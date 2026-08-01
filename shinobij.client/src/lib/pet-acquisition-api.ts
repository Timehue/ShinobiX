import type { Character } from '../types/character';
import type { Pet } from '../types/pet';

/**
 * Commit the cost of summoning a pet into a CLIENT-RUN PvE fight — one point of
 * PVE-gear durability (and the gear itself once spent) plus the battle
 * consumable. `loadout` is a server-owned pet field, so the caller's local edit
 * is only an optimistic mirror; without this the spend is discarded by the save
 * and the gear never wears out. Best-effort by design: a failure leaves the
 * pet's gear intact and the fight continues either way, so callers `void` it.
 */
export async function spendPetSummonCost(playerName: string, petId: string): Promise<void> {
    try {
        await fetch('/api/pet/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, petId, action: 'summon-spend' }),
        });
    } catch { /* offline / transient — the pet simply keeps its gear */ }
}

export async function chooseStarterPetServer(playerName: string, pet: Pet): Promise<{ character?: Character; _saveVersion?: number; error?: string }> {
    const response = await fetch('/api/pet/choose-starter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, pet }),
    });
    const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; error?: string } | null;
    return response.ok ? (data ?? {}) : { error: data?.error || 'Starter choice was not committed.' };
}
