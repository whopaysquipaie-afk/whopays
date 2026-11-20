// Home page (index.html): live counters, Rich vs Poor match, category tiles, wall.
import { api } from '../api.js';
import { initPage } from '../page.js';
import { $, $$, h, formatNumber } from '../ui.js';
import { icon } from '../icons.js';
import { CATEGORIES, HOME_TILES, category } from '../categories.js';
import { countUp, countUpWhenVisible } from '../animations.js';
import { initMur } from '../mur.js';
import { afficherAnnonces } from '../annonces.js';
import { badgeCamp, filigrane } from '../carte.js';
import { montantAffiche } from '../riens.js';

await initPage('accueil');

/* ---------- Counters & match ---------- */
async function chargerCompteurs() {
  try {
    const c = await api.getCompteurs();
    for (const el of $$('[data-compteur]')) {
      const v = c[el.dataset.compteur];
      if (v === undefined) continue;
      if (el.closest('.match')) countUpWhenVisible(el, v);
      else countUp(el, v);
    }
    const lib = $('[data-libelle="milliardaires"]');
    if (lib) lib.textContent = c.milliardaires_verifies > 1 ? 'milliardaires vérifiés' : 'milliardaire vérifié';
    const total = c.riches + c.pauvres;
    const partRiche = total ? Math.round((c.riches / total) * 1000) / 10 : 50;
    const barre = $('#rapport .part-riche');
    if (barre) {
      // Leave a visible sliver even when one camp is tiny
      barre.style.width = `${Math.max(2, Math.min(98, partRiche))}%`;
    }
    const lr = $('[data-part="riche"]');
    const lp = $('[data-part="pauvre"]');
    if (lr) lr.textContent = `Riches ${formatNumber(partRiche)} %`;
    if (lp) lp.textContent = `Pauvres ${formatNumber(Math.round((100 - partRiche) * 10) / 10)} %`;
    const rapport = $('#rapport .rapport-barre');
    if (rapport) rapport.setAttribute('aria-label', `Rapport de force : ${formatNumber(c.riches)} riches contre ${formatNumber(c.pauvres)} pauvres`);
  } catch {
    // Counters are decorative: the page stays usable.
  }
}
chargerCompteurs();
setInterval(() => { if (document.visibilityState === 'visible') chargerCompteurs(); }, 60000);

/* ---------- Hero card: « Le problème du moment » (R-034) ---------- */
// Loaded from the database; the static card of index.html stays as a fallback if the call fails.
async function chargerProblemeDuMoment() {
  const statique = $('.hero-visuel .carte-hero');
  if (!statique) return;
  let p = null;
  try { p = await api.getProblemeDuMoment(); } catch { return; }
  if (!p || !p.id || !p.titre) return;
  const cat = category(p.categorie) || { label: 'Problème', icon: 'help' };
  const m = montantAffiche(p.montant);
  statique.replaceWith(h('a', {
    class: 'carte carte-hero', href: `p.html?id=${encodeURIComponent(p.id)}`,
    'aria-label': `Le problème du moment : ${p.titre} — ${cat.label}, par ${p.pseudo}`
  },
    h('div', { class: 'carte-haut' },
      h('div', { class: 'carte-tuile' }, h('img', { src: 'assets/img/mascotte.svg', alt: '', width: '96', height: '96' })),
      h('div', { class: 'carte-entete' },
        h('span', { class: 'pastille' }, icon(cat.icon), ` ${cat.label}`),
        h('span', { class: 'badge badge-moment' }, 'Le problème du moment'))),
    h('h2', { class: 'carte-titre' }, p.titre),
    h('p', { class: 'carte-texte' }, p.texte),
    h('div', { class: 'carte-ligne-bas' },
      m ? h('span', {}, h('span', { class: 'montant-riens' }, m.principal), ' recherchés ', h('span', { class: 'montant-euros' }, m.euros)) : null,
      h('span', { class: 'zero' }, 'Milliardaires intéressés : 0')),
    h('div', { class: 'carte-meta' },
      h('span', { class: 'carte-auteur' }, h('span', { class: 'nom' }, p.pseudo), p.camp ? badgeCamp(p.camp) : null)),
    filigrane()));
}
chargerProblemeDuMoment();

/* ---------- Category tiles ---------- */
const tuiles = $('#tuiles-categories');
let mur = null;
for (const id of HOME_TILES) {
  const c = category(id);
  tuiles.appendChild(h('a', {
    class: 'tuile-cat', href: `index.html?categorie=${c.id}#mur`,
    onclick: (e) => { if (mur) { e.preventDefault(); mur.choisir(c.id); $('#mur').scrollIntoView({ behavior: 'smooth' }); } }
  }, icon(c.icon), h('strong', {}, c.label)));
}
tuiles.appendChild(h('a', {
  class: 'tuile-cat plus', href: '#mur',
  onclick: (e) => { e.preventDefault(); if (mur) mur.choisir(null); $('#mur').scrollIntoView({ behavior: 'smooth' }); }
}, icon('sparkles'), h('strong', {}, `Et bien plus… (${CATEGORIES.length} catégories)`)));

/* ---------- Wall ---------- */
const categorieUrl = new URLSearchParams(location.search).get('categorie');
mur = initMur({ grille: $('#grille-mur'), filtres: $('#filtres'), voirPlus: $('#voir-plus'), categorieInitiale: categorieUrl, typeInitial: new URLSearchParams(location.search).get('type') });
document.addEventListener('wp:probleme-soumis', () => chargerCompteurs());
document.addEventListener('wp:session-maj', () => chargerCompteurs());

// R-031: « Un nouveau riche vient d'arriver » (72 h)
afficherAnnonces([$('#annonces-haut'), $('#annonces-mur')]);
