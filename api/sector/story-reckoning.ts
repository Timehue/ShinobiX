import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { worldContextWinProofCount } from '../missions/_world-ai-fight.js';
import { onlineStore } from '../_realtime/online-store.js';
import { advanceStoryField, newStoryFieldProgress, parseStoryFieldRecords, storyFieldJourney, storyFieldPointId, storyFieldTraits, type StoryFieldProgress } from '../../shared/story-field-work.js';
import {
    STORY_RECKONINGS,
    STORY_RECKONING_DAILY_CAP,
    storyReckoningEligible,
    storyReckoningPresenceReason,
    storyReckoningRedemption,
    storyReckoningTaskComplete,
    storyReckoningRyo,
    ownedItemCount,
    type StoryReckoningDef,
    parseStoryReckoningSeal,
    type StoryReckoningSeal,
} from './_story-reckoning.js';

const TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
const tokenKeyFor = (player: string) => `story-reckoning:${player}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);
const strArray = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function mirrorFor(def: StoryReckoningDef, stage: 'task' | 'return', baseline: number, fieldWork?: StoryFieldProgress) {
    return { id: def.id, stage, metric: def.metric, baseline, target: def.target, dropItemId: def.dropItemId, ...(fieldWork ? { fieldWork } : {}) };
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
                if (storyReckoningRedemption(char, def.id)) return { status: 200, body: { ok: false, reason: 'ineligible' } };
                const durable = parseStoryReckoningSeal(rec.activeStoryReckoningSeal);
                const cached = parseStoryReckoningSeal(await kv.get(tokenKey));
                const existing = durable ?? cached;
                // A lost accept response is a read-only replay of the exact seal.
                // It remains safe after the player moves and refreshes the client
                // mirror without minting a second quest or changing the route.
                if (existing?.id === def.id && existing.stage === 'task') {
                    const activeStoryReckoning = mirrorFor(def, 'task', existing.baseline, existing.fieldWork);
                    const mirror = char.activeStoryReckoning as Record<string, unknown> | null | undefined;
                    const needsRepair = !durable
                        || mirror?.id !== activeStoryReckoning.id
                        || mirror.stage !== activeStoryReckoning.stage
                        || mirror.metric !== activeStoryReckoning.metric
                        || num(mirror.baseline) !== activeStoryReckoning.baseline
                        || num(mirror.target) !== activeStoryReckoning.target
                        || mirror.dropItemId !== activeStoryReckoning.dropItemId
                        || JSON.stringify(mirror.fieldWork) !== JSON.stringify(activeStoryReckoning.fieldWork);
                    const updated = needsRepair ? { ...char, activeStoryReckoning } : char;
                    let replaySave = rec;
                    if (needsRepair) {
                        const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: existing, character: updated });
                        const merged = mergePreservingImages(next, rec) as Record<string, unknown>;
                        merged.activeStoryReckoningSeal = existing;
                        (merged.character as Record<string, unknown>).activeStoryReckoning = activeStoryReckoning;
                        await kv.set(saveKey, merged);
                        replaySave = merged;
                    }
                    return { status: 200, body: { ok: true, replayed: true, activeStoryReckoning, character: updated, _saveVersion: Number(replaySave._saveVersion ?? 0) } };
                }
                if (!storyReckoningEligible(char, def)) return { status: 200, body: { ok: false, reason: 'ineligible' } };
                if (char.activeQuestbook || char.activeRiftQuest || existing) return { status: 200, body: { ok: false, reason: 'busy' } };
                const presenceReason = storyReckoningPresenceReason(def, onlineStore.get(playerName) ?? null, Date.now());
                if (presenceReason) return { status: 200, body: { ok: false, reason: presenceReason } };

                const baseline = num(char[def.metric]);
                const fieldWork = storyFieldJourney(def.id)
                    ? parseStoryFieldRecords(char.storyFieldRecords)[def.id] ?? newStoryFieldProgress()
                    : undefined;
                const sealed: StoryReckoningSeal = { id: def.id, stage: 'task', baseline, at: Date.now(), ...(fieldWork ? { fieldWork } : {}) };
                const activeStoryReckoning = mirrorFor(def, 'task', baseline, fieldWork);
                const updated = { ...char, activeStoryReckoning };
                const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: sealed, character: updated });
                await kv.set(saveKey, mergePreservingImages(next, rec));
                await kv.set(tokenKey, sealed, { ex: TOKEN_TTL_SECONDS }).catch(() => undefined);
                return { status: 200, body: { ok: true, activeStoryReckoning, character: updated, _saveVersion: Number((next as Record<string, unknown>)._saveVersion ?? 0) } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        if (action === 'field-act' && def) {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                const sealed = parseStoryReckoningSeal(rec.activeStoryReckoningSeal)
                    ?? parseStoryReckoningSeal(await kv.get(tokenKey));
                if (!sealed || sealed.id !== def.id || !sealed.fieldWork) {
                    return { status: 200, body: { ok: false, reason: 'none', character: char, _saveVersion: Number(rec._saveVersion ?? 0) } };
                }
                const pointId = typeof body.pointId === 'string' ? body.pointId : '';
                const choiceId = typeof body.choiceId === 'string' ? body.choiceId : '';
                // Same-choice retries are safe even after the player leaves the
                // place. New actions require live, stationary world presence.
                const result = advanceStoryField(def.id, sealed.fieldWork, pointId, choiceId, onlineStore.get(playerName) ?? null, Date.now());
                if (!result.ok) return { status: 200, body: { ...result, character: char, _saveVersion: Number(rec._saveVersion ?? 0) } };
                if (result.replayed) return { status: 200, body: { ok: true, replayed: true, character: char, activeStoryReckoning: char.activeStoryReckoning, _saveVersion: Number(rec._saveVersion ?? 0) } };
                const complete = storyFieldPointId(def.id, result.progress) === null;
                const nextSeal: StoryReckoningSeal = { ...sealed, stage: complete ? 'return' : 'task', fieldWork: result.progress };
                const activeStoryReckoning = mirrorFor(def, nextSeal.stage, sealed.baseline, result.progress);
                const storyFieldRecords = { ...parseStoryFieldRecords(char.storyFieldRecords), [def.id]: result.progress };
                const storyTraits = [...strArray(char.storyTraits).filter((trait) => !trait.startsWith('sf-')), ...storyFieldTraits(storyFieldRecords)];
                const inventory = Array.isArray(char.inventory) ? [...char.inventory] : [];
                if (complete && ownedItemCount(char, def.dropItemId) < 1) inventory.push(def.dropItemId);
                const updated = { ...char, inventory, storyFieldRecords, storyTraits, activeStoryReckoning };
                const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: nextSeal, character: updated });
                await kv.set(saveKey, mergePreservingImages(next, rec));
                await kv.set(tokenKey, nextSeal, { ex: TOKEN_TTL_SECONDS }).catch(() => undefined);
                return { status: 200, body: { ok: true, complete, activeStoryReckoning, character: updated, _saveVersion: Number(next._saveVersion ?? 0) } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        if (action === 'report' && def) {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                const durable = parseStoryReckoningSeal(rec.activeStoryReckoningSeal);
                const sealed = durable ?? parseStoryReckoningSeal(await kv.get(tokenKey));
                if (!sealed || sealed.id !== def.id) {
                    if (!sealed && (char.activeStoryReckoning as Record<string, unknown> | null)?.id === def.id) {
                        const updated = { ...char, activeStoryReckoning: null };
                        const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: null, character: updated });
                        await kv.set(saveKey, mergePreservingImages(next, rec));
                        return { status: 200, body: { ok: false, reason: 'none', activeStoryReckoning: null, character: updated, _saveVersion: Number((next as Record<string, unknown>)._saveVersion ?? 0) } };
                    }
                    return { status: 200, body: { ok: false, reason: 'none', activeStoryReckoning: char.activeStoryReckoning ?? null, character: char } };
                }

                if (sealed.stage === 'return') {
                    return { status: 200, body: { ok: true, dropItemId: def.dropItemId, activeStoryReckoning: mirrorFor(def, 'return', num(sealed.baseline), sealed.fieldWork), character: char, _saveVersion: Number(rec._saveVersion ?? 0) } };
                }
                const current = num(char[def.metric]);
                const exactCombatProof = def.metric !== 'totalAiKills' || worldContextWinProofCount(char, {
                    kind: 'story-reckoning', sourceId: sealed.id, stage: 0,
                    sealVersion: `${sealed.id}:${sealed.stage}:${sealed.baseline}:${sealed.at}`,
                }) >= Math.max(1, Math.floor(def.target));
                const taskComplete = sealed.fieldWork
                    ? storyFieldPointId(def.id, sealed.fieldWork) === null
                    : exactCombatProof && storyReckoningTaskComplete(sealed.baseline, current, def.target);
                if (!taskComplete) {
                    let saveVersion = Number(rec._saveVersion ?? 0);
                    if (!durable) {
                        const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: sealed });
                        await kv.set(saveKey, mergePreservingImages(next, rec));
                        saveVersion = Number((next as Record<string, unknown>)._saveVersion ?? 0);
                    }
                    return { status: 200, body: { ok: false, reason: 'incomplete', progress: Math.max(0, current - sealed.baseline), target: def.target, _saveVersion: saveVersion } };
                }
                const inventory = Array.isArray(char.inventory) ? [...(char.inventory as unknown[])] : [];
                if (ownedItemCount(char, def.dropItemId) < 1) inventory.push(def.dropItemId);

                const nextSeal: StoryReckoningSeal = { ...sealed, stage: 'return' };
                const activeStoryReckoning = mirrorFor(def, 'return', sealed.baseline, sealed.fieldWork);
                const updated = { ...char, inventory, activeStoryReckoning };
                const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: nextSeal, character: updated });
                await kv.set(saveKey, mergePreservingImages(next, rec));
                await kv.set(tokenKey, nextSeal, { ex: TOKEN_TTL_SECONDS }).catch(() => undefined);
                return { status: 200, body: { ok: true, dropItemId: def.dropItemId, activeStoryReckoning, character: updated, _saveVersion: Number((next as Record<string, unknown>)._saveVersion ?? 0) } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        if (action === 'turn-in' && def) {
            const today = utcDateKey();
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                const receipts = Array.isArray(char.redeemedStoryReckonings)
                    ? char.redeemedStoryReckonings as Array<Record<string, unknown>>
                    : [];
                const prior = storyReckoningRedemption(char, def.id);
                if (prior) {
                    const storyTraits = strArray(char.storyTraits);
                    if (!storyTraits.includes(def.completionTrait)) storyTraits.push(def.completionTrait);
                    const active = char.activeStoryReckoning as Record<string, unknown> | null | undefined;
                    const rawSeal = rec.activeStoryReckoningSeal as Record<string, unknown> | null | undefined;
                    const durableSeal = parseStoryReckoningSeal(rec.activeStoryReckoningSeal);
                    const cachedSeal = parseStoryReckoningSeal(await kv.get(tokenKey));
                    const staleMirror = active?.id === def.id;
                    const staleSeal = rawSeal?.id === def.id;
                    const preservedSeal = durableSeal && durableSeal.id !== def.id ? durableSeal
                        : cachedSeal && cachedSeal.id !== def.id ? cachedSeal
                            : null;
                    const preservedActive = staleMirror ? (preservedSeal && STORY_RECKONINGS[preservedSeal.id]
                        ? mirrorFor(STORY_RECKONINGS[preservedSeal.id], preservedSeal.stage, preservedSeal.baseline, preservedSeal.fieldWork)
                        : null) : active ?? (preservedSeal && STORY_RECKONINGS[preservedSeal.id]
                        ? mirrorFor(STORY_RECKONINGS[preservedSeal.id], preservedSeal.stage, preservedSeal.baseline, preservedSeal.fieldWork)
                        : null);
                    const needsRepair = staleMirror || staleSeal || preservedActive !== active
                        || !strArray(char.storyTraits).includes(def.completionTrait);
                    const updated = needsRepair
                        ? { ...char, storyTraits, activeStoryReckoning: preservedActive }
                        : char;
                    let repairedSave = rec;
                    if (needsRepair) {
                        const next = bumpSaveVersion({ ...rec, ...(staleSeal ? { activeStoryReckoningSeal: preservedSeal } : {}), character: updated });
                        const merged = mergePreservingImages(next, rec) as Record<string, unknown>;
                        // These are single-owner mirrors. A deep compatibility
                        // merge would retain route fields from the redeemed
                        // quest when promoting an unrelated cached seal.
                        if (staleSeal) merged.activeStoryReckoningSeal = preservedSeal;
                        (merged.character as Record<string, unknown>).activeStoryReckoning = preservedActive;
                        await kv.set(saveKey, merged);
                        repairedSave = merged;
                    }
                    if (cachedSeal?.id === def.id) await kv.del(tokenKey).catch(() => undefined);
                    return { status: 200, body: {
                        ok: true, replayed: true, ryo: num(prior.ryo), totalRyo: num(char.ryo),
                        fateShards: num(prior.fateShards), totalFateShards: num(char.fateShards),
                        title: prior.title, questTitles: strArray(char.questTitles),
                        completionTrait: def.completionTrait,
                        activeStoryReckoning: preservedActive,
                        character: updated, _saveVersion: Number(repairedSave._saveVersion ?? 0),
                    } };
                }
                const sealed = parseStoryReckoningSeal(rec.activeStoryReckoningSeal)
                    ?? parseStoryReckoningSeal(await kv.get(tokenKey));
                if (!sealed || sealed.id !== def.id) {
                    if (!sealed && (char.activeStoryReckoning as Record<string, unknown> | null)?.id === def.id) {
                        const updated = { ...char, activeStoryReckoning: null };
                        const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: null, character: updated });
                        await kv.set(saveKey, mergePreservingImages(next, rec));
                        return { status: 200, body: { ok: false, reason: 'none', activeStoryReckoning: null, character: updated, _saveVersion: Number((next as Record<string, unknown>)._saveVersion ?? 0) } };
                    }
                    return { status: 200, body: { ok: false, reason: 'none', activeStoryReckoning: char.activeStoryReckoning ?? null, character: char } };
                }
                if (sealed.stage !== 'return') return { status: 200, body: { ok: false, reason: 'incomplete' } };
                if (ownedItemCount(char, def.dropItemId) < 1) return { status: 200, body: { ok: false, reason: 'no-item' } };
                const presenceReason = storyReckoningPresenceReason(def, onlineStore.get(playerName) ?? null, Date.now());
                if (presenceReason) return { status: 200, body: { ok: false, reason: presenceReason } };

                const countKey = `story-reckoning-count:${playerName}:${today}`;
                const durableCount = char.storyReckoningRewardDate === today ? num(char.storyReckoningRewardCount) : 0;
                const compatibilityCount = num(await kv.get<number>(countKey));
                const claimedToday = Math.max(durableCount, compatibilityCount);
                if (claimedToday >= STORY_RECKONING_DAILY_CAP) {
                    return { status: 200, body: { ok: false, reason: 'daily-cap' } };
                }

                const ryo = storyReckoningRyo(char.level, def.weight);
                const totalRyo = num(char.ryo) + ryo;
                const totalFateShards = num(char.fateShards) + def.fateShards;
                const questTitles = strArray(char.questTitles);
                if (!questTitles.includes(def.title)) questTitles.push(def.title);
                const storyTraits = strArray(char.storyTraits);
                if (!storyTraits.includes(def.completionTrait)) storyTraits.push(def.completionTrait);
                const receipt = {
                    id: `${def.id}:${sealed.at}`, questId: def.id, at: sealed.at,
                    ryo, fateShards: def.fateShards, title: def.title,
                    completionTrait: def.completionTrait,
                };
                const updated = {
                    ...char, ryo: totalRyo, fateShards: totalFateShards, questTitles, storyTraits,
                    activeStoryReckoning: null,
                    storyReckoningRewardDate: today,
                    storyReckoningRewardCount: claimedToday + 1,
                    redeemedStoryReckonings: [...receipts.slice(-39), receipt],
                };
                const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: null, character: updated });
                await kv.set(saveKey, mergePreservingImages(next, rec));
                // Cache cleanup/counter mirroring follows the atomic save payout.
                // A failure here is replay-healed by the durable redemption.
                await kv.del(tokenKey).catch(() => undefined);
                await kv.set(countKey, claimedToday + 1, { ex: 25 * 60 * 60 }).catch(() => undefined);
                return { status: 200, body: { ok: true, ryo, totalRyo, fateShards: def.fateShards, totalFateShards, title: def.title, questTitles, completionTrait: def.completionTrait, activeStoryReckoning: null, character: updated, _saveVersion: Number((next as Record<string, unknown>)._saveVersion ?? 0) } };
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
                    const next = bumpSaveVersion({ ...rec, activeStoryReckoningSeal: null, character: updated });
                    await kv.set(saveKey, mergePreservingImages(next, rec));
                    return { status: 200, body: { ok: true, activeStoryReckoning: null, character: updated, _saveVersion: Number((next as Record<string, unknown>)._saveVersion ?? 0) } };
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
        console.error('[sector/story-reckoning]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
