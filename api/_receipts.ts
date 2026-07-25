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
    } catch (e) {
        // best-effort — never break the caller, but DO surface it: a swallowed
        // receipt write is exactly what makes a later "I won but got nothing"
        // dispute unanswerable.
        console.error(`[receipts] writeBattleReceipt failed for battle ${session.battleId}:`, e);
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
    } catch (e) {
        // best-effort — but log: this patch records what a battle actually paid
        // out, so a swallowed failure blanks the reward-dispute evidence.
        console.error(`[receipts] patchBattleSettlement failed for battle ${battleId}:`, e);
    }
}

// ─── Per-action combat receipts (phase 1) ─────────────────────────────────────
//
// The battle receipt above is ONE snapshot per finished fight. A per-action
// receipt is a compact, append-only record of a SINGLE committed action — a
// jutsu cast, item use, movement, flee, turn end, or the terminal resolution —
// written as the move commits. Together they form a durable, structured replay
// of the fight that outlives the 15-min session TTL, for support, tag/status
// disputes, and post-battle review — WITHOUT bloating the frequently-streamed
// live session payload. These live under their own `receipt:action:` keys, which
// are NOT in the kv_store anon-SELECT allowlist (pvp: only),
// so they are service-role-only by RLS — no anon direct reads.
//
// Storage (all RECEIPT_TTL_SEC, same 90-day window as the battle receipt):
//   receipt:seq:<battleId>            — atomic per-battle sequence counter (kv.incr)
//   receipt:action:<battleId>:<seq>   — one ActionReceipt JSON per committed move
//   receipt:act-tok:<battleId>:<tok>  — NX idempotency marker per moveToken
//
// Phase 1 captures what the engine already produces cheaply: the move's id/name,
// its flavor/cast narrative + effect lines (summaryLines, in order), compact
// resource deltas, and a result classification. Richer structured status /
// ground-effect events would require threading an event channel through the
// balance-sensitive combat resolver in api/pvp/move.ts and are intentionally
// DEFERRED. Best-effort + flag-gated (DISABLE_COMBAT_RECEIPTS) like the battle
// receipt; a write failure never affects combat.

export type ActionReceiptResult = 'applied' | 'blocked' | 'expired' | 'system' | 'battle_end';

// ─── Presentation metadata (additive, optional) ───────────────────────────────
//
// `actionName` alone is not enough to render a battle log well: the UI wants a
// human label, a category to group/filter by, and an icon. All of it is derived
// SERVER-SIDE from the already-validated jutsu/item object at the commit point —
// never from the client request body, which the player controls.
//
// Every field is optional so the 90 days of receipts already in storage keep
// rendering unchanged; the client falls back to category/element glyphs.

export type ActionReceiptCategory =
    | 'jutsu'
    | 'basic'
    | 'weapon'
    | 'item'
    | 'movement'
    | 'turn'
    | 'system';

export interface ActionReceiptDisplay {
    /** Human-readable name, e.g. "Blazing Dragon Arc" — never a raw id. */
    label: string;
    category: ActionReceiptCategory;
    element?: string;
    discipline?: string;
    iconKey?: string;
    /** Compact, safe image reference. NEVER a data: URL — see sanitizeImageRef. */
    imageRef?: string;
}

// Receipts are stored per action for 90 days, so an unbounded string is a real
// storage-growth and payload risk. Cap conservatively; labels this long are
// already pathological.
const MAX_LABEL_LEN = 80;
const MAX_META_LEN = 40;
const MAX_IMAGE_REF_LEN = 256;

function clampString(v: unknown, max: number): string | undefined {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    return s.length > max ? s.slice(0, max) : s;
}

// An image reference is only worth storing if it is compact AND safe to render
// as an <img src>. Three shapes qualify:
//   • a rooted static asset path   → /starter-avatar-one.webp
//   • a short /api/img reference   → /api/img?id=jutsu:foo
//   • a short absolute https URL   → https://img.shinobijourney.com/...
// Everything else — most importantly a base64 `data:` payload, which would bloat
// every receipt by hundreds of KB — is dropped, and the client falls back to a
// category/element glyph.
export function sanitizeImageRef(raw: unknown): string | undefined {
    const s = String(raw ?? '').trim();
    if (!s || s.length > MAX_IMAGE_REF_LEN) return undefined;
    // Reject anything with a scheme we don't explicitly allow (data:, blob:,
    // javascript:, file: …). Checked before the path test so a crafted
    // "/..\njavascript:" can't sneak through.
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
        if (!/^https:\/\//i.test(s)) return undefined;
        return s;
    }
    // Rooted, single-slash path only — no protocol-relative "//evil.host".
    if (s.startsWith('/') && !s.startsWith('//')) return s;
    return undefined;
}

// Normalize whatever the commit site assembled into a storable display block.
// Returns undefined when there is no usable label, so the field stays absent
// rather than persisting an empty object on every action.
export function buildActionDisplay(input: {
    label?: unknown;
    category?: ActionReceiptCategory;
    element?: unknown;
    discipline?: unknown;
    iconKey?: unknown;
    imageRef?: unknown;
} | undefined): ActionReceiptDisplay | undefined {
    if (!input) return undefined;
    const label = clampString(input.label, MAX_LABEL_LEN);
    if (!label || !input.category) return undefined;
    const display: ActionReceiptDisplay = { label, category: input.category };
    const element = clampString(input.element, MAX_META_LEN);
    const discipline = clampString(input.discipline, MAX_META_LEN);
    const iconKey = clampString(input.iconKey, MAX_META_LEN);
    const imageRef = sanitizeImageRef(input.imageRef);
    if (element) display.element = element;
    if (discipline) display.discipline = discipline;
    if (iconKey) display.iconKey = iconKey;
    if (imageRef) display.imageRef = imageRef;
    return display;
}

// Only the non-zero vitals that actually moved this action — keeps each receipt
// tiny (an idle "wait" records nothing but a turn change).
export interface ActionReceiptVitalsDelta {
    hp?: number;
    chakra?: number;
    stamina?: number;
    shield?: number;
    pos?: number;
}

export interface ActionReceipt {
    battleId: string;
    seq: number;
    moveToken?: string;
    round: number;
    actorRole: 'p1' | 'p2';
    actorName: string;
    targetRole: 'p1' | 'p2';
    targetName: string;
    actionId: string;
    actionName: string;
    // 'jutsu' | 'item' | 'move' | 'wait' | 'flee' | 'basic' | system actions.
    actionType: string;
    result: ActionReceiptResult;
    // The move's narrative: flavor/cast line(s) followed by what it did, in the
    // exact order the engine emitted them this action.
    summaryLines: string[];
    actorDelta: ActionReceiptVitalsDelta;
    targetDelta: ActionReceiptVitalsDelta;
    // AP spent this action (positive). Omitted when zero.
    apSpent?: number;
    // Present only on the terminal (battle_end) action.
    winner?: 'p1' | 'p2' | 'draw' | null;
    createdAt: number;
    // Optional server-derived presentation metadata. Absent on receipts written
    // before this field existed — the client falls back to actionName/actionType.
    display?: ActionReceiptDisplay;
}

// Everything writeActionReceipt needs to derive a receipt from a committed move.
// Passing the pre/post sessions lets the module compute deltas + the action's
// own log lines, so the move handler's call site stays a single line.
export interface ActionReceiptInput {
    pre: PvpSession;
    post: PvpSession;
    role: 'p1' | 'p2';
    actionId: string;
    actionName: string;
    actionType: string;
    moveToken?: string;
    // Server-resolved presentation metadata for this action. The move handler
    // assembles it from the VALIDATED jutsu/item object inside each switch
    // branch, so it can never carry a client-supplied label or image.
    display?: {
        label?: unknown;
        category?: ActionReceiptCategory;
        element?: unknown;
        discipline?: unknown;
        iconKey?: unknown;
        imageRef?: unknown;
    };
}

// The action layer needs atomic incr (seq), NX set (idempotency), and keys+mget
// (read-back). Defaulting to the shared `kv` keeps callers simple; tests inject
// an in-memory store.
type ActionReceiptKv = Pick<KvLike, 'set' | 'incr' | 'keys' | 'mget'>;

export function actionSeqKey(battleId: string): string { return `receipt:seq:${battleId}`; }
export function actionTokenKey(battleId: string, token: string): string {
    return `receipt:act-tok:${battleId}:${token}`;
}
// Zero-padded seq so a lexical key sort == numeric order. A battle caps at
// MAX_ROUNDS × MAX_ACTIONS × 2 fighters (~250 actions), far under 999999.
export function actionReceiptKey(battleId: string, seq: number): string {
    return `receipt:action:${battleId}:${String(seq).padStart(6, '0')}`;
}
export function actionReceiptPattern(battleId: string): string {
    return `receipt:action:${battleId}:*`;
}

// Compact delta of the vitals that changed. Rounds to integers and drops zeros.
function vitalsDelta(before: PvpFighter, after: PvpFighter): ActionReceiptVitalsDelta {
    const d: ActionReceiptVitalsDelta = {};
    const hp = Math.round((Number(after.hp) || 0) - (Number(before.hp) || 0));
    const chakra = Math.round((Number(after.chakra) || 0) - (Number(before.chakra) || 0));
    const stamina = Math.round((Number(after.stamina) || 0) - (Number(before.stamina) || 0));
    const shield = Math.round((Number(after.shield) || 0) - (Number(before.shield) || 0));
    const pos = (Number(after.pos) || 0) - (Number(before.pos) || 0);
    if (hp) d.hp = hp;
    if (chakra) d.chakra = chakra;
    if (stamina) d.stamina = stamina;
    if (shield) d.shield = shield;
    if (pos) d.pos = pos;
    return d;
}

// Pure: derive an ActionReceipt from the pre/post session + action metadata.
// `summaryLines` is the suffix of post.log beyond pre.log — every commit path
// builds post.log as [...pre.log, ...thisActionsLines], and the receipt is
// written BEFORE the log is trimmed, so the suffix is exactly this action's
// narrative (flavor/cast line first, then effect lines). No I/O, no clock.
export function buildActionReceipt(input: ActionReceiptInput, seq: number, now: number): ActionReceipt {
    const { pre, post, role } = input;
    const targetRole: 'p1' | 'p2' = role === 'p1' ? 'p2' : 'p1';
    const actorBefore = role === 'p1' ? pre.p1 : pre.p2;
    const actorAfter = role === 'p1' ? post.p1 : post.p2;
    const targetBefore = targetRole === 'p1' ? pre.p1 : pre.p2;
    const targetAfter = targetRole === 'p1' ? post.p1 : post.p2;

    const preLen = Array.isArray(pre.log) ? pre.log.length : 0;
    const summaryLines = (Array.isArray(post.log) ? post.log.slice(preLen) : []).map(String);

    const apSpent = (Number(pre.ap?.[role]) || 0) - (Number(post.ap?.[role]) || 0);
    const result: ActionReceiptResult = post.status === 'done' ? 'battle_end' : 'applied';

    return {
        battleId: String(pre.battleId ?? ''),
        seq,
        moveToken: input.moveToken,
        round: Number(pre.round) || 0,
        actorRole: role,
        actorName: String(actorBefore.name ?? ''),
        targetRole,
        targetName: String(targetBefore.name ?? ''),
        actionId: input.actionId,
        actionName: input.actionName,
        actionType: input.actionType,
        result,
        summaryLines,
        actorDelta: vitalsDelta(actorBefore, actorAfter),
        targetDelta: vitalsDelta(targetBefore, targetAfter),
        apSpent: apSpent > 0 ? apSpent : undefined,
        winner: post.status === 'done' ? (post.winner ?? null) : undefined,
        createdAt: now,
        display: buildActionDisplay(input.display),
    };
}

// Append one durable receipt for a committed action. Best-effort + idempotent:
// a per-moveToken NX marker means a retried move (the move handler already
// short-circuits known tokens, but guard here too) never double-appends, and any
// storage hiccup is swallowed so the combat path is never affected. No-op when
// receipts are disabled or the session has no battleId.
export async function writeActionReceipt(
    input: ActionReceiptInput,
    opts: { now?: number; kv?: ActionReceiptKv } = {},
): Promise<ActionReceipt | null> {
    if (receiptsDisabled()) return null;
    const battleId = String(input.pre?.battleId ?? '');
    if (!battleId) return null;
    const store = opts.kv ?? kv;
    const now = opts.now ?? Date.now();
    try {
        if (input.moveToken) {
            const placed = await store.set(
                actionTokenKey(battleId, input.moveToken),
                { ts: now },
                { nx: true, ex: RECEIPT_TTL_SEC } as never,
            );
            if (!placed) return null; // already recorded this move
        }
        const seq = await store.incr(actionSeqKey(battleId), { ex: RECEIPT_TTL_SEC });
        const receipt = buildActionReceipt(input, seq, now);
        await store.set(actionReceiptKey(battleId, seq), receipt, { ex: RECEIPT_TTL_SEC });
        return receipt;
    } catch (e) {
        // best-effort — never break the caller, but log so a KV outage that's
        // silently dropping the per-action replay is at least visible.
        console.error(`[receipts] writeActionReceipt failed for battle ${battleId}:`, e);
        return null;
    }
}

// ─── Per-player battle history index (phase 2) ────────────────────────────────
//
// A BattleReceipt is findable by battleId, but nothing lets a player LIST the
// battles they fought — the live `pvp:<battleId>` session is the only thing that
// ever knew, and it dies with its 15-minute TTL. So a finished fight was
// effectively unreachable the moment the session expired, even though its
// receipts were sitting in storage for 90 days.
//
// This index closes that gap with one compact, capped, participant-relative list
// per player:
//
//   receipt:history:<safeName>  — BattleHistorySummary[], newest first (90d TTL)
//
// It is written AFTER the battle receipt lands, under the shared KV lock, and is
// display-only: a failure here is logged and swallowed, never rolled back into a
// completed battle. Deduping by battleId makes a retried terminal request a
// no-op rather than a duplicate row.

/** Newest-first cap. ~50 battles is several weeks of play and keeps one read tiny. */
export const HISTORY_MAX_ENTRIES = 50;

export function historyKey(safePlayerName: string): string {
    return `receipt:history:${safePlayerName}`;
}

export type BattleOutcome = 'win' | 'loss' | 'draw' | 'flee';

// Participant-RELATIVE: `opponent` and `outcome` are written from the point of
// view of the player whose index this row lives in, so rendering a history list
// needs no extra resolution step.
export interface BattleHistorySummary {
    battleId: string;
    opponent: string;
    startedAt: number;
    endedAt: number;
    rounds: number;
    mode: string;
    ranked: boolean;
    outcome: BattleOutcome;
    winner: 'p1' | 'p2' | 'draw' | null;
}

// Pure: what a finished battle looked like from one side of it.
export function buildHistorySummary(
    receipt: BattleReceipt,
    role: 'p1' | 'p2',
): BattleHistorySummary {
    const isP1 = role === 'p1';
    const opponent = String((isP1 ? receipt.p2?.name : receipt.p1?.name) ?? '');
    // A flee is recorded as its own outcome for BOTH sides — the fleeing player
    // sees "fled", the other sees a win. Otherwise map the winner role.
    let outcome: BattleOutcome;
    if (receipt.fleedBy === role) outcome = 'flee';
    else if (receipt.winner === 'draw' || receipt.winner === null) outcome = 'draw';
    else outcome = receipt.winner === role ? 'win' : 'loss';
    return {
        battleId: String(receipt.battleId ?? ''),
        opponent,
        startedAt: Number(receipt.startedAt) || 0,
        endedAt: Number(receipt.endedAt) || 0,
        rounds: Number(receipt.rounds) || 0,
        mode: receipt.ranked ? 'Ranked' : 'PvP',
        ranked: receipt.ranked === true,
        outcome,
        winner: receipt.winner ?? null,
    };
}

// Pure: fold one summary into an existing list — dedupe by battleId (so a
// retried terminal settlement replaces rather than duplicates), newest first,
// capped. Exported for direct testing of the idempotency contract.
export function mergeHistoryEntry(
    existing: BattleHistorySummary[] | null | undefined,
    entry: BattleHistorySummary,
    max: number = HISTORY_MAX_ENTRIES,
): BattleHistorySummary[] {
    const list = Array.isArray(existing) ? existing : [];
    const deduped = list.filter((e) => e && e.battleId !== entry.battleId);
    return [entry, ...deduped]
        .sort((a, b) => (Number(b.endedAt) || 0) - (Number(a.endedAt) || 0))
        .slice(0, max);
}

type HistoryKv = Pick<KvLike, 'get' | 'set'>;

// Append one battle to a single player's index, under the shared KV lock so two
// concurrent terminal writes (both fighters' clients retrying at once) can't
// clobber each other's read-modify-write. Best-effort by design.
async function indexOne(
    safePlayerName: string,
    entry: BattleHistorySummary,
    store: HistoryKv,
    lock: <T>(target: string, fn: () => Promise<T>) => Promise<T>,
): Promise<boolean> {
    const key = historyKey(safePlayerName);
    try {
        await lock(key, async () => {
            const existing = await store.get<BattleHistorySummary[]>(key);
            const next = mergeHistoryEntry(existing, entry);
            await store.set(key, next, { ex: RECEIPT_TTL_SEC });
        });
        return true;
    } catch (e) {
        // Display-only: a missing index row costs the player a list entry, never
        // the battle or its rewards. Log with the battleId so a support ticket
        // ("my fight vanished from history") is traceable.
        console.error(`[receipts] history index failed for ${safePlayerName} battle ${entry.battleId}:`, e);
        return false;
    }
}

// Index a resolved battle for BOTH participants. Call AFTER writeBattleReceipt
// has succeeded. Idempotent via mergeHistoryEntry's battleId dedupe, so a
// retried terminal move never produces a duplicate row for either player.
export async function indexBattleForParticipants(
    receipt: BattleReceipt,
    opts: {
        kv?: HistoryKv;
        lock?: <T>(target: string, fn: () => Promise<T>) => Promise<T>;
        safeName?: (raw: string) => string;
    } = {},
): Promise<{ p1: boolean; p2: boolean }> {
    if (receiptsDisabled()) return { p1: false, p2: false };
    if (!receipt?.battleId) return { p1: false, p2: false };
    const store = opts.kv ?? kv;
    // Default lock is injected by the caller in production (api/_lock.ts) to keep
    // this module free of a cyclic import; tests pass a pass-through.
    const lock = opts.lock ?? (async <T,>(_t: string, fn: () => Promise<T>) => fn());
    const norm = opts.safeName ?? ((raw: string) => String(raw ?? '').trim().toLowerCase());

    const p1Name = norm(String(receipt.p1?.name ?? ''));
    const p2Name = norm(String(receipt.p2?.name ?? ''));
    const results = { p1: false, p2: false };
    if (p1Name) results.p1 = await indexOne(p1Name, buildHistorySummary(receipt, 'p1'), store, lock);
    if (p2Name) results.p2 = await indexOne(p2Name, buildHistorySummary(receipt, 'p2'), store, lock);
    return results;
}

// One read for a player's whole list — no per-battle fan-out. Newest first.
export async function readBattleHistory(
    safePlayerName: string,
    opts: { kv?: HistoryKv } = {},
): Promise<BattleHistorySummary[]> {
    const store = opts.kv ?? kv;
    try {
        const list = await store.get<BattleHistorySummary[]>(historyKey(safePlayerName));
        return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object' && e.battleId) : [];
    } catch {
        return [];
    }
}

// Read every per-action receipt for a battle, ordered by seq. Used by the
// combat-log endpoint. Best-effort: returns [] on any storage error.
export async function readActionReceipts(
    battleId: string,
    opts: { kv?: ActionReceiptKv } = {},
): Promise<ActionReceipt[]> {
    const store = opts.kv ?? kv;
    try {
        const keys = await store.keys(actionReceiptPattern(battleId));
        if (!keys.length) return [];
        keys.sort();
        const vals = await store.mget<ActionReceipt[]>(...keys);
        return vals
            .filter((v): v is ActionReceipt => !!v && typeof v === 'object')
            .sort((a, b) => a.seq - b.seq);
    } catch {
        return [];
    }
}
