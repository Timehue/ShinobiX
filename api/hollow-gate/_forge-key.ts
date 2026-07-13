export type KeyForgeSource = 'hollowShards' | 'dungeonKeys' | 'fateShards';
export const KEY_FORGE_COSTS = { hollowShards: 80, dungeonKeys: 5, fateShards: 10 } as const;

function countItem(character: Record<string, unknown>, itemId: string): number {
    const inventory = Array.isArray(character.inventory) ? character.inventory as unknown[] : [];
    const inline = inventory.filter((id) => id === itemId).length;
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : [];
    return inline + stacks.filter((s) => s?.itemId === itemId).reduce((n, s) => n + Math.max(0, Math.floor(Number(s.count) || 0)), 0);
}

function consumeItem(character: Record<string, unknown>, itemId: string, amount: number) {
    let remaining = amount;
    const stacks = (Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : []).flatMap((s) => {
        if (s?.itemId !== itemId || remaining <= 0) return [s];
        const count = Math.max(0, Math.floor(Number(s.count) || 0));
        const used = Math.min(count, remaining); remaining -= used;
        return count > used ? [{ ...s, count: count - used }] : [];
    });
    const inventory: string[] = [];
    for (const raw of Array.isArray(character.inventory) ? character.inventory : []) {
        if (raw === itemId && remaining > 0) { remaining -= 1; continue; }
        if (typeof raw === 'string') inventory.push(raw);
    }
    return { ...character, inventory, itemStacks: stacks };
}

export function forgeHollowGateKey(character: Record<string, unknown>, source: KeyForgeSource):
    | { ok: true; character: Record<string, unknown> }
    | { ok: false; reason: 'invalid-source' | 'forge-locked' | 'insufficient-materials' } {
    if (!(source in KEY_FORGE_COSTS)) return { ok: false as const, reason: 'invalid-source' as const };
    let next = { ...character };
    if (source === 'hollowShards') {
        const att = character.hollowGateAttunement as Record<string, unknown> | undefined;
        if (Math.floor(Number(att?.['key-forge']) || 0) < 1) return { ok: false as const, reason: 'forge-locked' as const };
        if (Number(character.hollowShards) < KEY_FORGE_COSTS.hollowShards) return { ok: false as const, reason: 'insufficient-materials' as const };
        next.hollowShards = Number(character.hollowShards) - KEY_FORGE_COSTS.hollowShards;
    } else if (source === 'fateShards') {
        if (Number(character.fateShards) < KEY_FORGE_COSTS.fateShards) return { ok: false as const, reason: 'insufficient-materials' as const };
        next.fateShards = Number(character.fateShards) - KEY_FORGE_COSTS.fateShards;
    } else {
        if (countItem(character, 'dungeon-key') < KEY_FORGE_COSTS.dungeonKeys) return { ok: false as const, reason: 'insufficient-materials' as const };
        next = consumeItem(next, 'dungeon-key', KEY_FORGE_COSTS.dungeonKeys);
    }
    const inventory = Array.isArray(next.inventory) ? next.inventory as string[] : [];
    return { ok: true as const, character: { ...next, inventory: [...inventory, 'hollow-gate-key'] } };
}
