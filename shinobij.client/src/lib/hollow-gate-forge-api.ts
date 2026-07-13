import type { Character } from '../types/character';

export type HollowGateKeyForgeSource = 'hollowShards' | 'dungeonKeys' | 'fateShards';

export async function forgeHollowGateKeyServer(playerName: string, source: HollowGateKeyForgeSource): Promise<{ character?: Character; _saveVersion?: number; error?: string }> {
    const response = await fetch('/api/hollow-gate/forge-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, source }),
    });
    const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; error?: string } | null;
    if (!response.ok) return { error: data?.error || 'The key forge failed.' };
    return data ?? { error: 'The key forge returned no result.' };
}
