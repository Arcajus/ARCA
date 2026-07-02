# Comment générer l'APK NEXUS

## Prérequis sur ta machine

1. **Android Studio** — télécharger sur https://developer.android.com/studio
2. **Java 17+** — inclus avec Android Studio
3. **Node.js 18+**

---

## Étapes pour générer l'APK

### 1. Cloner le projet
```bash
git clone <url-du-repo>
cd ARCA
```

### 2. Installer les dépendances
```bash
npm install
```

### 3. Construire l'app web (export statique) + synchroniser Android
```bash
npm run build:android
```
Ce script exclut temporairement les routes `/api/*` (impossibles à exporter statiquement),
génère `out/`, puis lance `npx cap sync android` automatiquement.

### 5. Option A — Ouvrir dans Android Studio (recommandé)
```bash
npx cap open android
```
Puis dans Android Studio :
- Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**
- L'APK se trouve dans `android/app/build/outputs/apk/debug/app-debug.apk`

### 5. Option B — Build en ligne de commande
```bash
cd android
./gradlew assembleDebug
```
APK généré : `android/app/build/outputs/apk/debug/app-debug.apk`

---

## Build de production (signé pour Google Play)

### 1. Générer le keystore (une seule fois, à conserver précieusement)
```bash
./scripts/generate-keystore.sh
```
Crée `android/nexus-release-key.jks` et `android/keystore.properties` (tous deux ignorés par git —
**sauvegarde-les ailleurs**, sans eux impossible de republier une mise à jour sur le même listing Play Store).

### 2. Builder
```bash
npm run build:android
cd android
./gradlew assembleRelease
```
Avec `keystore.properties` présent, `build.gradle` signe automatiquement l'APK release.
Sans ce fichier, le build release reste **non signé** (utile en CI sans secrets, mais pas publiable).

APK signé : `android/app/build/outputs/apk/release/app-release.apk`

### 3. Checklist avant publication sur le Play Store
- [ ] Politique de confidentialité accessible publiquement à l'URL de production (ex : `https://votredomaine.com/privacy`)
- [ ] Formulaire "Sécurité des données" du Play Console rempli (données collectées : voir `/privacy`)
- [ ] Bouton retour Android géré (fait — voir `backButton` listener dans `NexusApp.tsx`)
- [ ] Si Premium est un vrai achat : configurer RevenueCat (`src/lib/billing.ts`) — remplacer `REVENUECAT_API_KEY`, créer les produits dans Play Console, puis `npm install @revenuecat/purchases-capacitor && npx cap sync android`
- [ ] `versionCode`/`versionName` incrémentés dans `android/app/build.gradle` à chaque nouvelle publication

---

## Infos de l'app

| Champ | Valeur |
|---|---|
| App ID | `com.nexus.app` |
| App Name | `NEXUS` |
| Version | `1.1.0` |
| Min SDK | Android 5.0 (API 22) |
| Target SDK | Android 14 (API 34) |

---

## Permissions incluses

- `RECORD_AUDIO` — Studio débat vocal
- `ACCESS_FINE_LOCATION` — Événements géolocalisés
- `INTERNET` — API IA, temps réel
- `CAMERA` — Photo de profil
