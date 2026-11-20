// tests.html — runs the API contract suite in the browser.
// Demo mode: full suite on an isolated in-memory backend (your demo data is not touched).
// Supabase mode: read-only checks on the real public functions.
import { CONFIG } from '../config.js';
import { api } from '../api.js';
import { initLayout } from '../layout.js';
import { h } from '../ui.js';
import { runContractTests, runPublicChecks } from '../tests/contrat.js';

initLayout({ page: 'tests', mobileCta: false });

const list = document.getElementById('tests-liste');
const resume = document.getElementById('tests-resume');
document.getElementById('tests-mode').textContent = CONFIG.MODE === 'supabase'
  ? 'Mode Supabase : contrôles en lecture seule sur les fonctions publiques réelles (les tests d\'écriture se lancent dans l\'éditeur SQL : supabase/tests/verif_securite.sql).'
  : 'Mode démo : suite complète, sur une base fictive isolée en mémoire (tes données de démo ne sont pas modifiées).';

const onResult = (r) => {
  list.appendChild(h('li', {},
    h('span', { class: r.ok ? 'ok' : 'ko' }, r.ok ? 'OK     ' : 'ÉCHEC  '),
    `${r.group} › ${r.name}`,
    r.ok ? null : h('div', { class: 'ko' }, `→ ${r.error}`)
  ));
};

const started = performance.now();
const results = CONFIG.MODE === 'supabase'
  ? await runPublicChecks(api, { onResult })
  : await runContractTests({ onResult });
const failed = results.filter((r) => !r.ok).length;
resume.textContent = failed
  ? `${failed} test(s) en ÉCHEC sur ${results.length}.`
  : `Tous les tests sont OK : ${results.length}/${results.length} en ${Math.round(performance.now() - started)} ms.`;
resume.className = failed ? 'ko' : 'ok';
document.title = `${failed ? 'ÉCHEC' : 'OK'} — Tests du contrat d'API`;
