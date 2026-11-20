// R-031: « 🚨 Un nouveau riche vient d'arriver : <pseudo>. » for 72 h, on top of the home page and of the wall.
// get_annonces() returns pseudo + link only (a relative link built by the database).

import { api } from './api.js';
import { h } from './ui.js';

function bandeau(a) {
  const versPublication = /^p\.html\?id=/.test(a.lien);
  return h('p', { class: 'annonce-riche', role: 'status' },
    h('span', { 'aria-hidden': 'true' }, '🚨 '),
    'Un nouveau riche vient d’arriver : ', h('strong', {}, a.pseudo), '. ',
    h('a', { href: a.lien }, versPublication ? 'Va voir sa première publication.' : 'Va voir les publications de riches.'));
}

/** Fills each container with the current announcements (nothing when there is none). */
export async function afficherAnnonces(conteneurs) {
  let liste = [];
  try { liste = await api.getAnnonces(); } catch { return; }
  if (!liste.length) return;
  for (const c of conteneurs) {
    if (!c) continue;
    c.replaceChildren(...liste.slice(0, 2).map(bandeau));
    c.hidden = false;
  }
}
