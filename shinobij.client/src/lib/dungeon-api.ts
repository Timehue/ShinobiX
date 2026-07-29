import type { Character } from '../types/character';
export async function mutateDungeonRunServer(playerName: string, action: 'start' | 'settle' | 'abandon', token = ''): Promise<{ character: Character; token: string; _saveVersion?: number }> {
    const response = await fetch('/api/dungeon/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action, token }) });
    const data = await response.json().catch(() => null) as { character?: Character; token?: string; error?: string; _saveVersion?: number } | null;
    if (!response.ok || !data?.character || !data.token) throw new Error(data?.error || 'Dungeon run could not be verified.');
    return { character: data.character, token: data.token, _saveVersion: data._saveVersion };
}
