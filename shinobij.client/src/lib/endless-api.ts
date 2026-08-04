import type { Character, EndlessTowerRun } from '../types/character';
import type { SoloPveSession } from './solo-pve-api';

export type EndlessMutationResult = { character?: Character; _saveVersion?: number; run?: EndlessTowerRun | null; outcome?: 'win' | 'loss' | 'fled' | 'draw'; reward?: { ryo: number; xp: number }; milestone?: { boneCharms: number; fateShards: number }; creditedXp?: number; creditedRyo?: number; replayed?: boolean; error?: string };
export type EndlessWaveStartResult = { ok: boolean; runId: string; wave: number; session: SoloPveSession; error?: string };

export async function mutateEndlessRun(playerName: string, action: 'start' | 'settle' | 'cashout' | 'abandon', extra: Record<string, unknown> = {}): Promise<EndlessMutationResult> {
    const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action, ...extra }) };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/endless/run', init);
            const data = await response.json().catch(() => null) as EndlessMutationResult | null;
            return response.ok && data ? data : { error: data?.error || 'The Endless Tower seal rejected this action.' };
        } catch { if (attempt === 1) return { error: 'The Endless Tower server is unreachable.' }; }
    }
    return { error: 'The Endless Tower server is unreachable.' };
}

export async function startEndlessWave(playerName: string, runToken: string): Promise<EndlessWaveStartResult> {
    const response = await fetch('/api/endless/wave-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, runToken }),
    });
    const data = await response.json().catch(() => ({})) as Partial<EndlessWaveStartResult>;
    if (!response.ok || !data.runId || !data.wave || !data.session) {
        throw new Error(data.error ?? 'The Endless Tower wave could not be sealed.');
    }
    return data as EndlessWaveStartResult;
}
