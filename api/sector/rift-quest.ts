import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict } from '../save/_projected-write.js';
import {
    RIFT_QUESTS, RIFT_DAILY_CAP, RIFT_COOLDOWN_MS,
    isRiftQuestId, riftQuestRyo, riftTargetSector,
    parseRiftQuestSeal, parseRiftQuestBossReceipt, riftBossReceiptMatches,
    type RiftQuestSeal,
} from './_rift-quest.js';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo.js';

/*
 * /api/sector/rift-quest — POST { action: 'accept' | 'complete' | 'abandon', playerName, riftId? }
 *
 * Server-authoritative wandering-AI RIFT quest (a scaled event Hollow Gate). The
 * target sector and acceptance identity are sealed at accept. Hollow Gate start
 * binds the seal to one exact variant run; boss settlement stamps an exact combat
 * receipt. Complete pays only when all three identities agree, single-use and
 * daily-capped under the fail-closed save lock. activeRiftQuest remains a display
 * mirror; aggregate Warden kills are never completion proof.
 */

const QUEST_TTL_SECONDS = 7 * 24 * 60 * 60;
const questKeyFor = (player: string) => `rift-quest:${player}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);

type Sealed = RiftQuestSeal;

/** A rift reply; `echo` acknowledges the save version, `withCharacter` hands back the character. */
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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `rift-quest-${action}`, 20, 60_000, identity.name))) return;

        const questKey = questKeyFor(playerName);
        const def = action === 'abandon' ? null : RIFT_QUESTS[String(body.riftId ?? '')];
        if (action !== 'abandon' && !def) return res.status(400).json({ error: 'Unknown rift.' });

        // ── ACCEPT: gate-check the real save, seal the foe-kill baseline ──────
        if (action === 'accept' && def) {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                const answer = (reply: Record<string, unknown>) => ({ ok: true as const, write: false, character: char, value: { body: reply } });
                // Busy if a seal exists in EITHER store — the durable one still marks
                // an active rift after the KV seal's 7d TTL lapses (or a migration).
                if (parseRiftQuestSeal(rec.activeRiftQuestSeal) ?? parseRiftQuestSeal(await kv.get(questKey))) {
                    return answer({ ok: false, reason: 'busy' });
                }
                if (num(char.level) < def.levelReq) return answer({ ok: false, reason: 'level' });
                if (Date.now() < num(char.riftCooldownUntil)) return answer({ ok: false, reason: 'cooldown' });

                const targetSector = riftTargetSector(playerName, def.id);
                const baseline = num(char.hollowGateWardenKills);
                const sealed: Sealed = { id: def.id, targetSector, baseline, at: Date.now(), geoV: WORLD_GEO_VERSION };
                const activeRiftQuest = { id: def.id, targetSector, stage: 'travel' as const, baseline, bossName: def.bossName };
                return {
                    ok: true,
                    character: { ...char, activeRiftQuest, riftQuestBossReceipt: null },
                    // Durable seal on the save record (server-owned; SERVER_LEDGER_TOPLEVEL_FIELDS)
                    // so an in-flight rift survives the KV TTL and the Postgres cutover.
                    recordPatch: { activeRiftQuestSeal: sealed },
                    value: { body: { ok: true, activeRiftQuest }, echo: true },
                    // The KV copy follows the durable seal, best-effort. Written
                    // first, a failed save write left a phantom seal answering
                    // "busy" to every new rift until it expired a week later.
                    afterCommit: () => kv.set(questKey, sealed, { ex: QUEST_TTL_SECONDS }).then(() => undefined, () => undefined),
                };
            });
            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        // ── COMPLETE: verify the boss kill, pay, stamp cooldown ──────────────
        if (action === 'complete' && def) {
            const today = utcDateKey();
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                const answer = (reply: Record<string, unknown>) => ({ ok: true as const, write: false, character: char, value: { body: reply } });
                // Durable seal first, KV fallback — a legit rift accepted before the KV
                // TTL lapsed (or before the cutover) still pays out from the durable seal.
                const durable = parseRiftQuestSeal(rec.activeRiftQuestSeal);
                const sealed = durable ?? parseRiftQuestSeal(await kv.get(questKey));
                if (!sealed) {
                    // No seal in either store: the display mirror is stranded (7d TTL
                    // expiry, or a pre-durable-seal rift lost in the cutover). Without
                    // this, completeRiftRun silently no-ops and nextRift() stays blocked
                    // FOREVER — the whole rift feature dies for this player. Self-heal:
                    // clear the mirror + durable seal and tell the client so the giver
                    // can offer a fresh rift.
                    await kv.del(questKey).catch(() => undefined);
                    if (char.activeRiftQuest || rec.activeRiftQuestSeal !== undefined) {
                        return {
                            ok: true,
                            character: { ...char, activeRiftQuest: null, riftQuestBossReceipt: null },
                            recordPatch: { activeRiftQuestSeal: null },
                            value: { body: { ok: false, reason: 'none', activeRiftQuest: null }, echo: true, withCharacter: true },
                        };
                    }
                    return answer({ ok: false, reason: 'none' });
                }
                if (sealed.id !== def.id) return answer({ ok: false, reason: 'wrong-rift' });

                const bossReceipt = parseRiftQuestBossReceipt(char.riftQuestBossReceipt);
                if (!riftBossReceiptMatches(sealed, bossReceipt)) {
                    const reason = !sealed.runToken ? 'proof-missing-retry' : 'incomplete';
                    if (durable) return answer({ ok: false, reason });
                    // Migrate a KV-only legacy seal onto the durable save so it survives
                    // the TTL / a future cutover if the boss is cleared later.
                    return { ok: true, character: char, recordPatch: { activeRiftQuestSeal: sealed }, value: { body: { ok: false, reason }, echo: true } };
                }
                const countKey = `rift-quest-count:${playerName}:${today}`;
                if (num(await kv.get<number>(countKey)) >= RIFT_DAILY_CAP) {
                    return answer({ ok: false, reason: 'daily-cap' });
                }
                // Burn the single-use seal only now that it is verified, before payout.
                // The KV del is the single-use guard ONLY when the KV seal is the source
                // of truth; when we're paying from the durable seal, the seal-clear in
                // the success write below (under this same save lock) is the guard, so a
                // KV seal that already lapsed (consumed<=0) must NOT block the payout.
                const consumed = await kv.del(questKey);
                if (!durable && consumed <= 0) return answer({ ok: false, reason: 'none' });
                const countAfter = await kv.incr(countKey, { ex: 25 * 60 * 60 });

                const ryo = riftQuestRyo(num(char.level) || 1, def.weight);
                const totalRyo = num(char.ryo) + ryo;
                const totalFateShards = num(char.fateShards) + def.fateShards;
                const totalBoneCharms = num(char.boneCharms) + def.boneCharms;
                const cooldownUntil = Date.now() + RIFT_COOLDOWN_MS;

                const priorFirstClears = char.riftFirstClears && typeof char.riftFirstClears === 'object' && !Array.isArray(char.riftFirstClears)
                    ? char.riftFirstClears as Record<string, unknown>
                    : {};
                const firstClear = !Object.prototype.hasOwnProperty.call(priorFirstClears, def.id);
                const firstClearAt = firstClear ? bossReceipt!.clearedAt : num((priorFirstClears[def.id] as Record<string, unknown> | undefined)?.at);
                const riftFirstClears = firstClear
                    ? {
                        ...priorFirstClears,
                        [def.id]: {
                            at: firstClearAt,
                            runToken: bossReceipt!.runToken,
                            combatRunId: bossReceipt!.combatRunId,
                        },
                    }
                    : priorFirstClears;

                const updated = {
                    ...char, ryo: totalRyo, fateShards: totalFateShards, boneCharms: totalBoneCharms,
                    activeRiftQuest: null, riftCooldownUntil: cooldownUntil,
                    riftQuestBossReceipt: null,
                    riftFirstClears,
                };
                return {
                    ok: true,
                    character: updated,
                    recordPatch: { activeRiftQuestSeal: null },
                    value: {
                        body: {
                            ok: true, ryo, totalRyo,
                            fateShards: def.fateShards, totalFateShards,
                            boneCharms: def.boneCharms, totalBoneCharms,
                            cooldownUntil,
                            firstClear,
                            firstClearAt,
                            completedRiftId: def.id,
                        },
                        echo: true,
                    },
                    // A payout that loses its compare-and-set paid nothing. Put back
                    // what it spent ahead of the write: the KV seal (for a KV-only
                    // rift it is the only proof of the run) and the daily slot. Only
                    // this path writes either key, always under this save lock.
                    onConflict: async () => {
                        if (consumed > 0 && !(await kv.get(questKey))) {
                            const remaining = QUEST_TTL_SECONDS - Math.floor((Date.now() - num(sealed.at)) / 1000);
                            if (remaining > 0) await kv.set(questKey, sealed, { ex: remaining });
                        }
                        if (await kv.get<number>(countKey) === countAfter) await kv.set(countKey, countAfter - 1, { ex: 25 * 60 * 60 });
                    },
                };
            });
            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        // ── ABANDON: clear the sealed rift ───────────────────────────────────
        if (action === 'abandon') {
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ record: rec, character: char }) => {
                await kv.del(questKey).catch(() => undefined);
                if (!char.activeRiftQuest && rec.activeRiftQuestSeal == null) {
                    return { ok: true, write: false, character: char, value: { body: { ok: true }, echo: true } };
                }
                return {
                    ok: true,
                    character: { ...char, activeRiftQuest: null, riftQuestBossReceipt: null },
                    recordPatch: { activeRiftQuestSeal: null },
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
            return res.status(503).json({ error: 'Could not update the rift — please retry.' });
        }
        console.error('[sector/rift-quest]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
