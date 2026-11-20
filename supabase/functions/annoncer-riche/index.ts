// Supabase Edge Function « annoncer-riche » (R-031) — e-mails the poor when a new rich member arrives.
// NOT deployed automatically: see docs/CONFIGURATION.md (« E-mail “Un nouveau riche est arrivé” »).
//
// Called by the moderation page (button « Annoncer ce riche par e-mail ») with the moderator's session:
//   POST /functions/v1/annoncer-riche   Authorization: Bearer <access token>   body: { "annonce_id": "<uuid>" }
// 1. Checks the JWT and that the caller is a moderator (RPC mod_suis_je with the caller's token).
// 2. Reserves recipients with the service role (srv_reserver_envois, 012): members of the poor camp who
//    ticked the newsletter box, e-mail confirmed, not blocked, never e-mailed for this announcement,
//    within the budget of 250 e-mails per rolling 24 h (Brevo free plan: 300 / day).
// 3. Sends one e-mail per recipient through the Brevo API, each with its own unsubscribe link
//    (desinscription.html?jeton=…); failures are released (srv_annuler_envois) to be retried later.
//
// Secrets / environment (never in the repository):
//   BREVO_API_KEY   Brevo API key (Brevo → SMTP & API → API keys)
//   SENDER_EMAIL    sender address validated in Brevo (e.g. the project address)
//   SITE_URL        public site URL, with the trailing slash (same value as CONFIG.SITE_URL)
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: provided by Supabase.
//
// No dependency (plain fetch on PostgREST and Brevo). Written as plain JavaScript inside a .ts file,
// so that `node --check` can validate its syntax (tools/verif.mjs).

const LOT = 50;               // recipients reserved per round
const TOURS_MAX = 5;          // at most 250 e-mails per call (= the daily budget)
const BREVO = 'https://api.brevo.com/v3/smtp/email';

const env = (k) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variable d'environnement manquante : ${k}`);
  return v;
};

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin'
  };
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
  if (!r.ok) {
    const err = new Error((data && data.message) || `RPC ${nom} : HTTP ${r.status}`);
    err.status = r.status;
    err.hint = data && data.hint;
    throw err;
  }
  return data;
}

const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function contenu({ pseudo, lien, destinataire, jeton, siteUrl }) {
  const urlAnnonce = siteUrl + lien;
  const urlDesinscription = `${siteUrl}desinscription.html?jeton=${encodeURIComponent(jeton)}`;
  const sujet = `🚨 Un nouveau riche vient d'arriver : ${pseudo}`;
  const texte = [
    `Bonjour ${destinataire},`,
    '',
    `Un nouveau riche vient d'arriver sur Qui paie ? : ${pseudo}.`,
    `Va voir sa première publication : ${urlAnnonce}`,
    '',
    'Rappel : Qui paie ? est un projet humoristique, aucun argent ne circule entre membres.',
    '',
    `Ne plus recevoir ces e-mails : ${urlDesinscription}`
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#0B0B0B;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif">
<p style="font-size:16px">Bonjour ${echapper(destinataire)},</p>
<p style="font-size:22px;font-weight:900;font-style:italic;color:#C6F432">🚨 Un nouveau riche vient d'arriver : ${echapper(pseudo)}.</p>
<p><a href="${echapper(urlAnnonce)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#C6F432;color:#0B0B0B;font-weight:700;text-decoration:none">Voir sa première publication</a></p>
<p style="font-size:13px;color:#A3A3A3">Qui paie ? est un projet humoristique : aucun argent ne circule entre membres.</p>
<p style="font-size:13px;color:#A3A3A3"><a href="${echapper(urlDesinscription)}" style="color:#A3A3A3">Ne plus recevoir ces e-mails</a></p>
</body></html>`;
  return { sujet, texte, html, urlDesinscription };
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

Deno.serve(async (req) => {
  const siteUrl = env('SITE_URL');
  const headers = cors(new URL(siteUrl).origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(405, { erreur: 'Méthode non autorisée.' }, headers);

  // 1. JWT + moderator
  const auth = req.headers.get('Authorization') || '';
  const jeton = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jeton) return json(401, { erreur: 'Connexion requise.' }, headers);
  try {
    if ((await rpc('mod_suis_je', {}, { jeton })) !== true) return json(403, { erreur: 'Accès réservé aux modérateurs.' }, headers);
  } catch {
    return json(401, { erreur: 'Session invalide ou expirée.' }, headers);
  }

  let annonceId = null;
  try { annonceId = (await req.json()).annonce_id; } catch { /* checked below */ }
  if (typeof annonceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(annonceId)) return json(400, { erreur: 'annonce_id manquant ou invalide.' }, headers);

  // 2-3. Rounds of reservation + sending, within the daily budget
  let envoyes = 0;
  let echecs = 0;
  let dernier = null;
  try {
    for (let tour = 0; tour < TOURS_MAX; tour++) {
      dernier = await rpc('srv_reserver_envois', { p_annonce_id: annonceId, p_max: LOT }, { service: true });
      const lot = dernier.destinataires || [];
      if (!lot.length) break;
      const rates = [];
      for (const d of lot) {
        const message = contenu({ pseudo: dernier.annonce.pseudo, lien: dernier.annonce.lien, destinataire: d.pseudo, jeton: d.jeton, siteUrl });
        let ok = false;
        try { ok = await envoyer(message, d.email); } catch { ok = false; }
        if (ok) envoyes++; else { echecs++; rates.push(d.user_id); }
      }
      if (rates.length) {
        await rpc('srv_annuler_envois', { p_annonce_id: annonceId, p_user_ids: rates }, { service: true });
        break; // Brevo refuses: stop here, retry later
      }
    }
  } catch (e) {
    return json(e.hint === 'introuvable' ? 404 : 500, { erreur: e.message, envoyes, echecs }, headers);
  }
  return json(200, {
    envoyes,
    echecs,
    restant_24h: dernier ? dernier.restant_24h : null,
    reste_a_envoyer: dernier ? Math.max(0, dernier.reste_a_envoyer + echecs) : null
  }, headers);
});
