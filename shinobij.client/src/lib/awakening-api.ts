import type { Character } from '../types/character';

export type AwakeningRollResult = {
    character: Character;
    _saveVersion?: number;
};

export async function rollAwakeningServer(playerName: string, kind: string): Promise<AwakeningRollResult> {
    const payload = { playerName, kind, actionId: `awaken_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '')}` };
    let message = 'Elemental awakening failed.';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/awakening/roll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await response.json().catch(() => null) as { character?: Character; error?: string; _saveVersion?: number } | null;
            if (response.ok && data?.character) return { character: data.character, _saveVersion: data._saveVersion };
            message = data?.error || message;
            if (response.status < 500) break;
        } catch { message = 'Elemental awakening could not reach the server.'; }
    }
    throw new Error(message);
}
