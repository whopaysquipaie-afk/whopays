-- =====================================================================
-- Qui paie ? / Who pays? — 015: the powers of the rich (R-037)
--  * Crowns: an ACTIVE rich member crowns a published problem of the poor. 3 crowns per day
--    (Paris calendar day) at most, one per problem and per rich member, removable. A removed crown
--    is kept with retiree = true: it still counts in the day's 3 (no crown / uncrown loop) and
--    crowning again does not notify twice. couronner(p_problem_id), retirer_couronne(p_problem_id).
--  * On-site notifications (no e-mail): table notifications; "Le riche X a couronné ton problème".
--    mes_notifications() → { non_lues, liste }, marquer_notifications_lues().
--  * Reactions reserved to active rich members: 'yacht' (🛥️ Je regarde ça depuis mon yacht) and
--    'majordome' (🎩 Mon majordome s'en occupe). Everyone sees the counters.
--  * get_riche_de_la_semaine(): the active rich member (moderators excluded) who gave the most
--    crowns over 7 days, else the most recently registered active rich member, with their last
--    visible post; null if there is none.
--  * Public projection wp_probleme_json: + yacht, majordome, couronnes, couronne_par, ma_couronne.
--  * « Le problème du moment »: a crown given during the last 7 days weighs 10 reactions.
-- Every write goes through wp_exiger_membre (blocked / pending rich refused) and the IP limits of
-- 014 (quota "reaction"). 001 to 014 are NOT modified. Run after 014. Idempotent.
-- Same rules as api-demo.js (couronner, getMesNotifications, getRicheDeLaSemaine…).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.couronnes (
  problem_id uuid not null references public.problems (id) on delete cascade,
  riche_id   uuid not null references public.profiles (id) on delete cascade,
  retiree    boolean not null default false,
  cree_le    timestamptz not null default now(),
  primary key (problem_id, riche_id)
);
create index if not exists couronnes_riche_date_idx on public.couronnes (riche_id, cree_le);
create index if not exists couronnes_date_idx on public.couronnes (cree_le);

create table if not exists public.notifications (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type    text not null check (type ~ '^[a-z_]{2,30}$'),
  texte   text not null check (char_length(texte) between 1 and 200),
  -- relative link to a page of the site only
  lien    text check (lien is null or lien ~ '^[a-z]+\.html(\?[A-Za-z0-9=&_%.-]*)?(#[a-z-]+)?$'),
  lu      boolean not null default false,
  cree_le timestamptz not null default now()
);
create index if not exists notifications_user_date_idx on public.notifications (user_id, cree_le desc);

do $$
declare
  v_bypass boolean;
  v_table  text;
begin
  select r.rolbypassrls into v_bypass from pg_catalog.pg_roles r where r.rolname = current_user;
  foreach v_table in array array['couronnes', 'notifications'] loop
    execute format('alter table public.%I enable row level security', v_table);
    if coalesce(v_bypass, false) then
      execute format('alter table public.%I force row level security', v_table);
    else
      raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.%', current_user, v_table;
    end if;
  end loop;
end
$$;
revoke all on public.couronnes     from public, anon, authenticated;
revoke all on public.notifications from public, anon, authenticated;

-- Reactions of the rich
alter table public.reactions drop constraint if exists reactions_type_check;
alter table public.reactions add constraint reactions_type_check
  check (type in ('rire', 'courage', 'paierais', 'yacht', 'majordome'));

-- ---------------------------------------------------------------------
-- 2. Helpers (internal)
-- ---------------------------------------------------------------------

-- Start of the current day in Paris, as a timestamptz.
create or replace function public.wp_debut_jour_paris()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $fn$
  select (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
$fn$;

-- Adds a notification (keeps the 100 most recent ones of the member).
create or replace function public.wp_notifier(p_user_id uuid, p_type text, p_texte text, p_lien text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, type, texte, lien)
  values (p_user_id, p_type, left(p_texte, 200), p_lien);
  delete from public.notifications n
  where n.user_id = p_user_id
    and n.id not in (select x.id from public.notifications x where x.user_id = p_user_id
                     order by x.cree_le desc, x.id desc limit 100);
end;
$fn$;

-- Visible crowns of a problem (not removed, given by a rich member who is not blocked).
create or replace function public.wp_nb_couronnes(p_problem_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select count(*) from public.couronnes c
  join public.profiles pr on pr.id = c.riche_id and not pr.bloque
  where c.problem_id = p_problem_id and not c.retiree;
$fn$;

revoke all on function public.wp_debut_jour_paris()                    from public, anon, authenticated;
revoke all on function public.wp_notifier(uuid, text, text, text)      from public, anon, authenticated;
revoke all on function public.wp_nb_couronnes(uuid)                    from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Public projection (replaces 011): + yacht, majordome, couronnes, couronne_par, ma_couronne
-- ---------------------------------------------------------------------
create or replace function public.wp_probleme_json(p public.problems)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_pseudo text;
  v_camp   text;
  v_nb     bigint := public.wp_nb_couronnes(p.id);
begin
  if p.est_exemple or p.user_id is null then
    v_pseudo := 'L''équipe Qui paie ?';
    v_camp := null;
  else
    select pr.pseudo, pr.camp into v_pseudo, v_camp from public.profiles pr where pr.id = p.user_id;
    if not found then
      v_pseudo := 'Membre parti';
      v_camp := null;
    end if;
  end if;
  return jsonb_build_object(
    'id',               p.id,
    'type',             p.type,
    'premiere',         p.premiere,
    'categorie',        p.categorie,
    'titre',            p.titre,
    'texte',            p.texte,
    'montant',          p.montant,
    'pseudo',           v_pseudo,
    'camp',             v_camp,
    'est_exemple',      p.est_exemple,
    'cree_le',          coalesce(p.modere_le, p.cree_le),
    'rire',             (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'rire'),
    'courage',          (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'courage'),
    'paierais',         (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'paierais'),
    'yacht',            (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'yacht'),
    'majordome',        (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'majordome'),
    'commentaires',     (select count(*) from public.comments c where c.problem_id = p.id and not c.masque),
    'couronnes',        v_nb,
    -- the first rich member who crowned it (pseudo only), when there is exactly one
    'couronne_par',     case when v_nb = 1 then (
                          select pr.pseudo from public.couronnes c
                          join public.profiles pr on pr.id = c.riche_id and not pr.bloque
                          where c.problem_id = p.id and not c.retiree limit 1) end,
    'ma_couronne',      coalesce(v_uid is not null and exists (
                          select 1 from public.couronnes c where c.problem_id = p.id and c.riche_id = v_uid and not c.retiree), false),
    'est_mon_probleme', coalesce(v_uid is not null and p.user_id = v_uid, false)
  );
end;
$fn$;
revoke all on function public.wp_probleme_json(public.problems) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Reactions (replaces the core of 014; the wrapper reagir keeps the IP limit)
-- ---------------------------------------------------------------------
create or replace function public.wp_coeur_reagir(p_problem_id uuid, p_type text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p     public.profiles;
  v_actif boolean;
begin
  v_p := public.wp_exiger_membre(true);
  if p_type is null or p_type not in ('rire', 'courage', 'paierais', 'yacht', 'majordome') then
    perform public.wp_erreur('invalide', 'Réaction inconnue.');
  end if;
  -- wp_exiger_membre already refuses a pending rich member
  if p_type in ('yacht', 'majordome') and v_p.camp <> 'riche' then
    perform public.wp_erreur('interdit', 'Cette réaction est réservée aux riches validés. Toi, tu as le droit de rire.');
  end if;
  if not exists (
    select 1 from public.problems p
    where p.id = p_problem_id and p.statut = 'publie' and not p.masque
  ) then
    perform public.wp_erreur('introuvable', 'Ce problème est introuvable ou n’est pas publié.');
  end if;
  delete from public.reactions r
  where r.problem_id = p_problem_id and r.user_id = v_p.id and r.type = p_type;
  if found then
    v_actif := false;
  else
    insert into public.reactions (problem_id, user_id, type)
    values (p_problem_id, v_p.id, p_type)
    on conflict do nothing;
    v_actif := true;
  end if;
  return jsonb_build_object(
    'actif',     v_actif,
    'rire',      (select count(*) from public.reactions r where r.problem_id = p_problem_id and r.type = 'rire'),
    'courage',   (select count(*) from public.reactions r where r.problem_id = p_problem_id and r.type = 'courage'),
    'paierais',  (select count(*) from public.reactions r where r.problem_id = p_problem_id and r.type = 'paierais'),
    'yacht',     (select count(*) from public.reactions r where r.problem_id = p_problem_id and r.type = 'yacht'),
    'majordome', (select count(*) from public.reactions r where r.problem_id = p_problem_id and r.type = 'majordome')
  );
end;
$fn$;
revoke all on function public.wp_coeur_reagir(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Crowns
-- ---------------------------------------------------------------------
-- { couronne: true, couronnes: <visible crowns>, restantes: <crowns left today> }
create or replace function public.couronner(p_problem_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p      public.profiles;
  v_pb     public.problems;
  v_c      public.couronnes;
  v_jour   integer;
  v_existe boolean;
begin
  perform public.wp_limite_ip('reaction');
  v_p := public.wp_exiger_membre(true);   -- blocked / pending rich refused
  if v_p.camp <> 'riche' then
    perform public.wp_erreur('interdit', 'Seuls les riches validés distribuent des couronnes. Toi, tu peux réagir.');
  end if;
  select * into v_pb from public.problems p
  where p.id = p_problem_id and p.statut = 'publie' and not p.masque and p.type = 'pauvre';
  if not found then
    perform public.wp_erreur('introuvable', 'Ce problème de pauvre est introuvable ou n’est pas publié.');
  end if;
  select * into v_c from public.couronnes c where c.problem_id = p_problem_id and c.riche_id = v_p.id;
  v_existe := found;
  v_jour := (select count(*) from public.couronnes c
             where c.riche_id = v_p.id and c.cree_le >= public.wp_debut_jour_paris());
  if v_existe and not v_c.retiree then
    null;  -- already crowned: nothing to do
  elsif v_existe then
    update public.couronnes c set retiree = false where c.problem_id = p_problem_id and c.riche_id = v_p.id;
  else
    if v_jour >= 3 then
      perform public.wp_erreur('limite', 'Tu as déjà distribué tes 3 couronnes du jour. Le trésor royal rouvre demain.');
    end if;
    insert into public.couronnes (problem_id, riche_id) values (p_problem_id, v_p.id);
    v_jour := v_jour + 1;
    if v_pb.user_id is not null and v_pb.user_id <> v_p.id then
      perform public.wp_notifier(v_pb.user_id, 'couronne',
        'Le riche ' || v_p.pseudo || ' a couronné ton problème « ' || left(v_pb.titre, 80) || ' » 👑',
        'p.html?id=' || v_pb.id::text);
    end if;
  end if;
  return jsonb_build_object('couronne', true, 'couronnes', public.wp_nb_couronnes(p_problem_id),
                            'restantes', greatest(0, 3 - v_jour));
end;
$fn$;
revoke all on function public.couronner(uuid) from public, anon, authenticated;
grant execute on function public.couronner(uuid) to authenticated;

create or replace function public.retirer_couronne(p_problem_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.profiles;
begin
  v_p := public.wp_exiger_membre(true);
  if v_p.camp <> 'riche' then
    perform public.wp_erreur('interdit', 'Seuls les riches validés distribuent des couronnes. Toi, tu peux réagir.');
  end if;
  update public.couronnes c set retiree = true where c.problem_id = p_problem_id and c.riche_id = v_p.id;
  return jsonb_build_object('couronne', false, 'couronnes', public.wp_nb_couronnes(p_problem_id),
    'restantes', greatest(0, 3 - (select count(*) from public.couronnes c
                                  where c.riche_id = v_p.id and c.cree_le >= public.wp_debut_jour_paris())));
end;
$fn$;
revoke all on function public.retirer_couronne(uuid) from public, anon, authenticated;
grant execute on function public.retirer_couronne(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Notifications
-- ---------------------------------------------------------------------
-- { non_lues, liste: [{ id, type, texte, lien, lu, cree_le }] } (30 most recent); empty without profile.
create or replace function public.mes_notifications()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles pr where pr.id = v_uid) then
    return jsonb_build_object('non_lues', 0, 'liste', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'non_lues', (select count(*) from public.notifications n where n.user_id = v_uid and not n.lu),
    'liste', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.type, 'texte', x.texte, 'lien', x.lien,
                                          'lu', x.lu, 'cree_le', x.cree_le) order by x.cree_le desc, x.id desc)
      from (select n.* from public.notifications n where n.user_id = v_uid
            order by n.cree_le desc, n.id desc limit 30) x
    ), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.mes_notifications() from public, anon, authenticated;
grant execute on function public.mes_notifications() to authenticated;

-- Marks every notification of the caller as read; returns how many changed.
create or replace function public.marquer_notifications_lues()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null then
    perform public.wp_erreur('non_connecte', 'Rejoins un camp pour faire ça, ça prend 10 secondes.');
  end if;
  update public.notifications n set lu = true where n.user_id = v_uid and not n.lu;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;
revoke all on function public.marquer_notifications_lues() from public, anon, authenticated;
grant execute on function public.marquer_notifications_lues() to authenticated;

-- ---------------------------------------------------------------------
-- 7. « Le riche de la semaine »
-- ---------------------------------------------------------------------
-- { pseudo, camp, couronnes_7j, derniere (public projection or null) } or null.
create or replace function public.get_riche_de_la_semaine()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_r  public.profiles;
  v_nb bigint;
  v_pb public.problems;
begin
  select pr.* into v_r
  from public.profiles pr
  left join lateral (
    select count(*) as nb from public.couronnes c
    where c.riche_id = pr.id and not c.retiree and c.cree_le > now() - interval '7 days'
  ) k on true
  where pr.camp = 'riche' and not pr.bloque and public.wp_riche_actif(pr)
    and not exists (select 1 from public.moderateurs m where m.user_id = pr.id)
  order by coalesce(k.nb, 0) desc, pr.cree_le desc, pr.id
  limit 1;
  if not found then
    return null;
  end if;
  v_nb := (select count(*) from public.couronnes c
           where c.riche_id = v_r.id and not c.retiree and c.cree_le > now() - interval '7 days');
  select p.* into v_pb from public.problems p
  where p.user_id = v_r.id and p.type in ('riche', 'publication') and p.statut = 'publie' and not p.masque
  order by coalesce(p.modere_le, p.cree_le) desc, p.id desc
  limit 1;
  return jsonb_build_object(
    'pseudo', v_r.pseudo,
    'camp', v_r.camp,
    'couronnes_7j', v_nb,
    'derniere', case when v_pb.id is null then null else public.wp_probleme_json(v_pb) end
  );
end;
$fn$;
revoke all on function public.get_riche_de_la_semaine() from public, anon, authenticated;
grant execute on function public.get_riche_de_la_semaine() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. « Le problème du moment » (replaces 013): a crown of the last 7 days = 10 reactions
-- ---------------------------------------------------------------------
create or replace function public.get_probleme_du_moment()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_pb public.problems;
begin
  select p.* into v_pb
  from public.problems p
  join public.profiles pr on pr.id = p.user_id and not pr.bloque
  left join lateral (
    select count(*) as nb
    from public.reactions r
    where r.problem_id = p.id and r.cree_le > now() - interval '7 days'
  ) rx on true
  left join lateral (
    select count(*) as nb
    from public.couronnes c
    join public.profiles cr on cr.id = c.riche_id and not cr.bloque
    where c.problem_id = p.id and not c.retiree and c.cree_le > now() - interval '7 days'
  ) cx on true
  where p.type = 'pauvre'
    and p.statut = 'publie'
    and not p.masque
    and not p.est_exemple
  order by rx.nb + 10 * cx.nb desc, coalesce(p.modere_le, p.cree_le) desc, p.id desc
  limit 1;

  if not found then
    return null;
  end if;
  return public.wp_probleme_json(v_pb);
end;
$fn$;
revoke all on function public.get_probleme_du_moment() from public, anon, authenticated;
grant execute on function public.get_probleme_du_moment() to anon, authenticated;
