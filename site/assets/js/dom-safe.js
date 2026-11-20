// Pure safety rules used by ui.js → h(). No DOM access: also tested in Node (tests/contrat.js).

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'srcset', 'data']);
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * True when `value` is a relative path or an http(s)/mailto URL.
 * Blocks javascript:, data:, vbscript:, file:, blob: and obfuscated variants ("java\tscript:", "JaVaScRiPt:").
 */
export function isSafeUrl(value) {
  if (typeof value !== 'string') return false;
  // Browsers ignore ASCII control chars and whitespace inside a scheme: strip them before checking.
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000- \u007f-\u009f]/g, '');
  if (v === '') return true;
  const scheme = v.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  // Relative path. Protocol-relative forms ("//host", "/\host", "\\host") would leave the site: refused.
  if (!scheme) return !/^[\\/]{2}/.test(v);
  return SAFE_SCHEMES.has(scheme[1].toLowerCase() + ':');
}

/**
 * Decides whether h() may set attribute `name` to `value`.
 * Returns { ok: boolean, reason?: string }.
 */
export function checkAttribute(name, value) {
  const n = String(name).toLowerCase();
  if (n.startsWith('on')) {
    return typeof value === 'function'
      ? { ok: true }
      : { ok: false, reason: `attribut ${n} refusé : seul un gestionnaire (fonction) est accepté` };
  }
  if (n === 'srcdoc') return { ok: false, reason: 'attribut srcdoc refusé' };
  if (URL_ATTRS.has(n) && !isSafeUrl(String(value))) {
    return { ok: false, reason: `URL refusée pour ${n} : schéma non autorisé` };
  }
  return { ok: true };
}
