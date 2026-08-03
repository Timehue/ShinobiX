import type { Character } from "../types/character";
import type { AiFightBattleKind } from "./ai-fight-api";
import { reportAiFightWin, type AiFightReportResult } from "./ai-fight-api";
import { markMissionCompleted } from "./character-progress";
import { stampWandererFightResult } from "./wanderer-fight";

/*
 * Settling a SERVER-resolved AI fight.
 *
 * The split of authority, so the two halves are not re-derived at each call site:
 *
 * SERVER (api/missions/report-ai-fight) — reads the sealed SESSION and decides
 *   everything that matters: whether the player won, the XP/ryo, the secondary
 *   rewards (stamina, territory scroll, honor seals, aura dust, kill counters),
 *   the Legacy credit, the hunt + apex kill RECEIPTS, the surviving HP, and the
 *   hospital stay on a defeat or a forfeit. All of it in one atomic save
 *   mutation, none of it inflatable from here — this module sends only the token.
 *
 * CLIENT (this module) — only the world/mission state the server does not own:
 *   the shared sector territory pool, the accepted-mission raid/explore progress
 *   counters, the local hunt-board mirror, and the daily-mission counter. Exactly
 *   the set Arena.winBattle fires for an AI win, so the two engines stay
 *   equivalent until step 5 retires the local one.
 *
 * The settle runs on EVERY resolution, not just a win. A loss must reach the
 * server or the defeat costs nothing, and an abandoned fight must reach it too or
 * a losing player can simply close the screen and retry for free.
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

/** What the server says happened. `unknown` never reaches a settled result. */
export type AiFightOutcome = "win" | "loss" | "draw" | "forfeit";

export type AiFightSettleResult = {
    /** True when the server verified and settled the fight (win OR loss). */
    settled: boolean;
    outcome: AiFightOutcome | null;
    /** What the server actually granted — never a client-side prediction. */
    ryo: number;
    capped: boolean;
    replayed: boolean;
    /** The post-settle character, with the client-owned counters folded in. */
    character: Character | null;
    _saveVersion?: number;
};

/** The client-owned counters, applied on top of the server's settled character. */
export function applyLocalAiFightCounters(character: Character, battleKind: AiFightBattleKind): Character {
    return battleKind === "mission" ? markMissionCompleted(character) : character;
}

/**
 * The world/mission side effects the server does not own. Fires only on a WIN —
 * a defeat must never consume an accepted hunt or bank raid progress.
 *
 * `battleKind` alone selects the branch, matching how Arena computes it:
 *   raidAi   → sector territory damage + raid credit + hunt-board mirror
 *   explore  → explore-mission credit
 *   mission  → nothing here (the daily counter rides on the character)
 *   defense / practice / endless → nothing local
 */
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
 * Settle a resolved (or abandoned) server AI fight. The server reads the sealed
 * session, so this call does not assert an outcome — it asks for one.
 *
 * A refused settle still resolves (`settled: false`) rather than throwing: the
 * fight happened, and the result card must say nothing was granted instead of
 * promising a reward the server already declined.
 */
export async function settleAiFight(params: {
    playerName: string;
    token: string;
    opponentId: string;
    battleKind: AiFightBattleKind;
    sector?: number;
    hooks?: AiFightSettleHooks;
}): Promise<AiFightSettleResult> {
    const reported: AiFightReportResult | null = await reportAiFightWin(params.playerName, params.token);
    const outcome = (reported?.outcome ?? null) as AiFightOutcome | null;
    // Gated on the server having ACCEPTED the win. A refused settle, a defeat or
    // a forfeit must not burn the player's accepted hunt or raid progress.
    if (reported && outcome === "win") {
        fireLocalAiFightSideEffects(params.battleKind, params.opponentId, params.sector, params.hooks ?? {});
    }
    const settledCharacter = (reported?.character ?? null) as Character | null;
    return {
        settled: !!reported,
        outcome,
        ryo: Number(reported?.ryo) || 0,
        capped: reported?.capped === true,
        replayed: reported?.replayed === true,
        character: settledCharacter && outcome === "win"
            ? applyLocalAiFightCounters(settledCharacter, params.battleKind)
            : settledCharacter,
        _saveVersion: reported?._saveVersion,
    };
}

/**
 * Whether closing the fight screen must still settle the run.
 *
 * Leaving an unresolved fight is a FORFEIT, not an escape — the server scores an
 * `active` session as one and hospitalizes. Without this a player about to lose
 * could close the screen and take no damage at all, making every fight free to
 * retry, which is strictly better than winning carefully.
 *
 * Its own function so the rule is testable: inlined in the component it could
 * only be grep-asserted, and a grep cannot tell a live branch from a dead one.
 */
export function shouldSettleOnClose(hasFight: boolean, alreadySettled: boolean): boolean {
    return hasFight && !alreadySettled;
}

/** Stamp the authoritative outcome onto any pending wanderer/ambush/hunt-pack record. */
export function stampAiFightOutcome(won: boolean, draw: boolean): void {
    if (draw) return;
    stampWandererFightResult(won ? "win" : "loss");
}
