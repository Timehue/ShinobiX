import type { Character } from '../types/character';
import type { SoloPveSession } from './solo-pve-api';
import type { CaravanContract, CaravanProgress, CaravanWeather } from '../../../shared/sunscar/caravan-types';

export type CaravanResponse = {
    ok: true; progress: CaravanProgress; daily: { seed: number; weather: CaravanWeather; contracts: CaravanContract[] };
    serverNow: number; character: Character; _saveVersion: number; session?: SoloPveSession;
};
export async function requestCaravan(playerName: string, action?: Record<string, unknown>, signal?: AbortSignal): Promise<CaravanResponse> {
    const response = await fetch(action ? '/api/festival/caravan' : `/api/festival/caravan?playerName=${encodeURIComponent(playerName)}`, {
        method: action ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
        ...(action ? { body: JSON.stringify({ ...action, playerName }) } : {}), signal: signal ?? AbortSignal.timeout(20_000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'The dispatch office is unavailable. Please retry.');
    return data as CaravanResponse;
}
