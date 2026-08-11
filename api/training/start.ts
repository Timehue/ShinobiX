import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { TRAINING_TIERS } from '../_training-config.js';
import { moraleForCharacter, applyMoraleToGain } from '../_war-morale.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { activeTrainingBlocksStart, normalizeActiveTrainingSession, trustedTrainingRewards, TRAINING_TOKEN_TTL_SECONDS } from './_session.js';

/*
 * /api/training/start — POST only
 *
 * Mints a single-use token for a stat-training session (two-axis training; see
 * docs/leveling-training-redesign-plan.md). The chosen stat, tier, start/end
 * timestamps and the AUTHORITATIVE stat gain + XP trickle are SEALED into the
 * token here so /api/training/complete pays the stored save from the sealed
 * values, not the client body. The gain is computed from the tier rate and a CLAMPED
 * client-reported training bonus (village/clan bonus formula lives in a client
 * lib; clamping it here bounds the trust surface).
 *
 * Gates: a daily mint cap + a per-session time-gate (complete can't redeem before
 * endsAt). Start also debits stamina and persists activeTraining under the same
 * save lock; the client never applies a local fallback grant.
 *
 * Body: { playerName, stat, tierId }
 * Token: `training-token:<player>:<uuid>`, single-use (complete deletes on redeem).
 */

const STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];
// Generous anti-abuse ceiling, not a play-limit: an idle player restarts the 8h
// tier ~3×/day; an active short-tier player far more. Well above legit cadence.
const MAX_TRAINING_STARTS_PER_DAY = 96;
// Clamp the client-reported village/clan training bonus. The real max is well
// under this; the clamp bounds how much a tampered body can inflate the seal.
// Covers the 8h max tier + a long collect window (a player may close the game for
// days). The single-use deletion + time-gate + daily cap are the real bounds.
const TOKEN_TTL_SECONDS = TRAINING_TOKEN_TTL_SECONDS;
const MAX_SAVE_CAS_ATTEMPTS = 4;

function isPlayerSaveVersionConflict(error: unknown): boolean {
    return error instanceof Error && error.message === 'player-save-version-conflict';
}

async function publishTrainingCaches(params: {
    playerName: string;
    tokenId: string;
    stat: string;
    tierId: string;
    startedAt: number;
    endsAt: number;
    sealedGain: number;
    sealedXp: number;
    activeTraining: Record<string, unknown>;
}): Promise<void> {
    // activeTraining on the save is durable claim authority. These rows are
    // acceleration/compatibility caches, so failures must never turn a
    // committed start into a 500.
    await Promise.all([
        kv.set(`training-token:${params.playerName}:${params.tokenId}`, {
            playerName: params.playerName,
            stat: params.stat,
            tierId: params.tierId,
            startedAt: params.startedAt,
            endsAt: params.endsAt,
            sealedGain: params.sealedGain,
            sealedXp: params.sealedXp,
        }, { ex: TOKEN_TTL_SECONDS }).catch(() => console.error('[training/start] token cache publish failed after durable save')),
        kv.set(`training-active:${params.playerName}`, params.activeTraining, { ex: TOKEN_TTL_SECONDS })
            .catch(() => console.error('[training/start] active cache publish failed after durable save')),
    ]);
}

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'training-start', 6, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const stat = STAT_KEYS.includes(body.stat) ? String(body.stat) : null;
        const tier = TRAINING_TIERS.find((t) => t.id === body.tierId) ?? null;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!stat) return res.status(400).json({ error: 'Invalid stat.' });
        if (!tier) return res.status(400).json({ error: 'Invalid training tier.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own training.' });
        }

        // Daily mint cap, read-check-increment under a lock so concurrent starts
        // can't both slip past the boundary. Fail-open (no failClosed): a rare
        // over-mint costs a bounded stat gain, and we'd rather start than 500.
        const today = utcDateKey();
        const dailyKey = `training-start-count:${playerName}:${today}`;
        const capCheck = await withKvLock(dailyKey, async () => {
            const startedToday = Number((await kv.get<number>(dailyKey)) ?? 0);
            if (startedToday >= MAX_TRAINING_STARTS_PER_DAY) return { capped: true as const };
            await kv.set(dailyKey, startedToday + 1, { ex: 25 * 60 * 60 }).catch(() => undefined);
            return { capped: false as const };
        });
        if (capCheck.capped) {
            return res.status(200).json({ ok: true, reason: 'daily-training-cap', token: null });
        }

        const startedAt = Date.now();
        const endsAt = startedAt + tier.ms;
        const expiresAt = startedAt + TOKEN_TTL_SECONDS * 1000;
        // Keep one proposal token across CAS retries so an exact readback can
        // prove that this request (and not another start) committed.
        const tokenId = randomUUID().replace(/-/g, '');
        const saveKey = `save:${playerName}`;
        const result = await withKvLock(saveKey, async () => {
            for (let attempt = 0; attempt < MAX_SAVE_CAS_ATTEMPTS; attempt += 1) {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const character = record?.character as Record<string, unknown> | undefined;
                if (!record || !character) return { ok: false as const, status: 404, error: 'Player save not found.' };

                const prior = normalizeActiveTrainingSession(record.activeTraining);
                if (activeTrainingBlocksStart(prior)) {
                    return { ok: false as const, status: 409, error: 'A training session is already active.' };
                }
                const stamina = Math.max(0, Number(character.stamina) || 0);
                if (stamina < tier.staminaCost) return { ok: false as const, status: 409, error: 'Not enough stamina.' };

                // Seal inside the lock, from the LOCKED save: the growth bonus
                // (village/elder/clan) and the era dial are server-derived — the
                // client body contributes nothing to the amount.
                const trusted = trustedTrainingRewards(tier, character);
                // Village war MORALE, applied at the SEAL — this is the only seam that
                // works, because the gain is sealed here and paid out verbatim at
                // completion. A rallying village receives its comeback multiplier,
                // read from authoritative village-state rather than the client.
                const morale = await moraleForCharacter(character, startedAt);
                const sealedGain = applyMoraleToGain(trusted.sealedGain, morale.xpMult);
                const sealedXp = applyMoraleToGain(trusted.sealedXp, morale.xpMult);
                const bonusPct = trusted.bonusPct;
                const activeTraining = {
                    label: `${tier.label} ${stat} Training`, stat, xp: sealedXp, statGain: sealedGain,
                    staminaCost: tier.staminaCost, startedAt, endsAt, expiresAt, durationMs: tier.ms, token: tokenId,
                };
                const nextCharacter = { ...character, stamina: stamina - tier.staminaCost };
                try {
                    // `record` is the exact predecessor. activeTraining belongs in
                    // the next-record patch; adding it to the predecessor makes a
                    // first start fail exact CAS every time.
                    const written = await writeVersionedPlayerSave(saveKey, record, nextCharacter, { activeTraining });
                    // Publish while the save lock is still held. Publishing after
                    // release lets an immediate completion/successor start win,
                    // then be overwritten by this older request's delayed cache.
                    await publishTrainingCaches({
                        playerName, tokenId, stat, tierId: tier.id, startedAt, endsAt,
                        sealedGain, sealedXp, activeTraining,
                    });
                    return { ok: true as const, tokenId, activeTraining, character: nextCharacter, _saveVersion: written._saveVersion, sealedGain, sealedXp, bonusPct, morale: morale.morale };
                } catch (error) {
                    // writeVersionedPlayerSave already recovers an ambiguous CAS
                    // acknowledgement. The token readback also covers a failure in
                    // post-CAS projection work and returns the newest durable view.
                    const readback = await kv.get<Record<string, unknown>>(saveKey).catch(() => null);
                    const durable = normalizeActiveTrainingSession(readback?.activeTraining);
                    const durableCharacter = readback?.character as Record<string, unknown> | undefined;
                    if (durable?.token === tokenId && durableCharacter) {
                        const durableActiveTraining = readback!.activeTraining as typeof activeTraining;
                        await publishTrainingCaches({
                            playerName, tokenId, stat, tierId: tier.id, startedAt, endsAt,
                            sealedGain, sealedXp, activeTraining: durableActiveTraining,
                        });
                        return {
                            ok: true as const,
                            tokenId,
                            activeTraining: durableActiveTraining,
                            character: durableCharacter,
                            _saveVersion: Number(readback?._saveVersion ?? 0),
                            sealedGain,
                            sealedXp,
                            bonusPct,
                            morale: morale.morale,
                        };
                    }
                    if (isPlayerSaveVersionConflict(error)) {
                        // A normal autosave can outlive the shared lock TTL. Re-read
                        // its successor and recompute the debit/seal from that state;
                        // never overwrite it with the stale predecessor.
                        if (attempt + 1 < MAX_SAVE_CAS_ATTEMPTS) continue;
                        return { ok: false as const, status: 503, error: 'Your save changed while training was starting. Please retry.' };
                    }
                    throw error;
                }
            }
            return { ok: false as const, status: 503, error: 'Your save changed while training was starting. Please retry.' };
        }, { failClosed: true });
        if (!result.ok) return res.status(result.status).json({ error: result.error });

        return res.status(200).json({
            ok: true, token: result.tokenId, startedAt, endsAt, durationMs: tier.ms,
            sealedGain: result.sealedGain, sealedXp: result.sealedXp, bonusPct: result.bonusPct,
            activeTraining: result.activeTraining,
            character: result.character, _saveVersion: result._saveVersion,
        });
    } catch (err) {
        console.error('[training/start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
