-- =====================================================================
-- Qui paie ? / Who pays? — seed: the 7 example problems
-- Same as EXEMPLES in site/assets/js/demo-data.js. Badge "Exemple", author "L'équipe Qui paie ?",
-- never counted in the statistics (est_exemple = true, user_id = null, already published).
-- Idempotent: an example is skipped when an example with the same title already exists.
-- Each example gets its own timestamp (one minute apart, the last one is the newest) so that
-- the wall order is stable and date-based pagination never skips one.
-- =====================================================================

insert into public.problems (user_id, categorie, titre, texte, montant, statut, est_exemple, masque, cree_le, modere_le)
select null, e.categorie, e.titre, e.texte, e.montant, 'publie', true, false,
       now() - make_interval(mins => 8 - e.ordre), now() - make_interval(mins => 8 - e.ordre)
from (values
  (1, 'reve',
     'Je veux faire le tour du monde, mais mon compte bancaire refuse de collaborer.',
     'Je veux découvrir le Japon, la Nouvelle-Zélande et peut-être même la Lune… Si possible sans vendre un rein.',
     6000),
  (2, 'factures',
     'EDF connaît mieux mon adresse que mes amis.',
     'Ils m’écrivent tous les mois, sans faute. Mes amis, eux, ne savent même pas que j’ai déménagé. Quelqu’un pour régler la note et me rendre un peu de vie sociale ?',
     340),
  (3, 'patron',
     'Je veux payer le salaire de mon patron ce mois-ci. Il en a plus besoin que moi.',
     'Il a dit en réunion que « les temps sont durs pour tout le monde ». Je le crois. Il n’a pu changer sa voiture qu’une seule fois cette année.',
     4200),
  (4, 'projet',
     'J’ai une idée d’entreprise, mais mon banquier n’a pas autant d’imagination que moi.',
     'Un food-truck de croissants qui livre au lit. Mon banquier a ri. Pas le bon rire. Un milliardaire avec de l’imagination ferait l’affaire.',
     9000),
  (5, 'quotidien',
     'Je voudrais finir le mois sans calculatrice.',
     'Juste une fois. Faire les courses sans additionner chaque article de tête et sans reposer le fromage au dernier moment.',
     250),
  (6, 'plaisir',
     'Je veux acheter une console sans devoir vendre un rein.',
     'J’ai fait le calcul : un rein, c’est pas mal, mais j’en ai besoin pour jouer. Dilemme.',
     550),
  (7, 'defi',
     'Je veux passer un week-end entier sans notification de ma banque.',
     'Pas d’alerte « solde faible », pas de « prélèvement rejeté ». Juste moi, un plaid et le silence. Défi de l’année.',
     null::integer)
) as e(ordre, categorie, titre, texte, montant)
where not exists (
  select 1 from public.problems p
  where p.est_exemple and p.titre = e.titre
);
