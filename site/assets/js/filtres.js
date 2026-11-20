// Content filters (brief dev §5.5), pure functions. Same patterns in SQL (002_securite.sql): keep in sync.

/** Banned words (normalized). Mirrors supabase/seed/mots_interdits.sql. */
export const MOTS_INTERDITS_DEFAUT = [
  'connard', 'connasse', 'conasse', 'salope', 'salaud', 'encule', 'enculee', 'enculer', 'pute', 'putain de ta mere',
  'batard', 'batarde', 'fdp', 'fils de pute', 'ntm', 'nique ta mere', 'niquer', 'tg', 'ta gueule', 'pd', 'pede',
  'tapette', 'gouine', 'negre', 'negro', 'bougnoule', 'bougnoul', 'youpin', 'bicot', 'chinetoque',
  'pouffiasse', 'grognasse', 'sale arabe', 'sale noir', 'sale juif', 'sale blanc', 'heil hitler',
  'suicide toi', 'va crever', 'va te pendre'
];

export const MESSAGE_FILTRE = 'Ton message contient un numéro, un lien ou un mot interdit. Relis les règles du jeu.';

/** Lowercase + strip accents + œ/æ ligatures. Same as SQL public.wp_normaliser(). */
export function normaliser(texte) {
  return String(texte ?? '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Patterns (on the normalized text). Phones: French (06 12…, +33 6…, 0033…) and international
export const RE_TEL_FR = /(?:(?:\+|00)\s?33\s?\(?0?\)?\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/;
export const RE_TEL_INTL = /(?:\+|\b00)\s?[1-9]\d{0,2}(?:[\s.-]?\d{2,4}){3,5}\b/;
export const RE_CHIFFRES_LONGS = /\d{10,}/; // 10+ digits in a row
// IBAN: 2 letters, 2 check digits, 11 to 30 alphanumerics (spaces allowed), at least 10 digits overall.
export const RE_IBAN = /\b[a-z]{2}\d{2}(?:\s?[a-z0-9]){11,30}\b/g;
// E-mail addresses
export const RE_EMAIL = /[a-z0-9._%+-]+\s?(?:@|\(at\)|\[at\])\s?[a-z0-9.-]+\.[a-z]{2,}/;
// Links: http(s)://, www., and bare domain names with a common TLD
export const RE_LIEN = /(?:https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|fr|net|org|io|be|ch|ca|co|me|ly|gg|tv|app|dev|xyz|info|biz|eu|uk|de|es|it|link|site|online|shop|store|live|club|top|page|to|sh|cc)\b)/;

function contientIban(norm) {
  RE_IBAN.lastIndex = 0;
  let m;
  while ((m = RE_IBAN.exec(norm))) {
    if ((m[0].match(/\d/g) || []).length >= 10) return true;
  }
  return false;
}

function contientMotInterdit(norm, mots) {
  // Word-boundary match on the normalized text: "pd" matches "pd" but not "rapide".
  const propre = ` ${norm.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return mots.some((mot) => {
    const m = normaliser(mot).replace(/[^a-z0-9]+/g, ' ').trim();
    return m && propre.includes(` ${m} `);
  });
}

/**
 * Analyses a text. Returns null when the text is clean, otherwise the reason:
 * 'telephone' | 'iban' | 'email' | 'lien' | 'mot_interdit'.
 */
export function raisonFiltre(texte, motsInterdits = MOTS_INTERDITS_DEFAUT) {
  const norm = normaliser(texte);
  if (!norm.trim()) return null;
  if (RE_EMAIL.test(norm)) return 'email';
  if (RE_LIEN.test(norm)) return 'lien';
  if (contientIban(norm)) return 'iban';
  if (RE_TEL_FR.test(norm) || RE_TEL_INTL.test(norm) || RE_CHIFFRES_LONGS.test(norm.replace(/(\d)[.-](?=\d)/g, '$1'))) return 'telephone';
  if (contientMotInterdit(norm, motsInterdits)) return 'mot_interdit';
  return null;
}

/** True when the text contains one of the expressions (normalized, whole words), e.g. sensitive words. */
export function contientExpression(texte, expressions) {
  const norm = normaliser(texte);
  return !!norm.trim() && contientMotInterdit(norm, expressions);
}

/** True when the text passes every filter. */
export function estPropre(texte, motsInterdits) {
  return raisonFiltre(texte, motsInterdits) === null;
}

/* ---------------- Field validation (same limits as SQL) ---------------- */

export const LIMITES = {
  pseudo: [2, 30],
  email: [3, 254],
  titre: [3, 80],
  texte: [10, 600],
  commentaire: [1, 300],
  message: [1, 300],
  richeMessage: [0, 500],
  montant: [0, 1_000_000],
  richeMontant: [0, 10_000_000]
};

export const RE_EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Collapses whitespace (keeps single line breaks for long texts). */
export function nettoyer(texte, { multiligne = false } = {}) {
  let t = String(texte ?? '').replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '');
  if (multiligne) {
    t = t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n');
  } else {
    t = t.replace(/\s+/g, ' ');
  }
  return t.trim();
}

/** Returns an error message (French) or null. */
export function verifierLongueur(valeur, [min, max], libelle) {
  const n = [...valeur].length;
  if (n < min) return min <= 1 ? `${libelle} est vide.` : `${libelle} doit faire au moins ${min} caractères.`;
  if (n > max) return `${libelle} ne doit pas dépasser ${max} caractères.`;
  return null;
}

/** Immediate client-side check for a form field (same rules as the server). */
export function verifierChamp(valeur, { limites, libelle, multiligne = false, filtrer = true } = {}) {
  const v = nettoyer(valeur, { multiligne });
  const erreurLongueur = limites ? verifierLongueur(v, limites, libelle) : null;
  if (erreurLongueur) return erreurLongueur;
  if (filtrer && raisonFiltre(v)) return MESSAGE_FILTRE;
  return null;
}
