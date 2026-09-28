import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isAdmin, isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { safeLogValue } from '../_safe-log.js';
import { recordAudit } from '../_audit.js';
import { COMBAT_USAGE_MODES, readCombatUsage, resetCombatUsage, type CombatUsageMode } from '../_combat-usage.js';

// Admin read of the combat usage telemetry (api/_combat-usage.ts).
//
//   GET    /api/admin/combat-usage?mode=ranked|pvp|pve|tower|clan-boss → { mode, usage }
//   DELETE /api/admin/combat-usage?mode=…                → { ok }   (full admin)
//
// Reading is open to either admin tier (it changes nothing). Resetting starts
// the count afresh, e.g. right after a rebalance, so it needs full admin.
function modeOf(req: VercelRequest): CombatUsageMode | null {
    const raw = String((req.query?.mode as string | undefined) ?? '').trim();
    return (COMBAT_USAGE_MODES as readonly string[]).includes(raw) ? raw as CombatUsageMode : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'DELETE') return res.status(405).end();
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    if (req.method === 'DELETE' && !isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-combat-usage', 60, 60_000)) return;
    res.setHeader('Cache-Control', 'no-store');

    const mode = modeOf(req);
    if (!mode) return res.status(400).json({ error: `mode must be one of ${COMBAT_USAGE_MODES.join(', ')}.` });
    try {
        if (req.method === 'DELETE') {
            const before = await readCombatUsage(mode);
            await resetCombatUsage(mode);
            await recordAudit({
                actor: 'admin', domain: 'combat', action: 'combat-usage.reset',
                entityType: 'combat-usage', entityId: mode,
                before: before ? { fights: before.fights, since: before.since } : null, after: null,
            });
            return res.status(200).json({ ok: true });
        }
        return res.status(200).json({ mode, usage: await readCombatUsage(mode) });
    } catch (err) {
        console.error('[admin/combat-usage]', safeLogValue(err));
        return res.status(503).json({ error: 'Combat usage storage is unavailable. Try again.' });
    }
}
