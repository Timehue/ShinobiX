import type { KvLike } from '../_storage.js';
import { creditRankedElderWin } from '../village/_elder-ranked-win.js';
import { PVP_TERMINAL_REPLAY_TTL, SESSION_TTL } from '../combat-core/constants.js';
import {
    completePlayerRankedAdmission,
    getPlayerRankedAdmission,
    readPetRankedSeasonGateFresh,
    type PlayerRankedAdmission,
} from '../pet/_ranked-preparation.js';
import {
    settlePvpConsumablesDurably,
    type SaveLockRunner,
} from './_consumable-settlement.js';
import {
    clearPlayerRankedSettlingPointer,
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
import { loadPvpRewardRecoverySnapshot } from './_reward-recovery.js';
import {
    grantVanguardRewardsForSession,
    hasDurableVanguardTerminalOutcome,
} from './_vanguard-rewards.js';

type RankedTerminalStore = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'keys' | 'hset' | 'del'>;

/**
 * Exact proof that nothing can still need the discoverable terminal row: the
 * journal is completed with both rating confirmations and both item receipts,
 * the durable Vanguard outcome exists, and the gate admission is gone. These
 * are the same facts season close requires before it finishes a terminal
 * admission whose session row has already been compacted away.
 */
export async function playerRankedTerminalIsSettled(
    store: RankedTerminalStore,
    journal: PlayerRankedJournal,
    battleId: string,
): Promise<boolean> {
    if (journal.state !== 'completed'
        || !journal.confirmations.a
        || !journal.confirmations.b
        || !journal.items.a.confirmed
        || !journal.items.b.confirmed
        || journal.terminal.battleId !== battleId) return false;
    if (await getPlayerRankedAdmission(store, journal.terminal.matchId)) return false;
    return hasDurableVanguardTerminalOutcome(store, journal.terminal);
}

/**
 * Return a fully settled ranked terminal to the ordinary session lease.
 *
 * The terminal row is held for the long replay horizon precisely so a crash
 * anywhere in the saga leaves it discoverable. Once every effect above has
 * landed there is nothing left to help forward from it — a late claim reads the
 * separately sealed reward-recovery snapshot, not this row — so it compacts.
 * Anything short of complete proof keeps the long bind: retaining a row nobody
 * reads is far cheaper than deleting one recovery still needs.
 */
export async function compactSettledPlayerRankedSession(
    store: RankedTerminalStore,
    session: PvpSession,
    journal: PlayerRankedJournal,
): Promise<boolean> {
    if (!await playerRankedTerminalIsSettled(store, journal, session.battleId)) return false;
    await boundExactPvpSession(store, `pvp:${session.battleId}`, session, SESSION_TTL);
    // Nothing is left for the settlement sweep to find.
    await clearPlayerRankedSettlingPointer(store, journal.terminal.matchId);
    return true;
}

/**
 * Durable terminal hook shared by move retries and season rollover. Publication
 * alone is not completion: exact empty-item authority and both rating-side
 * confirmations must land, and the gate admission must be removed, before the
 * non-expiring terminal session may be compacted — which this hook then does,
 * since removing the admission is what takes the match out of every later sweep.
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
        const terminal = settled.journal.terminal;
        if (terminal.winner === 'a' || terminal.winner === 'b') {
            await creditRankedElderWin(store, options.lock, terminal[terminal.winner], terminal.battleId,
                terminal.terminalAt, options.now ?? Date.now());
        }
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
    await boundExactPvpSession(store, `pvp:${session.battleId}`, session, PVP_TERMINAL_REPLAY_TTL);
    const admission = await getPlayerRankedAdmission(store, settled.journal.terminal.matchId);
    if (admission) {
        if (admission.phase !== 'terminal'
            || admission.battleId !== session.battleId
            || admission.terminalFingerprint !== settled.journal.terminal.fingerprint) {
            throw new Error('player-ranked-admission-journal-conflict');
        }
        await completePlayerRankedAdmission(store, admission);
    }
    // Compaction is now proven for the normal path. The admission has left the
    // gate, so the season-close sweep will never iterate this match again; this
    // is the only place that can retire its row from the replay horizon.
    await compactSettledPlayerRankedSession(store, session, settled.journal);
    return settled.journal;
}

/**
 * Normal queue traffic helps every discoverable terminal phase forward. An
 * active admission may already have an exact done session if the worker died
 * after the session CAS but before gate terminalization; terminal admissions
 * may be at any later journal/effect phase. A sealed recovery snapshot can
 * replay an expired live row; without either row, the completed journal must
 * prove every effect before the gate admission can be removed.
 */
export async function recoverCompletedPlayerRankedFinalizations(
    store: RankedTerminalStore,
    lock: SaveLockRunner,
    options: {
        eligible?: (a: string, b: string) => Promise<boolean>;
        onFailure?: (matchId: string, error: unknown) => void;
    } = {},
): Promise<void> {
    const gate = await readPetRankedSeasonGateFresh(store);
    for (const admission of gate?.playerAdmissions ?? []) {
        if ((admission.phase !== 'active' && admission.phase !== 'terminal') || !admission.battleId) continue;
        try {
            const raw = await store.get<unknown>(`pvp:${admission.battleId}`)
                ?? await loadPvpRewardRecoverySnapshot(store, admission.battleId);
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
            await completeSessionlessTerminalAdmission(store, admission);
        } catch (error) {
            if (!options.onFailure) throw error;
            options.onFailure(admission.matchId, error);
        }
    }
}

/**
 * A terminal admission whose session row (and recovery snapshot) are gone may
 * leave the gate only on exact proof that its whole saga already completed.
 */
async function completeSessionlessTerminalAdmission(
    store: RankedTerminalStore,
    admission: PlayerRankedAdmission,
): Promise<void> {
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
    await clearPlayerRankedSettlingPointer(store, admission.matchId);
}

function isPvpSessionRow(value: unknown, battleId: string): value is PvpSession {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Partial<PvpSession>;
    return row.battleId === battleId
        && (row.status === 'active' || row.status === 'done')
        && !!row.p1
        && !!row.p2;
}

/** The exact committed terminal row, else its sealed 48-hour recovery copy. */
async function readRankedTerminalSession(
    store: RankedTerminalStore,
    battleId: string,
): Promise<PvpSession | null> {
    // Close/orphan/publication tombstones are control data, never a session.
    const live = await store.get<unknown>(`pvp:${battleId}`);
    if (isPvpSessionRow(live, battleId)) return live;
    return loadPvpRewardRecoverySnapshot(store, battleId);
}

const sealedEligibility = async (): Promise<boolean> => {
    // A journal or terminal admission already sealed eligibility once.
    throw new Error('player-ranked-eligibility-recomputed');
};

export type PlayerRankedResumeOutcome =
    /** The whole saga is proven: the same proof that compacts its session row. */
    | 'settled'
    /** No journal and no terminal/active admission: nothing could ever settle. */
    | 'void';

/**
 * Drive one match's settlement forward from durable state alone — the unit of
 * work for the server-side settlement sweep (api/cron/_player-ranked-settlement-sweep.ts).
 *
 * With a session row it runs exactly the terminal confirm path a claim, move,
 * queue recovery or season close runs (confirmPlayerRankedTerminalEffects),
 * with or without the gate admission: same locks, same receipts, so it may race
 * any of them. Eligibility is sealed only for an admission still `active`, the
 * same way those callers seal it; otherwise it was sealed long ago and must
 * never be recomputed. Throws while any work remains so the caller can retry.
 */
export async function resumePlayerRankedSettlement(
    store: RankedTerminalStore,
    matchId: string,
    options: {
        lock: SaveLockRunner;
        eligible: (a: string, b: string) => Promise<boolean>;
        now?: number;
    },
): Promise<PlayerRankedResumeOutcome> {
    const journal = await getPlayerRankedJournal(store, matchId);
    const admission = await getPlayerRankedAdmission(store, matchId);
    // A queued admission has no battle yet, and a cancelled one's no-contest
    // belongs to close/orphan cleanup. Neither is terminal settlement work.
    const settling = admission && (admission.phase === 'active' || admission.phase === 'terminal')
        ? admission
        : null;
    if (!journal && !settling) return 'void';
    const battleId = journal?.terminal.battleId ?? settling?.battleId ?? null;
    if (!battleId) return 'void';
    if (admission && admission.battleId !== battleId) throw new Error('player-ranked-admission-journal-conflict');
    // A journal is only ever written after its admission's terminal CAS. A gate
    // that shows `active` beside one was rolled back out of band; sealing a
    // second terminal there would contradict the journal forever.
    if (journal && settling?.phase === 'active') throw new Error('player-ranked-admission-journal-conflict');

    const session = await readRankedTerminalSession(store, battleId);
    if (session) {
        if (session.status !== 'done') throw new Error('player-ranked-session-still-active');
        if (!isPlayerRankedV2Session(session)
            || session.rankedMatchId !== matchId
            || (admission && !playerRankedSessionMatchesAdmission(session, admission))) {
            throw new Error('player-ranked-terminal-session-conflict');
        }
        await confirmPlayerRankedTerminalEffects(store, session, {
            eligible: settling?.phase === 'active' ? options.eligible : sealedEligibility,
            lock: options.lock,
            now: options.now,
        });
    } else if (settling) {
        if (settling.phase !== 'terminal') throw new Error('player-ranked-terminal-session-missing');
        await completeSessionlessTerminalAdmission(store, settling);
    }

    const current = await getPlayerRankedJournal(store, matchId);
    if (current && await playerRankedTerminalIsSettled(store, current, battleId)) return 'settled';
    throw new Error(session ? 'player-ranked-settlement-unproven' : 'player-ranked-terminal-session-missing');
}
