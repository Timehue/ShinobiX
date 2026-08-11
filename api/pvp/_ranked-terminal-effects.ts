import type { KvLike } from '../_storage.js';
import { SESSION_TTL } from '../combat-core/constants.js';
import {
    completePlayerRankedAdmission,
    getPlayerRankedAdmission,
    readPetRankedSeasonGateFresh,
} from '../pet/_ranked-preparation.js';
import {
    settlePvpConsumablesDurably,
    type SaveLockRunner,
} from './_consumable-settlement.js';
import {
    publishPlayerRankedTerminal,
    settlePlayerRankedJournal,
    getPlayerRankedJournal,
    type PlayerRankedJournal,
} from './_player-ranked-journal.js';
import {
    isPlayerRankedV2Session,
    playerRankedSessionMatchesAdmission,
    pvpSessionMayGrantProgress,
    type PvpSession,
} from './session.js';
import { boundExactPvpSession } from './_session-mutation.js';
import {
    grantVanguardRewardsForSession,
    hasDurableVanguardTerminalOutcome,
} from './_vanguard-rewards.js';

type RankedTerminalStore = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'keys'>;

/**
 * Durable terminal hook shared by move retries and season rollover. Publication
 * alone is not completion: exact empty-item authority and both rating-side
 * confirmations must land, and the gate admission must be removed, before the
 * caller may compact the non-expiring terminal session.
 */
export async function confirmPlayerRankedTerminalEffects(
    store: RankedTerminalStore,
    session: PvpSession,
    options: {
        eligible: (a: string, b: string) => Promise<boolean>;
        lock: SaveLockRunner;
        now?: number;
    },
): Promise<PlayerRankedJournal> {
    const journal = await publishPlayerRankedTerminal(store, session, {
        eligible: options.eligible,
        now: options.now,
    });
    await settlePvpConsumablesDurably(store, session, options.lock, {
        now: options.now,
        playerRankedJournal: journal,
    });
    const settled = await settlePlayerRankedJournal(
        store,
        journal.terminal.matchId,
        Math.max(1, Math.floor(options.now ?? Date.now())),
        { completeAdmission: false },
    );
    if (settled.journal.terminal.rankedEligible
        && session.winner
        && session.winner !== 'draw'
        && pvpSessionMayGrantProgress(session)) {
        // Ranked Vanguard progression is part of the same discoverable saga.
        // Failure must leave the terminal admission/session durable so a move,
        // claim, queue sweep, or season close can retry before compaction.
        await grantVanguardRewardsForSession(session, {
            store,
            lock: options.lock,
            rankedTerminal: settled.journal.terminal,
            now: options.now,
            // Player Ranked V2 is enabled only after the documented full
            // worker drain, so its durable saga may always recover an expired
            // Vanguard owner lease without a second rollout gate.
            allowLeaseTakeover: true,
        });
    }
    // Preserve a discoverable terminal admission until exact session
    // compaction is proven. Crash after Elo but before this CAS leaves both the
    // durable session and admission for claim/season/move to help forward.
    await boundExactPvpSession(store, `pvp:${session.battleId}`, session, SESSION_TTL);
    const admission = await getPlayerRankedAdmission(store, settled.journal.terminal.matchId);
    if (admission) {
        if (admission.phase !== 'terminal'
            || admission.battleId !== session.battleId
            || admission.terminalFingerprint !== settled.journal.terminal.fingerprint) {
            throw new Error('player-ranked-admission-journal-conflict');
        }
        await completePlayerRankedAdmission(store, admission);
    }
    return settled.journal;
}

/**
 * Normal queue traffic helps every discoverable terminal phase forward. An
 * active admission may already have an exact done session if the worker died
 * after the session CAS but before gate terminalization; terminal admissions
 * may be at any later journal/effect phase. Only a missing session requires a
 * fully-completed journal before the gate row can be removed.
 */
export async function recoverCompletedPlayerRankedFinalizations(
    store: RankedTerminalStore,
    lock: SaveLockRunner,
    options: {
        eligible?: (a: string, b: string) => Promise<boolean>;
    } = {},
): Promise<void> {
    const gate = await readPetRankedSeasonGateFresh(store);
    for (const admission of gate?.playerAdmissions ?? []) {
        if ((admission.phase !== 'active' && admission.phase !== 'terminal') || !admission.battleId) continue;
        const raw = await store.get<unknown>(`pvp:${admission.battleId}`);
        if (raw !== null) {
            const session = raw as PvpSession;
            if (session.status !== 'done') {
                if (admission.phase === 'terminal') throw new Error('player-ranked-terminal-session-conflict');
                continue;
            }
            if (!isPlayerRankedV2Session(session)
                || !playerRankedSessionMatchesAdmission(session, admission)) {
                throw new Error('player-ranked-terminal-session-conflict');
            }
            await confirmPlayerRankedTerminalEffects(store, session, {
                eligible: admission.phase === 'terminal'
                    ? async () => { throw new Error('player-ranked-eligibility-recomputed'); }
                    : options.eligible ?? (async () => { throw new Error('player-ranked-eligibility-required'); }),
                lock,
            });
            continue;
        }
        if (admission.phase !== 'terminal') continue;
        const journal = await getPlayerRankedJournal(store, admission.matchId);
        if (!journal
            || journal.state !== 'completed'
            || !journal.confirmations.a
            || !journal.confirmations.b
            || !journal.items.a.confirmed
            || !journal.items.b.confirmed
            || journal.terminal.battleId !== admission.battleId
            || journal.terminal.fingerprint !== admission.terminalFingerprint) {
            throw new Error('player-ranked-admission-journal-conflict');
        }
        if (!(await hasDurableVanguardTerminalOutcome(store, journal.terminal))) {
            throw new Error('player-ranked-vanguard-settlement-pending');
        }
        await completePlayerRankedAdmission(store, admission);
    }
}
