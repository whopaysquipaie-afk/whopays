// Site configuration: the ONLY place for the site URL and keys. All public: NEVER put a secret here.

export const CONFIG = {
  // 'demo' (localStorage, no backend) | 'supabase' (docs/CONFIGURATION.md; ?demo=1 still works)
  MODE: 'supabase',
  SITE_URL: 'https://whopaysquipaie-afk.github.io/whopays/',
  REPO_URL: 'https://github.com/whopaysquipaie-afk/whopays',
  SUPABASE_URL: 'https://jitjbwlxwyeiqyruezkz.supabase.co',
  // PUBLIC key by design: security relies on RLS + RPC
  SUPABASE_PUBLIC_KEY: 'sb_publishable_LEP6wln2QlpHwK5xn1ZbXg_LXu0uVvG',
  // Turnstile SITE key (the secret goes into the Supabase dashboard only)
  TURNSTILE_SITE_KEY: '',
  // Support address (R-029: "Contacter le support" to become rich)
  SUPPORT_EMAIL: 'whopays.quipaie@gmail.com',
  // R-042: address of the Edge Function « partage » (link previews of a problem), e.g.
  // 'https://<projet>.supabase.co/functions/v1/partage'. Empty = share the plain p.html?id=… link.
  URL_PARTAGE: 'https://jitjbwlxwyeiqyruezkz.supabase.co/functions/v1/partage',
  // Cloudflare Web Analytics token (cookieless). Empty = no analytics.
  CF_ANALYTICS_TOKEN: ''
};

// ?demo=1: demo mode in THIS tab (sessionStorage flag) until ?demo=0 or "Quitter la démo" (demo-ui.js).
export const DEMO_FLAG = 'whopays_demo_a_la_demande';
export const MODE_CONFIGURE = CONFIG.MODE;

function lireDemo() {
  if (CONFIG.MODE === 'demo' || typeof location === 'undefined') return false;
  const param = new URLSearchParams(location.search).get('demo');
  try {
    if (param === '1') sessionStorage.setItem(DEMO_FLAG, '1');
    if (param === '0') sessionStorage.removeItem(DEMO_FLAG);
    return sessionStorage.getItem(DEMO_FLAG) === '1';
  } catch {
    return param === '1';
  }
}

export const demoALaDemande = lireDemo();
if (demoALaDemande) CONFIG.MODE = 'demo';

/** Host + path shown in the watermark, e.g. "whopaysquipaie-afk.github.io/whopays". */
export function siteLabel() {
  return CONFIG.SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Absolute URL of a page of the site, e.g. siteUrl('p.html?id=…'). */
export function siteUrl(path = '') {
  return CONFIG.SITE_URL + String(path).replace(/^\.?\//, '');
}
