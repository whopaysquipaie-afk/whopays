// R-036: one theme per day of the week (Paris time), no database. Pure: usable in the browser and in Node.

import { category } from './categories.js';

// Index = day of the week in Paris (0 = Sunday … 6 = Saturday) → category id.
export const THEMES_SEMAINE = ['defi', 'patron', 'factures', 'amour', 'famille', 'plaisir', 'reve'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const COURTS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Day of the week in Paris (0 = Sunday), whatever the device time zone. */
export function jourParis(date = new Date()) {
  const court = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(date);
  return COURTS[court] ?? date.getDay();
}

/** { jour: 'lundi', categorie: 'patron', label: 'Mon patron' } for the given date (default: now). */
export function themeDuJour(date = new Date()) {
  const j = jourParis(date);
  const id = THEMES_SEMAINE[j];
  return { jour: JOURS[j], categorie: id, label: category(id).label };
}

/** Share text of a problem: « {titre} » — Qui paie ? {url} (brief dev §6.H). */
// R-036: a problem of the theme of the day says so (« Thème du jour : Mon patron »).
export function texteProbleme(titre, url, categorie = null, date = new Date()) {
  const theme = themeDuJour(date);
  return categorie && categorie === theme.categorie
    ? `« ${titre} » — Thème du jour : ${theme.label} · Qui paie ? ${url}`
    : `« ${titre} » — Qui paie ? ${url}`;
}

/** Text to share the theme of the day. */
export function texteTheme(theme, url) {
  return `Thème du jour sur Qui paie ? : « ${theme.label} ». Raconte le tien, avec humour 👉 ${url}`;
}
