// Common bootstrap for every page: session, layout, intents (join / publish / reconnect),
// referral memory, reveal animations, watermark, service worker, analytics.

import { CONFIG, siteLabel } from './config.js';
import { api } from './api.js';
import { initLayout, updateHeaderSession, registerServiceWorker, intent } from './layout.js';
import { $$, toastError } from './ui.js';
import { initReveal } from './animations.js';
import { memoriserRef } from './parrainage.js';

let current = null;

export function session() {
  return current;
}

export function estMembre() {
  return !!(current && current.profil);
}

/**
 * Runs `action` if the visitor is a member; otherwise opens "Choisis ton camp"
 * and runs `action` automatically after a successful join (brief dev §6.B.6).
 */
export function exigerMembre(action, { camp = null, raison = '' } = {}) {
  if (estMembre()) {
    if (current.profil.bloque) {
      toastError({ message: 'Ton compte est bloqué : tu ne peux plus publier, réagir ni écrire.' });
      return false;
    }
    action();
    return true;
  }
  intent('rejoindre', { camp, raison, apres: action });
  return false;
}

async function refresh() {
  try {
    current = await api.getSession();
  } catch {
    current = { connecte: false, userId: null, profil: null };
  }
  return current;
}

export async function initPage(page, { mobileCta = true } = {}) {
  memoriserRef();
  await refresh();
  initLayout({ page, session: current, mobileCta });

  document.addEventListener('wp:session', async () => {
    await refresh();
    updateHeaderSession(current);
    document.dispatchEvent(new CustomEvent('wp:session-maj', { detail: current }));
  });
  document.addEventListener('wp:rejoindre', (e) => {
    import('./auth.js').then((m) => m.ouvrirRejoindre(e.detail || {})).catch(toastError);
  });
  document.addEventListener('wp:reconnecter', (e) => {
    import('./auth.js').then((m) => m.ouvrirReconnexion(e.detail || {})).catch(toastError);
  });
  document.addEventListener('wp:publier', (e) => {
    import('./publier.js').then((m) => m.ouvrirPublier(e.detail || {})).catch(toastError);
  });

  // Declarative buttons
  for (const b of $$('[data-action="publier"]')) b.addEventListener('click', () => intent('publier'));
  for (const b of $$('[data-action="hasard"]')) b.addEventListener('click', () => allerAuHasard(b));
  for (const b of $$('[data-rejoindre]')) {
    b.addEventListener('click', () => {
      if (estMembre()) { location.href = 'espace.html'; return; }
      intent('rejoindre', { camp: b.dataset.rejoindre === 'riche' ? 'riche' : 'pauvre' });
    });
  }
  for (const el of $$('[data-filigrane]')) el.textContent = siteLabel();

  // Manifest shortcut "Publier un problème" (index.html?publier=1)
  if (new URLSearchParams(location.search).get('publier') === '1') setTimeout(() => intent('publier'), 300);

  initReveal();
  registerServiceWorker();
  loadAnalytics();
  return current;
}

/** "Tombe sur un problème au hasard" → p.html?id=… */
export async function allerAuHasard(button = null, { sauf = null } = {}) {
  if (button) button.setAttribute('aria-busy', 'true');
  try {
    let id = await api.getProblemeHasard();
    for (let i = 0; i < 3 && id && id === sauf; i++) id = await api.getProblemeHasard();
    if (!id) {
      toastError({ message: 'Aucun problème publié pour l’instant. Sois le premier !' });
      return;
    }
    location.href = `p.html?id=${encodeURIComponent(id)}`;
  } catch (e) {
    toastError(e);
  } finally {
    if (button) button.removeAttribute('aria-busy');
  }
}

/** Cloudflare Web Analytics (cookieless), only when a token is configured. */
function loadAnalytics() {
  const token = CONFIG.CF_ANALYTICS_TOKEN;
  if (!token || !/^[a-f0-9]{32}$/i.test(token)) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.dataset.cfBeacon = JSON.stringify({ token });
  document.head.appendChild(s);
}
