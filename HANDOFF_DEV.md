# NEXUS — Dossier de passation développeur

Document à transmettre à un développeur freelance/agence pour devis et
réalisation de la **finalisation totale de l'APK Android**. Décrit l'état
actuel, ce qui reste à faire, et les livrables attendus.

## 1. Le projet en bref

- **Stack** : Next.js 16 (React 19), déployé sur Vercel (backend + web).
- **App Android** : générée via Capacitor (export statique du front +
  wrapper natif Android). Pas une app native écrite à la main.
- **Repo** : `arcajus/arca` sur GitHub, branche de travail actuelle
  `claude/dreamy-rubin-GBcJB` (à fusionner ou prendre comme base).
- **But de l'app** : NEXUS — simulations de débats/négociations (ONU,
  procès, etc.) assistées par IA, + un flux d'actualités incluant des
  articles écrits automatiquement par l'app elle-même ("NEXUS Originals").

## 2. Ce qui fonctionne déjà

- Build web (Vercel) et build Android (export statique + Capacitor) tous
  les deux opérationnels (`npm run build:android`).
- Gestion du bouton retour matériel Android (`@capacitor/app`).
- Page de politique de confidentialité (`/privacy`), nécessaire pour le
  Play Store.
- Infra de signature de build release (gitignored
  `android/keystore.properties` + script `scripts/generate-keystore.sh`),
  mais **aucun build signé n'a encore été produit dans cet environnement**
  (sandbox sans accès réseau à `dl.google.com` — à faire sur une machine
  avec accès internet normal).
- Flux d'actualités avec articles RSS classiques + articles générés
  automatiquement par IA ("NEXUS Originals"), avec règle de fiabilité
  (publication seulement si ≥3 sources indépendantes corroborent un sujet).
- Onglet Emplois branché sur l'API Adzuna (clés non configurées).
- Écran "Premium" avec plans affichés, mais **paiement non réel** :
  le bouton ne fait qu'activer un flag `localStorage`, gratuitement,
  sans aucune vérification. À considérer comme un mockup UI, pas un
  système de paiement.

## 3. Ce qui reste à faire (le périmètre du devis)

### 3.1 Build signé + publication Play Store (obligatoire, le minimum)
- Générer le keystore de production (`scripts/generate-keystore.sh`)
- Produire un `assembleRelease` signé et fonctionnel
- Créer la fiche Play Store (captures d'écran, description, catégorie,
  politique de confidentialité déjà prête à `/privacy`)
- Remplir le formulaire "Sécurité des données" du Play Console (cf.
  liste des permissions Android utilisées : micro, localisation, caméra,
  internet — déjà documentée dans `BUILD_APK.md`)
- Soumettre pour review Google (délai variable, hors contrôle du dev)

### 3.2 Système de paiement réel (Google Play Billing)
- Intégrer un SDK Billing pour Capacitor
  (`@capacitor-community/in-app-purchases` ou équivalent)
- Créer les produits d'abonnement dans Play Console (mensuel/annuel,
  IDs à définir avec le client)
- Remplacer la logique actuelle dans `PremiumScreen`
  (`src/components/NexusApp.tsx`) par le vrai flux d'achat natif
- **Vérification du reçu côté serveur obligatoire** (sécurité anti-fraude)
  — créer une route API dédiée + table en base (Postgres/Neon déjà en
  place, réutilisable) pour stocker l'état d'abonnement par utilisateur
- Gérer renouvellement, annulation, remboursement, restauration d'achat

### 3.3 Système de compte utilisateur (prérequis pour 3.2)
- Aujourd'hui, **aucune authentification** n'existe : tout repose sur
  `localStorage` local à l'appareil. Si un abonné change de téléphone ou
  réinstalle l'app, l'abonnement ne pourra pas être retrouvé sans compte.
- À ajouter : connexion par email ou Google Sign-In, table utilisateurs
  en base, migration des préférences `localStorage` existantes vers un
  profil serveur.

### 3.4 Finitions secondaires
- Configurer les clés `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` et tester
  l'onglet Emplois avec de vraies données
- Configurer `DATABASE_URL` (Postgres/Neon via Vercel Storage) et
  `CRON_SECRET` pour activer la génération automatique d'articles NEXUS
- Revue de sécurité générale avant mise en production publique à grande
  échelle (le composant principal `NexusApp.tsx` fait ~10 400 lignes,
  un découpage en modules est recommandé avant d'ajouter le Billing/Auth
  pour limiter les risques de régression)

## 4. Variables d'environnement à fournir au développeur

| Variable | Usage | Statut |
|---|---|---|
| `GEMINI_API_KEY` | Génération IA (simulations + NEXUS Originals) | Déjà configurée |
| `AZURE_TTS_KEY` / `AZURE_TTS_REGION` | Synthèse vocale | Déjà configurée |
| `OPENAI_API_KEY` | Fallback TTS | Déjà configurée |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | API Emplois | À créer (developer.adzuna.com, gratuit) |
| `DATABASE_URL` | Base Postgres/Neon (NEXUS Originals) | À lier via Vercel Storage |
| `CRON_SECRET` | Sécurise le cron quotidien de génération d'articles | À définir |

**Règle non négociable : aucune clé API ne doit jamais être codée en dur
dans le code source.** Elles vivent uniquement comme variables
d'environnement Vercel, côté serveur.

## 5. Accès à donner au développeur (au fur et à mesure, pas tout d'un coup)
1. Accès lecture au repo GitHub pour étudier le code et chiffrer (devis)
2. Accès collaborateur GitHub une fois la mission validée
3. Accès Vercel (projet uniquement, pas le compte entier si possible)
4. Accès Play Console **en tant que collaborateur sur ton compte** —
   ne jamais laisser un prestataire créer le compte développeur Google
   en son nom propre, l'app lui appartiendrait légalement.

## 6. Découpage en jalons de paiement recommandé
1. **Build signé installable + tests internes** → ~25-30%
2. **Publication effective sur le Play Store** (review/test fermé) → ~25%
3. **Auth + Billing fonctionnels en sandbox, vérifiés par un vrai
   abonnement test** → ~35%
4. **Recette finale + corrections post-livraison (garantie ~2-4 semaines)** → ~10-15%

Ne jamais payer 100% à l'avance ; privilégier l'escrow intégré des
plateformes freelance (Malt, Upwork) si possible.
