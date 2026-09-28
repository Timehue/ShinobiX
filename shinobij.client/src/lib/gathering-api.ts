import type { Character } from '../types/character';
import type { GatherChoice, GatherYield, PendingGatherFind } from '../../../shared/gathering';

export async function claimGatherFind(playerName: string, find: PendingGatherFind, choice: GatherChoice): Promise<{
    character?: Character; saveVersion?: number; rewards?: GatherYield; error?: string;
}> {
    try {
        const response = await fetch('/api/world/claim-gather', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, findId: find.id, sector: find.sector, ...choice }),
        });
        const data = await response.json();
        if (!response.ok || !data.character) return { error: data.error || 'Your find remains saved. Try again.' };
        return { character: data.character, saveVersion: data._saveVersion, rewards: data.rewards };
    } catch { return { error: 'Connection lost. Your find remains saved; retry this choice when connected.' }; }
}
