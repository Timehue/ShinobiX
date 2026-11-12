/**
 * Plays the NPC's seat in a Cinderhold duel (Push 2, 2026-11-09).
 *
 * The driver is a server-side CLIENT: it calls the real /api/pvp/move and
 * /api/pvp/claim-rewards handlers in-process, authenticated as the NPC with a
 * short server-minted session token, exactly as a browser would. So the NPC
 * joins through the join window, every move passes the same validation, lock,
 * CAS, 45 s clock and round-25 tiebreak as a player's, and the NPC's own claim
 * clears its pending-battle pointer the normal way (and is never credited).
 *
 * It stands down while an admin controls the NPC (the takeover rotates the
 * NPC's session epoch, which also voids any token the driver holds), and it
 * never holds a lock across turns: each move is one ordinary request.
 */
import { kv } from './_storage.js';
import { issuePlayerToken, readPlayerSessionEpoch } from './_auth.js';
import { isNpcPossessed } from './_npc-possession.js';
import { npcOwnsSlug } from './_npc-ownership.js';
import { withNpcSeatLease, type NpcSeatLease } from './_npc-seat-lease.js';
import { pvpTurnDeadlineNeedsWork } from './pvp/_turn-deadline.js';
import { chooseNpcMove, npcInSeat, type NpcMoveBody, type PvpSeat } from './_npc-ai-seat.js';
import { NPC_DUEL_PUBLISH_GRACE_MS, forgetNpcDuel, liveNpcDuels, npcSeatOf, recordNpcDuelResult } from './_npc-duel.js';
import type { PvpSession } from './pvp/session.js';
import { woundNpc } from './_npc-wounds.js';
import { PVP_HOSPITAL_DURATION_MS, PVP_RAID_SHIELD_MS } from './pvp/_vitals-settlement.js';
import { safeName } from './_utils.js';
import { NPC_VILLAGE_ROSTER } from '../shared/npc-village-roster.js';

/** Actions per turn before the seat ends it (the engine caps a turn at five). */
const MAX_ACTIONS_PER_TURN = 6;
/** A short beat between actions so a watching player can follow the turn (varied per action, like a hand on a mouse). */
export const NPC_ACTION_BEAT_MS = 650;
/**
 * A player reads the board before their first action of a turn; an NPC that
 * answered the instant the turn passed would give itself away. Each turn waits
 * a think time in this range, rolled from the duel and round, so it is the
 * same on every sweep and across a restart. The whole turn (think plus up to
 * six beats) stays far inside the 45 s PvP clock.
 */
export const NPC_THINK_MIN_MS = 2_000;
export const NPC_THINK_MAX_MS = 10_000;
const TOKEN_TTL_MS = 20 * 60 * 1000;
const tokens = new Map<string, { token: string; until: number }>();
const driving = new Map<string, Promise<'idle' | 'acted' | 'finished' | 'gone'>>();
const joinRefusals = new Map<string, number>();
const claimFailures = new Map<string, number>();
/** Sweeps (one a second) before a claim that keeps failing is given up on and logged. */
const MAX_CLAIM_ATTEMPTS = 120;
let beatMs = NPC_ACTION_BEAT_MS;
let thinkScale = 1;

/** Tests run the seat without the presentation beat, the think time or the join delay. */
export function setNpcActionBeatForTest(ms: number): void { beatMs = Math.max(0, ms); thinkScale = ms > 0 ? 1 : 0; }

function hash32(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/** How long the NPC reads the board before its first action this turn. */
export function npcThinkMs(battleId: string, round: unknown, seat: PvpSeat): number {
    const span = NPC_THINK_MAX_MS - NPC_THINK_MIN_MS;
    return thinkScale * (NPC_THINK_MIN_MS + (hash32(`${battleId}:${String(round)}:${seat}:think`) % (span + 1)));
}

/**
 * A challenged player needs a moment to see the fight and step in; an NPC
 * that took its seat the instant the duel was published would give itself
 * away. Rolled from the duel, like the think time, and far inside the 90 s
 * join window (shared/pvp-cancellation.ts PVP_JOIN_WINDOW_MS).
 */
export const NPC_JOIN_MIN_MS = 3_000;
export const NPC_JOIN_MAX_MS = 12_000;

/** How long the NPC takes to step into this duel once it is published. */
export function npcJoinDelayMs(battleId: string, seat: PvpSeat): number {
    const span = NPC_JOIN_MAX_MS - NPC_JOIN_MIN_MS;
    return thinkScale * (NPC_JOIN_MIN_MS + (hash32(`${battleId}:${seat}:join`) % (span + 1)));
}

/** One beat between actions, 60-140% of NPC_ACTION_BEAT_MS. */
function actionBeat(): number {
    return Math.round(beatMs * (0.6 + Math.random() * 0.8));
}

/** Actions refused by the engine this turn, so the planner picks another instead of giving the turn up. */
const MAX_REPLANS_PER_TURN = 2;

async function npcToken(slug: string): Promise<string | null> {
    // Never a session for a PLAYER who holds an NPC's account name: every NPC
    // action (duels, war strikes, campaigns, clan wars, hunts, spectating)
    // comes through here, so a player's account is never driven as an NPC.
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

/**
 * A route module's default handler. Under tsx (tests) `import()` yields the ES
 * namespace (`.default` is the handler); the compiled CommonJS server gets the
 * CJS exports object wrapped once more (`.default.default`).
 */
export function routeHandler(mod: unknown): Handler {
    const first = (mod as { default?: unknown }).default;
    const fn = typeof first === 'function' ? first : (first as { default?: unknown } | undefined)?.default;
    if (typeof fn !== 'function') throw new Error('npc-duel-driver: route handler not found');
    return fn as Handler;
}

/** Calls a route handler in-process as the NPC; resolves with its status and JSON. */
export async function asNpc(handler: Handler, slug: string, displayName: string, body: Record<string, unknown>): Promise<Reply> {
    const token = await npcToken(slug);
    if (!token) return { status: 503, body: { error: 'no-npc-session' } };
    const out: Reply = { status: 200, body: {} };
    const res = {
        statusCode: 200,
        headersSent: false,
        setHeader() { return res; },
        getHeader() { return undefined; },
        status(code: number) { out.status = code; res.statusCode = code; return res; },
        json(value: unknown) { out.body = (value ?? {}) as Record<string, unknown>; res.headersSent = true; return res; },
        send(value: unknown) { out.body = { value }; res.headersSent = true; return res; },
        end() { res.headersSent = true; return res; },
    };
    await handler({
        method: 'POST', url: '/api/npc-duel', query: {}, body,
        headers: { 'content-type': 'application/json', 'x-player-token': token, 'x-player-name': displayName },
        socket: { remoteAddress: '127.0.0.1' },
    }, res);
    if (out.status === 401) tokens.delete(slug); // epoch moved (takeover): mint afresh next time
    return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readSession(battleId: string): Promise<PvpSession | null> {
    return (await kv.get<PvpSession>(`pvp:${battleId}`)) ?? null;
}

/**
 * The NPC's own claim: it credits the NPC nothing, but it is what clears the
 * NPC's pending-battle pointer, so it must land. Returns false while it does
 * not (the duel stays registered and the next sweep tries again).
 */
async function claimAsNpc(session: PvpSession, seat: PvpSeat): Promise<boolean> {
    const npc = npcInSeat(session, seat)!;
    const claim = routeHandler(await import('./pvp/claim-rewards.js'));
    const outcome = session.winner === 'draw' || !session.winner ? 'draw' : session.winner === seat ? 'win' : 'loss';
    const body = { playerName: npc.id, battleId: session.battleId, outcome, completionVersion: 1 };
    const first = await asNpc(claim, npc.id, npc.name, body);
    if (first.status !== 200) return false;
    const ack = await asNpc(claim, npc.id, npc.name, { ...body, completionAck: true });
    if (ack.status !== 200) return false;
    const foe = seat === 'p1' ? session.p2.name : session.p1.name;
    await recordNpcDuelResult(npc.id, String(foe ?? ''), outcome, session.battleId).catch(() => undefined);
    // A win is a PvP kill on its profile, as a player's would be: rebuild its
    // save from the record now rather than at the next daily pass.
    if (outcome === 'win') {
        const { reseedNpc } = await import('./_npc-village-seed.js');
        await reseedNpc(npc.id).catch(() => undefined);
    }
    // Beaten at a war front: wounded, off the map to recover (api/_npc-wounds.ts).
    // Beaten anywhere else: a player's loss, the hospital and then the Field
    // Recovery shield, so a winner cannot rematch it at full HP on the spot.
    if (outcome === 'loss') {
        const at = Number(session.endedAt) || Date.now();
        const by = safeName(String(foe ?? ''));
        const opts = await atWarFront(session) ? {} : { ms: PVP_HOSPITAL_DURATION_MS, shieldMs: PVP_RAID_SHIELD_MS };
        await woundNpc(npc.id, at, by, opts).catch(() => undefined);
        // Beaten, it walks nowhere: it stays where it fell, as a beaten player's
        // row does while they sit on the result and hospital screens, until the
        // next presence tick reads the wound and takes it off the map.
        const { holdNpcJourney } = await import('./_npc-journeys.js');
        holdNpcJourney(npc.id, 'wounded');
    }
    return true;
}

/**
 * Whether this duel is a war fight: on a sector Cinderhold is at war over, a
 * village-war objective battle, or a duel with a village Cinderhold is fighting
 * a five-day village war against (Push 4b: any such duel scores that war).
 */
async function atWarFront(session: PvpSession): Promise<boolean> {
    if (session.villageWarObjective) return true;
    // A clan-war duel (Cinderhold's clans, 2026-11-10) is no village-war front,
    // whatever the two villages: a beaten NPC takes a player's ordinary loss
    // (the hospital, then the Field Recovery shield), not the 3 h war wound.
    if (session.rewardAuthority === 'clan-war') return false;
    const { npcVillageWarEnemies } = await import('./_npc-village-campaign.js');
    const enemies = await npcVillageWarEnemies().catch(() => new Set<string>());
    const seat = npcSeatOf(session);
    const foe = seat === 'p1' ? session.p2 : seat === 'p2' ? session.p1 : null;
    if (foe && enemies.has(String(foe.character?.village ?? '').trim())) return true;
    const { npcWarFronts } = await import('./_npc-village-war.js');
    const { pvpWorldBattleSector } = await import('./pvp/_sector-war-continuation.js');
    return (await npcWarFronts().catch(() => [] as number[])).includes(pvpWorldBattleSector(session));
}

/**
 * Lets a duel go. `unlist` says what becomes of its spectator listing: 'any'
 * takes it off the board whoever listed it (the duel is over or gone), 'ours'
 * only when this seat listed it (a player's own listing of a live duel stays).
 */
async function forget(battleId: string, unlist: 'any' | 'ours', npc?: NpcIdentity): Promise<void> {
    joinRefusals.delete(battleId);
    claimFailures.delete(battleId);
    await unlistForSpectators(battleId, unlist, npc).catch(() => undefined);
    await forgetNpcDuel(battleId);
}

/**
 * Spectating (2026-11-11). A fighter's own client lists a live duel on the
 * shared board the roster's "Fighting → Spectate" reads (api/game-state.ts
 * `arenaActiveFight`; PvpBattleScreen registers it). An NPC has no client, so a
 * duel it started (a hunt, a war strike) was only listed once the player's
 * screen opened. The seat lists it the same way, through the same route as the
 * NPC, once both fighters are seated (a duel the player never joins is never
 * listed), unless the player already has; and takes it off again on every way
 * the seat lets the duel go. Display only. The board holds 20 fights, so a
 * stale entry would push a live one off it.
 */
const ARENA_ACTIVE_FIGHTS_KEY = 'game:arena:active-fights';
type NpcIdentity = { id: string; name: string };
/** Duels on the board this process knows of: who the seat is, and whether the seat listed it itself. */
const listed = new Map<string, { npc: NpcIdentity; ours: boolean }>();
async function arenaRoute(): Promise<Handler> { return routeHandler(await import('./game-state.js')); }
type BoardFight = { id?: string; fighters?: string[] };
const readBoard = async () => (await kv.get<BoardFight[]>(ARENA_ACTIVE_FIGHTS_KEY).catch(() => null)) ?? [];
async function listForSpectators(session: PvpSession, npc: NpcIdentity): Promise<void> {
    const battleId = session.battleId;
    if (listed.has(battleId) || session.status !== 'active') return;
    let ours = false;
    if (!(await readBoard()).some((fight) => fight?.id === `pvp-${battleId}`)) {
        const reply = await asNpc(await arenaRoute(), npc.id, npc.name, {
            kind: 'arenaActiveFight', action: 'register',
            fight: { id: `pvp-${battleId}`, battleId, mode: session.rewardAuthority === 'clan-war' ? 'Clan War' : 'PvP', ...(typeof session.biome === 'string' ? { biome: session.biome } : {}) },
        });
        if (reply.status !== 200) return; // tried again on the next drive
        ours = true;
    }
    listed.set(battleId, { npc, ours });
}
/** Takes a duel off the board. One read and nothing written when it is not there. */
async function unlistForSpectators(battleId: string, unlist: 'any' | 'ours', npc?: NpcIdentity): Promise<void> {
    const known = listed.get(battleId);
    listed.delete(battleId);
    if (unlist === 'ours' && !known?.ours) return;
    const fight = (await readBoard()).find((f) => f?.id === `pvp-${battleId}`);
    if (!fight) return;
    // After a restart the seat may not know the duel: the board names its fighters.
    const as = npc ?? known?.npc ?? NPC_VILLAGE_ROSTER.find((n) => (fight.fighters ?? []).some((f) => safeName(f) === n.id));
    if (!as) return;
    await asNpc(await arenaRoute(), as.id, as.name, { kind: 'arenaActiveFight', action: 'remove', fightId: `pvp-${battleId}` });
}

/**
 * One pass over a duel: join if unseated, play the NPC's whole turn if it is
 * the NPC's to play, claim once it is over. Safe to call at any time and from
 * any trigger; a duel is never driven twice at once in this process.
 */
export async function driveNpcDuel(battleId: string, seat: PvpSeat, registeredAt = 0): Promise<'idle' | 'acted' | 'finished' | 'gone'> {
    // One run per duel at a time in this process: a second caller waits for the run in flight.
    const inFlight = driving.get(battleId);
    if (inFlight) { await inFlight.catch(() => undefined); return 'idle'; }
    const run = (async (): Promise<'idle' | 'acted' | 'finished' | 'gone'> => {
        // One read decides whether there is anything to do, so a sweep that
        // finds the NPC stepping in, reading the board or waiting on the player
        // writes nothing (no lease is taken).
        const seen = await readSession(battleId).catch((error) => { console.error('[npc-duel-driver]', battleId, String(error)); return undefined; });
        if (seen === undefined || !npcDuelHasWork(battleId, seat, registeredAt, seen, Date.now())) return 'idle';
        const npc = seen ? npcInSeat(seen, seat) : null;
        if (npc && await isNpcPossessed(npc.id)) {
            // The admin plays this seat by hand, from a client that lists the
            // duel itself; the seat's own listing goes (and comes back if the
            // seat takes the duel over again).
            if (listed.has(battleId)) await unlistForSpectators(battleId, 'ours', npc).catch(() => undefined);
            return 'idle';
        }
        // Across processes too (a deploy overlap): one seat per duel.
        return withNpcSeatLease(npcDuelLeaseKey(battleId), 'idle' as const, (lease) => driveOnce(battleId, seat, registeredAt, lease));
    })();
    driving.set(battleId, run);
    try { return await run; } finally { driving.delete(battleId); }
}

/** The cross-process lease one drive of this duel holds (api/_npc-seat-lease.ts). */
export const npcDuelLeaseKey = (battleId: string) => `npc-duel:lease:${battleId}`;

/**
 * Whether this duel gives the seat anything to do now: the same checks
 * driveOnce acts on, from one read and no writes.
 */
export function npcDuelHasWork(battleId: string, seat: PvpSeat, registeredAt: number, session: PvpSession | null, now: number): boolean {
    if (!session) return now - registeredAt >= NPC_DUEL_PUBLISH_GRACE_MS; // forget it once the publish grace is over
    if (!npcInSeat(session, seat)) return true; // forget it
    if (session.status === 'done') return true; // claim it
    if (!session.joined?.[seat]) {
        const publishedAt = Number(session.createdAt) || registeredAt || now;
        return publishedAt + npcJoinDelayMs(battleId, seat) <= now;
    }
    const playerJoined = !!session.joined?.[seat === 'p1' ? 'p2' : 'p1'];
    if (playerJoined && session.status === 'active' && !listed.has(battleId)) return true; // list it for spectators
    if (!playerJoined || session.activePlayer !== seat) return pvpTurnDeadlineNeedsWork(session, now);
    if ((session.turnStartedAt ?? 0) > now) return false;
    return Number(session.turnStartedAt ?? 0) + npcThinkMs(battleId, session.round, seat) <= now;
}

async function driveOnce(battleId: string, seat: PvpSeat, registeredAt: number, lease: NpcSeatLease): Promise<'idle' | 'acted' | 'finished' | 'gone'> {
    try {
        let session = await readSession(battleId);
        if (!session) {
            // Registered just before its row is published: give the create a moment.
            if (Date.now() - registeredAt < NPC_DUEL_PUBLISH_GRACE_MS) return 'idle';
            await forget(battleId, 'any'); // no duel: nothing left to watch
            return 'gone';
        }
        const npc = npcInSeat(session, seat);
        if (!npc) { await forget(battleId, 'ours'); return 'gone'; }
        if (await isNpcPossessed(npc.id)) {
            if (listed.has(battleId)) await unlistForSpectators(battleId, 'ours', npc).catch(() => undefined);
            return 'idle';
        }
        const move = routeHandler(await import('./pvp/move.js'));
        const send = (b: NpcMoveBody | { action: 'join' }) => asNpc(move, npc.id, npc.name, {
            battleId, role: seat, ...b, moveToken: `npc-${battleId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        });
        if (session.status === 'done') {
            // Off the board first, so a claim that keeps failing does not keep
            // a finished duel listed (once: a retried claim reads nothing more).
            if (!claimFailures.has(battleId)) await unlistForSpectators(battleId, 'any', npc).catch(() => undefined);
            if (!await claimAsNpc(session, seat)) {
                const tries = (claimFailures.get(battleId) ?? 0) + 1;
                claimFailures.set(battleId, tries);
                if (tries < MAX_CLAIM_ATTEMPTS) return 'idle';
                console.error('[npc-duel-driver] NPC claim keeps failing; giving up', battleId);
            }
            await forget(battleId, 'any', npc);
            return 'finished';
        }
        if (!session.joined?.[seat]) {
            // A player takes a few seconds to answer: seeded, so a restart or a
            // second sweep keeps the same moment, and far inside the join window.
            const publishedAt = Number(session.createdAt) || registeredAt || Date.now();
            if (publishedAt + npcJoinDelayMs(battleId, seat) > Date.now()) return 'idle';
            const joined = await send({ action: 'join' });
            const refused = joined.status !== 200 || !!(joined.body as { rejected?: unknown }).rejected;
            if (refused) {
                const tries = (joinRefusals.get(battleId) ?? 0) + 1;
                joinRefusals.set(battleId, tries);
                // A seat that cannot join in ~20 s will not: stop retrying and let
                // the join window settle the duel as a no-show, the PvP rule.
                if (tries >= 20) {
                    console.warn('[npc-duel-driver] giving up joining', battleId, joined.status, JSON.stringify(joined.body).slice(0, 200));
                    await forget(battleId, 'ours', npc);
                    return 'gone';
                }
            } else {
                joinRefusals.delete(battleId);
                if (session.joined?.[seat === 'p1' ? 'p2' : 'p1']) await listForSpectators(session, npc).catch(() => undefined);
            }
            return 'acted';
        }
        // Until the player has joined too, the move route refuses every action,
        // so the seat only runs the clocks: the same function closes a lapsed
        // join window as a no-show, the PvP rule, with no move-route calls.
        // Nor is a duel nobody has joined yet anything to watch.
        const playerJoined = !!session.joined?.[seat === 'p1' ? 'p2' : 'p1'];
        if (playerJoined) await listForSpectators(session, npc).catch(() => undefined);
        if (!playerJoined || session.activePlayer !== seat) {
            // The player's own browser normally enforces their 45 s clock by
            // reading the session; if they have left, the seat does it with the
            // same function, so an abandoned duel plays out instead of stalling.
            const { enforcePvpTurnDeadline } = await import('./pvp/_turn-deadline.js');
            const enforced = await enforcePvpTurnDeadline(kv, battleId, session).catch(() => null);
            return enforced && enforced.applied !== 'none' ? 'acted' : 'idle';
        }
        if ((session.turnStartedAt ?? 0) > Date.now()) return 'idle';
        // Reading the board: the sweep comes back each second until the think
        // time has passed (no lock or promise is held while it waits).
        if (Number(session.turnStartedAt ?? 0) + npcThinkMs(battleId, session.round, seat) > Date.now()) return 'idle';
        let acted = false;
        let busyRetries = 0;
        const avoid: NpcMoveBody[] = [];
        const atWar = await atWarFront(session);
        for (let step = 0; step < MAX_ACTIONS_PER_TURN; step++) {
            // Still ours? (A long turn renews the lease; another process that
            // took it over is the one playing now.)
            if (!await lease.keep()) break;
            const choice = chooseNpcMove(session, seat, { atWar, avoid });
            if (acted && beatMs) await sleep(actionBeat());
            const reply = await send(choice);
            acted = true;
            // The move route refuses with 200 + `rejected` (illegal, or busy).
            const rejected = (reply.body as { rejected?: { reason?: unknown } }).rejected;
            if (rejected && /busy/i.test(String(rejected.reason ?? '')) && busyRetries < 3) {
                busyRetries++; step--; await sleep(300); continue;
            }
            if (choice.action === 'wait') break;
            if (reply.status !== 200 || rejected) {
                // The engine said no (a rule the planner's projection missed).
                // A player would try something else: plan again without that
                // move, a couple of times, before ending the turn.
                if (avoid.length < MAX_REPLANS_PER_TURN) { avoid.push(choice); step--; continue; }
                await send({ action: 'wait' });
                break;
            }
            const next = await readSession(battleId);
            if (!next || next.status !== 'active' || next.activePlayer !== seat) break;
            session = next;
        }
        return acted ? 'acted' : 'idle';
    } catch (error) {
        console.error('[npc-duel-driver]', battleId, String(error));
        return 'idle';
    }
}

/** Drive one duel now (called right after its session is published). */
export async function kickNpcDuel(battleId: string): Promise<void> {
    const live = await liveNpcDuels();
    const entry = live[battleId];
    if (entry) await driveNpcDuel(battleId, entry.seat, entry.at);
}

/**
 * One sweep over every live duel: the safety net behind the kick. Duels run
 * side by side (each NPC turn takes seconds of beats, so playing them one after
 * another would push later duels past their turn clock), and a duel already
 * being played is left to that run instead of being queued behind it.
 */
export async function sweepNpcDuels(): Promise<number> {
    const live = await liveNpcDuels();
    const results = await Promise.all(Object.entries(live)
        .filter(([battleId]) => !driving.has(battleId))
        .map(([battleId, entry]) => driveNpcDuel(battleId, entry.seat, entry.at)));
    return results.filter((result) => result === 'finished').length;
}

let timer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;
/** Starts the once-a-second sweep (idempotent). DISABLE_NPC_VILLAGE=1 keeps it off. */
export function startNpcDuelDriver(): void {
    if (timer || process.env.DISABLE_NPC_VILLAGE === '1') return;
    timer = setInterval(() => {
        if (sweeping) return; // one sweep at a time; a slow one is not stacked on
        sweeping = true;
        void sweepNpcDuels().catch(() => undefined).finally(() => { sweeping = false; });
    }, 1000);
    timer.unref?.();
}
export function stopNpcDuelDriver(): void { if (timer) clearInterval(timer); timer = null; }
