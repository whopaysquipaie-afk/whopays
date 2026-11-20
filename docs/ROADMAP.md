# Roadmap

> Rule zero, forever: **no money is ever collected or transferred through this project.**

## ✅ V0 — shipped

- Home with live counters, Rich vs Poor match, category tiles, wall of problems
- Join a camp in 10 seconds (no password), magic-link reconnect, referral links
- Problem page: reactions, comments, reports, share buttons, downloadable story card, watermark
- One private club per camp (group chat, no private messages)
- "Les chiffres": € of problems waiting for a billionaire, 0 € funded
- My space: camp switch, my problems, referral, account deletion
- Installable app (manifest + service worker), demo mode, contract tests, security tests

## 🌊 Wave 2 (1–2 weeks after launch, depending on the numbers)

- **Live feed** of new problems and reactions (Supabase Realtime instead of 4 s polling)
- **Badges & levels** (first problem, 100 laughs received, top referrer…)
- **Leaderboards**: most laughed-at problem of the week, most active camp
- **In-site notifications** (your problem is published, someone commented)
- **Favorites**
- **Public profiles** (pseudo, camp, published problems — never the e-mail)
- **Search and sorting** on the wall (newest, most laughs, most "I'd pay")
- **Challenge of the week** (a theme, the best problems featured)

## 🧩 Options

- Google sign-in
- "Rich questionnaire" (what kind of problems would you fund — for fun)
- English version of the site (the README already is)
- Mobile admin dashboard for moderation

## 🚫 Out of scope (on purpose)

Payments · private messages · putting people in touch · custom domain · per-problem link preview images.

## Good first issues

Small, self-contained tasks to get into the codebase. Run `sh tools/check.sh` before opening a PR.

1. **Keyboard shortcut** on the wall: `R` opens a random problem (`page.js` → `allerAuHasard`). Respect inputs and dialogs.
2. **Empty states**: add 3 more funny empty-state lines in `site/assets/js/mur.js` (`VIDES`).
3. **Relative dates**: unit-test `formatDate()` (`ui.js`) — extract it to a DOM-free module and add tests to `tests/contrat.js`.
4. **Story card**: add an option to choose the background (black / lemon / lavender) in `story.js`.
5. **Accessibility**: announce the result of a reaction to screen readers (`aria-live` region in `reactions.js`).
6. **Share text**: add Telegram and Bluesky to `partage.js` (`liensReseaux`).
7. **Banned words**: propose additions to `filtres.js` *and* `supabase/seed/mots_interdits.sql` with a test case each.
8. **Club**: show "N new messages ↓" when new messages arrive while the user has scrolled up (`club.js`).
9. **Demo data**: write 10 new funny fictional problems in `demo-data.js` (they must pass the filters — the test suite checks it).
10. **Docs**: translate `docs/MODERATION.md` to English (`docs/MODERATION.en.md`).
