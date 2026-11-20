// Story card (brief visuel §7.6): 1080 × 1920 canvas, downloadable PNG, native file share on mobile.

import { siteLabel } from './config.js';
import { h, openDialog, toast, toastError, formatEuros } from './ui.js';
import { icon } from './icons.js';
import { category, CAMPS } from './categories.js';
import { partageNatif } from './partage.js';

const W = 1080;
const H = 1920;
const C = { noir: '#0B0B0B', anthracite: '#161616', bordure: '#2A2A2A', blanc: '#FFFFFF', gris: '#A3A3A3', citron: '#C6F432', lavande: '#DCD3FF', lavandeTexte: '#3B2A8C' };
const TITRE = '"Montserrat", "Segoe UI Black", "Arial Black", sans-serif';
const TEXTE = '"Inter", "Segoe UI", system-ui, sans-serif';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Logo A (Montserrat Black Italic glyphs): viewBox only, width / height ratio 3.958.
const LOGO_RATIO = 7468 / 1887;

/**
 * Loads an SVG that has a viewBox but no width / height (the logo) with an explicit
 * intrinsic size, so that every browser can draw it on a canvas (Firefox refuses otherwise).
 */
async function loadSvgSized(src, width, height) {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    const text = (await res.text()).replace(/<svg\b(?![^>]*\swidth=)/, `<svg width="${width}" height="${height}"`);
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    if (img) return img;
  } catch { /* fall back to a plain load */ }
  return loadImage(src);
}

/** Splits text into lines that fit `maxWidth`. */
function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsize(ctx, lines, max, maxWidth) {
  if (lines.length <= max) return lines;
  const out = lines.slice(0, max);
  let last = out[max - 1];
  while (ctx.measureText(`${last}…`).width > maxWidth && last.length) last = last.slice(0, -1);
  out[max - 1] = `${last.replace(/[\s,.;:]+$/, '')}…`;
  return out;
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function brush(ctx, x, y, w, hgt, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + hgt * 0.5);
  ctx.bezierCurveTo(x + w * 0.2, y, x + w * 0.6, y + hgt * 0.1, x + w, y + hgt * 0.25);
  ctx.bezierCurveTo(x + w * 1.01, y + hgt * 0.6, x + w * 0.7, y + hgt, x + w * 0.3, y + hgt * 0.92);
  ctx.bezierCurveTo(x + w * 0.1, y + hgt * 0.9, x - w * 0.01, y + hgt * 0.8, x, y + hgt * 0.5);
  ctx.fill();
  ctx.restore();
}

/** The keyword in lemon: the longest word of the title (≥ 6 letters), if any. */
function motCle(titre) {
  const words = titre.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}’'-]/gu, ''));
  const best = words.filter((w) => w.length >= 6).sort((a, b) => b.length - a.length)[0];
  return best || null;
}

/** Draws the story card. Returns the canvas. */
export async function dessinerStory(p) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch { /* ignore */ }
  const LOGO_W = 430;
  const LOGO_H = Math.round(LOGO_W / LOGO_RATIO);
  const [logo, couronne] = await Promise.all([loadSvgSized('assets/img/logo.svg', LOGO_W, LOGO_H), loadImage('assets/img/couronne.svg')]);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const M = 96; // margin
  const largeur = W - M * 2;

  // Background + decorations
  ctx.fillStyle = C.noir;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = C.citron;
  ctx.beginPath(); ctx.arc(W - 60, 300, 360, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.lavande;
  ctx.beginPath(); ctx.arc(80, H - 380, 300, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  brush(ctx, M - 10, 300, 360, 34, C.citron, 0.95);

  // Logo A
  let y = 120;
  if (logo) {
    ctx.drawImage(logo, M - 10, y, LOGO_W, LOGO_H);
    y += LOGO_H;
  }
  if (couronne) {
    ctx.save();
    ctx.translate(W - M - 150, 150);
    ctx.rotate(0.18);
    ctx.drawImage(couronne, 0, 0, 170, 116);
    ctx.restore();
  }

  // Category pill
  y = 470;
  const cat = category(p.categorie);
  ctx.font = `600 38px ${TEXTE}`;
  const label = cat ? cat.label : 'Problème';
  const pw = ctx.measureText(label).width + 64;
  ctx.fillStyle = C.lavande;
  roundRect(ctx, M, y, pw, 76, 38);
  ctx.fill();
  ctx.fillStyle = C.lavandeTexte;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, M + 32, y + 40);
  if (p.est_exemple) {
    ctx.font = `600 32px ${TEXTE}`;
    const ew = ctx.measureText('Exemple').width + 48;
    ctx.fillStyle = '#DADAD4';
    roundRect(ctx, M + pw + 16, y + 6, ew, 64, 32);
    ctx.fill();
    ctx.fillStyle = '#3A3A36';
    ctx.fillText('Exemple', M + pw + 40, y + 40);
  }
  ctx.textBaseline = 'alphabetic';

  // Title (Montserrat Black Italic, auto size, keyword in lemon)
  y += 150;
  let size = 96;
  let lignes;
  for (;;) {
    ctx.font = `italic 900 ${size}px ${TITRE}`;
    lignes = wrap(ctx, p.titre, largeur);
    if (lignes.length <= 5 || size <= 64) break;
    size -= 6;
  }
  lignes = ellipsize(ctx, lignes, 6, largeur);
  const cle = motCle(p.titre);
  for (const ligne of lignes) {
    y += size * 1.08;
    let x = M;
    for (const [i, mot] of ligne.split(' ').entries()) {
      const nu = mot.replace(/[^\p{L}\p{N}’'-]/gu, '');
      ctx.fillStyle = cle && nu === cle ? C.citron : C.blanc;
      const txt = i === 0 ? mot : ` ${mot}`;
      ctx.fillText(txt, x, y);
      x += ctx.measureText(txt).width;
    }
  }

  // Excerpt
  y += 70;
  ctx.font = `400 42px ${TEXTE}`;
  ctx.fillStyle = '#D4D4D4';
  for (const l of ellipsize(ctx, wrap(ctx, p.texte, largeur), 5, largeur)) {
    y += 62;
    ctx.fillText(l, M, y);
  }

  // Amount + "Milliardaires intéressés : 0"
  y = Math.max(y + 110, 1330);
  if (p.montant) {
    ctx.font = `italic 900 84px ${TITRE}`;
    ctx.fillStyle = C.blanc;
    const m = formatEuros(p.montant);
    ctx.fillText(m, M, y);
    const mw = ctx.measureText(m).width;
    ctx.font = `600 40px ${TEXTE}`;
    ctx.fillStyle = C.gris;
    ctx.fillText(' recherchés', M + mw + 8, y);
    y += 80;
  }
  ctx.font = `600 44px ${TEXTE}`;
  ctx.fillStyle = C.citron;
  ctx.fillText('Milliardaires intéressés : 0', M, y);

  // Author + camp badge
  y += 110;
  ctx.font = `600 42px ${TEXTE}`;
  ctx.fillStyle = C.blanc;
  const pseudo = String(p.pseudo).slice(0, 34);
  ctx.fillText(pseudo, M, y);
  const camp = CAMPS[p.camp];
  if (camp) {
    const x = M + ctx.measureText(pseudo).width + 24;
    ctx.font = `600 32px ${TEXTE}`;
    const bw = ctx.measureText(camp.label).width + 48;
    ctx.fillStyle = camp.id === 'riche' ? C.citron : C.lavande;
    roundRect(ctx, x, y - 42, bw, 56, 28);
    ctx.fill();
    ctx.fillStyle = camp.id === 'riche' ? C.noir : C.lavandeTexte;
    ctx.fillText(camp.label, x + 24, y - 3);
  }

  // Footer: "Qui paie ?" + site address
  ctx.fillStyle = C.anthracite;
  ctx.fillRect(0, H - 220, W, 220);
  ctx.fillStyle = C.bordure;
  ctx.fillRect(0, H - 220, W, 2);
  ctx.font = `italic 900 64px ${TITRE}`;
  ctx.fillStyle = C.blanc;
  ctx.fillText('Qui paie ', M, H - 110);
  ctx.fillStyle = C.citron;
  ctx.fillText('?', M + ctx.measureText('Qui paie ').width, H - 110);
  ctx.font = `600 38px ${TEXTE}`;
  ctx.fillStyle = C.gris;
  ctx.fillText(siteLabel(), M, H - 52);
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

function nomFichier(p) {
  const slug = String(p.titre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `qui-paie-${slug || 'carte'}.png`;
}

/** Opens a preview dialog with "Télécharger" and (mobile) "Partager". */
export async function ouvrirStory(p, { url }) {
  let canvas;
  try {
    canvas = await dessinerStory(p);
  } catch (e) {
    toastError(e);
    return;
  }
  const blob = await toBlob(canvas);
  if (!blob) { toastError({ message: 'Impossible de créer l’image sur ce navigateur.' }); return; }
  const objectUrl = URL.createObjectURL(blob);
  const fichier = new File([blob], nomFichier(p), { type: 'image/png' });
  // blob: URLs are generated here from our own canvas: set directly (h() only accepts http(s)/relative URLs).
  const apercu = h('img', { alt: `Carte story du problème « ${p.titre} »`, width: '270', height: '480', class: 'story-apercu' });
  apercu.src = objectUrl;
  const telecharger = h('a', { class: 'btn btn-primaire', download: fichier.name }, icon('download'), 'Télécharger');
  telecharger.href = objectUrl;
  telecharger.addEventListener('click', () => toast('Carte téléchargée. Direction ta story !'));
  const peutPartager = navigator.canShare && navigator.canShare({ files: [fichier] });
  const partager = peutPartager
    ? h('button', { type: 'button', class: 'btn btn-secondaire', onclick: () => partageNatif({ title: 'Qui paie ?', text: `« ${p.titre} » — Qui paie ? ${url}`, url, files: [fichier] }) }, icon('share'), 'Partager')
    : null;
  openDialog({
    title: 'Ta carte story',
    content: [h('div', { class: 'story-zone' }, apercu), h('p', { class: 'gris petit centre mt-16' }, 'Format 1 080 × 1 920, prêt pour Instagram, TikTok ou WhatsApp.')],
    footer: [partager, telecharger],
    onClose: () => setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  });
}
