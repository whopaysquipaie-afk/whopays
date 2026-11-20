// Wall of problems: category filters, card grid, skeletons, "Voir plus", funny empty states.

import { api } from './api.js';
import { h, clear, toastError } from './ui.js';
import { icon } from './icons.js';
import { CATEGORIES, category, isCategory } from './categories.js';
import { carteProbleme, carteSquelette } from './carte.js';
import { intent } from './layout.js';

const PAGE = 12;

const VIDES = [
  ['Aucun problème ici. C’est louche.', 'Personne n’a encore osé. Ça pourrait être toi.'],
  ['Catégorie vide. Comme mon frigo.', 'Publie le premier problème de la catégorie, il sera en ligne tout de suite.'],
  ['Ici, tout va bien. Trop bien.', 'Impossible. Il doit bien y avoir un problème quelque part.']
];

export function initMur({ grille, filtres, voirPlus, categorieInitiale = null }) {
  const state = { categorie: isCategory(categorieInitiale) ? categorieInitiale : null, avant: null, chargement: false, fini: false, jeton: 0 };

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

  function majChips() {
    for (const b of chips) b.setAttribute('aria-pressed', String((b.dataset.categorie || null) === state.categorie));
  }

  function choisir(id) {
    state.categorie = id;
    majChips();
    const url = new URL(location.href);
    if (id) url.searchParams.set('categorie', id); else url.searchParams.delete('categorie');
    history.replaceState(null, '', url.pathname.split('/').pop() + url.search + '#mur');
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
      const rows = await api.getProblemesPublics({ categorie: state.categorie, limite: PAGE, avant: state.avant });
      if (jeton !== state.jeton) return; // a newer request won
      squelettes.forEach((s) => s.remove());
      if (reset && rows.length === 0) {
        grille.appendChild(etatVide(state.categorie));
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
  return { choisir, recharger: () => charger(true) };
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
