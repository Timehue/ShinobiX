/*
 * Road patrols answer to the village that holds the sector they walk.
 *
 * The roll still decides WHERE a patrol stands (shared/wanderer-roster.ts);
 * the territory decides whose patrol it is. Client and server read the same
 * owner (the sector's territory record) and run this same function, so the
 * patrol the map shows is the patrol the server will fight.
 *
 *   home     your own village holds the road: the patrol warns you, never fights
 *   rival    another village holds it: you may still spar with its patrol
 *   rivalWar the holder is at war with your village: the patrol hunts you down
 *            and stops you with Fight/Flee, like a bandit
 *   (none)   an unclaimed road keeps the old neutral patrol
 */

export type PatrolStance = "home" | "rival" | "rivalWar";

function clean(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/** How a patrol in a sector held by `ownerVillage` treats a player from
 *  `playerVillage`, or null on an unclaimed road. */
export function patrolStance(ownerVillage: unknown, playerVillage: unknown, warEnemies: readonly string[]): PatrolStance | null {
    const owner = clean(ownerVillage);
    if (!owner) return null;
    const mine = clean(playerVillage);
    if (mine && owner.toLowerCase() === mine.toLowerCase()) return "home";
    return warEnemies.some((enemy) => clean(enemy).toLowerCase() === owner.toLowerCase()) ? "rivalWar" : "rival";
}

/** The patrol's name as it walks a claimed road. */
export function patrolNameFor(ownerVillage: unknown, stance: PatrolStance | null, fallback: string): string {
    const owner = clean(ownerVillage);
    if (!owner || !stance) return fallback;
    return `${owner} Patrol`;
}

const PATROL_LINES: Record<PatrolStance, readonly string[]> = {
    home: [
        "You're one of ours. Keep your head down past the next ridge.",
        "Our village controls this road. Safe travels, and tell us if you see trouble.",
        "Good to see a friendly face out here. Need news from the road?",
    ],
    rival: [
        "You're a long way from your own village. Mind your manners on our road.",
        "This road belongs to our village. Pass through, and don't linger.",
        "We know your village's colors. Keep walking, unless you want a lesson.",
    ],
    rivalWar: [
        "Your village is at war with ours. You picked the wrong road.",
        "Enemy colors on our road. Draw, or run.",
        "We've orders to stop your kind on sight. Nothing personal.",
    ],
};

/** A stable greeting for this patrol and stance. */
export function patrolGreeting(stance: PatrolStance, seed: number): string {
    const lines = PATROL_LINES[stance];
    return lines[Math.abs(Math.floor(seed)) % lines.length];
}
