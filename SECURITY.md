# Security policy

This repository is public and the site handles real e-mail addresses. Security is not a joke here.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository.

Include the page or SQL function concerned, the steps to reproduce and the impact. You will get an answer within 7 days.

## What is in scope

- Reading data you should not see (e-mails, unpublished problems, the other camp's club, masked content)
- Writing data you should not write (choosing a problem's status, skipping the review of sensitive problems, bypassing filters or rate limits, acting as a blocked member)
- Script injection (XSS) on any page
- A secret committed to the repository or its history

## How the project is protected

- **Row Level Security** on every table, with **no direct grant** to `anon` or `authenticated`.
- Every read and write goes through `SECURITY DEFINER` RPC functions with an empty `search_path`.
- Server-side content filters (banned words, phone numbers, IBANs, e-mails, links) and per-member rate limits.
- Cloudflare Turnstile on anonymous sign-in and magic links.
- No `innerHTML` with user content; strict Content Security Policy on every page.
- `gitleaks` runs on every push and pull request; `tools/verif.mjs` scans the whole Git history.

## Keys

Only the Supabase **public** key (publishable / anon) and the Turnstile **site** key may appear in `site/assets/js/config.js`. They are public by design. The `service_role` key and every secret key live only in the Supabase and Cloudflare dashboards.
