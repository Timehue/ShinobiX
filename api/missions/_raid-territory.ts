import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { isWildSector } from '../../shared/sector-geo.js';
import { createHash } from 'node:crypto';

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
    await kv.set(territoryKey, cleared);
    return cleared;
}

async function pinAndFinalizeReceipt(
    territoryKey: string,
    row: Record<string, unknown>,
    receipt: DurableRaidDamageReceipt,
): Promise<Record<string, unknown>> {
    const pinned = { ...row, serverRaidDamagePending: receipt };
    await kv.set(territoryKey, pinned);
    await publishDurableReceipt(receipt);
    const cleared = withoutPendingReceipt(pinned);
    await kv.set(territoryKey, cleared);
    return cleared;
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
}): Promise<{ amount: number; sector?: number; hpAfter?: number; destroyed?: boolean; replayed: boolean }> {
    const sector = Math.floor(Number(params.sector));
    if (!isWildSector(sector)) return { amount: 0, replayed: false };
    const proofId = typeof params.proofId === 'string' ? params.proofId.trim().slice(0, 180) : '';
    if (!proofId) throw new Error('invalid-raid-territory-proof');
    const playerName = safeName(params.playerName);
    if (!playerName) throw new Error('invalid-raid-territory-player');
    const key = `world:territory:${sector}`;
    const proofKey = raidTerritoryProofKey(proofId);
    return withKvLock(proofKey, async () => {
        const durablePrior = await readDurableReceipt(proofKey);
        if (durablePrior) {
            if (durablePrior.playerName.toLowerCase() !== playerName.toLowerCase()
                || durablePrior.sector !== sector) throw new Error('raid-territory-proof-binding-conflict');
            return {
                amount: durablePrior.amount,
                sector,
                hpAfter: durablePrior.hpAfter,
                destroyed: durablePrior.destroyed,
                replayed: true,
            };
        }
        return withKvLock(key, async () => {
            let current = (await kv.get<Record<string, unknown>>(key)) ?? {
                sector,
                controlScore: 0,
                hp: TERRITORY_HP_MAX,
                terrainBuffStat: 'bukijutsuOffense',
                guards: [],
                warSupply: 0,
                updatedAt: Date.now(),
            };
            current = await helpForwardPendingReceipt(key, sector, current);
            const existing = receipts(current.serverRaidDamageReceipts);
            const prior = existing.find((entry) => entry.proofId === proofId);
            if (prior) {
                const durable: DurableRaidDamageReceipt = { version: 1, sector, ...prior };
                // Rolling-upgrade rows may predate terminal proof keys. Pin the
                // old exact result before backfilling so a crash cannot let later
                // raids evict it from the bounded audit ring.
                await pinAndFinalizeReceipt(key, current, durable);
                return {
                    amount: prior.amount,
                    sector,
                    hpAfter: prior.hpAfter,
                    destroyed: prior.destroyed,
                    replayed: true,
                };
            }

            const ownerClan = String(current.ownerClan ?? '').trim();
            const ownerVillage = String(current.ownerVillage ?? '').trim();
            const guards = Array.isArray(current.guards)
                ? current.guards.map((guard) => safeName(String(guard))).filter(Boolean).slice(0, 20)
                : [];
            let amount = 0;
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
            const hpBefore = Math.max(0, Math.min(TERRITORY_HP_MAX, Math.floor(Number(current.hp) || TERRITORY_HP_MAX)));
            const destroyed = amount > 0 && hpBefore - amount <= 0;
            const hpAfter = destroyed ? TERRITORY_HP_MAX : Math.max(0, hpBefore - amount);
            const receipt: RaidDamageReceipt = {
                proofId,
                playerName,
                amount,
                hpAfter,
                destroyed,
                at: Date.now(),
            };
            const next = destroyed ? {
                ...current,
                ownerClan: undefined,
                ownerVillage: undefined,
                backgroundImage: undefined,
                controlScore: 0,
                hp: TERRITORY_HP_MAX,
                weather: undefined,
                guards: [],
                warSupply: 0,
                lastSupplyAt: undefined,
                rebuiltAt: Date.now(),
                updatedAt: Date.now(),
                serverRaidDamageReceipts: [...existing, receipt].slice(-MAX_RECEIPTS),
            } : {
                ...current,
                hp: hpAfter,
                updatedAt: Date.now(),
                serverRaidDamageReceipts: [...existing, receipt].slice(-MAX_RECEIPTS),
            };
            const durable: DurableRaidDamageReceipt = { version: 1, sector, ...receipt };
            await pinAndFinalizeReceipt(key, next, durable);
            return { amount, sector, hpAfter, destroyed, replayed: false };
        }, { failClosed: true });
    }, { failClosed: true });
}
