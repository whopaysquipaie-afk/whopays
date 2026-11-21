// R-037: on-site notifications (no e-mail): count on the header avatar, list in Mon espace.
// Hidden without a word while migration 015 is not applied (the call fails → nothing is shown).

import { api } from './api.js';
import { h, formatDate, toastError } from './ui.js';
import { majNotifications } from './layout.js';

/** Unread count for the header (null when unavailable). */
export async function rafraichirBadge() {
  try {
    const r = await api.getMesNotifications();
    majNotifications(r.non_lues || 0);
    return r;
  } catch {
    majNotifications(0);
    return null;
  }
}

/** Liens are relative pages of the site only (checked by the database too). */
const lienSur = (l) => (typeof l === 'string' && /^[a-z]+\.html(\?[A-Za-z0-9=&_%.-]*)?(#[a-z-]+)?$/.test(l) ? l : null);

/** "Mes notifications" section for Mon espace, or null when the feature is not available. */
export async function blocNotifications() {
  const r = await rafraichirBadge();
  if (!r) return null;
  const liste = h('ul', { class: 'notifs' });
  const bouton = h('button', { type: 'button', class: 'btn btn-fantome btn-petit mt-16' }, 'Tout marquer comme lu');
  const remplir = (items) => {
    liste.replaceChildren(...(items.length ? items.map((n) => {
      const lien = lienSur(n.lien);
      return h('li', { class: `notif${n.lu ? '' : ' non-lue'}` },
        lien ? h('a', { href: lien }, n.texte) : h('span', {}, n.texte),
        h('time', { datetime: n.cree_le }, formatDate(n.cree_le)));
    }) : [h('li', { class: 'gris' }, 'Rien pour l’instant. Les riches sont sur leur yacht.')]));
    bouton.hidden = !items.some((n) => !n.lu);
  };
  remplir(r.liste || []);
  bouton.addEventListener('click', async () => {
    try {
      await api.marquerNotificationsLues();
      const maj = await rafraichirBadge();
      remplir(maj ? maj.liste : []);
    } catch (e) { toastError(e); }
  });
  return h('section', { class: 'bloc pleine', 'aria-labelledby': 'titre-notifs' },
    h('h2', { id: 'titre-notifs' }, 'Mes notifications', r.non_lues ? h('span', { class: 'pastille-notif-titre' }, ` ${r.non_lues}`) : null),
    liste, bouton);
}
