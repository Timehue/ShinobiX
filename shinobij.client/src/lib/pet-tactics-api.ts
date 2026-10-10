import { PET_TACTICS_RULESET, type TacticsView } from '../../../shared/pet-tactics-contract';

export async function petTacticsRequest(action: string, payload: Record<string, unknown> = {}): Promise<TacticsView | null> {
    const response = await fetch('/api/pet/tactics', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }), signal: AbortSignal.timeout(12_000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? 'The arena did not answer. Retry to recover your locked orders.');
    if (data?.idle === true) return null;
    if (data?.ruleset !== PET_TACTICS_RULESET || !Array.isArray(data.own) || !Array.isArray(data.enemy) || !Array.isArray(data.transcript)) throw new Error('The arena returned an invalid battle state.');
    return data as TacticsView;
}
