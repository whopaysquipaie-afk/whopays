// UI helpers. User or database content is ALWAYS set with textContent (never innerHTML).

import { icon } from './icons.js';
import { checkAttribute } from './dom-safe.js';

/** h('div', { class, onclick: fn, dataset }, child, 'text', [children]) — strings become text nodes. */
export function h(tag, attrs = {}, ...children) {
  if (!/^[a-z][a-z0-9-]*$/i.test(tag) || /^(script|iframe|object|embed|base|meta|link|style)$/i.test(tag)) {
    throw new Error(`h(): balise refusée (${tag})`);
  }
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') { el.className = value; continue; }
    if (key === 'text') { el.textContent = value; continue; }
    if (key === 'dataset') { Object.assign(el.dataset, value); continue; }
    if (key === 'style' && typeof value === 'object') { Object.assign(el.style, value); continue; }
    // R-004: on* = functions only; URLs = relative, http(s), mailto only
    const verdict = checkAttribute(key, value);
    if (!verdict.ok) {
      console.warn(`h(): ${verdict.reason}`);
      continue;
    }
    if (key.toLowerCase().startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- Formatting ---------------- */

const nf = new Intl.NumberFormat('fr-FR');
export const formatNumber = (n) => nf.format(Number(n) || 0);
export const formatEuros = (n) => `${formatNumber(n)} €`;

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) {
    const j = Math.floor(diff / 86400);
    return j === 1 ? 'hier' : `il y a ${j} jours`;
  }
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** Absolute date, e.g. "20 décembre 2026" (end of a rich member's period, R-029). */
export function formatJour(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatHour(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function plural(n, one, many) {
  return `${formatNumber(n)} ${Math.abs(n) > 1 ? many : one}`;
}

/* ---------------- Toasts ---------------- */

let toastZone = null;
export function toast(message, { type = 'info', duration = 4000 } = {}) {
  if (!toastZone) {
    toastZone = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastZone);
  }
  const el = h('div', { class: `toast${type === 'erreur' ? ' erreur' : ''}` }, message);
  toastZone.appendChild(el);
  setTimeout(() => {
    el.classList.add('sort');
    setTimeout(() => el.remove(), 260);
  }, duration);
  return el;
}

export function toastError(err) {
  const msg = (err && err.message) || 'Oups, quelque chose a coincé. Réessaie dans un instant.';
  return toast(msg, { type: 'erreur', duration: 5000 });
}

/* ---------------- Dialogs ---------------- */

/**
 * Opens a modal <dialog>. Returns { dialog, body, close }.
 * Native <dialog> gives focus trapping, Esc to close and aria-modal semantics.
 */
export function openDialog({ title, content = [], footer = null, onClose = null, labelId = null, className = '' } = {}) {
  const id = labelId || `fenetre-titre-${Math.random().toString(36).slice(2, 8)}`;
  const closeBtn = h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Fermer' }, icon('x'));
  const body = h('div', { class: 'fenetre-corps' }, content);
  const dialog = h('dialog', { class: `fenetre ${className}`.trim(), 'aria-labelledby': id },
    h('div', { class: 'fenetre-entete' }, h('h2', { id }, title), closeBtn),
    body,
    footer ? h('div', { class: 'fenetre-pied' }, footer) : null
  );
  const previousFocus = document.activeElement;
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    if (onClose) onClose(value);
  };
  closeBtn.addEventListener('click', () => close());
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.appendChild(dialog);
  dialog.showModal();
  return { dialog, body, close };
}

/** Promise-based confirmation dialog. Resolves true / false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const ok = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primaire'}` }, confirmLabel);
    const cancel = h('button', { type: 'button', class: 'btn btn-fantome' }, cancelLabel);
    const { close } = openDialog({
      title,
      content: [h('p', {}, message)],
      footer: [cancel, ok],
      onClose: () => resolve(answer)
    });
    cancel.addEventListener('click', () => close());
    ok.addEventListener('click', () => { answer = true; close(); });
    setTimeout(() => cancel.focus(), 30);
  });
}

/* ---------------- "…" menu ---------------- */

let openMenu = null;
function closeOpenMenu() {
  if (openMenu) { openMenu(); openMenu = null; }
}
document.addEventListener('click', closeOpenMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOpenMenu(); });

/**
 * items: [{ label, icon, onSelect, disabled }]
 */
export function dotsMenu(items, { label = 'Plus d\'actions' } = {}) {
  const button = h('button', { type: 'button', class: 'btn-icone', 'aria-label': label, 'aria-haspopup': 'true', 'aria-expanded': 'false' }, icon('dots'));
  const wrap = h('div', { class: 'menu-points' }, button);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const wasOpen = button.getAttribute('aria-expanded') === 'true';
    closeOpenMenu();
    if (wasOpen) return;
    const list = h('ul', { class: 'menu-liste', role: 'menu' },
      items.filter(Boolean).map((item) => h('li', { role: 'none' },
        h('button', {
          type: 'button', role: 'menuitem', disabled: !!item.disabled,
          onclick: (ev) => { ev.stopPropagation(); ev.preventDefault(); closeOpenMenu(); item.onSelect(); }
        }, item.icon ? icon(item.icon) : null, item.label)
      ))
    );
    wrap.appendChild(list);
    button.setAttribute('aria-expanded', 'true');
    const first = list.querySelector('button:not([disabled])');
    if (first) first.focus();
    openMenu = () => { list.remove(); button.setAttribute('aria-expanded', 'false'); };
  });
  return wrap;
}

/* ---------------- Misc ---------------- */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { 'aria-hidden': 'true', style: { position: 'fixed', opacity: '0' } });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/** Reads and validates a URL parameter against a regex. Returns null when invalid. */
export function param(name, pattern) {
  const value = new URLSearchParams(location.search).get(name);
  if (value === null) return null;
  return pattern.test(value) ? value : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Character counter for an input/textarea. */
export function bindCounter(field, counter, max) {
  const update = () => {
    const n = field.value.length;
    counter.textContent = `${n} / ${max}`;
    counter.classList.toggle('limite', n > max);
  };
  field.addEventListener('input', update);
  update();
  return update;
}

/** Sets a field error message (accessible). */
export function setFieldError(field, errorEl, message) {
  if (message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    field.setAttribute('aria-invalid', 'true');
  } else {
    errorEl.textContent = '';
    errorEl.hidden = true;
    field.removeAttribute('aria-invalid');
  }
}
