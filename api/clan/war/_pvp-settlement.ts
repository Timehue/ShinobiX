import { isDeepStrictEqual } from 'node:util';
import { kv } from '../../_storage.js';
import { withKvLock } from '../../_lock.js';
import { safeName } from '../../_utils.js';
import { pvpSessionMayReward, type PvpSession } from '../../pvp/session.js';
import {
    applyFinalResult,
    CLAN_WAR_KEY_PREFIX,
    CLAN_WAR_REMATCH_COOLDOWN_SEC,
    clanWarCooldownKey,
    type ChallengeResult,
    type ClanChallenge,
    type ClanWar,
} from './_storage.js';
import {
    awardPvpFinalizedWarPoints,
    challengeWinners,
    clanWarPvpTerritoryScrollDrop,
    finalizedWarPointTotals,
} from './_war-points.js';
import { awardPvpWarEndClanXp } from './_war-xp.js';

const RECEIPT_TTL_SECONDS = 60 * 24 * 60 * 60;

type PvpClanWarReceipt = {
    version: 1;
    battleId: string;
    warId: string;
    challengeId: string;
    result: ChallengeResult;
    outcome: 'applied' | 'superseded';
    settledAt: number;
};

export type PvpClanWarSettlement = {
    outcome: 'applied' | 'superseded';
    replayed: boolean;
    warId: string;
    challengeId: string;
    result: ChallengeResult;
    /** Exact points credited to each participant by this settlement. */
    pointsByPlayer: Record<string, number>;
    /** Exact server-authored scroll result keyed by canonical winner name. */
    territoryScrollsByPlayer: Record<string, number>;
};

function territoryScrollsByPlayer(
    challenge: ClanChallenge,
    battleId: string,
    outcome: 'applied' | 'superseded',
): Record<string, number> {
    if (outcome !== 'applied' || challenge.mode !== 'pvp1v1' || challenge.result === 'draw') return {};
    return Object.fromEntries(challengeWinners(challenge).map((name) => {
        const player = safeName(name);
        return [player, player && clanWarPvpTerritoryScrollDrop(battleId, player) ? 1 : 0];
    }).filter(([player]) => Boolean(player)));
}

function receiptKey(battleId: string): string {
    return `pvp:clan-war-continuation:${battleId}`;
}

function exactReceipt(value: unknown, expected: PvpClanWarReceipt): boolean {
    return !!value
        && typeof value === 'object'
        && !Array.isArray(value)
        && isDeepStrictEqual(value, expected);
}

function parseReceipt(value: unknown, session: PvpSession): PvpClanWarReceipt | null {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('pvp-clan-war-receipt-invalid');
    }
    const row = value as Partial<PvpClanWarReceipt>;
    if (row.version !== 1
        || row.battleId !== session.battleId
        || row.warId !== session.clanWarId
        || row.challengeId !== session.clanWarChallengeId
        || (row.result !== 'from-wins' && row.result !== 'to-wins' && row.result !== 'draw')
        || (row.outcome !== 'applied' && row.outcome !== 'superseded')
        || !Number.isSafeInteger(row.settledAt)
        || Number(row.settledAt) <= 0
        || row.settledAt !== session.endedAt) {
        throw new Error('pvp-clan-war-receipt-invalid');
    }
    return row as PvpClanWarReceipt;
}

function expectedResult(session: PvpSession, challenge: ClanChallenge): ChallengeResult {
    if (session.winner !== 'p1' && session.winner !== 'p2' && session.winner !== 'draw') {
        throw new Error('pvp-clan-war-winner-invalid');
    }
    const from = [challenge.fromPlayer, challenge.fromPlayer2]
        .map((name) => safeName(name ?? ''))
        .filter(Boolean);
    const to = [challenge.acceptedPlayer, challenge.acceptedPlayer2]
        .map((name) => safeName(name ?? ''))
        .filter(Boolean);
    if (session.winner === 'draw') {
        const p1 = safeName(session.p1.name);
        const p2 = safeName(session.p2.name);
        if (!p1 || !p2
            || (!from.includes(p1) && !to.includes(p1))
            || (!from.includes(p2) && !to.includes(p2))
            || from.includes(p1) === from.includes(p2)) {
            throw new Error('pvp-clan-war-participants-conflict');
        }
        return 'draw';
    }
    const winner = safeName(session.winner === 'p1' ? session.p1.name : session.p2.name);
    const loser = safeName(session.winner === 'p1' ? session.p2.name : session.p1.name);
    if (!winner || !loser
        || (!from.includes(winner) && !to.includes(winner))
        || (!from.includes(loser) && !to.includes(loser))
        || from.includes(winner) === from.includes(loser)) {
        throw new Error('pvp-clan-war-participants-conflict');
    }
    return from.includes(winner) ? 'from-wins' : 'to-wins';
}

function receiptMatchesPublishedChallenge(
    receipt: PvpClanWarReceipt,
    challenge: ClanChallenge,
    war: ClanWar,
): boolean {
    if (receipt.outcome === 'applied') {
        return challenge.status === 'completed'
            && challenge.result === receipt.result
            && challenge.pvpSettlementVersion === 1;
    }
    if (challenge.status === 'completed') {
        return challenge.result === receipt.result
            && challenge.pvpSettlementVersion !== 1;
    }
    return !!war.endedAt
        && (challenge.status === 'accepted' || challenge.status === 'cancelled');
}

async function commitReceipt(receipt: PvpClanWarReceipt): Promise<void> {
    const key = receiptKey(receipt.battleId);
    try {
        if (await kv.compareSet(key, null, receipt, { ex: RECEIPT_TTL_SECONDS })) return;
    } catch (error) {
        const recovered = await kv.get<unknown>(key).catch(() => null);
        if (exactReceipt(recovered, receipt)) return;
        throw error;
    }
    const current = await kv.get<unknown>(key);
    if (exactReceipt(current, receipt)) return;
    throw new Error('pvp-clan-war-receipt-conflict');
}

async function ensureCooldown(war: ClanWar): Promise<void> {
    if (!Number.isSafeInteger(war.endedAt) || Number(war.endedAt) <= 0) return;
    const deadline = Number(war.endedAt) + CLAN_WAR_REMATCH_COOLDOWN_SEC * 1_000;
    const remaining = Math.ceil((deadline - Date.now()) / 1_000);
    if (remaining <= 0) return;
    await kv.set(clanWarCooldownKey(war.clans[0], war.clans[1]), war.endedAt, { ex: remaining });
}

/**
 * Help the exact server-authored Clan War result forward from either fighter's
 * reward claim. No sessionStorage report or opposing-side confirmation is
 * required: the joined terminal PvP row already seals both consent and winner.
 */
export async function settlePvpClanWarContinuation(
    session: PvpSession,
): Promise<PvpClanWarSettlement | null> {
    if (session.rewardAuthority !== 'clan-war') return null;
    if (!pvpSessionMayReward(session)
        || session.status !== 'done'
        || (session.winner !== 'p1' && session.winner !== 'p2' && session.winner !== 'draw')
        || !session.clanWarId
        || !session.clanWarChallengeId) {
        throw new Error('pvp-clan-war-session-invalid');
    }
    const terminalAt = Number(session.endedAt);
    if (!Number.isSafeInteger(terminalAt)
        || terminalAt < Number(session.createdAt)
        || terminalAt > Date.now() + 60_000) {
        throw new Error('pvp-clan-war-terminal-time-invalid');
    }
    const warKey = `${CLAN_WAR_KEY_PREFIX}${session.clanWarId}`;
    const prior = parseReceipt(await kv.get<unknown>(receiptKey(session.battleId)), session);
    if (prior) {
        const war = await kv.get<ClanWar>(warKey);
        if (!war || war.id !== session.clanWarId) throw new Error('pvp-clan-war-receipt-row-missing');
        const challenge = war.completedChallenges.find((entry) => entry.id === session.clanWarChallengeId)
            ?? war.pendingChallenges.find((entry) => entry.id === session.clanWarChallengeId);
        if (!challenge || challenge.battleId !== session.battleId) {
            throw new Error('pvp-clan-war-receipt-challenge-conflict');
        }
        const result = expectedResult(session, challenge);
        if (prior.result !== result
            || !receiptMatchesPublishedChallenge(prior, challenge, war)) {
            throw new Error('pvp-clan-war-receipt-result-conflict');
        }
        await ensureCooldown(war);
        const settlementBody = {
            war,
            challenge,
            warEnded: Number.isSafeInteger(war.endedAt),
            tentative: false,
        };
        return {
            ...prior,
            replayed: true,
            pointsByPlayer: prior.outcome === 'applied'
                ? finalizedWarPointTotals(settlementBody)
                : {},
            territoryScrollsByPlayer: territoryScrollsByPlayer(challenge, session.battleId, prior.outcome),
        };
    }

    const publication = await withKvLock(warKey, async () => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const current = await kv.get<ClanWar>(warKey);
            if (!current || current.id !== session.clanWarId) {
                throw new Error('pvp-clan-war-row-missing');
            }
            const completed = current.completedChallenges.find((entry) => (
                entry.id === session.clanWarChallengeId
            ));
            if (completed) {
                if (completed.battleId !== session.battleId) {
                    throw new Error('pvp-clan-war-completed-conflict');
                }
                const result = expectedResult(session, completed);
                // War finalization sweeps every still-accepted challenge into
                // completed history as cancelled. The exact sealed battle may
                // finish later; bind it, but stamp a durable superseded no-op.
                if (completed.status === 'cancelled' && !completed.result && current.endedAt) {
                    return {
                        war: current,
                        challenge: completed,
                        result,
                        outcome: 'superseded' as const,
                        warEnded: true,
                    };
                }
                if (!completed.result) throw new Error('pvp-clan-war-completed-conflict');
                if (completed.result !== result) throw new Error('pvp-clan-war-result-conflict');
                // A completed challenge without the cutover marker was
                // finalized by the legacy/admin report route, which already
                // ran its point/XP side effects. Bind it without replaying a
                // second settlement under the new receipt namespace.
                if (completed.pvpSettlementVersion !== 1) {
                    return {
                        war: current,
                        challenge: completed,
                        result,
                        outcome: 'superseded' as const,
                        warEnded: Number.isSafeInteger(current.endedAt),
                    };
                }
                return {
                    war: current,
                    challenge: completed,
                    result,
                    outcome: 'applied' as const,
                    warEnded: Number.isSafeInteger(current.endedAt),
                };
            }
            const challenge = current.pendingChallenges.find((entry) => (
                entry.id === session.clanWarChallengeId
            ));
            if (!challenge
                || challenge.status !== 'accepted'
                || challenge.mode !== 'pvp1v1'
                || challenge.battleId !== session.battleId) {
                throw new Error('pvp-clan-war-challenge-conflict');
            }
            const result = expectedResult(session, challenge);
            if (current.endedAt) {
                return {
                    war: current,
                    challenge,
                    result,
                    outcome: 'superseded' as const,
                    warEnded: true,
                };
            }
            const projected = applyFinalResult(current, {
                ...challenge,
                pvpSettlementVersion: 1,
            }, result, terminalAt);
            const candidate: ClanWar = {
                ...projected.war,
                updatedAt: Math.max(Number(current.updatedAt) || 0, terminalAt),
            };
            try {
                if (await kv.compareSet(warKey, current, candidate)) {
                    return {
                        war: candidate,
                        challenge: projected.completed,
                        result,
                        outcome: 'applied' as const,
                        warEnded: projected.warJustEnded,
                    };
                }
            } catch (error) {
                const recovered = await kv.get<ClanWar>(warKey).catch(() => null);
                const recoveredChallenge = recovered?.completedChallenges.find((entry) => (
                    entry.id === session.clanWarChallengeId
                        && entry.battleId === session.battleId
                        && entry.result === result
                ));
                if (recovered && recoveredChallenge) {
                    return {
                        war: recovered,
                        challenge: recoveredChallenge,
                        result,
                        outcome: recoveredChallenge.pvpSettlementVersion === 1
                            ? 'applied' as const
                            : 'superseded' as const,
                        warEnded: Number.isSafeInteger(recovered.endedAt),
                    };
                }
                throw error;
            }
        }
        throw new Error('pvp-clan-war-publication-busy');
    }, { failClosed: true });

    const settlementBody = {
        war: publication.war,
        challenge: publication.challenge,
        warEnded: publication.warEnded,
        tentative: false,
    };
    if (publication.outcome === 'applied') {
        await awardPvpFinalizedWarPoints(settlementBody, session.battleId, terminalAt);
        if (publication.warEnded) {
            await awardPvpWarEndClanXp(publication.war, session.battleId, terminalAt);
        }
    }
    await ensureCooldown(publication.war);
    const receipt: PvpClanWarReceipt = {
        version: 1,
        battleId: session.battleId,
        warId: session.clanWarId,
        challengeId: session.clanWarChallengeId,
        result: publication.result,
        outcome: publication.outcome,
        settledAt: terminalAt,
    };
    await commitReceipt(receipt);
    return {
        ...receipt,
        replayed: false,
        pointsByPlayer: publication.outcome === 'applied'
            ? finalizedWarPointTotals(settlementBody)
            : {},
        territoryScrollsByPlayer: territoryScrollsByPlayer(
            publication.challenge,
            session.battleId,
            publication.outcome,
        ),
    };
}
