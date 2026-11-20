// R-029 (simple version, Hassen 20/11 21 h 10): a rich account waits for a moderator.
// Screen "Être riche sur Qui paie ?": the two prices and ONE button, "Contacter le support" (mailto).
// No payment, no legal text, nothing else. Shown after joining as rich, after switching to the rich
// camp, once per browser session while the account is pending, and on any blocked action.

import { CONFIG } from './config.js';
import { h, openDialog } from './ui.js';
import { icon } from './icons.js';
import { enRiens } from './riens.js';

export const FORMULES = {
  mensuel: { prix: 300, libelle: 'par mois', nom: 'mensuelle' },
  annuel: { prix: 3000, libelle: 'par an', nom: 'annuelle' }
};

/** True when the session profile is a rich member waiting for validation. */
export const richeEnAttente = (profil) => !!(profil && profil.camp === 'riche' && profil.statut_riche === 'en_attente');

/** mailto: link to the support, subject "Devenir riche — <pseudo>", body = pseudo + chosen plan. */
export function lienSupport(pseudo, formule = 'mensuel') {
  const f = FORMULES[formule] || FORMULES.mensuel;
  const sujet = `Devenir riche — ${pseudo || ''}`.trim();
  const corps = `Bonjour,\n\nJe veux être riche sur Qui paie ?\n\nPseudo : ${pseudo || ''}\nFormule choisie : ${f.nom} (${enRiens(f.prix)} ${f.libelle}, soit ${f.prix.toLocaleString('fr-FR')} €)\n`;
  return `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

/** The screen content (prices + support button), reused in the dialog and in Mon espace. */
export function ecranPrixRiche(pseudo) {
  const groupe = `formule-${Math.random().toString(36).slice(2, 8)}`;
  const bouton = h('a', { class: 'btn btn-primaire btn-bloc mt-16', href: lienSupport(pseudo, 'mensuel') }, icon('mail'), 'Contacter le support');
  const carte = (id) => {
    const f = FORMULES[id];
    const input = h('input', { type: 'radio', name: groupe, value: id });
    input.checked = id === 'mensuel';
    input.addEventListener('change', () => { if (input.checked) bouton.setAttribute('href', lienSupport(pseudo, id)); });
    return h('label', { class: 'prix-riche' }, input,
      // R-032: « 3x rien / par mois » in big, « 300 € » in small
      h('span', { class: 'prix-montant' }, enRiens(f.prix), h('span', { class: 'prix-periode' }, ` ${f.libelle}`)),
      h('span', { class: 'prix-euros' }, `${f.prix.toLocaleString('fr-FR')} €`));
  };
  return h('div', { class: 'ecran-riche' },
    h('fieldset', { class: 'prix-riches' }, h('legend', { class: 'visually-hidden' }, 'Choisis ta formule'), carte('mensuel'), carte('annuel')),
    bouton,
    h('p', { class: 'petit gris mt-16' }, 'Ton abonnement paie ton statut de riche sur la plateforme, il ne finance aucun problème.'));
}

/** Opens the dialog "Être riche sur Qui paie ?". */
export function ouvrirPrixRiche(pseudo) {
  return openDialog({ title: 'Être riche sur Qui paie ?', content: [ecranPrixRiche(pseudo)], className: 'dialog-riche' });
}

/** Once per browser session and per account while pending (page load). */
export function rappelPrixRiche(session) {
  if (!session || !richeEnAttente(session.profil)) return;
  const cle = `wp:prix-riche:${session.userId}`;
  try {
    if (sessionStorage.getItem(cle)) return;
    sessionStorage.setItem(cle, '1');
  } catch { /* privacy mode: show it anyway */ }
  ouvrirPrixRiche(session.profil.pseudo);
}
