// Mon espace (brief visuel §6.6, parcours G).

import { CONFIG } from './config.js';
import { api } from './api.js';
import { h, clear, formatDate, formatJour, formatNumber, toast, toastError, confirmDialog, openDialog } from './ui.js';
import { icon } from './icons.js';
import { CAMPS } from './categories.js';
import { champ, caseACocher, boiteErreur, chargement } from './champs.js';
import { lienParrainage } from './parrainage.js';
import { barrePartage, urlProbleme, texteProbleme, partageNatif, copierLien } from './partage.js';
import { intent } from './layout.js';
import { CLUBS } from './club.js';
import { phraseRang, partagerRang } from './palmares.js';
import { LIBELLE_NEWSLETTER } from './auth-textes.js';
import { FORMULES, richeEnAttente, ecranPrixRiche, ouvrirPrixRiche } from './riche-attente.js';
import { montantAffiche } from './riens.js';

const STATUTS = {
  recu: { label: 'En relecture', classe: '' },
  publie: { label: 'Publié', classe: 'publie' },
  refuse: { label: 'Non publié', classe: 'refuse' },
  reoriente: { label: 'Non publié', classe: 'reoriente' }
};

export async function monterEspace(zone) {
  let e;
  try {
    e = await api.getMonEspace();
  } catch (err) {
    if (err.code === 'non_connecte' || err.code === 'profil_absent') { invitation(zone); return; }
    toastError(err);
    zone.replaceChildren(h('p', { class: 'erreur-form' }, err.message));
    return;
  }
  const camp = CAMPS[e.camp];
  clear(zone);
  const grille = h('div', { class: 'espace-grille' });
  zone.appendChild(grille);

  /* ---------- Identity card ---------- */
  const nom = h('p', { class: 'nom' }, e.pseudo);
  grille.appendChild(h('section', { class: 'bloc pleine', 'aria-labelledby': 'titre-identite' },
    h('h2', { class: 'visually-hidden', id: 'titre-identite' }, 'Ma carte d’identité'),
    h('div', { class: 'carte-identite' },
      h('div', { class: `avatar rond camp-${camp.id}` }, icon(camp.icon)),
      h('div', { class: 'identite-infos' },
        nom,
        h('p', { class: 'identite-badges' }, h('span', { class: `badge badge-${camp.id}` }, icon(camp.icon), `Camp des ${camp.plural}`),
          e.verifie ? h('span', { class: 'badge badge-sombre' }, icon('check'), 'Milliardaire vérifié') : null)),
      h('div', { class: 'identite-actions' },
        h('button', { type: 'button', class: 'btn btn-fantome btn-petit', onclick: () => modifierPseudo(e, nom) }, 'Modifier mon pseudo'),
        h('button', { type: 'button', class: 'btn btn-secondaire btn-petit', onclick: () => changerCamp(e) }, icon('switch'), 'Changer de camp'))),
    e.bloque ? h('p', { class: 'erreur-form' }, 'Ton compte est bloqué : tu peux lire le site, mais plus publier, réagir ni écrire.') : null,
    e.camp === 'riche' && e.statut_riche === 'actif' && e.riche_jusqu_au
      ? h('p', { class: 'gris mt-8' }, `Riche validé jusqu’au ${formatJour(e.riche_jusqu_au)}${e.riche_formule ? ` (formule ${FORMULES[e.riche_formule] ? FORMULES[e.riche_formule].nom : e.riche_formule})` : ''}.`)
      : null,
    !e.email_confirme ? confirmation(e) : null
  ));

  /* ---------- Rich waiting for a moderator (R-029) ---------- */
  if (richeEnAttente(e)) {
    grille.appendChild(h('section', { class: 'bloc pleine bloc-riche-attente', 'aria-labelledby': 'titre-riche-attente' },
      h('h2', { id: 'titre-riche-attente' }, 'Être riche sur Qui paie ?'),
      h('p', { class: 'gris mt-8' }, 'Ton compte riche attend la validation d’un modérateur. En attendant, tu peux tout lire, mais pas encore publier, réagir, commenter ni écrire au club des riches.'),
      ecranPrixRiche(e.pseudo)));
  }

  /* ---------- Poor: my total and my rank (R-028) ---------- */
  if (e.camp === 'pauvre') grille.appendChild(blocRang(e));

  /* ---------- Referral ---------- */
  const lien = lienParrainage(e.code_partage);
  grille.appendChild(h('section', { class: 'bloc', 'aria-labelledby': 'titre-parrainage' },
    h('h2', { id: 'titre-parrainage' }, 'Fais venir du monde'),
    h('p', { class: 'gris mt-8' }, e.nb_invites
      ? `Tu as fait venir ${formatNumber(e.nb_invites)} personne${e.nb_invites > 1 ? 's' : ''}. Le match ${camp.id === 'riche' ? 'penche un peu plus de ton côté' : 'n’a qu’à bien se tenir'}.`
      : 'Tu as fait venir 0 personne. Pour l’instant.'),
    h('div', { class: 'lien-parrainage' },
      h('code', {}, lien),
      h('button', { type: 'button', class: 'btn btn-primaire btn-petit', onclick: () => copierLien(lien) }, icon('copy'), 'Copier'),
      navigator.share ? h('button', { type: 'button', class: 'btn btn-secondaire btn-petit', onclick: () => partageNatif({ title: 'Qui paie ?', text: 'Rejoins-moi sur Qui paie ? Riches contre Pauvres, zéro argent, beaucoup de problèmes.', url: lien }) }, icon('share'), 'Partager') : null)
  ));

  /* ---------- Club shortcut ---------- */
  grille.appendChild(h('section', { class: 'bloc', 'aria-labelledby': 'titre-club' },
    h('h2', { id: 'titre-club' }, CLUBS[camp.id].titre),
    h('p', { class: 'gris mt-8' }, CLUBS[camp.id].accroche),
    h('a', { class: `btn ${camp.id === 'riche' ? 'btn-primaire' : 'btn-lavande'} mt-16`, href: 'club.html' }, 'Ouvrir mon club', icon('arrow-right', { className: 'fleche' }))));

  /* ---------- My problems ---------- */
  const liste = h('ul', { class: 'mes-problemes' });
  grille.appendChild(h('section', { class: 'bloc pleine', 'aria-labelledby': 'titre-mes-problemes' },
    h('h2', { id: 'titre-mes-problemes' }, 'Mes problèmes'),
    liste,
    h('button', { type: 'button', class: 'btn btn-primaire btn-petit mt-16', onclick: () => intent('publier') }, 'Publier un problème', icon('arrow-right', { className: 'fleche' }))));
  if (!e.problemes.length) liste.appendChild(h('li', { class: 'gris' }, 'Aucun problème publié. Tu es soit très heureux, soit très discret.'));
  for (const p of e.problemes) liste.appendChild(ligneProbleme(p, e, () => monterEspace(zone)));

  /* ---------- Rich: what I would fund ---------- */
  if (e.camp === 'riche') grille.appendChild(blocRiche(e));

  /* ---------- Preferences & account ---------- */
  const news = caseACocher({ name: 'newsletter', label: LIBELLE_NEWSLETTER, checked: !!e.newsletter });
  news.input.addEventListener('change', async () => {
    try {
      await api.majProfil({ newsletter: news.input.checked });
      toast(news.input.checked ? 'C’est noté, on te tiendra au courant.' : 'Plus de nouvelles. Promis.');
    } catch (err) { news.input.checked = !news.input.checked; toastError(err); }
  });
  grille.appendChild(h('section', { class: 'bloc pleine zone-danger', 'aria-labelledby': 'titre-compte' },
    h('h2', { id: 'titre-compte' }, 'Mon compte'),
    h('p', { class: 'gris mt-8' }, 'E-mail : ', h('strong', {}, e.email)),
    news.wrap,
    h('div', { class: 'hero-actions' },
      h('button', { type: 'button', class: 'btn btn-fantome', onclick: deconnexion }, icon('logout'), 'Se déconnecter'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: () => supprimer(e) }, icon('trash'), 'Supprimer mon compte'))));
  zone.closest('main').setAttribute('aria-busy', 'false');
}

/** "Mon total : 3 problèmes · 4,25x Rien" + "Ton rang : 42ᵉ sur 312 pauvres" (R-028). */
function blocRang(e) {
  const total = h('p', { class: 'total-pauvre' }, '…');
  const rang = h('p', { class: 'gris mt-8' });
  const partager = h('button', { type: 'button', class: 'btn btn-secondaire btn-petit', hidden: true }, icon('share'), 'Partager mon rang');
  const bloc = h('section', { class: 'bloc mon-rang', 'aria-labelledby': 'titre-rang' },
    h('h2', { id: 'titre-rang' }, 'Mon palmarès'),
    total, rang,
    h('div', { class: 'hero-actions' },
      h('a', { class: 'btn btn-lavande btn-petit', href: 'palmares.html' }, 'Voir le palmarès', icon('arrow-right', { className: 'fleche' })),
      partager));
  api.getMonRang().then((mon) => {
    if (!mon) { bloc.hidden = true; return; }
    const m = montantAffiche(mon.total, { zero: true });
    total.replaceChildren('Mon total : ', h('span', { class: 'montant-riens' }, m.principal),
      h('span', { class: 'montant-euros' }, `${m.euros} · ${formatNumber(mon.nb)} problème${mon.nb > 1 ? 's' : ''}`));
    rang.textContent = phraseRang(mon);
    partager.hidden = !mon.rang;
    partager.onclick = () => partagerRang(mon, e.code_partage);
  }, () => { bloc.hidden = true; });
  return bloc;
}

function invitation(zone) {
  zone.replaceChildren(h('div', { class: 'reserve' },
    h('img', { class: 'icone-reserve', src: 'assets/img/question.svg', alt: '', width: '72', height: '72' }),
    h('h2', { class: 'section-titre mt-16' }, 'Tu n’as pas encore de camp.'),
    h('p', {}, 'Mon espace, c’est pour les membres : ton camp, tes problèmes, ton lien de parrainage.'),
    h('div', { class: 'hero-actions', style: { justifyContent: 'center' } },
      h('button', { type: 'button', class: 'btn btn-primaire', onclick: () => intent('rejoindre') }, 'Rejoindre un camp', icon('arrow-right', { className: 'fleche' })),
      h('button', { type: 'button', class: 'btn btn-secondaire', onclick: () => intent('reconnecter') }, 'Déjà membre ?'))));
  zone.closest('main').setAttribute('aria-busy', 'false');
}

function confirmation() {
  const btn = h('button', { type: 'button', class: 'btn btn-fantome btn-petit' }, icon('mail'), 'Renvoyer l’e-mail de confirmation');
  const note = h('p', { class: 'erreur-form mt-8', role: 'status', hidden: true }, 'Cette adresse est déjà liée à un autre compte. Pour le retrouver, utilise « Déjà membre ? » avec cette adresse.');
  const emailPris = () => { note.hidden = false; };
  btn.addEventListener('click', async () => {
    chargement(btn, true, 'Envoi…');
    try {
      const r = await api.renvoyerConfirmation();
      note.hidden = true;
      toast(r.statut === 'confirme' ? 'Mode démo : e-mail considéré comme confirmé.' : 'E-mail envoyé. Pense à regarder les indésirables.');
    } catch (err) {
      if (err.code === 'email_pris') emailPris(); else toastError(err);
    } finally { chargement(btn, false); }
  });
  // R-024: same attempt as page.js (never a second e-mail)
  api.rattraperEmail().then((r) => {
    if (r.statut === 'email_pris') emailPris();
    else if (r.statut === 'rattache' && !r.deja) toast('On vient de t’envoyer l’e-mail de confirmation. Pense à regarder les indésirables.');
  });
  return h('div', { class: 'avertissement' }, icon('info'),
    h('div', {},
      h('p', {}, 'Ton e-mail n’est pas encore confirmé. Sans confirmation, ton compte reste lié à ce navigateur : si tu le vides, tu perds l’accès.'),
      note,
      h('p', { class: 'mt-8' }, btn)));
}

function ligneProbleme(p, e, recharger) {
  const st = STATUTS[p.statut] || STATUTS.recu;
  const actions = h('div', { class: 'actions' }, h('span', { class: `badge badge-statut ${st.classe}` }, p.masque ? 'Masqué' : st.label));
  if (p.statut === 'publie' && !p.masque) {
    const url = urlProbleme(p.id, e.code_partage);
    actions.append(
      h('a', { class: 'btn btn-fantome btn-petit', href: `p.html?id=${encodeURIComponent(p.id)}` }, 'Voir'),
      h('button', { type: 'button', class: 'btn btn-primaire btn-petit', onclick: async () => { const ok = await partageNatif({ title: p.titre, text: texteProbleme(p.titre, url), url }); if (!ok) openPartage(p, url); } }, icon('share'), 'Partager'));
  }
  if (p.statut === 'reoriente') actions.append(h('a', { class: 'lien petit', href: 'aide.html' }, 'Besoin d’une vraie aide ?'));
  if (p.statut === 'recu' && CONFIG.MODE === 'demo') {
    actions.append(h('button', {
      type: 'button', class: 'btn btn-fantome btn-petit', title: 'Mode démo uniquement : simule la modération',
      onclick: async () => { const admin = await api.demoAdmin(); await admin.publier(p.id); toast('Mode démo : problème publié par la « modération ».'); recharger(); }
    }, '(Démo) Publier'));
  }
  return h('li', {},
    h('div', { style: { minWidth: '0', flex: '1 1 260px' } },
      h('p', { class: 'titre' }, p.titre),
      h('p', { class: 'date' }, `Envoyé ${formatDate(p.cree_le)}`)),
    actions);
}

function openPartage(p, url) {
  const ok = h('button', { type: 'button', class: 'btn btn-primaire' }, 'Fermer');
  const { close } = openDialog({ title: 'Partager', content: [h('p', {}, p.titre), barrePartage({ texte: texteProbleme(p.titre, url), url, titre: p.titre })], footer: [ok] });
  ok.addEventListener('click', () => close());
}

function blocRiche(e) {
  const message = champ({ name: 'riche_message', label: 'Ce que je serais prêt à financer', min: 0, max: 500, multiline: true, rows: 3, required: false, libelle: 'Ton message', value: e.riche_message || '', placeholder: 'Ex. : une boulangerie de quartier qui ne ferme jamais.' });
  const montant = champ({ name: 'riche_montant', label: 'Montant indicatif (€)', required: false, check: 'montant', inputmode: 'numeric', maxValue: 10000000, value: e.riche_montant ?? '', help: 'Purement indicatif. Aucun paiement ne passe par ce site.' });
  const erreur = boiteErreur();
  const btn = h('button', { type: 'submit', class: 'btn btn-primaire mt-16' }, 'Enregistrer');
  const form = h('form', { novalidate: true }, message.wrap, montant.wrap, erreur.el, btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erreur.hide();
    if (message.validate() || montant.validate()) return;
    chargement(btn, true, 'Enregistrement…');
    try {
      const m = montant.value().replace(/\s/g, '');
      await api.majProfil({ riche_message: message.value().trim() || null, riche_montant: m === '' ? null : Number(m) });
      toast('C’est noté. Les pauvres n’en reviennent pas.');
    } catch (err) { erreur.show(err.message); } finally { chargement(btn, false); }
  });
  return h('section', { class: 'bloc pleine', 'aria-labelledby': 'titre-riche' },
    h('h2', { id: 'titre-riche' }, 'Vous avez trop d’argent ?'),
    h('p', { class: 'gris mt-8' }, 'Dites-nous quel genre de problème vous plairait. C’est pour le plaisir : ici, personne ne paie.'),
    form);
}

async function modifierPseudo(e, nomEl) {
  const f = champ({ name: 'pseudo', label: 'Nouveau pseudo', min: 2, max: 30, libelle: 'Ton pseudo', value: e.pseudo });
  const erreur = boiteErreur();
  const ok = h('button', { type: 'submit', class: 'btn btn-primaire mt-16' }, 'Enregistrer');
  const form = h('form', { novalidate: true }, f.wrap, erreur.el, ok);
  const { close } = openDialog({ title: 'Modifier mon pseudo', content: [form] });
  setTimeout(() => f.focus(), 50);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (f.validate()) return;
    chargement(ok, true);
    try {
      const r = await api.majProfil({ pseudo: f.value() });
      e.pseudo = r.pseudo;
      nomEl.textContent = r.pseudo;
      close();
      toast('Pseudo mis à jour.');
    } catch (err) { erreur.show(err.message); } finally { chargement(ok, false); }
  });
}

async function changerCamp(e) {
  const actuel = CAMPS[e.camp];
  const autre = CAMPS[e.camp === 'riche' ? 'pauvre' : 'riche'];
  const ok = await confirmDialog({
    title: `Passer chez les ${autre.plural} ?`,
    message: autre.id === 'riche'
      ? 'Tu quittes le club des pauvres. Un compte riche doit être validé par un modérateur : en attendant, tu pourras tout lire, mais ni publier, ni réagir, ni écrire.'
      : `Tu quittes le club des ${actuel.plural}. Tu rejoins le club des ${autre.plural} et le score du match change.`,
    confirmLabel: `Devenir ${autre.label.toLowerCase()}`
  });
  if (!ok) return;
  try {
    const r = await api.majProfil({ camp: autre.id });
    if (r.statut_riche === 'en_attente') ouvrirPrixRiche(r.pseudo);
    else toast(`Bienvenue chez les ${autre.plural} !`);
  } catch (err) { toastError(err); }
}

async function deconnexion() {
  try {
    await api.seDeconnecter();
    toast('À bientôt ! Ton camp t’attend.');
    setTimeout(() => { location.href = 'index.html'; }, 600);
  } catch (err) { toastError(err); }
}

async function supprimer() {
  const ok = await confirmDialog({
    title: 'Supprimer ton compte ?',
    message: 'Ton profil, tes problèmes, tes réactions, tes commentaires et tes messages seront effacés pour de bon. Impossible de revenir en arrière.',
    confirmLabel: 'Tout supprimer',
    danger: true
  });
  if (!ok) return;
  try {
    await api.supprimerMonCompte();
    toast('Compte supprimé. Merci d’être passé, et bonne chance avec tes problèmes.');
    setTimeout(() => { location.href = 'index.html'; }, 1200);
  } catch (err) { toastError(err); }
}
