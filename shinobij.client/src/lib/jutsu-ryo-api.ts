import { AMBIGUOUS_ACTION_MESSAGE } from './ambiguous-action';
import type { Character } from '../types/character';
import type { ActiveJutsuTraining } from '../types/combat';

type Result = { character?: Character; activeJutsuTraining?: ActiveJutsuTraining | null; _saveVersion?: number; cost?: number; refund?: number; error?: string };

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** Longest server-hinted wait worth one automatic retry; longer ones are surfaced. */
const MAX_HINTED_RETRY_MS = 1_500;

/** The server's rate limiter answers 429 with `retryAfterMs` in the body. */
function hintedRetryMs(data: unknown): number | null {
    const value = Number((data as { retryAfterMs?: unknown } | null)?.retryAfterMs);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function retryDelayMs(response: Response, attempt: number, data: unknown): number | null {
    // A 250ms retry of a rate-limited request lands in the same window, fails
    // again and spends more budget. Wait out a short hint; give up on a long one.
    const hinted = hintedRetryMs(data);
    if (hinted !== null) return hinted <= MAX_HINTED_RETRY_MS ? hinted + 50 : null;
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
    let lastError = AMBIGUOUS_ACTION_MESSAGE;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch('/api/training/jutsu-ryo', init);
            const data = await response.json().catch(() => null) as Result | null;
            if (response.ok && data) return data;
            const hinted = response.status === 429 ? hintedRetryMs(data) : null;
            lastError = response.status === 408 || response.status >= 500
                ? AMBIGUOUS_ACTION_MESSAGE
                : hinted !== null
                ? `Jutsu training is busy. Try again in ${Math.max(1, Math.ceil(hinted / 1000))}s.`
                : data?.error || (RETRYABLE_STATUS.has(response.status)
                ? 'Jutsu training is temporarily busy. Please retry.'
                : 'Jutsu training was rejected.');
            if (!RETRYABLE_STATUS.has(response.status) || attempt === 1) break;
            const delay = retryDelayMs(response, attempt, data);
            if (delay === null) break;
            await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
        } catch {
            lastError = AMBIGUOUS_ACTION_MESSAGE;
            if (attempt === 0) await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
        }
    }
    return { error: lastError };
}
