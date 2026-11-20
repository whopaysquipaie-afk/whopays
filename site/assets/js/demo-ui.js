// Demo-only UI, loaded by layout.js only when CONFIG.MODE = 'demo' (never for visitors of the real site):
// the "Mode démo" banner and, for the demo on demand (?demo=1, see config.js), the "Quitter la démo"
// link and the propagation of demo=1 into internal links.

import { demoALaDemande, DEMO_FLAG } from './config.js';
import { h } from './ui.js';

function quitterDemo() {
  try { sessionStorage.removeItem(DEMO_FLAG); } catch { /* ignore */ }
}

export function initDemoUi(header) {
  header.before(h('div', { class: 'bandeau-demo', role: 'note' },
    h('strong', {}, 'Mode démo'), ' : données fictives, stockées dans ce navigateur.',
    h('button', {
      type: 'button', class: 'lien-discret',
      onclick: () => {
        try { localStorage.removeItem('whopays_demo_v1'); } catch { /* ignore */ }
        location.reload();
      }
    }, 'Réinitialiser'),
    demoALaDemande ? h('a', {
      class: 'lien-discret', href: urlSansDemo(), 'data-sans-demo': '',
      onclick: () => quitterDemo()
    }, 'Quitter la démo') : null
  ));
  if (demoALaDemande) propagateDemo();
}

/** Relative URL of the current page without the `demo` parameter. */
function urlSansDemo() {
  const params = new URLSearchParams(location.search);
  params.delete('demo');
  const q = params.toString();
  return `${location.pathname.split('/').pop() || 'index.html'}${q ? `?${q}` : ''}${location.hash}`;
}

/** Adds demo=1 to an internal link (same origin, not a bare #anchor, not marked data-sans-demo). */
function addDemoParam(a) {
  const raw = a.getAttribute('href');
  if (!raw || raw.startsWith('#') || a.hasAttribute('data-sans-demo')) return;
  let url;
  try { url = new URL(raw, location.href); } catch { return; }
  if (url.origin !== location.origin || url.searchParams.get('demo') === '1') return;
  url.searchParams.set('demo', '1');
  a.setAttribute('href', `${url.pathname.split('/').pop() || 'index.html'}${url.search}${url.hash}`);
}

/** Keeps demo=1 in every internal link while the demo on demand is active (also links added later). */
function propagateDemo() {
  document.querySelectorAll('a[href]').forEach(addDemoParam);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') { addDemoParam(m.target); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches('a[href]')) addDemoParam(n);
        n.querySelectorAll('a[href]').forEach(addDemoParam);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
}
