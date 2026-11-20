// Creates the Supabase client from the vendored UMD build (site/assets/vendor/supabase.js).
// No CDN: the file is copied into the repo (see docs/CONFIGURATION.md). Loaded only in 'supabase' mode.

import { CONFIG } from './config.js';

let clientPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Impossible de charger le client Supabase (assets/vendor/supabase.js).'));
    document.head.appendChild(s);
  });
}

export function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLIC_KEY) {
        throw new Error('Supabase n’est pas configuré : renseigne SUPABASE_URL et SUPABASE_PUBLIC_KEY dans config.js.');
      }
      await loadScript('assets/vendor/supabase.js');
      return window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLIC_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'implicit',
          storageKey: 'whopays_auth'
        },
        db: { schema: 'public' }
      });
    })();
  }
  return clientPromise;
}
