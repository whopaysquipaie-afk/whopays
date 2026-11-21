-- =====================================================================
-- Qui paie ? / Who pays? — 018: public profile « Mon CV de pauvre / de riche » (R-040)
--  * get_profil_public(p_code): by share code (never by id), public, read only →
--      { pseudo, camp, statut_riche, arrive_le (date), badges,
--        rang_mois { rang, sur }, rang_general { rang, sur }, total, nb   (poor members)
--        problemes: the 24 most recent visible posts (public projection),
--        couronnes_donnees: the 12 most recent problems crowned (rich members) }
--    null for an unknown code or a blocked member. Never an id, never an e-mail.
--  * Public projection wp_probleme_json (replaces 015): + code_auteur (share code of the author,
--    null for the team's examples), so that the pseudos of the cards link to the profile.
-- 001 to 017 are NOT modified. Run after 017. Idempotent.
-- Same rules as getProfilPublic() in site/assets/js/api-demo.js.
-- =====================================================================

create or replace function public.wp_probleme_json(p public.problems)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_pseudo text;
  v_camp   text;
  v_code   text;
  v_nb     bigint := public.wp_nb_couronnes(p.id);
begin
  if p.est_exemple or p.user_id is null then
    v_pseudo := 'L''équipe Qui paie ?';
    v_camp := null;
  else
    select pr.pseudo, pr.camp, case when pr.bloque then null else pr.code_partage end
      into v_pseudo, v_camp, v_code
    from public.profiles pr where pr.id = p.user_id;
    if not found then
      v_pseudo := 'Membre parti';
      v_camp := null;
    end if;
  end if;
  return jsonb_build_object(
    'id',               p.id,
    'type',             p.type,
    'premiere',         p.premiere,
    'categorie',        p.categorie,
    'titre',            p.titre,
    'texte',            p.texte,
    'montant',          p.montant,
    'pseudo',           v_pseudo,
    'camp',             v_camp,
    'code_auteur',      v_code,
    'est_exemple',      p.est_exemple,
    'cree_le',          coalesce(p.modere_le, p.cree_le),
    'rire',             (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'rire'),
    'courage',          (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'courage'),
    'paierais',         (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'paierais'),
    'yacht',            (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'yacht'),
    'majordome',        (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'majordome'),
    'commentaires',     (select count(*) from public.comments c where c.problem_id = p.id and not c.masque),
    'couronnes',        v_nb,
    'couronne_par',     case when v_nb = 1 then (
                          select pr.pseudo from public.couronnes c
                          join public.profiles pr on pr.id = c.riche_id and not pr.bloque
                          where c.problem_id = p.id and not c.retiree limit 1) end,
    'ma_couronne',      coalesce(v_uid is not null and exists (
                          select 1 from public.couronnes c where c.problem_id = p.id and c.riche_id = v_uid and not c.retiree), false),
    'est_mon_probleme', coalesce(v_uid is not null and p.user_id = v_uid, false)
  );
end;
$fn$;
revoke all on function public.wp_probleme_json(public.problems) from public, anon, authenticated;

-- The member of a share code (case-insensitive), not blocked; null otherwise.
create or replace function public.wp_profil_par_code(p_code text)
returns public.profiles
language plpgsql
stable
security invoker
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
  return v_p;
end;
$fn$;
revoke all on function public.wp_profil_par_code(text) from public, anon, authenticated;

create or replace function public.get_profil_public(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_p  public.profiles := public.wp_profil_par_code(p_code);
  v_m  record;
  v_g  record;
  v_r  jsonb := '{}'::jsonb;
begin
  if v_p.id is null then
    return null;
  end if;
  if v_p.camp = 'pauvre' then
    select c.* into v_m from public.wp_classement_pauvres_depuis(public.wp_debut_mois_paris()) c where c.user_id = v_p.id;
    select c.* into v_g from public.wp_classement_pauvres_depuis(null) c where c.user_id = v_p.id;
    v_r := jsonb_build_object(
      'rang_mois',    jsonb_build_object('rang', v_m.rang,
                        'sur', (select count(*) from public.wp_classement_pauvres_depuis(public.wp_debut_mois_paris()))),
      'rang_general', jsonb_build_object('rang', v_g.rang,
                        'sur', (select count(*) from public.wp_classement_pauvres_depuis(null))),
      'total', coalesce(v_g.total, 0),
      'nb',    coalesce(v_g.nb, 0));
  end if;
  return v_r || jsonb_build_object(
    'pseudo',       v_p.pseudo,
    'camp',         v_p.camp,
    'code',         v_p.code_partage,
    'statut_riche', public.wp_statut_riche(v_p),
    'arrive_le',    (v_p.cree_le at time zone 'Europe/Paris')::date,
    'badges',       public.wp_badges(v_p.id),
    'problemes', coalesce((
      select jsonb_agg(public.wp_probleme_json(x) order by coalesce(x.modere_le, x.cree_le) desc, x.id desc)
      from (select p.* from public.problems p
            where p.user_id = v_p.id and p.statut = 'publie' and not p.masque and not p.est_exemple
            order by coalesce(p.modere_le, p.cree_le) desc, p.id desc limit 24) x
    ), '[]'::jsonb),
    'couronnes_donnees', case when v_p.camp <> 'riche' then '[]'::jsonb else coalesce((
      select jsonb_agg(public.wp_probleme_json(x.pb) order by x.couronne_le desc, (x.pb).id desc)
      from (select p as pb, c.cree_le as couronne_le from public.couronnes c
            join public.problems p on p.id = c.problem_id and p.statut = 'publie' and not p.masque
            where c.riche_id = v_p.id and not c.retiree
            order by c.cree_le desc limit 12) x
    ), '[]'::jsonb) end
  );
end;
$fn$;
revoke all on function public.get_profil_public(text) from public, anon, authenticated;
grant execute on function public.get_profil_public(text) to anon, authenticated;
