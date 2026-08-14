import type { Character } from "../types/character";
import type { AiFightBattleKind } from "./ai-fight-api";
import { reportAiFightWin, type AiFightReportResult } from "./ai-fight-api";
import type { WorldAiFightContext } from "../../../shared/world-ai-fight";

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
 * CLIENT (this module) — adopts that versioned character and mirrors only the
 *   exact field/profession ids echoed by settlement for immediate presentation.
 *   It never infers mission, hunt, or territory progression from battleKind.
 *
 * The settle runs on EVERY resolution, not just a win. A loss must reach the
 * server or the defeat costs nothing, and an abandoned fight must reach it too or
 * a losing player can simply close the screen and retry for free.
 */

export type AiFightSettleHooks = {
    /** App's recordMissionRaid — accepted-mission raid progress for this sector. */
    onMissionRaidComplete?: (sector: number, missionIds: readonly string[]) => void;
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
    /** The post-settle character returned by the server. */
    character: Character | null;
    _saveVersion?: number;
    /** Echoed from the token/session seal; World Map callbacks never trust their
     * local pending record for encounter identity or stage. */
    worldContext?: WorldAiFightContext;
    /** Exact field-mission ids stamped by this settlement. */
    fetchMissionsCredited: string[];
    raidProgression?: {
        missionsCompleted: Array<{ id: string; name: string; xpReward: number }>;
        xpAwarded: number;
        bonusRyo: number;
        bonusSeals: number;
        territoryDamage: number;
        sector: number | null;
        replayed: boolean;
    };
};

/**
 * Presentation mirrors for exact server-owned raid receipts. Fires only on a
 * WIN; a defeat must never light a field-mission card.
 *
 * `battleKind` alone selects the branch, matching how Arena computes it:
 *   raidAi   → exact field-mission ids returned by report-ai-fight
 *   explore  → no local progression (the exact tile receipt owns field credit)
 *   mission  → nothing here (generic mission starts fail closed)
 *   defense / practice / endless → nothing local
 */
export function fireLocalAiFightSideEffects(
    battleKind: AiFightBattleKind,
    sector: number | undefined,
    hooks: AiFightSettleHooks,
    worldContext?: WorldAiFightContext,
    fetchMissionsCredited: readonly string[] = [],
): void {
    if (worldContext) return;
    if (battleKind !== "raidAi") return;
    if (typeof sector === "number") {
        if (fetchMissionsCredited.length > 0) {
            hooks.onMissionRaidComplete?.(sector, fetchMissionsCredited);
        }
    }
}

/**
 * Settle a resolved (or abandoned) server AI fight. The server reads the sealed
 * session, so this call does not assert an outcome — it asks for one.
 *
 * THROWS when the settle could not be verified at all. That is deliberate: the
 * arena shell wraps `settleFn` in a 4x backoff retry and only then offers a
 * manual Retry button, and resolving quietly here made all of that dead code —
 * one dropped request on a WIN showed "no reward was granted" while the token
 * sat unspent, with nothing the player could do. The token is single-use and the
 * redemption ledger makes a repeat idempotent, so retrying is always safe.
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
    if (!reported) throw new Error("The fight could not be settled.");
    const outcome = (reported.outcome ?? null) as AiFightOutcome | null;
    const fetchMissionsCredited = Array.from(new Set(
        (reported.raidProgression?.fetchMissionsCredited ?? reported.fetchMissionsCredited ?? [])
            .filter((missionId): missionId is string => typeof missionId === "string")
            .map((missionId) => missionId.trim())
            .filter(Boolean),
    ));
    // Gated on the server having accepted a WIN. A defeat or a forfeit must not
    // burn the player's accepted hunt or raid progress.
    if (outcome === "win") {
        fireLocalAiFightSideEffects(
            params.battleKind,
            params.sector,
            params.hooks ?? {},
            reported.worldContext,
            fetchMissionsCredited,
        );
    }
    const settledCharacter = (reported.character ?? null) as Character | null;
    const raidProgression = reported.raidProgression ? {
        missionsCompleted: Array.isArray(reported.raidProgression.missionsCompleted)
            ? reported.raidProgression.missionsCompleted.filter((mission) => !!mission
                && typeof mission.id === "string"
                && typeof mission.name === "string"
                && Number.isFinite(mission.xpReward))
            : [],
        xpAwarded: Math.max(0, Number(reported.raidProgression.xpAwarded) || 0),
        bonusRyo: Math.max(0, Number(reported.raidProgression.bonusRyo) || 0),
        bonusSeals: Math.max(0, Number(reported.raidProgression.bonusSeals) || 0),
        territoryDamage: Math.max(0, Number(reported.raidProgression.territoryDamage) || 0),
        sector: Number.isSafeInteger(Number(reported.raidProgression.sector))
            ? Math.floor(Number(reported.raidProgression.sector))
            : null,
        replayed: reported.raidProgression.replayed === true,
    } : undefined;
    return {
        settled: true,
        outcome,
        ryo: Number(reported.ryo) || 0,
        capped: reported.capped === true,
        replayed: reported.replayed === true,
        character: settledCharacter,
        _saveVersion: reported._saveVersion,
        fetchMissionsCredited,
        ...(raidProgression ? { raidProgression } : {}),
        ...(reported.worldContext ? { worldContext: reported.worldContext } : {}),
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
