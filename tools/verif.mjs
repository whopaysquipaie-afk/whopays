#!/usr/bin/env node
// Static checks — run before every commit: node tools/verif.mjs
//  1. every JS file parses (ES modules for the site, classic script for sw.js)
//  2. no innerHTML / outerHTML / insertAdjacentHTML / document.write fed by a variable
//  3. no link or asset path starting with "/" (the site lives under /whopays/)
//  4. no hard-coded site URL outside site/assets/js/config.js
//  5. a Content-Security-Policy <meta> on every page, no inline script, no inline handler
//  6. no secret pattern in the working tree AND in the whole Git history
//  7. visible texts: "problème" never misspelled "probléme"
//  8. site JavaScript budget < 150 KB (vendor/ excluded)

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
const textExt = new Set(['.js', '.mjs', '.html', '.css', '.md', '.sql', '.json', '.webmanifest', '.yml', '.yaml', '.svg', '.txt', '']);
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
  const files = [...siteJs, ...allFiles.filter((f) => rel(f).startsWith('tools/') && extname(f) === '.mjs')];
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

/* 8. JS budget */
{
  // Budget = JavaScript shipped to visitors of the real site: vendor/ excluded, and also the test
  // suite (tests.html only) and the demo simulation + demo UI (loaded only in demo mode or with ?demo=1).
  const horsBudget = (f) => /site\/assets\/js\/(tests\/|api-demo\.js$|demo-data\.js$|demo-ui\.js$|pages\/tests\.js$)/.test(rel(f));
  const total = siteJs.filter((f) => !horsBudget(f)).reduce((s, f) => s + statSync(f).size, 0);
  const demo = siteJs.filter(horsBudget).reduce((s, f) => s + statSync(f).size, 0);
  const kb = Math.round(total / 1024);
  check(`Poids du JavaScript du site : ${kb} Ko (limite 150 Ko ; hors vendor, tests et simulation démo : +${Math.round(demo / 1024)} Ko)`, total > 150 * 1024 ? [`${kb} Ko > 150 Ko`] : []);
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
