import type { Character } from '../types/character';
import type { ActiveJutsuTraining } from '../types/combat';

type Result = { character?: Character; activeJutsuTraining?: ActiveJutsuTraining | null; _saveVersion?: number; cost?: number; refund?: number; error?: string };
export async function mutateJutsuRyoTraining(playerName: string, action: 'start' | 'complete' | 'cancel' | 'finish' | 'queue' | 'cancel-queue' | 'advance', extra: Record<string, unknown>): Promise<Result> {
    const requestId = `${Date.now()}-${crypto.randomUUID().replace(/-/g, '')}`;
    const { bonusPct, ...rest } = extra;
    const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action, requestId, ...rest, ...(bonusPct === undefined ? {} : { trainingBonusPct: bonusPct }) }) };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/training/jutsu-ryo', init);
            const data = await response.json().catch(() => null) as Result | null;
            return response.ok && data ? data : { error: data?.error || 'Jutsu training was rejected.' };
        } catch { if (attempt === 1) return { error: 'The jutsu training server is unreachable.' }; }
    }
    return { error: 'The jutsu training server is unreachable.' };
}
