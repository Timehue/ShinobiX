import type { Pet } from "../types/pet";
import { petXpNeeded } from "./pet-balance";

export type AuthoritativePetExpeditionGains = {
  xp: number;
  leveledUp: boolean;
  statSummary: string;
};

function totalPetProgressXp(pet: Pet): number {
  let total = Math.max(0, Number(pet.xp) || 0);
  for (let level = 1; level < Math.max(1, Number(pet.level) || 1); level += 1) {
    total += petXpNeeded(level);
  }
  return total;
}

/** Derive the reward presentation from the server-returned pet, never from the
 * optimistic client preview. This also handles XP that crosses level boundaries. */
export function authoritativePetExpeditionGains(before: Pet, after: Pet): AuthoritativePetExpeditionGains {
  const gain = (field: "attack" | "defense" | "speed" | "hp") =>
    Math.max(0, Math.floor(Number(after[field]) || 0) - Math.floor(Number(before[field]) || 0));
  const statParts = [
    ["ATK", gain("attack")],
    ["DEF", gain("defense")],
    ["SPD", gain("speed")],
    ["HP", gain("hp")],
  ]
    .filter((entry) => Number(entry[1]) > 0)
    .map(([label, amount]) => `+${amount} ${label}`);

  return {
    xp: Math.max(0, totalPetProgressXp(after) - totalPetProgressXp(before)),
    leveledUp: after.level > before.level,
    statSummary: statParts.join(" · "),
  };
}
