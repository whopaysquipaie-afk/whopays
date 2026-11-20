// desinscription.html?jeton=… (R-031): unticks the newsletter of the member owning the token.
import { api } from '../api.js';
import { initPage } from '../page.js';
import { $, param, UUID_RE } from '../ui.js';

await initPage('desinscription', { mobileCta: false });

const message = $('#desinscription-message');
const jeton = param('jeton', UUID_RE);
let ok = false;
if (jeton) {
  try { ok = await api.seDesinscrire(jeton); } catch { ok = false; }
}
message.textContent = ok
  ? 'C’est fait : tu ne recevras plus nos e-mails (ni les arrivées de riches, ni les nouvelles du projet). Tu peux recocher la case dans Mon espace quand tu veux.'
  : 'Ce lien de désinscription n’est pas (ou plus) valide. Tu peux aussi décocher la case des e-mails dans Mon espace.';
$('main').setAttribute('aria-busy', 'false');
