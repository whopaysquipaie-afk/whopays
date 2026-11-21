-- =====================================================================
-- Qui paie ? / Who pays? — 017: titles and badges (R-039)
--  * Computed on the fly, nothing stored. wp_badges(user) → jsonb array of badge ids, in this order:
--      or / argent / bronze   🥇🥈🥉 top 3 of the leaderboard of the month (016)
--      roi_decouvert          💸 the poor member with the most problems « factures »
--      smicard                🏅 20 problems published
--      plafond                🔟 a problem at 10x Rien (10 000 €)
--      couronne               👑 received a crown (015)
--      star_rire              😂 a post with 20 « Mort de rire »
--      yacht                  🛥️ a post seen from a yacht (reaction of a rich member, 015)
--      mecene                 🎩 rich member who gave 10 crowns
--      rabatteur              🤝 3 people invited
--      pipelette              💬 30 visible comments
--      premier                🌱 first problem published
--    Only published, visible, non-example posts count. A blocked member has no badge.
--  * get_badges(p_code): public, by share code (never by id) → { pseudo, badges } or null.
--  * get_palmares(p_limite, p_periode) (replaces 016): each line also carries badges and code
--    (the share code, used by the public profile of R-040). Never an id, never an e-mail.
-- 001 to 016 are NOT modified. Run after 016. Idempotent.
-- Same rules as api-demo.js (badgesDe, getBadges) and the labels of site/assets/js/badges.js.
-- =====================================================================

create or replace function public.wp_badges(p_user_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_p    public.profiles;
  v_b    text[] := '{}';
  v_rang bigint;
  v_nb   bigint;
begin
  select * into v_p from public.profiles pr where pr.id = p_user_id;
  if not found or v_p.bloque then
    return '[]'::jsonb;
  end if;
  v_nb := (select count(*) from public.problems p
           where p.user_id = p_user_id and p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple);
  if v_p.camp = 'pauvre' then
    select c.rang into v_rang
    from public.wp_classement_pauvres_depuis(public.wp_debut_mois_paris()) c where c.user_id = p_user_id;
    if v_rang = 1 then v_b := v_b || 'or'::text;
    elsif v_rang = 2 then v_b := v_b || 'argent'::text;
    elsif v_rang = 3 then v_b := v_b || 'bronze'::text;
    end if;
    if p_user_id = (
      select p.user_id from public.problems p
      join public.profiles pr on pr.id = p.user_id and pr.camp = 'pauvre' and not pr.bloque
      where p.type = 'pauvre' and p.categorie = 'factures' and p.statut = 'publie' and not p.masque and not p.est_exemple
      group by p.user_id, pr.cree_le
      order by count(*) desc, pr.cree_le, p.user_id
      limit 1
    ) then
      v_b := v_b || 'roi_decouvert'::text;
    end if;
    if v_nb >= 20 then v_b := v_b || 'smicard'::text; end if;
    if exists (select 1 from public.problems p
               where p.user_id = p_user_id and p.type = 'pauvre' and p.montant >= 10000
                 and p.statut = 'publie' and not p.masque) then
      v_b := v_b || 'plafond'::text;
    end if;
    if exists (select 1 from public.couronnes c
               join public.problems p on p.id = c.problem_id and p.statut = 'publie' and not p.masque
               where p.user_id = p_user_id and not c.retiree) then
      v_b := v_b || 'couronne'::text;
    end if;
  end if;
  if exists (select 1 from public.problems p
             where p.user_id = p_user_id and p.statut = 'publie' and not p.masque
               and (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'rire') >= 20) then
    v_b := v_b || 'star_rire'::text;
  end if;
  if exists (select 1 from public.reactions r
             join public.problems p on p.id = r.problem_id and p.statut = 'publie' and not p.masque
             where p.user_id = p_user_id and r.type = 'yacht') then
    v_b := v_b || 'yacht'::text;
  end if;
  if v_p.camp = 'riche'
     and (select count(*) from public.couronnes c where c.riche_id = p_user_id and not c.retiree) >= 10 then
    v_b := v_b || 'mecene'::text;
  end if;
  if (select count(*) from public.profiles x where x.invite_par = p_user_id) >= 3 then
    v_b := v_b || 'rabatteur'::text;
  end if;
  if (select count(*) from public.comments c where c.user_id = p_user_id and not c.masque) >= 30 then
    v_b := v_b || 'pipelette'::text;
  end if;
  if v_nb >= 1 then v_b := v_b || 'premier'::text; end if;
  return to_jsonb(v_b);
end;
$fn$;
revoke all on function public.wp_badges(uuid) from public, anon, authenticated;

-- { pseudo, badges } of the member with this share code (case-insensitive), or null.
create or replace function public.get_badges(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_p public.profiles;
begin
  if p_code is null or upper(btrim(p_code)) !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    return null;
  end if;
  select * into v_p from public.profiles pr where pr.code_partage = upper(btrim(p_code)) and not pr.bloque;
  if not found then
    return null;
  end if;
  return jsonb_build_object('pseudo', v_p.pseudo, 'badges', public.wp_badges(v_p.id));
end;
$fn$;
revoke all on function public.get_badges(text) from public, anon, authenticated;
grant execute on function public.get_badges(text) to anon, authenticated;

-- Replaces 016: + badges and code on each line.
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
               'rang', c.rang, 'pseudo', c.pseudo, 'camp', c.camp, 'nb', c.nb, 'total', c.total,
               'code', pr.code_partage, 'badges', public.wp_badges(c.user_id)
             ) order by c.rang)
      from public.wp_classement_pauvres_depuis(v_depuis) c
      join public.profiles pr on pr.id = c.user_id
      where c.rang <= v_limite
    ), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.get_palmares(integer, text) from public, anon, authenticated;
grant execute on function public.get_palmares(integer, text) to anon, authenticated;
