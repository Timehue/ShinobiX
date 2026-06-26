/*
 * POST /api/village/hire-mercenary — hire a mercenary band for the active village
 * war. Server-authoritative honor-seal SINK (see api/village/_mercenaries.ts):
 *
 *   1. Caller must be a logged-in player whose village is in an active, non-pending war.
 *   2. Each tier can be hired at most ONCE per war (NX marker `war:merc:<warId>:<player>:<tier>`),
 *      so the contract resets when a new war begins.
 *   3. The tier's Honor Seal cost is deducted from the player's save under a failClosed
 *      lock (never trusts a client amount — recomputed from the sealed tier table).
 *   4. The tier's war damage is applied to the enemy village's HP under the war-record
 *      lock (same `world:war:<id>` key the world-state handler uses, so they're mutually
 *      exclusive), floored at 1 so a merc can't end the war, and attributed to the
 *      hiring player's contributions.
 *
 * On a rare post-deduct failure the seals are refunded and the marker released, so a
 * player is never charged for a merc that didn't strike.
 */
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { MERCENARY_TIERS, mercenaryById, applyMercenaryDamage } from './_mercenaries.js';

// These mirror api/world-state.ts (keep in sync). The war record is the source of
// truth; we only touch hp[enemy], contributions[player], and updatedAt.
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';
const VILLAGE_WAR_HP_MAX = 5000;
const MERC_MARKER_TTL_SEC = 14 * 24 * 60 * 60; // a war's max lifetime

type VillageWar = {
    id: string;
    villages: [string, string];
    hp: Record<string, number>;
    endedAt?: number;
    pendingUntil?: number;
    contributions?: Record<string, { damage: number; raids: number; pvpKills: number; side: string; name: string }>;
    updatedAt: number;
};

async function activeWarForVillage(village: string): Promise<VillageWar | null> {
    const keys = await kv.keys(`${VILLAGE_WAR_KEY_PREFIX}*`);
    if (!keys.length) return null;
    const wars = await kv.mget<VillageWar[]>(...keys);
    const now = Date.now();
    for (const w of wars) {
        if (!w || w.endedAt) continue;
        if (!Array.isArray(w.villages) || !w.villages.includes(village)) continue;
        if (w.pendingUntil && w.pendingUntil > now) continue; // war not hot yet
        return w;
    }
    return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin) return res.status(400).json({ error: 'Admins have no village to hire for.' });
    if (!(await enforceRateLimitKv(req, res, 'hire-mercenary', 20, 60_000, identity.name))) return;

    let body: { action?: string; tierId?: string };
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    } catch {
        return res.status(400).json({ error: 'Bad request body.' });
    }
    if (body.action !== 'hire') return res.status(400).json({ error: 'Unknown action.' });

    const tier = mercenaryById(String(body.tierId ?? ''));
    if (!tier) return res.status(400).json({ error: 'Unknown mercenary tier.' });

    // Resolve the player's village + active war.
    const saveKey = `save:${identity.name}`;
    const save = await kv.get<{ character?: Record<string, unknown> }>(saveKey);
    const char = save?.character ?? null;
    const village = String(char?.village ?? '').trim();
    if (!char || !village) return res.status(400).json({ error: 'You are not in a village.' });

    const war = await activeWarForVillage(village);
    if (!war) return res.status(409).json({ error: 'Your village is not in an active war.' });
    const enemy = war.villages.find(v => v !== village);
    if (!enemy) return res.status(409).json({ error: 'No enemy village to strike.' });

    // Once-per-war-per-tier contract. NX marker claims the slot up front.
    const marker = `war:merc:${war.id}:${identity.name}:${tier.id}`;
    const placed = await kv.set(marker, { at: Date.now() }, { nx: true, ex: MERC_MARKER_TTL_SEC } as never);
    if (!placed) return res.status(409).json({ error: `You already hired the ${tier.name} for this war.` });

    // Deduct seals (recomputed from the sealed table — never the client) and record
    // the hire on the save (display-only; the NX marker is the real guard).
    const deduct = await withKvLock<{ ok: true; balance: number; warMercs: { warId: string; tiers: string[] } } | { error: string }>(
        saveKey,
        async () => {
            const fresh = await kv.get<{ character?: Record<string, unknown> }>(saveKey);
            const fc = fresh?.character;
            if (!fresh || !fc) return { error: 'Save not found.' };
            const balance = Math.max(0, Math.floor(Number(fc.honorSeals ?? 0)));
            if (balance < tier.costSeals) return { error: `Not enough Honor Seals — the ${tier.name} costs ${tier.costSeals}.` };
            fc.honorSeals = balance - tier.costSeals;
            const prevWm = fc.warMercs as { warId?: string; tiers?: string[] } | undefined;
            const warMercs = prevWm && prevWm.warId === war.id
                ? { warId: war.id, tiers: Array.isArray(prevWm.tiers) ? [...prevWm.tiers] : [] }
                : { warId: war.id, tiers: [] as string[] };
            if (!warMercs.tiers.includes(tier.id)) warMercs.tiers.push(tier.id);
            fc.warMercs = warMercs;
            await kv.set(saveKey, fresh);
            return { ok: true as const, balance: fc.honorSeals as number, warMercs };
        },
        { failClosed: true },
    );

    if (!deduct || 'error' in deduct) {
        await kv.del(marker).catch(() => 0);
        return res.status(deduct && 'error' in deduct ? 400 : 503).json({ error: (deduct && 'error' in deduct ? deduct.error : 'Treasury busy — try again.') });
    }

    // Apply the war damage to the enemy village (floored, attributed). Same lock key
    // the world-state handler uses, so writes never interleave.
    const warKey = `${VILLAGE_WAR_KEY_PREFIX}${war.id}`;
    const struck = await withKvLock<{ enemyHp: number; dealt: number } | null>(
        warKey,
        async () => {
            const w = await kv.get<VillageWar>(warKey);
            if (!w || w.endedAt) return null;
            const en = w.villages.find(v => v !== village);
            if (!en) return null;
            const prevHp = Number(w.hp?.[en] ?? VILLAGE_WAR_HP_MAX);
            const { nextHp, dealt } = applyMercenaryDamage(prevHp, tier.warDamage);
            w.hp = { ...w.hp, [en]: nextHp };
            const contribs = { ...(w.contributions ?? {}) };
            const prev = contribs[identity.name] ?? { damage: 0, raids: 0, pvpKills: 0, side: village, name: String(char?.name ?? identity.name) };
            contribs[identity.name] = { ...prev, damage: prev.damage + dealt, side: village, name: prev.name };
            w.contributions = contribs;
            w.updatedAt = Date.now();
            await kv.set(warKey, w);
            return { enemyHp: nextHp, dealt };
        },
        { failClosed: true },
    );

    if (!struck) {
        // Refund the seals + release the contract — the merc never struck.
        await withKvLock(saveKey, async () => {
            const fresh = await kv.get<{ character?: Record<string, unknown> }>(saveKey);
            const fc = fresh?.character;
            if (!fresh || !fc) return;
            fc.honorSeals = Math.max(0, Math.floor(Number(fc.honorSeals ?? 0))) + tier.costSeals;
            const wm = fc.warMercs as { warId?: string; tiers?: string[] } | undefined;
            if (wm && wm.warId === war.id && Array.isArray(wm.tiers)) {
                wm.tiers = wm.tiers.filter(t => t !== tier.id);
            }
            await kv.set(saveKey, fresh);
        }, { failClosed: true }).catch(() => 0);
        await kv.del(marker).catch(() => 0);
        return res.status(503).json({ error: 'The war front is busy — your seals were not spent. Try again.' });
    }

    return res.status(200).json({
        ok: true,
        tier: tier.id,
        name: tier.name,
        balance: deduct.balance,
        warMercs: deduct.warMercs,
        enemy,
        enemyHp: struck.enemyHp,
        dealt: struck.dealt,
    });
}

export { MERCENARY_TIERS };
