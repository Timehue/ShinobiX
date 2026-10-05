import { isProfession } from '../../../shared/profession-change';
import type { Profession } from '../types/core';

export type ProfessionChangeIntent = { kind: 'purchase'; requestId: string }
    | { kind: 'change'; requestId: string; fromProfession: Profession; fromProfessionChosenAt: number | null; profession: Profession };
const pending = new Map<string, ProfessionChangeIntent>();
const keyFor = (name: string) => `shinobix.profession-change:${name.trim().toLowerCase()}`;

/** Keep an uncertain purchase/change recoverable across navigation and reloads. */
export function readProfessionChangeIntent(name: string): ProfessionChangeIntent | null {
    const key = keyFor(name);
    let value: unknown = pending.get(key);
    try {
        const saved = sessionStorage.getItem(key);
        if (saved) value = JSON.parse(saved);
    } catch { /* In-memory fallback when storage is unavailable. */ }
    if (!value || typeof value !== 'object') return null;
    const intent = value as Record<string, unknown>;
    if (typeof intent.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(intent.requestId)) return null;
    if (intent.kind !== 'purchase' && !(intent.kind === 'change'
        && isProfession(intent.fromProfession) && isProfession(intent.profession) && intent.fromProfession !== intent.profession
        && (intent.fromProfessionChosenAt === null || (typeof intent.fromProfessionChosenAt === 'number' && Number.isSafeInteger(intent.fromProfessionChosenAt))))) return null;
    return value as ProfessionChangeIntent;
}

export function retainProfessionChangeIntent(name: string, intent: ProfessionChangeIntent): void {
    pending.set(keyFor(name), intent);
    try { sessionStorage.setItem(keyFor(name), JSON.stringify(intent)); } catch { /* In-memory fallback. */ }
}

export function clearProfessionChangeIntent(name: string): void {
    pending.delete(keyFor(name));
    try { sessionStorage.removeItem(keyFor(name)); } catch { /* In-memory fallback. */ }
}
