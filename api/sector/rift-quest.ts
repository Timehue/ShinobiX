import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    RIFT_QUESTS, RIFT_DAILY_CAP, RIFT_COOLDOWN_MS,
    isRiftQuestId, riftQuestRyo, riftBossKilled, riftTargetSector,
    parseRiftQuestSeal, type RiftQuestSeal,
} from './_rift-quest.js';

/*
 * /api/sector/rift-quest — POST { action: 'accept' | 'complete' | 'abandon', playerName, riftId? }
 *
 * Server-authoritative wandering-AI RIFT quest (a scaled event Hollow Gate). The
 * Hollow-Gate-boss-kill baseline (character.hollowGateWardenKills — the counter the
 * shrine boss bumps on defeat, NOT totalAiKills, which the Hollow Gate combat path
 * never touches) + target sector are sealed in KV at accept; at complete the server
 * verifies that counter advanced (the boss fell) and pays a recomputed reward,
 * single-use, daily-capped, under the fail-closed save lock. The client flushes the
 * bumped save to the server BEFORE calling complete, so the read is not racy. The
 * character.activeRiftQuest field is a DISPLAY mirror only. No Hollow Gate code is
 * touched — the reward is gated on the boss-kill counter, not the run itself.
 */

const QUEST_TTL_SECONDS = 7 * 24 * 60 * 60;
const questKeyFor = (player: string) => `rift-quest:${player}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);

type Sealed = RiftQuestSeal;

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
            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                // Busy if a seal exists in EITHER store — the durable one still marks
                // an active rift after the KV seal's 7d TTL lapses (or a migration).
                if (parseRiftQuestSeal(rec.activeRiftQuestSeal) ?? parseRiftQuestSeal(await kv.get(questKey))) {
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                }
                if (num(char.level) < def.levelReq) return { status: 200, body: { ok: false, reason: 'level' } };
                if (Date.now() < num(char.riftCooldownUntil)) return { status: 200, body: { ok: false, reason: 'cooldown' } };

                const targetSector = riftTargetSector(playerName, def.id);
                const baseline = num(char.hollowGateWardenKills);
                const sealed: Sealed = { id: def.id, targetSector, baseline, at: Date.now() };
                await kv.set(questKey, sealed, { ex: QUEST_TTL_SECONDS });
                const activeRiftQuest = { id: def.id, targetSector, stage: 'travel' as const, baseline, bossName: def.bossName };
                const updated = { ...char, activeRiftQuest };
                // Durable seal on the save record (server-owned; SERVER_LEDGER_TOPLEVEL_FIELDS)
                // so an in-flight rift survives the KV TTL and the Postgres cutover.
                await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeRiftQuestSeal: sealed, character: updated }), rec));
                return { status: 200, body: { ok: true, activeRiftQuest } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        // ── COMPLETE: verify the boss kill, pay, stamp cooldown ──────────────
        if (action === 'complete' && def) {
            const today = utcDateKey();
            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
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
                        const updated = { ...char, activeRiftQuest: null };
                        await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeRiftQuestSeal: null, character: updated }), rec));
                        return { status: 200, body: { ok: false, reason: 'none', activeRiftQuest: null, character: updated } };
                    }
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                if (sealed.id !== def.id) return { status: 200, body: { ok: false, reason: 'none' } };

                if (!riftBossKilled(num(sealed.baseline), num(char.hollowGateWardenKills))) {
                    // Migrate a KV-only legacy seal onto the durable save so it survives
                    // the TTL / a future cutover if the boss is cleared later.
                    if (!durable) {
                        await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeRiftQuestSeal: sealed }), rec));
                    }
                    return { status: 200, body: { ok: false, reason: 'incomplete' } };
                }
                const countKey = `rift-quest-count:${playerName}:${today}`;
                if (num(await kv.get<number>(countKey)) >= RIFT_DAILY_CAP) {
                    return { status: 200, body: { ok: false, reason: 'daily-cap' } };
                }
                // Burn the single-use seal only now that it is verified, before payout.
                // The KV del is the single-use guard ONLY when the KV seal is the source
                // of truth; when we're paying from the durable seal, the seal-clear in
                // the success write below (under this same save lock) is the guard, so a
                // KV seal that already lapsed (consumed<=0) must NOT block the payout.
                const consumed = await kv.del(questKey);
                if (!durable && consumed <= 0) return { status: 200, body: { ok: false, reason: 'none' } };
                await kv.incr(countKey, { ex: 25 * 60 * 60 });

                const ryo = riftQuestRyo(num(char.level) || 1, def.weight);
                const totalRyo = num(char.ryo) + ryo;
                const totalFateShards = num(char.fateShards) + def.fateShards;
                const totalBoneCharms = num(char.boneCharms) + def.boneCharms;
                const cooldownUntil = Date.now() + RIFT_COOLDOWN_MS;

                const updated = {
                    ...char, ryo: totalRyo, fateShards: totalFateShards, boneCharms: totalBoneCharms,
                    activeRiftQuest: null, riftCooldownUntil: cooldownUntil,
                };
                await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeRiftQuestSeal: null, character: updated }), rec));
                return {
                    status: 200,
                    body: {
                        ok: true, ryo, totalRyo,
                        fateShards: def.fateShards, totalFateShards,
                        boneCharms: def.boneCharms, totalBoneCharms,
                        cooldownUntil,
                    },
                };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        // ── ABANDON: clear the sealed rift ───────────────────────────────────
        if (action === 'abandon') {
            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                await kv.del(questKey).catch(() => undefined);
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (rec && char) {
                    const updated = { ...char, activeRiftQuest: null };
                    await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, activeRiftQuestSeal: null, character: updated }), rec));
                }
                return { status: 200, body: { ok: true } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not update the rift — please retry.' });
        }
        console.error('[sector/rift-quest]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
