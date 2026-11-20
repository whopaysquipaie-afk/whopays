-- =====================================================================
-- Qui paie ? / Who pays? — 002: security
--  * RLS on every table, NO policy: anon and authenticated cannot touch any table directly.
--  * Every privilege revoked from anon / authenticated / public (now and for future objects).
--  * Content filters shared by every write function (same rules as site/assets/js/filtres.js).
-- Run after 001_schema.sql. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Row Level Security, no policies
-- ---------------------------------------------------------------------
-- FORCE also applies RLS to the table owner. The RPC functions (003) are SECURITY DEFINER and
-- run as the owner, so FORCE is only applied when the owner can bypass RLS (superuser or
-- BYPASSRLS, which is the case of the "postgres" role on Supabase). Otherwise every function
-- would see empty tables; in that case RLS stays enabled (not forced) and a notice is printed.
do $$
declare
  v_table  text;
  v_bypass boolean;
begin
  select r.rolsuper or r.rolbypassrls into v_bypass
  from pg_catalog.pg_roles r
  where r.rolname = current_user;

  foreach v_table in array array[
    'profiles', 'problems', 'reactions', 'comments', 'club_messages',
    'reports', 'verifications', 'mots_interdits'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    if coalesce(v_bypass, false) then
      execute format('alter table public.%I force row level security', v_table);
    else
      raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.%', current_user, v_table;
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 2. No direct privileges for anon / authenticated / public
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Future objects created by the current role (postgres) in schema public
alter default privileges in schema public revoke all on tables    from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
-- PostgreSQL grants EXECUTE to PUBLIC on every new function by default (global setting,
-- it cannot be revoked per schema). Execution is granted function by function in 003.
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- 3. Content filters (internal helpers, never executable by anon / authenticated)
-- ---------------------------------------------------------------------

-- Lowercase + strip accents + œ/æ ligatures. Same as normaliser() in filtres.js.
-- Does not depend on the unaccent extension: translate() with every Latin letter whose
-- canonical decomposition is "ASCII letter + combining marks" (Latin-1, Extended-A/B,
-- Extended Additional), then removal of any remaining combining mark (U+0300 to U+036F).
-- Upper-case letters are mapped too, in case lower() is ASCII-only under the database locale.
create or replace function public.wp_normaliser(p_texte text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $fn$
declare
  v_de constant text :=
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ';
  v_vers constant text :=
    'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwyaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyy';
  v text;
begin
  v := lower(coalesce(p_texte, ''));
  v := replace(replace(replace(replace(v, 'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae');
  v := translate(v, v_de, v_vers);
  v := regexp_replace(v, $re$[̀-ͯ]$re$, '', 'g');
  return v;
end;
$fn$;

-- Same as nettoyer() in filtres.js: CRLF -> LF, strip control and bidi characters,
-- collapse spaces (keep line breaks, at most one blank line, when p_multiligne), trim.
-- The whitespace class is exactly JavaScript's \s.
create or replace function public.wp_nettoyer(p_texte text, p_multiligne boolean default false)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $fn$
declare
  c_ws   constant text := $re$[\t\n\u000b\f\r    -     　﻿]$re$;
  c_trim constant text := '^' || c_ws || '+|' || c_ws || '+$';
  v text := coalesce(p_texte, '');
begin
  v := regexp_replace(v, $re$\r\n?$re$, E'\n', 'g');
  v := regexp_replace(v, $re$[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]$re$, '', 'g');
  if coalesce(p_multiligne, false) then
    select string_agg(regexp_replace(regexp_replace(s.ligne, $re$[ \t]+$re$, ' ', 'g'), c_trim, '', 'g'), E'\n' order by s.n)
      into v
      from regexp_split_to_table(v, E'\n') with ordinality as s(ligne, n);
    v := regexp_replace(coalesce(v, ''), E'\n{3,}', E'\n\n', 'g');
  else
    v := regexp_replace(v, c_ws || '+', ' ', 'g');
  end if;
  return regexp_replace(v, c_trim, '', 'g');
end;
$fn$;

-- The 10 category ids, in the display order of categories.js
create or replace function public.wp_categories()
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select array['reve', 'factures', 'coup-de-pouce', 'amour', 'famille',
               'patron', 'projet', 'quotidien', 'plaisir', 'defi']::text[];
$fn$;

-- Returns null when the text is clean, otherwise the reason:
-- 'email' | 'lien' | 'iban' | 'telephone' | 'mot_interdit' (same order and patterns as raisonFiltre()).
-- Patterns are translated from JavaScript to PostgreSQL ARE: \b -> \y (word boundary),
-- \s -> [[:space:]] inside brackets. They are applied on the normalized text.
create or replace function public.wp_raison_filtre(p_texte text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_norm   text := public.wp_normaliser(p_texte);
  v_propre text;
  v_iban   text;
begin
  if v_norm ~ $re$^[\t\n\u000b\f\r    -     　﻿]*$$re$ then
    return null;
  end if;

  -- E-mail addresses (also "name (at) domain.com" and "name [at] domain.com")
  if v_norm ~ $re$[a-z0-9._%+-]+\s?(?:@|\(at\)|\[at\])\s?[a-z0-9.-]+\.[a-z]{2,}$re$ then
    return 'email';
  end if;

  -- Links: http(s)://, www., bare domain names with a common TLD
  if v_norm ~ $re$(?:https?://|\ywww\.|\y[a-z0-9-]+\.(?:com|fr|net|org|io|be|ch|ca|co|me|ly|gg|tv|app|dev|xyz|info|biz|eu|uk|de|es|it|link|site|online|shop|store|live|club|top|page|to|sh|cc)\y)$re$ then
    return 'lien';
  end if;

  -- IBAN: 2 letters, 2 check digits, 11 to 30 alphanumerics (spaces allowed), at least 10 digits
  for v_iban in
    select m.arr[1]
    from regexp_matches(v_norm, $re$\y[a-z]{2}\d{2}(?:\s?[a-z0-9]){11,30}\y$re$, 'g') as m(arr)
  loop
    if char_length(regexp_replace(v_iban, $re$\D$re$, '', 'g')) >= 10 then
      return 'iban';
    end if;
  end loop;

  -- Phone numbers: French, international, or 10+ digits in a row (dots and dashes between digits ignored)
  if v_norm ~ $re$(?:(?:\+|00)\s?33\s?\(?0?\)?\s?|\y0)[1-9](?:[[:space:].-]?\d{2}){4}\y$re$
     or v_norm ~ $re$(?:\+|\y00)\s?[1-9]\d{0,2}(?:[[:space:].-]?\d{2,4}){3,5}\y$re$
     or regexp_replace(v_norm, $re$(\d)[.-](?=\d)$re$, $re$\1$re$, 'g') ~ $re$\d{10,}$re$ then
    return 'telephone';
  end if;

  -- Banned words, matched on whole words: "pd" matches "pd" but not "rapide"
  v_propre := ' ' || btrim(regexp_replace(v_norm, '[^a-z0-9]+', ' ', 'g')) || ' ';
  if exists (
    select 1
    from public.mots_interdits mi
    cross join lateral (
      select btrim(regexp_replace(public.wp_normaliser(mi.mot), '[^a-z0-9]+', ' ', 'g')) as mot
    ) n
    where n.mot <> ''
      and strpos(v_propre, ' ' || n.mot || ' ') > 0
  ) then
    return 'mot_interdit';
  end if;

  return null;
end;
$fn$;

-- Cleans a text field, checks its length and the content filters, returns the cleaned value.
-- Same as texteValide() in api-demo.js; errors carry the French message and the hint code
-- read by the site ('invalide' or 'filtre').
create or replace function public.wp_texte_valide(
  p_valeur     text,
  p_min        integer,
  p_max        integer,
  p_libelle    text,
  p_multiligne boolean default false
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v text := public.wp_nettoyer(p_valeur, p_multiligne);
  n integer := char_length(v);
begin
  if n < p_min then
    raise exception using
      errcode = 'P0001',
      message = case when p_min <= 1 then format('%s est vide.', p_libelle)
                     else format('%s doit faire au moins %s caractères.', p_libelle, p_min) end,
      hint = 'invalide';
  end if;
  if n > p_max then
    raise exception using
      errcode = 'P0001',
      message = format('%s ne doit pas dépasser %s caractères.', p_libelle, p_max),
      hint = 'invalide';
  end if;
  if public.wp_raison_filtre(v) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Ton message contient un numéro, un lien ou un mot interdit. Relis les règles du jeu.',
      hint = 'filtre';
  end if;
  return v;
end;
$fn$;

-- Optional integer within [p_min, p_max]; null stays null. Same as entierValide() in api-demo.js,
-- the maximum is written the French way (narrow no-break space as thousands separator).
create or replace function public.wp_entier_valide(
  p_valeur  integer,
  p_min     integer,
  p_max     integer,
  p_libelle text
)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $fn$
begin
  if p_valeur is null then
    return null;
  end if;
  if p_valeur < p_min or p_valeur > p_max then
    raise exception using
      errcode = 'P0001',
      message = format('%s doit être un nombre entier entre %s et %s.',
                       p_libelle, p_min,
                       regexp_replace(p_max::text, $re$(\d)(?=(\d{3})+$)$re$, $re$\1$re$ || chr(8239), 'g')),
      hint = 'invalide';
  end if;
  return p_valeur;
end;
$fn$;

-- Helpers are internal: only the function owner (and SECURITY DEFINER functions) may run them.
revoke all on function public.wp_normaliser(text)                                  from public, anon, authenticated;
revoke all on function public.wp_nettoyer(text, boolean)                           from public, anon, authenticated;
revoke all on function public.wp_categories()                                      from public, anon, authenticated;
revoke all on function public.wp_raison_filtre(text)                               from public, anon, authenticated;
revoke all on function public.wp_texte_valide(text, integer, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.wp_entier_valide(integer, integer, integer, text)    from public, anon, authenticated;
