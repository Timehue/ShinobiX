import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
} from '../_war-state.js';
import { defenderPointsMultiplier, sectorWarDamageMultiplier } from '../_war-structures.js';
import { sealedSectorWarRoleOf, sectorControlSwing } from '../_war-role.js';
import {
    applySectorWarBattle,
    isSectorWarActive,
    sectorWarId,
} from '../_sector-war.js';
import {
    commitSectorWarBattle,
    commitSectorWarResolutionReceipt,
    activeContestOnSector,
    locateSectorWarAppliedBattle,
    loadSectorWarResolutionReceipt,
    loadSectorWarToken,
    mintSectorWarToken,
    type SectorWarLocatedBattle,
    type SectorWarResolutionReceipt,
} from '../_sector-war-store.js';
import { newSectorWarBattleToken } from '../_sector-war.js';
import { legacyEnabled, bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContributionOnce } from '../_era.js';
import { villageWarMapEnabled } from '../_release-flags.js';
import { logWarEvent } from '../_war-event-log.js';
import {
    pvpSessionMayGrantProgress,
    type PvpSession,
} from './session.js';

function safeTerminalClock(session: PvpSession): { createdAt: number; endedAt: number } | null {
    const createdAt = Number(session.createdAt);
    const endedAt = Number(session.endedAt);
    return Number.isSafeInteger(createdAt) && createdAt > 0
        && Number.isSafeInteger(endedAt) && endedAt >= createdAt
        ? { createdAt, endedAt }
        : null;
}

function sealedFighterVillage(session: PvpSession, side: 'p1' | 'p2'): string {
    return String(session[side]?.character?.village ?? '').trim();
}

function receiptMatchesSession(
    receipt: SectorWarResolutionReceipt,
    session: PvpSession,
    clock: { createdAt: number; endedAt: number },
): boolean {
    return receipt.battleId === session.battleId
        && receipt.p1Name === safeName(session.p1?.name ?? '')
        && receipt.p2Name === safeName(session.p2?.name ?? '')
        && receipt.sessionCreatedAt === clock.createdAt
        && receipt.sessionEndedAt === clock.endedAt;
}

/**
 * The two contest ids a world battle could have scored in. A contest row is
 * keyed `<sector>:<attacker>-vs-<defender>`, and a sector-war battle is always
 * fought between exactly its contest's two villages — in one order or the
 * other. Empty when the battle carries no usable sector/village evidence.
 */
function candidateContestIds(session: PvpSession, p1Village: string, p2Village: string): string[] {
    const sector = Math.floor(Number(session.rewardSector));
    if (!Number.isSafeInteger(sector) || sector <= 0 || !p1Village || !p2Village || p1Village === p2Village) return [];
    const ids = [sectorWarId(sector, p1Village, p2Village), sectorWarId(sector, p2Village, p1Village)];
    return ids[0] === ids[1] ? [] : ids;
}

/** Which fighter's village attacked in `contestId`, read from the id's own
 *  attacker-first ordering. Null when the id is not one of the candidates. */
function attackerVillageFromContestId(contestId: string, candidates: readonly string[], p1Village: string, p2Village: string): string | null {
    if (candidates.length !== 2) return null;
    if (contestId === candidates[0]) return p1Village;
    if (contestId === candidates[1]) return p2Village;
    return null;
}

export type PvpSectorWarRegistration =
    | { registered: true; sectorWarId: string; biome?: string }
    | { registered: false; noContest: true };

async function helpAppliedSectorWarEffects(
    battleId: string,
    winnerName: string,
    attackerWon: boolean,
): Promise<void> {
    if (!legacyEnabled()) return;
    const receiptId = `sector-pvp:${battleId}`;
    const legacySettled = await bumpLegacyStats(winnerName, {
        warPvpKills: 1,
        warContribution: 2000,
        ...(!attackerWon ? { sectorDefenses: 1, defensiveWins: 1 } : {}),
    }, {
        receiptId,
        durableReceipt: true,
    });
    if (!legacySettled) throw new Error('sector-war-legacy-effects-unconfirmed');
    // Era delivery is also receipt-backed. Existing receipts confirm replay;
    // write/read failures keep PvP completion pending for help-forward.
    await bumpEraContributionOnce('warBattles', receiptId);
}

/**
 * Server-side move prerequisite. Client registration improves UX/terrain
 * presentation, but a reload or lost response can never let combat advance
 * without either an exact contest token or a proven no-contest result.
 */
export async function ensurePvpSectorWarRegistration(
    session: PvpSession,
): Promise<PvpSectorWarRegistration> {
    if (session.rewardAuthority !== 'world'
        || (session.progressionAuthorityVersion !== 1 && session.baseRewards !== true)) {
        return { registered: false, noContest: true };
    }
    // The war kill switch closes this door too. World PvP is not a war
    // endpoint, so DISABLE_VILLAGE_WAR used to leave it binding new battles to
    // Combat contests (and scoring them) while every war route answered 404.
    if (!villageWarMapEnabled()) return { registered: false, noContest: true };
    const sector = Math.floor(Number(session.rewardSector));
    if (!Number.isSafeInteger(sector) || sector <= 0) return { registered: false, noContest: true };
    const contest = await activeContestOnSector(sector, session.createdAt);
    if (!contest || contest.winCondition !== 'combat') return { registered: false, noContest: true };
    const p1Name = safeName(session.p1?.name ?? '');
    const p2Name = safeName(session.p2?.name ?? '');
    const p1Village = sealedFighterVillage(session, 'p1');
    const p2Village = sealedFighterVillage(session, 'p2');
    const villages = new Set([p1Village, p2Village]);
    if (!p1Name
        || !p2Name
        || villages.size !== 2
        || !villages.has(contest.attackerVillage)
        || !villages.has(contest.defenderVillage)) {
        return { registered: false, noContest: true };
    }
    const existing = await loadSectorWarToken(session.battleId);
    if (existing) {
        if (existing.sectorWarId !== contest.id
            || existing.sector !== sector
            || existing.p1Name !== p1Name
            || existing.p2Name !== p2Name
            || existing.p1Village !== p1Village
            || existing.p2Village !== p2Village
            || existing.createdAt !== session.createdAt) {
            throw new Error('sector-war-token-authority-conflict');
        }
        const biome = existing.biome || session.biome;
        return { registered: true, sectorWarId: contest.id, ...(biome ? { biome } : {}) };
    }
    const defenderState = normalizeVillageWarRecord(
        contest.defenderVillage,
        (await kv.get<Record<string, unknown>>(villageWarKey(contest.defenderVillage))) ?? undefined,
    );
    const biome = defenderState.sectors[String(sector)]?.terrain || session.biome || 'central';
    const registeredBy = safeName(session.worldAttacker?.name ?? '');
    if (!registeredBy) throw new Error('sector-war-world-attacker-invalid');
    await mintSectorWarToken(newSectorWarBattleToken({
        battleId: session.battleId,
        sectorWarId: contest.id,
        sector,
        attackerVillage: contest.attackerVillage,
        defenderVillage: contest.defenderVillage,
        registeredBy,
        winCondition: 'combat',
        p1Name,
        p2Name,
        p1Village,
        p2Village,
        biome,
        now: session.createdAt,
    }));
    return { registered: true, sectorWarId: contest.id, ...(biome ? { biome } : {}) };
}

/**
 * Settle the optional Combat-sector contest tied to an exact terminal session.
 *
 * This is a mandatory server continuation, not a browser callback. Ordinary
 * world PvP without a contest token commits a canonical no-op. A score embedded
 * by the contest CAS is recovered before token lookup, closing the crash gap
 * between the contest write and the external per-battle receipt.
 */
export async function settlePvpSectorWarContinuation(
    session: PvpSession,
): Promise<SectorWarResolutionReceipt> {
    const clock = safeTerminalClock(session);
    if (session.status !== 'done' || !session.winner || !clock) {
        throw new Error('sector-war-terminal-session-invalid');
    }
    if (session.rewardAuthority !== 'world' || !pvpSessionMayGrantProgress(session)) {
        throw new Error('sector-war-session-authority-invalid');
    }
    const battleId = session.battleId;
    const p1Name = safeName(session.p1?.name ?? '');
    const p2Name = safeName(session.p2?.name ?? '');
    if (!p1Name || !p2Name) throw new Error('sector-war-session-participants-invalid');

    const receiptBase = {
        version: 1 as const,
        battleId,
        p1Name,
        p2Name,
        sessionCreatedAt: clock.createdAt,
        sessionEndedAt: clock.endedAt,
    };
    const commitNoop = (outcome: 'superseded' | 'not-applicable', sectorWarId: string | null = null) => (
        commitSectorWarResolutionReceipt({
            ...receiptBase,
            outcome,
            sectorWarId,
            attackerWon: null,
            points: 0,
            attackerPoints: null,
            defenderPoints: null,
        })
    );

    if (session.winner === 'draw') return commitNoop('not-applicable');

    const p1Village = sealedFighterVillage(session, 'p1');
    const p2Village = sealedFighterVillage(session, 'p2');
    const winnerSide = session.winner === 'p1' ? 'p1' : 'p2';
    const loserSide = winnerSide === 'p1' ? 'p2' : 'p1';
    const winnerName = winnerSide === 'p1' ? p1Name : p2Name;
    const winnerVillage = winnerSide === 'p1' ? p1Village : p2Village;

    // An applied battle is recovered from its own evidence: the two contest
    // ids it could belong to follow from its sector and sealed villages, so
    // recovery is a handful of keyed reads — never a scan of every war.
    const candidates = candidateContestIds(session, p1Village, p2Village);
    const locate = (boundContestId: string | null) => locateSectorWarAppliedBattle({
        contestIds: [...(boundContestId ? [boundContestId] : []), ...candidates],
        battleId,
        battleCreatedAt: clock.createdAt,
        scanContestIds: boundContestId ? [boundContestId] : [],
    });
    const proveApplied = (located: SectorWarLocatedBattle, conflict: string) => {
        const contest = located.session;
        const participantVillages = new Set([p1Village, p2Village]);
        // With the row, its own villages decide who attacked (as they always
        // did). Once the row is gone, the contest id's ordering does.
        const attackerVillage = contest
            ? contest.attackerVillage
            : attackerVillageFromContestId(located.contestId, candidates, p1Village, p2Village);
        const attackerWon = !!attackerVillage && winnerVillage === attackerVillage;
        if (!attackerVillage
            || !candidates.includes(located.contestId)
            || (contest && (!participantVillages.has(contest.attackerVillage)
                || !participantVillages.has(contest.defenderVillage)
                || contest.sector !== session.rewardSector))
            || located.receipt.attackerWon !== attackerWon
            || located.receipt.at !== clock.endedAt
            || safeName(located.receipt.by) !== winnerName) {
            throw new Error(conflict);
        }
        return { attackerWon, attackerPoints: located.tally.attackerPoints, defenderPoints: located.tally.defenderPoints };
    };

    const prior = await loadSectorWarResolutionReceipt(battleId);
    if (prior) {
        if (!receiptMatchesSession(prior, session, clock)) {
            throw new Error('sector-war-resolution-receipt-authority-conflict');
        }
        if (prior.outcome === 'applied') {
            const located = await locate(prior.sectorWarId);
            if (!located) throw new Error('sector-war-resolution-receipt-authority-conflict');
            const proven = proveApplied(located, 'sector-war-resolution-receipt-authority-conflict');
            if (prior.sectorWarId !== located.contestId
                || prior.attackerWon !== proven.attackerWon
                || prior.points !== located.receipt.points) {
                throw new Error('sector-war-resolution-receipt-authority-conflict');
            }
            await helpAppliedSectorWarEffects(battleId, winnerName, proven.attackerWon);
        }
        return prior;
    }

    // Crash recovery: the contest CAS records the score (and its receipt)
    // before the per-battle resolution receipt is published. Recover that
    // exact proof before trusting the registration token, whose TTL is only an
    // admission horizon.
    const token = await loadSectorWarToken(battleId);
    const embedded = await locate(token?.sectorWarId ?? null);
    if (embedded) {
        const proven = proveApplied(embedded, 'sector-war-embedded-receipt-authority-conflict');
        await helpAppliedSectorWarEffects(battleId, winnerName, proven.attackerWon);
        return commitSectorWarResolutionReceipt({
            ...receiptBase,
            outcome: 'applied',
            sectorWarId: embedded.contestId,
            attackerWon: proven.attackerWon,
            points: embedded.receipt.points,
            attackerPoints: proven.attackerPoints,
            defenderPoints: proven.defenderPoints,
        });
    }

    if (!token) return commitNoop('not-applicable');
    // With the war switched off nothing new scores, not even a battle bound
    // before the switch: DISABLE_VILLAGE_WAR is the operators' way to stop a
    // war mid-event. The outcome is final (a replay returns this receipt).
    // Scores that had already landed were recovered above, so none is lost.
    if (!villageWarMapEnabled()) {
        logWarEvent('pvp-resolution', {
            contestId: token.sectorWarId,
            battleId,
            outcome: 'superseded',
            reason: 'war-disabled',
        }, 'warn');
        return commitNoop('superseded', token.sectorWarId);
    }
    if (token.battleId !== battleId
        || token.createdAt !== clock.createdAt
        || p1Name !== token.p1Name
        || p2Name !== token.p2Name
        || p1Village !== token.p1Village
        || p2Village !== token.p2Village
        || session.rewardSector !== token.sector) {
        throw new Error('sector-war-token-authority-conflict');
    }

    const tokenWinnerVillage = winnerSide === 'p1' ? token.p1Village : token.p2Village;
    const tokenLoserVillage = loserSide === 'p1' ? token.p1Village : token.p2Village;
    const attackerWon = tokenWinnerVillage === token.attackerVillage;
    const winnerRole = sealedSectorWarRoleOf(
        session.warRoleEvidence,
        winnerSide,
        tokenWinnerVillage,
        clock.createdAt,
    );
    const loserRole = sealedSectorWarRoleOf(
        session.warRoleEvidence,
        loserSide,
        tokenLoserVillage,
        clock.createdAt,
    );

    const result = await commitSectorWarBattle({
        contestId: token.sectorWarId,
        battleId,
        decide: async (contest) => {
            // A battle that began before this contest instance belongs to an
            // earlier war on the sector; one that ended after the war stopped
            // being live is a defender hold. Both use immutable battle clocks,
            // never the delayed claim's wall-clock.
            if (clock.createdAt < contest.startedAt) return { kind: 'skip', reason: 'superseded' };
            if (!isSectorWarActive(contest, clock.endedAt)) return { kind: 'skip', reason: 'superseded' };
            const [attackerState, defenderState] = await Promise.all([
                kv.get<Record<string, unknown>>(villageWarKey(token.attackerVillage)),
                kv.get<Record<string, unknown>>(villageWarKey(token.defenderVillage)),
            ]);
            // Score the kill. Sectors never flip mid-war -- settlement compares
            // the tallies when the 72 hours close (api/_sector-war-settle.ts).
            const outcome = applySectorWarBattle(contest, attackerWon, {
                now: clock.endedAt,
                roleSwing: sectorControlSwing(winnerRole, loserRole),
                attackerMult: sectorWarDamageMultiplier(
                    normalizeVillageWarRecord(token.attackerVillage, attackerState ?? undefined),
                ),
                defenderMult: defenderPointsMultiplier(
                    normalizeVillageWarRecord(token.defenderVillage, defenderState ?? undefined),
                ),
                by: winnerName,
            });
            return { kind: 'score', outcome, attackerWon, by: winnerName, at: clock.endedAt };
        },
        verifyPrior: (existing) => {
            if (existing.attackerWon !== attackerWon
                || existing.at !== clock.endedAt
                || safeName(existing.by) !== winnerName) {
                throw new Error('sector-war-embedded-receipt-conflict');
            }
        },
    });

    if (result.status !== 'applied') {
        logWarEvent('pvp-resolution', {
            contestId: token.sectorWarId,
            battleId,
            outcome: 'superseded',
            reason: result.status === 'skipped' ? result.reason : result.status,
        });
        return commitNoop('superseded', token.sectorWarId);
    }

    await helpAppliedSectorWarEffects(battleId, winnerName, attackerWon);
    return commitSectorWarResolutionReceipt({
        ...receiptBase,
        outcome: 'applied',
        sectorWarId: token.sectorWarId,
        attackerWon,
        points: result.receipt.points,
        attackerPoints: result.session.attackerPoints,
        defenderPoints: result.session.defenderPoints,
    });
}
