// Referral: ?ref=CODE in the URL is remembered (localStorage) and sent with creer_profil().

import { siteUrl } from './config.js';

const KEY = 'whopays_ref';
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

/** Reads ?ref= from the URL, validates it and stores it. Then cleans the URL. */
export function memoriserRef() {
  try {
    const url = new URL(location.href);
    const ref = (url.searchParams.get('ref') || '').toUpperCase();
    if (ref && CODE_RE.test(ref)) localStorage.setItem(KEY, ref);
    if (url.searchParams.has('ref')) {
      url.searchParams.delete('ref');
      history.replaceState(null, '', url.pathname.split('/').pop() + url.search + url.hash);
    }
  } catch { /* storage unavailable */ }
}

export function lireRef() {
  try {
    const v = localStorage.getItem(KEY);
    return v && CODE_RE.test(v) ? v : null;
  } catch { return null; }
}

export function oublierRef() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Public referral link of a member. */
export function lienParrainage(code, page = '') {
  const sep = page.includes('?') ? '&' : '?';
  return siteUrl(`${page}${sep}ref=${encodeURIComponent(code)}`);
}
