// Demo backend: simulates every Supabase RPC in localStorage (key "whopays_demo_v1").
// Same signatures, same French errors, same rules as the SQL functions:
// filters, rate limits, camp isolation, auto-mask at 3 reports, blocked members, referral.
// No DOM access: runs in the browser and in Node (tools/test.mjs provides a localStorage).

import { CATEGORY_IDS, TEAM_PSEUDO } from './categories.js';
import {
  raisonFiltre, nettoyer, verifierLongueur, LIMITES, RE_EMAIL_VALIDE, MESSAGE_FILTRE, MOTS_INTERDITS_DEFAUT
} from './filtres.js';
import { MOTS_SENSIBLES_DEFAUT, contientMotSensible } from './mots-sensibles.js';
import { PLAFOND_PAUVRE } from './riens.js';
import { MEMBRES, EXEMPLES, PROBLEMES, COMMENTAIRES, CLUB_RICHES, CLUB_PAUVRES } from './demo-data.js';

export const DEMO_KEY = 'whopays_demo_v1';
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export class ApiError extends Error {
  constructor(message, code = 'erreur') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const ERR = {
  nonConnecte: () => new ApiError('Rejoins un camp pour faire ça, ça prend 10 secondes.', 'non_connecte'),
  profilAbsent: () => new ApiError('Ton profil n’existe pas encore. Choisis ton camp pour commencer.', 'profil_absent'),
  bloque: () => new ApiError('Ton compte est bloqué : tu ne peux plus publier, réagir ni écrire.', 'bloque'),
  filtre: () => new ApiError(MESSAGE_FILTRE, 'filtre'),
  invalide: (msg) => new ApiError(msg, 'invalide'),
  introuvable: (msg = 'Ce problème est introuvable ou n’est pas publié.') => new ApiError(msg, 'introuvable'),
  interdit: (msg = 'Tu n’as pas le droit de faire ça.') => new ApiError(msg, 'interdit'),
  limite: (msg) => new ApiError(msg, 'limite')
};

/* ---------------- Storage ---------------- */

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function defaultStorage() {
  try {
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  } catch { /* access denied (privacy mode) */ }
  return memoryStorage();
}

/* ---------------- Helpers ---------------- */

function uuid(rand) {
  const hex = [];
  for (let i = 0; i < 16; i++) hex.push(Math.floor(rand() * 256));
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  const s = hex.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Deterministic PRNG (mulberry32) for the seed. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function codePartage(rand, existing) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 8; i++) c += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
    if (!existing.has(c)) return c;
  }
}

const iso = (ms) => new Date(ms).toISOString();
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isIsoDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function texteValide(valeur, limites, libelle, { multiligne = false, mots } = {}) {
  if (valeur !== null && valeur !== undefined && typeof valeur !== 'string') throw ERR.invalide(`${libelle} est invalide.`);
  const v = nettoyer(valeur, { multiligne });
  const err = verifierLongueur(v, limites, libelle);
  if (err) throw ERR.invalide(err);
  if (raisonFiltre(v, mots)) throw ERR.filtre();
  return v;
}

function entierValide(valeur, [min, max], libelle) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const n = typeof valeur === 'number' ? valeur : Number(String(valeur).replace(/\s/g, ''));
  if (!Number.isInteger(n) || n < min || n > max) throw ERR.invalide(`${libelle} doit être un nombre entier entre ${min} et ${max.toLocaleString('fr-FR')}.`);
  return n;
}

/** R-027 (= 008): a problem of the poor always has an amount, a whole number from 1 to 10 000 €. */
function montantPauvre(valeur) {
  const n = valeur === null || valeur === undefined || valeur === '' ? NaN
    : typeof valeur === 'number' ? valeur : Number(String(valeur).replace(/\s/g, ''));
  if (!Number.isInteger(n) || n < 1) throw ERR.invalide('Indique le montant recherché : un nombre entier de 1 à 10 000 €.');
  if (n > PLAFOND_PAUVRE) throw ERR.invalide('Un problème de pauvre ne dépasse jamais 10x Rien (10 000 €).');
  return n;
}

/* ---------------- Seed ---------------- */

function buildSeed(now) {
  const rand = prng(20261120);
  const st = {
    version: 1, seededAt: iso(now), session: null,
    users: [], profiles: [], problems: [], reactions: [], comments: [], club_messages: [], reports: [], verifications: [],
    mots_interdits: [...MOTS_INTERDITS_DEFAUT],
    mots_sensibles: [...MOTS_SENSIBLES_DEFAUT],
    reglages: { publication_auto: true },
    moderateurs: []
  };
  const codes = new Set();
  // Members, registered over the last 30 days
  MEMBRES.forEach(([pseudo, camp, richeMessage, richeMontant], i) => {
    const id = uuid(rand);
    const created = now - (30 - i * 0.45) * DAY - Math.floor(rand() * 6) * HOUR;
    const code = codePartage(rand, codes);
    codes.add(code);
    st.users.push({ id, email_confirme: true, is_anonymous: false });
    st.profiles.push({
      id, pseudo, email: `membre${i + 1}@exemple.invalid`, camp, newsletter: rand() > 0.5,
      riche_message: richeMessage || null, riche_montant: richeMontant || null,
      code_partage: code, invite_par: i > 20 && rand() > 0.7 ? st.profiles[Math.floor(rand() * 10)].id : null,
      regles_acceptees_le: iso(created), bloque: false, cree_le: iso(created)
    });
  });
  // Examples (team)
  EXEMPLES.forEach(([categorie, titre, texte, montant], i) => {
    const t = now - (35 - i) * DAY;
    st.problems.push({ id: uuid(rand), user_id: null, categorie, titre, texte, montant, statut: 'publie', est_exemple: true, masque: false, cree_le: iso(t), modere_le: iso(t) });
  });
  // Member problems, spread over the last 20 days (newest last in the list)
  PROBLEMES.forEach(([categorie, titre, texte, montant, idx, statut], i) => {
    const t = now - (20 - i * 0.45) * DAY - Math.floor(rand() * 10) * HOUR;
    st.problems.push({
      id: uuid(rand), user_id: st.profiles[idx].id, categorie, titre, texte, montant, statut,
      est_exemple: false, masque: false, cree_le: iso(t), modere_le: statut === 'recu' ? null : iso(t + 3 * HOUR)
    });
  });
  // Reactions & comments on published problems
  const published = st.problems.filter((p) => p.statut === 'publie');
  for (const p of published) {
    const popularity = p.est_exemple ? 0.55 : 0.12 + rand() * 0.45;
    for (const prof of st.profiles) {
      for (const type of ['rire', 'courage', 'paierais']) {
        const bias = type === 'rire' ? 1 : type === 'courage' ? 0.6 : (prof.camp === 'riche' ? 0.9 : 0.35);
        if (rand() < popularity * bias) {
          st.reactions.push({ problem_id: p.id, user_id: prof.id, type, cree_le: iso(Date.parse(p.cree_le) + rand() * 2 * DAY) });
        }
      }
    }
    const nbComments = Math.floor(rand() * 5);
    for (let c = 0; c < nbComments; c++) {
      const author = st.profiles[Math.floor(rand() * st.profiles.length)];
      st.comments.push({
        id: uuid(rand), problem_id: p.id, user_id: author.id,
        texte: COMMENTAIRES[Math.floor(rand() * COMMENTAIRES.length)],
        masque: false, masque_par: null, cree_le: iso(Math.min(now - HOUR, Date.parse(p.cree_le) + (c + 1) * (2 + rand() * 20) * HOUR))
      });
    }
  }
  // Clubs: messages over the last 2 days
  const club = (list, camp) => list.forEach(([idx, texte], i) => {
    st.club_messages.push({ id: uuid(rand), camp, user_id: st.profiles[idx].id, texte, masque: false, cree_le: iso(now - (list.length - i) * 2.7 * HOUR) });
  });
  club(CLUB_RICHES, 'riche');
  club(CLUB_PAUVRES, 'pauvre');
  st.comments.sort((a, b) => a.cree_le.localeCompare(b.cree_le));
  return st;
}

/* ---------------- API factory ---------------- */

export function createDemoApi({ storage = defaultStorage(), now = () => Date.now(), key = DEMO_KEY } = {}) {
  let clock = now;
  let rand = Math.random;

  function load() {
    let raw = null;
    try { raw = storage.getItem(key); } catch { raw = null; }
    if (raw) {
      try {
        const st = JSON.parse(raw);
        if (st && st.version === 1) return st;
      } catch { /* corrupted: reseed */ }
    }
    const st = buildSeed(clock());
    save(st);
    return st;
  }
  function save(st) {
    try { storage.setItem(key, JSON.stringify(st)); } catch { /* quota or privacy mode: keep going in memory */ }
  }
  /** Runs fn on the state and persists it (write operations). */
  function tx(fn) {
    const st = load();
    const result = fn(st);
    save(st);
    return result;
  }
  const t = () => clock();

  /* ----- identity ----- */
  function uid(st) { return st.session ? st.session.userId : null; }
  function me(st) {
    const id = uid(st);
    return id ? st.profiles.find((p) => p.id === id) || null : null;
  }
  /** Caller must have a profile and not be blocked (every write function). */
  function writer(st) {
    if (!uid(st)) throw ERR.nonConnecte();
    const p = me(st);
    if (!p) throw ERR.profilAbsent();
    if (p.bloque) throw ERR.bloque();
    return p;
  }
  const pseudoOf = (st, userId) => {
    const p = st.profiles.find((x) => x.id === userId);
    return p ? { pseudo: p.pseudo, camp: p.camp } : { pseudo: 'Membre parti', camp: null };
  };
  const recent = (rows, userId, windowMs) => rows.filter((r) => r.user_id === userId && Date.parse(r.cree_le) > t() - windowMs).length;

  /* ----- public projections (never expose email, user_id, unpublished or masked rows) ----- */
  function visibleProblem(p) {
    return p && p.statut === 'publie' && !p.masque;
  }
  function problemRow(st, p) {
    const author = p.est_exemple || !p.user_id ? { pseudo: TEAM_PSEUDO, camp: null } : pseudoOf(st, p.user_id);
    const count = (type) => st.reactions.filter((r) => r.problem_id === p.id && r.type === type).length;
    const myId = uid(st);
    return {
      id: p.id, categorie: p.categorie, titre: p.titre, texte: p.texte, montant: p.montant,
      pseudo: author.pseudo, camp: author.camp, est_exemple: !!p.est_exemple, cree_le: p.modere_le || p.cree_le,
      rire: count('rire'), courage: count('courage'), paierais: count('paierais'),
      commentaires: st.comments.filter((c) => c.problem_id === p.id && !c.masque).length,
      est_mon_probleme: !!myId && p.user_id === myId
    };
  }
  const sortDate = (p) => p.modere_le || p.cree_le;

  const api = {
    mode: 'demo',

    /* ================= Public reads ================= */

    async getCompteurs() {
      const st = load();
      const emails = new Set(st.profiles.map((p) => p.email.toLowerCase()));
      return {
        problemes: st.problems.filter((p) => !p.est_exemple).length,
        membres: emails.size,
        riches: st.profiles.filter((p) => p.camp === 'riche').length,
        pauvres: st.profiles.filter((p) => p.camp === 'pauvre').length,
        milliardaires_verifies: st.verifications.length
      };
    },

    async getChiffres() {
      const st = load();
      const pub = st.problems.filter((p) => p.statut === 'publie' && !p.est_exemple);
      const parCat = CATEGORY_IDS.map((categorie) => ({ categorie, nombre: pub.filter((p) => p.categorie === categorie).length }))
        .filter((c) => c.nombre > 0)
        .sort((a, b) => b.nombre - a.nombre);
      return {
        montant_total: pub.reduce((s, p) => s + (p.montant || 0), 0),
        finance: 0,
        par_categorie: parCat,
        membres: new Set(st.profiles.map((p) => p.email.toLowerCase())).size,
        problemes_publies: pub.length,
        reactions: st.reactions.length,
        commentaires: st.comments.filter((c) => !c.masque).length,
        riches: st.profiles.filter((p) => p.camp === 'riche').length,
        pauvres: st.profiles.filter((p) => p.camp === 'pauvre').length
      };
    },

    async getProblemesPublics({ categorie = null, limite = 12, avant = null } = {}) {
      if (categorie !== null && categorie !== undefined && categorie !== '' && !CATEGORY_IDS.includes(categorie)) throw ERR.invalide('Catégorie inconnue.');
      if (avant !== null && avant !== undefined && !isIsoDate(avant)) throw ERR.invalide('Curseur de pagination invalide.');
      const lim = Math.max(1, Math.min(48, Number.isInteger(limite) ? limite : 12));
      const st = load();
      return st.problems
        .filter(visibleProblem)
        .filter((p) => !categorie || p.categorie === categorie)
        .filter((p) => !avant || sortDate(p) < avant)
        .sort((a, b) => sortDate(b).localeCompare(sortDate(a)))
        .slice(0, lim)
        .map((p) => problemRow(st, p));
    },

    async getProblemePublic(id) {
      if (!isUuid(id)) return null;
      const st = load();
      const p = st.problems.find((x) => x.id === id);
      return visibleProblem(p) ? problemRow(st, p) : null;
    },

    async getProblemeHasard() {
      const st = load();
      const pub = st.problems.filter(visibleProblem);
      if (!pub.length) return null;
      return pub[Math.floor(rand() * pub.length)].id;
    },

    async getCommentaires(problemId, avant = null) {
      if (!isUuid(problemId)) throw ERR.invalide('Identifiant de problème invalide.');
      if (avant !== null && avant !== undefined && !isIsoDate(avant)) throw ERR.invalide('Curseur de pagination invalide.');
      const st = load();
      const p = st.problems.find((x) => x.id === problemId);
      if (!visibleProblem(p)) return [];
      const myId = uid(st);
      return st.comments
        .filter((c) => c.problem_id === problemId && (!avant || c.cree_le < avant))
        .sort((a, b) => b.cree_le.localeCompare(a.cree_le))
        .slice(0, 50)
        .map((c) => {
          const a = pseudoOf(st, c.user_id);
          return {
            id: c.id, pseudo: a.pseudo, camp: a.camp, texte: c.masque ? null : c.texte, masque: !!c.masque,
            cree_le: c.cree_le, est_auteur_probleme: !!p.user_id && c.user_id === p.user_id, est_moi: !!myId && c.user_id === myId
          };
        });
    },

    /* ================= Members ================= */

    async creerProfil({ camp, pseudo, email, newsletter = false, codeRef = null } = {}) {
      return tx((st) => {
        const id = uid(st);
        if (!id) throw ERR.nonConnecte();
        if (me(st)) throw ERR.invalide('Ton profil existe déjà.');
        if (camp !== 'riche' && camp !== 'pauvre') throw ERR.invalide('Choisis un camp : riche ou pauvre.');
        const ps = texteValide(pseudo, LIMITES.pseudo, 'Ton pseudo', { mots: st.mots_interdits });
        const em = nettoyer(email).toLowerCase();
        if (!RE_EMAIL_VALIDE.test(em) || em.length > 254) throw ERR.invalide('Ton adresse e-mail n’a pas l’air valide.');
        const codes = new Set(st.profiles.map((p) => p.code_partage));
        const code = codePartage(rand, codes);
        let invitePar = null;
        if (typeof codeRef === 'string' && /^[A-Z0-9]{8}$/i.test(codeRef)) {
          const parrain = st.profiles.find((p) => p.code_partage === codeRef.toUpperCase());
          if (parrain && parrain.id !== id) invitePar = parrain.id;
        }
        st.profiles.push({
          id, pseudo: ps, email: em, camp, newsletter: newsletter === true, riche_message: null, riche_montant: null,
          code_partage: code, invite_par: invitePar, regles_acceptees_le: iso(t()), bloque: false, cree_le: iso(t())
        });
        return { code_partage: code };
      });
    },

    async majProfil({ pseudo = null, newsletter = null, camp = null, riche_message = undefined, riche_montant = undefined } = {}) {
      return tx((st) => {
        const p = writer(st);
        if (pseudo !== null && pseudo !== undefined) p.pseudo = texteValide(pseudo, LIMITES.pseudo, 'Ton pseudo', { mots: st.mots_interdits });
        if (newsletter !== null && newsletter !== undefined) p.newsletter = newsletter === true;
        if (camp !== null && camp !== undefined) {
          if (camp !== 'riche' && camp !== 'pauvre') throw ERR.invalide('Choisis un camp : riche ou pauvre.');
          p.camp = camp;
        }
        if (riche_message !== undefined) {
          p.riche_message = riche_message === null || nettoyer(riche_message) === ''
            ? null
            : texteValide(riche_message, LIMITES.richeMessage, 'Ton message', { multiligne: true, mots: st.mots_interdits });
        }
        if (riche_montant !== undefined) p.riche_montant = entierValide(riche_montant, LIMITES.richeMontant, 'Le montant');
        return { pseudo: p.pseudo, camp: p.camp, newsletter: p.newsletter, riche_message: p.riche_message, riche_montant: p.riche_montant };
      });
    },

    async soumettreProbleme({ categorie, titre, texte, montant = null } = {}) {
      return tx((st) => {
        const p = writer(st);
        if (!CATEGORY_IDS.includes(categorie)) throw ERR.invalide('Choisis une catégorie.');
        const ti = texteValide(titre, LIMITES.titre, 'Le titre', { mots: st.mots_interdits });
        const tx2 = texteValide(texte, LIMITES.texte, 'Le texte', { multiligne: true, mots: st.mots_interdits });
        const mt = p.camp === 'pauvre' ? montantPauvre(montant) : entierValide(montant, LIMITES.montant, 'Le montant');
        if (recent(st.problems, p.id, DAY) >= 10) throw ERR.limite('Tu as déjà envoyé 10 problèmes en 24 h. Reviens demain !');
        // Published at once when automatic publication is on and nothing sensitive is detected
        // (same rule as soumettre_probleme in 005_publication_auto.sql); otherwise waits for a human review.
        const auto = !(st.reglages && st.reglages.publication_auto === false);
        const sensible = contientMotSensible(`${ti}\n${tx2}`, st.mots_sensibles || MOTS_SENSIBLES_DEFAUT);
        const statut = auto && !sensible ? 'publie' : 'recu';
        const row = { id: uuid(rand), user_id: p.id, categorie, titre: ti, texte: tx2, montant: mt, statut, est_exemple: false, masque: false, cree_le: iso(t()), modere_le: null };
        st.problems.push(row);
        return { id: row.id, statut };
      });
    },

    async reagir(problemId, type) {
      return tx((st) => {
        const p = writer(st);
        if (!['rire', 'courage', 'paierais'].includes(type)) throw ERR.invalide('Réaction inconnue.');
        const pb = isUuid(problemId) ? st.problems.find((x) => x.id === problemId) : null;
        if (!visibleProblem(pb)) throw ERR.introuvable();
        const i = st.reactions.findIndex((r) => r.problem_id === problemId && r.user_id === p.id && r.type === type);
        let actif;
        if (i >= 0) { st.reactions.splice(i, 1); actif = false; } else { st.reactions.push({ problem_id: problemId, user_id: p.id, type, cree_le: iso(t()) }); actif = true; }
        const c = (ty) => st.reactions.filter((r) => r.problem_id === problemId && r.type === ty).length;
        return { actif, rire: c('rire'), courage: c('courage'), paierais: c('paierais') };
      });
    },

    async getMesReactions(problemIds = []) {
      const st = load();
      const id = uid(st);
      if (!id || !me(st)) return [];
      if (!Array.isArray(problemIds)) throw ERR.invalide('Liste de problèmes invalide.');
      const ids = new Set(problemIds.filter(isUuid).slice(0, 100));
      return st.reactions.filter((r) => r.user_id === id && ids.has(r.problem_id)).map((r) => ({ problem_id: r.problem_id, type: r.type }));
    },

    async commenter(problemId, texte) {
      return tx((st) => {
        const p = writer(st);
        const pb = isUuid(problemId) ? st.problems.find((x) => x.id === problemId) : null;
        if (!visibleProblem(pb)) throw ERR.introuvable();
        const v = texteValide(texte, LIMITES.commentaire, 'Ton commentaire', { multiligne: true, mots: st.mots_interdits });
        if (recent(st.comments, p.id, HOUR) >= 10) throw ERR.limite('Tu as déjà écrit 10 commentaires cette heure-ci. Petite pause ?');
        const c = { id: uuid(rand), problem_id: problemId, user_id: p.id, texte: v, masque: false, masque_par: null, cree_le: iso(t()) };
        st.comments.push(c);
        return { id: c.id, pseudo: p.pseudo, camp: p.camp, texte: c.texte, masque: false, cree_le: c.cree_le, est_auteur_probleme: pb.user_id === p.id, est_moi: true };
      });
    },

    async supprimerMonCommentaire(commentId) {
      return tx((st) => {
        const p = writer(st);
        const i = st.comments.findIndex((c) => c.id === commentId);
        if (i < 0) throw ERR.introuvable('Ce commentaire est introuvable.');
        if (st.comments[i].user_id !== p.id) throw ERR.interdit('Tu ne peux supprimer que tes propres commentaires.');
        const id = st.comments[i].id;
        st.comments.splice(i, 1);
        st.reports = st.reports.filter((r) => !(r.cible_type === 'commentaire' && r.cible_id === id));
        return true;
      });
    },

    async masquerCommentaire(commentId) {
      return tx((st) => {
        const p = writer(st);
        const c = st.comments.find((x) => x.id === commentId);
        if (!c) throw ERR.introuvable('Ce commentaire est introuvable.');
        const pb = st.problems.find((x) => x.id === c.problem_id);
        if (!pb || pb.user_id !== p.id) throw ERR.interdit('Seul l’auteur du problème peut masquer un commentaire.');
        c.masque = true;
        c.masque_par = 'auteur_probleme';
        return true;
      });
    },

    async getClubMessages(apres = null) {
      const st = load();
      const p = writer(st);
      if (apres !== null && apres !== undefined && !isIsoDate(apres)) throw ERR.invalide('Curseur invalide.');
      const rows = st.club_messages
        .filter((m) => m.camp === p.camp && !m.masque)
        .sort((a, b) => a.cree_le.localeCompare(b.cree_le));
      const list = apres ? rows.filter((m) => m.cree_le > apres) : rows.slice(-100);
      return list.map((m) => ({ id: m.id, pseudo: pseudoOf(st, m.user_id).pseudo, texte: m.texte, cree_le: m.cree_le, est_moi: m.user_id === p.id }));
    },

    async envoyerMessageClub(texte) {
      return tx((st) => {
        const p = writer(st);
        const v = texteValide(texte, LIMITES.message, 'Ton message', { multiligne: true, mots: st.mots_interdits });
        if (recent(st.club_messages, p.id, HOUR) >= 30) throw ERR.limite('Tu as déjà envoyé 30 messages cette heure-ci. Laisse parler les autres un peu !');
        const m = { id: uuid(rand), camp: p.camp, user_id: p.id, texte: v, masque: false, cree_le: iso(t()) };
        st.club_messages.push(m);
        return { id: m.id, pseudo: p.pseudo, texte: m.texte, cree_le: m.cree_le, est_moi: true };
      });
    },

    async signaler(cibleType, cibleId) {
      return tx((st) => {
        const p = writer(st);
        const tables = { probleme: 'problems', commentaire: 'comments', message: 'club_messages' };
        if (!tables[cibleType]) throw ERR.invalide('Type de contenu inconnu.');
        if (!isUuid(cibleId)) throw ERR.invalide('Identifiant invalide.');
        const cible = st[tables[cibleType]].find((x) => x.id === cibleId);
        if (!cible) throw ERR.introuvable('Ce contenu est introuvable.');
        if (cibleType === 'probleme' && !visibleProblem(cible)) throw ERR.introuvable();
        if (cibleType === 'message' && cible.camp !== p.camp) throw ERR.introuvable('Ce contenu est introuvable.');
        if (st.reports.some((r) => r.cible_type === cibleType && r.cible_id === cibleId && r.user_id === p.id)) {
          throw new ApiError('Tu as déjà signalé ce contenu. Merci, on regarde ça.', 'deja_fait');
        }
        if (recent(st.reports, p.id, HOUR) >= 20) throw ERR.limite('Tu as déjà fait 20 signalements cette heure-ci. On s’en occupe !');
        st.reports.push({ id: uuid(rand), cible_type: cibleType, cible_id: cibleId, user_id: p.id, cree_le: iso(t()) });
        const total = st.reports.filter((r) => r.cible_type === cibleType && r.cible_id === cibleId).length;
        if (total >= 3 && !cible.masque) {
          cible.masque = true;
          if (cibleType === 'commentaire') cible.masque_par = 'signalements';
        }
        return { masque: !!cible.masque };
      });
    },

    async getMonEspace() {
      const st = load();
      if (!uid(st)) throw ERR.nonConnecte();
      const p = me(st);
      if (!p) throw ERR.profilAbsent();
      const user = st.users.find((u) => u.id === p.id);
      return {
        pseudo: p.pseudo, email: p.email, camp: p.camp, newsletter: p.newsletter,
        riche_message: p.riche_message, riche_montant: p.riche_montant, code_partage: p.code_partage,
        nb_invites: st.profiles.filter((x) => x.invite_par === p.id).length,
        email_confirme: !!(user && user.email_confirme), bloque: !!p.bloque, verifie: st.verifications.some((v) => v.user_id === p.id),
        problemes: st.problems.filter((x) => x.user_id === p.id)
          .sort((a, b) => b.cree_le.localeCompare(a.cree_le))
          .map((x) => ({ id: x.id, titre: x.titre, statut: x.statut, masque: !!x.masque, cree_le: x.cree_le }))
      };
    },

    async supprimerMonCompte() {
      return tx((st) => {
        const id = uid(st);
        if (!id) throw ERR.nonConnecte();
        const myProblems = new Set(st.problems.filter((p) => p.user_id === id).map((p) => p.id));
        st.reactions = st.reactions.filter((r) => r.user_id !== id && !myProblems.has(r.problem_id));
        st.comments = st.comments.filter((c) => c.user_id !== id && !myProblems.has(c.problem_id));
        st.club_messages = st.club_messages.filter((m) => m.user_id !== id);
        st.reports = st.reports.filter((r) => r.user_id !== id);
        st.problems = st.problems.filter((p) => p.user_id !== id);
        st.verifications = st.verifications.filter((v) => v.user_id !== id);
        st.moderateurs = (st.moderateurs || []).filter((m) => m !== id);
        for (const p of st.profiles) if (p.invite_par === id) p.invite_par = null;
        st.profiles = st.profiles.filter((p) => p.id !== id);
        st.users = st.users.filter((u) => u.id !== id);
        st.session = null;
        return true;
      });
    },

    /* ================= Auth (simulated) ================= */

    /**
     * Parcours B. Demo: creates an anonymous user + profile in one go.
     * If the e-mail already belongs to a confirmed member → { statut: 'deja_membre' } (a magic link would be sent).
     */
    async rejoindre({ camp, pseudo, email, newsletter = false, majeur, regles, codeRef = null } = {}) {
      if (majeur !== true) throw ERR.invalide('Il faut avoir 18 ans ou plus pour rejoindre un camp.');
      if (regles !== true) throw ERR.invalide('Accepte les règles du jeu pour continuer.');
      const em = nettoyer(email).toLowerCase();
      if (!RE_EMAIL_VALIDE.test(em)) throw ERR.invalide('Ton adresse e-mail n’a pas l’air valide.');
      const st = load();
      const existing = st.profiles.find((p) => p.email === em);
      if (existing) {
        const user = st.users.find((u) => u.id === existing.id);
        if (user && user.email_confirme) return { statut: 'deja_membre' };
      }
      // Validate before creating the anonymous user (so a filtered pseudo leaves nothing behind)
      if (camp !== 'riche' && camp !== 'pauvre') throw ERR.invalide('Choisis un camp : riche ou pauvre.');
      texteValide(pseudo, LIMITES.pseudo, 'Ton pseudo', { mots: st.mots_interdits });
      const id = uuid(rand);
      tx((s) => {
        s.users.push({ id, email_confirme: false, is_anonymous: true });
        s.session = { userId: id };
      });
      try {
        const { code_partage } = await api.creerProfil({ camp, pseudo, email: em, newsletter, codeRef });
        return { statut: 'cree', code_partage };
      } catch (e) {
        tx((s) => { s.users = s.users.filter((u) => u.id !== id); s.session = null; });
        throw e;
      }
    },

    /** Parcours C. Demo: no e-mail can be sent, so a confirmed member is signed in directly. */
    async seReconnecter(email) {
      const em = nettoyer(email).toLowerCase();
      if (!RE_EMAIL_VALIDE.test(em)) throw ERR.invalide('Ton adresse e-mail n’a pas l’air valide.');
      return tx((st) => {
        const p = st.profiles.find((x) => x.email === em);
        const user = p && st.users.find((u) => u.id === p.id);
        if (!p || !user || !user.email_confirme) {
          throw new ApiError('On ne trouve pas de compte confirmé avec cet e-mail. Rejoins un camp, ça prend 10 secondes.', 'aucun_compte');
        }
        st.session = { userId: p.id };
        return { statut: 'connecte' };
      });
    },

    async seDeconnecter() {
      tx((st) => { st.session = null; });
      return true;
    },

    async getSession() {
      const st = load();
      const id = uid(st);
      if (!id) return { connecte: false, userId: null, profil: null };
      const p = me(st);
      const user = st.users.find((u) => u.id === id);
      return {
        connecte: true, userId: id,
        profil: p ? { pseudo: p.pseudo, camp: p.camp, code_partage: p.code_partage, bloque: !!p.bloque, email_confirme: !!(user && user.email_confirme) } : null
      };
    },

    /**
     * Demo: the confirmation e-mail is "clicked" immediately. Like Supabase, an address already confirmed
     * by another account is refused (email_pris), and an account without an auth address uses its profile one (R-024).
     */
    async renvoyerConfirmation() {
      return tx((st) => {
        const id = uid(st);
        if (!id) throw ERR.nonConnecte();
        const user = st.users.find((u) => u.id === id);
        if (user && emailPrisAilleurs(st, id)) {
          throw new ApiError('Cette adresse est déjà liée à un autre compte. Utilise « Déjà membre ? » avec cette adresse.', 'email_pris');
        }
        if (user) { user.email_confirme = true; user.is_anonymous = false; user.email_non_rattache = false; }
        return { statut: 'confirme' };
      });
    },

    /**
     * Silent catch-up (= api-supabase.js): an account whose e-mail never reached the auth side
     * (demoAdmin.simulerEmailNonRattache) gets its profile address attached. Never throws.
     */
    async rattraperEmail() {
      return tx((st) => {
        const id = uid(st);
        const user = id && st.users.find((u) => u.id === id);
        const p = id && st.profiles.find((x) => x.id === id);
        if (!user || !p || !p.email || !user.is_anonymous || !user.email_non_rattache) return { statut: 'inutile' };
        if (emailPrisAilleurs(st, id)) return { statut: 'email_pris' };
        user.email_non_rattache = false;
        return { statut: 'rattache' };
      });
    }
  };

  /** True when the profile address of `userId` belongs to another confirmed account. */
  function emailPrisAilleurs(st, userId) {
    const p = st.profiles.find((x) => x.id === userId);
    if (!p || !p.email) return false;
    return st.profiles.some((o) => o.id !== userId && o.email === p.email
      && st.users.some((u) => u.id === o.id && u.email_confirme));
  }

  /* ================= Moderation page (= mod_* functions of 006_moderateurs.sql) ================= */
  // Same rules as SQL: every function except suisJe() requires the caller to be in st.moderateurs
  // ('interdit' otherwise); results never contain an e-mail address.
  const MOD_TABLES = { probleme: 'problems', commentaire: 'comments', message: 'club_messages' };
  const MOD_ALIAS = { problem: 'probleme', comment: 'commentaire', club_message: 'message' };
  const estModo = (st) => !!uid(st) && (st.moderateurs || []).includes(uid(st));
  function exigerModo(st) {
    if (!estModo(st)) throw ERR.interdit('Accès réservé aux modérateurs.');
    return uid(st);
  }
  const auteur = (st, userId) => {
    const p = userId ? st.profiles.find((x) => x.id === userId) : null;
    return { pseudo: p ? p.pseudo : null, camp: p ? p.camp : null, user_id: userId || null, bloque: !!(p && p.bloque) };
  };
  const nbSignalements = (st, type, id, depuis = 0) =>
    st.reports.filter((r) => r.cible_type === type && r.cible_id === id && Date.parse(r.cree_le) > depuis).length;
  const problemeModo = (st, p) => ({
    id: p.id, cree_le: p.modere_le || p.cree_le, categorie: p.categorie, titre: p.titre, texte: p.texte, montant: p.montant,
    statut: p.statut, masque: !!p.masque, ...auteur(st, p.user_id), nb_signalements: nbSignalements(st, 'probleme', p.id)
  });
  const contenuDe = (type, row) => (type === 'probleme' ? `${row.titre} — ${row.texte}` : type === 'message' ? `[${row.camp}] ${row.texte}` : row.texte);

  api.moderation = {
    async suisJe() { return estModo(load()); },

    async aRelire() {
      const st = load();
      exigerModo(st);
      return st.problems.filter((p) => p.statut === 'recu')
        .sort((a, b) => a.cree_le.localeCompare(b.cree_le))
        .slice(0, 200)
        .map((p) => ({
          ...problemeModo(st, p), cree_le: p.cree_le,
          auteur_nb_publies: st.problems.filter((x) => p.user_id && x.user_id === p.user_id && x.statut === 'publie').length,
          auteur_signalements_24h: st.reports.filter((r) => p.user_id && r.user_id === p.user_id && Date.parse(r.cree_le) > t() - DAY).length
        }));
    },

    async recents(heures = 48) {
      const st = load();
      exigerModo(st);
      const h = Math.min(720, Math.max(1, Number.isInteger(heures) ? heures : 48));
      return st.problems
        .filter((p) => p.statut === 'publie' && !p.est_exemple && Date.parse(sortDate(p)) > t() - h * HOUR)
        .sort((a, b) => sortDate(b).localeCompare(sortDate(a)))
        .slice(0, 200)
        .map((p) => problemeModo(st, p));
    },

    async masques() {
      const st = load();
      exigerModo(st);
      const rows = [];
      for (const [type, table] of Object.entries(MOD_TABLES)) {
        for (const row of st[table].filter((x) => x.masque)) {
          rows.push({
            cible_type: type, cible_id: row.id, contenu: contenuDe(type, row), masque: true,
            masque_par: type === 'commentaire' ? row.masque_par || null : null,
            nb_signalements: nbSignalements(st, type, row.id), ...auteur(st, row.user_id),
            statut: type === 'probleme' ? row.statut : null, cree_le: row.cree_le
          });
        }
      }
      return rows.sort((a, b) => b.cree_le.localeCompare(a.cree_le)).slice(0, 200)
        .map(({ camp, ...r }) => r);
    },

    async signalements24h() {
      const st = load();
      exigerModo(st);
      const depuis = t() - DAY;
      const groupes = new Map();
      for (const r of st.reports.filter((x) => Date.parse(x.cree_le) > depuis)) {
        const k = `${r.cible_type}:${r.cible_id}`;
        const g = groupes.get(k) || { cible_type: r.cible_type, cible_id: r.cible_id, nb_signalements: 0, premier: r.cree_le, dernier: r.cree_le };
        g.nb_signalements++;
        if (r.cree_le < g.premier) g.premier = r.cree_le;
        if (r.cree_le > g.dernier) g.dernier = r.cree_le;
        groupes.set(k, g);
      }
      return [...groupes.values()].map((g) => {
        const row = st[MOD_TABLES[g.cible_type]].find((x) => x.id === g.cible_id);
        const a = auteur(st, row && row.user_id);
        return {
          ...g, contenu: row ? contenuDe(g.cible_type, row) : '(contenu supprimé)', masque: !!(row && row.masque),
          statut: g.cible_type === 'probleme' && row ? row.statut : null, user_id: a.user_id, pseudo: a.pseudo, bloque: a.bloque
        };
      }).sort((a, b) => b.nb_signalements - a.nb_signalements || b.dernier.localeCompare(a.dernier)).slice(0, 200);
    },

    async modererProbleme(id, statut) {
      return tx((st) => {
        exigerModo(st);
        if (!['recu', 'publie', 'refuse', 'reoriente'].includes(statut)) throw ERR.invalide('Statut inconnu (recu, publie, refuse, reoriente).');
        const p = st.problems.find((x) => x.id === id);
        if (!p) throw ERR.introuvable('Ce problème est introuvable.');
        p.statut = statut;
        p.modere_le = statut === 'recu' ? null : iso(t());
        return { id, statut };
      });
    },

    async masquer(type, id, masque = true) {
      return tx((st) => {
        exigerModo(st);
        const ty = MOD_ALIAS[type] || type;
        if (!MOD_TABLES[ty]) throw ERR.invalide('Type de contenu inconnu.');
        const row = st[MOD_TABLES[ty]].find((x) => x.id === id);
        if (!row) throw ERR.introuvable('Contenu introuvable.');
        const v = masque !== false;
        row.masque = v;
        if (ty === 'commentaire') row.masque_par = v ? 'admin' : null;
        return { cible_type: ty, cible_id: id, masque: v };
      });
    },

    async bloquer(userId, bloque = true) {
      return tx((st) => {
        const moi = exigerModo(st);
        if (userId === moi) throw ERR.invalide('Tu ne peux pas te bloquer toi-même.');
        const p = st.profiles.find((x) => x.id === userId);
        if (!p) throw ERR.introuvable('Membre introuvable.');
        p.bloque = bloque !== false;
        return { user_id: userId, bloque: p.bloque };
      });
    }
  };

  /* ================= Moderation helpers (tests & demo only) ================= */
  const setStatut = (statut) => async (problemId) => tx((st) => {
    const p = st.problems.find((x) => x.id === problemId);
    if (!p) throw ERR.introuvable();
    p.statut = statut;
    p.modere_le = iso(t());
    return true;
  });
  api.demoAdmin = {
    publier: setStatut('publie'),
    refuser: setStatut('refuse'),
    reorienter: setStatut('reoriente'),
    /** Automatic publication on/off (= public.reglages 'publication_auto'). */
    async setPublicationAuto(valeur = true) {
      return tx((st) => { st.reglages = { ...(st.reglages || {}), publication_auto: valeur !== false }; return true; });
    },
    async bloquer(userId, valeur = true) {
      return tx((st) => { const p = st.profiles.find((x) => x.id === userId); if (!p) throw ERR.introuvable('Membre introuvable.'); p.bloque = valeur; return true; });
    },
    async verifier(userId) {
      return tx((st) => {
        if (!st.profiles.some((x) => x.id === userId)) throw ERR.introuvable('Membre introuvable.');
        if (!st.verifications.some((v) => v.user_id === userId)) st.verifications.push({ user_id: userId, verifie_le: iso(t()) });
        return true;
      });
    },
    async masquer(type, id, valeur = true) {
      const tables = { probleme: 'problems', commentaire: 'comments', message: 'club_messages' };
      return tx((st) => { const row = (st[tables[type]] || []).find((x) => x.id === id); if (!row) throw ERR.introuvable('Contenu introuvable.'); row.masque = valeur; if (type === 'commentaire') row.masque_par = valeur ? 'admin' : null; return true; });
    },
    /** Adds (or removes) a moderator (= insert into public.moderateurs, SQL editor only). */
    async setModerateur(userId, valeur = true) {
      return tx((st) => {
        if (!st.users.some((u) => u.id === userId)) throw ERR.introuvable('Membre introuvable.');
        const autres = (st.moderateurs || []).filter((m) => m !== userId);
        st.moderateurs = valeur === false ? autres : [...autres, userId];
        return true;
      });
    },
    /** Simulates an account created while e-mail sending was failing (no address on the auth side, R-024). */
    async simulerEmailNonRattache(userId) {
      return tx((st) => {
        const u = st.users.find((x) => x.id === userId);
        if (!u) throw ERR.introuvable('Membre introuvable.');
        u.email_non_rattache = true; u.email_confirme = false; u.is_anonymous = true;
        return true;
      });
    },
    /** Signs in as an existing member (tests). */
    async connecterEnTantQue(userId) {
      return tx((st) => { if (!st.users.some((u) => u.id === userId)) throw ERR.introuvable('Membre introuvable.'); st.session = { userId }; return true; });
    },
    /** Read-only snapshot of the raw state (tests only: contains e-mails). */
    etatBrut() { return JSON.parse(JSON.stringify(load())); },
    membres(camp = null) { return load().profiles.filter((p) => !camp || p.camp === camp).map((p) => ({ id: p.id, pseudo: p.pseudo, camp: p.camp })); },
    reinitialiser() { try { storage.removeItem(key); } catch { /* ignore */ } return true; },
    setHorloge(fn) { clock = fn; },
    setHasard(fn) { rand = fn; }
  };

  return api;
}
