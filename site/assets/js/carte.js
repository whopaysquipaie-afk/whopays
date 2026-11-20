// Problem card (brief visuel §7.2). Never: progress bar, "collectés", "contributeurs", percentage.

import { h, formatEuros, formatNumber } from './ui.js';
import { enRiens, phraseRiens } from './riens.js';
import { icon } from './icons.js';
import { category, CAMPS } from './categories.js';
import { siteLabel } from './config.js';

export function badgeCamp(camp, { court = false } = {}) {
  const c = CAMPS[camp];
  if (!c) return null;
  return h('span', { class: `badge badge-${c.id}` }, icon(c.icon), court ? c.label : c.label);
}

export function filigrane() {
  return h('div', { class: 'filigrane' }, h('span', { class: 'q', 'aria-hidden': 'true' }, '?'), h('span', {}, siteLabel()));
}

function statsCompactes(p) {
  return h('div', { class: 'carte-stats', 'aria-label': `${p.rire} morts de rire, ${p.courage} courage, ${p.paierais} paieraient, ${p.commentaires} commentaires` },
    h('span', { title: 'Mort de rire', 'aria-hidden': 'true' }, '😂 ', formatNumber(p.rire)),
    h('span', { title: 'Courage', 'aria-hidden': 'true' }, '💪 ', formatNumber(p.courage)),
    h('span', { title: 'Si j\'étais riche, je paierais', 'aria-hidden': 'true' }, '💸 ', formatNumber(p.paierais)),
    h('span', { title: 'Commentaires', 'aria-hidden': 'true' }, icon('message'), formatNumber(p.commentaires))
  );
}

/** p = public problem row; large = p.html version; lien = wrap in a link. */
export function carteProbleme(p, { large = false, lien = !large, titreNiveau = large ? 'h1' : 'h3' } = {}) {
  const cat = category(p.categorie) || { label: 'Problème', icon: 'help' };
  const tag = lien ? 'a' : 'article';
  const card = h(tag, {
    class: `carte${large ? ' carte-large' : ''}`,
    href: lien ? `p.html?id=${encodeURIComponent(p.id)}` : null,
    'aria-label': lien ? `${p.titre} — ${cat.label}` : null
  },
    h('div', { class: 'carte-haut' },
      h('div', { class: 'carte-tuile', 'aria-hidden': 'true' }, icon(cat.icon)),
      h('div', { class: 'carte-entete' },
        h('span', { class: 'pastille' }, cat.label),
        p.est_exemple ? h('span', { class: 'badge badge-exemple' }, 'Exemple') : null
      )
    ),
    h(titreNiveau, { class: 'carte-titre' }, p.titre),
    h('p', { class: 'carte-texte' }, p.texte),
    p.montant ? h('p', { class: 'carte-montant' }, formatEuros(p.montant), ' ', h('small', {}, 'recherchés'),
      large ? null : h('span', { class: 'riens' }, ` · ${enRiens(p.montant)}`)) : null,
    p.montant && large ? h('p', { class: 'carte-riens' }, phraseRiens(p.montant)) : null,
    h('div', { class: 'carte-meta' },
      h('span', { class: 'carte-auteur' }, h('span', { class: 'nom' }, p.pseudo), p.camp ? badgeCamp(p.camp) : null),
      large ? h('span', {}, 'Milliardaires intéressés : 0') : null
    ),
    large ? null : statsCompactes(p),
    filigrane()
  );
  return card;
}

export function carteSquelette() {
  return h('div', { class: 'carte squelette', 'aria-hidden': 'true' },
    h('div', { class: 'carte-haut' }, h('div', { class: 'carte-tuile' }), h('div', { class: 'barre l40' })),
    h('div', { class: 'barre haute l90' }),
    h('div', { class: 'barre l70' }),
    h('div', { class: 'barre l90' }),
    h('div', { class: 'barre l40' }),
    h('div', { class: 'filigrane' }, ' ')
  );
}
