import { isTransferVillage } from '../../../shared/village-transfer';

export type VillageTransferIntent = { kind: 'purchase'; requestId: string }
    | { kind: 'transfer'; requestId: string; fromVillage: string; village: string };
const pending = new Map<string, VillageTransferIntent>();
const keyFor = (name: string) => `shinobix.village-transfer:${name.trim().toLowerCase()}`;

/** Preserve uncertain operations across navigation and reloads, scoped to the account. */
export function readVillageTransferIntent(name: string): VillageTransferIntent | null {
    const key = keyFor(name);
    let value: unknown = pending.get(key);
    try {
        const saved = sessionStorage.getItem(key);
        if (saved) value = JSON.parse(saved);
    } catch { /* Storage unavailable: retain the in-memory operation. */ }
    if (!value || typeof value !== 'object') return null;
    const intent = value as Record<string, unknown>;
    if (typeof intent.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(intent.requestId)) return null;
    if (intent.kind !== 'purchase' && !(intent.kind === 'transfer'
        && isTransferVillage(intent.fromVillage) && isTransferVillage(intent.village) && intent.fromVillage !== intent.village)) return null;
    return value as VillageTransferIntent;
}

export function retainVillageTransferIntent(name: string, intent: VillageTransferIntent): void {
    const key = keyFor(name);
    pending.set(key, intent);
    try { sessionStorage.setItem(key, JSON.stringify(intent)); } catch { /* In-memory fallback. */ }
}

export function clearVillageTransferIntent(name: string): void {
    const key = keyFor(name);
    pending.delete(key);
    try { sessionStorage.removeItem(key); } catch { /* In-memory fallback. */ }
}
