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

/** Freeze the roaming clock whenever one or two players are waiting for a team.
 * Lock order is event → queue; queue-only mutations release their lock before
 * calling this helper. */
export async function syncWorldBossMovementPause(eventId: string, now = Date.now()): Promise<void> {
    await withKvLock(worldBossEventKey(eventId), async () => {
        const event = await readWorldBossEvent(eventId);
        if (!event) return;
        const queue = await withKvLock(worldBossQueueKey(eventId), () => readWorldBossQueue(eventId), { failClosed: true });
        const shouldPause = queue.tickets.length > 0 && worldBossEventIsOpen({
            ...event,
            status: worldBossEventStatus(event, now),
        }, now) && now < event.roamEndsAt;
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

/** Form full trios immediately, then release one or two waiting players after 30 seconds. */
export async function tickWorldBossQueue(eventId: string, now = Date.now()): Promise<WorldBossQueueRecord> {
    await syncWorldBossMovementPause(eventId, now);
    const event = await readWorldBossEvent(eventId);
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

    const queueKey = worldBossQueueKey(eventId);
    const toStart = await withKvLock(queueKey, async () => {
        const queue = await readWorldBossQueue(eventId);
        const liveIds: string[] = [];
        for (const matchId of queue.activeMatchIds) {
            const match = await readWorldBossMatch(eventId, matchId);
            if (match && (match.status === 'preparing' || match.status === 'active')) liveIds.push(matchId);
        }
        queue.activeMatchIds = liveIds;
        const groups: WorldBossQueueTicket[][] = [];
        while (queue.tickets.length >= WORLD_BOSS_EVENT_MAX_PARTY) {
            groups.push(queue.tickets.splice(0, WORLD_BOSS_EVENT_MAX_PARTY));
        }
        const first = queue.tickets[0];
        if (first && now - first.joinedAt >= WORLD_BOSS_EVENT_QUEUE_MS) {
            groups.push(queue.tickets.splice(0, WORLD_BOSS_EVENT_MAX_PARTY));
        }
        for (const group of groups) {
            const match = makeMatch(event, group, now);
            await writeWorldBossMatch(match);
            await Promise.all(match.members.map(member => writeWorldBossPlayerPointer(eventId, member.slug, {
                matchId: match.matchId,
                status: 'preparing',
                updatedAt: now,
            })));
            queue.activeMatchIds.push(match.matchId);
        }
        queue.updatedAt = now;
        await writeWorldBossQueue(eventId, queue);
        return queue;
    }, { failClosed: true });

    for (const matchId of toStart.activeMatchIds) {
        await ensureWorldBossMatchStarted(eventId, matchId, now);
    }
    await syncWorldBossMovementPause(eventId, now);
    return toStart;
}

export async function closeWorldBossQueue(eventId: string, now = Date.now()): Promise<WorldBossQueueRecord> {
    const queueKey = worldBossQueueKey(eventId);
    const pending = await withKvLock(queueKey, async () => {
        const queue = await readWorldBossQueue(eventId);
        const ids = [...queue.activeMatchIds];
        queue.tickets = [];
        queue.updatedAt = now;
        await writeWorldBossQueue(eventId, queue);
        return { queue, ids };
    }, { failClosed: true });
    for (const matchId of pending.ids) {
        const match = await readWorldBossMatch(eventId, matchId);
        if (match?.status === 'preparing') await ensureWorldBossMatchStarted(eventId, matchId, now);
    }
    await syncWorldBossMovementPause(eventId, now);
    return pending.queue;
}

export async function worldBossQueueView(event: WorldBossEventRecord, playerSlug: string, now = Date.now()): Promise<WorldBossQueueView> {
    const queue = await tickWorldBossQueue(event.eventId, now);
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
