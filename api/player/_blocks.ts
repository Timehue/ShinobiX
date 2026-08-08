import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';

export const MAX_BLOCKED_PLAYERS = 200;

export function blockListKey(player: string): string {
    return `player-blocks:${safeName(player)}`;
}

export function sanitizeBlockList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((entry) => safeName(String(entry ?? ''))).filter(Boolean))]
        .slice(0, MAX_BLOCKED_PLAYERS);
}

export function updateBlockList(current: unknown, target: string, blocked: boolean): string[] {
    const normalized = safeName(target);
    const list = sanitizeBlockList(current).filter((entry) => entry !== normalized);
    if (blocked && normalized) return [normalized, ...list].slice(0, MAX_BLOCKED_PLAYERS);
    return list;
}

export async function blockedPlayersFor(player: string): Promise<string[]> {
    return sanitizeBlockList(await kv.get<unknown>(blockListKey(player)));
}

export async function blockRelationship(a: string, b: string): Promise<{ aBlockedB: boolean; bBlockedA: boolean }> {
    const aName = safeName(a);
    const bName = safeName(b);
    const [aList, bList] = await Promise.all([blockedPlayersFor(aName), blockedPlayersFor(bName)]);
    return { aBlockedB: aList.includes(bName), bBlockedA: bList.includes(aName) };
}
