import type { Character } from '../types/character';
import type { Pet } from '../types/pet';

export async function chooseStarterPetServer(playerName: string, pet: Pet): Promise<{ character?: Character; _saveVersion?: number; error?: string }> {
    const response = await fetch('/api/pet/choose-starter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, pet }),
    });
    const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; error?: string } | null;
    return response.ok ? (data ?? {}) : { error: data?.error || 'Starter choice was not committed.' };
}
