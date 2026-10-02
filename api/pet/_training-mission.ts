import { kv } from '../_storage.js';
import { reportMissionEvent, type CompletedMissionInfo } from '../missions/_progress.js';

/*
 * A collected pet training counts toward the Pet Tamer "trained a pet" daily
 * missions (kind pet-tamer-pet-train). The session settles in the save, and the
 * mission report is a second write, to the daily row. A report that failed (the
 * missions:daily:<player> lock contended past its fail-closed acquire, as when
 * several sessions are collected at once, or the row write failing) used to
 * lose that progress for good: the session was already collected, and nothing
 * recorded that it still owed a mission event.
 *
 * The settle now records the event in a short list beside the save the moment
 * it commits, and a report that lands clears it. An event whose report failed
 * stays listed, and the player's next training action (a collect or a start, on
 * any pet) reports it again. Every report carries the session's receipt, which
 * the day's row matches, so an event that already landed counts once.
 *
 * The receipts live in the day's row, and a new UTC day starts a fresh row. So
 * only an event settled on the current UTC day is reported again. An older one
 * may already count in a row that is gone, and counting it again would count it
 * twice, so it is dropped (loss-only). So is an event from before the player
 * chose their profession again, because their board is a fresh one.
 */

const PENDING_TTL_SECONDS = 36 * 60 * 60;
// Only a run of failed reports fills this; the oldest event is dropped first.
const PENDING_CAP = 8;

type PendingTrainingMission = { receiptId: string; settledAt: number };
type PendingTrainingMissions = { version: 1; events: PendingTrainingMission[] };

function pendingKey(playerName: string): string {
    return `pet-train-missions:${playerName}`;
}

function pendingEvents(value: unknown): PendingTrainingMission[] {
    const events = (value as Partial<PendingTrainingMissions> | null | undefined)?.events;
    return Array.isArray(events)
        ? events.filter((event): event is PendingTrainingMission => Boolean(event)
            && typeof event.receiptId === 'string'
            && event.receiptId.length > 0
            && Number.isSafeInteger(event.settledAt)
            && event.settledAt > 0)
        : [];
}

function utcDay(at: number | Date): string {
    return new Date(at).toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The daily-mission receipt for one training session: its pet and its own start and end. */
export function petTrainingMissionReceipt(petId: string, training: Record<string, unknown>): string {
    return `pet-train:${petId}:${Math.floor(Number(training.startedAt)) || 0}:${Math.floor(Number(training.endsAt)) || 0}`;
}

/**
 * List a settled session's mission event. Call it from the settle's
 * afterCommit, so every writer holds the player's save lock and two of them
 * never race. A flush racing it can only bring back an event the flush had
 * cleared, and that event's next report finds its receipt and counts nothing.
 *
 * Never throws: the save has already committed, and a throw would answer the
 * player's settled collect with an error. Returns the list it stored, or null
 * when the event could not be listed (it is then lost, loss-only).
 */
export async function recordPendingTrainingMission(
    playerName: string,
    event: PendingTrainingMission,
): Promise<PendingTrainingMissions | null> {
    try {
        const key = pendingKey(playerName);
        const kept = pendingEvents(await kv.get(key)).filter((entry) => entry.receiptId !== event.receiptId);
        const next: PendingTrainingMissions = { version: 1, events: [...kept, event].slice(-PENDING_CAP) };
        await kv.set(key, next, { ex: PENDING_TTL_SECONDS });
        return next;
    } catch (error) {
        console.warn('[pet/progress] training mission event not listed', { playerName, receiptId: event.receiptId, error: errorMessage(error) });
        return null;
    }
}

/** Remove settled events by compare-and-set, keeping any listed meanwhile. */
async function clearPendingTrainingMissions(
    playerName: string,
    receiptIds: ReadonlySet<string>,
    known: PendingTrainingMissions | null,
): Promise<void> {
    const key = pendingKey(playerName);
    let stored: unknown = known;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (stored === null || attempt > 0) stored = await kv.get(key);
        const events = pendingEvents(stored);
        const remaining = events.filter((event) => !receiptIds.has(event.receiptId));
        if (remaining.length === events.length) return;
        const cleared = remaining.length === 0
            ? await kv.delIfEqual(key, stored)
            : await kv.compareSet(key, stored, { version: 1, events: remaining }, { ex: PENDING_TTL_SECONDS });
        if (cleared) return;
    }
    // Still listed: the next flush finds those receipts and counts nothing twice.
}

/**
 * Report the session the caller just settled and every training event still
 * listed for the player, then clear each listed one that is done: reported
 * (counted now, or found already counted) or dropped as stale. Never throws. An
 * event whose report fails stays listed for the next training action, and so
 * do the ones behind it, since the daily row is most likely still contended.
 *
 * `known` carries what the caller already holds: the character it just
 * committed, the list its afterCommit stored (skipping a read), and the session
 * it settled, which is reported even if listing it failed. `reported` says a
 * report ran, which may have paid profession XP into the save and moved its
 * version past the one the caller committed.
 */
export async function flushPendingTrainingMissions(
    playerName: string,
    known: {
        character?: Record<string, unknown>;
        stored?: PendingTrainingMissions | null;
        settled?: PendingTrainingMission | null;
    } = {},
): Promise<{ missionsCompleted: CompletedMissionInfo[]; reported: boolean }> {
    const none = { missionsCompleted: [] as CompletedMissionInfo[], reported: false };
    let stored: PendingTrainingMissions | null = known.stored ?? null;
    if (!stored) {
        try {
            stored = await kv.get<PendingTrainingMissions>(pendingKey(playerName));
        } catch (error) {
            console.warn('[pet/progress] training mission events unreadable', { playerName, error: errorMessage(error) });
        }
    }
    const listed = pendingEvents(stored);
    const settled = known.settled;
    const events = settled && !listed.some((event) => event.receiptId === settled.receiptId) ? [...listed, settled] : listed;
    if (events.length === 0) return none;
    let character = known.character;
    if (!character) {
        try {
            character = (await kv.get<Record<string, unknown>>(`save:${playerName}`))?.character as Record<string, unknown> | undefined;
        } catch (error) {
            console.warn('[pet/progress] training mission events unreadable', { playerName, error: errorMessage(error) });
            return none;
        }
    }
    const chosenAt = Number(character?.professionChosenAt ?? 0);
    // One clock reading for the day check AND the reports, so a report that
    // crosses midnight after the check cannot land in the next day's row.
    const now = new Date();
    const done = new Set<string>();
    const missionsCompleted: CompletedMissionInfo[] = [];
    let reported = false;
    for (const event of events) {
        const reportable = character?.profession === 'petTamer'
            && !(chosenAt > event.settledAt)
            && utcDay(event.settledAt) === utcDay(now);
        if (reportable) {
            try {
                const result = await reportMissionEvent({
                    playerName,
                    profession: 'petTamer',
                    kind: 'pet-tamer-pet-train',
                    receiptId: event.receiptId,
                    now,
                });
                reported = true;
                // A receipt the day's row already holds landed on an earlier
                // attempt, whose reply carried its completions; never toast twice.
                if (!result.replayed) missionsCompleted.push(...result.missionsCompleted);
            } catch (error) {
                console.warn('[pet/progress] training mission report deferred', { playerName, receiptId: event.receiptId, error: errorMessage(error) });
                break;
            }
        }
        done.add(event.receiptId);
    }
    if (done.size > 0) {
        try {
            await clearPendingTrainingMissions(playerName, done, stored);
        } catch (error) {
            console.warn('[pet/progress] training mission events not cleared', { playerName, error: errorMessage(error) });
        }
    }
    return { missionsCompleted, reported };
}
