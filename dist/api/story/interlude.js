"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _story_interludes_js_1 = require("../_story-interludes.js");
/*
 * /api/story/interlude — POST { action, playerName, interludeId?, trait? }
 *
 * Server-authoritative story record for the VN-only interludes (the rebuild
 * foundation — docs/fable-5-story-rebuild.md §10). Interludes pay NO XP/ryo/
 * items, so there is nothing to seal or mint here; what the server owns is
 * WHICH choice was made and the running good/neutral/bad lane tallies that
 * later gate path titles, finale dialogue, and path Legacies. The client's
 * `storyTraits` array stays a display mirror the server never trusts.
 *
 *   complete { interludeId, trait } → { ok, lane, lanes } | { ok:false, reason }
 *   state                           → { ok, record|null }
 *
 * Eligibility is recomputed from the real save: level >= levelReq,
 * storyProgress >= minProgress (milestones beaten), and the character's story
 * village must own the interlude. Each interlude records exactly once.
 */
const storyKeyFor = (player) => `story:${player}`;
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
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `story-interlude-${action}`, 20, 60_000, identity.name)))
            return;
        const storyKey = storyKeyFor(playerName);
        if (action === 'state') {
            const record = await _storage_js_1.kv.get(storyKey);
            return res.status(200).json({ ok: true, record: record ?? null });
        }
        if (action === 'complete') {
            const interludeId = typeof body.interludeId === 'string' ? body.interludeId : '';
            const trait = typeof body.trait === 'string' ? body.trait : '';
            const def = _story_interludes_js_1.STORY_INTERLUDE_DEFS[interludeId];
            if (!def)
                return res.status(400).json({ error: 'Unknown interlude.' });
            const lane = def.traits[trait];
            if (!lane)
                return res.status(400).json({ error: 'Unknown choice for this interlude.' });
            const out = await (0, _lock_js_1.withKvLock)(storyKey, async () => {
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const village = String(char.storyVillage || char.village || '');
                if (village !== def.village)
                    return { status: 200, body: { ok: false, reason: 'village' } };
                if ((num(char.level) || 1) < def.levelReq)
                    return { status: 200, body: { ok: false, reason: 'level' } };
                if (num(char.storyProgress) < def.minProgress)
                    return { status: 200, body: { ok: false, reason: 'progress' } };
                const record = (await _storage_js_1.kv.get(storyKey)) ?? { village, interludes: {}, lanes: { good: 0, neutral: 0, bad: 0 } };
                if (record.interludes?.[interludeId])
                    return { status: 200, body: { ok: false, reason: 'done' } };
                const lanes = { good: num(record.lanes?.good), neutral: num(record.lanes?.neutral), bad: num(record.lanes?.bad) };
                lanes[lane] += 1;
                const updated = {
                    village,
                    interludes: { ...(record.interludes ?? {}), [interludeId]: { trait, lane, at: Date.now() } },
                    lanes,
                };
                // No TTL — the story record is permanent character history.
                await _storage_js_1.kv.set(storyKey, updated);
                return { status: 200, body: { ok: true, lane, lanes } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not record the choice — please retry.' });
        }
        console.error('[story/interlude]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
