// R-035: invisible trap field + minimum filling time for the "Rejoindre" and "Publier" forms.
// A bot that fills the trap, or submits less than 3 s after the form opened, gets a fake success
// and nothing is sent.

export const DELAI_MIN_MS = 3000;

/** Pure rule (tested): trap filled or form submitted too fast. */
export function estRobot(valeurPiege, ecouleMs) {
  return String(valeurPiege || '').trim() !== '' || !(Number(ecouleMs) >= DELAI_MIN_MS);
}

/** { el, estRobot() }: `el` goes inside the form (off-screen, out of the tab order, hidden from assistive tech). */
export function creerPiege() {
  const debut = Date.now();
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', name: 'site_web', tabIndex: -1, autocomplete: 'off', id: `site-web-${debut}` });
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = 'Site web (laisse ce champ vide)';
  const el = document.createElement('div');
  el.className = 'piege';
  el.setAttribute('aria-hidden', 'true');
  el.append(label, input);
  return { el, estRobot: () => estRobot(input.value, Date.now() - debut) };
}
