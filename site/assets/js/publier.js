// Parcours D — "Publier un problème" dialog. Visitors get the join fields on top (one single submit).

import { api } from './api.js';
import { h, openDialog, toastError } from './ui.js';
import { icon } from './icons.js';
import { CATEGORIES, isCategory } from './categories.js';
import { champ, boiteErreur, chargement } from './champs.js';
import { champsRejoindre, executerRejoindre, INFO_DONNEES } from './auth.js';
import { creerTurnstile } from './turnstile.js';
import { session } from './page.js';
import { barrePartage, urlProbleme, texteProbleme } from './partage.js';

/** Success screen when the problem is published at once (R-017): view it, share it, story card. */
async function ecranEnLigne(id, titreSaisi) {
  let s = null;
  try { s = await api.getSession(); } catch { /* no referral code then */ }
  const url = urlProbleme(id, s && s.profil ? s.profil.code_partage : null);
  let p = null;
  try { p = await api.getProblemePublic(id); } catch { /* the story button is hidden then */ }
  const titre = p ? p.titre : titreSaisi;
  const story = h('button', { type: 'button', class: 'btn btn-secondaire' }, icon('download'), 'Télécharger la carte story');
  story.addEventListener('click', async () => {
    story.setAttribute('aria-busy', 'true');
    try {
      const { ouvrirStory } = await import('./story.js');
      await ouvrirStory(p, { url });
    } catch (e) { toastError(e); } finally { story.removeAttribute('aria-busy'); }
  });
  return h('div', { class: 'succes' },
    h('p', { class: 'grand' }, 'C’est en ligne !'),
    h('p', {}, 'Ton problème attend son milliardaire. Partage-le maintenant : plus il circule, plus il a de chances de tomber sur la bonne personne.'),
    h('div', { class: 'actions-probleme' },
      h('a', { class: 'btn btn-primaire', href: `p.html?id=${encodeURIComponent(id)}` }, 'Voir mon problème', icon('arrow-right', { className: 'fleche' })),
      p ? story : null),
    barrePartage({ texte: texteProbleme(titre, url), url, titre }));
}

/** Success screen when the problem waits for a human review (sensitive words or pre-moderation). */
function ecranRecu() {
  return h('div', { class: 'succes' },
    h('p', { class: 'grand' }, 'Reçu !'),
    h('p', {}, 'On le relit avant de le mettre en ligne. Suis son statut dans Mon espace.'),
    h('a', { class: 'btn btn-primaire', href: 'espace.html' }, 'Mon espace', icon('arrow-right', { className: 'fleche' })),
    h('p', { class: 'gris petit mt-16' }, 'Si tu traverses un moment difficile, ',
      h('a', { href: 'aide.html' }, 'des personnes peuvent t’aider, gratuitement'), '.'));
}

export async function ouvrirPublier({ categorie = null } = {}) {
  let s = session();
  try { s = await api.getSession(); } catch { /* keep cached */ }
  const membre = !!(s && s.profil);
  if (membre && s.profil.bloque) {
    toastError({ message: 'Ton compte est bloqué : tu ne peux plus publier, réagir ni écrire.' });
    return;
  }

  const form = h('form', { novalidate: true });
  const rejoindre = membre ? null : champsRejoindre();
  const zoneTs = h('div', { class: 'turnstile-zone' });

  // Category
  const select = h('select', { id: 'pub-categorie', name: 'categorie', required: true },
    h('option', { value: '' }, 'Choisis une catégorie…'),
    CATEGORIES.map((c) => h('option', { value: c.id }, c.label)));
  if (isCategory(categorie)) select.value = categorie;
  const erreurCat = h('p', { class: 'erreur', role: 'alert', hidden: true });
  const champCat = h('div', { class: 'champ' }, h('label', { for: 'pub-categorie' }, 'Catégorie'), select, erreurCat);

  const titre = champ({ name: 'titre', label: 'Ton problème en une phrase', min: 3, max: 80, libelle: 'Le titre', placeholder: 'Ex. : Mon frigo fait de l’écho.' });
  const texte = champ({ name: 'texte', label: 'Raconte', min: 10, max: 600, multiline: true, rows: 5, libelle: 'Le texte', placeholder: 'Avec humour si tu peux. Sans vrai nom, sans adresse.' });
  const montant = champ({ name: 'montant', label: 'Montant recherché (€)', required: false, check: 'montant', inputmode: 'numeric', maxValue: 1000000, help: 'Indicatif. Personne ne paiera ici : c’est un projet test, sans aucune collecte.' });

  const erreur = boiteErreur();
  const submit = h('button', { type: 'submit', class: 'btn btn-primaire btn-bloc mt-24' }, membre ? 'Envoyer mon problème' : 'Rejoindre et envoyer', icon('arrow-right', { className: 'fleche' }));

  form.append(
    ...(rejoindre ? [h('p', { class: 'etiquette-section' }, '1. Choisis ton camp'), ...rejoindre.nodes, h('div', { class: 'separateur' }), h('p', { class: 'etiquette-section' }, '2. Ton problème')] : []),
    champCat, titre.wrap, texte.wrap, montant.wrap,
    h('div', { class: 'avertissement' }, icon('alert-triangle'),
      h('span', {}, 'Ni vrai nom, ni adresse, ni informations de santé. Ton problème est filtré puis mis en ligne tout de suite. Besoin d’une aide réelle ? ',
        h('a', { href: 'aide.html' }, 'On t’oriente ici.'))),
    zoneTs, erreur.el, submit,
    rejoindre ? h('p', { class: 'mentions' }, INFO_DONNEES) : null
  );

  const { body, close } = openDialog({ title: 'Publier un problème', content: [form], onClose: () => turnstile.destroy() });
  const turnstile = creerTurnstile(membre ? h('div') : zoneTs);
  setTimeout(() => (rejoindre ? rejoindre.champs.camps.focus() : select.focus()), 50);

  const validerProbleme = () => {
    const msgCat = select.value ? null : 'Choisis une catégorie.';
    erreurCat.textContent = msgCat || '';
    erreurCat.hidden = !msgCat;
    select.setAttribute('aria-invalid', msgCat ? 'true' : 'false');
    const errs = [msgCat, titre.validate(), texte.validate(), montant.validate()];
    if (errs[0]) select.focus();
    else if (errs[1]) titre.focus();
    else if (errs[2]) texte.focus();
    else if (errs[3]) montant.focus();
    return !errs.some(Boolean);
  };
  select.addEventListener('change', () => { if (select.value) { erreurCat.hidden = true; select.removeAttribute('aria-invalid'); } });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erreur.hide();
    const okRejoindre = rejoindre ? rejoindre.valider() : true;
    const okProbleme = validerProbleme();
    if (!okRejoindre || !okProbleme) return;
    chargement(submit, true, 'Envoi…');
    try {
      const deja = await api.getSession();
      if (rejoindre && !(deja && deja.profil)) {
        const statut = await executerRejoindre(rejoindre.valeurs(), turnstile);
        if (statut === 'deja_membre') {
          erreur.show('Tu as déjà un compte avec cet e-mail. Connecte-toi avec « Déjà membre ? », puis renvoie ton problème : on a gardé ton texte ici.');
          return;
        }
      }
      const m = montant.value().replace(/\s/g, '');
      const r = await api.soumettreProbleme({ categorie: select.value, titre: titre.value(), texte: texte.value(), montant: m === '' ? null : Number(m) });
      document.dispatchEvent(new CustomEvent('wp:probleme-soumis'));
      body.replaceChildren(r && r.statut === 'publie' ? await ecranEnLigne(r.id, titre.value()) : ecranRecu());
    } catch (err) {
      erreur.show(err.message || 'Oups, quelque chose a coincé. Réessaie.');
    } finally {
      chargement(submit, false);
    }
  });
}
