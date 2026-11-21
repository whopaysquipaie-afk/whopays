#!/usr/bin/env node
// Generates the SVG assets of the brand (icons, decorations, PNG masters, social images).
// The logo itself (logo.svg, logo-clair.svg) is a delivered source file, embedded as-is.
// Usage: node tools/images.mjs
// Outputs: site/assets/img/*.svg, site/assets/img/src/*.svg (PNG masters, incl. the 10 share images partage-<categorie>.svg
// of R-042, rendered to site/assets/img/partage/<categorie>.png), docs/social-preview.svg

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../site/assets/js/categories.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'site/assets/img');
const SRC = join(IMG, 'src');

const C = { noir: '#0B0B0B', blanc: '#FFFFFF', citron: '#C6F432', lavande: '#DCD3FF', lavandeTexte: '#3B2A8C', anthracite: '#161616', creme: '#F4F4F0', gris: '#A3A3A3' };

// Italic skew shared by the "?" icons (same slant as the logo).
const SKEW = -12; // degrees
const SKEW_K = Math.tan((SKEW * Math.PI) / 180);

// Question mark of the icons (favicon, app icons), centerline drawn in a 0..120 × 0..222 box.
const Q_STROKE = 40;
function questionMark(x, y, color, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="${Q_STROKE}" stroke-linecap="butt" stroke-linejoin="round">
    <path d="M22 72 C22 38 42 20 66 20 C92 20 110 38 110 62 C110 86 92 96 78 106 C68 113 64 122 64 136 V150"/>
    <rect x="44" y="176" width="40" height="40" rx="6" fill="${color}" stroke="none"/>
  </g>`;
}

/*
 * The official logo (logo.svg / logo-clair.svg) is drawn from the real glyphs of
 * Montserrat Black Italic and delivered as a file: it is a SOURCE, never regenerated here.
 * The compositions below embed it as a nested <svg> (same viewBox, metadata stripped).
 */
function readLogo(file) {
  const raw = readFileSync(join(IMG, file), 'utf8');
  const viewBox = (raw.match(/<svg\b[^>]*\sviewBox="([^"]+)"/) || [])[1];
  if (!viewBox) throw new Error(`${file}: no viewBox`);
  const [, , vw, vh] = viewBox.trim().split(/[\s,]+/).map(Number);
  const inner = raw
    .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
    .trim();
  return { viewBox, ratio: vw / vh, inner };
}

/** Logo as a nested <svg> to embed in bigger compositions (width target). */
function logoGroup(x, y, targetW, { clair = false } = {}) {
  const L = readLogo(clair ? 'logo-clair.svg' : 'logo.svg');
  const hgt = targetW / L.ratio;
  return {
    g: `<svg x="${x}" y="${y}" width="${targetW}" height="${hgt.toFixed(2)}" viewBox="${L.viewBox}">${L.inner}</svg>`,
    h: hgt
  };
}

/** "?" alone on black — favicon, app icon. `safe` shrinks it for maskable icons. */
function iconQ({ size = 512, safe = false, radius = 0 } = {}) {
  const scale = (safe ? 0.56 : 0.72) * size / 222;
  const qw = 120 * scale + Math.abs(SKEW_K) * 222 * scale;
  const x = (size - qw) / 2 + Math.abs(SKEW_K) * 222 * scale;
  const y = (size - 216 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${C.noir}"/>
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) skewX(${SKEW})">${questionMark(0, 0, C.citron, scale)}</g>
</svg>`;
}

/* ---------------- Decorations ---------------- */

const CROWN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 150" width="220" height="150" role="img" aria-label="Couronne">
  <g fill="none" stroke="${C.citron}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <path d="M28 118 C24 92 18 64 14 38 C34 56 52 70 66 78 C80 58 96 34 110 12 C123 34 138 58 152 79 C168 68 186 54 206 36 C200 64 194 92 190 119"/>
    <path d="M24 132 C80 124 140 124 196 132"/>
  </g>
  <g fill="${C.citron}">
    <circle cx="14" cy="34" r="10"/><circle cx="110" cy="10" r="10"/><circle cx="207" cy="32" r="10"/>
    <path d="M102 96 l8 -12 l8 12 l-8 12z"/>
  </g>
</svg>`;

const PIGGY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 170" width="220" height="170" role="img" aria-label="Tirelire">
  <g fill="none" stroke="${C.lavande}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M58 52 C78 38 112 34 138 40 C150 26 164 22 172 24 C170 36 168 46 172 54 C186 64 194 76 196 88 L208 90 C212 104 210 116 204 122 L192 124 C186 136 176 146 164 150 L162 164 L140 164 L136 154 C118 158 98 158 80 154 L76 164 L54 164 L52 148 C34 136 24 118 24 98 C24 78 36 62 58 52 Z"/>
    <path d="M96 58 C108 54 124 54 136 58"/>
    <path d="M30 96 C18 96 12 88 14 80"/>
  </g>
  <circle cx="160" cy="88" r="7" fill="${C.lavande}"/>
  <rect x="94" y="30" width="48" height="12" rx="6" fill="${C.lavande}" transform="rotate(-6 118 36)"/>
</svg>`;

const BRUSH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 40" width="400" height="40" preserveAspectRatio="none">
  <path fill="${C.citron}" d="M6 22 C40 10 92 8 150 9 C214 10 290 6 352 8 C372 9 388 12 395 17 C388 20 372 21 360 22 C376 25 390 28 392 32 C330 36 250 33 180 34 C120 35 60 37 14 34 C6 33 2 29 6 26 C18 24 26 23 30 22 C22 22 12 23 6 22 Z"/>
  <path fill="${C.citron}" opacity=".55" d="M40 30 C110 28 200 29 300 27 C330 27 356 28 370 30 C300 32 200 33 120 33 C90 33 60 33 40 30 Z"/>
</svg>`;

/* Provisional mascot: an original stylised dog with sunglasses and a travel bag. */
const MASCOT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="Chien à lunettes avec son sac de voyage">
  <rect width="400" height="400" rx="56" fill="#1C1C1C"/>
  <circle cx="320" cy="80" r="34" fill="${C.citron}" opacity=".9"/>
  <path d="M40 330 C120 300 280 300 360 330 L360 400 L40 400 Z" fill="#232323"/>
  <!-- travel bag -->
  <g transform="translate(222 232) rotate(8)">
    <path d="M18 18 C18 -4 76 -4 76 18" fill="none" stroke="#6B4A2B" stroke-width="10" stroke-linecap="round"/>
    <rect x="0" y="16" width="96" height="80" rx="16" fill="#B5793F"/>
    <rect x="0" y="44" width="96" height="12" fill="#8E5C2C"/>
    <rect x="38" y="38" width="20" height="24" rx="4" fill="${C.citron}"/>
    <circle cx="20" cy="30" r="6" fill="${C.lavande}"/><rect x="66" y="70" width="18" height="14" rx="3" fill="#F4F4F0"/>
  </g>
  <!-- body -->
  <path d="M120 360 C110 300 130 252 196 246 C252 242 270 290 262 360 Z" fill="#E8C08A"/>
  <path d="M168 360 C164 318 176 292 198 290 C220 292 230 318 226 360 Z" fill="#F6E3C4"/>
  <!-- ears -->
  <path d="M110 128 C78 140 70 206 92 232 C110 224 122 186 132 152 Z" fill="#8E5C2C"/>
  <path d="M290 128 C322 140 330 206 308 232 C290 224 278 186 268 152 Z" fill="#8E5C2C"/>
  <!-- head -->
  <ellipse cx="200" cy="170" rx="92" ry="86" fill="#E8C08A"/>
  <ellipse cx="200" cy="218" rx="52" ry="40" fill="#F6E3C4"/>
  <!-- sunglasses -->
  <g>
    <rect x="118" y="138" width="72" height="46" rx="18" fill="${C.noir}"/>
    <rect x="210" y="138" width="72" height="46" rx="18" fill="${C.noir}"/>
    <rect x="186" y="150" width="28" height="9" rx="4" fill="${C.noir}"/>
    <path d="M132 148 L150 148" stroke="${C.citron}" stroke-width="6" stroke-linecap="round"/>
    <path d="M224 148 L242 148" stroke="${C.citron}" stroke-width="6" stroke-linecap="round"/>
  </g>
  <!-- nose and smile -->
  <ellipse cx="200" cy="204" rx="18" ry="13" fill="#2A1A10"/>
  <path d="M176 230 C188 244 212 244 224 230" fill="none" stroke="#2A1A10" stroke-width="6" stroke-linecap="round"/>
  <path d="M204 238 C206 252 218 254 220 240" fill="#FF8FA3"/>
  <!-- tiny passport -->
  <g transform="translate(118 290) rotate(-12)">
    <rect width="44" height="58" rx="6" fill="${C.lavande}"/>
    <circle cx="22" cy="24" r="10" fill="none" stroke="${C.lavandeTexte}" stroke-width="4"/>
    <rect x="10" y="42" width="24" height="5" rx="2" fill="${C.lavandeTexte}"/>
  </g>
</svg>`;

/* ---------------- Compositions ---------------- */

function textBlock(lines, { x, y, size, weight = 900, italic = true, color = C.blanc, lh = 1.1 }) {
  return lines.map((line, i) => {
    const fill = typeof line === 'object' ? line.color : color;
    const t = typeof line === 'object' ? line.text : line;
    return `<text x="${x}" y="${y + i * size * lh}" font-family="Montserrat, 'Arial Black', 'Segoe UI Black', sans-serif" font-size="${size}" font-weight="${weight}" ${italic ? 'font-style="italic"' : ''} fill="${fill}">${t}</text>`;
  }).join('\n  ');
}

function ogImage() {
  const w = 1200, hgt = 630;
  const L = logoGroup(70, 70, 440);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}">
  <rect width="${w}" height="${hgt}" fill="${C.noir}"/>
  <circle cx="1080" cy="120" r="260" fill="${C.citron}" opacity=".06"/>
  ${L.g}
  ${textBlock(['Vous avez trop d’argent ?'], { x: 70, y: 330, size: 58 })}
  ${textBlock([{ text: 'Nous avons beaucoup trop', color: C.citron }, { text: 'de problèmes à vous proposer.', color: C.citron }], { x: 70, y: 410, size: 52 })}
  <rect x="70" y="540" width="520" height="44" rx="22" fill="${C.anthracite}" stroke="#2A2A2A"/>
  <text x="96" y="569" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="20" font-weight="600" fill="${C.gris}">Projet test — aucune collecte ni aucun paiement.</text>
</svg>`;
}

function socialPreview() {
  const w = 1280, hgt = 640;
  const L = logoGroup(80, 80, 460);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}">
  <rect width="${w}" height="${hgt}" fill="${C.noir}"/>
  <circle cx="1120" cy="560" r="300" fill="${C.lavande}" opacity=".07"/>
  <circle cx="1060" cy="110" r="220" fill="${C.citron}" opacity=".07"/>
  ${L.g}
  ${textBlock(['The first platform where', 'billionaires can finally find', 'problems worth their money.'], { x: 80, y: 330, size: 46 })}
  ${textBlock([{ text: 'It’s a joke. Mostly.', color: C.citron }], { x: 80, y: 520, size: 46 })}
  <g transform="translate(940 300) rotate(-4) scale(.9)">
    <rect width="300" height="250" rx="20" fill="${C.creme}" stroke="${C.citron}" stroke-width="5"/>
    <rect x="22" y="22" width="56" height="56" rx="12" fill="${C.anthracite}"/>
    <rect x="94" y="34" width="120" height="26" rx="13" fill="${C.lavande}"/>
    <rect x="22" y="100" width="250" height="18" rx="9" fill="#141414"/>
    <rect x="22" y="128" width="190" height="18" rx="9" fill="#141414"/>
    <rect x="22" y="164" width="230" height="12" rx="6" fill="#B9B9B2"/>
    <rect x="22" y="184" width="200" height="12" rx="6" fill="#B9B9B2"/>
    <text x="22" y="230" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600" fill="#55554F">Milliardaires intéressés : 0</text>
  </g>
</svg>`;
}

/** R-042: share image of a category (1200 × 630): logo, category, slogan, a card with the title's place. */
function imagePartage(cat) {
  const w = 1200, hgt = 630;
  const L = logoGroup(70, 64, 360);
  const pill = Math.round(cat.label.length * 17 + 56);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}">
  <rect width="${w}" height="${hgt}" fill="${C.noir}"/>
  <circle cx="1090" cy="110" r="250" fill="${C.citron}" opacity=".07"/>
  <circle cx="160" cy="600" r="220" fill="${C.lavande}" opacity=".06"/>
  ${L.g}
  <rect x="70" y="232" width="${pill}" height="58" rx="29" fill="${C.lavande}"/>
  <text x="98" y="271" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="30" font-weight="600" fill="${C.lavandeTexte}">${cat.label}</text>
  ${textBlock(['Un problème de pauvre'], { x: 70, y: 380, size: 54 })}
  ${textBlock([{ text: 'cherche son milliardaire.', color: C.citron }], { x: 70, y: 444, size: 54 })}
  <rect x="70" y="530" width="640" height="44" rx="22" fill="${C.anthracite}" stroke="#2A2A2A"/>
  <text x="96" y="559" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="20" font-weight="600" fill="${C.gris}">Projet humoristique — aucun argent ne circule entre membres.</text>
  <g transform="translate(800 250) rotate(-5)">
    <rect width="320" height="270" rx="22" fill="${C.creme}" stroke="${C.citron}" stroke-width="6"/>
    <rect x="24" y="24" width="60" height="60" rx="14" fill="${C.anthracite}"/>
    ${questionMark(39, 30, C.citron, 0.22)}
    <rect x="100" y="38" width="150" height="28" rx="14" fill="${C.lavande}"/>
    <rect x="24" y="108" width="270" height="22" rx="11" fill="#141414"/>
    <rect x="24" y="140" width="200" height="22" rx="11" fill="#141414"/>
    <rect x="24" y="180" width="250" height="12" rx="6" fill="#B9B9B2"/>
    <rect x="24" y="200" width="210" height="12" rx="6" fill="#B9B9B2"/>
    <text x="24" y="246" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600" fill="#55554F">Milliardaires intéressés : 0</text>
  </g>
</svg>`;
}

function splash() {
  const L = logoGroup(56, 0, 400);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${C.noir}"/>
  <g transform="translate(0 ${((512 - L.h) / 2).toFixed(1)})">${L.g}</g>
</svg>`;
}

/* ---------------- Write files ---------------- */

function out(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.trim() + '\n', 'utf8');
  console.log('  ✓', path.replace(ROOT, '').replace(/\\/g, '/'));
}

console.log('Generating SVG assets…');
// logo.svg and logo-clair.svg are sources (real Montserrat glyphs): not regenerated.
for (const f of ['logo.svg', 'logo-clair.svg']) {
  if (!existsSync(join(IMG, f))) throw new Error(`Missing source ${f}`);
  console.log('  = site/assets/img/' + f + ' (source, ratio ' + readLogo(f).ratio.toFixed(3) + ')');
}
out(join(IMG, 'favicon.svg'), iconQ({ size: 64, radius: 12 }));
out(join(IMG, 'couronne.svg'), CROWN);
out(join(IMG, 'tirelire.svg'), PIGGY);
out(join(IMG, 'couronne-noire.svg'), CROWN.replaceAll(C.citron, C.noir));
out(join(IMG, 'tirelire-violette.svg'), PIGGY.replaceAll(C.lavande, C.lavandeTexte));
out(join(IMG, 'pinceau.svg'), BRUSH);
out(join(IMG, 'mascotte.svg'), MASCOT);
out(join(IMG, 'question.svg'), iconQ({ size: 256, radius: 0 }).replace(`<rect width="256" height="256" rx="0" fill="${C.noir}"/>`, ''));
// PNG masters (converted by Claude chat, see _interne/BESOINS_IMAGES.md)
out(join(SRC, 'favicon-32.svg'), iconQ({ size: 32, radius: 6 }));
out(join(SRC, 'apple-touch-icon-180.svg'), iconQ({ size: 180 }));
out(join(SRC, 'icone-192.svg'), iconQ({ size: 192, safe: true }));
out(join(SRC, 'icone-512.svg'), iconQ({ size: 512, safe: true }));
out(join(SRC, 'og-image-1200x630.svg'), ogImage());
out(join(SRC, 'splash-512.svg'), splash());
// R-042: share images per category (PNG rendered from these masters: site/assets/img/partage/<id>.png)
for (const cat of CATEGORIES) out(join(SRC, `partage-${cat.id}.svg`), imagePartage(cat));
out(join(ROOT, 'docs/social-preview.svg'), socialPreview());
console.log('Done.');
