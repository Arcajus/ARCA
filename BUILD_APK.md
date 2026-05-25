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

### 3. Construire l'app web (export statique)
```bash
npm run build
```

### 4. Synchroniser avec Android
```bash
npx cap sync android
```

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

```bash
cd android
./gradlew assembleRelease
```

Tu devras créer un keystore :
```bash
keytool -genkey -v -keystore nexus-release-key.jks \
  -alias nexus -keyalg RSA -keysize 2048 -validity 10000
```

---

## Infos de l'app

| Champ | Valeur |
|---|---|
| App ID | `com.nexus.app` |
| App Name | `NEXUS` |
| Version | `1.0` |
| Min SDK | Android 5.0 (API 22) |
| Target SDK | Android 14 (API 34) |

---

## Permissions incluses

- `RECORD_AUDIO` — Studio débat vocal
- `ACCESS_FINE_LOCATION` — Événements géolocalisés
- `INTERNET` — API IA, temps réel
- `CAMERA` — Photo de profil
