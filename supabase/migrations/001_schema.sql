-- =====================================================================
-- Qui paie ? / Who pays? — 001: schema
-- Run in the Supabase SQL editor, in order: 001, 002, 003, 004, then seeds.
-- Idempotent: safe to run again (tables and indexes are created only if missing).
-- No direct access is ever granted on these tables: see 002_securite.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles — one member (id = auth.users.id)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  pseudo              text not null check (char_length(pseudo) between 2 and 30),
  email               text not null check (
                        char_length(email) <= 254
                        and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
                      ),
  camp                text not null check (camp in ('riche', 'pauvre')),
  newsletter          boolean not null default false,
  riche_message       text check (riche_message is null or char_length(riche_message) <= 500),
  riche_montant       integer check (riche_montant is null or riche_montant between 0 and 10000000),
  code_partage        text not null unique check (code_partage ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  -- Referral: the referrer leaving must not delete the members they invited.
  invite_par          uuid references public.profiles (id) on delete set null,
  regles_acceptees_le timestamptz not null default now(),
  bloque              boolean not null default false,
  cree_le             timestamptz not null default now(),
  constraint profiles_invite_par_pas_soi check (invite_par is null or invite_par <> id)
);

-- ---------------------------------------------------------------------
-- problems
-- ---------------------------------------------------------------------
create table if not exists public.problems (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete cascade,
  categorie   text not null check (categorie in (
                'reve', 'factures', 'coup-de-pouce', 'amour', 'famille',
                'patron', 'projet', 'quotidien', 'plaisir', 'defi'
              )),
  titre       text not null,
  texte       text not null check (char_length(texte) between 10 and 600),
  montant     integer check (montant is null or montant between 0 and 1000000),
  statut      text not null default 'recu' check (statut in ('recu', 'publie', 'refuse', 'reoriente')),
  est_exemple boolean not null default false,
  masque      boolean not null default false,
  cree_le     timestamptz not null default now(),
  modere_le   timestamptz,
  -- user_id may be null only for the team's example problems
  constraint problems_auteur_ou_exemple check (user_id is not null or est_exemple),
  -- Members: 3 to 80 characters (also enforced by soumettre_probleme).
  -- Team examples may be slightly longer (one seeded example title has 83 characters).
  constraint problems_titre_longueur check (
    char_length(titre) between 3 and (case when est_exemple then 120 else 80 end)
  )
);

-- ---------------------------------------------------------------------
-- reactions
-- ---------------------------------------------------------------------
create table if not exists public.reactions (
  problem_id uuid not null references public.problems (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in ('rire', 'courage', 'paierais')),
  cree_le    timestamptz not null default now(),
  primary key (problem_id, user_id, type)
);

-- ---------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  texte      text not null check (char_length(texte) between 1 and 300),
  masque     boolean not null default false,
  masque_par text check (masque_par is null or masque_par in ('signalements', 'auteur_probleme', 'admin')),
  cree_le    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- club_messages
-- ---------------------------------------------------------------------
create table if not exists public.club_messages (
  id      uuid primary key default gen_random_uuid(),
  camp    text not null check (camp in ('riche', 'pauvre')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  texte   text not null check (char_length(texte) between 1 and 300),
  masque  boolean not null default false,
  cree_le timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- reports (signalements)
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  cible_type text not null check (cible_type in ('probleme', 'commentaire', 'message')),
  cible_id   uuid not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  cree_le    timestamptz not null default now(),
  constraint reports_un_par_membre unique (cible_type, cible_id, user_id)
);

-- ---------------------------------------------------------------------
-- verifications — verified billionaires (filled in Supabase Studio only)
-- ---------------------------------------------------------------------
create table if not exists public.verifications (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  verifie_le timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- mots_interdits — banned words, stored normalized (lowercase, no accents)
-- ---------------------------------------------------------------------
create table if not exists public.mots_interdits (
  mot text primary key check (char_length(btrim(mot)) > 0)
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
-- Public wall: published, visible problems sorted by display date (coalesce(modere_le, cree_le))
create index if not exists problems_publics_date_idx
  on public.problems ((coalesce(modere_le, cree_le)) desc)
  where statut = 'publie' and not masque;
create index if not exists problems_publics_categorie_idx
  on public.problems (categorie, (coalesce(modere_le, cree_le)) desc)
  where statut = 'publie' and not masque;
-- Moderation queue and statistics
create index if not exists problems_statut_idx on public.problems (statut, masque, cree_le);
-- Rate limit (3 per 24 h) and "Mon espace"
create index if not exists problems_user_date_idx on public.problems (user_id, cree_le);

-- Counts per problem (the primary key starts with problem_id) and "my reactions"
create index if not exists reactions_user_idx on public.reactions (user_id, problem_id);

create index if not exists comments_problem_date_idx on public.comments (problem_id, cree_le desc);
create index if not exists comments_user_date_idx on public.comments (user_id, cree_le);

create index if not exists club_messages_camp_date_idx on public.club_messages (camp, cree_le);
create index if not exists club_messages_user_date_idx on public.club_messages (user_id, cree_le);

create index if not exists reports_user_date_idx on public.reports (user_id, cree_le);
create index if not exists reports_date_idx on public.reports (cree_le);

create index if not exists profiles_invite_par_idx on public.profiles (invite_par);
create index if not exists profiles_email_idx on public.profiles (lower(email));
