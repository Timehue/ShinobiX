import type { Character } from '../types/character';
import type { GameItem } from '../types/combat';
import { makeId } from './utils';
import type { CraftMaterialSelection } from '../../../shared/crafting-recipes';
import { pendingEconomyIntent, readPendingEconomyIntent, economyIntentSettled } from './economy-request-intent';

export type CraftKind = 'supply' | 'weapon' | 'armor' | 'relic';
export { NAMED_WEAPON_TAGS } from '../../../shared/named-forge-roll';
import { NAMED_ARMOR_SPECIALS as ARMOR_SPECIALS } from '../../../shared/named-forge-roll';
export const NAMED_ARMOR_SPECIALS = ARMOR_SPECIALS.map((special) => special.kind);
export async function forgeServer(playerName: string, kind: CraftKind, recipeId: string, quantity = 1, materials?: CraftMaterialSelection): Promise<{ character?: Character; _saveVersion?: number; error?: string }> {
    const intent = materials ? pendingEconomyIntent('craft-forge', [playerName, kind, recipeId, quantity, materials]) : null;
    try {
        const response = await fetch('/api/craft/forge', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, kind, recipeId, quantity, materials, requestId: intent?.requestId ?? makeId() }),
        });
        const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; error?: string } | null;
        if (intent && economyIntentSettled(response.status, data) && (!response.ok || (data?.character && Number.isSafeInteger(data._saveVersion)))) intent.complete();
        return response.ok && data ? data : { error: data?.error || 'The forge rejected this recipe.' };
    } catch { return { error: 'The forge is unreachable.' }; }
}

export type NamedRollResult<T> = { character?: Character; _saveVersion?: number; item?: GameItem | null; roll?: T | null; replayed?: boolean; error?: string };

function namedRollIntentParts(playerName: string, kind: 'weapon' | 'armor', slot?: string) {
    return [playerName, kind, slot ?? ''];
}

/** A depleted wallet may already reflect this exact unconfirmed roll's price. */
export function hasPendingNamedForgeRoll(playerName: string, kind: 'weapon' | 'armor', slot?: string): boolean {
    return readPendingEconomyIntent('named-roll', namedRollIntentParts(playerName, kind, slot)) !== null;
}

/**
 * One paid named-gear roll (owner ruling 2026-10-15): the server charges the
 * roll, rolls it and keeps the item in one write — there is no discard. The
 * name and flavor text are chosen before rolling. The request id survives a
 * retry, so a lost response returns the same item instead of charging twice.
 */
export async function rollNamedForgeServer<T>(playerName: string, kind: 'weapon' | 'armor', options: { slot?: string; name: string; flavorText: string }): Promise<NamedRollResult<T>> {
    const intent = pendingEconomyIntent('named-roll', namedRollIntentParts(playerName, kind, options.slot));
    try {
        const response = await fetch('/api/craft/named', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, action: 'roll', kind, slot: options.slot, name: options.name, flavorText: options.flavorText, requestId: intent.requestId.replace(/-/g, '') }),
        });
        const data = await response.json().catch(() => null) as NamedRollResult<T> | null;
        if (economyIntentSettled(response.status, data) && (!response.ok || (data?.character && Number.isSafeInteger(data._saveVersion)))) intent.complete();
        return response.ok && data ? data : { error: data?.error || 'The named forge roll failed.' };
    } catch { return { error: 'The named forge is unreachable.' }; }
}
