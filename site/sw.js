/* Service worker — caches ONLY the static files of the site (HTML, CSS, JS, fonts, images).
   Never caches Supabase, Turnstile or analytics responses (cross-origin requests are not touched).
   Bump VERSION to refresh every cached file after a deploy. */

const VERSION = 'whopays-v2';
const STATIC = [
  './', 'index.html', 'p.html', 'chiffres.html', 'club.html', 'espace.html', 'aide.html', '404.html',
  'manifest.webmanifest',
  'assets/css/style.css',
  'assets/js/config.js', 'assets/js/api.js', 'assets/js/api-demo.js', 'assets/js/demo-data.js', 'assets/js/api-supabase.js',
  'assets/js/supabase.js', 'assets/js/layout.js', 'assets/js/page.js', 'assets/js/ui.js', 'assets/js/dom-safe.js', 'assets/js/icons.js',
  'assets/js/categories.js', 'assets/js/filtres.js', 'assets/js/animations.js', 'assets/js/carte.js', 'assets/js/mur.js',
  'assets/js/auth.js', 'assets/js/champs.js', 'assets/js/publier.js', 'assets/js/turnstile.js', 'assets/js/parrainage.js',
  'assets/js/partage.js', 'assets/js/reactions.js', 'assets/js/commentaires.js', 'assets/js/signalement.js', 'assets/js/story.js',
  'assets/js/club.js', 'assets/js/espace.js',
  'assets/js/pages/accueil.js', 'assets/js/pages/probleme.js', 'assets/js/pages/chiffres.js', 'assets/js/pages/club.js',
  'assets/js/pages/espace.js', 'assets/js/pages/aide.js',
  'assets/img/logo.svg', 'assets/img/favicon.svg', 'assets/img/couronne.svg', 'assets/img/couronne-noire.svg',
  'assets/img/tirelire.svg', 'assets/img/tirelire-violette.svg', 'assets/img/pinceau.svg', 'assets/img/mascotte.svg',
  'assets/img/question.svg', 'assets/img/icone-192.png', 'assets/img/icone-512.png',
  'assets/fonts/Montserrat-BlackItalic.woff2', 'assets/fonts/Montserrat-ExtraBold.woff2', 'assets/fonts/Montserrat-BoldItalic.woff2',
  'assets/fonts/Inter-Regular.woff2', 'assets/fonts/Inter-SemiBold.woff2'
];
const STATIC_EXT = /\.(?:html|css|js|mjs|svg|png|webp|jpg|jpeg|woff2|webmanifest)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(STATIC.map((url) => cache.add(url).catch(() => null))))
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only our own static files. Supabase, Turnstile, analytics: never intercepted, never cached.
  if (url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  if (!isPage && !STATIC_EXT.test(url.pathname)) return;

  if (isPage) {
    // Network first for pages (fresh content), cache as offline fallback.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(url.pathname, copy)); }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // Stale-while-revalidate for static assets.
  event.respondWith(
    caches.open(VERSION).then((cache) => cache.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }))
  );
});
