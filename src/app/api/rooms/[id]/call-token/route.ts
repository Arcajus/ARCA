import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// Point d'intégration pour le vrai appel audio/vidéo.
//
// La liste de présence (qui est dans la salle, micro/caméra) est déjà
// réelle — voir /api/rooms/[id]/participants et /api/rooms/[id]/presence.
// Il manque uniquement le transport audio/vidéo lui-même.
//
// Pour l'activer avec LiveKit Cloud ou Daily.co :
//   1. Créer un compte gratuit chez le fournisseur choisi.
//   2. Ajouter les variables d'env (ex: LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
//      LIVEKIT_URL — ou DAILY_API_KEY).
//   3. Remplacer le corps de ce handler par la génération d'un token
//      d'accès à la salle pour `user.handle`, et le renvoyer au client.
//   4. Côté client, utiliser le SDK du fournisseur avec ce token pour
//      rejoindre la salle d'appel (room id = `id`).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Connecte-toi pour rejoindre l'appel." }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: "CALL_PROVIDER_NOT_CONFIGURED",
      message: "Le service d'appel audio/vidéo n'est pas encore branché. La liste des participants reste réelle.",
    },
    { status: 501 }
  );
}
