-- =====================================================================
-- Qui paie ? / Who pays? — 021: « La Gazette des pauvres » (R-043) — weekly e-mail, code only
--  * Content computed by wp_contenu_gazette(): top 5 of the week (reactions + 10 per crown + 2 per
--    duel win over 7 days), the poor of the month, the new rich members of the week, the themes of the
--    next week. Frozen once per week (table gazettes, one row per Monday in Paris) when the first
--    e-mail of the week is reserved: everyone receives the same issue.
--  * Recipients: members (both camps) who ticked the box (same consent and same unsubscribe link as
--    012), e-mail confirmed, not blocked; never twice the same issue (table gazette_envois).
--  * Daily budget SHARED with the announcements of 012: 250 e-mails per rolling 24 h, announcements
--    and gazette together (srv_reserver_envois of 012 is replaced: same signature, counts both).
--  * mod_gazette_apercu(): moderators only, the issue as it would be sent + counters (preview in
--    moderation.html). srv_gazette_reserver / srv_gazette_annuler: service_role only (Edge Function
--    « gazette »). Nothing scheduled: the pg_cron job is documented in docs/CONFIGURATION.md, NOT enabled.
-- 001 to 020 are NOT modified. Run after 020. Idempotent.
-- =====================================================================

create table if not exists public.gazettes (
  id      uuid primary key default gen_random_uuid(),
  semaine date not null unique,
  contenu jsonb not null,
  cree_le timestamptz not null default now()
);

create table if not exists public.gazette_envois (
  gazette_id uuid not null references public.gazettes (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  envoye_le  timestamptz not null default now(),
  primary key (gazette_id, user_id)
);
create index if not exists gazette_envois_date_idx on public.gazette_envois (envoye_le);

do $$
declare
  v_bypass boolean;
  v_table  text;
begin
  select r.rolbypassrls into v_bypass from pg_catalog.pg_roles r where r.rolname = current_user;
  foreach v_table in array array['gazettes', 'gazette_envois'] loop
    execute format('alter table public.%I enable row level security', v_table);
    if coalesce(v_bypass, false) then
      execute format('alter table public.%I force row level security', v_table);
    else
      raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.%', current_user, v_table;
    end if;
  end loop;
end
$$;
revoke all on public.gazettes       from public, anon, authenticated;
revoke all on public.gazette_envois from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Helpers (internal)
-- ---------------------------------------------------------------------
-- Monday of the current week in Paris.
create or replace function public.wp_lundi_paris()
returns date
language sql
stable
security invoker
set search_path = ''
as $fn$
  select (date_trunc('week', now() at time zone 'Europe/Paris'))::date;
$fn$;

-- E-mails reserved during the last 24 h, announcements and gazette together (shared budget: 250).
create or replace function public.wp_envois_24h()
returns integer
language sql
stable
security invoker
set search_path = ''
as $fn$
  select ((select count(*) from public.annonce_envois e where e.envoye_le > now() - interval '24 hours')
        + (select count(*) from public.gazette_envois g where g.envoye_le > now() - interval '24 hours'))::integer;
$fn$;

-- The issue of the week, computed now (no id, no e-mail: pseudos and relative links only).
create or replace function public.wp_contenu_gazette()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select jsonb_build_object(
    'semaine', public.wp_lundi_paris(),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('titre', t.titre, 'montant', t.montant, 'pseudo', t.pseudo,
                                          'lien', 'p.html?id=' || t.id::text) order by t.score desc, t.date_affichee desc)
      from (
        select p.id, p.titre, p.montant, pr.pseudo, coalesce(p.modere_le, p.cree_le) as date_affichee,
               (select count(*) from public.reactions r where r.problem_id = p.id and r.cree_le > now() - interval '7 days')
               + 10 * (select count(*) from public.couronnes c where c.problem_id = p.id and not c.retiree
                         and c.cree_le > now() - interval '7 days')
               + 2 * (select count(*) from public.duels d where d.gagnant_id = p.id and d.cree_le > now() - interval '7 days')
               as score
        from public.problems p
        join public.profiles pr on pr.id = p.user_id and not pr.bloque
        where p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple
        order by score desc, coalesce(p.modere_le, p.cree_le) desc
        limit 5
      ) t
    ), '[]'::jsonb),
    'pauvre_du_mois', (
      select jsonb_build_object('pseudo', c.pseudo, 'total', c.total, 'lien', 'profil.html?c=' || pr.code_partage)
      from public.wp_classement_pauvres_depuis(public.wp_debut_mois_paris()) c
      join public.profiles pr on pr.id = c.user_id
      where c.rang = 1
    ),
    'nouveaux_riches', coalesce((
      select jsonb_agg(jsonb_build_object('pseudo', pr.pseudo, 'lien', public.wp_lien_annonce(pr.id)) order by a.cree_le desc)
      from public.annonces a
      join public.profiles pr on pr.id = a.user_id and not pr.bloque and public.wp_riche_actif(pr)
      where a.cree_le > now() - interval '7 days'
    ), '[]'::jsonb),
    -- themes of the next week (same days as site/assets/js/themes.js)
    'themes', '[{"jour": "lundi", "theme": "Mon patron"}, {"jour": "mardi", "theme": "J''ai des factures à payer"},
                {"jour": "mercredi", "theme": "Ma vie amoureuse"}, {"jour": "jeudi", "theme": "Je veux aider ma famille"},
                {"jour": "vendredi", "theme": "Je veux me faire plaisir"}, {"jour": "samedi", "theme": "J''ai un rêve"},
                {"jour": "dimanche", "theme": "Mon défi"}]'::jsonb
  );
$fn$;

-- Recipients of the gazette that have not received this issue.
create or replace function public.wp_destinataires_gazette(p_gazette_id uuid)
returns table (user_id uuid, email text, pseudo text, jeton uuid, cree_le timestamptz)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select d.id, d.email, d.pseudo, d.jeton_desinscription, d.cree_le
  from public.profiles d
  join auth.users u on u.id = d.id
  where d.newsletter and not d.bloque
    and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
    and (p_gazette_id is null or not exists (
      select 1 from public.gazette_envois g where g.gazette_id = p_gazette_id and g.user_id = d.id));
$fn$;

revoke all on function public.wp_lundi_paris()                    from public, anon, authenticated;
revoke all on function public.wp_envois_24h()                     from public, anon, authenticated;
revoke all on function public.wp_contenu_gazette()                from public, anon, authenticated;
revoke all on function public.wp_destinataires_gazette(uuid)      from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Moderators: preview
-- ---------------------------------------------------------------------
-- { contenu, figee (the issue of the week is already frozen), envoyes, destinataires, restant_24h }
create or replace function public.mod_gazette_apercu()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_g public.gazettes;
begin
  perform public.wp_exiger_moderateur();
  select * into v_g from public.gazettes g where g.semaine = public.wp_lundi_paris();
  return jsonb_build_object(
    'contenu', coalesce(v_g.contenu, public.wp_contenu_gazette()),
    'figee', v_g.id is not null,
    'envoyes', (select count(*) from public.gazette_envois e where e.gazette_id = v_g.id),
    'destinataires', (select count(*) from public.wp_destinataires_gazette(null)),
    'restant_24h', greatest(0, 250 - public.wp_envois_24h())
  );
end;
$fn$;
revoke all on function public.mod_gazette_apercu() from public, anon, authenticated;
grant execute on function public.mod_gazette_apercu() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Sending, for the Edge Function only (service_role)
-- ---------------------------------------------------------------------
-- Freezes the issue of the week if needed, reserves up to p_max recipients (1 to 100) within the shared
-- budget. → { gazette: { id, contenu }, destinataires: [{ user_id, email, pseudo, jeton }], restant_24h, reste_a_envoyer }
create or replace function public.srv_gazette_reserver(p_max integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_plafond constant integer := 250;
  v_g       public.gazettes;
  v_budget  integer;
  v_lot     jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('wp_annonce_envois'));   -- same lock as the announcements
  insert into public.gazettes (semaine, contenu) values (public.wp_lundi_paris(), public.wp_contenu_gazette())
  on conflict (semaine) do nothing;
  select * into v_g from public.gazettes g where g.semaine = public.wp_lundi_paris();
  v_budget := greatest(0, c_plafond - public.wp_envois_24h());
  with choisis as (
    select d.* from public.wp_destinataires_gazette(v_g.id) d
    order by d.cree_le, d.user_id
    limit least(v_budget, greatest(1, least(100, coalesce(p_max, 50))))
  ), reserves as (
    insert into public.gazette_envois (gazette_id, user_id)
    select v_g.id, c.user_id from choisis c
    returning user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'email', c.email, 'pseudo', c.pseudo, 'jeton', c.jeton)), '[]'::jsonb)
    into v_lot
  from choisis c join reserves r on r.user_id = c.user_id;
  return jsonb_build_object(
    'gazette', jsonb_build_object('id', v_g.id, 'contenu', v_g.contenu),
    'destinataires', v_lot,
    'restant_24h', greatest(0, v_budget - jsonb_array_length(v_lot)),
    'reste_a_envoyer', (select count(*) from public.wp_destinataires_gazette(v_g.id))
  );
end;
$fn$;

create or replace function public.srv_gazette_annuler(p_gazette_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  delete from public.gazette_envois e
  where e.gazette_id = p_gazette_id and e.user_id = any (coalesce(p_user_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;
revoke all on function public.srv_gazette_reserver(integer)       from public, anon, authenticated;
revoke all on function public.srv_gazette_annuler(uuid, uuid[])   from public, anon, authenticated;
grant execute on function public.srv_gazette_reserver(integer)     to service_role;
grant execute on function public.srv_gazette_annuler(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------
-- 4. Announcements (replaces 012; same signature and grants): the budget now counts the gazette too
-- ---------------------------------------------------------------------
create or replace function public.srv_reserver_envois(p_annonce_id uuid, p_max integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_plafond constant integer := 250;
  v_annonce public.annonces;
  v_pseudo  text;
  v_budget  integer;
  v_lot     jsonb;
begin
  select * into v_annonce from public.annonces a where a.id = p_annonce_id;
  if not found then
    perform public.wp_erreur('introuvable', 'Annonce introuvable.');
  end if;
  select pr.pseudo into v_pseudo from public.profiles pr where pr.id = v_annonce.user_id;
  perform pg_advisory_xact_lock(hashtext('wp_annonce_envois'));
  v_budget := greatest(0, c_plafond - public.wp_envois_24h());
  with choisis as (
    select d.id, d.email, d.pseudo, d.jeton_desinscription
    from public.profiles d
    join auth.users u on u.id = d.id
    where d.camp = 'pauvre' and d.newsletter and not d.bloque
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.annonce_envois e where e.annonce_id = p_annonce_id and e.user_id = d.id)
    order by d.cree_le, d.id
    limit least(v_budget, greatest(1, least(100, coalesce(p_max, 50))))
  ), reserves as (
    insert into public.annonce_envois (annonce_id, user_id)
    select p_annonce_id, c.id from choisis c
    returning user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', c.id, 'email', c.email, 'pseudo', c.pseudo,
                                               'jeton', c.jeton_desinscription)), '[]'::jsonb)
    into v_lot
  from choisis c join reserves r on r.user_id = c.id;
  return jsonb_build_object(
    'annonce', jsonb_build_object('pseudo', v_pseudo, 'lien', public.wp_lien_annonce(v_annonce.user_id),
                                  'en_cours', v_annonce.expire_le > now()),
    'destinataires', v_lot,
    'restant_24h', greatest(0, v_budget - jsonb_array_length(v_lot)),
    'reste_a_envoyer', (select count(*) from public.profiles d
                        join auth.users u on u.id = d.id
                        where d.camp = 'pauvre' and d.newsletter and not d.bloque
                          and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
                          and not exists (select 1 from public.annonce_envois e
                                          where e.annonce_id = p_annonce_id and e.user_id = d.id))
  );
end;
$fn$;
revoke all on function public.srv_reserver_envois(uuid, integer) from public, anon, authenticated;
grant execute on function public.srv_reserver_envois(uuid, integer) to service_role;
