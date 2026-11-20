// Shared layout: demo banner, header, mobile menu, footer, transparency banner,
// mobile "Publier" button, "Règles du jeu" dialog, install link.
// Pages call initLayout() once; auth.js calls updateHeaderSession() when the session changes.

import { CONFIG } from './config.js';
import { h, $, openDialog, clear } from './ui.js';
import { icon, hydrateIcons } from './icons.js';
import { CAMPS } from './categories.js';

const NAV = [
  { id: 'problemes', label: 'Les problèmes', href: 'index.html#mur' },
  { id: 'chiffres', label: 'Les chiffres', href: 'chiffres.html' },
  { id: 'club', label: 'Mon club', href: 'club.html', membersOnly: true }
];

let state = { page: '', session: null };
let headerActions = null;
let navEl = null;
let mobileMenu = null;
let deferredInstall = null;

/** Fires a global UI intent handled by auth.js / publier.js (decoupled modules). */
export function intent(name, detail = {}) {
  document.dispatchEvent(new CustomEvent(`wp:${name}`, { detail }));
}

export function initLayout({ page = '', session = null, mobileCta = true } = {}) {
  state = { page, session };
  const body = document.body;

  if (CONFIG.MODE === 'demo') body.prepend(demoBanner());
  const skip = h('a', { class: 'skip-link', href: '#contenu' }, 'Aller au contenu');
  body.prepend(skip);

  const header = buildHeader();
  skip.after(header);
  if (CONFIG.MODE === 'demo') header.before($('.bandeau-demo'));

  body.appendChild(buildFooter());
  body.appendChild(h('div', { class: 'bandeau-transparence', role: 'note' },
    icon('shield-check'), 'Projet test — aucune collecte ni aucun paiement.'));

  if (mobileCta) {
    body.classList.add('avec-cta-mobile');
    body.appendChild(h('button', {
      type: 'button', class: 'btn btn-primaire cta-mobile',
      onclick: () => intent('publier')
    }, 'Publier un problème', icon('arrow-right', { className: 'fleche' })));
  }

  hydrateIcons(document);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  setupInstall();
  updateHeaderSession(session);
}

function demoBanner() {
  return h('div', { class: 'bandeau-demo', role: 'note' },
    h('strong', {}, 'Mode démo'), ' : données fictives, stockées dans ce navigateur.',
    h('button', {
      type: 'button', class: 'lien-discret',
      onclick: () => {
        try { localStorage.removeItem('whopays_demo_v1'); } catch { /* ignore */ }
        location.reload();
      }
    }, 'Réinitialiser')
  );
}

function buildHeader() {
  navEl = h('nav', { class: 'nav', 'aria-label': 'Navigation principale' });
  headerActions = h('div', { class: 'entete-actions' });
  const menuBtn = h('button', {
    type: 'button', class: 'btn-icone menu-bouton', 'aria-label': 'Ouvrir le menu', 'aria-expanded': 'false',
    onclick: () => toggleMobileMenu(menuBtn)
  }, icon('menu'));
  const header = h('header', { class: 'entete' },
    h('div', { class: 'container entete-interieur' },
      h('a', { class: 'logo', href: 'index.html', 'aria-label': 'Qui paie ? — accueil' },
        h('img', { src: 'assets/img/logo.svg', alt: 'Who pays ? Qui paie ?', width: '150', height: '40' })),
      navEl,
      headerActions,
    )
  );
  headerActions.after(menuBtn);
  return header;
}

function renderNav() {
  clear(navEl);
  for (const item of NAV) {
    if (item.membersOnly && !hasProfile()) continue;
    navEl.appendChild(h('a', {
      href: item.href,
      'aria-current': state.page === item.id ? 'page' : null
    }, item.label));
  }
}

function hasProfile() {
  return !!(state.session && state.session.profil);
}

export function updateHeaderSession(session) {
  state.session = session;
  if (!headerActions) return;
  renderNav();
  clear(headerActions);
  if (hasProfile()) {
    const p = session.profil;
    const camp = CAMPS[p.camp] || CAMPS.pauvre;
    headerActions.appendChild(h('a', {
      class: `pastille-camp camp-${camp.id}`, href: 'espace.html',
      'aria-label': `Mon espace — ${p.pseudo}, camp des ${camp.plural}`
    }, h('span', { class: 'rond' }, icon(camp.icon)), h('span', { class: 'pseudo' }, p.pseudo)));
  } else {
    headerActions.appendChild(h('button', {
      type: 'button', class: 'btn btn-secondaire btn-petit btn-rejoindre', onclick: () => intent('rejoindre')
    }, 'Rejoindre'));
  }
  headerActions.appendChild(h('button', {
    type: 'button', class: 'btn btn-primaire btn-petit btn-publier-entete', onclick: () => intent('publier')
  }, 'Publier un problème', icon('arrow-right', { className: 'fleche' })));
  if (mobileMenu) buildMobileMenuContent();
}

function toggleMobileMenu(btn) {
  if (mobileMenu) {
    mobileMenu.remove();
    mobileMenu = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Ouvrir le menu');
    clear(btn).appendChild(icon('menu'));
    document.body.style.overflow = '';
    return;
  }
  mobileMenu = h('div', { class: 'menu-mobile', id: 'menu-mobile' });
  buildMobileMenuContent();
  document.body.appendChild(mobileMenu);
  document.body.style.overflow = 'hidden';
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-label', 'Fermer le menu');
  clear(btn).appendChild(icon('x'));
  const close = () => { if (mobileMenu) toggleMobileMenu(btn); };
  mobileMenu.addEventListener('click', (e) => { if (e.target.closest('a, button')) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  const first = mobileMenu.querySelector('a, button');
  if (first) first.focus();
}

function buildMobileMenuContent() {
  clear(mobileMenu);
  for (const item of NAV) {
    if (item.membersOnly && !hasProfile()) continue;
    mobileMenu.appendChild(h('a', { href: item.href }, item.label));
  }
  if (hasProfile()) mobileMenu.appendChild(h('a', { href: 'espace.html' }, 'Mon espace'));
  mobileMenu.appendChild(h('button', { type: 'button', class: 'lien-menu', onclick: () => openRules() }, 'Règles du jeu'));
  mobileMenu.appendChild(h('a', { href: 'aide.html' }, 'Besoin d\'une vraie aide ?'));
  if (!hasProfile()) {
    mobileMenu.appendChild(h('button', { type: 'button', class: 'btn btn-secondaire btn-bloc', onclick: () => intent('rejoindre') }, 'Rejoindre un camp'));
  }
  mobileMenu.appendChild(h('button', { type: 'button', class: 'btn btn-primaire btn-bloc', onclick: () => intent('publier') },
    'Publier un problème', icon('arrow-right', { className: 'fleche' })));
}

function buildFooter() {
  const installBtn = h('button', { type: 'button', id: 'installer-app', hidden: true, onclick: install }, 'Installer l\'application');
  return h('footer', { class: 'pied' },
    h('div', { class: 'container pied-interieur' },
      h('div', {},
        h('a', { class: 'pied-logo', href: 'index.html', 'aria-label': 'Qui paie ? — accueil' },
          h('img', { src: 'assets/img/logo.svg', alt: 'Who pays ? Qui paie ?', width: '128', height: '34', loading: 'lazy' })),
        h('p', { class: 'mt-16' }, 'Site édité par Hassen Bamri · Hébergé par GitHub · Projet test sans collecte d\'argent')
      ),
      h('div', { class: 'pied-liens' },
        h('button', { type: 'button', onclick: () => openRules() }, 'Règles du jeu'),
        h('a', { href: 'aide.html' }, 'Besoin d\'une vraie aide ?'),
        installBtn,
        h('a', { href: CONFIG.REPO_URL, rel: 'noopener', target: '_blank' }, 'Code source')
      )
    )
  );
}

function onScroll() {
  const header = $('.entete');
  if (header) header.classList.toggle('a-defile', window.scrollY > 8);
}

/* ---------------- Rules of the game (brief visuel §7.7) ---------------- */

export const RULES = [
  'On rit des situations, pas des personnes.',
  'Pas d\'insultes, pas de harcèlement.',
  'Pas de numéro de téléphone, d\'IBAN, d\'adresse ni de lien.',
  'Personne ne demande ni n\'envoie d\'argent ici.',
  'Les contenus signalés sont masqués, les comptes abusifs bloqués.'
];

export function openRules() {
  const ok = h('button', { type: 'button', class: 'btn btn-primaire' }, 'Compris', icon('check'));
  const { close } = openDialog({
    title: 'Règles du jeu',
    content: [
      h('p', {}, 'Cinq règles, zéro exception. Merci de les respecter, sinon le chien à lunettes se fâche.'),
      h('ol', { class: 'regles' }, RULES.map((r) => h('li', {}, r))),
      h('p', { class: 'mentions' }, 'Besoin d\'une aide réelle ? ', h('a', { href: 'aide.html', class: 'lien' }, 'On t\'oriente ici.'))
    ],
    footer: [ok]
  });
  ok.addEventListener('click', () => close());
}

/* ---------------- Installable app ---------------- */

function setupInstall() {
  const btn = document.getElementById('installer-app');
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  if (standalone) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { if (btn) btn.hidden = true; deferredInstall = null; });
  if (isIos && btn) btn.hidden = false;
}

async function install() {
  if (deferredInstall) {
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch { /* ignore */ }
    deferredInstall = null;
    const btn = document.getElementById('installer-app');
    if (btn) btn.hidden = true;
    return;
  }
  const ok = h('button', { type: 'button', class: 'btn btn-primaire' }, 'OK');
  const { close } = openDialog({
    title: 'Installer l\'application',
    content: [
      h('p', {}, 'Sur iPhone : touche le bouton Partager de Safari, puis « Sur l\'écran d\'accueil ».'),
      h('p', { class: 'mt-16 gris' }, 'Sur Android : menu du navigateur, puis « Installer l\'application ».')
    ],
    footer: [ok]
  });
  ok.addEventListener('click', () => close());
}

/* ---------------- Service worker ---------------- */

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  const go = () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* offline support is optional */ });
  // Pages use top-level await: the load event may already be over when we get here.
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}
