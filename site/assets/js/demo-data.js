// Fictional data for demo mode. Everything here is invented. No real person, no real money.
// Pure data: used by api-demo.js (browser + Node).

/** [pseudo, camp, richeMessage?, richeMontant?] — 60 fictional members. */
export const MEMBRES = [
  ['Picsou du 16e', 'riche', 'Je financerais volontiers un voyage scolaire, mais seulement en jet privé.', 50000],
  ['Rentier Masqué', 'riche', 'Prêt à payer des cours de natation à toute une ville. Je possède déjà la piscine.', 120000],
  ['Yacht Club Ginette', 'riche', 'Je cherche un problème qui tient sur un yacht de 40 mètres.', 80000],
  ['Le Marquis', 'riche', null, null],
  ['Caviar Gauche', 'riche', 'Je paierais les factures d’électricité de tout un immeuble. Par principe.', 15000],
  ['Golden Retraité', 'riche', null, null],
  ['Héritière Discrète', 'riche', 'Une boulangerie de quartier qui ne ferme jamais : voilà mon rêve.', 30000],
  ['Monsieur Dividende', 'riche', null, null],
  ['Startupeuse en Série', 'riche', 'J’adore les projets fous. Les plus fous que les miens, ce sera difficile.', 25000],
  ['Baron de la Tech', 'riche', null, null],
  ['Lady Placement', 'riche', null, null],
  ['Tonton Offshore', 'riche', 'Je financerais un tour du monde. Pour moi d’abord, ensuite on voit.', 5000],
  ['Duc des Actions', 'riche', null, null],
  ['Riche par Accident', 'riche', 'J’ai gagné au loto en 2019 et je n’ai toujours pas trouvé de problème à ma taille.', 40000],
  ['Fin de Mois Difficile', 'pauvre'], ['Kevin Découvert', 'pauvre'], ['Nadia Coupons', 'pauvre'],
  ['Le Roi des Pâtes', 'pauvre'], ['Sandrine Soldes', 'pauvre'], ['Marmotte Fauchée', 'pauvre'],
  ['Jojo Agios', 'pauvre'], ['Capitaine Crédit', 'pauvre'], ['Lucie Ticket Resto', 'pauvre'],
  ['Mamie Livret A', 'pauvre'], ['Rayan RSA Rigolo', 'pauvre'], ['Sophie Smic', 'pauvre'],
  ['Tchoupi Endetté', 'pauvre'], ['Bernard Bricole', 'pauvre'], ['Clémence Coloc', 'pauvre'],
  ['Yanis Vélo Volé', 'pauvre'], ['Inès Intérim', 'pauvre'], ['Dédé Dépanneur', 'pauvre'],
  ['La Reine du Vide-Grenier', 'pauvre'], ['Momo Mutuelle', 'pauvre'], ['Gégé Gratuit', 'pauvre'],
  ['Chloé Chômage Party', 'pauvre'], ['Patrick Promo', 'pauvre'], ['Aïcha Appart Minuscule', 'pauvre'],
  ['Le Stagiaire Éternel', 'pauvre'], ['Zoé Zéro Euro', 'pauvre'], ['Hugo Huissier', 'pauvre'],
  ['Fatou Fauchée', 'pauvre'], ['Thomas Trottinette', 'pauvre'], ['Élodie Étudiante', 'pauvre'],
  ['Max Mi-Temps', 'pauvre'], ['Julie Jardin Partagé', 'pauvre'], ['Karim Covoit', 'pauvre'],
  ['Loulou Loyer', 'pauvre'], ['Pierrot Panne', 'pauvre'], ['Samia Système D', 'pauvre'],
  ['Victor Vache à Lait', 'pauvre'], ['Nono Note de Frais', 'pauvre'], ['Emma Économe', 'pauvre'],
  ['Bastien Bouts de Ficelle', 'pauvre'], ['Linda Lessive', 'pauvre'], ['Rémi Remboursement', 'pauvre'],
  ['Mélanie Marché', 'pauvre'], ['Antoine Auto-Stop', 'pauvre'], ['Lila Lentilles', 'pauvre'],
  ['Gaston Grosse Facture', 'pauvre']
];

/** Example problems (badge "Exemple", author "L'équipe Qui paie ?"). Not counted in statistics. */
export const EXEMPLES = [
  ['reve', 'Je veux faire le tour du monde, mais mon compte bancaire refuse de collaborer.', 'Je veux découvrir le Japon, la Nouvelle-Zélande et peut-être même la Lune… Si possible sans vendre un rein.', 6000],
  ['factures', 'EDF connaît mieux mon adresse que mes amis.', 'Ils m’écrivent tous les mois, sans faute. Mes amis, eux, ne savent même pas que j’ai déménagé. Quelqu’un pour régler la note et me rendre un peu de vie sociale ?', 340],
  ['patron', 'Je veux payer le salaire de mon patron ce mois-ci. Il en a plus besoin que moi.', 'Il a dit en réunion que « les temps sont durs pour tout le monde ». Je le crois. Il n’a pu changer sa voiture qu’une seule fois cette année.', 4200],
  ['projet', 'J’ai une idée d’entreprise, mais mon banquier n’a pas autant d’imagination que moi.', 'Un food-truck de croissants qui livre au lit. Mon banquier a ri. Pas le bon rire. Un milliardaire avec de l’imagination ferait l’affaire.', 9000],
  ['quotidien', 'Je voudrais finir le mois sans calculatrice.', 'Juste une fois. Faire les courses sans additionner chaque article de tête et sans reposer le fromage au dernier moment.', 250],
  ['plaisir', 'Je veux acheter une console sans devoir vendre un rein.', 'J’ai fait le calcul : un rein, c’est pas mal, mais j’en ai besoin pour jouer. Dilemme.', 550],
  ['defi', 'Je veux passer un week-end entier sans notification de ma banque.', 'Pas d’alerte « solde faible », pas de « prélèvement rejeté ». Juste moi, un plaid et le silence. Défi de l’année.', null]
];

/** Member problems: [category, title, text, amount|null, member index, status] */
export const PROBLEMES = [
  ['reve', 'Voir une aurore boréale autrement qu’en fond d’écran.', 'Ça fait 6 ans que mon fond d’écran me nargue. Je voudrais vérifier en vrai que les couleurs ne sont pas retouchées.', 2400, 14, 'publie'],
  ['factures', 'Ma facture de chauffage me fait plus froid dans le dos que l’hiver.', 'J’ai baissé à 17 degrés, mis trois pulls et adopté un chat pour la chaleur. La facture n’a pas eu pitié.', 680, 15, 'publie'],
  ['coup-de-pouce', 'Mon frigo fait de l’écho.', 'Quand je l’ouvre, j’entends ma voix revenir. Un coup de pouce pour qu’il retrouve un peu de compagnie.', 150, 16, 'publie'],
  ['amour', 'Je veux inviter quelqu’un au restaurant sans regarder la colonne de droite.', 'Je commande toujours « la même chose que toi » en espérant que l’autre choisisse le moins cher. Ça marche une fois sur deux.', 120, 17, 'publie'],
  ['famille', 'Offrir des vacances à ma mère qui n’en a jamais pris.', 'Elle dit que la mer, « c’est surfait ». Je pense surtout qu’elle n’a jamais pu y aller. Une semaine en Bretagne, même sous la pluie.', 1500, 18, 'publie'],
  ['patron', 'Mon patron m’a demandé de « donner 110 % ». Je n’ai que 100 % de salaire.', 'Les 10 % manquants, quelqu’un peut les financer ? Je suis prêt à donner 110 % de reconnaissance.', 210, 19, 'publie'],
  ['projet', 'Ouvrir un salon de thé pour chats timides.', 'Pas un bar à chats : un lieu où les chats timides peuvent boire un thé sans être dérangés. Le concept est solide. Le budget, moins.', 9500, 20, 'publie'],
  ['quotidien', 'Remplacer mon parapluie qui se retourne au premier souffle.', 'Il a vécu quatre tempêtes et deux trahisons. Il mérite sa retraite, et moi des cheveux secs.', 25, 21, 'publie'],
  ['plaisir', 'Manger un vrai homard une fois dans ma vie.', 'J’ai vu un homard dans un aquarium au supermarché. On s’est regardés. Je pense qu’il savait que je n’avais pas les moyens.', 90, 22, 'publie'],
  ['defi', 'Courir un marathon avec des chaussures qui n’ont pas 9 ans.', 'Mes baskets ont connu trois présidents. Elles ne tiendront pas 42 kilomètres. Moi peut-être.', 140, 23, 'publie'],
  ['reve', 'Prendre le train de nuit jusqu’à Venise en première classe.', 'Avec une couchette, un pyjama en soie et un petit-déjeuner servi par quelqu’un qui m’appelle « Madame ». Une seule fois.', 900, 24, 'publie'],
  ['factures', 'Mon forfait téléphone coûte plus cher que mon téléphone.', 'J’ai payé le téléphone 80 €, le forfait me coûte 35 € par mois depuis 2017. Les maths ne sont pas de mon côté.', 420, 25, 'publie'],
  ['coup-de-pouce', 'Réparer ma voiture qui fait un bruit de dinosaure.', 'Le garagiste a dit « ah, quand même ». Je ne sais pas combien coûte un « ah, quand même », mais j’ai peur.', 1100, 26, 'publie'],
  ['factures', 'Mon ex a gardé l’abonnement de streaming à mon nom.', 'Il regarde des séries tous les soirs avec sa nouvelle copine, sur mon compte. Je paie leur soirée romantique. Au secours.', 14, 27, 'publie'],
  ['famille', 'Acheter un lave-vaisselle à mes parents pour leurs 40 ans de mariage.', 'Ils se disputent depuis 40 ans pour savoir qui fait la vaisselle. Je veux sauver ce mariage.', 450, 28, 'publie'],
  ['patron', 'Mon patron veut « une ambiance start-up ». On a eu un baby-foot, pas d’augmentation.', 'Je suis devenu très fort au baby-foot. Mon propriétaire n’accepte malheureusement pas les buts comme paiement.', 1500, 29, 'publie'],
  ['projet', 'Lancer ma marque de chaussettes dépareillées volontairement.', 'Le monde perd une chaussette sur deux. J’en fais un business. Vendu par trois, jamais assorties.', 8000, 30, 'publie'],
  ['quotidien', 'Avoir une machine à laver qui ne danse pas la salsa.', 'Elle traverse la salle de bain à chaque essorage. Elle est même sortie dans le couloir une fois.', 380, 31, 'publie'],
  ['quotidien', 'Aller au cinéma ET acheter du pop-corn.', 'Le même jour. Dans la même séance. Sans culpabiliser pendant la bande-annonce.', 22, 32, 'publie'],
  ['reve', 'Apprendre le piano à 52 ans.', 'Mes voisins ne sont pas d’accord, mais j’ai un rêve : jouer « La Lettre à Élise » sans m’arrêter au milieu.', 600, 33, 'publie'],
  ['reve', 'Voir l’Islande, ses volcans et ses chevaux à frange.', 'Les chevaux islandais ont une meilleure coupe de cheveux que moi. Je veux voir ça de mes yeux.', 2800, 34, 'publie'],
  ['factures', 'Le contrôle technique m’a contrôlé, techniquement.', 'Quatorze points à corriger. Je n’en connaissais que deux, dont l’autoradio.', 760, 35, 'publie'],
  ['coup-de-pouce', 'Payer mon permis de conduire avant mes 40 ans.', 'J’ai 38 ans, ça devient un sprint. Le code est en poche depuis 2014, il commence à avoir de la valeur historique.', 1600, 36, 'publie'],
  ['amour', 'Offrir une vraie bague, pas celle du distributeur de bonbons.', 'Elle a dit oui avec la bague en plastique. Elle mérite au moins une bague qui ne fond pas au soleil.', 700, 37, 'publie'],
  ['famille', 'Emmener mes neveux à Disneyland sans hypothéquer mon appartement.', 'Je suis le tonton cool. Enfin, je l’étais jusqu’à ce que je regarde les prix des billets.', 900, 38, 'publie'],
  ['patron', 'Mon patron signe ses e-mails « Bisous ». Je voudrais une prime au lieu des bisous.', 'Je ne suis pas contre l’affection, mais mon banquier ne prend pas les bisous en compte.', 300, 39, 'publie'],
  ['projet', 'Monter un groupe de rock de retraités.', 'On est quatre, 287 ans à nous tous, une batterie qui date de 1978. Il nous manque un ampli et un kiné.', 2500, 40, 'publie'],
  ['quotidien', 'Changer mon matelas qui a pris la forme d’un hamac.', 'Je dors en banane depuis trois ans. Mon dos m’a envoyé une lettre de réclamation.', 400, 41, 'publie'],
  ['plaisir', 'Un massage. Un seul. Par un professionnel, pas par mon chat.', 'Mon chat fait de son mieux, mais il a des griffes et aucune formation.', 70, 42, 'publie'],
  ['defi', 'Gravir le mont Blanc avec un équipement qui ne vient pas d’un vide-grenier.', 'Mon piolet est un ancien manche à balai. Le guide a refusé de me prendre au sérieux.', 1800, 43, 'publie'],
  ['reve', 'Dormir une nuit dans une cabane perchée.', 'Petit, j’avais construit une cabane dans un arbre. Elle s’est effondrée. Je veux une revanche, en version adulte.', 250, 44, 'publie'],
  ['factures', 'Ma mutuelle rembourse tout, sauf ce dont j’ai besoin.', 'Les lunettes ? Non. Les dents ? Non. Un séjour en thalasso en Patagonie ? Peut-être, sous conditions.', 520, 45, 'publie'],
  ['coup-de-pouce', 'Racheter un ordinateur qui ne s’éteint pas quand on ouvre deux onglets.', 'Je fais mes candidatures avec un ordinateur qui souffle comme un sèche-cheveux. Il chauffe plus que mon appartement.', 450, 46, 'publie'],
  ['amour', 'Organiser une demande en mariage qui ne finit pas en pique-nique sur un parking.', 'La dernière fois, c’était romantique jusqu’à ce que la voiture du dessus nous klaxonne.', 1200, 47, 'publie'],
  ['famille', 'Payer le permis de ma petite sœur, qui conduit déjà mieux que moi.', 'Elle a 18 ans, elle a réussi le code du premier coup, elle me fait la leçon en voiture. Elle mérite son permis.', 1400, 48, 'publie'],
  ['projet', 'Ouvrir une friperie solidaire dans mon village.', 'Il n’y a plus que la boulangerie et l’église. Je voudrais ajouter un troisième lieu où l’on peut se croiser.', 8000, 49, 'publie'],
  ['quotidien', 'Avoir un vélo assez solide pour mon trajet de 12 kilomètres.', 'Le mien perd une pièce par semaine. Il sera bientôt une trottinette, puis un skateboard.', 350, 50, 'publie'],
  ['reve', 'Voir mon groupe préféré en concert ailleurs qu’au fond du stade.', 'D’où je suis, je vois surtout l’écran géant et la nuque de quelqu’un de très grand.', 180, 51, 'publie'],
  ['defi', 'Faire le tour de France à vélo pour mes 60 ans.', 'Mes genoux disent non, mon cœur dit oui, mon compte en banque n’a pas encore pris position.', 3000, 52, 'publie'],
  ['patron', 'Mon patron m’appelle « champion ». J’aimerais un salaire de champion.', 'Les champions gagnent des millions. Moi, je gagne le droit de fermer le bureau le soir.', 5000, 53, 'publie'],
  ['reve', 'Apprendre à surfer à Biarritz.', 'J’ai déjà la combinaison, trouvée dans une benne. Il me manque les cours et la vague.', 450, 54, 'recu'],
  ['quotidien', 'Une poussette qui ne grince pas à chaque trottoir.', 'Tout le quartier sait quand je sors. Le bébé dort, la poussette hurle.', 260, 55, 'recu'],
  ['projet', 'Créer une appli qui trouve la caisse la plus rapide au supermarché.', 'Je me trompe à chaque fois. Avec des données, je pourrais enfin gagner.', 5000, 56, 'recu'],
  ['plaisir', 'Un week-end à la mer sans calculer le prix des glaces.', 'Deux boules. Avec chantilly. Sans compter.', 300, 57, 'refuse']
];

/** Posts of (active) rich members, R-030: [type 'riche' | 'publication', title|null, text, amount|null, member index] */
export const POSTS_RICHES = [
  ['riche', 'Mon majordome a démissionné par SMS.', 'Il paraît que c’est la mode. Je ne sais même plus où sont rangées mes chaussettes en soie. Ni ce qu’est un tiroir.', 12000, 0],
  ['publication', null, 'Bonjour les pauvres. Je viens de lire tout le mur depuis mon jacuzzi. Très émouvant. Le jacuzzi aussi.', null, 2],
  ['riche', 'Mon deuxième yacht ne rentre pas dans le port.', 'Le capitaine propose de le garer en double file. J’ai refusé : je suis quelqu’un de bien.', 80000, 1],
  ['publication', null, 'Petite pensée pour ceux qui finissent le mois sans calculatrice. Moi, j’ai un comptable. Il a une calculatrice.', null, 8],
  ['riche', 'Le caviar de ma cantine d’entreprise est tiède.', 'Je ne veux pas faire d’histoires, mais on parle d’œufs d’esturgeon, pas d’une soupe de lentilles.', null, 4]
];

/** Comment pool: [text, problem index or -1 for random] */
export const COMMENTAIRES = [
  'Je ne suis pas milliardaire, mais j’ai ri, ça compte ?',
  'Courage ! On est tous passés par là, surtout le passage avec le fromage.',
  'Si je gagne au loto, tu es sur ma liste. Juste après mes dettes.',
  'Mon banquier a la même absence d’imagination. On devrait les présenter.',
  'J’ai partagé à mon oncle qui a un bateau. Il a dit « ah ». C’est un début.',
  'Le meilleur problème du mur, je vote pour.',
  'Je compatis, mon frigo fait aussi de l’écho. On pourrait faire un duo.',
  'Message aux riches : celui-là, il est rentable en fous rires.',
  'Je suis riche et je confirme : ce problème me plaît.',
  'Ça m’a rappelé mon dernier contrôle technique. J’ai pleuré.',
  'Tiens bon, la fin du mois finit toujours par finir.',
  'J’adore. Je partage dans le groupe de la famille.',
  'Si j’étais riche, je paierais. Je ne le suis pas, donc je like.',
  'Je propose qu’on fasse une cagnotte… de blagues. Seulement de blagues.',
  'Le passage sur le chat m’a achevé.',
  'Un milliardaire va forcément tomber dessus, c’est trop bien écrit.',
  'Je me sens moins seul avec ma machine à laver danseuse.',
  'En tant que riche, je trouve ça très instructif.',
  'On y croit !',
  'Franchement, ça mérite un passage au journal de 20 h.'
];

export const CLUB_RICHES = [
  [0, 'Quelqu’un sait où on range un deuxième yacht ? Le premier prend toute la place au port.'],
  [2, 'Ginette ici. J’ai lu le mur, il y a des problèmes formidables. Je n’en ai aucun, c’est vexant.'],
  [4, 'J’ai réagi « Si j’étais riche, je paierais » partout. Ah, mais je suis riche. Malaise.'],
  [8, 'Nouveau défi : passer une journée sans parler de placements. J’ai tenu 11 minutes.'],
  [13, 'Moi j’ai gagné au loto et je ne sais toujours pas comment on dépense « intelligemment ».'],
  [1, 'Rappel du club : personne ne demande ni n’envoie d’argent ici. On rit, c’est tout.'],
  [6, 'J’ai adoré le problème du salon de thé pour chats timides. Je suis un chat timide.'],
  [11, 'Je cherche un problème qui accepte les paiements en coquillages. Pour la blague.'],
  [3, 'Le Marquis salue l’assemblée. Le Marquis n’a rien d’autre à dire.'],
  [9, 'Débat du jour : le jet privé, c’est un problème ou une solution ?']
];

export const CLUB_PAUVRES = [
  [15, 'Bon plan : le marché baisse les prix à 13 h pile. Soyez rapides, les mamies sont redoutables.'],
  [17, 'Pâtes au beurre, pâtes à la tomate, pâtes au rien. Mon menu de la semaine est prêt.'],
  [19, 'Qui d’autre secoue la bouteille de gel douche à l’envers pour le dernier mois ?'],
  [16, 'J’ai trouvé un pull à 2 € au vide-grenier. Il a un trou, mais il a du caractère.'],
  [22, 'Mon ticket resto est périmé depuis hier. Je fais son deuil.'],
  [31, 'Ma machine à laver a encore dansé. Elle est maintenant dans la cuisine.'],
  [24, 'Les riches ont un club avec des yachts, nous on a des recettes de soupe. On gagne.'],
  [27, 'Astuce : la bibliothèque prête des films, des jeux et même du wifi. Le luxe.'],
  [36, 'J’ai réussi le défi « un mois sans découvert ». C’était le mois de février.'],
  [40, 'Rappel : pas de numéro ni d’IBAN ici, sinon le chien à lunettes nous gronde.'],
  [44, 'Fous rires du jour : mon banquier m’a souhaité « un excellent mois ». Il est drôle lui.'],
  [50, 'Qui veut monter un club de vélo ? Il faut juste avoir un vélo. Ou une moitié de vélo.'],
  [33, 'Je suis au chômage, mais je suis très occupé à chercher du travail. C’est un temps plein.'],
  [21, 'Courage à tous pour la fin du mois. On se retrouve de l’autre côté.']
];
