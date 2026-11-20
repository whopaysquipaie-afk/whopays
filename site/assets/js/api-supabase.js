// Real backend: Supabase RPC functions (supabase/migrations/003_fonctions.sql).
// Tables are never read or written directly (no grants): everything goes through rpc().
// Same method names, arguments and return shapes as api-demo.js.

import { CONFIG, siteUrl } from './config.js';
import { getClient } from './supabase.js';

export class ApiError extends Error {
  constructor(message, code = 'erreur') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const RESEAU = 'Connexion impossible pour le moment. Vérifie ton réseau et réessaie.';

/** Converts a Supabase / PostgREST error into an ApiError with a French message. */
function toApiError(error) {
  if (!error) return new ApiError(RESEAU, 'reseau');
  if (error instanceof ApiError) return error;
  // Our SQL functions raise: errcode P0001, message = French text, hint = code
  if (error.code === 'P0001' && error.message) return new ApiError(error.message, error.hint || 'erreur');
  if (error.code === 'PGRST202') return new ApiError('Fonction introuvable côté serveur : les migrations SQL sont-elles appliquées ?', 'configuration');
  if (error.code === '42501') return new ApiError('Action non autorisée.', 'interdit');
  if (/fetch|network/i.test(error.message || '')) return new ApiError(RESEAU, 'reseau');
  return new ApiError('Oups, le serveur a répondu bizarrement. Réessaie dans un instant.', 'serveur');
}

async function rpc(name, params = {}) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, params);
  if (error) throw toApiError(error);
  return data;
}

const nn = (v) => (v === undefined ? null : v);

export function createSupabaseApi() {
  let profilCache = null;

  const api = {
    mode: 'supabase',

    /* ================= Public reads ================= */
    getCompteurs: () => rpc('get_compteurs'),
    getChiffres: () => rpc('get_chiffres'),
    getProblemesPublics: ({ categorie = null, limite = 12, avant = null } = {}) =>
      rpc('get_problemes_publics', { p_categorie: categorie || null, p_limite: limite, p_avant: avant }).then((d) => d || []),
    getProblemePublic: (id) => rpc('get_probleme_public', { p_id: id }),
    getProblemeHasard: () => rpc('get_probleme_hasard'),
    getCommentaires: (problemId, avant = null) => rpc('get_commentaires', { p_problem_id: problemId, p_avant: avant }).then((d) => d || []),

    /* ================= Members ================= */
    creerProfil: ({ camp, pseudo, email, newsletter = false, codeRef = null } = {}) =>
      rpc('creer_profil', { p_camp: camp, p_pseudo: pseudo, p_email: email, p_newsletter: newsletter === true, p_code_ref: codeRef }),
    majProfil: ({ pseudo = null, newsletter = null, camp = null, riche_message = undefined, riche_montant = undefined } = {}) =>
      rpc('maj_profil', {
        p_pseudo: pseudo, p_newsletter: newsletter, p_camp: camp,
        // SQL convention: null = unchanged, '' / -1 = clear
        p_riche_message: riche_message === undefined ? null : (riche_message === null ? '' : riche_message),
        p_riche_montant: riche_montant === undefined ? null : (riche_montant === null || riche_montant === '' ? -1 : Number(riche_montant))
      }),
    soumettreProbleme: ({ categorie, titre, texte, montant = null } = {}) =>
      rpc('soumettre_probleme', { p_categorie: categorie, p_titre: titre, p_texte: texte, p_montant: montant === '' ? null : nn(montant) }),
    reagir: (problemId, type) => rpc('reagir', { p_problem_id: problemId, p_type: type }),
    getMesReactions: async (problemIds = []) => {
      const s = await api.getSession();
      if (!s.profil || !problemIds.length) return [];
      return (await rpc('get_mes_reactions', { p_problem_ids: problemIds })) || [];
    },
    commenter: (problemId, texte) => rpc('commenter', { p_problem_id: problemId, p_texte: texte }),
    supprimerMonCommentaire: (id) => rpc('supprimer_mon_commentaire', { p_comment_id: id }),
    masquerCommentaire: (id) => rpc('masquer_commentaire', { p_comment_id: id }),
    getClubMessages: (apres = null) => rpc('get_club_messages', { p_apres: apres }).then((d) => d || []),
    envoyerMessageClub: (texte) => rpc('envoyer_message_club', { p_texte: texte }),
    signaler: (cibleType, cibleId) => rpc('signaler', { p_cible_type: cibleType, p_cible_id: cibleId }),
    getMonEspace: () => rpc('get_mon_espace'),
    supprimerMonCompte: async () => {
      await rpc('supprimer_mon_compte');
      const sb = await getClient();
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      profilCache = null;
      return true;
    },

    /* ================= Auth ================= */

    /**
     * Parcours B (brief dev §6). `getCaptchaToken` is an async function returning a fresh Turnstile token
     * (each token is single-use: sign-in and magic link need one each).
     */
    async rejoindre({ camp, pseudo, email, newsletter = false, majeur, regles, codeRef = null, getCaptchaToken = async () => undefined } = {}) {
      if (majeur !== true) throw new ApiError('Il faut avoir 18 ans ou plus pour rejoindre un camp.', 'invalide');
      if (regles !== true) throw new ApiError('Accepte les règles du jeu pour continuer.', 'invalide');
      const sb = await getClient();
      const em = String(email || '').trim().toLowerCase();

      // 1. Anonymous session (instant)
      let session = (await sb.auth.getSession()).data.session;
      if (!session) {
        const { data, error } = await sb.auth.signInAnonymously({ options: { captchaToken: await getCaptchaToken() } });
        if (error) throw new ApiError('Impossible de créer ta session. Réessaie dans un instant.', 'auth');
        session = data.session;
      }

      // 2. Attach the e-mail (confirmation e-mail, non-blocking)
      const { error: mailError } = await sb.auth.updateUser({ email: em }, { emailRedirectTo: siteUrl('espace.html') });
      if (mailError && (mailError.code === 'email_exists' || /already been registered|already exists/i.test(mailError.message || ''))) {
        // E-mail already used by a confirmed account: remove the fresh anonymous user and send a magic link.
        try { await rpc('supprimer_utilisateur_anonyme'); } catch { /* best effort */ }
        await sb.auth.signOut({ scope: 'local' }).catch(() => {});
        await sb.auth.signInWithOtp({
          email: em,
          options: { shouldCreateUser: false, emailRedirectTo: siteUrl('espace.html'), captchaToken: await getCaptchaToken() }
        }).catch(() => {});
        profilCache = null;
        return { statut: 'deja_membre' };
      }
      // Any other e-mail error: keep going (the profile does not depend on it).

      // 3. Profile
      const { code_partage } = await api.creerProfil({ camp, pseudo, email: em, newsletter, codeRef });
      profilCache = null;
      return { statut: 'cree', code_partage };
    },

    /** Parcours C: magic link, never creates an account. */
    async seReconnecter(email, { getCaptchaToken = async () => undefined } = {}) {
      const sb = await getClient();
      const { error } = await sb.auth.signInWithOtp({
        email: String(email || '').trim().toLowerCase(),
        options: { shouldCreateUser: false, emailRedirectTo: siteUrl('espace.html'), captchaToken: await getCaptchaToken() }
      });
      if (error) {
        if (/signups not allowed|not found|user not found/i.test(error.message || '') || error.code === 'otp_disabled') {
          throw new ApiError('On ne trouve pas de compte confirmé avec cet e-mail. Rejoins un camp, ça prend 10 secondes.', 'aucun_compte');
        }
        if (error.status === 429) throw new ApiError('Trop de demandes. Attends une minute avant de réessayer.', 'limite');
        throw new ApiError('Impossible d’envoyer le lien pour le moment. Réessaie dans un instant.', 'auth');
      }
      return { statut: 'lien_envoye' };
    },

    async seDeconnecter() {
      const sb = await getClient();
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      profilCache = null;
      return true;
    },

    async getSession() {
      const sb = await getClient();
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) return { connecte: false, userId: null, profil: null };
      if (!profilCache || profilCache.userId !== session.user.id) {
        let profil = null;
        try {
          const e = await rpc('get_mon_espace');
          profil = { pseudo: e.pseudo, camp: e.camp, code_partage: e.code_partage, bloque: !!e.bloque, email_confirme: !!e.email_confirme };
        } catch (err) {
          if (err.code !== 'profil_absent') throw err;
        }
        profilCache = { userId: session.user.id, profil };
      }
      return { connecte: true, userId: session.user.id, profil: profilCache.profil };
    },

    async renvoyerConfirmation() {
      const sb = await getClient();
      const { data } = await sb.auth.getUser();
      const email = data && data.user && (data.user.new_email || data.user.email);
      if (!email) throw new ApiError('Aucune adresse e-mail à confirmer.', 'invalide');
      const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: siteUrl('espace.html') });
      if (error && error.status === 429) throw new ApiError('Trop de demandes. Attends une minute avant de réessayer.', 'limite');
      return { statut: 'envoye' };
    }
  };

  if (!CONFIG.TURNSTILE_SITE_KEY) {
    // Without a Turnstile site key, Supabase must have CAPTCHA protection disabled (development only).
    console.info('Qui paie ? — Turnstile non configuré (TURNSTILE_SITE_KEY vide).');
  }
  return api;
}
