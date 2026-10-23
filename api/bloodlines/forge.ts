import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyBloodlineForgePurchase } from './_forge.js';
import { recordEconomyTxn } from '../_economy.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only begin your own Bloodline Awakening.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'bloodline-forge', 6, 60_000, identity.name))) return;

        const result = await mutatePlayerSave(playerName, ({ character, record }) => {
            const purchase = applyBloodlineForgePurchase(
                character,
                record.pendingBloodlineForges,
                body.rank,
                randomUUID(),
                Date.now(),
                body.resumeOnly === true,
            );
            if (!purchase.ok) return purchase;
            return {
                ok: true as const,
                character: purchase.character,
                ...(purchase.resumed ? { write: false as const } : { recordPatch: { pendingBloodlineForges: purchase.pending } }),
                value: {
                    rank: purchase.entitlement.rank,
                    currency: purchase.currency,
                    cost: purchase.cost,
                    balance: purchase.balance,
                    resumed: purchase.resumed,
                },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        // Economy telemetry (I-19): the ritual's material sink, after the commit.
        // A resumed entitlement was paid earlier and charges 0, so it logs nothing.
        if (!result.value.resumed && result.value.cost > 0) {
            void recordEconomyTxn({
                txnId: `bloodline-forge:${playerName}:${result._saveVersion}`,
                player: playerName,
                currency: result.value.currency,
                delta: -result.value.cost,
                source: 'bloodline.forge',
                balanceAfter: result.value.balance,
            });
        }
        return res.status(200).json({
            ok: true,
            ...result.value,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (err) {
        console.error('[bloodlines/forge]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
