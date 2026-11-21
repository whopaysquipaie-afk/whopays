// Sharing: WhatsApp, X, Facebook, LinkedIn, copy link, native share.
// Text format (brief dev §6.H): « {titre} » — Qui paie ? {url}, with ?ref= of the member when signed in.

import { siteUrl } from './config.js';
import { h, toast, copyText } from './ui.js';
import { icon } from './icons.js';
// texteProbleme lives in themes.js (pure, unit-tested in Node); re-exported here for the pages
export { texteProbleme } from './themes.js';

export function urlProbleme(id, codeRef = null) {
  return siteUrl(`p.html?id=${encodeURIComponent(id)}${codeRef ? `&ref=${encodeURIComponent(codeRef)}` : ''}`);
}



export function liensReseaux(texte, url) {
  const t = encodeURIComponent(texte);
  const u = encodeURIComponent(url);
  return [
    { id: 'whatsapp', label: 'Partager sur WhatsApp', icon: 'brand-whatsapp', href: `https://wa.me/?text=${t}` },
    { id: 'x', label: 'Partager sur X', icon: 'brand-x', href: `https://twitter.com/intent/tweet?text=${t}` },
    { id: 'facebook', label: 'Partager sur Facebook', icon: 'brand-facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: 'linkedin', label: 'Partager sur LinkedIn', icon: 'brand-linkedin', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` }
  ];
}

export async function partageNatif({ title, text, url, files = null }) {
  if (!navigator.share) return false;
  const data = { title, text, url };
  if (files && navigator.canShare && navigator.canShare({ files })) data.files = files;
  try {
    await navigator.share(data);
    return true;
  } catch (e) {
    return e && e.name === 'AbortError'; // user cancelled: handled
  }
}

export async function copierLien(url) {
  const ok = await copyText(url);
  toast(ok ? 'Lien copié. À toi de jouer !' : 'Impossible de copier le lien. Sélectionne-le à la main.', { type: ok ? 'info' : 'erreur' });
  return ok;
}

/** Row of share buttons. */
export function barrePartage({ texte, url, titre = 'Qui paie ?' }) {
  const row = h('div', { class: 'partage', role: 'group', 'aria-label': 'Partager' });
  for (const l of liensReseaux(texte, url)) {
    row.appendChild(h('a', { class: 'btn-icone', href: l.href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': l.label, title: l.label }, icon(l.icon)));
  }
  row.appendChild(h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Copier le lien', title: 'Copier le lien', onclick: () => copierLien(url) }, icon('link')));
  if (navigator.share) {
    row.appendChild(h('button', {
      type: 'button', class: 'btn-icone', 'aria-label': 'Partager…', title: 'Partager…',
      onclick: () => partageNatif({ title: titre, text: texte, url })
    }, icon('share')));
  }
  return row;
}
