/*
 * POST /api/village/hire-mercenary — the RETIRED Town Hall Honor-Seal hire.
 *
 * Owner ruling 2026-10-08: village-war mercenaries are now hired as AI bands from
 * the War Map (api/village/war-merc.ts). This route no longer starts a hire. It
 * stays mounted for what is already in flight:
 *
 *   1. A hire caught mid-saga (a target-first marker still hides its war row) is
 *      finished — retireWarMercenaryHire: Honor Seals that already left the save
 *      buy the strike they paid for, an attempt that never debited is aborted.
 *      The war row unfreezes either way, and nothing is charged twice. The
 *      mercenary tick sweeps for the same thing, so no row waits on a caller.
 *   2. A client retrying a hire whose response was lost gets that hire's
 *      receipt back, with the player's `_saveVersion`.
 *
 * Everything else is answered 410 with the War Map pointer. The saga itself
 * (api/_war-mercenary-hire.ts) and its receipts are kept, so the history reads.
 */
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { warDeclarationFundingMarkerFromRow } from '../_war-declaration-funding.js';
import {
    retireWarMercenaryHire,
    warHasMercenaryFundingField,
    warMercenaryAppliedReceiptFromRow,
    warMercenaryFundingMarkerFromRow,
} from '../_war-mercenary-hire.js';
import { mercenaryById } from './_mercenaries.js';

/** What a new Town Hall hire is told now. */
export const MERCENARY_HIRE_RETIRED_MESSAGE = 'Village-war mercenaries are now hired as AI bands from the War Map.';

// These mirror api/world-state.ts (keep in sync). The war record is the source of
// truth. This route never starts a strike; the saga it helps forward only ever
// touches hp[enemy], contributions[player], updatedAt and its own receipts.
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';
const VILLAGE_WAR_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1_000;

type VillageWar = {
    id: string;
    villages: [string, string];
    hp: Record<string, number>;
    startedAt: number;
    endedAt?: number;
    pendingUntil?: number;
    declarationGeneration?: number;
    declarationFunding?: { version?: number; status?: string };
    mercenaryFunding?: unknown;
    mercenaryHireReceipts?: Record<string, unknown>;
    contributions?: Record<string, { damage: number; raids: number; pvpKills: number; side: string; name: string }>;
    updatedAt: number;
};

function villageWarGenerationToken(war: VillageWar): string {
    const generation = Math.floor(Number(war.declarationGeneration));
    return Number.isSafeInteger(generation) && generation > 0
        ? `${war.id}-g${generation}`
        : war.id;
}

function villageWarEndsAt(war: VillageWar): number | null {
    const startedAt = Number(war.startedAt);
    const pendingUntil = war.pendingUntil === undefined ? undefined : Number(war.pendingUntil);
    const effectiveStart = pendingUntil ?? startedAt;
    const endsAt = effectiveStart + VILLAGE_WAR_MAX_DURATION_MS;
    return Number.isSafeInteger(startedAt) && startedAt > 0
        && (pendingUntil === undefined || (Number.isSafeInteger(pendingUntil) && pendingUntil > 0))
        && Number.isSafeInteger(endsAt)
        ? endsAt
        : null;
}

type VillageWarLookup = { key: string; war: VillageWar; funding: boolean };

async function warForVillage(village: string): Promise<VillageWarLookup | null> {
    const keys = await kv.keys(`${VILLAGE_WAR_KEY_PREFIX}*`);
    if (!keys.length) return null;
    const wars = await kv.mget<VillageWar[]>(...keys);
    const now = Date.now();
    let active: VillageWarLookup | null = null;
    for (let index = 0; index < wars.length; index += 1) {
        const w = wars[index];
        if (!w || w.endedAt) continue;
        if (!Array.isArray(w.villages) || !w.villages.includes(village)) continue;
        if (warHasMercenaryFundingField(w)) {
            // A malformed marker is still authority: fail closed instead of
            // treating the underlying war as mutable gameplay state.
            return { key: keys[index], war: w, funding: true };
        }
        if (Object.prototype.hasOwnProperty.call(w, 'declarationFunding')
            && warDeclarationFundingMarkerFromRow(w)?.status !== 'active') continue;
        if (w.pendingUntil && w.pendingUntil > now) continue; // war not hot yet
        const endsAt = villageWarEndsAt(w);
        if (endsAt === null || now >= endsAt) continue;
        active ??= { key: keys[index], war: w, funding: false };
    }
    return active;
}

function responseWarMercs(sourceRow: Record<string, unknown>, warToken: string, tierId: string): { warId: string; tiers: string[] } {
    const character = sourceRow.character as Record<string, unknown> | undefined;
    const stored = character?.warMercs as { warId?: unknown; tiers?: unknown } | undefined;
    if (stored && String(stored.warId ?? '') === warToken && Array.isArray(stored.tiers)) {
        return { warId: warToken, tiers: [...new Set(stored.tiers.map(String))] };
    }
    return { warId: warToken, tiers: [tierId] };
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
    // The tier only names which earlier hire a retry is asking about.
    const tier = mercenaryById(String(body.tierId ?? ''));

    const saveKey = `save:${identity.name}`;
    const save = await kv.get<{ character?: Record<string, unknown> }>(saveKey);
    const village = String(save?.character?.village ?? '').trim();
    let lookup = village ? await warForVillage(village) : null;

    // (1) A hire caught mid-saga still hides its war row. Finish it — never
    // start one. Hidden rows are deliberately discoverable here even though
    // every gameplay scan excludes them.
    if (lookup?.funding) {
        const warKey = lookup.key;
        const marker = warMercenaryFundingMarkerFromRow(lookup.war);
        if (!marker) return res.status(503).json({ error: 'Mercenary funding state is malformed.' });
        const settled = await withKvLock(
            warKey,
            async () => {
                const exact = await kv.get<Record<string, unknown>>(warKey);
                const exactMarker = warMercenaryFundingMarkerFromRow(exact);
                if (!exact || !exactMarker) return null;
                return withKvLock(
                    exactMarker.sourceKey,
                    () => retireWarMercenaryHire(kv, warKey, exact, Date.now()),
                    { failClosed: true },
                );
            },
            { failClosed: true },
        );
        if (settled?.status === 'active'
            && marker.player === identity.name
            && (!tier || marker.tierId === tier.id)) {
            const named = mercenaryById(marker.tierId);
            return res.status(200).json({
                ok: true,
                replayed: true,
                tier: marker.tierId,
                name: named?.name ?? marker.tierId,
                balance: settled.receipt.balanceAfter,
                warMercs: responseWarMercs(settled.sourceRow, marker.warToken, marker.tierId),
                enemy: marker.enemy,
                enemyHp: settled.receipt.enemyHp,
                dealt: settled.receipt.dealt,
                _saveVersion: Number(settled.sourceRow._saveVersion ?? 0),
            });
        }
        if (settled !== null && settled.status !== 'active' && settled.status !== 'retired') {
            return res.status(503).json({ error: 'An earlier mercenary strike is still settling; retry.' });
        }
        // Settled here or by a concurrent helper: read the unfrozen row afresh.
        lookup = await warForVillage(village);
        if (lookup?.funding) return res.status(503).json({ error: 'An earlier mercenary strike is still settling; retry.' });
    }

    // (2) A retry of a hire that already landed gets its receipt back instead
    // of a refusal it would read as "my seals vanished".
    if (lookup && !lookup.funding && tier) {
        const warToken = villageWarGenerationToken(lookup.war);
        const applied = warMercenaryAppliedReceiptFromRow(lookup.war, `merc:${warToken}:${identity.name}:${tier.id}`);
        if (applied && applied.player === identity.name) {
            const source = (await kv.get<Record<string, unknown>>(saveKey)) ?? {};
            return res.status(200).json({
                ok: true,
                replayed: true,
                tier: tier.id,
                name: tier.name,
                balance: applied.balanceAfter,
                warMercs: responseWarMercs(source, warToken, tier.id),
                enemy: applied.enemy,
                enemyHp: applied.enemyHp,
                dealt: applied.dealt,
                _saveVersion: Number(source._saveVersion ?? 0),
            });
        }
    }

    return res.status(410).json({ error: MERCENARY_HIRE_RETIRED_MESSAGE, retired: true });
}
