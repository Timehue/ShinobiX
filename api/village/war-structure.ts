import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { isWarVillage } from '../_war-map-sectors.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
    villageWarSlug,
    STRUCTURE_KEYS,
} from '../_war-state.js';
import { applyStructureUpgrade } from '../_war-structures.js';

/*
 * /api/village/war-structure — POST only
 *
 * Server-authoritative upgrade of a SHARED village-level war structure (§7, §17.4).
 * Only the seated Kage (or admin) may upgrade; the cost is Honor Seals taken from
 * the village TREASURY (not the player), recomputed server-side from the sealed
 * cost curve. The treasury debit and the structure level-up happen together under
 * locks (treasury outer, war-record inner, both failClosed) so seals can't be
 * spent without the level applying, and vice-versa.
 *
 * Server-gated: returns 404 unless ENABLE_VILLAGE_WAR=1 — the whole feature is OFF
 * by default, so this endpoint is inert until launch.
 *
 * Body: { playerName, village, structure }.
 */

const VILLAGE_STATE_PREFIX = 'game:village-state:';
function villageStateKey(village: string): string {
    return `${VILLAGE_STATE_PREFIX}${villageWarSlug(village)}`;
}
// Kage seat key — note the seat uses a DIFFERENT slug (spaces→dashes), matching
// api/village/kage.ts.
function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const structure = String(body.structure ?? '');
        if (!playerName || !village) return res.status(400).json({ error: 'Missing playerName or village.' });
        if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
        if (!(STRUCTURE_KEYS as readonly string[]).includes(structure)) return res.status(400).json({ error: 'Unknown structure.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-war-structure', 20, 60_000, identity.name))) return;

        // Only the seated Kage (or admin) may upgrade.
        if (!identity.admin) {
            const kageState = await kv.get<{ seatedKage?: string }>(kageKey(village));
            if (safeName(kageState?.seatedKage ?? '') !== playerName) {
                return res.status(403).json({ error: 'Only the seated Kage can upgrade village structures.' });
            }
        }

        const stateKey = villageStateKey(village);
        const warKey = villageWarKey(village);

        // Debit treasury seals + apply the level-up atomically: treasury lock outer,
        // war-record lock inner (debit-before-credit; both failClosed).
        const result = await withKvLock(stateKey, async () => {
            const state = (await kv.get<Record<string, unknown>>(stateKey)) ?? {};
            const treasury = (state.treasury ?? {}) as Record<string, unknown>;
            const seals = num(treasury.honorSeals);
            return await withKvLock(warKey, async () => {
                const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(warKey)) ?? undefined);
                const up = applyStructureUpgrade(record, seals, structure);
                if (!up.ok) return { ok: false as const, error: up.error, cost: up.cost };
                await kv.set(warKey, up.record);
                await kv.set(stateKey, { ...state, treasury: { ...treasury, honorSeals: up.nextSeals } });
                return { ok: true as const, structure, newLevel: up.newLevel, cost: up.cost, remainingSeals: up.nextSeals };
            }, { failClosed: true });
        }, { failClosed: true });

        if (!result.ok) {
            const status = result.error === 'insufficient-seals' ? 402 : result.error === 'max-level' ? 409 : 400;
            return res.status(status).json({ error: result.error, cost: result.cost });
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[village/war-structure]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
