-- =====================================================================
-- Qui paie ? / Who pays? — 019: follow a profile (R-047)
--  * Table suivis (suiveur_id, suivi_id, cree_le): RLS forced, no grant, primary key on the pair,
--    nobody follows themself.
--  * suivre(p_code) / ne_plus_suivre(p_code): by share code, never by id. A member is required
--    (visitor refused, blocked member and pending rich member refused by wp_exiger_membre), IP quota
--    "reaction" of 014. Following twice changes nothing. → { suivi, abonnes }
--  * mes_suivis(): the accounts I follow: pseudo, camp, code, badges and their last visible post.
--  * get_fil_suivis(p_limite, p_avant): the wall « Mes suivis » (posts of the accounts I follow,
--    newest first, same projection and pagination as get_problemes_publics).
--  * get_plus_suivis(): top 10 poor and top 5 rich by number of followers (pseudo, code, abonnes).
--  * get_profil_public (replaces 018): + abonnes, je_suis (does the caller follow this member).
--  * Notification « X a publié … » to the followers when a followed account publishes (the wrappers
--    soumettre_probleme / publier_riche of 014 are replaced: same signatures, same IP limits).
-- Never an id, never an e-mail. 001 to 018 are NOT modified. Run after 018. Idempotent.
-- Same rules as api-demo.js (suivre, getMesSuivis, getFilSuivis, getPlusSuivis…).
-- =====================================================================

create table if not exists public.suivis (
  suiveur_id uuid not null references public.profiles (id) on delete cascade,
  suivi_id   uuid not null references public.profiles (id) on delete cascade,
  cree_le    timestamptz not null default now(),
  primary key (suiveur_id, suivi_id),
  constraint suivis_pas_soi check (suiveur_id <> suivi_id)
);
create index if not exists suivis_suivi_idx on public.suivis (suivi_id);

do $$
declare
  v_bypass boolean;
begin
  select r.rolbypassrls into v_bypass from pg_catalog.pg_roles r where r.rolname = current_user;
  alter table public.suivis enable row level security;
  if coalesce(v_bypass, false) then
    alter table public.suivis force row level security;
  else
    raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.suivis', current_user;
  end if;
end
$$;
revoke all on public.suivis from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Helpers (internal)
-- ---------------------------------------------------------------------
create or replace function public.wp_nb_abonnes(p_user_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select count(*) from public.suivis s
  join public.profiles pr on pr.id = s.suiveur_id and not pr.bloque
  where s.suivi_id = p_user_id;
$fn$;
revoke all on function public.wp_nb_abonnes(uuid) from public, anon, authenticated;

-- « Caviar Gauche a publié : « … » » to the followers of the author of a published post (500 max).
create or replace function public.wp_notifier_suiveurs(p_problem_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_pb public.problems;
  v_a  public.profiles;
  v_s  record;
begin
  select * into v_pb from public.problems p where p.id = p_problem_id and p.statut = 'publie' and not p.masque;
  if not found or v_pb.user_id is null then
    return;
  end if;
  select * into v_a from public.profiles pr where pr.id = v_pb.user_id;
  for v_s in
    select s.suiveur_id from public.suivis s
    join public.profiles pr on pr.id = s.suiveur_id and not pr.bloque
    where s.suivi_id = v_pb.user_id
    order by s.cree_le
    limit 500
  loop
    perform public.wp_notifier(v_s.suiveur_id, 'suivi',
      v_a.pseudo || ' a publié : « ' || left(coalesce(v_pb.titre, v_pb.texte), 80) || ' »',
      'p.html?id=' || v_pb.id::text);
  end loop;
end;
$fn$;
revoke all on function public.wp_notifier_suiveurs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Follow / unfollow
-- ---------------------------------------------------------------------
create or replace function public.suivre(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.profiles;
  v_c public.profiles;
begin
  perform public.wp_limite_ip('reaction');
  v_p := public.wp_exiger_membre(false);
  v_c := public.wp_profil_par_code(p_code);
  if v_c.id is null then
    perform public.wp_erreur('introuvable', 'Ce membre est introuvable.');
  end if;
  if v_c.id = v_p.id then
    perform public.wp_erreur('invalide', 'Tu ne peux pas te suivre toi-même. Même si tu es très drôle.');
  end if;
  insert into public.suivis (suiveur_id, suivi_id) values (v_p.id, v_c.id) on conflict do nothing;
  return jsonb_build_object('suivi', true, 'abonnes', public.wp_nb_abonnes(v_c.id));
end;
$fn$;
revoke all on function public.suivre(text) from public, anon, authenticated;
grant execute on function public.suivre(text) to authenticated;

create or replace function public.ne_plus_suivre(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.profiles;
  v_c public.profiles;
begin
  v_p := public.wp_exiger_membre(false);
  v_c := public.wp_profil_par_code(p_code);
  if v_c.id is null then
    perform public.wp_erreur('introuvable', 'Ce membre est introuvable.');
  end if;
  delete from public.suivis s where s.suiveur_id = v_p.id and s.suivi_id = v_c.id;
  return jsonb_build_object('suivi', false, 'abonnes', public.wp_nb_abonnes(v_c.id));
end;
$fn$;
revoke all on function public.ne_plus_suivre(text) from public, anon, authenticated;
grant execute on function public.ne_plus_suivre(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Reads
-- ---------------------------------------------------------------------
-- [{ pseudo, camp, code, badges, dernier }] (followed accounts, not blocked; most recent activity first).
create or replace function public.mes_suivis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'pseudo', x.pseudo, 'camp', x.camp, 'code', x.code_partage,
             'badges', public.wp_badges(x.id),
             'dernier', case when (x.dernier).id is null then null else public.wp_probleme_json(x.dernier) end
           ) order by coalesce(x.date_dernier, x.suivi_le) desc, x.pseudo)
    from (
      select pr.id, pr.pseudo, pr.camp, pr.code_partage, s.cree_le as suivi_le, d.pb as dernier, d.date_affichee as date_dernier
      from public.suivis s
      join public.profiles pr on pr.id = s.suivi_id and not pr.bloque
      left join lateral (
        select p as pb, coalesce(p.modere_le, p.cree_le) as date_affichee from public.problems p
        where p.user_id = pr.id and p.statut = 'publie' and not p.masque and not p.est_exemple
        order by coalesce(p.modere_le, p.cree_le) desc, p.id desc limit 1
      ) d on true
      where s.suiveur_id = v_uid
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.mes_suivis() from public, anon, authenticated;
grant execute on function public.mes_suivis() to authenticated;

-- The wall « Mes suivis »: same projection and pagination as get_problemes_publics (48 max).
create or replace function public.get_fil_suivis(p_limite integer default 12, p_avant timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_limite integer := greatest(1, least(48, coalesce(p_limite, 12)));
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(public.wp_probleme_json(x.pb) order by x.date_affichee desc, (x.pb).id desc)
    from (
      select p as pb, coalesce(p.modere_le, p.cree_le) as date_affichee
      from public.problems p
      join public.suivis s on s.suivi_id = p.user_id and s.suiveur_id = v_uid
      join public.profiles pr on pr.id = p.user_id and not pr.bloque
      where p.statut = 'publie' and not p.masque and not p.est_exemple
        and (p_avant is null or coalesce(p.modere_le, p.cree_le) < p_avant)
      order by coalesce(p.modere_le, p.cree_le) desc, p.id desc
      limit v_limite
    ) x
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_fil_suivis(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.get_fil_suivis(integer, timestamptz) to authenticated;

-- { pauvres: top 10, riches: top 5 } by number of followers: [{ pseudo, camp, code, abonnes }].
create or replace function public.get_plus_suivis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_camp text;
  v_res  jsonb := '{}'::jsonb;
begin
  foreach v_camp in array array['pauvre', 'riche'] loop
    v_res := v_res || jsonb_build_object(v_camp || 's', coalesce((
      select jsonb_agg(jsonb_build_object('pseudo', t.pseudo, 'camp', t.camp, 'code', t.code_partage, 'abonnes', t.nb)
                       order by t.nb desc, t.cree_le, t.pseudo)
      from (
        select pr.pseudo, pr.camp, pr.code_partage, pr.cree_le, count(*) as nb
        from public.suivis s
        join public.profiles pr on pr.id = s.suivi_id and not pr.bloque and pr.camp = v_camp
        join public.profiles f on f.id = s.suiveur_id and not f.bloque
        where v_camp = 'pauvre' or public.wp_riche_actif(pr)
        group by pr.id
        order by count(*) desc, pr.cree_le, pr.pseudo
        limit case when v_camp = 'pauvre' then 10 else 5 end
      ) t
    ), '[]'::jsonb));
  end loop;
  return v_res;
end;
$fn$;
revoke all on function public.get_plus_suivis() from public, anon, authenticated;
grant execute on function public.get_plus_suivis() to anon, authenticated;

-- get_profil_public (replaces 018): + abonnes, je_suis.
create or replace function public.get_profil_public(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles := public.wp_profil_par_code(p_code);
  v_m   record;
  v_g   record;
  v_r   jsonb := '{}'::jsonb;
begin
  if v_p.id is null then
    return null;
  end if;
  if v_p.camp = 'pauvre' then
    select c.* into v_m from public.wp_classement_pauvres_depuis(public.wp_debut_mois_paris()) c where c.user_id = v_p.id;
    select c.* into v_g from public.wp_classement_pauvres_depuis(null) c where c.user_id = v_p.id;
    v_r := jsonb_build_object(
      'rang_mois',    jsonb_build_object('rang', v_m.rang,
                        'sur', (select count(*) from public.wp_classement_pauvres_depuis(public.wp_debut_mois_paris()))),
      'rang_general', jsonb_build_object('rang', v_g.rang,
                        'sur', (select count(*) from public.wp_classement_pauvres_depuis(null))),
      'total', coalesce(v_g.total, 0),
      'nb',    coalesce(v_g.nb, 0));
  end if;
  return v_r || jsonb_build_object(
    'pseudo',       v_p.pseudo,
    'camp',         v_p.camp,
    'code',         v_p.code_partage,
    'statut_riche', public.wp_statut_riche(v_p),
    'arrive_le',    (v_p.cree_le at time zone 'Europe/Paris')::date,
    'badges',       public.wp_badges(v_p.id),
    'abonnes',      public.wp_nb_abonnes(v_p.id),
    'je_suis',      coalesce(v_uid is not null and exists (
                      select 1 from public.suivis s where s.suiveur_id = v_uid and s.suivi_id = v_p.id), false),
    'problemes', coalesce((
      select jsonb_agg(public.wp_probleme_json(x) order by coalesce(x.modere_le, x.cree_le) desc, x.id desc)
      from (select p.* from public.problems p
            where p.user_id = v_p.id and p.statut = 'publie' and not p.masque and not p.est_exemple
            order by coalesce(p.modere_le, p.cree_le) desc, p.id desc limit 24) x
    ), '[]'::jsonb),
    'couronnes_donnees', case when v_p.camp <> 'riche' then '[]'::jsonb else coalesce((
      select jsonb_agg(public.wp_probleme_json(x.pb) order by x.couronne_le desc, (x.pb).id desc)
      from (select p as pb, c.cree_le as couronne_le from public.couronnes c
            join public.problems p on p.id = c.problem_id and p.statut = 'publie' and not p.masque
            where c.riche_id = v_p.id and not c.retiree
            order by c.cree_le desc limit 12) x
    ), '[]'::jsonb) end
  );
end;
$fn$;
revoke all on function public.get_profil_public(text) from public, anon, authenticated;
grant execute on function public.get_profil_public(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Publishing notifies the followers (replaces the wrappers of 014; same signatures and limits)
-- ---------------------------------------------------------------------
create or replace function public.soumettre_probleme(
  p_categorie text,
  p_titre     text,
  p_texte     text,
  p_montant   integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_r jsonb;
begin
  perform public.wp_limite_ip('publication');
  v_r := public.wp_coeur_soumettre_probleme(p_categorie, p_titre, p_texte, p_montant);
  if v_r ->> 'statut' = 'publie' then
    perform public.wp_notifier_suiveurs((v_r ->> 'id')::uuid);
  end if;
  return v_r;
end;
$fn$;
revoke all on function public.soumettre_probleme(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.soumettre_probleme(text, text, text, integer) to authenticated;

create or replace function public.publier_riche(
  p_type    text,
  p_texte   text,
  p_titre   text default null,
  p_montant integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_r jsonb;
begin
  perform public.wp_limite_ip('publication');
  v_r := public.wp_coeur_publier_riche(p_type, p_texte, p_titre, p_montant);
  if v_r ->> 'statut' = 'publie' then
    perform public.wp_notifier_suiveurs((v_r ->> 'id')::uuid);
  end if;
  return v_r;
end;
$fn$;
revoke all on function public.publier_riche(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.publier_riche(text, text, text, integer) to authenticated;
