-- =====================================================================
-- Qui paie ? / Who pays? — 020: the game « Lequel est le plus drôle ? » (R-041)
--  * get_duel(p_sauf): two problems of the poor drawn at random (published, visible, not examples,
--    author not blocked), never one of p_sauf (the ones just seen). Public (visitors can play).
--  * voter_duel(p_gagnant, p_perdant): records a vote. Public too: visitors play without an account,
--    within the IP ceiling of 014 (quota "reaction"). Both problems must be distinct problems of the
--    poor, published and visible. The voter is kept as an anonymous fingerprint only (salted sha256 of
--    the IP, else of the member id): never an IP, never an id in clear.
--  * get_plus_droles_semaine(p_limite): the problems with the most duel wins over 7 days.
--  * « Le problème du moment » (replaces 015): + 2 points per duel win of the last 7 days.
-- 001 to 019 are NOT modified. Run after 019 (needs 014 and 015). Idempotent.
-- Same rules as api-demo.js (getDuel, voterDuel, getPlusDrolesSemaine).
-- =====================================================================

create table if not exists public.duels (
  id               uuid primary key default gen_random_uuid(),
  gagnant_id       uuid not null references public.problems (id) on delete cascade,
  perdant_id       uuid not null references public.problems (id) on delete cascade,
  votant_empreinte text check (votant_empreinte is null or votant_empreinte ~ '^[0-9a-f]{64}$'),
  cree_le          timestamptz not null default now(),
  constraint duels_deux_problemes check (gagnant_id <> perdant_id)
);
create index if not exists duels_gagnant_date_idx on public.duels (gagnant_id, cree_le);
create index if not exists duels_date_idx on public.duels (cree_le);

do $$
declare
  v_bypass boolean;
begin
  select r.rolbypassrls into v_bypass from pg_catalog.pg_roles r where r.rolname = current_user;
  alter table public.duels enable row level security;
  if coalesce(v_bypass, false) then
    alter table public.duels force row level security;
  else
    raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.duels', current_user;
  end if;
end
$$;
revoke all on public.duels from public, anon, authenticated;

-- A problem that can enter a duel.
create or replace function public.wp_duelliste(p_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select exists (
    select 1 from public.problems p
    join public.profiles pr on pr.id = p.user_id and not pr.bloque
    where p.id = p_id and p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple);
$fn$;
revoke all on function public.wp_duelliste(uuid) from public, anon, authenticated;

-- [problem A, problem B] (public projection), or [] when fewer than 2 problems can fight.
create or replace function public.get_duel(p_sauf uuid[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_sauf uuid[] := coalesce((p_sauf)[1:20], '{}');
  v_res  jsonb;
begin
  select coalesce(jsonb_agg(public.wp_probleme_json(x.pb)), '[]'::jsonb) into v_res
  from (
    select p as pb from public.problems p
    join public.profiles pr on pr.id = p.user_id and not pr.bloque
    where p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple
      and not (p.id = any (v_sauf))
    order by random()
    limit 2
  ) x;
  if jsonb_array_length(v_res) < 2 and cardinality(v_sauf) > 0 then
    return public.get_duel(null);   -- not enough fresh problems: forget the ones just seen
  end if;
  return case when jsonb_array_length(v_res) = 2 then v_res else '[]'::jsonb end;
end;
$fn$;
revoke all on function public.get_duel(uuid[]) from public, anon, authenticated;
grant execute on function public.get_duel(uuid[]) to anon, authenticated;

-- { ok, victoires_7j } (wins of the winner over 7 days).
create or replace function public.voter_duel(p_gagnant uuid, p_perdant uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_emp text;
begin
  perform public.wp_limite_ip('reaction');
  if p_gagnant is null or p_perdant is null or p_gagnant = p_perdant
     or not public.wp_duelliste(p_gagnant) or not public.wp_duelliste(p_perdant) then
    perform public.wp_erreur('invalide', 'Ce duel n’existe plus. On t’en sert un autre.');
  end if;
  if v_uid is not null and exists (select 1 from public.profiles pr where pr.id = v_uid and pr.bloque) then
    perform public.wp_erreur('bloque', 'Ton compte est bloqué : tu ne peux plus publier, réagir ni écrire.');
  end if;
  v_emp := coalesce(public.wp_empreinte_ip(),
                    case when v_uid is null then null
                         else encode(sha256(convert_to('membre:' || v_uid::text || coalesce(
                           (select r.valeur #>> '{}' from public.reglages r where r.cle = 'ip_sel'), ''), 'UTF8')), 'hex') end);
  insert into public.duels (gagnant_id, perdant_id, votant_empreinte) values (p_gagnant, p_perdant, v_emp);
  return jsonb_build_object('ok', true, 'victoires_7j',
    (select count(*) from public.duels d where d.gagnant_id = p_gagnant and d.cree_le > now() - interval '7 days'));
end;
$fn$;
revoke all on function public.voter_duel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.voter_duel(uuid, uuid) to anon, authenticated;

-- [{ carte, victoires }] most wins over 7 days (p_limite 1 to 20).
create or replace function public.get_plus_droles_semaine(p_limite integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limite integer := greatest(1, least(20, coalesce(p_limite, 5)));
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('carte', public.wp_probleme_json(x.pb), 'victoires', x.nb) order by x.nb desc, (x.pb).id)
    from (
      select p as pb, count(*) as nb
      from public.duels d
      join public.problems p on p.id = d.gagnant_id and p.type = 'pauvre' and p.statut = 'publie' and not p.masque
      join public.profiles pr on pr.id = p.user_id and not pr.bloque
      where d.cree_le > now() - interval '7 days'
      group by p.id
      order by count(*) desc, p.id
      limit v_limite
    ) x
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_plus_droles_semaine(integer) from public, anon, authenticated;
grant execute on function public.get_plus_droles_semaine(integer) to anon, authenticated;

-- « Le problème du moment » (replaces 015): reactions + 10 per crown + 2 per duel win (7 days).
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
  left join lateral (
    select count(*) as nb
    from public.duels d
    where d.gagnant_id = p.id and d.cree_le > now() - interval '7 days'
  ) dx on true
  where p.type = 'pauvre'
    and p.statut = 'publie'
    and not p.masque
    and not p.est_exemple
  order by rx.nb + 10 * cx.nb + 2 * dx.nb desc, coalesce(p.modere_le, p.cree_le) desc, p.id desc
  limit 1;

  if not found then
    return null;
  end if;
  return public.wp_probleme_json(v_pb);
end;
$fn$;
revoke all on function public.get_probleme_du_moment() from public, anon, authenticated;
grant execute on function public.get_probleme_du_moment() to anon, authenticated;
