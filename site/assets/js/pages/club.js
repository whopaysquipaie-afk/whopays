// club.html — the club of the member's camp. ?camp=riche|pauvre is only used to show the "reserved" screen.
import { initPage, session } from '../page.js';
import { $, param } from '../ui.js';
import { intent } from '../layout.js';
import { monterClub, ecranReserve } from '../club.js';

await initPage('club', { mobileCta: false });

const main = $('#contenu');
const demande = param('camp', /^(riche|pauvre)$/);
let club = null;

function afficher() {
  if (club) { club.arreter(); club = null; }
  const s = session();
  const profil = s && s.profil;
  if (!profil) {
    ecranReserve(main, { camp: demande, membre: false, onRejoindre: (camp) => intent('rejoindre', { camp, apres: () => {} }) });
    return;
  }
  if (demande && demande !== profil.camp) {
    ecranReserve(main, { camp: demande, membre: true });
    return;
  }
  club = monterClub(main, profil);
}

afficher();
document.addEventListener('wp:session-maj', afficher);
