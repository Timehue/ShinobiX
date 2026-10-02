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

/** A quest reply; `echo` acknowledges the save version, `withCharacter` hands back the character. */
type Reply = { body: Record<string, unknown>; echo?: boolean; withCharacter?: boolean };
type Decision = PlayerSaveMutation<Reply>;

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
function unwritten(char: Record<string, unknown>, body: Record<string, unknown>, echo = false): Decision {
    return { ok: true, write: false, character: char, value: { body, echo } };
}

/** Write a (re)sealed epic: the durable seal and its display mirror, then the TTL cache. */
function persist(player: string, char: Record<string, unknown>, sealed: Sealed, body: Record<string, unknown>): Decision {
    return {
        ok: true,
        character: { ...char, activeQuestbook: mirrorOf(sealed) },
        // Durable seal on the save record (server-owned; SERVER_LEDGER_TOPLEVEL_FIELDS)
        // so an in-flight epic survives the KV TTL and the Postgres cutover.
        recordPatch: { activeQuestbookSeal: sealed },
        value: { body, echo: true },
        // The save-resident seal is authoritative. Populate the TTL cache only
        // after that durable write so a cache success + save failure cannot strand
        // the player behind a 14-day phantom "busy" seal.
        afterCommit: () => kv.set(questKeyFor(player), sealed, { ex: QUESTBOOK_TTL_SECONDS }).then(() => undefined, () => undefined),
    };
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
    | { ok: true; sealed: Sealed; durable: boolean }
    | { ok: false; decision: Decision };

/**
 * Resolve the epic seal DURABLE-FIRST (the save-resident copy, then the KV
 * fallback). If neither exists the display mirror is stranded — the seal
 * expired (14d TTL) or was lost in the cutover — so self-heal: clear the
 * mirror + durable seal and surface `none` + the cleared character, mirroring
 * wanderer-quest / rift-quest.
 */
async function loadSealed(player: string, rec: Record<string, unknown>, char: Record<string, unknown>): Promise<LoadedSeal> {
    const durableSeal = parseQuestbookSeal(rec.activeQuestbookSeal);
    const sealed = durableSeal ?? parseQuestbookSeal(await kv.get(questKeyFor(player)));
    if (!sealed) {
        await kv.del(questKeyFor(player)).catch(() => undefined);
        if (char.activeQuestbook || rec.activeQuestbookSeal !== undefined) {
            return {
                ok: false,
                decision: {
                    ok: true,
                    character: { ...char, activeQuestbook: null },
                    recordPatch: { activeQuestbookSeal: null },
                    value: { body: { ok: false, reason: 'none', activeQuestbook: null }, echo: true, withCharacter: true },
                },
            };
        }
        return { ok: false, decision: unwritten(char, { ok: false, reason: 'none' }) };
    }
    return { ok: true, sealed, durable: !!durableSeal };
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

        // ── ACCEPT ───────────────────────────────────────────────────────────
        if (action === 'accept') {
            const questId = typeof body.questId === 'string' ? body.questId : '';
            if (!isQuestBookId(questId)) return res.status(400).json({ error: 'Unknown quest.' });
            const entry = QUEST_BOOK[questId];

            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                // Busy if a seal exists in EITHER store — the durable one still marks an
                // active epic after the KV seal's 14d TTL lapses (or a migration).
                if (parseQuestbookSeal(rec.activeQuestbookSeal) ?? parseQuestbookSeal(await kv.get(questKey))) {
                    return unwritten(char, { ok: false, reason: 'busy' });
                }
                const cooling = await kv.get(doneKeyFor(playerName, questId));
                if (cooling) return unwritten(char, { ok: false, reason: 'cooldown' });
                if (!bandMatches(entry, num(char.level) || 1)) return unwritten(char, { ok: false, reason: 'band' });

                const sealed = sealStage(questId, 0, char, {}, Date.now());
                return persist(playerName, char, sealed, { ok: true, id: questId, stage: 0, target: entry.stages[0].count, deadline: sealed.deadline ?? null });
            });

            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        // ── ADVANCE ──────────────────────────────────────────────────────────
        if (action === 'advance') {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                const loaded = await loadSealed(playerName, rec, char);
                if (!loaded.ok) return loaded.decision;
                const { sealed } = loaded;
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
                        return persist(playerName, char, reseal, { ok: false, reason: 'expired', resetToStage: resetIdx, target: entry.stages[resetIdx].count, deadline: reseal.deadline ?? null });
                    }
                }

                // A lazily armed timer is persisted with the reply (which then
                // acknowledges its version); otherwise nothing is written.
                const persistMigratedTimer = (body: Record<string, unknown>): Decision =>
                    working === sealed ? unwritten(char, body) : persist(playerName, char, working, body);

                // Branch: a choice stage advances only via `choose`.
                if (stageIsChoice(stage) && !choices[stage.key]) {
                    return persistMigratedTimer({ ok: false, reason: 'choose', stage: stageIdx });
                }

                const current = num(char[stage.metric]);
                if (!exactBossProofExists(char, working, stageIdx)
                    || !questStageComplete(num(working.baseline), current, stage.count)) {
                    return persistMigratedTimer({ ok: false, reason: 'incomplete', stage: stageIdx, progress: Math.max(0, current - num(working.baseline)), target: stage.count, deadline: working.deadline ?? null });
                }
                if (stageIdx >= finalIdx) {
                    return persistMigratedTimer({ ok: true, stage: stageIdx, readyToClaim: true });
                }

                const reseal = sealStage(sealed.id, stageIdx + 1, char, choices, now);
                return persist(playerName, char, reseal, { ok: true, advanced: true, stage: reseal.stage, target: entry.stages[reseal.stage].count, deadline: reseal.deadline ?? null });
            });

            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        // ── CHOOSE (branch) ──────────────────────────────────────────────────
        if (action === 'choose') {
            const optionKey = typeof body.optionKey === 'string' ? body.optionKey : '';
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                const loaded = await loadSealed(playerName, rec, char);
                if (!loaded.ok) return loaded.decision;
                const { sealed } = loaded;
                const entry = QUEST_BOOK[sealed.id];
                const finalIdx = finalStageIndex(entry);
                const stageIdx = Math.max(0, Math.min(finalIdx, Math.floor(num(sealed.stage))));
                const stage = entry.stages[stageIdx];
                if (!stageIsChoice(stage)) return unwritten(char, { ok: false, reason: 'no-choice' });
                if (!choiceOption(stage, optionKey)) return unwritten(char, { ok: false, reason: 'bad-option' });

                const now = Date.now();
                const choices = { ...(sealed.choices ?? {}), [stage.key]: optionKey };
                if (stageIdx >= finalIdx) {
                    return persist(playerName, char, { ...sealed, choices }, { ok: true, chose: optionKey, readyToClaim: true });
                }
                const reseal = sealStage(sealed.id, stageIdx + 1, char, choices, now);
                return persist(playerName, char, reseal, { ok: true, chose: optionKey, advanced: true, stage: reseal.stage, target: entry.stages[reseal.stage].count, deadline: reseal.deadline ?? null });
            });

            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        // ── CLAIM ────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                const loaded = await loadSealed(playerName, rec, char);
                if (!loaded.ok) return loaded.decision;
                const { sealed } = loaded;
                const entry = QUEST_BOOK[sealed.id];
                const finalIdx = finalStageIndex(entry);
                if (Math.floor(num(sealed.stage)) < finalIdx) {
                    return unwritten(char, { ok: false, reason: 'not-final', stage: num(sealed.stage) });
                }
                const stage = entry.stages[finalIdx];
                const choices = sealed.choices ?? {};

                const receiptId = `${sealed.id}:${Number(sealed.at ?? 0)}`;
                const receipts = Array.isArray(char.redeemedQuestbookRuns) ? char.redeemedQuestbookRuns as Array<Record<string, unknown>> : [];
                const prior = receipts.find((receiptEntry) => receiptEntry.id === receiptId);
                if (prior) {
                    await kv.set(doneKeyFor(playerName, sealed.id), Date.now(), { ex: DONE_COOLDOWN_SECONDS }).catch(() => undefined);
                    await kv.del(questKey).catch(() => undefined);
                    return unwritten(char, { ok: true, replayed: true, ryo: num(prior.ryo), totalRyo: num(char.ryo), fateShards: num(prior.fateShards), title: prior.title, standings: prior.standings, clearedRivalry: prior.clearedRivalry === true }, true);
                }

                const now = Date.now();
                // A timed final stage must still be within its deadline.
                if (stageTimerMs(stage) > 0 && sealed.deadline && now > sealed.deadline) {
                    const resetIdx = timerResetStage(entry, finalIdx);
                    const reseal = sealStage(sealed.id, resetIdx, char, choices, now);
                    return persist(playerName, char, reseal, { ok: false, reason: 'expired', resetToStage: resetIdx, target: entry.stages[resetIdx].count });
                }
                if (stageIsChoice(stage) && !choices[stage.key]) {
                    return unwritten(char, { ok: false, reason: 'choose', stage: finalIdx });
                }

                const current = num(char[stage.metric]);
                if (!exactBossProofExists(char, sealed, finalIdx)
                    || !questStageComplete(num(sealed.baseline), current, stage.count)) {
                    return unwritten(char, { ok: false, reason: 'incomplete', stage: finalIdx, progress: Math.max(0, current - num(sealed.baseline)), target: stage.count });
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
                return {
                    ok: true,
                    character: updated,
                    recordPatch: { activeQuestbookSeal: null },
                    value: { body: { ok: true, ryo, totalRyo, fateShards: fateAward, title: awardTitle, standings: fx.standings, clearedRivalry: !!entry.clearsRivalry }, echo: true },
                    // The completion cooldown and the cache cleanup follow the
                    // committed payout, still under the save lock.
                    afterCommit: async () => {
                        await kv.set(doneKeyFor(playerName, entry.id), Date.now(), { ex: DONE_COOLDOWN_SECONDS });
                        await kv.del(questKey).catch(() => undefined);
                    },
                };
            });

            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        // ── ABANDON ──────────────────────────────────────────────────────────
        if (action === 'abandon') {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                await kv.del(questKey).catch(() => undefined);
                if (!char.activeQuestbook && rec.activeQuestbookSeal == null) return unwritten(char, { ok: true }, true);
                return {
                    ok: true,
                    character: { ...char, activeQuestbook: null },
                    recordPatch: { activeQuestbookSeal: null },
                    value: { body: { ok: true }, echo: true },
                };
            });
            // Abandoning with no save at all has nothing to clear.
            const out = !committed.ok && committed.status === 404 ? { status: 200, body: { ok: true } } : replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) {
            return res.status(503).json({ error: 'Could not update the quest — please retry.' });
        }
        console.error('[sector/questbook]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
