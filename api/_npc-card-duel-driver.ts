/**
 * Plays a Cinderhold NPC's seat in a war card duel (Push 3, 2026-11-09).
 *
 * Owner ruling 2026-11-09: pet and card battles against Cinderhold happen only
 * inside war features. A war card duel is an open-world Chronicle duel
 * (api/village/sector-card.ts `engage`): the challenger opens it, and the
 * challenged shinobi joins and plays it out under the shared Chronicle clock.
 * When the challenged shinobi is a Cinderhold NPC, this seat joins with the
 * NPC's own saved deck and plays its turns.
 *
 * Exactly the pattern of the shinobi duel seat (api/_npc-duel-driver.ts): a
 * server-side CLIENT that calls the real /api/village/sector-card handler
 * in-process as the NPC, with a short server-minted token, so every rule (the
 * clock, response windows, the AFK forfeit, participation, scoring, Chronicle
 * Points) is the duel's own. Moves come from the hard Chronicle AI's chooser
 * (api/card-clash/_ai-engine.ts chooseAiIntents), which reads only what the AI
 * match always read. It stands down while an admin controls the NPC.
 *
 * The NPC defends (seat p2): the attacking village's fighter is always p1, and
 * Cinderhold declares no wars before the war push.
 */
import { kv } from './_storage.js';
import { issuePlayerToken, readPlayerSessionEpoch } from './_auth.js';
import { isNpcPossessed } from './_npc-possession.js';
import { npcOwnsSlug } from './_npc-ownership.js';
import { NPC_VILLAGE_ROSTER } from '../shared/npc-village-roster.js';
import { forgetNpcCardDuel, liveNpcCardDuels, type NpcCardDuelEntry } from './_npc-duel.js';
import { safeName } from './_utils.js';
import { chooseAiIntents } from './card-clash/_ai-engine.js';
import { advanceExpiredChronicleTurn, applyAction, type ChronicleActionIntent, type ChronicleMatch } from '../shared/chronicle-duel.js';

export { NPC_CARD_DUEL_ACTIVE_KEY, registerNpcCardDuel, forgetNpcCardDuel, liveNpcCardDuels, npcInLiveCardDuel, type NpcCardDuelEntry } from './_npc-duel.js';
type OpenDuel = {
    sectorWarId: string; status: 'awaiting-target' | 'active' | 'done' | 'void';
    p1Name: string; p2Name?: string; state?: ChronicleMatch;
    open?: { engageId: string; target: string; joinBy: number };
};

/** Actions per drive before the seat yields (a Chronicle turn is a handful). */
const MAX_ACTIONS_PER_DRIVE = 24;
export const NPC_CARD_ACTION_BEAT_MS = 450;
const PUBLISH_GRACE_MS = 15_000;
const TOKEN_TTL_MS = 20 * 60 * 1000;
/** Sweeps (one a second) before a finished duel whose settling read keeps failing is let go. */
const MAX_SETTLE_ATTEMPTS = 120;
/**
 * One process drives a duel at a time, even while two overlap during a deploy.
 * A drive yields after DRIVE_BUDGET_MS (the next sweep carries on) and renews
 * its lease each LEASE_RENEW_MS it holds it, so the longest gap between
 * renewals is one beat and one request, far inside the TTL, while a crashed
 * holder's lease still lapses well inside the 60 s turn clock.
 */
const LEASE_TTL_SEC = 30;
const LEASE_RENEW_MS = 10_000;
const DRIVE_BUDGET_MS = 20_000;
let beatMs = NPC_CARD_ACTION_BEAT_MS;
let thinkScale = 1;
/** Tests run the seat without the beats, the think time or the join delay. */
export function setNpcCardBeatForTest(ms: number): void { beatMs = Math.max(0, ms); thinkScale = ms > 0 ? 1 : 0; }
type Sender = (slug: string, displayName: string, body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
let sendForTest: Sender | null = null;
/** Tests stand a fake route in for /api/village/sector-card (null restores it). */
export function setNpcCardDuelSendForTest(send: Sender | null): void { sendForTest = send; }

/*
 * Human pace at the Chronicle table (2026-11-11), the same idea as the shinobi
 * seat's think time (api/_npc-duel-driver.ts npcThinkMs): a player takes a few
 * seconds to sit down, reads the board before the first action of each turn,
 * takes a moment to decide whether to answer a response window, and plays
 * the rest of a turn at an uneven pace. Every wait is rolled from the duel and
 * the turn (or window), so it is the same on every sweep and after a restart,
 * and every one stays far inside the clock it runs against (the 60 s turn, the
 * 15 s response window, the join deadline).
 */
export const NPC_CARD_JOIN_MIN_MS = 3_000;
export const NPC_CARD_JOIN_MAX_MS = 12_000;
export const NPC_CARD_THINK_MIN_MS = 2_000;
export const NPC_CARD_THINK_MAX_MS = 10_000;
export const NPC_CARD_REACT_MIN_MS = 1_500;
export const NPC_CARD_REACT_MAX_MS = 5_000;
export const NPC_CARD_BEAT_MAX_MS = 1_200;
/** A response is always sent at least this long before its window closes. */
const RESPONSE_SAFETY_MS = 4_000;

function hash32(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function rolled(seed: string, min: number, max: number, scale: number): number {
    return scale * (min + (hash32(seed) % (max - min + 1)));
}

/**
 * When the NPC takes its seat in a duel published at `publishedAt` (before
 * `deadline`, when there is one). `scale` 0 (tests) seats it at once; the
 * clan-war seat passes its own.
 */
export function npcCardJoinAt(duelId: string, publishedAt: number, deadline?: number, scale = thinkScale): number {
    const at = publishedAt + rolled(`${duelId}:join`, NPC_CARD_JOIN_MIN_MS, NPC_CARD_JOIN_MAX_MS, scale);
    return deadline && Number.isFinite(deadline) ? Math.min(at, deadline - 10_000) : at;
}

/**
 * The earliest moment the seat may act on this board: after reading a turn
 * it has not yet acted in, or after weighing a response window that is its to
 * answer. 0 when nothing is to be waited for.
 */
export function npcChronicleReadyAt(duelId: string, state: ChronicleMatch, seat: 'p1' | 'p2', scale = thinkScale): number {
    if (!scale) return 0;
    const window = state.responseWindow;
    if (window && window.responder === seat) {
        const at = Number(window.openedAt) + rolled(`${duelId}:${window.id}:react`, NPC_CARD_REACT_MIN_MS, NPC_CARD_REACT_MAX_MS, scale);
        return Math.min(at, Number(window.expiresAt) - RESPONSE_SAFETY_MS);
    }
    if (!window && state.activePlayer === seat && state.actedThisTurn === false) {
        return Number(state.turnStartedAt) + rolled(`${duelId}:${state.turnNumber}:think`, NPC_CARD_THINK_MIN_MS, NPC_CARD_THINK_MAX_MS, scale);
    }
    return 0;
}

/** One beat between actions inside a turn: 450-1200 ms, uneven like a hand on a mouse. */
export function npcCardBeatMs(base = beatMs): number {
    if (!base) return 0;
    const scale = base / NPC_CARD_ACTION_BEAT_MS;
    return Math.round(base + Math.random() * (NPC_CARD_BEAT_MAX_MS - NPC_CARD_ACTION_BEAT_MS) * scale);
}
const settleFailures = new Map<string, number>();

const tokens = new Map<string, { token: string; until: number }>();
async function npcToken(slug: string): Promise<string | null> {
    // Never a session for a PLAYER who holds an NPC's account name (api/_npc-ownership.ts).
    if (!(await npcOwnsSlug(slug))) { tokens.delete(slug); return null; }
    const cached = tokens.get(slug);
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const token = issuePlayerToken(slug, TOKEN_TTL_MS, await readPlayerSessionEpoch(slug));
    if (!token) return null;
    tokens.set(slug, { token, until: Date.now() + TOKEN_TTL_MS });
    return token;
}

type Reply = { status: number; body: Record<string, unknown> };
type Handler = (req: unknown, res: unknown) => unknown;
function routeHandler(mod: unknown): Handler {
    const first = (mod as { default?: unknown }).default;
    const fn = typeof first === 'function' ? first : (first as { default?: unknown } | undefined)?.default;
    if (typeof fn !== 'function') throw new Error('npc-card-duel-driver: route handler not found');
    return fn as Handler;
}

async function asNpc(slug: string, displayName: string, body: Record<string, unknown>): Promise<Reply> {
    if (sendForTest) return sendForTest(slug, displayName, body);
    const token = await npcToken(slug);
    if (!token) return { status: 503, body: { error: 'no-npc-session' } };
    const handler = routeHandler(await import('./village/sector-card.js'));
    const out: Reply = { status: 200, body: {} };
    const res = {
        statusCode: 200, headersSent: false,
        setHeader() { return res; }, getHeader() { return undefined; },
        status(code: number) { out.status = code; res.statusCode = code; return res; },
        json(value: unknown) { out.body = (value ?? {}) as Record<string, unknown>; res.headersSent = true; return res; },
        send(value: unknown) { out.body = { value }; res.headersSent = true; return res; },
        end() { res.headersSent = true; return res; },
    };
    await handler({
        method: 'POST', url: '/api/village/sector-card', query: {}, body,
        headers: { 'content-type': 'application/json', 'x-player-token': token, 'x-player-name': displayName },
        socket: { remoteAddress: '127.0.0.1' },
    }, res);
    if (out.status === 401) tokens.delete(slug);
    return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const NPC_SAFE_STEPS: ChronicleActionIntent[] = [{ action: 'pass-response' }, { action: 'advance-phase' }, { action: 'enter-end-phase' }, { action: 'end-turn' }];
const driving = new Map<string, Promise<'idle' | 'acted' | 'finished' | 'gone'>>();

/**
 * One pass over a war card duel the NPC is seated in. Never drives one duel
 * twice at once. The duel row is read first and the lease taken only when
 * that board gives the seat something to do, so a sweep that finds the NPC
 * stepping in, reading the board or waiting on the player writes nothing.
 */
export async function driveNpcCardDuel(engageId: string, entry: NpcCardDuelEntry): Promise<'idle' | 'acted' | 'finished' | 'gone'> {
    const inFlight = driving.get(engageId);
    if (inFlight) { await inFlight.catch(() => undefined); return 'idle'; }
    const run = (async (): Promise<'idle' | 'acted' | 'finished' | 'gone'> => {
        const seen = await kv.get<OpenDuel>(duelKey(engageId)).catch(() => undefined);
        if (seen === undefined || !hasWork(engageId, entry, seen, Date.now())) return 'idle';
        if (seen && await isNpcPossessed(entry.npc)) return 'idle'; // the admin plays this seat
        return leased(engageId, (lease) => driveOnce(engageId, entry, lease));
    })();
    driving.set(engageId, run);
    try { return await run; } finally { driving.delete(engageId); }
}

const duelKey = (engageId: string) => `sector-card-open:${engageId}`;

/** Whether this board gives the seat anything to do now (the same checks driveOnce acts on). */
function hasWork(engageId: string, entry: NpcCardDuelEntry, duel: OpenDuel | null, now: number): boolean {
    const npc = NPC_VILLAGE_ROSTER.find((n) => n.id === entry.npc);
    if (!npc) return true; // forget it
    if (!duel) return now - entry.at >= PUBLISH_GRACE_MS; // forget it once the publish grace is over
    if (duel.status === 'void' || duel.status === 'done') return true; // forget it, or settle it
    const state = duel.state;
    if (safeName(duel.p2Name ?? '') !== npc.id) {
        // Not its seat: only a lapsed clock to pass.
        return duel.status === 'active' && !!state && advanceExpiredChronicleTurn(state, now, { catchUp: true }) !== state;
    }
    if (duel.status === 'awaiting-target') {
        return safeName(duel.open?.target ?? '') === npc.id && npcCardJoinAt(engageId, Number(entry.at) || now, duel.open?.joinBy) <= now;
    }
    if (duel.status !== 'active' || !state) return false;
    if (advanceExpiredChronicleTurn(state, now, { catchUp: true }) !== state) return true;
    const window = state.responseWindow;
    if (window ? window.responder !== 'p2' : state.activePlayer !== 'p2') return false; // the player's move
    return npcChronicleReadyAt(engageId, state, 'p2') <= now;
}

/**
 * The war card route has no move token, so two processes (a deploy overlap)
 * choosing from the same board could both send `end-turn`. A short lease per
 * duel keeps one driver on it, renewed while a long drive holds it; a crashed
 * holder's lease lapses in 30 s.
 */
const leaseOwner = `npc-card:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
type Lease = { keep(): Promise<boolean> };
async function leased(engageId: string, run: (lease: Lease) => Promise<'idle' | 'acted' | 'finished' | 'gone'>): Promise<'idle' | 'acted' | 'finished' | 'gone'> {
    const key = `npc-card-duel:lease:${engageId}`;
    const taken = await kv.set(key, leaseOwner, { nx: true, ex: LEASE_TTL_SEC }).catch(() => null);
    if (taken !== 'OK' && await kv.get(key).catch(() => null) !== leaseOwner) return 'idle';
    let heldSince = Date.now();
    const lease: Lease = {
        async keep() {
            if (Date.now() - heldSince < LEASE_RENEW_MS) return true;
            const kept = await kv.compareSet(key, leaseOwner, leaseOwner, { ex: LEASE_TTL_SEC }).catch(() => false);
            if (kept) heldSince = Date.now();
            return kept;
        },
    };
    try { return await run(lease); }
    finally { if (await kv.get(key).catch(() => null) === leaseOwner) await kv.del(key).catch(() => undefined); }
}

async function driveOnce(engageId: string, entry: NpcCardDuelEntry, lease: Lease): Promise<'idle' | 'acted' | 'finished' | 'gone'> {
    try {
        const npc = NPC_VILLAGE_ROSTER.find((n) => n.id === entry.npc);
        if (!npc) { await forgetNpcCardDuel(engageId); return 'gone'; }
        const read = () => kv.get<OpenDuel>(duelKey(engageId));
        let duel = await read();
        if (!duel) {
            if (Date.now() - entry.at < PUBLISH_GRACE_MS) return 'idle';
            await forgetNpcCardDuel(engageId);
            return 'gone';
        }
        const base = { sectorWarId: entry.sectorWarId, engageId };
        if (duel.status === 'void') { await forgetNpcCardDuel(engageId); return 'gone'; }
        if (duel.status === 'done') {
            // One read settles the duel's Chronicle Points even if the player
            // left; a busy or failed read is tried again on the next sweep.
            const read = await asNpc(npc.id, npc.name, { ...base, action: 'state' });
            if (read.status !== 200) {
                const tries = (settleFailures.get(engageId) ?? 0) + 1;
                settleFailures.set(engageId, tries);
                if (tries < MAX_SETTLE_ATTEMPTS) return 'idle';
                console.error('[npc-card-duel-driver] finished duel keeps failing to settle; letting go', engageId);
            }
            settleFailures.delete(engageId);
            await forgetNpcCardDuel(engageId);
            return 'finished';
        }
        const seat = safeName(duel.p2Name ?? '') === npc.id ? 'p2' : null;
        if (!seat) {
            // An admin-controlled NPC that opened the duel holds the attacking
            // seat, which the server cannot play: it only keeps the clock running,
            // so a duel the admin walks away from ends by the duel's own rules.
            const state = duel.state;
            if (duel.status === 'active' && state && advanceExpiredChronicleTurn(state, Date.now(), { catchUp: true }) !== state) {
                await asNpc(npc.id, npc.name, { ...base, action: 'state' });
                return 'acted';
            }
            return 'idle';
        }
        if (duel.status === 'awaiting-target') {
            if (safeName(duel.open?.target ?? '') !== npc.id) return 'idle';
            if (npcCardJoinAt(engageId, Number(entry.at) || Date.now(), duel.open?.joinBy) > Date.now()) return 'idle';
            // An empty request resolves the NPC's own saved 40-card deck.
            const joined = await asNpc(npc.id, npc.name, { ...base, action: 'join', deck: [] });
            if (joined.status !== 200) console.warn('[npc-card-duel-driver] join refused', engageId, joined.status, JSON.stringify(joined.body).slice(0, 160));
            return 'acted';
        }
        let acted = false;
        const started = Date.now();
        for (let step = 0; step < MAX_ACTIONS_PER_DRIVE; step++) {
            const state = duel?.state;
            if (!duel || duel.status !== 'active' || !state) break;
            const now = Date.now();
            // A turn whose clock ran out (the player walked out, or nothing the
            // seat could send was legal): one read lets the duel's own clock pass
            // it, or forfeit the absentee, exactly as for two players.
            if (advanceExpiredChronicleTurn(state, now, { catchUp: true }) !== state) {
                await asNpc(npc.id, npc.name, { ...base, action: 'state' });
                acted = true;
                break;
            }
            // Still reading the board or weighing a response: the sweep comes
            // back each second (no lock or lease is held while it waits).
            if (npcChronicleReadyAt(engageId, state, 'p2') > now || now - started > DRIVE_BUDGET_MS || !await lease.keep()) break;
            const candidates = chooseAiIntents(state, 'hard');
            if (!candidates) break; // the player's move
            // The first choice the engine accepts on this exact board is the one
            // sent; the route re-checks it under the duel's lock.
            // If none of the AI's choices is legal on this board, end the step the
            // way a player would rather than sit until the clock forfeits the NPC.
            const legal: ChronicleActionIntent | undefined = [...candidates, ...NPC_SAFE_STEPS]
                .find((intent) => applyAction(state, 'p2', intent, now).ok);
            if (!legal) break;
            if (acted && beatMs) await sleep(npcCardBeatMs());
            const reply = await asNpc(npc.id, npc.name, { ...base, ...legal });
            acted = true;
            if (reply.status !== 200) {
                // The board moved under us (or the clock passed the turn): read it again next drive.
                break;
            }
            duel = await read();
        }
        return acted ? 'acted' : 'idle';
    } catch (error) {
        console.error('[npc-card-duel-driver]', engageId, String(error));
        return 'idle';
    }
}

/** Drive one duel now (called right after it is opened). */
export async function kickNpcCardDuel(engageId: string): Promise<void> {
    const entry = (await liveNpcCardDuels())[engageId];
    if (entry) await driveNpcCardDuel(engageId, entry);
}

/** One sweep: every live war card duel with an NPC seated, side by side. */
export async function sweepNpcCardDuels(): Promise<number> {
    const live = await liveNpcCardDuels();
    const results = await Promise.all(Object.entries(live)
        .filter(([engageId]) => !driving.has(engageId))
        .map(([engageId, entry]) => driveNpcCardDuel(engageId, entry)));
    return results.filter((result) => result === 'finished').length;
}

let timer: ReturnType<typeof setInterval> | null = null;
/**
 * Starts the once-a-second sweep (idempotent). DISABLE_NPC_VILLAGE=1 keeps it
 * off. Sweeps are not gated on one another: a duel waiting on a 15 s response
 * window must not wait behind another duel's long turn. The per-duel guard and
 * lease keep any one duel to a single driver.
 */
export function startNpcCardDuelDriver(): void {
    if (timer || process.env.DISABLE_NPC_VILLAGE === '1') return;
    timer = setInterval(() => { void sweepNpcCardDuels().catch(() => undefined); }, 1000);
    timer.unref?.();
}
export function stopNpcCardDuelDriver(): void { if (timer) clearInterval(timer); timer = null; }
