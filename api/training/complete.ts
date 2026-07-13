import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyTrainingGrant } from './_grant.js';
import { parseLegacyTraining } from './_legacy.js';

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
        const now = Date.now();
        const result = await mutatePlayerSave(playerName, async ({ record, character }) => {
            const redeemed = Array.isArray(character.redeemedTrainingTokens)
                ? (character.redeemedTrainingTokens as unknown[]).filter((v): v is TrainingRedemption => !!v && typeof v === 'object' && typeof (v as TrainingRedemption).token === 'string')
                : [];
            const legacyData = legacy ? parseLegacyTraining(record.activeTraining) : null;
            const priorLegacy = legacy && !record.activeTraining
                ? [...redeemed].reverse().find((entry) => entry.token.startsWith('legacy'))
                : undefined;
            if (priorLegacy) {
                return {
                    ok: true as const,
                    character,
                    recordPatch: { activeTraining: null },
                    value: { granted: true, alreadyGranted: true, ...priorLegacy },
                };
            }
            if (legacy && !legacyData) return { ok: false as const, status: 409, error: 'No eligible legacy training session was found.' };
            const redemptionToken = legacyData?.token ?? token;
            const prior = redeemed.find((entry) => entry.token === redemptionToken);
            if (prior) {
                return {
                    ok: true as const,
                    character,
                    recordPatch: { activeTraining: null },
                    value: { granted: true, alreadyGranted: true, ...prior },
                };
            }

            const data = legacyData ?? await kv.get<TrainingToken>(tokenKey);
            if (!data) return { ok: false as const, status: 409, error: 'Training token is invalid or already spent.' };
            if ('playerName' in data && (data.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
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
            const grant = applyTrainingGrant(character, data.stat, gain, xp);
            const redemption: TrainingRedemption = { token: redemptionToken, stat: data.stat, gain, xp, applied: grant.applied, cap: grant.cap };
            return {
                ok: true as const,
                character: { ...grant.character, redeemedTrainingTokens: [...redeemed.slice(-99), redemption] },
                recordPatch: { activeTraining: null },
                value: { granted: true, alreadyGranted: false, ...redemption },
            };
        });

        if (!result.ok) return res.status(result.status).json({ error: result.error });
        if (tokenKey) await kv.del(tokenKey).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
