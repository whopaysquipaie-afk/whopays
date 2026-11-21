// Cloudflare Turnstile (managed mode). Only active in Supabase mode with a site key.
// Each Supabase Auth call (anonymous sign-in, magic link) consumes one token: getToken() always
// returns a fresh one.

import { CONFIG } from './config.js';

let scriptPromise = null;

function loadScript() {
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      if (window.turnstile) { resolve(window.turnstile); return; }
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => { scriptPromise = null; reject(new Error('Vérification anti-robots indisponible. Désactive ton bloqueur ou réessaie.')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function turnstileActif() {
  return CONFIG.MODE === 'supabase' && !!CONFIG.TURNSTILE_SITE_KEY;
}

/** Renders a widget into `container`. Returns { getToken(): Promise<string|undefined>, destroy() }. */
export function creerTurnstile(container) {
  if (!turnstileActif()) return { getToken: async () => undefined, destroy() {} };
  let widgetId = null;
  let token = null;
  let waiting = [];
  const ready = loadScript().then((ts) => {
    widgetId = ts.render(container, {
      sitekey: CONFIG.TURNSTILE_SITE_KEY,
      appearance: 'interaction-only',
      language: 'fr',
      // R-052: no empty gap while the widget stays invisible; once shown, it keeps its space (result, error)
      'before-interactive-callback': () => container.classList.add('interactif'),
      callback: (t) => {
        if (waiting.length) waiting.shift().resolve(t);
        else token = t;
      },
      'expired-callback': () => { token = null; },
      'error-callback': () => {
        const w = waiting;
        waiting = [];
        w.forEach((p) => p.reject(new Error('La vérification anti-robots a échoué. Réessaie.')));
      }
    });
    return ts;
  });
  return {
    async getToken() {
      const ts = await ready;
      if (token) { const t = token; token = null; return t; }
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject };
        waiting.push(entry);
        try { ts.reset(widgetId); } catch { /* first render still pending */ }
        setTimeout(() => {
          if (waiting.includes(entry)) {
            waiting = waiting.filter((x) => x !== entry);
            reject(new Error('La vérification anti-robots prend trop de temps. Réessaie.'));
          }
        }, 45000);
      });
    },
    destroy() { ready.then((ts) => { try { ts.remove(widgetId); } catch { /* ignore */ } }).catch(() => {}); }
  };
}
