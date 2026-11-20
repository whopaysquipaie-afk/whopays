-- =====================================================================
-- Qui paie ? / Who pays? — 008: 10 000 € cap and "post at will" for the poor (R-027)
--  * soumettre_probleme (same signature and grants, replaces the 005 version):
--      - a member of the poor camp MUST give an amount, a whole number from 1 to 10 000
--        ("Un problème de pauvre ne dépasse jamais 10x Rien (10 000 €).");
--      - rich members keep the previous rule (optional, 0 to 1 000 000);
--      - rate limit raised from 3 to 10 problems per 24 h.
--    Filters, sensitive expressions and automatic publication: unchanged (005 / 007).
--  * Team examples above the cap are brought down to 9 000 € (one seeded example had 18 000 €).
--    Members' problems already published are left as they are.
-- 001 to 007 are applied in production and are NOT modified. Run after 007. Idempotent.
-- Same rules as soumettreProbleme() in site/assets/js/api-demo.js.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Examples within the cap
-- ---------------------------------------------------------------------
update public.problems p
set montant = 9000
where p.est_exemple and p.montant > 10000;

-- ---------------------------------------------------------------------
-- 2. Submitting a problem
-- ---------------------------------------------------------------------
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
  if v_p.camp = 'pauvre' then
    if p_montant is null or p_montant < 1 then
      perform public.wp_erreur('invalide', 'Indique le montant recherché : un nombre entier de 1 à 10 000 €.');
    end if;
    if p_montant > 10000 then
      perform public.wp_erreur('invalide', 'Un problème de pauvre ne dépasse jamais 10x Rien (10 000 €).');
    end if;
    v_montant := p_montant;
  else
    v_montant := public.wp_entier_valide(p_montant, 0, 1000000, 'Le montant');
  end if;
  if (select count(*) from public.problems p
      where p.user_id = v_p.id and p.cree_le > now() - interval '24 hours') >= 10 then
    perform public.wp_erreur('limite', 'Tu as déjà envoyé 10 problèmes en 24 h. Reviens demain !');
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
