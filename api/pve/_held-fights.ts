/*
 * Settle a player's held fights before another fight is sealed from their save.
 *
 * A fight seeded from the save is fought on the HP (and, in the open world, the
 * chakra and stamina) the save holds when the fight is sealed. A fight that is
 * finished but not settled yet, or left open, has not been charged to the save,
 * so a second fight sealed in the meantime started on a pool the first had
 * already spent. Hold one report back and the next fight is fought on HP the
 * player no longer has. Each settlement already charges what the save lost
 * since its fight was sealed (missions/_ai-fight-outcome.ts
 * `vitalLostSinceSeal`), so the final HP came out right, but the second fight
 * could still be won on that phantom HP.
 *
 * So every route that seals a fight from the save calls settleHeldFights FIRST,
 * before it reads the save to seed the new fighter
 * (api/pve/_held-fights-routes.test.ts fails a route that does not):
 *   - a FINISHED held fight has its physical consequence written now, through
 *     the generic path (./_fight-outcome-settlement.ts) and against the receipt
 *     its own mode's settlement honours, so that settlement still pays its
 *     rewards and leaves the HP alone;
 *   - an OPEN one is abandoned and settled: the walk-away rule the lapse
 *     reconciler applies once it expires (10% of max HP, a loss, nothing paid),
 *     because starting another fight IS walking away from it;
 *   - a Hollow Gate dive fight belongs to its dive (api/hollow-gate/combat-settle.ts),
 *     so while one is still open the new fight is refused instead, before any
 *     other held fight is touched.
 * The index of held fights (api/solo-pve/_held-fight-index.ts) is written when
 * a fight is sealed and pruned here.
 */
import { createHash } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { pushSaveVersion } from '../_realtime/notify.js';
import { readSoloPveSession } from '../solo-pve/_store.js';
import { abandonSoloPveSession, isHollowGateFightSession } from '../solo-pve/_abandon.js';
import { heldFightsKey } from '../solo-pve/_held-fight-index.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { readPveOutcomeMarker, settlePveFightOutcome } from './_fight-outcome-settlement.js';

export type HeldFightsResult =
    | { ok: true; settled: number; saveVersion?: number }
    | { ok: false; status: 409; error: string; reason: 'hollow-gate-encounter-open' };

export const HOLLOW_GATE_ENCOUNTER_OPEN = 'Finish your Hollow Gate encounter before starting another fight.';

/** Abandoning races a move landing on the same session; one re-read settles it. */
const ABANDON_ATTEMPTS = 2;

/**
 * A dive fight stays the dive's to settle while its own binding is unresolved
 * and its dive is still live. A dive that ended, expired or was replaced leaves
 * nothing for anyone to settle, and holds nothing up.
 */
async function hollowGateFightStillOpen(slug: string, session: SoloPveSession): Promise<boolean> {
    if (await readPveOutcomeMarker(session, slug)) return false;
    const [{ hollowGateCombatBindingKey }, { hollowGateRunKey }] = await Promise.all([
        import('../hollow-gate/_combat-session.js'),
        import('../hollow-gate/_run-token.js'),
    ]);
    const binding = await kv.get<{ status?: unknown; tokenDigest?: unknown }>(hollowGateCombatBindingKey(session.sessionId));
    if (!binding || binding.status !== 'active') return false;
    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${slug}`);
    const dive = save?.character?.hollowGateRun as { runToken?: unknown; completed?: unknown } | null | undefined;
    const token = typeof dive?.runToken === 'string' ? dive.runToken : '';
    if (!token || dive?.completed) return false;
    if (createHash('sha256').update(token).digest('hex') !== binding.tokenDigest) return false;
    return Boolean(await kv.get(hollowGateRunKey(slug, token)));
}

/** The held fight as a terminal session to settle, abandoning it if it is still open. */
async function terminalHeldFight(slug: string, session: SoloPveSession): Promise<SoloPveSession | null> {
    let current: SoloPveSession | null = session;
    for (let attempt = 0; current && current.status === 'active' && attempt < ABANDON_ATTEMPTS; attempt += 1) {
        const abandoned = await abandonSoloPveSession(current.sessionId, slug);
        if (abandoned.ok) return abandoned.session;
        // Anything but a race (gone, not ours, no abandon rule) leaves nothing to settle.
        if (!abandoned.retryable) return null;
        current = await readSoloPveSession(current.sessionId);
    }
    if (current?.status === 'active') throw new Error(`held fight ${session.sessionId} could not be abandoned`);
    return current;
}

/**
 * Settle every fight this player is holding before a new one is sealed from
 * their save. Call it after the route has resumed or refused its own open fight
 * and before it reads the save to seed the new fighter; `except` names a session
 * the route is about to resume, which must not be abandoned here.
 *
 * A storage failure throws, and the route fails like any other unavailable
 * dependency, leaving the held fight in the index to be settled on the retry.
 */
export async function settleHeldFights(playerName: string, opts: { except?: string } = {}): Promise<HeldFightsResult> {
    const slug = safeName(playerName);
    if (!slug) return { ok: true, settled: 0 };
    const key = heldFightsKey(slug);
    const index = await kv.hgetall<Record<string, unknown>>(key);
    const held = Object.entries(index ?? {})
        .filter(([sessionId]) => sessionId !== opts.except)
        .sort(([, a], [, b]) => (Number(a) || 0) - (Number(b) || 0))
        .map(([sessionId]) => sessionId);
    if (held.length === 0) return { ok: true, settled: 0 };

    // Every held fight is read before any is touched: an open dive fight refuses
    // the new one first, so a refusal leaves each held fight as it was rather
    // than abandoning the ones sealed before it.
    const sessions: Array<{ sessionId: string; session: SoloPveSession | null }> = [];
    for (const sessionId of held) {
        const session = await readSoloPveSession(sessionId);
        sessions.push({ sessionId, session: session && session.ownerSlug.toLowerCase() === slug ? session : null });
    }
    for (const { session } of sessions) {
        if (session && isHollowGateFightSession(session) && await hollowGateFightStillOpen(slug, session)) {
            return { ok: false, status: 409, error: HOLLOW_GATE_ENCOUNTER_OPEN, reason: 'hollow-gate-encounter-open' };
        }
    }

    const handled: string[] = [];
    let settled = 0;
    let saveVersion: number | undefined;
    try {
        for (const { sessionId, session } of sessions) {
            // Gone, someone else's, or a dive fight its dive is done with:
            // nothing is left to settle.
            if (!session || isHollowGateFightSession(session)) {
                handled.push(sessionId);
                continue;
            }
            const terminal = await terminalHeldFight(slug, session);
            if (terminal) {
                // Receipt-idempotent: a fight its own mode already settled
                // replays here and writes nothing.
                const outcome = await settlePveFightOutcome(terminal, slug);
                if (outcome.ok && outcome.applied) {
                    settled += 1;
                    if (outcome._saveVersion) saveVersion = outcome._saveVersion;
                } else if (!outcome.ok) {
                    console.warn('[pve/held-fights] held fight left to its own mode', sessionId, outcome.status, outcome.error);
                }
            }
            handled.push(sessionId);
        }
    } finally {
        if (handled.length > 0) await kv.hdel(key, ...handled).catch(() => undefined);
        // The write landed with no request of the player's carrying it back.
        if (saveVersion) pushSaveVersion(slug, saveVersion);
    }
    return { ok: true, settled, ...(saveVersion ? { saveVersion } : {}) };
}
