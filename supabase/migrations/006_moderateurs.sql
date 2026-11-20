-- =====================================================================
-- Qui paie ? / Who pays? — 006: moderators and the mobile moderation page (R-018)
-- site/moderation.html lets a moderator review content from a phone, without the SQL editor.
--  * public.moderateurs: the members allowed to moderate (filled in the SQL editor only, see
--    docs/MODERATION.md). RLS forced, no privilege for anon / authenticated.
--  * mod_* functions: SECURITY DEFINER, search_path = '', EXECUTE granted to authenticated ONLY.
--    Every one of them first checks that auth.uid() is in public.moderateurs, otherwise it raises
--    an error (hint 'interdit'); mod_suis_je() is the only one that never raises.
--  * They reuse the 004 views and functions internally, and never return an e-mail address.
-- 001 to 005 are applied in production and are NOT modified.
-- Run after 005_publication_auto.sql. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------

create table if not exists public.moderateurs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  ajoute_le  timestamptz not null default now()
);

-- RLS with no policy, FORCE when the migrating role can bypass RLS (same rule as 002, DC-006).
do $$
declare
  v_bypass boolean;
begin
  select r.rolsuper or r.rolbypassrls into v_bypass
  from pg_catalog.pg_roles r
  where r.rolname = current_user;

  alter table public.moderateurs enable row level security;
  if coalesce(v_bypass, false) then
    alter table public.moderateurs force row level security;
  else
    raise notice 'Role % cannot bypass RLS: RLS enabled but not forced on public.moderateurs', current_user;
  end if;
end
$$;

revoke all on public.moderateurs from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Internal helper (not executable by anon / authenticated)
-- ---------------------------------------------------------------------

-- Raises 'interdit' unless the caller is a moderator.
create or replace function public.wp_exiger_moderateur()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.moderateurs m where m.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'Accès réservé aux modérateurs.', hint = 'interdit';
  end if;
  return v_uid;
end;
$fn$;
revoke all on function public.wp_exiger_moderateur() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Functions for site/moderation.html
-- ---------------------------------------------------------------------

-- Is the caller a moderator? Never raises (false for a visitor without session).
create or replace function public.mod_suis_je()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select auth.uid() is not null
     and exists (select 1 from public.moderateurs m where m.user_id = auth.uid());
$fn$;
revoke all on function public.mod_suis_je() from public, anon, authenticated;
grant execute on function public.mod_suis_je() to authenticated;

-- Queue "À relire": problems waiting for a human review (oldest first), from the 004 view.
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
             'id', v.id, 'cree_le', v.cree_le, 'categorie', v.categorie, 'titre', v.titre,
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

-- "Récents": problems published in the last p_heures hours (1 to 720, default 48), masked ones
-- included, newest first — to withdraw quickly what slipped through the automatic publication.
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
             'id', x.id, 'cree_le', x.cree_le, 'categorie', x.categorie, 'titre', x.titre,
             'texte', x.texte, 'montant', x.montant, 'statut', x.statut, 'masque', x.masque,
             'pseudo', x.pseudo, 'camp', x.camp, 'user_id', x.user_id, 'bloque', x.bloque,
             'nb_signalements', x.nb_signalements
           ) order by x.cree_le desc, x.id)
    from (
      select p.id, coalesce(p.modere_le, p.cree_le) as cree_le, p.categorie, p.titre, p.texte, p.montant,
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

-- "Masqués": every masked problem, comment or club message (newest first), from the 004 view.
create or replace function public.mod_masques()
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
             'cible_type', v.cible_type, 'cible_id', v.cible_id, 'contenu', v.contenu,
             'masque', true, 'masque_par', v.masque_par, 'nb_signalements', v.nb_signalements,
             'pseudo', v.pseudo, 'user_id', v.user_id, 'bloque', coalesce(pr.bloque, false),
             'statut', p.statut, 'cree_le', v.cree_le
           ) order by v.cree_le desc, v.cible_id)
    from (select * from public.moderation_masques order by cree_le desc limit 200) v
    left join public.profiles pr on pr.id = v.user_id
    left join public.problems p on v.cible_type = 'probleme' and p.id = v.cible_id
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.mod_masques() from public, anon, authenticated;
grant execute on function public.mod_masques() to authenticated;

-- "Signalés": content reported in the last 24 hours, most reported first, from the 004 view.
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
             'contenu', coalesce(p.titre || ' — ' || p.texte, s.contenu),
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

-- Publish / refuse / redirect a problem (or put it back to 'recu'), with moderer_probleme (004).
create or replace function public.mod_moderer_probleme(p_id uuid, p_statut text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_exiger_moderateur();  -- moderators only (raises 'interdit')
  perform public.moderer_probleme(p_id, p_statut);
  return jsonb_build_object('id', p_id, 'statut', p_statut);
end;
$fn$;
revoke all on function public.mod_moderer_probleme(uuid, text) from public, anon, authenticated;
grant execute on function public.mod_moderer_probleme(uuid, text) to authenticated;

-- Mask or restore a problem, a comment or a club message, with masquer_contenu (004).
-- p_type: 'probleme' | 'commentaire' | 'message' (English aliases accepted: 'problem',
-- 'comment', 'club_message'). p_masque null = mask.
create or replace function public.mod_masquer(p_type text, p_id uuid, p_masque boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_type text;
begin
  perform public.wp_exiger_moderateur();  -- moderators only (raises 'interdit')
  v_type := case p_type
              when 'problem' then 'probleme'
              when 'comment' then 'commentaire'
              when 'club_message' then 'message'
              else p_type
            end;
  perform public.masquer_contenu(v_type, p_id, coalesce(p_masque, true));
  return jsonb_build_object('cible_type', v_type, 'cible_id', p_id, 'masque', coalesce(p_masque, true));
end;
$fn$;
revoke all on function public.mod_masquer(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.mod_masquer(text, uuid, boolean) to authenticated;

-- Block (or unblock) a member, with bloquer_membre (004). A moderator cannot block themselves.
create or replace function public.mod_bloquer(p_user_id uuid, p_bloque boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform public.wp_exiger_moderateur();  -- moderators only (raises 'interdit')
  if p_user_id = auth.uid() then
    perform public.wp_erreur('invalide', 'Tu ne peux pas te bloquer toi-même.');
  end if;
  perform public.bloquer_membre(p_user_id, coalesce(p_bloque, true));
  return jsonb_build_object('user_id', p_user_id, 'bloque', coalesce(p_bloque, true));
end;
$fn$;
revoke all on function public.mod_bloquer(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mod_bloquer(uuid, boolean) to authenticated;
