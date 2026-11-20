// espace.html — Mon espace.
import { initPage } from '../page.js';
import { $ } from '../ui.js';
import { monterEspace } from '../espace.js';

await initPage('espace');
const zone = $('#espace');
monterEspace(zone);
document.addEventListener('wp:session-maj', () => monterEspace(zone));
document.addEventListener('wp:espace-recharger', () => monterEspace(zone));
document.addEventListener('wp:probleme-soumis', () => monterEspace(zone));
