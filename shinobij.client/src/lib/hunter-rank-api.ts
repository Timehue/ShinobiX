import type { Character } from '../types/character';

export type HunterRankMutation = { character: Character; _saveVersion: number };

export async function rankUpHunterServer(playerName: string): Promise<HunterRankMutation> {
    const payload = { playerName, actionId: `hunter_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '')}` };
    let message = 'Hunter Rank advancement failed.';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/hunter/rank-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: unknown; error?: string } | null;
            if (response.ok && data?.character && typeof data._saveVersion === 'number' && Number.isSafeInteger(data._saveVersion) && data._saveVersion > 0) {
                return { character: data.character, _saveVersion: data._saveVersion };
            }
            if (response.ok && data?.character) message = 'Hunter Rank advanced, but its save receipt was invalid. Refresh before continuing.';
            message = data?.error || message;
            if (response.status < 500) break;
        } catch { message = 'Hunter Rank advancement could not reach the server.'; }
    }
    throw new Error(message);
}
