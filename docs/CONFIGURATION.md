# Configuration — pas à pas

Ce guide fait passer le site du **mode démo** (données fictives dans le navigateur) au **mode Supabase** (vraies données), puis le publie sur GitHub Pages. Compter environ 1 h la première fois.

> Les seules valeurs qui vont dans le dépôt sont **publiques par nature** : l'URL Supabase, la clé publique Supabase (« publishable » ou « anon »), la clé de site Turnstile et le jeton Cloudflare Web Analytics. **Jamais** la clé `service_role`, la clé secrète Turnstile ni la clé SMTP Brevo.

---

## 0. Essayer en local (mode démo, 1 commande)

```bash
python -m http.server 8080 --directory site
```

Ouvrir http://localhost:8080/ — tout fonctionne avec des données fictives. `http://localhost:8080/tests.html` lance la suite de tests du contrat d'API.

Avant chaque commit :

```bash
node tools/test.mjs && node tools/verif.mjs     # ou : sh tools/check.sh
```

---

## 1. Fichiers à déposer (aucune installation)

| Fichier | Où | Pourquoi |
|---|---|---|
| `supabase-js` v2, build UMD (`dist/umd/supabase.js` du paquet `@supabase/supabase-js`, version figée) | `site/assets/vendor/supabase.js` | Client Supabase, chargé uniquement en mode Supabase. Pas de CDN. |
| Montserrat (BlackItalic, ExtraBold, BoldItalic) et Inter (Regular, SemiBold) en woff2 | `site/assets/fonts/` | Polices de la marque, licence OFL. Puis lancer `node tools/polices.mjs`. |

Noter la version de `supabase-js` dans un commentaire en tête du fichier et dans `site/assets/vendor/README.md`.

---

## 2. Supabase

### 2.1 Projet
1. Créer un projet, **région Europe** (ex. West EU – Irlande), offre gratuite.
2. *Project Settings → API* : noter l'**URL du projet** et la **clé publique** (publishable / anon).
3. *Project Settings → Data API* : laisser l'API activée. **Désactiver** l'exposition automatique des nouvelles tables si l'option existe (les migrations révoquent de toute façon tous les droits).

### 2.2 Base de données
*SQL Editor*, exécuter **dans l'ordre**, chaque fichier en entier :

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_securite.sql`
3. `supabase/migrations/003_fonctions.sql`
4. `supabase/migrations/004_moderation.sql`
5. `supabase/migrations/005_publication_auto.sql` (publication immédiate, mots sensibles)
6. `supabase/migrations/006_moderateurs.sql` (modérateurs et page de modération mobile)
7. `supabase/migrations/007_mots_sensibles_v2.sql` (liste des mots sensibles ajustée : moins de faux positifs)
8. `supabase/migrations/008_plafond_pauvres.sql` (montant obligatoire de 1 à 10 000 € pour un pauvre, 10 problèmes par 24 h)
9. `supabase/migrations/009_palmares.sql` (palmarès des pauvres : `get_palmares`, `get_mon_rang`)
10. `supabase/migrations/010_riches_payants.sql` (riches payants : en attente tant qu'un modérateur ne les a pas activés)
11. `supabase/migrations/011_publications_riches.sql` (problèmes et publications des riches actifs, filtres du mur par type)
12. `supabase/migrations/012_annonces_riches.sql` (« Un nouveau riche est arrivé », désinscription, envois d'e-mails : voir 4.2)
13. `supabase/migrations/013_probleme_du_moment.sql` (carte « Le problème du moment » de l'accueil : `get_probleme_du_moment()`, publique, lecture seule)
14. `supabase/migrations/014_anti_robots.sql` (limites par adresse IP : 5 profils, 30 publications, 60 commentaires ou messages, 300 réactions par heure ; IP jamais stockée en clair ; voir 3.1)
15. `supabase/migrations/015_pouvoirs_riches.sql` (couronnes des riches, notifications sur le site, réactions « yacht » et « majordome », « Le riche de la semaine » ; après 014)
16. `supabase/migrations/016_saisons_palmares.sql` (palmarès du mois et général : `get_palmares(p_limite, p_periode)`, `get_mon_rang(p_periode)`)
17. `supabase/migrations/017_badges.sql` (titres et badges calculés : `get_badges(p_code)`, badges et code dans le palmarès ; après 016)
18. `supabase/migrations/018_profil_public.sql` (profil public « Mon CV de pauvre » : `get_profil_public(p_code)`, code de l'auteur dans les cartes ; après 017)
19. `supabase/migrations/019_suivis.sql` (suivre un profil, fil « Mes suivis », les plus suivis, notification à la publication ; après 018)
20. `supabase/migrations/020_duel.sql` (le duel « Lequel est le plus drôle ? », ouvert aux visiteurs dans le plafond IP ; après 019)
21. `supabase/migrations/021_gazette.sql` (« La Gazette des pauvres » : contenu, aperçu modérateur, réservations ; budget d'envoi partagé avec les annonces ; voir 4.4)
22. `supabase/seed/mots_interdits.sql`
23. `supabase/seed/exemples.sql`

Pour modérer depuis un téléphone, inscrire son propre compte de membre dans `public.moderateurs` (voir `docs/MODERATION.md`, « Page de modération »).

Puis vérifier la sécurité : exécuter `supabase/tests/verif_securite.sql`. Chaque ligne doit afficher **OK** (le script s'annule à la fin : il ne laisse aucune donnée). Si l'éditeur n'affiche que le résultat de la dernière instruction, lire les messages `NOTICE`, ou exécuter le script sans sa dernière ligne `rollback;`.

### 2.3 Authentification
*Authentication → Sign In / Providers* :
- **Allow anonymous sign-ins** : activé (inscription en 10 secondes).
- **Email** : activé ; **Confirm email** : activé.
- Laisser les inscriptions par e-mail autorisées (la connexion par lien magique utilise `shouldCreateUser: false`, elle ne crée jamais de compte).

*Authentication → URL Configuration* :
- **Site URL** : `https://<compte>.github.io/whopays/`
- **Redirect URLs** : `https://<compte>.github.io/whopays/**`

*Authentication → Rate Limits* : limiter les connexions anonymes par IP (ex. 30 par heure).

*Authentication → Attack Protection (Bot protection)* : activer **CAPTCHA**, fournisseur **Cloudflare Turnstile**, coller la **clé secrète** Turnstile (étape 3).

*Authentication → Emails* :
- **SMTP Settings** : activer le SMTP personnalisé avec Brevo (étape 4).
- **Templates** : traduire en français les modèles « Confirm signup », « Change email address » et « Magic Link ». Exemple pour le lien magique :

  > **Objet :** Ton lien de connexion à Qui paie ?
  >
  > Salut ! Clique ici pour retrouver ton camp : {{ .ConfirmationURL }}
  > Pas de mot de passe, pas de carte bancaire, pas de milliardaire (pour l'instant).
  > Tu n'as rien demandé ? Ignore simplement cet e-mail.

---

## 3. Cloudflare

1. **Turnstile** → *Add site* : nom « Qui paie ? », nom d'hôte `<compte>.github.io`, mode **Managed**.
   - **Site key** (publique) → `CONFIG.TURNSTILE_SITE_KEY` dans `site/assets/js/config.js`.
   - **Secret key** → uniquement dans Supabase (étape 2.3).
   - Pour tester en local, ajouter aussi `localhost` aux noms d'hôte.
### 3.1 Activer Turnstile : l'ordre exact (R-035)

Le code est prêt : tant que `CONFIG.TURNSTILE_SITE_KEY` est vide, aucun widget n'est chargé ni demandé. Le jour de l'activation, **respecter cet ordre**, sinon plus personne ne peut rejoindre un camp :

1. Coller la **clé de site** (publique) dans `CONFIG.TURNSTILE_SITE_KEY` (`site/assets/js/config.js`), committer, pousser, et **attendre la fin du déploiement** GitHub Pages (onglet *Actions* au vert, puis recharger le site : le fichier `assets/js/config.js` servi doit contenir la clé).
2. **Seulement ensuite**, dans Supabase *Authentication → Attack Protection*, activer **CAPTCHA** (Cloudflare Turnstile) et coller la **clé secrète**.
3. Tester : « Rejoindre » un camp avec un nouvel e-mail, puis « Déjà membre ? ». Le widget est en mode `interaction-only` : invisible pour presque tout le monde, il n'apparaît (case à cocher) que si Cloudflare a un doute ; aucun espace vide ni clignotement sinon (`.turnstile-zone:empty` est masquée).

Pour désactiver : l'ordre inverse (d'abord le CAPTCHA dans Supabase, puis vider la clé dans `config.js`).

En plus de Turnstile, sans rien configurer :
- **Limites par adresse IP** (migration 014) : 5 créations de profil, 30 publications, 60 commentaires ou messages de club, 300 réactions par IP et par heure. L'IP vient de l'en-tête `cf-connecting-ip` (sinon le premier élément de `x-forwarded-for`) ; seule une empreinte salée (sha256) est stockée, 24 h au plus. Réglables sans redéploiement : `update public.reglages set valeur = '{"profil": 5, "publication": 30, "message": 60, "reaction": 300}' where cle = 'limites_ip';`
- **Champ piège et temps minimum** dans « Rejoindre » et « Publier » : un robot qui remplit le champ invisible `site_web` ou envoie en moins de 3 secondes voit un faux succès, rien n'est envoyé.

2. **Web Analytics** (facultatif, sans cookie) → *Add a site* → copier le **token** → `CONFIG.CF_ANALYTICS_TOKEN`.

---

## 4. Brevo (e-mails)

1. Créer un compte gratuit.
2. *Senders* : ajouter l'adresse Gmail dédiée au projet et la **vérifier**.
3. *SMTP & API → SMTP* : noter le serveur (`smtp-relay.brevo.com`), le port (587), l'identifiant et générer une **clé SMTP**.
4. Dans Supabase *Authentication → Emails → SMTP Settings* : coller ces valeurs ; expéditeur = l'adresse Gmail dédiée, nom = « Qui paie ? ».

Sans nom de domaine, les e-mails peuvent arriver en indésirables : c'est sans conséquence, la création de compte ne dépend jamais de l'e-mail.

### 4.1 E-mail de confirmation : une version pour les riches (R-031)

Au moment de rattacher l'e-mail (`updateUser`), le site enregistre le camp dans les métadonnées de l'utilisateur (`data: { camp }`). Le modèle Supabase peut donc afficher un texte différent pour un riche.

*Authentication → Emails → Templates → **Change email address*** (c'est ce modèle qui part à l'inscription : le compte est d'abord anonyme, puis l'adresse lui est rattachée) :

- **Objet :** `Confirme ton adresse — Qui paie ?`
- **Corps** (à coller tel quel, onglet *Source*) :

```html
<h2>{{ if eq .Data.camp "riche" }}Bienvenue chez les riches !{{ else }}Bienvenue chez les pauvres !{{ end }}</h2>
{{ if eq .Data.camp "riche" }}
<p>Confirme ton adresse pour garder ton compte riche, même si tu changes de navigateur :</p>
<p><a href="{{ .ConfirmationURL }}">Confirmer mon adresse</a></p>
<p>Ton compte doit encore être validé par un modérateur. Dès qu'il l'est, toute la communauté des pauvres saura que ton compte est créé : un bandeau « Un nouveau riche vient d'arriver » s'affiche sur le site, et les pauvres qui l'ont demandé reçoivent un e-mail. Prépare ta première publication, ils vont tous aller la lire.</p>
<p>Rappel : ton abonnement paie ton statut de riche sur la plateforme, il ne finance aucun problème. Aucun argent ne circule entre membres.</p>
{{ else }}
<p>Confirme ton adresse pour garder ton compte, même si tu changes de navigateur :</p>
<p><a href="{{ .ConfirmationURL }}">Confirmer mon adresse</a></p>
<p>Publie tes problèmes (jusqu'à 10x Rien, soit 10 000 €), grimpe au palmarès et attends ton milliardaire. Personne ne paiera ici : c'est un projet humoristique.</p>
{{ end }}
<p>Tu n'as rien demandé ? Ignore simplement cet e-mail.</p>
```

Les comptes créés avant cette version n'ont pas de camp dans leurs métadonnées : ils reçoivent la version « pauvres » (branche `else`), sans conséquence.

### 4.2 E-mail « Un nouveau riche est arrivé » : fonction Edge `annoncer-riche` (R-031)

Le code est dans `supabase/functions/annoncer-riche/index.ts` (aucune dépendance). Rien n'est déployé automatiquement, et **aucun test n'envoie d'e-mail**.

**Ce qu'elle fait.** Le bouton « Annoncer ce riche par e-mail » de la page de modération (onglet **Riches**, sur l'annonce en cours) l'appelle avec la session du modérateur. Elle vérifie le jeton et le rôle de modérateur (`mod_suis_je`), puis envoie, via l'API Brevo, un e-mail aux **pauvres qui ont coché la case** « Préviens-moi par e-mail quand un riche débarque… » (e-mail confirmé, compte non bloqué). Elle s'arrête à **250 e-mails par 24 h glissantes** (l'offre gratuite de Brevo en autorise 300 par jour). Personne ne reçoit deux fois la même annonce. Les e-mails refusés par Brevo seront retentés au prochain clic. Chaque e-mail contient un lien de désinscription `desinscription.html?jeton=…`.

**Déploiement** (une fois, depuis un ordinateur avec la [CLI Supabase](https://supabase.com/docs/guides/cli), ou depuis le tableau de bord : *Edge Functions → Deploy a new function → Via Editor*, nom `annoncer-riche`, coller le fichier) :

1. Brevo → *SMTP & API → **API Keys*** → générer une clé API (différente de la clé SMTP).
2. Supabase → *Edge Functions → Secrets* (ou `supabase secrets set …`) :
   - `BREVO_API_KEY` = la clé API Brevo ;
   - `SENDER_EMAIL` = l'adresse d'expéditeur vérifiée dans Brevo (l'adresse du projet) ;
   - `SITE_URL` = l'adresse publique du site, avec la barre finale (même valeur que `CONFIG.SITE_URL`).
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement par Supabase.
3. Déployer : `supabase functions deploy annoncer-riche --project-ref <ref du projet>`.
   Laisser **« Verify JWT »** activé (option par défaut) : seul un utilisateur connecté peut l'appeler, et la fonction vérifie en plus qu'il est modérateur.
4. Tester : activer un riche de test dans `moderation.html` (onglet **Riches** → « Activer 1 mois »). L'annonce apparaît en haut de l'onglet ; cliquer sur « Annoncer ce riche par e-mail ». Le message indique le nombre d'e-mails envoyés, ceux en échec et ceux qui restent pour plus tard.

Sans la fonction déployée, le bouton affiche « Envoi impossible : la fonction « annoncer-riche » est-elle déployée ? ». Le reste du site n'en dépend pas : le bandeau du site s'affiche dès l'activation.

---

### 4.3 Aperçus de partage propres à chaque problème : fonction Edge `partage` (R-042)

Sans elle, un lien de problème partagé montre l'image générique du site. Avec elle, WhatsApp, X, Facebook, LinkedIn… affichent **le titre du problème**, « 5x Rien recherchés — soit 5 000 € · Qui paie ? » et **l'image de sa catégorie** (`site/assets/img/partage/<categorie>.png`, 1200 × 630, générées depuis `tools/images.mjs`).

Fonctionnement : `GET https://<projet>.supabase.co/functions/v1/partage?id=<problème>[&ref=<code>]` lit le problème avec la fonction **publique** `get_probleme_public` (clé publique : les mêmes données que le site) ; les robots d'aperçu (facebookexternalhit, Twitterbot, WhatsApp, LinkedInBot, Slackbot, Discordbot, TelegramBot…) reçoivent une petite page HTML avec les balises `og:*` / `twitter:*` ; **les humains sont redirigés tout de suite** (HTTP 302) vers `p.html?id=…`. Problème inconnu, masqué ou pas encore publié → redirection vers l'accueil.

1. Déployer **sans vérification de JWT** (les robots n'ont pas de jeton) :
   `supabase functions deploy partage --no-verify-jwt`
2. Secret : `SITE_URL` (déjà posé pour `annoncer-riche`, avec la barre finale). `SUPABASE_URL` et `SUPABASE_ANON_KEY` sont fournis par Supabase.
3. Tester : `curl -A "facebookexternalhit/1.1" "https://<projet>.supabase.co/functions/v1/partage?id=<id d'un problème publié>"` → page avec `og:title` ; sans `-A` → `302` vers `p.html?id=…`. Vérifier aussi avec le débogueur de partage de Facebook.
4. **Seulement ensuite**, renseigner `CONFIG.URL_PARTAGE = 'https://<projet>.supabase.co/functions/v1/partage'` dans `site/assets/js/config.js`, committer et pousser : tous les boutons de partage d'un problème (page problème, « C'est en ligne ! », Mon espace) utiliseront ce lien. Vide = comportement d'avant (lien `p.html?id=…`).

> Attention : sur le domaine par défaut `*.supabase.co`, Supabase peut servir les réponses HTML des fonctions Edge en `text/plain`. Les humains ne sont pas concernés (redirection 302), mais certains robots d'aperçu exigent `text/html` : si l'aperçu reste générique après le test du point 3, il faut un **domaine personnalisé** pour les fonctions (offre payante) ou héberger cette redirection ailleurs (ex. Cloudflare Worker, même code). Dans le doute, laisser `URL_PARTAGE` vide : le site fonctionne comme avant.

### 4.4 « La Gazette des pauvres » : fonction Edge `gazette` (R-043) — envoi activé plus tard par Hassen

Un e-mail par semaine aux membres (riches et pauvres) qui ont coché la case « Préviens-moi par e-mail… » (même consentement et même lien de désinscription que l'annonce des nouveaux riches) : le top 5 de la semaine, le pauvre du mois, les nouveaux riches, les thèmes de la semaine prochaine. Le numéro est **figé** au premier envoi de la semaine (tout le monde reçoit le même) ; personne ne le reçoit deux fois ; **250 e-mails par 24 h glissantes, partagés avec les annonces** (offre gratuite Brevo : 300 / jour).

1. Appliquer `021_gazette.sql` (après 020). Dans `moderation.html`, onglet **Riches** : bloc « 🗞️ La Gazette des pauvres » avec **« Aperçu de la gazette »** (le numéro tel qu'il partirait) et **« Envoyer la gazette »** (modérateurs seulement).
2. Déployer **sans vérification de JWT** (la fonction vérifie elle-même le modérateur, ou le secret du job hebdomadaire) :
   `supabase functions deploy gazette --no-verify-jwt`
3. Secrets : `BREVO_API_KEY`, `SENDER_EMAIL`, `SITE_URL` (les mêmes que pour `annoncer-riche`) ; pour le job hebdomadaire seulement, `GAZETTE_SECRET` = une longue chaîne aléatoire (`openssl rand -hex 32`).
4. Tester avec un compte modérateur : « Envoyer la gazette » → « N e-mails envoyés ». Si plus de 250 inscrits, relancer le lendemain : la suite part, jamais deux fois.

**Envoi automatique chaque lundi (documenté, NON activé)** — à exécuter seulement quand Hassen le décide, dans le *SQL Editor*, après avoir activé les extensions `pg_cron` et `pg_net` (*Database → Extensions*) :

```sql
-- 1. Le secret, rangé dans le coffre de Supabase (jamais en clair dans un job)
select vault.create_secret('<la même valeur que GAZETTE_SECRET>', 'gazette_secret');
-- 2. Lundi, mardi et mercredi à 8 h UTC (9 h ou 10 h à Paris) : le lundi envoie les 250 premiers,
--    les jours suivants la suite s'il reste des inscrits (jamais deux fois le même numéro).
select cron.schedule('gazette-hebdo', '0 8 * * 1,2,3', $$
  select net.http_post(
    url := 'https://<projet>.supabase.co/functions/v1/gazette',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gazette-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gazette_secret')),
    body := '{}'::jsonb);
$$);
-- Arrêter : select cron.unschedule('gazette-hebdo');
```

## 5. Brancher le site

Dans `site/assets/js/config.js` :

```js
export const CONFIG = {
  MODE: 'supabase',
  SITE_URL: 'https://<compte>.github.io/whopays/',
  REPO_URL: 'https://github.com/<compte>/whopays',
  SUPABASE_URL: 'https://<projet>.supabase.co',
  SUPABASE_PUBLIC_KEY: 'sb_publishable_…',
  TURNSTILE_SITE_KEY: '0x4AAAA…',
  CF_ANALYTICS_TOKEN: ''
};
```

Si `SITE_URL` a changé : `node tools/sync-url.mjs` (met à jour les balises de partage `og:image` / `og:url`).

Puis : `node tools/test.mjs && node tools/verif.mjs`, ouvrir `tests.html` (en mode Supabase, contrôles en lecture seule sur les vraies fonctions), commit, push.

Test de bout en bout contre la vraie base : `node tools/e2e-supabase.mjs` (rejoindre riche et pauvre, publier, réagir, commenter, signaler, club, Mon espace, changer de camp, supprimer le compte). Les comptes de test (`test-…`) sont supprimés à la fin ; rien ne reste dans la base. Nécessite la connexion anonyme activée et, tant que `TURNSTILE_SITE_KEY` est vide, le captcha désactivé côté Supabase.

**Démo à la demande.** En mode Supabase, ajouter `?demo=1` à n'importe quelle adresse du site bascule **cet onglet** en mode démo (données fictives, aucun appel à Supabase), avec un bandeau « Mode démo » et un lien « Quitter la démo » ; `demo=1` est conservé dans les liens internes. `?demo=0` ou « Quitter la démo » revient au vrai site. Lien « Essayer la démo » dans le pied de page.

---

## 6. GitHub Pages

1. Le dépôt contient déjà `.github/workflows/deploy.yml` (tests + publication de `site/`) et `.github/workflows/securite.yml` (gitleaks à chaque push).
2. *Settings → Pages → Build and deployment → Source* : **GitHub Actions**.
3. Pousser sur `main` : le site est publié sur `https://<compte>.github.io/whopays/`.
4. Le déploiement Pages échoue tant que le dépôt est privé sur un compte gratuit : c'est normal, il passe dès que le dépôt est public.

---

## 7. Forker le projet

1. Fork, puis remplacer `<compte>` partout dans `config.js` (`SITE_URL`, `REPO_URL`) et lancer `node tools/sync-url.mjs`.
2. Suivre les étapes 2 à 6 avec ton propre projet Supabase.
3. Le nom de l'éditeur (« Site édité par … ») est dans `site/assets/js/layout.js` et dans les 3 lignes d'information de `site/assets/js/auth.js`.
