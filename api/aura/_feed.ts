export const AURA_SPHERE_ITEM_ID = 'aura-sphere';

export function auraSphereDustNeeded(levelRaw: unknown): number {
    const level = Math.max(1, Math.min(300, Math.floor(Number(levelRaw) || 1)));
    return Math.floor(12 + level * 2.5);
}

function ownsAuraSphere(character: Record<string, unknown>): boolean {
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const equipment = character.equipment && typeof character.equipment === 'object'
        ? Object.values(character.equipment as Record<string, unknown>)
        : [];
    return inventory.includes(AURA_SPHERE_ITEM_ID) || equipment.includes(AURA_SPHERE_ITEM_ID);
}

export function feedAuraSphere(character: Record<string, unknown>, actionIdRaw: unknown) {
    const actionId = typeof actionIdRaw === 'string' ? actionIdRaw.trim().slice(0, 80) : '';
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId)) return { ok: false as const, reason: 'invalid-action-id' as const };
    const receipts = Array.isArray(character.redeemedAuraFeeds)
        ? (character.redeemedAuraFeeds as unknown[]).filter((id): id is string => typeof id === 'string').slice(-127)
        : [];
    if (receipts.includes(actionId)) return { ok: true as const, alreadyApplied: true, cost: 0, character };
    if (!ownsAuraSphere(character)) return { ok: false as const, reason: 'aura-sphere-not-owned' as const };
    const level = Math.max(1, Math.floor(Number(character.auraSphereLevel) || 1));
    if (level >= 300) return { ok: false as const, reason: 'aura-sphere-max-level' as const };
    const cost = auraSphereDustNeeded(level);
    const dust = Math.max(0, Math.floor(Number(character.auraDust) || 0));
    if (dust < cost) return { ok: false as const, reason: 'insufficient-aura-dust' as const };
    return {
        ok: true as const,
        alreadyApplied: false,
        cost,
        character: {
            ...character,
            auraDust: dust - cost,
            auraSphereLevel: level + 1,
            redeemedAuraFeeds: [...receipts, actionId],
        },
    };
}
