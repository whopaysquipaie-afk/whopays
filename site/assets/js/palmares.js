// Leaderboard of the poor (R-028): shared helpers for palmares.html and Mon espace.

import { siteUrl } from './config.js';
import { formatNumber, formatEuros } from './ui.js';
import { enRiens } from './riens.js';
import { partageNatif, copierLien } from './partage.js';

/** 1 → "1ᵉʳ", 42 → "42ᵉ". */
export const ordinal = (n) => `${formatNumber(n)}${n === 1 ? 'ᵉʳ' : 'ᵉ'}`;

/** "4 250 € · 4,25x Rien" (total of a member). */
export const totalRiens = (total) => [formatEuros(total), enRiens(total)].filter(Boolean).join(' · ');

/** "Ton rang : 42ᵉ sur 312 pauvres" (or an invitation when not ranked yet). */
export function phraseRang(mon) {
  if (!mon || !mon.rang) return 'Pas encore classé : publie un problème pour entrer au palmarès.';
  return `Ton rang : ${ordinal(mon.rang)} sur ${formatNumber(mon.sur)} pauvre${mon.sur > 1 ? 's' : ''}`;
}

/** Native share sheet, or copy of the text + link (with the member's referral code). */
export async function partagerRang(mon, codeRef = null) {
  const url = siteUrl(`palmares.html${codeRef ? `?ref=${encodeURIComponent(codeRef)}` : ''}`);
  const riens = enRiens(mon.total);
  const texte = `Je suis ${ordinal(mon.rang)} sur ${formatNumber(mon.sur)} au palmarès des pauvres de Qui paie ?${riens ? `, avec ${riens} de problèmes` : ''}. Et toi, tu es à combien de Riens ? ${url}`;
  const ok = await partageNatif({ title: 'Le palmarès des pauvres — Qui paie ?', text: texte, url });
  if (!ok) await copierLien(texte);
}
