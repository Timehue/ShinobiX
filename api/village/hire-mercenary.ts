/*
 * POST /api/village/hire-mercenary — hire a mercenary band for the active village
 * war. Server-authoritative honor-seal SINK (see api/village/_mercenaries.ts):
 *
 *   1. Caller must be a logged-in player whose village is in an active, non-pending war.
 *   2. A target-first marker freezes/hides the exact war generation before any debit.
 *   3. The save CAS co-writes an immutable Honor Seal debit receipt.
 *   4. Activation atomically replaces the marker with damage + a war-row receipt.
 *
 * Any authenticated participant can help a hidden marker after a crash. There is no
 * expiring NX side key or best-effort refund window: a durable committed debit can
 * only be helped forward into its already-reserved strike.
 */
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { warDeclarationFundingMarkerFromRow } from '../_war-declaration-funding.js';
import {
    helpWarMercenaryHire,
    newWarMercenaryFundingOwnerId,
    settleWarMercenaryHire,
    warHasMercenaryFundingField,
    warMercenaryFundingMarkerFromRow,
    warMercenaryHireFingerprint,
    type WarMercenaryHireIdentity,
} from '../_war-mercenary-hire.js';
import { MERCENARY_TIERS, mercenaryById } from './_mercenaries.js';

// These mirror api/world-state.ts (keep in sync). The war record is the source of
// truth; we only touch hp[enemy], contributions[player], and updatedAt.
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

    const tier = mercenaryById(String(body.tierId ?? ''));
    if (!tier) return res.status(400).json({ error: 'Unknown mercenary tier.' });

    // Resolve the player's village + active war.
    const saveKey = `save:${identity.name}`;
    const save = await kv.get<{ character?: Record<string, unknown> }>(saveKey);
    const char = save?.character ?? null;
    const village = String(char?.village ?? '').trim();
    if (!char || !village) return res.status(400).json({ error: 'You are not in a village.' });

    let lookup = await warForVillage(village);
    if (!lookup) return res.status(409).json({ error: 'Your village is not in an active war.' });

    // Hidden rows are deliberately discoverable here even though every gameplay
    // scan excludes them. A crash after target reservation or source debit is
    // therefore help-forwardable and never suppressed by an expiring side key.
    if (lookup.funding) {
        const marker = warMercenaryFundingMarkerFromRow(lookup.war);
        if (!marker) return res.status(503).json({ error: 'Mercenary funding state is malformed.' });
        const helped = await withKvLock(
            lookup.key,
            async () => {
                const exact = await kv.get<Record<string, unknown>>(lookup!.key);
                const exactMarker = warMercenaryFundingMarkerFromRow(exact);
                if (!exact || !exactMarker) return null;
                return withKvLock(
                    exactMarker.sourceKey,
                    () => helpWarMercenaryHire(kv, lookup!.key, exact, Date.now()),
                    { failClosed: true },
                );
            },
            { failClosed: true },
        );
        if (!helped) return res.status(503).json({ error: 'Mercenary funding recovery is busy; retry.' });
        if (helped.status === 'active'
            && marker.player === identity.name
            && marker.tierId === tier.id) {
            return res.status(200).json({
                ok: true,
                replayed: true,
                tier: tier.id,
                name: tier.name,
                balance: helped.receipt.balanceAfter,
                warMercs: responseWarMercs(helped.sourceRow, marker.warToken, marker.tierId),
                enemy: marker.enemy,
                enemyHp: helped.receipt.enemyHp,
                dealt: helped.receipt.dealt,
                _saveVersion: Number(helped.sourceRow._saveVersion ?? 0),
            });
        }
        if (helped.status === 'insufficient' && marker.player === identity.name) {
            return res.status(400).json({ error: `Not enough Honor Seals — the ${tier.name} costs ${tier.costSeals}.` });
        }
        if (helped.status === 'expired') {
            return res.status(409).json({ error: 'That village war reached its maximum lifetime before the strike was funded.' });
        }
        if (helped.status !== 'active' && helped.status !== 'insufficient') {
            return res.status(503).json({ error: 'Mercenary funding is settling; retry.' });
        }
        lookup = await warForVillage(village);
        if (!lookup || lookup.funding) return res.status(503).json({ error: 'Mercenary funding activation is settling; retry.' });
    }

    const war = lookup.war;
    const enemy = war.villages.find(v => v !== village);
    if (!enemy) return res.status(409).json({ error: 'No enemy village to strike.' });
    const warToken = villageWarGenerationToken(war);
    const generation = Math.max(1, Math.floor(Number(war.declarationGeneration) || 1));
    const warEndsAt = villageWarEndsAt(war);
    if (warEndsAt === null || Date.now() >= warEndsAt) {
        return res.status(409).json({ error: 'That village war has reached its maximum lifetime.' });
    }
    const hireId = `merc:${warToken}:${identity.name}:${tier.id}`;
    const hireIdentity: WarMercenaryHireIdentity = {
        hireId,
        warId: war.id,
        warToken,
        generation,
        warEndsAt,
        player: identity.name,
        displayName: String(char.name ?? identity.name),
        village,
        enemy,
        tierId: tier.id,
        costSeals: tier.costSeals,
        warDamage: tier.warDamage,
        sourceKey: saveKey,
    };
    const fingerprint = warMercenaryHireFingerprint(hireIdentity);
    const settled = await withKvLock(
        lookup.key,
        async () => {
            const exact = await kv.get<Record<string, unknown>>(lookup!.key);
            if (!exact || exact.endedAt !== undefined) return null;
            if (Object.prototype.hasOwnProperty.call(exact, 'declarationFunding')
                && warDeclarationFundingMarkerFromRow(exact)?.status !== 'active') return null;
            if (villageWarGenerationToken(exact as VillageWar) !== warToken) return null;
            const settlementNow = Date.now();
            const exactEndsAt = villageWarEndsAt(exact as VillageWar);
            if (Number(exact.pendingUntil ?? 0) > settlementNow
                || exactEndsAt === null
                || exactEndsAt !== warEndsAt
                || settlementNow >= exactEndsAt) return null;
            return withKvLock(
                saveKey,
                () => settleWarMercenaryHire(kv, {
                    ...hireIdentity,
                    warKey: lookup!.key,
                    fingerprint,
                    ownerId: newWarMercenaryFundingOwnerId(),
                    now: settlementNow,
                    expectedWar: exact,
                }),
                { failClosed: true },
            );
        },
        { failClosed: true },
    );

    if (!settled) return res.status(503).json({ error: 'The war front changed; retry.' });
    if (settled.status === 'insufficient') {
        return res.status(400).json({ error: `Not enough Honor Seals — the ${tier.name} costs ${tier.costSeals}.` });
    }
    if (settled.status === 'expired') {
        return res.status(409).json({ error: 'That village war reached its maximum lifetime before the strike was funded.' });
    }
    if (settled.status !== 'active') {
        const status = settled.status === 'busy' ? 409 : 503;
        return res.status(status).json({
            error: settled.status === 'busy'
                ? 'Another mercenary strike is settling; retry.'
                : 'Mercenary funding is settling; retry.',
        });
    }
    return res.status(200).json({
        ok: true,
        replayed: settled.replayed,
        tier: tier.id,
        name: tier.name,
        balance: settled.receipt.balanceAfter,
        warMercs: responseWarMercs(settled.sourceRow, warToken, tier.id),
        enemy,
        enemyHp: settled.receipt.enemyHp,
        dealt: settled.receipt.dealt,
        _saveVersion: Number(settled.sourceRow._saveVersion ?? 0),
    });
}

export { MERCENARY_TIERS };
