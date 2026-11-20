-- =====================================================================
-- Qui paie ? / Who pays? — 010: paying rich members, simple version (R-029)
-- Rule (Hassen, 20/11 21 h 12): NO rich account is active without a moderator's validation.
--  * profiles: statut_riche ('en_attente' | 'actif'), riche_formule ('mensuel' | 'annuel'),
--    riche_jusqu_au (end of the paid period). A rich member whose riche_jusqu_au has passed is
--    pending again: computed on every call (wp_riche_actif), no scheduled job.
--    Existing rich members (the moderator included) become 'actif' with no end date;
--    moderators are always active.
--  * wp_exiger_membre (used by EVERY write function: publish, react, comment, report, club,
--    delete / mask a comment) now also refuses a pending rich member (hint 'riche_en_attente').
--    Reading the rich club is refused too (it is reserved to validated rich members).
--    maj_profil no longer goes through it (a pending member may still change pseudo, newsletter
--    or camp); switching camp always puts the account back to 'en_attente'.
--  * get_mon_espace also returns statut_riche (null for the poor), riche_formule, riche_jusqu_au.
--  * get_compteurs / get_chiffres: "riches" = active rich members only.
--  * Moderation (moderators only, like 006): mod_riches(), mod_activer_riche(p_user_id, p_formule),
--    mod_desactiver_riche(p_user_id), mod_refuser_riche(p_user_id) (back to the poor camp).
-- The subscription only pays for the rich status on the platform; it never funds a problem and no
-- money ever goes from one member to another. No payment is handled here (contact the support).
-- 001 to 009 are NOT modified. Run after 009. Idempotent.
-- Same rules as api-demo.js (writer(), majProfil(), moderation.riches…).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'statut_riche') then
    alter table public.profiles
      add column statut_riche text not null default 'en_attente'
        check (statut_riche in ('en_attente', 'actif')),
      add column riche_formule text check (riche_formule is null or riche_formule in ('mensuel', 'annuel')),
      add column riche_jusqu_au timestamptz;
    -- Rich members registered before this migration stay active, with no end date.
    update public.profiles pr set statut_riche = 'actif' where pr.camp = 'riche';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Helpers (internal)
-- ---------------------------------------------------------------------

-- Validated rich member: a moderator, or 'actif' with no end date / an end date in the future.
create or replace function public.wp_riche_actif(p public.profiles)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select p.camp = 'riche'
     and (exists (select 1 from public.moderateurs m where m.user_id = p.id)
          or (p.statut_riche = 'actif' and (p.riche_jusqu_au is null or p.riche_jusqu_au > now())));
$fn$;

-- 'actif' | 'en_attente' for a rich member, null for the poor.
create or replace function public.wp_statut_riche(p public.profiles)
returns text
language sql
stable
security invoker
set search_path = ''
as $fn$
  select case when p.camp <> 'riche' then null
              when public.wp_riche_actif(p) then 'actif'
              else 'en_attente' end;
$fn$;

-- Same as 003 + a pending rich member is refused (every write function goes through here).
create or replace function public.wp_exiger_membre(p_verrou boolean default false)
returns public.profiles
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_profil public.profiles;
begin
  if v_uid is null then
    perform public.wp_erreur('non_connecte', 'Rejoins un camp pour faire ça, ça prend 10 secondes.');
  end if;
  if coalesce(p_verrou, false) then
    select * into v_profil from public.profiles where id = v_uid for no key update;
  else
    select * into v_profil from public.profiles where id = v_uid;
  end if;
  if not found then
    perform public.wp_erreur('profil_absent', 'Ton profil n’existe pas encore. Choisis ton camp pour commencer.');
  end if;
  if v_profil.bloque then
    perform public.wp_erreur('bloque', 'Ton compte est bloqué : tu ne peux plus publier, réagir ni écrire.');
  end if;
  if v_profil.camp = 'riche' and not public.wp_riche_actif(v_profil) then
    perform public.wp_erreur('riche_en_attente',
      'Ton compte riche attend la validation d’un modérateur : tu peux lire le site, mais pas encore publier, réagir, commenter ni écrire au club.');
  end if;
  return v_profil;
end;
$fn$;

revoke all on function public.wp_riche_actif(public.profiles)   from public, anon, authenticated;
revoke all on function public.wp_statut_riche(public.profiles)  from public, anon, authenticated;
revoke all on function public.wp_exiger_membre(boolean)         from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Profile update (replaces 003; same signature and grants)
-- ---------------------------------------------------------------------
-- Allowed while pending (pseudo, newsletter, camp, rich message). Switching camp puts the account
-- back to 'en_attente' (a poor member who becomes rich waits for a moderator).
create or replace function public.maj_profil(
  p_pseudo        text default null,
  p_newsletter    boolean default null,
  p_camp          text default null,
  p_riche_message text default null,
  p_riche_montant integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
begin
  if v_uid is null then
    perform public.wp_erreur('non_connecte', 'Rejoins un camp pour faire ça, ça prend 10 secondes.');
  end if;
  select * into v_p from public.profiles pr where pr.id = v_uid for no key update;
  if not found then
    perform public.wp_erreur('profil_absent', 'Ton profil n’existe pas encore. Choisis ton camp pour commencer.');
  end if;
  if v_p.bloque then
    perform public.wp_erreur('bloque', 'Ton compte est bloqué : tu ne peux plus publier, réagir ni écrire.');
  end if;
  if p_pseudo is not null then
    v_p.pseudo := public.wp_texte_valide(p_pseudo, 2, 30, 'Ton pseudo', false);
  end if;
  if p_newsletter is not null then
    v_p.newsletter := p_newsletter;
  end if;
  if p_camp is not null then
    if p_camp not in ('riche', 'pauvre') then
      perform public.wp_erreur('invalide', 'Choisis un camp : riche ou pauvre.');
    end if;
    if p_camp <> v_p.camp then
      v_p.camp := p_camp;
      v_p.statut_riche := 'en_attente';
      v_p.riche_formule := null;
      v_p.riche_jusqu_au := null;
    end if;
  end if;
  if p_riche_message is not null then
    if public.wp_nettoyer(p_riche_message, false) = '' then
      v_p.riche_message := null;
    else
      v_p.riche_message := public.wp_texte_valide(p_riche_message, 0, 500, 'Ton message', true);
    end if;
  end if;
  if p_riche_montant is not null then
    if p_riche_montant = -1 then
      v_p.riche_montant := null;
    else
      v_p.riche_montant := public.wp_entier_valide(p_riche_montant, 0, 10000000, 'Le montant');
    end if;
  end if;
  update public.profiles pr
  set pseudo = v_p.pseudo,
      newsletter = v_p.newsletter,
      camp = v_p.camp,
      riche_message = v_p.riche_message,
      riche_montant = v_p.riche_montant,
      statut_riche = v_p.statut_riche,
      riche_formule = v_p.riche_formule,
      riche_jusqu_au = v_p.riche_jusqu_au
  where pr.id = v_p.id;
  return jsonb_build_object(
    'pseudo',        v_p.pseudo,
    'camp',          v_p.camp,
    'newsletter',    v_p.newsletter,
    'riche_message', v_p.riche_message,
    'riche_montant', v_p.riche_montant,
    'statut_riche',  public.wp_statut_riche(v_p)
  );
end;
$fn$;
revoke all on function public.maj_profil(text, boolean, text, text, integer) from public, anon, authenticated;
grant execute on function public.maj_profil(text, boolean, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. "Mon espace" (replaces 003; + statut_riche, riche_formule, riche_jusqu_au)
-- ---------------------------------------------------------------------
create or replace function public.get_mon_espace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_p        public.profiles;
  v_confirme boolean;
  v_statut   text;
begin
  if v_uid is null then
    perform public.wp_erreur('non_connecte', 'Rejoins un camp pour faire ça, ça prend 10 secondes.');
  end if;
  select * into v_p from public.profiles pr where pr.id = v_uid;
  if not found then
    perform public.wp_erreur('profil_absent', 'Ton profil n’existe pas encore. Choisis ton camp pour commencer.');
  end if;
  select u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
    into v_confirme
  from auth.users u where u.id = v_uid;
  v_statut := public.wp_statut_riche(v_p);
  return jsonb_build_object(
    'pseudo',         v_p.pseudo,
    'email',          v_p.email,
    'camp',           v_p.camp,
    'newsletter',     v_p.newsletter,
    'riche_message',  v_p.riche_message,
    'riche_montant',  v_p.riche_montant,
    'statut_riche',   v_statut,
    'riche_formule',  case when v_statut = 'actif' then v_p.riche_formule end,
    'riche_jusqu_au', case when v_statut = 'actif' then v_p.riche_jusqu_au end,
    'code_partage',   v_p.code_partage,
    'nb_invites',     (select count(*) from public.profiles pr where pr.invite_par = v_uid),
    'email_confirme', coalesce(v_confirme, false),
    'bloque',         v_p.bloque,
    'verifie',        exists (select 1 from public.verifications v where v.user_id = v_uid),
    'problemes',      coalesce((
                        select jsonb_agg(jsonb_build_object(
                                 'id', p.id, 'titre', p.titre, 'statut', p.statut,
                                 'masque', p.masque, 'cree_le', p.cree_le
                               ) order by p.cree_le desc, p.id desc)
                        from public.problems p
                        where p.user_id = v_uid
                      ), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.get_mon_espace() from public, anon, authenticated;
grant execute on function public.get_mon_espace() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Counters: active rich members only (replace 003; same signatures and grants)
-- ---------------------------------------------------------------------
create or replace function public.get_compteurs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return jsonb_build_object(
    'problemes',              (select count(*) from public.problems p where not p.est_exemple),
    'membres',                (select count(distinct lower(pr.email)) from public.profiles pr),
    'riches',                 (select count(*) from public.profiles pr where public.wp_riche_actif(pr)),
    'pauvres',                (select count(*) from public.profiles pr where pr.camp = 'pauvre'),
    'milliardaires_verifies', (select count(*) from public.verifications v)
  );
end;
$fn$;
revoke all on function public.get_compteurs() from public, anon, authenticated;
grant execute on function public.get_compteurs() to anon, authenticated;

create or replace function public.get_chiffres()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return jsonb_build_object(
    'montant_total', (
      select coalesce(sum(p.montant), 0) from public.problems p
      where p.statut = 'publie' and not p.est_exemple
    ),
    'finance', 0,
    'par_categorie', coalesce((
      select jsonb_agg(jsonb_build_object('categorie', c.categorie, 'nombre', c.nombre)
                       order by c.nombre desc, c.ordre)
      from (
        select k.categorie, k.ordre, count(*) as nombre
        from unnest(public.wp_categories()) with ordinality as k(categorie, ordre)
        join public.problems p
          on p.categorie = k.categorie and p.statut = 'publie' and not p.est_exemple
        group by k.categorie, k.ordre
      ) c
    ), '[]'::jsonb),
    'membres',           (select count(distinct lower(pr.email)) from public.profiles pr),
    'problemes_publies', (select count(*) from public.problems p where p.statut = 'publie' and not p.est_exemple),
    'reactions',         (select count(*) from public.reactions r),
    'commentaires',      (select count(*) from public.comments c where not c.masque),
    'riches',            (select count(*) from public.profiles pr where public.wp_riche_actif(pr)),
    'pauvres',           (select count(*) from public.profiles pr where pr.camp = 'pauvre')
  );
end;
$fn$;
revoke all on function public.get_chiffres() from public, anon, authenticated;
grant execute on function public.get_chiffres() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Moderation of rich members (moderators only, never an e-mail)
-- ---------------------------------------------------------------------

-- Rich members: pending first (oldest first), then active ones (end date soonest first). 500 max.
create or replace function public.mod_riches()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_exiger_moderateur();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', x.id, 'pseudo', x.pseudo, 'statut', x.statut, 'formule', x.formule,
             'jusqu_au', x.jusqu_au, 'cree_le', x.cree_le, 'bloque', x.bloque, 'est_moderateur', x.modo
           ) order by x.statut desc, x.jusqu_au nulls last, x.cree_le)
    from (
      select pr.id, pr.pseudo, pr.cree_le, pr.bloque,
             public.wp_statut_riche(pr) as statut,
             case when public.wp_riche_actif(pr) then pr.riche_formule end as formule,
             case when public.wp_riche_actif(pr) then pr.riche_jusqu_au end as jusqu_au,
             exists (select 1 from public.moderateurs m where m.user_id = pr.id) as modo
      from public.profiles pr
      where pr.camp = 'riche'
      order by public.wp_statut_riche(pr) desc, pr.cree_le
      limit 500
    ) x
  ), '[]'::jsonb);
end;
$fn$;

-- Activates (or extends) a rich member for 1 month or 1 year, from the current end date when it is
-- still in the future, otherwise from now. Returns { user_id, statut, formule, jusqu_au }.
create or replace function public.mod_activer_riche(p_user_id uuid, p_formule text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p     public.profiles;
  v_debut timestamptz;
  v_fin   timestamptz;
begin
  perform public.wp_exiger_moderateur();
  if p_formule is null or p_formule not in ('mensuel', 'annuel') then
    perform public.wp_erreur('invalide', 'Formule inconnue (mensuel ou annuel).');
  end if;
  select * into v_p from public.profiles pr where pr.id = p_user_id for no key update;
  if not found then
    perform public.wp_erreur('introuvable', 'Membre introuvable.');
  end if;
  if v_p.camp <> 'riche' then
    perform public.wp_erreur('invalide', 'Ce membre n’est pas dans le camp des riches.');
  end if;
  v_debut := case when v_p.statut_riche = 'actif' and v_p.riche_jusqu_au > now() then v_p.riche_jusqu_au else now() end;
  v_fin := v_debut + case when p_formule = 'annuel' then interval '1 year' else interval '1 month' end;
  update public.profiles pr
  set statut_riche = 'actif', riche_formule = p_formule, riche_jusqu_au = v_fin
  where pr.id = p_user_id;
  return jsonb_build_object('user_id', p_user_id, 'statut', 'actif', 'formule', p_formule, 'jusqu_au', v_fin);
end;
$fn$;

-- Puts a rich member back to 'en_attente' (moderators always stay active).
create or replace function public.mod_desactiver_riche(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.profiles;
begin
  perform public.wp_exiger_moderateur();
  select * into v_p from public.profiles pr where pr.id = p_user_id for no key update;
  if not found then
    perform public.wp_erreur('introuvable', 'Membre introuvable.');
  end if;
  if v_p.camp <> 'riche' then
    perform public.wp_erreur('invalide', 'Ce membre n’est pas dans le camp des riches.');
  end if;
  if exists (select 1 from public.moderateurs m where m.user_id = p_user_id) then
    perform public.wp_erreur('invalide', 'Un modérateur reste toujours actif.');
  end if;
  update public.profiles pr
  set statut_riche = 'en_attente', riche_formule = null, riche_jusqu_au = null
  where pr.id = p_user_id;
  return jsonb_build_object('user_id', p_user_id, 'statut', 'en_attente');
end;
$fn$;

-- Refuses a rich member: back to the poor camp.
create or replace function public.mod_refuser_riche(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.profiles;
begin
  perform public.wp_exiger_moderateur();
  select * into v_p from public.profiles pr where pr.id = p_user_id for no key update;
  if not found then
    perform public.wp_erreur('introuvable', 'Membre introuvable.');
  end if;
  if v_p.camp <> 'riche' then
    perform public.wp_erreur('invalide', 'Ce membre n’est pas dans le camp des riches.');
  end if;
  if exists (select 1 from public.moderateurs m where m.user_id = p_user_id) then
    perform public.wp_erreur('invalide', 'Un modérateur reste toujours actif.');
  end if;
  update public.profiles pr
  set camp = 'pauvre', statut_riche = 'en_attente', riche_formule = null, riche_jusqu_au = null
  where pr.id = p_user_id;
  return jsonb_build_object('user_id', p_user_id, 'camp', 'pauvre');
end;
$fn$;

revoke all on function public.mod_riches()                   from public, anon, authenticated;
revoke all on function public.mod_activer_riche(uuid, text)  from public, anon, authenticated;
revoke all on function public.mod_desactiver_riche(uuid)     from public, anon, authenticated;
revoke all on function public.mod_refuser_riche(uuid)        from public, anon, authenticated;
grant execute on function public.mod_riches()                  to authenticated;
grant execute on function public.mod_activer_riche(uuid, text) to authenticated;
grant execute on function public.mod_desactiver_riche(uuid)    to authenticated;
grant execute on function public.mod_refuser_riche(uuid)       to authenticated;
