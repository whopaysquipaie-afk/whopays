// Home page (index.html): live counters, Rich vs Poor match, category tiles, wall.
import { api } from '../api.js';
import { initPage } from '../page.js';
import { $, $$, h, formatNumber } from '../ui.js';
import { icon } from '../icons.js';
import { CATEGORIES, HOME_TILES, category } from '../categories.js';
import { countUp, countUpWhenVisible } from '../animations.js';
import { initMur } from '../mur.js';
import { afficherAnnonces } from '../annonces.js';

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
