# Changelog

All notable changes to this project are documented here.
Format inspired by [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- E-mail never attached to accounts created while e-mail sending was failing (anonymous auth user without `email` / `new_email`, address only in the profile): « Renvoyer l'e-mail de confirmation » now falls back to the profile address instead of answering « Aucune adresse e-mail à confirmer » without calling the server, and reports sending errors (« L'envoi a échoué, réessaie dans un instant ») instead of ignoring them. Pages also attach the profile address silently, once per browser session. If the address already belongs to another confirmed account, Mon espace says so and nothing is changed. The end-to-end test no longer attaches e-mails (SMTP is live: no mail to invented addresses).
- « Mon espace » on phones: the identity card is now mobile first (avatar + pseudo on one row, pseudo on two lines at most, buttons below at full width; former layout from 768 px), and the page no longer overflows horizontally at 360 px (grid tracks `minmax(0, 1fr)` instead of `auto`, which grew to the width of the referral link). Moderation buttons wrap instead of overflowing; the bottom banner reserves the iPhone home-bar area.

### Changed
- Problems of the poor (`008_plafond_pauvres.sql`): the amount is now required, a whole number from 1 to 10 000 € (« Un problème de pauvre ne dépasse jamais 10x Rien (10 000 €). »), and the limit goes from 3 to 10 problems per 24 h. The one example above the cap now asks for 9 000 €. Publish form: required amount field, `max=10000`, live conversion in Riens.
- JavaScript budget is now measured per page (entry module + everything it can import, dynamic imports included), still 150 KB, instead of the sum of every module of the site.
- Story card: the excerpt gets fewer lines when the title is long, so the author line never runs into the footer.
- Moderation page, restricted-access screen: a visitor without an account now gets a main « Rejoindre » button (the join dialog stays on the page, which refreshes once the account exists), with « Déjà membre ? Se connecter » as secondary; a member who is not a moderator sees their pseudo, their member id to copy and a hint to ask the administrator.
- Sensitive expressions, v2 (`007_mots_sensibles_v2.sql`): fewer false positives on a humour site. Ambiguous single words (`mourir`, `enceinte`, `abus`, `drogue(s)`, `frappe`) are replaced by explicit first-person expressions (`veux mourir`, `je suis enceinte`, `abuse de moi`, `je me drogue`, `il me frappe`…); `addiction`, `alcoolique`, `pensees suicidaires`, `idees noires` added. « Je vais mourir de rire » and « mon enceinte Bluetooth » are now published at once.
- Immediate publication (`005_publication_auto.sql`): a problem that passes the filters is published at once, so its author can share it within the second (« C'est en ligne ! » screen with share buttons and the story card). Problems containing a sensitive expression (distress, violence, serious illness, precariousness — table `mots_sensibles`) still wait for a human review. `reglages.publication_auto = false` switches back to full pre-moderation.
- Service worker: pages, JavaScript, CSS and the manifest are now network first (cache only offline); fonts and images stay stale-while-revalidate. The cache version is stamped with the commit SHA at deploy time, and an open page reloads once when a new version takes over: no more stale `config.js` after a deploy.
- The live site now runs on the real Supabase backend (`MODE: 'supabase'`). Without a Turnstile site key, anonymous sign-in and magic links are called without a captcha token.

### Added
- Leaderboard of the poor (`palmares.html`, « Le palmarès » in the navigation, `009_palmares.sql`): top 100 of the poor ranked by the total of their published, visible problems (tie-break: number of problems, then the oldest member), with a humorous podium and the signed-in member's line highlighted even outside the top 100. Mon espace (poor): « Mon total », « Ton rang : 42ᵉ sur 312 pauvres », « Voir le palmarès » and « Partager mon rang ». `get_palmares` / `get_mon_rang` expose only pseudo, camp, number of problems, total and rank.
- The « rien / Rien » unit (1 rien = 100 €, 1 Rien = 1 000 €): every amount is now shown with its value in Riens — wall cards (« 4 250 € recherchés · 4,25x Rien »), problem page (« Pour un riche, ça vaut 4,25x Rien »), story card, « Les chiffres » total and a live conversion under the amount field of the publish form. Pure function `enRiens()` in `riens.js`, unit-tested.
- Mobile moderation page (`moderation.html`, linked from nowhere, `noindex`, never cached): four tabs (to review · published in the last 48 h · reported · masked) with thumb-sized buttons to publish, refuse, redirect, mask / restore and block the author. Backed by `006_moderateurs.sql`: table `moderateurs` and `mod_*` functions that refuse anyone who is not a moderator (no execute right for `anon`) and never return an e-mail address. Simulated in demo mode.
- Demo on demand: `?demo=1` switches the current tab to demo mode (no call to Supabase), with a "Quitter la démo" link and `demo=1` kept in internal links; "Essayer la démo" link in the footer.
- `tools/e2e-supabase.mjs`: end-to-end test against the real Supabase project (join rich/poor, publish, react, comment, report, club isolation, my space, camp switch, account deletion), every test account deleted at the end.

## [0.1.0] — 2026-11-20

First public prototype.

### Added
- Home: live counters, Rich vs Poor match with tug-of-war bar, category tiles, wall of problems with filters and pagination.
- Join a camp in 10 seconds (anonymous session + non-blocking e-mail confirmation), magic-link reconnect, referral links.
- Publish a problem, with instant client-side filter feedback.
- Problem page: reactions, comments (delete / hide / report), reports with auto-masking at 3, share buttons, 1080×1920 story card, watermark.
- One club per camp (group chat refreshed every 4 s, camp isolation enforced in SQL).
- "Les chiffres" page, random problem, my space (camp switch, my problems, referral, rich wishes, newsletter, account deletion).
- Installable app (manifest, service worker caching static files only), help page, 404.
- Full demo mode (localStorage) with 60 fictional members; API contract test suite (Node + browser).
- Supabase: schema, RLS lockdown with zero direct grants, 20 SECURITY DEFINER RPC functions, moderation views and functions, seeds, SQL security test script.
- Tooling: static checks (syntax, unsafe DOM, absolute links, CSP, secrets in files and Git history, assets, JS budget), SVG brand generator, Open Graph URL sync, font wiring.
- Docs: README (EN/FR), architecture, configuration, moderation, roadmap.
