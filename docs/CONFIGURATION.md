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
9. `supabase/seed/mots_interdits.sql`
10. `supabase/seed/exemples.sql`

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
2. **Web Analytics** (facultatif, sans cookie) → *Add a site* → copier le **token** → `CONFIG.CF_ANALYTICS_TOKEN`.

---

## 4. Brevo (e-mails)

1. Créer un compte gratuit.
2. *Senders* : ajouter l'adresse Gmail dédiée au projet et la **vérifier**.
3. *SMTP & API → SMTP* : noter le serveur (`smtp-relay.brevo.com`), le port (587), l'identifiant et générer une **clé SMTP**.
4. Dans Supabase *Authentication → Emails → SMTP Settings* : coller ces valeurs ; expéditeur = l'adresse Gmail dédiée, nom = « Qui paie ? ».

Sans nom de domaine, les e-mails peuvent arriver en indésirables : c'est sans conséquence, la création de compte ne dépend jamais de l'e-mail.

---

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
