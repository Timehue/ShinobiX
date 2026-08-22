import type { Character } from '../types/character';
import { runSingleFlight } from './single-flight';

type BuiltinEventClaim = { character?: Character; _saveVersion?: number; alreadyClaimed?: boolean; error?: string };

/**
 * One in-flight claim per player+event.
 *
 * The VN action lock that guards the finale button self-heals after 1.5s (it
 * has to — holding it forever is what wedged the whole overlay), which is
 * shorter than a slow round trip. A second click inside that window used to
 * issue a second claim against an in-flight one. The endpoint is idempotent
 * (api/events/_claim.ts refuses an already-claimed event), so this was never a
 * double-grant — but the duplicate response drove a second versioned commit
 * that can lose a save-version race. Sharing the promise makes the second click
 * adopt the first result. A settled claim clears the entry, so a retry after a
 * failure still goes to the server immediately.
 */
const inFlightClaims = new Map<string, Promise<BuiltinEventClaim>>();

export function claimBuiltinEventReward(playerName: string, eventId: string): Promise<BuiltinEventClaim> {
    return runSingleFlight(inFlightClaims, `${playerName.trim().toLowerCase()}::${eventId}`, () => postClaim(playerName, eventId));
}

async function postClaim(playerName: string, eventId: string): Promise<BuiltinEventClaim> {
    try {
        const response = await fetch('/api/events/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, eventId }),
            // Load-bearing for the single-flight above, not just good hygiene:
            // sharing the promise means a hung request would swallow every retry
            // click with it, where an unshared call at least got a fresh socket.
            // A deadline makes the shared promise settle, which clears the map
            // and lets the next click actually reach the server. 12s matches the
            // other player-facing deadlines in this client.
            signal: AbortSignal.timeout(12_000),
        });
        const data = await response.json().catch(() => null) as { character?: Character; _saveVersion?: number; alreadyClaimed?: boolean; error?: string } | null;
        return response.ok && data ? data : { error: data?.error || 'This event has no server-approved reward.' };
    } catch {
        return { error: 'The event reward server is unreachable.' };
    }
}
