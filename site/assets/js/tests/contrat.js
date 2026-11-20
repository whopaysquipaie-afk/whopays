// API contract test suite — no DOM. Runs in Node (tools/test.mjs) and in the browser (tests.html).
// Demo mode: the full suite, each test on a fresh in-memory backend with a controlled clock.
// Supabase mode (browser only): read-only checks on the public functions (see runPublicChecks).
// Mirrors the SQL security tests of supabase/tests/verif_securite.sql (brief dev §5.7) + parcours B to I.

import { createDemoApi } from '../api-demo.js';
import { raisonFiltre, MESSAGE_FILTRE } from '../filtres.js';
import { isSafeUrl, checkAttribute } from '../dom-safe.js';
import { EXEMPLES, PROBLEMES, COMMENTAIRES, CLUB_RICHES, CLUB_PAUVRES, MEMBRES } from '../demo-data.js';
import { CATEGORY_IDS } from '../categories.js';

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
  const join = async (camp = 'pauvre', pseudo = null, extra = {}) => {
    n++;
    const r = await api.rejoindre({ camp, pseudo: pseudo || `Testeur ${camp} ${n}`, email: `test${n}.${camp}@exemple.test`, majeur: true, regles: true, ...extra });
    const s = await api.getSession();
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
    ...CLUB_RICHES.map((m) => m[1]), ...CLUB_PAUVRES.map((m) => m[1]), ...MEMBRES.map((m) => m[0]), ...MEMBRES.map((m) => m[2]).filter(Boolean)
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
  const r = await api.rejoindre({ camp: 'pauvre', pseudo: 'Doublon', email: 'MEMBRE1@exemple.invalid', majeur: true, regles: true });
  eq(r.statut, 'deja_membre');
  eq((await api.getCompteurs()).membres, avant.membres);
  eq((await api.getSession()).connecte, false);
  eq(admin.etatBrut().profiles.filter((p) => p.email === 'membre1@exemple.invalid').length, 1);
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
  eq((await api.seReconnecter('membre3@exemple.invalid')).statut, 'connecte');
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

/* ================= D. Publish ================= */

test('D. Publier', 'un problème soumis reste en relecture et invisible', async () => {
  const { api, join } = fresh();
  await join('pauvre');
  const r = await api.soumettreProbleme({ categorie: 'quotidien', titre: 'Mon grille-pain me juge', texte: 'Il brûle tout, sauf mes factures.', montant: 40 });
  eq(r.statut, 'recu');
  eq(await api.getProblemePublic(r.id), null);
  const e = await api.getMonEspace();
  eq(e.problemes[0].statut, 'recu');
});
test('D. Publier', 'un membre ne peut pas publier lui-même (seule la modération publie)', async () => {
  const { api, join, admin } = fresh();
  await join('pauvre');
  const r = await api.soumettreProbleme({ categorie: 'reve', titre: 'Voir la mer', texte: 'Une fois, en vrai, pas en photo.', montant: null });
  assert(!('statut' in await api.majProfil({ pseudo: 'Tricheur' })), 'maj_profil ne touche pas aux problèmes');
  eq(await api.getProblemePublic(r.id), null);
  await admin.publier(r.id);
  eq((await api.getProblemePublic(r.id)).titre, 'Voir la mer');
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
test('D. Publier', 'limite : 3 problèmes par 24 h', async () => {
  const { api, join, advance } = fresh();
  await join('pauvre');
  const p = (i) => api.soumettreProbleme({ categorie: 'defi', titre: `Défi numéro ${i}`, texte: 'Un texte de plus de dix caractères.' });
  await p(1); await p(2); await p(3);
  await rejects(p(4), 'limite');
  advance(DAY + 1000);
  eq((await p(5)).statut, 'recu');
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
  const pb = await api.soumettreProbleme({ categorie: 'amour', titre: 'Mon crush a un yacht', texte: 'Et moi une trottinette. Ça coince.' });
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
  await join('pauvre');
  await api.majProfil({ camp: 'riche' });
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
  await api.soumettreProbleme({ categorie: 'reve', titre: 'Partir loin', texte: 'Très loin, sans laisser d’adresse.' });
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
