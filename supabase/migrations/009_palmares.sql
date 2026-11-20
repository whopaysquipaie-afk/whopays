-- =====================================================================
-- Qui paie ? / Who pays? — 009: the leaderboard of the poor (R-028)
--  * get_palmares(p_limite): top of the poor, ranked by the sum of the amounts of their
--    published, non-masked problems (tie-break: number of problems, then the oldest member).
--  * get_mon_rang(): the caller's own line (null for a visitor or a member of the rich camp).
-- Only members of the poor camp, not blocked, with at least one published problem are ranked.
-- Both functions expose ONLY pseudo, camp, nb, total, rang (+ the number of ranked members):
-- never an id, never an e-mail. SECURITY DEFINER, empty search_path, EXECUTE for anon and
-- authenticated. 001 to 008 are NOT modified. Run after 008. Idempotent.
-- Same rules as getPalmares() / getMonRang() in site/assets/js/api-demo.js.
-- =====================================================================

-- Internal: the full ranking (user id included, never returned by the public functions).
create or replace function public.wp_classement_pauvres()
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
      on p.user_id = pr.id and p.statut = 'publie' and not p.masque and not p.est_exemple
    where pr.camp = 'pauvre' and not pr.bloque
    group by pr.id
  ) t;
$fn$;
revoke all on function public.wp_classement_pauvres() from public, anon, authenticated;

-- { classes: <number of ranked poor>, lignes: [{ rang, pseudo, camp, nb, total }] }, p_limite from 1 to 100.
create or replace function public.get_palmares(p_limite integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limite integer := greatest(1, least(100, coalesce(p_limite, 100)));
begin
  return jsonb_build_object(
    'classes', (select count(*) from public.wp_classement_pauvres()),
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rang', c.rang, 'pseudo', c.pseudo, 'camp', c.camp, 'nb', c.nb, 'total', c.total
             ) order by c.rang)
      from public.wp_classement_pauvres() c
      where c.rang <= v_limite
    ), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.get_palmares(integer) from public, anon, authenticated;
grant execute on function public.get_palmares(integer) to anon, authenticated;

-- The caller's line: { rang (null when not ranked yet), sur, pseudo, camp, nb, total };
-- null for a visitor, a member without profile or a member of the rich camp.
create or replace function public.get_mon_rang()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
  v_c   record;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_p from public.profiles pr where pr.id = v_uid;
  if not found or v_p.camp <> 'pauvre' then
    return null;
  end if;
  select c.* into v_c from public.wp_classement_pauvres() c where c.user_id = v_uid;
  return jsonb_build_object(
    'rang',   v_c.rang,
    'sur',    (select count(*) from public.wp_classement_pauvres()),
    'pseudo', v_p.pseudo,
    'camp',   v_p.camp,
    'nb',     coalesce(v_c.nb, 0),
    'total',  coalesce(v_c.total, 0)
  );
end;
$fn$;
revoke all on function public.get_mon_rang() from public, anon, authenticated;
grant execute on function public.get_mon_rang() to anon, authenticated;
