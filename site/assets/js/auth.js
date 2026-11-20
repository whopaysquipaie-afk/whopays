// Parcours B (join in 10 seconds) and C (magic link) — brief dev §6, brief visuel §7.3.

import { CONFIG } from './config.js';
import { api } from './api.js';
import { h, openDialog, toast, toastError } from './ui.js';
import { icon } from './icons.js';
import { CAMPS } from './categories.js';
import { champ, caseACocher, choixCamp, lienRegles, boiteErreur, chargement } from './champs.js';
import { creerTurnstile } from './turnstile.js';
import { lireRef, oublierRef } from './parrainage.js';
import { confetti } from './animations.js';

export const INFO_DONNEES = 'Ton pseudo et ton e-mail servent uniquement à faire fonctionner ton compte, et à t’envoyer des nouvelles si tu le demandes. Tu peux supprimer ton compte à tout moment depuis Mon espace. Responsable : Hassen Bamri.';
export const SOUS_BOUTON = 'Pas de mot de passe. Pas de carte bancaire. Pas de milliardaire non plus (pour l’instant).';

/** Join fields, for the join dialog and the top of the "Publier" form (visitors). */
export function champsRejoindre({ camp = null } = {}) {
  const camps = choixCamp({ valeur: camp });
  const pseudo = champ({ name: 'pseudo', label: 'Pseudo', min: 2, max: 30, autocomplete: 'nickname', libelle: 'Ton pseudo', help: 'C’est le seul nom qui apparaîtra sur le site.' });
  const email = champ({ name: 'email', label: 'E-mail', type: 'email', check: 'email', autocomplete: 'email', inputmode: 'email' });
  const majeur = caseACocher({ name: 'majeur', label: 'J’ai 18 ans ou plus', required: true });
  const regles = caseACocher({ name: 'regles', label: ['J’accepte les ', lienRegles(), ''], required: true });
  const newsletter = caseACocher({ name: 'newsletter', label: 'Je veux recevoir les nouvelles du projet' });
  const caseErreur = h('p', { class: 'erreur', role: 'alert', hidden: true });

  const nodes = [camps.wrap, pseudo.wrap, email.wrap, majeur.wrap, regles.wrap, newsletter.wrap, caseErreur];

  function valider() {
    const erreurs = [camps.validate(), pseudo.validate(), email.validate()];
    let msgCase = null;
    if (!majeur.input.checked) msgCase = 'Il faut avoir 18 ans ou plus pour rejoindre un camp.';
    else if (!regles.input.checked) msgCase = 'Accepte les règles du jeu pour continuer.';
    caseErreur.textContent = msgCase || '';
    caseErreur.hidden = !msgCase;
    erreurs.push(msgCase);
    const first = [camps, pseudo, email].find((f, i) => erreurs[i]);
    if (first) first.focus();
    else if (msgCase) (majeur.input.checked ? regles.input : majeur.input).focus();
    return !erreurs.some(Boolean);
  }

  function valeurs() {
    return {
      camp: camps.value(), pseudo: pseudo.value(), email: email.value().trim(),
      newsletter: newsletter.input.checked, majeur: majeur.input.checked, regles: regles.input.checked, codeRef: lireRef()
    };
  }
  return { nodes, valider, valeurs, champs: { camps, pseudo, email } };
}

/** Runs parcours B. Returns 'cree' | 'deja_membre'. Throws on error. */
export async function executerRejoindre(valeurs, turnstile) {
  const r = await api.rejoindre({ ...valeurs, getCaptchaToken: () => turnstile.getToken() });
  if (r.statut === 'cree') {
    oublierRef();
    confetti({ camp: valeurs.camp });
    toast(`Bienvenue chez les ${CAMPS[valeurs.camp].plural}, ${valeurs.pseudo.trim()} !`);
  }
  return r.statut;
}

/** R-029: right after joining as rich, the account waits for a moderator: show the prices. */
export function ouvrirPrixApresInscription(pseudo) {
  import('./riche-attente.js').then(async (m) => {
    const s = await api.getSession();
    try { sessionStorage.setItem(`wp:prix-riche:${s.userId}`, '1'); } catch { /* ignore */ }
    m.ouvrirPrixRiche(pseudo.trim());
  }).catch(toastError);
}

function messageDejaMembre() {
  return h('div', { class: 'succes' },
    h('p', { class: 'grand' }, 'Tu as déjà un compte !'),
    h('p', {}, CONFIG.MODE === 'demo'
      ? 'Tu as déjà un compte : en vrai, on t’enverrait un lien de connexion. En mode démo, utilise « Déjà membre ? » pour te connecter directement.'
      : 'Tu as déjà un compte : on t’a envoyé un lien de connexion. Ouvre-le sur cet appareil.'));
}

/**
 * "Choisis ton camp" dialog.
 * detail: { camp, apres: function to run after success (the action the visitor wanted), raison }
 */
export function ouvrirRejoindre({ camp = null, apres = null, raison = '' } = {}) {
  const form = h('form', { novalidate: true });
  const f = champsRejoindre({ camp });
  const zoneTs = h('div', { class: 'turnstile-zone' });
  const erreur = boiteErreur();
  const submit = h('button', { type: 'submit', class: 'btn btn-primaire btn-bloc mt-24' }, 'C’est parti', icon('arrow-right', { className: 'fleche' }));
  const dejaMembre = h('button', { type: 'button', class: 'lien' }, 'Déjà membre ? Reçois un lien de connexion');

  form.append(
    raison ? h('p', { class: 'gris' }, raison) : h('p', { class: 'gris' }, 'Riche ou pauvre, un pseudo, un e-mail. 10 secondes, promis.'),
    ...f.nodes, zoneTs, erreur.el, submit,
    h('p', { class: 'sous-bouton' }, SOUS_BOUTON),
    h('p', { class: 'mentions' }, INFO_DONNEES),
    h('p', { class: 'centre mt-16' }, dejaMembre)
  );

  const { body, close } = openDialog({ title: 'Choisis ton camp', content: [form], onClose: () => turnstile.destroy() });
  const turnstile = creerTurnstile(zoneTs);
  dejaMembre.addEventListener('click', () => { close(); ouvrirReconnexion(); });
  setTimeout(() => (camp ? f.champs.pseudo.focus() : f.champs.camps.focus()), 50);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erreur.hide();
    if (!f.valider()) return;
    const v = f.valeurs();
    chargement(submit, true, 'On t’installe…');
    try {
      const statut = await executerRejoindre(v, turnstile);
      if (statut === 'deja_membre') {
        body.replaceChildren(messageDejaMembre(), h('p', { class: 'centre mt-16' },
          h('button', { type: 'button', class: 'btn btn-primaire', onclick: () => { close(); ouvrirReconnexion({ email: v.email }); } }, 'Recevoir un lien de connexion')));
        return;
      }
      close();
      if (v.camp === 'riche') ouvrirPrixApresInscription(v.pseudo);
      else if (typeof apres === 'function') setTimeout(() => apres(), 350);
    } catch (err) {
      erreur.show(err.message || 'Oups, quelque chose a coincé. Réessaie.');
    } finally {
      chargement(submit, false);
    }
  });
}

/** Parcours C: "Déjà membre ?" → magic link (demo: direct sign-in). */
export function ouvrirReconnexion({ email = '' } = {}) {
  const form = h('form', { novalidate: true });
  const mail = champ({ name: 'email', label: 'Ton e-mail', type: 'email', check: 'email', autocomplete: 'email', inputmode: 'email', value: email });
  const zoneTs = h('div', { class: 'turnstile-zone' });
  const erreur = boiteErreur();
  const submit = h('button', { type: 'submit', class: 'btn btn-primaire btn-bloc mt-24' }, CONFIG.MODE === 'demo' ? 'Me connecter' : 'Recevoir mon lien', icon('arrow-right', { className: 'fleche' }));
  form.append(
    h('p', { class: 'gris' }, CONFIG.MODE === 'demo'
      ? 'Mode démo : pas d’e-mail, on te connecte directement. Essaie par exemple membre1@exemple.invalid (un riche) ou membre20@exemple.invalid (un pauvre).'
      : 'On t’envoie un lien de connexion par e-mail. Pas de mot de passe, jamais.'),
    mail.wrap, zoneTs, erreur.el, submit,
    h('p', { class: 'sous-bouton' }, 'Pas encore membre ? ', h('button', { type: 'button', class: 'lien', onclick: () => { close(); ouvrirRejoindre(); } }, 'Rejoins un camp'))
  );
  const { body, close } = openDialog({ title: 'Déjà membre ?', content: [form], onClose: () => turnstile.destroy() });
  const turnstile = creerTurnstile(zoneTs);
  setTimeout(() => mail.focus(), 50);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erreur.hide();
    if (mail.validate()) { mail.focus(); return; }
    chargement(submit, true, 'Envoi…');
    try {
      const r = await api.seReconnecter(mail.value().trim(), { getCaptchaToken: () => turnstile.getToken() });
      if (r.statut === 'connecte') {
        const s = await api.getSession();
        close();
        toast(`Re-bonjour ${s.profil ? s.profil.pseudo : ''} !`);
        return;
      }
      body.replaceChildren(h('div', { class: 'succes' },
        h('p', { class: 'grand' }, 'Lien envoyé !'),
        h('p', {}, 'Regarde ta boîte mail (et les indésirables, on est encore jeunes). Ouvre le lien sur cet appareil.')));
    } catch (err) {
      erreur.show(err.message);
      if (err.code === 'aucun_compte') {
        erreur.el.appendChild(document.createTextNode(' '));
        erreur.el.appendChild(h('button', { type: 'button', class: 'lien', onclick: () => { close(); ouvrirRejoindre(); } }, 'Rejoindre un camp'));
      }
    } finally {
      chargement(submit, false);
    }
  });
}

/** Sign out with feedback. */
export async function deconnecter() {
  try {
    await api.seDeconnecter();
    toast('À bientôt ! Ton camp t’attend.');
  } catch (e) {
    toastError(e);
  }
}
