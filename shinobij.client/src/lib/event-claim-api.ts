import type { Character } from '../types/character';

export async function claimBuiltinEventReward(playerName: string, eventId: string): Promise<{ character?: Character; _saveVersion?: number; alreadyClaimed?: boolean; error?: string }> {
    try {
        const response = await fetch('/api/events/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, eventId }),
        });
        const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; alreadyClaimed?: boolean; error?: string } | null;
        return response.ok && data ? data : { error: data?.error || 'This event has no server-approved reward.' };
    } catch {
        return { error: 'The event reward server is unreachable.' };
    }
}
