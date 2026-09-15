import type { Character } from '../types/character';
import type { RallyProgress } from '../../../shared/sunscar/rally-championship';
import type { RallyState } from '../../../shared/sunscar/rally-types';
export type RallyResponse = {
    ok: true; progress: RallyProgress; daily: { day: string; seed: number; tracks: string[]; rivals: string[] };
    serverNow: number; practice?: RallyState; preview?: RallyState; character?: Character; _saveVersion?: number;
};
export async function requestRally(playerName: string, action?: Record<string, unknown>, signal?: AbortSignal): Promise<RallyResponse> {
    const response = await fetch(action ? '/api/festival/rally' : `/api/festival/rally?playerName=${encodeURIComponent(playerName)}`, {
        method: action ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
        ...(action ? { body: JSON.stringify({ ...action, playerName }) } : {}), signal: signal ?? AbortSignal.timeout(20_000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'The race desk is unavailable. Please retry.');
    return data as RallyResponse;
}
