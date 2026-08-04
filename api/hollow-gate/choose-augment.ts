import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { AUGMENT_CATALOG, augmentDisplay, hollowGateRunKey, hollowGateRunsEnabled, type HollowGateRunToken } from './_run-token.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';

/*
 * /api/hollow-gate/choose-augment  — POST only
 *
 * Re-seals an open run token with the player's chosen augment (which must be one
 * of the three the SERVER offered at start — the client can't smuggle in an
 * augment it wasn't offered). The reward multiplier stays sealed server-side;
 * settle reads it from chosenAugmentId, never from the client.
 * Body: { playerName, token, augmentId }.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const augmentId = String(body.augmentId ?? '').slice(0, 48);
        if (!playerName || !token || !augmentId) return res.status(400).json({ error: 'Missing playerName, token, or augmentId.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!hollowGateRunsEnabled()) {
            return res.status(503).json({ error: 'Hollow Gate runs are temporarily unavailable until server settlement is complete.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-choose', 30, 60_000, identity.name))) return;

        const key = hollowGateRunKey(playerName, token);
        const result = await withKvLock(key, async () => {
            const run = await kv.get<HollowGateRunToken>(key);
            if (!run) return { status: 200, body: { ok: true, reason: 'invalid-or-spent' } };
            if (run.playerName.toLowerCase() !== playerName.toLowerCase()) return { status: 403, body: { error: 'Not your run.' } };
            if (run.chosenAugmentId) return { status: 200, body: { ok: true, reason: 'already-chosen', chosenAugmentId: run.chosenAugmentId } };
            if (!run.offeredAugmentIds.includes(augmentId) || !AUGMENT_CATALOG[augmentId]) {
                return { status: 400, body: { error: 'That augment was not offered for this run.' } };
            }
            await kv.set(key, { ...run, chosenAugmentId: augmentId });
            return { status: 200, body: { ok: true, chosenAugmentId: augmentId } };
        }, { failClosed: true, ttlSec: 10 });
        const chosenAugmentId = typeof result.body === 'object' && result.body && 'chosenAugmentId' in result.body
            ? String((result.body as { chosenAugmentId?: unknown }).chosenAugmentId ?? '')
            : '';
        if (result.status === 200 && chosenAugmentId && AUGMENT_CATALOG[chosenAugmentId]) {
            // Keep the refresh projection aligned with the sealed choice. A
            // failed projection write is recoverable: replaying this endpoint
            // reads the existing KV choice and retries the same save update.
            const projection = await mutatePlayerSave(playerName, ({ character }) => {
                const savedRun = character.hollowGateRun && typeof character.hollowGateRun === 'object'
                    ? character.hollowGateRun as Record<string, unknown>
                    : null;
                if (!savedRun || savedRun.runToken !== token) {
                    return { ok: true as const, character, value: null };
                }
                return {
                    ok: true as const,
                    character: {
                        ...character,
                        hollowGateRun: {
                            ...savedRun,
                            chosenAugment: augmentDisplay(AUGMENT_CATALOG[chosenAugmentId]),
                        },
                    },
                    value: null,
                };
            });
            if (!projection.ok) return res.status(503).json({ error: 'The augment was sealed; retry to synchronize the saved run.' });
        }
        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[hollow-gate/choose-augment]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
