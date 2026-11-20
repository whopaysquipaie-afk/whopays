// Sensitive expressions (distress, violence, serious illness, precariousness), R-017 / R-020.
// A problem containing one is NOT rejected: it simply waits for a human review ('recu') instead of
// being published at once. Normalized, whole-word match (same rule as the banned words).
// Used by the demo backend only (the real check runs in SQL). Mirrors the seed of
// supabase/migrations/005_publication_auto.sql as adjusted by 007_mots_sensibles_v2.sql
// (tools/verif.mjs checks that both lists are identical).

import { contientExpression } from './filtres.js';

export const MOTS_SENSIBLES_DEFAUT = [
  'suicide', 'suicider', 'me suicider', 'suicidaire', 'pensees suicidaires', 'idees noires',
  'en finir', 'me tuer', 'vais me tuer', 'me foutre en l air',
  'envie de mourir', 'veux mourir', 'plus envie de vivre', 'me faire du mal', 'me mutiler', 'automutilation',
  'scarif', 'scarifie', 'scarifier', 'scarifiee', 'scarification',
  'viol', 'viols', 'viole', 'violee', 'violer', 'abus sexuel', 'abuse de moi', 'attouchements', 'inceste', 'pedophile',
  'me frappe', 'il me frappe', 'elle me frappe', 'on me frappe', 'me bat', 'violence conjugale', 'violences conjugales',
  'harcelement', 'harcele', 'harcelee', 'cancer', 'chimio', 'chimiotherapie', 'leucemie', 'tumeur', 'maladie grave',
  'je suis enceinte', 'tomber enceinte', 'avortement', 'avorter', 'ivg',
  'sdf', 'a la rue', 'sans abri', 'expulse', 'expulsee', 'expulsion',
  'overdose', 'me drogue', 'je me drogue', 'addiction', 'alcoolique',
  'depression', 'depressif', 'depressive', 'anorexie', 'boulimie'
];

/** True when the text contains a sensitive expression (the problem then waits for a human review). */
export function contientMotSensible(texte, motsSensibles = MOTS_SENSIBLES_DEFAUT) {
  return contientExpression(texte, motsSensibles);
}
