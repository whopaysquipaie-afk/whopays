# Changelog

All notable changes to this project are documented here.
Format inspired by [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- The live site now runs on the real Supabase backend (`MODE: 'supabase'`). Without a Turnstile site key, anonymous sign-in and magic links are called without a captcha token.

### Added
- Demo on demand: `?demo=1` switches the current tab to demo mode (no call to Supabase), with a "Quitter la démo" link and `demo=1` kept in internal links; "Essayer la démo" link in the footer.
- `tools/e2e-supabase.mjs`: end-to-end test against the real Supabase project (join rich/poor, publish, react, comment, report, club isolation, my space, camp switch, account deletion), every test account deleted at the end.

## [0.1.0] — 2026-11-20

First public prototype.

### Added
- Home: live counters, Rich vs Poor match with tug-of-war bar, category tiles, wall of problems with filters and pagination.
- Join a camp in 10 seconds (anonymous session + non-blocking e-mail confirmation), magic-link reconnect, referral links.
- Publish a problem (moderated before publication), with instant client-side filter feedback.
- Problem page: reactions, comments (delete / hide / report), reports with auto-masking at 3, share buttons, 1080×1920 story card, watermark.
- One club per camp (group chat refreshed every 4 s, camp isolation enforced in SQL).
- "Les chiffres" page, random problem, my space (camp switch, my problems, referral, rich wishes, newsletter, account deletion).
- Installable app (manifest, service worker caching static files only), help page, 404.
- Full demo mode (localStorage) with 60 fictional members; API contract test suite (Node + browser).
- Supabase: schema, RLS lockdown with zero direct grants, 20 SECURITY DEFINER RPC functions, moderation views and functions, seeds, SQL security test script.
- Tooling: static checks (syntax, unsafe DOM, absolute links, CSP, secrets in files and Git history, assets, JS budget), SVG brand generator, Open Graph URL sync, font wiring.
- Docs: README (EN/FR), architecture, configuration, moderation, roadmap.
