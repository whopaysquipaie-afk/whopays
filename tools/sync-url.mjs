#!/usr/bin/env node
// Copies CONFIG.SITE_URL (site/assets/js/config.js) into the Open Graph tags of every page.
// Social networks do not run JavaScript, so og:image and og:url must be absolute.
// Run it once after changing SITE_URL (e.g. when you fork the project):  node tools/sync-url.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const config = readFileSync(join(SITE, 'assets/js/config.js'), 'utf8');
const siteUrl = (config.match(/SITE_URL:\s*'([^']+)'/) || [])[1];
if (!siteUrl || !/^https:\/\/.+\/$/.test(siteUrl)) {
  console.error('CONFIG.SITE_URL must be an https URL ending with "/".');
  process.exit(1);
}

let changed = 0;
for (const file of readdirSync(SITE).filter((f) => f.endsWith('.html'))) {
  const path = join(SITE, file);
  const before = readFileSync(path, 'utf8');
  const page = file === 'index.html' ? '' : file;
  const after = before
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${siteUrl}assets/img/og-image.png">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${siteUrl}${page}">`);
  if (after !== before) {
    writeFileSync(path, after, 'utf8');
    changed++;
    console.log('  ✓', file);
  }
}
console.log(changed ? `${changed} page(s) updated with ${siteUrl}` : `All pages already use ${siteUrl}`);
