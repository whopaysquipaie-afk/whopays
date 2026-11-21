// R-039: titles and badges, computed by the database (017_badges.sql) or the demo. Pure data + rendering helpers
// without DOM, usable in Node. The order is the display order.

export const BADGES = {
  or: { emoji: '🥇', nom: 'Pauvre d’or', description: 'Numéro 1 du palmarès du mois.' },
  argent: { emoji: '🥈', nom: 'Pauvre d’argent', description: 'Numéro 2 du palmarès du mois.' },
  bronze: { emoji: '🥉', nom: 'Pauvre de bronze', description: 'Numéro 3 du palmarès du mois.' },
  roi_decouvert: { emoji: '💸', nom: 'Roi du découvert', description: 'Le plus de problèmes « factures » du site.' },
  smicard: { emoji: '🏅', nom: 'Smicard légendaire', description: '20 problèmes publiés.' },
  plafond: { emoji: '🔟', nom: 'Plafond atteint', description: 'Un problème à 10x Rien. Pas un rien de plus.' },
  couronne: { emoji: '👑', nom: 'Couronné', description: 'Un riche a couronné un de tes problèmes.' },
  star_rire: { emoji: '😂', nom: 'Star du rire', description: 'Une publication à 20 « Mort de rire ».' },
  yacht: { emoji: '🛥️', nom: 'Vu depuis un yacht', description: 'Un riche a regardé ton problème depuis son yacht.' },
  mecene: { emoji: '🎩', nom: 'Mécène imaginaire', description: 'Riche ayant distribué 10 couronnes.' },
  rabatteur: { emoji: '🤝', nom: 'Rabatteur', description: '3 personnes invitées avec ton lien.' },
  pipelette: { emoji: '💬', nom: 'Pipelette', description: '30 commentaires. Tu as un avis sur tout.' },
  premier: { emoji: '🌱', nom: 'Premier problème', description: 'Tout commence par un problème.' }
};

export const ORDRE_BADGES = Object.keys(BADGES);

/** Known badges only, in display order (unknown ids from a newer database are ignored). */
export function badgesConnus(ids) {
  const set = new Set(Array.isArray(ids) ? ids : []);
  return ORDRE_BADGES.filter((id) => set.has(id)).map((id) => ({ id, ...BADGES[id] }));
}

/** « 🥇 Pauvre d’or, 🌱 Premier problème » (accessible label of a row of badges). */
export function libelleBadges(ids) {
  return badgesConnus(ids).map((b) => `${b.emoji} ${b.nom}`).join(', ');
}
