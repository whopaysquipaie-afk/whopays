// Reactions bar (brief visuel §7.4): instant toggle, counters, pop animation.

import { api } from './api.js';
import { h, formatNumber, toastError } from './ui.js';
import { REACTIONS } from './categories.js';
import { exigerMembre, estMembre } from './page.js';
import { pop } from './animations.js';

/**
 * @param {object} p problem row (rire, courage, paierais, id)
 * @returns {HTMLElement}
 */
export function barreReactions(p) {
  const counts = { rire: p.rire, courage: p.courage, paierais: p.paierais };
  const actives = new Set();
  const buttons = {};

  const render = (type) => {
    const b = buttons[type];
    b.setAttribute('aria-pressed', String(actives.has(type)));
    b.querySelector('.nb').textContent = formatNumber(counts[type]);
    const r = REACTIONS.find((x) => x.id === type);
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
      counts.rire = r.rire; counts.courage = r.courage; counts.paierais = r.paierais;
      if (r.actif) actives.add(type); else actives.delete(type);
      REACTIONS.forEach((x) => render(x.id));
    } catch (e) {
      if (etaitActive) { actives.add(type); counts[type]++; } else { actives.delete(type); counts[type]--; }
      render(type);
      toastError(e);
    }
  }

  const bar = h('div', { class: 'reactions', role: 'group', 'aria-label': 'Réactions' },
    REACTIONS.map((r) => {
      const b = h('button', { type: 'button', class: 'reaction', 'aria-pressed': 'false' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, r.emoji), h('span', {}, r.label), h('span', { class: 'nb' }, '0'));
      b.addEventListener('click', () => exigerMembre(() => basculer(r.id), { raison: 'Rejoins un camp pour réagir. Ça prend 10 secondes.' }));
      buttons[r.id] = b;
      return b;
    })
  );
  REACTIONS.forEach((r) => render(r.id));

  async function chargerMesReactions() {
    actives.clear();
    if (estMembre()) {
      try {
        for (const r of await api.getMesReactions([p.id])) actives.add(r.type);
      } catch { /* keep neutral */ }
    }
    REACTIONS.forEach((r) => render(r.id));
  }
  chargerMesReactions();
  document.addEventListener('wp:session-maj', chargerMesReactions);
  return bar;
}
