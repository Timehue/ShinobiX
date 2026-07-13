import type { Character, EndlessTowerRun } from '../types/character';

type Result = { character?: Character; _saveVersion?: number; run?: EndlessTowerRun; reward?: { ryo: number; xp: number }; milestone?: { boneCharms: number; fateShards: number }; creditedXp?: number; creditedRyo?: number; error?: string };
export async function mutateEndlessRun(playerName: string, action: 'start' | 'win' | 'cashout' | 'abandon', extra: Record<string, unknown> = {}): Promise<Result> {
    const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action, ...extra }) };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/endless/run', init);
            const data = await response.json().catch(() => null) as Result | null;
            return response.ok && data ? data : { error: data?.error || 'The Endless Tower seal rejected this action.' };
        } catch { if (attempt === 1) return { error: 'The Endless Tower server is unreachable.' }; }
    }
    return { error: 'The Endless Tower server is unreachable.' };
}
