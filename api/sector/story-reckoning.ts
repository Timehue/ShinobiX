import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { mutatePlayerSave, type PlayerSaveMutation, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict } from '../save/_projected-write.js';
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

/** A reckoning reply; `echo` acknowledges the save version, `withCharacter` hands back the character. */
type Reply = { body: Record<string, unknown>; echo?: boolean; withCharacter?: boolean };

function replyFor(committed: PlayerSaveMutationResult<Reply>): { status: number; body: Record<string, unknown> } {
    if (!committed.ok) {
        return committed.status === 404
            ? { status: 404, body: { error: 'Your save was not found.' } }
            : { status: committed.status, body: { error: committed.error } };
    }
    const { body, echo, withCharacter } = committed.value;
    return {
        status: 200,
        body: {
            ...body,
            ...(withCharacter ? { character: committed.character } : {}),
            ...(echo ? { _saveVersion: committed._saveVersion } : {}),
        },
    };
}

/** Answer without writing the save. */
function unwritten(char: Record<string, unknown>, body: Record<string, unknown>, opts: Omit<Reply, 'body'> = {}): PlayerSaveMutation<Reply> {
    return { ok: true, write: false, character: char, value: { body, ...opts } };
}

/** No seal in either store but a mirror for this quest: clear the stranded mirror and seal. */
function clearStranded(char: Record<string, unknown>): PlayerSaveMutation<Reply> {
    return {
        ok: true,
        character: { ...char, activeStoryReckoning: null },
        recordPatch: { activeStoryReckoningSeal: null },
        value: { body: { ok: false, reason: 'none', activeStoryReckoning: null }, echo: true, withCharacter: true },
    };
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

        const tokenKey = tokenKeyFor(playerName);
        // The save-resident seal is authoritative; its KV copy follows each
        // committed write, best-effort.
        const cacheSeal = (seal: StoryReckoningSeal) => kv.set(tokenKey, seal, { ex: TOKEN_TTL_SECONDS }).then(() => undefined, () => undefined);
        const def = action === 'abandon' ? null : STORY_RECKONINGS[String(body.questId ?? '')];
        if (action !== 'abandon' && !def) return res.status(400).json({ error: 'Unknown reckoning.' });

        if (action === 'accept' && def) {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                if (storyReckoningRedemption(char, def.id)) return unwritten(char, { ok: false, reason: 'ineligible' });
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
                    const reply = { ok: true, replayed: true, activeStoryReckoning };
                    if (!needsRepair) return unwritten(char, reply, { echo: true, withCharacter: true });
                    // The seal and mirror replace their stored values whole
                    // (REPLACE_SUBTREE_KEYS), so the repair carries no fields of
                    // whatever the save held before.
                    return {
                        ok: true,
                        character: { ...char, activeStoryReckoning },
                        recordPatch: { activeStoryReckoningSeal: existing },
                        value: { body: reply, echo: true, withCharacter: true },
                    };
                }
                if (!storyReckoningEligible(char, def)) return unwritten(char, { ok: false, reason: 'ineligible' });
                if (char.activeQuestbook || char.activeRiftQuest || existing) return unwritten(char, { ok: false, reason: 'busy' });
                const presenceReason = storyReckoningPresenceReason(def, onlineStore.get(playerName) ?? null, Date.now());
                if (presenceReason) return unwritten(char, { ok: false, reason: presenceReason });

                const baseline = num(char[def.metric]);
                const fieldWork = storyFieldJourney(def.id)
                    ? parseStoryFieldRecords(char.storyFieldRecords)[def.id] ?? newStoryFieldProgress()
                    : undefined;
                const sealed: StoryReckoningSeal = { id: def.id, stage: 'task', baseline, at: Date.now(), ...(fieldWork ? { fieldWork } : {}) };
                const activeStoryReckoning = mirrorFor(def, 'task', baseline, fieldWork);
                return {
                    ok: true,
                    character: { ...char, activeStoryReckoning },
                    recordPatch: { activeStoryReckoningSeal: sealed },
                    value: { body: { ok: true, activeStoryReckoning }, echo: true, withCharacter: true },
                    afterCommit: () => cacheSeal(sealed),
                };
            });
            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        if (action === 'field-act' && def) {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                const sealed = parseStoryReckoningSeal(rec.activeStoryReckoningSeal)
                    ?? parseStoryReckoningSeal(await kv.get(tokenKey));
                if (!sealed || sealed.id !== def.id || !sealed.fieldWork) {
                    return unwritten(char, { ok: false, reason: 'none' }, { echo: true, withCharacter: true });
                }
                const pointId = typeof body.pointId === 'string' ? body.pointId : '';
                const choiceId = typeof body.choiceId === 'string' ? body.choiceId : '';
                // Same-choice retries are safe even after the player leaves the
                // place. New actions require live, stationary world presence.
                const result = advanceStoryField(def.id, sealed.fieldWork, pointId, choiceId, onlineStore.get(playerName) ?? null, Date.now());
                if (!result.ok) return unwritten(char, { ...result }, { echo: true, withCharacter: true });
                if (result.replayed) {
                    return unwritten(char, { ok: true, replayed: true, activeStoryReckoning: char.activeStoryReckoning }, { echo: true, withCharacter: true });
                }
                const complete = storyFieldPointId(def.id, result.progress) === null;
                const nextSeal: StoryReckoningSeal = { ...sealed, stage: complete ? 'return' : 'task', fieldWork: result.progress };
                const activeStoryReckoning = mirrorFor(def, nextSeal.stage, sealed.baseline, result.progress);
                const storyFieldRecords = { ...parseStoryFieldRecords(char.storyFieldRecords), [def.id]: result.progress };
                const storyTraits = [...strArray(char.storyTraits).filter((trait) => !trait.startsWith('sf-')), ...storyFieldTraits(storyFieldRecords)];
                const inventory = Array.isArray(char.inventory) ? [...char.inventory] : [];
                if (complete && ownedItemCount(char, def.dropItemId) < 1) inventory.push(def.dropItemId);
                return {
                    ok: true,
                    character: { ...char, inventory, storyFieldRecords, storyTraits, activeStoryReckoning },
                    recordPatch: { activeStoryReckoningSeal: nextSeal },
                    value: { body: { ok: true, complete, activeStoryReckoning }, echo: true, withCharacter: true },
                    afterCommit: () => cacheSeal(nextSeal),
                };
            });
            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        if (action === 'report' && def) {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                const durable = parseStoryReckoningSeal(rec.activeStoryReckoningSeal);
                const sealed = durable ?? parseStoryReckoningSeal(await kv.get(tokenKey));
                if (!sealed || sealed.id !== def.id) {
                    if (!sealed && (char.activeStoryReckoning as Record<string, unknown> | null)?.id === def.id) return clearStranded(char);
                    return unwritten(char, { ok: false, reason: 'none', activeStoryReckoning: char.activeStoryReckoning ?? null }, { withCharacter: true });
                }

                if (sealed.stage === 'return') {
                    return unwritten(char, { ok: true, dropItemId: def.dropItemId, activeStoryReckoning: mirrorFor(def, 'return', num(sealed.baseline), sealed.fieldWork) }, { echo: true, withCharacter: true });
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
                    const reply = { ok: false, reason: 'incomplete', progress: Math.max(0, current - sealed.baseline), target: def.target };
                    if (durable) return unwritten(char, reply, { echo: true });
                    // Migrate a KV-only seal onto the durable save.
                    return { ok: true, character: char, recordPatch: { activeStoryReckoningSeal: sealed }, value: { body: reply, echo: true } };
                }
                const inventory = Array.isArray(char.inventory) ? [...(char.inventory as unknown[])] : [];
                if (ownedItemCount(char, def.dropItemId) < 1) inventory.push(def.dropItemId);

                const nextSeal: StoryReckoningSeal = { ...sealed, stage: 'return' };
                const activeStoryReckoning = mirrorFor(def, 'return', sealed.baseline, sealed.fieldWork);
                return {
                    ok: true,
                    character: { ...char, inventory, activeStoryReckoning },
                    recordPatch: { activeStoryReckoningSeal: nextSeal },
                    value: { body: { ok: true, dropItemId: def.dropItemId, activeStoryReckoning }, echo: true, withCharacter: true },
                    afterCommit: () => cacheSeal(nextSeal),
                };
            });
            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        if (action === 'turn-in' && def) {
            const today = utcDateKey();
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
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
                    const reply = {
                        ok: true, replayed: true, ryo: num(prior.ryo), totalRyo: num(char.ryo),
                        fateShards: num(prior.fateShards), totalFateShards: num(char.fateShards),
                        title: prior.title, questTitles: strArray(char.questTitles),
                        completionTrait: def.completionTrait,
                        activeStoryReckoning: preservedActive,
                    };
                    const dropRedeemedCache = () => cachedSeal?.id === def.id ? kv.del(tokenKey).then(() => undefined, () => undefined) : undefined;
                    if (!needsRepair) {
                        await dropRedeemedCache();
                        return unwritten(char, reply, { echo: true, withCharacter: true });
                    }
                    // These are single-owner mirrors: the seal and mirror replace
                    // their stored values whole (REPLACE_SUBTREE_KEYS), so promoting
                    // an unrelated cached seal keeps no route fields from the
                    // redeemed quest.
                    return {
                        ok: true,
                        character: { ...char, storyTraits, activeStoryReckoning: preservedActive },
                        ...(staleSeal ? { recordPatch: { activeStoryReckoningSeal: preservedSeal } } : {}),
                        value: { body: reply, echo: true, withCharacter: true },
                        afterCommit: dropRedeemedCache,
                    };
                }
                const sealed = parseStoryReckoningSeal(rec.activeStoryReckoningSeal)
                    ?? parseStoryReckoningSeal(await kv.get(tokenKey));
                if (!sealed || sealed.id !== def.id) {
                    if (!sealed && (char.activeStoryReckoning as Record<string, unknown> | null)?.id === def.id) return clearStranded(char);
                    return unwritten(char, { ok: false, reason: 'none', activeStoryReckoning: char.activeStoryReckoning ?? null }, { withCharacter: true });
                }
                if (sealed.stage !== 'return') return unwritten(char, { ok: false, reason: 'incomplete' });
                if (ownedItemCount(char, def.dropItemId) < 1) return unwritten(char, { ok: false, reason: 'no-item' });
                const presenceReason = storyReckoningPresenceReason(def, onlineStore.get(playerName) ?? null, Date.now());
                if (presenceReason) return unwritten(char, { ok: false, reason: presenceReason });

                const countKey = `story-reckoning-count:${playerName}:${today}`;
                const durableCount = char.storyReckoningRewardDate === today ? num(char.storyReckoningRewardCount) : 0;
                const compatibilityCount = num(await kv.get<number>(countKey));
                const claimedToday = Math.max(durableCount, compatibilityCount);
                if (claimedToday >= STORY_RECKONING_DAILY_CAP) {
                    return unwritten(char, { ok: false, reason: 'daily-cap' });
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
                return {
                    ok: true,
                    character: updated,
                    recordPatch: { activeStoryReckoningSeal: null },
                    value: {
                        body: { ok: true, ryo, totalRyo, fateShards: def.fateShards, totalFateShards, title: def.title, questTitles, completionTrait: def.completionTrait, activeStoryReckoning: null },
                        echo: true,
                        withCharacter: true,
                    },
                    // Cache cleanup/counter mirroring follows the atomic save payout.
                    // A failure here is replay-healed by the durable redemption.
                    afterCommit: async () => {
                        await kv.del(tokenKey).catch(() => undefined);
                        await kv.set(countKey, claimedToday + 1, { ex: 25 * 60 * 60 }).catch(() => undefined);
                    },
                };
            });
            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        if (action === 'abandon') {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
                await kv.del(tokenKey).catch(() => undefined);
                return {
                    ok: true,
                    character: { ...char, activeStoryReckoning: null },
                    recordPatch: { activeStoryReckoningSeal: null },
                    value: { body: { ok: true, activeStoryReckoning: null }, echo: true, withCharacter: true },
                };
            });
            // Abandoning with no save at all has nothing to clear.
            const out = !committed.ok && committed.status === 404 ? { status: 200, body: { ok: true } } : replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) {
            return res.status(503).json({ error: 'Could not update the reckoning. Please retry.' });
        }
        console.error('[sector/story-reckoning]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
