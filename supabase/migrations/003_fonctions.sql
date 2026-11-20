-- =====================================================================
-- Qui paie ? / Who pays? — 003: RPC functions
-- The ONLY entry points of the site (tables have no grants, see 002).
-- Behaviour, validation, French messages and return shapes mirror the reference contract
-- site/assets/js/api-demo.js. Errors are raised with:
--   errcode = 'P0001', message = <French message shown to the user>, hint = <machine code>
-- where the code is one of: non_connecte | profil_absent | bloque | filtre | invalide |
-- introuvable | interdit | limite | deja_fait | aucun_compte.
-- Every function: SECURITY DEFINER, empty search_path, fully qualified names.
-- Run after 002_securite.sql. Idempotent (create or replace).
-- =====================================================================

-- =====================================================================
-- Internal helpers (not executable by anon / authenticated)
-- =====================================================================

-- Raises a user-facing error. Never returns.
create or replace function public.wp_erreur(p_code text, p_message text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end;
$fn$;

-- The caller's profile, for every write function (same checks and order as writer() in
-- api-demo.js): signed in, has a profile, not blocked. p_verrou locks the profile row so that
-- concurrent calls of the same member are serialized (exact rate limits).
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
  return v_profil;
end;
$fn$;

-- New unique referral code: 8 characters, no ambiguous letters or digits (no I, O, 0, 1).
create or replace function public.wp_nouveau_code()
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(c_alphabet, 1 + floor(random() * 32)::integer, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where code_partage = v_code);
  end loop;
  return v_code;
end;
$fn$;

-- Public projection of a problem (same keys as problemRow() in api-demo.js).
-- Never exposes user_id or e-mail.
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
begin
  if p.est_exemple or p.user_id is null then
    v_pseudo := 'L''équipe Qui paie ?';
    v_camp := null;
  else
    select pr.pseudo, pr.camp into v_pseudo, v_camp from public.profiles pr where pr.id = p.user_id;
    if not found then
      v_pseudo := 'Membre parti';
      v_camp := null;
    end if;
  end if;
  return jsonb_build_object(
    'id',               p.id,
    'categorie',        p.categorie,
    'titre',            p.titre,
    'texte',            p.texte,
    'montant',          p.montant,
    'pseudo',           v_pseudo,
    'camp',             v_camp,
    'est_exemple',      p.est_exemple,
    'cree_le',          coalesce(p.modere_le, p.cree_le),
    'rire',             (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'rire'),
    'courage',          (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'courage'),
    'paierais',         (select count(*) from public.reactions r where r.problem_id = p.id and r.type = 'paierais'),
    'commentaires',     (select count(*) from public.comments c where c.problem_id = p.id and not c.masque),
    'est_mon_probleme', coalesce(v_uid is not null and p.user_id = v_uid, false)
  );
end;
$fn$;

revoke all on function public.wp_erreur(text, text)              from public, anon, authenticated;
revoke all on function public.wp_exiger_membre(boolean)          from public, anon, authenticated;
revoke all on function public.wp_nouveau_code()                  from public, anon, authenticated;
revoke all on function public.wp_probleme_json(public.problems)  from public, anon, authenticated;

-- =====================================================================
-- Public reads (anon + authenticated)
-- =====================================================================

-- Home counters. "problemes" = every problem received (examples excluded);
-- "membres" = distinct e-mails.
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
    'riches',                 (select count(*) from public.profiles pr where pr.camp = 'riche'),
    'pauvres',                (select count(*) from public.profiles pr where pr.camp = 'pauvre'),
    'milliardaires_verifies', (select count(*) from public.verifications v)
  );
end;
$fn$;
revoke all on function public.get_compteurs() from public, anon, authenticated;
grant execute on function public.get_compteurs() to anon, authenticated;

-- "Les chiffres" page. Published problems only, examples excluded. Nothing is ever financed: 0.
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
    'riches',            (select count(*) from public.profiles pr where pr.camp = 'riche'),
    'pauvres',           (select count(*) from public.profiles pr where pr.camp = 'pauvre')
  );
end;
$fn$;
revoke all on function public.get_chiffres() from public, anon, authenticated;
grant execute on function public.get_chiffres() to anon, authenticated;

-- The wall: published, non-masked problems, newest first (date = coalesce(modere_le, cree_le)).
-- p_avant = date of the last problem already shown (pagination). Limit 1 to 48 (default 12).
create or replace function public.get_problemes_publics(
  p_categorie text default null,
  p_limite    integer default 12,
  p_avant     timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_categorie text := nullif(p_categorie, '');
  v_limite    integer := greatest(1, least(48, coalesce(p_limite, 12)));
begin
  if v_categorie is not null and not (v_categorie = any (public.wp_categories())) then
    perform public.wp_erreur('invalide', 'Catégorie inconnue.');
  end if;
  return coalesce((
    select jsonb_agg(public.wp_probleme_json(x.pb) order by x.date_affichee desc, (x.pb).id desc)
    from (
      select p as pb, coalesce(p.modere_le, p.cree_le) as date_affichee
      from public.problems p
      where p.statut = 'publie'
        and not p.masque
        and (v_categorie is null or p.categorie = v_categorie)
        and (p_avant is null or coalesce(p.modere_le, p.cree_le) < p_avant)
      order by coalesce(p.modere_le, p.cree_le) desc, p.id desc
      limit v_limite
    ) x
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_problemes_publics(text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.get_problemes_publics(text, integer, timestamptz) to anon, authenticated;

-- One problem (same keys as the wall), or null when it does not exist, is not published or is masked.
create or replace function public.get_probleme_public(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_resultat jsonb;
begin
  select public.wp_probleme_json(p) into v_resultat
  from public.problems p
  where p.id = p_id and p.statut = 'publie' and not p.masque;
  return v_resultat;
end;
$fn$;
revoke all on function public.get_probleme_public(uuid) from public, anon, authenticated;
grant execute on function public.get_probleme_public(uuid) to anon, authenticated;

-- Id of a random published, non-masked problem (null when there is none).
create or replace function public.get_probleme_hasard()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  select p.id into v_id
  from public.problems p
  where p.statut = 'publie' and not p.masque
  order by random()
  limit 1;
  return v_id;
end;
$fn$;
revoke all on function public.get_probleme_hasard() from public, anon, authenticated;
grant execute on function public.get_probleme_hasard() to anon, authenticated;

-- Comments of a visible problem, newest first, 50 per page (p_avant = date of the last one shown).
-- A masked comment keeps its place but its text is never sent (texte = null, masque = true).
create or replace function public.get_commentaires(
  p_problem_id uuid,
  p_avant      timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_pb  public.problems;
begin
  if p_problem_id is null then
    perform public.wp_erreur('invalide', 'Identifiant de problème invalide.');
  end if;
  select * into v_pb from public.problems p
  where p.id = p_problem_id and p.statut = 'publie' and not p.masque;
  if not found then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',                  c.id,
             'pseudo',              coalesce(pr.pseudo, 'Membre parti'),
             'camp',                pr.camp,
             'texte',               case when c.masque then null else c.texte end,
             'masque',              c.masque,
             'cree_le',             c.cree_le,
             'est_auteur_probleme', coalesce(v_pb.user_id is not null and c.user_id = v_pb.user_id, false),
             'est_moi',             coalesce(v_uid is not null and c.user_id = v_uid, false)
           ) order by c.cree_le desc, c.id desc)
    from (
      select cm.*
      from public.comments cm
      where cm.problem_id = p_problem_id
        and (p_avant is null or cm.cree_le < p_avant)
      order by cm.cree_le desc, cm.id desc
      limit 50
    ) c
    left join public.profiles pr on pr.id = c.user_id
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_commentaires(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.get_commentaires(uuid, timestamptz) to anon, authenticated;

-- =====================================================================
-- Members (authenticated only)
-- =====================================================================

-- Creates the caller's profile (once). Resolves the referral code (an unknown code or the
-- caller's own code is ignored). Returns { code_partage }.
create or replace function public.creer_profil(
  p_camp       text,
  p_pseudo     text,
  p_email      text,
  p_newsletter boolean default false,
  p_code_ref   text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_pseudo  text;
  v_email   text;
  v_code    text;
  v_parrain uuid;
begin
  if v_uid is null then
    perform public.wp_erreur('non_connecte', 'Rejoins un camp pour faire ça, ça prend 10 secondes.');
  end if;
  if exists (select 1 from public.profiles pr where pr.id = v_uid) then
    perform public.wp_erreur('invalide', 'Ton profil existe déjà.');
  end if;
  if p_camp is null or p_camp not in ('riche', 'pauvre') then
    perform public.wp_erreur('invalide', 'Choisis un camp : riche ou pauvre.');
  end if;
  v_pseudo := public.wp_texte_valide(p_pseudo, 2, 30, 'Ton pseudo', false);
  v_email := lower(public.wp_nettoyer(p_email, false));
  if char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    perform public.wp_erreur('invalide', 'Ton adresse e-mail n’a pas l’air valide.');
  end if;
  v_code := public.wp_nouveau_code();
  if p_code_ref is not null and p_code_ref ~ '^[A-Za-z0-9]{8}$' then
    select pr.id into v_parrain
    from public.profiles pr
    where pr.code_partage = upper(p_code_ref) and pr.id <> v_uid;
  end if;
  insert into public.profiles (id, pseudo, email, camp, newsletter, code_partage, invite_par, regles_acceptees_le, bloque)
  values (v_uid, v_pseudo, v_email, p_camp, coalesce(p_newsletter, false), v_code, v_parrain, now(), false);
  return jsonb_build_object('code_partage', v_code);
end;
$fn$;
revoke all on function public.creer_profil(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.creer_profil(text, text, text, boolean, text) to authenticated;

-- Updates the caller's profile, only these fields. Convention: null = unchanged;
-- p_riche_message = '' (or blank) clears the message; p_riche_montant = -1 clears the amount.
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
  v_p public.profiles;
begin
  v_p := public.wp_exiger_membre(true);
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
    v_p.camp := p_camp;
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
      riche_montant = v_p.riche_montant
  where pr.id = v_p.id;
  return jsonb_build_object(
    'pseudo',        v_p.pseudo,
    'camp',          v_p.camp,
    'newsletter',    v_p.newsletter,
    'riche_message', v_p.riche_message,
    'riche_montant', v_p.riche_montant
  );
end;
$fn$;
revoke all on function public.maj_profil(text, boolean, text, text, integer) from public, anon, authenticated;
grant execute on function public.maj_profil(text, boolean, text, text, integer) to authenticated;

-- Submits a problem. Always inserted as 'recu' (published only by moderation). 3 per 24 h.
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
  v_id      uuid;
begin
  v_p := public.wp_exiger_membre(true);
  if p_categorie is null or not (p_categorie = any (public.wp_categories())) then
    perform public.wp_erreur('invalide', 'Choisis une catégorie.');
  end if;
  v_titre := public.wp_texte_valide(p_titre, 3, 80, 'Le titre', false);
  v_texte := public.wp_texte_valide(p_texte, 10, 600, 'Le texte', true);
  v_montant := public.wp_entier_valide(p_montant, 0, 1000000, 'Le montant');
  if (select count(*) from public.problems p
      where p.user_id = v_p.id and p.cree_le > now() - interval '24 hours') >= 3 then
    perform public.wp_erreur('limite', 'Tu as déjà envoyé 3 problèmes en 24 h. Reviens demain, on aura relu les premiers.');
  end if;
  insert into public.problems (user_id, categorie, titre, texte, montant, statut, est_exemple, masque)
  values (v_p.id, p_categorie, v_titre, v_texte, v_montant, 'recu', false, false)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'statut', 'recu');
end;
$fn$;
revoke all on function public.soumettre_probleme(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.soumettre_probleme(text, text, text, integer) to authenticated;

-- Adds or removes a reaction (toggle). Returns { actif, rire, courage, paierais }.
create or replace function public.reagir(p_problem_id uuid, p_type text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p     public.profiles;
  v_actif boolean;
begin
  v_p := public.wp_exiger_membre(true);
  if p_type is null or p_type not in ('rire', 'courage', 'paierais') then
    perform public.wp_erreur('invalide', 'Réaction inconnue.');
  end if;
  if not exists (
    select 1 from public.problems p
    where p.id = p_problem_id and p.statut = 'publie' and not p.masque
  ) then
    perform public.wp_erreur('introuvable', 'Ce problème est introuvable ou n’est pas publié.');
  end if;
  delete from public.reactions r
  where r.problem_id = p_problem_id and r.user_id = v_p.id and r.type = p_type;
  if found then
    v_actif := false;
  else
    insert into public.reactions (problem_id, user_id, type)
    values (p_problem_id, v_p.id, p_type)
    on conflict do nothing;
    v_actif := true;
  end if;
  return jsonb_build_object(
    'actif',    v_actif,
    'rire',     (select count(*) from public.reactions r where r.problem_id = p_problem_id and r.type = 'rire'),
    'courage',  (select count(*) from public.reactions r where r.problem_id = p_problem_id and r.type = 'courage'),
    'paierais', (select count(*) from public.reactions r where r.problem_id = p_problem_id and r.type = 'paierais')
  );
end;
$fn$;
revoke all on function public.reagir(uuid, text) from public, anon, authenticated;
grant execute on function public.reagir(uuid, text) to authenticated;

-- The caller's reactions on a list of problems (100 ids max): [{ problem_id, type }].
-- Empty list when the caller has no profile.
create or replace function public.get_mes_reactions(p_problem_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or p_problem_ids is null
     or not exists (select 1 from public.profiles pr where pr.id = v_uid) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('problem_id', r.problem_id, 'type', r.type)
                     order by r.cree_le, r.problem_id, r.type)
    from public.reactions r
    where r.user_id = v_uid
      and r.problem_id = any ((p_problem_ids)[1:100])
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_mes_reactions(uuid[]) from public, anon, authenticated;
grant execute on function public.get_mes_reactions(uuid[]) to authenticated;

-- Comments a published, non-masked problem. 10 per hour.
create or replace function public.commenter(p_problem_id uuid, p_texte text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p       public.profiles;
  v_pb      public.problems;
  v_texte   text;
  v_id      uuid;
  v_cree_le timestamptz;
begin
  v_p := public.wp_exiger_membre(true);
  select * into v_pb from public.problems p
  where p.id = p_problem_id and p.statut = 'publie' and not p.masque;
  if not found then
    perform public.wp_erreur('introuvable', 'Ce problème est introuvable ou n’est pas publié.');
  end if;
  v_texte := public.wp_texte_valide(p_texte, 1, 300, 'Ton commentaire', true);
  if (select count(*) from public.comments c
      where c.user_id = v_p.id and c.cree_le > now() - interval '1 hour') >= 10 then
    perform public.wp_erreur('limite', 'Tu as déjà écrit 10 commentaires cette heure-ci. Petite pause ?');
  end if;
  insert into public.comments (problem_id, user_id, texte, masque, masque_par)
  values (p_problem_id, v_p.id, v_texte, false, null)
  returning id, cree_le into v_id, v_cree_le;
  return jsonb_build_object(
    'id',                  v_id,
    'pseudo',              v_p.pseudo,
    'camp',                v_p.camp,
    'texte',               v_texte,
    'masque',              false,
    'cree_le',             v_cree_le,
    'est_auteur_probleme', coalesce(v_pb.user_id = v_p.id, false),
    'est_moi',             true
  );
end;
$fn$;
revoke all on function public.commenter(uuid, text) from public, anon, authenticated;
grant execute on function public.commenter(uuid, text) to authenticated;

-- Deletes one of the caller's own comments (and the reports about it).
create or replace function public.supprimer_mon_commentaire(p_comment_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p      public.profiles;
  v_auteur uuid;
begin
  v_p := public.wp_exiger_membre(true);
  select c.user_id into v_auteur from public.comments c where c.id = p_comment_id;
  if not found then
    perform public.wp_erreur('introuvable', 'Ce commentaire est introuvable.');
  end if;
  if v_auteur <> v_p.id then
    perform public.wp_erreur('interdit', 'Tu ne peux supprimer que tes propres commentaires.');
  end if;
  delete from public.comments c where c.id = p_comment_id;
  delete from public.reports r where r.cible_type = 'commentaire' and r.cible_id = p_comment_id;
  return true;
end;
$fn$;
revoke all on function public.supprimer_mon_commentaire(uuid) from public, anon, authenticated;
grant execute on function public.supprimer_mon_commentaire(uuid) to authenticated;

-- Masks a comment. Only the author of the problem the comment belongs to may do it.
create or replace function public.masquer_commentaire(p_comment_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p          public.profiles;
  v_problem_id uuid;
  v_auteur_pb  uuid;
begin
  v_p := public.wp_exiger_membre(true);
  select c.problem_id into v_problem_id from public.comments c where c.id = p_comment_id;
  if not found then
    perform public.wp_erreur('introuvable', 'Ce commentaire est introuvable.');
  end if;
  select p.user_id into v_auteur_pb from public.problems p where p.id = v_problem_id;
  if v_auteur_pb is null or v_auteur_pb <> v_p.id then
    perform public.wp_erreur('interdit', 'Seul l’auteur du problème peut masquer un commentaire.');
  end if;
  update public.comments c
  set masque = true, masque_par = 'auteur_probleme'
  where c.id = p_comment_id;
  return true;
end;
$fn$;
revoke all on function public.masquer_commentaire(uuid) from public, anon, authenticated;
grant execute on function public.masquer_commentaire(uuid) to authenticated;

-- Club messages of the caller's camp ONLY, non-masked, oldest first.
-- First call (p_apres null): the 100 latest. Then: the messages after p_apres (500 max per call).
create or replace function public.get_club_messages(p_apres timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_p public.profiles;
begin
  v_p := public.wp_exiger_membre(false);
  if p_apres is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'pseudo', coalesce(pr.pseudo, 'Membre parti'), 'texte', m.texte,
               'cree_le', m.cree_le, 'est_moi', m.user_id = v_p.id
             ) order by m.cree_le, m.id)
      from (
        select cm.* from public.club_messages cm
        where cm.camp = v_p.camp and not cm.masque
        order by cm.cree_le desc, cm.id desc
        limit 100
      ) m
      left join public.profiles pr on pr.id = m.user_id
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', m.id, 'pseudo', coalesce(pr.pseudo, 'Membre parti'), 'texte', m.texte,
             'cree_le', m.cree_le, 'est_moi', m.user_id = v_p.id
           ) order by m.cree_le, m.id)
    from (
      select cm.* from public.club_messages cm
      where cm.camp = v_p.camp and not cm.masque and cm.cree_le > p_apres
      order by cm.cree_le, cm.id
      limit 500
    ) m
    left join public.profiles pr on pr.id = m.user_id
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_club_messages(timestamptz) from public, anon, authenticated;
grant execute on function public.get_club_messages(timestamptz) to authenticated;

-- Sends a message to the caller's club (camp taken from the profile). 30 per hour.
create or replace function public.envoyer_message_club(p_texte text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p       public.profiles;
  v_texte   text;
  v_id      uuid;
  v_cree_le timestamptz;
begin
  v_p := public.wp_exiger_membre(true);
  v_texte := public.wp_texte_valide(p_texte, 1, 300, 'Ton message', true);
  if (select count(*) from public.club_messages m
      where m.user_id = v_p.id and m.cree_le > now() - interval '1 hour') >= 30 then
    perform public.wp_erreur('limite', 'Tu as déjà envoyé 30 messages cette heure-ci. Laisse parler les autres un peu !');
  end if;
  insert into public.club_messages (camp, user_id, texte, masque)
  values (v_p.camp, v_p.id, v_texte, false)
  returning id, cree_le into v_id, v_cree_le;
  return jsonb_build_object(
    'id', v_id, 'pseudo', v_p.pseudo, 'texte', v_texte, 'cree_le', v_cree_le, 'est_moi', true
  );
end;
$fn$;
revoke all on function public.envoyer_message_club(text) from public, anon, authenticated;
grant execute on function public.envoyer_message_club(text) to authenticated;

-- Reports a problem, a comment or a club message (of the caller's camp). One report per member
-- and per target; 20 per hour. The 3rd report masks the target. Returns { masque }.
create or replace function public.signaler(p_cible_type text, p_cible_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p      public.profiles;
  v_statut text;
  v_camp   text;
  v_masque boolean;
  v_total  integer;
begin
  v_p := public.wp_exiger_membre(true);
  if p_cible_type is null or p_cible_type not in ('probleme', 'commentaire', 'message') then
    perform public.wp_erreur('invalide', 'Type de contenu inconnu.');
  end if;
  if p_cible_id is null then
    perform public.wp_erreur('invalide', 'Identifiant invalide.');
  end if;

  -- The target row is locked so that concurrent reports are counted one after the other.
  if p_cible_type = 'probleme' then
    select p.statut, p.masque into v_statut, v_masque
    from public.problems p where p.id = p_cible_id
    for no key update;
    if not found then
      perform public.wp_erreur('introuvable', 'Ce contenu est introuvable.');
    end if;
    if v_statut <> 'publie' or v_masque then
      perform public.wp_erreur('introuvable', 'Ce problème est introuvable ou n’est pas publié.');
    end if;
  elsif p_cible_type = 'commentaire' then
    select c.masque into v_masque
    from public.comments c where c.id = p_cible_id
    for no key update;
    if not found then
      perform public.wp_erreur('introuvable', 'Ce contenu est introuvable.');
    end if;
  else
    select m.camp, m.masque into v_camp, v_masque
    from public.club_messages m where m.id = p_cible_id
    for no key update;
    if not found or v_camp <> v_p.camp then
      perform public.wp_erreur('introuvable', 'Ce contenu est introuvable.');
    end if;
  end if;

  if exists (
    select 1 from public.reports r
    where r.cible_type = p_cible_type and r.cible_id = p_cible_id and r.user_id = v_p.id
  ) then
    perform public.wp_erreur('deja_fait', 'Tu as déjà signalé ce contenu. Merci, on regarde ça.');
  end if;
  if (select count(*) from public.reports r
      where r.user_id = v_p.id and r.cree_le > now() - interval '1 hour') >= 20 then
    perform public.wp_erreur('limite', 'Tu as déjà fait 20 signalements cette heure-ci. On s’en occupe !');
  end if;

  insert into public.reports (cible_type, cible_id, user_id)
  values (p_cible_type, p_cible_id, v_p.id)
  on conflict (cible_type, cible_id, user_id) do nothing;
  if not found then
    perform public.wp_erreur('deja_fait', 'Tu as déjà signalé ce contenu. Merci, on regarde ça.');
  end if;

  select count(*) into v_total
  from public.reports r
  where r.cible_type = p_cible_type and r.cible_id = p_cible_id;

  if v_total >= 3 and not v_masque then
    if p_cible_type = 'probleme' then
      update public.problems p set masque = true where p.id = p_cible_id;
    elsif p_cible_type = 'commentaire' then
      update public.comments c set masque = true, masque_par = 'signalements' where c.id = p_cible_id;
    else
      update public.club_messages m set masque = true where m.id = p_cible_id;
    end if;
    v_masque := true;
  end if;
  return jsonb_build_object('masque', v_masque);
end;
$fn$;
revoke all on function public.signaler(text, uuid) from public, anon, authenticated;
grant execute on function public.signaler(text, uuid) to authenticated;

-- "Mon espace": the caller's own data (the only function that returns an e-mail: the caller's).
-- Readable even when blocked (bloque = true is shown).
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
  return jsonb_build_object(
    'pseudo',         v_p.pseudo,
    'email',          v_p.email,
    'camp',           v_p.camp,
    'newsletter',     v_p.newsletter,
    'riche_message',  v_p.riche_message,
    'riche_montant',  v_p.riche_montant,
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

-- Deletes everything about the caller, then the auth.users row. Allowed even when blocked.
create or replace function public.supprimer_mon_compte()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform public.wp_erreur('non_connecte', 'Rejoins un camp pour faire ça, ça prend 10 secondes.');
  end if;
  -- Reports about the caller's content (that content disappears below)
  delete from public.reports r
  where (r.cible_type = 'probleme'
         and r.cible_id in (select p.id from public.problems p where p.user_id = v_uid))
     or (r.cible_type = 'commentaire'
         and r.cible_id in (select c.id from public.comments c
                            where c.user_id = v_uid
                               or c.problem_id in (select p.id from public.problems p where p.user_id = v_uid)))
     or (r.cible_type = 'message'
         and r.cible_id in (select m.id from public.club_messages m where m.user_id = v_uid));
  delete from public.reports r where r.user_id = v_uid;
  delete from public.reactions r where r.user_id = v_uid;
  delete from public.comments c where c.user_id = v_uid;
  delete from public.club_messages m where m.user_id = v_uid;
  -- Also removes the reactions and comments of other members on these problems (cascade)
  delete from public.problems p where p.user_id = v_uid;
  delete from public.verifications v where v.user_id = v_uid;
  update public.profiles pr set invite_par = null where pr.invite_par = v_uid;
  delete from public.profiles pr where pr.id = v_uid;
  delete from auth.users u where u.id = v_uid;
  return true;
end;
$fn$;
revoke all on function public.supprimer_mon_compte() from public, anon, authenticated;
grant execute on function public.supprimer_mon_compte() to authenticated;

-- Join flow: when the e-mail already belongs to a confirmed member, the anonymous user that was
-- just created is removed. Deletes the caller's auth.users row only if it is anonymous and has
-- no profile. Returns true when deleted, false otherwise.
create or replace function public.supprimer_utilisateur_anonyme()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform public.wp_erreur('non_connecte', 'Rejoins un camp pour faire ça, ça prend 10 secondes.');
  end if;
  if exists (select 1 from public.profiles pr where pr.id = v_uid) then
    return false;
  end if;
  delete from auth.users u where u.id = v_uid and u.is_anonymous is true;
  return found;
end;
$fn$;
revoke all on function public.supprimer_utilisateur_anonyme() from public, anon, authenticated;
grant execute on function public.supprimer_utilisateur_anonyme() to authenticated;
