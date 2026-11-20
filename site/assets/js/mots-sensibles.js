// Sensitive expressions (distress, violence, serious illness, precariousness), R-017.
// A problem containing one is NOT rejected: it simply waits for a human review ('recu') instead of
// being published at once. Normalized, whole-word match (same rule as the banned words).
// Used by the demo backend only (the real check runs in SQL). Mirrors the seed of
// supabase/migrations/005_publication_auto.sql (tools/verif.mjs checks that both lists are identical).

import { contientExpression } from './filtres.js';

export const MOTS_SENSIBLES_DEFAUT = [
  'suicide', 'suicider', 'me suicider', 'suicidaire', 'en finir', 'me tuer', 'me foutre en l air',
  'mourir', 'envie de mourir', 'plus envie de vivre', 'me faire du mal', 'me mutiler', 'automutilation',
  'scarif', 'scarifie', 'scarifier', 'scarifiee', 'scarification',
  'viol', 'viols', 'viole', 'violee', 'violer', 'abus', 'abus sexuel', 'attouchements', 'inceste', 'pedophile',
  'frappe', 'me frappe', 'me bat', 'violence conjugale', 'violences conjugales',
  'harcelement', 'harcele', 'harcelee', 'cancer', 'chimio', 'chimiotherapie', 'leucemie', 'tumeur', 'maladie grave',
  'enceinte', 'avortement', 'avorter', 'ivg', 'sdf', 'a la rue', 'sans abri', 'expulse', 'expulsee', 'expulsion',
  'overdose', 'drogue', 'drogues', 'depression', 'depressif', 'depressive', 'anorexie', 'boulimie'
];

/** True when the text contains a sensitive expression (the problem then waits for a human review). */
export function contientMotSensible(texte, motsSensibles = MOTS_SENSIBLES_DEFAUT) {
  return contientExpression(texte, motsSensibles);
}
