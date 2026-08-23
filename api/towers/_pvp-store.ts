import { randomInt, randomUUID } from 'node:crypto';
import { kv as realKv } from '../_storage.js';
import { withKvLock as realWithKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import type { TowerPvpBinding, TowerPvpPresence } from '../../shared/tower-pvp.js';
import { TOWER_PVP_MATCH_SIZE, TOWER_PVP_REQUEST_ID, towerPvpBindingOf } from '../../shared/tower-pvp.js';
import { sealTowerFighter, sealTowerItemCharges } from './_seal.js';
import type { TowerKv, TowerLock } from './_tower-store.js';
import {
    battleLockKey,
    claimTowerBattleLeases,
    recoverConfirmedMissingTowerBattleLease,
    releaseTowerBattleLeases,
    towerBattleLeaseForMember,
    type TowerBattleLeaseClaim,
} from './_battle-lease.js';
import {
    TOWER_PVP_ID,
    activateReadyTowerPvpMatch,
    bumpTowerPvpVersion,
    createTowerPvpMatch,
    forfeitTowerPvpActor,
    projectTowerPvpTerminal,
    towerPvpMember,
    type StoredTowerPvpMatch,
    type TowerPvpFighterSeed,
} from './_pvp-session.js';
import { publishTowerPvpKick, publishTowerPvpQueuedKick } from './_pvp-realtime.js';

export const TOWER_PVP_QUEUE_KEY = 'tower-pvp:queue:v1';
export const TOWER_PVP_QUEUE_LOCK = 'tower-pvp:queue-lock:v1';
export const TOWER_PVP_QUEUE_TTL = 15 * 60;
export const TOWER_PVP_LIVE_TTL = 2 * 60 * 60;
export const TOWER_PVP_TERMINAL_TTL = 24 * 60 * 60;
export const TOWER_PVP_COMMAND_HISTORY = 64;

export const towerPvpMatchKey = (matchId: string) => `tower-pvp:match:${matchId}`;
export const towerPvpPlayerKey = (slug: string) => `tower-pvp:player:${safeName(slug)}`;

export type TowerPvpQueueEntry = {
    slug: string;
    displayName: string;
    skill: number;
    joinedAt: number;
    requestId: string;
};

export type TowerPvpPlayerPointer =
    | { state: 'queued'; joinedAt: number }
    | { state: 'match'; matchId: string };

export type TowerPvpStoreDeps = {
    kv?: TowerKv;
    lock?: TowerLock;
    now?: () => number;
    id?: () => string;
    seed?: () => number;
    loadFighter?: (slug: string) => Promise<TowerPvpFighterSeed | null>;
    claim?: (matchId: string, members: readonly string[]) => Promise<TowerBattleLeaseClaim>;
    release?: (matchId: string, members: readonly string[]) => Promise<void>;
};

type ResolvedDeps = Required<Omit<TowerPvpStoreDeps, 'kv' | 'lock'>> & { kv: TowerKv; lock: TowerLock };

function matchId(): string {
    return `tpvp-${randomUUID().replaceAll('-', '')}`;
}

function combatSkill(character: Record<string, unknown>): number {
    const stats = character.stats && typeof character.stats === 'object'
        ? character.stats as Record<string, unknown> : {};
    const statTotal = Object.values(stats).reduce<number>((sum, value) => {
        const n = Number(value);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
    }, 0);
    return Math.max(1, Math.floor(Number(character.level ?? 1) || 1)) * 10_000
        + Math.min(9_999, Math.floor(statTotal));
}

/**
 * Full-save, canonical PvP/Tower seal. No client-authored loadout enters
 * matchmaking.
 *
 * `consumables` defaults OFF for the open Team Arena: it settles no economy, so
 * burning a real potion there would cost the player something the mode never
 * pays back. A reward-bearing caller (clan-war 2v2) opts in and gets the same
 * sealed budget clan-war 1v1 receives on the PvP engine.
 */
export async function loadTowerPvpFighter(
    slugInput: string,
    options: { consumables?: boolean } = {},
): Promise<TowerPvpFighterSeed | null> {
    const slug = safeName(slugInput);
    if (!slug) return null;
    const save = await augmentSaveWithForgedDefs(await realKv.get<Record<string, unknown>>(`save:${slug}`));
    const character = save?.character as Record<string, unknown> | undefined;
    if (!save || !character) return null;
    const admin = await loadAdminCombatContent();
    const sealed = sealTowerFighter(character, save, {}, admin);
    return {
        slug,
        displayName: String(character.name ?? slug).slice(0, 40),
        skill: combatSkill(sealed),
        character: sealed,
        ...(options.consumables ? { itemCharges: sealTowerItemCharges(character) } : {}),
    };
}

function depsOf(input: TowerPvpStoreDeps = {}): ResolvedDeps {
    const kv = input.kv ?? realKv;
    const lock = input.lock ?? realWithKvLock;
    const now = input.now ?? Date.now;
    return {
        kv,
        lock,
        now,
        id: input.id ?? matchId,
        seed: input.seed ?? (() => randomInt(1, 0x7fff_ffff)),
        loadFighter: input.loadFighter ?? loadTowerPvpFighter,
        claim: input.claim ?? ((id, members) => claimTowerBattleLeases(
            { runId: id, members, mode: 'mpvp' }, { kv, lock, now },
        )),
        release: input.release ?? ((id, members) => releaseTowerBattleLeases(id, members, { kv, lock, now })),
    };
}

async function requiredSet(kv: TowerKv, key: string, value: unknown, ex: number): Promise<void> {
    try {
        if ((await kv.set(key, value, { ex })) === null) throw new Error(`Tower MPvP write rejected: ${key}`);
    } catch (error) {
        // A remote adapter may commit and then lose the acknowledgement. Exact
        // readback turns that into success instead of publishing duplicate matches.
        const observed = await kv.get<unknown>(key).catch(() => null);
        if (JSON.stringify(observed) === JSON.stringify(value)) return;
        throw error;
    }
}

async function readQueue(kv: TowerKv, now: number): Promise<TowerPvpQueueEntry[]> {
    const queue = await kv.get<TowerPvpQueueEntry[]>(TOWER_PVP_QUEUE_KEY);
    if (!Array.isArray(queue)) return [];
    const seen = new Set<string>();
    return queue.filter(entry => {
        const slug = safeName(entry?.slug ?? '');
        const joinedAt = Number(entry?.joinedAt);
        if (!slug || seen.has(slug) || !TOWER_PVP_REQUEST_ID.test(String(entry?.requestId ?? ''))
            || !Number.isFinite(joinedAt) || joinedAt > now + 60_000
            || now - joinedAt >= TOWER_PVP_QUEUE_TTL * 1_000) return false;
        seen.add(slug);
        return true;
    });
}

async function writeQueue(kv: TowerKv, queue: TowerPvpQueueEntry[]): Promise<void> {
    if (!queue.length) {
        await kv.del(TOWER_PVP_QUEUE_KEY);
        return;
    }
    await requiredSet(kv, TOWER_PVP_QUEUE_KEY, queue, TOWER_PVP_QUEUE_TTL);
}

export async function readTowerPvpMatch(matchIdInput: string, deps: TowerPvpStoreDeps = {}): Promise<StoredTowerPvpMatch | null> {
    if (!TOWER_PVP_ID.test(matchIdInput)) return null;
    return (deps.kv ?? realKv).get<StoredTowerPvpMatch>(towerPvpMatchKey(matchIdInput));
}

export async function writeTowerPvpMatch(match: StoredTowerPvpMatch, deps: TowerPvpStoreDeps = {}): Promise<void> {
    const kv = deps.kv ?? realKv;
    const ttl = match.status === 'ready' || match.status === 'active' ? TOWER_PVP_LIVE_TTL : TOWER_PVP_TERMINAL_TTL;
    await requiredSet(kv, towerPvpMatchKey(match.matchId), match, ttl);
}

async function publishNewTowerPvpMatch(match: StoredTowerPvpMatch, deps: ResolvedDeps): Promise<void> {
    const key = towerPvpMatchKey(match.matchId);
    try {
        const written = await deps.kv.set(key, match, { ex: TOWER_PVP_LIVE_TTL, nx: true });
        if (written === null) throw new Error('Tower MPvP match ID collision.');
    } catch (error) {
        // Commit-then-throw recovery is safe only for this byte-identical match.
        const observed = await deps.kv.get<StoredTowerPvpMatch>(key).catch(() => null);
        if (JSON.stringify(observed) === JSON.stringify(match)) return;
        throw error;
    }
}

export async function withTowerPvpMatchMutation<T>(
    matchIdInput: string,
    fn: (match: StoredTowerPvpMatch | null) => Promise<T>,
    deps: TowerPvpStoreDeps = {},
): Promise<T> {
    if (!TOWER_PVP_ID.test(matchIdInput)) return fn(null);
    const { kv, lock } = depsOf(deps);
    return lock(towerPvpMatchKey(matchIdInput), async () => {
        const fresh = await kv.get<StoredTowerPvpMatch>(towerPvpMatchKey(matchIdInput));
        return fn(fresh);
    }, { failClosed: true });
}

async function writePlayerPointer(
    slug: string,
    pointer: TowerPvpPlayerPointer,
    deps: ResolvedDeps,
): Promise<void> {
    await requiredSet(deps.kv, towerPvpPlayerKey(slug), pointer,
        pointer.state === 'match' ? TOWER_PVP_TERMINAL_TTL : TOWER_PVP_QUEUE_TTL);
}

async function clearPointerIf(
    slug: string,
    predicate: (pointer: TowerPvpPlayerPointer | null) => boolean,
    deps: ResolvedDeps,
): Promise<void> {
    await deps.lock(towerPvpPlayerKey(slug), async () => {
        const pointer = await deps.kv.get<TowerPvpPlayerPointer>(towerPvpPlayerKey(slug));
        if (predicate(pointer)) await deps.kv.del(towerPvpPlayerKey(slug));
    }, { failClosed: true });
}

function members(match: StoredTowerPvpMatch): string[] {
    return match.roster.map(member => member.slug).sort();
}

function isTerminalMatch(match: StoredTowerPvpMatch): boolean {
    return match.status === 'done' || match.status === 'cancelled';
}

async function matchOneCohort(
    queue: TowerPvpQueueEntry[],
    deps: ResolvedDeps,
): Promise<{ queue: TowerPvpQueueEntry[]; match: StoredTowerPvpMatch | null }> {
    if (queue.length < TOWER_PVP_MATCH_SIZE) return { queue, match: null };
    const cohort = queue.slice(0, TOWER_PVP_MATCH_SIZE);
    const slugs = cohort.map(entry => entry.slug);
    const id = deps.id();
    if (!TOWER_PVP_ID.test(id)) throw new Error('Tower MPvP ID generator returned an invalid ID.');
    const lease = await deps.claim(id, slugs);
    if (!lease.ok) {
        const busy = new Set(lease.members);
        for (const slug of busy) {
            await clearPointerIf(slug, pointer => pointer?.state === 'queued', deps).catch(() => undefined);
        }
        return { queue: queue.filter(entry => !busy.has(entry.slug)), match: null };
    }

    let published = false;
    try {
        const loaded = await Promise.all(slugs.map(slug => deps.loadFighter(slug)));
        const unavailable = slugs.filter((_slug, index) => !loaded[index]);
        if (unavailable.length) {
            await deps.release(id, slugs);
            const missing = new Set(unavailable);
            for (const slug of missing) {
                await clearPointerIf(slug, pointer => pointer?.state === 'queued', deps).catch(() => undefined);
            }
            return { queue: queue.filter(entry => !missing.has(entry.slug)), match: null };
        }
        const match = createTowerPvpMatch({
            matchId: id,
            fighters: loaded as TowerPvpFighterSeed[],
            seed: deps.seed(),
            now: deps.now(),
        });
        // Durable join receipts survive the queue row being removed, so any of
        // the four clients can recover a lost "matched" response by repeating
        // its original queue command.
        match.recentCommands = cohort.map(entry => ({
            requestId: entry.requestId,
            playerSlug: entry.slug,
            fingerprint: 'queue:join',
        }));
        await publishNewTowerPvpMatch(match, deps);
        published = true;
        await Promise.all(slugs.map(slug => writePlayerPointer(slug, { state: 'match', matchId: id }, deps)));
        publishTowerPvpKick(match, 'matched');
        return {
            queue: queue.filter(entry => !slugs.includes(entry.slug)),
            match,
        };
    } catch (error) {
        if (!published) await deps.release(id, slugs).catch(() => undefined);
        throw error;
    }
}

export type JoinTowerPvpQueueResult = {
    replayed: boolean;
    presence: TowerPvpPresence<StoredTowerPvpMatch['combat']>;
};

export async function joinTowerPvpQueue(input: {
    fighter: TowerPvpFighterSeed;
    requestId: string;
}, dependencies: TowerPvpStoreDeps = {}): Promise<JoinTowerPvpQueueResult> {
    const deps = depsOf(dependencies);
    const slug = safeName(input.fighter.slug);
    if (!slug || !TOWER_PVP_REQUEST_ID.test(input.requestId)) throw new TypeError('Invalid Tower MPvP queue command.');

    let replayed = false;
    await deps.lock(TOWER_PVP_QUEUE_LOCK, async () => {
        let queue = await readQueue(deps.kv, deps.now());
        const current = queue.find(entry => entry.slug === slug);
        if (current) {
            replayed = current.requestId === input.requestId;
            if (!replayed) throw new Error('already-queued');
        } else {
            // A live match lease is authority even when a stale queue pointer is missing.
            const lease = await towerBattleLeaseForMember(slug, { kv: deps.kv, lock: deps.lock, now: deps.now });
            if (lease?.meta.mode === 'mpvp') {
                const match = await deps.kv.get<StoredTowerPvpMatch>(towerPvpMatchKey(lease.battleId));
                const receipt = match?.recentCommands.find(command => command.requestId === input.requestId);
                if (match && towerPvpMember(match, slug)
                    && receipt?.playerSlug === slug && receipt.fingerprint === 'queue:join') {
                    replayed = true;
                    await writePlayerPointer(slug, { state: 'match', matchId: match.matchId }, deps);
                    return;
                }
                throw new Error('already-matched');
            }
            if (lease) throw new Error('member-busy');
            const pointer = await deps.kv.get<TowerPvpPlayerPointer>(towerPvpPlayerKey(slug));
            if (pointer?.state === 'match') {
                const prior = await deps.kv.get<StoredTowerPvpMatch>(towerPvpMatchKey(pointer.matchId));
                if (prior && (prior.status === 'ready' || prior.status === 'active')) throw new Error('already-matched');
            }
            const entry: TowerPvpQueueEntry = {
                slug,
                displayName: input.fighter.displayName.slice(0, 40),
                skill: Math.max(0, Math.floor(input.fighter.skill)),
                joinedAt: deps.now(),
                requestId: input.requestId,
            };
            queue.push(entry);
            await writePlayerPointer(slug, { state: 'queued', joinedAt: entry.joinedAt }, deps);
        }

        // One join can repair a backed-up queue and publish more than one cohort.
        // Every iteration either removes four, removes a busy/unavailable member,
        // or stops, so malformed state cannot spin forever.
        let guard = queue.length + 1;
        while (queue.length >= TOWER_PVP_MATCH_SIZE && guard-- > 0) {
            const before = queue.length;
            const result = await matchOneCohort(queue, deps);
            queue = result.queue;
            if (!result.match && queue.length === before) break;
        }
        await writeQueue(deps.kv, queue);
    }, { failClosed: true });
    const presence = await towerPvpPresence(slug, deps);
    if (presence.state === 'queued') publishTowerPvpQueuedKick(slug);
    return { replayed, presence };
}

async function presenceFromPointer(
    slug: string,
    pointer: TowerPvpPlayerPointer | null,
    deps: ResolvedDeps,
): Promise<TowerPvpPresence<StoredTowerPvpMatch['combat']> | null> {
    if (pointer?.state === 'match') {
        const match = await deps.kv.get<StoredTowerPvpMatch>(towerPvpMatchKey(pointer.matchId));
        // Defence in depth: the clan-war path never writes this pointer, but if a
        // bound match ever reached it, public presence must still refuse to show
        // it in the Battle Towers lobby rather than adopt someone else's fight.
        if (match && towerPvpMember(match, slug) && towerPvpBindingOf(match).kind === 'public-queue') {
            return { state: 'matched', match, queuePosition: null };
        }
        await clearPointerIf(slug, current => current?.state === 'match' && current.matchId === pointer.matchId, deps);
    }
    if (pointer?.state === 'queued') {
        const queue = await readQueue(deps.kv, deps.now());
        const index = queue.findIndex(entry => entry.slug === slug);
        if (index >= 0) return { state: 'queued', match: null, queuePosition: index + 1, queuedAt: queue[index]!.joinedAt };
        await clearPointerIf(slug, current => current?.state === 'queued', deps);
    }
    return null;
}

export async function towerPvpPresence(
    slugInput: string,
    dependencies: TowerPvpStoreDeps = {},
): Promise<TowerPvpPresence<StoredTowerPvpMatch['combat']>> {
    const deps = depsOf(dependencies);
    const slug = safeName(slugInput);
    if (!slug) return { state: 'idle', match: null, queuePosition: null };
    const pointer = await deps.kv.get<TowerPvpPlayerPointer>(towerPvpPlayerKey(slug));
    const projected = await presenceFromPointer(slug, pointer, deps);
    if (projected) return projected;

    // Lost pointer recovery: the account-wide lease embeds the exact match ID.
    const lease = await towerBattleLeaseForMember(slug, { kv: deps.kv, lock: deps.lock, now: deps.now });
    if (lease?.meta.mode === 'mpvp') {
        const match = await deps.kv.get<StoredTowerPvpMatch>(towerPvpMatchKey(lease.battleId));
        if (match && towerPvpMember(match, slug)) {
            await writePlayerPointer(slug, { state: 'match', matchId: match.matchId }, deps);
            return { state: 'matched', match, queuePosition: null };
        }
        // A definitely absent match after publication grace is a crash-partial
        // claim, not an eternal "already matched" state. Exact-run recovery can
        // only release this MPvP lease and never a newer battle.
        await recoverConfirmedMissingTowerBattleLease(lease.battleId, slug, {
            kv: deps.kv,
            lock: deps.lock,
            now: deps.now,
        });
    }
    return { state: 'idle', match: null, queuePosition: null };
}

function commandFingerprint(action: string, payload: unknown): string {
    return JSON.stringify([action, payload]);
}

function inspectCommand(
    match: StoredTowerPvpMatch,
    slug: string,
    requestId: string,
    fingerprint: string,
): 'fresh' | 'replay' | 'conflict' {
    const found = match.recentCommands.find(command => command.requestId === requestId);
    if (!found) return 'fresh';
    return found.playerSlug === slug && found.fingerprint === fingerprint ? 'replay' : 'conflict';
}

function recordCommand(match: StoredTowerPvpMatch, slug: string, requestId: string, fingerprint: string): void {
    match.recentCommands = [...match.recentCommands, { requestId, playerSlug: slug, fingerprint }]
        .slice(-TOWER_PVP_COMMAND_HISTORY);
}

/**
 * A match may only be driven through the surface that owns it. The open queue
 * and a clan-war challenge share this store and this reducer, so without an
 * explicit binding check a clan-war member could cancel their war match through
 * the public queue's `leave` action. Checked INSIDE the mutation lock so it
 * cannot race a concurrent write.
 */
function bindingMismatch(
    match: StoredTowerPvpMatch,
    required: TowerPvpBinding['kind'] | undefined,
): { ok: false; status: 403; code: 'wrong-surface'; error: string; match: StoredTowerPvpMatch } | null {
    if (!required || towerPvpBindingOf(match).kind === required) return null;
    return {
        ok: false,
        status: 403,
        code: 'wrong-surface',
        error: 'That match belongs to a different Tower surface.',
        match,
    };
}

export type TowerPvpMutationResult =
    | { ok: true; replayed: boolean; match?: StoredTowerPvpMatch }
    | { ok: false; status: number; code: string; error: string; match?: StoredTowerPvpMatch };

export async function setTowerPvpReady(input: {
    matchId: string;
    slug: string;
    ready: boolean;
    requestId: string;
    expectedVersion: number;
    /** Surface that owns this call; omitted only by internal callers. */
    requireBinding?: TowerPvpBinding['kind'];
}, dependencies: TowerPvpStoreDeps = {}): Promise<TowerPvpMutationResult> {
    const deps = depsOf(dependencies);
    const fingerprint = commandFingerprint('ready', input.ready);
    let releaseMembers: string[] = [];
    const result = await withTowerPvpMatchMutation(input.matchId, async match => {
        if (!match) return { ok: false, status: 404, code: 'match-not-found', error: 'Tower MPvP match not found.' } as const;
        if (!towerPvpMember(match, input.slug)) return { ok: false, status: 403, code: 'not-a-member', error: 'Not a member of this match.' } as const;
        const surface = bindingMismatch(match, input.requireBinding);
        if (surface) return surface;
        const command = inspectCommand(match, input.slug, input.requestId, fingerprint);
        if (command === 'conflict') return { ok: false, status: 409, code: 'request-id-conflict', error: 'Request ID was reused for another command.', match } as const;
        if (command === 'replay') return { ok: true, replayed: true, match } as const;
        if (match.status !== 'ready') return { ok: false, status: 409, code: 'match-not-ready', error: 'Readiness is closed for this match.', match } as const;
        if (deps.now() >= match.readyDeadlineAt) {
            match.status = 'cancelled';
            match.cancellationReason = 'ready-timeout';
            match.combat.status = 'done';
            match.combat.winner = 'draw';
            releaseMembers = members(match);
            recordCommand(match, input.slug, input.requestId, fingerprint);
            bumpTowerPvpVersion(match, deps.now());
            await writeTowerPvpMatch(match, deps);
            return { ok: false, status: 409, code: 'ready-timeout', error: 'The ready check expired.', match } as const;
        }
        if (input.expectedVersion !== match.version) {
            return { ok: false, status: 409, code: 'stale-version', error: 'Match state changed. Retry from the latest state.', match } as const;
        }
        const member = towerPvpMember(match, input.slug)!;
        member.ready = input.ready;
        recordCommand(match, input.slug, input.requestId, fingerprint);
        if (!activateReadyTowerPvpMatch(match, deps.now())) bumpTowerPvpVersion(match, deps.now());
        await writeTowerPvpMatch(match, deps);
        return { ok: true, replayed: false, match } as const;
    }, deps);
    if (releaseMembers.length) await deps.release(input.matchId, releaseMembers).catch(() => undefined);
    if (result.match) publishTowerPvpKick(result.match, result.match.status === 'cancelled' ? 'closed' : 'ready');
    return result;
}

export async function leaveTowerPvp(input: {
    slug: string;
    matchId?: string;
    requestId: string;
    expectedVersion?: number;
    /** Surface that owns this call; omitted only by internal callers. */
    requireBinding?: TowerPvpBinding['kind'];
}, dependencies: TowerPvpStoreDeps = {}): Promise<TowerPvpMutationResult> {
    const deps = depsOf(dependencies);
    if (!input.matchId) {
        await deps.lock(TOWER_PVP_QUEUE_LOCK, async () => {
            const queue = await readQueue(deps.kv, deps.now());
            await writeQueue(deps.kv, queue.filter(entry => entry.slug !== input.slug));
            await clearPointerIf(input.slug, pointer => pointer?.state === 'queued', deps);
        }, { failClosed: true });
        return { ok: true, replayed: false };
    }
    const fingerprint = commandFingerprint('leave', input.matchId);
    let releaseMembers: string[] = [];
    const result = await withTowerPvpMatchMutation(input.matchId, async match => {
        if (!match) return { ok: false, status: 404, code: 'match-not-found', error: 'Tower MPvP match not found.' } as const;
        if (!towerPvpMember(match, input.slug)) return { ok: false, status: 403, code: 'not-a-member', error: 'Not a member of this match.' } as const;
        const surface = bindingMismatch(match, input.requireBinding);
        if (surface) return surface;
        const command = inspectCommand(match, input.slug, input.requestId, fingerprint);
        if (command === 'conflict') return { ok: false, status: 409, code: 'request-id-conflict', error: 'Request ID was reused for another command.', match } as const;
        if (command === 'replay') return { ok: true, replayed: true, match } as const;
        if (match.status === 'done' || match.status === 'cancelled') {
            recordCommand(match, input.slug, input.requestId, fingerprint);
            bumpTowerPvpVersion(match, deps.now());
            await writeTowerPvpMatch(match, deps);
            return { ok: true, replayed: false, match } as const;
        }
        if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== match.version) {
            return { ok: false, status: 409, code: 'stale-version', error: 'Match state changed. Retry from the latest state.', match } as const;
        }
        recordCommand(match, input.slug, input.requestId, fingerprint);
        if (match.status === 'ready') {
            match.status = 'cancelled';
            match.cancellationReason = 'player-left';
            match.combat.status = 'done';
            match.combat.winner = 'draw';
            bumpTowerPvpVersion(match, deps.now());
        } else {
            forfeitTowerPvpActor(match, input.slug, deps.now());
        }
        releaseMembers = isTerminalMatch(match) ? members(match) : [];
        await writeTowerPvpMatch(match, deps);
        return { ok: true, replayed: false, match } as const;
    }, deps);
    if (result.ok && result.match && (result.match.status === 'done' || result.match.status === 'cancelled')) {
        await clearPointerIf(input.slug, pointer => pointer?.state === 'match' && pointer.matchId === input.matchId, deps).catch(() => undefined);
    }
    if (releaseMembers.length) await deps.release(input.matchId, releaseMembers).catch(() => undefined);
    if (result.match) publishTowerPvpKick(result.match, isTerminalMatch(result.match) ? 'closed' : 'action');
    return result;
}

/** Poll-time ready expiry; idempotent and fail-closed under the match mutation lock. */
export async function expireTowerPvpReadyCheck(
    matchId: string,
    dependencies: TowerPvpStoreDeps = {},
): Promise<StoredTowerPvpMatch | null> {
    const deps = depsOf(dependencies);
    let releaseMembers: string[] = [];
    const match = await withTowerPvpMatchMutation(matchId, async fresh => {
        if (!fresh || fresh.status !== 'ready' || deps.now() < fresh.readyDeadlineAt) return fresh;
        fresh.status = 'cancelled';
        fresh.cancellationReason = 'ready-timeout';
        fresh.combat.status = 'done';
        fresh.combat.winner = 'draw';
        releaseMembers = members(fresh);
        bumpTowerPvpVersion(fresh, deps.now());
        await writeTowerPvpMatch(fresh, deps);
        return fresh;
    }, deps);
    if (releaseMembers.length) await deps.release(matchId, releaseMembers).catch(() => undefined);
    if (releaseMembers.length && match) publishTowerPvpKick(match, 'closed');
    return match;
}

/** Release every exact-run lease after terminal state; safe on every retry. */
export async function releaseTerminalTowerPvpLeases(
    match: StoredTowerPvpMatch,
    dependencies: TowerPvpStoreDeps = {},
): Promise<void> {
    if (match.status !== 'done' && match.status !== 'cancelled') return;
    const deps = depsOf(dependencies);
    await deps.release(match.matchId, members(match));
}

/** Refresh all exact-run leases while ready/active; conflicts fail the caller closed. */
export async function refreshTowerPvpLeases(
    match: StoredTowerPvpMatch,
    dependencies: TowerPvpStoreDeps = {},
): Promise<TowerBattleLeaseClaim> {
    if (match.status !== 'ready' && match.status !== 'active') return { ok: true, members: members(match), replayed: true };
    const deps = depsOf(dependencies);
    return deps.claim(match.matchId, members(match));
}

/** Test/support export: authoritative queue snapshot, never used as a client response. */
export async function readTowerPvpQueue(deps: TowerPvpStoreDeps = {}): Promise<TowerPvpQueueEntry[]> {
    return readQueue(deps.kv ?? realKv, deps.now?.() ?? Date.now());
}

/** Remove a queued pointer when a foreign mode claims the shared battle lock. */
export async function evictBusyTowerPvpQueueMember(slug: string, deps: TowerPvpStoreDeps = {}): Promise<void> {
    const resolved = depsOf(deps);
    await resolved.lock(TOWER_PVP_QUEUE_LOCK, async () => {
        const queue = await readQueue(resolved.kv, resolved.now());
        await writeQueue(resolved.kv, queue.filter(entry => entry.slug !== slug));
        await clearPointerIf(slug, pointer => pointer?.state === 'queued', resolved);
    }, { failClosed: true });
}

/** Shared battle-lock key is deliberately referenced here for contract-level isolation tests. */
export const towerPvpBattleLockKey = battleLockKey;
