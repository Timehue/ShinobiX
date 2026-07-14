import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    STORY_RECKONINGS,
    STORY_RECKONING_DAILY_CAP,
    storyReckoningEligible,
    storyReckoningTaskComplete,
    storyReckoningRyo,
    ownedItemCount,
    type StoryReckoningDef,
} from './_story-reckoning.js';

const TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
const tokenKeyFor = (player: string) => `story-reckoning:${player}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);
const strArray = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

type Sealed = { id: string; stage: 'task' | 'return'; baseline: number; at?: number };

function mirrorFor(def: StoryReckoningDef, stage: 'task' | 'return', baseline: number) {
    return { id: def.id, stage, metric: def.metric, baseline, target: def.target, dropItemId: def.dropItemId };
}

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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `story-reckoning-${action}`, 30, 60_000, identity.name))) return;

        const saveKey = `save:${playerName}`;
        const tokenKey = tokenKeyFor(playerName);
        const def = action === 'abandon' ? null : STORY_RECKONINGS[String(body.questId ?? '')];
        if (action !== 'abandon' && !def) return res.status(400).json({ error: 'Unknown reckoning.' });

        if (action === 'accept' && def) {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                if (!storyReckoningEligible(char, def)) return { status: 200, body: { ok: false, reason: 'ineligible' } };
                if (char.activeQuestbook || char.activeRiftQuest || char.activeStoryReckoning) return { status: 200, body: { ok: false, reason: 'busy' } };
                if (await kv.get(tokenKey)) return { status: 200, body: { ok: false, reason: 'busy' } };

                const baseline = num(char[def.metric]);
                const sealed: Sealed = { id: def.id, stage: 'task', baseline, at: Date.now() };
                await kv.set(tokenKey, sealed, { ex: TOKEN_TTL_SECONDS });
                const activeStoryReckoning = mirrorFor(def, 'task', baseline);
                const updated = { ...char, activeStoryReckoning };
                await kv.set(saveKey, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true, activeStoryReckoning } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        if (action === 'report' && def) {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const sealed = await kv.get<Sealed>(tokenKey);
                if (!sealed || sealed.id !== def.id) return { status: 200, body: { ok: false, reason: 'none' } };
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

                if (sealed.stage === 'return') {
                    return { status: 200, body: { ok: true, dropItemId: def.dropItemId, activeStoryReckoning: mirrorFor(def, 'return', num(sealed.baseline)) } };
                }
                const current = num(char[def.metric]);
                if (!storyReckoningTaskComplete(sealed.baseline, current, def.target)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', progress: Math.max(0, current - sealed.baseline), target: def.target } };
                }
                const inventory = Array.isArray(char.inventory) ? [...(char.inventory as unknown[])] : [];
                if (ownedItemCount(char, def.dropItemId) < 1) inventory.push(def.dropItemId);

                await kv.set(tokenKey, { ...sealed, stage: 'return' }, { ex: TOKEN_TTL_SECONDS });
                const activeStoryReckoning = mirrorFor(def, 'return', sealed.baseline);
                const updated = { ...char, inventory, activeStoryReckoning };
                await kv.set(saveKey, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true, dropItemId: def.dropItemId, activeStoryReckoning } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        if (action === 'turn-in' && def) {
            const today = utcDateKey();
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const sealed = await kv.get<Sealed>(tokenKey);
                if (!sealed || sealed.id !== def.id) return { status: 200, body: { ok: false, reason: 'none' } };
                if (sealed.stage !== 'return') return { status: 200, body: { ok: false, reason: 'incomplete' } };
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                if (ownedItemCount(char, def.dropItemId) < 1) return { status: 200, body: { ok: false, reason: 'no-item' } };

                const countKey = `story-reckoning-count:${playerName}:${today}`;
                if (num(await kv.get<number>(countKey)) >= STORY_RECKONING_DAILY_CAP) {
                    return { status: 200, body: { ok: false, reason: 'daily-cap' } };
                }
                const consumed = await kv.del(tokenKey);
                if (consumed <= 0) return { status: 200, body: { ok: false, reason: 'none' } };
                await kv.incr(countKey, { ex: 25 * 60 * 60 });

                const ryo = storyReckoningRyo(char.level, def.weight);
                const totalRyo = num(char.ryo) + ryo;
                const totalFateShards = num(char.fateShards) + def.fateShards;
                const questTitles = strArray(char.questTitles);
                if (!questTitles.includes(def.title)) questTitles.push(def.title);
                const storyTraits = strArray(char.storyTraits);
                if (!storyTraits.includes(def.completionTrait)) storyTraits.push(def.completionTrait);
                const updated = { ...char, ryo: totalRyo, fateShards: totalFateShards, questTitles, storyTraits, activeStoryReckoning: null };
                await kv.set(saveKey, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true, ryo, totalRyo, fateShards: def.fateShards, totalFateShards, title: def.title, questTitles, completionTrait: def.completionTrait } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        if (action === 'abandon') {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                await kv.del(tokenKey).catch(() => undefined);
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (rec && char) {
                    const updated = { ...char, activeStoryReckoning: null };
                    await kv.set(saveKey, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
                }
                return { status: 200, body: { ok: true } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not update the reckoning. Please retry.' });
        }
        console.error('[sector/story-reckoning]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
