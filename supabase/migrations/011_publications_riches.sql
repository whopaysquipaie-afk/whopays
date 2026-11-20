-- =====================================================================
-- Qui paie ? / Who pays? — 011: problems and posts of the rich (R-030)
--  * problems.type: 'pauvre' (default, every existing row) | 'riche' | 'publication';
--    problems.premiere: first post (problem or publication) of a rich member.
--    A rich problem / post has no category; a publication has no title and no amount.
--  * soumettre_probleme (same signature): problems of the poor only. A rich member is refused.
--  * publier_riche(p_type, p_texte, p_titre, p_montant): an ACTIVE rich member (validated by a
--    moderator, 010 — checked by wp_exiger_membre) posts "Un problème de riche" (title, text,
--    optional amount up to 1 000 000, no 10 000 cap) or "Une simple publication" (text only,
--    10 to 600 characters). Same filters, sensitive expressions, automatic publication and
--    rate limit (10 per 24 h, all types together) as the problems of the poor.
--  * get_problemes_publics: new optional filter p_type (the 3-argument version is replaced).
--  * Public rows (wp_probleme_json) also carry type and premiere.
--  * The leaderboard (009), "Les chiffres" and the home counter only count problems of the poor
--    (posts are not problems; rich problems never enter the leaderboard).
--  * Moderation lists (006) also carry the type.
-- 001 to 010 are NOT modified. Run after 010. Idempotent.
-- Same rules as api-demo.js (publierRiche, soumettreProbleme, getProblemesPublics…).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns and constraints
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'problems' and column_name = 'type') then
    alter table public.problems
      add column type text not null default 'pauvre' check (type in ('pauvre', 'riche', 'publication')),
      add column premiere boolean not null default false;
    alter table public.problems alter column categorie drop not null;
    alter table public.problems alter column titre drop not null;
    -- A problem of the poor always has a category; only a publication has no title.
    alter table public.problems add constraint problems_categorie_selon_type
      check (type <> 'pauvre' or categorie is not null);
    alter table public.problems add constraint problems_titre_selon_type
      check ((type = 'publication') = (titre is null));
    alter table public.problems add constraint problems_publication_sans_montant
      check (type <> 'publication' or montant is null);
  end if;
end
$$;

create index if not exists problems_publics_type_idx
  on public.problems (type, (coalesce(modere_le, cree_le)) desc)
  where statut = 'publie' and not masque;

-- ---------------------------------------------------------------------
-- 2. Public projection (replaces 003): + type, premiere
-- ---------------------------------------------------------------------
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
    'type',             p.type,
    'premiere',         p.premiere,
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
revoke all on function public.wp_probleme_json(public.problems) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. The wall: optional type filter (replaces the 3-argument version of 003)
-- ---------------------------------------------------------------------
drop function if exists public.get_problemes_publics(text, integer, timestamptz);

create or replace function public.get_problemes_publics(
  p_categorie text default null,
  p_limite    integer default 12,
  p_avant     timestamptz default null,
  p_type      text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_categorie text := nullif(p_categorie, '');
  v_type      text := nullif(p_type, '');
  v_limite    integer := greatest(1, least(48, coalesce(p_limite, 12)));
begin
  if v_categorie is not null and not (v_categorie = any (public.wp_categories())) then
    perform public.wp_erreur('invalide', 'Catégorie inconnue.');
  end if;
  if v_type is not null and v_type not in ('pauvre', 'riche', 'publication') then
    perform public.wp_erreur('invalide', 'Type de publication inconnu.');
  end if;
  return coalesce((
    select jsonb_agg(public.wp_probleme_json(x.pb) order by x.date_affichee desc, (x.pb).id desc)
    from (
      select p as pb, coalesce(p.modere_le, p.cree_le) as date_affichee
      from public.problems p
      where p.statut = 'publie'
        and not p.masque
        and (v_categorie is null or p.categorie = v_categorie)
        and (v_type is null or p.type = v_type)
        and (p_avant is null or coalesce(p.modere_le, p.cree_le) < p_avant)
      order by coalesce(p.modere_le, p.cree_le) desc, p.id desc
      limit v_limite
    ) x
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_problemes_publics(text, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.get_problemes_publics(text, integer, timestamptz, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Problems of the poor (replaces 008; same signature and grants)
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
  v_statut  text;
  v_id      uuid;
begin
  v_p := public.wp_exiger_membre(true);
  if v_p.camp <> 'pauvre' then
    perform public.wp_erreur('interdit',
      'Un riche ne publie pas de problème de pauvre : choisis « Un problème de riche » ou « Une simple publication ».');
  end if;
  if p_categorie is null or not (p_categorie = any (public.wp_categories())) then
    perform public.wp_erreur('invalide', 'Choisis une catégorie.');
  end if;
  v_titre := public.wp_texte_valide(p_titre, 3, 80, 'Le titre', false);
  v_texte := public.wp_texte_valide(p_texte, 10, 600, 'Le texte', true);
  if p_montant is null or p_montant < 1 then
    perform public.wp_erreur('invalide', 'Indique le montant recherché : un nombre entier de 1 à 10 000 €.');
  end if;
  if p_montant > 10000 then
    perform public.wp_erreur('invalide', 'Un problème de pauvre ne dépasse jamais 10x Rien (10 000 €).');
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
  insert into public.problems (user_id, type, categorie, titre, texte, montant, statut, est_exemple, masque)
  values (v_p.id, 'pauvre', p_categorie, v_titre, v_texte, p_montant, v_statut, false, false)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'statut', v_statut);
end;
$fn$;
revoke all on function public.soumettre_probleme(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.soumettre_probleme(text, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Posts of the rich (active rich members only)
-- ---------------------------------------------------------------------
-- p_type 'riche' (title 3-80, text 10-600, optional amount 0-1 000 000) or 'publication' (text 10-600).
-- Returns { id, statut, premiere }.
create or replace function public.publier_riche(
  p_type    text,
  p_texte   text,
  p_titre   text default null,
  p_montant integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p        public.profiles;
  v_titre    text;
  v_texte    text;
  v_montant  integer;
  v_statut   text;
  v_premiere boolean;
  v_id       uuid;
begin
  v_p := public.wp_exiger_membre(true);  -- refuses a pending rich member (010)
  if v_p.camp <> 'riche' then
    perform public.wp_erreur('interdit', 'Seuls les riches validés publient ici. Un pauvre publie un problème de pauvre.');
  end if;
  if p_type is null or p_type not in ('riche', 'publication') then
    perform public.wp_erreur('invalide', 'Choisis « Un problème de riche » ou « Une simple publication ».');
  end if;
  v_texte := public.wp_texte_valide(p_texte, 10, 600, 'Le texte', true);
  if p_type = 'riche' then
    v_titre := public.wp_texte_valide(p_titre, 3, 80, 'Le titre', false);
    v_montant := public.wp_entier_valide(p_montant, 0, 1000000, 'Le montant');
  end if;
  if (select count(*) from public.problems p
      where p.user_id = v_p.id and p.cree_le > now() - interval '24 hours') >= 10 then
    perform public.wp_erreur('limite', 'Tu as déjà publié 10 fois en 24 h. Reviens demain !');
  end if;
  if public.wp_publication_auto()
     and not public.wp_contient_mot_sensible(coalesce(v_titre || E'\n', '') || v_texte) then
    v_statut := 'publie';
  else
    v_statut := 'recu';
  end if;
  v_premiere := not exists (
    select 1 from public.problems p where p.user_id = v_p.id and p.type in ('riche', 'publication'));
  insert into public.problems (user_id, type, premiere, categorie, titre, texte, montant, statut, est_exemple, masque)
  values (v_p.id, p_type, v_premiere, null, v_titre, v_texte, v_montant, v_statut, false, false)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'statut', v_statut, 'premiere', v_premiere);
end;
$fn$;
revoke all on function public.publier_riche(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.publier_riche(text, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Leaderboard, counters and figures: problems of the poor only
-- ---------------------------------------------------------------------
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
      on p.user_id = pr.id and p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple
    where pr.camp = 'pauvre' and not pr.bloque
    group by pr.id
  ) t;
$fn$;
revoke all on function public.wp_classement_pauvres() from public, anon, authenticated;

create or replace function public.get_compteurs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return jsonb_build_object(
    'problemes',              (select count(*) from public.problems p where not p.est_exemple and p.type = 'pauvre'),
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
      where p.statut = 'publie' and not p.est_exemple and p.type = 'pauvre'
    ),
    'finance', 0,
    'par_categorie', coalesce((
      select jsonb_agg(jsonb_build_object('categorie', c.categorie, 'nombre', c.nombre)
                       order by c.nombre desc, c.ordre)
      from (
        select k.categorie, k.ordre, count(*) as nombre
        from unnest(public.wp_categories()) with ordinality as k(categorie, ordre)
        join public.problems p
          on p.categorie = k.categorie and p.statut = 'publie' and not p.est_exemple and p.type = 'pauvre'
        group by k.categorie, k.ordre
      ) c
    ), '[]'::jsonb),
    'membres',           (select count(distinct lower(pr.email)) from public.profiles pr),
    'problemes_publies', (select count(*) from public.problems p
                          where p.statut = 'publie' and not p.est_exemple and p.type = 'pauvre'),
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
-- 7. "Mon espace": + type of each post, a publication shows the start of its text
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
                                 'id', p.id, 'type', p.type,
                                 'titre', coalesce(p.titre, left(p.texte, 80)),
                                 'statut', p.statut, 'masque', p.masque, 'cree_le', p.cree_le
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
-- 8. Moderation lists (replace 006): + type
-- ---------------------------------------------------------------------
create or replace function public.mod_a_relire()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_exiger_moderateur();  -- moderators only (raises 'interdit')
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'type', p.type, 'cree_le', v.cree_le, 'categorie', v.categorie, 'titre', v.titre,
             'texte', v.texte, 'montant', v.montant, 'statut', 'recu', 'masque', p.masque,
             'pseudo', v.pseudo, 'camp', v.camp, 'user_id', p.user_id, 'bloque', coalesce(v.bloque, false),
             'auteur_nb_publies', v.auteur_nb_publies, 'auteur_signalements_24h', v.auteur_signalements_24h
           ) order by v.cree_le, v.id)
    from (select * from public.moderation_a_relire limit 200) v
    join public.problems p on p.id = v.id
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.mod_a_relire() from public, anon, authenticated;
grant execute on function public.mod_a_relire() to authenticated;

create or replace function public.mod_recents(p_heures integer default 48)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_heures integer := least(greatest(coalesce(p_heures, 48), 1), 720);
begin
  perform public.wp_exiger_moderateur();  -- moderators only (raises 'interdit')
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'type', x.type, 'cree_le', x.cree_le, 'categorie', x.categorie, 'titre', x.titre,
             'texte', x.texte, 'montant', x.montant, 'statut', x.statut, 'masque', x.masque,
             'pseudo', x.pseudo, 'camp', x.camp, 'user_id', x.user_id, 'bloque', x.bloque,
             'nb_signalements', x.nb_signalements
           ) order by x.cree_le desc, x.id)
    from (
      select p.id, p.type, coalesce(p.modere_le, p.cree_le) as cree_le, p.categorie, p.titre, p.texte, p.montant,
             p.statut, p.masque, pr.pseudo, pr.camp, p.user_id, coalesce(pr.bloque, false) as bloque,
             (select count(*) from public.reports r
               where r.cible_type = 'probleme' and r.cible_id = p.id) as nb_signalements
      from public.problems p
      left join public.profiles pr on pr.id = p.user_id
      where p.statut = 'publie'
        and not p.est_exemple
        and coalesce(p.modere_le, p.cree_le) > now() - make_interval(hours => v_heures)
      order by coalesce(p.modere_le, p.cree_le) desc
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.mod_recents(integer) from public, anon, authenticated;
grant execute on function public.mod_recents(integer) to authenticated;

-- A publication has no title: the moderation views (004) show its text instead of nothing.
-- Same columns, same order, same types (create or replace view keeps the grants: none).
create or replace view public.moderation_masques
with (security_invoker = true) as
select
  'probleme'::text as cible_type,
  p.id             as cible_id,
  coalesce(p.titre || ' — ', '') || p.texte as contenu,
  null::text       as masque_par,
  (select count(*) from public.reports r where r.cible_type = 'probleme' and r.cible_id = p.id) as nb_signalements,
  pr.pseudo,
  pr.email,
  p.user_id,
  p.cree_le
from public.problems p
left join public.profiles pr on pr.id = p.user_id
where p.masque
union all
select
  'commentaire',
  c.id,
  c.texte,
  c.masque_par,
  (select count(*) from public.reports r where r.cible_type = 'commentaire' and r.cible_id = c.id),
  pr.pseudo,
  pr.email,
  c.user_id,
  c.cree_le
from public.comments c
left join public.profiles pr on pr.id = c.user_id
where c.masque
union all
select
  'message',
  m.id,
  '[' || m.camp || '] ' || m.texte,
  null::text,
  (select count(*) from public.reports r where r.cible_type = 'message' and r.cible_id = m.id),
  pr.pseudo,
  pr.email,
  m.user_id,
  m.cree_le
from public.club_messages m
left join public.profiles pr on pr.id = m.user_id
where m.masque;

-- Reports of the last 24 hours, grouped by target (most reported first).
create or replace view public.moderation_signalements_24h
with (security_invoker = true) as
select
  r.cible_type,
  r.cible_id,
  count(*)        as nb_signalements,
  min(r.cree_le)  as premier,
  max(r.cree_le)  as dernier,
  coalesce(
    (select coalesce(p.titre, left(p.texte, 80)) from public.problems p where r.cible_type = 'probleme' and p.id = r.cible_id),
    (select c.texte from public.comments c where r.cible_type = 'commentaire' and c.id = r.cible_id),
    (select m.texte from public.club_messages m where r.cible_type = 'message' and m.id = r.cible_id),
    '(contenu supprimé)'
  ) as contenu,
  coalesce(
    (select p.masque from public.problems p where r.cible_type = 'probleme' and p.id = r.cible_id),
    (select c.masque from public.comments c where r.cible_type = 'commentaire' and c.id = r.cible_id),
    (select m.masque from public.club_messages m where r.cible_type = 'message' and m.id = r.cible_id)
  ) as masque,
  coalesce(
    (select p.user_id from public.problems p where r.cible_type = 'probleme' and p.id = r.cible_id),
    (select c.user_id from public.comments c where r.cible_type = 'commentaire' and c.id = r.cible_id),
    (select m.user_id from public.club_messages m where r.cible_type = 'message' and m.id = r.cible_id)
  ) as auteur_id
from public.reports r
where r.cree_le > now() - interval '24 hours'
group by r.cible_type, r.cible_id
order by count(*) desc, max(r.cree_le) desc;

-- Reported content (replaces 006): same fallback for a publication without title.
create or replace function public.mod_signalements_24h()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_exiger_moderateur();  -- moderators only (raises 'interdit')
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'cible_type', s.cible_type, 'cible_id', s.cible_id, 'nb_signalements', s.nb_signalements,
             'premier', s.premier, 'dernier', s.dernier,
             'contenu', coalesce(coalesce(p.titre || ' — ', '') || p.texte, s.contenu),
             'masque', coalesce(s.masque, false), 'statut', p.statut,
             'user_id', s.auteur_id, 'pseudo', pr.pseudo, 'bloque', coalesce(pr.bloque, false)
           ) order by s.nb_signalements desc, s.dernier desc, s.cible_id)
    from (select * from public.moderation_signalements_24h limit 200) s
    left join public.profiles pr on pr.id = s.auteur_id
    left join public.problems p on s.cible_type = 'probleme' and p.id = s.cible_id
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.mod_signalements_24h() from public, anon, authenticated;
grant execute on function public.mod_signalements_24h() to authenticated;
