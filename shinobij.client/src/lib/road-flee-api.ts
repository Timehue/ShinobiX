import { roadFleeCost, type RoadFleeCost } from "../../../shared/road-flee";
import type { Character } from "../types/character";
import type { Wanderer } from "./wanderers";

/** The flee price, said before the choice: every hostile that stops you shows it. */
export function roadFleePriceLine(character: Pick<Character, "hp" | "ryo" | "level">): string {
    const cost = roadFleeCost(character.hp, character.ryo, character.level);
    const parts = [cost.hp > 0 ? `lose ${cost.hp.toLocaleString()} HP` : "", cost.ryo > 0 ? `drop ${cost.ryo.toLocaleString()} ryo` : ""].filter(Boolean);
    return parts.length ? `If you flee, you ${parts.join(" and ")}.` : "You have nothing left to lose by running.";
}

/**
 * The hostile an exploration's rolled battle stands for, so it stops the player
 * in the same Fight/Flee encounter dialog as a road bandit. The server picks
 * the real opponent when the fight starts; this is only who blocks the path.
 */
export function exploreAmbushWanderer(requestId: string, level: number): Wanderer {
    return {
        id: `explore-ambush-${requestId}`, name: "Wild Challenger", archetype: "bandit", verb: "attack",
        level, homeTile: 0, waypoints: [], movement: "stationary", tellTint: "var(--red-400)", avatarKey: "bandit",
        greeting: "You picked the wrong ground to go digging in.",
    };
}

/** Which ambush is being fled: a hostile on the road, or an exploration's rolled battle. */
export type RoadFleeTarget = { kind: "road" } | { kind: "explore"; sector: number; requestId: string };

export type RoadFleeResult =
    | { ok: true; cost: RoadFleeCost; totals: { hp: number; ryo: number }; _saveVersion?: number }
    | { ok: false; reason?: string; error: string };

/**
 * The server charges the price in shared/road-flee.ts; the client never sends
 * an amount. `fleeId` is one per Flee choice, so a retry is never charged twice.
 */
export async function fleeRoadAmbush(playerName: string, fleeId: string, target: RoadFleeTarget): Promise<RoadFleeResult> {
    const fallback = "You could not break away. Fight, or try to run again.";
    try {
        const res = await fetch("/api/sector/road-flee", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, fleeId, ...target }),
            // The choice cannot be dismissed, so a stalled request must end: a
            // retry with the same fleeId replays rather than charging again.
            signal: AbortSignal.timeout(12_000),
        });
        const data = await res.json().catch(() => ({})) as {
            ok?: boolean; reason?: string; error?: string; cost?: RoadFleeCost; totals?: { hp: number; ryo: number }; _saveVersion?: number;
        };
        if (res.ok && data.ok === true && data.cost && data.totals) return { ok: true, cost: data.cost, totals: data.totals, _saveVersion: data._saveVersion };
        return { ok: false, reason: data.reason, error: data.error || fallback };
    } catch {
        return { ok: false, error: fallback };
    }
}
