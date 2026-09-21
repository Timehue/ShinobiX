import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isRankedFormatWeaponId } from './_ranked-format.js';

/**
 * Sets the player's Ranked Format weapon preference ahead of queueing for
 * ranked 1v1 or ranked 2v2 (both modes read the same
 * `character.rankedFormatWeaponId`; see api/pvp/_ranked-format.ts). The
 * generic save sanitizer (api/save/_sanitize-progression.ts) locks this field
 * to stored, so this endpoint is the ONLY way to change it.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const weaponId = String(body.weaponId ?? '');
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!isRankedFormatWeaponId(weaponId)) return res.status(400).json({ error: 'Invalid ranked weapon choice.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only set your own ranked weapon.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'ranked-format-weapon', 20, 60_000, identity.name))) return;

        const result = await mutatePlayerSave(playerName, ({ character }) => {
            if (character.rankedFormatWeaponId === weaponId) {
                return { ok: true as const, write: false, character, value: { weaponId } };
            }
            return { ok: true as const, character: { ...character, rankedFormatWeaponId: weaponId }, value: { weaponId } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, weaponId, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[pvp/ranked-format-weapon]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
