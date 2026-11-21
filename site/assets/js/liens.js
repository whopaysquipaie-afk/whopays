// Share links of a problem (pure, no DOM, unit-tested in Node).
// R-042: when CONFIG.URL_PARTAGE is set (Edge Function « partage »), every share button of a problem uses it,
// so that WhatsApp, X, Facebook… show the title of the problem and the image of its category;
// otherwise the plain page p.html?id=… (previous behaviour).

import { CONFIG, siteUrl } from './config.js';

export function urlProbleme(id, codeRef = null, { urlPartage = CONFIG.URL_PARTAGE } = {}) {
  const ref = codeRef ? `&ref=${encodeURIComponent(codeRef)}` : '';
  const base = String(urlPartage || '').trim();
  if (/^https:\/\/[^\s?#]+$/.test(base)) return `${base}?id=${encodeURIComponent(id)}${ref}`;
  return siteUrl(`p.html?id=${encodeURIComponent(id)}${ref}`);
}
