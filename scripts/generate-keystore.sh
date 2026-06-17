#!/usr/bin/env bash
# Génère le keystore de signature pour le build release de l'APK NEXUS,
# et crée android/keystore.properties (jamais commité — voir .gitignore).
set -euo pipefail
cd "$(dirname "$0")/.."

KEYSTORE_PATH="android/nexus-release-key.jks"
PROPS_PATH="android/keystore.properties"

if [ -f "$KEYSTORE_PATH" ]; then
  echo "Un keystore existe déjà : $KEYSTORE_PATH — abandon pour ne pas l'écraser."
  exit 1
fi

read -rp "Mot de passe du keystore : " -s STORE_PASS; echo
read -rp "Mot de passe de la clé (Entrée = même que le keystore) : " -s KEY_PASS; echo
KEY_PASS=${KEY_PASS:-$STORE_PASS}

keytool -genkey -v \
  -keystore "$KEYSTORE_PATH" \
  -alias nexus \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$STORE_PASS" -keypass "$KEY_PASS"

cat > "$PROPS_PATH" <<EOF
storeFile=nexus-release-key.jks
storePassword=$STORE_PASS
keyAlias=nexus
keyPassword=$KEY_PASS
EOF

echo "Keystore généré : $KEYSTORE_PATH"
echo "Config écrite : $PROPS_PATH (gardé hors de git)"
echo "Sauvegarde ces deux fichiers en lieu sûr — sans eux, impossible de publier une mise à jour de l'app sur le même listing Play Store."
