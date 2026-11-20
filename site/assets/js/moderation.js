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
      bloquer: (userId, bloque = true) => rpc('mod_bloquer', { p_user_id: userId, p_bloque: bloque !== false })
    };
  }
  const { createDemoApi } = await import('./api-demo.js');
  const demo = createDemoApi();
  return { mode: 'demo', demoAdmin: demo.demoAdmin, ...demo.moderation };
}
