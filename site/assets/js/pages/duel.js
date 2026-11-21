// « Lequel est le plus drôle ? » (duel.html, R-041): two problems of the poor, tap the funniest, endless.
// Visitors can play (IP ceiling in the database). Hidden behind a friendly message while 020 is not applied.
import { api } from '../api.js';
import { initPage } from '../page.js';
import { $, h, formatNumber, toastError, UUID_RE } from '../ui.js';
import { carteProbleme } from '../carte.js';
import { pop } from '../animations.js';
import { partageNatif, copierLien } from '../partage.js';
import { siteUrl } from '../config.js';

await initPage('duel');

const arene = $('#duel-arene');
const compteur = $('#duel-compteur');
const CLE = 'wp:duels-votes';
let duel = [];
let vus = [];
let occupe = false;

const lireVotes = () => { try { return Number(localStorage.getItem(CLE)) || 0; } catch { return 0; } };
function majCompteur() {
  const n = lireVotes();
  compteur.textContent = n ? `${formatNumber(n)} duel${n > 1 ? 's' : ''} voté${n > 1 ? 's' : ''}. Le jury, c'est toi.` : 'Premier duel : à toi de juger.';
}

function indisponible(message) {
  arene.replaceChildren(h('div', { class: 'etat-vide' }, h('p', { class: 'grand' }, 'Le ring est en travaux.'), h('p', {}, message)));
  $('#duel-passer').hidden = true;
  $('#duel-partager').hidden = true;
  $('main').setAttribute('aria-busy', 'false');
}

function afficher(paire) {
  duel = paire;
  vus = [...paire.map((p) => p.id), ...vus].slice(0, 20);
  const choix = paire.map((p, i) => {
    const b = h('button', { type: 'button', class: 'duel-choix', 'aria-label': `Le plus drôle : « ${p.titre} »` }, carteProbleme({ ...p, code_auteur: null }, { lien: false, titreNiveau: 'h2' }), h('p', { class: 'duel-tampon', 'aria-hidden': 'true' }));
    b.addEventListener('click', () => voter(i, choix));
    return b;
  });
  arene.replaceChildren(choix[0], h('span', { class: 'duel-vs', 'aria-hidden': 'true' }, 'VS'), choix[1]);
  $('main').setAttribute('aria-busy', 'false');
}

async function suivant() {
  try {
    const paire = await api.getDuel(vus);
    if (paire.length < 2) { indisponible('Il faut au moins deux problèmes publiés pour un duel. Publie le tien !'); return; }
    afficher(paire);
  } catch (e) {
    if (e.code === 'configuration') { indisponible('Le duel ouvre très bientôt. Reviens dans un moment.'); return; }
    toastError(e);
  }
}

async function voter(i, choix) {
  if (occupe) return;
  occupe = true;
  const gagnant = duel[i];
  const perdant = duel[1 - i];
  choix[i].classList.add('gagnant');
  choix[1 - i].classList.add('perdant');
  choix[i].querySelector('.duel-tampon').textContent = '😂 Le plus drôle !';
  pop(choix[i]);
  try {
    await api.voterDuel(gagnant.id, perdant.id);
    try { localStorage.setItem(CLE, String(lireVotes() + 1)); } catch { /* private mode */ }
    majCompteur();
  } catch (e) {
    if (e.code !== 'invalide') toastError(e);
  }
  setTimeout(async () => { await suivant(); occupe = false; }, 700);
}

async function chargerPlusDroles() {
  let l = [];
  try { l = await api.getPlusDrolesSemaine(5); } catch { return; }
  if (!l.length) return;
  $('#plus-droles').replaceChildren(...l.map((x) => h('li', {},
    h('a', { href: `p.html?id=${encodeURIComponent(x.carte.id)}` }, x.carte.titre),
    h('span', { class: 'gris petit' }, ` · ${formatNumber(x.victoires)} victoire${x.victoires > 1 ? 's' : ''}`))));
  $('#plus-droles-zone').hidden = false;
}

$('#duel-passer').addEventListener('click', () => { if (!occupe) suivant(); });
$('#duel-partager').addEventListener('click', async () => {
  const url = siteUrl(duel.length === 2 ? `duel.html?a=${duel[0].id}&b=${duel[1].id}` : 'duel.html');
  const texte = duel.length === 2
    ? `Lequel est le plus drôle ? « ${duel[0].titre} » ou « ${duel[1].titre} » — vote sur Qui paie ? ${url}`
    : `Lequel est le plus drôle ? Viens voter sur Qui paie ? ${url}`;
  if (!(await partageNatif({ title: 'Le duel — Qui paie ?', text: texte, url }))) copierLien(url);
});

majCompteur();
chargerPlusDroles();
// A shared duel (?a=…&b=…) is shown first when both problems still exist
const q = new URLSearchParams(location.search);
const a = q.get('a');
const b = q.get('b');
if (a && b && UUID_RE.test(a) && UUID_RE.test(b) && a !== b) {
  Promise.all([api.getProblemePublic(a), api.getProblemePublic(b)]).then(([pa, pb]) => {
    if (pa && pb && pa.type === 'pauvre' && pb.type === 'pauvre') afficher([pa, pb]); else suivant();
  }, () => suivant());
} else suivant();
