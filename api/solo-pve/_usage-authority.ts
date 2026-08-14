import type { SoloPveSession } from './_session.js';

export type SoloPveUsageAuthorityResult =
    | { ok: true; session: SoloPveSession; replayed: boolean }
    | { ok: false; status: number; error: string };

/**
 * Validate the terminal usage evidence before an owning settlement applies its
 * item and companion costs in the same versioned save write as HP/rewards.
 *
 * The current Solo-PvE runtime seals item/companion usage directly into the
 * terminal session. Keeping this adapter central lets mission and World AI
 * settlements share the same fail-closed contract without reintroducing the
 * retired action-time side ledgers.
 */
export async function settleSoloPveTerminalUsage(
    session: SoloPveSession,
    playerName: string,
): Promise<SoloPveUsageAuthorityResult> {
    if (session.ownerSlug.toLowerCase() !== playerName.toLowerCase()) {
        return { ok: false, status: 403, error: 'That solo-PvE usage belongs to another player.' };
    }
    if (session.status !== 'done' || !session.terminalEvidence) {
        return { ok: false, status: 409, error: 'Terminal solo-PvE usage cannot be verified.' };
    }
    const terminalItems = session.terminalEvidence.itemsUsed;
    const itemKeys = new Set([...Object.keys(session.itemsUsed), ...Object.keys(terminalItems)]);
    for (const itemId of itemKeys) {
        const live = Number(session.itemsUsed[itemId] ?? 0);
        const sealed = Number(terminalItems[itemId] ?? 0);
        if (!Number.isSafeInteger(live) || live < 0 || live !== sealed) {
            return { ok: false, status: 409, error: 'The terminal combat-item usage authority is invalid.' };
        }
    }
    return { ok: true, session, replayed: session.settlementState === 'settled' };
}
