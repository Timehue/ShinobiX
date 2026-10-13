import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { enforceRateLimitKv, PUBLIC_READ_IP_BACKSTOP, requestPlayerKey } from '../_ratelimit.js';
import { pvpSessionHasRankedCloseFence, type PvpSession } from './session.js';
import {
    parsePlayerRankedSessionCloseTombstone,
    parsePlayerRankedSessionOrphanTombstone,
} from '../pet/_ranked-preparation.js';
import { pvpSessionPublicationTombstoneFor } from './_session-publication-tombstone.js';
import { enforcePvpTurnDeadline, pvpTurnDeadlineNeedsWork, pvpTurnNextCheckAt } from './_turn-deadline.js';
import { onKeyWritten } from '../_kv-write-signal.js';
import { registerStreamHandoff, streamsDraining } from './_stream-handoff.js';
import {
    forgetSharedStreamRead,
    readSharedStreamSession,
    releaseSharedStreamRead,
    retainSharedStreamRead,
} from './_stream-shared-read.js';

// GET /api/pvp/stream?id=<battleId>
//
// Server-Sent Events stream of the PvP session record. Replaces the
// 1-second polling loop on the PvP battle screen — the server holds
// the connection open, wakes whenever the session record is written
// (see SAFETY_POLL_MS below), and pushes a
// `data: { session }\n\n` chunk whenever the record changes. Both
// fighters and spectators consume this instead of fetching session
// state once per second.
//
// Why this is dramatically faster:
//   • Polling: opponent move appears 0-1000ms after server commit
//     (avg 500ms wait for next poll tick).
//   • SSE:     opponent move appears within 250ms (the server-side
//     poll cadence), with no client wakeup overhead.
//
// Lifecycle (the battle screen's only live transport):
//   • Stream lasts up to STREAM_DURATION_MS (13 min), then sends
//     `event: reconnect` (reason 'renew') and ends; the client reopens at
//     once, without showing "Reconnecting...".
//   • A deploy does the same with reason 'server-restart' the moment
//     shutdown starts (_stream-handoff.ts), and a draining server refuses
//     new streams with a fast 503 so they land on its replacement.
//   • Sends `event: end` and closes when session.status === 'done' so the
//     client knows to stop and tear down, or when the battle is gone.
//
// Auth: GET is unauthenticated (matches /api/pvp/session GET) so
// EventSource works without custom headers. Session state is
// shareable — both fighters + any spectator can read it.

// 13 minutes, so most fights finish in a single stream with no mid-fight
// reconnect. Originally sized to Vercel's 900s streaming limit; Railway has
// no such limit, and the value is simply kept.
const STREAM_DURATION_MS = 13 * 60 * 1000;  // 13 minutes
const HEARTBEAT_INTERVAL_MS = 15_000;
// The stream no longer re-reads its session every 100 ms (about 20 database
// reads a second for a quiet 1v1). It sleeps until the session key is written
// in this process (api/_kv-write-signal.ts), until the turn clock is due, or
// until SAFETY_POLL_MS. The Postgres and in-memory backends signal every write;
// the safety poll covers the writes the stream cannot hear: another process
// (a deploy overlap), unguarded REST and dormant overlay writes, and a
// compare-and-set whose commit acknowledgement was lost. The turn clock never
// wakes it more often than the old MIN_WAKE_MS cadence, even for an overdue
// turn; a write wakes it at once, and each wake costs at most one read.
const SAFETY_POLL_MS = 1_000;
const MIN_WAKE_MS = 100;
// Wake a hair after the lapse so the deadline check sees it as due.
const DEADLINE_WAKE_SLACK_MS = 5;

/** A run of failed session reads this long ends the stream (the client then backs off). */
const MAX_CONSECUTIVE_READ_FAILURES = 5;

/**
 * One turn-deadline enforcement per battle at a time in this process. Every
 * open stream of a battle (both fighters and every spectator) wakes when a turn
 * lapses; without this, each would race for the move lock with its own write,
 * and the losers would retry every 100 ms until the winner committed. The
 * enforcer re-reads the session under the lock, so sharing its result is safe.
 */
const deadlineInFlight = new Map<string, ReturnType<typeof enforcePvpTurnDeadline>>();
function enforceTurnDeadlineOnce(battleId: string, session: PvpSession): ReturnType<typeof enforcePvpTurnDeadline> {
    // Nothing due: answer from this viewer's own session, never another's.
    if (!pvpTurnDeadlineNeedsWork(session)) return Promise.resolve({ session, applied: 'none' });
    const pending = deadlineInFlight.get(battleId);
    if (pending) return pending;
    const run = enforcePvpTurnDeadline(kv, battleId, session).then((result) => {
        // The turn moved: no viewer may keep reading the lapsed session from
        // the shared read, even if this write path raised no in-process
        // signal, or each would race for the lock again.
        if (result.applied !== 'none') forgetSharedStreamRead(`pvp:${battleId}`);
        return result;
    }).finally(() => {
        if (deadlineInFlight.get(battleId) === run) deadlineInFlight.delete(battleId);
    });
    deadlineInFlight.set(battleId, run);
    return run;
}

/** How long the stream may sleep before its next read of `session`. */
export function streamWakeDelayMs(session: PvpSession, now = Date.now()): number {
    const checkAt = pvpTurnNextCheckAt(session, now);
    if (checkAt === null) return SAFETY_POLL_MS;
    return Math.min(SAFETY_POLL_MS, Math.max(MIN_WAKE_MS, checkAt - now + DEADLINE_WAKE_SLACK_MS));
}

function parseLiveSession(value: unknown, battleId: string): PvpSession | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Partial<PvpSession>;
    if (candidate.battleId !== battleId
        || (candidate.status !== 'active' && candidate.status !== 'done')
        || !candidate.p1
        || !candidate.p2) return null;
    return candidate as PvpSession;
}

function isRankedSessionTerminalControl(value: unknown, battleId: string): boolean {
    return parsePlayerRankedSessionCloseTombstone(value)?.battleId === battleId
        || parsePlayerRankedSessionOrphanTombstone(value)?.battleId === battleId
        || (pvpSessionHasRankedCloseFence(value) && value.battleId === battleId);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // This process is handing its streams to its replacement (a deploy): send
    // the viewer straight back so the retry lands on the new server. Checked
    // before the rate limit, so it costs the viewer nothing from their budget.
    if (streamsDraining()) {
        res.setHeader('Retry-After', '1');
        return res.status(503).json({ error: 'Server restarting; reconnect.' });
    }

    // Each streaming connection counts as one expensive invocation; 30/min
    // covers reconnects under flaky networks. EventSource cannot send the
    // x-player-name header, so the client names itself in `viewer`, and the
    // budget is keyed per player AT this address (requestPlayerKey): players
    // behind one connection no longer share it, and nobody elsewhere can spend
    // it. Streams are long-lived, so name rotation from one address is held to
    // PUBLIC_READ_IP_BACKSTOP x 30/min, not the general 20x backstop.
    if (!(await enforceRateLimitKv(req, res, 'pvp-stream', 30, 60_000, requestPlayerKey(req, req.query.viewer),
        { ipBackstopMultiplier: PUBLIC_READ_IP_BACKSTOP }))) return;

    const battleId = String(req.query.id ?? '');
    if (!battleId) return res.status(400).json({ error: 'Missing id' });
    const key = `pvp:${battleId}`;

    // Listen BEFORE the initial read. A move that commits between that read and
    // a later subscription would otherwise wait for the safety poll; heard
    // here, it marks the stream dirty and the first wake re-reads at once.
    const signals = createStreamSignals();
    // Every viewer of this battle shares one read (_stream-shared-read.ts); a
    // heard write discards it before waking anyone.
    retainSharedStreamRead(key);
    const stopListening = onKeyWritten(key, () => { forgetSharedStreamRead(key); signals.markDirty(); });
    // A deploy asks every open stream to move to the new server (_stream-handoff.ts).
    const stopHandoff = registerStreamHandoff(signals.handOff);
    try {
        await streamSession(req, res, battleId, key, signals);
    } finally {
        stopHandoff();
        stopListening();
        releaseSharedStreamRead(key);
    }
}

type StreamSignals = ReturnType<typeof createStreamSignals>;

/** Shared by the write listener, the client-close handler and the loop. */
function createStreamSignals() {
    let wake: (() => void) | null = null;
    let dirty = false;
    let aborted = false;
    let handedOff = false;
    return {
        markDirty: () => { dirty = true; wake?.(); },
        isDirty: () => dirty,
        clearDirty: () => { dirty = false; },
        isAborted: () => aborted,
        abort: () => { aborted = true; wake?.(); },
        /** Stop streaming because this server is handing off; the viewer is told to reconnect. */
        handOff: () => { handedOff = true; aborted = true; wake?.(); },
        isHandedOff: () => handedOff,
        setWake: (next: (() => void) | null) => { wake = next; },
    };
}

async function streamSession(req: VercelRequest, res: VercelResponse, battleId: string, key: string, signals: StreamSignals) {
    // Initial session fetch — bail with 404 if the battle doesn't exist
    // BEFORE upgrading to a stream. Saves an SSE connection on bad IDs.
    const initialRaw = await readSharedStreamSession(key);
    // A rolled-back publication is an absent battle, not a malformed one — a
    // 502 here would read to the client as a server fault worth retrying.
    if (!initialRaw || pvpSessionPublicationTombstoneFor(initialRaw, battleId)) {
        return res.status(404).json({ error: 'Session not found' });
    }
    if (isRankedSessionTerminalControl(initialRaw, battleId)) {
        return res.status(409).json({ error: 'This ranked match ended as a no-contest.' });
    }
    const initial = parseLiveSession(initialRaw, battleId);
    if (!initial) return res.status(502).json({ error: 'Invalid battle session projection' });

    // Upgrade to SSE.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Ask any buffering reverse proxy (nginx-style) to pass this stream through.
    res.setHeader('X-Accel-Buffering', 'no');
    // flushHeaders sends the response head immediately so the client's
    // EventSource transitions to OPEN state without waiting for the
    // first data chunk.
    if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
        (res as unknown as { flushHeaders: () => void }).flushHeaders();
    }

    let lastJson = JSON.stringify(initial);
    let lastSentAt = 0;

    // Writes an already-serialized payload. The session is serialized once to
    // detect a change, and that same string is what gets sent.
    function sendEventJson(event: string, json: string) {
        try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${json}\n\n`);
            lastSentAt = Date.now();
        } catch {
            signals.abort();
        }
    }
    function sendEvent(event: string, payload: unknown) {
        sendEventJson(event, JSON.stringify(payload));
    }

    // Push the initial state immediately so clients have something to
    // render on connect.
    sendEventJson('session', lastJson);

    // Sleep until the session is written, the turn clock is due, or the safety
    // poll — whichever comes first. A write during the read below marks the
    // stream dirty, so it is never lost between wakes.
    const sleep = (ms: number) => new Promise<void>((resolve) => {
        if (signals.isDirty() || signals.isAborted()) { resolve(); return; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => { clearTimeout(timer); signals.setWake(null); resolve(); };
        timer = setTimeout(done, ms);
        signals.setWake(done);
    });

    // Tear down on client disconnect. req.on('close') fires when the
    // client goes away (tab close, navigation, network drop).
    req.on('close', signals.abort);

    const startedAt = Date.now();
    let current: PvpSession = initial;
    let readFailures = 0;
    // Set once the battle itself is over for this viewer (an `end` event).
    let ended = false;
    const endStream = (reason: string) => { ended = true; sendEvent('end', { reason }); };
    try {
        // A finished fight has nothing left to stream. Checked before the first
        // sleep, which would otherwise hold this answer for the safety poll.
        if (initial.status === 'done') {
            endStream('session-done');
            return;
        }
        while (!signals.isAborted() && (Date.now() - startedAt) < STREAM_DURATION_MS) {
            // After a failed read, wait the full safety poll (spread, so a
            // battle's viewers don't retry in step) rather than the 100 ms turn
            // cadence: a struggling database gets breathing room.
            await sleep(readFailures > 0
                ? SAFETY_POLL_MS + Math.floor(Math.random() * 250)
                : streamWakeDelayMs(current));
            signals.clearDirty();
            if (signals.isAborted()) break;
            // A failed read is a missed tick, not the end of the stream: one
            // statement timeout must not drop every viewer of the battle at
            // once (they share the read) and send them all into a reconnect
            // loop. Only a run of failures ends the stream, through the
            // error path, so the client backs off.
            let rawSession: unknown;
            try {
                rawSession = await readSharedStreamSession(key);
                readFailures = 0;
            } catch (error) {
                readFailures += 1;
                if (readFailures >= MAX_CONSECUTIVE_READ_FAILURES) throw error;
                console.warn('[pvp/stream] session read failed; retrying on the next tick', (error as Error)?.message ?? error);
                // The connection itself is fine; keep the client's watch fed.
                if (Date.now() - lastSentAt > HEARTBEAT_INTERVAL_MS) sendEvent('ping', { at: Date.now() });
                continue;
            }
            if (!rawSession || pvpSessionPublicationTombstoneFor(rawSession, battleId)) {
                endStream('session-expired');
                break;
            }
            if (isRankedSessionTerminalControl(rawSession, battleId)) {
                endStream('ranked-no-contest');
                break;
            }
            let session = parseLiveSession(rawSession, battleId);
            if (!session) {
                endStream('session-invalid');
                break;
            }
            // Server-authoritative turn expiry on the SSE tick, so a match whose
            // only live connection is this stream still advances a lapsed turn.
            // Cheap pre-check inside; takes the move lock only when due.
            if (session.status === 'active') {
                try {
                    session = (await enforceTurnDeadlineOnce(battleId, session)).session;
                } catch (error) {
                    console.error('[pvp/stream] turn deadline enforcement failed', error);
                }
            }
            current = session;
            const json = JSON.stringify(session);
            if (json !== lastJson) {
                sendEventJson('session', json);
                lastJson = json;
            }
            // Periodic heartbeat. It keeps intermediaries from closing an idle
            // connection, and it is a real `ping` EVENT (not an SSE comment,
            // which EventSource never surfaces) so the client can tell a quiet
            // fight from a silently dead connection and reopen the latter.
            if (Date.now() - lastSentAt > HEARTBEAT_INTERVAL_MS) {
                sendEvent('ping', { at: Date.now() });
            }
            // Wind down the stream once the fight resolves — client
            // will fall back to the (now-done) session and stop
            // listening.
            if (session.status === 'done') {
                endStream('session-done');
                break;
            }
        }
        // The battle goes on but this stream stops on purpose: the 13-minute
        // renewal, or a deploy handing the battle to the new server. Say so, so
        // the client reopens at once instead of reading the cut as an error and
        // showing "Reconnecting...". A viewer who left (client close) or a
        // failed write gets nothing more.
        if (!ended && (signals.isHandedOff() || !signals.isAborted())) {
            sendEvent('reconnect', { reason: signals.isHandedOff() ? 'server-restart' : 'renew' });
        }
    } catch (err) {
        console.error('[pvp/stream]', err);
    } finally {
        try { res.end(); } catch { /* already closed */ }
    }
}
