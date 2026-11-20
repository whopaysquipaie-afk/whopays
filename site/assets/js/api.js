// Single data interface used by every page.
// Delegates to api-demo.js (CONFIG.MODE = 'demo') or api-supabase.js (CONFIG.MODE = 'supabase').
// Every method returns a Promise and throws an Error with a French `message` and a `code`.

import { CONFIG } from './config.js';

let backendPromise = null;

function backend() {
  if (!backendPromise) {
    backendPromise = (async () => {
      if (CONFIG.MODE === 'supabase') {
        const m = await import('./api-supabase.js');
        return m.createSupabaseApi();
      }
      const m = await import('./api-demo.js');
      const demo = m.createDemoApi();
      // Moderation shortcuts for testers, from the browser console: demoAdmin.publier(id)…
      if (typeof window !== 'undefined') window.demoAdmin = demo.demoAdmin;
      return demo;
    })();
  }
  return backendPromise;
}

const METHODS = [
  // public reads
  'getCompteurs', 'getChiffres', 'getProblemesPublics', 'getProblemePublic', 'getProblemeHasard', 'getCommentaires',
  // members
  'creerProfil', 'majProfil', 'soumettreProbleme', 'reagir', 'getMesReactions', 'commenter',
  'supprimerMonCommentaire', 'masquerCommentaire', 'getClubMessages', 'envoyerMessageClub', 'signaler',
  'getMonEspace', 'supprimerMonCompte',
  // auth
  'rejoindre', 'seReconnecter', 'seDeconnecter', 'getSession', 'renvoyerConfirmation'
];

/** Methods after which the session (and the header) must be refreshed. */
const SESSION_CHANGING = new Set(['rejoindre', 'seReconnecter', 'seDeconnecter', 'creerProfil', 'majProfil', 'supprimerMonCompte', 'renvoyerConfirmation']);

let sessionCache = null;

function notifySession() {
  sessionCache = null;
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('wp:session'));
}

export const api = { mode: CONFIG.MODE };

for (const name of METHODS) {
  api[name] = async (...args) => {
    const b = await backend();
    if (name === 'getSession') {
      if (!sessionCache) sessionCache = b.getSession().catch((e) => { sessionCache = null; throw e; });
      return sessionCache;
    }
    const result = await b[name](...args);
    if (SESSION_CHANGING.has(name)) notifySession();
    return result;
  };
}

/** Forces the next getSession() to hit the backend. */
api.rafraichirSession = () => notifySession();

/** Demo moderation helpers (undefined in Supabase mode). */
api.demoAdmin = async () => (await backend()).demoAdmin;

export default api;
