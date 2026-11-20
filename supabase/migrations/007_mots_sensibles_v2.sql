-- =====================================================================
-- Qui paie ? / Who pays? — 007: sensitive expressions, v2 (R-020)
-- Fewer false positives on a humour site. Single words that are far more often harmless than
-- alarming are replaced by explicit first-person expressions:
--   "mourir"  ("mort de rire", "mourir de honte")  -> "veux mourir" ("envie de mourir" is kept)
--   "enceinte" (Bluetooth speaker)                  -> "je suis enceinte", "tomber enceinte"
--   "abus"    ("abus de pouvoir")                   -> "abuse de moi" ("abus sexuel" is kept)
--   "drogue", "drogues" ("drogué au café")          -> "me drogue", "je me drogue", "addiction"
--   "frappe"  ("frappe à la porte")                 -> "il/elle/on me frappe" ("me frappe" is kept)
-- Also added: "vais me tuer", "alcoolique", "pensees suicidaires", "idees noires".
-- 005 is applied in production and is NOT modified. Run after 005_publication_auto.sql
-- (and again if 005 is ever replayed: its seed would bring the removed words back). Idempotent.
-- Same list as MOTS_SENSIBLES_DEFAUT in site/assets/js/mots-sensibles.js (checked by tools/verif.mjs).
-- =====================================================================

delete from public.mots_sensibles
where mot in ('mourir', 'enceinte', 'abus', 'drogue', 'drogues', 'frappe');

insert into public.mots_sensibles (mot) values
  ('veux mourir'), ('vais me tuer'), ('il me frappe'), ('elle me frappe'), ('on me frappe'),
  ('je suis enceinte'), ('tomber enceinte'), ('abuse de moi'), ('me drogue'), ('je me drogue'),
  ('addiction'), ('alcoolique'), ('pensees suicidaires'), ('idees noires')
on conflict (mot) do nothing;
