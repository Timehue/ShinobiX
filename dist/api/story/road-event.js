"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _story_road_events_js_1 = require("../_story-road-events.js");
const _story_record_js_1 = require("../_story-record.js");
/*
 * /api/story/road-event — POST { action: 'complete', playerName, eventId, trait }
 *
 * Server record for the wandering story road events (rebuild §10). Road events
 * pay no XP/ryo/items — the server owns WHICH choice was made and the shared
 * good/neutral/bad lane tally in `story:<player>`. Village-agnostic (these are
 * cross-village road stories); gates are level and, for the post-finale event,
 * storyProgress. The choice is reported at CHOICE time (a battle that follows
 * resolves flavor, not the record), and each event records exactly once.
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'story-road-event', 20, 60_000, identity.name)))
            return;
        if (action !== 'complete')
            return res.status(400).json({ error: 'Unknown action.' });
        const eventId = typeof body.eventId === 'string' ? body.eventId : '';
        const trait = typeof body.trait === 'string' ? body.trait : '';
        const def = _story_road_events_js_1.STORY_ROAD_EVENT_DEFS[eventId];
        if (!def)
            return res.status(400).json({ error: 'Unknown road event.' });
        const lane = def.traits[trait];
        if (!lane)
            return res.status(400).json({ error: 'Unknown choice for this event.' });
        const storyKey = (0, _story_record_js_1.storyKeyFor)(playerName);
        const out = await (0, _lock_js_1.withKvLock)(storyKey, async () => {
            const rec = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (rec?.character ?? null);
            if (!rec || !char)
                return { status: 404, body: { error: 'Your save was not found.' } };
            if ((num(char.level) || 1) < def.levelReq)
                return { status: 200, body: { ok: false, reason: 'level' } };
            if (num(char.storyProgress) < def.minProgress)
                return { status: 200, body: { ok: false, reason: 'progress' } };
            const record = (await _storage_js_1.kv.get(storyKey))
                ?? (0, _story_record_js_1.emptyStoryRecord)(String(char.storyVillage || char.village || ''));
            if (record.roadEvents?.[eventId])
                return { status: 200, body: { ok: false, reason: 'done' } };
            const lanes = (0, _story_record_js_1.bumpLanes)(record.lanes, lane);
            const updated = {
                ...record,
                roadEvents: { ...(record.roadEvents ?? {}), [eventId]: { trait, lane, at: Date.now() } },
                lanes,
            };
            // No TTL — permanent character history.
            await _storage_js_1.kv.set(storyKey, updated);
            return { status: 200, body: { ok: true, lane, lanes } };
        }, { failClosed: true });
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not record the choice — please retry.' });
        }
        console.error('[story/road-event]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
