-- =====================================================================
-- Qui paie ? / Who pays? — 005: immediate publication (R-017)
-- A problem that passes the content filters is published AT ONCE (the author can share it within
-- the second), unless:
--   * it contains a sensitive expression (distress, violence, serious illness, precariousness):
--     it then waits for a human review ('recu'), as before;
--   * automatic publication is switched off (public.reglages 'publication_auto' = false):
--     every problem waits for a human review (pre-moderation, as before).
-- 001 to 004 are applied in production and are NOT modified: this migration adds two tables and
-- replaces public.soumettre_probleme (same signature, same grants).
-- Run after 004_moderation.sql. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Site settings, edited by the moderator only (SQL editor).
create table if not exists public.reglages (
  cle    text primary key check (char_length(btrim(cle)) > 0),
  valeur jsonb not null
);

-- Sensitive expressions, stored normalized (lowercase, no accents), whole-word match.
-- Same list as MOTS_SENSIBLES_DEFAUT in site/assets/js/mots-sensibles.js (demo mode).
create table if not exists public.mots_sensibles (
  mot text primary key check (char_length(btrim(mot)) > 0)
);

-- RLS with no policy, FORCE when the migrating role can bypass RLS (same rule as 002, DC-006).
do $$
declare
  v_table  text;
  v_bypass boolean;
begin
  select r.rolsuper or r.rolbypassrls into v_bypass
  from pg_catalog.pg_roles r
  where r.rolname = current_user;

  foreach v_table in array array['reglages', 'mots_sensibles'] loop
    execute format('alter table public.%I enable row level security', v_table);
    if coalesce(v_bypass, false) then
      execute format('alter table public.%I force row level security', v_table);
    else
      raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.%', current_user, v_table;
    end if;
  end loop;
end
$$;

revoke all on public.reglages       from public, anon, authenticated;
revoke all on public.mots_sensibles from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Data
-- ---------------------------------------------------------------------

insert into public.reglages (cle, valeur) values ('publication_auto', 'true'::jsonb)
on conflict (cle) do nothing;

insert into public.mots_sensibles (mot) values
  ('suicide'), ('suicider'), ('me suicider'), ('suicidaire'), ('en finir'), ('me tuer'), ('me foutre en l air'),
  ('mourir'), ('envie de mourir'), ('plus envie de vivre'), ('me faire du mal'), ('me mutiler'), ('automutilation'),
  ('scarif'), ('scarifie'), ('scarifier'), ('scarifiee'), ('scarification'),
  ('viol'), ('viols'), ('viole'), ('violee'), ('violer'), ('abus'), ('abus sexuel'), ('attouchements'), ('inceste'), ('pedophile'),
  ('frappe'), ('me frappe'), ('me bat'), ('violence conjugale'), ('violences conjugales'),
  ('harcelement'), ('harcele'), ('harcelee'), ('cancer'), ('chimio'), ('chimiotherapie'), ('leucemie'), ('tumeur'), ('maladie grave'),
  ('enceinte'), ('avortement'), ('avorter'), ('ivg'), ('sdf'), ('a la rue'), ('sans abri'), ('expulse'), ('expulsee'), ('expulsion'),
  ('overdose'), ('drogue'), ('drogues'), ('depression'), ('depressif'), ('depressive'), ('anorexie'), ('boulimie')
on conflict (mot) do nothing;

-- ---------------------------------------------------------------------
-- 3. Internal helpers (not executable by anon / authenticated)
-- ---------------------------------------------------------------------

-- True when the text contains a sensitive expression. Same normalization and whole-word rule
-- as the banned words in wp_raison_filtre() (002): "viol" matches "violé" but not "violon".
create or replace function public.wp_contient_mot_sensible(p_texte text)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_propre text := ' ' || btrim(regexp_replace(public.wp_normaliser(p_texte), '[^a-z0-9]+', ' ', 'g')) || ' ';
begin
  if btrim(v_propre) = '' then
    return false;
  end if;
  return exists (
    select 1
    from public.mots_sensibles ms
    cross join lateral (
      select btrim(regexp_replace(public.wp_normaliser(ms.mot), '[^a-z0-9]+', ' ', 'g')) as mot
    ) n
    where n.mot <> ''
      and strpos(v_propre, ' ' || n.mot || ' ') > 0
  );
end;
$fn$;

-- True when automatic publication is on. Missing or invalid setting = off (pre-moderation).
create or replace function public.wp_publication_auto()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce((select r.valeur = 'true'::jsonb from public.reglages r where r.cle = 'publication_auto'), false);
$fn$;

revoke all on function public.wp_contient_mot_sensible(text) from public, anon, authenticated;
revoke all on function public.wp_publication_auto()          from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Submitting a problem (replaces the 003 version, same signature and grants)
-- ---------------------------------------------------------------------

-- Validation, filters and rate limit (3 per 24 h) unchanged. Status:
--   'publie' when automatic publication is on and no sensitive expression is found in title + text;
--   'recu' otherwise (human review). Returns { id, statut }.
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
  v_p       public.profiles;
  v_titre   text;
  v_texte   text;
  v_montant integer;
  v_statut  text;
  v_id      uuid;
begin
  v_p := public.wp_exiger_membre(true);
  if p_categorie is null or not (p_categorie = any (public.wp_categories())) then
    perform public.wp_erreur('invalide', 'Choisis une catégorie.');
  end if;
  v_titre := public.wp_texte_valide(p_titre, 3, 80, 'Le titre', false);
  v_texte := public.wp_texte_valide(p_texte, 10, 600, 'Le texte', true);
  v_montant := public.wp_entier_valide(p_montant, 0, 1000000, 'Le montant');
  if (select count(*) from public.problems p
      where p.user_id = v_p.id and p.cree_le > now() - interval '24 hours') >= 3 then
    perform public.wp_erreur('limite', 'Tu as déjà envoyé 3 problèmes en 24 h. Reviens demain !');
  end if;
  if public.wp_publication_auto() and not public.wp_contient_mot_sensible(v_titre || E'\n' || v_texte) then
    v_statut := 'publie';
  else
    v_statut := 'recu';
  end if;
  insert into public.problems (user_id, categorie, titre, texte, montant, statut, est_exemple, masque)
  values (v_p.id, p_categorie, v_titre, v_texte, v_montant, v_statut, false, false)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'statut', v_statut);
end;
$fn$;
revoke all on function public.soumettre_probleme(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.soumettre_probleme(text, text, text, integer) to authenticated;
