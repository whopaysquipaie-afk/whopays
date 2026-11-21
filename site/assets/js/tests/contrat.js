// API contract test suite — no DOM. Runs in Node (tools/test.mjs) and in the browser (tests.html).
// Demo mode: the full suite, each test on a fresh in-memory backend with a controlled clock.
// Supabase mode (browser only): read-only checks on the public functions (see runPublicChecks).
// Mirrors the SQL security tests of supabase/tests/verif_securite.sql (brief dev §5.7) + parcours B to I.

import { createDemoApi } from '../api-demo.js';
import { raisonFiltre, MESSAGE_FILTRE } from '../filtres.js';
import { isSafeUrl, checkAttribute } from '../dom-safe.js';
import { EXEMPLES, PROBLEMES, POSTS_RICHES, COMMENTAIRES, CLUB_RICHES, CLUB_PAUVRES, MEMBRES } from '../demo-data.js';
import { CATEGORY_IDS } from '../categories.js';
import { enRiens, phraseRiens, montantAffiche, enEuros } from '../riens.js';
import { urlProbleme } from '../liens.js';
import { CONFIG, siteUrl } from '../config.js';
import { badgesConnus, libelleBadges } from '../badges.js';
import { deMois } from '../themes.js';
import { themeDuJour, texteTheme, texteProbleme } from '../themes.js';
import { estRobot, DELAI_MIN_MS } from '../piege.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-20T12:00:00.000Z');

/* ---------------- Mini test framework ---------------- */

const tests = [];
const test = (group, name, fn) => tests.push({ group, name, fn });

class AssertionError extends Error {}
function assert(cond, msg = 'assertion échouée') { if (!cond) throw new AssertionError(msg); }
function eq(a, b, msg = '') { if (a !== b) throw new AssertionError(`${msg} attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }
async function rejects(promise, code, msg = '') {
  try {
    await promise;
  } catch (e) {
    if (code && e.code !== code) throw new AssertionError(`${msg} erreur « ${code} » attendue, obtenu « ${e.code} » (${e.message})`);
    if (!e.message || /[A-Z_]{6,}|undefined|null/.test(e.message)) throw new AssertionError(`${msg} message d'erreur illisible : ${e.message}`);
    return e;
  }
  throw new AssertionError(`${msg} une erreur « ${code} » était attendue`);
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** Fresh demo backend + controllable clock. */
function fresh() {
  const clock = { now: T0 };
  const api = createDemoApi({ storage: memoryStorage(), now: () => clock.now });
  api.demoAdmin.setHorloge(() => clock.now);
  let n = 0;
  // R-029: a rich member is validated at once (as by a moderator) unless { enAttente: true }
  const join = async (camp = 'pauvre', pseudo = null, { enAttente = false, ...extra } = {}) => {
    n++;
    const r = await api.rejoindre({ camp, pseudo: pseudo || `Testeur ${camp} ${n}`, email: `test${n}.${camp}@exemple.test`, majeur: true, regles: true, ...extra });
    const s = await api.getSession();
    if (camp === 'riche' && !enAttente && s.userId) await api.demoAdmin.activerRiche(s.userId);
    return { ...r, userId: s.userId, email: `test${n}.${camp}@exemple.test` };
  };
  const as = (userId) => api.demoAdmin.connecterEnTantQue(userId);
  const advance = (ms) => { clock.now += ms; };
  return { api, admin: api.demoAdmin, join, as, advance, clock };
}

async function firstPublished(api) {
  const list = await api.getProblemesPublics({ limite: 48 });
  return list.find((p) => !p.est_exemple);
}

/** Recursively checks that a public payload exposes no private data. */
function assertNoPrivateData(payload, where) {
  const json = JSON.stringify(payload);
  assert(!/@/.test(json), `${where} : contient une adresse e-mail`);
  assert(!/"(email|user_id|invite_par|bloque|newsletter|code_partage)"/.test(json), `${where} : expose un champ privé`);
}

/* ================= Unité « rien / Rien » (R-026) ================= */

const CAS_RIENS = [
  [100, '1x rien'], [350, '3,5x rien'], [50, '0,5x rien'], [1, '0,01x rien'], [999, '9,99x rien'],
  [1000, '1x Rien'], [4000, '4x Rien'], [4500, '4,5x Rien'], [4250, '4,25x Rien'], [1234, '1,23x Rien'],
  [10000, '10x Rien'], [1000000, '1 000x Rien'], ['4 500', '4,5x Rien'], ['350', '3,5x rien']
];
for (const [montant, attendu] of CAS_RIENS) {
  test('Unité rien / Rien', `${JSON.stringify(montant)} € → « ${attendu} »`, () => {
    eq(enRiens(montant).replace(/[  ]/g, ' '), attendu);
  });
}
test('Unité rien / Rien', '0, vide, négatif ou invalide → rien affiché', () => {
  for (const v of [0, '', null, undefined, -5, 'abc', NaN, Infinity, 0.4]) eq(enRiens(v), '', String(v));
});
test('Unité rien / Rien', 'jamais de « ,0 » ni plus de 2 décimales', () => {
  for (let m = 1; m <= 20000; m += 7) {
    const r = enRiens(m);
    assert(/^\d[\d  ]*(,\d{1,2})?x (rien|Rien)$/.test(r) && !/,0x|,\d0x/.test(r), `${m} → ${r}`);
  }
});
test('Unité rien / Rien', 'phrase de la page problème', () => {
  eq(phraseRiens(4000), 'Pour un riche, ça vaut 4x Rien');
  eq(phraseRiens(null), '');
});

/* R-032: the Rien is the main information (big), the euro comes after (small) */
const CAS_AFFICHAGE = [
  [4000, '4x Rien', '4 000 €'], [350, '3,5x rien', '350 €'], [300, '3x rien', '300 €'], [3000, '3x Rien', '3 000 €'],
  [9500, '9,5x Rien', '9 500 €'], [83381, '83,38x Rien', '83 381 €'], [10000, '10x Rien', '10 000 €'], ['4 250', '4,25x Rien', '4 250 €']
];
for (const [montant, principal, euros] of CAS_AFFICHAGE) {
  test('Unité rien / Rien', `affichage (R-032) : ${JSON.stringify(montant)} → « ${principal} » en gros, « ${euros} » en petit`, () => {
    const m = montantAffiche(montant);
    eq(m.principal.replace(/[  ]/g, ' '), principal);
    eq(m.euros.replace(/[  ]/g, ' '), euros);
  });
}
test('Unité rien / Rien', 'affichage (R-032) : rien pour 0 / vide / invalide, sauf « 0x Rien » demandé (0x Rien financé)', () => {
  for (const v of [0, null, undefined, '', -5, 'abc']) eq(montantAffiche(v), null, `${JSON.stringify(v)} :`);
  eq(JSON.stringify(montantAffiche(0, { zero: true })), JSON.stringify({ principal: '0x Rien', euros: '0 €' }));
  eq(montantAffiche(null, { zero: true }), null);
  eq(enEuros(1234567).replace(/[  ]/g, ' '), '1 234 567 €');
});

/* ================= Filters ================= */

test('Filtres', 'rejette un numéro de téléphone (français et international)', () => {
  for (const t of ['Appelle-moi au 06 12 34 56 78', 'au 06.12.34.56.78', '+33 6 12 34 56 78', '0033612345678', '+44 20 7946 0958', '0612345678']) {
    eq(raisonFiltre(t), 'telephone', t);
  }
});
test('Filtres', 'rejette un IBAN (FR76 et générique)', () => {
  eq(raisonFiltre('FR76 3000 6000 0112 3456 7890 189'), 'iban');
  eq(raisonFiltre('mon rib: fr7630006000011234567890189'), 'iban');
  eq(raisonFiltre('DE89 3704 0044 0532 0130 00'), 'iban');
});
test('Filtres', 'rejette une adresse e-mail', () => {
  eq(raisonFiltre('écris-moi à jean.dupont@gmail.com'), 'email');
  eq(raisonFiltre('jean (at) exemple.fr'), 'email');
});
test('Filtres', 'rejette un lien', () => {
  for (const t of ['https://exemple.org', 'va sur www.cagnotte.fr', 'mon-site.com', 'bit.ly/xyz', 'HTTP://X.Y']) eq(raisonFiltre(t), 'lien', t);
});
test('Filtres', 'rejette un mot interdit (sans accents ni majuscules)', () => {
  eq(raisonFiltre('Espèce de CONNARD'), 'mot_interdit');
  eq(raisonFiltre('quel enculé'), 'mot_interdit');
  eq(raisonFiltre('PD'), 'mot_interdit');
});
test('Filtres', 'laisse passer les textes normaux et les montants', () => {
  for (const t of ['Je veux 6 000 € pour partir', 'ça coûte 1 000 000 €', 'Il fait 10 000 000 euros', 'le 12 mars 2024 à 14h30', 'Je suis crevé et mon patron est rapide', 'Mon défi : 42,195 km', 'Problème n° 3']) {
    eq(raisonFiltre(t), null, t);
  }
});
test('Filtres', 'tout le contenu fictif du mode démo passe les filtres', () => {
  const textes = [
    ...EXEMPLES.flatMap((e) => [e[1], e[2]]), ...PROBLEMES.flatMap((p) => [p[1], p[2]]), ...COMMENTAIRES,
    ...POSTS_RICHES.flatMap((p) => [p[1], p[2]]).filter(Boolean), ...CLUB_RICHES.map((m) => m[1]), ...CLUB_PAUVRES.map((m) => m[1]), ...MEMBRES.map((m) => m[0]), ...MEMBRES.map((m) => m[2]).filter(Boolean)
  ];
  for (const t of textes) eq(raisonFiltre(t), null, `« ${t} »`);
});

/* ================= DOM safety (R-004) ================= */

test('Sécurité du DOM', 'isSafeUrl bloque javascript:, data:, vbscript: et les variantes masquées', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:x', 'java\tscript:x', 'java\nscript:x', 'data:text/html,<b>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', '/\\evil.example', '\\\\evil']) {
    eq(isSafeUrl(bad), false, bad);
  }
  for (const ok of ['index.html', 'p.html?id=1', '#mur', './aide.html', 'https://wa.me/?text=x', 'http://exemple.org', 'mailto:x@y.z', 'assets/img/logo.svg', '']) {
    eq(isSafeUrl(ok), true, ok);
  }
});
test('Sécurité du DOM', 'checkAttribute refuse on* non-fonction et les URL dangereuses', () => {
  eq(checkAttribute('onclick', 'alert(1)').ok, false);
  eq(checkAttribute('onClick', () => {}).ok, true);
  eq(checkAttribute('href', 'javascript:alert(1)').ok, false);
  eq(checkAttribute('src', 'data:image/svg+xml,<svg onload=alert(1)>').ok, false);
  eq(checkAttribute('formaction', 'javascript:x').ok, false);
  eq(checkAttribute('srcdoc', '<b>').ok, false);
  eq(checkAttribute('href', 'espace.html').ok, true);
  eq(checkAttribute('title', 'javascript:pas une url').ok, true);
});

/* ================= Public reads ================= */

test('Lecture publique', 'get_compteurs : forme et exemples exclus', async () => {
  const { api } = fresh();
  const c = await api.getCompteurs();
  for (const k of ['problemes', 'membres', 'riches', 'pauvres', 'milliardaires_verifies']) assert(Number.isInteger(c[k]), `champ ${k}`);
  eq(c.problemes, PROBLEMES.length, 'problèmes reçus hors exemples :');
  eq(c.riches + c.pauvres, MEMBRES.length);
  eq(c.milliardaires_verifies, 0);
});
test('Lecture publique', 'get_chiffres : 0 € financé, exemples exclus, catégories triées', async () => {
  const { api } = fresh();
  const c = await api.getChiffres();
  eq(c.finance, 0);
  const pub = PROBLEMES.filter((p) => p[5] === 'publie');
  eq(c.problemes_publies, pub.length);
  eq(c.montant_total, pub.reduce((s, p) => s + (p[3] || 0), 0));
  assert(c.par_categorie.every((x, i, a) => i === 0 || a[i - 1].nombre >= x.nombre), 'tri décroissant');
  assert(c.par_categorie.every((x) => CATEGORY_IDS.includes(x.categorie)));
});
test('Lecture publique', 'get_problemes_publics : uniquement publiés, non masqués, limite 48', async () => {
  const { api } = fresh();
  const list = await api.getProblemesPublics({ limite: 500 });
  assert(list.length <= 48, 'limite max 48');
  const titresNonPublies = PROBLEMES.filter((p) => p[5] !== 'publie').map((p) => p[1]);
  assert(!list.some((p) => titresNonPublies.includes(p.titre)), 'un problème non publié est visible');
  for (const k of ['id', 'categorie', 'titre', 'texte', 'montant', 'pseudo', 'camp', 'est_exemple', 'cree_le', 'rire', 'courage', 'paierais', 'commentaires']) assert(k in list[0], `colonne ${k}`);
  const ex = list.filter((p) => p.est_exemple);
  assert(ex.every((p) => p.pseudo === 'L\'équipe Qui paie ?' && p.camp === null), 'pseudo des exemples');
});
test('Lecture publique', 'get_problemes_publics : filtre de catégorie et pagination', async () => {
  const { api } = fresh();
  const reves = await api.getProblemesPublics({ categorie: 'reve', limite: 48 });
  assert(reves.length > 0 && reves.every((p) => p.categorie === 'reve'));
  const page1 = await api.getProblemesPublics({ limite: 5 });
  const page2 = await api.getProblemesPublics({ limite: 5, avant: page1[4].cree_le });
  assert(page2.length === 5 && !page2.some((p) => page1.some((q) => q.id === p.id)), 'pages distinctes');
  assert(page2[0].cree_le <= page1[4].cree_le, 'ordre chronologique inverse');
  await rejects(api.getProblemesPublics({ categorie: '<script>' }), 'invalide');
});
test('Lecture publique', 'get_probleme_public : null si non publié, inconnu ou id invalide', async () => {
  const { api, admin } = fresh();
  const brut = admin.etatBrut();
  const recu = brut.problems.find((p) => p.statut === 'recu');
  const refuse = brut.problems.find((p) => p.statut === 'refuse');
  eq(await api.getProblemePublic(recu.id), null);
  eq(await api.getProblemePublic(refuse.id), null);
  eq(await api.getProblemePublic('00000000-0000-4000-8000-000000000000'), null);
  eq(await api.getProblemePublic('1 OR 1=1'), null);
});
test('Lecture publique', 'get_probleme_hasard : renvoie toujours un problème publié', async () => {
  const { api } = fresh();
  for (let i = 0; i < 20; i++) {
    const id = await api.getProblemeHasard();
    assert(await api.getProblemePublic(id), 'le hasard a choisi un problème non visible');
  }
});
test('Lecture publique', 'aucune donnée privée dans les fonctions publiques', async () => {
  const { api } = fresh();
  assertNoPrivateData(await api.getCompteurs(), 'get_compteurs');
  assertNoPrivateData(await api.getChiffres(), 'get_chiffres');
  const list = await api.getProblemesPublics({ limite: 48 });
  assertNoPrivateData(list, 'get_problemes_publics');
  for (const p of list.slice(0, 10)) {
    assertNoPrivateData(await api.getProblemePublic(p.id), 'get_probleme_public');
    assertNoPrivateData(await api.getCommentaires(p.id), 'get_commentaires');
  }
});
test('Lecture publique', 'un visiteur ne peut rien écrire', async () => {
  const { api } = fresh();
  const p = await firstPublished(api);
  await rejects(api.reagir(p.id, 'rire'), 'non_connecte');
  await rejects(api.commenter(p.id, 'Salut'), 'non_connecte');
  await rejects(api.soumettreProbleme({ categorie: 'reve', titre: 'Titre ok', texte: 'Un texte assez long.' }), 'non_connecte');
  await rejects(api.getClubMessages(), 'non_connecte');
  await rejects(api.envoyerMessageClub('Coucou'), 'non_connecte');
  await rejects(api.signaler('probleme', p.id), 'non_connecte');
  await rejects(api.getMonEspace(), 'non_connecte');
  eq((await api.getMesReactions([p.id])).length, 0);
});

/* ================= B. Join in 10 seconds ================= */

test('B. Rejoindre', 'crée le profil et la session en un appel', async () => {
  const { api, join } = fresh();
  const avant = await api.getCompteurs();
  const r = await join('riche', 'Crésus Junior');
  eq(r.statut, 'cree');
  assert(/^[A-Z2-9]{8}$/.test(r.code_partage), 'code de partage sur 8 caractères');
  const s = await api.getSession();
  eq(s.profil.pseudo, 'Crésus Junior');
  eq(s.profil.camp, 'riche');
  const apres = await api.getCompteurs();
  eq(apres.riches, avant.riches + 1);
  eq(apres.membres, avant.membres + 1);
});
test('B. Rejoindre', 'exige 18 ans, les règles, un camp, un pseudo et un e-mail valides', async () => {
  const { api } = fresh();
  const base = { camp: 'pauvre', pseudo: 'Bob', email: 'bob@exemple.test', majeur: true, regles: true };
  await rejects(api.rejoindre({ ...base, majeur: false }), 'invalide');
  await rejects(api.rejoindre({ ...base, regles: false }), 'invalide');
  await rejects(api.rejoindre({ ...base, camp: 'milliardaire' }), 'invalide');
  await rejects(api.rejoindre({ ...base, pseudo: 'B' }), 'invalide');
  await rejects(api.rejoindre({ ...base, pseudo: 'x'.repeat(31) }), 'invalide');
  await rejects(api.rejoindre({ ...base, email: 'pas-un-mail' }), 'invalide');
  const e = await rejects(api.rejoindre({ ...base, pseudo: 'Gros connard' }), 'filtre');
  eq(e.message, MESSAGE_FILTRE);
  eq((await api.getSession()).connecte, false, 'aucune session ne doit rester après un échec :');
});
test('B. Rejoindre', 'e-mail déjà confirmé : lien de connexion, pas de doublon', async () => {
  const { api, admin } = fresh();
  const avant = await api.getCompteurs();
  const r = await api.rejoindre({ camp: 'pauvre', pseudo: 'Doublon', email: 'MEMBRE1@demo.invalid', majeur: true, regles: true });
  eq(r.statut, 'deja_membre');
  eq((await api.getCompteurs()).membres, avant.membres);
  eq((await api.getSession()).connecte, false);
  eq(admin.etatBrut().profiles.filter((p) => p.email === 'membre1@demo.invalid').length, 1);
});
test('B. Rejoindre', 'parrainage : code valide résolu, code inconnu ignoré', async () => {
  const { api, join } = fresh();
  const parrain = await join('pauvre', 'Parrain');
  await api.seDeconnecter();
  await join('riche', 'Filleul', { codeRef: parrain.code_partage.toLowerCase() });
  await api.seDeconnecter();
  await join('riche', 'Sans parrain', { codeRef: 'ZZZZZZZZ' });
  await join; // noop
  await api.seDeconnecter();
  await api.demoAdmin.connecterEnTantQue(parrain.userId);
  eq((await api.getMonEspace()).nb_invites, 1);
});
test('B. Rejoindre', 'creer_profil refuse un second profil', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  await rejects(api.creerProfil({ camp: 'riche', pseudo: 'Encore moi', email: 'x@exemple.test' }), 'invalide');
});

/* ================= C. Reconnect ================= */

test('C. Se reconnecter', 'compte confirmé : connexion ; inconnu : message dédié', async () => {
  const { api } = fresh();
  eq((await api.seReconnecter('membre3@demo.invalid')).statut, 'connecte');
  eq((await api.getSession()).profil.pseudo, MEMBRES[2][0]);
  await api.seDeconnecter();
  const e = await rejects(api.seReconnecter('inconnu@exemple.test'), 'aucun_compte');
  assert(/Rejoins un camp/.test(e.message));
});
test('C. Se reconnecter', 'compte non confirmé : pas de connexion par lien', async () => {
  const { api, join } = fresh();
  const m = await join('pauvre');
  await api.seDeconnecter();
  await rejects(api.seReconnecter(m.email), 'aucun_compte');
});

/* ================= C bis. E-mail never attached (R-024) ================= */

test('C. Se reconnecter', 'R-024 : compte sans e-mail côté auth → rattrapage avec l’adresse du profil, une seule fois', async () => {
  const { api, admin, join } = fresh();
  const m = await join('pauvre', 'Sans adresse');
  await admin.simulerEmailNonRattache(m.userId);
  eq((await api.rattraperEmail()).statut, 'rattache');
  const u = admin.etatBrut().users.find((x) => x.id === m.userId);
  eq(u.email_non_rattache, false, 'adresse rattachée :');
  eq(u.email_confirme, false, 'pas encore confirmée (e-mail envoyé) :');
  eq((await api.rattraperEmail()).statut, 'inutile', 'second appel :');
  // Account that already has its address: nothing to do
  await api.seDeconnecter();
  await join('riche', 'Normal');
  eq((await api.rattraperEmail()).statut, 'inutile');
  // Visitor: nothing to do
  await api.seDeconnecter();
  eq((await api.rattraperEmail()).statut, 'inutile');
});
test('C. Se reconnecter', 'R-024 : « Renvoyer l’e-mail » utilise l’adresse du profil si l’auth n’en a pas', async () => {
  const { api, admin, join } = fresh();
  const m = await join('pauvre', 'Sans adresse 2');
  await admin.simulerEmailNonRattache(m.userId);
  eq((await api.renvoyerConfirmation()).statut, 'confirme');
  eq((await api.getSession()).profil.email_confirme, true);
  await rejects(fresh().api.renvoyerConfirmation(), 'non_connecte', 'visiteur :');
});
test('C. Se reconnecter', 'R-024 : adresse déjà confirmée par un autre compte → email_pris, rien ne casse', async () => {
  const { api, admin } = fresh();
  // Two unconfirmed accounts with the same address; the first one confirms it.
  const a = await api.rejoindre({ camp: 'pauvre', pseudo: 'Premier', email: 'meme@exemple.test', majeur: true, regles: true });
  eq(a.statut, 'cree');
  const idA = (await api.getSession()).userId;
  await api.seDeconnecter();
  await api.rejoindre({ camp: 'riche', pseudo: 'Second', email: 'meme@exemple.test', majeur: true, regles: true });
  const idB = (await api.getSession()).userId;
  await admin.connecterEnTantQue(idA);
  eq((await api.renvoyerConfirmation()).statut, 'confirme');
  await admin.connecterEnTantQue(idB);
  await admin.simulerEmailNonRattache(idB);
  eq((await api.rattraperEmail()).statut, 'email_pris');
  const e = await rejects(api.renvoyerConfirmation(), 'email_pris');
  assert(/déjà liée à un autre compte/.test(e.message));
  // Nothing broken: B keeps its profile and its session, A stays confirmed
  const s = await api.getSession();
  eq(s.profil.pseudo, 'Second');
  eq(s.profil.email_confirme, false);
  eq(admin.etatBrut().users.find((x) => x.id === idA).email_confirme, true);
});

/* ================= D. Publish ================= */

test('D. Publier', 'un problème sans mot sensible est publié tout de suite', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  const r = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Mon grille-pain me juge', texte: 'Il brûle tout, sauf mes factures.', montant: 40 });
  eq(r.statut, 'publie');
  assert(/^[0-9a-f-]{36}$/.test(r.id), 'id renvoyé');
  const p = await api.getProblemePublic(r.id);
  eq(p.titre, 'Mon grille-pain me juge');
  eq(p.est_mon_probleme, true);
  const e = await api.getMonEspace();
  eq(e.problemes[0].statut, 'publie');
});
test('D. Publier', 'un mot sensible (titre ou texte, accents ignorés) envoie en relecture, invisible', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  const r1 = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Je suis à la rue', texte: 'Depuis lundi, avec mon sac et mon chat.', montant: 50 });
  eq(r1.statut, 'recu');
  eq(await api.getProblemePublic(r1.id), null);
  const r2 = await api.soumettreProbleme({ categorie: 'famille', titre: 'Une semaine compliquée', texte: 'Ma mère commence sa CHIMIO lundi, on cherche un taxi.', montant: 50 });
  eq(r2.statut, 'recu');
  const e = await api.getMonEspace();
  assert(e.problemes.every((x) => x.statut === 'recu'), 'les deux en relecture');
});
test('D. Publier', 'mots sensibles : mots entiers seulement (« violon », « abusé » passent)', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  const r = await api.soumettreProbleme({ categorie: 'plaisir', titre: 'Un violon pour mon chat', texte: 'Le prix est abusé, mais il chante faux sans.', montant: 50 });
  eq(r.statut, 'publie');
});
test('D. Publier', 'mots sensibles v2 (R-020) : « mourir de rire », « enceinte Bluetooth » publiés ; « envie de mourir » en relecture', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  eq((await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Je vais mourir de rire', texte: 'Mon chat a encore raté son saut sur le canapé.', montant: 50 })).statut, 'publie');
  eq((await api.soumettreProbleme({ categorie: 'plaisir', titre: 'Mon enceinte Bluetooth me trahit', texte: 'Elle se connecte toute seule chez le voisin, abus de pouvoir.', montant: 50 })).statut, 'publie');
  eq((await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Une période difficile', texte: 'J’ai envie de mourir depuis quelques semaines.', montant: 50 })).statut, 'recu');
  const { contientMotSensible } = await import('../mots-sensibles.js');
  for (const t of ['Je suis drogué au café', 'Mon chat frappe à la porte', 'Un abus de pouvoir']) assert(!contientMotSensible(t), `publié : ${t}`);
  for (const t of ['Je veux mourir', 'Je suis enceinte', 'Il me frappe', 'J’ai des idées noires', 'Des pensées suicidaires', 'Je me drogue']) assert(contientMotSensible(t), `relecture : ${t}`);
});
test('D. Publier', 'publication automatique coupée : tout part en relecture', async () => {
  const { api, join, admin } = fresh();
  await join('pauvre');
  await admin.setPublicationAuto(false);
  const r = await api.soumettreProbleme({ categorie: 'reve', titre: 'Voir la mer', texte: 'Une fois, en vrai, pas en photo.', montant: 50 });
  eq(r.statut, 'recu');
  eq(await api.getProblemePublic(r.id), null);
  await admin.setPublicationAuto(true);
  eq((await api.soumettreProbleme({ categorie: 'reve', titre: 'Voir la montagne', texte: 'Et redescendre en luge.', montant: 50 })).statut, 'publie');
});
test('D. Publier', 'un membre ne peut pas publier lui-même un problème en relecture (seule la modération publie)', async () => {
  const { api, join, admin } = fresh();
  await join('pauvre');
  const r = await api.soumettreProbleme({ categorie: 'reve', titre: 'Sortir de la dépression', texte: 'Une fois, en vrai, pas en photo.', montant: 50 });
  eq(r.statut, 'recu');
  assert(!('statut' in await api.majProfil({ pseudo: 'Tricheur' })), 'maj_profil ne touche pas aux problèmes');
  eq(await api.getProblemePublic(r.id), null);
  await admin.publier(r.id);
  eq((await api.getProblemePublic(r.id)).titre, 'Sortir de la dépression');
});
test('D. Publier', 'validation : catégorie, longueurs, montant, filtres', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  const ok = { categorie: 'reve', titre: 'Titre correct', texte: 'Un texte de plus de dix caractères.', montant: 100 };
  await rejects(api.soumettreProbleme({ ...ok, categorie: 'casino' }), 'invalide');
  await rejects(api.soumettreProbleme({ ...ok, titre: 'ab' }), 'invalide');
  await rejects(api.soumettreProbleme({ ...ok, titre: 'x'.repeat(81) }), 'invalide');
  await rejects(api.soumettreProbleme({ ...ok, texte: 'court' }), 'invalide');
  await rejects(api.soumettreProbleme({ ...ok, texte: 'x'.repeat(601) }), 'invalide');
  await rejects(api.soumettreProbleme({ ...ok, montant: -5 }), 'invalide');
  await rejects(api.soumettreProbleme({ ...ok, montant: 1000001 }), 'invalide');
  await rejects(api.soumettreProbleme({ ...ok, montant: 12.5 }), 'invalide');
  await rejects(api.soumettreProbleme({ ...ok, texte: 'Virez sur FR76 3000 6000 0112 3456 7890 189 merci' }), 'filtre');
  await rejects(api.soumettreProbleme({ ...ok, titre: 'Appelez le 0612345678' }), 'filtre');
});
test('D. Publier', 'limite (R-027) : 10 problèmes par 24 h', async () => {
  const { api, join, advance } = fresh();
  await join('pauvre');
  const p = (i) => api.soumettreProbleme({ categorie: 'defi', titre: `Défi numéro ${i}`, texte: 'Un texte de plus de dix caractères.', montant: 10 * i });
  for (let i = 1; i <= 10; i++) await p(i);
  const e = await rejects(p(11), 'limite');
  assert(/10 problèmes en 24 h/.test(e.message), e.message);
  advance(DAY + 1000);
  eq((await p(12)).statut, 'publie');
});
test('D. Publier', 'plafond (R-027) : un pauvre donne toujours un montant de 1 à 10 000 €', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  const ok = { categorie: 'reve', titre: 'Un rêve au plafond', texte: 'Un texte de plus de dix caractères.' };
  for (const montant of [undefined, null, '', 0, -1, 12.5]) {
    const e = await rejects(api.soumettreProbleme({ ...ok, montant }), 'invalide', `montant ${JSON.stringify(montant)} :`);
    assert(/de 1 à 10 000 €/.test(e.message), e.message);
  }
  const e = await rejects(api.soumettreProbleme({ ...ok, montant: 10001 }), 'invalide');
  eq(e.message, 'Un problème de pauvre ne dépasse jamais 10x Rien (10 000 €).');
  const r = await api.soumettreProbleme({ ...ok, montant: 10000 });
  eq((await api.getProblemePublic(r.id)).montant, 10000);
  eq((await api.soumettreProbleme({ ...ok, titre: 'Un tout petit rêve', montant: 1 })).statut, 'publie');
});
test('D. Publier', 'plafond (R-027) : exemples et données de démo des pauvres sous 10 000 €', () => {
  for (const [, titre, , montant] of EXEMPLES) assert(montant === null || montant <= 10000, `exemple « ${titre} » : ${montant}`);
  for (const [, titre, , montant, idx] of PROBLEMES) {
    eq(MEMBRES[idx][1], 'pauvre', `auteur de « ${titre} »`);
    assert(Number.isInteger(montant) && montant >= 1 && montant <= 10000, `« ${titre} » : ${montant}`);
  }
});

/* ================= Palmarès des pauvres (= 009_palmares.sql, R-028) ================= */

test('Palmarès', 'public : seulement rang, pseudo, camp, nb, total ; pauvres triés ; démo cohérente', async () => {
  const { api } = fresh();
  eq(await api.getMonRang(), null, 'visiteur :');
  const p = await api.getPalmares();
  assert(p.lignes.length > 10 && p.lignes.length <= 100, `${p.lignes.length} lignes`);
  eq(p.classes, new Set(PROBLEMES.filter((x) => x[5] === 'publie').map((x) => x[4])).size, 'pauvres classés :');
  for (const [i, l] of p.lignes.entries()) {
    eq(Object.keys(l).sort().join(','), 'camp,nb,pseudo,rang,total');
    eq(l.camp, 'pauvre');
    eq(l.rang, i + 1);
    if (i) assert(l.total < p.lignes[i - 1].total || (l.total === p.lignes[i - 1].total && l.nb <= p.lignes[i - 1].nb), `ordre au rang ${l.rang}`);
  }
  assertNoPrivateData(p, 'get_palmares');
  eq((await api.getPalmares({ limite: 3 })).lignes.length, 3);
  eq((await api.getPalmares({ limite: 5000 })).lignes.length, Math.min(100, p.classes));
});
test('Palmarès', 'mon rang : problèmes publiés non masqués seulement ; riche → null', async () => {
  const { api, join, admin } = fresh();
  const avant = (await api.getPalmares()).classes;
  await join('pauvre', 'Roi de la Dèche');
  let r = await api.getMonRang();
  eq(r.rang, null); eq(r.nb, 0); eq(r.total, 0); eq(r.sur, avant); eq(r.pseudo, 'Roi de la Dèche');
  const ok = { categorie: 'reve', texte: 'Un texte de plus de dix caractères.' };
  const a = await api.soumettreProbleme({ ...ok, titre: 'Premier gros rêve', montant: 10000 });
  await api.soumettreProbleme({ ...ok, titre: 'Second gros rêve', montant: 10000 });
  await api.soumettreProbleme({ ...ok, titre: 'Je suis à la rue', montant: 10000 }); // sensitive → in review, not counted
  r = await api.getMonRang();
  eq(r.rang, 1); eq(r.nb, 2); eq(r.total, 20000); eq(r.sur, avant + 1);
  eq((await api.getPalmares()).lignes[0].pseudo, 'Roi de la Dèche');
  await admin.masquer('probleme', a.id);
  r = await api.getMonRang();
  eq(r.nb, 1); eq(r.total, 10000);
  await join('riche');
  eq(await api.getMonRang(), null, 'riche :');
});
test('Palmarès', 'départage : nombre de problèmes, puis ancienneté ; membres bloqués exclus', async () => {
  const { api, join, admin, advance } = fresh();
  const ok = { categorie: 'defi', texte: 'Un texte de plus de dix caractères.' };
  const ancien = await join('pauvre', 'Ancien Fauché');
  await api.soumettreProbleme({ ...ok, titre: 'Défi unique', montant: 10000 });
  advance(HOUR);
  const recent = await join('pauvre', 'Nouveau Fauché');
  await api.soumettreProbleme({ ...ok, titre: 'Défi unique bis', montant: 10000 });
  advance(HOUR);
  await join('pauvre', 'Fauché en Deux');
  await api.soumettreProbleme({ ...ok, titre: 'Défi moitié un', montant: 5000 });
  await api.soumettreProbleme({ ...ok, titre: 'Défi moitié deux', montant: 5000 });
  const top = (await api.getPalmares({ limite: 3 })).lignes.map((l) => l.pseudo);
  eq(top.join(' > '), 'Fauché en Deux > Ancien Fauché > Nouveau Fauché');
  await admin.bloquer(ancien.userId);
  assert(!(await api.getPalmares()).lignes.some((l) => l.pseudo === 'Ancien Fauché'), 'bloqué exclu');
  await api.demoAdmin.connecterEnTantQue(recent.userId);
  eq((await api.getMonRang()).rang, 2);
});

/* ================= E. React, comment, report ================= */

test('E. Réactions', 'ajoute puis retire une réaction, compteurs à jour', async () => {
  const { api, join } = fresh();
  await join('riche');
  const p = await firstPublished(api);
  const r1 = await api.reagir(p.id, 'paierais');
  eq(r1.actif, true);
  eq(r1.paierais, p.paierais + 1);
  eq((await api.getMesReactions([p.id])).filter((x) => x.type === 'paierais').length, 1);
  const r2 = await api.reagir(p.id, 'paierais');
  eq(r2.actif, false);
  eq(r2.paierais, p.paierais);
  await rejects(api.reagir(p.id, 'colere'), 'invalide');
});
test('E. Réactions', 'impossible sur un problème non publié', async () => {
  const { api, join, admin } = fresh();
  await join('riche');
  const recu = admin.etatBrut().problems.find((x) => x.statut === 'recu');
  await rejects(api.reagir(recu.id, 'rire'), 'introuvable');
});
test('E. Commentaires', 'commenter, apparition immédiate, compteur', async () => {
  const { api, join } = fresh();
  await join('pauvre', 'Commentateur');
  const p = await firstPublished(api);
  const c = await api.commenter(p.id, 'Trop drôle, courage !');
  eq(c.pseudo, 'Commentateur');
  eq(c.est_moi, true);
  const list = await api.getCommentaires(p.id);
  eq(list[0].id, c.id);
  eq((await api.getProblemePublic(p.id)).commentaires, p.commentaires + 1);
});
test('E. Commentaires', 'limite : 10 commentaires par heure ; filtres', async () => {
  const { api, join, advance } = fresh();
  await join('pauvre');
  const p = await firstPublished(api);
  for (let i = 0; i < 10; i++) await api.commenter(p.id, `Commentaire ${i}`);
  await rejects(api.commenter(p.id, 'Un de trop'), 'limite');
  advance(HOUR + 1000);
  await api.commenter(p.id, 'Ça repart');
  await rejects(api.commenter(p.id, 'contacte moi sur www.arnaque.fr'), 'filtre');
  await rejects(api.commenter(p.id, '   '), 'invalide');
  await rejects(api.commenter(p.id, 'x'.repeat(301)), 'invalide');
});
test('E. Commentaires', 'supprimer : seulement l’auteur du commentaire', async () => {
  const { api, join, as } = fresh();
  const a = await join('pauvre', 'Auteur');
  const p = await firstPublished(api);
  const c = await api.commenter(p.id, 'À supprimer');
  await api.seDeconnecter();
  await join('riche', 'Intrus');
  await rejects(api.supprimerMonCommentaire(c.id), 'interdit');
  await as(a.userId);
  eq(await api.supprimerMonCommentaire(c.id), true);
  assert(!(await api.getCommentaires(p.id)).some((x) => x.id === c.id));
});
test('E. Commentaires', 'masquer : seulement l’auteur du problème ; texte masqué non renvoyé', async () => {
  const { api, join, as, admin } = fresh();
  const auteur = await join('pauvre', 'Auteur du problème');
  const pb = await api.soumettreProbleme({ categorie: 'amour', titre: 'Mon crush a un yacht', texte: 'Et moi une trottinette. Ça coince.', montant: 50 });
  await admin.publier(pb.id);
  await api.seDeconnecter();
  await join('riche', 'Moqueur');
  const c = await api.commenter(pb.id, 'Commentaire un peu lourd');
  await rejects(api.masquerCommentaire(c.id), 'interdit');
  await api.seDeconnecter();
  await join('riche', 'Autre');
  await rejects(api.masquerCommentaire(c.id), 'interdit');
  await as(auteur.userId);
  eq(await api.masquerCommentaire(c.id), true);
  const vu = (await api.getCommentaires(pb.id)).find((x) => x.id === c.id);
  eq(vu.texte, null);
  eq(vu.masque, true);
  assertNoPrivateData(vu, 'commentaire masqué');
});
test('E. Signaler', 'le 3ᵉ signalement masque un problème', async () => {
  const { api, join } = fresh();
  const p = await firstPublished(api);
  for (let i = 0; i < 2; i++) {
    await join('pauvre');
    eq((await api.signaler('probleme', p.id)).masque, false);
    await api.seDeconnecter();
  }
  await join('riche');
  eq((await api.signaler('probleme', p.id)).masque, true);
  eq(await api.getProblemePublic(p.id), null);
  assert(!(await api.getProblemesPublics({ limite: 48 })).some((x) => x.id === p.id));
});
test('E. Signaler', 'un seul signalement par membre et par cible ; limite 20/h', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  const list = await api.getProblemesPublics({ limite: 48 });
  await api.signaler('probleme', list[0].id);
  await rejects(api.signaler('probleme', list[0].id), 'deja_fait');
  for (let i = 1; i < 20; i++) await api.signaler('probleme', list[i].id);
  await rejects(api.signaler('probleme', list[20].id), 'limite');
  await rejects(api.signaler('utilisateur', list[21].id), 'invalide');
});
test('E. Signaler', 'le 3ᵉ signalement masque un commentaire et un message de club', async () => {
  const { api, join } = fresh();
  const p = await firstPublished(api);
  await join('pauvre', 'Cible');
  const c = await api.commenter(p.id, 'Commentaire signalé');
  const m = await api.envoyerMessageClub('Message signalé');
  await api.seDeconnecter();
  for (let i = 0; i < 3; i++) {
    await join('pauvre');
    await api.signaler('commentaire', c.id);
    await api.signaler('message', m.id);
    await api.seDeconnecter();
  }
  const vu = (await api.getCommentaires(p.id)).find((x) => x.id === c.id);
  eq(vu.masque, true);
  eq(vu.texte, null);
  await join('pauvre');
  assert(!(await api.getClubMessages()).some((x) => x.id === m.id), 'message masqué encore visible');
});

/* ================= F. Clubs ================= */

test('F. Clubs', 'cloisonnement : un pauvre ne lit pas le club des riches, et inversement', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  const mp = await api.envoyerMessageClub('Message secret des pauvres');
  const vusPauvre = await api.getClubMessages();
  assert(vusPauvre.some((x) => x.id === mp.id));
  assert(!vusPauvre.some((x) => CLUB_RICHES.some(([, t]) => t === x.texte)), 'un pauvre voit un message des riches');
  await api.seDeconnecter();
  await join('riche');
  const vusRiche = await api.getClubMessages();
  assert(!vusRiche.some((x) => x.id === mp.id), 'un riche voit un message des pauvres');
  assert(!vusRiche.some((x) => CLUB_PAUVRES.some(([, t]) => t === x.texte)));
  assertNoPrivateData(vusRiche, 'get_club_messages');
  await rejects(api.signaler('message', mp.id), 'introuvable');
});
test('F. Clubs', 'messages après un curseur, 100 au premier appel', async () => {
  const { api, join, advance } = fresh();
  await join('riche');
  const avant = await api.getClubMessages();
  assert(avant.length <= 100);
  const dernier = avant[avant.length - 1].cree_le;
  advance(1000);
  await api.envoyerMessageClub('Nouveau message');
  const apres = await api.getClubMessages(dernier);
  eq(apres.length, 1);
  eq(apres[0].est_moi, true);
});
test('F. Clubs', 'limite : 30 messages par heure ; filtres', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  for (let i = 0; i < 30; i++) await api.envoyerMessageClub(`Message ${i}`);
  await rejects(api.envoyerMessageClub('Un de trop'), 'limite');
  const { api: api2, join: join2 } = fresh();
  await join2('pauvre');
  await rejects(api2.envoyerMessageClub('Mon IBAN : FR76 3000 6000 0112 3456 7890 189'), 'filtre');
  await rejects(api2.envoyerMessageClub('jean@exemple.fr'), 'filtre');
});
test('F. Clubs', 'changer de camp change de club', async () => {
  const { api, join } = fresh();
  const moi = await join('pauvre');
  await api.majProfil({ camp: 'riche' });
  await rejects(api.getClubMessages(), 'riche_en_attente');
  await api.demoAdmin.activerRiche(moi.userId);
  const msgs = await api.getClubMessages();
  assert(msgs.some((x) => CLUB_RICHES.some(([, t]) => t === x.texte)));
  const m = await api.envoyerMessageClub('Je suis passé chez les riches');
  assert((await api.getClubMessages()).some((x) => x.id === m.id));
});

/* ================= G. My space ================= */

test('G. Mon espace', 'renvoie ses données, ses problèmes, ses invités', async () => {
  const { api, join } = fresh();
  const m = await join('riche', 'Mécène');
  const e = await api.getMonEspace();
  eq(e.pseudo, 'Mécène');
  eq(e.email, m.email);
  eq(e.code_partage, m.code_partage);
  eq(e.nb_invites, 0);
  eq(Array.isArray(e.problemes), true);
});
test('G. Mon espace', 'maj_profil : pseudo, newsletter, données riche, validation', async () => {
  const { api, join } = fresh();
  await join('riche');
  const r = await api.majProfil({ pseudo: 'Nouveau nom', newsletter: true, riche_message: 'Je financerais une bibliothèque.', riche_montant: 25000 });
  eq(r.pseudo, 'Nouveau nom');
  eq(r.riche_montant, 25000);
  await rejects(api.majProfil({ riche_montant: 10000001 }), 'invalide');
  await rejects(api.majProfil({ riche_message: 'Écrivez-moi sur riche@exemple.fr' }), 'filtre');
  await rejects(api.majProfil({ camp: 'bourgeois' }), 'invalide');
  const c = await api.majProfil({ riche_message: null, riche_montant: null });
  eq(c.riche_message, null);
  eq(c.riche_montant, null);
});
test('G. Mon espace', 'supprimer mon compte efface tout et déconnecte', async () => {
  const { api, join, admin } = fresh();
  const avant = await api.getCompteurs();
  const m = await join('pauvre', 'Éphémère');
  const p = await firstPublished(api);
  await api.reagir(p.id, 'rire');
  await api.commenter(p.id, 'Je pars bientôt');
  await api.envoyerMessageClub('Au revoir le club');
  await api.soumettreProbleme({ categorie: 'reve', titre: 'Partir loin', texte: 'Très loin, sans laisser d’adresse.', montant: 50 });
  eq(await api.supprimerMonCompte(), true);
  eq((await api.getSession()).connecte, false);
  const brut = admin.etatBrut();
  for (const table of ['reactions', 'comments', 'club_messages', 'problems', 'reports']) {
    assert(!brut[table].some((r) => r.user_id === m.userId), `reste des lignes dans ${table}`);
  }
  assert(!brut.profiles.some((x) => x.id === m.userId));
  eq((await api.getCompteurs()).membres, avant.membres);
});

/* ================= Blocked member ================= */

test('Blocage', 'un membre bloqué ne peut plus rien écrire', async () => {
  const { api, join, admin } = fresh();
  const m = await join('pauvre');
  const p = await firstPublished(api);
  const c = await api.commenter(p.id, 'Avant le blocage');
  await admin.bloquer(m.userId);
  await rejects(api.soumettreProbleme({ categorie: 'reve', titre: 'Titre bloqué', texte: 'Texte bloqué assez long.' }), 'bloque');
  await rejects(api.reagir(p.id, 'rire'), 'bloque');
  await rejects(api.commenter(p.id, 'Après'), 'bloque');
  await rejects(api.envoyerMessageClub('Après'), 'bloque');
  await rejects(api.signaler('probleme', p.id), 'bloque');
  await rejects(api.majProfil({ pseudo: 'Rebelle' }), 'bloque');
  await rejects(api.supprimerMonCommentaire(c.id), 'bloque');
  eq((await api.getSession()).profil.bloque, true);
});
test('Blocage', 'un membre ne peut pas se déclarer vérifié', async () => {
  const { api, join } = fresh();
  await join('riche');
  await api.majProfil({ pseudo: 'Milliardaire vérifié', verifie: true });
  eq((await api.getMonEspace()).verifie, false);
  eq((await api.getCompteurs()).milliardaires_verifies, 0);
});

/* ================= Persistence ================= */

test('Persistance', 'l’état survit à un rechargement (même stockage)', async () => {
  const storage = memoryStorage();
  const a = createDemoApi({ storage, now: () => T0 });
  await a.rejoindre({ camp: 'riche', pseudo: 'Persistant', email: 'p@exemple.test', majeur: true, regles: true });
  const b = createDemoApi({ storage, now: () => T0 + HOUR });
  eq((await b.getSession()).profil.pseudo, 'Persistant');
  b.demoAdmin.reinitialiser();
  const c = createDemoApi({ storage, now: () => T0 });
  eq((await c.getSession()).connecte, false);
});

/* ================= Runner ================= */

/* ================= H. Moderation page (= mod_* of 006_moderateurs.sql) ================= */

const MOD_APPELS = (m, ids) => [
  ['aRelire', () => m.aRelire()],
  ['recents', () => m.recents(48)],
  ['masques', () => m.masques()],
  ['signalements24h', () => m.signalements24h()],
  ['modererProbleme', () => m.modererProbleme(ids.probleme, 'publie')],
  ['masquer', () => m.masquer('probleme', ids.probleme, true)],
  ['bloquer', () => m.bloquer(ids.membre, true)]
];

test('H. Modération', 'visiteur et membre non modérateur : refusés sur chaque fonction, rien ne change', async () => {
  const { api, join } = fresh();
  const auteur = await join('pauvre');
  const r = await api.soumettreProbleme({ categorie: 'famille', titre: 'Une semaine compliquée', texte: 'Ma mère commence sa chimio lundi.', montant: 50 });
  eq(r.statut, 'recu');
  const ids = { probleme: r.id, membre: auteur.userId };
  await api.seDeconnecter();
  eq(await api.moderation.suisJe(), false, 'visiteur :');
  for (const [nom, appel] of MOD_APPELS(api.moderation, ids)) await rejects(appel(), 'interdit', `visiteur, ${nom} :`);
  await join('riche');
  eq(await api.moderation.suisJe(), false, 'membre :');
  for (const [nom, appel] of MOD_APPELS(api.moderation, ids)) await rejects(appel(), 'interdit', `membre, ${nom} :`);
  const brut = api.demoAdmin.etatBrut();
  eq(brut.problems.find((p) => p.id === r.id).statut, 'recu');
  eq(brut.problems.find((p) => p.id === r.id).masque, false);
  eq(brut.profiles.find((p) => p.id === auteur.userId).bloque, false);
});

test('H. Modération', 'modérateur : à relire, publier, refuser, réorienter, récents', async () => {
  const { api, join, as, admin } = fresh();
  const auteur = await join('pauvre');
  const sensible = await api.soumettreProbleme({ categorie: 'famille', titre: 'Une semaine compliquée', texte: 'Ma mère commence sa chimio lundi.', montant: 50 });
  const normal = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Mon grille-pain me juge', texte: 'Il brûle tout, sauf mes factures.', montant: 50 });
  const modo = await join('riche', 'Modo');
  await admin.setModerateur(modo.userId);
  eq(await api.moderation.suisJe(), true);
  const file = await api.moderation.aRelire();
  const item = file.find((x) => x.id === sensible.id);
  assert(item && item.user_id === auteur.userId && item.pseudo, 'problème sensible dans la file, avec son auteur');
  assert(!file.some((x) => x.id === normal.id), 'le problème publié n’est pas dans la file');
  assertNoEmail(file, 'aRelire');
  const recents = await api.moderation.recents(48);
  assert(recents.some((x) => x.id === normal.id) && recents.every((x) => x.statut === 'publie'), 'récents = publiés');
  assert(!recents.some((x) => x.id === sensible.id), 'récents sans le problème en attente');
  eq((await api.moderation.modererProbleme(sensible.id, 'publie')).statut, 'publie');
  eq((await api.getProblemePublic(sensible.id)).titre, 'Une semaine compliquée');
  await api.moderation.modererProbleme(sensible.id, 'reoriente');
  eq(await api.getProblemePublic(sensible.id), null);
  await api.moderation.modererProbleme(normal.id, 'refuse');
  eq(await api.getProblemePublic(normal.id), null);
  await rejects(api.moderation.modererProbleme(normal.id, 'supprime'), 'invalide');
  await as(auteur.userId);
  const e = await api.getMonEspace();
  eq(e.problemes.find((x) => x.id === sensible.id).statut, 'reoriente');
});

test('H. Modération', 'modérateur : signalés, masquer / rétablir (alias anglais), bloquer / débloquer', async () => {
  const { api, join, as, admin } = fresh();
  const auteur = await join('pauvre');
  const pb = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Mon chat me snobe', texte: 'Il refuse de me dire bonjour le matin.', montant: 50 });
  const com = await api.commenter(pb.id, 'Commentaire à modérer');
  const modo = await join('riche', 'Modo');
  await admin.setModerateur(modo.userId);
  await api.signaler('probleme', pb.id);
  const sig = await api.moderation.signalements24h();
  const s = sig.find((x) => x.cible_id === pb.id);
  assert(s && s.nb_signalements === 1 && s.user_id === auteur.userId && s.cible_type === 'probleme', 'contenu signalé listé');
  assertNoEmail(sig, 'signalements24h');
  await api.moderation.masquer('probleme', pb.id, true);
  eq(await api.getProblemePublic(pb.id), null);
  assert((await api.moderation.masques()).some((x) => x.cible_id === pb.id && x.cible_type === 'probleme'), 'listé dans masqués');
  await api.moderation.masquer('problem', pb.id, false);
  assert(await api.getProblemePublic(pb.id), 'rétabli');
  await api.moderation.masquer('comment', com.id, true);
  const c = api.demoAdmin.etatBrut().comments.find((x) => x.id === com.id);
  assert(c.masque && c.masque_par === 'admin', 'commentaire masqué par la modération');
  await api.moderation.masquer('commentaire', com.id, false);
  await rejects(api.moderation.masquer('profil', pb.id, true), 'invalide');
  await api.moderation.bloquer(auteur.userId, true);
  await rejects(api.moderation.bloquer(modo.userId, true), 'invalide', 'se bloquer soi-même :');
  await as(auteur.userId);
  await rejects(api.commenter(pb.id, 'Je suis bloqué'), 'bloque');
  await as(modo.userId);
  await api.moderation.bloquer(auteur.userId, false);
  await as(auteur.userId);
  await api.commenter(pb.id, 'Je suis débloqué');
});

test('H. Modération', 'supprimer son compte retire le droit de modérateur', async () => {
  const { api, join, admin } = fresh();
  const modo = await join('riche', 'Modo');
  await admin.setModerateur(modo.userId);
  await api.supprimerMonCompte();
  eq(admin.etatBrut().moderateurs.length, 0);
  eq(await api.moderation.suisJe(), false);
});

/* ================= I. Riches payants (= 010_riches_payants.sql, R-029) ================= */

test('I. Riches payants', 'un riche qui s’inscrit est en attente : il lit, mais n’écrit nulle part', async () => {
  const { api, join } = fresh();
  const avant = await api.getCompteurs();
  const p = await firstPublished(api);
  await join('riche', 'Riche Patient', { enAttente: true });
  eq((await api.getSession()).profil.statut_riche, 'en_attente');
  const e = await api.getMonEspace();
  eq(e.statut_riche, 'en_attente'); eq(e.riche_jusqu_au, null);
  eq((await api.getCompteurs()).riches, avant.riches, 'compteur des riches :');
  eq((await api.getChiffres()).riches, avant.riches, 'chiffres :');
  assert((await api.getProblemesPublics()).length > 0, 'il lit le mur');
  for (const [nom, appel] of [
    ['publier', () => api.soumettreProbleme({ categorie: 'reve', titre: 'Un yacht de plus', texte: 'Le premier est trop petit.', montant: 100 })],
    ['réagir', () => api.reagir(p.id, 'rire')],
    ['commenter', () => api.commenter(p.id, 'Bonjour les pauvres')],
    ['écrire au club', () => api.envoyerMessageClub('Bonjour le club')],
    ['lire le club', () => api.getClubMessages()],
    ['signaler', () => api.signaler('probleme', p.id)]
  ]) await rejects(appel(), 'riche_en_attente', `${nom} :`);
  eq((await api.majProfil({ pseudo: 'Riche Toujours Patient' })).statut_riche, 'en_attente');
});

test('I. Riches payants', 'modération : activer 1 mois / 1 an (prolonge), expiration calculée, désactiver, refuser', async () => {
  const { api, join, as, advance } = fresh();
  const avant = (await api.getCompteurs()).riches;
  const r = await join('riche', 'Futur Riche', { enAttente: true });
  const modo = await join('pauvre', 'Modo Démo');
  await api.demoAdmin.setModerateur(modo.userId);
  const liste = await api.moderation.riches();
  assert(liste.some((x) => x.user_id === r.userId && x.statut === 'en_attente'), 'en attente listé');
  eq(liste[0].statut, 'en_attente', 'en attente d’abord :');
  assertNoEmail(liste, 'riches()');
  const a = await api.moderation.activerRiche(r.userId, 'mensuel');
  eq(a.jusqu_au, new Date(Date.UTC(2026, 11, 20, 12)).toISOString(), '1 mois :');
  const b = await api.moderation.activerRiche(r.userId, 'annuel');
  eq(b.jusqu_au, new Date(Date.UTC(2027, 11, 20, 12)).toISOString(), '1 mois + 1 an :');
  await rejects(api.moderation.activerRiche(r.userId, 'hebdo'), 'invalide');
  await rejects(api.moderation.activerRiche(modo.userId, 'annuel'), 'invalide', 'un pauvre :');
  eq((await api.getCompteurs()).riches, avant + 1);
  await as(r.userId);
  const p = await firstPublished(api);
  eq((await api.commenter(p.id, 'Enfin validé')).texte, 'Enfin validé');
  eq((await api.getMonEspace()).riche_formule, 'annuel');
  advance(400 * DAY);
  await rejects(api.reagir(p.id, 'rire'), 'riche_en_attente', 'expiré :');
  eq((await api.getMonEspace()).statut_riche, 'en_attente');
  eq((await api.getCompteurs()).riches, avant);
  await as(modo.userId);
  await api.moderation.activerRiche(r.userId, 'mensuel');
  await api.moderation.desactiverRiche(r.userId);
  await as(r.userId);
  eq((await api.getSession()).profil.statut_riche, 'en_attente');
  await as(modo.userId);
  await api.moderation.refuserRiche(r.userId);
  await as(r.userId);
  eq((await api.getSession()).profil.camp, 'pauvre');
  eq((await api.soumettreProbleme({ categorie: 'reve', titre: 'Retour chez les pauvres', texte: 'Un texte assez long.', montant: 100 })).statut, 'publie');
});

test('I. Riches payants', 'modérateur toujours actif ; passer de pauvre à riche remet en attente ; non-modérateurs refusés', async () => {
  const { api, join, as } = fresh();
  const modo = await join('riche', 'Modo Riche', { enAttente: true });
  await api.demoAdmin.setModerateur(modo.userId);
  eq((await api.getSession()).profil.statut_riche, 'actif', 'modérateur :');
  await rejects(api.moderation.refuserRiche(modo.userId), 'invalide');
  await rejects(api.moderation.desactiverRiche(modo.userId), 'invalide');
  const p = await join('pauvre', 'Pauvre Ambitieux');
  eq((await api.majProfil({ camp: 'riche' })).statut_riche, 'en_attente');
  await rejects(api.envoyerMessageClub('Bonjour les riches'), 'riche_en_attente');
  for (const appel of [() => api.moderation.riches(), () => api.moderation.activerRiche(p.userId, 'annuel'),
    () => api.moderation.desactiverRiche(modo.userId), () => api.moderation.refuserRiche(modo.userId)]) {
    await rejects(appel(), 'interdit');
  }
  eq((await api.getSession()).profil.statut_riche, 'en_attente', 'rien n’a changé :');
  const riche = await join('riche', 'Riche Actif');
  eq((await api.getSession()).profil.statut_riche, 'actif');
  await api.majProfil({ camp: 'pauvre' });
  eq((await api.majProfil({ camp: 'riche' })).statut_riche, 'en_attente', 'aller-retour :');
  await as(riche.userId);
});

/* ================= J. Problèmes et publications de riches (= 011, R-030) ================= */

test('J. Publications de riches', 'un riche actif publie un problème de riche (sans plafond) ou une simple publication', async () => {
  const { api, join } = fresh();
  await join('riche', 'Nouveau Riche');
  await rejects(api.soumettreProbleme({ categorie: 'reve', titre: 'Un yacht de plus', texte: 'Le premier est trop petit.', montant: 100 }), 'interdit', 'problème de pauvre :');
  const a = await api.publierRiche({ type: 'publication', texte: 'Bonjour les pauvres, je viens d’arriver avec mon yacht.', titre: 'ignoré', montant: 999 });
  eq(a.statut, 'publie'); eq(a.premiere, true);
  const pa = await api.getProblemePublic(a.id);
  eq(pa.type, 'publication'); eq(pa.titre, null); eq(pa.montant, null); eq(pa.categorie, null); eq(pa.premiere, true); eq(pa.camp, 'riche');
  const b = await api.publierRiche({ type: 'riche', titre: 'Problème de majordome', texte: 'Il refuse de repasser mes chaussettes en soie.', montant: 50000 });
  eq(b.premiere, false);
  const pb = await api.getProblemePublic(b.id);
  eq(pb.type, 'riche'); eq(pb.montant, 50000);
  const ok = { type: 'riche', titre: 'Titre correct', texte: 'Un texte de plus de dix caractères.' };
  await rejects(api.publierRiche({ ...ok, montant: 1000001 }), 'invalide');
  await rejects(api.publierRiche({ ...ok, titre: null }), 'invalide');
  await rejects(api.publierRiche({ type: 'publication', texte: 'x'.repeat(601) }), 'invalide');
  await rejects(api.publierRiche({ type: 'pauvre', texte: 'Un riche déguisé en pauvre.' }), 'invalide');
  await rejects(api.publierRiche({ type: 'publication', texte: 'Appelez-moi au 06 12 34 56 78 pour mon yacht.' }), 'filtre');
  eq((await api.publierRiche({ type: 'publication', texte: 'Ma mère commence sa chimio, je ne sais pas quoi faire.' })).statut, 'recu');
  const e = await api.getMonEspace();
  assert(e.problemes.some((x) => x.type === 'publication' && x.titre.startsWith('Bonjour les pauvres')), 'Mon espace');
});
test('J. Publications de riches', 'un pauvre, un riche en attente et un visiteur ne publient pas comme un riche', async () => {
  const { api, join } = fresh();
  await rejects(api.publierRiche({ type: 'publication', texte: 'Un visiteur anonyme.' }), 'non_connecte');
  await join('pauvre');
  await rejects(api.publierRiche({ type: 'publication', texte: 'Je me fais passer pour un riche.' }), 'interdit');
  await join('riche', null, { enAttente: true });
  await rejects(api.publierRiche({ type: 'publication', texte: 'Je ne suis pas encore validé.' }), 'riche_en_attente');
});
test('J. Publications de riches', 'mur : filtres par type ; ni le palmarès ni « Les chiffres » ne comptent les riches', async () => {
  const { api, join } = fresh();
  const chiffres = await api.getChiffres();
  const palmares = await api.getPalmares();
  const compteurs = await api.getCompteurs();
  for (const type of ['pauvre', 'riche', 'publication']) {
    const l = await api.getProblemesPublics({ type, limite: 48 });
    assert(l.length > 0 && l.every((x) => x.type === type), `filtre ${type}`);
  }
  eq((await api.getProblemesPublics({ type: 'publication', limite: 48 })).length, POSTS_RICHES.filter((x) => x[0] === 'publication').length);
  await rejects(api.getProblemesPublics({ type: 'yacht' }), 'invalide');
  assert((await api.getProblemesPublics({ limite: 48 })).some((x) => x.type !== 'pauvre'), 'tout voir mélange les types');
  await join('riche');
  await api.publierRiche({ type: 'riche', titre: 'Mon jet est trop bruyant', texte: 'Les pilotes refusent de chuchoter.', montant: 90000 });
  eq((await api.getChiffres()).montant_total, chiffres.montant_total, 'chiffres :');
  eq((await api.getChiffres()).problemes_publies, chiffres.problemes_publies);
  eq((await api.getCompteurs()).problemes, compteurs.problemes);
  eq(JSON.stringify(await api.getPalmares()), JSON.stringify(palmares), 'palmarès :');
});
test('J. Publications de riches', 'même modération : signalements, masquage, relecture', async () => {
  const { api, join, as } = fresh();
  const r = await join('riche');
  const a = await api.publierRiche({ type: 'publication', texte: 'Ma petite publication de riche à signaler.' });
  const s = await api.publierRiche({ type: 'publication', texte: 'Je me sens à la rue depuis que mon chef est parti.' });
  eq(s.statut, 'recu');
  for (let i = 0; i < 3; i++) { await join('pauvre'); await api.signaler('probleme', a.id); }
  eq(await api.getProblemePublic(a.id), null, 'masquée au 3ᵉ signalement :');
  await api.demoAdmin.setModerateur(r.userId);
  await as(r.userId);
  const masques = await api.moderation.masques();
  assert(masques.some((x) => x.cible_id === a.id && x.contenu === 'Ma petite publication de riche à signaler.'), 'contenu lisible');
  assert((await api.moderation.aRelire()).some((x) => x.id === s.id && x.type === 'publication'), 'à relire avec le type');
});

/* ================= K. « Un nouveau riche est arrivé » (= 012, R-031) ================= */

test('K. Nouveau riche', 'l’activation par un modérateur crée une annonce de 72 h (pseudo + lien) ; prolonger n’annonce rien', async () => {
  const { api, join, as, advance } = fresh();
  eq((await api.getAnnonces()).length, 0);
  const r = await join('riche', 'Crésus Junior', { enAttente: true });
  const modo = await join('pauvre', 'Modo Annonces');
  await api.demoAdmin.setModerateur(modo.userId);
  eq((await api.moderation.activerRiche(r.userId, 'mensuel')).annonce, true);
  eq((await api.moderation.activerRiche(r.userId, 'annuel')).annonce, false, 'prolongation :');
  await api.seDeconnecter();
  let l = await api.getAnnonces();
  eq(l.length, 1);
  eq(Object.keys(l[0]).sort().join(','), 'lien,pseudo');
  eq(l[0].pseudo, 'Crésus Junior');
  eq(l[0].lien, 'index.html?type=publication#mur', 'sans publication :');
  await as(r.userId);
  const pub = await api.publierRiche({ type: 'publication', texte: 'Bonjour les pauvres, je suis enfin validé !' });
  eq((await api.getAnnonces())[0].lien, `p.html?id=${pub.id}`, 'vers sa première publication :');
  assertNoPrivateData(await api.getAnnonces(), 'get_annonces');
  advance(73 * HOUR);
  eq((await api.getAnnonces()).length, 0, 'après 72 h :');
});
test('K. Nouveau riche', 'e-mail (démo, aucun envoi réel) : pauvres inscrits seulement, jamais deux fois, modérateurs seulement', async () => {
  const { api, join, as } = fresh();
  const r = await join('riche', 'Riche Annoncé', { enAttente: true });
  const p1 = await join('pauvre', 'Pauvre Inscrit', { newsletter: true });
  await api.renvoyerConfirmation();
  await join('pauvre', 'Pauvre Discret', { newsletter: false });
  await api.renvoyerConfirmation();
  const modo = await join('pauvre', 'Modo Mail');
  await api.demoAdmin.setModerateur(modo.userId);
  await api.moderation.activerRiche(r.userId, 'annuel');
  const [annonce] = await api.moderation.annonces();
  eq(annonce.pseudo, 'Riche Annoncé'); eq(annonce.en_cours, true); eq(annonce.envoyes, 0);
  assertNoEmail(await api.moderation.annonces(), 'mod_annonces');
  const brut = api.demoAdmin.etatBrut();
  const attendus = brut.profiles.filter((p) => p.camp === 'pauvre' && p.newsletter && !p.bloque
    && brut.users.some((u) => u.id === p.id && u.email_confirme && !u.is_anonymous));
  assert(attendus.some((p) => p.id === p1.userId), 'le pauvre inscrit est destinataire');
  const e1 = await api.moderation.annoncerParEmail(annonce.id);
  eq(e1.demo, true); eq(e1.envoyes, Math.min(250, attendus.length)); eq(e1.echecs, 0);
  const envois = api.demoAdmin.etatBrut().annonce_envois;
  assert(!envois.some((e) => brut.profiles.find((p) => p.id === e.user_id).pseudo === 'Pauvre Discret'), 'pas de case cochée, pas d’e-mail');
  eq((await api.moderation.annoncerParEmail(annonce.id)).envoyes, 0, 'jamais deux fois :');
  await as(p1.userId);
  await rejects(api.moderation.annoncerParEmail(annonce.id), 'interdit');
  await rejects(api.moderation.annonces(), 'interdit');
});
test('K. Nouveau riche', 'désinscription par jeton ; case de l’inscription renommée', async () => {
  const { api, join } = fresh();
  const p = await join('pauvre', 'Pauvre Lassé', { newsletter: true });
  const jeton = api.demoAdmin.etatBrut().profiles.find((x) => x.id === p.userId).jeton_desinscription;
  assert(/^[0-9a-f-]{36}$/.test(jeton), 'jeton');
  await api.seDeconnecter();
  eq(await api.seDesinscrire('pas-un-jeton'), false);
  eq(await api.seDesinscrire('00000000-0000-4000-8000-000000000000'), false);
  eq(await api.seDesinscrire(jeton), true);
  eq(api.demoAdmin.etatBrut().profiles.find((x) => x.id === p.userId).newsletter, false);
  const { LIBELLE_NEWSLETTER } = await import('../auth-textes.js');
  eq(LIBELLE_NEWSLETTER, 'Préviens-moi par e-mail quand un riche débarque (et les nouvelles du projet)');
});

/* ================= L. « Le problème du moment » (= 013, R-034) ================= */
test('L. Problème du moment', 'le plus de réactions sur 7 jours, sinon le plus récent ; jamais riche, masqué, bloqué ni exemple', async () => {
  const { api, admin, join, as, advance } = fresh();
  await api.getCompteurs();  // seeds the demo at T0
  advance(30 * DAY);  // every seeded reaction is now older than 7 days
  const auteur = await join('pauvre', 'Auteur du moment');
  const x = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Mon frigo fait la grève', texte: 'Il ne refroidit plus que les ambiances.', montant: 450 });
  let m = await api.getProblemeDuMoment();
  eq(m.id, x.id, 'sans réaction récente, le plus récent :');
  assertNoPrivateData(m, 'get_probleme_du_moment');
  eq(m.type, 'pauvre'); eq(m.pseudo, 'Auteur du moment'); eq(m.est_exemple, false);
  advance(HOUR);
  const y = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Ma box internet me boude', texte: 'Elle clignote en rouge dès que je la regarde.', montant: 80 });
  eq((await api.getProblemeDuMoment()).id, y.id, 'le plus récent :');
  const r1 = await join('pauvre'); await api.reagir(x.id, 'rire'); await api.reagir(x.id, 'courage');
  const riche = await join('riche');
  await api.reagir(x.id, 'paierais');
  const pub = await api.publierRiche({ type: 'riche', titre: 'Mon yacht est trop petit', texte: 'Il ne rentre que deux hélicoptères.', montant: 90000 });
  for (const u of [r1.userId, auteur.userId]) { await as(u); await api.reagir(pub.id, 'rire'); await api.reagir(pub.id, 'courage'); }
  await as(r1.userId); await api.reagir(pub.id, 'paierais');
  m = await api.getProblemeDuMoment();
  eq(m.id, x.id, 'le plus de réactions sur 7 jours (le problème de riche ne compte pas) :');
  eq(m.rire + m.courage + m.paierais, 3);
  await admin.masquer('probleme', x.id, true);
  eq((await api.getProblemeDuMoment()).id, y.id, 'masqué :');
  await admin.masquer('probleme', x.id, false);
  eq((await api.getProblemeDuMoment()).id, x.id);
  advance(8 * DAY);
  eq((await api.getProblemeDuMoment()).id, y.id, 'réactions de plus de 7 jours :');
  await admin.bloquer(auteur.userId, true);
  const z = await api.getProblemeDuMoment();
  assert(z && z.id !== x.id && z.id !== y.id, 'auteur bloqué');
  assert(!(await api.getProblemesPublics({ limite: 48 })).some((p) => p.id === z.id && p.est_exemple), 'jamais un exemple');
  void riche;
});

test('L. Problème du moment', 'plus jamais le mot « Exemple » : ni badge sur les cartes, ni dans la carte du hero, ni dans les adresses de démo', async () => {
  const fs = await import('node:fs').catch(() => null);
  if (!fs) return;  // browser: source files are not readable here
  const lire = (f) => fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');
  for (const f of ['index.html', 'chiffres.html', 'assets/js/carte.js', 'assets/js/story.js', 'assets/js/auth.js', 'assets/js/api-demo.js', 'assets/js/pages/accueil.js']) {
    const s = lire(f).replace(/par exemple/gi, '');
    assert(!/[>'"`« ]Exemple\b|badge-exemple|exemple\.invalid|Exemple de problème/.test(s), `« Exemple » dans ${f}`);
  }
  const { api } = fresh();
  for (const p of await api.getProblemesPublics({ limite: 48 })) assert(!JSON.stringify(p).includes('Exemple'), p.titre);
  eq((await api.seReconnecter('membre1@demo.invalid')).statut, 'connecte');
});

function assertNoEmail(payload, where) {
  const json = JSON.stringify(payload);
  assert(!/@/.test(json) && !/"email"/.test(json), `${where} : contient une adresse e-mail`);
}

/* ---------------- M. Anti-robots (R-035) ---------------- */

test('M. Anti-robots', 'champ piège rempli ou formulaire envoyé en moins de 3 s → robot (rien n’est envoyé)', () => {
  eq(DELAI_MIN_MS, 3000);
  eq(estRobot('', 3000), false, 'humain à 3 s');
  eq(estRobot('', 45000), false, 'humain lent');
  eq(estRobot('  ', 5000), false, 'espaces seulement');
  eq(estRobot('http://spam.example', 60000), true, 'piège rempli');
  eq(estRobot('', 2999), true, 'trop rapide');
  eq(estRobot('', NaN), true, 'durée inconnue');
  eq(estRobot(null, 4000), false, 'piège absent');
});

test('M. Anti-robots', 'formulaires « Rejoindre » et « Publier » : champ piège site_web hors écran, hors tabulation, sans saisie automatique', async () => {
  const fs = await import('node:fs').catch(() => null);
  if (!fs) return;  // browser: source files are not readable here
  const { readFileSync } = fs;
  const lire = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const piege = lire('../piege.js');
  for (const attendu of ["name: 'site_web'", 'tabIndex: -1', "autocomplete: 'off'", "'aria-hidden', 'true'"]) assert(piege.includes(attendu), attendu);
  const auth = lire('../auth.js');
  const publier = lire('../publier.js');
  assert(/form\.append\(piege\.el/.test(auth) && /piege\.estRobot\(\)/.test(auth), 'Rejoindre');
  eq((publier.match(/piege\.estRobot\(\)/g) || []).length, 2, 'Publier (pauvre + riche)');
  const css = lire('../../css/style.css');
  assert(/\.piege \{[^}]*left: -10000px/.test(css) && !/\.piege \{[^}]*display: none/.test(css), 'hors écran, jamais display:none');
});

test('M. Anti-robots', 'migration 014 : plafonds par IP réglables, IP jamais stockée en clair, 6 fonctions d’écriture branchées', async () => {
  const fs = await import('node:fs').catch(() => null);
  if (!fs) return;  // browser: source files are not readable here
  const { readFileSync } = fs;
  const sql = readFileSync(new URL('../../../../supabase/migrations/014_anti_robots.sql', import.meta.url), 'utf8');
  assert(sql.includes('{"profil": 5, "publication": 30, "message": 60, "reaction": 300}'), 'plafonds');
  assert(sql.includes("'cf-connecting-ip'") && sql.includes("'x-forwarded-for'"), 'en-têtes');
  assert(/sha256\(convert_to\(v_ip \|\| coalesce\(v_sel/.test(sql), 'empreinte salée');
  assert(sql.includes("Doucement ! Trop d''actions depuis ta connexion, reviens dans une heure."), 'message');
  for (const f of ['creer_profil', 'soumettre_probleme', 'publier_riche', 'commenter', 'envoyer_message_club', 'reagir']) {
    assert(new RegExp(`function public\\.${f}\\(`).test(sql), f);
  }
});

/* ---------------- N. Thèmes du jour (R-036) ---------------- */

test('N. Thèmes du jour', 'un thème par jour, à l’heure de Paris (lundi « Mon patron » … dimanche « Mon défi »)', () => {
  // 2026-11-23 is a Monday
  const attendus = ['Mon patron', 'J\'ai des factures à payer', 'Ma vie amoureuse', 'Je veux aider ma famille', 'Je veux me faire plaisir', 'J\'ai un rêve', 'Mon défi'];
  const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  for (let i = 0; i < 7; i++) {
    const t = themeDuJour(new Date(Date.UTC(2026, 10, 23 + i, 11, 0)));
    eq(t.label, attendus[i], jours[i]);
    eq(t.jour, jours[i]);
    assert(CATEGORY_IDS.includes(t.categorie), t.categorie);
  }
  // Paris time, not UTC: Sunday 23:30 UTC is already Monday 00:30 in Paris (winter time)
  eq(themeDuJour(new Date('2026-11-22T23:30:00Z')).label, 'Mon patron', 'minuit à Paris');
  eq(themeDuJour(new Date('2026-11-22T22:30:00Z')).label, 'Mon défi', 'encore dimanche à Paris');
  // summer time (UTC+2): Monday 22:30 UTC is Tuesday in Paris
  eq(themeDuJour(new Date('2026-06-22T22:30:00Z')).label, 'J\'ai des factures à payer', 'heure d’été');
});

test('N. Thèmes du jour', 'texte de partage adapté : thème du jour et problème de la catégorie du jour', () => {
  const lundi = new Date('2026-11-23T10:00:00Z');
  const url = 'https://exemple.test/p.html?id=1';
  eq(texteProbleme('Mon boss me juge', url, 'patron', lundi), '« Mon boss me juge » — Thème du jour : Mon patron · Qui paie ? https://exemple.test/p.html?id=1');
  eq(texteProbleme('Mon frigo', url, 'quotidien', lundi), '« Mon frigo » — Qui paie ? https://exemple.test/p.html?id=1');
  eq(texteProbleme('Sans catégorie', url), '« Sans catégorie » — Qui paie ? https://exemple.test/p.html?id=1');
  const t = themeDuJour(lundi);
  assert(texteTheme(t, url).includes('« Mon patron »') && texteTheme(t, url).endsWith(url));
});

/* ---------------- O. Pouvoirs des riches (R-037) ---------------- */

async function problemeDePauvre(api, join, { titre = 'Mon frigo fait de l’écho', montant = 300 } = {}) {
  const auteur = await join('pauvre');
  const r = await api.soumettreProbleme({ categorie: 'quotidien', titre, texte: 'Un texte assez long pour être publié tout de suite.', montant });
  eq(r.statut, 'publie');
  return { id: r.id, auteur };
}

test('O. Pouvoirs des riches', 'couronner : pauvre et riche en attente refusés, 3 par jour, une par problème, notification à l’auteur', async () => {
  const { api, join, as, advance } = fresh();
  const pbs = [];
  for (let i = 0; i < 4; i++) pbs.push(await problemeDePauvre(api, join, { titre: `Mon problème couronnable ${i}` }));
  await rejects(api.couronner(pbs[0].id), 'interdit', 'pauvre');
  await join('riche', 'Riche Patient', { enAttente: true });
  await rejects(api.couronner(pbs[0].id), 'riche_en_attente', 'en attente');
  const riche = await join('riche', 'Caviar Couronneur');
  let r = await api.couronner(pbs[0].id);
  eq(r.couronnes, 1); eq(r.restantes, 2);
  r = await api.couronner(pbs[0].id);
  eq(r.couronnes, 1, 'une seule par riche'); eq(r.restantes, 2);
  await api.couronner(pbs[1].id);
  eq((await api.couronner(pbs[2].id)).restantes, 0);
  await rejects(api.couronner(pbs[3].id), 'limite', '4ᵉ');
  eq((await api.retirerCouronne(pbs[0].id)).couronnes, 0);
  await rejects(api.couronner(pbs[3].id), 'limite', 'retirer ne rend rien');
  const p = await api.getProblemePublic(pbs[1].id);
  eq(p.couronnes, 1); eq(p.couronne_par, 'Caviar Couronneur'); eq(p.ma_couronne, true);
  assertNoEmail(p, 'projection couronnée');
  // the next day (Paris), three new crowns
  advance(DAY);
  eq((await api.couronner(pbs[3].id)).restantes, 2);
  // notification of the author
  await as(pbs[1].auteur.userId);
  const n = await api.getMesNotifications();
  eq(n.non_lues, 1);
  assert(n.liste[0].texte.startsWith('Le riche Caviar Couronneur a couronné ton problème'), n.liste[0].texte);
  eq(n.liste[0].lien, `p.html?id=${pbs[1].id}`);
  assert(!('user_id' in n.liste[0]));
  eq(await api.marquerNotificationsLues(), 1);
  eq((await api.getMesNotifications()).non_lues, 0);
  // a crown of the poor who re-crowns the same problem does not notify twice
  await as(riche.userId);
  await api.retirerCouronne(pbs[1].id);
  await api.couronner(pbs[1].id);
  await as(pbs[1].auteur.userId);
  eq((await api.getMesNotifications()).liste.length, 1, 'pas de 2ᵉ notification');
  // a problem of the rich is never crowned
  await as(riche.userId);
  const post = await api.publierRiche({ type: 'riche', titre: 'Mon yacht est trop petit', texte: 'Un vrai problème de riche, avec du teck.', montant: 50000 });
  await rejects(api.couronner(post.id), 'introuvable', 'problème de riche');
});

test('O. Pouvoirs des riches', 'réactions « yacht » et « majordome » réservées aux riches actifs, compteurs visibles par tous', async () => {
  const { api, join } = fresh();
  const pb = await problemeDePauvre(api, join);
  await rejects(api.reagir(pb.id, 'yacht'), 'interdit', 'pauvre');
  await join('riche', 'Riche Patient', { enAttente: true });
  await rejects(api.reagir(pb.id, 'majordome'), 'riche_en_attente', 'en attente');
  await join('riche', 'Monocle Doré');
  const r = await api.reagir(pb.id, 'yacht');
  eq(r.actif, true); eq(r.yacht, 1); eq(r.majordome, 0);
  eq((await api.reagir(pb.id, 'majordome')).majordome, 1);
  await api.seDeconnecter();
  const p = await api.getProblemePublic(pb.id);
  eq(p.yacht, 1); eq(p.majordome, 1);
});

test('O. Pouvoirs des riches', 'le riche de la semaine (le plus de couronnes sur 7 jours, à défaut le plus récent) et le problème du moment couronné', async () => {
  const { api, join, advance } = fresh();
  await api.getCompteurs();  // seeds the demo now…
  advance(10 * DAY);  // …then the seeded reactions (up to 2 days after their problem) and crowns leave the 7-day window
  const pb = await problemeDePauvre(api, join, { titre: 'Personne ne me couronne' });
  const autres = [await problemeDePauvre(api, join, { titre: 'Deuxième couronnable' }), await problemeDePauvre(api, join, { titre: 'Troisième couronnable' })];
  await join('riche', 'Mécène Imaginaire');
  await api.publierRiche({ type: 'publication', texte: 'Je distribue des couronnes, pas des euros.' });
  await api.couronner(pb.id);
  for (const a of autres) await api.couronner(a.id);
  await join('riche', 'Riche Tout Neuf');
  const r = await api.getRicheDeLaSemaine();
  eq(r.pseudo, 'Mécène Imaginaire', 'le plus de couronnes (les riches de la démo en ont 2 au plus)'); eq(r.couronnes_7j, 3);
  eq(r.derniere.texte, 'Je distribue des couronnes, pas des euros.');
  assertNoEmail(r, 'riche de la semaine');
  const sansCouronne = await problemeDePauvre(api, join, { titre: 'Le plus récent, sans couronne' });
  const moment = (await api.getProblemeDuMoment()).id;
  assert(moment !== sansCouronne.id && [pb.id, ...autres.map((x) => x.id)].includes(moment), 'une couronne (= 10 réactions) passe devant le plus récent');
});

/* ---------------- P. Saisons du palmarès (R-038) ---------------- */

test('P. Saisons du palmarès', 'palmarès du mois (heure de Paris, remise à zéro le 1er) et palmarès général', async () => {
  const { api, join, as, advance, clock } = fresh();
  clock.now = Date.parse('2026-11-30T22:30:00Z');  // 30 November, 23:30 in Paris
  const vieux = await join('pauvre', 'Gros Découvert');
  await api.soumettreProbleme({ categorie: 'factures', titre: 'Mon découvert de novembre', texte: 'Un découvert qui date de novembre, encore là.', montant: 10000 });
  advance(HOUR);  // 1 December, 00:30 in Paris
  const neuf = await join('pauvre', 'Petit Nouveau');
  await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Mon premier problème de décembre', texte: 'Il fait froid et le radiateur boude.', montant: 1 });
  const mois = await api.getPalmares({ periode: 'mois' });
  eq(mois.periode, 'mois');
  eq(mois.lignes.length, 1, 'remise à zéro le 1er à minuit (Paris)');
  eq(mois.lignes[0].pseudo, 'Petit Nouveau');
  const general = await api.getPalmares({ periode: 'toujours' });
  const rang = (l, pseudo) => l.lignes.find((x) => x.pseudo === pseudo).rang;
  assert(rang(general, 'Gros Découvert') < rang(general, 'Petit Nouveau'), 'général');
  eq(JSON.stringify((await api.getPalmares()).lignes), JSON.stringify(general.lignes.map(({ code, badges, ...l }) => l)), 'ancienne signature = général (sans badges ni code)');
  await rejects(api.getPalmares({ periode: 'semaine' }), 'invalide');
  assertNoEmail(mois, 'palmarès du mois');
  await as(vieux.userId);
  const m = await api.getMonRang('mois');
  eq(m.rang, null); eq(m.total, 0); eq(m.periode, 'mois');
  eq((await api.getMonRang('toujours')).rang, rang(general, 'Gros Découvert'));
  await as(neuf.userId);
  eq((await api.getMonRang('mois')).rang, 1);
});

test('P. Saisons du palmarès', '« de novembre », « d’avril », « d’août », « d’octobre » (mois de Paris)', () => {
  eq(deMois(new Date('2026-11-15T12:00:00Z')), 'de novembre');
  eq(deMois(new Date('2026-04-15T12:00:00Z')), 'd’avril');
  eq(deMois(new Date('2026-08-15T12:00:00Z')), 'd’août');
  eq(deMois(new Date('2026-10-15T12:00:00Z')), 'd’octobre');
  eq(deMois(new Date('2026-11-30T23:30:00Z')), 'de décembre', 'heure de Paris');
});

/* ---------------- Q. Titres et badges (R-039) ---------------- */

test('Q. Titres et badges', 'badges calculés : podium du mois, roi du découvert, plafond, couronné, rabatteur, premier problème ; seulement pseudo + badges', async () => {
  const { api, join, as, advance } = fresh();
  await api.getCompteurs();
  advance(40 * DAY);  // a new month without the seeded problems
  const moi = await join('pauvre', 'Médaille en Chocolat');
  await api.soumettreProbleme({ categorie: 'factures', titre: 'Le plafond est atteint', texte: 'Un problème à dix Riens tout ronds.', montant: 10000 });
  for (let i = 0; i < 6; i++) await api.soumettreProbleme({ categorie: 'factures', titre: `Facture numéro ${i}`, texte: 'Encore une facture, toujours la même histoire.', montant: 1 });
  const s = await api.getSession();
  const code = s.profil.code_partage;
  for (let i = 0; i < 3; i++) await join('pauvre', `Invité ${i}`, { codeRef: code });
  await join('riche', 'Couronneur Fou');
  const pbs = await api.getProblemesPublics({ type: 'pauvre', limite: 7 });
  await api.couronner(pbs.find((p) => p.pseudo === 'Médaille en Chocolat').id);
  const b = await api.getBadges(code.toLowerCase());
  eq(JSON.stringify(Object.keys(b)), '["pseudo","badges"]');
  eq(b.pseudo, 'Médaille en Chocolat');
  eq(JSON.stringify(b.badges), '["or","roi_decouvert","plafond","couronne","rabatteur","premier"]');
  eq(await api.getBadges('PASUNCODE'), null);
  const p = await api.getPalmares({ periode: 'mois' });
  eq(p.lignes[0].code, code); assert(p.lignes[0].badges.includes('or'));
  assertNoEmail(p, 'palmarès avec badges');
  await as(moi.userId);
  eq(badgesConnus(['premier', 'inconnu', 'or']).map((x) => x.id).join(','), 'or,premier', 'ordre d’affichage, badges inconnus ignorés');
  eq(libelleBadges(['plafond']), '🔟 Plafond atteint');
});

/* ---------------- R. Profil public (R-040) ---------------- */

test('R. Profil public', 'CV d’un pauvre et d’un riche par code de partage, sans id ni e-mail ; pseudo des cartes relié au profil', async () => {
  const { api, join, as } = fresh();
  const pauvre = await join('pauvre', 'CV Impeccable');
  await api.soumettreProbleme({ categorie: 'reve', titre: 'Mon rêve de CV', texte: 'Un CV de pauvre, mais un CV quand même.', montant: 2500 });
  const codeP = (await api.getSession()).profil.code_partage;
  const riche = await join('riche', 'Monocle CV');
  const pb = (await api.getProblemesPublics({ type: 'pauvre', limite: 1 }))[0];
  eq(pb.code_auteur, codeP, 'code_auteur dans la projection');
  await api.couronner(pb.id);
  const codeR = (await api.getSession()).profil.code_partage;
  await api.seDeconnecter();
  const cv = await api.getProfilPublic(codeP.toLowerCase());
  eq(cv.pseudo, 'CV Impeccable'); eq(cv.camp, 'pauvre'); eq(cv.nb, 1); eq(cv.total, 2500);
  assert(cv.rang_mois.rang >= 1 && cv.rang_general.rang >= 1, 'rangs');
  eq(cv.problemes.length, 1); assert(cv.badges.includes('premier') && cv.badges.includes('couronne'), cv.badges.join());
  assert(/^\d{4}-\d{2}-\d{2}$/.test(cv.arrive_le), cv.arrive_le);
  assertNoEmail(cv, 'profil public'); assert(!('id' in cv) && !('user_id' in cv.problemes[0]));
  const cvR = await api.getProfilPublic(codeR);
  eq(cvR.camp, 'riche'); eq(cvR.statut_riche, 'actif'); eq(cvR.couronnes_donnees.length, 1); assert(!('rang_mois' in cvR));
  eq(await api.getProfilPublic('ZZZZZZZZ'), null); eq(await api.getProfilPublic('<script>'), null);
  await as(pauvre.userId); await api.supprimerMonCompte();
  eq(await api.getProfilPublic(codeP), null, 'membre parti');
  void riche;
});

/* ---------------- S. Suivre un profil (R-047) ---------------- */

test('S. Suivre un profil', 'suivre par code : visiteur refusé, soi-même refusé, double suivi sans effet, notification, fil « Mes suivis », plus suivis', async () => {
  const { api, join, as } = fresh();
  const star = await join('pauvre', 'Star du Découvert');
  const codeStar = (await api.getSession()).profil.code_partage;
  await api.seDeconnecter();
  await rejects(api.suivre(codeStar), 'non_connecte', 'visiteur');
  const fan = await join('pauvre', 'Fan Numéro Un');
  const codeFan = (await api.getSession()).profil.code_partage;
  await rejects(api.suivre(codeFan), 'invalide', 'soi-même');
  await rejects(api.suivre('ZZZZZZZZ'), 'introuvable');
  eq((await api.suivre(codeStar.toLowerCase())).abonnes, 1);
  eq((await api.suivre(codeStar)).abonnes, 1, 'double suivi sans effet');
  const cv = await api.getProfilPublic(codeStar);
  eq(cv.abonnes, 1); eq(cv.je_suis, true);
  await as(star.userId);
  const r = await api.soumettreProbleme({ categorie: 'amour', titre: 'Mon ex garde le chat', texte: 'Et le canapé. Et le chat dort sur le canapé.', montant: 300 });
  await as(fan.userId);
  const n = await api.getMesNotifications();
  assert(n.liste.some((x) => x.type === 'suivi' && x.texte === 'Star du Découvert a publié : « Mon ex garde le chat »' && x.lien === `p.html?id=${r.id}`), JSON.stringify(n.liste[0]));
  const fil = await api.getFilSuivis({ limite: 12 });
  eq(fil.length, 1); eq(fil[0].id, r.id);
  const suivis = await api.getMesSuivis();
  eq(suivis.length, 1); eq(suivis[0].pseudo, 'Star du Découvert'); eq(suivis[0].dernier.id, r.id); assert(Array.isArray(suivis[0].badges));
  assertNoEmail(suivis, 'mes suivis'); assertNoEmail(fil, 'fil suivis');
  const top = await api.getPlusSuivis();
  assert(top.pauvres.some((x) => x.pseudo === 'Star du Découvert' && x.abonnes === 1), 'plus suivis');
  assert(top.pauvres.length <= 10 && top.riches.length <= 5);
  assertNoEmail(top, 'plus suivis');
  eq((await api.nePlusSuivre(codeStar)).abonnes, 0);
  eq((await api.getFilSuivis()).length, 0);
});

/* ---------------- T. Le duel (R-041) ---------------- */

test('T. Le duel', 'un visiteur joue : deux problèmes de pauvres différents, vote, « les plus drôles de la semaine », problème du moment', async () => {
  const { api, join, advance } = fresh();
  await api.getCompteurs();
  advance(10 * DAY);  // seeded reactions and crowns out of the 7-day window
  await join('pauvre', 'Champion du Rire');
  const a = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Mon chat commande des croquettes', texte: 'Il a trouvé ma carte. Il a bon goût.', montant: 50 });
  const b = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Mon chat se tait', texte: 'Et c’est tout. Vraiment tout.', montant: 40 });
  await api.seDeconnecter();
  const d = await api.getDuel();
  eq(d.length, 2); assert(d[0].id !== d[1].id); assert(d.every((p) => p.type === 'pauvre'));
  const d2 = await api.getDuel([d[0].id, d[1].id]);
  assert(!d2.some((p) => p.id === d[0].id || p.id === d[1].id), 'évite les problèmes vus');
  for (let i = 0; i < 3; i++) await api.voterDuel(a.id, b.id);
  eq((await api.voterDuel(a.id, b.id)).victoires_7j, 4);
  await rejects(api.voterDuel(a.id, a.id), 'invalide');
  const top = await api.getPlusDrolesSemaine(5);
  eq(top[0].carte.id, a.id); eq(top[0].victoires, 4);
  assertNoEmail(top, 'plus drôles');
  eq((await api.getProblemeDuMoment()).id, a.id, '2 points par victoire');
});

/* ---------------- U. Aperçus de partage (R-042) ---------------- */

test('U. Aperçus de partage', 'URL_PARTAGE renseignée → lien de la fonction Edge ; vide ou invalide → p.html?id=… (comportement d’avant)', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  eq(urlProbleme(id, null, { urlPartage: '' }), siteUrl(`p.html?id=${id}`));
  eq(urlProbleme(id, 'ABCDEFGH', { urlPartage: '' }), siteUrl(`p.html?id=${id}&ref=ABCDEFGH`));
  eq(urlProbleme(id, 'ABCDEFGH', { urlPartage: 'https://projet.supabase.co/functions/v1/partage' }), `https://projet.supabase.co/functions/v1/partage?id=${id}&ref=ABCDEFGH`);
  eq(urlProbleme(id, null, { urlPartage: 'javascript:alert(1)' }), siteUrl(`p.html?id=${id}`), 'jamais autre chose que https');
  eq(CONFIG.URL_PARTAGE, '', 'vide par défaut');
});

test('U. Aperçus de partage', 'fonction Edge « partage » : og:title = titre, og:description en Riens, image de la catégorie, tout échappé', async () => {
  if (typeof process === 'undefined') return;  // browser: the Edge Function is not served
  const m = await import('../../../../supabase/functions/partage/index.ts').catch(() => null);
  if (!m) return;
  const site = 'https://exemple.test/whopays/';
  const html = m.pageApercu({ id: 'x', type: 'pauvre', categorie: 'patron', titre: 'Mon patron <script>alert(1)</script> & moi', montant: 5000 }, { site, cible: `${site}p.html?id=x` });
  assert(html.includes('<meta property="og:title" content="Mon patron &lt;script&gt;alert(1)&lt;/script&gt; &amp; moi">'), 'titre échappé');
  assert(html.includes('content="5x Rien recherchés — soit 5 000 € · Qui paie ?"'), 'description');
  assert(html.includes(`content="${site}assets/img/partage/patron.png"`), 'image de la catégorie');
  assert(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert(!/<script/i.test(html), 'aucun script');
  const pub = m.pageApercu({ id: 'y', type: 'publication', categorie: null, titre: null, texte: 'Une publication de riche', montant: null }, { site, cible: site });
  assert(pub.includes(`${site}assets/img/og-image.png`) && pub.includes('og:title" content="Une publication de riche"'), 'publication');
});

test('U. Aperçus de partage', 'les 10 images de partage existent (une par catégorie)', async () => {
  const fs = await import('node:fs').catch(() => null);
  if (!fs) return;
  for (const c of CATEGORY_IDS) {
    const b = fs.readFileSync(new URL(`../../img/partage/${c}.png`, import.meta.url));
    eq(b.readUInt32BE(16), 1200, `${c} largeur`); eq(b.readUInt32BE(20), 630, `${c} hauteur`);
  }
});

/* ---------------- V. La Gazette des pauvres (R-043) ---------------- */

test('V. La Gazette des pauvres', 'aperçu réservé aux modérateurs ; envoi de démo sans e-mail, jamais deux fois, budget partagé avec les annonces', async () => {
  const { api, join, admin } = fresh();
  const membre = await join('pauvre', 'Lecteur Assidu', { newsletter: true });
  await rejects(api.moderation.gazetteApercu(), 'interdit', 'non modérateur');
  await admin.setModerateur(membre.userId);
  const g = await api.moderation.gazetteApercu();
  eq(g.figee, false); eq(g.contenu.themes.length, 7); eq(g.contenu.themes[0].theme, 'Mon patron');
  assert(g.contenu.top.length >= 1 && g.contenu.top.length <= 5, 'top 5');
  assert(g.destinataires >= 1, 'destinataires'); eq(g.restant_24h, 250);
  assertNoEmail(g.contenu, 'contenu de la gazette');
  const r = await api.moderation.envoyerGazette();
  eq(r.demo, true); eq(r.envoyes, g.destinataires); eq(r.echecs, 0);
  eq((await api.moderation.envoyerGazette()).envoyes, 0, 'jamais deux fois');
  const g2 = await api.moderation.gazetteApercu();
  eq(g2.figee, true); eq(g2.envoyes, g.destinataires); eq(g2.restant_24h, 250 - g.destinataires, 'budget partagé sur 24 h');
});

test('V. La Gazette des pauvres', 'fonction Edge « gazette » : e-mail échappé, lien de désinscription personnel, montants en Riens', async () => {
  if (typeof process === 'undefined') return;
  const m = await import('../../../../supabase/functions/gazette/index.ts').catch(() => null);
  if (!m) return;
  const c = {
    top: [{ titre: 'Mon <b>patron</b> & moi', montant: 4500, pseudo: 'Gégé <script>', lien: 'p.html?id=1' }],
    pauvre_du_mois: { pseudo: 'Jojo', total: 9500, lien: 'profil.html?c=ABCDEFGH' },
    nouveaux_riches: [{ pseudo: 'Caviar', lien: 'p.html?id=2' }],
    themes: [{ jour: 'lundi', theme: 'Mon patron' }]
  };
  const e = m.contenuGazette(c, { destinataire: 'Lili', jeton: 'abc-123', siteUrl: 'https://exemple.test/whopays/' });
  assert(e.html.includes('Mon &lt;b&gt;patron&lt;/b&gt; &amp; moi') && !e.html.includes('<script>'), 'échappé');
  assert(e.html.includes('4,5x Rien') && e.html.includes('9,5x Rien'), 'Riens');
  eq(e.urlDesinscription, 'https://exemple.test/whopays/desinscription.html?jeton=abc-123');
  assert(e.texte.includes('Ne plus recevoir ces e-mails : https://exemple.test/whopays/desinscription.html?jeton=abc-123'));
  assert(e.texte.includes('aucun argent ne circule'), 'rappel humoristique');
});

export async function runContractTests({ onResult = () => {}, filter = null } = {}) {
  const results = [];
  for (const t of tests) {
    if (filter && !`${t.group} ${t.name}`.includes(filter)) continue;
    const r = { group: t.group, name: t.name, ok: true, error: null };
    try {
      await t.fn();
    } catch (e) {
      r.ok = false;
      r.error = e && e.message ? e.message : String(e);
    }
    results.push(r);
    onResult(r);
  }
  return results;
}

/**
 * Supabase mode (browser): read-only checks against the real public functions.
 * `api` is the object exported by api.js.
 */
export async function runPublicChecks(api, { onResult = () => {} } = {}) {
  const checks = [
    ['get_compteurs répond avec des entiers', async () => {
      const c = await api.getCompteurs();
      for (const k of ['problemes', 'membres', 'riches', 'pauvres', 'milliardaires_verifies']) assert(Number.isInteger(c[k]), k);
      assertNoPrivateData(c, 'get_compteurs');
    }],
    ['get_chiffres : 0 € financé', async () => { const c = await api.getChiffres(); eq(c.finance, 0); assertNoPrivateData(c, 'get_chiffres'); }],
    ['get_problemes_publics : limite 48, aucune donnée privée', async () => {
      const l = await api.getProblemesPublics({ limite: 500 });
      assert(l.length <= 48);
      assertNoPrivateData(l, 'get_problemes_publics');
    }],
    ['get_probleme_public : id inconnu → null', async () => eq(await api.getProblemePublic('00000000-0000-4000-8000-000000000000'), null)],
    ['get_commentaires : aucune donnée privée', async () => {
      const l = await api.getProblemesPublics({ limite: 5 });
      for (const p of l) assertNoPrivateData(await api.getCommentaires(p.id), 'get_commentaires');
    }],
    ['get_probleme_du_moment : problème de pauvre ou null, aucune donnée privée', async () => {
      const p = await api.getProblemeDuMoment();
      if (p !== null) { eq(p.type, 'pauvre'); assertNoPrivateData(p, 'get_probleme_du_moment'); }
    }],
    ['catégorie invalide refusée', async () => rejects(api.getProblemesPublics({ categorie: '<script>' }), 'invalide')]
  ];
  const results = [];
  for (const [name, fn] of checks) {
    const r = { group: 'Supabase (lecture publique)', name, ok: true, error: null };
    try { await fn(); } catch (e) { r.ok = false; r.error = e.message; }
    results.push(r);
    onResult(r);
  }
  return results;
}
