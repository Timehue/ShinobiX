import { randomUUID } from 'node:crypto';
import { withKvLock } from '../_lock.js';
import { readSession } from '../towers/_tower-store.js';
import { releaseTowerBattleLeases } from '../towers/_battle-lease.js';
import { WORLD_BOSS_EVENT_QUEUE_MS, WORLD_BOSS_EVENT_MAX_PARTY, WORLD_BOSS_QUEUE_REJOIN_COOLDOWN_MS, worldBossEventPosition, worldBossEventStatus } from '../../shared/world-boss-event.js';
import {
    emptyWorldBossQueue,
    readWorldBossEvent,
    readWorldBossMatch,
    readWorldBossPlayerPointer,
    readWorldBossQueue,
    worldBossEventIsOpen,
    worldBossEventKey,
    worldBossMatchKey,
    worldBossQueueKey,
    worldBossQueueCooldownKey,
    readWorldBossQueueCooldownUntil,
    writeWorldBossEvent,
    writeWorldBossMatch,
    writeWorldBossPlayerPointer,
    writeWorldBossQueue,
    writeWorldBossQueueCooldownUntil,
    type WorldBossEventRecord,
    type WorldBossMatchRecord,
    type WorldBossPlayerPointer,
    type WorldBossQueueRecord,
    type WorldBossQueueTicket,
} from './_event.js';
import { createWorldBossEncounter } from './_encounter.js';
import { applyWorldBossRetreatPenalty } from './_retreat.js';

export type WorldBossQueueView = {
    waitingCount: number;
    waitingSince: number | null;
    queueClosesAt: number | null;
    rejoinAfter: number | null;
    queued: boolean;
    match: null | {
        matchId: string;
        status: WorldBossMatchRecord['status'];
        runId: string;
        session?: Awaited<ReturnType<typeof readSession>>;
        error?: string;
        reward?: WorldBossMatchRecord['members'][number]['reward'];
        contribution?: WorldBossMatchRecord['members'][number]['contribution'];
    };
};

/** Whether the roaming clock should be frozen for this event + queue at `now`. */
function movementShouldPause(event: WorldBossEventRecord, queue: WorldBossQueueRecord, now: number): boolean {
    return queue.tickets.length > 0 && worldBossEventIsOpen({
        ...event,
        status: worldBossEventStatus(event, now),
    }, now) && now < event.roamEndsAt;
}

function movementPauseInSync(event: WorldBossEventRecord, queue: WorldBossQueueRecord, now: number): boolean {
    return movementShouldPause(event, queue, now) === (event.movementPausedAt != null);
}

type MovementPauseSnapshot = { event: WorldBossEventRecord | null; queue: WorldBossQueueRecord };

/** Freeze the roaming clock whenever one or two players are waiting for a team.
 * Lock order is event → queue; queue-only mutations release their lock before
 * calling this helper. */
export async function syncWorldBossMovementPause(eventId: string, now = Date.now()): Promise<void> {
    await syncMovementPause(eventId, now);
}

/** {@link syncWorldBossMovementPause}, returning the event and queue it last saw.
 *
 * A lock-free peek decides first: when the stored pause state already matches
 * the queue (the steady state on every status poll) nothing would be written,
 * so neither lock is taken. Any mismatch takes the same event → queue locks as
 * before and re-decides from records read under them, so the write itself is
 * exactly as guarded as it always was. Every writer that changes the ticket
 * list (join, leave, tick, close) either sets the pause itself under the event
 * lock or calls this after its commit, so a peek that reads just before such a
 * commit is followed by a sync that reads after it. */
async function syncMovementPause(eventId: string, now: number): Promise<MovementPauseSnapshot> {
    const [peekEvent, peekQueue] = await Promise.all([readWorldBossEvent(eventId), readWorldBossQueue(eventId)]);
    if (!peekEvent) return { event: null, queue: peekQueue };
    if (movementPauseInSync(peekEvent, peekQueue, now)) return { event: peekEvent, queue: peekQueue };
    return withKvLock(worldBossEventKey(eventId), async (): Promise<MovementPauseSnapshot> => {
        const event = await readWorldBossEvent(eventId);
        if (!event) return { event: null, queue: peekQueue };
        const queue = await withKvLock(worldBossQueueKey(eventId), () => readWorldBossQueue(eventId), { failClosed: true });
        const shouldPause = movementShouldPause(event, queue, now);
        let changed = false;
        if (shouldPause && event.movementPausedAt == null) {
            event.movementPausedAt = now;
            changed = true;
        } else if (!shouldPause && event.movementPausedAt != null) {
            const pauseStart = Math.max(event.startedAt, event.movementPausedAt);
            const pauseEnd = Math.min(now, event.roamEndsAt);
            event.movementPausedTotalMs = Math.max(0, Math.floor(Number(event.movementPausedTotalMs) || 0))
                + Math.max(0, pauseEnd - pauseStart);
            event.movementPausedAt = null;
            changed = true;
        }
        if (changed) {
            event.updatedAt = now;
            await writeWorldBossEvent(event);
        }
        return { event, queue };
    }, { failClosed: true });
}

function shortError(error: unknown): string {
    return String(error instanceof Error ? error.message : error).slice(0, 180) || 'The team could not be assembled.';
}

async function removeMatchFromQueue(eventId: string, matchId: string): Promise<void> {
    const queueKey = worldBossQueueKey(eventId);
    await withKvLock(queueKey, async () => {
        const queue = await readWorldBossQueue(eventId);
        queue.activeMatchIds = queue.activeMatchIds.filter(id => id !== matchId);
        queue.updatedAt = Date.now();
        await writeWorldBossQueue(eventId, queue);
    }, { failClosed: true });
}

async function cancelWorldBossMatch(match: WorldBossMatchRecord, message: string): Promise<void> {
    match.status = 'cancelled';
    match.error = message;
    await writeWorldBossMatch(match);
    await releaseTowerBattleLeases(match.runId, match.members.map(member => member.slug)).catch(() => undefined);
    await Promise.all(match.members.map(member => writeWorldBossPlayerPointer(match.eventId, member.slug, {
        matchId: match.matchId,
        status: 'cancelled',
        updatedAt: Date.now(),
        error: message,
    })));
    await removeMatchFromQueue(match.eventId, match.matchId);
}

/** Start a prepared match once, with event closure and its HP pool serialized against other starts/settlements. */
export async function ensureWorldBossMatchStarted(eventId: string, matchId: string, now = Date.now()): Promise<WorldBossMatchRecord | null> {
    const matchLock = worldBossMatchKey(eventId, matchId);
    return withKvLock(matchLock, async () => {
        const match = await readWorldBossMatch(eventId, matchId);
        if (!match || match.status !== 'preparing') return match;
        let cancelledMessage: string | null = null;
        try {
            const started = await withKvLock(worldBossEventKey(eventId), async () => {
                const event = await readWorldBossEvent(eventId);
                if (!event) {
                    cancelledMessage = 'This world event has ended.';
                    return null;
                }
                const status = worldBossEventStatus(event, now);
                if (!worldBossEventIsOpen({ ...event, status }, now)) {
                    if (status === 'retreated' && event.status !== 'retreated') {
                        event.status = 'retreated';
                        event.endedAt = event.endsAt;
                    }
                    if (status === 'retreated') await applyWorldBossRetreatPenalty(event, now);
                    if (status === 'retreated') { event.updatedAt = now; await writeWorldBossEvent(event); }
                    cancelledMessage = event.hp <= 0 ? 'The boss has already been defeated.' : 'The event is no longer accepting new teams.';
                    return null;
                }
                const position = worldBossEventPosition(event, now);
                if (!position?.active) {
                    cancelledMessage = 'The boss is not on the map right now.';
                    return null;
                }
                const created = await createWorldBossEncounter({ event, match, expectedSector: position.currentSector, now });
                match.status = 'active';
                match.startedAt = now;
                match.matchHp = created.session.worldBossEvent?.matchHpAtStart ?? 0;
                await writeWorldBossMatch(match);
                await Promise.all(match.members.map(member => writeWorldBossPlayerPointer(eventId, member.slug, {
                    matchId,
                    status: 'active',
                    updatedAt: now,
                })));
                return match;
            }, { failClosed: true });
            if (started) return started;
        } catch (error) {
            cancelledMessage = shortError(error);
        }
        if (cancelledMessage) await cancelWorldBossMatch(match, cancelledMessage);
        return readWorldBossMatch(eventId, matchId);
    }, { failClosed: true });
}

function makeMatch(event: WorldBossEventRecord, tickets: WorldBossQueueTicket[], now: number): WorldBossMatchRecord {
    const matchId = randomUUID().replace(/-/g, '');
    return {
        matchId,
        eventId: event.eventId,
        runId: `wbe-${event.eventId.slice(-8)}-${matchId}`,
        status: 'preparing',
        members: tickets.map(ticket => ({
            slug: ticket.slug,
            name: ticket.name,
            village: ticket.village,
            clan: ticket.clan,
            ...(ticket.loadout ? { loadout: ticket.loadout } : {}),
        })),
        createdAt: now,
        startedAt: now,
        matchHp: 0,
    };
}

type MatchStatus = WorldBossMatchRecord['status'] | null;

/** Read every listed match's status in parallel (the rows are independent). */
async function readMatchStatuses(eventId: string, matchIds: string[]): Promise<Map<string, MatchStatus>> {
    const matches = await Promise.all(matchIds.map(matchId => readWorldBossMatch(eventId, matchId)));
    return new Map(matchIds.map((matchId, index) => [matchId, matches[index]?.status ?? null]));
}

const matchIsLive = (status: MatchStatus) => status === 'preparing' || status === 'active';

/** The pure part of a tick: drop finished matches and cut the ticket list into
 * the teams that are ready to start. Works on a copy; `queue` is not touched. */
function planQueueTick(queue: WorldBossQueueRecord, statuses: Map<string, MatchStatus>, now: number): {
    next: WorldBossQueueRecord;
    groups: WorldBossQueueTicket[][];
} {
    const next: WorldBossQueueRecord = {
        ...queue,
        tickets: [...queue.tickets],
        activeMatchIds: queue.activeMatchIds.filter(matchId => matchIsLive(statuses.get(matchId) ?? null)),
    };
    const groups: WorldBossQueueTicket[][] = [];
    while (next.tickets.length >= WORLD_BOSS_EVENT_MAX_PARTY) {
        groups.push(next.tickets.splice(0, WORLD_BOSS_EVENT_MAX_PARTY));
    }
    const first = next.tickets[0];
    if (first && now - first.joinedAt >= WORLD_BOSS_EVENT_QUEUE_MS) {
        groups.push(next.tickets.splice(0, WORLD_BOSS_EVENT_MAX_PARTY));
    }
    return { next, groups };
}

/** Deep-equal on the fields a tick can change (`updatedAt` is bookkeeping only). */
function sameQueueContent(a: WorldBossQueueRecord, b: WorldBossQueueRecord): boolean {
    return JSON.stringify(a.tickets) === JSON.stringify(b.tickets)
        && JSON.stringify(a.activeMatchIds) === JSON.stringify(b.activeMatchIds);
}

/** Form full trios immediately, then release one or two waiting players after 30 seconds. */
export async function tickWorldBossQueue(eventId: string, now = Date.now()): Promise<WorldBossQueueRecord> {
    try {
        return await runWorldBossQueueTick(eventId, now);
    } finally {
        coalescerFor(eventId).lastFinishedAt = Date.now();
    }
}

async function runWorldBossQueueTick(eventId: string, now: number): Promise<WorldBossQueueRecord> {
    const synced = await syncMovementPause(eventId, now);
    // The sync read (or wrote) the event a moment ago; no second read needed.
    const event = synced.event;
    if (!event) return emptyWorldBossQueue(now);
    const status = worldBossEventStatus(event, now);
    if (!worldBossEventIsOpen({ ...event, status }, now)) {
        if (status === 'retreated' && (event.status !== 'retreated' || !event.retreatPenaltyApplied)) {
            await withKvLock(worldBossEventKey(eventId), async () => {
                const fresh = await readWorldBossEvent(eventId);
                if (fresh && worldBossEventIsOpen(fresh, now) === false && fresh.hp > 0 && fresh.status !== 'victory' && fresh.status !== 'stopped') {
                    fresh.status = 'retreated';
                    fresh.endedAt = fresh.endsAt;
                    await applyWorldBossRetreatPenalty(fresh, now);
                    fresh.updatedAt = now;
                    await writeWorldBossEvent(fresh);
                }
            }, { failClosed: true });
        }
        return closeWorldBossQueue(eventId, now);
    }

    // Lock-free peek with the queue the sync just read. When there is no team to
    // form and no finished match to drop, the locked section below would only
    // rewrite the same row, so it is skipped. Anything to change takes the queue
    // lock (fail-closed, as before) and re-plans from the row read under it.
    const peekQueue = synced.queue;
    const peekStatuses = await readMatchStatuses(eventId, peekQueue.activeMatchIds);
    const peekPlan = planQueueTick(peekQueue, peekStatuses, now);
    let result: WorldBossQueueRecord;
    let preparingIds: string[];
    let formedTeams = 0;
    if (peekPlan.groups.length === 0 && sameQueueContent(peekQueue, peekPlan.next)) {
        result = peekQueue;
        preparingIds = peekQueue.activeMatchIds.filter(matchId => peekStatuses.get(matchId) === 'preparing');
    } else {
        const locked = await withKvLock(worldBossQueueKey(eventId), async () => {
            const queue = await readWorldBossQueue(eventId);
            const statuses = await readMatchStatuses(eventId, queue.activeMatchIds);
            const { next, groups } = planQueueTick(queue, statuses, now);
            const preparing = next.activeMatchIds.filter(matchId => statuses.get(matchId) === 'preparing');
            for (const group of groups) {
                const match = makeMatch(event, group, now);
                await writeWorldBossMatch(match);
                await Promise.all(match.members.map(member => writeWorldBossPlayerPointer(eventId, member.slug, {
                    matchId: match.matchId,
                    status: 'preparing',
                    updatedAt: now,
                })));
                next.activeMatchIds.push(match.matchId);
                preparing.push(match.matchId);
            }
            if (!sameQueueContent(queue, next)) {
                next.updatedAt = now;
                await writeWorldBossQueue(eventId, next);
            }
            return { queue: next, preparing, formed: groups.length };
        }, { failClosed: true });
        result = locked.queue;
        preparingIds = locked.preparing;
        formedTeams = locked.formed;
    }

    // Only a preparing match has anything to start; ensureWorldBossMatchStarted
    // returns untouched for active, settled, cancelled or missing ones.
    for (const matchId of preparingIds) {
        await ensureWorldBossMatchStarted(eventId, matchId, now);
    }
    // Re-sync the roaming clock when this tick changed anything it depends on:
    // tickets left the queue, a start may have closed the event, or the queue
    // moved under us between the first sync and the locked read.
    if (formedTeams > 0 || preparingIds.length > 0 || JSON.stringify(result.tickets) !== JSON.stringify(peekQueue.tickets)) {
        await syncMovementPause(eventId, now);
    }
    return result;
}

export async function closeWorldBossQueue(eventId: string, now = Date.now()): Promise<WorldBossQueueRecord> {
    const queueKey = worldBossQueueKey(eventId);
    // Lock-free peek: an already-empty queue has nothing to clear, so the
    // fail-closed queue lock is only taken when there are tickets to drop.
    const peek = await readWorldBossQueue(eventId);
    const pending = peek.tickets.length === 0
        ? { queue: peek, ids: [...peek.activeMatchIds] }
        : await withKvLock(queueKey, async () => {
            const queue = await readWorldBossQueue(eventId);
            const ids = [...queue.activeMatchIds];
            if (queue.tickets.length > 0) {
                queue.tickets = [];
                queue.updatedAt = now;
                await writeWorldBossQueue(eventId, queue);
            }
            return { queue, ids };
        }, { failClosed: true });
    const statuses = await readMatchStatuses(eventId, pending.ids);
    for (const matchId of pending.ids) {
        if (statuses.get(matchId) === 'preparing') await ensureWorldBossMatchStarted(eventId, matchId, now);
    }
    await syncMovementPause(eventId, now);
    return pending.queue;
}

// ── Status-poll tick coalescing ─────────────────────────────────────────────
// Every open world-boss window polls status (2 s, 6 s in a fight; the map
// overlay every 20 s, anonymously). Each poll used to run a full tick. Now the
// status GET runs at most one tick per WORLD_BOSS_TICK_COALESCE_MS across the
// whole process: callers that arrive while a tick is running wait for it, and
// callers inside the window serve a plain read of the committed queue. An
// authenticated poll may still tick early when the plain read shows work that
// a tick would do right now (a full trio, the 30-second release, a pause flip,
// a closing event), so teams form and the clock pauses on the same poll as
// before. Join/leave keep calling tickWorldBossQueue directly.

export const WORLD_BOSS_TICK_COALESCE_MS = 1_000;
/** Floor between early ("due") ticks, so a tick that keeps failing cannot spin. */
const WORLD_BOSS_DUE_TICK_MIN_GAP_MS = 250;

type TickCoalescer = { inFlight: Promise<WorldBossQueueRecord> | null; lastFinishedAt: number };
const tickCoalescers = new Map<string, TickCoalescer>();

function coalescerFor(eventId: string): TickCoalescer {
    let state = tickCoalescers.get(eventId);
    if (!state) {
        if (tickCoalescers.size >= 16) {
            for (const [id, entry] of tickCoalescers) if (!entry.inFlight) tickCoalescers.delete(id);
        }
        state = { inFlight: null, lastFinishedAt: 0 };
        tickCoalescers.set(eventId, state);
    }
    return state;
}

/** Test hook: forget every coalescer's history. */
export function resetWorldBossQueueTickCoalescing(): void {
    tickCoalescers.clear();
}

/** Would a tick do something at `now` that a player would see? Reads nothing. */
export function worldBossQueueTickDue(event: WorldBossEventRecord, queue: WorldBossQueueRecord, now: number): boolean {
    const status = worldBossEventStatus(event, now);
    if (worldBossEventIsOpen({ ...event, status }, now)) {
        if (queue.tickets.length >= WORLD_BOSS_EVENT_MAX_PARTY) return true;
        const first = queue.tickets[0];
        if (first && now - first.joinedAt >= WORLD_BOSS_EVENT_QUEUE_MS) return true;
    } else {
        if (queue.tickets.length > 0) return true;
        if (status === 'retreated' && event.hp > 0 && (event.status !== 'retreated' || !event.retreatPenaltyApplied)) return true;
    }
    return !movementPauseInSync(event, queue, now);
}

function startCoalescedTick(eventId: string, state: TickCoalescer, now: number): Promise<WorldBossQueueRecord> {
    const run = tickWorldBossQueue(eventId, now);
    state.inFlight = run;
    const settle = () => { if (state.inFlight === run) state.inFlight = null; };
    run.then(settle, settle);
    return run;
}

async function awaitInFlightThenRead(eventId: string, inFlight: Promise<WorldBossQueueRecord>): Promise<WorldBossQueueRecord> {
    // The request that started the tick reports its failure; a waiter serves
    // the committed queue either way.
    await inFlight.catch(() => undefined);
    return readWorldBossQueue(eventId);
}

/** Run the queue tick for a status poll, at most once per window process-wide.
 * Always resolves to the queue as committed after any tick it ran or waited on. */
export async function tickWorldBossQueueCoalesced(eventId: string, now = Date.now(), options: {
    /** Authenticated polls may tick early when a tick is due (see above). */
    allowDueTick?: boolean;
    /** The event the caller already read, used only for the due check. */
    event?: WorldBossEventRecord | null;
} = {}): Promise<{ queue: WorldBossQueueRecord; ticked: boolean }> {
    const state = coalescerFor(eventId);
    if (state.inFlight) return { queue: await awaitInFlightThenRead(eventId, state.inFlight), ticked: false };
    const seenFinishedAt = state.lastFinishedAt;
    const sinceLast = Date.now() - seenFinishedAt;
    if (sinceLast >= WORLD_BOSS_TICK_COALESCE_MS) return { queue: await startCoalescedTick(eventId, state, now), ticked: true };

    const queue = await readWorldBossQueue(eventId);
    if (!options.allowDueTick || sinceLast < WORLD_BOSS_DUE_TICK_MIN_GAP_MS) return { queue, ticked: false };
    const event = options.event ?? await readWorldBossEvent(eventId);
    if (!event || !worldBossQueueTickDue(event, queue, now)) return { queue, ticked: false };
    // Another request may have started or finished a tick while we read.
    if (state.inFlight) return { queue: await awaitInFlightThenRead(eventId, state.inFlight), ticked: false };
    if (state.lastFinishedAt !== seenFinishedAt) return { queue: await readWorldBossQueue(eventId), ticked: false };
    return { queue: await startCoalescedTick(eventId, state, now), ticked: true };
}

export async function worldBossQueueView(event: WorldBossEventRecord, playerSlug: string, now = Date.now(), options: {
    /** Status polls share one tick per window (tickWorldBossQueueCoalesced); queue actions tick directly. */
    coalesceTick?: boolean;
} = {}): Promise<WorldBossQueueView> {
    const queue = options.coalesceTick
        ? (await tickWorldBossQueueCoalesced(event.eventId, now, { allowDueTick: true, event })).queue
        : await tickWorldBossQueue(event.eventId, now);
    const ticket = queue.tickets.find(entry => entry.slug === playerSlug);
    const waitingSince = queue.tickets[0]?.joinedAt ?? null;
    const cooldownUntil = await readWorldBossQueueCooldownUntil(playerSlug);
    const rejoinAfter = cooldownUntil != null && cooldownUntil > now ? cooldownUntil : null;
    const pointer: WorldBossPlayerPointer | null = await readWorldBossPlayerPointer(event.eventId, playerSlug);
    // A completed match pointer is retained for its result/reward receipt, but a
    // fresh queue ticket takes precedence when the same player joins another raid.
    if (pointer?.matchId && !ticket) {
        let match = await readWorldBossMatch(event.eventId, pointer.matchId);
        if (match?.status === 'preparing') match = await ensureWorldBossMatchStarted(event.eventId, pointer.matchId, now);
        if (match && (match.status === 'preparing' || match.status === 'active' || match.status === 'settled' || match.status === 'cancelled')) {
            if (match.status === 'settled') {
                await releaseTowerBattleLeases(match.runId, match.members.map(member => member.slug));
            }
            if (pointer.status !== match.status) {
                await writeWorldBossPlayerPointer(event.eventId, playerSlug, {
                    matchId: match.matchId,
                    status: match.status,
                    updatedAt: now,
                    ...(match.error ? { error: match.error } : {}),
                });
            }
            const member = match.members.find(entry => entry.slug === playerSlug);
            const session = match.runId ? await readSession(match.runId) : null;
            return {
                waitingCount: queue.tickets.length,
                waitingSince,
                queueClosesAt: waitingSince == null ? null : waitingSince + WORLD_BOSS_EVENT_QUEUE_MS,
                rejoinAfter,
                queued: false,
                match: {
                    matchId: match.matchId,
                    status: match.status,
                    runId: match.runId,
                    ...(session ? { session } : {}),
                    ...(match.error ? { error: match.error } : {}),
                    ...(member?.reward ? { reward: member.reward } : {}),
                    ...(member?.contribution ? { contribution: member.contribution } : {}),
                },
            };
        }
    }
    return {
        waitingCount: queue.tickets.length,
        waitingSince,
        queueClosesAt: waitingSince == null ? null : waitingSince + WORLD_BOSS_EVENT_QUEUE_MS,
        rejoinAfter,
        queued: !!ticket,
        match: null,
    };
}

export async function leaveWorldBossQueue(eventId: string, playerSlug: string, now = Date.now()): Promise<{
    removed: boolean;
    activeMatch: boolean;
    rejoinAfter: number | null;
}> {
    const result = await withKvLock(worldBossEventKey(eventId), async () => {
        const pointer = await readWorldBossPlayerPointer(eventId, playerSlug);
        if (pointer?.matchId && (pointer.status === 'preparing' || pointer.status === 'active')) {
            const match = await readWorldBossMatch(eventId, pointer.matchId);
            if (match?.status === 'preparing' || match?.status === 'active') {
                return { removed: false, activeMatch: true, rejoinAfter: null };
            }
        }

        return withKvLock(worldBossQueueCooldownKey(playerSlug), async () => {
            const key = worldBossQueueKey(eventId);
            return withKvLock(key, async () => {
                const queue = await readWorldBossQueue(eventId);
                const ticket = queue.tickets.find(entry => entry.slug === playerSlug);
                if (!ticket) {
                    const existingCooldown = await readWorldBossQueueCooldownUntil(playerSlug);
                    return {
                        removed: false,
                        activeMatch: false,
                        rejoinAfter: existingCooldown != null && existingCooldown > now ? existingCooldown : null,
                    };
                }

                const rejoinAfter = now + WORLD_BOSS_QUEUE_REJOIN_COOLDOWN_MS;
                await writeWorldBossQueueCooldownUntil(playerSlug, rejoinAfter, now);
                queue.tickets = queue.tickets.filter(entry => entry.slug !== playerSlug);
                queue.updatedAt = now;
                await writeWorldBossQueue(eventId, queue);
                await writeWorldBossPlayerPointer(eventId, playerSlug, {
                    ticketId: ticket.ticketId,
                    status: 'cancelled',
                    updatedAt: now,
                });
                return { removed: true, activeMatch: false, rejoinAfter };
            }, { failClosed: true });
        }, { failClosed: true });
    }, { failClosed: true });

    if (result.removed) await syncWorldBossMovementPause(eventId, now);
    return result;
}

export async function removeWorldBossMatchFromQueue(eventId: string, matchId: string, now = Date.now()): Promise<void> {
    await removeMatchFromQueue(eventId, matchId);
}
