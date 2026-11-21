// Le palmarès des pauvres (palmares.html, R-028) — fed by get_palmares() and get_mon_rang().
import { api } from '../api.js';
import { initPage, session } from '../page.js';
import { $, h, clear, formatNumber, toastError } from '../ui.js';
import { icon } from '../icons.js';
import { ordinal, totalRiens, partagerRang, deMois, rangeeBadges } from '../palmares.js';

await initPage('palmares');

/** Humorous titles of the podium (brief visuel: ton du site). */
const PODIUM = [
  { titre: 'La Couronne en carton', sous: 'Le plus gros tas de problèmes du royaume.', classe: 'or' },
  { titre: 'L’Argent qu’on n’a pas', sous: 'Médaille d’argent. Sans l’argent.', classe: 'argent' },
  { titre: 'Le Bronze du découvert', sous: 'Sur le podium. Pas sur le compte.', classe: 'bronze' }
];

const plur = (n, mot) => `${formatNumber(n)} ${mot}${n > 1 ? 's' : ''}`;

function ligne(l, { moi = false } = {}) {
  return h('tr', { class: moi ? 'moi' : null, 'aria-current': moi ? 'true' : null },
    h('td', { class: 'rang' }, ordinal(l.rang)),
    h('td', { class: 'pseudo' }, l.pseudo, moi ? h('span', { class: 'badge badge-pauvre' }, 'toi') : null, rangeeBadges(l.badges)),
    h('td', {}, formatNumber(l.nb)),
    h('td', { class: 'total' }, ...totalRiens(l.total)));
}

/* R-038: « Ce mois-ci » (default) / « Depuis toujours »; tabs hidden while 016 is not applied. */
let periode = new URLSearchParams(location.search).get('periode') === 'toujours' ? 'toujours' : 'mois';
let saisons = true;
const onglets = $('#palmares-onglets');
for (const b of onglets.querySelectorAll('button')) {
  b.addEventListener('click', () => { periode = b.dataset.periode; charger(); });
}
function majOnglets() {
  onglets.hidden = !saisons;
  for (const b of onglets.querySelectorAll('button')) b.setAttribute('aria-pressed', String(saisons && b.dataset.periode === periode));
  const mois = saisons && periode === 'mois';
  $('#titre-palmares').textContent = mois ? `Le palmarès des pauvres ${deMois()}` : 'Le palmarès des pauvres';
  $('#titre-classement').textContent = mois ? 'Le top 100 du mois' : 'Le top 100';
  $('#palmares-note-mois').hidden = !mois;
}

async function charger() {
  let p;
  let mon = null;
  try {
    if (saisons) {
      try {
        [p, mon] = await Promise.all([api.getPalmares({ limite: 100, periode }), api.getMonRang(periode).catch(() => null)]);
      } catch (e) {
        if (e.code !== 'configuration') throw e;
        saisons = false;  // 016 not applied yet: the all-time leaderboard only
      }
    }
    if (!saisons) [p, mon] = await Promise.all([api.getPalmares({ limite: 100 }), api.getMonRang().catch(() => null)]);
  } catch (e) {
    toastError(e);
    return;
  }
  majOnglets();
  $('#palmares-classes').textContent = p.classes
    ? `${plur(p.classes, 'pauvre')} classé${p.classes > 1 ? 's' : ''}.`
    : '';

  const podium = clear($('#podium'));
  p.lignes.slice(0, 3).forEach((l, i) => {
    const d = PODIUM[i];
    podium.appendChild(h('li', { class: `marche ${d.classe}${mon && mon.rang === l.rang ? ' moi' : ''}` },
      h('span', { class: 'marche-rang', 'aria-hidden': 'true' }, String(l.rang)),
      icon(i === 0 ? 'crown' : 'trophy', { className: 'marche-icone' }),
      h('p', { class: 'marche-titre' }, d.titre),
      h('p', { class: 'marche-pseudo' }, h('span', { class: 'visually-hidden' }, `${ordinal(l.rang)} : `), l.pseudo),
      rangeeBadges(l.badges, { max: 3 }),
      h('p', { class: 'marche-total' }, ...totalRiens(l.total)),
      h('p', { class: 'marche-sous' }, d.sous)));
  });

  const corps = clear($('#palmares-lignes'));
  if (!p.lignes.length) {
    corps.appendChild(h('tr', {}, h('td', { colspan: '4', class: 'etat-vide' },
      h('p', { class: 'grand' }, 'Personne au palmarès.'), h('p', {}, 'Publie le premier problème : tu prends la tête sans effort.'))));
  }
  for (const l of p.lignes) corps.appendChild(ligne(l, { moi: !!(mon && mon.rang === l.rang) }));
  if (mon && mon.rang && mon.rang > p.lignes.length) {
    corps.appendChild(h('tr', { class: 'ellipse', 'aria-hidden': 'true' }, h('td', { colspan: '4' }, '…')));
    corps.appendChild(ligne(mon, { moi: true }));
  }

  const btn = $('#partager-rang');
  btn.hidden = !(mon && mon.rang);
  btn.onclick = () => partagerRang(mon, session() && session().profil ? session().profil.code_partage : null);
  $('main').setAttribute('aria-busy', 'false');
}

document.addEventListener('wp:session-maj', charger);
document.addEventListener('wp:probleme-soumis', charger);
charger();
