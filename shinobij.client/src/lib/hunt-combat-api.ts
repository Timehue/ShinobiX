import { parseHuntCombatAction } from '../../../shared/hunt-combat';
import type { SoloPveActionInput, SoloPveSession } from './solo-pve-api';
import type { TowerActionInput, TowerActionResponse, TowerSession } from './towers-api';

/** Presentation projection only; all mutations go through the hunt's original
 * authenticated, versioned fight endpoint and its existing settlement receipt. */
export function huntSessionForTower(session: SoloPveSession): TowerSession {
    if (!session.huntCombat) throw new Error('The server did not return a hunt battlefield.');
    return {
        ...session.huntCombat.battle,
        actionVersion: session.version,
    };
}

export async function fetchHuntCombatState(sessionId: string, playerName: string, signal?: AbortSignal): Promise<TowerSession> {
    const response = await fetch(`/api/solo-pve/state?sessionId=${encodeURIComponent(sessionId)}&playerName=${encodeURIComponent(playerName)}`, { signal });
    const body = await response.json() as { error?: string; session?: SoloPveSession };
    // An expired active fight returns its server-terminalized state with 410.
    if (!body.session || (!response.ok && !(response.status === 410 && body.session.status === 'done'))) throw new Error(body.error ?? 'The hunt battlefield could not be recovered.');
    return huntSessionForTower(body.session);
}

export async function submitHuntCombatAction(sessionId: string, playerName: string, intent: TowerActionInput, expectedVersion?: number): Promise<TowerActionResponse> {
    const parsed = intent.type === 'forfeit' ? null : parseHuntCombatAction(intent);
    if (intent.type !== 'forfeit' && !parsed) throw new Error('That command is not available in a hunt.');
    const action: SoloPveActionInput = intent.type === 'forfeit' ? { type: 'abandon' } : { type: 'huntAction', action: parsed! };
    const moveToken = crypto.randomUUID();
    // Resolved at call time so this lazy hunt chunk reuses the host's solo-PvE client
    // instead of forcing a shared chunk into the initial graph.
    const { submitSoloPveAction } = await import('./solo-pve-api');
    const request = () => submitSoloPveAction({ sessionId, playerName, expectedVersion: expectedVersion ?? 0, moveToken, action });
    let response;
    try { response = await request(); } catch { response = await request(); }
    if (!response.session) throw new Error(response.error ?? 'The server returned no hunt battlefield.');
    return { applied: response.applied === true, replayed: response.duplicate, reason: response.reason ?? response.error,
        session: huntSessionForTower(response.session), currentVersion: response.session.version };
}
