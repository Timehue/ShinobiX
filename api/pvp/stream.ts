import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { pvpSessionHasRankedCloseFence, type PvpSession } from './session.js';
import {
    parsePlayerRankedSessionCloseTombstone,
    parsePlayerRankedSessionOrphanTombstone,
} from '../pet/_ranked-preparation.js';
import { pvpSessionPublicationTombstoneFor } from './_session-publication-tombstone.js';
import { enforcePvpTurnDeadline, pvpTurnNextCheckAt } from './_turn-deadline.js';
import { onKeyWritten } from '../_kv-write-signal.js';

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
// Why this is cheaper on Vercel compute:
//   • One streaming function = one invocation that lives ~5 min.
//   • One polling client = 300 invocations over 5 min.
//
// Lifecycle:
//   • Stream lasts up to STREAM_DURATION_MS (4.5 min) — safely under
//     the 300s Vercel Function timeout. Client reconnects automatically
//     via EventSource's built-in reconnect logic when the stream ends.
//   • Closes early when session.status === 'done' so the client knows
//     to stop and tear down.
//   • Closes early if the underlying KV key disappears (TTL expired).
//
// Auth: GET is unauthenticated (matches /api/pvp/session GET) so
// EventSource works without custom headers. Session state is
// shareable — both fighters + any spectator can read it.

// Vercel Pro lets streaming functions live up to 900s. Bumped from
// 4.5min → 13min so most fights finish in a single stream with no
// mid-fight reconnect. Server-side poll interval dropped from 250ms
// → 100ms — Supabase Pro has unlimited API requests so the extra
// reads are free, and the latency improvement is the difference
// between "responsive" and "instant" from the player's perspective
// (sub-100ms means human reaction time can't tell the move was
// server-mediated).
const STREAM_DURATION_MS = 13 * 60 * 1000;  // 13 minutes
const HEARTBEAT_INTERVAL_MS = 15_000;
// The stream no longer re-reads its session every 100 ms (about 20 database
// reads a second for a quiet 1v1). It sleeps until the session key is written
// in this process (api/_kv-write-signal.ts — every writer, since the storage
// backend signals), until the turn clock is due, or until SAFETY_POLL_MS for
// writes it cannot hear (another process during a deploy overlap). It never
// wakes more often than the old MIN_WAKE_MS cadence, even for an overdue turn.
const SAFETY_POLL_MS = 1_000;
const MIN_WAKE_MS = 100;
// Wake a hair after the lapse so the deadline check sees it as due.
const DEADLINE_WAKE_SLACK_MS = 5;

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

    // Each streaming connection counts as one expensive invocation, so
    // rate-limit aggressively per IP. A single battler + a few
    // spectators is the legitimate ceiling per battle per IP; 30/min
    // covers reconnects under flaky networks.
    if (!(await enforceRateLimitKv(req, res, 'pvp-stream', 30, 60_000))) return;

    const battleId = String(req.query.id ?? '');
    if (!battleId) return res.status(400).json({ error: 'Missing id' });
    const key = `pvp:${battleId}`;

    // Initial session fetch — bail with 404 if the battle doesn't exist
    // BEFORE upgrading to a stream. Saves an SSE connection on bad IDs.
    const initialRaw = await kv.get<unknown>(key);
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
    // Disable Vercel's automatic response buffering for this stream.
    res.setHeader('X-Accel-Buffering', 'no');
    // flushHeaders sends the response head immediately so the client's
    // EventSource transitions to OPEN state without waiting for the
    // first data chunk.
    if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
        (res as unknown as { flushHeaders: () => void }).flushHeaders();
    }

    let lastJson = JSON.stringify(initial);
    let lastSentAt = 0;
    let aborted = false;

    function sendEvent(event: string, payload: unknown) {
        try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
            lastSentAt = Date.now();
        } catch {
            aborted = true;
        }
    }

    // Push the initial state immediately so clients have something to
    // render on connect.
    sendEvent('session', initial);

    // Sleep until the session is written, the turn clock is due, or the safety
    // poll — whichever comes first. A write during the read below re-arms `dirty`
    // so it is never lost between wakes.
    let wake: (() => void) | null = null;
    let dirty = false;
    const stopListening = onKeyWritten(key, () => {
        dirty = true;
        wake?.();
    });
    const sleep = (ms: number) => new Promise<void>((resolve) => {
        if (dirty || aborted) { resolve(); return; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => { clearTimeout(timer); wake = null; resolve(); };
        timer = setTimeout(done, ms);
        wake = done;
    });

    // Tear down on client disconnect. req.on('close') fires when the
    // client goes away (tab close, navigation, network drop).
    req.on('close', () => { aborted = true; wake?.(); });

    const startedAt = Date.now();
    let current: PvpSession = initial;
    try {
        while (!aborted && (Date.now() - startedAt) < STREAM_DURATION_MS) {
            await sleep(streamWakeDelayMs(current));
            dirty = false;
            if (aborted) break;
            const rawSession = await kv.get<unknown>(key);
            if (!rawSession || pvpSessionPublicationTombstoneFor(rawSession, battleId)) {
                sendEvent('end', { reason: 'session-expired' });
                break;
            }
            if (isRankedSessionTerminalControl(rawSession, battleId)) {
                sendEvent('end', { reason: 'ranked-no-contest' });
                break;
            }
            let session = parseLiveSession(rawSession, battleId);
            if (!session) {
                sendEvent('end', { reason: 'session-invalid' });
                break;
            }
            // Server-authoritative turn expiry on the SSE tick, so a match whose
            // only live connection is this stream still advances a lapsed turn.
            // Cheap pre-check inside; takes the move lock only when due.
            if (session.status === 'active') {
                try {
                    session = (await enforcePvpTurnDeadline(kv, battleId, session)).session;
                } catch (error) {
                    console.error('[pvp/stream] turn deadline enforcement failed', error);
                }
            }
            current = session;
            const json = JSON.stringify(session);
            if (json !== lastJson) {
                sendEvent('session', session);
                lastJson = json;
            }
            // Periodic heartbeat keeps intermediaries from closing the
            // connection on idle. Most fights have natural traffic, but
            // a long staring contest needs a keepalive.
            if (Date.now() - lastSentAt > HEARTBEAT_INTERVAL_MS) {
                try { res.write(`: ping\n\n`); lastSentAt = Date.now(); } catch { aborted = true; }
            }
            // Wind down the stream once the fight resolves — client
            // will fall back to the (now-done) session and stop
            // listening.
            if (session.status === 'done') {
                sendEvent('end', { reason: 'session-done' });
                break;
            }
        }
    } catch (err) {
        console.error('[pvp/stream]', err);
    } finally {
        stopListening();
        try { res.end(); } catch { /* already closed */ }
    }
}
