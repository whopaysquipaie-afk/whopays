// Les chiffres (chiffres.html) — fed by get_chiffres().
import { api } from '../api.js';
import { initPage } from '../page.js';
import { $, $$, h, clear, formatNumber, formatEuros, toastError, reducedMotion } from '../ui.js';
import { icon } from '../icons.js';
import { category } from '../categories.js';
import { countUp, countUpWhenVisible } from '../animations.js';
import { siteUrl } from '../config.js';
import { partageNatif, copierLien } from '../partage.js';
import { enRiens } from '../riens.js';

await initPage('chiffres');

let chiffres = null;

async function charger() {
  try {
    chiffres = await api.getChiffres();
  } catch (e) {
    toastError(e);
    return;
  }
  const c = chiffres;
  // R-032: the total in Riens in big, the euros after, small
  countUp($('#montant-total'), c.montant_total, { duration: 1600, format: (n) => enRiens(n) || '0x Rien' });
  const elEuros = $('#riens-total');
  elEuros.textContent = `soit ${formatEuros(c.montant_total)}`;
  elEuros.hidden = false;
  for (const el of $$('[data-compteur]')) countUpWhenVisible(el, c[el.dataset.compteur]);
  for (const el of $$('[data-chiffre]')) countUpWhenVisible(el, c[el.dataset.chiffre]);

  const total = c.riches + c.pauvres;
  const part = total ? Math.round((c.riches / total) * 1000) / 10 : 50;
  $('#rapport .part-riche').style.width = `${Math.max(2, Math.min(98, part))}%`;
  $('[data-part="riche"]').textContent = `Riches ${formatNumber(part)} %`;
  $('[data-part="pauvre"]').textContent = `Pauvres ${formatNumber(Math.round((100 - part) * 10) / 10)} %`;
  $('#rapport .rapport-barre').setAttribute('aria-label', `Rapport de force : ${formatNumber(c.riches)} riches contre ${formatNumber(c.pauvres)} pauvres`);

  const ul = clear($('#barres-categories'));
  const max = Math.max(1, ...c.par_categorie.map((x) => x.nombre));
  if (!c.par_categorie.length) {
    ul.appendChild(h('li', { class: 'etat-vide' }, h('p', { class: 'grand' }, 'Pas encore de classement.'), h('p', {}, 'Le premier problème publié prendra la tête. Facile.')));
  }
  for (const x of c.par_categorie) {
    const cat = category(x.categorie);
    if (!cat) continue;
    const rempli = h('div', { class: 'rempli' });
    ul.appendChild(h('li', { class: 'barre-ligne' },
      h('span', { class: 'etiquette' }, icon(cat.icon), cat.label),
      h('span', { class: 'valeur' }, `${formatNumber(x.nombre)} problème${x.nombre > 1 ? 's' : ''}`),
      h('div', { class: 'piste', 'aria-hidden': 'true' }, rempli)
    ));
    const width = `${Math.round((x.nombre / max) * 100)}%`;
    if (reducedMotion()) rempli.style.width = width;
    else requestAnimationFrame(() => requestAnimationFrame(() => { rempli.style.width = width; }));
  }
  ul.setAttribute('aria-busy', 'false');
}

$('#partager-chiffres').addEventListener('click', async () => {
  const url = siteUrl('chiffres.html');
  const montant = chiffres ? `${enRiens(chiffres.montant_total) || '0x Rien'} (soit ${formatEuros(chiffres.montant_total)})` : 'Des tas de Riens';
  const texte = `${montant} de problèmes en attente d'un milliardaire. 0x Rien financé. — Qui paie ? ${url}`;
  const ok = await partageNatif({ title: 'Les chiffres — Qui paie ?', text: texte, url });
  if (!ok) await copierLien(texte);
});

charger();
