/*
 * Client side of the server-authoritative mission claim.
 *
 * The client posts only { missionType, missionId } to /api/missions/claim-mission
 * — never reward amounts. The server resolves the reward from its trusted
 * catalog, enforces eligibility (daily cap / pending combat claim / one-time
 * Academy Trial / level), persists under the save lock, and returns the
 * server-computed amounts. We then MIRROR those amounts onto the local character
 * (same reconcile pattern PetYard uses after report-pet-event) so the UI matches
 * and the next autosave carries the credited values.
 *
 * `gainXp` is injected by the caller (it lives in App.tsx) to avoid a lib→App
 * import cycle — every screen that claims already imports it.
 */
import { grantTerritoryScrolls } from "./world-state";
import { applyCurrencyRewards } from "./currency";
import { markMissionCompleted, markHuntCompleted } from "./character-progress";
import { currentMonthKey } from "./utils";
import type { Character, CurrencyRewards } from "../types/character";

export type MissionType = "combat" | "field" | "hunt" | "academy-trial";

export type ClaimReward = {
    xpBoosted: number;        // base after the town-hall boost; pass to gainXp
    ryo: number;
    stamina: number;
    territoryScrolls: number;
    currency: CurrencyRewards;
    items?: string[];         // literal item ids (hunt material drops)
};

export type ClaimMissionResult =
    | {
        ok: true;
        applied: true;
        reward: ClaimReward;
        combat?: { aiProfileId: string; missionKey: string };
        completion: "daily" | "total" | "none" | "hunt";
        academyTrialClaimed?: boolean;
    }
    | { ok: true; applied: false; reason: string; clientFallback?: boolean }
    | null;

export async function postClaimMission(
    playerName: string,
    missionType: MissionType,
    missionId: string,
): Promise<ClaimMissionResult> {
    try {
        const r = await fetch("/api/missions/claim-mission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, missionType, missionId }),
        });
        if (!r.ok) return null;
        return (await r.json()) as ClaimMissionResult;
    } catch {
        return null;
    }
}

// Apply the SERVER-computed reward onto the local character.
export function applyServerMissionReward(
    character: Character,
    result: Extract<ClaimMissionResult, { applied: true }>,
    gainXp: (c: Character, amount: number) => Character,
): Character {
    let next = gainXp(character, result.reward.xpBoosted);
    next = { ...next, ryo: next.ryo + result.reward.ryo };
    if (result.reward.stamina > 0) {
        next = { ...next, stamina: Math.min(next.maxStamina, next.stamina + result.reward.stamina) };
    }
    if (result.reward.territoryScrolls > 0) {
        next = grantTerritoryScrolls(next, result.reward.territoryScrolls);
    }
    if (result.reward.items && result.reward.items.length > 0) {
        next = { ...next, inventory: [...next.inventory, ...result.reward.items] };
    }
    next = applyCurrencyRewards(next, result.reward.currency);
    if (result.combat) {
        const aiId = result.combat.aiProfileId;
        const missionKey = result.combat.missionKey;
        next = {
            ...next,
            totalAiKills: (next.totalAiKills ?? 0) + 1,
            dailyAiKills: (next.dailyAiKills ?? 0) + 1,
            defeatedAiIds: (next.defeatedAiIds ?? []).includes(aiId) ? (next.defeatedAiIds ?? []) : [...(next.defeatedAiIds ?? []), aiId],
            aiKills: { ...(next.aiKills ?? {}), [aiId]: ((next.aiKills ?? {})[aiId] ?? 0) + 1 },
            pendingCombatMissionClaims: (next.pendingCombatMissionClaims ?? []).filter((key) => key !== missionKey),
        };
    }
    if (result.completion === "daily") {
        next = markMissionCompleted(next);
    } else if (result.completion === "hunt") {
        // Hunter Guild contract — bumps the independent daily-hunt counter.
        next = markHuntCompleted(next);
    } else if (result.completion === "total") {
        // Counts toward lifetime/clan totals (e.g. the Academy checklist's "first
        // mission" goal) but NOT the daily cap.
        next = {
            ...next,
            clanMissionContrib: (next.clanMissionContrib ?? 0) + 1,
            totalMissionsCompleted: (next.totalMissionsCompleted ?? 0) + 1,
            clanContribMonth: currentMonthKey(),
        };
    }
    if (result.academyTrialClaimed) next = { ...next, academyTrialClaimed: true };
    return next;
}

export function claimReasonMessage(reason: string): string {
    switch (reason) {
        case "daily-cap": return "Daily mission limit reached (20/20). Resets at midnight UTC.";
        case "not-queued": return "Win this mission's battle first.";
        case "level": return "You don't meet the level requirement.";
        case "already-claimed": return "You've already claimed this.";
        case "no-save": return "Could not load your save. Try again.";
        default: return "Could not claim this mission right now. Try again.";
    }
}
