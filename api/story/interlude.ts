import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { STORY_INTERLUDE_DEFS } from '../_story-interludes.js';
import { storyKeyFor, emptyStoryRecord, bumpLanes, type StoryRecord } from '../_story-record.js';

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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `story-interlude-${action}`, 20, 60_000, identity.name))) return;

        const storyKey = storyKeyFor(playerName);

        if (action === 'state') {
            const record = await kv.get<StoryRecord>(storyKey);
            return res.status(200).json({ ok: true, record: record ?? null });
        }

        if (action === 'complete') {
            const interludeId = typeof body.interludeId === 'string' ? body.interludeId : '';
            const trait = typeof body.trait === 'string' ? body.trait : '';
            const def = STORY_INTERLUDE_DEFS[interludeId];
            if (!def) return res.status(400).json({ error: 'Unknown interlude.' });
            const lane = def.traits[trait];
            if (!lane) return res.status(400).json({ error: 'Unknown choice for this interlude.' });

            const out = await withKvLock<{ status: number; body: unknown }>(storyKey, async () => {
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                const village = String(char.storyVillage || char.village || '');
                if (village !== def.village) return { status: 200, body: { ok: false, reason: 'village' } };
                if ((num(char.level) || 1) < def.levelReq) return { status: 200, body: { ok: false, reason: 'level' } };
                if (num(char.storyProgress) < def.minProgress) return { status: 200, body: { ok: false, reason: 'progress' } };

                const record = (await kv.get<StoryRecord>(storyKey)) ?? emptyStoryRecord(village);
                if (record.interludes?.[interludeId]) return { status: 200, body: { ok: false, reason: 'done' } };
                const lanes = bumpLanes(record.lanes, lane);
                // Spread the record so road-event entries survive this write.
                const updated: StoryRecord = {
                    ...record,
                    village,
                    interludes: { ...(record.interludes ?? {}), [interludeId]: { trait, lane, at: Date.now() } },
                    lanes,
                };
                // No TTL — the story record is permanent character history.
                await kv.set(storyKey, updated);
                return { status: 200, body: { ok: true, lane, lanes } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not record the choice — please retry.' });
        }
        console.error('[story/interlude]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
