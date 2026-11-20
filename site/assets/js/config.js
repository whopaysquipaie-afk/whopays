// Site configuration — the ONLY place where the site URL and public keys live.
// Every value below is public by design. NEVER put a secret here
// (no Supabase secret/admin key, no Turnstile secret key, no Brevo key).

export const CONFIG = {
  // 'demo'     → fake data stored in the browser (localStorage), no backend needed
  // 'supabase' → real backend (fill the three values below first, see docs/CONFIGURATION.md)
  MODE: 'demo',

  // Public URL of the site (used for share links, watermark, story card, manifest checks).
  SITE_URL: 'https://whopaysquipaie-afk.github.io/whopays/',

  // Source code repository (footer link "Code source").
  REPO_URL: 'https://github.com/whopaysquipaie-afk/whopays',

  // Supabase project URL
  SUPABASE_URL: 'https://jitjbwlxwyeiqyruezkz.supabase.co',

  // Supabase PUBLIC key ("publishable" or "anon"). Public by design: security relies on RLS + RPC.
  SUPABASE_PUBLIC_KEY: 'sb_publishable_LEP6wln2QlpHwK5xn1ZbXg_LXu0uVvG',

  // Cloudflare Turnstile SITE key (public). The secret key goes into the Supabase dashboard only.
  TURNSTILE_SITE_KEY: '',

  // Cloudflare Web Analytics token (public, cookieless). Empty = no analytics.
  CF_ANALYTICS_TOKEN: ''
};

/** Host + path shown in the watermark, e.g. "whopaysquipaie-afk.github.io/whopays". */
export function siteLabel() {
  return CONFIG.SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Absolute URL of a page of the site, e.g. siteUrl('p.html?id=…'). */
export function siteUrl(path = '') {
  return CONFIG.SITE_URL + String(path).replace(/^\.?\//, '');
}
