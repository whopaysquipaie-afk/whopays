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
import { MEMBRES, EXEMPLES, PROBLEMES, POSTS_RICHES, COMMENTAIRES, CLUB_RICHES, CLUB_PAUVRES } from './demo-data.js';

export const DEMO_KEY = 'whopays_demo_v1';
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const TYPES = ['pauvre', 'riche', 'publication'];

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
  limite: (msg) => new ApiError(msg, 'limite'),
  richeEnAttente: () => new ApiError('Ton compte riche attend la validation d’un modérateur : tu peux lire le site, mais pas encore publier, réagir, commenter ni écrire au club.', 'riche_en_attente')
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
    moderateurs: [],
    annonces: [], annonce_envois: [],
    couronnes: [], notifications: [], suivis: [], duels: [], defis: []
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
      id, pseudo, email: `membre${i + 1}@demo.invalid`, camp, newsletter: rand() > 0.5,
      riche_message: richeMessage || null, riche_montant: richeMontant || null,
      statut_riche: camp === 'riche' ? 'actif' : 'en_attente', riche_formule: null, riche_jusqu_au: null,
      jeton_desinscription: uuid(rand),
      code_partage: code, invite_par: i > 20 && rand() > 0.7 ? st.profiles[Math.floor(rand() * 10)].id : null,
      regles_acceptees_le: iso(created), bloque: false, cree_le: iso(created)
    });
  });
  // Examples (team)
  EXEMPLES.forEach(([categorie, titre, texte, montant], i) => {
    const t = now - (35 - i) * DAY;
    st.problems.push({ id: uuid(rand), user_id: null, type: 'pauvre', premiere: false, categorie, titre, texte, montant, statut: 'publie', est_exemple: true, masque: false, cree_le: iso(t), modere_le: iso(t) });
  });
  // Member problems, spread over the last 20 days (newest last in the list)
  PROBLEMES.forEach(([categorie, titre, texte, montant, idx, statut], i) => {
    const t = now - (20 - i * 0.45) * DAY - Math.floor(rand() * 10) * HOUR;
    st.problems.push({
      id: uuid(rand), user_id: st.profiles[idx].id, type: 'pauvre', premiere: false, categorie, titre, texte, montant, statut,
      est_exemple: false, masque: false, cree_le: iso(t), modere_le: statut === 'recu' ? null : iso(t + 3 * HOUR)
    });
  });
  // Posts of rich members (R-030), spread over the last 6 days
  const dejaPoste = new Set();
  POSTS_RICHES.forEach(([type, titre, texte, montant, idx], i) => {
    const t = now - (6 - i * 1.1) * DAY - Math.floor(rand() * 5) * HOUR;
    const user = st.profiles[idx].id;
    st.problems.push({
      id: uuid(rand), user_id: user, type, premiere: !dejaPoste.has(user), categorie: null, titre, texte, montant,
      statut: 'publie', est_exemple: false, masque: false, cree_le: iso(t), modere_le: null
    });
    dejaPoste.add(user);
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
  // R-047: a few follows (the first members follow some funny ones)
  st.suivis = [];
  const droles = st.profiles.filter((p) => p.camp === 'pauvre').slice(0, 4);
  st.profiles.slice(0, 18).forEach((f, i) => droles.slice(0, 1 + (i % 4)).forEach((d) => {
    if (d.id !== f.id) st.suivis.push({ suiveur_id: f.id, suivi_id: d.id, cree_le: iso(now - (i + 1) * HOUR) });
  }));
  // R-037: a few crowns from the rich over the last 2 days, with the authors' notifications
  const riches = st.profiles.filter((p) => p.camp === 'riche').slice(0, 3);
  const recentsPauvres = st.problems.filter((p) => p.statut === 'publie' && p.type === 'pauvre' && !p.est_exemple).slice(-8);
  riches.forEach((r, i) => [0, 3].forEach((k, j) => {
    const pb = recentsPauvres[(i * 2 + k) % recentsPauvres.length];
    if (!pb || st.couronnes.some((c) => c.problem_id === pb.id && c.riche_id === r.id)) return;
    const quand = iso(now - (i * 14 + j * 5 + 2) * HOUR);
    st.couronnes.push({ problem_id: pb.id, riche_id: r.id, retiree: false, cree_le: quand });
    st.notifications.push({ id: uuid(rand), user_id: pb.user_id, type: 'couronne', texte: `Le riche ${r.pseudo} a couronné ton problème « ${pb.titre} » 👑`, lien: `p.html?id=${pb.id}`, lu: false, cree_le: quand });
  }));
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
        if (st && st.version === 1) {
          // States saved before R-031: every member gets an unsubscribe token (= default of 012)
          // R-034: the demo addresses of older saved states move to @demo.invalid
          if (st.users && st.users.some((u) => /@exemple\.invalid$/.test(u.email || ''))) {
            for (const u of st.users) if (u.email) u.email = u.email.replace(/@exemple\.invalid$/, '@demo.invalid');
            for (const p of st.profiles) if (p.email) p.email = p.email.replace(/@exemple\.invalid$/, '@demo.invalid');
            save(st);
          } else if (st.profiles.some((p) => /@exemple\.invalid$/.test(p.email || ''))) {
            for (const p of st.profiles) if (p.email) p.email = p.email.replace(/@exemple\.invalid$/, '@demo.invalid');
            save(st);
          }
          // R-037: states saved before 015
          if (!st.couronnes) st.couronnes = [];
          if (!st.notifications) st.notifications = [];
          if (!st.suivis) st.suivis = [];
          if (!st.duels) st.duels = [];
          if (!st.defis) st.defis = [];
          if (st.profiles.some((p) => !p.jeton_desinscription)) {
            for (const p of st.profiles) if (!p.jeton_desinscription) p.jeton_desinscription = uuid(Math.random);
            save(st);
          }
          return st;
        }
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
    if (p.camp === 'riche' && !richeActif(st, p)) throw ERR.richeEnAttente();
    return p;
  }
  /** = wp_riche_actif (010): a moderator, or 'actif' with no end date / an end date in the future. */
  function richeActif(st, p) {
    if (!p || p.camp !== 'riche') return false;
    if ((st.moderateurs || []).includes(p.id)) return true;
    // profiles stored before R-029 have no statut_riche: active, like the 010 migration
    const statut = p.statut_riche === undefined ? 'actif' : p.statut_riche;
    return statut === 'actif' && (!p.riche_jusqu_au || Date.parse(p.riche_jusqu_au) > t());
  }
  const statutRiche = (st, p) => (p.camp !== 'riche' ? null : richeActif(st, p) ? 'actif' : 'en_attente');
  const pseudoOf = (st, userId) => {
    const p = st.profiles.find((x) => x.id === userId);
    return p ? { pseudo: p.pseudo, camp: p.camp } : { pseudo: 'Membre parti', camp: null };
  };
  const recent = (rows, userId, windowMs) => rows.filter((r) => r.user_id === userId && Date.parse(r.cree_le) > t() - windowMs).length;

  /* ----- R-037 (= 015_pouvoirs_riches.sql): crowns, notifications ----- */
  const jourParis = (ms) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  /** Visible crowns of a problem: not removed, given by a rich member who is not blocked. */
  const couronnesVisibles = (st, problemId) => (st.couronnes || []).filter((c) => c.problem_id === problemId && !c.retiree
    && st.profiles.some((p) => p.id === c.riche_id && !p.bloque));
  /** Crowns given today (Paris calendar day), removed ones included (= 015). */
  const couronnesDuJour = (st, richeId) => (st.couronnes || []).filter((c) => c.riche_id === richeId && jourParis(Date.parse(c.cree_le)) === jourParis(t())).length;
  function notifier(st, userId, type, texte, lien) {
    if (!userId) return;
    st.notifications.push({ id: uuid(rand), user_id: userId, type, texte: String(texte).slice(0, 200), lien, lu: false, cree_le: iso(t()) });
    const miennes = st.notifications.filter((n) => n.user_id === userId).sort((a, b) => b.cree_le.localeCompare(a.cree_le));
    if (miennes.length > 100) { const garder = new Set(miennes.slice(0, 100)); st.notifications = st.notifications.filter((n) => n.user_id !== userId || garder.has(n)); }
  }

  /* ----- public projections (never expose email, user_id, unpublished or masked rows) ----- */
  function visibleProblem(p) {
    return p && p.statut === 'publie' && !p.masque;
  }
  /** R-040 (018): share code of the author (null for the team's examples, a gone or blocked member). */
  const codeAuteur = (st, p) => {
    if (p.est_exemple || !p.user_id) return null;
    const a = st.profiles.find((x) => x.id === p.user_id);
    return a && !a.bloque ? a.code_partage : null;
  };
  function problemRow(st, p) {
    const author = p.est_exemple || !p.user_id ? { pseudo: TEAM_PSEUDO, camp: null } : pseudoOf(st, p.user_id);
    const count = (type) => st.reactions.filter((r) => r.problem_id === p.id && r.type === type).length;
    const myId = uid(st);
    const cour = couronnesVisibles(st, p.id);
    return {
      id: p.id, type: p.type || 'pauvre', premiere: !!p.premiere, categorie: p.categorie, titre: p.titre, texte: p.texte, montant: p.montant,
      pseudo: author.pseudo, camp: author.camp, code_auteur: codeAuteur(st, p), est_exemple: !!p.est_exemple, cree_le: p.modere_le || p.cree_le,
      rire: count('rire'), courage: count('courage'), paierais: count('paierais'), yacht: count('yacht'), majordome: count('majordome'),
      couronnes: cour.length, couronne_par: cour.length === 1 ? pseudoOf(st, cour[0].riche_id).pseudo : null,
      ma_couronne: !!myId && cour.some((c) => c.riche_id === myId),
      commentaires: st.comments.filter((c) => c.problem_id === p.id && !c.masque).length,
      est_mon_probleme: !!myId && p.user_id === myId
    };
  }
  const sortDate = (p) => p.modere_le || p.cree_le;
  /** Problems stored before R-030 have no type: problems of the poor (= default of 011). */
  const typeDe = (p) => p.type || 'pauvre';

  /** R-038: 'YYYY-MM' of a date in Paris. */
  const moisParis = (ms) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date(ms));
  /** = wp_depuis_periode (016): 'mois' | 'toujours' (null = toujours, old signature). */
  function periodeValide(periode) {
    if (periode === null || periode === undefined || periode === 'toujours' || periode === 'mois') return periode || 'toujours';
    throw ERR.invalide('Période inconnue : « mois » ou « toujours ».');
  }
  /** Ranked poor (not blocked, ≥ 1 published non-masked problem): total desc, nb desc, oldest member. 'mois' = shown this month (Paris). */
  function classementPauvres(st, periode = 'toujours') {
    const parId = new Map();
    const ceMois = moisParis(t());
    for (const pb of st.problems) {
      if (!visibleProblem(pb) || pb.est_exemple || !pb.user_id || typeDe(pb) !== 'pauvre') continue;
      if (periode === 'mois' && moisParis(Date.parse(sortDate(pb))) !== ceMois) continue;
      const l = parId.get(pb.user_id) || { nb: 0, total: 0 };
      l.nb++; l.total += pb.montant || 0;
      parId.set(pb.user_id, l);
    }
    return st.profiles
      .filter((p) => p.camp === 'pauvre' && !p.bloque && parId.has(p.id))
      .map((p) => ({ user_id: p.id, pseudo: p.pseudo, camp: p.camp, cree_le: p.cree_le, ...parId.get(p.id) }))
      .sort((a, b) => b.total - a.total || b.nb - a.nb || a.cree_le.localeCompare(b.cree_le) || a.user_id.localeCompare(b.user_id))
      .map(({ cree_le, ...l }, i) => ({ rang: i + 1, ...l }));
  }

  /** = wp_badges (017): computed badges of a member, in display order. */
  function badgesDe(st, userId) {
    const p = st.profiles.find((x) => x.id === userId);
    if (!p || p.bloque) return [];
    const b = [];
    const visibles = st.problems.filter((x) => x.user_id === userId && visibleProblem(x) && !x.est_exemple);
    const pauvres = visibles.filter((x) => typeDe(x) === 'pauvre');
    if (p.camp === 'pauvre') {
      const l = classementPauvres(st, 'mois').find((x) => x.user_id === userId);
      if (l && l.rang <= 3) b.push(['or', 'argent', 'bronze'][l.rang - 1]);
      const factures = new Map();
      for (const x of st.problems) {
        if (!visibleProblem(x) || x.est_exemple || typeDe(x) !== 'pauvre' || x.categorie !== 'factures' || !x.user_id) continue;
        const a = st.profiles.find((y) => y.id === x.user_id);
        if (!a || a.camp !== 'pauvre' || a.bloque) continue;
        factures.set(a.id, { n: (factures.get(a.id)?.n || 0) + 1, cree_le: a.cree_le, id: a.id });
      }
      const roi = [...factures.values()].sort((x, y) => y.n - x.n || x.cree_le.localeCompare(y.cree_le) || x.id.localeCompare(y.id))[0];
      if (roi && roi.id === userId) b.push('roi_decouvert');
      if (pauvres.length >= 20) b.push('smicard');
      if (pauvres.some((x) => (x.montant || 0) >= 10000)) b.push('plafond');
      const ids = new Set(visibles.map((x) => x.id));
      if ((st.couronnes || []).some((c) => ids.has(c.problem_id) && !c.retiree)) b.push('couronne');
    }
    const nbReac = (pid, type) => st.reactions.filter((r) => r.problem_id === pid && r.type === type).length;
    if (visibles.some((x) => nbReac(x.id, 'rire') >= 20)) b.push('star_rire');
    if (visibles.some((x) => nbReac(x.id, 'yacht') >= 1)) b.push('yacht');
    if (p.camp === 'riche' && (st.couronnes || []).filter((c) => c.riche_id === userId && !c.retiree).length >= 10) b.push('mecene');
    if (st.profiles.filter((x) => x.invite_par === userId).length >= 3) b.push('rabatteur');
    if (st.comments.filter((c) => c.user_id === userId && !c.masque).length >= 30) b.push('pipelette');
    if (pauvres.length >= 1) b.push('premier');
    return b;
  }
  /* ----- R-047 (= 019_suivis.sql) ----- */
  const nbAbonnes = (st, userId) => (st.suivis || []).filter((s) => s.suivi_id === userId && st.profiles.some((p) => p.id === s.suiveur_id && !p.bloque)).length;
  function notifierSuiveurs(st, pb) {
    const a = st.profiles.find((p) => p.id === pb.user_id);
    if (!a) return;
    for (const s of (st.suivis || []).filter((x) => x.suivi_id === pb.user_id).slice(0, 500)) {
      const f = st.profiles.find((p) => p.id === s.suiveur_id);
      if (f && !f.bloque) notifier(st, f.id, 'suivi', `${a.pseudo} a publié : « ${String(pb.titre || pb.texte).slice(0, 80)} »`, `p.html?id=${pb.id}`);
    }
  }
  /* ----- R-043 (= 021_gazette.sql) ----- */
  const lundiParis = (ms) => {
    const j = new Date(`${new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date(ms))}T12:00:00Z`);
    j.setUTCDate(j.getUTCDate() - ((j.getUTCDay() + 6) % 7));
    return j.toISOString().slice(0, 10);
  };
  const envois24h = (st) => (st.annonce_envois || []).filter((e) => Date.parse(e.envoye_le) > t() - DAY).length
    + (st.gazette_envois || []).filter((e) => Date.parse(e.envoye_le) > t() - DAY).length;
  const destinatairesGazette = (st) => st.profiles.filter((p) => p.newsletter && !p.bloque && (st.users.find((u) => u.id === p.id) || {}).email_confirme);
  function contenuGazette(st) {
    const depuis = t() - 7 * DAY;
    const score = (p) => st.reactions.filter((r) => r.problem_id === p.id && Date.parse(r.cree_le) > depuis).length
      + 10 * (st.couronnes || []).filter((c) => c.problem_id === p.id && !c.retiree && Date.parse(c.cree_le) > depuis).length
      + 2 * (st.duels || []).filter((d) => d.gagnant_id === p.id && Date.parse(d.cree_le) > depuis).length;
    const top = st.problems.filter((p) => visibleProblem(p) && typeDe(p) === 'pauvre' && !p.est_exemple && st.profiles.some((x) => x.id === p.user_id && !x.bloque))
      .map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s || sortDate(b.p).localeCompare(sortDate(a.p))).slice(0, 5)
      .map(({ p }) => ({ titre: p.titre, montant: p.montant, pseudo: pseudoOf(st, p.user_id).pseudo, lien: `p.html?id=${p.id}` }));
    const n1 = classementPauvres(st, 'mois')[0];
    const pdm = n1 ? { pseudo: n1.pseudo, total: n1.total, lien: `profil.html?c=${st.profiles.find((x) => x.id === n1.user_id).code_partage}` } : null;
    const nouveaux = (st.annonces || []).filter((a) => Date.parse(a.cree_le) > depuis).sort((a, b) => b.cree_le.localeCompare(a.cree_le))
      .map((a) => st.profiles.find((x) => x.id === a.user_id)).filter((p) => p && !p.bloque && richeActif(st, p))
      .map((p) => ({ pseudo: p.pseudo, lien: lienAnnonce(st, p.id) }));
    const themes = [['lundi', 'Mon patron'], ['mardi', 'J\'ai des factures à payer'], ['mercredi', 'Ma vie amoureuse'], ['jeudi', 'Je veux aider ma famille'],
      ['vendredi', 'Je veux me faire plaisir'], ['samedi', 'J\'ai un rêve'], ['dimanche', 'Mon défi']].map(([jour, theme]) => ({ jour, theme }));
    return { semaine: lundiParis(t()), top, pauvre_du_mois: pdm, nouveaux_riches: nouveaux, themes };
  }
  const profilParCode = (st, code) => {
    const c = String(code || '').trim().toUpperCase();
    return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(c) ? st.profiles.find((x) => x.code_partage === c && !x.bloque) || null : null;
  };

  const api = {
    mode: 'demo',

    /* ================= Public reads ================= */

    async getCompteurs() {
      const st = load();
      const emails = new Set(st.profiles.map((p) => p.email.toLowerCase()));
      return {
        problemes: st.problems.filter((p) => !p.est_exemple && typeDe(p) === 'pauvre').length,
        membres: emails.size,
        riches: st.profiles.filter((p) => richeActif(st, p)).length,
        pauvres: st.profiles.filter((p) => p.camp === 'pauvre').length,
        milliardaires_verifies: st.verifications.length
      };
    },

    async getChiffres() {
      const st = load();
      const pub = st.problems.filter((p) => p.statut === 'publie' && !p.est_exemple && typeDe(p) === 'pauvre');
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
        riches: st.profiles.filter((p) => richeActif(st, p)).length,
        pauvres: st.profiles.filter((p) => p.camp === 'pauvre').length
      };
    },

    async getProblemesPublics({ categorie = null, limite = 12, avant = null, type = null } = {}) {
      if (categorie !== null && categorie !== undefined && categorie !== '' && !CATEGORY_IDS.includes(categorie)) throw ERR.invalide('Catégorie inconnue.');
      if (type !== null && type !== undefined && type !== '' && !TYPES.includes(type)) throw ERR.invalide('Type de publication inconnu.');
      if (avant !== null && avant !== undefined && !isIsoDate(avant)) throw ERR.invalide('Curseur de pagination invalide.');
      const lim = Math.max(1, Math.min(48, Number.isInteger(limite) ? limite : 12));
      const st = load();
      return st.problems
        .filter(visibleProblem)
        .filter((p) => !categorie || p.categorie === categorie)
        .filter((p) => !type || typeDe(p) === type)
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

    /** R-034 (= 013): the poor problem with the most reactions over the last 7 days, else the most recent. */
    async getProblemeDuMoment() {
      const st = load();
      const depuis = t() - 7 * DAY;
      const auteurOk = (p) => { const a = st.profiles.find((x) => x.id === p.user_id); return !!a && !a.bloque; };
      const cands = st.problems.filter((p) => visibleProblem(p) && typeDe(p) === 'pauvre' && !p.est_exemple && p.user_id && auteurOk(p));
      if (!cands.length) return null;
      // R-037: a crown of the last 7 days weighs 10 reactions
      const score = (p) => st.reactions.filter((r) => r.problem_id === p.id && Date.parse(r.cree_le) > depuis).length
        + 10 * couronnesVisibles(st, p.id).filter((c) => Date.parse(c.cree_le) > depuis).length
        + 2 * (st.duels || []).filter((d) => d.gagnant_id === p.id && Date.parse(d.cree_le) > depuis).length;  // R-041
      const best = cands.map((p) => ({ p, s: score(p) }))
        .sort((a, b) => b.s - a.s || sortDate(b.p).localeCompare(sortDate(a.p)) || b.p.id.localeCompare(a.p.id))[0].p;
      return problemRow(st, best);
    },

    /** R-037 (= 015): the active rich member (moderators excluded) who gave the most crowns over 7 days, else the newest one. */
    async getRicheDeLaSemaine() {
      const st = load();
      const depuis = t() - 7 * DAY;
      const nb = (id) => (st.couronnes || []).filter((c) => c.riche_id === id && !c.retiree && Date.parse(c.cree_le) > depuis).length;
      const r = st.profiles.filter((p) => p.camp === 'riche' && !p.bloque && richeActif(st, p) && !(st.moderateurs || []).includes(p.id))
        .sort((a, b) => nb(b.id) - nb(a.id) || b.cree_le.localeCompare(a.cree_le) || a.id.localeCompare(b.id))[0];
      if (!r) return null;
      const derniere = st.problems.filter((p) => p.user_id === r.id && typeDe(p) !== 'pauvre' && visibleProblem(p))
        .sort((a, b) => sortDate(b).localeCompare(sortDate(a)) || b.id.localeCompare(a.id))[0];
      return { pseudo: r.pseudo, camp: r.camp, couronnes_7j: nb(r.id), derniere: derniere ? problemRow(st, derniere) : null };
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

    /* ===== « Un nouveau riche est arrivé » (= 012_annonces_riches.sql, R-031) ===== */

    /** Current announcements (72 h): pseudo + link only, newest first, 5 max. */
    async getAnnonces() {
      const st = load();
      return (st.annonces || [])
        .filter((a) => Date.parse(a.expire_le) > t())
        .map((a) => ({ a, p: st.profiles.find((x) => x.id === a.user_id) }))
        .filter(({ p }) => p && richeActif(st, p) && !p.bloque)
        .sort((x, y) => y.a.cree_le.localeCompare(x.a.cree_le))
        .slice(0, 5)
        .map(({ a, p }) => ({ pseudo: p.pseudo, lien: lienAnnonce(st, a.user_id) }));
    },

    /** Unticks the newsletter of the member owning this token (desinscription.html). */
    async seDesinscrire(jeton) {
      if (!isUuid(jeton)) return false;
      return tx((st) => {
        const p = st.profiles.find((x) => x.jeton_desinscription === jeton);
        if (!p) return false;
        p.newsletter = false;
        return true;
      });
    },

    /* ===== Leaderboard of the poor (= 009_palmares.sql, R-028) ===== */

    // R-038 (016): periode 'mois' | 'toujours' (absent = the old all-time version)
    async getPalmares({ limite = 100, periode = null } = {}) {
      const per = periodeValide(periode);
      const lim = Math.max(1, Math.min(100, Number.isInteger(limite) ? limite : 100));
      const st = load();
      const c = classementPauvres(st, per);
      // R-039 (017): the new signature also carries the badges and the share code of each line
      const extra = (id) => (periode ? { code: st.profiles.find((x) => x.id === id).code_partage, badges: badgesDe(st, id) } : {});
      return { ...(periode ? { periode: per } : {}), classes: c.length, lignes: c.slice(0, lim).map(({ user_id, ...l }) => ({ ...l, ...extra(user_id) })) };
    },

    /** R-040 (= get_profil_public, 018): the « CV » of a member by share code, or null. */
    async getProfilPublic(code) {
      const st = load();
      const p = profilParCode(st, code);
      if (!p) return null;
      const r = {
        pseudo: p.pseudo, camp: p.camp, code: p.code_partage, statut_riche: statutRiche(st, p),
        arrive_le: new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date(p.cree_le)),
        badges: badgesDe(st, p.id),
        peut_defier: p.camp === 'pauvre' && !!me(st) && me(st).camp === 'pauvre' && !me(st).bloque && me(st).id !== p.id,
        abonnes: nbAbonnes(st, p.id), je_suis: !!uid(st) && (st.suivis || []).some((s) => s.suiveur_id === uid(st) && s.suivi_id === p.id),
        problemes: st.problems.filter((x) => x.user_id === p.id && visibleProblem(x) && !x.est_exemple)
          .sort((a, b) => sortDate(b).localeCompare(sortDate(a)) || b.id.localeCompare(a.id)).slice(0, 24).map((x) => problemRow(st, x)),
        couronnes_donnees: p.camp !== 'riche' ? [] : (st.couronnes || []).filter((c) => c.riche_id === p.id && !c.retiree)
          .sort((a, b) => b.cree_le.localeCompare(a.cree_le))
          .map((c) => st.problems.find((x) => x.id === c.problem_id)).filter((x) => visibleProblem(x)).slice(0, 12).map((x) => problemRow(st, x))
      };
      if (p.camp === 'pauvre') {
        const m = classementPauvres(st, 'mois');
        const g = classementPauvres(st, 'toujours');
        const lm = m.find((x) => x.user_id === p.id);
        const lg = g.find((x) => x.user_id === p.id);
        Object.assign(r, { rang_mois: { rang: lm ? lm.rang : null, sur: m.length }, rang_general: { rang: lg ? lg.rang : null, sur: g.length }, total: lg ? lg.total : 0, nb: lg ? lg.nb : 0 });
      }
      return r;
    },

    /* ===== The duel (= 020_duel.sql, R-041) ===== */
    async getDuel(sauf = []) {
      const st = load();
      const ok = (p) => visibleProblem(p) && typeDe(p) === 'pauvre' && !p.est_exemple && p.user_id && st.profiles.some((x) => x.id === p.user_id && !x.bloque);
      const exclus = new Set((Array.isArray(sauf) ? sauf : []).slice(0, 20));
      let cands = st.problems.filter((p) => ok(p) && !exclus.has(p.id));
      if (cands.length < 2) cands = st.problems.filter(ok);
      if (cands.length < 2) return [];
      const i = Math.floor(rand() * cands.length);
      let j = Math.floor(rand() * (cands.length - 1));
      if (j >= i) j++;
      return [problemRow(st, cands[i]), problemRow(st, cands[j])];
    },

    async voterDuel(gagnant, perdant) {
      return tx((st) => {
        const ok = (id) => { const p = isUuid(id) && st.problems.find((x) => x.id === id); return !!p && visibleProblem(p) && typeDe(p) === 'pauvre' && !p.est_exemple && st.profiles.some((x) => x.id === p.user_id && !x.bloque); };
        if (!gagnant || gagnant === perdant || !ok(gagnant) || !ok(perdant)) throw ERR.invalide('Ce duel n’existe plus. On t’en sert un autre.');
        const moi = me(st);
        if (moi && moi.bloque) throw ERR.bloque();
        st.duels.push({ gagnant_id: gagnant, perdant_id: perdant, cree_le: iso(t()) });
        return { ok: true, victoires_7j: st.duels.filter((d) => d.gagnant_id === gagnant && Date.parse(d.cree_le) > t() - 7 * DAY).length };
      });
    },

    async getPlusDrolesSemaine(limite = 5) {
      const st = load();
      const lim = Math.max(1, Math.min(20, Number.isInteger(limite) ? limite : 5));
      const nb = new Map();
      for (const d of st.duels || []) if (Date.parse(d.cree_le) > t() - 7 * DAY) nb.set(d.gagnant_id, (nb.get(d.gagnant_id) || 0) + 1);
      return [...nb.entries()].map(([id, n]) => ({ p: st.problems.find((x) => x.id === id), n }))
        .filter(({ p }) => p && visibleProblem(p) && typeDe(p) === 'pauvre' && st.profiles.some((x) => x.id === p.user_id && !x.bloque))
        .sort((a, b) => b.n - a.n || a.p.id.localeCompare(b.p.id)).slice(0, lim)
        .map(({ p, n }) => ({ carte: problemRow(st, p), victoires: n }));
    },

    /* ===== Challenges between poor members (= 022, R-044) ===== */
    async defier(code) {
      return tx((st) => {
        const p = writer(st);
        if (p.camp !== 'pauvre') throw ERR.interdit('Les défis, c’est entre pauvres. Un riche, lui, couronne.');
        const c = profilParCode(st, code);
        if (!c || c.camp !== 'pauvre') throw ERR.introuvable('Ce pauvre est introuvable.');
        if (c.id === p.id) throw ERR.invalide('Te défier toi-même ? Tu gagnerais et tu perdrais à la fois.');
        if (st.defis.some((d) => d.defieur_id === p.id && d.defie_id === c.id && jourParis(Date.parse(d.cree_le)) === jourParis(t()))) {
          throw ERR.limite('Tu l’as déjà défié aujourd’hui. Laisse-lui le temps de souffrir.');
        }
        st.defis.push({ defieur_id: p.id, defie_id: c.id, cree_le: iso(t()) });
        const l = classementPauvres(st, 'mois').find((x) => x.user_id === p.id);
        notifier(st, c.id, 'defi', `${p.pseudo} te défie de faire mieux${l ? ` : ${l.rang}${l.rang === 1 ? 'ᵉʳ' : 'ᵉ'} du mois. À toi de faire mieux !` : '. À toi de faire mieux !'}`, `profil.html?c=${p.code_partage}`);
        return { ok: true };
      });
    },

    /* ===== Follow a profile (= 019, R-047) ===== */
    async suivre(code) {
      return tx((st) => {
        const p = writer(st);
        const c = profilParCode(st, code);
        if (!c) throw ERR.introuvable('Ce membre est introuvable.');
        if (c.id === p.id) throw ERR.invalide('Tu ne peux pas te suivre toi-même. Même si tu es très drôle.');
        if (!st.suivis.some((s) => s.suiveur_id === p.id && s.suivi_id === c.id)) st.suivis.push({ suiveur_id: p.id, suivi_id: c.id, cree_le: iso(t()) });
        return { suivi: true, abonnes: nbAbonnes(st, c.id) };
      });
    },

    async nePlusSuivre(code) {
      return tx((st) => {
        const p = writer(st);
        const c = profilParCode(st, code);
        if (!c) throw ERR.introuvable('Ce membre est introuvable.');
        st.suivis = st.suivis.filter((s) => !(s.suiveur_id === p.id && s.suivi_id === c.id));
        return { suivi: false, abonnes: nbAbonnes(st, c.id) };
      });
    },

    async getMesSuivis() {
      const st = load();
      const id = uid(st);
      if (!id) return [];
      return (st.suivis || []).filter((s) => s.suiveur_id === id)
        .map((s) => ({ s, p: st.profiles.find((x) => x.id === s.suivi_id) })).filter(({ p }) => p && !p.bloque)
        .map(({ s, p }) => {
          const d = st.problems.filter((x) => x.user_id === p.id && visibleProblem(x) && !x.est_exemple).sort((a, b) => sortDate(b).localeCompare(sortDate(a)) || b.id.localeCompare(a.id))[0];
          return { cle: d ? sortDate(d) : s.cree_le, r: { pseudo: p.pseudo, camp: p.camp, code: p.code_partage, badges: badgesDe(st, p.id), dernier: d ? problemRow(st, d) : null } };
        })
        .sort((a, b) => b.cle.localeCompare(a.cle) || a.r.pseudo.localeCompare(b.r.pseudo)).map((x) => x.r);
    },

    async getFilSuivis({ limite = 12, avant = null } = {}) {
      if (avant !== null && avant !== undefined && !isIsoDate(avant)) throw ERR.invalide('Curseur de pagination invalide.');
      const st = load();
      const id = uid(st);
      if (!id) return [];
      const suivis = new Set((st.suivis || []).filter((s) => s.suiveur_id === id).map((s) => s.suivi_id));
      const lim = Math.max(1, Math.min(48, Number.isInteger(limite) ? limite : 12));
      return st.problems
        .filter((p) => visibleProblem(p) && !p.est_exemple && suivis.has(p.user_id) && st.profiles.some((x) => x.id === p.user_id && !x.bloque))
        .filter((p) => !avant || sortDate(p) < avant)
        .sort((a, b) => sortDate(b).localeCompare(sortDate(a)) || b.id.localeCompare(a.id))
        .slice(0, lim).map((p) => problemRow(st, p));
    },

    async getPlusSuivis() {
      const st = load();
      const top = (camp, n) => st.profiles.filter((p) => p.camp === camp && !p.bloque && (camp === 'pauvre' || richeActif(st, p)))
        .map((p) => ({ p, nb: nbAbonnes(st, p.id) })).filter((x) => x.nb > 0)
        .sort((a, b) => b.nb - a.nb || a.p.cree_le.localeCompare(b.p.cree_le) || a.p.pseudo.localeCompare(b.p.pseudo))
        .slice(0, n).map(({ p, nb }) => ({ pseudo: p.pseudo, camp: p.camp, code: p.code_partage, abonnes: nb }));
      return { pauvres: top('pauvre', 10), riches: top('riche', 5) };
    },

    /** R-039 (= get_badges, 017): { pseudo, badges } by share code, or null. */
    async getBadges(code) {
      const st = load();
      const p = profilParCode(st, code);
      return p ? { pseudo: p.pseudo, badges: badgesDe(st, p.id) } : null;
    },

    async getMonRang(periode = null) {
      const per = periodeValide(periode);
      const st = load();
      const p = me(st);
      if (!p || p.camp !== 'pauvre') return null;
      const c = classementPauvres(st, per);
      const l = c.find((x) => x.user_id === p.id);
      return { ...(periode ? { periode: per } : {}), rang: l ? l.rang : null, sur: c.length, pseudo: p.pseudo, camp: p.camp, nb: l ? l.nb : 0, total: l ? l.total : 0 };
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
          statut_riche: 'en_attente', riche_formule: null, riche_jusqu_au: null, jeton_desinscription: uuid(rand),
          code_partage: code, invite_par: invitePar, regles_acceptees_le: iso(t()), bloque: false, cree_le: iso(t())
        });
        return { code_partage: code };
      });
    },

    async majProfil({ pseudo = null, newsletter = null, camp = null, riche_message = undefined, riche_montant = undefined } = {}) {
      return tx((st) => {
        // = maj_profil (010): allowed while pending; a camp switch always puts the account back to 'en_attente'
        if (!uid(st)) throw ERR.nonConnecte();
        const p = me(st);
        if (!p) throw ERR.profilAbsent();
        if (p.bloque) throw ERR.bloque();
        if (pseudo !== null && pseudo !== undefined) p.pseudo = texteValide(pseudo, LIMITES.pseudo, 'Ton pseudo', { mots: st.mots_interdits });
        if (newsletter !== null && newsletter !== undefined) p.newsletter = newsletter === true;
        if (camp !== null && camp !== undefined) {
          if (camp !== 'riche' && camp !== 'pauvre') throw ERR.invalide('Choisis un camp : riche ou pauvre.');
          if (camp !== p.camp) Object.assign(p, { camp, statut_riche: 'en_attente', riche_formule: null, riche_jusqu_au: null });
        }
        if (riche_message !== undefined) {
          p.riche_message = riche_message === null || nettoyer(riche_message) === ''
            ? null
            : texteValide(riche_message, LIMITES.richeMessage, 'Ton message', { multiligne: true, mots: st.mots_interdits });
        }
        if (riche_montant !== undefined) p.riche_montant = entierValide(riche_montant, LIMITES.richeMontant, 'Le montant');
        return { pseudo: p.pseudo, camp: p.camp, newsletter: p.newsletter, riche_message: p.riche_message, riche_montant: p.riche_montant, statut_riche: statutRiche(st, p) };
      });
    },

    async soumettreProbleme({ categorie, titre, texte, montant = null } = {}) {
      return tx((st) => {
        const p = writer(st);
        if (p.camp !== 'pauvre') throw ERR.interdit('Un riche ne publie pas de problème de pauvre : choisis « Un problème de riche » ou « Une simple publication ».');
        if (!CATEGORY_IDS.includes(categorie)) throw ERR.invalide('Choisis une catégorie.');
        const ti = texteValide(titre, LIMITES.titre, 'Le titre', { mots: st.mots_interdits });
        const tx2 = texteValide(texte, LIMITES.texte, 'Le texte', { multiligne: true, mots: st.mots_interdits });
        const mt = montantPauvre(montant);
        if (recent(st.problems, p.id, DAY) >= 10) throw ERR.limite('Tu as déjà envoyé 10 problèmes en 24 h. Reviens demain !');
        // Published at once when automatic publication is on and nothing sensitive is detected
        // (same rule as soumettre_probleme in 005_publication_auto.sql); otherwise waits for a human review.
        const auto = !(st.reglages && st.reglages.publication_auto === false);
        const sensible = contientMotSensible(`${ti}\n${tx2}`, st.mots_sensibles || MOTS_SENSIBLES_DEFAUT);
        const statut = auto && !sensible ? 'publie' : 'recu';
        const row = { id: uuid(rand), user_id: p.id, type: 'pauvre', premiere: false, categorie, titre: ti, texte: tx2, montant: mt, statut, est_exemple: false, masque: false, cree_le: iso(t()), modere_le: null };
        st.problems.push(row);
        if (statut === 'publie') notifierSuiveurs(st, row);
        return { id: row.id, statut };
      });
    },

    /** = publier_riche (011): an ACTIVE rich member posts a rich problem or a simple publication. */
    async publierRiche({ type, titre = null, texte, montant = null } = {}) {
      return tx((st) => {
        const p = writer(st);
        if (p.camp !== 'riche') throw ERR.interdit('Seuls les riches validés publient ici. Un pauvre publie un problème de pauvre.');
        if (type !== 'riche' && type !== 'publication') throw ERR.invalide('Choisis « Un problème de riche » ou « Une simple publication ».');
        const tx2 = texteValide(texte, LIMITES.texte, 'Le texte', { multiligne: true, mots: st.mots_interdits });
        const ti = type === 'riche' ? texteValide(titre, LIMITES.titre, 'Le titre', { mots: st.mots_interdits }) : null;
        const mt = type === 'riche' ? entierValide(montant, LIMITES.montant, 'Le montant') : null;
        if (recent(st.problems, p.id, DAY) >= 10) throw ERR.limite('Tu as déjà publié 10 fois en 24 h. Reviens demain !');
        const auto = !(st.reglages && st.reglages.publication_auto === false);
        const sensible = contientMotSensible(`${ti ? `${ti}\n` : ''}${tx2}`, st.mots_sensibles || MOTS_SENSIBLES_DEFAUT);
        const statut = auto && !sensible ? 'publie' : 'recu';
        const premiere = !st.problems.some((x) => x.user_id === p.id && typeDe(x) !== 'pauvre');
        const row = { id: uuid(rand), user_id: p.id, type, premiere, categorie: null, titre: ti, texte: tx2, montant: mt, statut, est_exemple: false, masque: false, cree_le: iso(t()), modere_le: null };
        st.problems.push(row);
        if (statut === 'publie') notifierSuiveurs(st, row);
        return { id: row.id, statut, premiere };
      });
    },

    async reagir(problemId, type) {
      return tx((st) => {
        const p = writer(st);
        if (!['rire', 'courage', 'paierais', 'yacht', 'majordome'].includes(type)) throw ERR.invalide('Réaction inconnue.');
        if ((type === 'yacht' || type === 'majordome') && p.camp !== 'riche') throw ERR.interdit('Cette réaction est réservée aux riches validés. Toi, tu as le droit de rire.');
        const pb = isUuid(problemId) ? st.problems.find((x) => x.id === problemId) : null;
        if (!visibleProblem(pb)) throw ERR.introuvable();
        const i = st.reactions.findIndex((r) => r.problem_id === problemId && r.user_id === p.id && r.type === type);
        let actif;
        if (i >= 0) { st.reactions.splice(i, 1); actif = false; } else { st.reactions.push({ problem_id: problemId, user_id: p.id, type, cree_le: iso(t()) }); actif = true; }
        const c = (ty) => st.reactions.filter((r) => r.problem_id === problemId && r.type === ty).length;
        return { actif, rire: c('rire'), courage: c('courage'), paierais: c('paierais'), yacht: c('yacht'), majordome: c('majordome') };
      });
    },

    /* ===== Powers of the rich (= 015, R-037) ===== */
    async couronner(problemId) {
      return tx((st) => {
        const p = writer(st);
        if (p.camp !== 'riche') throw ERR.interdit('Seuls les riches validés distribuent des couronnes. Toi, tu peux réagir.');
        const pb = isUuid(problemId) ? st.problems.find((x) => x.id === problemId) : null;
        if (!visibleProblem(pb) || typeDe(pb) !== 'pauvre') throw ERR.introuvable('Ce problème de pauvre est introuvable ou n’est pas publié.');
        const c = st.couronnes.find((x) => x.problem_id === problemId && x.riche_id === p.id);
        let jour = couronnesDuJour(st, p.id);
        if (c) c.retiree = false;
        else {
          if (jour >= 3) throw ERR.limite('Tu as déjà distribué tes 3 couronnes du jour. Le trésor royal rouvre demain.');
          st.couronnes.push({ problem_id: problemId, riche_id: p.id, retiree: false, cree_le: iso(t()) });
          jour++;
          if (pb.user_id && pb.user_id !== p.id) notifier(st, pb.user_id, 'couronne', `Le riche ${p.pseudo} a couronné ton problème « ${pb.titre.slice(0, 80)} » 👑`, `p.html?id=${pb.id}`);
        }
        return { couronne: true, couronnes: couronnesVisibles(st, problemId).length, restantes: Math.max(0, 3 - jour) };
      });
    },

    async retirerCouronne(problemId) {
      return tx((st) => {
        const p = writer(st);
        if (p.camp !== 'riche') throw ERR.interdit('Seuls les riches validés distribuent des couronnes. Toi, tu peux réagir.');
        const c = st.couronnes.find((x) => x.problem_id === problemId && x.riche_id === p.id);
        if (c) c.retiree = true;
        return { couronne: false, couronnes: couronnesVisibles(st, problemId).length, restantes: Math.max(0, 3 - couronnesDuJour(st, p.id)) };
      });
    },

    async getMesNotifications() {
      const st = load();
      const p = me(st);
      if (!p) return { non_lues: 0, liste: [] };
      const miennes = (st.notifications || []).filter((n) => n.user_id === p.id).sort((a, b) => b.cree_le.localeCompare(a.cree_le) || b.id.localeCompare(a.id));
      return { non_lues: miennes.filter((n) => !n.lu).length, liste: miennes.slice(0, 30).map(({ user_id, ...n }) => ({ ...n })) };
    },

    async marquerNotificationsLues() {
      return tx((st) => {
        const id = uid(st);
        if (!id) throw ERR.nonConnecte();
        let n = 0;
        for (const x of st.notifications) if (x.user_id === id && !x.lu) { x.lu = true; n++; }
        return n;
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
        statut_riche: statutRiche(st, p),
        riche_formule: statutRiche(st, p) === 'actif' ? p.riche_formule || null : null,
        riche_jusqu_au: statutRiche(st, p) === 'actif' ? p.riche_jusqu_au || null : null,
        nb_invites: st.profiles.filter((x) => x.invite_par === p.id).length,
        email_confirme: !!(user && user.email_confirme), bloque: !!p.bloque, verifie: st.verifications.some((v) => v.user_id === p.id),
        problemes: st.problems.filter((x) => x.user_id === p.id)
          .sort((a, b) => b.cree_le.localeCompare(a.cree_le))
          .map((x) => ({ id: x.id, type: typeDe(x), titre: x.titre || x.texte.slice(0, 80), statut: x.statut, masque: !!x.masque, cree_le: x.cree_le }))
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
        st.couronnes = (st.couronnes || []).filter((c) => c.riche_id !== id && !myProblems.has(c.problem_id));
        st.notifications = (st.notifications || []).filter((n) => n.user_id !== id);
        st.suivis = (st.suivis || []).filter((s) => s.suiveur_id !== id && s.suivi_id !== id);
        st.defis = (st.defis || []).filter((d) => d.defieur_id !== id && d.defie_id !== id);
        st.duels = (st.duels || []).filter((d) => !myProblems.has(d.gagnant_id) && !myProblems.has(d.perdant_id));
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
        profil: p ? { pseudo: p.pseudo, camp: p.camp, statut_riche: statutRiche(st, p), code_partage: p.code_partage, bloque: !!p.bloque, email_confirme: !!(user && user.email_confirme) } : null
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
  function richeModifiable(st, userId, { modoOk = false } = {}) {
    const p = st.profiles.find((x) => x.id === userId);
    if (!p) throw ERR.introuvable('Membre introuvable.');
    if (p.camp !== 'riche') throw ERR.invalide('Ce membre n’est pas dans le camp des riches.');
    if (!modoOk && (st.moderateurs || []).includes(p.id)) throw ERR.invalide('Un modérateur reste toujours actif.');
    return p;
  }
  /** = wp_lien_annonce: first visible rich post of the member, otherwise the rich posts of the wall. */
  function lienAnnonce(st, userId) {
    const posts = st.problems.filter((p) => p.user_id === userId && typeDe(p) !== 'pauvre' && visibleProblem(p))
      .sort((a, b) => (b.premiere ? 1 : 0) - (a.premiere ? 1 : 0) || a.cree_le.localeCompare(b.cree_le));
    return posts.length ? `p.html?id=${posts[0].id}` : 'index.html?type=publication#mur';
  }
  /** Poor members who ticked the newsletter, e-mail confirmed, not blocked (= srv_reserver_envois). */
  function destinatairesAnnonce(st) {
    return st.profiles.filter((p) => p.camp === 'pauvre' && p.newsletter && !p.bloque
      && st.users.some((u) => u.id === p.id && u.email_confirme && !u.is_anonymous));
  }
  /** End of a paid period: + 1 month or + 1 year (= interval in mod_activer_riche). */
  function finFormule(depuis, formule) {
    const d = new Date(depuis);
    if (formule === 'annuel') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString();
  }
  const auteur = (st, userId) => {
    const p = userId ? st.profiles.find((x) => x.id === userId) : null;
    return { pseudo: p ? p.pseudo : null, camp: p ? p.camp : null, user_id: userId || null, bloque: !!(p && p.bloque) };
  };
  const nbSignalements = (st, type, id, depuis = 0) =>
    st.reports.filter((r) => r.cible_type === type && r.cible_id === id && Date.parse(r.cree_le) > depuis).length;
  const problemeModo = (st, p) => ({
    id: p.id, type: typeDe(p), cree_le: p.modere_le || p.cree_le, categorie: p.categorie, titre: p.titre, texte: p.texte, montant: p.montant,
    statut: p.statut, masque: !!p.masque, ...auteur(st, p.user_id), nb_signalements: nbSignalements(st, 'probleme', p.id)
  });
  const contenuDe = (type, row) => (type === 'probleme' ? (row.titre ? `${row.titre} — ${row.texte}` : row.texte) : type === 'message' ? `[${row.camp}] ${row.texte}` : row.texte);

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

    /* ----- paying rich members (= mod_riches / mod_activer_riche / … of 010) ----- */
    async riches() {
      const st = load();
      exigerModo(st);
      return st.profiles.filter((p) => p.camp === 'riche')
        .map((p) => {
          const statut = statutRiche(st, p);
          return {
            user_id: p.id, pseudo: p.pseudo, statut, formule: statut === 'actif' ? p.riche_formule || null : null,
            jusqu_au: statut === 'actif' ? p.riche_jusqu_au || null : null, cree_le: p.cree_le, bloque: !!p.bloque,
            est_moderateur: (st.moderateurs || []).includes(p.id)
          };
        })
        .sort((a, b) => (a.statut === b.statut ? 0 : a.statut === 'en_attente' ? -1 : 1)
          || (a.jusqu_au || '9').localeCompare(b.jusqu_au || '9') || a.cree_le.localeCompare(b.cree_le))
        .slice(0, 500);
    },

    async activerRiche(userId, formule) {
      return tx((st) => {
        exigerModo(st);
        if (formule !== 'mensuel' && formule !== 'annuel') throw ERR.invalide('Formule inconnue (mensuel ou annuel).');
        const p = richeModifiable(st, userId, { modoOk: true });
        const encours = p.statut_riche === 'actif' && p.riche_jusqu_au && Date.parse(p.riche_jusqu_au) > t();
        const etait = richeActif(st, p);
        Object.assign(p, { statut_riche: 'actif', riche_formule: formule, riche_jusqu_au: finFormule(encours ? Date.parse(p.riche_jusqu_au) : t(), formule) });
        if (!etait) {
          st.annonces = st.annonces || [];
          st.annonces.push({ id: uuid(rand), user_id: userId, cree_le: iso(t()), expire_le: iso(t() + 72 * HOUR) });
        }
        return { user_id: userId, statut: 'actif', formule, jusqu_au: p.riche_jusqu_au, annonce: !etait };
      });
    },

    /** = mod_annonces: announcements of the last 7 days with the e-mail progress. */
    async annonces() {
      const st = load();
      exigerModo(st);
      const dest = destinatairesAnnonce(st).length;
      return (st.annonces || []).filter((a) => Date.parse(a.cree_le) > t() - 7 * DAY)
        .sort((x, y) => y.cree_le.localeCompare(x.cree_le))
        .map((a) => {
          const p = st.profiles.find((x) => x.id === a.user_id);
          return {
            id: a.id, user_id: a.user_id, pseudo: p ? p.pseudo : null, lien: lienAnnonce(st, a.user_id), cree_le: a.cree_le,
            expire_le: a.expire_le, en_cours: Date.parse(a.expire_le) > t(),
            envoyes: (st.annonce_envois || []).filter((e) => e.annonce_id === a.id).length, destinataires: dest
          };
        });
    },

    /**
     * Demo of the Edge Function « annoncer-riche »: same recipients and same 250 / 24 h budget as
     * srv_reserver_envois, but NO e-mail is ever sent (the "sent" rows are only recorded).
     */
    async annoncerParEmail(annonceId) {
      return tx((st) => {
        exigerModo(st);
        const a = (st.annonces || []).find((x) => x.id === annonceId);
        if (!a) throw ERR.introuvable('Annonce introuvable.');
        st.annonce_envois = st.annonce_envois || [];
        const budget = Math.max(0, 250 - envois24h(st));  // R-043: budget shared with the gazette
        const restants = destinatairesAnnonce(st).filter((p) => !st.annonce_envois.some((e) => e.annonce_id === a.id && e.user_id === p.id));
        const lot = restants.slice(0, budget);
        for (const p of lot) st.annonce_envois.push({ annonce_id: a.id, user_id: p.id, envoye_le: iso(t()) });
        return { envoyes: lot.length, echecs: 0, restant_24h: budget - lot.length, reste_a_envoyer: restants.length - lot.length, demo: true };
      });
    },

    /** = mod_gazette_apercu (021): the issue of the week as it would be sent. */
    async gazetteApercu() {
      const st = load();
      exigerModo(st);
      const semaine = lundiParis(t());
      const g = (st.gazettes || []).find((x) => x.semaine === semaine);
      return {
        contenu: g ? g.contenu : contenuGazette(st), figee: !!g,
        envoyes: g ? (st.gazette_envois || []).filter((e) => e.gazette_id === g.id).length : 0,
        destinataires: destinatairesGazette(st).length, restant_24h: Math.max(0, 250 - envois24h(st))
      };
    },

    /** Demo of the Edge Function « gazette »: same recipients and shared budget, NO e-mail is ever sent. */
    async envoyerGazette() {
      return tx((st) => {
        exigerModo(st);
        st.gazettes = st.gazettes || [];
        st.gazette_envois = st.gazette_envois || [];
        const semaine = lundiParis(t());
        let g = st.gazettes.find((x) => x.semaine === semaine);
        if (!g) { g = { id: uuid(rand), semaine, contenu: contenuGazette(st), cree_le: iso(t()) }; st.gazettes.push(g); }
        const budget = Math.max(0, 250 - envois24h(st));
        const restants = destinatairesGazette(st).filter((p) => !st.gazette_envois.some((e) => e.gazette_id === g.id && e.user_id === p.id));
        const lot = restants.slice(0, budget);
        for (const p of lot) st.gazette_envois.push({ gazette_id: g.id, user_id: p.id, envoye_le: iso(t()) });
        return { envoyes: lot.length, echecs: 0, restant_24h: budget - lot.length, reste_a_envoyer: restants.length - lot.length, demo: true };
      });
    },

    async desactiverRiche(userId) {
      return tx((st) => {
        exigerModo(st);
        const p = richeModifiable(st, userId);
        Object.assign(p, { statut_riche: 'en_attente', riche_formule: null, riche_jusqu_au: null });
        return { user_id: userId, statut: 'en_attente' };
      });
    },

    async refuserRiche(userId) {
      return tx((st) => {
        exigerModo(st);
        const p = richeModifiable(st, userId);
        Object.assign(p, { camp: 'pauvre', statut_riche: 'en_attente', riche_formule: null, riche_jusqu_au: null });
        return { user_id: userId, camp: 'pauvre' };
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
    /** Validates a rich member without a moderator session (tests and demo, = mod_activer_riche). */
    async activerRiche(userId, formule = 'annuel') {
      return tx((st) => {
        const p = st.profiles.find((x) => x.id === userId && x.camp === 'riche');
        if (!p) throw ERR.introuvable('Membre introuvable.');
        Object.assign(p, { statut_riche: 'actif', riche_formule: formule, riche_jusqu_au: finFormule(t(), formule) });
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
