// Supabase Edge Function « gazette » (R-043) — « La Gazette des pauvres », weekly e-mail.
// NOT deployed nor scheduled automatically: see docs/CONFIGURATION.md (§4.4). Sending is enabled later by Hassen.
//
//   POST /functions/v1/gazette
//   - from the moderation page: Authorization: Bearer <moderator access token> (button « Envoyer la gazette »)
//   - from the weekly pg_cron job (documented, NOT enabled): header x-gazette-secret: <GAZETTE_SECRET>
// 1. Checks the caller (moderator through mod_suis_je, or the shared secret of the cron job).
// 2. Reserves recipients with the service role (srv_gazette_reserver, 021): members of both camps who ticked
//    the box (same consent as the announcements of 012), e-mail confirmed, not blocked, never twice the same
//    issue, within the budget of 250 e-mails per rolling 24 h SHARED with the announcements.
// 3. Sends one e-mail per recipient through the Brevo API, each with its own unsubscribe link; failures are
//    released (srv_gazette_annuler) to be retried by the next call.
//
// Secrets / environment (never in the repository):
//   BREVO_API_KEY, SENDER_EMAIL, SITE_URL (same as « annoncer-riche »)
//   GAZETTE_SECRET (optional, only for the pg_cron job: a long random string)
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: provided by Supabase.
// No dependency; plain JavaScript inside a .ts file so that `node --check` validates it (tools/verif.mjs).

const LOT = 50;
const TOURS_MAX = 5;
const BREVO = 'https://api.brevo.com/v3/smtp/email';

const env = (k) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variable d'environnement manquante : ${k}`);
  return v;
};

const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** « 4x Rien » / « 3,5x rien » (same rule as site/assets/js/riens.js). */
function enRiens(montant) {
  const m = Number(montant);
  if (!Number.isFinite(m) || m <= 0) return '';
  const grand = m >= 1000;
  const v = Math.round((m / (grand ? 1000 : 100)) * 100) / 100;
  return `${String(v).replace('.', ',')}x ${grand ? 'Rien' : 'rien'}`;
}

/** The e-mail of one recipient: { sujet, texte, html, urlDesinscription }. Pure (unit-tested in Node). */
export function contenuGazette(c, { destinataire, jeton, siteUrl }) {
  const lien = (l) => siteUrl + String(l || '');
  const urlDesinscription = `${siteUrl}desinscription.html?jeton=${encodeURIComponent(jeton)}`;
  const sujet = '🗞️ La Gazette des pauvres — les problèmes de la semaine';
  const top = (c.top || []).slice(0, 5);
  const riches = c.nouveaux_riches || [];
  const themes = c.themes || [];
  const texte = [
    `Bonjour ${destinataire},`, '', 'LA GAZETTE DES PAUVRES', '',
    'Le top 5 de la semaine :',
    ...top.map((p, i) => `${i + 1}. ${p.titre} (${enRiens(p.montant) || 'sans montant'}, par ${p.pseudo}) — ${lien(p.lien)}`),
    '', c.pauvre_du_mois ? `Le pauvre du mois : ${c.pauvre_du_mois.pseudo}, ${enRiens(c.pauvre_du_mois.total)} — ${lien(c.pauvre_du_mois.lien)}` : 'Le pauvre du mois : personne encore. La place est libre.',
    '', riches.length ? `Nouveaux riches : ${riches.map((r) => r.pseudo).join(', ')}` : 'Aucun nouveau riche cette semaine. Ils sont sur leur yacht.',
    '', 'Les thèmes de la semaine prochaine :', ...themes.map((t) => `- ${t.jour} : ${t.theme}`),
    '', 'Rappel : Qui paie ? est un projet humoristique, aucun argent ne circule entre membres.',
    '', `Ne plus recevoir ces e-mails : ${urlDesinscription}`
  ].join('\n');
  const li = (contenu) => `<li style="margin:0 0 10px">${contenu}</li>`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#0B0B0B;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif">
<p style="font-size:16px">Bonjour ${echapper(destinataire)},</p>
<p style="font-size:28px;font-weight:900;font-style:italic;color:#C6F432;margin:0 0 16px">🗞️ La Gazette des pauvres</p>
<p style="font-size:18px;font-weight:700">Le top 5 de la semaine</p>
<ol style="padding-left:20px">${top.map((p) => li(`<a href="${echapper(lien(p.lien))}" style="color:#FFFFFF;font-weight:700">${echapper(p.titre)}</a><br><span style="color:#C6F432;font-weight:900;font-style:italic">${echapper(enRiens(p.montant))}</span> <span style="color:#A3A3A3">· par ${echapper(p.pseudo)}</span>`)).join('')}</ol>
<p style="font-size:18px;font-weight:700">🥇 Le pauvre du mois</p>
<p>${c.pauvre_du_mois ? `<a href="${echapper(lien(c.pauvre_du_mois.lien))}" style="color:#DCD3FF;font-weight:700">${echapper(c.pauvre_du_mois.pseudo)}</a> · <span style="color:#C6F432;font-weight:900;font-style:italic">${echapper(enRiens(c.pauvre_du_mois.total))}</span>` : 'Personne encore. La place est libre.'}</p>
<p style="font-size:18px;font-weight:700">👑 Les nouveaux riches</p>
<p>${riches.length ? riches.map((r) => `<a href="${echapper(lien(r.lien))}" style="color:#C6F432">${echapper(r.pseudo)}</a>`).join(', ') : 'Aucun cette semaine. Ils sont sur leur yacht.'}</p>
<p style="font-size:18px;font-weight:700">📅 Les thèmes de la semaine prochaine</p>
<ul style="padding-left:20px">${themes.map((t) => li(`${echapper(t.jour)} : <strong>${echapper(t.theme)}</strong>`)).join('')}</ul>
<p><a href="${echapper(siteUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#C6F432;color:#0B0B0B;font-weight:700;text-decoration:none">Publier mon problème</a></p>
<p style="font-size:13px;color:#A3A3A3">Qui paie ? est un projet humoristique : aucun argent ne circule entre membres.</p>
<p style="font-size:13px;color:#A3A3A3"><a href="${echapper(urlDesinscription)}" style="color:#A3A3A3">Ne plus recevoir ces e-mails</a></p>
</body></html>`;
  return { sujet, texte, html, urlDesinscription };
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

async function rpc(nom, args, { jeton, service = false }) {
  const cle = service ? env('SUPABASE_SERVICE_ROLE_KEY') : env('SUPABASE_ANON_KEY');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: { apikey: cle, Authorization: `Bearer ${service ? cle : jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {})
  });
  const texte = await r.text();
  const data = texte ? JSON.parse(texte) : null;
  if (!r.ok) throw Object.assign(new Error((data && data.message) || `RPC ${nom} : HTTP ${r.status}`), { status: r.status });
  return data;
}

async function envoyer(message, destinataire) {
  const r = await fetch(BREVO, {
    method: 'POST',
    headers: { 'api-key': env('BREVO_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Qui paie ?', email: env('SENDER_EMAIL') },
      to: [{ email: destinataire }],
      subject: message.sujet,
      htmlContent: message.html,
      textContent: message.texte,
      headers: { 'List-Unsubscribe': `<${message.urlDesinscription}>` }
    })
  });
  return r.ok;
}

/** Constant-time comparison of the cron secret. */
function memeSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

if (typeof Deno !== 'undefined') {
  Deno.serve(async (req) => {
    const siteUrl = env('SITE_URL');
    const headers = {
      'Access-Control-Allow-Origin': new URL(siteUrl).origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response('ok', { headers });
    if (req.method !== 'POST') return json(405, { erreur: 'Méthode non autorisée.' }, headers);

    // 1. Moderator, or the weekly job with the shared secret
    const secret = Deno.env.get('GAZETTE_SECRET') || '';
    if (!memeSecret(req.headers.get('x-gazette-secret') || '', secret)) {
      const auth = req.headers.get('Authorization') || '';
      const jeton = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!jeton) return json(401, { erreur: 'Connexion requise.' }, headers);
      try {
        if ((await rpc('mod_suis_je', {}, { jeton })) !== true) return json(403, { erreur: 'Accès réservé aux modérateurs.' }, headers);
      } catch {
        return json(401, { erreur: 'Session invalide ou expirée.' }, headers);
      }
    }

    // 2-3. Rounds of reservation + sending, within the shared daily budget
    let envoyes = 0;
    let echecs = 0;
    let dernier = null;
    try {
      for (let tour = 0; tour < TOURS_MAX; tour++) {
        dernier = await rpc('srv_gazette_reserver', { p_max: LOT }, { service: true });
        const lot = dernier.destinataires || [];
        if (!lot.length) break;
        const rates = [];
        for (const d of lot) {
          const message = contenuGazette(dernier.gazette.contenu, { destinataire: d.pseudo, jeton: d.jeton, siteUrl });
          let ok = false;
          try { ok = await envoyer(message, d.email); } catch { ok = false; }
          if (ok) envoyes++; else { echecs++; rates.push(d.user_id); }
        }
        if (rates.length) {
          await rpc('srv_gazette_annuler', { p_gazette_id: dernier.gazette.id, p_user_ids: rates }, { service: true });
          break;
        }
      }
    } catch (e) {
      return json(500, { erreur: e.message, envoyes, echecs }, headers);
    }
    return json(200, {
      envoyes,
      echecs,
      restant_24h: dernier ? dernier.restant_24h : null,
      reste_a_envoyer: dernier ? Math.max(0, dernier.reste_a_envoyer + echecs) : null
    }, headers);
  });
}
