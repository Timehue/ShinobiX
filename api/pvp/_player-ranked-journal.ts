import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { creditRankedOutcome } from '../_ranked-rating.js';
import { safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { inspectSettlementReceipt } from '../_settlement-receipts.js';
import {
    completePlayerRankedAdmission,
    getPlayerRankedAdmission,
    markPlayerRankedAdmissionTerminal,
    type PlayerRankedAdmission,
} from '../pet/_ranked-preparation.js';
import { isPlayerRankedV2Session, pvpSessionMayReward, type PvpSession } from './session.js';
import { embedPvpSettlementReceipt, pvpSettlementId } from './_reward-settlement.js';

export const PLAYER_RANKED_JOURNAL_VERSION = 'player-ranked-journal-v1' as const;
export const PLAYER_RANKED_SETTLEMENT_STAMP_FIELD = 'playerRankedSettlementStamp' as const;
export const PLAYER_RANKED_JOURNAL_PREFIX = 'player:ranked-journal:';
export const PLAYER_RANKED_CANCELLED_PREFIX = 'player:ranked-cancelled:';
const JOURNAL_TTL_SECONDS = 400 * 24 * 60 * 60;
export const PLAYER_RANKED_SETTLEMENT_STAMP_LIMIT = 64;

export type PlayerRankedTerminal = {
    matchId: string;
    battleId: string;
    a: string;
    b: string;
    aRating: number;
    bRating: number;
    seasonId: number;
    seasonEpoch: number;
    winner: 'a' | 'b' | 'draw';
    rankedEligible: boolean;
    terminalAt: number;
    fingerprint: string;
};

export type PlayerRankedJournal = {
    version: typeof PLAYER_RANKED_JOURNAL_VERSION;
    terminal: PlayerRankedTerminal;
    items: {
        a: { usageFingerprint: string; confirmed: boolean };
        b: { usageFingerprint: string; confirmed: boolean };
    };
    confirmations: { a: boolean; b: boolean };
    state: 'pending' | 'completed';
    updatedAt: number;
};

export type PlayerRankedSettlementResult = {
    journal: PlayerRankedJournal;
    ratings: { a: number; b: number };
};

type JournalStore = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'keys'>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function terminalCore(terminal: Omit<PlayerRankedTerminal, 'fingerprint'>): string {
    return JSON.stringify(terminal);
}

export function playerRankedTerminalFingerprint(
    terminal: Omit<PlayerRankedTerminal, 'fingerprint'>,
): string {
    return createHash('sha256').update(terminalCore(terminal)).digest('hex');
}

function validTerminal(value: unknown): value is PlayerRankedTerminal {
    if (!isRecord(value) || !exactKeys(value, [
        'matchId', 'battleId', 'a', 'b', 'aRating', 'bRating', 'seasonId',
        'seasonEpoch', 'winner', 'rankedEligible', 'terminalAt', 'fingerprint',
    ])) return false;
    const terminal = value as PlayerRankedTerminal;
    const { fingerprint, ...core } = terminal;
    return /^player-ranked-[0-9a-f-]{36}$/.test(terminal.matchId)
        && /^pvp-[0-9a-f-]{36}$/.test(terminal.battleId)
        && terminal.a === safeName(terminal.a)
        && terminal.b === safeName(terminal.b)
        && !!terminal.a
        && terminal.a < terminal.b
        && Number.isFinite(terminal.aRating)
        && terminal.aRating >= 0
        && Number.isFinite(terminal.bRating)
        && terminal.bRating >= 0
        && Number.isSafeInteger(terminal.seasonId)
        && terminal.seasonId > 0
        && Number.isSafeInteger(terminal.seasonEpoch)
        && terminal.seasonEpoch > 0
        && (terminal.winner === 'a' || terminal.winner === 'b' || terminal.winner === 'draw')
        && typeof terminal.rankedEligible === 'boolean'
        && Number.isSafeInteger(terminal.terminalAt)
        && terminal.terminalAt > 0
        && /^[a-f0-9]{64}$/.test(fingerprint)
        && fingerprint === playerRankedTerminalFingerprint(core);
}

export function parsePlayerRankedJournal(value: unknown): PlayerRankedJournal | null {
    if (!isRecord(value) || !exactKeys(value, [
        'version', 'terminal', 'items', 'confirmations', 'state', 'updatedAt',
    ])) return null;
    const journal = value as PlayerRankedJournal;
    if (journal.version !== PLAYER_RANKED_JOURNAL_VERSION
        || !validTerminal(journal.terminal)
        || !isRecord(journal.items)
        || !exactKeys(journal.items, ['a', 'b'])
        || !isRecord(journal.items.a)
        || !isRecord(journal.items.b)
        || !exactKeys(journal.items.a, ['usageFingerprint', 'confirmed'])
        || !exactKeys(journal.items.b, ['usageFingerprint', 'confirmed'])
        || !/^[a-f0-9]{64}$/.test(String(journal.items.a.usageFingerprint))
        || !/^[a-f0-9]{64}$/.test(String(journal.items.b.usageFingerprint))
        || typeof journal.items.a.confirmed !== 'boolean'
        || typeof journal.items.b.confirmed !== 'boolean'
        || !isRecord(journal.confirmations)
        || !exactKeys(journal.confirmations, ['a', 'b'])
        || typeof journal.confirmations.a !== 'boolean'
        || typeof journal.confirmations.b !== 'boolean'
        || (journal.state !== 'pending' && journal.state !== 'completed')
        || !Number.isSafeInteger(journal.updatedAt)
        || journal.updatedAt <= 0
        || (journal.state === 'completed'
            ? (!journal.confirmations.a || !journal.confirmations.b)
            : (journal.confirmations.a && journal.confirmations.b))) return null;
    return journal;
}

export function playerRankedJournalKey(matchId: string): string {
    return `${PLAYER_RANKED_JOURNAL_PREFIX}${matchId}`;
}

export async function getPlayerRankedJournal(
    store: Pick<KvLike, 'get'>,
    matchId: string,
): Promise<PlayerRankedJournal | null> {
    const raw = await store.get<unknown>(playerRankedJournalKey(matchId));
    if (raw === null) return null;
    const journal = parsePlayerRankedJournal(raw);
    if (!journal || journal.terminal.matchId !== matchId) throw new Error('player-ranked-journal-invalid');
    return journal;
}

function terminalFromAdmission(admission: PlayerRankedAdmission): PlayerRankedTerminal {
    if (admission.phase !== 'terminal'
        || !admission.battleId
        || !admission.terminalAt
        || !admission.winner
        || admission.rankedEligible === null
        || !admission.terminalFingerprint) {
        throw new Error('player-ranked-admission-not-terminal');
    }
    const terminal: PlayerRankedTerminal = {
        matchId: admission.matchId,
        battleId: admission.battleId,
        a: admission.a,
        b: admission.b,
        aRating: admission.aRating,
        bRating: admission.bRating,
        seasonId: admission.seasonId,
        seasonEpoch: admission.seasonEpoch,
        winner: admission.winner,
        rankedEligible: admission.rankedEligible,
        terminalAt: admission.terminalAt,
        fingerprint: admission.terminalFingerprint,
    };
    if (!validTerminal(terminal)) throw new Error('player-ranked-terminal-invalid');
    return terminal;
}

async function materializeJournal(
    store: JournalStore,
    terminal: PlayerRankedTerminal,
    items: PlayerRankedJournal['items'],
): Promise<PlayerRankedJournal> {
    const key = playerRankedJournalKey(terminal.matchId);
    const existing = await getPlayerRankedJournal(store, terminal.matchId);
    if (existing) {
        if (!isDeepStrictEqual(existing.terminal, terminal)
            || existing.items.a.usageFingerprint !== items.a.usageFingerprint
            || existing.items.b.usageFingerprint !== items.b.usageFingerprint) {
            throw new Error('player-ranked-journal-conflict');
        }
        return existing;
    }
    const initial: PlayerRankedJournal = {
        version: PLAYER_RANKED_JOURNAL_VERSION,
        terminal,
        items,
        confirmations: { a: false, b: false },
        state: 'pending',
        updatedAt: terminal.terminalAt,
    };
    try {
        if (await store.set(key, initial, { nx: true, ex: JOURNAL_TTL_SECONDS }) === 'OK') return initial;
    } catch (error) {
        const recovered = await getPlayerRankedJournal(store, terminal.matchId).catch(() => null);
        if (recovered
            && isDeepStrictEqual(recovered.terminal, terminal)
            && recovered.items.a.usageFingerprint === items.a.usageFingerprint
            && recovered.items.b.usageFingerprint === items.b.usageFingerprint) return recovered;
        throw error;
    }
    const winner = await getPlayerRankedJournal(store, terminal.matchId);
    if (!winner
        || !isDeepStrictEqual(winner.terminal, terminal)
        || winner.items.a.usageFingerprint !== items.a.usageFingerprint
        || winner.items.b.usageFingerprint !== items.b.usageFingerprint) {
        throw new Error('player-ranked-journal-conflict');
    }
    return winner;
}

function sessionTerminalCore(
    session: PvpSession,
    admission: PlayerRankedAdmission,
    rankedEligible: boolean,
    terminalAt: number,
): Omit<PlayerRankedTerminal, 'fingerprint'> {
    const p1 = safeName(session.p1?.name ?? '');
    const p2 = safeName(session.p2?.name ?? '');
    const winner = session.winner === 'draw'
        ? 'draw'
        : session.winner === 'p1'
            ? (p1 === admission.a ? 'a' : 'b')
            : (p2 === admission.a ? 'a' : 'b');
    return {
        matchId: admission.matchId,
        battleId: admission.battleId!,
        a: admission.a,
        b: admission.b,
        aRating: admission.aRating,
        bRating: admission.bRating,
        seasonId: admission.seasonId,
        seasonEpoch: admission.seasonEpoch,
        winner,
        rankedEligible: winner !== 'draw' && rankedEligible,
        terminalAt,
    };
}

function normalizedItemUsage(value: unknown): Record<string, number> {
    if (value === undefined) return {};
    if (!isRecord(value)) throw new Error('player-ranked-item-usage-invalid');
    const entries = Object.entries(value)
        .map(([itemId, count]) => [itemId, Number(count)] as const)
        .sort(([left], [right]) => left.localeCompare(right));
    const out: Record<string, number> = {};
    for (const [itemId, count] of entries) {
        if (!itemId
            || itemId.length > 200
            || !Number.isSafeInteger(count)
            || count <= 0) throw new Error('player-ranked-item-usage-invalid');
        out[itemId] = count;
    }
    return out;
}

/** Exact economic fingerprint for one sorted player side's terminal usage. */
export function playerRankedItemUsageFingerprint(
    session: PvpSession,
    terminal: PlayerRankedTerminal,
    side: 'a' | 'b',
): string {
    if (!isPlayerRankedV2Session(session)
        || session.battleId !== terminal.battleId
        || session.rankedMatchId !== terminal.matchId
        || session.rankedSeasonId !== terminal.seasonId
        || session.rankedSeasonEpoch !== terminal.seasonEpoch) {
        throw new Error('player-ranked-item-session-conflict');
    }
    const wanted = terminal[side];
    const roles = (['p1', 'p2'] as const).filter((role) => safeName(session[role]?.name ?? '') === wanted);
    if (roles.length !== 1 || session.realFighters?.[roles[0]] !== true) {
        throw new Error('player-ranked-item-side-invalid');
    }
    const used = normalizedItemUsage(session.itemsUsed?.[roles[0]] ?? {});
    if (Object.keys(used).length > 0) throw new Error('player-ranked-v2-consumables-disabled');
    return createHash('sha256').update(JSON.stringify({
        version: 'player-ranked-item-usage-v1',
        matchId: terminal.matchId,
        battleId: terminal.battleId,
        terminalFingerprint: terminal.fingerprint,
        side,
        player: wanted,
        used,
    })).digest('hex');
}

function journalItemsFromSession(
    session: PvpSession,
    terminal: PlayerRankedTerminal,
): PlayerRankedJournal['items'] {
    return {
        // V2 seals every tracked consumable/throwable id to zero and upgraded
        // move also rejects those actions. Publication can therefore confirm
        // the exact empty usage without a cross-save economic step.
        a: { usageFingerprint: playerRankedItemUsageFingerprint(session, terminal, 'a'), confirmed: true },
        b: { usageFingerprint: playerRankedItemUsageFingerprint(session, terminal, 'b'), confirmed: true },
    };
}

/**
 * Publish terminal authority after the durable session commit. The gate CAS
 * seals outcome/snapshots/eligibility first; the per-match journal is a durable
 * mirror that claim and cron can reconstruct after a crash or lost ack.
 */
export async function publishPlayerRankedTerminal(
    store: JournalStore,
    session: PvpSession,
    options: {
        now?: number;
        eligible: (a: string, b: string) => Promise<boolean>;
    },
): Promise<PlayerRankedJournal> {
    if (session.status !== 'done'
        || (session.winner !== 'p1' && session.winner !== 'p2' && session.winner !== 'draw')
        || !isPlayerRankedV2Session(session)
        || typeof session.rankedMatchId !== 'string'
        || !session.battleId) throw new Error('player-ranked-session-not-terminal');

    const admission = await getPlayerRankedAdmission(store, session.rankedMatchId);
    if (!admission) {
        const completed = await getPlayerRankedJournal(store, session.rankedMatchId);
        if (completed?.state === 'completed' && completed.terminal.battleId === session.battleId) {
            const items = journalItemsFromSession(session, completed.terminal);
            if (completed.items.a.usageFingerprint === items.a.usageFingerprint
                && completed.items.b.usageFingerprint === items.b.usageFingerprint) return completed;
            throw new Error('player-ranked-journal-conflict');
        }
        throw new Error('player-ranked-admission-missing');
    }
    const pair = [safeName(session.p1?.name ?? ''), safeName(session.p2?.name ?? '')].sort();
    if (admission.a !== pair[0]
        || admission.b !== pair[1]
        || admission.battleId !== session.battleId
        || admission.seasonId !== session.rankedSeasonId
        || admission.seasonEpoch !== session.rankedSeasonEpoch) {
        throw new Error('player-ranked-session-admission-conflict');
    }

    let terminalAdmission = admission;
    if (terminalAdmission.phase !== 'terminal') {
        if (terminalAdmission.phase !== 'active') throw new Error('player-ranked-admission-cancelled');
        // Eligibility is sealed once. Storage uncertainty fails closed by
        // throwing; the already-durable terminal session can be retried.
        // A creator can flee before the opponent joins. That terminal still
        // needs full help-forward cleanup, but is a durable no-contest for
        // economic/progression rewards. Seal the joined decision here so a
        // later retry can never recompute it from changed or missing evidence.
        const eligible = pvpSessionMayReward(session)
            && await options.eligible(admission.a, admission.b);
        const terminalAt = Math.max(1, Math.floor(options.now ?? Date.now()));
        const core = sessionTerminalCore(session, admission, eligible, terminalAt);
        const fingerprint = playerRankedTerminalFingerprint(core);
        terminalAdmission = await markPlayerRankedAdmissionTerminal(
            store,
            admission.matchId,
            admission.battleId,
            {
                winner: core.winner,
                rankedEligible: core.rankedEligible,
                terminalAt,
                terminalFingerprint: fingerprint,
            },
        );
    }
    const terminal = terminalFromAdmission(terminalAdmission);
    if (terminal.rankedEligible && !pvpSessionMayReward(session)) {
        throw new Error('player-ranked-terminal-participants-unconfirmed');
    }
    // A stale/corrupt terminal session can never remap the gate-sealed winner.
    const sessionWinner = sessionTerminalCore(
        session,
        terminalAdmission,
        terminal.rankedEligible,
        terminal.terminalAt,
    ).winner;
    if (sessionWinner !== terminal.winner) throw new Error('player-ranked-terminal-winner-conflict');
    return materializeJournal(store, terminal, journalItemsFromSession(session, terminal));
}

export async function materializePlayerRankedJournalFromAdmission(
    store: JournalStore,
    admission: PlayerRankedAdmission,
): Promise<PlayerRankedJournal> {
    const terminal = terminalFromAdmission(admission);
    const journal = await getPlayerRankedJournal(store, admission.matchId);
    if (!journal || !isDeepStrictEqual(journal.terminal, terminal)) {
        throw new Error('player-ranked-journal-missing');
    }
    return journal;
}

type SettlementStamp = {
    fingerprint: string;
    seasonId: number;
    role: 'winner' | 'loser' | 'draw' | 'ineligible';
    settledAt: number;
    ratingAfter: number;
};

function readStamps(character: Record<string, unknown>): Record<string, SettlementStamp> {
    const raw = character[PLAYER_RANKED_SETTLEMENT_STAMP_FIELD];
    if (raw === undefined) return {};
    if (!isRecord(raw)) throw new Error('player-ranked-settlement-stamp-invalid');
    const out: Record<string, SettlementStamp> = {};
    for (const [matchId, value] of Object.entries(raw)) {
        if (!/^player-ranked-[0-9a-f-]{36}$/.test(matchId)
            || !isRecord(value)
            || !exactKeys(value, ['fingerprint', 'seasonId', 'role', 'settledAt', 'ratingAfter'])
            || typeof value.fingerprint !== 'string'
            || !/^[a-f0-9]{64}$/.test(value.fingerprint)
            || !Number.isSafeInteger(value.seasonId)
            || Number(value.seasonId) <= 0
            || !['winner', 'loser', 'draw', 'ineligible'].includes(String(value.role))
            || !Number.isSafeInteger(value.settledAt)
            || Number(value.settledAt) <= 0
            || !Number.isFinite(value.ratingAfter)
            || Number(value.ratingAfter) < 0) throw new Error('player-ranked-settlement-stamp-invalid');
        out[matchId] = value as SettlementStamp;
    }
    return out;
}

function appendBoundedStamp(
    stamps: Record<string, SettlementStamp>,
    matchId: string,
    stamp: SettlementStamp,
): Record<string, SettlementStamp> {
    return Object.fromEntries([
        [matchId, stamp] as const,
        ...Object.entries(stamps)
            .filter(([candidate]) => candidate !== matchId)
            .sort((left, right) => (
                right[1].settledAt - left[1].settledAt || left[0].localeCompare(right[0])
            ))
            .slice(0, PLAYER_RANKED_SETTLEMENT_STAMP_LIMIT - 1),
    ]);
}

async function confirmSide(
    store: JournalStore,
    journal: PlayerRankedJournal,
    side: 'a' | 'b',
    now: number,
): Promise<PlayerRankedJournal> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const current = await getPlayerRankedJournal(store, journal.terminal.matchId);
        if (!current || !isDeepStrictEqual(current.terminal, journal.terminal)) {
            throw new Error('player-ranked-journal-conflict');
        }
        if (current.confirmations[side]) return current;
        const confirmations = { ...current.confirmations, [side]: true };
        const next: PlayerRankedJournal = {
            ...current,
            confirmations,
            state: confirmations.a && confirmations.b ? 'completed' : 'pending',
            updatedAt: now,
        };
        try {
            if (await store.compareSet(playerRankedJournalKey(journal.terminal.matchId), current, next, {
                ex: JOURNAL_TTL_SECONDS,
            })) return next;
        } catch (error) {
            const recovered = await getPlayerRankedJournal(store, journal.terminal.matchId).catch(() => null);
            if (recovered?.confirmations[side]
                && isDeepStrictEqual(recovered.terminal, journal.terminal)) return recovered;
            throw error;
        }
    }
    throw new Error('player-ranked-journal-busy');
}

export async function confirmPlayerRankedItemSettlement(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    journal: PlayerRankedJournal,
    side: 'a' | 'b',
    usageFingerprint: string,
    now = Date.now(),
): Promise<PlayerRankedJournal> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const current = await getPlayerRankedJournal(store, journal.terminal.matchId);
        if (!current
            || !isDeepStrictEqual(current.terminal, journal.terminal)
            || current.items[side].usageFingerprint !== usageFingerprint) {
            throw new Error('player-ranked-item-journal-conflict');
        }
        if (current.items[side].confirmed) return current;
        const next: PlayerRankedJournal = {
            ...current,
            items: {
                ...current.items,
                [side]: { ...current.items[side], confirmed: true },
            },
            updatedAt: Math.max(current.updatedAt, Math.max(1, Math.floor(now))),
        };
        try {
            if (await store.compareSet(playerRankedJournalKey(journal.terminal.matchId), current, next, {
                ex: JOURNAL_TTL_SECONDS,
            })) return next;
        } catch (error) {
            const recovered = await getPlayerRankedJournal(store, journal.terminal.matchId).catch(() => null);
            if (recovered
                && isDeepStrictEqual(recovered.terminal, journal.terminal)
                && recovered.items[side].usageFingerprint === usageFingerprint
                && recovered.items[side].confirmed) return recovered;
            throw error;
        }
    }
    throw new Error('player-ranked-item-journal-busy');
}

async function settleSide(
    store: JournalStore,
    journal: PlayerRankedJournal,
    side: 'a' | 'b',
    now: number,
): Promise<number> {
    const terminal = journal.terminal;
    const slug = terminal[side];
    const saveKey = `save:${slug}`;
    const winnerSide = terminal.winner;
    const role: SettlementStamp['role'] = !terminal.rankedEligible
        ? 'ineligible'
        : winnerSide === 'draw'
            ? 'draw'
            : winnerSide === side ? 'winner' : 'loser';
    const legacyRole = winnerSide === 'draw'
        ? null
        : winnerSide === side ? 'winner' as const : 'loser' as const;
    const legacySettlementId = pvpSettlementId('rating', terminal.battleId);
    const legacyFingerprint = legacyRole ? `rating-${legacyRole}` : null;
    for (let attempt = 0; attempt < 32; attempt += 1) {
        const record = await store.get<Record<string, unknown>>(saveKey);
        const character = (record?.character ?? null) as Record<string, unknown> | null;
        if (!record || !character) throw new Error(`player-ranked-save-unreadable:${slug}`);
        const stamps = readStamps(character);
        const existing = stamps[terminal.matchId];
        if (existing) {
            if (existing.fingerprint !== terminal.fingerprint || existing.role !== role) {
                throw new Error('player-ranked-settlement-stamp-conflict');
            }
        }

        const legacyInspection = legacyFingerprint
            ? inspectSettlementReceipt(character, legacySettlementId, legacyFingerprint)
            : null;
        if (legacyInspection
            && legacyInspection.status !== 'fresh'
            && legacyInspection.status !== 'replay') {
            throw new Error('player-ranked-legacy-settlement-receipt-invalid');
        }

        let credited = character;
        let ratingAfter = Number(character.rankedRating);
        if (!Number.isFinite(ratingAfter)) ratingAfter = 1000;
        const legacyAlreadySettled = legacyInspection?.status === 'replay';
        if (!existing && !legacyAlreadySettled && (role === 'winner' || role === 'loser')) {
            const winnerRating = winnerSide === 'a' ? terminal.aRating : terminal.bRating;
            const loserRating = winnerSide === 'a' ? terminal.bRating : terminal.aRating;
            const result = creditRankedOutcome(character, {
                role,
                winnerRating,
                loserRating,
                kind: 'player',
            });
            credited = { ...character, ...result.patch };
            ratingAfter = result.newRating;
        } else if (existing) {
            ratingAfter = existing.ratingAfter;
        }
        const stamp: SettlementStamp = existing ?? {
            fingerprint: terminal.fingerprint,
            seasonId: terminal.seasonId,
            role,
            settledAt: now,
            ratingAfter,
        };
        let nextCharacter: Record<string, unknown> = {
            ...credited,
            [PLAYER_RANKED_SETTLEMENT_STAMP_FIELD]: appendBoundedStamp(stamps, terminal.matchId, stamp),
        };

        // Old d76a claim workers only know this bounded generic receipt. Writing
        // it in the same save CAS makes both old→new and new→old interleavings
        // observe the exact same economic fence during a rolling deployment.
        if (legacyFingerprint && legacyInspection?.status === 'fresh') {
            nextCharacter = embedPvpSettlementReceipt(
                nextCharacter,
                legacyInspection.receipts,
                legacySettlementId,
                legacyFingerprint,
                now,
            );
        }
        const needsWrite = !existing
            || legacyInspection?.status === 'fresh'
            || Object.keys(stamps).length > PLAYER_RANKED_SETTLEMENT_STAMP_LIMIT;
        if (!needsWrite) {
            await confirmSide(store, journal, side, now);
            const currentRating = Number(character.rankedRating);
            return Number.isFinite(currentRating) ? currentRating : ratingAfter;
        }
        const next = bumpSaveVersion({ ...record, character: nextCharacter });
        try {
            if (await store.compareSet(saveKey, record, next)) {
                await confirmSide(store, journal, side, now);
                return ratingAfter;
            }
        } catch (error) {
            const recovered = await store.get<Record<string, unknown>>(saveKey).catch(() => null);
            const recoveredCharacter = (recovered?.character ?? null) as Record<string, unknown> | null;
            const recoveredStamp = recoveredCharacter
                ? readStamps(recoveredCharacter)[terminal.matchId]
                : undefined;
            const recoveredLegacy = recoveredCharacter && legacyFingerprint
                ? inspectSettlementReceipt(recoveredCharacter, legacySettlementId, legacyFingerprint)
                : null;
            if (recoveredStamp?.fingerprint === terminal.fingerprint
                && recoveredStamp.role === role
                && (!legacyFingerprint || recoveredLegacy?.status === 'replay')) {
                await confirmSide(store, journal, side, now);
                const recoveredRating = Number(recoveredCharacter?.rankedRating);
                return Number.isFinite(recoveredRating) ? recoveredRating : recoveredStamp.ratingAfter;
            }
            throw error;
        }
    }
    throw new Error(`player-ranked-save-cas-busy:${slug}`);
}

export async function settlePlayerRankedJournal(
    store: JournalStore,
    input: PlayerRankedJournal | string,
    now = Date.now(),
    options: { completeAdmission?: boolean } = {},
): Promise<PlayerRankedSettlementResult> {
    let journal = typeof input === 'string'
        ? await getPlayerRankedJournal(store, input)
        : input;
    if (!journal) throw new Error('player-ranked-journal-missing');
    if (!journal.items.a.confirmed || !journal.items.b.confirmed) {
        throw new Error('player-ranked-item-settlement-pending');
    }
    if (journal.state === 'completed') {
        // Both exact save commits were already confirmed. Replaying an old
        // completed journal must never depend on retaining every historical
        // in-save stamp; doing so would force unbounded player-controlled data.
        const [aRecord, bRecord] = await Promise.all([
            store.get<Record<string, unknown>>(`save:${journal.terminal.a}`),
            store.get<Record<string, unknown>>(`save:${journal.terminal.b}`),
        ]);
        const aRating = Number((aRecord?.character as Record<string, unknown> | undefined)?.rankedRating);
        const bRating = Number((bRecord?.character as Record<string, unknown> | undefined)?.rankedRating);
        if (!aRecord?.character || !bRecord?.character) throw new Error('player-ranked-save-unreadable');
        const admission = options.completeAdmission === false
            ? null
            : await getPlayerRankedAdmission(store, journal.terminal.matchId);
        if (admission) {
            if (admission.phase !== 'terminal'
                || admission.terminalFingerprint !== journal.terminal.fingerprint) {
                throw new Error('player-ranked-admission-journal-conflict');
            }
            await completePlayerRankedAdmission(store, admission);
        }
        return {
            journal,
            ratings: {
                a: Number.isFinite(aRating) ? aRating : 1000,
                b: Number.isFinite(bRating) ? bRating : 1000,
            },
        };
    }
    const settledAt = Math.max(1, Math.floor(now));
    const a = await settleSide(store, journal, 'a', settledAt);
    journal = await getPlayerRankedJournal(store, journal.terminal.matchId) ?? journal;
    const b = await settleSide(store, journal, 'b', settledAt);
    journal = await getPlayerRankedJournal(store, journal.terminal.matchId) ?? journal;
    if (journal.state !== 'completed') throw new Error('player-ranked-journal-not-completed');
    const admission = options.completeAdmission === false
        ? null
        : await getPlayerRankedAdmission(store, journal.terminal.matchId);
    if (admission) {
        if (admission.phase !== 'terminal'
            || admission.terminalFingerprint !== journal.terminal.fingerprint) {
            throw new Error('player-ranked-admission-journal-conflict');
        }
        await completePlayerRankedAdmission(store, admission);
    }
    return { journal, ratings: { a, b } };
}

export async function listPendingPlayerRankedJournals(
    store: JournalStore,
): Promise<PlayerRankedJournal[]> {
    const keys = await store.keys(`${PLAYER_RANKED_JOURNAL_PREFIX}*`);
    const pending: PlayerRankedJournal[] = [];
    for (const key of keys) {
        const matchId = key.slice(PLAYER_RANKED_JOURNAL_PREFIX.length);
        const journal = await getPlayerRankedJournal(store, matchId);
        if (journal?.state === 'pending') pending.push(journal);
    }
    return pending.sort((left, right) => left.terminal.matchId.localeCompare(right.terminal.matchId));
}

export async function recordCancelledPlayerRankedAdmission(
    store: JournalStore,
    admission: PlayerRankedAdmission,
    options: { reason?: 'season-close-no-contest' | 'orphan-session-missing' } = {},
): Promise<void> {
    if (admission.phase !== 'cancelled' || !admission.cancelledAt) {
        throw new Error('player-ranked-admission-not-cancelled');
    }
    const key = `${PLAYER_RANKED_CANCELLED_PREFIX}${admission.matchId}`;
    const cancellation = {
        matchId: admission.matchId,
        battleId: admission.battleId,
        seasonId: admission.seasonId,
        seasonEpoch: admission.seasonEpoch,
        cancelledAt: admission.cancelledAt,
        reason: options.reason ?? 'season-close-no-contest',
    };
    try {
        const placed = await store.set(key, cancellation, { nx: true, ex: JOURNAL_TTL_SECONDS });
        if (placed !== 'OK') {
            const current = await store.get<unknown>(key);
            if (!isDeepStrictEqual(current, cancellation)) throw new Error('player-ranked-cancellation-conflict');
        }
    } catch (error) {
        const recovered = await store.get<unknown>(key).catch(() => null);
        if (!isDeepStrictEqual(recovered, cancellation)) throw error;
    }
    await completePlayerRankedAdmission(store, admission);
}
