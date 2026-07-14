import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { applyTrainingGrant } from './_grant.js';
import { parseLegacyTraining } from './_legacy.js';
import { gainXp } from '../_xp-engine.js';
import { MAX_TRAINING_RECEIPTS, activeTrainingMatches, storedTrainingGrant } from './_session.js';

interface TrainingToken {
    playerName: string;
    stat: string;
    tierId: string;
    startedAt: number;
    endsAt: number;
    sealedGain: number;
    sealedXp: number;
}

interface TrainingRedemption {
    token: string;
    stat: string;
    gain: number;
    xp: number;
    applied: number;
    cap: number;
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
        const legacy = body.legacy === true;
        const cancel = body.cancel === true;
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!token && !legacy) return res.status(400).json({ error: 'Missing training token.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only complete your own training.' });

        const tokenKey = token ? `training-token:${playerName}:${token}` : '';
        const saveKey = `save:${playerName}`;
        const now = Date.now();
        const result = await withKvLock(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const character = record?.character as Record<string, unknown> | undefined;
            if (!record || !character) return { ok: false as const, status: 404, error: 'Player save not found.' };
            const receipts = Array.isArray(record._trainingReceipts)
                ? record._trainingReceipts.filter((v): v is string => typeof v === 'string')
                : [];
            const legacyData = legacy ? parseLegacyTraining(record.activeTraining) : null;
            if (legacy && !legacyData) return { ok: false as const, status: 409, error: 'No eligible legacy training session was found.' };
            const redemptionToken = legacyData?.token ?? token;
            if (receipts.includes(token)) {
                return {
                    ok: true as const,
                    character,
                    activeTraining: record.activeTraining ?? null,
                    _saveVersion: Number(record._saveVersion ?? 0),
                    value: { granted: true, alreadyGranted: true, token: redemptionToken },
                };
            }

            // A delayed completion from an older tab must never clear a newer
            // session that the player started after collecting. Receipts make a
            // genuine retry idempotent above; every first-time redemption must
            // still own the active lease stored on the save.
            if (!legacyData && !activeTrainingMatches(record.activeTraining, token)) {
                return { ok: false as const, status: 409, error: 'This training session is no longer active. Refresh to load the current session.' };
            }

            // The cache token speeds up redemption, but the protected save lease
            // is durable claim authority. This keeps legitimately earned training
            // collectible after the cache TTL without weakening token matching.
            const data = legacyData ?? await kv.get<TrainingToken>(tokenKey) ?? storedTrainingGrant(record.activeTraining, token);
            if (!data) return { ok: false as const, status: 409, error: 'Training token is invalid or already spent.' };
            const sealedPlayerName = 'playerName' in data && typeof data.playerName === 'string' ? data.playerName : '';
            if (sealedPlayerName && sealedPlayerName.toLowerCase() !== playerName.toLowerCase()) {
                return { ok: false as const, status: 403, error: 'Training token does not belong to this player.' };
            }
            if (!cancel && now < data.endsAt) {
                return { ok: false as const, status: 409, error: `Training is not finished. ${data.endsAt - now}ms remaining.` };
            }

            let gain = Math.max(0, Math.floor(data.sealedGain));
            let xp = Math.max(0, Math.floor(data.sealedXp));
            if (cancel) {
                const totalMs = data.endsAt - data.startedAt;
                const fraction = totalMs > 0 ? Math.max(0, Math.min(1, (now - data.startedAt) / totalMs)) : 1;
                gain = Math.floor(gain * fraction);
                xp = Math.floor(xp * fraction);
            }
            const leveled = gainXp(character, xp) as Record<string, unknown>;
            const grant = applyTrainingGrant(leveled, data.stat, gain, 0);
            const redemption: TrainingRedemption = { token: redemptionToken, stat: data.stat, gain, xp, applied: grant.applied, cap: grant.cap };
            const nextReceipts = [...receipts.filter((entry) => entry !== redemptionToken), redemptionToken].slice(-MAX_TRAINING_RECEIPTS);
            const nextCharacter = { ...grant.character, redeemedTrainingTokens: [redemption] };
            const written = await writeVersionedPlayerSave(saveKey, {
                ...record,
                _trainingReceipts: nextReceipts,
                activeTraining: null,
            }, nextCharacter);
            return { ok: true as const, character: nextCharacter, activeTraining: null, _saveVersion: written._saveVersion, value: { granted: true, alreadyGranted: false, ...redemption } };
        }, { failClosed: true });

        if (!result.ok) return res.status(result.status).json({ error: result.error });
        if (tokenKey) await kv.del(tokenKey).catch(() => console.error('active-session cleanup failed after durable receipt'));
        if (!result.activeTraining) {
            await kv.del(`training-active:${playerName}`).catch(() => console.error('active-session cleanup failed after durable receipt'));
        }
        return res.status(200).json({ ok: true, ...result.value, character: result.character, activeTraining: result.activeTraining, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
