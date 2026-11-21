// Data layer of the private moderation page (moderation.html). Loaded by that page only.
// Supabase mode: the mod_* RPC functions of supabase/migrations/006_moderateurs.sql (moderators only,
// checked server-side). Demo mode: api-demo.js › moderation (same rules, same shapes).

import { CONFIG } from './config.js';

export async function createModerationApi() {
  if (CONFIG.MODE === 'supabase') {
    const { rpc } = await import('./api-supabase.js');
    const liste = (d) => d || [];
    return {
      mode: 'supabase',
      demoAdmin: null,
      // anon has no EXECUTE on mod_suis_je: a visitor without session is simply not a moderator
      suisJe: () => rpc('mod_suis_je').then((v) => v === true).catch((e) => {
        if (e.code === 'interdit') return false;
        throw e;
      }),
      aRelire: () => rpc('mod_a_relire').then(liste),
      recents: (heures = 48) => rpc('mod_recents', { p_heures: heures }).then(liste),
      masques: () => rpc('mod_masques').then(liste),
      signalements24h: () => rpc('mod_signalements_24h').then(liste),
      modererProbleme: (id, statut) => rpc('mod_moderer_probleme', { p_id: id, p_statut: statut }),
      masquer: (type, id, masque = true) => rpc('mod_masquer', { p_type: type, p_id: id, p_masque: masque !== false }),
      bloquer: (userId, bloque = true) => rpc('mod_bloquer', { p_user_id: userId, p_bloque: bloque !== false }),
      // R-029: paying rich members (010_riches_payants.sql)
      riches: () => rpc('mod_riches').then(liste),
      activerRiche: (userId, formule) => rpc('mod_activer_riche', { p_user_id: userId, p_formule: formule }),
      desactiverRiche: (userId) => rpc('mod_desactiver_riche', { p_user_id: userId }),
      refuserRiche: (userId) => rpc('mod_refuser_riche', { p_user_id: userId }),
      // R-031: announcements + e-mail to the poor through the Edge Function « annoncer-riche »
      annonces: () => rpc('mod_annonces').then(liste),
      annoncerParEmail: (annonceId) => fonctionEdge('annoncer-riche', { annonce_id: annonceId }),
      // R-043: « La Gazette des pauvres » (021 + Edge Function « gazette »)
      gazetteApercu: () => rpc('mod_gazette_apercu'),
      envoyerGazette: () => fonctionEdge('gazette', {})
    };
  }
  const { createDemoApi } = await import('./api-demo.js');
  const demo = createDemoApi();
  return { mode: 'demo', demoAdmin: demo.demoAdmin, ...demo.moderation };
}

/** POST to an Edge Function with the moderator's session. */
async function fonctionEdge(nom, corpsRequete) {
  const { getClient } = await import('./supabase.js');
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  const jeton = data && data.session ? data.session.access_token : null;
  if (!jeton) throw Object.assign(new Error('Ta session a expiré. Recharge la page.'), { code: 'non_connecte' });
  let r;
  try {
    r = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${nom}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, apikey: CONFIG.SUPABASE_PUBLIC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpsRequete)
    });
  } catch {
    throw Object.assign(new Error(`Envoi impossible : la fonction « ${nom} » est-elle déployée ?`), { code: 'reseau' });
  }
  const corps = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(corps.erreur || `Envoi impossible (HTTP ${r.status}). La fonction « ${nom} » est-elle déployée ?`), { code: 'serveur' });
  return corps;
}
