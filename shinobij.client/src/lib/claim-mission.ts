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

export type MissionType = "combat" | "field" | "hunt" | "apex" | "academy-trial" | "academy-checklist";

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
        academyChecklistClaimed?: boolean;
        character?: Character;
        _saveVersion?: number;
    }
    | {
        ok: true;
        applied: false;
        reason: string;
        error?: string;
        requiredLevel?: number;
        playerLevel?: number;
        requiredSystem?: string;
        requiredProfession?: string;
        requiredProfessionRank?: number;
        // What the server's progress receipt actually holds — present when a field
        // claim is rejected for incomplete progress. Mirror it onto local progress
        // so an optimistic card that ran ahead of the server becomes doable again.
        serverProgress?: { exploreCount: number; raidCount: number };
    }
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
    // Current servers return the final character committed under the save lock.
    // Keep the reward-mirroring branch only for a rolling deploy against an
    // older backend; once every server is upgraded this fallback can be removed.
    if (result.character) return { ...character, ...result.character };
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
    if (result.academyChecklistClaimed) next = { ...next, academyChecklistClaimed: true };
    return next;
}

export function claimReasonMessage(reason: string, result?: Extract<ClaimMissionResult, { applied: false }>): string {
    switch (reason) {
        case "daily-cap": return "Daily mission limit reached (20/20). Resets at midnight UTC.";
        case "not-queued": return "Win this mission's battle first.";
        case "missing-progress-receipt":
        case "incomplete-progress-receipt": return "Finish this mission's required field progress first.";
        // Both are recoverable: HunterBoard rolls tracking back to required-1 when
        // these fire, so the trail relights and the beast can be re-fought.
        case "missing-hunt-kill-receipt": return "The server never recorded this kill. The trail is hot again — hunt the beast once more to re-earn the contract.";
        case "missing-server-evidence": return "Some of this hunt's tracking wasn't recorded by the server. The trail is hot again — track and kill the beast once more.";
        case "level": return "You don't meet the level requirement.";
        case "level-too-low": return result?.requiredLevel ? `Unlocks at Level ${result.requiredLevel}.` : "You don't meet this mission's level requirement.";
        case "rank-too-low": return "You don't meet this mission's rank requirement.";
        case "profession-mismatch": return result?.requiredProfession ? `Requires ${result.requiredProfession} profession.` : "This mission requires a different profession.";
        case "profession-rank-too-low": return result?.requiredProfessionRank ? `Requires profession rank ${result.requiredProfessionRank}.` : "Your profession rank is too low for this mission.";
        case "system-locked": return systemLockedMessage(result?.requiredSystem);
        case "missing-clan": return "Requires joining a clan.";
        case "missing-village": return "Requires joining a village.";
        case "missing-pet": return "Requires a pet.";
        case "feature-disabled": return "This mission's feature is not enabled right now.";
        case "not-yet-unlocked": return "This mission is not unlocked for your character yet.";
        case "unknown-mission": return "This mission is not available for server-authoritative rewards.";
        case "already-claimed": return "You've already claimed this.";
        case "already-claimed-today": return "You've already claimed this today. Resets at midnight UTC.";
        case "no-save": return "Could not load your save. Try again.";
        // Server self-heals the stale durable claim flag when this fires (the
        // mission's single-use authority token expired or predates the token gate);
        // the card flips back to "Begin Mission" so you can re-fight to re-earn it.
        // Mirror the exact string from api/_release-flags.ts.
        case "server_authoritative_combat_required": return "This mission's claim window has passed. Win the battle again to re-earn the reward.";
        default: return "Could not claim this mission right now. Try again.";
    }
}

function systemLockedMessage(system?: string): string {
    switch (system) {
        case "hollowGate": return "Requires Hollow Gate access.";
        case "ranked": return "Requires ranked PvP.";
        case "pvp": return "Requires PvP access.";
        case "clanBoss": return "Requires clan boss access.";
        case "villageWar": return "Requires an active village war.";
        case "legacy": return "Requires Legacy access.";
        case "pet":
        case "expedition": return "Requires a pet.";
        case "cardClash": return "Requires Chronicle Showdown access.";
        default: return "This mission requires a system your character has not unlocked yet.";
    }
}
