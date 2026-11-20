// Problem page (p.html?id=…): big card with watermark, reactions, share, story card, comments, report.
import { api } from '../api.js';
import { initPage, allerAuHasard, session } from '../page.js';
import { $, h, clear, param, UUID_RE, dotsMenu, toastError } from '../ui.js';
import { icon } from '../icons.js';
import { carteProbleme, carteSquelette } from '../carte.js';
import { barreReactions } from '../reactions.js';
import { sectionCommentaires } from '../commentaires.js';
import { signaler, dejaSignale } from '../signalement.js';
import { barrePartage, urlProbleme, texteProbleme } from '../partage.js';

await initPage('problemes');

const zoneCarte = $('#zone-carte');
const zoneCote = $('#zone-cote');
const zoneCom = $('#zone-commentaires');
const conteneur = $('#probleme');
const id = param('id', UUID_RE);

function introuvable(message = 'Ce problème est introuvable, ou il n’est pas encore publié.') {
  clear(zoneCarte);
  clear(zoneCote);
  clear(zoneCom);
  zoneCarte.classList.add('introuvable-probleme');
  zoneCarte.appendChild(h('div', { class: 'introuvable' },
    h('img', { class: 'q-geant', src: 'assets/img/question.svg', alt: '', width: '120', height: '120' }),
    h('h1', {}, 'Ce problème-là, on ne l’a pas.'),
    h('p', {}, message),
    h('button', { type: 'button', class: 'btn btn-primaire', onclick: (e) => allerAuHasard(e.currentTarget) }, icon('dice'), 'Tombe sur un problème au hasard')));
  conteneur.setAttribute('aria-busy', 'false');
  document.title = 'Problème introuvable — Qui paie ?';
}

async function charger() {
  if (!id) { introuvable('Le lien de ce problème est incomplet ou invalide.'); return; }
  zoneCarte.appendChild(carteSquelette());
  let p;
  try {
    p = await api.getProblemePublic(id);
  } catch (e) {
    toastError(e);
    introuvable('Impossible de charger ce problème pour le moment. Réessaie dans un instant.');
    return;
  }
  if (!p) { introuvable(); return; }
  afficher(p);
}

function urlPartage(p) {
  const s = session();
  return urlProbleme(p.id, s && s.profil ? s.profil.code_partage : null);
}

function afficher(p) {
  document.title = `${p.titre} — Qui paie ?`;
  clear(zoneCarte);
  clear(zoneCote);
  clear(zoneCom);

  // Card + "…" menu
  const carte = carteProbleme(p, { large: true });
  zoneCarte.appendChild(carte);
  const menu = () => dotsMenu([{
    label: dejaSignale('probleme', p.id) ? 'Signalé — merci' : 'Signaler', icon: 'flag', disabled: dejaSignale('probleme', p.id),
    onSelect: () => signaler('probleme', p.id, { onDone: (r) => {
      zoneCarte.querySelector('.menu-points').replaceWith(menu());
      if (r.masque) introuvable('Ce problème a été masqué après plusieurs signalements. Merci de veiller sur le site.');
    } })
  }], { label: 'Plus d’actions sur ce problème' });
  if (!p.est_mon_probleme) zoneCarte.appendChild(menu());

  // Comments under the card
  zoneCom.appendChild(sectionCommentaires(p));

  // Side column: reactions, actions, share
  const partageZone = h('div', {});
  const renderPartage = () => {
    const url = urlPartage(p);
    clear(partageZone).appendChild(barrePartage({ texte: texteProbleme(p.titre, url), url, titre: p.titre }));
  };
  renderPartage();
  document.addEventListener('wp:session-maj', renderPartage);

  const storyBtn = h('button', { type: 'button', class: 'btn btn-primaire' }, icon('download'), 'Télécharger la carte story');
  storyBtn.addEventListener('click', async () => {
    storyBtn.setAttribute('aria-busy', 'true');
    try {
      const { ouvrirStory } = await import('../story.js');
      await ouvrirStory(p, { url: urlPartage(p) });
    } catch (e) { toastError(e); } finally { storyBtn.removeAttribute('aria-busy'); }
  });
  const autre = h('button', { type: 'button', class: 'btn btn-secondaire' }, icon('dice'), 'Tombe sur un autre problème');
  autre.addEventListener('click', () => allerAuHasard(autre, { sauf: p.id }));

  zoneCote.append(
    h('div', { class: 'bloc' },
      h('h2', {}, 'Ta réaction'),
      barreReactions(p),
      h('div', { class: 'actions-probleme' }, storyBtn, autre),
      h('h3', { class: 'mt-24' }, 'Fais-le circuler'),
      h('p', { class: 'gris petit mt-8' }, 'Plus il circule, plus un milliardaire a de chances de tomber dessus. Aucun argent ne transite par ici.'),
      partageZone
    )
  );
  conteneur.setAttribute('aria-busy', 'false');
}

charger();
