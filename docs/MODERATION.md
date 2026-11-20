# Modération — routine quotidienne

Deux façons de modérer :

- **Depuis un téléphone** : la page privée `moderation.html` (section « Page de modération » ci-dessous), réservée aux membres inscrits dans `public.moderateurs` (`006_moderateurs.sql`). C'est le plus rapide pour la routine quotidienne.
- **Dans Supabase Studio** (Table Editor et SQL Editor), connecté avec le compte administrateur : toutes les commandes SQL des sections 0 à 7. Les vues et fonctions de `004_moderation.sql` ne sont accessibles ni à `anon` ni à `authenticated`.

Durée : 5 à 15 minutes par jour selon le volume.

## Page de modération (mobile)

Adresse : `moderation.html` à la racine du site (après `CONFIG.SITE_URL`). Elle n'est liée nulle part, porte `noindex` et n'est jamais mise en cache par le service worker. Chaque action est vérifiée **côté serveur** : les fonctions `mod_*` (`006_moderateurs.sql`) refusent tout appelant absent de `public.moderateurs` (et `anon` n'a aucun droit d'exécution).

**Devenir modérateur** (une fois, dans le SQL Editor) :

1. Avoir un compte de membre sur le site, avec un e-mail confirmé (pour pouvoir se reconnecter par lien magique sur le téléphone).
2. Exécuter, en remplaçant le pseudo :
   ```sql
   insert into public.moderateurs (user_id) select id from public.profiles where pseudo = '<pseudo>';
   ```
   Variante : ouvrir `moderation.html` connecté avec ce compte ; la page « Accès réservé » affiche l'identifiant du membre à copier, puis
   `insert into public.moderateurs (user_id) values ('<identifiant>');`
3. Retirer le droit : `delete from public.moderateurs where user_id = '<identifiant>';` (il disparaît aussi quand le compte est supprimé).

**Les 4 onglets** (le nombre d'éléments est affiché sur chaque onglet) :

| Onglet | Contenu | Boutons |
|---|---|---|
| **À relire** | Problèmes en attente (`recu` = cas sensibles, ou tout en pré-modération), le plus ancien en premier | Publier · Refuser · Réorienter · Bloquer l'auteur |
| **Récents 48 h** | Problèmes publiés depuis 48 h (masqués compris), le plus récent en premier | Masquer / Rétablir · Refuser (retirer) · Voir sur le site · Bloquer l'auteur |
| **Signalés** | Contenus signalés depuis 24 h (problèmes, commentaires, messages de club), les plus signalés en premier | Masquer / Rétablir · Refuser (problème) · Bloquer l'auteur |
| **Masqués** | Tout ce qui est masqué (3 signalements, auteur du problème, modération) | Rétablir · Refuser (problème) · Bloquer l'auteur |

« Bloquer l'auteur » demande une confirmation ; un auteur bloqué affiche « Débloquer l'auteur ». Un modérateur ne peut pas se bloquer lui-même. Les fonctions ne renvoient jamais d'adresse e-mail.

En mode démo (`?demo=1`), la page est simulée : le bouton « (Démo) Essayer en modérateur » donne le rôle au membre connecté (ou au premier membre fictif).

## 0. Publication immédiate (depuis `005_publication_auto.sql`)

Un problème qui passe les filtres (numéro, IBAN, e-mail, lien, mot interdit) est **publié tout de suite** : l'auteur peut le partager dans la seconde. Seuls les problèmes qui contiennent une **expression sensible** (table `mots_sensibles` : suicide, en finir, viol, harcèlement, cancer, chimio, à la rue, expulsé, drogue, dépression…) partent en relecture (`statut = 'recu'`). La file « à relire » ne contient donc plus que des **cas sensibles** : les traiter en priorité, et réorienter au moindre doute.

La routine devient :
1. relire `moderation_a_relire` (cas sensibles) ;
2. parcourir les problèmes publiés récemment et **retirer vite** ce qui n'aurait pas dû passer :
   ```sql
   select id, cree_le, titre, texte from public.problems
   where statut = 'publie' and not est_exemple and cree_le > now() - interval '48 hours'
   order by cree_le desc;
   select public.moderer_probleme('<id>', 'refuse');      -- ou 'reoriente', ou masquer_contenu('probleme', '<id>')
   ```
3. signalements et contenus masqués (sections 2 et 3).

**Repasser en pré-modération** (tout problème attend une relecture, comme au lancement) :

```sql
update public.reglages set valeur = 'false' where cle = 'publication_auto';
-- revenir à la publication immédiate :
update public.reglages set valeur = 'true' where cle = 'publication_auto';
```

**Ajouter une expression sensible** : Table Editor → `mots_sensibles`, en minuscules et sans accents (la comparaison ignore accents et majuscules, et porte sur des mots entiers : « viol » ne touche pas « violon »). L'ajouter aussi à `MOTS_SENSIBLES_DEFAUT` dans `site/assets/js/mots-sensibles.js` et dans le `insert` de `005_publication_auto.sql` (`tools/verif.mjs` vérifie que les deux listes sont identiques).

## 1. Problèmes à relire

SQL Editor :

```sql
select * from public.moderation_a_relire;  -- statut = 'recu' (cas sensibles), le plus ancien en premier
```

Pour chaque problème :

| Décision | Quand | Commande |
|---|---|---|
| **Publier** | Drôle ou touchant, anonyme, respecte les règles | `select public.moderer_probleme('<id>', 'publie');` |
| **Refuser** | Insulte, données personnelles, demande d'argent explicite, hors sujet | `select public.moderer_probleme('<id>', 'refuse');` |
| **Réorienter** | Détresse réelle, santé, violence, situation grave | `select public.moderer_probleme('<id>', 'reoriente');` — l'auteur voit « Non publié » + le lien vers la page d'aide |

Repères :
- On rit **des situations, jamais des personnes**.
- Aucun vrai nom, aucune adresse, aucune information de santé, aucun numéro, aucun IBAN.
- Personne ne demande ni n'envoie d'argent : un problème peut citer un montant, jamais un moyen de paiement.
- En cas de doute sur une détresse réelle : **réorienter**.

## 2. Contenus masqués automatiquement

Un problème, un commentaire ou un message de club est masqué automatiquement au **3ᵉ signalement**.

```sql
select * from public.moderation_masques;  -- problèmes, commentaires, messages masqués
```

- Masquage justifié → ne rien faire (le contenu reste masqué).
- Masquage abusif → rétablir :

```sql
update public.problems      set masque = false where id = '<id>';
update public.comments      set masque = false, masque_par = null where id = '<id>';
update public.club_messages set masque = false where id = '<id>';
```

## 3. Signalements des dernières 24 h

```sql
select * from public.moderation_signalements_24h;
```

Repérer les membres abusifs (beaucoup de contenus signalés, ou qui signalent tout et n'importe quoi), puis bloquer :

```sql
select public.bloquer_membre('<user_id>', true);   -- false pour débloquer
```

Un membre bloqué peut encore lire le site mais ne peut plus rien écrire (publier, réagir, commenter, écrire au club, signaler, modifier son profil).

## 4. Milliardaires vérifiés

Si un milliardaire (un vrai) se manifeste et que son identité a été vérifiée hors du site :

```sql
select public.verifier_milliardaire('<user_id>');
```

Le compteur « milliardaire vérifié » de l'accueil augmente. Aujourd'hui : 0. On attend.

## 5. Une fois par mois

```sql
select public.purger_anciens_refus();  -- supprime les problèmes 'refuse' et 'reoriente' de plus de 90 jours
```

## 6. Export des membres

Table Editor → `profiles` → **Export to CSV**.

> ⚠️ **Seuls les membres avec `newsletter = true` peuvent recevoir des nouvelles du projet.** Filtrer sur cette colonne avant tout envoi. Les e-mails ne servent à rien d'autre.

## 7. Mots interdits

Table Editor → `mots_interdits`. Ajouter un mot en minuscules et sans accents (la comparaison ignore accents et majuscules). Le même mot doit être ajouté à `MOTS_INTERDITS_DEFAUT` dans `site/assets/js/filtres.js` pour que le formulaire prévienne l'utilisateur avant l'envoi.
