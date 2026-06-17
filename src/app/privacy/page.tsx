export const metadata = { title: "Politique de confidentialité — NEXUS" };

export default function PrivacyPage() {
  return (
    <div style={{maxWidth:680,margin:"0 auto",padding:"40px 24px 80px",fontFamily:"system-ui,sans-serif",color:"#0C1117",lineHeight:1.6}}>
      <h1 style={{fontSize:26,fontWeight:800,marginBottom:8}}>Politique de confidentialité — NEXUS</h1>
      <p style={{color:"#4A5A72",fontSize:13,marginBottom:32}}>Dernière mise à jour : juin 2026</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>1. Qui sommes-nous</h2>
      <p>NEXUS est une application de simulation politique, juridique et diplomatique éditée par Arcajus Auguste GBAGUIDI (Marseille, France). Contact : augustegbaguidi13@gmail.com.</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>2. Données collectées</h2>
      <ul>
        <li><b>Stockage local (localStorage)</b> : préférences (thème, objectifs, niveau), statut Premium, progression — reste sur l&apos;appareil, jamais transmis à nos serveurs.</li>
        <li><b>Contenu saisi dans les simulations</b> (discours, messages, position papers) : envoyé à l&apos;API Gemini (Google) pour générer les réponses des adversaires IA et l&apos;évaluation. Non conservé après la requête.</li>
        <li><b>Voix (micro)</b> : utilisée uniquement pour la reconnaissance vocale pendant le Studio Débat ; le flux audio n&apos;est pas enregistré ni stocké sur nos serveurs.</li>
        <li><b>Localisation approximative</b> : utilisée uniquement pour afficher des événements géolocalisés pertinents ; jamais transmise à des tiers.</li>
      </ul>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>3. Services tiers</h2>
      <p>NEXUS s&apos;appuie sur Google Gemini (génération de texte), Microsoft Azure Cognitive Services ou OpenAI (synthèse vocale), et Google News RSS (actualités). Ces services traitent les requêtes nécessaires à l&apos;affichage du contenu, conformément à leurs propres politiques de confidentialité.</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>4. Conservation</h2>
      <p>Aucune base de données serveur ne conserve vos contenus de simulation. Les seules données persistantes sont celles stockées localement sur votre appareil, que vous pouvez effacer à tout moment en désinstallant l&apos;application ou en vidant le stockage du navigateur.</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>5. Vos droits</h2>
      <p>Conformément au RGPD, vous pouvez demander l&apos;accès, la rectification ou la suppression de vos données en nous contactant à l&apos;adresse ci-dessus.</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>6. Permissions de l&apos;application Android</h2>
      <ul>
        <li><b>Micro</b> — Studio débat audio (reconnaissance vocale)</li>
        <li><b>Localisation</b> — Affichage d&apos;événements géolocalisés</li>
        <li><b>Caméra</b> — Photo de profil (optionnel)</li>
        <li><b>Internet</b> — Fonctionnement de l&apos;application (API, actualités)</li>
      </ul>
    </div>
  );
}
