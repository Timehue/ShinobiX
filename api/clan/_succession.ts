import { safeName } from '../_utils.js';

/*
 * Pure succession logic for a clan losing its founder — extracted so the choice
 * can be unit-tested without KV, auth or locks (same split as _kick-core.ts).
 *
 * WHY THIS EXISTS
 *
 * `founderName` could previously only change by admin action, and leaving a clan
 * was a client-orchestrated flow whose roster write was explicitly best-effort.
 * So a founder who quit left a clan that no remaining member could dissolve,
 * re-doctrine, or distribute the seal pool from — while it could still hold
 * territory, a treasury and war commitments nobody could wind down. The clan's
 * own UI warned about it ("leaving doesn't transfer ownership") because there
 * was no mechanism, not because anyone wanted that outcome.
 *
 * The genre settled this a long time ago: WoW ships automatic guild-master
 * replacement, FFXIV and EVE ship explicit transfer plus an inactivity path.
 * Nobody leaves a guild permanently headless.
 *
 * WHY IT IS COMPUTED, NEVER CLAIMED
 *
 * The successor is derived deterministically from the roster the server already
 * holds. There is no "claim leadership" call to race, so the pass is idempotent
 * and there is no hostile-takeover surface: a member cannot make themselves
 * eligible except by being in the clan longer than everyone senior to them.
 */

/** Leadership preference, lowest first. Roles come from `roleOverrides`. */
const ROLE_RANK: Record<string, number> = { Leader: 0, Officer: 1 };
const DEFAULT_ROLE_RANK = 2;

export type ClanSuccessionRecord = {
    founderName?: string;
    members?: Array<Record<string, unknown>>;
    roleOverrides?: Record<string, string>;
};

export type ClanSuccession =
    | { kind: 'succeeded'; successorSlug: string; successorName: string; nextFounderName: string }
    /** Nobody is left — the caller should leave `founderName` as-is (an empty clan has nothing to administer). */
    | { kind: 'clan-empty' }
    /** The departing player was not the founder; ownership is untouched. */
    | { kind: 'not-founder' };

function memberSlug(member: Record<string, unknown>): string {
    return safeName(String(member?.name ?? ''));
}

function joinedAtOf(member: Record<string, unknown>): number {
    const raw = Math.floor(Number(member?.joinedAt ?? 0));
    // A missing or malformed timestamp must not win the tie-break by sorting as
    // 0 ("joined at the dawn of time"), so it sorts LAST among real timestamps.
    return Number.isFinite(raw) && raw > 0 ? raw : Number.MAX_SAFE_INTEGER;
}

/**
 * Choose who inherits a clan whose founder is leaving.
 *
 * Order: declared leadership rank (Leader, then Officer, then ordinary member)
 * as a PREFERENCE, then longest tenure, then slug — a total order, so the same
 * roster always yields the same successor no matter how many times this runs.
 *
 * Rank is a preference and not a gate on purpose: a clan whose only remaining
 * members are ordinary members must still get an owner, otherwise the exact
 * headless state this fixes just returns with extra steps.
 */
export function resolveClanSuccession(
    clanRec: ClanSuccessionRecord,
    departingSlug: string,
): ClanSuccession {
    const founderSlug = safeName(String(clanRec.founderName ?? ''));
    if (!founderSlug || founderSlug !== departingSlug) return { kind: 'not-founder' };

    const overrides = (clanRec.roleOverrides ?? {}) as Record<string, string>;
    const rankFor = (member: Record<string, unknown>): number => {
        const raw = String(member?.name ?? '');
        // roleOverrides is keyed by DISPLAY name, so look it up both ways rather
        // than assuming the caller normalized it.
        const role = overrides[raw] ?? overrides[safeName(raw)] ?? '';
        return ROLE_RANK[role] ?? DEFAULT_ROLE_RANK;
    };

    const candidates = (Array.isArray(clanRec.members) ? clanRec.members : [])
        .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
        .filter((m) => memberSlug(m) && memberSlug(m) !== departingSlug);

    if (!candidates.length) return { kind: 'clan-empty' };

    const successor = candidates.slice().sort((a, b) =>
        rankFor(a) - rankFor(b)
        || joinedAtOf(a) - joinedAtOf(b)
        || memberSlug(a).localeCompare(memberSlug(b)))[0];

    const successorName = String(successor.name ?? '');
    return {
        kind: 'succeeded',
        successorSlug: memberSlug(successor),
        successorName,
        nextFounderName: successorName,
    };
}

/**
 * The roster with `departingSlug` removed and, when they were the founder, the
 * successor's stale role override dropped (they are the founder now — leaving a
 * `Leader` override on them would show two ranks at once).
 */
export function applyClanSuccession(
    clanRec: ClanSuccessionRecord,
    departingSlug: string,
    succession: ClanSuccession,
): { members: Array<Record<string, unknown>>; roleOverrides: Record<string, string>; founderName: string } {
    const members = (Array.isArray(clanRec.members) ? clanRec.members : [])
        .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
        .filter((m) => memberSlug(m) !== departingSlug);

    const roleOverrides: Record<string, string> = { ...(clanRec.roleOverrides ?? {}) };
    for (const key of Object.keys(roleOverrides)) {
        if (safeName(key) === departingSlug) delete roleOverrides[key];
        if (succession.kind === 'succeeded' && safeName(key) === succession.successorSlug) delete roleOverrides[key];
    }

    const founderName = succession.kind === 'succeeded'
        ? succession.nextFounderName
        : String(clanRec.founderName ?? '');

    return { members, roleOverrides, founderName };
}
