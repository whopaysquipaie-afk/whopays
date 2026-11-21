// R-037: « Couronner ce problème » (active rich members, 3 crowns per day). Problem page only.
// Shown only when the row carries the crown fields (migration 015 applied).

import { api } from './api.js';
import { h, toast, toastError } from './ui.js';
import { session } from './page.js';
import { ligneCouronne } from './carte.js';
import { pop } from './animations.js';

const richeActif = () => { const s = session(); return !!(s && s.profil && s.profil.camp === 'riche' && s.profil.statut_riche === 'actif'); };

/**
 * Button (or null) for a problem of the poor. `ligne` = the « Couronné par … » element of the card,
 * replaced after each change.
 */
export function boutonCouronne(p, carte) {
  if (p.type !== 'pauvre' || !('couronnes' in p) || !richeActif()) return null;
  let etat = { couronne: !!p.ma_couronne, couronnes: Number(p.couronnes) || 0 };
  const b = h('button', { type: 'button', class: 'btn btn-couronne' });
  const rendre = () => {
    b.replaceChildren(h('span', { 'aria-hidden': 'true' }, '👑 '), etat.couronne ? 'Retirer ma couronne' : 'Couronner ce problème');
    b.setAttribute('aria-pressed', String(etat.couronne));
    const ancienne = carte.querySelector('.carte-couronne');
    const nouvelle = ligneCouronne({ couronnes: etat.couronnes, couronne_par: etat.couronnes === 1 && etat.couronne ? session().profil.pseudo : (etat.couronnes === 1 ? p.couronne_par : null) });
    if (ancienne && nouvelle) ancienne.replaceWith(nouvelle);
    else if (ancienne) ancienne.remove();
    else if (nouvelle) { const m = carte.querySelector('.carte-meta'); if (m) m.before(nouvelle); }
  };
  rendre();
  b.addEventListener('click', async () => {
    b.setAttribute('aria-busy', 'true');
    try {
      const r = etat.couronne ? await api.retirerCouronne(p.id) : await api.couronner(p.id);
      etat = { couronne: r.couronne, couronnes: r.couronnes };
      rendre();
      if (r.couronne) {
        pop(b);
        toast(r.restantes ? `Couronné ! Il te reste ${r.restantes} couronne${r.restantes > 1 ? 's' : ''} aujourd’hui.` : 'Couronné ! C’était ta dernière couronne du jour.');
      } else toast('Couronne retirée. Elle compte quand même dans tes 3 du jour.');
    } catch (e) { toastError(e); } finally { b.removeAttribute('aria-busy'); }
  });
  return h('div', { class: 'bloc-couronne' }, b,
    h('p', { class: 'gris petit mt-8' }, 'Pouvoir de riche : 3 couronnes par jour. Le pauvre est prévenu, et sa gloire grimpe.'));
}
