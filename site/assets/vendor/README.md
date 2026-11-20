# Vendor

Third-party files copied as-is (no CDN, no npm install).

| File | What | Version | License |
|---|---|---|---|
| `supabase.js` | `@supabase/supabase-js`, official UMD build from npm (`dist/umd/supabase.js`) | **2.119.2** | MIT — `supabase-js-LICENSE.txt` |

Only needed when `CONFIG.MODE = 'supabase'`. In demo mode it is never loaded.

To update: download the UMD build of the wanted version from the npm package
(`@supabase/supabase-js/dist/umd/supabase.js`), replace `supabase.js`, update the version above,
keep `supabase-js-LICENSE.txt`, then bump `VERSION` in `site/sw.js`. See also `docs/CONFIGURATION.md`, step "supabase-js".

## Fonts

The self-hosted fonts live in `../fonts/` (static instances, Latin subset, from the official
Google Fonts repository), under the SIL Open Font License 1.1: `OFL-Montserrat.txt`, `OFL-Inter.txt`.
They are wired into `style.css` and the pages by `node tools/polices.mjs`.
