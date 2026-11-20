// "rien / Rien" unit (R-026): 1 rien = 100 €, 1 Rien = 1 000 €. Pure functions, no DOM.
// Under 1 000 € → "3,5x rien"; from 1 000 € → "4,25x Rien". French comma, 2 decimals max, no ",0".

/** R-027: a problem of the poor never exceeds 10x Rien (= 008_plafond_pauvres.sql). */
export const PLAFOND_PAUVRE = 10000;

const FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** "4,5x Rien" for 4 500 €; '' for 0, empty, negative or invalid amounts. */
export function enRiens(montant) {
  if (montant === null || montant === undefined || montant === '') return '';
  const n = Number(String(montant).replace(/\s/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  const grand = n >= 1000;
  const v = Math.round((n / (grand ? 1000 : 100)) * 100) / 100;
  if (v <= 0) return '';
  return `${FORMAT.format(v)}x ${grand ? 'Rien' : 'rien'}`;
}

const EUROS = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** "4 000 €" (the secondary, small information since R-032). */
export function enEuros(montant) {
  const n = Number(String(montant ?? '').replace(/\s/g, ''));
  return Number.isFinite(n) ? `${EUROS.format(n)} €` : '';
}

/**
 * R-032: what to display for an amount. The Rien is the main information, the euro comes after, small.
 * 4 000 → { principal: '4x Rien', euros: '4 000 €' }; null for 0 / empty / invalid,
 * except with { zero: true }: 0 → { principal: '0x Rien', euros: '0 €' } (« 0x Rien financé »).
 */
export function montantAffiche(montant, { zero = false } = {}) {
  const principal = enRiens(montant);
  if (principal) return { principal, euros: enEuros(montant) };
  const n = Number(String(montant ?? '').replace(/\s/g, ''));
  if (zero && montant !== null && montant !== undefined && montant !== '' && n === 0) return { principal: '0x Rien', euros: '0 €' };
  return null;
}

/** "Pour un riche, ça vaut 4x Rien" (problem page); '' when there is no amount. */
export function phraseRiens(montant) {
  const r = enRiens(montant);
  return r ? `Pour un riche, ça vaut ${r}` : '';
}
