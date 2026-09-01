import { kv } from '../_storage.js';
import { isDeepStrictEqual } from 'node:util';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
} from '../_war-state.js';
import { defenderPointsMultiplier, sectorWarDamageMultiplier } from '../_war-structures.js';
import { sealedSectorWarRoleOf, sectorControlSwing } from '../_war-role.js';
import {
    applySectorWarBattle,
    findSectorWarBattleReceipt,
    isSectorWarActive,
    normalizeSectorWarSession,
    recordSectorWarBattleOutcome,
    sectorWarKey,
} from '../_sector-war.js';
import {
    commitSectorWarResolutionReceipt,
    activeContestOnSector,
    findSectorWarAppliedBattle,
    loadSectorWarResolutionReceipt,
    loadSectorWarToken,
    mintSectorWarToken,
    type SectorWarResolutionReceipt,
} from '../_sector-war-store.js';
import { newSectorWarBattleToken } from '../_sector-war.js';
import { legacyEnabled, bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContributionOnce } from '../_era.js';
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

    const prior = await loadSectorWarResolutionReceipt(battleId);
    if (prior) {
        if (!receiptMatchesSession(prior, session, clock)) {
            throw new Error('sector-war-resolution-receipt-authority-conflict');
        }
        if (prior.outcome === 'applied') {
            const recovered = await findSectorWarAppliedBattle(battleId);
            const contest = recovered?.session;
            const embeddedReceipt = recovered?.receipt;
            const participantVillages = new Set([p1Village, p2Village]);
            const attackerWon = winnerVillage === contest?.attackerVillage;
            if (!contest
                || !embeddedReceipt
                || !p1Village
                || !p2Village
                || participantVillages.size !== 2
                || !participantVillages.has(contest.attackerVillage)
                || !participantVillages.has(contest.defenderVillage)
                || contest.sector !== session.rewardSector
                || embeddedReceipt.attackerWon !== attackerWon
                || embeddedReceipt.at !== clock.endedAt
                || safeName(embeddedReceipt.by) !== winnerName
                || prior.sectorWarId !== contest.id
                || prior.attackerWon !== attackerWon
                || prior.points !== embeddedReceipt.points) {
                throw new Error('sector-war-resolution-receipt-authority-conflict');
            }
            await helpAppliedSectorWarEffects(battleId, winnerName, attackerWon);
        }
        return prior;
    }

    const embedded = await findSectorWarAppliedBattle(battleId);
    if (embedded) {
        const contest = embedded.session;
        const participantVillages = new Set([p1Village, p2Village]);
        const attackerWon = winnerVillage === contest.attackerVillage;
        if (!p1Village
            || !p2Village
            || participantVillages.size !== 2
            || !participantVillages.has(contest.attackerVillage)
            || !participantVillages.has(contest.defenderVillage)
            || contest.sector !== session.rewardSector
            || embedded.receipt.attackerWon !== attackerWon
            || embedded.receipt.at !== clock.endedAt
            || safeName(embedded.receipt.by) !== winnerName) {
            throw new Error('sector-war-embedded-receipt-authority-conflict');
        }
        await helpAppliedSectorWarEffects(battleId, winnerName, attackerWon);
        return commitSectorWarResolutionReceipt({
            ...receiptBase,
            outcome: 'applied',
            sectorWarId: contest.id,
            attackerWon,
            points: embedded.receipt.points,
            attackerPoints: contest.attackerPoints,
            defenderPoints: contest.defenderPoints,
        });
    }

    const token = await loadSectorWarToken(battleId);
    if (!token) return commitNoop('not-applicable');
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

    const result = await withKvLock(sectorWarKey(token.sectorWarId), async () => {
        const rawContest = await kv.get<Parameters<typeof normalizeSectorWarSession>[0]>(
            sectorWarKey(token.sectorWarId),
        );
        const contest = rawContest ? normalizeSectorWarSession(rawContest) : null;
        if (!contest || clock.createdAt < contest.startedAt) {
            return { outcome: 'superseded' as const, contest };
        }
        if (!isSectorWarActive(contest, clock.endedAt)) {
            return { outcome: 'superseded' as const, contest };
        }
        const existing = findSectorWarBattleReceipt(contest, battleId);
        if (existing) {
            if (existing.attackerWon !== attackerWon
                || existing.at !== clock.endedAt
                || safeName(existing.by) !== winnerName) {
                throw new Error('sector-war-embedded-receipt-conflict');
            }
            return {
                outcome: 'applied' as const,
                replayed: true,
                awarded: existing.points,
                session: contest,
            };
        }
        const [attackerState, defenderState] = await Promise.all([
            kv.get<Record<string, unknown>>(villageWarKey(token.attackerVillage)),
            kv.get<Record<string, unknown>>(villageWarKey(token.defenderVillage)),
        ]);
        const projected = applySectorWarBattle(contest, attackerWon, {
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
        const recorded = recordSectorWarBattleOutcome(projected, {
            battleId,
            attackerWon,
            by: winnerName,
            at: clock.endedAt,
        });
        try {
            if (!(await kv.compareSet(sectorWarKey(token.sectorWarId), rawContest, recorded.session))) {
                throw new Error('sector-war-contest-version-conflict');
            }
        } catch (error) {
            const recovered = await kv.get<unknown>(sectorWarKey(token.sectorWarId)).catch(() => null);
            if (!isDeepStrictEqual(recovered, recorded.session)) throw error;
        }
        return {
            outcome: 'applied' as const,
            replayed: false,
            awarded: projected.awarded,
            session: recorded.session,
        };
    }, { failClosed: true });

    if (result.outcome === 'superseded') return commitNoop('superseded', token.sectorWarId);

    await helpAppliedSectorWarEffects(battleId, winnerName, attackerWon);
    return commitSectorWarResolutionReceipt({
        ...receiptBase,
        outcome: 'applied',
        sectorWarId: token.sectorWarId,
        attackerWon,
        points: result.awarded,
        attackerPoints: result.session.attackerPoints,
        defenderPoints: result.session.defenderPoints,
    });
}
