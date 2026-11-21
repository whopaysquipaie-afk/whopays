// R-046: « La courbe des Riens » — Riens published per day over 30 days (single series, bar chart).
// SVG built with DOM APIs only; hover / focus tooltip per bar; the data also exists as a table.

import { h } from './ui.js';
import { montantAffiche } from './riens.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const jourCourt = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });

/** [{ jour, total, nb }] → figure (chart + tooltip + table). */
export function courbeRiens(jours) {
  const W = 600;
  const H = 220;
  const max = Math.max(1, ...jours.map((j) => j.total));
  const pas = W / jours.length;
  const largeur = Math.max(4, pas - 2); // 2px gap between bars
  const graphe = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'courbe-svg', role: 'img', 'aria-label': 'Riens publiés par jour sur les 30 derniers jours (le détail est dans le tableau ci-dessous)' });
  for (const f of [0.5, 1]) graphe.appendChild(svg('line', { x1: 0, x2: W, y1: H - H * f * 0.92, y2: H - H * f * 0.92, class: 'courbe-grille' }));
  const bulle = h('div', { class: 'courbe-bulle', role: 'status', hidden: true });
  const montrer = (j, x) => {
    const m = montantAffiche(j.total, { zero: true });
    bulle.textContent = `${jourCourt(j.jour)} : ${m.principal} (${m.euros}) · ${j.nb} problème${j.nb > 1 ? 's' : ''}`;
    bulle.style.left = `${Math.min(88, Math.max(12, (x / W) * 100))}%`;
    bulle.hidden = false;
  };
  jours.forEach((j, i) => {
    const hauteur = j.total ? Math.max(3, (j.total / max) * H * 0.92) : 0;
    const x = i * pas + (pas - largeur) / 2;
    const g = svg('g', { class: 'courbe-barre', tabindex: '0' });
    // hit target bigger than the mark: the whole column
    g.appendChild(svg('rect', { x: i * pas, y: 0, width: pas, height: H, class: 'courbe-cible' }));
    if (hauteur) g.appendChild(svg('path', { d: `M${x} ${H} V${H - hauteur + 2} q0 -2 2 -2 h${largeur - 4} q2 0 2 2 V${H} Z`, class: 'courbe-mark' }));
    g.addEventListener('mouseenter', () => montrer(j, x + largeur / 2));
    g.addEventListener('focus', () => montrer(j, x + largeur / 2));
    g.addEventListener('mouseleave', () => { bulle.hidden = true; });
    g.addEventListener('blur', () => { bulle.hidden = true; });
    graphe.appendChild(g);
  });
  graphe.appendChild(svg('line', { x1: 0, x2: W, y1: H, y2: H, class: 'courbe-base' }));
  const maxM = montantAffiche(max, { zero: true });
  const table = h('table', { class: 'courbe-table' },
    h('caption', { class: 'visually-hidden' }, 'Riens publiés par jour'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Jour'), h('th', { scope: 'col' }, 'Riens'), h('th', { scope: 'col' }, 'Problèmes'))),
    h('tbody', {}, jours.map((j) => h('tr', {}, h('td', {}, jourCourt(j.jour)), h('td', {}, montantAffiche(j.total, { zero: true }).principal), h('td', {}, String(j.nb))))));
  return h('figure', { class: 'courbe' },
    jours.some((j) => j.total) ? h('p', { class: 'courbe-record' }, `Record : ${maxM.principal} en un jour`) : null,
    h('div', { class: 'courbe-zone' }, graphe, bulle),
    h('div', { class: 'courbe-axe', 'aria-hidden': 'true' }, h('span', {}, jourCourt(jours[0].jour)), h('span', {}, jourCourt(jours[jours.length - 1].jour))),
    h('details', { class: 'mt-16' }, h('summary', {}, 'Voir les données'), table));
}
