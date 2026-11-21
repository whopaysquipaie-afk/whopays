// Leaderboard of the poor (R-028): shared helpers for palmares.html and Mon espace.

import { siteUrl } from './config.js';
import { h, formatNumber } from './ui.js';
import { enRiens, montantAffiche } from './riens.js';
import { partageNatif, copierLien } from './partage.js';
import { deMois } from './themes.js';
import { badgesConnus, libelleBadges } from './badges.js';

export { deMois };

/** 1 → "1ᵉʳ", 42 → "42ᵉ". */
export const ordinal = (n) => `${formatNumber(n)}${n === 1 ? 'ᵉʳ' : 'ᵉ'}`;

/** R-032: « 4,25x Rien » in big, then « 4 250 € » in small (total of a member). */
export function totalRiens(total) {
  const m = montantAffiche(total, { zero: true });
  return [h('span', { class: 'montant-riens' }, m.principal), h('span', { class: 'montant-euros' }, m.euros)];
}

/** R-039: row of badge emojis (title = name), at most `max` then « +N ». Null without badge. */
export function rangeeBadges(ids, { max = 4 } = {}) {
  const b = badgesConnus(ids);
  if (!b.length) return null;
  return h('span', { class: 'badges-ligne', role: 'img', 'aria-label': `Badges : ${libelleBadges(ids)}` },
    ...b.slice(0, max).map((x) => h('span', { title: x.nom, 'aria-hidden': 'true' }, x.emoji)),
    b.length > max ? h('span', { class: 'badges-plus', 'aria-hidden': 'true' }, `+${b.length - max}`) : null);
}

/** "Ton rang : 42ᵉ sur 312 pauvres" (or an invitation when not ranked yet). */
export function phraseRang(mon) {
  if (!mon || !mon.rang) return 'Pas encore classé : publie un problème pour entrer au palmarès.';
  return `Ton rang : ${ordinal(mon.rang)} sur ${formatNumber(mon.sur)} pauvre${mon.sur > 1 ? 's' : ''}`;
}

/** Native share sheet, or copy of the text + link (with the member's referral code). */
export async function partagerRang(mon, codeRef = null) {
  const url = siteUrl(`palmares.html${codeRef ? `?ref=${encodeURIComponent(codeRef)}` : ''}`);
  const riens = enRiens(mon.total);
  const texte = `Je suis ${ordinal(mon.rang)} sur ${formatNumber(mon.sur)} au palmarès des pauvres ${mon.periode === 'mois' ? `${deMois()} ` : ''}de Qui paie ?${riens ? `, avec ${riens} de problèmes` : ''}. Et toi, tu es à combien de Riens ? ${url}`;
  const ok = await partageNatif({ title: 'Le palmarès des pauvres — Qui paie ?', text: texte, url });
  if (!ok) await copierLien(texte);
}
