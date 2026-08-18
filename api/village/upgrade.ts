import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { purchaseVillageUpgrade } from './_upgrade.js';

/*
 * /api/village/upgrade — POST { playerName, key }
 *
 * The seated Kage buys one level of a village upgrade out of the village
 * TREASURY's Honor Seal pool. The levels are village-wide: every member reads
 * them (see _upgrade.ts for why this moved off the character).
 *
 * Currency safety: the treasury is shared state, so the read-modify-write is
 * serialized on the village-state key with `failClosed` — the same shape
 * war-structure.ts uses for the same pool.
 */

const slug = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your upgrade.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-upgrade', 20, 60_000, identity.name))) return;

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = (save?.character ?? null) as Record<string, unknown> | null;
        if (!character) return res.status(404).json({ error: 'Player not found.' });
        const stateKey = `game:village-state:${slug(character.village)}`;

        const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(stateKey, async () => {
            const state = (await kv.get<Record<string, unknown>>(stateKey)) ?? {};
            if (!identity.admin && safeName(String(state.seatedKage ?? '')) !== playerName) {
                return { status: 403, body: { error: 'Only the seated Kage can upgrade village structures.' } };
            }
            const result = purchaseVillageUpgrade(state, body.key);
            if (!result.ok) {
                const message = result.reason === 'insufficient-treasury-seals'
                    ? 'The village treasury does not hold enough Honor Seals. Vanguards fund upgrades by donating seals.'
                    : result.reason;
                return { status: 409, body: { error: message, reason: result.reason } };
            }
            const treasury = (state.treasury && typeof state.treasury === 'object') ? state.treasury as Record<string, unknown> : {};
            await kv.set(stateKey, { ...state, treasury: { ...treasury, honorSeals: result.nextSeals }, upgrades: result.upgrades });
            return {
                status: 200,
                body: {
                    ok: true,
                    cost: result.cost,
                    level: result.level,
                    upgrades: result.upgrades,
                    treasuryHonorSeals: result.nextSeals,
                },
            };
        }, { failClosed: true });

        return res.status(out.status).json(out.body);
    } catch (error) {
        console.error('[village/upgrade]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
