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
        <li><b>Compte</b> : email, pseudo et mot de passe (haché, jamais stocké en clair) — créé automatiquement lors de ta première participation à une salle, ou manuellement si tu crées un compte. Sert uniquement à t&apos;identifier dans les salles et à associer les pièces que tu verses.</li>
        <li><b>Présence en salle</b> : pseudo, rôle, statut micro/caméra, horodatage de connexion — visible des autres participants de la même salle, supprimé automatiquement après ton départ.</li>
        <li><b>Pièces versées au dossier</b> (fichiers uploadés dans les simulations de procès) : stockées sur Vercel Blob, liées à ton compte, visibles des autres participants de la salle.</li>
        <li><b>Stockage local (localStorage)</b> : préférences (thème, objectifs, niveau), statut Premium, progression — reste sur l&apos;appareil, jamais transmis à nos serveurs.</li>
        <li><b>Contenu saisi dans les simulations</b> (discours, messages, position papers) : envoyé à l&apos;API Gemini (Google) pour générer les réponses des adversaires IA et l&apos;évaluation. Non conservé après la requête.</li>
        <li><b>Voix (micro)</b> : utilisée uniquement pour la reconnaissance vocale pendant le Studio Débat ; le flux audio n&apos;est pas enregistré ni stocké sur nos serveurs.</li>
        <li><b>Localisation approximative</b> : utilisée uniquement pour afficher des événements géolocalisés pertinents ; jamais transmise à des tiers.</li>
      </ul>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>3. Services tiers</h2>
      <p>NEXUS s&apos;appuie sur Google Gemini (génération de texte), Microsoft Azure Cognitive Services ou OpenAI (synthèse vocale), Google News RSS (actualités), Neon (base de données Postgres) et Vercel Blob (stockage de fichiers). Ces services traitent les requêtes nécessaires à l&apos;affichage du contenu, conformément à leurs propres politiques de confidentialité.</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>4. Conservation</h2>
      <p>Les données de compte, de présence en salle et les pièces versées sont conservées sur nos serveurs tant que ton compte existe. Tout le reste (préférences, progression, brouillons de publication) reste exclusivement sur ton appareil, et disparaît si tu désinstalles l&apos;application ou vides le stockage du navigateur.</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>5. Suppression de ton compte et de tes données</h2>
      <p>Tu peux supprimer définitivement ton compte et toutes les données associées (sessions, participations aux salles, pièces versées) à tout moment, directement dans l&apos;application : <b>Profil → Paramètres → Supprimer mon compte</b>. La suppression est immédiate et irréversible. Tu peux aussi nous écrire à l&apos;adresse ci-dessus pour qu&apos;on s&apos;en charge à ta place.</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>6. Vos droits</h2>
      <p>Conformément au RGPD, tu peux demander l&apos;accès, la rectification, la portabilité ou la suppression de tes données en nous contactant à l&apos;adresse ci-dessus, en plus de la suppression directe décrite au point 5.</p>

      <h2 style={{fontSize:18,fontWeight:700,marginTop:28,marginBottom:8}}>7. Permissions de l&apos;application Android</h2>
      <ul>
        <li><b>Micro</b> — Studio débat audio (reconnaissance vocale)</li>
        <li><b>Localisation</b> — Affichage d&apos;événements géolocalisés</li>
        <li><b>Caméra</b> — Photo de profil (optionnel)</li>
        <li><b>Internet</b> — Fonctionnement de l&apos;application (API, actualités)</li>
      </ul>
    </div>
  );
}
