import { safeName } from '../_utils.js';
import {
    MAX_RAID_REPORTS_PER_DAY,
    settleRaidProgressionWithDailyCap,
    type CappedRaidProgressionResult,
} from '../missions/_raid-progression.js';
import { settlePvpVillageWarContinuation } from '../world-state.js';
import {
    pvpSessionMayGrantProgress,
    pvpSessionMayReward,
    sealedWorldRaidAttacker,
    type PvpSession,
} from './session.js';

/*
 * World-raid progression and village-war continuation, settled from the
 * terminal session instead of from a browser's claim.
 *
 * Sector war and clan war already settle inside the terminal barrier, so they
 * land with no browser at all. These two did not: both ran only inside
 * pvp/claim-rewards, which means a duel where neither tab claimed left the raid
 * unrecorded and the village-war row untouched. This closes that gap.
 *
 * The two are settled TOGETHER and in this order because they are coupled: the
 * village-war settler may only apply a sealed World raid against an exact
 * territory proof, and that proof is the `territory` field of the raid result.
 * Splitting them would hand the war settler an unverifiable raid.
 *
 * ⛔ Nothing here throws. claim-rewards remains the settlement AUTHORITY — it
 * still calls both, still 503s so the client retries, and both settlers are
 * proof-idempotent, so its call replays whatever landed here. This module is
 * strictly additive: it can only settle earlier than before, never block. That
 * matters because the barrier is awaited by the terminal MOVE, so a throw here
 * would fail the killing blow's own response and every retry of it — the
 * lockout shape that trapped winners on the victory screen in 2026-09.
 */

export type TerminalWorldSettlement = {
    raid?: CappedRaidProgressionResult;
    villageWar?: { status: number; body: Record<string, unknown> };
};

/** Seams for tests only; production passes none and uses the real settlers. */
export type TerminalWorldRaidDeps = {
    settleRaid?: typeof settleRaidProgressionWithDailyCap;
    settleVillageWar?: typeof settlePvpVillageWarContinuation;
    now?: number;
};

export async function settleTerminalWorldRaid(
    session: PvpSession,
    deps: TerminalWorldRaidDeps = {},
): Promise<TerminalWorldSettlement> {
    const settleRaid = deps.settleRaid ?? settleRaidProgressionWithDailyCap;
    const settleVillageWar = deps.settleVillageWar ?? settlePvpVillageWarContinuation;
    const now = deps.now ?? Date.now();
    const out: TerminalWorldSettlement = {};
    // A draw has no winner to settle for. The village-war settler answers 409
    // "Battle not yet decided" for one, so this guard is what keeps a drawn
    // match's terminal move from taking the deferral path on every replay.
    if (session.winner !== 'p1' && session.winner !== 'p2') return out;
    const winnerSlug = safeName((session.winner === 'p1' ? session.p1.name : session.p2.name) ?? '');
    if (!winnerSlug) return out;

    // The same terminal-time window the claim validates before settling. A
    // malformed stamp cannot produce a valid proof and no retry can repair it.
    const settledAt = Number(session.endedAt);
    if (!Number.isSafeInteger(settledAt)
        || settledAt <= 0
        || settledAt < Number(session.createdAt)
        || settledAt > now + 60_000) return out;

    const worldAttacker = sealedWorldRaidAttacker(session);
    // Mirrors the settler's own `sealedWorldRaid`: a raid it will refuse to
    // apply without an exact, verified proof.
    const sealedWorldRaid = worldAttacker?.side === session.winner && worldAttacker.name === winnerSlug;
    const raidSector = Math.floor(Number(session.rewardSector));

    if (sealedWorldRaid
        && pvpSessionMayReward(session)
        && pvpSessionMayGrantProgress(session)
        && Number.isSafeInteger(raidSector)
        && raidSector >= 1
        && raidSector <= 66) {
        try {
            out.raid = await settleRaid({
                playerName: worldAttacker.name,
                proofId: `pvp-raid:${session.battleId}`,
                proofAt: settledAt,
                sector: raidSector,
                dailyLimit: MAX_RAID_REPORTS_PER_DAY,
                ...(session.worldTerritoryEvidence
                    ? { territoryEvidence: session.worldTerritoryEvidence }
                    : {}),
            });
        } catch (error) {
            console.error('[pvp/terminal] world raid progression deferred to claim', error);
        }
    }

    const shouldSettleVillageWar = pvpSessionMayGrantProgress(session)
        && session.rewardAuthority !== 'admin'
        && !(session.ranked === true && session.rankedKind === 'pet');
    if (!shouldSettleVillageWar) return out;

    // Never offer the war settler a sealed World raid it cannot verify. Without
    // a raid result — an out-of-range rewardSector, a session with no sealed
    // territory evidence, a raid settlement that just failed — it answers 503
    // "raid-territory proof is still finalizing" at the point of application.
    // That is correct of it, and the right response here is to leave the whole
    // settlement to the claim rather than to record a weaker outcome.
    if (sealedWorldRaid && (!out.raid || !session.worldTerritoryEvidence)) return out;

    try {
        const settlement = await settleVillageWar(
            session.battleId,
            winnerSlug,
            session,
            out.raid?.territory,
        );
        // A non-200 is not an error here, only "not settled yet". The claim owns
        // retrying it; the receipt this would have written is still unwritten,
        // so nothing is half-done.
        if (settlement.status === 200) out.villageWar = settlement;
        else console.error('[pvp/terminal] village-war continuation deferred to claim', settlement.status, settlement.body?.error);
    } catch (error) {
        console.error('[pvp/terminal] village-war continuation deferred to claim', error);
    }
    return out;
}
