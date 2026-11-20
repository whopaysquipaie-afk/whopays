// Accessible form fields with immediate validation (same rules as the server, see filtres.js).

import { h, bindCounter, setFieldError } from './ui.js';
import { icon } from './icons.js';
import { verifierChamp, RE_EMAIL_VALIDE } from './filtres.js';
import { CAMPS } from './categories.js';
import { openRules } from './layout.js';

let seq = 0;
const uid = (p) => `${p}-${++seq}`;

/** Text field → { wrap, input, error, validate() → message|null, value() }. opts.check: 'texte'|'email'|'none'. */
export function champ(opts) {
  const id = uid(opts.name || 'champ');
  const errId = `${id}-err`;
  const helpId = opts.help ? `${id}-aide` : null;
  const attrs = {
    id, name: opts.name, required: opts.required !== false, placeholder: opts.placeholder || null,
    autocomplete: opts.autocomplete || 'off', 'aria-describedby': [helpId, errId].filter(Boolean).join(' '),
    maxlength: opts.max ? String(opts.max + 20) : null, inputmode: opts.inputmode || null,
    spellcheck: opts.type === 'email' ? 'false' : null, autocapitalize: opts.type === 'email' ? 'off' : null
  };
  const input = opts.multiline
    ? h('textarea', { ...attrs, rows: opts.rows || 4 })
    : h('input', { ...attrs, type: opts.type || 'text', min: opts.minValue ?? null, max: opts.maxValue ?? null, step: opts.step || null });
  if (opts.value !== undefined && opts.value !== null) input.value = String(opts.value);
  const error = h('p', { class: 'erreur', id: errId, hidden: true, role: 'alert' });
  const counter = opts.max ? h('span', { class: 'compteur', 'aria-hidden': 'true' }) : null;
  const wrap = h('div', { class: 'champ' },
    h('label', { for: id }, opts.label, opts.required === false ? h('span', { class: 'gris' }, ' (facultatif)') : null),
    input,
    opts.help ? h('p', { class: 'aide', id: helpId }, opts.help) : null,
    counter, error
  );
  if (counter) bindCounter(input, counter, opts.max);

  const validate = () => {
    const v = input.value;
    let msg = null;
    if (opts.check === 'email') {
      const e = v.trim();
      msg = !e ? 'Indique ton adresse e-mail.' : (!RE_EMAIL_VALIDE.test(e) || e.length > 254 ? 'Ton adresse e-mail n’a pas l’air valide.' : null);
    } else if (opts.check === 'montant') {
      const t = v.replace(/\s/g, '');
      const min = opts.required === false ? 0 : 1;
      const max = Number(opts.maxValue ?? 1e6);
      const plage = `Indique un montant entier de ${min} à ${max.toLocaleString('fr-FR')} €.`;
      if (t === '') msg = opts.required === false ? null : (opts.messageVide || plage);
      else if (!/^\d+$/.test(t) || Number(t) < min) msg = plage;
      else if (Number(t) > max) msg = opts.messageMax || plage;
    } else if (opts.check !== 'none') {
      if (opts.required === false && v.trim() === '') msg = null;
      else msg = verifierChamp(v, { limites: [opts.min ?? 1, opts.max ?? 300], libelle: opts.libelle || opts.label, multiligne: !!opts.multiline });
    }
    setFieldError(input, error, msg);
    return msg;
  };
  input.addEventListener('blur', () => { if (input.value.trim()) validate(); });
  input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') validate(); });
  return { wrap, input, error, validate, value: () => input.value, focus: () => input.focus() };
}

/** Checkbox with label (children can contain links/buttons). */
export function caseACocher({ name, label, required = false, checked = false }) {
  const id = uid(name);
  const input = h('input', { type: 'checkbox', id, name, required });
  input.checked = checked;
  const wrap = h('label', { class: 'case', for: id }, input, h('span', {}, label));
  return { wrap, input };
}

/** The two big camp cards (brief visuel §7.3). */
export function choixCamp({ name = 'camp', valeur = null } = {}) {
  const group = uid('camp');
  const radios = {};
  const carte = (camp, texte) => {
    const c = CAMPS[camp];
    const input = h('input', { type: 'radio', name: group, value: camp, 'aria-label': `${c.label} — ${texte}` });
    if (valeur === camp) input.checked = true;
    radios[camp] = input;
    return h('label', { class: `choix-camp ${camp}` }, input,
      h('span', { class: 'contenu' }, icon(c.icon), h('strong', {}, c.label), h('span', {}, texte)));
  };
  const error = h('p', { class: 'erreur', hidden: true, role: 'alert' });
  const wrap = h('fieldset', { class: 'champ champ-groupe', name },
    h('legend', { class: 'visually-hidden' }, 'Ton camp'),
    h('div', { class: 'choix-camps' },
      carte('riche', 'J’ai de l’argent mais pas assez de problèmes.'),
      carte('pauvre', 'J’ai plein de problèmes et zéro milliardaire.')),
    error);
  const value = () => (radios.riche.checked ? 'riche' : radios.pauvre.checked ? 'pauvre' : null);
  const validate = () => {
    const msg = value() ? null : 'Choisis ton camp : riche ou pauvre.';
    error.textContent = msg || '';
    error.hidden = !msg;
    return msg;
  };
  for (const r of Object.values(radios)) r.addEventListener('change', validate);
  return { wrap, value, validate, focus: () => radios.riche.focus(), radios };
}

/** Link-like button that opens the rules dialog (inside checkbox labels). */
export function lienRegles(texte = 'règles du jeu') {
  return h('button', { type: 'button', class: 'lien', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openRules(); } }, texte);
}

/** Error box at the bottom of a form. */
export function boiteErreur() {
  const el = h('p', { class: 'erreur-form', role: 'alert', hidden: true });
  return {
    el,
    show(msg) { el.textContent = msg; el.hidden = !msg; },
    hide() { el.hidden = true; el.textContent = ''; }
  };
}

/** Puts a button in loading state (on) or restores its original content (off). */
export function chargement(btn, on, texte = 'Un instant…') {
  if (on) {
    if (!btn._contenu) btn._contenu = Array.from(btn.childNodes);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.replaceChildren(texte);
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (btn._contenu) btn.replaceChildren(...btn._contenu);
  }
}
