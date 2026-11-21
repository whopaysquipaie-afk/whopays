// R-045: the « 1x Rien » banknote (1600 × 800 PNG) with the member's pseudo and rank, for social networks.
// Drawn on a canvas from the profile data; no database. Loaded on demand (profile page).
// Clearly worthless on purpose: « SANS AUCUNE VALEUR » (brief visuel §10: no promise of money).

import { siteLabel } from './config.js';
import { h, openDialog, toast, toastError } from './ui.js';
import { icon } from './icons.js';
import { partageNatif } from './partage.js';

const W = 1600;
const H = 800;
const C = { noir: '#0B0B0B', citron: '#C6F432', lavande: '#DCD3FF', lavandeTexte: '#3B2A8C', creme: '#F4F4F0', gris: '#55554F' };
const TITRE = '"Montserrat", "Segoe UI Black", "Arial Black", sans-serif';
const TEXTE = '"Inter", "Segoe UI", system-ui, sans-serif';

const image = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; });

/** « N° RIEN-ABCD-EFGH » from the share code (or a fixed number). */
export const numeroBillet = (code) => {
  const c = /^[A-Z2-9]{8}$/.test(String(code || '')) ? code : 'QUIPAIE0';
  return `N° RIEN-${c.slice(0, 4)}-${c.slice(4)}`;
};

export async function dessinerBillet({ pseudo, rang, code }) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch { /* ignore */ }
  const [couronne, tirelire] = await Promise.all([image('assets/img/couronne-noire.svg'), image('assets/img/tirelire-violette.svg')]);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  // paper + frame
  x.fillStyle = C.citron; x.fillRect(0, 0, W, H);
  x.fillStyle = C.creme; x.fillRect(36, 36, W - 72, H - 72);
  x.strokeStyle = C.noir; x.lineWidth = 6; x.strokeRect(56, 56, W - 112, H - 112);
  // guilloche
  x.save(); x.globalAlpha = 0.12; x.strokeStyle = C.lavandeTexte; x.lineWidth = 2;
  for (let i = 0; i < 26; i++) { x.beginPath(); x.ellipse(1180, 400, 60 + i * 11, 40 + i * 8, i * 0.12, 0, Math.PI * 2); x.stroke(); }
  x.restore();
  // big « 1 » in the corners
  x.fillStyle = C.noir; x.font = `italic 900 120px ${TITRE}`;
  x.fillText('1', 90, 190); x.fillText('1', W - 170, H - 100);
  // header
  x.font = `italic 900 54px ${TITRE}`; x.fillText('BANQUE CENTRALE DU RIEN', 230, 150);
  x.font = `600 26px ${TEXTE}`; x.fillStyle = C.gris;
  x.fillText('Émis par Qui paie ? — garanti par absolument personne', 232, 192);
  // value
  x.fillStyle = C.noir; x.font = `italic 900 190px ${TITRE}`; x.fillText('1x Rien', 220, 420);
  x.fillStyle = C.lavandeTexte; x.font = `italic 900 40px ${TITRE}`; x.fillText('SANS AUCUNE VALEUR', 230, 480);
  // holder
  x.fillStyle = C.noir; x.font = `600 30px ${TEXTE}`; x.fillText('Titulaire :', 230, 560);
  const decalage = 230 + x.measureText('Titulaire : ').width + 8;
  x.font = `italic 900 46px ${TITRE}`;
  const nom = String(pseudo || 'Membre anonyme').slice(0, 30);
  x.fillText(nom, decalage, 562);
  x.font = `600 30px ${TEXTE}`; x.fillStyle = C.gris;
  x.fillText(rang || 'Pauvre en devenir', 230, 612);
  x.fillText(numeroBillet(code), 230, 656);
  // portrait medallion
  x.fillStyle = C.lavande; x.beginPath(); x.arc(1180, 400, 190, 0, Math.PI * 2); x.fill();
  x.strokeStyle = C.noir; x.lineWidth = 6; x.stroke();
  if (tirelire) x.drawImage(tirelire, 1060, 330, 240, 185);
  if (couronne) x.drawImage(couronne, 1110, 220, 140, 95);
  // footer
  x.fillStyle = C.noir; x.font = `600 22px ${TEXTE}`;
  x.fillText(`Ce billet ne vaut rien. Littéralement. Aucun argent ne circule sur ${siteLabel()}`, 230, H - 80);
  return cv;
}

export async function ouvrirBillet(donnees, { url }) {
  let cv;
  try { cv = await dessinerBillet(donnees); } catch (e) { toastError(e); return; }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  if (!blob) { toastError({ message: 'Impossible de créer l’image sur ce navigateur.' }); return; }
  const objectUrl = URL.createObjectURL(blob);
  const fichier = new File([blob], 'billet-1x-rien.png', { type: 'image/png' });
  const apercu = h('img', { alt: `Billet de 1x Rien au nom de ${donnees.pseudo}`, width: '320', height: '160', class: 'billet-apercu' });
  apercu.src = objectUrl;
  const telecharger = h('a', { class: 'btn btn-primaire', download: fichier.name }, icon('download'), 'Télécharger');
  telecharger.href = objectUrl;
  telecharger.addEventListener('click', () => toast('Billet imprimé. Ne le dépense pas tout de suite.'));
  const peut = navigator.canShare && navigator.canShare({ files: [fichier] });
  const partager = peut ? h('button', { type: 'button', class: 'btn btn-secondaire', onclick: () => partageNatif({ title: 'Qui paie ?', text: `Mon billet de 1x Rien sur Qui paie ? ${url}`, url, files: [fichier] }) }, icon('share'), 'Partager') : null;
  openDialog({
    title: 'Ton billet de 1x Rien',
    content: [h('div', { class: 'billet-zone' }, apercu), h('p', { class: 'gris petit centre mt-16' }, 'Format 1 600 × 800. Sans aucune valeur, garanti.')],
    footer: [partager, telecharger],
    onClose: () => setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  });
}
