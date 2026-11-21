-- =====================================================================
-- Qui paie ? / Who pays? — 022: challenges between poor members (R-044, bonus)
--  * defier(p_code): « Je te défie de faire mieux » from a public profile. Poor members only, never
--    oneself, once per pair and per Paris day, IP quota « reaction » of 014. The challenged member gets
--    an on-site notification (015) with the challenger's rank of the month, linking to the challenger's
--    profile. Table defis: RLS forced, no grant.
--  * get_profil_public (replaces 019): + peut_defier (the site shows the button only then).
-- Never an id, never an e-mail. 001 to 021 are NOT modified. Run after 021. Idempotent.
-- Same rules as api-demo.js (defier).
-- =====================================================================

create table if not exists public.defis (
  defieur_id uuid not null references public.profiles (id) on delete cascade,
  defie_id   uuid not null references public.profiles (id) on delete cascade,
  cree_le    timestamptz not null default now(),
  constraint defis_pas_soi check (defieur_id <> defie_id)
);
create index if not exists defis_paire_date_idx on public.defis (defieur_id, defie_id, cree_le);

do $$
declare
  v_bypass boolean;
begin
  select r.rolbypassrls into v_bypass from pg_catalog.pg_roles r where r.rolname = current_user;
  alter table public.defis enable row level security;
  if coalesce(v_bypass, false) then
    alter table public.defis force row level security;
  else
    raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.defis', current_user;
  end if;
end
$$;
revoke all on public.defis from public, anon, authenticated;

-- { ok: true }; the challenged member is notified.
create or replace function public.defier(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.profiles;
  v_c public.profiles;
  v_l record;
  v_t text;
begin
  perform public.wp_limite_ip('reaction');
  v_p := public.wp_exiger_membre(false);
  if v_p.camp <> 'pauvre' then
    perform public.wp_erreur('interdit', 'Les défis, c''est entre pauvres. Un riche, lui, couronne.');
  end if;
  v_c := public.wp_profil_par_code(p_code);
  if v_c.id is null or v_c.camp <> 'pauvre' then
    perform public.wp_erreur('introuvable', 'Ce pauvre est introuvable.');
  end if;
  if v_c.id = v_p.id then
    perform public.wp_erreur('invalide', 'Te défier toi-même ? Tu gagnerais et tu perdrais à la fois.');
  end if;
  if exists (select 1 from public.defis d where d.defieur_id = v_p.id and d.defie_id = v_c.id
             and d.cree_le >= public.wp_debut_jour_paris()) then
    perform public.wp_erreur('limite', 'Tu l''as déjà défié aujourd''hui. Laisse-lui le temps de souffrir.');
  end if;
  insert into public.defis (defieur_id, defie_id) values (v_p.id, v_c.id);
  select c.* into v_l from public.wp_classement_pauvres_depuis(public.wp_debut_mois_paris()) c where c.user_id = v_p.id;
  v_t := case when v_l.rang is not null
              then ' : ' || v_l.rang || (case when v_l.rang = 1 then 'ᵉʳ' else 'ᵉ' end) || ' du mois. À toi de faire mieux !'
              else '. À toi de faire mieux !' end;
  perform public.wp_notifier(v_c.id, 'defi', v_p.pseudo || ' te défie de faire mieux' || v_t,
                             'profil.html?c=' || v_p.code_partage);
  return jsonb_build_object('ok', true);
end;
$fn$;
revoke all on function public.defier(text) from public, anon, authenticated;
grant execute on function public.defier(text) to authenticated;

-- get_profil_public (replaces 019): + peut_defier (the caller is poor, the profile is another poor member).
create or replace function public.get_profil_public(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles := public.wp_profil_par_code(p_code);
  v_m   record;
  v_g   record;
  v_r   jsonb := '{}'::jsonb;
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
    'abonnes',      public.wp_nb_abonnes(v_p.id),
    'je_suis',      coalesce(v_uid is not null and exists (
                      select 1 from public.suivis s where s.suiveur_id = v_uid and s.suivi_id = v_p.id), false),
    'peut_defier',  coalesce(v_p.camp = 'pauvre' and v_uid is not null and v_uid <> v_p.id and exists (
                      select 1 from public.profiles m where m.id = v_uid and m.camp = 'pauvre' and not m.bloque), false),
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
