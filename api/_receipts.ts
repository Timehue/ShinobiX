import { kv } from './_storage.js';
import type { KvLike } from './_storage.js';
import type { PvpSession, PvpFighter } from './pvp/session.js';

// ─── Durable battle receipts ──────────────────────────────────────────────────
//
// The live PvP combat log (`session.log`) is capped and dies with the session's
// 15-min KV TTL, so once a fight is over there is no record left to debug a
// support ticket, verify a disputed reward, or audit an outcome. A *receipt* is
// a compact, durable snapshot written ONCE when a battle resolves, keyed by
// battleId and kept for 90 days — long enough to settle almost any player
// dispute, still tiny storage.
//
// This is purely additive observability: the receipt is derived from the
// already-finalized session and never feeds back into combat resolution. The
// write is best-effort and idempotent (a per-battle NX marker), so it can never
// double-write or break the combat path. Gate off with DISABLE_COMBAT_RECEIPTS=1.
//
//   receipt:battle:<battleId>   — the BattleReceipt JSON (90d TTL)
//   receipt:wrote:<battleId>    — NX idempotency marker (90d TTL)

const RECEIPT_PREFIX = 'receipt:battle:';
const WROTE_PREFIX = 'receipt:wrote:';
// 90 days. Receipts are small (a few KB) and only one per finished battle, so
// the retention cost is negligible; the long window means a player can dispute
// an outcome weeks later and the evidence still exists.
export const RECEIPT_TTL_SEC = 90 * 24 * 60 * 60;

export function receiptKey(battleId: string): string { return `${RECEIPT_PREFIX}${battleId}`; }
export function receiptWroteKey(battleId: string): string { return `${WROTE_PREFIX}${battleId}`; }

export interface BattleReceiptFighter {
    name: string;
    hp: number;
    maxHp: number;
    // Final statuses at resolution — names + remaining rounds only (no blobs).
    finalStatuses: Array<{ name: string; rounds: number }>;
}

// Server-credited settlement summary, patched in by the reward paths
// (claim-rewards / vanguard) AFTER the receipt is written. Lets an admin see
// at a glance what a battle actually paid out, for reward-dispute triage.
export interface BattleSettlement {
    settledAt?: number;
    winnerRyo?: number;
    winnerXp?: number;
    ratingDelta?: number;
    vanguardSeals?: number;
    vanguardXp?: number;
    note?: string;
}

export interface BattleReceipt {
    battleId: string;
    ranked: boolean;
    rankedKind?: 'player' | 'pet';
    startedAt: number;
    endedAt: number;
    rounds: number;
    p1: BattleReceiptFighter;
    p2: BattleReceiptFighter;
    winner: 'p1' | 'p2' | 'draw' | null;
    fleedBy?: 'p1' | 'p2';
    p1Rating?: number;
    p2Rating?: number;
    // Durable copy of the final combat log (already trimmed by the session).
    log: string[];
    settlement?: BattleSettlement;
}

// Minimal KV surface the receipt functions need. Defaulting to the shared `kv`
// keeps production callers dead-simple (`writeBattleReceipt(session)`) while
// letting tests inject an in-memory store for deterministic idempotency checks.
type ReceiptKv = Pick<KvLike, 'get' | 'set'>;

function fighterReceipt(f: PvpFighter): BattleReceiptFighter {
    return {
        name: String(f.name ?? ''),
        hp: Math.max(0, Math.round(Number(f.hp) || 0)),
        maxHp: Math.round(Number(f.maxHp) || 0),
        finalStatuses: (Array.isArray(f.statuses) ? f.statuses : []).map((s) => ({
            name: String(s.name ?? ''),
            rounds: Number(s.rounds) || 0,
        })),
    };
}

// Pure: derive the durable receipt from a finalized session. No I/O, no clock —
// `now` is passed so callers (and tests) control the timestamp.
export function buildBattleReceipt(session: PvpSession, now: number): BattleReceipt {
    return {
        battleId: String(session.battleId ?? ''),
        ranked: session.ranked === true,
        rankedKind: session.rankedKind,
        startedAt: Number(session.createdAt) || 0,
        endedAt: now,
        rounds: Number(session.round) || 0,
        p1: fighterReceipt(session.p1),
        p2: fighterReceipt(session.p2),
        winner: session.winner ?? null,
        fleedBy: session.fleedBy,
        p1Rating: session.p1Rating,
        p2Rating: session.p2Rating,
        log: Array.isArray(session.log) ? [...session.log] : [],
        settlement: undefined,
    };
}

function receiptsDisabled(): boolean {
    return process.env.DISABLE_COMBAT_RECEIPTS === '1';
}

// Write the durable receipt exactly once for a resolved battle. Best-effort and
// idempotent: a per-battle NX marker means a retried terminal move (or a replay)
// never double-writes, and any storage hiccup is swallowed so the combat path is
// never affected. No-op for unresolved sessions or when receipts are disabled.
export async function writeBattleReceipt(
    session: PvpSession,
    opts: { now?: number; kv?: ReceiptKv } = {},
): Promise<boolean> {
    if (receiptsDisabled()) return false;
    if (!session?.battleId || session.status !== 'done') return false;
    const store = opts.kv ?? kv;
    const now = opts.now ?? Date.now();
    try {
        const placed = await store.set(
            receiptWroteKey(session.battleId),
            { ts: now },
            { nx: true, ex: RECEIPT_TTL_SEC } as never,
        );
        if (!placed) return false; // already written for this battle
        await store.set(receiptKey(session.battleId), buildBattleReceipt(session, now), { ex: RECEIPT_TTL_SEC });
        return true;
    } catch {
        // best-effort — never break the caller
        return false;
    }
}

export async function readBattleReceipt(
    battleId: string,
    opts: { kv?: ReceiptKv } = {},
): Promise<BattleReceipt | null> {
    const store = opts.kv ?? kv;
    try {
        return await store.get<BattleReceipt>(receiptKey(battleId));
    } catch {
        return null;
    }
}

// Pure: merge a settlement patch onto an existing receipt. Last-writer-wins on
// individual fields, which is benign for this debug-only summary (the winner's
// claim writes ryo/xp/ratingDelta; the loser's writes their ratingDelta).
export function mergeSettlement(
    existing: BattleReceipt,
    patch: Partial<BattleSettlement>,
    now: number,
): BattleReceipt {
    const settlement: BattleSettlement = {
        ...(existing.settlement ?? {}),
        ...patch,
        settledAt: patch.settledAt ?? existing.settlement?.settledAt ?? now,
    };
    return { ...existing, settlement };
}

// Patch the server-credited settlement summary onto a battle's receipt. Runs
// AFTER the reward is actually credited; best-effort, never throws into the
// reward path. No-op if the receipt doesn't exist (e.g. receipts disabled).
export async function patchBattleSettlement(
    battleId: string,
    patch: Partial<BattleSettlement>,
    opts: { now?: number; kv?: ReceiptKv } = {},
): Promise<void> {
    if (receiptsDisabled()) return;
    const store = opts.kv ?? kv;
    const now = opts.now ?? Date.now();
    try {
        const existing = await store.get<BattleReceipt>(receiptKey(battleId));
        if (!existing) return;
        await store.set(receiptKey(battleId), mergeSettlement(existing, patch, now), { ex: RECEIPT_TTL_SEC });
    } catch {
        // best-effort
    }
}
