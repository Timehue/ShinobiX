import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { WANDERER_QUESTS, isWandererQuestId, wandererQuestRyo, wandererQuestComplete } from './_wanderer-quest.js';

/*
 * /api/sector/wanderer-quest — POST { action: 'accept' | 'claim', playerName, questId? }
 *
 * Server-authoritative sector-wanderer quest. The baseline (foe-kills at accept)
 * and quest id are sealed in KV; the reward is recomputed from the catalog at
 * claim. The character.activeWandererQuest field is a DISPLAY mirror only — the
 * server never trusts it (see docs/auth-and-anti-cheat-patterns.md).
 *
 *   accept → { ok:true, id, target, baseline } | { ok:false, reason }
 *   claim  → { ok:true, ryo, totalRyo } | { ok:false, reason, progress?, target? }
 */

const QUEST_TTL_SECONDS = 7 * 24 * 60 * 60;
const questKeyFor = (player: string) => `wanderer-quest:${player}`;
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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `wanderer-quest-${action}`, 20, 60_000, identity.name))) return;

        const questKey = questKeyFor(playerName);

        // ── ACCEPT ───────────────────────────────────────────────────────────
        if (action === 'accept') {
            const questId = typeof body.questId === 'string' ? body.questId : '';
            if (!isWandererQuestId(questId)) return res.status(400).json({ error: 'Unknown quest.' });
            const def = WANDERER_QUESTS[questId];

            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const existing = await kv.get<{ id: string; baseline: number }>(questKey);
                if (existing) return { status: 200, body: { ok: false, reason: 'busy' } };

                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

                const baseline = num(char[def.metric]);
                await kv.set(questKey, { id: questId, baseline, at: Date.now() }, { ex: QUEST_TTL_SECONDS });
                // Display mirror on the save (server never trusts this back).
                const updated = { ...char, activeWandererQuest: { id: questId, target: def.target, baseline } };
                await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true, id: questId, target: def.target, baseline } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        // ── CLAIM ────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const sealed = await kv.get<{ id: string; baseline: number }>(questKey);
                if (!sealed || !isWandererQuestId(sealed.id)) {
                    await kv.del(questKey).catch(() => undefined);
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                const def = WANDERER_QUESTS[sealed.id];

                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

                const current = num(char[def.metric]);
                if (!wandererQuestComplete(num(sealed.baseline), current, def.target)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', progress: Math.max(0, current - num(sealed.baseline)), target: def.target } };
                }

                const consumed = await kv.del(questKey);
                if (consumed <= 0) return { status: 200, body: { ok: false, reason: 'none' } };

                const reward = wandererQuestRyo(num(char.level) || 1, def.weight);
                const totalRyo = num(char.ryo) + reward;
                const updated = { ...char, ryo: totalRyo, activeWandererQuest: null };
                await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true, ryo: reward, totalRyo } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not update the quest — please retry.' });
        }
        console.error('[sector/wanderer-quest]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
