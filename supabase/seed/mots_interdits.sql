-- =====================================================================
-- Qui paie ? / Who pays? — seed: starter list of banned words
-- Same list as MOTS_INTERDITS_DEFAUT in site/assets/js/filtres.js, already normalized
-- (lowercase, no accents). Edit the table public.mots_interdits in Supabase Studio afterwards.
-- Idempotent.
-- =====================================================================

insert into public.mots_interdits (mot) values
  ('connard'),
  ('connasse'),
  ('conasse'),
  ('salope'),
  ('salaud'),
  ('encule'),
  ('enculee'),
  ('enculer'),
  ('pute'),
  ('putain de ta mere'),
  ('batard'),
  ('batarde'),
  ('fdp'),
  ('fils de pute'),
  ('ntm'),
  ('nique ta mere'),
  ('niquer'),
  ('tg'),
  ('ta gueule'),
  ('pd'),
  ('pede'),
  ('tapette'),
  ('gouine'),
  ('negre'),
  ('negro'),
  ('bougnoule'),
  ('bougnoul'),
  ('youpin'),
  ('bicot'),
  ('chinetoque'),
  ('pouffiasse'),
  ('grognasse'),
  ('sale arabe'),
  ('sale noir'),
  ('sale juif'),
  ('sale blanc'),
  ('heil hitler'),
  ('suicide toi'),
  ('va crever'),
  ('va te pendre')
on conflict (mot) do nothing;
