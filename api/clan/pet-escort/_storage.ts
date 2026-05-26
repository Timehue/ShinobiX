import { kv } from '../../_storage.js';

// Clan pet-escort offers. Each active offer is a single KV key with a 1h TTL
// so offers naturally expire if the Pet Tamer doesn't refresh. Storage shape
// is minimal — the key itself encodes clan + Pet Tamer; the value is just a
// timestamp for display.

export const OFFER_TTL_S = 60 * 60;

function escortKey(clanName: string, petTamerName: string): string {
    return `clan-pet-escort:${clanName.toLowerCase()}:${petTamerName.toLowerCase()}`;
}

function escortPrefix(clanName: string): string {
    return `clan-pet-escort:${clanName.toLowerCase()}:`;
}

export async function offerEscort(clanName: string, petTamerName: string): Promise<void> {
    await kv.set(escortKey(clanName, petTamerName), { offeredAt: Date.now() }, { ex: OFFER_TTL_S });
}

export async function cancelEscort(clanName: string, petTamerName: string): Promise<void> {
    await kv.del(escortKey(clanName, petTamerName));
}

// Returns the names of Pet Tamers currently offering escort to this clan.
// Verifies that each offerer is still actually in this clan (handles the
// case where a Pet Tamer left clan A and joined clan B — their stale A
// offer would otherwise still fire for A's Vanguards).
export async function listActiveEscorters(clanName: string): Promise<string[]> {
    try {
        const keys = await kv.keys(`${escortPrefix(clanName)}*`);
        const prefix = escortPrefix(clanName);
        const candidateNames = keys.map(k => k.slice(prefix.length)).filter(Boolean);
        if (candidateNames.length === 0) return [];

        // Cross-check each candidate's current clan membership. Stale offers
        // are best-effort deleted so they don't keep wasting lookup cost.
        const records = await kv.mget(...candidateNames.map(n => `save:${n.toLowerCase()}`));
        const valid: string[] = [];
        await Promise.all(candidateNames.map(async (name, i) => {
            const r = records[i] as Record<string, unknown> | null;
            const c = r?.character as Record<string, unknown> | undefined;
            const currentClan = typeof c?.clan === 'string' ? c.clan : '';
            if (currentClan.toLowerCase() === clanName.toLowerCase()) {
                valid.push(name);
            } else {
                // Best-effort cleanup of the stale offer.
                try { await kv.del(escortKey(clanName, name)); } catch { /* ignore */ }
            }
        }));
        return valid;
    } catch {
        return [];
    }
}
