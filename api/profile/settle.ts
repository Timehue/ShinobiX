import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { recordEconomyTxn } from '../_economy.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { appendCustomTitleLog } from '../_titles-registry.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyProfileSettlement, parseProfileSettlementAction } from './_settlement.js';

/** Settle paid profile actions only from the stored character under its save lock. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const action = parseProfileSettlementAction(body.action);
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        if (!action) return res.status(400).json({ error: 'Unknown profile settlement action.' });

        const identityName = await authedPlayer(req, playerName);
        if (!identityName) return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName) return res.status(403).json({ error: 'You can only update your own profile.' });
        if (!(await enforceRateLimitKv(req, res, 'profile-settlement', 20, 60_000, identityName, { strict: true }))) return;

        const out = await mutatePlayerSave(playerName, ({ character }) => {
            const applied = applyProfileSettlement(character, action);
            if (!applied.ok) return applied;
            return {
                ok: true,
                character: applied.character,
                value: { changed: applied.changed, cost: applied.cost, action: applied.action },
            };
        });
        if (!out.ok) return res.status(out.status).json({ error: out.error });

        if (out.value.changed && out.value.cost > 0) {
            const now = Date.now();
            await recordEconomyTxn({
                txnId: `profile-settlement:${playerName}:${out.value.action}:${now}`,
                player: playerName,
                currency: 'fateShards',
                delta: -out.value.cost,
                source: `profile.${out.value.action}`,
                balanceAfter: Number(out.character.fateShards ?? 0),
            });
            if (action.type === 'purchase-title') await appendCustomTitleLog(playerName, String(out.character.customTitle ?? ''));
        }

        return res.status(200).json({
            ok: true,
            ...out.value,
            character: out.character,
            _saveVersion: out._saveVersion,
        });
    } catch (error) {
        console.error('[profile/settle]', safeLogValue(error));
        return res.status(503).json({ error: 'Could not update your profile. Please retry.' });
    }
}
