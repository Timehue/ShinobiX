"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
// GET /api/pvp/stream?id=<battleId>
//
// Server-Sent Events stream of the PvP session record. Replaces the
// 1-second polling loop on the PvP battle screen — the server holds
// the connection open, polls KV at 250ms internally, and pushes a
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
const STREAM_DURATION_MS = 13 * 60 * 1000; // 13 minutes
const POLL_INTERVAL_MS = 100;
const HEARTBEAT_INTERVAL_MS = 15_000;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    // Each streaming connection counts as one expensive invocation, so
    // rate-limit aggressively per IP. A single battler + a few
    // spectators is the legitimate ceiling per battle per IP; 30/min
    // covers reconnects under flaky networks.
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pvp-stream', 30, 60_000)))
        return;
    const battleId = String(req.query.id ?? '');
    if (!battleId)
        return res.status(400).json({ error: 'Missing id' });
    const key = `pvp:${battleId}`;
    // Initial session fetch — bail with 404 if the battle doesn't exist
    // BEFORE upgrading to a stream. Saves an SSE connection on bad IDs.
    const initial = await _storage_js_1.kv.get(key);
    if (!initial)
        return res.status(404).json({ error: 'Session not found' });
    // Upgrade to SSE.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Disable Vercel's automatic response buffering for this stream.
    res.setHeader('X-Accel-Buffering', 'no');
    // flushHeaders sends the response head immediately so the client's
    // EventSource transitions to OPEN state without waiting for the
    // first data chunk.
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }
    let lastJson = JSON.stringify(initial);
    let lastSentAt = 0;
    let aborted = false;
    function sendEvent(event, payload) {
        try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
            lastSentAt = Date.now();
        }
        catch {
            aborted = true;
        }
    }
    // Push the initial state immediately so clients have something to
    // render on connect.
    sendEvent('session', initial);
    // Tear down on client disconnect. req.on('close') fires when the
    // client goes away (tab close, navigation, network drop).
    req.on('close', () => { aborted = true; });
    const startedAt = Date.now();
    try {
        while (!aborted && (Date.now() - startedAt) < STREAM_DURATION_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            if (aborted)
                break;
            const session = await _storage_js_1.kv.get(key);
            if (!session) {
                sendEvent('end', { reason: 'session-expired' });
                break;
            }
            const json = JSON.stringify(session);
            if (json !== lastJson) {
                sendEvent('session', session);
                lastJson = json;
            }
            // Periodic heartbeat keeps intermediaries from closing the
            // connection on idle. Most fights have natural traffic, but
            // a long staring contest needs a keepalive.
            if (Date.now() - lastSentAt > HEARTBEAT_INTERVAL_MS) {
                try {
                    res.write(`: ping\n\n`);
                    lastSentAt = Date.now();
                }
                catch {
                    aborted = true;
                }
            }
            // Wind down the stream once the fight resolves — client
            // will fall back to the (now-done) session and stop
            // listening.
            if (session.status === 'done') {
                sendEvent('end', { reason: 'session-done' });
                break;
            }
        }
    }
    catch (err) {
        console.error('[pvp/stream]', err);
    }
    finally {
        try {
            res.end();
        }
        catch { /* already closed */ }
    }
}
