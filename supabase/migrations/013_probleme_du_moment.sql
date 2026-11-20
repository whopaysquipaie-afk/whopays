-- =====================================================================
-- Qui paie ? / Who pays? — 013: « Le problème du moment » (R-034)
--  * get_probleme_du_moment(): the card of the home hero, loaded from the database.
--    Candidates: problems of the poor (type 'pauvre'), published, not masked, not examples,
--    whose author still exists and is not blocked.
--    Choice: the candidate that received the most reactions during the last 7 days
--    (reactions.cree_le); ties → the most recent problem. No reaction in 7 days → the most
--    recent candidate. Nothing at all → null (the page keeps its static card).
--  * Returns the public projection wp_probleme_json (011): no user id, no e-mail.
-- Public (anon + authenticated), read only. 001 to 012 are NOT modified. Run after 012. Idempotent.
-- Same rule as api-demo.js (getProblemeDuMoment).
-- =====================================================================

create index if not exists reactions_cree_le_idx on public.reactions (cree_le desc);

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
  where p.type = 'pauvre'
    and p.statut = 'publie'
    and not p.masque
    and not p.est_exemple
  order by rx.nb desc, coalesce(p.modere_le, p.cree_le) desc, p.id desc
  limit 1;

  if not found then
    return null;
  end if;
  return public.wp_probleme_json(v_pb);
end;
$fn$;
revoke all on function public.get_probleme_du_moment() from public, anon, authenticated;
grant execute on function public.get_probleme_du_moment() to anon, authenticated;
