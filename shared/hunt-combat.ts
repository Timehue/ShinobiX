/** Sealed once from the accepted hunt nonce; reconnects and rematches retain it. */
export type HuntFormation = {
    version: 1;
    kind: 'single' | 'waves' | 'pack';
    count: 1 | 2 | 3;
};

/** Intents only. Actor identity, turn order, stats and results stay server-owned. */
export type HuntCombatAction =
    | { type: 'move' | 'dash'; tile: number }
    | { type: 'attack' | 'clear'; targetId: string }
    | { type: 'jutsu'; jutsuId: string; targetId?: string; tile?: number }
    | { type: 'weapon'; targetId: string; itemId?: string }
    | { type: 'item'; itemId?: string }
    | { type: 'heal' | 'cleanse' | 'summon' | 'wait' | 'flee' };

export function parseHuntCombatAction(value: unknown): HuntCombatAction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const id = (key: string) => typeof raw[key] === 'string' && raw[key].length > 0 && raw[key].length <= 128 ? raw[key] as string : undefined;
    const tile = Number.isSafeInteger(raw.tile) && Number(raw.tile) >= 0 && Number(raw.tile) < 120 ? Number(raw.tile) : undefined;
    const targetId = id('targetId');
    const itemId = id('itemId');
    switch (raw.type) {
        case 'move': case 'dash': return tile !== undefined ? { type: raw.type, tile } : null;
        case 'attack': case 'clear': return targetId ? { type: raw.type, targetId } : null;
        case 'jutsu': {
            const jutsuId = id('jutsuId');
            if (!jutsuId || (raw.tile !== undefined && tile === undefined) || (raw.targetId !== undefined && !targetId)) return null;
            return { type: 'jutsu', jutsuId, ...(targetId ? { targetId } : {}), ...(tile !== undefined ? { tile } : {}) };
        }
        case 'weapon': return targetId ? { type: 'weapon', targetId, ...(itemId ? { itemId } : {}) } : null;
        case 'item': return { type: 'item', ...(itemId ? { itemId } : {}) };
        case 'heal': case 'cleanse': case 'summon': case 'wait': case 'flee': return { type: raw.type };
        default: return null;
    }
}
