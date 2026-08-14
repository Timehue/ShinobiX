import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, parseJsonBody, safeName } from '../_utils.js';
import { safeLogValue } from '../_safe-log.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { chronicleUnlocked } from './_starter-cards.js';
import { backfillChronicleProgressionCards } from './_progression-cards.js';

/**
 * Idempotent migration/repair endpoint for the Living Chronicle. Card Hall
 * calls it on entry so accounts created before progression grants shipped are
 * repaired from server-owned story/Legacy state before their collection is
 * rendered. No ids are accepted from the client.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const parsed = parseJsonBody(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const body = parsed.body as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        // Resolve an explicit caller identity before binding authentication to
        // the body target. Otherwise a valid player-A token aimed at player B
        // is collapsed to "unauthenticated" inside authedPlayer and the 403
        // ownership branch below is unreachable. Keep the body-scoped fallback
        // solely for the documented legacy password-only shape, where no
        // x-player-name header exists and the route/body supplies the account.
        const explicitIdentity = await authedPlayerOrAdmin(req);
        const mayUseBodyScopedPassword = !req.headers['x-player-name'] && !!req.headers['x-player-password'];
        const identity = explicitIdentity
            ?? (mayUseBodyScopedPassword ? await authedPlayerOrAdmin(req, playerName) : null);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your Chronicle.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'chronicle-sync-progression', 12, 60_000, identity.name))) return;

        const result = await mutatePlayerSave(playerName, ({ character }) => {
            if (!chronicleUnlocked(character)) {
                return { ok: false as const, status: 409, error: 'chronicle-locked' };
            }
            const repaired = backfillChronicleProgressionCards(character);
            return {
                ok: true as const,
                character: repaired.character,
                value: { granted: repaired.granted },
                // A routine Card Hall visit is a read when the collection is
                // already current. Do not manufacture a save-version bump (and
                // a needless cross-device conflict) for an identical snapshot.
                write: repaired.granted.length > 0,
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({
            ok: true,
            granted: result.value.granted,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (error) {
        console.error('[card-clash/sync-progression]', safeLogValue(error));
        return res.status(500).json({ error: 'The Living Chronicle could not be reconciled. Please retry.' });
    }
}
