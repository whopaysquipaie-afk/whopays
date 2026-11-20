// Club of a camp (brief visuel §6.5): group chat, refreshed every 4 s while the page is visible.
// The server only ever returns the messages of the caller's own camp.

import { api } from './api.js';
import { h, clear, formatHour, toastError, dotsMenu } from './ui.js';
import { icon } from './icons.js';
import { CAMPS } from './categories.js';
import { champ, boiteErreur } from './champs.js';
import { signaler, dejaSignale } from './signalement.js';

const POLL_MS = 4000;
export const CLUBS = {
  riche: { titre: 'Club des riches', accroche: 'Entre gens qui ont trop d’argent et pas assez de problèmes.', image: 'assets/img/couronne-noire.svg' },
  pauvre: { titre: 'Club des pauvres', accroche: 'Entraide, bons plans et fous rires de fin de mois.', image: 'assets/img/tirelire-violette.svg' }
};

function jour(iso) {
  const d = new Date(iso);
  const auj = new Date();
  const hier = new Date(Date.now() - 86400000);
  if (d.toDateString() === auj.toDateString()) return 'Aujourd’hui';
  if (d.toDateString() === hier.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function monterClub(main, profil) {
  const camp = CAMPS[profil.camp];
  const club = CLUBS[profil.camp];
  main.className = `club-page club-${camp.id}`;
  document.body.classList.add('page-club');
  document.title = `${club.titre} — Qui paie ?`;

  const liste = h('ol', { class: 'club-messages', 'aria-label': `Messages du ${club.titre.toLowerCase()}` });
  const vide = h('p', { class: 'gris centre', hidden: true }, 'Personne n’a encore parlé. Lance la conversation !');
  const fil = h('div', { class: 'club-fil', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' }, h('div', { class: 'container container-etroit' }, vide, liste));

  const saisie = champ({ name: 'message', label: 'Ton message', min: 1, max: 300, multiline: true, rows: 1, libelle: 'Ton message', placeholder: 'Écris au club…' });
  saisie.wrap.querySelector('label').classList.add('visually-hidden');
  const erreur = boiteErreur();
  const envoyer = h('button', { type: 'submit', class: 'btn btn-primaire', 'aria-label': 'Envoyer' }, icon('send'));
  const form = h('form', { novalidate: true }, saisie.wrap, envoyer);
  const barre = h('div', { class: 'club-saisie' }, h('div', { class: 'container container-etroit' },
    h('p', { class: 'club-rappel' }, 'Pas de numéro, d’IBAN ni de lien. Personne ne demande ni n’envoie d’argent ici.'),
    form, erreur.el));

  main.replaceChildren(
    h('header', { class: 'club-entete' }, h('div', { class: 'container container-etroit' },
      h('img', { src: club.image, alt: '', width: '52', height: '52' }),
      h('div', {}, h('h1', {}, club.titre), h('p', {}, club.accroche)))),
    fil, barre
  );

  if (profil.bloque) {
    saisie.input.disabled = true;
    envoyer.disabled = true;
    erreur.show('Ton compte est bloqué : tu peux lire, mais plus écrire.');
  }

  let dernier = null;
  let dernierJour = null;
  const vus = new Set();

  const enBas = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
  const descendre = (smooth = true) => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

  function bulle(m) {
    const ligne = h('li', { class: `bulle-ligne${m.est_moi ? ' moi' : ''}`, dataset: { id: m.id } },
      h('div', { class: 'bulle' },
        h('div', { class: 'tete' }, h('span', { class: 'pseudo' }, m.est_moi ? 'Moi' : m.pseudo), h('time', { class: 'heure', datetime: m.cree_le }, formatHour(m.cree_le))),
        h('p', { class: 'texte' }, m.texte)));
    if (!m.est_moi) {
      const menu = () => dotsMenu([{
        label: dejaSignale('message', m.id) ? 'Signalé — merci' : 'Signaler', icon: 'flag', disabled: dejaSignale('message', m.id),
        onSelect: () => signaler('message', m.id, { onDone: (r) => {
          if (r.masque) ligne.remove();
          else ligne.querySelector('.menu-points').replaceWith(menu());
        } })
      }], { label: `Actions sur le message de ${m.pseudo}` });
      ligne.appendChild(menu());
    }
    return ligne;
  }

  function ajouter(messages) {
    let ajoutes = 0;
    for (const m of messages) {
      if (vus.has(m.id)) continue;
      vus.add(m.id);
      const j = jour(m.cree_le);
      if (j !== dernierJour) {
        liste.appendChild(h('li', { class: 'club-jour', 'aria-hidden': 'true' }, j));
        dernierJour = j;
      }
      liste.appendChild(bulle(m));
      if (!dernier || m.cree_le > dernier) dernier = m.cree_le;
      ajoutes++;
    }
    vide.hidden = vus.size > 0;
    return ajoutes;
  }

  let timer = null;
  let enCours = false;
  async function rafraichir(premier = false) {
    if (enCours) return;
    enCours = true;
    try {
      const etaitEnBas = premier || enBas();
      const msgs = await api.getClubMessages(premier ? null : dernier);
      if (ajouter(msgs) && etaitEnBas) descendre(!premier);
    } catch (e) {
      if (premier) toastError(e);
    } finally {
      enCours = false;
      main.setAttribute('aria-busy', 'false');
    }
  }
  const planifier = () => {
    clearInterval(timer);
    if (document.visibilityState === 'visible') timer = setInterval(() => rafraichir(false), POLL_MS);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rafraichir(false);
    planifier();
  });

  async function poster() {
    erreur.hide();
    if (saisie.validate()) { saisie.focus(); return; }
    const texte = saisie.value();
    envoyer.disabled = true;
    try {
      const m = await api.envoyerMessageClub(texte);
      saisie.input.value = '';
      saisie.input.dispatchEvent(new Event('input'));
      ajouter([m]);
      descendre();
    } catch (e) {
      erreur.show(e.message);
    } finally {
      envoyer.disabled = !!profil.bloque;
      saisie.focus();
    }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); poster(); });
  saisie.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); poster(); }
  });
  // Auto-grow the textarea
  saisie.input.addEventListener('input', () => {
    saisie.input.style.height = 'auto';
    saisie.input.style.height = `${Math.min(140, saisie.input.scrollHeight)}px`;
  });

  rafraichir(true);
  planifier();
  return { arreter: () => clearInterval(timer) };
}

/** "Ce club est réservé aux …" screen. camp = the club that was requested (or null for visitors). */
export function ecranReserve(main, { camp = null, membre = false, onRejoindre }) {
  const c = camp ? CAMPS[camp] : null;
  main.className = 'club-page';
  document.body.classList.remove('page-club');
  main.replaceChildren(h('div', { class: 'container' }, h('div', { class: 'reserve' },
    h('img', { class: 'icone-reserve', src: c ? (c.id === 'riche' ? 'assets/img/couronne.svg' : 'assets/img/tirelire.svg') : 'assets/img/question.svg', alt: '', width: '72', height: '72' }),
    h('h1', {}, c ? `Ce club est réservé aux ${c.plural}.` : 'Les clubs sont réservés aux membres.'),
    h('p', {}, membre
      ? 'Chaque membre ne voit que le club de son camp. Tu peux changer de camp depuis Mon espace.'
      : 'Un club par camp : les riches entre eux, les pauvres entre eux. Rejoins le tien en 10 secondes.'),
    membre
      ? h('div', { class: 'hero-actions', style: { justifyContent: 'center' } },
        h('a', { class: 'btn btn-primaire', href: 'club.html' }, 'Mon club', icon('arrow-right', { className: 'fleche' })),
        h('a', { class: 'btn btn-secondaire', href: 'espace.html' }, 'Changer de camp'))
      : h('div', { class: 'hero-actions', style: { justifyContent: 'center' } },
        (!c || c.id === 'riche') ? h('button', { type: 'button', class: 'btn btn-primaire', onclick: () => onRejoindre('riche') }, icon('crown'), 'Rejoindre les riches') : null,
        (!c || c.id === 'pauvre') ? h('button', { type: 'button', class: c ? 'btn btn-primaire' : 'btn btn-lavande', onclick: () => onRejoindre('pauvre') }, icon('pig-money'), 'Rejoindre les pauvres') : null)
  )));
  main.setAttribute('aria-busy', 'false');
}
