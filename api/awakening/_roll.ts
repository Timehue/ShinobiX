export const AWAKENING_ELEMENTS = ['Water', 'Wind', 'Earth', 'Lightning', 'Fire'] as const;
export const AWAKENING_FREE_LV2_ID = 'awakening-free-lv2';
export const AWAKENING_FREE_LV20_ID = 'awakening-free-lv20';

function currentElements(character: Record<string, unknown>): string[] {
    const raw = [...(Array.isArray(character.elements) ? character.elements : []), character.element];
    return [...new Set(raw.filter((v): v is string => typeof v === 'string' && AWAKENING_ELEMENTS.includes(v as typeof AWAKENING_ELEMENTS[number])))];
}

function pick(pool: readonly string[], randomIndex: (max: number) => number): string {
    return pool[Math.max(0, Math.min(pool.length - 1, Math.floor(randomIndex(pool.length))))] ?? AWAKENING_ELEMENTS[0];
}

export function rollAwakening(character: Record<string, unknown>, kindRaw: unknown, actionIdRaw: unknown, randomIndex: (max: number) => number = (max) => Math.floor(Math.random() * max)) {
    const kind = typeof kindRaw === 'string' ? kindRaw : '';
    const actionId = typeof actionIdRaw === 'string' ? actionIdRaw.trim().slice(0, 80) : '';
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId)) return { ok: false as const, reason: 'invalid-action-id' as const };
    const receipts = Array.isArray(character.redeemedAwakeningActions)
        ? (character.redeemedAwakeningActions as unknown[]).filter((id): id is string => typeof id === 'string').slice(-63) : [];
    if (receipts.includes(actionId)) return { ok: true as const, alreadyApplied: true, character };
    const claimed = Array.isArray(character.claimedAwakenings)
        ? (character.claimedAwakenings as unknown[]).filter((id): id is string => typeof id === 'string') : [];
    const owned = currentElements(character);
    let next: string[];
    let nextClaimed = claimed;
    let fateShards = Math.max(0, Math.floor(Number(character.fateShards) || 0));
    if (kind === AWAKENING_FREE_LV2_ID || kind === AWAKENING_FREE_LV20_ID) {
        const requiredLevel = kind === AWAKENING_FREE_LV2_ID ? 2 : 20;
        if (Math.max(1, Math.floor(Number(character.level) || 1)) < requiredLevel) return { ok: false as const, reason: 'awakening-level-required' as const };
        if (claimed.includes(kind)) return { ok: true as const, alreadyApplied: true, character };
        const available = AWAKENING_ELEMENTS.filter((element) => !owned.includes(element));
        next = [...new Set([...owned, pick(available.length ? available : AWAKENING_ELEMENTS, randomIndex)])];
        nextClaimed = [...claimed, kind];
    } else if (kind === 'paid') {
        if (fateShards < 10) return { ok: false as const, reason: 'insufficient-fate-shards' as const };
        const count = Math.max(1, Math.min(AWAKENING_ELEMENTS.length, owned.length));
        const pool = [...AWAKENING_ELEMENTS];
        next = [];
        while (next.length < count) {
            const element = pick(pool, randomIndex);
            next.push(element);
            pool.splice(pool.indexOf(element as typeof pool[number]), 1);
        }
        fateShards -= 10;
    } else return { ok: false as const, reason: 'invalid-awakening-kind' as const };
    return { ok: true as const, alreadyApplied: false, character: { ...character, element: next[0], elements: next, fateShards, claimedAwakenings: nextClaimed, redeemedAwakeningActions: [...receipts, actionId] } };
}
