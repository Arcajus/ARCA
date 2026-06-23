import { Sql } from "./db";

export const SEED_ROOMS = [
  { id: "s1", type: "onu", topic: "Réforme du droit de veto au Conseil de Sécurité", status: "upcoming", scheduled: Date.now() + 86400000 * 2, maxParticipants: 193, moderator: "@mod_alice", room: 1, trialType: null as string | null },
  { id: "s2", type: "onu", topic: "Cessez-le-feu immédiat en Ukraine", status: "live", scheduled: Date.now() - 3600000, maxParticipants: 193, moderator: "@mod_pierre", room: 1, trialType: null },
  { id: "s3", type: "onu", topic: "Cessez-le-feu immédiat en Ukraine", status: "live", scheduled: Date.now() - 3600000, maxParticipants: 193, moderator: "@mod_pierre", room: 2, trialType: null },
  { id: "s4", type: "proces", topic: "Corruption d'un élu local", status: "live", scheduled: Date.now() - 5400000, maxParticipants: 12, moderator: "@juge_martin", room: 1, trialType: "correctionnel" },
  { id: "s7", type: "proces", topic: "Viol — affaire Dumont c. Ministère", status: "upcoming", scheduled: Date.now() + 86400000 * 2, maxParticipants: 12, moderator: "@juge_sophie", room: 1, trialType: "assises" },
  { id: "s5", type: "debat", topic: "L'intelligence artificielle va-t-elle détruire l'emploi ?", status: "open", scheduled: Date.now() + 3600000, maxParticipants: 20, moderator: "@mod_sofia", room: 1, trialType: null },
  { id: "s6", type: "debat", topic: "Faut-il taxer les milliardaires ?", status: "live", scheduled: Date.now() - 1800000, maxParticipants: 20, moderator: "@mod_jean", room: 1, trialType: null },
  { id: "s8", type: "assemblee", topic: "Réforme des retraites — Report de l'âge légal à 64 ans", status: "upcoming", scheduled: Date.now() + 86400000 * 3, maxParticipants: 30, moderator: "@mod_claire", room: 1, trialType: null },
  { id: "s9", type: "assemblee", topic: "Projet de loi immigration — contrôle des frontières", status: "live", scheduled: Date.now() - 1800000, maxParticipants: 30, moderator: "@mod_elise", room: 1, trialType: null },
  { id: "s10", type: "conseil", topic: "Cessez-le-feu immédiat en Palestine — Résolution d'urgence", status: "live", scheduled: Date.now() - 900000, maxParticipants: 15, moderator: "@pdt_cs", room: 1, trialType: null },
  { id: "s11", type: "presse", topic: "Conférence de presse du Ministre de l'Intérieur — réforme de la police", status: "upcoming", scheduled: Date.now() + 86400000 * 2, maxParticipants: 1, moderator: "@journaliste_ia", room: 1, trialType: null },
  { id: "s12", type: "eloquence", topic: "Grand oral — Plaidoyer pour l'engagement citoyen", status: "live", scheduled: Date.now() - 1200000, maxParticipants: 8, moderator: "@jury_lina", room: 1, trialType: null },
  { id: "s13", type: "eloquence", topic: "Soutenance orale — Présentez votre projet en 3 minutes", status: "upcoming", scheduled: Date.now() + 86400000, maxParticipants: 8, moderator: "@jury_marc", room: 1, trialType: null },
];

export async function seedRoomsIfEmpty(sql: Sql): Promise<void> {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM nexus_rooms`;
  if ((rows[0]?.n ?? 0) > 0) return;
  for (const r of SEED_ROOMS) {
    await sql`
      INSERT INTO nexus_rooms (id, type, topic, status, scheduled, max_participants, moderator_id, moderator_handle, room_number, trial_type)
      VALUES (${r.id}, ${r.type}, ${r.topic}, ${r.status}, ${r.scheduled}, ${r.maxParticipants}, NULL, ${r.moderator}, ${r.room}, ${r.trialType})
      ON CONFLICT (id) DO NOTHING
    `;
  }
}
