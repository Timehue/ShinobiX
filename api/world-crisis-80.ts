import type { VercelRequest, VercelResponse } from './_vercel.js';
import { isFullAdmin } from './_auth.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { cors } from './_utils.js';
import {
    applyWorldCrisis80AdminAction,
    readWorldCrisis80Projection,
    type WorldCrisis80AdminAction,
} from './world-crisis-80/_state.js';

const ADMIN_ACTIONS = new Set<WorldCrisis80AdminAction>([
    'arm',
    'stand-down',
    'awaken-now',
    'resolve',
    'set-target',
]);

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'World crisis request failed.';
}

/** Public level-80 crisis projection plus full-admin lifecycle controls. Battle
 * contributions never enter here; only a terminal server-owned fight proof may
 * advance a village. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            if (!(await enforceRateLimitKv(req, res, 'world-crisis-80-read', 90, 60_000, null))) return;
            return res.status(200).json({ crisis: await readWorldCrisis80Projection() });
        }
        if (req.method !== 'POST') return res.status(405).end();
        if (!isFullAdmin(req)) return res.status(401).json({ error: 'Admin authentication required.' });
        if (!(await enforceRateLimitKv(req, res, 'world-crisis-80-admin', 30, 60_000, 'admin'))) return;

        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        if (!ADMIN_ACTIONS.has(action as WorldCrisis80AdminAction)) {
            return res.status(400).json({ error: 'Unknown level-80 world crisis action.' });
        }
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
        if ((action === 'stand-down' || action === 'resolve') && !reason) {
            return res.status(400).json({ error: 'A reason is required for this lifecycle override.' });
        }
        const crisis = await applyWorldCrisis80AdminAction({
            action: action as WorldCrisis80AdminAction,
            targetPerVillage: body.targetPerVillage,
            creditPlayerName: typeof body.creditPlayer === 'string' ? body.creditPlayer : undefined,
            actor: reason ? `admin:${reason}` : 'admin',
        });
        return res.status(200).json({ ok: true, crisis });
    } catch (error) {
        console.error('[world-crisis-80]', error);
        const message = errorMessage(error);
        const status = /Only |not waiting|not active|lock/i.test(message) ? 409 : 500;
        return res.status(status).json({ error: status === 500 ? 'Internal server error.' : message });
    }
}
