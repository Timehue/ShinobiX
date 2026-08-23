/*
 * Ranked 2v2 — duo formation and duo-vs-duo matchmaking.
 *
 * You pair with ONE other player, then the pair queues together and is matched
 * against another pair. That ordering is the whole point of the mode: teams are
 * a fact of who chose to play together, never a fairness shuffle, so a duo's
 * result is genuinely theirs.
 *
 * DIVISION OF LABOUR. This module owns only the pairing and the queue. The fight
 * runs on the same four-player N-actor session every other 2v2 uses — the
 * canonical 12x10 PvP grid, the shared jutsu resolver, the same AP/round budget
 * — and the rating is applied by `_ranked-2v2-settlement.ts`. Nothing here and
 * nothing in api/towers/_pvp-* writes a rating, which is what keeps the open
 * Team Arena structurally unrated while sharing the engine.
 *
 * DURABILITY. Every mutation runs under a fail-closed lock on the row it edits.
 * A duo is a durable record with its own TTL, so a dropped browser cannot strand
 * a partner: the record expires, and either member can leave at any time.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { DEFAULT_RANKED_RATING } from '../_ranked-rating.js';
import { ATTACKABLE_MIN_LEVEL, isBelowAttackableFloor } from '../_realtime/presence-gating.js';
import { claimTowerBattleLeases, releaseTowerBattleLeases, towerBattleLeaseForMember } from '../towers/_battle-lease.js';
import {
    createTowerPvpMatch,
    TOWER_PVP_ID,
    type StoredTowerPvpMatch,
    type TowerPvpFighterSeed,
} from '../towers/_pvp-session.js';
import { loadTowerPvpFighter, readTowerPvpMatch, writeTowerPvpMatch } from '../towers/_pvp-store.js';

export const RANKED_2V2_QUEUE_KEY = 'ranked-2v2:queue';
export const RANKED_2V2_QUEUE_LOCK = 'ranked-2v2:queue-lock';
export const duoKey = (duoId: string) => `ranked-2v2:duo:${duoId}`;
export const duoPlayerKey = (slug: string) => `ranked-2v2:player:${safeName(slug)}`;
export const duoMatchKey = (slug: string) => `ranked-2v2:match:${safeName(slug)}`;

export const RANKED_2V2_DUO_ID = /^r2v2-[a-f0-9]{32}$/;
/** A duo outlives a page reload but not an abandoned session. */
export const DUO_TTL_SECONDS = 2 * 60 * 60;
/** A queued entry older than this is an abandoned tab, not a waiting player. */
export const QUEUE_TTL_MS = 5 * 60_000;
const MATCH_POINTER_TTL_SECONDS = 24 * 60 * 60;

/** Widen the acceptable rating gap the longer a duo has waited. */
const RATING_WINDOW_BASE = 120;
const RATING_WINDOW_PER_SECOND = 20;

export type Ranked2v2Member = {
    slug: string;
    displayName: string;
    rating: number;
    /** The inviter is accepted on creation; the invitee must opt in. */
    accepted: boolean;
};

export type StoredRanked2v2Duo = {
    id: string;
    members: Ranked2v2Member[];
    status: 'forming' | 'ready' | 'queued' | 'matched' | 'closed';
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    /** Set once matchmaking publishes a match for this duo. */
    matchId?: string;
};

export type Ranked2v2QueueEntry = {
    duoId: string;
    slugs: string[];
    /** Team rating = the mean of both members. */
    rating: number;
    joinedAt: number;
};

export type Ranked2v2Result<T> =
    | { ok: true; value: T }
    | { ok: false; status: number; code: string; error: string };

const fail = (status: number, code: string, error: string): Ranked2v2Result<never> =>
    ({ ok: false, status, code, error });

export function duoRating(duo: Pick<StoredRanked2v2Duo, 'members'>): number {
    if (!duo.members.length) return DEFAULT_RANKED_RATING;
    const total = duo.members.reduce((sum, member) => sum + member.rating, 0);
    return Math.round(total / duo.members.length);
}

export function duoIsQueueable(duo: StoredRanked2v2Duo): boolean {
    return duo.members.length === 2 && duo.members.every(member => member.accepted);
}

function ratingWindow(entry: Ranked2v2QueueEntry, now: number): number {
    return RATING_WINDOW_BASE + Math.max(0, (now - entry.joinedAt) / 1_000) * RATING_WINDOW_PER_SECOND;
}

/**
 * BOTH duos must accept the gap. A pair that has waited a long time widens only
 * its own tolerance, so a freshly-queued duo is never dragged into a mismatch by
 * someone else's patience.
 */
export function duosPairable(a: Ranked2v2QueueEntry, b: Ranked2v2QueueEntry, now: number): boolean {
    if (a.duoId === b.duoId) return false;
    // A player cannot face themselves through a second account in the same match.
    if (a.slugs.some(slug => b.slugs.includes(slug))) return false;
    const gap = Math.abs(a.rating - b.rating);
    return gap <= ratingWindow(a, now) && gap <= ratingWindow(b, now);
}

export function pruneQueue(value: unknown, now: number): Ranked2v2QueueEntry[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((raw): raw is Ranked2v2QueueEntry => {
        const entry = raw as Partial<Ranked2v2QueueEntry>;
        const duoId = String(entry?.duoId ?? '');
        const joinedAt = Number(entry?.joinedAt);
        if (!RANKED_2V2_DUO_ID.test(duoId) || seen.has(duoId)) return false;
        if (!Array.isArray(entry?.slugs) || entry.slugs.length !== 2) return false;
        if (!Number.isFinite(joinedAt) || joinedAt > now + 60_000 || now - joinedAt >= QUEUE_TTL_MS) return false;
        seen.add(duoId);
        return true;
    });
}

/** Longest-waiting first, so nobody starves behind a churn of new arrivals. */
export function selectOpponentDuo(
    joiner: Ranked2v2QueueEntry,
    waiting: readonly Ranked2v2QueueEntry[],
    now: number,
): Ranked2v2QueueEntry | null {
    return [...waiting]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .find(candidate => duosPairable(joiner, candidate, now)) ?? null;
}

async function loadDuo(duoId: string): Promise<StoredRanked2v2Duo | null> {
    if (!RANKED_2V2_DUO_ID.test(duoId)) return null;
    return kv.get<StoredRanked2v2Duo>(duoKey(duoId));
}

async function saveDuo(duo: StoredRanked2v2Duo, now: number): Promise<StoredRanked2v2Duo> {
    const ttl = Math.max(1, Math.ceil((duo.expiresAt - now) / 1_000));
    const next = { ...duo, updatedAt: now };
    await kv.set(duoKey(next.id), next, { ex: ttl });
    return next;
}

export async function duoForPlayer(slugInput: string): Promise<StoredRanked2v2Duo | null> {
    const slug = safeName(slugInput);
    if (!slug) return null;
    const duoId = await kv.get<string>(duoPlayerKey(slug));
    if (!duoId) return null;
    const duo = await loadDuo(duoId);
    if (!duo || duo.status === 'closed' || !duo.members.some(member => member.slug === slug)) return null;
    return duo;
}

async function ratingFor(slug: string): Promise<{ rating: number; level: number; displayName: string } | null> {
    const save = await kv.get<Record<string, unknown>>(`save:${slug}`);
    const character = save?.character as Record<string, unknown> | undefined;
    if (!character) return null;
    const rating = Number(character.ranked2v2Rating);
    return {
        rating: Number.isFinite(rating) ? rating : DEFAULT_RANKED_RATING,
        level: Math.floor(Number(character.level ?? 0)) || 0,
        displayName: String(character.name ?? slug).slice(0, 40),
    };
}

/** Newcomer protection, read from the authoritative save exactly as 1v1 ranked does. */
async function admissible(slug: string): Promise<Ranked2v2Result<{ rating: number; displayName: string }>> {
    const profile = await ratingFor(slug);
    if (!profile) return fail(404, 'save-not-found', 'That shinobi has no save.');
    if (isBelowAttackableFloor(profile.level)) {
        return fail(403, 'ranked-level-locked', `Both partners must reach level ${ATTACKABLE_MIN_LEVEL} to enter ranked.`);
    }
    return { ok: true, value: { rating: profile.rating, displayName: profile.displayName } };
}

/** Invite one partner. The inviter is accepted on creation; the invitee opts in. */
export async function inviteRanked2v2Partner(input: {
    actor: string;
    target: string;
}): Promise<Ranked2v2Result<StoredRanked2v2Duo>> {
    const actor = safeName(input.actor);
    const target = safeName(input.target);
    if (!actor || !target) return fail(400, 'invalid-player', 'Choose a valid partner.');
    if (actor === target) return fail(400, 'invalid-target', 'You cannot partner with yourself.');

    const mine = await admissible(actor);
    if (!mine.ok) return mine;
    const theirs = await admissible(target);
    if (!theirs.ok) return theirs;

    return withKvLock(duoPlayerKey(actor), async () => {
        const existing = await duoForPlayer(actor);
        if (existing) return fail(409, 'already-partnered', 'Leave your current duo first.');
        const targetDuo = await duoForPlayer(target);
        if (targetDuo) return fail(409, 'target-busy', 'That shinobi is already in a duo.');

        const now = Date.now();
        const duo: StoredRanked2v2Duo = {
            id: `r2v2-${randomUUID().replaceAll('-', '')}`,
            members: [
                { slug: actor, displayName: mine.value.displayName, rating: mine.value.rating, accepted: true },
                { slug: target, displayName: theirs.value.displayName, rating: theirs.value.rating, accepted: false },
            ],
            status: 'forming',
            createdAt: now,
            updatedAt: now,
            expiresAt: now + DUO_TTL_SECONDS * 1_000,
        };
        await kv.set(duoKey(duo.id), duo, { ex: DUO_TTL_SECONDS });
        await kv.set(duoPlayerKey(actor), duo.id, { ex: DUO_TTL_SECONDS });
        // The invitee is indexed too, so they can discover the invite by polling
        // their own state rather than needing a separate inbox.
        await kv.set(duoPlayerKey(target), duo.id, { ex: DUO_TTL_SECONDS });
        return { ok: true as const, value: duo };
    }, { failClosed: true });
}

export async function acceptRanked2v2Invite(actorInput: string): Promise<Ranked2v2Result<StoredRanked2v2Duo>> {
    const actor = safeName(actorInput);
    const current = await duoForPlayer(actor);
    if (!current) return fail(404, 'no-duo', 'You have no pending duo invitation.');
    return withKvLock(duoKey(current.id), async () => {
        const duo = await loadDuo(current.id);
        if (!duo || duo.status === 'closed') return fail(404, 'no-duo', 'That duo no longer exists.');
        const member = duo.members.find(entry => entry.slug === actor);
        if (!member) return fail(403, 'not-a-member', 'You are not in that duo.');
        if (member.accepted) return { ok: true as const, value: duo };
        if (duo.status !== 'forming') return fail(409, 'duo-locked', 'That duo is already in a match or queue.');
        member.accepted = true;
        const next = await saveDuo({ ...duo, status: duoIsQueueable(duo) ? 'ready' : 'forming' }, Date.now());
        return { ok: true as const, value: next };
    }, { failClosed: true });
}

/** Leave or disband. Always available so a partner can never be trapped. */
export async function leaveRanked2v2Duo(actorInput: string): Promise<Ranked2v2Result<null>> {
    const actor = safeName(actorInput);
    const current = await duoForPlayer(actor);
    if (!current) return { ok: true, value: null };
    await withKvLock(RANKED_2V2_QUEUE_LOCK, async () => {
        const queue = pruneQueue(await kv.get(RANKED_2V2_QUEUE_KEY), Date.now())
            .filter(entry => entry.duoId !== current.id);
        if (queue.length) await kv.set(RANKED_2V2_QUEUE_KEY, queue, { ex: 15 * 60 });
        else await kv.del(RANKED_2V2_QUEUE_KEY);
    }, { failClosed: true });
    await withKvLock(duoKey(current.id), async () => {
        const duo = await loadDuo(current.id);
        if (!duo) return;
        // Disbanding the whole duo is deliberate: a one-person "duo" has nothing
        // to queue with, and leaving a hollow record would let a partner sit
        // waiting on a pairing that can never form.
        await saveDuo({ ...duo, status: 'closed' }, Date.now());
        for (const member of duo.members) {
            const owner = await kv.get<string>(duoPlayerKey(member.slug));
            if (owner === duo.id) await kv.del(duoPlayerKey(member.slug));
        }
    }, { failClosed: true });
    return { ok: true, value: null };
}

async function publishRanked2v2Match(
    amber: Ranked2v2QueueEntry,
    violet: Ranked2v2QueueEntry,
    now: number,
): Promise<StoredTowerPvpMatch | null> {
    const members = [...amber.slugs, ...violet.slugs];
    // Consumables ON: a rated fight costs what a rated fight costs, exactly like
    // ranked 1v1. Settlement deducts what was spent.
    const seeds = await Promise.all(members.map(slug => loadTowerPvpFighter(slug, { consumables: true })));
    if (seeds.some(seed => !seed)) return null;

    const matchId = `tpvp-${randomUUID().replaceAll('-', '')}`;
    if (!TOWER_PVP_ID.test(matchId)) throw new Error('Invalid generated ranked 2v2 match ID.');
    const lease = await claimTowerBattleLeases({ runId: matchId, members, mode: 'ranked-2v2' });
    if (!lease.ok) return null;

    try {
        const match = createTowerPvpMatch({
            matchId,
            fighters: seeds as TowerPvpFighterSeed[],
            seed: randomInt(1, 0x7fff_ffff),
            now,
            teams: { amber: amber.slugs, violet: violet.slugs },
            binding: {
                kind: 'ranked-2v2',
                amberDuoId: amber.duoId,
                violetDuoId: violet.duoId,
                // Ratings are sealed at match time so a rating that moves during
                // the fight cannot change what this match is worth.
                amberRating: amber.rating,
                violetRating: violet.rating,
            },
        });
        await writeTowerPvpMatch(match);
        await Promise.all(members.map(slug => kv.set(duoMatchKey(slug), matchId, { ex: MATCH_POINTER_TTL_SECONDS })));
        for (const entry of [amber, violet]) {
            const duo = await loadDuo(entry.duoId);
            if (duo) await saveDuo({ ...duo, status: 'matched', matchId }, now);
        }
        return match;
    } catch (error) {
        await releaseTowerBattleLeases(matchId, members).catch(() => undefined);
        throw error;
    }
}

export type Ranked2v2QueueState =
    | { state: 'idle' }
    | { state: 'queued'; position: number; waiting: number; rating: number }
    | { state: 'matched'; matchId: string };

/** Queue the caller's duo. Either member may queue; both are pulled in. */
export async function queueRanked2v2(actorInput: string): Promise<Ranked2v2Result<Ranked2v2QueueState>> {
    const actor = safeName(actorInput);
    const duo = await duoForPlayer(actor);
    if (!duo) return fail(404, 'no-duo', 'Pair with a partner before queueing.');
    if (!duoIsQueueable(duo)) return fail(409, 'duo-incomplete', 'Your partner has not accepted yet.');
    if (duo.status === 'matched' && duo.matchId) return { ok: true, value: { state: 'matched', matchId: duo.matchId } };

    // A member already in ANY other battle cannot be pulled into a rated match.
    for (const member of duo.members) {
        const lease = await towerBattleLeaseForMember(member.slug);
        if (lease) return fail(409, 'member-busy', 'A partner is already in another battle.');
    }

    type Published =
        | { queued: Ranked2v2QueueState }
        | { matched: string }
        | { unavailable: true };
    const published = await withKvLock<Published>(RANKED_2V2_QUEUE_LOCK, async () => {
        const now = Date.now();
        const waiting = pruneQueue(await kv.get(RANKED_2V2_QUEUE_KEY), now);
        const already = waiting.find(entry => entry.duoId === duo.id);
        const joiner: Ranked2v2QueueEntry = already ?? {
            duoId: duo.id,
            slugs: duo.members.map(member => member.slug),
            rating: duoRating(duo),
            joinedAt: now,
        };
        const opponent = selectOpponentDuo(joiner, waiting.filter(entry => entry.duoId !== duo.id), now);
        if (!opponent) {
            const next = [...waiting.filter(entry => entry.duoId !== duo.id), joiner];
            await kv.set(RANKED_2V2_QUEUE_KEY, next, { ex: 15 * 60 });
            const position = next.findIndex(entry => entry.duoId === duo.id) + 1;
            const queued: Ranked2v2QueueState = {
                state: 'queued', position, waiting: next.length, rating: joiner.rating,
            };
            return { queued } as Published;
        }

        // The joining duo takes amber purely so the split is deterministic; the
        // board itself is symmetric and the viewer projection flips sides.
        const match = await publishRanked2v2Match(joiner, opponent, now);
        const remaining = waiting.filter(entry => entry.duoId !== duo.id && entry.duoId !== opponent.duoId);
        if (remaining.length) await kv.set(RANKED_2V2_QUEUE_KEY, remaining, { ex: 15 * 60 });
        else await kv.del(RANKED_2V2_QUEUE_KEY);
        // A failed publication drops BOTH duos from the queue rather than
        // silently re-queueing a pair whose fighters could not be sealed.
        return (match ? { matched: match.matchId } : { unavailable: true }) as Published;
    }, { failClosed: true });

    if ('queued' in published) return { ok: true, value: published.queued };
    if ('matched' in published) return { ok: true, value: { state: 'matched', matchId: published.matched } };
    return fail(409, 'member-unavailable', 'A fighter could not be sealed for ranked. Try again.');
}

export async function unqueueRanked2v2(actorInput: string): Promise<Ranked2v2Result<null>> {
    const actor = safeName(actorInput);
    const duo = await duoForPlayer(actor);
    if (!duo) return { ok: true, value: null };
    await withKvLock(RANKED_2V2_QUEUE_LOCK, async () => {
        const queue = pruneQueue(await kv.get(RANKED_2V2_QUEUE_KEY), Date.now())
            .filter(entry => entry.duoId !== duo.id);
        if (queue.length) await kv.set(RANKED_2V2_QUEUE_KEY, queue, { ex: 15 * 60 });
        else await kv.del(RANKED_2V2_QUEUE_KEY);
    }, { failClosed: true });
    if (duo.status === 'queued') await saveDuo({ ...duo, status: 'ready' }, Date.now());
    return { ok: true, value: null };
}

export type Ranked2v2Status = {
    duo: StoredRanked2v2Duo | null;
    queue: Ranked2v2QueueState;
    match: StoredTowerPvpMatch | null;
};

/** One poll answering every question the panel asks. */
export async function ranked2v2Status(actorInput: string): Promise<Ranked2v2Status> {
    const actor = safeName(actorInput);
    const duo = await duoForPlayer(actor);
    const matchId = await kv.get<string>(duoMatchKey(actor));
    const match = matchId ? await readTowerPvpMatch(matchId) : null;
    if (match && match.status !== 'done' && match.status !== 'cancelled') {
        return { duo, queue: { state: 'matched', matchId: match.matchId }, match };
    }
    if (!duo) return { duo: null, queue: { state: 'idle' }, match };
    const waiting = pruneQueue(await kv.get(RANKED_2V2_QUEUE_KEY), Date.now());
    const index = waiting.findIndex(entry => entry.duoId === duo.id);
    const entry = index >= 0 ? waiting[index] : undefined;
    return {
        duo,
        queue: entry
            ? { state: 'queued', position: index + 1, waiting: waiting.length, rating: entry.rating }
            : { state: 'idle' },
        match,
    };
}

/** Release a settled match's pointers so the duo can queue again. */
export async function clearRanked2v2Match(match: StoredTowerPvpMatch): Promise<void> {
    await Promise.all(match.roster.map(async member => {
        const pointer = await kv.get<string>(duoMatchKey(member.slug));
        if (pointer === match.matchId) await kv.del(duoMatchKey(member.slug));
    }));
}
