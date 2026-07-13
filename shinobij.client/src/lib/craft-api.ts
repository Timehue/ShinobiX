import type { Character } from '../types/character';
import type { GameItem } from '../types/combat';
import { makeId } from './utils';

export type CraftKind = 'supply' | 'weapon' | 'armor' | 'relic';
export const NAMED_WEAPON_TAGS = ['Siphon', 'Absorb', 'Poison', 'Wound', 'Reflect', 'Shield', 'Drain', 'Ignition', 'Heal', 'Increase Damage Given', 'Increase Generals', 'Decrease Damage Taken'] as const;
export const NAMED_ARMOR_SPECIALS = ['Absorb', 'Shield', 'Reflect', 'Life Steal', 'Increase Damage'] as const;
export async function forgeServer(playerName: string, kind: CraftKind, recipeId: string, quantity = 1): Promise<{ character?: Character; _saveVersion?: number; error?: string }> {
    try {
        const response = await fetch('/api/craft/forge', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, kind, recipeId, quantity, requestId: makeId() }),
        });
        const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; error?: string } | null;
        return response.ok && data ? data : { error: data?.error || 'The forge rejected this recipe.' };
    } catch { return { error: 'The forge is unreachable.' }; }
}

export async function rollNamedForgeServer<T>(playerName: string, kind: 'weapon' | 'armor', slot?: string): Promise<{ token?: string; roll?: T; error?: string }> {
    try {
        const response = await fetch('/api/craft/named', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action: 'roll', kind, slot }) });
        const data = await response.json().catch(() => null) as { token?: string; roll?: T; error?: string } | null;
        return response.ok && data ? data : { error: data?.error || 'The named forge roll failed.' };
    } catch { return { error: 'The named forge is unreachable.' }; }
}

export async function commitNamedForgeServer(playerName: string, token: string, name: string, flavorText: string): Promise<{ character?: Character; _saveVersion?: number; item?: GameItem | null; error?: string }> {
    try {
        const response = await fetch('/api/craft/named', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action: 'forge', token, name, flavorText }) });
        const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; item?: GameItem | null; error?: string } | null;
        return response.ok && data ? data : { error: data?.error || 'The named forge commit failed.' };
    } catch { return { error: 'The named forge is unreachable.' }; }
}
