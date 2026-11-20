#!/usr/bin/env node
// End-to-end test against the REAL Supabase project configured in site/assets/js/config.js.
// Drives the real data layer (site/assets/js/api-supabase.js + the vendored supabase-js) from Node:
// join (rich and poor), publish, react, comment, report, club (with camp isolation), my space,
// switch camp, delete the account, moderation refused to non-moderators (006). Every test account is named "test-…" and is deleted at the end
// with "Supprimer mon compte" (also on failure). Nothing is left in the database.
//
// Usage: node tools/e2e-supabase.mjs
// Needs network access. Uses only the public (publishable) key, like the site.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS = join(ROOT, 'site/assets/js');

// Browser-like globals, without `document` (supabase-js then skips URL session detection)
// and without localStorage (supabase-js then keeps the session in memory).
globalThis.window = globalThis;
vm.runInThisContext(readFileSync(join(ROOT, 'site/assets/vendor/supabase.js'), 'utf8'), { filename: 'supabase.js' });
if (!globalThis.supabase || !globalThis.supabase.createClient) {
  console.error('ÉCHEC  supabase-js introuvable (site/assets/vendor/supabase.js).');
  process.exit(1);
}

const { CONFIG } = await import(pathToFileURL(join(JS, 'config.js')).href);
const { createSupabaseApi } = await import(pathToFileURL(join(JS, 'api-supabase.js')).href);
const { createModerationApi } = await import(pathToFileURL(join(JS, 'moderation.js')).href);
const { getClient } = await import(pathToFileURL(join(JS, 'supabase.js')).href);

const api = createSupabaseApi();
const mod = await createModerationApi();
const results = [];
const suffixe = Date.now().toString(36).slice(-5);

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion'); }

async function step(name, fn) {
  const r = { name, ok: true, error: null };
  try { r.value = await fn(); } catch (e) { r.ok = false; r.error = `${e.message}${e.code ? ` [${e.code}]` : ''}`; }
  results.push(r);
  console.log(`${r.ok ? 'OK    ' : 'ÉCHEC '} ${name}${r.ok ? '' : `\n         → ${r.error}`}`);
  return r;
}

async function rejects(promise, code) {
  try { await promise; } catch (e) {
    if (code && e.code !== code) throw new Error(`erreur « ${e.code} » au lieu de « ${code} » (${e.message})`);
    return e;
  }
  throw new Error(`aurait dû échouer (${code})`);
}

/** Deletes the current account if a session with a profile (or an anonymous user) is open. */
async function nettoyer() {
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  if (!data.session) return 'rien à nettoyer';
  try { await api.supprimerMonCompte(); return 'compte supprimé'; } catch (e) {
    try { await sb.rpc('supprimer_utilisateur_anonyme'); } catch { /* ignore */ }
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    return `nettoyage partiel : ${e.message}`;
  }
}

console.log(`Test de bout en bout contre ${CONFIG.SUPABASE_URL} (Turnstile : ${CONFIG.TURNSTILE_SITE_KEY ? 'activé' : 'non configuré'})\n`);

const started = Date.now();
let exemple = null;

// Same read-only checks as tests.html in Supabase mode
const { runPublicChecks } = await import(pathToFileURL(join(JS, 'tests/contrat.js')).href);
for (const r of await runPublicChecks(api)) {
  results.push(r);
  console.log(`${r.ok ? 'OK    ' : 'ÉCHEC '} tests.html › ${r.name}${r.ok ? '' : `\n         → ${r.error}`}`);
}

await step('Lecture publique : compteurs, chiffres, mur', async () => {
  const c = await api.getCompteurs();
  assert(Number.isInteger(c.membres), 'compteurs');
  const ch = await api.getChiffres();
  assert(ch.finance === 0, '0 € financé');
  const mur = await api.getProblemesPublics({ limite: 12 });
  assert(mur.length > 0, 'mur vide : les exemples sont-ils chargés ?');
  exemple = mur[0];
  const p = await api.getProblemePublic(exemple.id);
  assert(p && p.id === exemple.id, 'get_probleme_public');
  assert(await api.getProblemeHasard(), 'get_probleme_hasard');
  return `${mur.length} problèmes publics`;
});

await step('Visiteur : réagir est refusé (non connecté)', () => rejects(api.reagir(exemple.id, 'rire')));

// 006 (R-018): the moderation functions are closed to visitors and to members who are not moderators.
await step('Visiteur : modération refusée (mod_suis_je = false, mod_a_relire interdit)', async () => {
  assert(await mod.suisJe() === false, 'mod_suis_je devrait renvoyer false');
  await rejects(mod.aRelire(), 'interdit');
});

for (const camp of ['riche', 'pauvre']) {
  const autre = camp === 'riche' ? 'pauvre' : 'riche';
  const pseudo = `test-${camp}-${suffixe}`;
  const email = `test-${camp}-${suffixe}@exemple.invalid`;
  let monProbleme = null;
  let monCommentaire = null;
  let monMessage = null;
  try {
    const join = await step(`[${camp}] Rejoindre (connexion anonyme sans Turnstile, e-mail non bloquant)`, async () => {
      const r = await api.rejoindre({ camp, pseudo, email, newsletter: false, majeur: true, regles: true });
      assert(r.statut === 'cree', `statut ${r.statut}`);
      const s = await api.getSession();
      assert(s.connecte && s.profil && s.profil.camp === camp && s.profil.pseudo === pseudo, 'session/profil');
      return r;
    });
    if (!join.ok) continue;

    // 005 (R-017): a clean problem is published at once; a sensitive one waits for review.
    // The published test problem is visible on the real wall for a few seconds only (deleted with the account).
    await step(`[${camp}] Publier un problème : publication immédiate (statut « publié », visible)`, async () => {
      const r = await api.soumettreProbleme({ categorie: 'quotidien', titre: `Test automatique ${suffixe}`, texte: 'Problème de test créé par tools/e2e-supabase.mjs, supprimé à la fin du test.' });
      monProbleme = r && r.id;
      assert(r && r.statut === 'publie', `statut renvoyé « ${r && r.statut} » au lieu de « publie » (005 appliquée ?)`);
      const e = await api.getMonEspace();
      const p = e.problemes.find((x) => x.id === r.id);
      assert(p && p.statut === 'publie', 'problème absent de Mon espace ou non publié');
      const pub = await api.getProblemePublic(r.id);
      assert(pub && pub.titre === `Test automatique ${suffixe}` && pub.est_mon_probleme === true, 'le problème publié doit être public');
    });

    await step(`[${camp}] Publier un problème avec un mot sensible (statut « reçu », invisible)`, async () => {
      const r = await api.soumettreProbleme({ categorie: 'famille', titre: `Test sensible ${suffixe}`, texte: 'Ma mère commence sa chimio lundi. Problème de test, supprimé à la fin.' });
      assert(r && r.statut === 'recu', `statut renvoyé « ${r && r.statut} » au lieu de « recu »`);
      assert(await api.getProblemePublic(r.id) === null, 'un problème non publié ne doit pas être public');
    });

    await step(`[${camp}] Membre non modérateur : chaque fonction de modération est refusée`, async () => {
      assert(await mod.suisJe() === false, 'mod_suis_je devrait renvoyer false (006 appliquée ?)');
      await rejects(mod.aRelire(), 'interdit');
      await rejects(mod.recents(48), 'interdit');
      await rejects(mod.masques(), 'interdit');
      await rejects(mod.signalements24h(), 'interdit');
      await rejects(mod.modererProbleme(exemple.id, 'refuse'), 'interdit');
      await rejects(mod.masquer('probleme', exemple.id, true), 'interdit');
      const s = await api.getSession();
      await rejects(mod.bloquer(s.userId, true), 'interdit');
      const p = await api.getProblemePublic(exemple.id);
      assert(p && p.id === exemple.id, 'l’exemple doit rester publié et visible');
    });

    await step(`[${camp}] Filtre : un numéro de téléphone est refusé`, () =>
      rejects(api.commenter(exemple.id, 'Appelle-moi au 06 12 34 56 78')));

    await step(`[${camp}] Réagir (ajout puis retrait)`, async () => {
      const r1 = await api.reagir(exemple.id, 'rire');
      const mes = await api.getMesReactions([exemple.id]);
      assert(mes.some((x) => x.problem_id === exemple.id && x.type === 'rire'), `réaction absente (${JSON.stringify(r1)})`);
      await api.reagir(exemple.id, 'rire');
      const mes2 = await api.getMesReactions([exemple.id]);
      assert(!mes2.some((x) => x.problem_id === exemple.id && x.type === 'rire'), 'réaction non retirée');
      await api.reagir(exemple.id, 'courage');
    });

    await step(`[${camp}] Commenter, lire, supprimer son commentaire`, async () => {
      const texte = `Commentaire de test ${suffixe} (${camp})`;
      await api.commenter(exemple.id, texte);
      const l = await api.getCommentaires(exemple.id);
      const c = l.find((x) => x.texte === texte);
      assert(c, 'commentaire absent');
      assert(!('email' in c) && !('user_id' in c), 'donnée privée exposée');
      monCommentaire = c.id;
      await api.supprimerMonCommentaire(c.id);
      const l2 = await api.getCommentaires(exemple.id);
      assert(!l2.some((x) => x.id === c.id && !x.masque), 'commentaire non supprimé');
      await api.commenter(exemple.id, `${texte} — gardé jusqu'à la suppression du compte`);
    });

    await step(`[${camp}] Signaler un problème (et pas deux fois)`, async () => {
      await api.signaler('probleme', exemple.id);
      await rejects(api.signaler('probleme', exemple.id), 'deja_fait');
    });

    await step(`[${camp}] Club : envoyer et lire`, async () => {
      const texte = `Message de test ${suffixe} (${camp})`;
      await api.envoyerMessageClub(texte);
      const msgs = await api.getClubMessages();
      const m = msgs.find((x) => x.texte === texte);
      assert(m, 'message absent');
      assert(msgs.every((x) => !('email' in x)), 'donnée privée exposée');
      monMessage = m.id;
    });

    await step(`[${camp}] Mon espace`, async () => {
      const e = await api.getMonEspace();
      assert(e.pseudo === pseudo && e.camp === camp && e.email === email, 'données de Mon espace');
      assert(e.email_confirme === false, 'e-mail non confirmé attendu');
      assert(/^[A-Z0-9]{8}$/.test(e.code_partage), 'code de partage');
    });

    if (camp === 'riche') {
      await step(`[${camp}] Bloc riche « Ce que je serais prêt à financer »`, async () => {
        const r = await api.majProfil({ riche_message: 'Un an de croquettes pour le chien à lunettes.', riche_montant: 500 });
        assert(r.riche_montant === 500, 'montant');
        const r2 = await api.majProfil({ riche_message: null, riche_montant: null });
        assert(r2.riche_message === null && r2.riche_montant === null, 'effacement');
      });
    }

    await step(`[${camp}] Changer de camp → ${autre} (cloisonnement du club)`, async () => {
      await api.majProfil({ camp: autre });
      api.rafraichirSession?.();
      const e = await api.getMonEspace();
      assert(e.camp === autre, 'camp non changé');
      const msgs = await api.getClubMessages();
      assert(!msgs.some((x) => x.id === monMessage), 'message de l\'autre club visible');
      await api.majProfil({ camp });
    });

    await step(`[${camp}] Signaler son propre message de club est sans effet de bord`, async () => {
      // Not asserted strictly: the server may refuse or accept; it must not throw a server error.
      try { await api.signaler('message', monMessage); } catch (e) { assert(e.code !== 'serveur', e.message); }
    });
  } finally {
    await step(`[${camp}] Supprimer mon compte (nettoyage)`, async () => {
      const r = await nettoyer();
      assert(r === 'compte supprimé', r);
      const s = await api.getSession();
      assert(!s.connecte, 'session encore ouverte');
      if (monProbleme) assert(await api.getProblemePublic(monProbleme) === null, 'problème encore présent');
      const l = await api.getCommentaires(exemple.id);
      assert(!l.some((x) => String(x.texte || '').includes(suffixe)), 'commentaire de test encore présent');
      void monCommentaire;
    });
  }
}

await step('Reconnexion : e-mail inconnu → message clair (aucun compte créé)', async () => {
  try {
    await api.seReconnecter(`test-inconnu-${suffixe}@exemple.invalid`);
    return 'lien demandé (Supabase ne révèle pas si le compte existe)';
  } catch (e) {
    assert(['aucun_compte', 'limite', 'auth'].includes(e.code), `${e.code} : ${e.message}`);
    return e.code;
  }
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} étapes OK en ${Date.now() - started} ms.`);
process.exit(failed ? 1 : 0);
