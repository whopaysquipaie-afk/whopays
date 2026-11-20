// moderation.html — private moderation page (R-018), designed for a phone (360 px, big buttons).
// Linked from nowhere, noindex, never cached by the service worker. Every action is checked
// server-side (mod_* functions, 006_moderateurs.sql): this page only displays what they allow.
import { initPage, session as sessionCourante } from '../page.js';
import { intent } from '../layout.js';
import { h, $, clear, toast, toastError, confirmDialog, copyText, formatDate, plural } from '../ui.js';
import { category, CAMPS } from '../categories.js';
import { createModerationApi } from '../moderation.js';

const ONGLETS = [
  { id: 'a-relire', label: 'À relire', vide: 'Rien à relire. Les problèmes sensibles arrivent ici.' },
  { id: 'recents', label: 'Récents 48 h', vide: 'Aucun problème publié ces dernières 48 heures.' },
  { id: 'signales', label: 'Signalés', vide: 'Aucun signalement ces dernières 24 heures.' },
  { id: 'masques', label: 'Masqués', vide: 'Aucun contenu masqué.' }
];
const TYPES = { probleme: 'Problème', commentaire: 'Commentaire', message: 'Message de club' };
const STATUTS = { recu: 'À relire', publie: 'Publié', refuse: 'Refusé', reoriente: 'Réorienté' };

await initPage('moderation', { mobileCta: false });
const zone = $('#moderation');
const main = $('#contenu');
const mod = await createModerationApi();
let onglet = 'a-relire';
let donnees = { 'a-relire': [], recents: [], signales: [], masques: [] };

await afficher();
document.addEventListener('wp:session-maj', () => afficher());

/* ---------------- Access ---------------- */

async function afficher() {
  main.setAttribute('aria-busy', 'true');
  clear(zone);
  try {
    const courante = sessionCourante();
    const s = courante && courante.connecte ? courante : null;
    if (await mod.suisJe()) {
      await chargerTout();
      return;
    }
    accesReserve(s);
  } catch (e) {
    zone.appendChild(h('p', { class: 'modo-erreur', role: 'alert' }, e.message || 'Chargement impossible.'));
  } finally {
    main.removeAttribute('aria-busy');
  }
}

function accesReserve(s) {
  const blocs = [h('h2', {}, 'Accès réservé'), h('p', {}, 'Cette page est réservée aux modérateurs du site.')];
  if (!s || !s.userId) {
    blocs.push(h('p', {}, 'Connecte-toi d’abord avec ton compte de membre, puis reviens sur cette page.'));
    blocs.push(h('button', { type: 'button', class: 'btn btn-primaire btn-bloc', onclick: () => intent('reconnecter') }, 'Déjà membre ? Se connecter'));
  } else {
    const id = s.userId;
    blocs.push(
      h('p', {}, 'Ton identifiant de membre (à donner à l’administrateur pour devenir modérateur) :'),
      h('code', { class: 'modo-identifiant' }, id),
      h('button', {
        type: 'button', class: 'btn btn-fantome btn-bloc',
        onclick: async () => toast(await copyText(id) ? 'Identifiant copié.' : 'Copie impossible : sélectionne-le à la main.')
      }, 'Copier mon identifiant')
    );
  }
  if (mod.mode === 'demo') {
    blocs.push(h('p', { class: 'modo-note' }, 'Mode démo : la modération est simulée dans ce navigateur.'));
    blocs.push(h('button', { type: 'button', class: 'btn btn-lavande btn-bloc', onclick: devenirModoDemo }, '(Démo) Essayer en modérateur'));
  }
  zone.appendChild(h('section', { class: 'modo-acces' }, blocs));
}

/** Demo only: signs in as the current member (or the first demo member) and makes them a moderator. */
async function devenirModoDemo() {
  try {
    const admin = mod.demoAdmin;
    const s = sessionCourante();
    let userId = s && s.connecte && s.profil ? s.userId : null;
    if (!userId) {
      userId = admin.membres()[0].id;
      await admin.connecterEnTantQue(userId);
    }
    await admin.setModerateur(userId, true);
    location.reload();
  } catch (e) {
    toastError(e);
  }
}

/* ---------------- Data ---------------- */

async function chargerTout() {
  const [aRelire, recents, signales, masques] = await Promise.all([
    mod.aRelire(), mod.recents(48), mod.signalements24h(), mod.masques()
  ]);
  donnees = { 'a-relire': aRelire, recents, signales, masques };
  dessiner();
}

async function action(fn, message) {
  try {
    await fn();
    toast(message);
    await chargerTout();
  } catch (e) {
    toastError(e);
    dessiner(); // re-enables the button that was disabled on click
  }
}

/* ---------------- Rendering ---------------- */

function dessiner() {
  clear(zone);
  const tabs = h('div', { class: 'modo-onglets', role: 'tablist', 'aria-label': 'Files de modération' });
  const panneau = h('div', { class: 'modo-panneau', role: 'tabpanel', id: 'modo-panneau', tabindex: '-1' });
  ONGLETS.forEach((o, i) => {
    const actif = o.id === onglet;
    const b = h('button', {
      type: 'button', role: 'tab', id: `onglet-${o.id}`, class: 'modo-onglet',
      'aria-selected': actif ? 'true' : 'false', 'aria-controls': 'modo-panneau', tabindex: actif ? '0' : '-1',
      onclick: () => { onglet = o.id; dessiner(); $(`#onglet-${o.id}`).focus(); },
      onkeydown: (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const n = ONGLETS[(i + (e.key === 'ArrowRight' ? 1 : ONGLETS.length - 1)) % ONGLETS.length];
        onglet = n.id; dessiner(); $(`#onglet-${n.id}`).focus();
      }
    }, o.label, h('span', { class: 'modo-compte' }, String(donnees[o.id].length)));
    tabs.appendChild(b);
  });
  panneau.setAttribute('aria-labelledby', `onglet-${onglet}`);

  const liste = donnees[onglet];
  const def = ONGLETS.find((o) => o.id === onglet);
  if (!liste.length) panneau.appendChild(h('p', { class: 'modo-vide' }, def.vide));
  for (const item of liste) panneau.appendChild(onglet === 'a-relire' || onglet === 'recents' ? carteProbleme(item) : carteCible(item));

  zone.append(
    h('div', { class: 'modo-barre' },
      h('p', { class: 'modo-note' }, mod.mode === 'demo' ? 'Mode démo : actions simulées dans ce navigateur.' : 'Chaque action est appliquée tout de suite sur le site.'),
      h('button', { type: 'button', class: 'btn btn-fantome btn-petit', onclick: () => action(async () => {}, 'Listes à jour.') }, 'Actualiser')),
    tabs, panneau
  );
}

function badges(item, type) {
  const cat = type === 'probleme' && item.categorie ? category(item.categorie) : null;
  return h('div', { class: 'modo-badges' },
    h('span', { class: 'badge badge-sombre' }, TYPES[type] || type),
    cat ? h('span', { class: 'badge badge-sombre' }, cat.label) : null,
    item.statut ? h('span', { class: `badge badge-statut ${item.statut}` }, STATUTS[item.statut] || item.statut) : null,
    item.masque ? h('span', { class: 'badge badge-statut refuse' }, 'Masqué') : null,
    item.nb_signalements ? h('span', { class: 'badge badge-statut refuse' }, plural(item.nb_signalements, 'signalement', 'signalements')) : null
  );
}

function auteur(item, date) {
  const camp = item.camp && CAMPS[item.camp] ? ` (${CAMPS[item.camp].label.toLowerCase()})` : '';
  return h('p', { class: 'modo-meta' },
    item.pseudo ? `${item.pseudo}${camp}` : (item.user_id ? 'Membre parti' : 'L’équipe'),
    date ? ` · ${formatDate(date)}` : '',
    item.bloque ? h('span', { class: 'badge badge-statut refuse' }, 'Auteur bloqué') : null,
    typeof item.auteur_nb_publies === 'number' ? ` · ${plural(item.auteur_nb_publies, 'problème publié', 'problèmes publiés')}` : ''
  );
}

function bouton(label, classe, fn) {
  return h('button', { type: 'button', class: `btn ${classe}`, onclick: (e) => { e.currentTarget.disabled = true; fn(); } }, label);
}

function boutonsCommuns(item, type, id) {
  const out = [];
  if (type === 'probleme' && item.statut === 'publie' && !item.masque) {
    out.push(h('a', { class: 'btn btn-fantome', href: `p.html?id=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener' }, 'Voir sur le site'));
  }
  if (item.user_id) {
    out.push(item.bloque
      ? bouton('Débloquer l’auteur', 'btn-fantome', () => action(() => mod.bloquer(item.user_id, false), 'Auteur débloqué.'))
      : h('button', { type: 'button', class: 'btn btn-danger', onclick: () => bloquer(item) }, 'Bloquer l’auteur'));
  }
  return out;
}

async function bloquer(item) {
  const ok = await confirmDialog({
    title: 'Bloquer l’auteur ?',
    message: `${item.pseudo || 'Ce membre'} ne pourra plus publier, réagir, commenter ni écrire dans son club. Ses contenus restent tels quels.`,
    confirmLabel: 'Bloquer', danger: true
  });
  if (ok) await action(() => mod.bloquer(item.user_id, true), 'Auteur bloqué.');
}

/** Problem card (tabs "À relire" and "Récents"). */
function carteProbleme(p) {
  const actions = [];
  if (p.statut === 'recu') {
    actions.push(
      bouton('Publier', 'btn-primaire', () => action(() => mod.modererProbleme(p.id, 'publie'), 'Publié.')),
      bouton('Refuser', 'btn-danger', () => action(() => mod.modererProbleme(p.id, 'refuse'), 'Refusé.')),
      bouton('Réorienter', 'btn-lavande', () => action(() => mod.modererProbleme(p.id, 'reoriente'), 'Réorienté vers l’aide.'))
    );
  } else {
    actions.push(p.masque
      ? bouton('Rétablir', 'btn-primaire', () => action(() => mod.masquer('probleme', p.id, false), 'Rétabli.'))
      : bouton('Masquer', 'btn-danger', () => action(() => mod.masquer('probleme', p.id, true), 'Masqué.')));
    actions.push(bouton('Refuser (retirer)', 'btn-danger', () => action(() => mod.modererProbleme(p.id, 'refuse'), 'Retiré du site.')));
  }
  return h('article', { class: 'modo-item' },
    badges(p, 'probleme'),
    h('h3', { class: 'modo-titre' }, p.titre),
    h('p', { class: 'modo-texte' }, p.texte),
    typeof p.montant === 'number' ? h('p', { class: 'modo-meta' }, `Montant : ${p.montant.toLocaleString('fr-FR')} €`) : null,
    auteur(p, p.cree_le),
    h('div', { class: 'modo-actions' }, actions, boutonsCommuns(p, 'probleme', p.id))
  );
}

/** Reported or masked content (problem, comment or club message). */
function carteCible(c) {
  const actions = [c.masque
    ? bouton('Rétablir', 'btn-primaire', () => action(() => mod.masquer(c.cible_type, c.cible_id, false), 'Rétabli.'))
    : bouton('Masquer', 'btn-danger', () => action(() => mod.masquer(c.cible_type, c.cible_id, true), 'Masqué.'))];
  if (c.cible_type === 'probleme' && c.statut && c.statut !== 'refuse') {
    actions.push(bouton('Refuser (retirer)', 'btn-danger', () => action(() => mod.modererProbleme(c.cible_id, 'refuse'), 'Retiré du site.')));
  }
  const masquePar = { signalements: 'masqué par 3 signalements', auteur_probleme: 'masqué par l’auteur du problème', admin: 'masqué par la modération' };
  return h('article', { class: 'modo-item' },
    badges(c, c.cible_type),
    h('p', { class: 'modo-texte' }, c.contenu || '(contenu supprimé)'),
    c.masque_par ? h('p', { class: 'modo-meta' }, masquePar[c.masque_par] || c.masque_par) : null,
    auteur(c, c.dernier || c.cree_le),
    h('div', { class: 'modo-actions' }, actions, boutonsCommuns(c, c.cible_type, c.cible_id))
  );
}
