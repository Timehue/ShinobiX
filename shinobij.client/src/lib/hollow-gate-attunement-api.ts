import type { Character } from '../types/character';

export async function buyHollowGateAttunementServer(playerName: string, id: string): Promise<{ character?: Character; _saveVersion?: number; error?: string }> {
    try {
        const response = await fetch('/api/hollow-gate/attune', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, id }),
        });
        const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; error?: string } | null;
        return response.ok && data ? data : { error: data?.error || 'The attunement was rejected.' };
    } catch {
        return { error: 'The attunement server is unreachable.' };
    }
}
