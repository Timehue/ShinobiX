import type { Character } from '../types/character';

function actionId(): string {
    return `aura_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export async function feedAuraSphereServer(playerName: string): Promise<Character> {
    const payload = { playerName, actionId: actionId() };
    let lastError = 'Aura Sphere feed failed.';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/aura/feed', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => null) as { character?: Character; error?: string } | null;
            if (response.ok && data?.character) return data.character;
            lastError = data?.error || lastError;
            if (response.status < 500) break;
        } catch {
            lastError = 'Aura Sphere feed could not reach the server.';
        }
    }
    throw new Error(lastError);
}
