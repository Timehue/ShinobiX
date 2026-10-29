const leases = new Map<symbol, string>();
const ownerKey = (name: string) => name.toLowerCase();

/** Each embedded host owns its own lease; cleanup cannot clear another fight. */
export function beginEmbeddedCombat(playerName: string): () => void {
    const key = Symbol();
    leases.set(key, ownerKey(playerName));
    return () => { leases.delete(key); };
}

export function hasEmbeddedCombat(playerName: string | undefined): boolean {
    return !!playerName && [...leases.values()].includes(ownerKey(playerName));
}
