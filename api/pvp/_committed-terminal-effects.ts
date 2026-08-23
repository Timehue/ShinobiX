import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { hasRecentIpOrFpOverlapStrict } from '../_player-ips.js';
import {
    RECEIPT_TTL_SEC,
    buildBattleReceipt,
    indexBattleForParticipants,
    receiptKey,
    type BattleReceipt,
} from '../_receipts.js';
import { onlineStore } from '../_realtime/online-store.js';
import { safeName } from '../_utils.js';
import {
    discoverAcceptedKageDuelPointer,
    kageDuelKey,
    parseKageDuelPointer,
    recordPendingKageSettle,
    settleKageDuelFromSession,
} from '../village/_kage-settle.js';
import { confirmPlayerRankedTerminalEffects } from './_ranked-terminal-effects.js';
import { grantVanguardRewardsForSession } from './_vanguard-rewards.js';
import {
    isPlayerRankedV2Session,
    pvpSessionMayGrantProgress,
    type PvpSession,
} from './session.js';
import type { PlayerRankedJournal } from './_player-ranked-journal.js';
import { replayCommittedPvpActionReceipt } from './_action-receipt-replay.js';
import { ensurePvpTerminalRecoveryPublication } from './_reward-recovery.js';
import { settlePvpSectorWarContinuation } from './_sector-war-continuation.js';
import { settlePvpClanWarContinuation } from '../clan/war/_pvp-settlement.js';
import type { PvpClanWarSettlement } from '../clan/war/_pvp-settlement.js';

export type CommittedPvpTerminalReplay = {
    playerRankedJournal?: PlayerRankedJournal;
    clanWarSettlement?: PvpClanWarSettlement;
};

function jsonCanonical<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function committedTerminalAt(session: PvpSession): number {
    for (const candidate of [session.endedAt, session.lastMoveAt, session.createdAt]) {
        const value = Number(candidate);
        if (Number.isSafeInteger(value) && value > 0) return value;
    }
    // Malformed legacy data remains deterministic across every helper retry.
    return 1;
}

function isBattleReceiptFor(value: unknown, battleId: string): value is BattleReceipt {
    return !!value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Partial<BattleReceipt>).battleId === battleId;
}

/** Persist the receipt body itself as the CAS authority (no marker/body gap). */
async function ensureCommittedBattleReceipt(session: PvpSession): Promise<BattleReceipt | null> {
    if (process.env.DISABLE_COMBAT_RECEIPTS === '1') return null;
    const key = receiptKey(session.battleId);
    const desired = jsonCanonical(buildBattleReceipt(session, committedTerminalAt(session)));
    const current = await kv.get<unknown>(key);
    // Existing pre-upgrade receipts and later settlement patches remain valid;
    // never overwrite an immutable battle record merely to normalize its shape.
    if (isBattleReceiptFor(current, session.battleId)) return current;
    if (current !== null) throw new Error('pvp-battle-receipt-conflict');
    try {
        if (await kv.compareSet(key, null, desired, { ex: RECEIPT_TTL_SEC })) return desired;
    } catch (error) {
        const recovered = await kv.get<unknown>(key).catch(() => null);
        if (isBattleReceiptFor(recovered, session.battleId)) return recovered;
        throw error;
    }
    const recovered = await kv.get<unknown>(key);
    if (isBattleReceiptFor(recovered, session.battleId)) return recovered;
    throw new Error('pvp-battle-receipt-unconfirmed');
}

/**
 * Help a terminal session's idempotent side effects forward.
 *
 * Callers must pass a projection that is already the exact committed KV row.
 * Nothing here mutates that row, so a failed/retried helper cannot publish an
 * uncommitted combat outcome. Ranked V2 intentionally propagates failures: its
 * non-expiring terminal row remains the durable recovery anchor until the
 * journal, item, Elo, Vanguard, and admission saga completes.
 */
export async function replayCommittedPvpTerminalEffects(
    session: PvpSession,
): Promise<CommittedPvpTerminalReplay> {
    if (session.status !== 'done') return {};

    // Refresh both real-player recovery pointers from the exact committed row
    // and seal the terminal snapshot before shorter-lived presentation work.
    // A private-mode/full reload can then discover and repair completion without
    // any browser storage breadcrumb.
    await ensurePvpTerminalRecoveryPublication(kv, session.battleId, session);

    // A terminal retry is also the final action's durable replay path. The
    // capsule lives in the exact committed session, so no uncommitted move can
    // publish history and a crash after combat CAS remains repairable.
    await replayCommittedPvpActionReceipt(kv, session);

    // Presence is a cache projection. Repeating these clears is harmless and
    // ensures a process death after the terminal CAS cannot leave either player
    // looking permanently engaged once any terminal reader retries.
    try {
        onlineStore.setInBattle(session.p1.name, false);
        onlineStore.clearPendingAttacker(session.p1.name);
        onlineStore.setInBattle(session.p2.name, false);
        onlineStore.clearPendingAttacker(session.p2.name);
    } catch (error) {
        console.error('[pvp/terminal] presence cleanup failed', error);
    }

    // Receipt and history writers are battle-id idempotent. Indexing is retried
    // even when the receipt writer reports "already exists", which repairs a
    // crash after the receipt but before one participant's history projection.
    let receipt: BattleReceipt | null = null;
    try {
        receipt = await ensureCommittedBattleReceipt(session);
        if (receipt) await indexBattleForParticipants(receipt, {
            lock: withKvLock,
            safeName,
        });
    } catch (error) {
        console.error('[pvp/terminal] battle history index failed', error);
    }

    // Persist the Kage outcome before attempting the immediate seat transfer.
    // A missing pointer is a legitimate non-Kage battle. Once a pointer exists,
    // malformed/conflicting evidence or an unconfirmed seat CAS must propagate:
    // reward completion cannot ACK away the only recovery path for an official
    // Kage duel. The session itself is passed into settlement so a 48-hour
    // recovery snapshot can help forward after the live combat row expires.
    if (session.winner) {
        const pointerValue = await kv.get<unknown>(kageDuelKey(session.battleId));
        const pointer = pointerValue === null
            ? await discoverAcceptedKageDuelPointer(session)
            : parseKageDuelPointer(pointerValue);
        if (pointerValue !== null && !pointer) throw new Error('kage-duel-pointer-malformed');
        if (pointer) {
            await recordPendingKageSettle(pointer.village, session, pointer.challengeId);
            const settled = await settleKageDuelFromSession(pointer.village, session, Date.now(), {
                expectChallengeId: pointer.challengeId,
            });
            if (!settled.ok) {
                throw new Error(`kage-settlement-unconfirmed:${settled.status}:${settled.error}`);
            }
        }
    }

    // World Combat contests are server settlement, never a browser callback.
    // This runs for either participant's retry (and terminal move replay) before
    // reward completion can ACK-clear the recovery pointer. Ordinary world PvP
    // durably records a canonical no-op when no contest binding exists.
    if (session.rewardAuthority === 'world' && pvpSessionMayGrantProgress(session)) {
        await settlePvpSectorWarContinuation(session);
    }

    // The terminal PvP row is the exact opposite-side Clan War proof. Settle
    // wins, losses, and draws here so every terminal replay (including either
    // participant's claim after a lost response) closes the accepted challenge
    // before browser completion can ACK away its recovery pointer.
    const clanWarSettlement = session.rewardAuthority === 'clan-war'
        ? await settlePvpClanWarContinuation(session) ?? undefined
        : undefined;

    if (isPlayerRankedV2Session(session)) {
        const playerRankedJournal = await confirmPlayerRankedTerminalEffects(kv, session, {
            eligible: async (a, b) => !(await hasRecentIpOrFpOverlapStrict(a, b, kv)),
            lock: (saveKey, action) => withKvLock(saveKey, action, { failClosed: true }),
        });
        return { playerRankedJournal, clanWarSettlement };
    }

    // The receipt inside the Vanguard settlement is the authority; the old
    // session flag was only a fast path. Do not rewrite the terminal projection
    // after CAS merely to add a display log/flag.
    if (session.winner && session.winner !== 'draw' && pvpSessionMayGrantProgress(session)) {
        // This durable settlement is part of the terminal credit barrier. A
        // transient saga/storage failure must keep claim completion and the
        // player recovery pointer pending so the exact session can help it
        // forward; normal ineligible `{ granted:false }` results remain success.
        await grantVanguardRewardsForSession(session);
    }

    return { clanWarSettlement };
}
