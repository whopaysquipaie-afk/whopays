// Reactions bar (brief visuel §7.4): instant toggle, counters, pop animation.

import { api } from './api.js';
import { h, formatNumber, toastError } from './ui.js';
import { REACTIONS, REACTIONS_RICHES } from './categories.js';
import { exigerMembre, estMembre, session } from './page.js';
import { pop } from './animations.js';

/**
 * @param {object} p problem row (rire, courage, paierais, id)
 * @returns {HTMLElement}
 */
export function barreReactions(p) {
  // R-037: the rich reactions exist once 015 is applied (the row then carries their counters)
  const riches = 'yacht' in p ? REACTIONS_RICHES : [];
  const TOUTES = [...REACTIONS, ...riches];
  const counts = { rire: p.rire, courage: p.courage, paierais: p.paierais, yacht: p.yacht || 0, majordome: p.majordome || 0 };
  const actives = new Set();
  const buttons = {};

  const render = (type) => {
    const b = buttons[type];
    b.setAttribute('aria-pressed', String(actives.has(type)));
    b.querySelector('.nb').textContent = formatNumber(counts[type]);
    const r = TOUTES.find((x) => x.id === type);
    b.setAttribute('aria-label', `${r.label} : ${counts[type]}`);
  };

  async function basculer(type) {
    // Optimistic update
    const etaitActive = actives.has(type);
    if (etaitActive) { actives.delete(type); counts[type]--; } else { actives.add(type); counts[type]++; }
    render(type);
    if (!etaitActive) pop(buttons[type]);
    try {
      const r = await api.reagir(p.id, type);
      for (const k of Object.keys(counts)) if (r[k] !== undefined) counts[k] = r[k];
      if (r.actif) actives.add(type); else actives.delete(type);
      TOUTES.forEach((x) => render(x.id));
    } catch (e) {
      if (etaitActive) { actives.add(type); counts[type]++; } else { actives.delete(type); counts[type]--; }
      render(type);
      toastError(e);
    }
  }

  const bouton = (r, riche = false) => {
    const b = h('button', { type: 'button', class: `reaction${riche ? ' reaction-riche' : ''}`, 'aria-pressed': 'false' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, r.emoji), h('span', {}, r.label), h('span', { class: 'nb' }, '0'));
    b.addEventListener('click', () => {
      // R-037: a poor member or a visitor only sees the counter of the rich reactions
      if (riche && !richeActif()) { toastError({ message: 'Réaction réservée aux riches validés. Toi, tu as le droit de rire.' }); return; }
      exigerMembre(() => basculer(r.id), { raison: 'Rejoins un camp pour réagir. Ça prend 10 secondes.' });
    });
    buttons[r.id] = b;
    return b;
  };
  const bar = h('div', { class: 'reactions', role: 'group', 'aria-label': 'Réactions' },
    REACTIONS.map((r) => bouton(r)),
    riches.length ? h('p', { class: 'reactions-riches-titre' }, '👑 Réservé aux riches') : null,
    riches.map((r) => bouton(r, true)));
  const richeActif = () => { const s = session(); return !!(s && s.profil && s.profil.camp === 'riche' && s.profil.statut_riche === 'actif'); };
  const majRiches = () => { for (const r of riches) buttons[r.id].classList.toggle('lecture-seule', !richeActif()); };
  majRiches();
  TOUTES.forEach((r) => render(r.id));

  async function chargerMesReactions() {
    actives.clear();
    if (estMembre()) {
      try {
        for (const r of await api.getMesReactions([p.id])) actives.add(r.type);
      } catch { /* keep neutral */ }
    }
    TOUTES.forEach((r) => render(r.id));
    majRiches();
  }
  chargerMesReactions();
  document.addEventListener('wp:session-maj', chargerMesReactions);
  return bar;
}
