import type { Character } from '../types/character';

export type CardPackType = 'standard' | 'fire' | 'water' | 'earth' | 'wind' | 'lightning' | 'epic' | 'legendary';

export interface CardPackResult {
    ok: boolean;
    error?: string;
    cards?: string[];
    currency?: 'ryo' | 'fateShards' | 'chroniclePoints';
    cost?: number;
    balance?: number;
    character?: Character;
    _saveVersion?: number;
    replayed?: boolean;
}

// Match the existing shop settlement retry convention: keep one pending intent
// across an ambiguous reply and page refresh; a confirmed purchase retires it.
const pendingRequestIds = new Map<string, string>();

function pendingKeyFor(playerName: string, packType: CardPackType): string {
    return `shinobix.card-pack:${JSON.stringify({ playerName, packType })}`;
}

function readPendingRequestId(key: string): string | undefined {
    let id = pendingRequestIds.get(key);
    try { id = sessionStorage.getItem(key) || id; } catch { /* in-memory fallback */ }
    return id && /^[A-Za-z0-9_-]{16,80}$/.test(id) ? id : undefined;
}

/** A pending intent may need replay, or may not yet have reached the server. */
export function hasPendingCardPackRequest(playerName: string, packType: CardPackType): boolean {
    return readPendingRequestId(pendingKeyFor(playerName, packType)) !== undefined;
}

function pendingRequestId(key: string): string {
    let id = readPendingRequestId(key);
    if (!id) {
        if (typeof crypto.randomUUID === 'function') id = crypto.randomUUID().replaceAll('-', '');
        else {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        }
    }
    pendingRequestIds.set(key, id);
    try { sessionStorage.setItem(key, id); } catch { /* in-memory fallback */ }
    return id;
}

function clearPendingRequest(key: string, id: string): void {
    // A late duplicate reply must not clear a newer purchase's pending identity.
    if (pendingRequestIds.get(key) === id) pendingRequestIds.delete(key);
    try { if (sessionStorage.getItem(key) === id) sessionStorage.removeItem(key); } catch { /* in-memory fallback */ }
}

export async function openCardPack(playerName: string, packType: CardPackType): Promise<CardPackResult> {
    const pendingKey = pendingKeyFor(playerName, packType);
    const requestId = pendingRequestId(pendingKey);
    try {
        const response = await fetch('/api/card-clash/open-pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, packType, requestId }),
        });
        const data = await response.json().catch(() => ({})) as CardPackResult;
        if (!response.ok || !data.ok || !data.character || !Array.isArray(data.cards)) {
            // Validation/conflict are definite rejections. Authentication,
            // throttling, server failures and malformed success remain pending.
            if (response.status === 400 || response.status === 409) clearPendingRequest(pendingKey, requestId);
            return { ok: false, error: data.error || 'Could not open the card pack.' };
        }
        // Keep the existing response contract: the shared character coordinator
        // decides whether a legacy unversioned snapshot can be adopted.
        clearPendingRequest(pendingKey, requestId);
        return data;
    } catch {
        return { ok: false, error: 'Pack opening unconfirmed. Refresh before retrying to recover the same purchase.' };
    }
}
