import type { TacticsBuild } from '../../../shared/pet-tactics-contract';
import type { Character } from '../types/character';

export async function savePetRankedBuild(playerName: string, build: TacticsBuild): Promise<{ character: Character; _saveVersion: number }> {
    const res = await fetch('/api/pet/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, petId: build.ownedPetId, action: 'ranked-build', build }), signal: AbortSignal.timeout(12_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.character || !Number.isSafeInteger(data._saveVersion)) throw new Error(String(data.error ?? 'The ranked loadout could not be saved.'));
    return data;
}
