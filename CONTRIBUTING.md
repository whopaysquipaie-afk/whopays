# Contributing to Who pays? / Qui paie ?

Thanks for wanting to help! This project is a joke with serious engineering. Please keep both.

## Ground rules

1. **No money, ever.** No payment, no donation link, no "collected" amount, no progress bar.
2. **No private messages** between members. Clubs are group rooms, one per camp.
3. **No build step, no framework, no npm dependency.** Plain HTML, CSS and ES modules.
4. **Security first:** never use `innerHTML` with user or database content, never commit a secret, all data access goes through Supabase RPC functions.
5. **Relative links only.** The site lives under `/whopays/`. The public URL comes from `CONFIG.SITE_URL`.
6. UI copy is **French**; code identifiers and commit messages are **English**.

## Run it locally (demo mode, no backend)

```bash
git clone https://github.com/whopaysquipaie-afk/whopays.git
cd whopays
python -m http.server 8080 --directory site
# open http://localhost:8080/
```

Demo mode stores fake data in your browser (`localStorage`). Click "Réinitialiser" in the demo banner to start over.

## Before opening a pull request

```bash
node tools/test.mjs    # API contract tests (demo mode)
node tools/verif.mjs   # static checks: syntax, innerHTML, links, CSP, secrets
```

Both must be green. Then open `site/tests.html` in a browser for the same suite in real conditions.

## Commit messages

`feat: …` · `fix: …` · `docs: …` · `test: …` · `chore: …` · `security: …`

## Good first issues

See [docs/ROADMAP.md](docs/ROADMAP.md#good-first-issues).

## Code of conduct

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
