/**
 * Plays a Cinderhold raider's seat in a village-war CARD battle (owner ruling
 * 2026-11-10: Cinderhold raids player strongholds as a player village does).
 *
 * A raider who starts the assault on a player village's card stronghold sits
 * in seat p1 of the campaign run, exactly as a player attacker does:
 *   - against a queued player defender it is a real PvP Chronicle duel
 *     (run.card) the defender plays from their own browser;
 *   - against the defending village's AI copy it is the AI match (run.aiCard)
 *     whose p1 seat a player would play.
 * This seat is a server-side CLIENT, the pattern of the war card seat
 * (api/_npc-card-duel-driver.ts): it calls the real /api/village/war-campaign
 * actions in-process as the NPC, with its server-minted token, so the clock,
 * the response windows, the AFK forfeit, participation, scoring and Chronicle
 * Points are the campaign's own (and pay the NPC nothing). Moves come from the
 * hard Chronicle AI's chooser (api/card-clash/_ai-engine.ts chooseAiIntents),
 * which plays seat p2: it is asked about the board seen from the other side
 * (seats swapped) and its answer swapped back, then checked against the real
 * board before it is sent.
 *
 * Like a player it reads the board before the first action of each turn
 * (2-10 s, seeded by run and turn) and takes a short beat between actions.
 * It stands down while an admin controls the NPC, and it never gives a battle
 * up: it plays until the run is over. DISABLE_NPC_VILLAGE=1 keeps it off.
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { isNpcPossessed } from './_npc-possession.js';
import { NPC_VILLAGE_ROSTER } from '../shared/npc-village-roster.js';
import { chooseAiIntents } from './card-clash/_ai-engine.js';
import { advanceExpiredChronicleTurn, applyAction, type ChronicleActionIntent, type ChronicleMatch } from '../shared/chronicle-duel.js';

export const NPC_CAMPAIGN_CARD_RUNS_KEY = 'npc-village:campaign-card-runs';
export type NpcCampaignCardRun = { npc: string; warId: string; at: number };
type Registry = Record<string, NpcCampaignCardRun>;
type CampaignCardRun = {
    id: string; warId: string; attacker: string; status: 'prepared' | 'active' | 'done'; npc: boolean;
    card?: ChronicleMatch; aiCard?: { state: ChronicleMatch };
};

export const NPC_CARD_THINK_MIN_MS = 2_000;
export const NPC_CARD_THINK_MAX_MS = 10_000;
/** A response window is short: the seat answers one in 1-3 s, never past its last 2 s. */
const RESPOND_MIN_MS = 1_000;
const RESPOND_MAX_MS = 3_000;
const BEAT_MIN_MS = 450;
const BEAT_MAX_MS = 1_200;
const MAX_ACTIONS_PER_DRIVE = 24;
const PUBLISH_GRACE_MS = 15_000;
/** Sweeps (one a second) before a finished run whose scoring read keeps failing is let go. */
const MAX_SETTLE_ATTEMPTS = 120;
/**
 * The lease one drive holds. A drive yields after DRIVE_BUDGET_MS (the next
 * sweep carries on) and renews the lease each LEASE_RENEW_MS it holds it, so
 * the longest gap between renewals is one beat and one request, far inside
 * the TTL, while a crashed holder's lease still lapses well inside the 60 s
 * turn clock.
 */
const LEASE_TTL_SEC = 30;
const LEASE_RENEW_MS = 10_000;
const DRIVE_BUDGET_MS = 20_000;
const NPC_SAFE_STEPS: ChronicleActionIntent[] = [{ action: 'pass-response' }, { action: 'advance-phase' }, { action: 'enter-end-phase' }, { action: 'end-turn' }];

let timeScale = 1;
let beatScale = 1;
/**
 * Tests pace the seat: `scale` scales the think and response times, and
 * `beats` the beats between actions (it follows `scale` unless given). 0 plays
 * at once.
 */
export function setNpcCampaignCardPaceForTest(scale: number, beats = scale): void {
    timeScale = Math.max(0, scale);
    beatScale = Math.max(0, beats);
}

type Sender = (npcId: string, npcName: string, body: Record<string, unknown>) => Promise<Reply>;
let sendForTest: Sender | null = null;
/** Tests stand a fake campaign route in for /api/village/war-campaign (null restores it). */
export function setNpcCampaignCardSendForTest(send: Sender | null): void { sendForTest = send; }

function hash32(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
const span = (key: string, min: number, max: number) => min + hash32(key) % (max - min + 1);
/** How long the raider reads the board before its first action of a turn. */
export function npcCardThinkMs(runId: string, turnNumber: unknown): number {
    return timeScale * span(`${runId}:${String(turnNumber)}:think`, NPC_CARD_THINK_MIN_MS, NPC_CARD_THINK_MAX_MS);
}
const beat = () => Math.round(beatScale * (BEAT_MIN_MS + Math.random() * (BEAT_MAX_MS - BEAT_MIN_MS)));

/**
 * The earliest moment the raider (seat p1) may act on this board, or null when
 * the move is not its own. Each new turn waits out the seeded think, and each
 * response window that is its to answer the seeded answer time; mid-turn (it
 * has already acted in this turn) only the beat between actions remains, so 0.
 * Against the AI copy the copy's whole turn is played inside the raider's own
 * request, so a drive that ends its turn sees its next one at once: this is
 * what makes it read that board too instead of playing straight on.
 */
export function npcCampaignCardReadyAt(runId: string, state: ChronicleMatch): number | null {
    const window = state.responseWindow;
    if (window) {
        if (window.responder !== 'p1') return null;
        return Math.min(Number(window.openedAt) + timeScale * span(`${runId}:${window.id}:respond`, RESPOND_MIN_MS, RESPOND_MAX_MS),
            Number(window.expiresAt) - 2_000);
    }
    if (state.activePlayer !== 'p1') return null;
    if (state.actedThisTurn === true) return 0;
    return Number(state.turnStartedAt) + npcCardThinkMs(runId, state.turnNumber);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Swaps every seat key and seat value, so the board reads from the other side. */
function swapSeats<T>(value: T): T {
    if (value === 'p1') return 'p2' as T;
    if (value === 'p2') return 'p1' as T;
    if (Array.isArray(value)) return value.map(swapSeats) as T;
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) out[key === 'p1' ? 'p2' : key === 'p2' ? 'p1' : key] = swapSeats(inner);
        return out as T;
    }
    return value;
}

/**
 * The hard Chronicle AI's choices for seat p1, then the fallbacks; null when it
 * is not p1's move. The chooser only knows seat p2, so it is shown the board
 * with the seats swapped and its answers are swapped back.
 */
export function chooseP1Intents(state: ChronicleMatch): ChronicleActionIntent[] | null {
    const mirrored = swapSeats({ ...state, log: [] });
    const choices = chooseAiIntents(mirrored, 'hard');
    return choices ? choices.map((intent) => swapSeats(intent)) : null;
}

/** An empty registry is re-read every 10 s, not every second (a run started in this process wakes the sweep at once). */
const IDLE_RECHECK_MS = 10_000;
let idleUntil = 0;

export async function registerNpcCampaignCardRun(runId: string, entry: NpcCampaignCardRun): Promise<void> {
    idleUntil = 0;
    // Already registered (the campaign tick re-asks each minute): no lock, no write.
    if ((await kv.get<Registry>(NPC_CAMPAIGN_CARD_RUNS_KEY))?.[runId]) return;
    await withKvLock(NPC_CAMPAIGN_CARD_RUNS_KEY, async () => {
        const live = (await kv.get<Registry>(NPC_CAMPAIGN_CARD_RUNS_KEY)) ?? {};
        if (live[runId]) return;
        live[runId] = entry;
        await kv.set(NPC_CAMPAIGN_CARD_RUNS_KEY, live, { ex: 6 * 24 * 60 * 60 });
    }, { failClosed: true });
}
async function forget(runId: string): Promise<void> {
    settleFailures.delete(runId);
    await withKvLock(NPC_CAMPAIGN_CARD_RUNS_KEY, async () => {
        const live = (await kv.get<Registry>(NPC_CAMPAIGN_CARD_RUNS_KEY)) ?? {};
        if (!(runId in live)) return;
        delete live[runId];
        await kv.set(NPC_CAMPAIGN_CARD_RUNS_KEY, live, { ex: 6 * 24 * 60 * 60 });
    }, { failClosed: true });
}
export async function liveNpcCampaignCardRuns(): Promise<Registry> {
    return (await kv.get<Registry>(NPC_CAMPAIGN_CARD_RUNS_KEY)) ?? {};
}

type Reply = { status: number; body: Record<string, unknown> };
async function asNpcOnCampaign(npcId: string, npcName: string, body: Record<string, unknown>): Promise<Reply> {
    if (sendForTest) return sendForTest(npcId, npcName, body);
    const { asNpc, routeHandler } = await import('./_npc-duel-driver.js');
    return asNpc(routeHandler(await import('./village/war-campaign.js')), npcId, npcName, body);
}

const settleFailures = new Map<string, number>();
const driving = new Map<string, Promise<DriveResult>>();
type DriveResult = 'idle' | 'acted' | 'finished' | 'gone';

/**
 * One pass over a card run a raider is seated in. Never drives one run twice
 * at once. The run row is read first and the lease taken only when that board
 * gives the seat something to do, so a sweep that finds the raider reading the
 * board, or the opponent to move, writes nothing.
 */
export async function driveNpcCampaignCardRun(runId: string, entry: NpcCampaignCardRun): Promise<DriveResult> {
    const inFlight = driving.get(runId);
    if (inFlight) { await inFlight.catch(() => undefined); return 'idle'; }
    const run = (async () => {
        if (process.env.DISABLE_NPC_VILLAGE === '1') return 'idle';
        const seen = await kv.get<CampaignCardRun>(runKey(runId)).catch(() => undefined);
        if (seen === undefined || !hasWork(runId, entry, seen, Date.now())) return 'idle';
        if (await isNpcPossessed(entry.npc)) return 'idle'; // the admin plays this seat by hand
        return leased(runId, (lease) => driveOnce(runId, entry, lease));
    })();
    driving.set(runId, run);
    try { return await run; } finally { driving.delete(runId); }
}

const runKey = (runId: string) => `village-campaign-run:${runId}`;

/** Whether this board gives the seat anything to do now (the same checks driveOnce acts on). */
function hasWork(runId: string, entry: NpcCampaignCardRun, run: CampaignCardRun | null, now: number): boolean {
    if (!NPC_VILLAGE_ROSTER.some((n) => n.id === entry.npc)) return true; // forget it
    if (!run) return now - entry.at >= PUBLISH_GRACE_MS; // forget it once the publish grace is over
    if (run.status === 'done' || run.attacker !== entry.npc) return true;
    const state = run.card ?? run.aiCard?.state;
    if (!state || state.status !== 'active') return true; // forget it, or score it
    if (run.card && advanceExpiredChronicleTurn(state, now, { catchUp: true }) !== state) return true;
    const readyAt = npcCampaignCardReadyAt(runId, state);
    return readyAt !== null && readyAt <= now;
}

/** Two processes (a deploy overlap) never drive the same run: a short lease per run, renewed while a long drive holds it. */
const leaseOwner = `npc-campaign-card:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
type Lease = { keep(): Promise<boolean> };
async function leased(runId: string, run: (lease: Lease) => Promise<DriveResult>): Promise<DriveResult> {
    const key = `npc-campaign-card:lease:${runId}`;
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

async function driveOnce(runId: string, entry: NpcCampaignCardRun, lease: Lease): Promise<DriveResult> {
    try {
        if (process.env.DISABLE_NPC_VILLAGE === '1') return 'idle';
        const npc = NPC_VILLAGE_ROSTER.find((n) => n.id === entry.npc);
        if (!npc) { await forget(runId); return 'gone'; }
        const read = () => kv.get<CampaignCardRun>(runKey(runId));
        let run = await read();
        if (!run) {
            if (Date.now() - entry.at < PUBLISH_GRACE_MS) return 'idle';
            await forget(runId);
            return 'gone';
        }
        if (run.status === 'done') { await forget(runId); return 'finished'; }
        if (run.attacker !== npc.id || (!run.card && !run.aiCard)) { await forget(runId); return 'gone'; }
        const base = { warId: entry.warId, runId };
        const send = (body: Record<string, unknown>) => asNpcOnCampaign(npc.id, npc.name, { ...base, ...body });
        let acted = false;
        const started = Date.now();
        for (let step = 0; step < MAX_ACTIONS_PER_DRIVE; step++) {
            if (!run) break;
            if (run.status === 'done') { await forget(runId); return 'finished'; }
            const state = run.card ?? run.aiCard?.state;
            if (!state) break;
            if (state.status !== 'active') {
                // Over, but not yet scored (the last move was the opponent's, or
                // the clock's): one read scores it, as the attacker's poll would.
                const scored = await send({ action: 'state' });
                if (scored.status === 200) { await forget(runId); return 'finished'; }
                const tries = (settleFailures.get(runId) ?? 0) + 1;
                settleFailures.set(runId, tries);
                if (tries >= MAX_SETTLE_ATTEMPTS) {
                    console.error('[npc-campaign-card-seat] finished run keeps failing to score; letting go', runId);
                    await forget(runId);
                    return 'gone';
                }
                return 'idle';
            }
            const now = Date.now();
            // Against a player, a turn whose clock ran out (they walked away) is
            // passed by any duelist's read, then the AFK forfeit ends the duel.
            if (run.card && advanceExpiredChronicleTurn(state, now, { catchUp: true }) !== state) {
                const passed = await send({ action: 'state' });
                acted = true;
                if (passed.status !== 200) break;
                run = await read();
                continue;
            }
            // Not its move, or a new turn or response window it has yet to read
            // (one that opened in this very drive too, as the AI copy's whole
            // turn does): stop, and a later sweep acts once the think is over.
            const readyAt = npcCampaignCardReadyAt(runId, state);
            if (readyAt === null || readyAt > now) break;
            if (now - started > DRIVE_BUDGET_MS || !await lease.keep()) break; // the next sweep carries on
            const candidates = chooseP1Intents(state) ?? [];
            const legal = [...candidates, ...NPC_SAFE_STEPS].find((intent) => applyAction(state, 'p1', intent, now).ok);
            if (!legal) break;
            if (acted && beatScale) await sleep(beat());
            const reply = await send({ ...legal });
            acted = true;
            if (reply.status !== 200) break; // the board moved under us: read it again next sweep
            run = await read();
        }
        return acted ? 'acted' : 'idle';
    } catch (error) {
        console.error('[npc-campaign-card-seat]', runId, String(error));
        return 'idle';
    }
}

/** Drive one run now (called right after the raider starts it). */
export async function kickNpcCampaignCardRun(runId: string): Promise<void> {
    const entry = (await liveNpcCampaignCardRuns())[runId];
    if (entry) await driveNpcCampaignCardRun(runId, entry);
}

/** One sweep: every live raider card run, side by side. */
export async function sweepNpcCampaignCardRuns(): Promise<number> {
    if (Date.now() < idleUntil) return 0;
    const live = await liveNpcCampaignCardRuns();
    if (!Object.keys(live).length) { idleUntil = Date.now() + IDLE_RECHECK_MS; return 0; }
    const results = await Promise.all(Object.entries(live)
        .filter(([runId]) => !driving.has(runId))
        .map(([runId, entry]) => driveNpcCampaignCardRun(runId, entry)));
    return results.filter((result) => result === 'finished').length;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Starts the once-a-second sweep (idempotent). DISABLE_NPC_VILLAGE=1 keeps it off. */
export function startNpcCampaignCardSeat(): void {
    if (timer || process.env.DISABLE_NPC_VILLAGE === '1') return;
    timer = setInterval(() => { void sweepNpcCampaignCardRuns().catch(() => undefined); }, 1000);
    timer.unref?.();
}
export function stopNpcCampaignCardSeat(): void { if (timer) clearInterval(timer); timer = null; }
