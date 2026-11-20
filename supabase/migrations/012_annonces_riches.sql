-- =====================================================================
-- Qui paie ? / Who pays? — 012: « Un nouveau riche est arrivé » (R-031)
--  * annonces: one row each time a moderator ACTIVATES a rich member who was not active
--    (mod_activer_riche, replaces 010; an extension of an active period announces nothing).
--    Shown on the site for 72 h. get_annonces() is public and returns pseudo + link only.
--  * E-mail to the poor (code only, deployed by hand: docs/CONFIGURATION.md): the Edge Function
--    supabase/functions/annoncer-riche calls the srv_* functions below with the service role key.
--    Recipients: members of the poor camp, not blocked, newsletter ticked, e-mail confirmed.
--    At most 250 e-mails per rolling 24 h (Brevo free plan: 300 / day). annonce_envois remembers
--    who already got which announcement (never twice).
--  * Unsubscribe: profiles.jeton_desinscription (random, unguessable, one per member) in every
--    e-mail (desinscription.html?jeton=…); se_desinscrire(p_jeton) unticks the newsletter.
-- Tables: RLS forced, no privilege for anon / authenticated (same rule as 002 / 006).
-- 001 to 011 are NOT modified. Run after 011. Idempotent.
-- Same rules as api-demo.js (getAnnonces, seDesinscrire, moderation.annonces / annoncerParEmail).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables and column
-- ---------------------------------------------------------------------
create table if not exists public.annonces (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles (id) on delete cascade,
  cree_le   timestamptz not null default now(),
  expire_le timestamptz not null
);
create index if not exists annonces_expire_idx on public.annonces (expire_le desc);

create table if not exists public.annonce_envois (
  annonce_id uuid not null references public.annonces (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  envoye_le  timestamptz not null default now(),
  primary key (annonce_id, user_id)
);
create index if not exists annonce_envois_date_idx on public.annonce_envois (envoye_le);

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'jeton_desinscription') then
    alter table public.profiles add column jeton_desinscription uuid not null default gen_random_uuid();
    alter table public.profiles add constraint profiles_jeton_desinscription_unique unique (jeton_desinscription);
  end if;
end
$$;

do $$
declare
  v_bypass boolean;
begin
  select r.rolsuper or r.rolbypassrls into v_bypass from pg_catalog.pg_roles r where r.rolname = current_user;
  alter table public.annonces enable row level security;
  alter table public.annonce_envois enable row level security;
  if coalesce(v_bypass, false) then
    alter table public.annonces force row level security;
    alter table public.annonce_envois force row level security;
  else
    raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on annonces / annonce_envois', current_user;
  end if;
end
$$;
revoke all on public.annonces from public, anon, authenticated;
revoke all on public.annonce_envois from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Activation announces (replaces 010; same signature and grants)
-- ---------------------------------------------------------------------
create or replace function public.mod_activer_riche(p_user_id uuid, p_formule text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p       public.profiles;
  v_etait   boolean;
  v_debut   timestamptz;
  v_fin     timestamptz;
  v_annonce boolean := false;
begin
  perform public.wp_exiger_moderateur();
  if p_formule is null or p_formule not in ('mensuel', 'annuel') then
    perform public.wp_erreur('invalide', 'Formule inconnue (mensuel ou annuel).');
  end if;
  select * into v_p from public.profiles pr where pr.id = p_user_id for no key update;
  if not found then
    perform public.wp_erreur('introuvable', 'Membre introuvable.');
  end if;
  if v_p.camp <> 'riche' then
    perform public.wp_erreur('invalide', 'Ce membre n’est pas dans le camp des riches.');
  end if;
  v_etait := public.wp_riche_actif(v_p);
  v_debut := case when v_p.statut_riche = 'actif' and v_p.riche_jusqu_au > now() then v_p.riche_jusqu_au else now() end;
  v_fin := v_debut + case when p_formule = 'annuel' then interval '1 year' else interval '1 month' end;
  update public.profiles pr
  set statut_riche = 'actif', riche_formule = p_formule, riche_jusqu_au = v_fin
  where pr.id = p_user_id;
  if not v_etait then
    insert into public.annonces (user_id, expire_le) values (p_user_id, now() + interval '72 hours');
    v_annonce := true;
  end if;
  return jsonb_build_object('user_id', p_user_id, 'statut', 'actif', 'formule', p_formule,
                            'jusqu_au', v_fin, 'annonce', v_annonce);
end;
$fn$;
revoke all on function public.mod_activer_riche(uuid, text) from public, anon, authenticated;
grant execute on function public.mod_activer_riche(uuid, text) to authenticated;

-- Internal: link of an announcement (first publication still visible, otherwise the rich posts).
create or replace function public.wp_lien_annonce(p_user_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(
    (select 'p.html?id=' || p.id::text
     from public.problems p
     where p.user_id = p_user_id and p.type in ('riche', 'publication')
       and p.statut = 'publie' and not p.masque
     order by p.premiere desc, p.cree_le
     limit 1),
    'index.html?type=publication#mur');
$fn$;
revoke all on function public.wp_lien_annonce(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Public: current announcements (72 h), pseudo + link ONLY, newest first
-- ---------------------------------------------------------------------
create or replace function public.get_annonces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('pseudo', x.pseudo, 'lien', x.lien) order by x.cree_le desc)
    from (
      select pr.pseudo, public.wp_lien_annonce(a.user_id) as lien, a.cree_le
      from public.annonces a
      join public.profiles pr on pr.id = a.user_id
      where a.expire_le > now() and public.wp_riche_actif(pr) and not pr.bloque
      order by a.cree_le desc
      limit 5
    ) x
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_annonces() from public, anon, authenticated;
grant execute on function public.get_annonces() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Moderation: announcements of the last 7 days with the e-mail progress
-- ---------------------------------------------------------------------
create or replace function public.mod_annonces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_exiger_moderateur();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'user_id', a.user_id, 'pseudo', pr.pseudo, 'lien', public.wp_lien_annonce(a.user_id),
             'cree_le', a.cree_le, 'expire_le', a.expire_le, 'en_cours', a.expire_le > now(),
             'envoyes', (select count(*) from public.annonce_envois e where e.annonce_id = a.id),
             'destinataires', (select count(*) from public.profiles d
                               join auth.users u on u.id = d.id
                               where d.camp = 'pauvre' and d.newsletter and not d.bloque
                                 and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false))
           ) order by a.cree_le desc)
    from public.annonces a
    join public.profiles pr on pr.id = a.user_id
    where a.cree_le > now() - interval '7 days'
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.mod_annonces() from public, anon, authenticated;
grant execute on function public.mod_annonces() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Unsubscribe (public: the token is the only key)
-- ---------------------------------------------------------------------
create or replace function public.se_desinscrire(p_jeton uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if p_jeton is null then
    return false;
  end if;
  update public.profiles pr set newsletter = false where pr.jeton_desinscription = p_jeton;
  return found;
end;
$fn$;
revoke all on function public.se_desinscrire(uuid) from public, anon, authenticated;
grant execute on function public.se_desinscrire(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. E-mail sending, for the Edge Function only (service_role; never anon / authenticated)
-- ---------------------------------------------------------------------
-- Reserves up to p_max recipients (1 to 100) who have not received this announcement yet, within the
-- 250 e-mails per rolling 24 h budget. Returns { annonce: { pseudo, lien }, destinataires: [{ user_id,
-- email, pseudo, jeton }], restant_24h, reste_a_envoyer }. Reserved rows count as sent; the function
-- calls srv_annuler_envois for the ones Brevo refused.
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
  -- one reservation at a time (the budget is shared)
  perform pg_advisory_xact_lock(hashtext('wp_annonce_envois'));
  v_budget := greatest(0, c_plafond - (select count(*) from public.annonce_envois e where e.envoye_le > now() - interval '24 hours'));
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

-- Releases the reservations of the e-mails that could not be sent (they will be retried later).
create or replace function public.srv_annuler_envois(p_annonce_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  delete from public.annonce_envois e
  where e.annonce_id = p_annonce_id and e.user_id = any (coalesce(p_user_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.srv_reserver_envois(uuid, integer) from public, anon, authenticated;
revoke all on function public.srv_annuler_envois(uuid, uuid[])   from public, anon, authenticated;
grant execute on function public.srv_reserver_envois(uuid, integer) to service_role;
grant execute on function public.srv_annuler_envois(uuid, uuid[])   to service_role;
