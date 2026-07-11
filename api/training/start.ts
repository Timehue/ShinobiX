import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { TRAINING_TIERS } from '../_training-config.js';
import { writeVersionedPlayerSave, type PlayerSaveRecord, type PlayerCharacter } from '../save/_mutate-player-save.js';
import {
    TRAINING_TOKEN_TTL_SECONDS,
    activeTrainingBlocksStart,
    normalizeActiveTrainingSession,
    trustedTrainingRewards,
    type ActiveTrainingSession,
} from './_session.js';

/*
 * /api/training/start — POST only
 *
 * Mints a single-use token for a stat-training session (two-axis training; see
 * docs/leveling-training-redesign-plan.md). The chosen stat, tier, start/end
 * timestamps and the AUTHORITATIVE stat gain + XP trickle are SEALED into the
 * token here so /api/training/complete pays out from the sealed values, not the
 * client body. Only base tier rewards are used until village/war modifiers can
 * be derived entirely from trusted server state.
 *
 * Gates: one live session per player, a daily mint cap, and a per-session
 * time-gate (complete can't redeem before endsAt). The client fails closed when
 * this endpoint is unavailable.
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

        // The active lease, daily cap, and stamina debit share one fail-closed
        // player-save lock so concurrent starts cannot cross any boundary.
        const today = utcDateKey();
        const dailyKey = `training-start-count:${playerName}:${today}`;
        const saveKey = `save:${playerName}`;
        const activeKey = `training-active:${playerName}`;
        const result = await withKvLock(saveKey, async () => {
            const record = await kv.get<PlayerSaveRecord>(saveKey);
            const character = (record?.character ?? null) as PlayerCharacter | null;
            if (!record || !character) {
                return { status: 404 as const, body: { error: 'Player save not found.' } };
            }

            // A missing or expired token cannot strand the account. Clear the
            // stale lease under the save lock before accepting a new session.
            const activeRaw = await kv.get<ActiveTrainingSession>(activeKey);
            const active = normalizeActiveTrainingSession(activeRaw);
            const activeTokenExists = !!active && active.expiresAt > Date.now()
                ? !!(await kv.get(`training-token:${playerName}:${active.token}`))
                : false;
            if (activeTrainingBlocksStart(active, activeTokenExists)) {
                return {
                    status: 409 as const,
                    body: {
                        error: 'A stat training session is already active.',
                        reason: 'training-already-active',
                        endsAt: active?.endsAt,
                    },
                };
            }
            if (activeRaw) await kv.del(activeKey);

            const startedToday = Math.max(0, Math.floor(Number((await kv.get<number>(dailyKey)) ?? 0)));
            if (startedToday >= MAX_TRAINING_STARTS_PER_DAY) {
                return { status: 429 as const, body: { error: 'Daily training start limit reached.', reason: 'daily-training-cap' } };
            }

            const stamina = Math.max(0, Math.floor(Number(character.stamina) || 0));
            if (stamina < tier.staminaCost) {
                return { status: 409 as const, body: { error: 'Not enough stamina.' } };
            }

            const startedAt = Date.now();
            const endsAt = startedAt + tier.ms;
            const expiresAt = startedAt + TRAINING_TOKEN_TTL_SECONDS * 1_000;
            const { sealedGain, sealedXp } = trustedTrainingRewards(tier);
            const tokenId = randomUUID().replace(/-/g, '');
            const tokenKey = `training-token:${playerName}:${tokenId}`;
            try {
                await kv.set(tokenKey, {
                    playerName, stat, tierId: tier.id, startedAt, endsAt, sealedGain, sealedXp,
                }, { ex: TRAINING_TOKEN_TTL_SECONDS });
                await kv.set(activeKey, {
                    token: tokenId, startedAt, endsAt, expiresAt,
                }, { ex: TRAINING_TOKEN_TTL_SECONDS });
                await kv.set(dailyKey, startedToday + 1, { ex: 25 * 60 * 60 });
                const nextCharacter: PlayerCharacter = { ...character, stamina: stamina - tier.staminaCost };
                const activeTraining = {
                    label: `${tier.label} ${stat} Training`,
                    stat,
                    xp: sealedXp,
                    statGain: sealedGain,
                    staminaCost: tier.staminaCost,
                    endsAt,
                    durationMs: tier.ms,
                    token: tokenId,
                };
                const saved = await writeVersionedPlayerSave(saveKey, { ...record, activeTraining }, nextCharacter);
                return {
                    status: 200 as const,
                    body: {
                        ok: true,
                        token: tokenId,
                        startedAt,
                        endsAt,
                        durationMs: tier.ms,
                        sealedGain,
                        sealedXp,
                        staminaCost: tier.staminaCost,
                        character: nextCharacter,
                        _saveVersion: saved._saveVersion,
                    },
                };
            } catch (error) {
                await kv.del(tokenKey).catch(() => undefined);
                await kv.del(activeKey).catch(() => undefined);
                throw error;
            }
        }, { failClosed: true });

        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[training/start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
