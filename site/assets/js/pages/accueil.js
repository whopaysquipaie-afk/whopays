// Home page (index.html). Lot 0: layout only — sections are wired in lot 2.
import { initLayout, registerServiceWorker } from '../layout.js';
import { siteLabel } from '../config.js';
import { $$ } from '../ui.js';

initLayout({ page: 'accueil' });
for (const el of $$('[data-filigrane]')) el.textContent = siteLabel();
registerServiceWorker();
