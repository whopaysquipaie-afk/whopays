// The 10 problem categories (brief visuel §8). Pure data: usable in the browser and in Node.

export const CATEGORIES = [
  { id: 'reve', label: "J'ai un rêve", icon: 'plane' },
  { id: 'factures', label: "J'ai des factures à payer", icon: 'receipt' },
  { id: 'coup-de-pouce', label: "J'ai besoin d'un coup de pouce", icon: 'heart-handshake' },
  { id: 'amour', label: 'Ma vie amoureuse', icon: 'heart' },
  { id: 'famille', label: 'Je veux aider ma famille', icon: 'home-heart' },
  { id: 'patron', label: 'Mon patron', icon: 'briefcase' },
  { id: 'projet', label: "J'ai un projet", icon: 'rocket' },
  { id: 'quotidien', label: 'Mon quotidien', icon: 'shopping-cart' },
  { id: 'plaisir', label: 'Je veux me faire plaisir', icon: 'gift' },
  { id: 'defi', label: 'Mon défi', icon: 'trophy' }
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** The 5 categories shown as tiles on the home page. */
export const HOME_TILES = ['reve', 'factures', 'patron', 'amour', 'projet'];

export function category(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function isCategory(id) {
  return CATEGORY_IDS.includes(id);
}

export const CAMPS = {
  riche: { id: 'riche', label: 'Riche', plural: 'riches', icon: 'crown', club: 'Club des riches' },
  pauvre: { id: 'pauvre', label: 'Pauvre', plural: 'pauvres', icon: 'pig-money', club: 'Club des pauvres' }
};

export const REACTIONS = [
  { id: 'rire', label: 'Mort de rire', emoji: '😂' },
  { id: 'courage', label: 'Courage', emoji: '💪' },
  { id: 'paierais', label: "Si j'étais riche, je paierais", emoji: '💸' }
];

/** R-037: reactions reserved to active rich members (everyone sees the counters). */
export const REACTIONS_RICHES = [
  { id: 'yacht', label: 'Je regarde ça depuis mon yacht', emoji: '🛥️' },
  { id: 'majordome', label: 'Mon majordome s’en occupe', emoji: '🎩' }
];

export const TEAM_PSEUDO = "L'équipe Qui paie ?";
