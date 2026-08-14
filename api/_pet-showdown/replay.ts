/**
 * Showdown replay — turning a stored descriptor back into a watchable match.
 *
 * THE MODEL. A stored row carries only the inputs (`ShowdownReplayDescriptor`:
 * seed, format, tier, both teams). The engine is deterministic over those, so
 * the event log is a pure function of the row and is re-derived on request
 * rather than persisted. A journal row stays a few hundred bytes instead of
 * thousands of events, and there is exactly one copy of the truth.
 *
 * WHY THE SERVER DOES THIS. The legacy duel sim is mirrored client-side, so the
 * old ladder hands the client a seed and the client replays it byte-identically.
 * Showdown has NO client mirror — that is the point of a server-authoritative
 * engine — so the client cannot re-derive anything. It asks for the log and
 * plays it back. The descriptor is the request; this module is the answer.
 *
 * WHAT THIS GUARANTEES. Same descriptor, same log, forever — the property the
 * determinism tests in headless.test.ts pin down. What it does NOT survive is a
 * deliberate balance change: retuning the engine re-derives old rows under the
 * new rules. That is a real limitation and the reason `version` exists. If a
 * change ever needs old rows to keep replaying under the OLD rules, the answer
 * is to bump the version and persist logs from then on — not to pretend
 * re-derivation is immune.
 */

import { createShowdownSession } from './engine.js';
import { resolveShowdownHeadless, type HeadlessResult } from './headless.js';
import {
    SHOWDOWN_REPLAY_VERSION,
    type ShowdownReplayDescriptor,
} from '../../shared/pet-showdown-contract.js';
import type { Pet } from '../_pet-sim/pet-types.js';

/** Build a storable descriptor from the inputs a match was created with. */
export function showdownReplayDescriptor(input: {
    seed: number;
    format: ShowdownReplayDescriptor['format'];
    tier: ShowdownReplayDescriptor['tier'];
    enemyTeamName: string;
    playerPets: Pet[];
    enemyPets: Pet[];
}): ShowdownReplayDescriptor {
    return {
        kind: 'showdown',
        version: SHOWDOWN_REPLAY_VERSION,
        seed: input.seed,
        format: input.format,
        tier: input.tier,
        enemyTeamName: input.enemyTeamName,
        playerPets: input.playerPets,
        enemyPets: input.enemyPets,
    };
}

/** True for a descriptor this build knows how to replay. */
export function isShowdownReplayDescriptor(value: unknown): value is ShowdownReplayDescriptor {
    if (!value || typeof value !== 'object') return false;
    const d = value as Partial<ShowdownReplayDescriptor>;
    return d.kind === 'showdown'
        && d.version === SHOWDOWN_REPLAY_VERSION
        && typeof d.seed === 'number'
        && Array.isArray(d.playerPets)
        && Array.isArray(d.enemyPets);
}

/**
 * Re-derive a stored match into its full event log.
 *
 * Throws on an unrecognized descriptor rather than replaying it under
 * assumptions — a replay that silently shows the wrong fight is worse than one
 * that refuses.
 */
export function replayShowdownDescriptor(descriptor: unknown): HeadlessResult {
    if (!isShowdownReplayDescriptor(descriptor)) {
        throw new Error('replayShowdownDescriptor: unrecognized or unsupported replay descriptor');
    }
    const session = createShowdownSession({
        sessionId: `replay-${descriptor.seed}`,
        // The replay is a spectator view; no player owns it and nothing settles
        // from it, so this name is a label rather than an identity.
        playerName: 'replay',
        format: descriptor.format,
        tier: descriptor.tier,
        seed: descriptor.seed,
        playerPets: descriptor.playerPets as Pet[],
        enemyPets: descriptor.enemyPets as Pet[],
        enemyTeamName: descriptor.enemyTeamName,
        // A replay can never pay. Sealed false so no code path downstream can
        // mistake a re-derived match for a fresh, earning one.
        rewardEligible: false,
    });
    return resolveShowdownHeadless(session);
}
