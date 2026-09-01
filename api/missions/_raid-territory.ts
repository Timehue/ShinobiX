import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { isWildSector } from '../../shared/sector-geo.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { collectTerritorySupply } from '../_territory-supply.js';
import {
    beginTerritoryBreach,
    settleExpiredTerritoryBreach,
    territoryIsBreached,
} from '../_territory-lifecycle.js';

const TERRITORY_HP_MAX = 20_000;
const MAX_RECEIPTS = 160;
// Longer than the AI token, PvP session, claim, and client recovery windows.
// The sector row keeps a bounded audit ring; this per-proof terminal receipt is
// the non-evicting authority for every still-replayable report.
export const RAID_TERRITORY_PROOF_TTL_SECONDS = 32 * 24 * 60 * 60;

type RaidDamageReceipt = {
    proofId: string;
    playerName: string;
    amount: number;
    hpAfter: number;
    destroyed: boolean;
    at: number;
};

type DurableRaidDamageReceipt = RaidDamageReceipt & {
    version: 1;
    sector: number;
};

export type SealedRaidTerritoryEvidence = {
    version: 1;
    sector: number;
    ownerClan: string;
    ownerVillage: string;
    raidDamage: number;
    observedAt: number;
};

export type RaidTerritoryDamageResult = {
    proofId: string;
    playerName: string;
    amount: number;
    sector?: number;
    hpAfter?: number;
    destroyed?: boolean;
    at: number;
    replayed: boolean;
};

export function raidTerritoryProofKey(proofId: string): string {
    return `raid-territory-proof:${createHash('sha256').update(proofId).digest('hex')}`;
}

function cleanDurableReceipt(value: unknown): DurableRaidDamageReceipt | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Partial<DurableRaidDamageReceipt>;
    if (item.version !== 1
        || typeof item.proofId !== 'string'
        || typeof item.playerName !== 'string'
        || !Number.isSafeInteger(item.sector)
        || !Number.isSafeInteger(item.amount)
        || !Number.isSafeInteger(item.hpAfter)
        || typeof item.destroyed !== 'boolean'
        || !Number.isFinite(item.at)) return null;
    return item as DurableRaidDamageReceipt;
}

function sameDurableReceipt(
    left: DurableRaidDamageReceipt,
    right: DurableRaidDamageReceipt,
): boolean {
    return left.version === right.version
        && left.sector === right.sector
        && left.proofId === right.proofId
        && left.playerName.toLowerCase() === right.playerName.toLowerCase()
        && left.amount === right.amount
        && left.hpAfter === right.hpAfter
        && left.destroyed === right.destroyed
        && left.at === right.at;
}

async function readDurableReceipt(key: string): Promise<DurableRaidDamageReceipt | null> {
    const raw = await kv.get(key);
    if (raw === null) return null;
    const receipt = cleanDurableReceipt(raw);
    if (!receipt) throw new Error('raid-territory-proof-invalid');
    return receipt;
}

function assertSameDurableReceipt(
    actual: DurableRaidDamageReceipt,
    expected: DurableRaidDamageReceipt,
): void {
    if (!sameDurableReceipt(actual, expected)) {
        throw new Error('raid-territory-proof-result-conflict');
    }
}

/**
 * Publish the immutable per-proof terminal row. NX prevents a stale helper
 * from replacing a terminal result, while exact readback heals a committed
 * write whose acknowledgement was lost.
 */
async function publishDurableReceipt(receipt: DurableRaidDamageReceipt): Promise<void> {
    const key = raidTerritoryProofKey(receipt.proofId);
    const prior = await readDurableReceipt(key);
    if (prior) {
        assertSameDurableReceipt(prior, receipt);
        return;
    }

    try {
        const created = await kv.set(key, receipt, {
            nx: true,
            ex: RAID_TERRITORY_PROOF_TTL_SECONDS,
        });
        if (created === 'OK') return;
    } catch (error) {
        // A remote store can commit and lose the response. Only the exact
        // intended immutable result is a successful recovery.
        try {
            const recovered = await readDurableReceipt(key);
            if (recovered) {
                assertSameDurableReceipt(recovered, receipt);
                return;
            }
        } catch {
            // Preserve the original storage failure when readback cannot prove
            // that this exact terminal record committed.
        }
        throw error;
    }

    const winner = await readDurableReceipt(key);
    if (!winner) throw new Error('raid-territory-proof-terminal-missing');
    assertSameDurableReceipt(winner, receipt);
}

function withoutPendingReceipt(row: Record<string, unknown>): Record<string, unknown> {
    const next = { ...row };
    delete next.serverRaidDamagePending;
    return next;
}

/**
 * A territory HP write and this pending receipt live in the same JSON row.
 * Before any later raid can mutate that row it must publish the pending result
 * to the durable per-proof key, then clear the pin. A crash at either boundary
 * therefore leaves enough authority for the next caller to help forward.
 */
async function helpForwardPendingReceipt(
    territoryKey: string,
    sector: number,
    row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    if (!Object.prototype.hasOwnProperty.call(row, 'serverRaidDamagePending')) return row;
    const pending = cleanDurableReceipt(row.serverRaidDamagePending);
    if (!pending || pending.sector !== sector) {
        throw new Error('raid-territory-pending-invalid');
    }
    await publishDurableReceipt(pending);
    const cleared = withoutPendingReceipt(row);
    try {
        if (await kv.compareSet(territoryKey, row, cleared)) return cleared;
    } catch (error) {
        const recovered = await kv.get<unknown>(territoryKey).catch(() => null);
        if (isDeepStrictEqual(recovered, cleared)) return cleared;
        throw error;
    }
    throw new Error('raid-territory-row-conflict');
}

async function pinAndFinalizeReceipt(
    territoryKey: string,
    /** null = the row does not exist yet and must be created by this CAS. */
    expectedRow: Record<string, unknown> | null,
    projectedRow: Record<string, unknown>,
    receipt: DurableRaidDamageReceipt,
): Promise<Record<string, unknown>> {
    const pinned = { ...projectedRow, serverRaidDamagePending: receipt };
    try {
        if (!(await kv.compareSet(territoryKey, expectedRow, pinned))) {
            throw new Error('raid-territory-row-conflict');
        }
    } catch (error) {
        const recovered = await kv.get<unknown>(territoryKey).catch(() => null);
        if (!isDeepStrictEqual(recovered, pinned)) throw error;
    }
    await publishDurableReceipt(receipt);
    const cleared = withoutPendingReceipt(pinned);
    try {
        if (await kv.compareSet(territoryKey, pinned, cleared)) return cleared;
    } catch (error) {
        const recovered = await kv.get<unknown>(territoryKey).catch(() => null);
        if (isDeepStrictEqual(recovered, cleared)) return cleared;
        throw error;
    }
    const recovered = await kv.get<Record<string, unknown>>(territoryKey);
    if (recovered && !Object.prototype.hasOwnProperty.call(recovered, 'serverRaidDamagePending')) {
        const replay = receipts(recovered.serverRaidDamageReceipts).find((entry) => entry.proofId === receipt.proofId);
        if (replay) return recovered;
    }
    throw new Error('raid-territory-pending-clear-conflict');
}

function receipts(value: unknown): RaidDamageReceipt[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is RaidDamageReceipt => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const item = entry as Partial<RaidDamageReceipt>;
        return typeof item.proofId === 'string'
            && typeof item.playerName === 'string'
            && Number.isSafeInteger(item.amount)
            && Number.isSafeInteger(item.hpAfter)
            && typeof item.destroyed === 'boolean'
            && Number.isFinite(item.at);
    }).slice(-MAX_RECEIPTS);
}

function villageSlug(value: unknown): string {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Apply one sealed raid's shared territory hit exactly once.
 *
 * The HP mutation and a pending proof receipt are committed in one territory
 * row write. A later raid must help that pending receipt into its immutable
 * terminal key before it can touch HP, so even a process death between the row
 * and terminal-key writes cannot be compacted into a second hit.
 */
export async function settleRaidTerritoryDamage(params: {
    playerName: string;
    proofId: string;
    sector?: number;
    eventAt?: number;
    evidence?: SealedRaidTerritoryEvidence;
}): Promise<RaidTerritoryDamageResult> {
    const sector = Math.floor(Number(params.sector));
    const eventAt = Number(params.eventAt ?? Date.now());
    const proofId = typeof params.proofId === 'string' ? params.proofId.trim().slice(0, 180) : '';
    const playerName = safeName(params.playerName);
    if (!proofId || !playerName || !Number.isSafeInteger(eventAt) || eventAt <= 0) {
        throw new Error('invalid-raid-territory-proof');
    }
    if (!isWildSector(sector)) return { proofId, playerName, amount: 0, at: eventAt, replayed: false };
    const evidence = params.evidence;
    if (evidence && (evidence.version !== 1
        || evidence.sector !== sector
        || !Number.isSafeInteger(evidence.raidDamage)
        || evidence.raidDamage < 0
        || evidence.raidDamage > 250
        || !Number.isSafeInteger(evidence.observedAt)
        || evidence.observedAt <= 0
        || typeof evidence.ownerClan !== 'string'
        || typeof evidence.ownerVillage !== 'string')) {
        throw new Error('invalid-raid-territory-evidence');
    }
    const key = `world:territory:${sector}`;
    const proofKey = raidTerritoryProofKey(proofId);
    return withKvLock(proofKey, async () => {
        const durablePrior = await readDurableReceipt(proofKey);
        if (durablePrior) {
            if (durablePrior.playerName.toLowerCase() !== playerName.toLowerCase()
                || durablePrior.sector !== sector) throw new Error('raid-territory-proof-binding-conflict');
            return {
                proofId,
                playerName,
                amount: durablePrior.amount,
                sector,
                hpAfter: durablePrior.hpAfter,
                destroyed: durablePrior.destroyed,
                at: durablePrior.at,
                replayed: true,
            };
        }
        return withKvLock(key, async () => {
            const stored = await kv.get<Record<string, unknown>>(key);
            let current = stored ?? {
                sector,
                controlScore: 0,
                hp: TERRITORY_HP_MAX,
                terrainBuffStat: 'bukijutsuOffense',
                guards: [],
                warSupply: 0,
                updatedAt: Date.now(),
            };
            // A sector nobody has captured or raided yet has NO row, and the
            // default above is a projection, not a stored predecessor. CAS with
            // a non-null expected compiles to `UPDATE ... WHERE value = ?`,
            // which matches nothing on an absent key — so every raid in such a
            // sector threw raid-territory-row-conflict forever and pinned its
            // winner on the victory screen. Absence is expressed as a null
            // expected, which routes to the insert-if-absent CAS branch.
            let expected: Record<string, unknown> | null = stored ? current : null;
            current = await helpForwardPendingReceipt(key, sector, current);
            if (expected !== null) expected = current;
            const lifecycleNow = Date.now();
            const lifecycle = settleExpiredTerritoryBreach(current, lifecycleNow);
            if (lifecycle.changed) {
                const projected = lifecycle.row as Record<string, unknown>;
                try {
                    if (!(await kv.compareSet(key, expected, projected))) throw new Error('raid-territory-lifecycle-conflict');
                } catch (error) {
                    const recovered = await kv.get<unknown>(key).catch(() => null);
                    if (!isDeepStrictEqual(recovered, projected)) throw error;
                }
                current = projected;
                expected = projected;
            }
            const existing = receipts(current.serverRaidDamageReceipts);
            const prior = existing.find((entry) => entry.proofId === proofId);
            if (prior) {
                const durable: DurableRaidDamageReceipt = { version: 1, sector, ...prior };
                // Rolling-upgrade rows may predate terminal proof keys. Pin the
                // old exact result before backfilling so a crash cannot let later
                // raids evict it from the bounded audit ring.
                await pinAndFinalizeReceipt(key, expected, current, durable);
                return {
                    proofId,
                    playerName,
                    amount: prior.amount,
                    sector,
                    hpAfter: prior.hpAfter,
                    destroyed: prior.destroyed,
                    at: prior.at,
                    replayed: true,
                };
            }

            const ownerClan = String(current.ownerClan ?? '').trim();
            const ownerVillage = String(current.ownerVillage ?? '').trim();
            const guards = Array.isArray(current.guards)
                ? current.guards.map((guard) => safeName(String(guard))).filter(Boolean).slice(0, 20)
                : [];
            let amount = 0;
            if (evidence) {
                const sameTarget = ownerClan === evidence.ownerClan && ownerVillage === evidence.ownerVillage;
                amount = sameTarget ? evidence.raidDamage : 0;
            } else {
                const playerSave = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`);
                const playerClan = String(playerSave?.character?.clan ?? '').trim();
                const playerVillage = String(playerSave?.character?.village ?? '').trim();
                const controlsTerritory = (!!ownerClan && ownerClan === playerClan)
                    || (!!ownerVillage && ownerVillage === playerVillage);
                if (ownerClan && !controlsTerritory) {
                const villageState = await kv.get<{ anbuAppointees?: unknown }>(
                    `game:village-state:${villageSlug(ownerVillage)}`,
                );
                const anbu = new Set(Array.isArray(villageState?.anbuAppointees)
                    ? villageState!.anbuAppointees!.map((name) => safeName(String(name))).filter(Boolean)
                    : []);
                const anbuCount = guards.filter((guard) => anbu.has(guard)).length;
                amount = anbuCount > 0 ? Math.max(50, 250 - anbuCount * 50) : guards.length > 0 ? 150 : 250;
                }
            }
            const rawHp = Number(current.hp);
            const hpBefore = Math.max(0, Math.min(
                TERRITORY_HP_MAX,
                Number.isFinite(rawHp) ? Math.floor(rawHp) : TERRITORY_HP_MAX,
            ));
            if (territoryIsBreached(current, lifecycleNow) && hpBefore <= 0) amount = 0;
            const breached = amount > 0 && hpBefore - amount <= 0;
            const destroyed = false;
            const hpAfter = breached ? 0 : Math.max(0, hpBefore - amount);
            const receipt: RaidDamageReceipt = {
                proofId,
                playerName,
                amount,
                hpAfter,
                destroyed,
                at: eventAt,
            };
            let next = {
                ...current,
                hp: hpAfter,
                updatedAt: lifecycleNow,
                serverRaidDamageReceipts: [...existing, receipt].slice(-MAX_RECEIPTS),
            };
            if (breached) {
                const bankedSupply = collectTerritorySupply(current, lifecycleNow).collected;
                next = beginTerritoryBreach(next, lifecycleNow, bankedSupply) as typeof next;
            }
            const durable: DurableRaidDamageReceipt = { version: 1, sector, ...receipt };
            await pinAndFinalizeReceipt(key, expected, next, durable);
            return { proofId, playerName, amount, sector, hpAfter, destroyed, at: eventAt, replayed: false };
        }, { failClosed: true });
    }, { failClosed: true });
}
