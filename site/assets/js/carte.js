// Problem card (brief visuel §7.2). Never: progress bar, "collectés", "contributeurs", percentage.

import { h, formatNumber, plural } from './ui.js';
import { montantAffiche } from './riens.js';
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

/** R-037: « 👑 Couronné par Caviar Gauche » / « 👑 Couronné par 3 riches » (nothing before 015). */
export function ligneCouronne(p) {
  const n = Number(p.couronnes) || 0;
  if (!n) return null;
  return h('p', { class: 'carte-couronne' }, h('span', { 'aria-hidden': 'true' }, '👑 '),
    n === 1 && p.couronne_par ? ['Couronné par ', h('strong', {}, p.couronne_par)] : `Couronné par ${plural(n, 'riche', 'riches')}`);
}

function statsCompactes(p) {
  return h('div', { class: 'carte-stats', 'aria-label': `${plural(p.rire, 'mort de rire', 'morts de rire')}, ${formatNumber(p.courage || 0)} courage, ${plural(p.paierais, 'paierait', 'paieraient')}, ${plural(p.commentaires, 'commentaire', 'commentaires')}` },
    h('span', { title: 'Mort de rire', 'aria-hidden': 'true' }, '😂 ', formatNumber(p.rire)),
    h('span', { title: 'Courage', 'aria-hidden': 'true' }, '💪 ', formatNumber(p.courage)),
    h('span', { title: 'Si j\'étais riche, je paierais', 'aria-hidden': 'true' }, '💸 ', formatNumber(p.paierais)),
    p.yacht ? h('span', { title: 'Je regarde ça depuis mon yacht', 'aria-hidden': 'true' }, '🛥️ ', formatNumber(p.yacht)) : null,
    p.majordome ? h('span', { title: 'Mon majordome s’en occupe', 'aria-hidden': 'true' }, '🎩 ', formatNumber(p.majordome)) : null,
    h('span', { title: 'Commentaires', 'aria-hidden': 'true' }, icon('message'), formatNumber(p.commentaires))
  );
}

/** R-030: kinds of posts. A rich problem and a publication have no category; a publication has no title. */
export const TYPES_POST = {
  pauvre: { label: 'Problèmes de pauvres', court: 'Problème' },
  riche: { label: 'Problèmes de riches', court: 'Problème de riche', icon: 'crown' },
  publication: { label: 'Publications de riches', court: 'Publication de riche', icon: 'crown' }
};

/** Title shown for any post: the title, or the start of the text of a publication. */
export function titreDe(p) {
  if (p.titre) return p.titre;
  const t = String(p.texte || '');
  return t.length > 70 ? `${t.slice(0, 69).trimEnd()}…` : t;
}

/** p = public problem row; large = p.html version; lien = wrap in a link. */
/** R-040: link to the public profile of a share code. */
export const lienProfil = (code) => `profil.html?c=${encodeURIComponent(code)}`;

/** Author name: a link to the profile when the share code is known. */
export function nomAuteur(p) {
  return p.code_auteur && /^[A-Z2-9]{8}$/.test(p.code_auteur)
    ? h('a', { class: 'nom lien-profil', href: lienProfil(p.code_auteur) }, p.pseudo)
    : h('span', { class: 'nom' }, p.pseudo);
}

export function carteProbleme(p, { large = false, lien = !large, titreNiveau = large ? 'h1' : 'h3' } = {}) {
  const type = TYPES_POST[p.type] && p.type !== 'pauvre' ? p.type : null;
  const cat = type ? { label: TYPES_POST[type].court, icon: 'crown' } : category(p.categorie) || { label: 'Problème', icon: 'help' };
  // R-040: with a profile link inside, the card cannot be one big <a> (no nested links):
  // it becomes an <article> with a stretched link to the problem, the pseudo link sits above it.
  const etendu = lien && !!p.code_auteur;
  const tag = lien && !etendu ? 'a' : 'article';
  const href = `p.html?id=${encodeURIComponent(p.id)}`;
  const card = h(tag, {
    class: `carte${large ? ' carte-large' : ''}${type ? ` carte-riche carte-${type}` : ''}${etendu ? ' carte-cliquable' : ''}`,
    href: lien && !etendu ? href : null,
    'aria-label': lien && !etendu ? `${titreDe(p)} — ${cat.label}` : null
  },
    etendu ? h('a', { class: 'carte-lien-etendu', href, 'aria-label': `${titreDe(p)} — ${cat.label}` }) : null,
    h('div', { class: 'carte-haut' },
      h('div', { class: 'carte-tuile', 'aria-hidden': 'true' }, icon(cat.icon)),
      h('div', { class: 'carte-entete' },
        h('span', { class: 'pastille' }, cat.label),
        p.premiere ? h('span', { class: 'badge badge-sombre' }, 'Première publication') : null
      )
    ),
    p.titre ? h(titreNiveau, { class: 'carte-titre' }, p.titre) : h(titreNiveau, { class: 'visually-hidden' }, titreDe(p)),
    h('p', { class: `carte-texte${p.titre ? '' : ' carte-texte-seul'}` }, p.texte),
    blocMontant(p.montant, { large }),
    ligneCouronne(p),
    h('div', { class: 'carte-meta' },
      h('span', { class: 'carte-auteur' }, nomAuteur(p), p.camp ? badgeCamp(p.camp) : null),
      large ? h('span', {}, 'Milliardaires intéressés : 0') : null
    ),
    large ? null : statsCompactes(p),
    filigrane()
  );
  return card;
}

/** R-032: « 4x Rien recherchés » in big, then « 4 000 € » (card) or « soit 4 000 € » (problem page) in small. */
export function blocMontant(montant, { large = false, suffixe = 'recherchés' } = {}) {
  const m = montantAffiche(montant);
  if (!m) return null;
  return h('p', { class: 'carte-montant' },
    h('span', { class: 'montant-riens' }, m.principal),
    suffixe ? h('small', {}, ` ${suffixe}`) : null,
    h('span', { class: 'montant-euros' }, large ? `soit ${m.euros}` : m.euros));
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
