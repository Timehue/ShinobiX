import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { WANDERER_QUESTS, isWandererQuestId, wandererQuestRyo, wandererQuestComplete, parseWandererQuestSeal, type WandererQuestSeal } from './_wanderer-quest.js';
import { currentWandererCooldownUntil, parseNaturalWandererId, withWandererUseState } from './_wanderer-encounter.js';
import { bumpLegacyStats, legacyEnabled } from '../_legacy-track.js';
import { bumpEraContribution } from '../_era.js';

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
        const wandererId = typeof body.wandererId === 'string' ? body.wandererId.trim() : '';
        const naturalWanderer = parseNaturalWandererId(wandererId);
        const sector = Math.max(1, Math.min(60, Math.floor(Number(body.sector ?? 0)) || 0));

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
            // Emissary errands (eq-*) belong to the Legacy wave: no new accepts
            // while ENABLE_LEGACY is off (already-sealed ones still claim, so a
            // kill-switch flip mid-quest never eats a player's progress).
            if (questId.startsWith('eq-') && !legacyEnabled()) {
                return res.status(400).json({ error: 'Unknown quest.' });
            }
            const def = WANDERER_QUESTS[questId];

            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const now = Date.now();
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                const existing = parseWandererQuestSeal(rec.activeWandererQuestSeal)
                    ?? parseWandererQuestSeal(await kv.get(questKey));
                if (existing) return { status: 200, body: { ok: false, reason: 'busy' } };
                if (naturalWanderer) {
                    const cooldownUntil = currentWandererCooldownUntil(char, wandererId, now);
                    if (cooldownUntil) return { status: 200, body: { ok: false, reason: 'cooldown', cooldownUntil } };
                }

                const baseline = num(char[def.metric]);
                const sealed: WandererQuestSeal = { id: questId, baseline, at: now };
                await kv.set(questKey, sealed, { ex: QUEST_TTL_SECONDS });
                // Display mirror on the save (server never trusts this back).
                let updated: Record<string, unknown> = { ...char, activeWandererQuest: { id: questId, target: def.target, baseline } };
                const body: Record<string, unknown> = { ok: true, id: questId, target: def.target, baseline };
                if (naturalWanderer) {
                    const used = withWandererUseState(updated, wandererId, now, sector);
                    updated = used.character;
                    body.cooldownUntil = used.cooldownUntil;
                    body.moveToSector = used.moveToSector;
                }
                await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeWandererQuestSeal: sealed, character: updated }), rec));
                return { status: 200, body };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        // ── CLAIM ────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const now = Date.now();
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                const durable = parseWandererQuestSeal(rec.activeWandererQuestSeal);
                const sealed = durable ?? parseWandererQuestSeal(await kv.get(questKey));
                if (!sealed) {
                    await kv.del(questKey).catch(() => undefined);
                    const updated = { ...char, activeWandererQuest: null };
                    await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeWandererQuestSeal: null, character: updated }), rec));
                    return { status: 200, body: { ok: false, reason: 'none', activeWandererQuest: null, character: updated } };
                }
                const def = WANDERER_QUESTS[sealed.id];
                const receiptId = `${sealed.id}:${sealed.baseline}:${Number(sealed.at ?? 0)}`;
                const receipts = Array.isArray(char.redeemedWandererQuests) ? char.redeemedWandererQuests as Array<Record<string, unknown>> : [];
                const prior = receipts.find((entry) => entry.id === receiptId);
                if (prior) {
                    await kv.del(questKey).catch(() => undefined);
                    const updated = { ...char, activeWandererQuest: null };
                    await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeWandererQuestSeal: null, character: updated }), rec));
                    return { status: 200, body: { ok: true, replayed: true, ryo: num(prior.ryo), totalRyo: num(char.ryo), activeWandererQuest: null, character: updated } };
                }
                if (naturalWanderer) {
                    const cooldownUntil = currentWandererCooldownUntil(char, wandererId, now);
                    if (cooldownUntil) return { status: 200, body: { ok: false, reason: 'cooldown', cooldownUntil } };
                }

                const current = num(char[def.metric]);
                if (!wandererQuestComplete(num(sealed.baseline), current, def.target)) {
                    if (!durable) {
                        await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeWandererQuestSeal: sealed }), rec));
                    }
                    return { status: 200, body: { ok: false, reason: 'incomplete', progress: Math.max(0, current - num(sealed.baseline)), target: def.target } };
                }

                const reward = wandererQuestRyo(num(char.level) || 1, def.weight);
                const totalRyo = num(char.ryo) + reward;
                let updated: Record<string, unknown> = { ...char, ryo: totalRyo, activeWandererQuest: null, redeemedWandererQuests: [...receipts.slice(-49), { id: receiptId, ryo: reward }] };
                const body: Record<string, unknown> = { ok: true, ryo: reward, totalRyo, activeWandererQuest: null };
                if (naturalWanderer) {
                    const used = withWandererUseState(updated, wandererId, now, sector);
                    updated = used.character;
                    body.cooldownUntil = used.cooldownUntil;
                    body.moveToSector = used.moveToSector;
                }
                await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeWandererQuestSeal: null, character: updated }), rec));
                await kv.del(questKey).catch(() => undefined);
                body.character = updated;
                return { status: 200, body };
            }, { failClosed: true });

            // Legacy tracking (ENABLE_LEGACY): AFTER the fail-closed save lock
            // releases — bumpLegacyStats takes its own lock, and nesting it
            // inside a currency critical section adds up to ~900ms of backoff
            // to the lock hold (verification finding).
            if (out.status === 200 && (out.body as { ok?: boolean; replayed?: boolean })?.ok === true && !(out.body as { replayed?: boolean }).replayed) {
                await bumpLegacyStats(playerName, { wandererQuests: 1 });
                await bumpEraContribution('discoveries');
            }
            return res.status(out.status).json(out.body);
        }

        if (action === 'abandon') {
            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                await kv.del(questKey).catch(() => undefined);
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                const updated = { ...char, activeWandererQuest: null };
                await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeWandererQuestSeal: null, character: updated }), rec));
                return { status: 200, body: { ok: true, activeWandererQuest: null, character: updated } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not update the quest — please retry.' });
        }
        console.error('[sector/wanderer-quest]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
