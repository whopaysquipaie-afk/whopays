-- =====================================================================
-- Qui paie ? / Who pays? — 004: moderation helpers for Supabase Studio
-- Views and functions used by the moderator in the SQL editor / Table editor (see docs/MODERATION.md).
-- NOTHING here is exposed to the site: no grant to anon or authenticated, views are
-- security_invoker (they run with the rights of the caller, and the caller must be the
-- moderator's role, e.g. postgres).
-- Run after 003_fonctions.sql. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Views
-- ---------------------------------------------------------------------

-- Problems waiting for moderation (oldest first), with the author's pseudo and e-mail.
create or replace view public.moderation_a_relire
with (security_invoker = true) as
select
  p.id,
  p.cree_le,
  p.categorie,
  p.titre,
  p.texte,
  p.montant,
  pr.pseudo,
  pr.email,
  pr.camp,
  pr.bloque,
  (select count(*) from public.problems p2 where p2.user_id = p.user_id and p2.statut = 'publie') as auteur_nb_publies,
  (select count(*) from public.reports r
    where r.user_id = p.user_id and r.cree_le > now() - interval '24 hours') as auteur_signalements_24h
from public.problems p
left join public.profiles pr on pr.id = p.user_id
where p.statut = 'recu'
order by p.cree_le;

-- Every masked item (automatically at 3 reports, by the problem's author, or by the moderator).
create or replace view public.moderation_masques
with (security_invoker = true) as
select
  'probleme'::text as cible_type,
  p.id             as cible_id,
  p.titre || ' — ' || p.texte as contenu,
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
    (select p.titre from public.problems p where r.cible_type = 'probleme' and p.id = r.cible_id),
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

-- Reports of the last 24 hours, grouped by reporter (spot members who report everything).
create or replace view public.moderation_signaleurs_24h
with (security_invoker = true) as
select
  r.user_id,
  pr.pseudo,
  pr.email,
  pr.bloque,
  count(*)       as nb_signalements,
  max(r.cree_le) as dernier
from public.reports r
left join public.profiles pr on pr.id = r.user_id
where r.cree_le > now() - interval '24 hours'
group by r.user_id, pr.pseudo, pr.email, pr.bloque
order by count(*) desc;

-- Authors whose content was reported in the last 24 hours (spot abusive members to block).
create or replace view public.moderation_auteurs_signales_24h
with (security_invoker = true) as
select
  s.auteur_id   as user_id,
  pr.pseudo,
  pr.email,
  pr.bloque,
  count(*)      as nb_contenus_signales,
  sum(s.nb_signalements) as nb_signalements
from public.moderation_signalements_24h s
left join public.profiles pr on pr.id = s.auteur_id
where s.auteur_id is not null
group by s.auteur_id, pr.pseudo, pr.email, pr.bloque
order by sum(s.nb_signalements) desc;

-- Newsletter export: ONLY members who said yes.
create or replace view public.moderation_newsletter
with (security_invoker = true) as
select pr.pseudo, pr.email, pr.camp, pr.cree_le
from public.profiles pr
where pr.newsletter and not pr.bloque
order by pr.cree_le;

revoke all on public.moderation_a_relire              from public, anon, authenticated;
revoke all on public.moderation_masques               from public, anon, authenticated;
revoke all on public.moderation_signalements_24h      from public, anon, authenticated;
revoke all on public.moderation_signaleurs_24h        from public, anon, authenticated;
revoke all on public.moderation_auteurs_signales_24h  from public, anon, authenticated;
revoke all on public.moderation_newsletter            from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Functions (run them in the SQL editor, e.g. select public.moderer_probleme('<id>', 'publie');)
-- ---------------------------------------------------------------------

-- Moderates a problem: 'publie', 'refuse', 'reoriente' (or back to 'recu'). Sets modere_le.
create or replace function public.moderer_probleme(p_id uuid, p_statut text)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  if p_statut is null or p_statut not in ('recu', 'publie', 'refuse', 'reoriente') then
    raise exception using errcode = 'P0001', message = 'Statut inconnu (recu, publie, refuse, reoriente).', hint = 'invalide';
  end if;
  update public.problems p
  set statut = p_statut,
      modere_le = case when p_statut = 'recu' then null else now() end
  where p.id = p_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'Ce problème est introuvable.', hint = 'introuvable';
  end if;
  return true;
end;
$fn$;

-- Masks or restores a problem, a comment or a club message.
create or replace function public.masquer_contenu(p_cible_type text, p_cible_id uuid, p_valeur boolean default true)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  if p_cible_type = 'probleme' then
    update public.problems p set masque = p_valeur where p.id = p_cible_id;
  elsif p_cible_type = 'commentaire' then
    update public.comments c
    set masque = p_valeur, masque_par = case when p_valeur then 'admin' else null end
    where c.id = p_cible_id;
  elsif p_cible_type = 'message' then
    update public.club_messages m set masque = p_valeur where m.id = p_cible_id;
  else
    raise exception using errcode = 'P0001', message = 'Type de contenu inconnu.', hint = 'invalide';
  end if;
  if not found then
    raise exception using errcode = 'P0001', message = 'Contenu introuvable.', hint = 'introuvable';
  end if;
  return true;
end;
$fn$;

-- Blocks (or unblocks) a member: no more writes at all.
create or replace function public.bloquer_membre(p_id uuid, p_valeur boolean default true)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  update public.profiles pr set bloque = coalesce(p_valeur, true) where pr.id = p_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'Membre introuvable.', hint = 'introuvable';
  end if;
  return true;
end;
$fn$;

-- Marks a member as a verified billionaire (idempotent).
create or replace function public.verifier_milliardaire(p_id uuid)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.profiles pr where pr.id = p_id) then
    raise exception using errcode = 'P0001', message = 'Membre introuvable.', hint = 'introuvable';
  end if;
  insert into public.verifications (user_id, verifie_le)
  values (p_id, now())
  on conflict (user_id) do nothing;
  return true;
end;
$fn$;

-- Monthly cleanup: deletes problems 'refuse' / 'reoriente' moderated more than 90 days ago
-- (their reactions and comments go with them), and reports about content that no longer exists.
-- Returns the number of problems deleted.
create or replace function public.purger_anciens_refus()
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_nb integer;
begin
  delete from public.problems p
  where p.statut in ('refuse', 'reoriente')
    and coalesce(p.modere_le, p.cree_le) < now() - interval '90 days';
  get diagnostics v_nb = row_count;

  delete from public.reports r
  where (r.cible_type = 'probleme'
         and not exists (select 1 from public.problems p where p.id = r.cible_id))
     or (r.cible_type = 'commentaire'
         and not exists (select 1 from public.comments c where c.id = r.cible_id))
     or (r.cible_type = 'message'
         and not exists (select 1 from public.club_messages m where m.id = r.cible_id));
  return v_nb;
end;
$fn$;

revoke all on function public.moderer_probleme(uuid, text)               from public, anon, authenticated;
revoke all on function public.masquer_contenu(text, uuid, boolean)       from public, anon, authenticated;
revoke all on function public.bloquer_membre(uuid, boolean)              from public, anon, authenticated;
revoke all on function public.verifier_milliardaire(uuid)                from public, anon, authenticated;
revoke all on function public.purger_anciens_refus()                     from public, anon, authenticated;
