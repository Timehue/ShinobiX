import type { Character } from '../types/character';
import type { Pet } from '../types/pet';

export type HollowLockedDoorClientResult = {
    outcome: 'chest' | 'trap' | 'pet';
    rarity?: 'rare' | 'legendary' | 'mythic';
    pet?: Pet;
    petToken?: string;
    loot?: { xp: number; ryo?: number; fateShards?: number; boneCharms?: number; auraStones?: number; auraDust?: number; hollowShards: number };
    error?: string;
};

export async function befriendHollowGatePetServer(playerName: string, token: string): Promise<{ character?: Character; trait?: string | null; destination?: "roster" | "sanctuary" | null; saveVersion?: number; error?: string }> {
    try {
        const response = await fetch('/api/pet/befriend', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, token }),
        });
        const data = await response.json().catch(() => null) as { character?: Character; trait?: string | null; destination?: "roster" | "sanctuary" | null; _saveVersion?: number; error?: string } | null;
        return response.ok && data
            ? { character: data.character, trait: data.trait, destination: data.destination, saveVersion: data._saveVersion }
            : { error: data?.error || 'The pet could not be befriended.' };
    } catch {
        return { error: 'The pet server is unreachable.' };
    }
}
