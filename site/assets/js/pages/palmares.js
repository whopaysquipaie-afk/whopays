// Le palmarès des pauvres (palmares.html, R-028) — fed by get_palmares() and get_mon_rang().
import { api } from '../api.js';
import { initPage, session } from '../page.js';
import { $, h, clear, formatNumber, toastError } from '../ui.js';
import { icon } from '../icons.js';
import { ordinal, totalRiens, partagerRang } from '../palmares.js';

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
    h('td', { class: 'pseudo' }, l.pseudo, moi ? h('span', { class: 'badge badge-pauvre' }, 'toi') : null),
    h('td', {}, formatNumber(l.nb)),
    h('td', { class: 'total' }, totalRiens(l.total)));
}

async function charger() {
  let p;
  let mon = null;
  try {
    [p, mon] = await Promise.all([api.getPalmares({ limite: 100 }), api.getMonRang().catch(() => null)]);
  } catch (e) {
    toastError(e);
    return;
  }
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
      h('p', { class: 'marche-total' }, totalRiens(l.total)),
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
