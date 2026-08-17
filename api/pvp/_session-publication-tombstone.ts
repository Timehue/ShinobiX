import { safeName } from '../_utils.js';
import { SESSION_TTL } from '../combat-core/constants.js';

/**
 * Publication tombstones for the `pvp:<battleId>` row.
 *
 * A create request publishes the session row first and only then finishes the
 * rest of its publication saga (activating the creator's pending-session
 * pointer, re-proving the Clan War reservation). When that tail fails, the row
 * it published must come back out — but deleting it frees the battle id for
 * ANY writer, including a stale copy of the same request that is still paused
 * inside the publication block. That is exactly how a rolled-back battle
 * returns as an orphan: a live session row that no recovery pointer indexes.
 *
 * So the rollback REPLACES the exact row it published with a tombstone naming
 * the create capability that owned it — battle id, authenticated creator, both
 * fighter slots, and the create-request fingerprint (which already seals every
 * reward-shaping parameter of the request; see createRequestFingerprintFor in
 * session.ts).
 *
 *   - The SAME capability may replace the tombstone. That is what makes the
 *     503 retry contract work: the client repeats the identical request and
 *     the second publication takes the battle id back.
 *   - Any OTHER capability must not. Letting a different creator overwrite it
 *     would hand a stable, client-chosen battle id to whoever asks second.
 *
 * Both halves are load-bearing: too permissive and a battle id is hijackable,
 * too strict and a rolled-back battle id is poisoned until the TTL lapses.
 *
 * Deliberately NOT used for player-ranked battle ids. There the admission gate
 * owns the id and already has its own cancellation tombstone
 * (`player-ranked-session-orphan-tombstone-v1`); a foreign row at that key
 * fails the exact CAS in both the quarantine writer and the season-close
 * cancellation, which would strand the match rather than fence it. Ranked
 * publication rollback keeps deleting the exact row it published.
 */
export const PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION = 'pvp-session-publication-tombstone-v1' as const;

/**
 * The fence only has to outlive the session generation it replaced, so it
 * carries that generation's own TTL. A writer that resumes past this point can
 * no longer resurrect anything a reward path would accept anyway — every
 * settlement route rejects sessions older than its replay window.
 */
export const PVP_SESSION_PUBLICATION_TOMBSTONE_TTL_SECONDS = SESSION_TTL;

/**
 * The admin marker is not a legal safeName ('@' is stripped), so a player who
 * happens to be named "admin" can never present itself as the admin creator.
 */
export const PVP_PUBLICATION_ADMIN_CREATOR = '@admin' as const;

/** The identity a rolled-back battle id stays reserved for. */
export type PvpSessionPublicationCapability = {
    battleId: string;
    /** safeName of the authenticated creator, or PVP_PUBLICATION_ADMIN_CREATOR. */
    creator: string;
    p1: string;
    p2: string;
    createRequestFingerprint: string;
};

export type PvpSessionPublicationTombstone = PvpSessionPublicationCapability & {
    version: typeof PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION;
    rolledBackAt: number;
};

const TOMBSTONE_KEYS = [
    'version', 'battleId', 'creator', 'p1', 'p2', 'createRequestFingerprint', 'rolledBackAt',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isCreatorName(value: unknown): value is string {
    if (typeof value !== 'string' || !value) return false;
    return value === PVP_PUBLICATION_ADMIN_CREATOR || value === safeName(value);
}

/** A capability is only usable when every field is well-formed and distinct. */
export function isPvpSessionPublicationCapability(
    value: unknown,
): value is PvpSessionPublicationCapability {
    if (!isRecord(value)) return false;
    return typeof value.battleId === 'string'
        && /^pvp-[0-9a-f-]{36}$/.test(value.battleId)
        && isCreatorName(value.creator)
        && typeof value.p1 === 'string'
        && typeof value.p2 === 'string'
        && !!value.p1
        && !!value.p2
        && value.p1 === safeName(value.p1)
        && value.p2 === safeName(value.p2)
        && value.p1 !== value.p2
        && typeof value.createRequestFingerprint === 'string'
        && /^[0-9a-f]{64}$/.test(value.createRequestFingerprint);
}

export function makePvpSessionPublicationTombstone(
    capability: PvpSessionPublicationCapability,
    now: number,
): PvpSessionPublicationTombstone {
    if (!isPvpSessionPublicationCapability(capability)) {
        throw new Error('pvp-session-publication-tombstone-capability-invalid');
    }
    return {
        version: PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION,
        battleId: capability.battleId,
        creator: capability.creator,
        p1: capability.p1,
        p2: capability.p2,
        createRequestFingerprint: capability.createRequestFingerprint,
        rolledBackAt: Math.max(1, Math.floor(now)),
    };
}

export function parsePvpSessionPublicationTombstone(
    value: unknown,
): PvpSessionPublicationTombstone | null {
    if (!isRecord(value) || !hasExactKeys(value, TOMBSTONE_KEYS)) return null;
    const rolledBackAt = value.rolledBackAt;
    if (value.version !== PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION
        || typeof rolledBackAt !== 'number'
        || !Number.isSafeInteger(rolledBackAt)
        || rolledBackAt <= 0
        || !isPvpSessionPublicationCapability(value)) return null;
    return value as unknown as PvpSessionPublicationTombstone;
}

/**
 * Readers use this to tell "the battle id is fenced" from "there is a session
 * here". A tombstone is never a session row: it has no status, no fighters and
 * no reward authority, so treating it as one would either crash a reader that
 * dereferences `session.p1.name` or make a rolled-back battle look live.
 */
export function pvpSessionPublicationTombstoneFor(
    value: unknown,
    battleId: string,
): PvpSessionPublicationTombstone | null {
    const tombstone = parsePvpSessionPublicationTombstone(value);
    return tombstone && tombstone.battleId === battleId ? tombstone : null;
}

/**
 * The replacement rule. Every field of the create capability must match: the
 * same authenticated creator, re-asking for the same battle id, with the same
 * two fighters in the same slots, under the same sealed create parameters.
 */
export function pvpSessionPublicationTombstoneMatchesCapability(
    value: unknown,
    capability: PvpSessionPublicationCapability,
): value is PvpSessionPublicationTombstone {
    const tombstone = parsePvpSessionPublicationTombstone(value);
    if (!tombstone || !isPvpSessionPublicationCapability(capability)) return false;
    return tombstone.battleId === capability.battleId
        && tombstone.creator === capability.creator
        && tombstone.p1 === capability.p1
        && tombstone.p2 === capability.p2
        && tombstone.createRequestFingerprint === capability.createRequestFingerprint;
}
