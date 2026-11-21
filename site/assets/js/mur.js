// Wall of problems: category filters, card grid, skeletons, "Voir plus", funny empty states.

import { api } from './api.js';
import { h, clear, toastError } from './ui.js';
import { icon } from './icons.js';
import { CATEGORIES, category, isCategory } from './categories.js';
import { carteProbleme, carteSquelette, TYPES_POST } from './carte.js';
import { intent } from './layout.js';
import { themeDuJour } from './themes.js';
import { estMembre } from './page.js';

const PAGE = 12;

const VIDES = [
  ['Aucun problème ici. C’est louche.', 'Personne n’a encore osé. Ça pourrait être toi.'],
  ['Catégorie vide. Comme mon frigo.', 'Publie le premier problème de la catégorie, il sera en ligne tout de suite.'],
  ['Ici, tout va bien. Trop bien.', 'Impossible. Il doit bien y avoir un problème quelque part.']
];

export function initMur({ grille, filtres, voirPlus, categorieInitiale = null, typeInitial = null }) {
  const state = {
    categorie: isCategory(categorieInitiale) ? categorieInitiale : null, type: TYPES_POST[typeInitial] || typeInitial === 'suivis' ? typeInitial : null,
    avant: null, chargement: false, fini: false, jeton: 0
  };

  // R-030: kinds of posts (all / problems of the poor / problems of the rich / posts of the rich)
  const types = h('div', { class: 'filtres filtres-types', role: 'group', 'aria-label': 'Filtrer par type de publication' });
  const chipsTypes = [];
  for (const [id, label] of [[null, 'Tout'], ...Object.entries(TYPES_POST).map(([k, v]) => [k, v.label])]) {
    const b = h('button', { type: 'button', class: `filtre${id && id !== 'pauvre' ? ' filtre-riche' : ''}`, 'aria-pressed': String(state.type === id), dataset: { type: id || '' } },
      id && id !== 'pauvre' ? icon('crown') : null, label);
    b.addEventListener('click', () => choisirType(id));
    chipsTypes.push(b);
    types.appendChild(b);
  }
  filtres.before(types);
  // R-047: « Mes suivis » for members, once the feed answers (019 applied)
  if (estMembre()) {
    api.getMesSuivis().then(() => {
      const b = h('button', { type: 'button', class: 'filtre filtre-suivis', 'aria-pressed': String(state.type === 'suivis'), dataset: { type: 'suivis' } }, '★ Mes suivis');
      b.addEventListener('click', () => choisirType('suivis'));
      chipsTypes.push(b);
      types.appendChild(b);
    }, () => { if (state.type === 'suivis') choisirType(null); });
  } else if (state.type === 'suivis') state.type = null;
  const majCategories = () => { filtres.hidden = state.type === 'riche' || state.type === 'publication' || state.type === 'suivis'; };
  majCategories();
  function choisirType(id) {
    state.type = id;
    if (id === 'riche' || id === 'publication' || id === 'suivis') state.categorie = null;
    for (const b of chipsTypes) b.setAttribute('aria-pressed', String((b.dataset.type || null) === state.type));
    majChips();
    majCategories();
    majUrl();
    charger(true);
  }

  // Filter chips
  const chips = [];
  const addChip = (id, label, ico) => {
    const b = h('button', { type: 'button', class: 'filtre', 'aria-pressed': String(state.categorie === id), dataset: { categorie: id || '' } },
      ico ? icon(ico) : null, label);
    b.addEventListener('click', () => choisir(id));
    chips.push(b);
    filtres.appendChild(b);
  };
  addChip(null, 'Tout voir', null);
  for (const c of CATEGORIES) addChip(c.id, c.label, c.icon);
  // R-036: the chip of the theme of the day
  const theme = themeDuJour();
  const chipTheme = chips.find((b) => b.dataset.categorie === theme.categorie);
  if (chipTheme) {
    chipTheme.classList.add('filtre-theme');
    chipTheme.title = 'Thème du jour';
    chipTheme.appendChild(h('span', { class: 'filtre-theme-marque' }, ' · thème du jour'));
  }

  function majChips() {
    for (const b of chips) b.setAttribute('aria-pressed', String((b.dataset.categorie || null) === state.categorie));
  }

  function majUrl() {
    const url = new URL(location.href);
    if (state.categorie) url.searchParams.set('categorie', state.categorie); else url.searchParams.delete('categorie');
    if (state.type) url.searchParams.set('type', state.type); else url.searchParams.delete('type');
    history.replaceState(null, '', url.pathname.split('/').pop() + url.search + '#mur');
  }

  function choisir(id) {
    state.categorie = id;
    if (id && state.type && state.type !== 'pauvre') {
      state.type = null;
      for (const b of chipsTypes) b.setAttribute('aria-pressed', String(!b.dataset.type));
      majCategories();
    }
    majChips();
    majUrl();
    charger(true);
  }

  async function charger(reset = false) {
    if (state.chargement && !reset) return;
    const jeton = ++state.jeton;
    state.chargement = true;
    if (reset) {
      state.avant = null;
      state.fini = false;
      clear(grille);
    }
    grille.setAttribute('aria-busy', 'true');
    voirPlus.hidden = true;
    const squelettes = Array.from({ length: reset ? 6 : 3 }, () => carteSquelette());
    squelettes.forEach((s) => grille.appendChild(s));
    try {
      const rows = state.type === 'suivis'
        ? await api.getFilSuivis({ limite: PAGE, avant: state.avant })
        : await api.getProblemesPublics({ categorie: state.categorie, type: state.type, limite: PAGE, avant: state.avant });
      if (jeton !== state.jeton) return; // a newer request won
      squelettes.forEach((s) => s.remove());
      if (reset && rows.length === 0) {
        grille.appendChild(state.type === 'suivis' ? etatVideSuivis() : state.type === 'riche' || state.type === 'publication' ? etatVideRiche(state.type) : etatVide(state.categorie));
      }
      for (const p of rows) {
        const card = carteProbleme(p);
        card.classList.add('apparait');
        grille.appendChild(card);
      }
      if (rows.length) state.avant = rows[rows.length - 1].cree_le;
      state.fini = rows.length < PAGE;
      voirPlus.hidden = state.fini;
    } catch (e) {
      squelettes.forEach((s) => s.remove());
      if (jeton === state.jeton) {
        grille.appendChild(h('div', { class: 'etat-vide' },
          h('p', { class: 'grand' }, 'Le mur fait une sieste.'),
          h('p', {}, e.message || 'Impossible de charger les problèmes.'),
          h('button', { type: 'button', class: 'btn btn-fantome', onclick: () => charger(true) }, icon('refresh'), 'Réessayer')));
        toastError(e);
      }
    } finally {
      if (jeton === state.jeton) {
        state.chargement = false;
        grille.setAttribute('aria-busy', 'false');
      }
    }
  }

  voirPlus.addEventListener('click', () => charger(false));
  charger(true);
  return { choisir, choisirType, recharger: () => charger(true) };
}

function etatVideSuivis() {
  return h('div', { class: 'etat-vide' },
    h('p', { class: 'grand' }, 'Ton fil est vide. Comme ton frigo ?'),
    h('p', {}, 'Touche « Suivre » sur le profil d’un pauvre (ou d’un riche) qui te fait rire : ses problèmes arriveront ici.'),
    h('a', { class: 'btn btn-primaire', href: 'palmares.html#plus-suivis' }, 'Voir les plus suivis', icon('arrow-right', { className: 'fleche' })));
}

function etatVideRiche(type) {
  return h('div', { class: 'etat-vide' },
    h('p', { class: 'grand' }, type === 'riche' ? 'Aucun problème de riche. Pour l’instant.' : 'Aucune publication de riche. Ils sont sur leur yacht.'),
    h('p', {}, 'Seuls les riches validés publient ici. Les problèmes de pauvres, eux, ne manquent pas.'));
}

function etatVide(categorieId) {
  const [titre, texte] = VIDES[Math.floor(Math.random() * VIDES.length)];
  const cat = category(categorieId);
  return h('div', { class: 'etat-vide' },
    h('p', { class: 'grand' }, titre),
    h('p', {}, cat ? `${texte} (${cat.label})` : texte),
    h('button', { type: 'button', class: 'btn btn-primaire', onclick: () => intent('publier', { categorie: categorieId }) },
      'Publier un problème', icon('arrow-right', { className: 'fleche' }))
  );
}
