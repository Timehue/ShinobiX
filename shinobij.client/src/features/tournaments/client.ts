import type { TournamentResponse } from '../../../../shared/tournaments';
export async function tournamentRequest<T = TournamentResponse>(action?: Record<string, unknown>, credential?: string): Promise<T> {
    const response = await fetch('/api/tournaments/event', {
        method: action ? 'POST' : 'GET', signal: AbortSignal.timeout(20_000),
        headers: { ...(action ? { 'Content-Type': 'application/json' } : {}), ...(credential ? { 'x-admin-password': credential } : {}) },
        ...(action ? { body: JSON.stringify(action) } : {}),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Unable to reach tournaments.');
    return body as T;
}
