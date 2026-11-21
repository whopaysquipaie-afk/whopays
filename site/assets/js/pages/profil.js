// Public profile « Mon CV de pauvre / de riche » (profil.html?c=<code de partage>, R-040).
import { api } from '../api.js';
import { initPage, session } from '../page.js';
import { $, h, formatNumber, formatJour, toastError } from '../ui.js';
import { icon } from '../icons.js';
import { CAMPS } from '../categories.js';
import { carteProbleme } from '../carte.js';
import { montantAffiche, enRiens } from '../riens.js';
import { badgesConnus } from '../badges.js';
import { ordinal } from '../palmares.js';
import { partageNatif, copierLien } from '../partage.js';
import { siteUrl } from '../config.js';
import { boutonSuivre, libelleAbonnes } from '../suivi.js';

await initPage('profil');

const zone = $('#profil');
const code = (new URLSearchParams(location.search).get('c') || '').trim().toUpperCase();

function vide(titre, texte) {
  zone.replaceChildren(h('div', { class: 'introuvable' },
    h('img', { class: 'q-geant', src: 'assets/img/question.svg', alt: '', width: '120', height: '120' }),
    h('h1', {}, titre), h('p', {}, texte),
    h('a', { class: 'btn btn-primaire', href: 'palmares.html' }, 'Voir le palmarès', icon('arrow-right', { className: 'fleche' }))));
  $('main').setAttribute('aria-busy', 'false');
}

/** « Je suis 12ᵉ pauvre du mois avec 23x Rien — et toi ? » (or « Caviar Gauche est … » for someone else). */
export function phraseCV(r, moi) {
  const sujet = moi ? 'Je suis' : `${r.pseudo} est`;
  if (r.camp === 'riche') {
    const n = r.couronnes_donnees ? r.couronnes_donnees.length : 0;
    return `${sujet} riche sur Qui paie ?${n ? ` avec ${formatNumber(n)} couronne${n > 1 ? 's' : ''} distribuée${n > 1 ? 's' : ''}` : ''} — et toi ?`;
  }
  const riens = enRiens(r.total) || '0x Rien';
  if (r.rang_mois && r.rang_mois.rang) return `${sujet} ${ordinal(r.rang_mois.rang)} pauvre du mois avec ${riens} — et toi ?`;
  if (r.rang_general && r.rang_general.rang) return `${sujet} ${ordinal(r.rang_general.rang)} pauvre de Qui paie ? avec ${riens} — et toi ?`;
  return `${moi ? 'Mon' : 'Son'} CV de pauvre : ${riens} de problèmes. Pour l’instant. Et toi ?`;
}

async function charger() {
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)) { vide('Ce CV n’existe pas.', 'Le lien est incomplet ou invalide.'); return; }
  let r;
  try {
    r = await api.getProfilPublic(code);
  } catch (e) {
    if (e.code === 'configuration') { vide('Les CV arrivent bientôt.', 'Cette page n’est pas encore ouverte. Reviens dans un moment.'); return; }
    toastError(e);
    vide('Impossible de charger ce CV.', 'Réessaie dans un instant.');
    return;
  }
  if (!r) { vide('Ce CV est introuvable.', 'Le membre a peut-être quitté le jeu, ou le lien est faux.'); return; }
  const s = session();
  const moi = !!(s && s.profil && s.profil.code_partage === r.code);
  const camp = CAMPS[r.camp] || CAMPS.pauvre;
  document.title = `${r.pseudo} — Mon CV de ${camp.id} — Qui paie ?`;
  const url = siteUrl(`profil.html?c=${encodeURIComponent(r.code)}`);
  const phrase = phraseCV(r, moi);

  const stats = [];
  if (r.camp === 'pauvre') {
    const m = montantAffiche(r.total, { zero: true });
    stats.push(
      h('li', {}, h('small', {}, 'Rang du mois'), h('strong', {}, r.rang_mois && r.rang_mois.rang ? ordinal(r.rang_mois.rang) : '—'),
        h('small', {}, r.rang_mois && r.rang_mois.rang ? `sur ${formatNumber(r.rang_mois.sur)}` : 'pas encore classé ce mois-ci')),
      h('li', {}, h('small', {}, 'Rang général'), h('strong', {}, r.rang_general && r.rang_general.rang ? ordinal(r.rang_general.rang) : '—'),
        h('small', {}, r.rang_general && r.rang_general.rang ? `sur ${formatNumber(r.rang_general.sur)}` : 'pas encore classé')),
      h('li', {}, h('small', {}, 'Total'), h('strong', {}, m.principal), h('small', {}, `soit ${m.euros}`)),
      h('li', {}, h('small', {}, 'Problèmes publiés'), h('strong', {}, formatNumber(r.nb || 0)), h('small', {}, 'tous filtrés, tous anonymes')));
  } else {
    stats.push(
      h('li', {}, h('small', {}, 'Statut'), h('strong', {}, r.statut_riche === 'actif' ? 'Riche validé' : 'En attente'), h('small', {}, r.statut_riche === 'actif' ? 'par un modérateur' : 'de validation')),
      h('li', {}, h('small', {}, 'Couronnes données'), h('strong', {}, formatNumber((r.couronnes_donnees || []).length)), h('small', {}, 'récemment')),
      h('li', {}, h('small', {}, 'Publications'), h('strong', {}, formatNumber((r.problemes || []).length)), h('small', {}, 'visibles')));
  }

  const badges = badgesConnus(r.badges);
  const story = h('button', { type: 'button', class: 'btn btn-secondaire' }, icon('download'), 'Carte story');
  story.addEventListener('click', async () => {
    story.setAttribute('aria-busy', 'true');
    try {
      const { ouvrirStory } = await import('../story.js');
      await ouvrirStory({
        etiquette: `Mon CV de ${camp.id}`, categorie: null, titre: phrase,
        texte: badges.length ? `Badges : ${badges.map((b) => `${b.emoji} ${b.nom}`).join(' · ')}` : 'Pas encore de badge. Ça va venir.',
        montant: null, pseudo: r.pseudo, camp: r.camp
      }, { url });
    } catch (e) { toastError(e); } finally { story.removeAttribute('aria-busy'); }
  });
  const partager = h('button', { type: 'button', class: 'btn btn-primaire' }, icon('share'), moi ? 'Partager mon CV' : 'Partager ce CV');
  partager.addEventListener('click', async () => {
    if (!(await partageNatif({ title: 'Qui paie ?', text: `${phrase} ${url}`, url }))) copierLien(url);
  });

  zone.replaceChildren(
    h('div', { class: 'profil-entete' },
      h('div', { class: `avatar rond camp-${camp.id}`, 'aria-hidden': 'true' }, icon(camp.icon)),
      h('div', { style: { minWidth: '0' } },
        h('p', { class: 'gris petit' }, moi ? 'Mon CV de ' + camp.id : `CV de ${camp.id}`),
        h('h1', { class: 'profil-pseudo', id: 'titre-profil' }, r.pseudo),
        h('p', { class: 'mt-8' }, h('span', { class: `badge badge-${camp.id}` }, icon(camp.icon), `Camp des ${camp.plural}`),
          r.arrive_le ? h('span', { class: 'gris petit' }, ` · arrivé le ${formatJour(r.arrive_le)}`) : null))),
    // R-047: followers + follow button (when 019 is applied)
    'abonnes' in r ? h('div', { class: 'profil-suivi' },
      h('span', { class: 'profil-abonnes' }, libelleAbonnes(r.abonnes)),
      moi ? null : boutonSuivre({ code: r.code, je_suis: r.je_suis, abonnes: r.abonnes, pseudo: r.pseudo },
        { onChange: (n) => { zone.querySelector('.profil-abonnes').textContent = libelleAbonnes(n); } })) : null,
    h('p', { class: 'mt-16 grand' }, phrase),
    h('ul', { class: 'profil-stats' }, stats),
    badges.length
      ? h('ul', { class: 'badges-grille' }, badges.map((b) => h('li', { class: 'badge-tuile' },
        h('span', { class: 'badge-emoji', 'aria-hidden': 'true' }, b.emoji), h('span', {}, h('strong', {}, b.nom), h('small', {}, b.description)))))
      : h('p', { class: 'gris mt-16' }, 'Aucun badge pour l’instant.'),
    h('div', { class: 'hero-actions' }, partager, story));

  const posts = r.problemes || [];
  $('#titre-profil-posts').textContent = r.camp === 'riche' ? 'Ses publications' : (moi ? 'Mes problèmes' : 'Ses problèmes');
  $('#profil-posts').replaceChildren(...(posts.length ? posts.map((p) => carteProbleme(p)) : [h('p', { class: 'gris' }, 'Rien de publié pour l’instant.')]));
  $('#profil-posts-zone').hidden = false;
  if (r.camp === 'riche') {
    const c = r.couronnes_donnees || [];
    $('#profil-couronnes').replaceChildren(...(c.length ? c.map((p) => carteProbleme(p)) : [h('p', { class: 'gris' }, 'Aucune couronne distribuée. Le trésor royal dort.')]));
    $('#profil-couronnes-zone').hidden = false;
  }
  $('main').setAttribute('aria-busy', 'false');
}

document.addEventListener('wp:session-maj', charger);
charger();
