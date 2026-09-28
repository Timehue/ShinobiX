/*
 * Server store for timed boost events (shared/boost-event.ts has the rules).
 *
 * One KV row, `game:boost-event`, holds the current event or nothing. An
 * admin starts one with a multiplier, targets and a duration; it switches
 * itself off at `endsAt` because every reader checks the clock. Stopping early
 * deletes the row.
 *
 * Grant endpoints read it through `boostMultiplier(target, atMs)`, which is
 * cached for a few seconds and FAILS NEUTRAL: if the row can't be read, the
 * multiplier is 1, so a storage hiccup never blocks or inflates a payout.
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { cachedFor, invalidateProcCache } from './_proc-cache.js';
import { announce } from './_announce.js';
import { recordAudit } from './_audit.js';
import { safeLogValue } from './_safe-log.js';
import {
    BOOST_TARGET_INFO,
    boostMultiplierAt,
    buildBoostEvent,
    formatBoostMultiplier,
    isBoostEventActive,
    sanitizeBoostEvent,
    type BoostEvent,
    type BoostTarget,
} from '../shared/boost-event.js';

export const BOOST_EVENT_KEY = 'game:boost-event';
const CACHE_KEY = 'boost-event';
const CACHE_TTL_MS = 3000;

/** The stored event, whether or not it is still running. */
export async function readStoredBoostEvent(): Promise<BoostEvent | null> {
    return sanitizeBoostEvent(await kv.get<unknown>(BOOST_EVENT_KEY));
}

/** The event running right now, or null. Cached briefly; never throws. */
export async function readActiveBoostEvent(nowMs: number = Date.now()): Promise<BoostEvent | null> {
    try {
        const event = await cachedFor(CACHE_KEY, CACHE_TTL_MS, readStoredBoostEvent);
        return isBoostEventActive(event, nowMs) ? event : null;
    } catch (err) {
        console.warn('[boost-event] read failed; treating as no event:', safeLogValue(err));
        return null;
    }
}

/** The multiplier for `target` at `atMs` (1 when no event covers it). */
export async function boostMultiplier(target: BoostTarget, atMs: number = Date.now()): Promise<number> {
    return boostMultiplierAt(await readActiveBoostEvent(atMs), target, atMs);
}

function invalidate() {
    invalidateProcCache(CACHE_KEY);
    invalidateProcCache('game-state:frame');
}

export async function startBoostEvent(input: {
    multiplier: unknown;
    targets: unknown;
    hours: unknown;
    title?: unknown;
    actor: string;
    nowMs?: number;
}): Promise<{ ok: true; event: BoostEvent } | { ok: false; status: number; error: string }> {
    const nowMs = input.nowMs ?? Date.now();
    const built = buildBoostEvent({ ...input, startedBy: input.actor, nowMs });
    if (!built.ok) return { ok: false, status: 400, error: built.error };
    const event = built.event;
    const previous = await withKvLock(BOOST_EVENT_KEY, async () => {
        const before = await readStoredBoostEvent();
        await kv.set(BOOST_EVENT_KEY, event);
        return before;
    }, { failClosed: true });
    invalidate();
    await recordAudit({
        actor: input.actor, domain: 'reward', action: 'boost-event.start',
        entityType: 'boost-event', entityId: event.id,
        before: isBoostEventActive(previous, nowMs) ? previous : null, after: event,
    });
    const hours = Math.round((event.endsAt - event.startsAt) / 3_600_000);
    const labels = event.targets.map((t) => BOOST_TARGET_INFO[t].label.toLowerCase());
    const what = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0];
    await announce({
        type: 'boost_event',
        importance: 'high',
        title: event.title,
        message: `A ${formatBoostMultiplier(event.multiplier)} boost to ${what} runs for the next ${hours} hour${hours === 1 ? '' : 's'}.`,
        meta: { boostEventId: event.id, endsAt: event.endsAt },
    }, { receiptId: `boost-event:${event.id}` });
    return { ok: true, event };
}

export async function stopBoostEvent(actor: string, nowMs: number = Date.now()): Promise<{ stopped: BoostEvent | null }> {
    const stopped = await withKvLock(BOOST_EVENT_KEY, async () => {
        const before = await readStoredBoostEvent();
        await kv.del(BOOST_EVENT_KEY);
        return before;
    }, { failClosed: true });
    invalidate();
    const wasActive = isBoostEventActive(stopped, nowMs) ? stopped : null;
    if (wasActive) {
        await recordAudit({
            actor, domain: 'reward', action: 'boost-event.stop',
            entityType: 'boost-event', entityId: wasActive.id, before: wasActive, after: null,
        });
    }
    return { stopped: wasActive };
}
