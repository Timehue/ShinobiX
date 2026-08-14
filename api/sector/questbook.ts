import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { worldContextWinProofCount } from '../missions/_world-ai-fight.js';
import {
    QUEST_BOOK,
    isQuestBookId,
    finalStageIndex,
    questStageComplete,
    stageIsChoice,
    choiceOption,
    stageTimerMs,
    timerResetStage,
    bandMatches,
    questBookRyo,
    aggregateChoiceEffects,
    parseQuestbookSeal,
    type QuestbookSeal,
} from './_questbook.js';

/*
 * /api/sector/questbook — POST { action, playerName, questId?, optionKey? }
 *
 * Server-authoritative multi-stage "epic" quests (see _questbook.ts). The sealed
 * record { id, stage, baseline, deadline?, choices } lives in KV (one active epic per
 * player); the save's `activeQuestbook` is a DISPLAY mirror the server never trusts.
 * Stage advancement, BRANCH choices, TIMED-stage deadlines, and the final reward are
 * all recomputed/enforced from the sealed catalog against the real character counters.
 *
 *   accept  { questId }   → { ok, id, stage, target } | { ok:false, reason }
 *   advance               → { ok, stage, target, advanced?, readyToClaim?, deadline? } | { ok:false, reason, ... }
 *   choose  { optionKey } → { ok, chose, advanced?, stage?, target?, readyToClaim? } | { ok:false, reason }
 *   claim                 → { ok, ryo, totalRyo, fateShards, title, standings } | { ok:false, reason }
 *   abandon               → { ok:true }
 */

const QUESTBOOK_TTL_SECONDS = 14 * 24 * 60 * 60; // an epic can sit unfinished for two weeks
const DONE_COOLDOWN_SECONDS = 3 * 24 * 60 * 60;  // re-roll cooldown after completing one
const questKeyFor = (player: string) => `questbook:${player}`;
const doneKeyFor = (player: string, questId: string) => `questbook:done:${player}:${questId}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

type Sealed = QuestbookSeal;

/** Seal a stage as it becomes active — re-baseline its counter + (re)arm its timer. */
function sealStage(id: string, stageIdx: number, char: Record<string, unknown>, choices: Record<string, string>, now: number): Sealed {
    const stage = QUEST_BOOK[id].stages[stageIdx];
    const timerMs = stageTimerMs(stage);
    return {
        id, stage: stageIdx,
        baseline: num(char[stage.metric]),
        at: now,
        deadline: timerMs > 0 ? now + timerMs : undefined,
        choices,
    };
}

/** The display mirror written onto the save (server never trusts it back). */
function mirrorOf(sealed: Sealed) {
    const stage = QUEST_BOOK[sealed.id].stages[sealed.stage];
    return {
        id: sealed.id,
        stage: sealed.stage,
        baseline: sealed.baseline,
        target: stage.count,
        deadline: sealed.deadline ?? null,
        choices: sealed.choices ?? {},
    };
}

async function persist(player: string, saveKey: string, rec: Record<string, unknown>, char: Record<string, unknown>, sealed: Sealed): Promise<number> {
    const updated = { ...char, activeQuestbook: mirrorOf(sealed) };
    // Durable seal on the save record (server-owned; SERVER_LEDGER_TOPLEVEL_FIELDS)
    // so an in-flight epic survives the KV TTL and the Postgres cutover.
    const nextRecord = bumpSaveVersion({ ...rec, activeQuestbookSeal: sealed, character: updated });
    await kv.set(saveKey, mergePreservingImages(nextRecord, rec));
    // The save-resident seal is authoritative. Populate the TTL cache only
    // after that durable write so a cache success + save failure cannot strand
    // the player behind a 14-day phantom "busy" seal.
    await kv.set(questKeyFor(player), sealed, { ex: QUESTBOOK_TTL_SECONDS }).catch(() => undefined);
    return Number(nextRecord._saveVersion ?? 0);
}

function exactBossProofExists(character: Record<string, unknown>, sealed: Sealed, stageIdx: number): boolean {
    const stage = QUEST_BOOK[sealed.id]?.stages[stageIdx];
    if (!stage?.bossId || stage.metric !== 'totalAiKills') return true;
    return worldContextWinProofCount(character, {
        kind: 'questbook-boss',
        sourceId: sealed.id,
        stage: stageIdx,
        sealVersion: `${sealed.id}:${stageIdx}:${sealed.baseline}:${sealed.at ?? 0}`,
    }) >= Math.max(1, Math.floor(Number(stage.count) || 1));
}

type LoadedSeal =
    | { ok: true; rec: Record<string, unknown>; char: Record<string, unknown>; sealed: Sealed; durable: boolean }
    | { ok: false; result: { status: number; body: unknown } };

/**
 * Read the save + resolve the epic seal DURABLE-FIRST (the save-resident copy,
 * then the KV fallback). If neither exists the display mirror is stranded — the
 * seal expired (14d TTL) or was lost in the cutover — so self-heal: clear the
 * mirror + durable seal and surface `none` + the cleared character, mirroring
 * wanderer-quest / rift-quest. Callers use the returned rec/char/sealed directly.
 */
async function loadSealed(player: string, saveKey: string): Promise<LoadedSeal> {
    const rec = await kv.get<Record<string, unknown>>(saveKey);
    const char = (rec?.character ?? null) as Record<string, unknown> | null;
    if (!rec || !char) return { ok: false, result: { status: 404, body: { error: 'Your save was not found.' } } };
    const durableSeal = parseQuestbookSeal(rec.activeQuestbookSeal);
    const sealed = durableSeal ?? parseQuestbookSeal(await kv.get(questKeyFor(player)));
    if (!sealed) {
        await kv.del(questKeyFor(player)).catch(() => undefined);
        if (char.activeQuestbook || rec.activeQuestbookSeal !== undefined) {
            const updated = { ...char, activeQuestbook: null };
            const nextRecord = bumpSaveVersion({ ...rec, activeQuestbookSeal: null, character: updated });
            await kv.set(saveKey, mergePreservingImages(nextRecord, rec));
            return { ok: false, result: { status: 200, body: { ok: false, reason: 'none', activeQuestbook: null, character: updated, _saveVersion: Number(nextRecord._saveVersion ?? 0) } } };
        }
        return { ok: false, result: { status: 200, body: { ok: false, reason: 'none' } } };
    }
    return { ok: true, rec, char, sealed, durable: !!durableSeal };
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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `questbook-${action}`, 20, 60_000, identity.name))) return;

        const questKey = questKeyFor(playerName);
        const saveKey = `save:${playerName}`;

        // ── ACCEPT ───────────────────────────────────────────────────────────
        if (action === 'accept') {
            const questId = typeof body.questId === 'string' ? body.questId : '';
            if (!isQuestBookId(questId)) return res.status(400).json({ error: 'Unknown quest.' });
            const entry = QUEST_BOOK[questId];

            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                // Busy if a seal exists in EITHER store — the durable one still marks an
                // active epic after the KV seal's 14d TTL lapses (or a migration).
                if (parseQuestbookSeal(rec.activeQuestbookSeal) ?? parseQuestbookSeal(await kv.get(questKey))) {
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                }
                const cooling = await kv.get(doneKeyFor(playerName, questId));
                if (cooling) return { status: 200, body: { ok: false, reason: 'cooldown' } };
                if (!bandMatches(entry, num(char.level) || 1)) return { status: 200, body: { ok: false, reason: 'band' } };

                const sealed = sealStage(questId, 0, char, {}, Date.now());
                const saveVersion = await persist(playerName, saveKey, rec, char, sealed);
                return { status: 200, body: { ok: true, id: questId, stage: 0, target: entry.stages[0].count, deadline: sealed.deadline ?? null, _saveVersion: saveVersion } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        // ── ADVANCE ──────────────────────────────────────────────────────────
        if (action === 'advance') {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const loaded = await loadSealed(playerName, saveKey);
                if (!loaded.ok) return loaded.result;
                const { rec, char, sealed } = loaded;
                const entry = QUEST_BOOK[sealed.id];
                const finalIdx = finalStageIndex(entry);
                const stageIdx = Math.max(0, Math.min(finalIdx, Math.floor(num(sealed.stage))));
                const stage = entry.stages[stageIdx];
                const choices = sealed.choices ?? {};
                const now = Date.now();
                // Timer: lazily arm a missing deadline (migrates in-flight epics); else
                // enforce expiry → reset to the timer's reset stage.
                let working = sealed;
                if (stageTimerMs(stage) > 0) {
                    if (!sealed.deadline) {
                        working = { ...sealed, deadline: now + stageTimerMs(stage) };
                    } else if (now > sealed.deadline) {
                        const resetIdx = timerResetStage(entry, stageIdx);
                        const reseal = sealStage(sealed.id, resetIdx, char, choices, now);
                        const saveVersion = await persist(playerName, saveKey, rec, char, reseal);
                        return { status: 200, body: { ok: false, reason: 'expired', resetToStage: resetIdx, target: entry.stages[resetIdx].count, deadline: reseal.deadline ?? null, _saveVersion: saveVersion } };
                    }
                }

                const persistMigratedTimer = async (): Promise<Record<string, number>> => {
                    if (working === sealed) return {};
                    return { _saveVersion: await persist(playerName, saveKey, rec, char, working) };
                };

                // Branch: a choice stage advances only via `choose`.
                if (stageIsChoice(stage) && !choices[stage.key]) {
                    return { status: 200, body: { ok: false, reason: 'choose', stage: stageIdx, ...(await persistMigratedTimer()) } };
                }

                const current = num(char[stage.metric]);
                if (!exactBossProofExists(char, working, stageIdx)
                    || !questStageComplete(num(working.baseline), current, stage.count)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', stage: stageIdx, progress: Math.max(0, current - num(working.baseline)), target: stage.count, deadline: working.deadline ?? null, ...(await persistMigratedTimer()) } };
                }
                if (stageIdx >= finalIdx) {
                    return { status: 200, body: { ok: true, stage: stageIdx, readyToClaim: true, ...(await persistMigratedTimer()) } };
                }

                const reseal = sealStage(sealed.id, stageIdx + 1, char, choices, now);
                const saveVersion = await persist(playerName, saveKey, rec, char, reseal);
                return { status: 200, body: { ok: true, advanced: true, stage: reseal.stage, target: entry.stages[reseal.stage].count, deadline: reseal.deadline ?? null, _saveVersion: saveVersion } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        // ── CHOOSE (branch) ──────────────────────────────────────────────────
        if (action === 'choose') {
            const optionKey = typeof body.optionKey === 'string' ? body.optionKey : '';
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const loaded = await loadSealed(playerName, saveKey);
                if (!loaded.ok) return loaded.result;
                const { rec, char, sealed } = loaded;
                const entry = QUEST_BOOK[sealed.id];
                const finalIdx = finalStageIndex(entry);
                const stageIdx = Math.max(0, Math.min(finalIdx, Math.floor(num(sealed.stage))));
                const stage = entry.stages[stageIdx];
                if (!stageIsChoice(stage)) return { status: 200, body: { ok: false, reason: 'no-choice' } };
                if (!choiceOption(stage, optionKey)) return { status: 200, body: { ok: false, reason: 'bad-option' } };

                const now = Date.now();
                const choices = { ...(sealed.choices ?? {}), [stage.key]: optionKey };
                if (stageIdx >= finalIdx) {
                    const saveVersion = await persist(playerName, saveKey, rec, char, { ...sealed, choices });
                    return { status: 200, body: { ok: true, chose: optionKey, readyToClaim: true, _saveVersion: saveVersion } };
                }
                const reseal = sealStage(sealed.id, stageIdx + 1, char, choices, now);
                const saveVersion = await persist(playerName, saveKey, rec, char, reseal);
                return { status: 200, body: { ok: true, chose: optionKey, advanced: true, stage: reseal.stage, target: entry.stages[reseal.stage].count, deadline: reseal.deadline ?? null, _saveVersion: saveVersion } };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        // ── CLAIM ────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const out = await withKvLock<{ status: number; body: unknown }>(saveKey, async () => {
                const loaded = await loadSealed(playerName, saveKey);
                if (!loaded.ok) return loaded.result;
                const { rec, char, sealed } = loaded;
                const entry = QUEST_BOOK[sealed.id];
                const finalIdx = finalStageIndex(entry);
                if (Math.floor(num(sealed.stage)) < finalIdx) {
                    return { status: 200, body: { ok: false, reason: 'not-final', stage: num(sealed.stage) } };
                }
                const stage = entry.stages[finalIdx];
                const choices = sealed.choices ?? {};

                const receiptId = `${sealed.id}:${Number(sealed.at ?? 0)}`;
                const receipts = Array.isArray(char.redeemedQuestbookRuns) ? char.redeemedQuestbookRuns as Array<Record<string, unknown>> : [];
                const prior = receipts.find((receiptEntry) => receiptEntry.id === receiptId);
                if (prior) {
                    await kv.set(doneKeyFor(playerName, sealed.id), Date.now(), { ex: DONE_COOLDOWN_SECONDS }).catch(() => undefined);
                    await kv.del(questKey).catch(() => undefined);
                    return { status: 200, body: { ok: true, replayed: true, ryo: num(prior.ryo), totalRyo: num(char.ryo), fateShards: num(prior.fateShards), title: prior.title, standings: prior.standings, clearedRivalry: prior.clearedRivalry === true, _saveVersion: Number(rec._saveVersion ?? 0) } };
                }

                const now = Date.now();
                // A timed final stage must still be within its deadline.
                if (stageTimerMs(stage) > 0 && sealed.deadline && now > sealed.deadline) {
                    const resetIdx = timerResetStage(entry, finalIdx);
                    const reseal = sealStage(sealed.id, resetIdx, char, choices, now);
                    const saveVersion = await persist(playerName, saveKey, rec, char, reseal);
                    return { status: 200, body: { ok: false, reason: 'expired', resetToStage: resetIdx, target: entry.stages[resetIdx].count, _saveVersion: saveVersion } };
                }
                if (stageIsChoice(stage) && !choices[stage.key]) {
                    return { status: 200, body: { ok: false, reason: 'choose', stage: finalIdx } };
                }

                const current = num(char[stage.metric]);
                if (!exactBossProofExists(char, sealed, finalIdx)
                    || !questStageComplete(num(sealed.baseline), current, stage.count)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', stage: finalIdx, progress: Math.max(0, current - num(sealed.baseline)), target: stage.count } };
                }

                // Apply sealed branch effects to the reward.
                const fx = aggregateChoiceEffects(entry, choices);
                const ryo = Math.round(questBookRyo(num(char.level) || 1, entry.weight) * fx.ryoMult);
                const fateAward = entry.fateShards + fx.bonusFateShards;
                const awardTitle = fx.titleOverride ?? entry.award;
                const totalRyo = num(char.ryo) + ryo;
                const fateShards = num(char.fateShards) + fateAward;
                const prevTitles = Array.isArray(char.questTitles) ? (char.questTitles as string[]).filter(t => typeof t === 'string') : [];
                const questTitles = prevTitles.includes(awardTitle) ? prevTitles : [...prevTitles, awardTitle];
                const prevStandings = Array.isArray(char.questStandings) ? (char.questStandings as string[]).filter(t => typeof t === 'string') : [];
                const questStandings = [...prevStandings];
                for (const s of fx.standings) if (!questStandings.includes(s)) questStandings.push(s);

                const receipt = { id: receiptId, ryo, fateShards: fateAward, title: awardTitle, standings: fx.standings, clearedRivalry: !!entry.clearsRivalry };
                const updated: Record<string, unknown> = { ...char, ryo: totalRyo, fateShards, questTitles, questStandings, activeQuestbook: null, redeemedQuestbookRuns: [...receipts.slice(-49), receipt] };
                // The capstone ends the rivalry for good (its whole point).
                if (entry.clearsRivalry) updated.wandererNemesis = null;
                const nextRecord = bumpSaveVersion({ ...rec, activeQuestbookSeal: null, character: updated });
                await kv.set(saveKey, mergePreservingImages(nextRecord, rec));
                await kv.set(doneKeyFor(playerName, entry.id), Date.now(), { ex: DONE_COOLDOWN_SECONDS });
                await kv.del(questKey).catch(() => undefined);
                return { status: 200, body: { ok: true, ryo, totalRyo, fateShards: fateAward, title: awardTitle, standings: fx.standings, clearedRivalry: !!entry.clearsRivalry, _saveVersion: Number(nextRecord._saveVersion ?? 0) } };
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
                    if (!char.activeQuestbook && rec.activeQuestbookSeal == null) {
                        return { status: 200, body: { ok: true, _saveVersion: Number(rec._saveVersion ?? 0) } };
                    }
                    const nextRecord = bumpSaveVersion({ ...rec, activeQuestbookSeal: null, character: updated });
                    await kv.set(saveKey, mergePreservingImages(nextRecord, rec));
                    return { status: 200, body: { ok: true, _saveVersion: Number(nextRecord._saveVersion ?? 0) } };
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
        console.error('[sector/questbook]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
