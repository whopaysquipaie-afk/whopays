#!/usr/bin/env node
// Static checks — run before every commit: node tools/verif.mjs
//  1. every JS file parses (ES modules for the site, classic script for sw.js)
//  2. no innerHTML / outerHTML / insertAdjacentHTML / document.write fed by a variable
//  3. no link or asset path starting with "/" (the site lives under /whopays/)
//  4. no hard-coded site URL outside site/assets/js/config.js
//  5. a Content-Security-Policy <meta> on every page, no inline script, no inline handler
//  6. no secret pattern in the working tree AND in the whole Git history
//  7. visible texts: "problème" never misspelled "probléme"
//  8. JavaScript budget: < 150 KB loaded by each page at start-up (static imports), < 250 KB with everything
//     it can open on demand (dynamic imports); vendor/ excluded (DC-017, DC-023, DC-033)
//  (+ 7b service worker / assets, 7c sensitive words JS = SQL, 7d private moderation page)

import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const SELF = 'tools/verif.mjs';
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

const results = [];
function check(name, problems) {
  results.push({ name, problems });
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const allFiles = walk(ROOT);
const textExt = new Set(['.js', '.mjs', '.ts', '.html', '.css', '.md', '.sql', '.json', '.webmanifest', '.yml', '.yaml', '.svg', '.txt', '']);
const textFiles = allFiles.filter((f) => textExt.has(extname(f)) && statSync(f).size < 2_000_000);
const siteFiles = allFiles.filter((f) => f.startsWith(SITE));
const isVendor = (f) => rel(f).startsWith('site/assets/vendor/');
const siteJs = siteFiles.filter((f) => ['.js', '.mjs'].includes(extname(f)) && !isVendor(f));
const siteHtml = siteFiles.filter((f) => extname(f) === '.html');
const read = (f) => readFileSync(f, 'utf8');

/* 1. Syntax */
{
  const problems = [];
  const tmp = mkdtempSync(join(tmpdir(), 'whopays-verif-'));
  // Edge Functions (supabase/functions/*/index.ts) are written as plain JavaScript: same check (R-031)
  const files = [...siteJs, ...allFiles.filter((f) => (rel(f).startsWith('tools/') && extname(f) === '.mjs')
    || (rel(f).startsWith('supabase/functions/') && extname(f) === '.ts'))];
  for (const f of files) {
    const classic = basename(f) === 'sw.js';
    const copy = join(tmp, `${Math.random().toString(36).slice(2)}${classic ? '.cjs' : '.mjs'}`);
    writeFileSync(copy, read(f));
    const r = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
    if (r.status !== 0) problems.push(`${rel(f)}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'syntax error'}`);
  }
  rmSync(tmp, { recursive: true, force: true });
  check(`Syntaxe JavaScript (${files.length} fichiers)`, problems);
}

/* 2. Unsafe DOM writes */
{
  const problems = [];
  const unsafe = [
    /\.innerHTML\s*\+?=(?!\s*(['"])\1\s*;?)/, // allow only `.innerHTML = ''`
    /\.outerHTML\s*\+?=/,
    /insertAdjacentHTML\s*\(/,
    /document\.write(ln)?\s*\(/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/
  ];
  for (const f of siteJs) {
    read(f).split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      for (const re of unsafe) if (re.test(line)) problems.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  check('Aucune écriture HTML dangereuse (innerHTML alimenté par une variable, eval…)', problems);
}

/* 3. Absolute links */
{
  const problems = [];
  const htmlRe = /\b(?:href|src|action|poster|srcset|data-src)\s*=\s*["']\/(?!\/)?/gi;
  const jsRe = /(?:\b(?:href|src|action)\s*[:=]\s*|fetch\(\s*|location(?:\.href)?\s*=\s*|register\(\s*)(['"`])\/(?!\/)/g;
  const cssRe = /url\(\s*['"]?\/(?!\/)/g;
  for (const f of siteFiles) {
    const ext = extname(f);
    if (isVendor(f)) continue;
    const text = ['.html', '.js', '.mjs', '.css', '.webmanifest', '.json'].includes(ext) ? read(f) : null;
    if (text === null) continue;
    const res = ext === '.html' ? [htmlRe, jsRe] : ext === '.css' ? [cssRe] : ['.webmanifest', '.json'].includes(ext) ? [/"(?:src|start_url|scope|url)"\s*:\s*"\/(?!\/)/g] : [jsRe];
    for (const re of res) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const line = text.slice(0, m.index).split('\n').length;
        problems.push(`${rel(f)}:${line}: ${text.slice(m.index, m.index + 50).split('\n')[0]}`);
      }
    }
  }
  check('Aucun lien ni chemin commençant par « / »', problems);
}

/* 4. Hard-coded site URL */
{
  const problems = [];
  const urlRe = /github\.io|whopays-app\b/i;
  const siteUrl = (read(join(SITE, 'assets/js/config.js')).match(/SITE_URL:\s*'([^']+)'/) || [])[1] || '';
  // Exception: Open Graph tags need an absolute URL. They are written by tools/sync-url.mjs
  // from CONFIG.SITE_URL and must match it exactly.
  const ogRe = /^\s*<meta property="og:(image|url)" content="([^"]+)">\s*$/;
  for (const f of siteFiles) {
    if (rel(f) === 'site/assets/js/config.js' || isVendor(f) || !textExt.has(extname(f))) continue;
    if (rel(f).startsWith('site/assets/img/')) continue;
    read(f).split('\n').forEach((line, i) => {
      const og = line.match(ogRe);
      if (og) {
        if (!siteUrl || !og[2].startsWith(siteUrl)) problems.push(`${rel(f)}:${i + 1}: og:${og[1]} ne correspond pas à CONFIG.SITE_URL (lancer node tools/sync-url.mjs)`);
        return;
      }
      if (urlRe.test(line)) problems.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  check('Aucune URL du site écrite en dur hors config.js', problems);
}

/* 5. CSP and inline code on every page */
{
  const problems = [];
  for (const f of siteHtml) {
    const html = read(f);
    const csp = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i);
    if (!csp) problems.push(`${rel(f)}: pas de balise CSP`);
    else {
      const v = csp[1];
      if (!/default-src 'self'/.test(v)) problems.push(`${rel(f)}: CSP sans default-src 'self'`);
      if (/script-src[^;]*'unsafe-(inline|eval)'/.test(v)) problems.push(`${rel(f)}: CSP autorise du script inline`);
      if (!/object-src 'none'/.test(v)) problems.push(`${rel(f)}: CSP sans object-src 'none'`);
    }
    if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html)) problems.push(`${rel(f)}: script inline`);
    if (/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<meta[^>]*>/gi, ''))) problems.push(`${rel(f)}: gestionnaire d'événement inline (onclick=…)`);
    if (!/<html[^>]*\blang="fr"/.test(html)) problems.push(`${rel(f)}: <html lang="fr"> manquant`);
    if (!/<meta\s+name="viewport"/.test(html)) problems.push(`${rel(f)}: meta viewport manquante`);
    if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${rel(f)}: <title> manquant`);
    const ext = [...html.matchAll(/<script[^>]+src=["'](https?:)?\/\/([^/"']+)/gi)].map((m) => m[2]);
    for (const host of ext) if (!['challenges.cloudflare.com', 'static.cloudflareinsights.com'].includes(host)) problems.push(`${rel(f)}: script externe interdit (${host})`);
    for (const m of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) if (!/rel=["'][^"']*noopener/.test(m[0])) problems.push(`${rel(f)}: target=_blank sans rel=noopener`);
  }
  check(`CSP, pas de code inline, métadonnées (${siteHtml.length} pages)`, problems);
}

/* 6. Secrets — working tree and full Git history */
const SECRET_PATTERNS = [
  { name: 'JWT (clé Supabase secrète ?)', re: new RegExp('ey' + 'J[A-Za-z0-9_-]{20,}\\.ey' + 'J[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}') },
  { name: 'Clé Stripe / OpenAI (sk_…)', re: new RegExp('\\bsk' + '_(live|test)?_?[A-Za-z0-9]{20,}') },
  { name: 'Clé secrète Supabase (sb_secret_…)', re: new RegExp('sb' + '_secret_[A-Za-z0-9_-]{10,}') },
  { name: 'Clé Brevo (xkeysib-…)', re: new RegExp('xkey' + 'sib-[A-Za-z0-9-]{10,}') },
  { name: 'Clé SMTP Brevo (xsmtpsib-…)', re: new RegExp('xsmtp' + 'sib-[A-Za-z0-9-]{10,}') },
  { name: 'Clé privée', re: new RegExp('-----BEGIN [A-Z ]*PRIV' + 'ATE KEY-----') },
  { name: 'Jeton GitHub', re: new RegExp('\\bgh[pousr]' + '_[A-Za-z0-9]{30,}') },
  { name: 'Clé AWS', re: new RegExp('\\bAK' + 'IA[0-9A-Z]{16}\\b') },
  { name: 'Mot de passe Postgres dans une URL', re: new RegExp('postgres(ql)?://[^:\\s]+:[^@\\s]{6,}@') }
];
const SERVICE_ROLE = new RegExp('service' + '_role');
{
  const problems = [];
  for (const f of textFiles) {
    const r = rel(f);
    if (r === SELF) continue;
    const text = read(f);
    for (const p of SECRET_PATTERNS) if (p.re.test(text)) problems.push(`${r}: ${p.name}`);
    if (r.startsWith('site/') && SERVICE_ROLE.test(text)) problems.push(`${r}: le code du site mentionne la clé service_role`);
    if (/(^|\/)\.env(\.|$)/.test(r)) problems.push(`${r}: fichier .env dans le dépôt`);
  }
  check('Aucun secret dans les fichiers', problems);
}
{
  const problems = [];
  let scanned = 0;
  try {
    const log = execFileSync('git', ['-C', ROOT, 'log', '-p', '--all', '--no-color', '--unified=0'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    let file = '';
    let commit = '';
    for (const line of log.split('\n')) {
      if (line.startsWith('commit ')) { commit = line.slice(7, 15); continue; }
      if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
      if (!line.startsWith('+') || file === SELF) continue;
      scanned++;
      for (const p of SECRET_PATTERNS) if (p.re.test(line)) problems.push(`commit ${commit} ${file}: ${p.name}`);
      if (file.startsWith('site/') && SERVICE_ROLE.test(line)) problems.push(`commit ${commit} ${file}: service_role dans le code du site`);
      if (/(^|\/)\.env(\.|$)/.test(file)) problems.push(`commit ${commit}: fichier ${file}`);
    }
  } catch {
    // not a git repo yet or no commit: nothing to scan
  }
  check(`Aucun secret dans l'historique Git (${scanned} lignes ajoutées analysées)`, [...new Set(problems)]);
}

/* 7. Spelling of "problème" */
{
  const problems = [];
  const bad = /probl[éê]me|problèmme|probleme(?![_-])/i;
  for (const f of siteFiles.filter((x) => ['.html', '.js', '.webmanifest', '.json'].includes(extname(x)) && !isVendor(x))) {
    read(f).split('\n').forEach((line, i) => {
      // Only check visible strings (quoted text, HTML text), not identifiers like get_probleme_public.
      // Enum values such as 'probleme' (lowercase, no space) are identifiers, not visible text.
      const strings = (line.match(/(["'`])(?:(?!\1).)*\1|>[^<]+</g) || [])
        .filter((s) => !/^(["'`])[#a-z0-9_.-]*\1$/.test(s)).join(' ');
      const cleaned = strings.replace(/[\w-]*probleme[\w-]*\.(html|js)/gi, '').replace(/\b[a-z_]*probleme[a-z_]*\b(?=\s*[(:])/gi, '');
      for (const m of cleaned.matchAll(/[A-Za-zÀ-ÿ'_-]*probl[eéê]m+e[A-Za-zÀ-ÿ_-]*/gi)) {
        const w = m[0];
        if (/_|-/.test(w) || /[a-z][A-Z]/.test(w)) continue; // identifiers: get_probleme, probleme-x, getProbleme
        if (bad.test(w)) problems.push(`${rel(f)}:${i + 1}: « ${w} »`);
      }
    });
  }
  check('Orthographe : « problème » (jamais « probléme » ni « probleme »)', problems);
}

/* 7b. Service worker & manifest: every referenced file exists */
{
  const problems = [];
  const sw = join(SITE, 'sw.js');
  if (existsSync(sw)) {
    const list = (read(sw).match(/const STATIC = \[([\s\S]*?)\];/) || [])[1] || '';
    for (const m of list.matchAll(/'([^']+)'/g)) {
      if (m[1] === './') continue;
      if (!existsSync(join(SITE, m[1]))) problems.push(`sw.js : fichier absent ${m[1]}`);
    }
    if (/supabase\.co|challenges\.cloudflare/.test(read(sw).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) problems.push('sw.js ne doit jamais référencer Supabase ou Cloudflare');
    // Cache version stamped automatically at deploy time (R-016).
    if (!/const VERSION = 'whopays-__BUILD__';/.test(read(sw))) problems.push("sw.js : VERSION doit valoir 'whopays-__BUILD__' (remplacé au déploiement)");
    const deploy = join(ROOT, '.github/workflows/deploy.yml');
    const dy = existsSync(deploy) ? read(deploy) : '';
    if (!/sed -i "s\/__BUILD__\/\$\{GITHUB_SHA::7\}\/" site\/sw\.js/.test(dy)) problems.push('deploy.yml : remplacement de __BUILD__ par le commit absent');
    else if (dy.indexOf('__BUILD__') > dy.indexOf('upload-pages-artifact')) problems.push('deploy.yml : le remplacement de __BUILD__ doit précéder l\'upload');
  }
  const manifest = join(SITE, 'manifest.webmanifest');
  if (existsSync(manifest)) {
    try {
      const m = JSON.parse(read(manifest));
      for (const i of m.icons || []) if (!existsSync(join(SITE, i.src))) problems.push(`manifest : icône absente ${i.src}`);
      if (m.start_url !== './' || m.scope !== './') problems.push('manifest : start_url et scope doivent valoir "./" (= /whopays/)');
    } catch (e) { problems.push(`manifest invalide : ${e.message}`); }
  }
  for (const f of siteHtml) {
    for (const m of read(f).matchAll(/\b(?:href|src)="(assets\/[^"?#]+)"/g)) {
      if (!existsSync(join(SITE, m[1])) && !/assets\/fonts\//.test(m[1])) problems.push(`${rel(f)} : ressource absente ${m[1]}`);
    }
  }
  check('Service worker, manifeste et ressources des pages présents', problems);
}

/* 7c. Sensitive words: the demo list (mots-sensibles.js) and the SQL list are identical (R-017, R-020).
   SQL list = seed of 005, then the deletions and insertions of every later migration, in order. */
{
  const problems = [];
  const js = join(SITE, 'assets/js/mots-sensibles.js');
  const dossier = join(ROOT, 'supabase/migrations');
  const sql = join(dossier, '005_publication_auto.sql');
  if (!existsSync(js) || !existsSync(sql)) problems.push('mots-sensibles.js ou 005_publication_auto.sql absent');
  else {
    const listeJs = [...((read(js).match(/MOTS_SENSIBLES_DEFAUT = \[([\s\S]*?)\];/) || [])[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const mots = (bloc) => [...bloc.matchAll(/'((?:[^']|'')+)'/g)].map((m) => m[1].replace(/''/g, "'"));
    const effectif = new Set();
    const migrations = readdirSync(dossier).filter((f) => /^\d{3}_.*\.sql$/.test(f) && f >= '005').sort();
    for (const f of migrations) {
      const src = read(join(dossier, f)).replace(/--.*$/gm, '');
      for (const m of src.matchAll(/delete from public\.mots_sensibles\s+where mot in \(([\s\S]*?)\);/g)) for (const w of mots(m[1])) effectif.delete(w);
      for (const m of src.matchAll(/insert into public\.mots_sensibles \(mot\) values([\s\S]*?)on conflict/g)) for (const w of mots(m[1])) effectif.add(w);
    }
    const listeSql = [...effectif];
    const a = [...listeJs].sort().join('|');
    const b = [...listeSql].sort().join('|');
    if (!listeJs.length) problems.push('mots-sensibles.js : liste vide');
    if (a !== b) {
      for (const m of listeJs) if (!listeSql.includes(m)) problems.push(`absent du SQL : ${m}`);
      for (const m of listeSql) if (!listeJs.includes(m)) problems.push(`absent du JS : ${m}`);
    }
  }
  check('Mots sensibles identiques en JS (démo) et en SQL (005 + migrations suivantes)', problems);
}

/* 7d. Private moderation page (R-018): noindex, linked from nowhere, never cached by the service worker */
{
  const problems = [];
  const page = join(SITE, 'moderation.html');
  if (!existsSync(page)) problems.push('site/moderation.html absent');
  else if (!/<meta name="robots" content="noindex[^"]*">/.test(read(page))) problems.push('moderation.html : <meta name="robots" content="noindex"> manquant');
  const lien = /moderation\.html/;
  for (const f of siteFiles.filter((x) => ['.html', '.js', '.webmanifest', '.xml', '.txt'].includes(extname(x)) && !isVendor(x))) {
    if (f === page || /^site\/(sw\.js|assets\/js\/(pages\/)?moderation\.js)$/.test(rel(f))) continue;
    if (lien.test(read(f))) problems.push(`${rel(f)} : lien vers moderation.html`);
  }
  const sw = join(SITE, 'sw.js');
  if (existsSync(sw)) {
    const src = read(sw);
    const statique = (src.match(/const STATIC = \[([\s\S]*?)\];/) || [])[1] || '';
    if (/moderation/.test(statique)) problems.push('sw.js : la page de modération est dans le précache');
    const m = src.match(/const NO_CACHE = (\/.*\/);/);
    const re = m ? new RegExp(m[1].slice(1, -1)) : null;
    for (const chemin of ['/whopays/moderation.html', '/whopays/moderation', '/whopays/assets/js/moderation.js', '/whopays/assets/js/pages/moderation.js']) {
      if (!re || !re.test(chemin)) problems.push(`sw.js : ${chemin} n'est pas exclu du cache (NO_CACHE)`);
    }
  }
  check('Page de modération privée (noindex, aucun lien, hors cache du service worker)', problems);
}

/* 8. JS budget */
{
  // Budget = JavaScript a visitor of the real site can load on ONE page: the page's entry module plus
  // everything reachable from it (static AND dynamic imports, so dialogs opened on demand count too).
  // Excluded: vendor/, the test suite, the demo simulation + demo UI (demo mode or ?demo=1 only),
  // sw.js (worker) and the private moderation page (moderators only). DC-017, DC-023.
  const horsBudget = (f) => /site\/(sw\.js$|assets\/js\/(tests\/|api-demo\.js$|demo-data\.js$|demo-ui\.js$|mots-sensibles\.js$|pages\/tests\.js$|moderation\.js$|pages\/moderation\.js$))/.test(rel(f));
  const RE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]+)\1/gm;
  const RE_STATIQUE = /(?:\bfrom\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]+)\1/gm;
  const atteignables = (entree, re = RE_IMPORT) => {
    const vus = new Set();
    const pile = [entree];
    while (pile.length) {
      const f = pile.pop();
      if (vus.has(f) || !existsSync(f)) continue;
      vus.add(f);
      for (const m of read(f).matchAll(re)) pile.push(join(dirname(f), m[2]));
    }
    return [...vus];
  };
  const problems = [];
  let pire = { kb: 0, page: '' };
  let pireTotal = { kb: 0, page: '' };
  for (const page of siteHtml) {
    for (const m of read(page).matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) {
      const entree = join(dirname(page), m[1]);
      if (horsBudget(entree)) continue;
      const poids = (re) => atteignables(entree, re).filter((f) => !horsBudget(f) && !isVendor(f)).reduce((s, f) => s + statSync(f).size, 0);
      const depart = poids(RE_STATIQUE);
      const total = poids(RE_IMPORT);
      const kb = Math.round(depart / 1024);
      if (kb >= pire.kb) pire = { kb, page: rel(page) };
      if (total >= pireTotal.kb * 1024) pireTotal = { kb: Math.round(total / 1024), page: rel(page) };
      if (depart > 150 * 1024) problems.push(`${rel(page)} : ${kb} Ko au chargement > 150 Ko`);
      if (total > 250 * 1024) problems.push(`${rel(page)} : ${Math.round(total / 1024)} Ko avec les imports à la demande > 250 Ko`);
    }
  }
  const tout = siteJs.filter((f) => !horsBudget(f)).reduce((s, f) => s + statSync(f).size, 0);
  check(`Poids du JavaScript par page : ${pire.kb} Ko au chargement au plus (${pire.page} ; limite 150 Ko), ${pireTotal.kb} Ko avec tout ce qui s'ouvre à la demande (${pireTotal.page} ; limite 250 Ko) ; tout le site hors démo, tests, sw.js et modération : ${Math.round(tout / 1024)} Ko`, problems);
}

/* Report */
let failed = 0;
for (const r of results) {
  const ok = r.problems.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${r.name}`);
  for (const p of r.problems.slice(0, 30)) console.log(`         - ${p}`);
  if (r.problems.length > 30) console.log(`         … et ${r.problems.length - 30} autres`);
}
console.log(failed ? `\n${failed} contrôle(s) en échec.` : `\nTous les contrôles sont OK (${results.length}).`);
process.exit(failed ? 1 : 0);
