import type { Character } from "../types/character";
import type { AiFightBattleKind } from "./ai-fight-api";
import { reportAiFightWin, type AiFightReportResult } from "./ai-fight-api";
import { markMissionCompleted } from "./character-progress";
import { stampWandererFightResult } from "./wanderer-fight";

/*
 * Settling a SERVER-resolved AI fight.
 *
 * The split of authority, so the two halves are not re-derived at each call
 * site:
 *
 * SERVER (api/missions/report-ai-fight, from the token sealed at start) — XP,
 *   ryo, stamina, the territory scroll, honor seals, aura dust, bone charms,
 *   fate shards, totalAiKills / dailyAiKills / totalVillageRaids / defeatedAiIds
 *   / aiKills, the Legacy kill credit, and the hunt + apex kill RECEIPTS. All of
 *   it keyed off the SEALED battleKind and opponentId, in one atomic save
 *   mutation, so none of it can be inflated from here.
 *
 * CLIENT (this module) — only what the server does not own: the shared sector
 *   territory pool, the accepted-mission raid/explore progress counters, the
 *   local hunt-board mirror, and the daily-mission counter. Exactly the set
 *   Arena.winBattle fires for an AI win, so the two paths stay equivalent until
 *   step 5 retires the local one.
 *
 * `battleKind` alone selects the branch, matching how Arena computes it:
 *   raidAi   → sector territory damage + raid credit + hunt-board mirror
 *   explore  → explore-mission credit
 *   mission  → the daily-mission counter
 *   defense / practice / endless → nothing local
 */

export type AiFightSettleHooks = {
    /**
     * Damage this sector's shared territory pool by the raid amount. Supplied by
     * the host rather than imported here on purpose: lib/world-state reaches back
     * into App for its back-compat re-exports, and pulling that in would drag a
     * component (and its .css) into this module — which node's test runner
     * cannot load, so this file would stop being testable.
     */
    onSectorRaidDamage?: (sector: number) => void;
    /** App's recordMissionRaid — accepted-mission raid progress for this sector. */
    onMissionRaidComplete?: (sector: number) => void;
    /** App's recordMissionExplore — explore credit deferred until the ambush was won. */
    onExploreAmbushWon?: () => void;
    /** App's completeHuntForAi — the LOCAL hunt-board mirror. The authoritative
     *  receipt is written server-side by report-ai-fight's hunt-kill producer. */
    onHuntBeastDefeated?: (opponentId: string) => void;
};

export type AiFightSettleResult = {
    /** True when the server verified and paid the win. */
    paid: boolean;
    /** What the server actually granted — never a client-side prediction. */
    ryo: number;
    capped: boolean;
    replayed: boolean;
    /** The post-payout character, with the client-owned counters folded in. */
    character: Character | null;
    _saveVersion?: number;
};

/** The client-owned counters, applied on top of the server's paid character. */
export function applyLocalAiFightCounters(character: Character, battleKind: AiFightBattleKind): Character {
    return battleKind === "mission" ? markMissionCompleted(character) : character;
}

/** The world/mission side effects the server does not own. Safe to call once per win. */
export function fireLocalAiFightSideEffects(
    battleKind: AiFightBattleKind,
    opponentId: string,
    sector: number | undefined,
    hooks: AiFightSettleHooks,
): void {
    if (battleKind === "explore") hooks.onExploreAmbushWon?.();
    if (battleKind !== "raidAi") return;
    if (typeof sector === "number") {
        hooks.onSectorRaidDamage?.(sector);
        hooks.onMissionRaidComplete?.(sector);
    }
    // Hunt contracts complete ONLY on an actual kill; the beast is fought as a
    // raidAi and this marks the matching accepted hunt claimable on the board.
    hooks.onHuntBeastDefeated?.(opponentId);
}

/**
 * Settle a won server AI fight: redeem the sealed token, then fire the
 * client-owned side effects. A refused report still resolves (paid: false) —
 * the fight happened, and the result card must say nothing was granted rather
 * than promise a reward the server already declined.
 */
export async function settleAiFightWin(params: {
    playerName: string;
    token: string;
    opponentId: string;
    battleKind: AiFightBattleKind;
    sector?: number;
    hooks?: AiFightSettleHooks;
}): Promise<AiFightSettleResult> {
    // A plain practice bout grants NOTHING — no ryo, stats, currency, items or
    // kill credit. Arena's win path returns before it reports one, so reporting
    // here would silently start paying for fights that are meant to pay nothing.
    // Progression comes from missions/hunts/raids, real PvP and training.
    if (params.battleKind === "practice") {
        return { paid: false, ryo: 0, capped: false, replayed: false, character: null };
    }
    const reported: AiFightReportResult | null = await reportAiFightWin(params.playerName, params.token);
    // The side effects are NOT gated on the report succeeding for a replayed
    // token (the reward was already paid on the first pass), but they ARE gated
    // on the server having accepted the win at all — otherwise a refused report
    // would still burn the player's accepted hunt or raid progress.
    if (reported) {
        fireLocalAiFightSideEffects(params.battleKind, params.opponentId, params.sector, params.hooks ?? {});
    }
    const paidCharacter = (reported?.character ?? null) as Character | null;
    return {
        paid: !!reported,
        ryo: Number(reported?.ryo) || 0,
        capped: reported?.capped === true,
        replayed: reported?.replayed === true,
        character: paidCharacter ? applyLocalAiFightCounters(paidCharacter, params.battleKind) : null,
        _saveVersion: reported?._saveVersion,
    };
}

/** Stamp the authoritative outcome onto any pending wanderer/ambush/hunt-pack record. */
export function stampAiFightOutcome(won: boolean, draw: boolean): void {
    if (draw) return;
    stampWandererFightResult(won ? "win" : "loss");
}
