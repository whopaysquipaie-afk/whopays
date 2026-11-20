// Reporting (brief dev §6.E): one report per member and per target; button disabled afterwards.

import { api } from './api.js';
import { toast, toastError } from './ui.js';
import { exigerMembre, session } from './page.js';

const key = () => `whopays_signales_${(session() && session().userId) || 'visiteur'}`;

function lire() {
  try { return new Set(JSON.parse(localStorage.getItem(key()) || '[]')); } catch { return new Set(); }
}

function ajouter(id) {
  try {
    const s = lire();
    s.add(id);
    localStorage.setItem(key(), JSON.stringify([...s].slice(-500)));
  } catch { /* ignore */ }
}

export function dejaSignale(type, id) {
  return lire().has(`${type}:${id}`);
}

/** Reports a target. `onDone({ masque })` is called on success. */
export function signaler(type, id, { onDone = () => {} } = {}) {
  exigerMembre(async () => {
    if (dejaSignale(type, id)) { toast('Merci, on regarde ça.'); return; }
    try {
      const r = await api.signaler(type, id);
      ajouter(`${type}:${id}`);
      toast('Merci, on regarde ça.');
      onDone(r);
    } catch (e) {
      if (e.code === 'deja_fait') {
        ajouter(`${type}:${id}`);
        toast('Merci, on regarde ça.');
        onDone({ masque: false });
      } else {
        toastError(e);
      }
    }
  }, { raison: 'Rejoins un camp pour signaler un contenu.' });
}
