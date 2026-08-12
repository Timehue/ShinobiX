import type { Character } from '../types/character';
import type { ActiveJutsuTraining } from '../types/combat';

type Result = { character?: Character; activeJutsuTraining?: ActiveJutsuTraining | null; _saveVersion?: number; cost?: number; refund?: number; error?: string };

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function retryDelayMs(response: Response, attempt: number): number {
    const retryAfterSeconds = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(1_500, retryAfterSeconds * 1_000);
    }
    return 250 * (attempt + 1);
}

export async function mutateJutsuRyoTraining(playerName: string, action: 'start' | 'complete' | 'cancel' | 'finish' | 'queue' | 'cancel-queue' | 'advance', extra: Record<string, unknown>): Promise<Result> {
    const requestId = `${Date.now()}-${crypto.randomUUID().replace(/-/g, '')}`;
    const { bonusPct, ...rest } = extra;
    const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action, requestId, ...rest, ...(bonusPct === undefined ? {} : { trainingBonusPct: bonusPct }) }) };
    let lastError = 'The jutsu training server is unreachable.';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/training/jutsu-ryo', init);
            const data = await response.json().catch(() => null) as Result | null;
            if (response.ok && data) return data;
            lastError = data?.error || (RETRYABLE_STATUS.has(response.status)
                ? 'Jutsu training is temporarily busy. Please retry.'
                : 'Jutsu training was rejected.');
            if (!RETRYABLE_STATUS.has(response.status) || attempt === 1) break;
            await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs(response, attempt)));
        } catch {
            lastError = 'The jutsu training server is unreachable.';
            if (attempt === 0) await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
        }
    }
    return { error: lastError };
}
