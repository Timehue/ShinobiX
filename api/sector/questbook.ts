import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import {
    QUEST_BOOK,
    isQuestBookId,
    questBookEntry,
    finalStageIndex,
    questStageComplete,
    bandMatches,
    questBookRyo,
} from './_questbook.js';

/*
 * /api/sector/questbook — POST { action, playerName, questId? }
 *
 * Server-authoritative multi-stage "epic" quests (see _questbook.ts). The sealed
 * record { id, stage, baseline } lives in KV (one active epic per player); the
 * save's `activeQuestbook` is a DISPLAY mirror the server never trusts. Stage
 * advancement + the final reward are recomputed from the sealed catalog against the
 * real character counters.
 *
 *   accept  { questId } → { ok, id, stage, target } | { ok:false, reason }
 *   advance            → { ok, stage, target, advanced? , readyToClaim? } | { ok:false, reason, progress?, target? }
 *   claim              → { ok, ryo, totalRyo, fateShards, title } | { ok:false, reason }
 *   abandon            → { ok:true }
 */

const QUESTBOOK_TTL_SECONDS = 14 * 24 * 60 * 60; // an epic can sit unfinished for two weeks
const DONE_COOLDOWN_SECONDS = 3 * 24 * 60 * 60;  // re-roll cooldown after completing one
const questKeyFor = (player: string) => `questbook:${player}`;
const doneKeyFor = (player: string, questId: string) => `questbook:done:${player}:${questId}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

type Sealed = { id: string; stage: number; baseline: number; at?: number };

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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `questbook-${action}`, 20, 60_000, identity.name))) return;

        const questKey = questKeyFor(playerName);
        const saveKey = `save:${playerName}`;

        // ── ACCEPT ───────────────────────────────────────────────────────────
        if (action === 'accept') {
            const questId = typeof body.questId === 'string' ? body.questId : '';
            if (!isQuestBookId(questId)) return res.status(400).json({ error: 'Unknown quest.' });
            const entry = QUEST_BOOK[questId];

            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const existing = await kv.get<Sealed>(questKey);
                if (existing) return { status: 200, body: { ok: false, reason: 'busy' } };
                const cooling = await kv.get(doneKeyFor(playerName, questId));
                if (cooling) return { status: 200, body: { ok: false, reason: 'cooldown' } };

                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                if (!bandMatches(entry, num(char.level) || 1)) return { status: 200, body: { ok: false, reason: 'band' } };

                const s0 = entry.stages[0];
                const baseline = num(char[s0.metric]);
                await kv.set(questKey, { id: questId, stage: 0, baseline, at: Date.now() }, { ex: QUESTBOOK_TTL_SECONDS });
                const updated = { ...char, activeQuestbook: { id: questId, stage: 0, baseline, target: s0.count } };
                await kv.set(saveKey, mergePreservingImages({ ...rec, character: updated }, rec));
                return { status: 200, body: { ok: true, id: questId, stage: 0, target: s0.count } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        // ── ADVANCE ──────────────────────────────────────────────────────────
        if (action === 'advance') {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const sealed = await kv.get<Sealed>(questKey);
                if (!sealed || !isQuestBookId(sealed.id)) {
                    await kv.del(questKey).catch(() => undefined);
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                const entry = QUEST_BOOK[sealed.id];
                const finalIdx = finalStageIndex(entry);
                const stageIdx = Math.max(0, Math.min(finalIdx, Math.floor(num(sealed.stage))));
                const stage = entry.stages[stageIdx];

                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

                const current = num(char[stage.metric]);
                if (!questStageComplete(num(sealed.baseline), current, stage.count)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', stage: stageIdx, progress: Math.max(0, current - num(sealed.baseline)), target: stage.count } };
                }
                if (stageIdx >= finalIdx) {
                    return { status: 200, body: { ok: true, stage: stageIdx, readyToClaim: true } };
                }

                const nextIdx = stageIdx + 1;
                const nextStage = entry.stages[nextIdx];
                const newBaseline = num(char[nextStage.metric]);
                await kv.set(questKey, { id: sealed.id, stage: nextIdx, baseline: newBaseline, at: Date.now() }, { ex: QUESTBOOK_TTL_SECONDS });
                const updated = { ...char, activeQuestbook: { id: sealed.id, stage: nextIdx, baseline: newBaseline, target: nextStage.count } };
                await kv.set(saveKey, mergePreservingImages({ ...rec, character: updated }, rec));
                return { status: 200, body: { ok: true, advanced: true, stage: nextIdx, target: nextStage.count } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        // ── CLAIM ────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const sealed = await kv.get<Sealed>(questKey);
                if (!sealed || !isQuestBookId(sealed.id)) {
                    await kv.del(questKey).catch(() => undefined);
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                const entry = QUEST_BOOK[sealed.id];
                const finalIdx = finalStageIndex(entry);
                if (Math.floor(num(sealed.stage)) < finalIdx) {
                    return { status: 200, body: { ok: false, reason: 'not-final', stage: num(sealed.stage) } };
                }
                const stage = entry.stages[finalIdx];

                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

                const current = num(char[stage.metric]);
                if (!questStageComplete(num(sealed.baseline), current, stage.count)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', stage: finalIdx, progress: Math.max(0, current - num(sealed.baseline)), target: stage.count } };
                }

                const ryo = questBookRyo(num(char.level) || 1, entry.weight);
                const totalRyo = num(char.ryo) + ryo;
                const fateShards = num(char.fateShards) + entry.fateShards;
                const prevTitles = Array.isArray(char.questTitles) ? (char.questTitles as string[]).filter(t => typeof t === 'string') : [];
                const questTitles = prevTitles.includes(entry.award) ? prevTitles : [...prevTitles, entry.award];
                const updated = { ...char, ryo: totalRyo, fateShards, questTitles, activeQuestbook: null };
                await kv.set(saveKey, mergePreservingImages({ ...rec, character: updated }, rec));
                await kv.del(questKey).catch(() => undefined);
                await kv.set(doneKeyFor(playerName, entry.id), Date.now(), { ex: DONE_COOLDOWN_SECONDS });
                return { status: 200, body: { ok: true, ryo, totalRyo, fateShards: entry.fateShards, title: entry.award } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        // ── ABANDON ──────────────────────────────────────────────────────────
        if (action === 'abandon') {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                await kv.del(questKey).catch(() => undefined);
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (rec && char) {
                    const updated = { ...char, activeQuestbook: null };
                    await kv.set(saveKey, mergePreservingImages({ ...rec, character: updated }, rec));
                }
                return { status: 200, body: { ok: true } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not update the quest — please retry.' });
        }
        console.error('[sector/questbook]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
