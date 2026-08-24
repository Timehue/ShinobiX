/*
 * Shared, server-authoritative settlement of an OFFICIAL Kage duel.
 *
 * The accepted-duel pointer, durable terminal evidence, and Kage-row receipt
 * form one help-forward chain. The seat mutation and its per-battle receipt are
 * published by the same exact CAS, so neither a lost write acknowledgement nor
 * a process crash can leave a marker/body gap. Reward completion must wait for
 * this chain whenever an official pointer exists.
 */
import { kv } from '../_storage.js';
import { safeName, setSafeRecordValue } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { announce } from '../_announce.js';
import { PVP_TERMINAL_REPLAY_TTL } from '../combat-core/constants.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { pvpSessionMayReward, type PvpSession } from '../pvp/session.js';
import {
    resolveDuelDecision,
    applySeatTransfer,
    applyDefense,
    applyExpiry,
    isChallengeExpired,
    KAGE_CHALLENGE_EXPIRY_MS,
    type KagePvpDuelSettlementReceipt,
    type KageStateLike,
} from './_kage-challenge.js';

const SESSION_REPLAY_WINDOW_MS = PVP_TERMINAL_REPLAY_TTL * 1000;
const KAGE_PVP_RECEIPT_MAX = 64;

export function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

export function kageDuelKey(battleId: string): string {
    return `kage-duel:${battleId}`;
}

export function kageSettleKey(battleId: string): string {
    return `kage-settle:${battleId}`;
}

export type KageDuelPointer = {
    village: string;
    challengeId: string;
};

/** The immutable facts of a finished official duel. */
export type KageDuelOutcome = {
    battleId: string;
    createdAt: number;
    endedAt: number;
    winnerName: string;
    loserName: string;
    p1Name: string;
    p2Name: string;
    challengeId?: string;
};

export type SettleResult =
    | { ok: false; status: number; error: string }
    | {
        ok: true;
        result: 'transferred' | 'defended';
        seatedKage: string;
        village: string;
        battleId: string;
        newKage?: string;
    };

function canonical<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function stableJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableJsonValue);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            out[key] = stableJsonValue((value as Record<string, unknown>)[key]);
        }
        return out;
    }
    return value;
}

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(stableJsonValue(canonical(a)))
        === JSON.stringify(stableJsonValue(canonical(b)));
}

function isSafeTime(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

export function parseKageDuelPointer(value: unknown): KageDuelPointer | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Partial<KageDuelPointer>;
    const village = typeof candidate.village === 'string' ? candidate.village.trim() : '';
    const challengeId = typeof candidate.challengeId === 'string' ? candidate.challengeId.trim() : '';
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return village
        && challengeId
        && candidate.village === village
        && candidate.challengeId === challengeId
        && sameJson(keys, ['challengeId', 'village'])
        ? { village, challengeId }
        : null;
}

function outcomeFromSession(session: PvpSession | null, challengeId?: string): KageDuelOutcome | null {
    if (!session
        || !pvpSessionMayReward(session)
        || session.status !== 'done'
        || !session.winner) return null;
    if (!isSafeTime(session.createdAt)
        || !isSafeTime(session.endedAt)
        || session.endedAt < session.createdAt) return null;
    const winnerName = session.winner === 'draw'
        ? 'draw'
        : session.winner === 'p1' ? session.p1.name : session.p2.name;
    const loserName = session.winner === 'draw'
        ? 'draw'
        : session.winner === 'p1' ? session.p2.name : session.p1.name;
    return canonical({
        battleId: session.battleId,
        createdAt: session.createdAt,
        endedAt: session.endedAt,
        winnerName,
        loserName,
        p1Name: session.p1.name,
        p2Name: session.p2.name,
        ...(challengeId ? { challengeId } : {}),
    });
}

function exactPointer(value: unknown, desired: KageDuelPointer): boolean {
    const parsed = parseKageDuelPointer(value);
    return parsed !== null && sameJson(value, desired);
}

/** Publish the accepted-duel pointer with exact lost-ack readback. */
export async function ensureKageDuelPointer(
    village: string,
    battleId: string,
    challengeId: string,
): Promise<KageDuelPointer> {
    const desired = canonical({ village: village.trim(), challengeId: challengeId.trim() });
    if (!desired.village || !desired.challengeId || !battleId.trim()) {
        throw new Error('kage-duel-pointer-invalid');
    }
    const key = kageDuelKey(battleId);
    const current = await kv.get<unknown>(key);
    if (exactPointer(current, desired)) return desired;
    if (current !== null) throw new Error('kage-duel-pointer-conflict');
    try {
        if (await kv.compareSet(key, null, desired, { ex: PVP_TERMINAL_REPLAY_TTL })) return desired;
    } catch (error) {
        const recovered = await kv.get<unknown>(key).catch(() => null);
        if (exactPointer(recovered, desired)) return desired;
        throw error;
    }
    const recovered = await kv.get<unknown>(key);
    if (exactPointer(recovered, desired)) return desired;
    throw new Error('kage-duel-pointer-unconfirmed');
}

/**
 * Help an official Kage challenge from pending -> accepted using only the
 * server-derived session admission. The pointer is published first; an orphan
 * pointer without an accepted row/session is inert, while a crash after either
 * write is repaired by the next join/move retry. No combat action may advance
 * until this function confirms both durable records.
 */
export async function ensureKageDuelAdmission(session: PvpSession): Promise<void> {
    const authority = session.kageDuelAuthority;
    if (!authority) return;
    const village = typeof authority.village === 'string' ? authority.village.trim() : '';
    const challengeId = typeof authority.challengeId === 'string' ? authority.challengeId.trim() : '';
    if (authority.version !== 1 || !village || !challengeId || !session.battleId) {
        throw new Error('kage-duel-admission-invalid');
    }
    const fighterNames = new Set([safeName(session.p1?.name), safeName(session.p2?.name)]);
    if (fighterNames.size !== 2 || fighterNames.has('')) throw new Error('kage-duel-admission-fighters-invalid');
    const key = kageKey(village);
    await withKvLock(key, async () => {
        const raw = await kv.get<KageStateLike>(key);
        const challenge = raw?.challenge;
        const seat = safeName(raw?.seatedKage ?? '');
        const challenger = safeName(challenge?.challenger ?? '');
        if (!raw
            || !challenge
            || challenge.challengeId !== challengeId
            || !seat
            || !challenger
            || !fighterNames.has(seat)
            || !fighterNames.has(challenger)
            || isChallengeExpired(challenge, session.createdAt)) {
            throw new Error('kage-duel-admission-authority-conflict');
        }
        if (challenge.status === 'accepted' && challenge.battleId !== session.battleId) {
            throw new Error('kage-duel-admission-battle-conflict');
        }
        await ensureKageDuelPointer(village, session.battleId, challengeId);
        if (challenge.status === 'accepted') return;
        const candidate = canonical({
            ...raw,
            challenge: { ...challenge, status: 'accepted' as const, battleId: session.battleId },
        });
        try {
            if (await kv.compareSet(key, raw, candidate)) return;
        } catch (error) {
            const recovered = await kv.get<KageStateLike>(key).catch(() => null);
            if (sameJson(recovered, candidate)) return;
            throw error;
        }
        const recovered = await kv.get<KageStateLike>(key);
        if (sameJson(recovered, candidate)) return;
        throw new Error('kage-duel-admission-publication-conflict');
    }, { failClosed: true });
}

/**
 * Repair the narrow crash window after the accepted Kage row commits but before
 * its external battle pointer publishes. Only the four configured villages and
 * the two sealed fighter villages are inspected; an exact accepted challenge,
 * battle id, and fighter pair are required before publishing the pointer.
 */
export async function discoverAcceptedKageDuelPointer(
    session: PvpSession,
): Promise<KageDuelPointer | null> {
    const candidates = new Set<string>([
        ...WAR_VILLAGES,
        String(session.p1?.character?.village ?? '').trim(),
        String(session.p2?.character?.village ?? '').trim(),
    ].filter(Boolean));
    const fighters = new Set([safeName(session.p1?.name), safeName(session.p2?.name)]);
    let found: KageDuelPointer | null = null;
    for (const village of candidates) {
        const state = await kv.get<KageStateLike>(kageKey(village));
        const challenge = state?.challenge;
        if (challenge?.status !== 'accepted' || challenge.battleId !== session.battleId) continue;
        const challengeId = typeof challenge.challengeId === 'string' ? challenge.challengeId.trim() : '';
        if (!challengeId
            || !fighters.has(safeName(state?.seatedKage ?? ''))
            || !fighters.has(safeName(challenge.challenger ?? ''))) {
            throw new Error('kage-accepted-duel-proof-malformed');
        }
        const candidate = { village, challengeId };
        if (found && !sameJson(found, candidate)) throw new Error('kage-accepted-duel-proof-conflict');
        found = candidate;
    }
    if (!found) return null;
    return ensureKageDuelPointer(found.village, session.battleId, found.challengeId);
}

function isExactOutcome(value: unknown, desired: KageDuelOutcome & { village: string }): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value) && sameJson(value, desired);
}

function isCompatibleLegacyOutcome(value: unknown, desired: KageDuelOutcome & { village: string }): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<KageDuelOutcome & { village: string }>;
    return candidate.endedAt === undefined
        && candidate.village === desired.village
        && candidate.battleId === desired.battleId
        && candidate.createdAt === desired.createdAt
        && candidate.winnerName === desired.winnerName
        && candidate.loserName === desired.loserName
        && candidate.p1Name === desired.p1Name
        && candidate.p2Name === desired.p2Name
        && candidate.challengeId === desired.challengeId;
}

/** Seal terminal evidence before touching the Kage row. */
export async function recordPendingKageSettle(
    village: string,
    session: PvpSession,
    challengeId?: string,
): Promise<void> {
    const outcome = outcomeFromSession(session, challengeId);
    if (!outcome || !challengeId) throw new Error('kage-settlement-terminal-evidence-invalid');
    const key = kageSettleKey(session.battleId);
    const desired = canonical({ village: village.trim(), ...outcome });
    let current = await kv.get<unknown>(key);
    if (isExactOutcome(current, desired)) return;
    if (current !== null && !isCompatibleLegacyOutcome(current, desired)) {
        throw new Error('kage-settlement-evidence-conflict');
    }
    try {
        if (await kv.compareSet(key, current, desired, { ex: PVP_TERMINAL_REPLAY_TTL })) return;
    } catch (error) {
        const recovered = await kv.get<unknown>(key).catch(() => null);
        if (isExactOutcome(recovered, desired)) return;
        throw error;
    }
    current = await kv.get<unknown>(key);
    if (isExactOutcome(current, desired)) return;
    throw new Error('kage-settlement-evidence-unconfirmed');
}

function parseReceiptLedger(value: unknown): Record<string, KagePvpDuelSettlementReceipt> {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('kage-pvp-receipt-ledger-malformed');
    }
    return value as Record<string, KagePvpDuelSettlementReceipt>;
}

function exactReceipt(
    state: KageStateLike,
    desired: KagePvpDuelSettlementReceipt,
): KagePvpDuelSettlementReceipt | null {
    const ledger = parseReceiptLedger(state.pvpDuelSettlementReceipts);
    if (!Object.prototype.hasOwnProperty.call(ledger, desired.battleId)) return null;
    const current = ledger[desired.battleId];
    if (!sameJson(current, desired)) throw new Error('kage-pvp-receipt-conflict');
    return current;
}

function receiptForOutcome(
    state: KageStateLike,
    outcome: KageDuelOutcome,
    challengeId: string,
): KagePvpDuelSettlementReceipt | null {
    const ledger = parseReceiptLedger(state.pvpDuelSettlementReceipts);
    if (!Object.prototype.hasOwnProperty.call(ledger, outcome.battleId)) return null;
    const receipt = ledger[outcome.battleId];
    const valid = receipt
        && receipt.version === 1
        && receipt.battleId === outcome.battleId
        && receipt.challengeId === challengeId
        && (receipt.outcome === 'transferred' || receipt.outcome === 'defended')
        && receipt.winnerName === outcome.winnerName
        && receipt.loserName === outcome.loserName
        && typeof receipt.seatedKage === 'string'
        && receipt.seatedKage.trim().length > 0
        && receipt.settledAt === outcome.endedAt;
    if (!valid) throw new Error('kage-pvp-receipt-conflict');
    return receipt;
}

function embedReceipt(
    state: KageStateLike,
    receipt: KagePvpDuelSettlementReceipt,
): KageStateLike {
    const existing = parseReceiptLedger(state.pvpDuelSettlementReceipts);
    const entries = Object.entries(existing)
        .filter(([, value]) => value && typeof value === 'object')
        .sort((a, b) => Number(b[1].settledAt) - Number(a[1].settledAt))
        .slice(0, KAGE_PVP_RECEIPT_MAX - 1);
    const next: Record<string, KagePvpDuelSettlementReceipt> = {};
    for (const [battleId, value] of entries) setSafeRecordValue(next, battleId, value);
    setSafeRecordValue(next, receipt.battleId, receipt);
    return { ...state, pvpDuelSettlementReceipts: next };
}

function resultFromReceipt(village: string, receipt: KagePvpDuelSettlementReceipt): SettleResult {
    return receipt.outcome === 'transferred'
        ? {
            ok: true,
            result: 'transferred',
            seatedKage: receipt.seatedKage,
            village,
            battleId: receipt.battleId,
            newKage: receipt.seatedKage,
        }
        : {
            ok: true,
            result: 'defended',
            seatedKage: receipt.seatedKage,
            village,
            battleId: receipt.battleId,
        };
}

async function settleFromOutcome(
    village: string,
    outcome: KageDuelOutcome,
    now: number,
    opts: { callerName?: string; isAdmin?: boolean; expectChallengeId?: string },
): Promise<SettleResult> {
    if (now - outcome.endedAt > SESSION_REPLAY_WINDOW_MS) {
        return { ok: false, status: 409, error: 'That duel is too old to settle the seat.' };
    }
    const key = kageKey(village);
    // The durable receipt that settled (fresh or replayed). Read after the lock
    // to announce a dethroning exactly once — the announcement receipt is the
    // battle id, so a replay after a lost acknowledgement does not re-post.
    let settledReceipt: KagePvpDuelSettlementReceipt | null = null;
    const result = await withKvLock<SettleResult>(key, async () => {
        const raw = await kv.get<KageStateLike>(key);
        let state = raw ?? { kageSystemUnlocked: false };
        const challengeId = opts.expectChallengeId ?? outcome.challengeId ?? state.challenge?.challengeId ?? '';
        if (!challengeId) return { ok: false, status: 409, error: 'The official challenge proof is missing.' };

        const replay = receiptForOutcome(state, outcome, challengeId);
        if (replay) { settledReceipt = replay; return resultFromReceipt(village, replay); }

        const winnerNorm = safeName(outcome.winnerName);
        const loserNorm = safeName(outcome.loserName);

        const matchingAcceptedChallenge = state.challenge?.status === 'accepted'
            && state.challenge.battleId === outcome.battleId
            && state.challenge.challengeId === challengeId;
        const terminalWithinChallenge = !!state.challenge
            && outcome.endedAt <= state.challenge.createdAt + KAGE_CHALLENGE_EXPIRY_MS;
        if (state.challenge && !(matchingAcceptedChallenge && terminalWithinChallenge)) {
            // Eligibility is fixed at the immutable combat terminal time. The
            // recovery wall clock only bounds how long the proof is retained;
            // it must not expire a duel that finished within its challenge.
            const expiredAtTerminal = isChallengeExpired(state.challenge, outcome.endedAt);
            if (!expiredAtTerminal) {
                return { ok: false, status: 409, error: 'That duel does not match the active Kage challenge.' };
            }
            const expired = applyExpiry(state, now);
            try {
                const committed = await kv.compareSet(key, raw, expired);
                if (!committed) throw new Error('kage-expiry-conflict');
            } catch (error) {
                const recovered = await kv.get<KageStateLike>(key).catch(() => null);
                if (!sameJson(recovered, expired)) throw error;
            }
            return { ok: false, status: 409, error: 'That Kage challenge expired before settlement.' };
        }

        const isDraw = outcome.winnerName === 'draw' && outcome.loserName === 'draw';
        const drawFighters = new Set([safeName(outcome.p1Name), safeName(outcome.p2Name)]);
        const drawAuthorized = isDraw
            && matchingAcceptedChallenge
            && drawFighters.has(safeName(state.seatedKage ?? ''))
            && drawFighters.has(safeName(state.challenge?.challenger ?? ''))
            && (!opts.callerName
                || opts.isAdmin
                || drawFighters.has(safeName(opts.callerName)));
        const decision = drawAuthorized
            ? { kind: 'defend' as const }
            : resolveDuelDecision({
                challenge: state.challenge,
                battleId: outcome.battleId,
                seatNorm: safeName(state.seatedKage ?? ''),
                challengerNorm: safeName(state.challenge?.challenger ?? ''),
                fighterNorms: [...drawFighters],
                winnerNorm,
                loserNorm,
                expectChallengeId: challengeId,
                callerNorm: opts.callerName ? safeName(opts.callerName) : undefined,
                isAdmin: opts.isAdmin,
            });
        if (decision.kind === 'reject') return { ok: false, status: decision.status, error: decision.error };

        const challengerName = state.challenge!.challenger;
        const projected = decision.kind === 'transfer'
            ? applySeatTransfer(state, challengerName, village, outcome.endedAt, 'defeated')
            : applyDefense(state, challengerName, outcome.endedAt);
        const receipt: KagePvpDuelSettlementReceipt = canonical({
            version: 1,
            battleId: outcome.battleId,
            challengeId,
            outcome: decision.kind === 'transfer' ? 'transferred' : 'defended',
            winnerName: outcome.winnerName,
            loserName: outcome.loserName,
            seatedKage: String(projected.seatedKage ?? ''),
            settledAt: outcome.endedAt,
        });
        const candidate = canonical(embedReceipt(projected, receipt));
        try {
            if (await kv.compareSet(key, raw, candidate)) { settledReceipt = receipt; return resultFromReceipt(village, receipt); }
        } catch (error) {
            const recovered = await kv.get<KageStateLike>(key).catch(() => null);
            if (recovered && exactReceipt(recovered, receipt)) { settledReceipt = receipt; return resultFromReceipt(village, receipt); }
            throw error;
        }
        const recovered = await kv.get<KageStateLike>(key);
        if (recovered && exactReceipt(recovered, receipt)) { settledReceipt = receipt; return resultFromReceipt(village, receipt); }
        throw new Error('kage-settlement-cas-conflict');
    }, { failClosed: true });
    const receipt = settledReceipt as KagePvpDuelSettlementReceipt | null;
    if (result.ok && result.result === 'transferred' && receipt && receipt.outcome === 'transferred') {
        await announceKageDethroned({
            village,
            challenger: receipt.winnerName,
            oldKage: receipt.loserName,
            receiptId: `kage-dethroned:${village}:${receipt.battleId}`,
            meta: { battleId: receipt.battleId, challengeId: receipt.challengeId, how: 'defeated' },
        });
    }
    return result;
}

/** World Herald for a Kage seat changing hands by challenge (duel defeat or a
 *  forfeited obligation). Best-effort and exact-once per receipt — never
 *  throws into the settlement that triggered it. */
export async function announceKageDethroned(args: {
    village: string;
    challenger: string;
    oldKage: string;
    receiptId: string;
    meta?: Record<string, unknown>;
}): Promise<void> {
    try {
        await announce({
            type: 'kage_dethroned',
            importance: 'high',
            title: 'A New Kage Rises',
            message: `${args.challenger} has defeated ${args.oldKage} and taken the Kage seat of ${args.village}.`,
            player: args.challenger,
            village: args.village,
            meta: args.meta,
        }, { receiptId: args.receiptId });
    } catch { /* best-effort */ }
}

export async function settleKageDuelFromSession(
    village: string,
    session: PvpSession,
    now: number,
    opts: { callerName?: string; isAdmin?: boolean; expectChallengeId?: string } = {},
): Promise<SettleResult> {
    const outcome = outcomeFromSession(session, opts.expectChallengeId);
    if (!outcome) return { ok: false, status: 409, error: 'That duel has no valid terminal outcome.' };
    return settleFromOutcome(village, outcome, now, opts);
}

export async function settleKageDuel(
    village: string,
    battleId: string,
    now: number,
    opts: { callerName?: string; isAdmin?: boolean; expectChallengeId?: string } = {},
): Promise<SettleResult> {
    const session = await kv.get<PvpSession>(`pvp:${battleId}`);
    if (!session) return { ok: false, status: 404, error: 'Battle session not found or expired.' };
    return settleKageDuelFromSession(village, session, now, opts);
}

/** Opportunistic repair from the durable terminal evidence. */
export async function reconcilePendingKageSettle(village: string, now: number): Promise<SettleResult | null> {
    const state = await kv.get<KageStateLike>(kageKey(village));
    const challenge = state?.challenge;
    if (!challenge || challenge.status !== 'accepted' || !challenge.battleId) return null;
    const rec = await kv.get<(KageDuelOutcome & { village?: string })>(kageSettleKey(challenge.battleId));
    if (!rec) return null;
    const endedAt = isSafeTime(rec.endedAt) ? rec.endedAt : now;
    return settleFromOutcome(
        village,
        { ...rec, endedAt },
        now,
        { expectChallengeId: rec.challengeId ?? challenge.challengeId },
    );
}
