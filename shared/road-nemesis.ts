/*
 * Kagero — the one road rival.
 *
 * The road nemesis used to be whichever bandit last beat you, and it surfaced
 * by taking over a random bandit encounter. It is now one authored character
 * with his own face, voice and spawn rule. Losing on the road to a bandit or a
 * night ninja puts you on Kagero's list (character.wandererNemesis, written by
 * the server's World settlement). From then on he walks some of the sectors you
 * enter, hunts you down, and grows stronger each time he beats you. Beat him
 * once and he leaves you alone until the road beats you again.
 *
 * Where he stands is a per-player presence gate, keyed by (player, sector,
 * window), so the client shows him where the server will fight him.
 */
import { isPlayableWildSector } from "./sector-geo.js";
import { WANDERER_BUCKET_MS, wandererDayBucketFromMs, wandererPresenceGate } from "./wanderer-roster.js";

export const ROAD_NEMESIS_NAME = "Kagero";
/** Share of the sectors you enter that Kagero is waiting in, per window. */
export const ROAD_NEMESIS_PRESENCE = 0.25;
/** A fight started this soon after the window turns may still name him. */
export const ROAD_NEMESIS_GRACE_MS = 5 * 60_000;
/** The world id prefix of his map actor (never a natural roster id). */
export const ROAD_NEMESIS_ID_PREFIX = "nemesis-";

export type RoadNemesisRecord = { name?: unknown; level?: unknown; tier?: unknown };

/** How many times he has beaten you since he first marked you (1 at the start). */
export function roadNemesisTier(record: RoadNemesisRecord | null | undefined): number {
    return Math.max(1, Math.floor(Number(record?.tier) || 1));
}

/** His name with the title his record has earned him. */
export function roadNemesisTitle(tier: number): string {
    if (tier >= 4) return `${ROAD_NEMESIS_NAME}, Unbroken`;
    if (tier === 3) return `${ROAD_NEMESIS_NAME} the Road-Taker`;
    if (tier === 2) return `${ROAD_NEMESIS_NAME} of the Cracked Mask`;
    return ROAD_NEMESIS_NAME;
}

/** What he says when he catches up with you. */
export function roadNemesisGreeting(tier: number, playerName: string): string {
    const name = playerName.trim() || "shinobi";
    if (tier >= 4) return `"${name}. I've stopped counting how many times you've fallen. Get up and fall again."`;
    if (tier === 3) return `"Every road you take, I'm already on it, ${name}. You should have learned that by now."`;
    if (tier === 2) return `"You cracked my mask last time, ${name}, but you still lost. Let's see if you've improved."`;
    return `"Word travels fast on the road, ${name}. I heard you lost out here. I collect shinobi like you."`;
}

/** The line shown after the fight. */
export function roadNemesisAftermath(won: boolean, tier: number): string {
    if (won) return `${roadNemesisTitle(tier)} goes down hard. He spits blood, pulls his mask straight, and vanishes into the brush. He'll leave you alone until the road beats you again.`;
    return `${roadNemesisTitle(tier)} stands over you and laughs. "That's one more for my count." He'll come back stronger.`;
}

function bucketPresence(playerName: string, sector: number, dayBucket: number): boolean {
    return wandererPresenceGate(`nemesis#${playerName.trim().toLowerCase()}#${sector}#${dayBucket}`, ROAD_NEMESIS_PRESENCE);
}

/** True when Kagero is waiting for this player in `sector` in this window. */
export function roadNemesisPresentIn(playerName: string, sector: number, dayBucket: number): boolean {
    return !!playerName.trim() && isPlayableWildSector(sector) && Number.isSafeInteger(dayBucket)
        && bucketPresence(playerName, sector, dayBucket);
}

/** Server check: he is in `sector` now, or was there in the window that only
 *  just ended (a fight started across the turn of the window). */
export function roadNemesisPresentAt(playerName: string, sector: number, nowMs: number): boolean {
    const bucket = wandererDayBucketFromMs(nowMs);
    if (roadNemesisPresentIn(playerName, sector, bucket)) return true;
    return nowMs - bucket * WANDERER_BUCKET_MS < ROAD_NEMESIS_GRACE_MS
        && roadNemesisPresentIn(playerName, sector, bucket - 1);
}

/** The map actor id for his appearance in one sector and window. */
export function roadNemesisActorId(sector: number, dayBucket: number): string {
    return `${ROAD_NEMESIS_ID_PREFIX}${sector}-${dayBucket}`;
}
