/* Service worker: own static files only (never Supabase/Cloudflare). Code = network first,
   fonts/images = stale-while-revalidate. __BUILD__ is replaced by the commit at deploy (docs/ARCHITECTURE.md). */

const VERSION = 'whopays-__BUILD__';
const STATIC = [
  './', 'index.html', 'p.html', 'chiffres.html', 'palmares.html', 'club.html', 'espace.html', 'aide.html', 'desinscription.html', '404.html',
  'manifest.webmanifest',
  'assets/css/style.css',
  'assets/js/config.js', 'assets/js/api.js', 'assets/js/api-demo.js', 'assets/js/demo-data.js', 'assets/js/demo-ui.js', 'assets/js/mots-sensibles.js', 'assets/js/api-supabase.js',
  'assets/js/supabase.js', 'assets/js/layout.js', 'assets/js/page.js', 'assets/js/ui.js', 'assets/js/dom-safe.js', 'assets/js/icons.js',
  'assets/js/categories.js', 'assets/js/filtres.js', 'assets/js/animations.js', 'assets/js/carte.js', 'assets/js/riens.js', 'assets/js/mur.js',
  'assets/js/auth.js', 'assets/js/champs.js', 'assets/js/publier.js', 'assets/js/turnstile.js', 'assets/js/parrainage.js',
  'assets/js/partage.js', 'assets/js/reactions.js', 'assets/js/commentaires.js', 'assets/js/signalement.js', 'assets/js/story.js',
  'assets/js/club.js', 'assets/js/espace.js', 'assets/js/palmares.js', 'assets/js/riche-attente.js', 'assets/js/annonces.js', 'assets/js/auth-textes.js',
  'assets/js/pages/accueil.js', 'assets/js/pages/probleme.js', 'assets/js/pages/chiffres.js', 'assets/js/pages/palmares.js', 'assets/js/pages/club.js',
  'assets/js/pages/espace.js', 'assets/js/pages/aide.js', 'assets/js/pages/desinscription.js',
  'assets/img/logo.svg', 'assets/img/favicon.svg', 'assets/img/couronne.svg', 'assets/img/couronne-noire.svg',
  'assets/img/tirelire.svg', 'assets/img/tirelire-violette.svg', 'assets/img/pinceau.svg', 'assets/img/mascotte.svg',
  'assets/img/question.svg', 'assets/img/icone-192.png', 'assets/img/icone-512.png',
  'assets/fonts/Montserrat-BlackItalic.woff2', 'assets/fonts/Montserrat-ExtraBold.woff2', 'assets/fonts/Montserrat-BoldItalic.woff2',
  'assets/fonts/Inter-Regular.woff2', 'assets/fonts/Inter-SemiBold.woff2'
];
const CODE_EXT = /\.(?:html|css|js|mjs|webmanifest)$/;
const MEDIA_EXT = /\.(?:svg|png|webp|jpg|jpeg|woff2)$/;
const NO_CACHE = /\/moderation(?:\.html)?$|\/assets\/js\/(?:pages\/)?moderation\.js$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(STATIC.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req, key) {
  const fresh = req.mode === 'navigate' ? fetch(req) : fetch(req, { cache: 'no-cache' });
  return fresh
    .then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(key, copy)); }
      return res;
    })
    .catch(() => caches.match(key).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
}

function staleWhileRevalidate(event, req) {
  return caches.open(VERSION).then((cache) => cache.match(req).then((cached) => {
    const network = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    if (cached) { event.waitUntil(network.catch(() => null)); return cached; }
    return network;
  }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NO_CACHE.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, url.pathname));
    return;
  }
  if (CODE_EXT.test(url.pathname)) { event.respondWith(networkFirst(req, req)); return; }
  if (MEDIA_EXT.test(url.pathname)) { event.respondWith(staleWhileRevalidate(event, req)); }
});
