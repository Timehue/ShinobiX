import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { STORY_ROAD_EVENT_DEFS } from '../_story-road-events.js';
import { storyKeyFor, emptyStoryRecord, bumpLanes, type StoryRecord } from '../_story-record.js';

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

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'story-road-event', 20, 60_000, identity.name))) return;

        if (action !== 'complete') return res.status(400).json({ error: 'Unknown action.' });

        const eventId = typeof body.eventId === 'string' ? body.eventId : '';
        const trait = typeof body.trait === 'string' ? body.trait : '';
        const def = STORY_ROAD_EVENT_DEFS[eventId];
        if (!def) return res.status(400).json({ error: 'Unknown road event.' });
        const lane = def.traits[trait];
        if (!lane) return res.status(400).json({ error: 'Unknown choice for this event.' });

        const storyKey = storyKeyFor(playerName);
        const out = await withKvLock<{ status: number; body: unknown }>(storyKey, async () => {
            const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (rec?.character ?? null) as Record<string, unknown> | null;
            if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
            if ((num(char.level) || 1) < def.levelReq) return { status: 200, body: { ok: false, reason: 'level' } };
            if (num(char.storyProgress) < def.minProgress) return { status: 200, body: { ok: false, reason: 'progress' } };

            const record = (await kv.get<StoryRecord>(storyKey))
                ?? emptyStoryRecord(String(char.storyVillage || char.village || ''));
            if (record.roadEvents?.[eventId]) return { status: 200, body: { ok: false, reason: 'done' } };
            const lanes = bumpLanes(record.lanes, lane);
            const updated: StoryRecord = {
                ...record,
                roadEvents: { ...(record.roadEvents ?? {}), [eventId]: { trait, lane, at: Date.now() } },
                lanes,
            };
            // No TTL — permanent character history.
            await kv.set(storyKey, updated);
            return { status: 200, body: { ok: true, lane, lanes } };
        }, { failClosed: true });

        return res.status(out.status).json(out.body);
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not record the choice — please retry.' });
        }
        console.error('[story/road-event]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
