-- =====================================================================
-- Qui paie ? / Who pays? — 016: seasons of the leaderboard (R-038)
--  * Monthly leaderboard (Paris calendar, reset on the 1st) next to the all-time one: same rules as
--    009/011 (problems of the poor, published, visible, not examples; author poor and not blocked),
--    restricted to the problems whose displayed date (coalesce(modere_le, cree_le)) is in the
--    current month in Paris.
--  * get_palmares(p_limite, p_periode) and get_mon_rang(p_periode): NEW signatures, p_periode =
--    'mois' | 'toujours', no default (so that PostgREST never hesitates between two versions).
--    The old get_palmares(p_limite) and get_mon_rang() stay and still return the all-time ranking.
--  * Same projection as 009: pseudo, camp, nb, total, rang (+ classes, periode, depuis); never an
--    id, never an e-mail. Public (anon + authenticated), read only.
-- 001 to 015 are NOT modified. Run after 015 (or any time after 011). Idempotent.
-- Same rules as getPalmares({ periode }) / getMonRang(periode) in site/assets/js/api-demo.js.
-- =====================================================================

-- Start of the current month in Paris, as a timestamptz.
create or replace function public.wp_debut_mois_paris()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $fn$
  select (date_trunc('month', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
$fn$;
revoke all on function public.wp_debut_mois_paris() from public, anon, authenticated;

-- Internal: the ranking of the poor over the problems shown since p_depuis (null = all time).
create or replace function public.wp_classement_pauvres_depuis(p_depuis timestamptz)
returns table (user_id uuid, pseudo text, camp text, nb bigint, total bigint, rang bigint)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select t.id, t.pseudo, t.camp, t.nb, t.total,
         row_number() over (order by t.total desc, t.nb desc, t.cree_le, t.id) as rang
  from (
    select pr.id, pr.pseudo, pr.camp, pr.cree_le,
           count(p.id) as nb, coalesce(sum(p.montant), 0)::bigint as total
    from public.profiles pr
    join public.problems p
      on p.user_id = pr.id and p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple
     and (p_depuis is null or coalesce(p.modere_le, p.cree_le) >= p_depuis)
    where pr.camp = 'pauvre' and not pr.bloque
    group by pr.id
  ) t;
$fn$;
revoke all on function public.wp_classement_pauvres_depuis(timestamptz) from public, anon, authenticated;

-- 'mois' → start of the month in Paris; 'toujours' → null; anything else → error.
create or replace function public.wp_depuis_periode(p_periode text)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
begin
  if p_periode = 'mois' then
    return public.wp_debut_mois_paris();
  elsif p_periode = 'toujours' then
    return null;
  end if;
  perform public.wp_erreur('invalide', 'Période inconnue : « mois » ou « toujours ».');
end;
$fn$;
revoke all on function public.wp_depuis_periode(text) from public, anon, authenticated;

-- { classes, periode, depuis, lignes: [{ rang, pseudo, camp, nb, total }] }, p_limite from 1 to 100.
create or replace function public.get_palmares(p_limite integer, p_periode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limite integer := greatest(1, least(100, coalesce(p_limite, 100)));
  v_depuis timestamptz := public.wp_depuis_periode(p_periode);
begin
  return jsonb_build_object(
    'periode', p_periode,
    'depuis', v_depuis,
    'classes', (select count(*) from public.wp_classement_pauvres_depuis(v_depuis)),
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rang', c.rang, 'pseudo', c.pseudo, 'camp', c.camp, 'nb', c.nb, 'total', c.total
             ) order by c.rang)
      from public.wp_classement_pauvres_depuis(v_depuis) c
      where c.rang <= v_limite
    ), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.get_palmares(integer, text) from public, anon, authenticated;
grant execute on function public.get_palmares(integer, text) to anon, authenticated;

-- The caller's line for the period: { periode, rang (null when not ranked), sur, pseudo, camp, nb, total };
-- null for a visitor, a member without profile or a member of the rich camp.
create or replace function public.get_mon_rang(p_periode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_depuis timestamptz := public.wp_depuis_periode(p_periode);
  v_p      public.profiles;
  v_c      record;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_p from public.profiles pr where pr.id = v_uid;
  if not found or v_p.camp <> 'pauvre' then
    return null;
  end if;
  select c.* into v_c from public.wp_classement_pauvres_depuis(v_depuis) c where c.user_id = v_uid;
  return jsonb_build_object(
    'periode', p_periode,
    'rang',    v_c.rang,
    'sur',     (select count(*) from public.wp_classement_pauvres_depuis(v_depuis)),
    'pseudo',  v_p.pseudo,
    'camp',    v_p.camp,
    'nb',      coalesce(v_c.nb, 0),
    'total',   coalesce(v_c.total, 0)
  );
end;
$fn$;
revoke all on function public.get_mon_rang(text) from public, anon, authenticated;
grant execute on function public.get_mon_rang(text) to anon, authenticated;
