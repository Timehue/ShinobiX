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
export async function listActiveEscorters(clanName: string): Promise<string[]> {
    try {
        const keys = await kv.keys(`${escortPrefix(clanName)}*`);
        const prefix = escortPrefix(clanName);
        return keys.map(k => k.slice(prefix.length)).filter(Boolean);
    } catch {
        return [];
    }
}
