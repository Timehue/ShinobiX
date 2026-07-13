import type { Character } from '../types/character';

export async function rankUpHunterServer(playerName: string): Promise<Character> {
    const payload = { playerName, actionId: `hunter_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '')}` };
    let message = 'Hunter Rank advancement failed.';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/hunter/rank-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await response.json().catch(() => null) as { character?: Character; error?: string } | null;
            if (response.ok && data?.character) return data.character;
            message = data?.error || message;
            if (response.status < 500) break;
        } catch { message = 'Hunter Rank advancement could not reach the server.'; }
    }
    throw new Error(message);
}
