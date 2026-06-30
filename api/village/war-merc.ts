import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { isWarVillage, homeSectorsForVillage } from '../_war-map-sectors.js';
import { normalizeVillageWarRecord, villageWarKey, villageWarSlug } from '../_war-state.js';
import { wrMercTierById, WR_MERC_TIERS } from '../_war-economy.js';
import { mercHireCost, addOrRefreshLease, MERC_LEASE_MS } from '../_war-merc.js';
import { recordWarEcoEvent } from '../_war-telemetry.js';

/*
 * /api/village/war-merc — POST only. Village-War mercenaries (Phase 5, §17.5 "B").
 *
 * Actions (body.action):
 *   - hire : the seated Kage (or admin) spends village WR to field a 2-day AI
 *            merc squad of a tier (comeback + Barracks discounted), debited from
 *            the WR pool under a fail-closed lock. The squad fights in Combat
 *            sector wars via the `attack` action (wired next).
 *   - list : read-only — the village WR pool + the merc tier menu + the active
 *            leases.
 *
 * Server-gated: 404 unless ENABLE_VILLAGE_WAR=1 (inert until launch). The hire is
 * server-authoritative (the cost is recomputed here from the sealed tier table,
 * never a client figure) — mirrors the WR-spend pattern in sector-war.ts.
 */

type Identity = NonNullable<Awaited<ReturnType<typeof authedPlayerOrAdmin>>>;

// Kage seat key — spaces→dashes, matching api/village/kage.ts + sector-war.ts.
function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
async function isSeatedKage(village: string, playerName: string): Promise<boolean> {
    const st = await kv.get<{ seatedKage?: string }>(kageKey(village));
    return safeName(st?.seatedKage ?? '') === playerName;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = String(body.action ?? '');
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }

        switch (action) {
            case 'hire': return await doHire(req, res, identity, playerName, body);
            case 'list': return await doList(res, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    } catch (err) {
        console.error('[village/war-merc]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// ── hire (debit WR from the village pool, add a 2-day lease) ───────────────────
async function doHire(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    const tierId = String(body.tierId ?? '');
    if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
    if (!wrMercTierById(tierId)) return res.status(400).json({ error: 'Unknown mercenary tier.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'war-merc-hire', 20, 60_000, identity.name))) return;
    if (!identity.admin && !(await isSeatedKage(village, playerName))) {
        return res.status(403).json({ error: 'Only the seated Kage can hire mercenaries.' });
    }

    const now = Date.now();
    // Phase-1 approximation (mirrors sector-war declare): the comeback discount is
    // keyed on home-sector count until live held-count tracking lands.
    const sectorsHeld = homeSectorsForVillage(village).length;
    const key = villageWarKey(village);
    const out = await withKvLock(key, async () => {
        const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(key)) ?? undefined);
        const cost = mercHireCost(tierId, sectorsHeld, record);
        if (record.warResources < cost) return { ok: false as const, cost };
        const mercLeases = addOrRefreshLease(record.mercLeases, tierId, playerName, now);
        await kv.set(key, { ...record, warResources: record.warResources - cost, mercLeases });
        return { ok: true as const, cost };
    }, { failClosed: true });

    if (!out.ok) return res.status(402).json({ error: `Hiring this mercenary costs ${out.cost} War Resources.` });
    // Telemetry (best-effort): WR spent on the hire (0 = a free comeback hire → no event).
    if (out.cost > 0) {
        void recordWarEcoEvent({ eventId: `merc:${villageWarSlug(village)}:${tierId}:${playerName}:${now}`, village, kind: 'wr.spend.merc', amount: out.cost, meta: tierId });
    }
    return res.status(200).json({ ok: true, tierId, cost: out.cost, expiresAt: now + MERC_LEASE_MS });
}

// ── list (read-only menu + active leases) ─────────────────────────────────────
async function doList(res: VercelResponse, body: Record<string, unknown>) {
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
    const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
    const now = Date.now();
    return res.status(200).json({
        ok: true,
        warResources: record.warResources,
        tiers: WR_MERC_TIERS,
        leases: record.mercLeases.filter((l) => l.expiresAt > now),
    });
}
