// Real backend: Supabase RPC only (tables have no grants). Same interface as api-demo.js.

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

export async function rpc(name, params = {}) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, params);
  if (error) throw toApiError(error);
  return data;
}

const nn = (v) => (v === undefined ? null : v);

// Adds a Turnstile token only when a site key is configured (otherwise none is requested nor sent).
const avecCaptcha = async (options, getToken) =>
  (CONFIG.TURNSTILE_SITE_KEY ? { ...options, captchaToken: await getToken() } : options);

export function createSupabaseApi() {
  let profilCache = null;

  const api = {
    mode: 'supabase',

    /* ================= Public reads ================= */
    getCompteurs: () => rpc('get_compteurs'),
    getChiffres: () => rpc('get_chiffres'),
    getProblemesPublics: ({ categorie = null, limite = 12, avant = null, type = null } = {}) =>
      rpc('get_problemes_publics', { p_categorie: categorie || null, p_limite: limite, p_avant: avant, ...(type ? { p_type: type } : {}) }).then((d) => d || []),
    getProblemePublic: (id) => rpc('get_probleme_public', { p_id: id }),
    getProblemeHasard: () => rpc('get_probleme_hasard'),
    getCommentaires: (problemId, avant = null) => rpc('get_commentaires', { p_problem_id: problemId, p_avant: avant }).then((d) => d || []),
    getPalmares: ({ limite = 100 } = {}) => rpc('get_palmares', { p_limite: limite }),
    getMonRang: () => rpc('get_mon_rang'),
    getAnnonces: () => rpc('get_annonces').then((d) => d || []),
    // R-034: hero card of the home page (null when nothing can be shown)
    getProblemeDuMoment: () => rpc('get_probleme_du_moment').then((d) => d || null),
    // R-037 (015). Pages hide the feature when the function is missing (code « configuration »).
    getRicheDeLaSemaine: () => rpc('get_riche_de_la_semaine').then((d) => d || null),
    seDesinscrire: (jeton) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(jeton || ''))
      ? rpc('se_desinscrire', { p_jeton: jeton }) : Promise.resolve(false)),

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
    publierRiche: ({ type, titre = null, texte, montant = null } = {}) =>
      rpc('publier_riche', { p_type: type, p_texte: texte, p_titre: titre || null, p_montant: montant === '' ? null : nn(montant) }),
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
    couronner: (problemId) => rpc('couronner', { p_problem_id: problemId }),
    retirerCouronne: (problemId) => rpc('retirer_couronne', { p_problem_id: problemId }),
    getMesNotifications: () => rpc('mes_notifications').then((d) => d || { non_lues: 0, liste: [] }),
    marquerNotificationsLues: () => rpc('marquer_notifications_lues'),
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
        const options = await avecCaptcha({}, getCaptchaToken);
        const { data, error } = await sb.auth.signInAnonymously(Object.keys(options).length ? { options } : undefined);
        if (error) {
          if (error.status === 429) throw new ApiError('Trop de demandes. Attends une minute avant de réessayer.', 'limite');
          throw new ApiError('Impossible de créer ta session. Réessaie dans un instant.', 'auth');
        }
        session = data.session;
      }

      // 2. Attach the e-mail (confirmation e-mail, non-blocking)
      const mailError = await lierEmail(em, camp);
      if (mailError && mailError.code === 'email_pris') {
        // E-mail already used by a confirmed account: remove the fresh anonymous user and send a magic link.
        try { await rpc('supprimer_utilisateur_anonyme'); } catch { /* best effort */ }
        await sb.auth.signOut({ scope: 'local' }).catch(() => {});
        try {
          await sb.auth.signInWithOtp({
            email: em,
            options: await avecCaptcha({ shouldCreateUser: false, emailRedirectTo: siteUrl('espace.html') }, getCaptchaToken)
          });
        } catch { /* the magic link is best effort here */ }
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
        options: await avecCaptcha({ shouldCreateUser: false, emailRedirectTo: siteUrl('espace.html') }, getCaptchaToken)
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
          profil = { pseudo: e.pseudo, camp: e.camp, statut_riche: e.statut_riche || null, code_partage: e.code_partage, bloque: !!e.bloque, email_confirme: !!e.email_confirme };
        } catch (err) {
          if (err.code !== 'profil_absent') throw err;
        }
        profilCache = { userId: session.user.id, profil };
      }
      return { connecte: true, userId: session.user.id, profil: profilCache.profil };
    },

    // R-024: accounts created while sending failed have no auth address → the profile one is used.
    async renvoyerConfirmation() {
      const u = await userAuth();
      if (!u) throw new ApiError('Ta session a expiré. Recharge la page.', 'non_connecte');
      const email = u.new_email || u.email || (await emailProfil());
      if (!email) throw new ApiError('Aucune adresse e-mail à confirmer.', 'invalide');
      const err = await lierEmail(email);
      if (err) throw err;
      return { statut: 'envoye' };
    },

    // R-024 silent catch-up (once-per-session guard in api.js). Never throws.
    async rattraperEmail() {
      try {
        const u = await userAuth();
        const email = u && u.is_anonymous && !u.email && !u.new_email && (await emailProfil());
        if (!email) return { statut: 'inutile' };
        const err = await lierEmail(email);
        return { statut: !err ? 'rattache' : (err.code === 'envoi' ? 'erreur' : err.code) };
      } catch { return { statut: 'erreur' }; }
    }
  };

  const userAuth = async () => (await (await getClient()).auth.getUser()).data?.user || null;
  const emailProfil = () => rpc('get_mon_espace').then((e) => e.email || null, (e) => { if (e.code === 'profil_absent') return null; throw e; });
  const campProfil = () => rpc('get_mon_espace').then((e) => e.camp || null, () => null);

  /**
   * updateUser({ email, data: { camp } }) → null, or an ApiError: email_pris | limite | envoi.
   * The camp is stored in the user metadata: the « Change email address » template of Supabase uses it
   * ({{ if eq .Data.camp "riche" }}, docs/CONFIGURATION.md, R-031).
   */
  async function lierEmail(email, camp = null) {
    const c = camp || (await campProfil());
    const attrs = c ? { email, data: { camp: c } } : { email };
    const { error: e } = await (await getClient()).auth.updateUser(attrs, { emailRedirectTo: siteUrl('espace.html') });
    if (!e) return null;
    if (e.code === 'email_exists' || /already been registered|already exists/i.test(e.message || '')) return new ApiError('Cette adresse est déjà liée à un autre compte. Utilise « Déjà membre ? » avec cette adresse.', 'email_pris');
    if (e.status === 429) return new ApiError('Trop de demandes. Attends une minute avant de réessayer.', 'limite');
    return new ApiError('L’envoi a échoué, réessaie dans un instant.', 'envoi');
  }

  if (!CONFIG.TURNSTILE_SITE_KEY) {
    // Without a Turnstile site key, Supabase must have CAPTCHA protection disabled (development only).
    console.info('Qui paie ? — Turnstile non configuré (TURNSTILE_SITE_KEY vide).');
  }
  return api;
}
