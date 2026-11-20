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
  'getPalmares', 'getMonRang',
  // members
  'creerProfil', 'majProfil', 'soumettreProbleme', 'publierRiche', 'reagir', 'getMesReactions', 'commenter',
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
    // maj_profil only changes the session (header badge, club) when the pseudo or the camp changes
    const majSansImpact = name === 'majProfil' && !(args[0] && (args[0].pseudo || args[0].camp));
    if (SESSION_CHANGING.has(name) && !majSansImpact) notifySession();
    return result;
  };
}

/**
 * R-024: attaches the profile e-mail of accounts created while sending failed, at most once per
 * browser session (sessionStorage guard set before the call). { statut, deja? }; never throws.
 */
const rattrapages = new Map();
api.rattraperEmail = async () => {
  try {
    const s = await api.getSession();
    if (!s.profil || s.profil.email_confirme) return { statut: 'inutile' };
    if (!rattrapages.has(s.userId)) {
      rattrapages.set(s.userId, (async (k) => {
        const deja = sessionStorage.getItem(k);
        if (deja) return { statut: deja === 'en_cours' ? 'erreur' : deja, deja: true };
        sessionStorage.setItem(k, 'en_cours');
        const { statut } = await (await backend()).rattraperEmail();
        sessionStorage.setItem(k, statut);
        return { statut };
      })('wp:rattrapage:' + s.userId));
    }
    return await rattrapages.get(s.userId);
  } catch { return { statut: 'erreur' }; }
};

/** Forces the next getSession() to hit the backend. */
api.rafraichirSession = () => notifySession();

/** Demo moderation helpers (undefined in Supabase mode). */
api.demoAdmin = async () => (await backend()).demoAdmin;

export default api;
