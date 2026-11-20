# Fonts

Self-hosted fonts (no Google Fonts call). Both are under the SIL Open Font License 1.1.

Files present (woff2, static instances, Latin subset, from the official Google Fonts repository).
Licenses: `OFL-Montserrat.txt`, `OFL-Inter.txt`.

| File | Font | Weight / style |
|---|---|---|
| `Montserrat-BlackItalic.woff2` | Montserrat | 900 italic — H1, logo-like titles |
| `Montserrat-ExtraBold.woff2` | Montserrat | 800 — section titles |
| `Montserrat-BoldItalic.woff2` | Montserrat | 700 italic — card titles |
| `Inter-Regular.woff2` | Inter | 400 — body text |
| `Inter-SemiBold.woff2` | Inter | 600 — buttons, labels |

If a file is missing, the site falls back to system fonts (`Segoe UI Black`, `Arial Black`, `system-ui`) and the CSS only references `local()` fonts, so the console stays clean.

**After adding or removing a file, run `node tools/polices.mjs`**: it adds the `url()` sources to `style.css` and the `<link rel="preload">` tags to every page.
Sources: Montserrat (github.com/JulietaUla/Montserrat), Inter (github.com/rsms/inter).
