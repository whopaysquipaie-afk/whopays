// Les chiffres (chiffres.html) — fed by get_chiffres().
import { api } from '../api.js';
import { initPage } from '../page.js';
import { $, $$, h, clear, formatNumber, formatEuros, toastError, reducedMotion } from '../ui.js';
import { icon } from '../icons.js';
import { category } from '../categories.js';
import { countUp, countUpWhenVisible } from '../animations.js';
import { siteUrl } from '../config.js';
import { partageNatif, copierLien } from '../partage.js';
import { enRiens, montantAffiche } from '../riens.js';

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

/* ---------- R-046: the curve of the Riens, the poorest category of the week, the rush hour (hidden without 023) ---------- */
const PHRASES_HEURE = (hh) => (hh < 6 ? 'les insomniaques ont des problèmes' : hh < 12 ? 'les problèmes se lèvent tôt' : hh < 14 ? 'les problèmes de la pause déj' : hh < 19 ? 'les problèmes du bureau' : 'les problèmes du soir, les plus sincères');
async function chargerPlus() {
  let r;
  try { r = await api.getChiffresPlus(); } catch { return; }
  if (!r || !Array.isArray(r.par_jour) || !r.par_jour.length) return;
  const { courbeRiens } = await import('../courbe.js');
  $('#courbe-riens').replaceChildren(courbeRiens(r.par_jour));
  const tuiles = [];
  if (r.categorie_semaine) {
    const cat = category(r.categorie_semaine.categorie);
    const m = montantAffiche(r.categorie_semaine.total, { zero: true });
    tuiles.push(h('div', { class: 'stat' }, h('div', { class: 'libelle' }, 'Catégorie la plus pauvre de la semaine'),
      h('div', { class: 'nombre nombre-texte' }, cat ? cat.label : r.categorie_semaine.categorie),
      h('div', { class: 'libelle' }, `${m.principal} (${m.euros}) · ${formatNumber(r.categorie_semaine.nb)} problème${r.categorie_semaine.nb > 1 ? 's' : ''}`)));
  }
  if (r.heure_pointe) {
    tuiles.push(h('div', { class: 'stat' }, h('div', { class: 'libelle' }, 'Heure de pointe des problèmes'),
      h('div', { class: 'nombre' }, `${r.heure_pointe.heure} h`),
      h('div', { class: 'libelle' }, `${PHRASES_HEURE(r.heure_pointe.heure)} (30 derniers jours)`)));
  }
  $('#tuiles-semaine').replaceChildren(...tuiles);
  $('#chiffres-plus').hidden = false;
}
chargerPlus();
