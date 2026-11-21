// R-047: « Suivre » / « Suivi ✓ » (by share code), follower counts, « Les plus suivis ».
// Shown only when the data carries the follow fields (migration 019 applied).

import { api } from './api.js';
import { h, formatNumber, toast, toastError } from './ui.js';
import { exigerMembre } from './page.js';
import { lienProfil } from './carte.js';

/** « 1 abonné », « 128 abonnés », « 0 abonné ». */
export const libelleAbonnes = (n) => `${formatNumber(n || 0)} abonné${(n || 0) > 1 ? 's' : ''}`;

/**
 * Follow button. etat = { code, je_suis, abonnes, pseudo }; onChange(abonnes) after each change.
 * A visitor gets the « Rejoindre » dialog, then the follow runs.
 */
export function boutonSuivre(etat, { onChange = () => {}, petit = false } = {}) {
  let suivi = !!etat.je_suis;
  const b = h('button', { type: 'button', class: `btn ${petit ? 'btn-petit ' : ''}btn-suivre` });
  const rendre = () => {
    b.textContent = suivi ? 'Suivi ✓' : 'Suivre';
    b.setAttribute('aria-pressed', String(suivi));
    b.setAttribute('aria-label', suivi ? `Ne plus suivre ${etat.pseudo}` : `Suivre ${etat.pseudo}`);
  };
  rendre();
  b.addEventListener('click', () => exigerMembre(async () => {
    b.setAttribute('aria-busy', 'true');
    try {
      const r = suivi ? await api.nePlusSuivre(etat.code) : await api.suivre(etat.code);
      suivi = r.suivi;
      rendre();
      onChange(r.abonnes);
      if (suivi) toast(`Tu suis ${etat.pseudo}. Tu seras prévenu de ses prochains problèmes.`);
    } catch (e) { toastError(e); } finally { b.removeAttribute('aria-busy'); }
  }, { raison: `Rejoins un camp pour suivre ${etat.pseudo}. Ça prend 10 secondes.` }));
  return b;
}

/** List « Les plus suivis » (top N of a camp), or null when empty. */
export function listePlusSuivis(lignes, { titre, max = 10 } = {}) {
  if (!lignes || !lignes.length) return null;
  return h('div', { class: 'plus-suivis' },
    titre ? h('h3', {}, titre) : null,
    h('ol', {}, lignes.slice(0, max).map((l) => h('li', {},
      h('a', { class: 'lien-profil', href: lienProfil(l.code) }, l.pseudo),
      h('span', { class: 'gris petit' }, ` · ${libelleAbonnes(l.abonnes)}`)))));
}
