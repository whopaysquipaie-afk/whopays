// Home page (index.html): live counters, Rich vs Poor match, category tiles, wall.
import { api } from '../api.js';
import { initPage } from '../page.js';
import { $, $$, h, formatNumber } from '../ui.js';
import { icon } from '../icons.js';
import { CATEGORIES, HOME_TILES, category } from '../categories.js';
import { countUp, countUpWhenVisible } from '../animations.js';
import { initMur } from '../mur.js';
import { afficherAnnonces } from '../annonces.js';
import { badgeCamp, filigrane, carteProbleme } from '../carte.js';
import { montantAffiche } from '../riens.js';
import { themeDuJour, texteTheme } from '../themes.js';
import { intent } from '../layout.js';
import { partageNatif, copierLien } from '../partage.js';
import { siteUrl } from '../config.js';

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

/* ---------- Theme of the day (R-036, Paris time, no database) ---------- */
// R-048: one compact line right after the hero (never above it). Under the wall filters: the full banner (tell, see, share).
function bandeauTheme(complet) {
  const t = themeDuJour();
  const url = siteUrl(`index.html?categorie=${t.categorie}#mur`);
  const raconter = () => intent('publier', { categorie: t.categorie });
  if (!complet) {
    return h('p', { class: 'theme-jour theme-jour-compact' }, icon(category(t.categorie).icon),
      h('span', {}, 'Thème du jour : ', h('strong', {}, t.label), ' — ',
        h('button', { type: 'button', class: 'lien', onclick: raconter }, 'raconte-nous')));
  }
  return h('div', { class: 'theme-jour', role: 'note' },
    h('p', { class: 'theme-jour-texte' }, icon(category(t.categorie).icon), h('span', {}, 'Thème du jour : ', h('strong', {}, t.label), ' — raconte-nous')),
    h('div', { class: 'theme-jour-actions' },
      h('button', { type: 'button', class: 'btn btn-primaire btn-petit', onclick: raconter }, 'Je raconte'),
      h('button', { type: 'button', class: 'btn btn-fantome btn-petit', onclick: () => { if (mur) mur.choisir(t.categorie); } }, 'Les voir'),
      h('button', {
        type: 'button', class: 'btn-icone', 'aria-label': 'Partager le thème du jour', title: 'Partager le thème du jour',
        onclick: async () => { if (!(await partageNatif({ title: 'Qui paie ?', text: texteTheme(t, url), url }))) copierLien(url); }
      }, icon('share'))));
}
for (const [id, complet] of [['theme-du-jour', false], ['theme-mur', true]]) {
  const zone = document.getElementById(id);
  if (zone) { zone.replaceChildren(bandeauTheme(complet)); zone.hidden = false; }
}

/* ---------- « Le pauvre du mois » (R-038; hidden while 016 is not applied or when nobody is ranked) ---------- */
async function chargerPauvreDuMois() {
  const zone = document.getElementById('pauvre-du-mois');
  if (!zone) return;
  let p = null;
  try { p = await api.getPalmares({ limite: 1, periode: 'mois' }); } catch { return; }
  const l = p && p.lignes && p.lignes[0];
  if (!l) return;
  const { deMois, totalRiens } = await import('../palmares.js');
  zone.querySelector('.pauvre-mois-corps').replaceChildren(
    h('p', { class: 'pauvre-mois-titre' }, h('span', { 'aria-hidden': 'true' }, '🥇 '), `Le pauvre ${deMois()}`),
    h('p', { class: 'riche-semaine-nom' }, h('strong', {}, l.pseudo)),
    h('p', { class: 'pauvre-mois-total' }, ...totalRiens(l.total), h('span', { class: 'gris' }, ` · ${formatNumber(l.nb)} problème${l.nb > 1 ? 's' : ''} ce mois-ci`)),
    h('a', { class: 'btn btn-lavande btn-petit', href: 'palmares.html' }, 'Voir le palmarès du mois', icon('arrow-right', { className: 'fleche' })));
  zone.hidden = false;
}
chargerPauvreDuMois();

/* ---------- « Les plus suivis » (R-047; preview, hidden while 019 is not applied) ---------- */
api.getPlusSuivis().then(async (r) => {
  const zone = document.getElementById('plus-suivis-accueil');
  if (!zone || !(r.pauvres.length || r.riches.length)) return;
  const { listePlusSuivis } = await import('../suivi.js');
  zone.querySelector('.plus-suivis-listes').replaceChildren(...[
    listePlusSuivis(r.pauvres, { titre: 'Pauvres', max: 3 }), listePlusSuivis(r.riches, { titre: 'Riches', max: 2 })].filter(Boolean));
  zone.hidden = false;
}, () => {});

/* ---------- « Le riche de la semaine » (R-037; hidden while 015 is not applied or without rich member) ---------- */
async function chargerRicheSemaine() {
  const zone = document.getElementById('riche-semaine');
  if (!zone) return;
  let r = null;
  try { r = await api.getRicheDeLaSemaine(); } catch { return; }
  if (!r || !r.pseudo) return;
  const n = Number(r.couronnes_7j) || 0;
  zone.querySelector('.riche-semaine-corps').replaceChildren(
    h('p', { class: 'riche-semaine-nom' }, h('span', { 'aria-hidden': 'true' }, '👑 '), h('strong', {}, r.pseudo)),
    h('p', { class: 'gris' }, n
      ? `A distribué ${formatNumber(n)} couronne${n > 1 ? 's' : ''} cette semaine. Un mécène imaginaire de premier ordre.`
      : 'Le dernier riche arrivé. Il n’a encore couronné personne : on surveille.'),
    r.derniere ? carteProbleme(r.derniere) : h('p', { class: 'gris' }, 'Pas encore de publication. Il réfléchit, depuis son yacht.'));
  zone.hidden = false;
}
chargerRicheSemaine();

// R-031: « Un nouveau riche vient d'arriver » (72 h)
afficherAnnonces([$('#annonces-haut'), $('#annonces-mur')]);
