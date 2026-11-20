// Comments (brief visuel §7.5): list, "…" menu (Signaler / Supprimer / Masquer), form 300 chars.

import { api } from './api.js';
import { h, clear, formatDate, toast, toastError, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { dotsMenu } from './ui.js';
import { badgeCamp } from './carte.js';
import { champ, boiteErreur, chargement } from './champs.js';
import { exigerMembre, estMembre } from './page.js';
import { intent } from './layout.js';
import { signaler, dejaSignale } from './signalement.js';

export function sectionCommentaires(p, { onCount = () => {} } = {}) {
  const list = h('ol', { class: 'commentaires-liste', 'aria-live': 'polite' });
  const plus = h('button', { type: 'button', class: 'btn btn-fantome btn-petit mt-16', hidden: true }, 'Commentaires plus anciens');
  const zoneForm = h('div', {});
  const titre = h('h2', { class: 'sous-titre-bloc', id: 'titre-commentaires' }, 'Commentaires');
  const section = h('section', { 'aria-labelledby': 'titre-commentaires' }, titre, zoneForm, list, plus);
  let avant = null;
  let total = p.commentaires;

  const majTitre = () => {
    titre.textContent = total ? `Commentaires (${total})` : 'Commentaires';
    onCount(total);
  };

  function item(c) {
    const li = h('li', { class: `commentaire${c.masque ? ' masque' : ''}`, dataset: { id: c.id } });
    const corps = h('div', { class: 'commentaire-corps' },
      h('div', { class: 'commentaire-tete' },
        h('span', { class: 'pseudo' }, c.pseudo),
        c.camp ? badgeCamp(c.camp) : null,
        c.est_auteur_probleme ? h('span', { class: 'badge badge-sombre' }, 'Auteur') : null,
        h('time', { class: 'heure', datetime: c.cree_le }, formatDate(c.cree_le))),
      h('p', { class: 'commentaire-texte' }, c.masque ? 'Commentaire masqué' : c.texte)
    );
    li.appendChild(corps);
    if (!c.masque) {
      const items = [];
      if (c.est_moi) {
        items.push({ label: 'Supprimer', icon: 'trash', onSelect: () => supprimer(c, li) });
      } else {
        items.push({
          label: dejaSignale('commentaire', c.id) ? 'Signalé' : 'Signaler', icon: 'flag', disabled: dejaSignale('commentaire', c.id),
          onSelect: () => signaler('commentaire', c.id, { onDone: (r) => { if (r.masque) masquerVisuellement(li); rafraichirMenu(c, li); } })
        });
        if (p.est_mon_probleme) items.push({ label: 'Masquer', icon: 'eye-off', onSelect: () => masquer(c, li) });
      }
      li.appendChild(dotsMenu(items, { label: `Actions sur le commentaire de ${c.pseudo}` }));
    }
    return li;
  }

  function rafraichirMenu(c, li) {
    const neuf = item(c);
    li.replaceWith(neuf);
  }

  function masquerVisuellement(li) {
    li.classList.add('masque');
    li.querySelector('.commentaire-texte').textContent = 'Commentaire masqué';
    const menu = li.querySelector('.menu-points');
    if (menu) menu.remove();
    total = Math.max(0, total - 1);
    majTitre();
  }

  async function supprimer(c, li) {
    const ok = await confirmDialog({ title: 'Supprimer ton commentaire ?', message: 'Il disparaîtra pour de bon.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      await api.supprimerMonCommentaire(c.id);
      li.remove();
      total = Math.max(0, total - 1);
      majTitre();
      toast('Commentaire supprimé.');
    } catch (e) { toastError(e); }
  }

  async function masquer(c, li) {
    const ok = await confirmDialog({ title: 'Masquer ce commentaire ?', message: 'Il sera remplacé par « Commentaire masqué » pour tout le monde.', confirmLabel: 'Masquer' });
    if (!ok) return;
    try {
      await api.masquerCommentaire(c.id);
      masquerVisuellement(li);
      toast('Commentaire masqué.');
    } catch (e) { toastError(e); }
  }

  async function charger(reset = false) {
    try {
      if (reset) { avant = null; clear(list); }
      const rows = await api.getCommentaires(p.id, avant);
      for (const c of rows) list.appendChild(item(c));
      if (rows.length) avant = rows[rows.length - 1].cree_le;
      plus.hidden = rows.length < 50;
      if (reset && !rows.length) list.appendChild(h('li', { class: 'gris vide-commentaires' }, 'Aucun commentaire. Le premier a toujours le meilleur jeu de mots.'));
    } catch (e) { toastError(e); }
  }
  plus.addEventListener('click', () => charger(false));

  function renderForm() {
    clear(zoneForm);
    if (!estMembre()) {
      zoneForm.appendChild(h('div', { class: 'invitation' },
        h('p', {}, 'Rejoins un camp pour commenter.'),
        h('button', { type: 'button', class: 'btn btn-primaire btn-petit', onclick: () => intent('rejoindre', { raison: 'Rejoins un camp pour commenter. 10 secondes, promis.' }) },
          'Rejoindre', icon('arrow-right', { className: 'fleche' }))));
      return;
    }
    const f = champ({ name: 'commentaire', label: 'Ton commentaire', min: 1, max: 300, multiline: true, rows: 2, libelle: 'Ton commentaire', placeholder: 'Drôle, gentil, sans numéro ni lien.' });
    const erreur = boiteErreur();
    const btn = h('button', { type: 'submit', class: 'btn btn-primaire' }, 'Publier');
    const form = h('form', { class: 'commentaire-form', novalidate: true }, h('div', { class: 'ligne' }, f.wrap, btn), erreur.el);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erreur.hide();
      if (f.validate()) { f.focus(); return; }
      exigerMembre(async () => {
        chargement(btn, true, '…');
        try {
          const c = await api.commenter(p.id, f.value());
          f.input.value = '';
          f.input.dispatchEvent(new Event('input'));
          const vide = list.querySelector('.vide-commentaires');
          if (vide) vide.remove();
          list.prepend(item(c));
          total++;
          majTitre();
        } catch (err) {
          erreur.show(err.message);
        } finally {
          chargement(btn, false);
        }
      });
    });
    zoneForm.appendChild(form);
  }

  majTitre();
  renderForm();
  charger(true);
  document.addEventListener('wp:session-maj', () => { renderForm(); charger(true); });
  return section;
}
