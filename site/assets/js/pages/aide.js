// Static pages (aide.html, 404.html): shared layout only.
import { initPage } from '../page.js';

await initPage('aide', { mobileCta: false });
