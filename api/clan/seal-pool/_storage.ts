import { kv } from '../../_storage.js';

export type ClanSealPoolEntry = {
    // 'distribute-refund' = a distribution whose recipient credit failed, so the
    // debited Seals were returned to the pool (see distribute.ts refund path).
    kind: 'donate' | 'distribute' | 'distribute-refund';
    by: string;
    to?: string;
    amount: number;
    at: number;
};

export type ClanSealPool = {
    clanName: string;
    balance: number;
    log: ClanSealPoolEntry[];
};

const MAX_LOG_ENTRIES = 50;

function poolKey(clanName: string): string {
    return `clan-seal-pool:${clanName.toLowerCase()}`;
}

export async function loadPool(clanName: string): Promise<ClanSealPool> {
    const existing = await kv.get<ClanSealPool>(poolKey(clanName));
    if (existing) return existing;
    return { clanName, balance: 0, log: [] };
}

export async function savePool(pool: ClanSealPool): Promise<void> {
    const trimmed: ClanSealPool = {
        ...pool,
        log: pool.log.slice(0, MAX_LOG_ENTRIES),
    };
    await kv.set(poolKey(pool.clanName), trimmed);
}
