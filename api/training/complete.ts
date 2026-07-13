import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors, setSafeRecordValue } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { gainXp, type XpCharacter } from '../_xp-engine.js';
import { statCapForLevel } from '../combat-core/formulas.js';
import { writeVersionedPlayerSave, type PlayerSaveRecord, type PlayerCharacter } from '../save/_mutate-player-save.js';
import {
    MAX_TRAINING_RECEIPTS,
    activeTrainingMatches,
    normalizeActiveTrainingSession,
    type ActiveTrainingSession,
} from './_session.js';

/*
 * /api/training/complete — POST only
 *
 * Redeems a stat-training token minted by /api/training/start. Verifies ownership
 * and the time-gate, then atomically consumes the single-use token (so a session
 * can't be collected twice) and returns the SEALED stat gain + XP for the client
 * to apply. `cancel: true` collects early, prorating the sealed reward by the
 * fraction of the tier that has elapsed (matches the client's "keep prorated
 * stats"). A not-yet-complete peek does NOT consume the token, so the player can
 * retry once the timer is up. The single-session lease is cleared only after the
 * reward receipt and updated character are durably written. A missing expired
 * token clears its stale lease without granting a reward.
 *
 * Body: { playerName, token, cancel? }
 */

interface TrainingToken {
    playerName: string;
    stat: string;
    tierId: string;
    startedAt: number;
    endsAt: number;
    sealedGain: number;
    sealedXp: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'training-complete', 8, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const tokenRaw = typeof body.token === 'string' ? body.token.trim() : '';
        const token = /^[A-Za-z0-9]+$/.test(tokenRaw) ? tokenRaw : '';
        const cancel = body.cancel === true;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!token) return res.status(400).json({ error: 'Missing training token.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only complete your own training.' });
        }

        const tokenKey = `training-token:${playerName}:${token}`;
        const saveKey = `save:${playerName}`;
        const activeKey = `training-active:${playerName}`;
        const outcome = await withKvLock(saveKey, async () => {
            const record = await kv.get<PlayerSaveRecord>(saveKey);
            const character = (record?.character ?? null) as PlayerCharacter | null;
            if (!record || !character) {
                return { status: 404 as const, body: { error: 'Player save not found.' } };
            }

            const activeRaw = await kv.get<ActiveTrainingSession>(activeKey);
            const active = normalizeActiveTrainingSession(activeRaw);
            const activeMatches = activeTrainingMatches(active, token);
            const persistedActive = record.activeTraining && typeof record.activeTraining === 'object'
                ? record.activeTraining as Record<string, unknown>
                : null;
            const persistedToken = typeof persistedActive?.token === 'string' ? persistedActive.token : '';
            const staleSessionMatches = activeMatches || (!active && persistedToken === token);

            const receipts = Array.isArray(record._trainingReceipts)
                ? record._trainingReceipts.filter((value): value is string => typeof value === 'string').slice(-MAX_TRAINING_RECEIPTS)
                : [];
            if (receipts.includes(token)) {
                await kv.del(tokenKey).catch(() => undefined);
                if (activeMatches) await kv.del(activeKey).catch(() => undefined);
                return { status: 200 as const, body: { ok: true, granted: false, reason: 'already-granted' } };
            }

            const data = await kv.get<TrainingToken>(tokenKey);
            if (!data) {
                // The token TTL and active lease share an expiry. If either was
                // lost independently, clear only the matching stale lease. No
                // reward is granted without the sealed token.
                if (staleSessionMatches) {
                    await writeVersionedPlayerSave(saveKey, { ...record, activeTraining: null }, character);
                    if (activeMatches) await kv.del(activeKey).catch(() => undefined);
                }
                return {
                    status: 200 as const,
                    body: { ok: true, granted: false, reason: 'invalid-or-spent-token', staleSessionCleared: staleSessionMatches },
                };
            }
            if ((data.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return { status: 403 as const, body: { error: 'Training token does not belong to this player.' } };
            }
            if (active && !activeMatches) {
                return { status: 409 as const, body: { error: 'This is not the active training session.' } };
            }

            const now = Date.now();
            if (!cancel && now < data.endsAt) {
                return {
                    status: 200 as const,
                    body: { ok: true, granted: false, reason: 'not-yet-complete', remainingMs: data.endsAt - now },
                };
            }

            let gain = Math.max(0, Math.floor(data.sealedGain));
            let xp = Math.max(0, Math.floor(data.sealedXp));
            if (cancel) {
                const totalMs = data.endsAt - data.startedAt;
                const frac = totalMs > 0 ? Math.max(0, Math.min(1, (now - data.startedAt) / totalMs)) : 1;
                gain = Math.floor(gain * frac);
                xp = Math.floor(xp * frac);
            }

            const leveled = gainXp(character as unknown as XpCharacter, xp) as unknown as PlayerCharacter;
            const stats = (leveled.stats && typeof leveled.stats === 'object')
                ? leveled.stats as Record<string, unknown>
                : {};
            const currentStat = Math.max(0, Math.floor(Number(stats[data.stat]) || 0));
            const cap = statCapForLevel(Math.max(1, Math.floor(Number(leveled.level) || 1)));
            const applied = Math.max(0, Math.min(gain, cap - currentStat));
            const nextStats = { ...stats };
            setSafeRecordValue(nextStats, data.stat, currentStat + applied);
            const nextCharacter: PlayerCharacter = {
                ...leveled,
                totalStatsTrained: Math.max(0, Math.floor(Number(leveled.totalStatsTrained) || 0)) + applied,
                stats: nextStats,
            };
            const nextReceipts = [...receipts.filter((receipt) => receipt !== token), token].slice(-MAX_TRAINING_RECEIPTS);
            const saved = await writeVersionedPlayerSave(
                saveKey,
                { ...record, _trainingReceipts: nextReceipts, activeTraining: null },
                nextCharacter,
            );
            await kv.del(tokenKey).catch((error) => {
                console.error('[training/complete] token cleanup failed after durable receipt:', error);
            });
            if (activeMatches) {
                await kv.del(activeKey).catch((error) => {
                    console.error('[training/complete] active-session cleanup failed after durable receipt:', error);
                });
            }

            return {
                status: 200 as const,
                body: {
                    ok: true,
                    granted: true,
                    stat: data.stat,
                    gain,
                    applied,
                    xp,
                    cap,
                    character: nextCharacter,
                    _saveVersion: saved._saveVersion,
                },
            };
        }, { failClosed: true });

        return res.status(outcome.status).json(outcome.body);
    } catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
