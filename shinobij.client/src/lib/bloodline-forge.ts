import type { Character } from '../types/character';
import type { Rank } from '../types/core';

export interface BloodlineForgeResult {
    ok: boolean;
    error?: string;
    rank?: Rank;
    currency?: 'boneCharms' | 'auraStones' | 'mythicSeals';
    cost?: number;
    balance?: number;
    character?: Character;
    _saveVersion?: number;
}

export async function purchaseBloodlineForge(playerName: string, rank: Rank): Promise<BloodlineForgeResult> {
    try {
        const response = await fetch('/api/bloodlines/forge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, rank }),
        });
        const data = await response.json().catch(() => ({})) as BloodlineForgeResult;
        if (!response.ok || !data.ok || !data.character) {
            return { ok: false, error: data.error || 'Could not purchase the bloodline forge.' };
        }
        return data;
    } catch {
        return { ok: false, error: 'Could not reach the bloodline forge. Please try again.' };
    }
}
