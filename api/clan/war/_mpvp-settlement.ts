/*
 * Clan War shinobi 2v2 — settlement adapter.
 *
 * This is the ONLY place a clan-war 2v2 writes a reward. The Tower MPvP modules
 * that run the fight stay reward-free (asserted by _pvp-contract.test.ts), so
 * the four-player engine can be shared with the public Team Arena without the
 * open queue ever gaining a progression path. Structurally the same split the
 * 1v1 continuation uses in _pvp-settlement.ts.
 *
 * Exactly-once discipline: a durable receipt keyed by the match makes any of the
 * four members' settle calls converge, and a retry after a lost response is a
 * no-op rather than a second 60 HP hit.
 */
import { isDeepStrictEqual } from 'node:util';
import { kv } from '../../_storage.js';
import { withKvLock } from '../../_lock.js';
import type { TowerPvpTeamId } from '../../../shared/tower-pvp.js';
import { towerPvpBindingOf } from '../../../shared/tower-pvp.js';
import type { StoredTowerPvpMatch } from '../../towers/_pvp-session.js';
import {
    applyFinalResult,
    CLAN_WAR_KEY_PREFIX,
    CLAN_WAR_REMATCH_COOLDOWN_SEC,
    clanWarCooldownKey,
    type ChallengeResult,
    type ClanChallenge,
    type ClanWar,
} from './_storage.js';
import { settleClanWar2v2Consumables } from './_mpvp-consumables.js';
import { awardPvpFinalizedWarPoints } from './_war-points.js';
import { awardPvpWarEndClanXp } from './_war-xp.js';

const RECEIPT_TTL_SECONDS = 60 * 24 * 60 * 60;

type ClanWar2v2Receipt = {
    version: 1;
    matchId: string;
    warId: string;
    challengeId: string;
    result: ChallengeResult;
    outcome: 'applied' | 'superseded';
    settledAt: number;
};

export type ClanWar2v2Settlement = {
    outcome: 'applied' | 'superseded';
    replayed: boolean;
    warId: string;
    challengeId: string;
    result: ChallengeResult;
};

const receiptKey = (matchId: string) => `clan-war:mpvp-settlement:${matchId}`;

/**
 * Amber is always the challenging clan (see _mpvp.ts), so the mapping is fixed
 * and never depends on which member reports.
 *
 * A cancelled match — ready-check timeout, or someone leaving before the first
 * turn — records a DRAW. It deals no HP either way rather than inventing a
 * forfeit rule: the challenge closes without rewarding a no-show grief tactic.
 */
export function clanWar2v2Result(match: StoredTowerPvpMatch): ChallengeResult | null {
    if (match.status === 'cancelled') return 'draw';
    if (match.status !== 'done') return null;
    const winner: TowerPvpTeamId | 'draw' | null = match.winner;
    if (winner === 'amber') return 'from-wins';
    if (winner === 'violet') return 'to-wins';
    return winner === 'draw' ? 'draw' : null;
}

function exactReceipt(value: unknown, expected: ClanWar2v2Receipt): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value) && isDeepStrictEqual(value, expected);
}

async function commitReceipt(receipt: ClanWar2v2Receipt): Promise<void> {
    if (await kv.set(receiptKey(receipt.matchId), receipt, { ex: RECEIPT_TTL_SECONDS, nx: true })) return;
    const observed = await kv.get<unknown>(receiptKey(receipt.matchId));
    // A concurrent settler that reached the same conclusion is success, not a
    // conflict. A DIFFERENT conclusion means the two disagree and must not both
    // stand — surface it rather than silently keeping one.
    if (!exactReceipt(observed, receipt)) throw new Error('clan-war-2v2-receipt-conflict');
}

async function ensureCooldown(war: ClanWar): Promise<void> {
    if (!Number.isSafeInteger(war.endedAt) || Number(war.endedAt) <= 0) return;
    const deadline = Number(war.endedAt) + CLAN_WAR_REMATCH_COOLDOWN_SEC * 1_000;
    const remaining = Math.ceil((deadline - Date.now()) / 1_000);
    if (remaining <= 0) return;
    await kv.set(clanWarCooldownKey(war.clans[0], war.clans[1]), war.endedAt, { ex: remaining });
}

/**
 * Apply a terminal 2v2 match to its clan war. Safe to call from all four
 * members and safe to retry; only the first call that observes a pending
 * challenge applies HP.
 */
export async function settleClanWar2v2Match(
    match: StoredTowerPvpMatch,
): Promise<ClanWar2v2Settlement | null> {
    const binding = towerPvpBindingOf(match);
    if (binding.kind !== 'clan-war') return null;
    const result = clanWar2v2Result(match);
    if (!result) throw new Error('clan-war-2v2-match-not-terminal');

    const terminalAt = Number(match.updatedAt);
    if (!Number.isSafeInteger(terminalAt)
        || terminalAt < Number(match.createdAt)
        || terminalAt > Date.now() + 60_000) {
        throw new Error('clan-war-2v2-terminal-time-invalid');
    }

    const warKey = `${CLAN_WAR_KEY_PREFIX}${binding.warId}`;
    const prior = await kv.get<ClanWar2v2Receipt>(receiptKey(match.matchId));
    if (prior) {
        if (prior.result !== result || prior.challengeId !== binding.challengeId) {
            throw new Error('clan-war-2v2-receipt-result-conflict');
        }
        const war = await kv.get<ClanWar>(warKey);
        if (war) await ensureCooldown(war);
        return {
            outcome: prior.outcome,
            replayed: true,
            warId: prior.warId,
            challengeId: prior.challengeId,
            result: prior.result,
        };
    }

    const publication = await withKvLock(warKey, async () => {
        const current = await kv.get<ClanWar>(warKey);
        if (!current || current.id !== binding.warId) throw new Error('clan-war-2v2-row-missing');

        const completed = current.completedChallenges.find(entry => entry.id === binding.challengeId);
        if (completed) {
            // Already finalized — by a racing member, by war finalization, or by
            // the legacy report route. Bind to it instead of applying twice.
            if (completed.result && completed.result !== result) {
                throw new Error('clan-war-2v2-completed-conflict');
            }
            return {
                war: current,
                challenge: completed,
                outcome: 'superseded' as const,
                warEnded: Number.isSafeInteger(current.endedAt),
            };
        }

        const challenge = current.pendingChallenges.find(entry => entry.id === binding.challengeId);
        if (!challenge || challenge.mode !== 'pvp2v2') throw new Error('clan-war-2v2-challenge-conflict');
        if (current.endedAt) {
            // The war closed under the fight. Record the outcome without moving
            // HP on a finished war.
            return { war: current, challenge, outcome: 'superseded' as const, warEnded: true };
        }

        const projected = applyFinalResult(
            current,
            { ...challenge, pvpSettlementVersion: 1 } as ClanChallenge,
            result,
            terminalAt,
        );
        const candidate: ClanWar = {
            ...projected.war,
            updatedAt: Math.max(Number(current.updatedAt) || 0, terminalAt),
        };
        if (await kv.compareSet(warKey, current, candidate)) {
            return {
                war: candidate,
                challenge: projected.completed,
                outcome: 'applied' as const,
                warEnded: projected.warJustEnded,
            };
        }
        throw new Error('clan-war-2v2-publication-busy');
    }, { failClosed: true });

    // Charge consumables regardless of outcome — a potion drunk in a superseded
    // or war-ended duel was still drunk. Receipt-guarded, so this is idempotent.
    await settleClanWar2v2Consumables(match).catch(error => {
        // Never let an item charge block the war result; the receipt makes a
        // later retry exact rather than double-charging.
        console.warn('[clan-war 2v2] consumable settlement deferred', error);
    });

    if (publication.outcome === 'applied') {
        await awardPvpFinalizedWarPoints({
            war: publication.war,
            challenge: publication.challenge,
            warEnded: publication.warEnded,
            tentative: false,
        }, match.matchId, terminalAt);
        if (publication.warEnded) {
            await awardPvpWarEndClanXp(publication.war, match.matchId, terminalAt);
        }
    }
    await ensureCooldown(publication.war);

    const receipt: ClanWar2v2Receipt = {
        version: 1,
        matchId: match.matchId,
        warId: binding.warId,
        challengeId: binding.challengeId,
        result,
        outcome: publication.outcome,
        settledAt: terminalAt,
    };
    await commitReceipt(receipt);
    return {
        outcome: receipt.outcome,
        replayed: false,
        warId: receipt.warId,
        challengeId: receipt.challengeId,
        result: receipt.result,
    };
}
