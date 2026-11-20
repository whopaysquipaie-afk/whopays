#!/usr/bin/env node
// Wires the self-hosted fonts once the woff2 files are in site/assets/fonts/.
//  - adds url(...) sources to the @font-face rules of style.css (only for files that exist)
//  - adds <link rel="preload"> for the two most visible fonts in every page
// Without the files, the CSS only uses local() fonts: no 404 in the console.
// Usage: node tools/polices.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const CSS = join(SITE, 'assets/css/style.css');
const FONTS = ['Montserrat-BlackItalic', 'Montserrat-ExtraBold', 'Montserrat-BoldItalic', 'Inter-Regular', 'Inter-SemiBold'];
const PRELOAD = ['Montserrat-BlackItalic', 'Inter-Regular'];

const present = FONTS.filter((f) => existsSync(join(SITE, 'assets/fonts', `${f}.woff2`)));
let css = readFileSync(CSS, 'utf8');
for (const f of FONTS) {
  const local = new RegExp(`(src: local\\("[^"]+"\\), local\\("${f}"\\))(,\\s*url\\("\\.\\./fonts/${f}\\.woff2"\\) format\\("woff2"\\))?;`);
  css = css.replace(local, (m, base) => (present.includes(f) ? `${base},\n       url("../fonts/${f}.woff2") format("woff2");` : `${base};`));
}
writeFileSync(CSS, css);

let pages = 0;
for (const file of readdirSync(SITE).filter((x) => x.endsWith('.html'))) {
  const path = join(SITE, file);
  let html = readFileSync(path, 'utf8').replace(/\s*<link rel="preload" href="assets\/fonts\/[^"]+" as="font" type="font\/woff2" crossorigin>/g, '');
  const links = PRELOAD.filter((f) => present.includes(f))
    .map((f) => `\n  <link rel="preload" href="assets/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('');
  html = html.replace(/(\s*<link rel="stylesheet" href="assets\/css\/style\.css">)/, `${links}$1`);
  writeFileSync(path, html);
  pages++;
}
console.log(`Polices présentes : ${present.length}/${FONTS.length} (${present.join(', ') || 'aucune'}). ${pages} pages mises à jour.`);
