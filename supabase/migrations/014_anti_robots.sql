-- =====================================================================
-- Qui paie ? / Who pays? — 014: anti-bot limits per IP address (R-035)
--  * The visitor's IP is read from the PostgREST request headers (current_setting('request.headers')):
--    'cf-connecting-ip' (set by Cloudflare, cannot be forged), else the first element of
--    'x-forwarded-for'. No IP → nothing is blocked (SQL editor, service calls, tests).
--  * The IP is NEVER stored: only sha256(ip || salt) in hexadecimal; the salt is drawn at random
--    by this migration and kept in public.reglages ('ip_sel'), which nobody can read.
--  * Table public.limites_ip (empreinte, action, cree_le): RLS forced, no grant at all. Rows older
--    than 24 h are purged at each insertion.
--  * Ceilings per IP and per hour, adjustable in public.reglages ('limites_ip'):
--      profil 5 · publication 30 · message 60 (comments + club) · reaction 300 (reactions, votes, follows)
--  * Wired into creer_profil, soumettre_probleme, publier_riche, commenter, envoyer_message_club and
--    reagir WITHOUT copying their bodies: each function is renamed wp_coeur_<name> (internal, no
--    grant) and replaced by a wrapper with the same signature, defaults and grants, which checks the
--    IP ceiling then calls the core. A refused or failed call is rolled back, so only successful
--    actions are counted.
--  Message: « Doucement ! Trop d'actions depuis ta connexion, reviens dans une heure. » (code limite).
-- 001 to 013 are NOT modified. Run after 013. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table and settings
-- ---------------------------------------------------------------------
create table if not exists public.limites_ip (
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  action    text not null check (action in ('profil', 'publication', 'message', 'reaction')),
  cree_le   timestamptz not null default now()
);
create index if not exists limites_ip_compte_idx on public.limites_ip (empreinte, action, cree_le);
create index if not exists limites_ip_date_idx on public.limites_ip (cree_le);

do $$
declare
  v_bypass boolean;
begin
  select r.rolbypassrls into v_bypass from pg_catalog.pg_roles r where r.rolname = current_user;
  alter table public.limites_ip enable row level security;
  if coalesce(v_bypass, false) then
    alter table public.limites_ip force row level security;
  else
    raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.limites_ip', current_user;
  end if;
end
$$;
revoke all on public.limites_ip from public, anon, authenticated;

-- Random salt, drawn once (never overwritten by a re-run).
insert into public.reglages (cle, valeur)
values ('ip_sel', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
on conflict (cle) do nothing;
insert into public.reglages (cle, valeur)
values ('limites_ip', '{"profil": 5, "publication": 30, "message": 60, "reaction": 300}'::jsonb)
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- 2. Helpers (internal)
-- ---------------------------------------------------------------------

-- The caller's IP from the request headers, or null.
create or replace function public.wp_ip_visiteur()
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_h  jsonb;
  v_ip text;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if v_h is null or jsonb_typeof(v_h) <> 'object' then
    return null;
  end if;
  v_ip := btrim(coalesce(v_h ->> 'cf-connecting-ip', ''));
  if v_ip = '' then
    v_ip := btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1));
  end if;
  if v_ip = '' or char_length(v_ip) > 64 then
    return null;
  end if;
  return lower(v_ip);
end;
$fn$;

-- sha256(ip || salt) in hexadecimal, or null when the IP is unknown.
create or replace function public.wp_empreinte_ip()
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_ip  text := public.wp_ip_visiteur();
  v_sel text;
begin
  if v_ip is null then
    return null;
  end if;
  select r.valeur #>> '{}' into v_sel from public.reglages r where r.cle = 'ip_sel';
  return encode(sha256(convert_to(v_ip || coalesce(v_sel, ''), 'UTF8')), 'hex');
end;
$fn$;

-- Counts one action for the caller's IP, or refuses it when the hourly ceiling is reached.
-- Unknown IP → does nothing.
create or replace function public.wp_limite_ip(p_action text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_emp text := public.wp_empreinte_ip();
  v_max integer;
begin
  if v_emp is null then
    return;
  end if;
  select (r.valeur ->> p_action)::integer into v_max from public.reglages r where r.cle = 'limites_ip';
  v_max := coalesce(v_max, case p_action when 'profil' then 5 when 'publication' then 30
                                         when 'message' then 60 else 300 end);
  -- one counter per (IP, action) at a time
  perform pg_advisory_xact_lock(hashtextextended('wp_limite_ip:' || v_emp || ':' || p_action, 0));
  delete from public.limites_ip l where l.cree_le < now() - interval '24 hours';
  if (select count(*) from public.limites_ip l
      where l.empreinte = v_emp and l.action = p_action and l.cree_le > now() - interval '1 hour') >= v_max then
    perform public.wp_erreur('limite', 'Doucement ! Trop d''actions depuis ta connexion, reviens dans une heure.');
  end if;
  insert into public.limites_ip (empreinte, action) values (v_emp, p_action);
end;
$fn$;

revoke all on function public.wp_ip_visiteur()     from public, anon, authenticated;
revoke all on function public.wp_empreinte_ip()    from public, anon, authenticated;
revoke all on function public.wp_limite_ip(text)   from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. The 6 write functions: core renamed, wrapper with the same signature
-- ---------------------------------------------------------------------
do $$
declare
  v_f record;
begin
  for v_f in
    select * from (values
      ('creer_profil',         'text, text, text, boolean, text'),
      ('soumettre_probleme',   'text, text, text, integer'),
      ('publier_riche',        'text, text, text, integer'),
      ('commenter',            'uuid, text'),
      ('envoyer_message_club', 'text'),
      ('reagir',               'uuid, text')
    ) as t(nom, args)
  loop
    if to_regprocedure(format('public.wp_coeur_%s(%s)', v_f.nom, v_f.args)) is null then
      execute format('alter function public.%I(%s) rename to %I', v_f.nom, v_f.args, 'wp_coeur_' || v_f.nom);
    end if;
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated',
                   'wp_coeur_' || v_f.nom, v_f.args);
  end loop;
end
$$;

create or replace function public.creer_profil(
  p_camp       text,
  p_pseudo     text,
  p_email      text,
  p_newsletter boolean default false,
  p_code_ref   text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_limite_ip('profil');
  return public.wp_coeur_creer_profil(p_camp, p_pseudo, p_email, p_newsletter, p_code_ref);
end;
$fn$;
revoke all on function public.creer_profil(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.creer_profil(text, text, text, boolean, text) to authenticated;

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
begin
  perform public.wp_limite_ip('publication');
  return public.wp_coeur_soumettre_probleme(p_categorie, p_titre, p_texte, p_montant);
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
begin
  perform public.wp_limite_ip('publication');
  return public.wp_coeur_publier_riche(p_type, p_texte, p_titre, p_montant);
end;
$fn$;
revoke all on function public.publier_riche(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.publier_riche(text, text, text, integer) to authenticated;

create or replace function public.commenter(p_problem_id uuid, p_texte text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_limite_ip('message');
  return public.wp_coeur_commenter(p_problem_id, p_texte);
end;
$fn$;
revoke all on function public.commenter(uuid, text) from public, anon, authenticated;
grant execute on function public.commenter(uuid, text) to authenticated;

create or replace function public.envoyer_message_club(p_texte text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_limite_ip('message');
  return public.wp_coeur_envoyer_message_club(p_texte);
end;
$fn$;
revoke all on function public.envoyer_message_club(text) from public, anon, authenticated;
grant execute on function public.envoyer_message_club(text) to authenticated;

create or replace function public.reagir(p_problem_id uuid, p_type text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_limite_ip('reaction');
  return public.wp_coeur_reagir(p_problem_id, p_type);
end;
$fn$;
revoke all on function public.reagir(uuid, text) from public, anon, authenticated;
grant execute on function public.reagir(uuid, text) to authenticated;
