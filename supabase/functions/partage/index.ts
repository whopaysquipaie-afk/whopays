// Supabase Edge Function « partage » (R-042) — link previews of a problem for social networks.
// NOT deployed automatically: see docs/CONFIGURATION.md (« Aperçus de partage »).
//
//   GET /functions/v1/partage?id=<uuid of a problem>[&ref=<share code>]
//
// * Link-preview robots (WhatsApp, Facebook, X, LinkedIn, Slack, Discord, Telegram…) get a tiny HTML page
//   whose og:title is the title of the problem, og:description « 5x Rien recherchés — soit 5 000 € · Qui paie ? »
//   and og:image the share image of its category (site/assets/img/partage/<categorie>.png).
// * Humans are redirected at once (HTTP 302) to p.html?id=… on the site (the robots' page also carries a
//   meta refresh and a link, in case a browser gets it).
// * Only published, visible problems: anything else (unknown id, masked, waiting) → redirect to the home page.
//   The problem is read with the PUBLIC function get_probleme_public (anon key): the same data as the site.
//
// Deploy WITHOUT JWT verification (robots have no token): supabase functions deploy partage --no-verify-jwt
// Environment: SITE_URL (secret, with the trailing slash, = CONFIG.SITE_URL);
//              SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase.
// No dependency; plain JavaScript inside a .ts file so that `node --check` validates it (tools/verif.mjs).

const ROBOTS = /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|skypeuripreview|pinterest|redditbot|applebot|googlebot|bingbot|embedly|vkshare|mastodon|bluesky|iframely|preview/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const CATEGORIES = ['reve', 'factures', 'coup-de-pouce', 'amour', 'famille', 'patron', 'projet', 'quotidien', 'plaisir', 'defi'];

const env = (k) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variable d'environnement manquante : ${k}`);
  return v;
};

const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** « 4x Rien » / « 3,5x rien » (same rule as site/assets/js/riens.js). */
function enRiens(montant) {
  const m = Number(montant);
  if (!Number.isFinite(m) || m <= 0) return null;
  const grand = m >= 1000;
  const v = Math.round((m / (grand ? 1000 : 100)) * 100) / 100;
  return `${String(v).replace('.', ',')}x ${grand ? 'Rien' : 'rien'}`;
}
const euros = (m) => `${new Intl.NumberFormat('fr-FR').format(Number(m)).replace(/ | /g, ' ')} €`;

function redirection(url) {
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'public, max-age=300' } });
}

/** Projection of get_probleme_public → the robots' page. */
export function pageApercu(p, { site, cible }) {
  const titre = p.titre || String(p.texte || '').slice(0, 70);
  const riens = enRiens(p.montant);
  const description = riens ? `${riens} recherchés — soit ${euros(p.montant)} · Qui paie ?` : 'Un problème cherche son milliardaire · Qui paie ?';
  const image = p.type === 'pauvre' && CATEGORIES.includes(p.categorie) ? `${site}assets/img/partage/${p.categorie}.png` : `${site}assets/img/og-image.png`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>${echapper(titre)} — Qui paie ?</title>
<meta name="description" content="${echapper(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Qui paie ?">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${echapper(titre)}">
<meta property="og:description" content="${echapper(description)}">
<meta property="og:image" content="${echapper(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${echapper(cible)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${echapper(titre)}">
<meta name="twitter:description" content="${echapper(description)}">
<meta name="twitter:image" content="${echapper(image)}">
<meta http-equiv="refresh" content="0;url=${echapper(cible)}">
<link rel="canonical" href="${echapper(cible)}">
</head><body><p><a href="${echapper(cible)}">${echapper(titre)} — voir le problème sur Qui paie ?</a></p></body></html>`;
}

async function lireProbleme(id) {
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/get_probleme_public`, {
    method: 'POST',
    headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${env('SUPABASE_ANON_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id })
  });
  if (!res.ok) return null;
  return res.json();
}

if (typeof Deno !== 'undefined') {
  Deno.serve(async (req) => {
    const site = env('SITE_URL');
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Méthode non autorisée', { status: 405 });
    const url = new URL(req.url);
    const id = url.searchParams.get('id') || '';
    const ref = (url.searchParams.get('ref') || '').toUpperCase();
    if (!UUID.test(id)) return redirection(site);
    const cible = `${site}p.html?id=${encodeURIComponent(id)}${CODE.test(ref) ? `&ref=${ref}` : ''}`;
    let p = null;
    try { p = await lireProbleme(id); } catch { p = null; }
    if (!p || !p.id) return redirection(site);   // unknown, masked or not published
    if (!ROBOTS.test(req.headers.get('user-agent') || '')) return redirection(cible);
    return new Response(pageApercu(p, { site, cible }), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600', 'X-Robots-Tag': 'noindex' }
    });
  });
}
