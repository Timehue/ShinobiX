import type { WorldPosition } from '../../../shared/world-position';

/**
 * Ground one movement update may carry. The server admits one update at a time and
 * refuses any that carries more than its WORLD_WALK_MAX_CREDIT (3 tiles), and network
 * jitter eats into that same budget, so updates stay well under it.
 */
export const WORLD_UPDATE_TILES = 1.4;
/**
 * Ground the walker may be ahead of the server's last answer: the most a refusal can
 * snap back. 0.4 tile under the server's credit, which no simulated jitter (to ±100 ms
 * a leg) got through.
 */
export const WORLD_UNANSWERED_TILES = 2.6;
/** The slowest the governor walks: past this, a slow link waits on `room` instead. */
const SLOWEST_RATE = .4;

export type WorldMoveUpdate = { cursor: WorldPosition; sample: number };

/**
 * When, and how fast, the continuous-world walker may walk ahead of the server.
 *
 * It used to wait whenever it was WORLD_UPDATE_TILES past the last ACKNOWLEDGED
 * update. With one update in flight, that froze it for part of every round trip
 * over about 100 ms: 31% of the time at a 160 ms phone round trip, 44% at 200 ms.
 * Now it waits only when the next update would be full, or when it is
 * WORLD_UNANSWERED_TILES past the server's answer. Allowing more than that would
 * cost real refusals on a jittery connection (simulated against the server gate).
 *
 * On a link too slow for full speed even then, `rate` walks at the pace the link
 * sustains, so the avatar walks steadily slower instead of dashing and freezing.
 */
export function createWorldMovePacer(speed: number, limits = { update: WORLD_UPDATE_TILES, unanswered: WORLD_UNANSWERED_TILES }) {
    const update = limits.update / speed, unanswered = limits.unanswered / speed;
    // Seconds walked, and the samples of the newest update sent and the newest one
    // accepted. A dropped update (throttled, offline, a lost connection) is re-sent
    // unchanged, so the next update always starts where the server holds the walker.
    let walked = 0, sent = 0, acknowledged = 0, retry: WorldMoveUpdate | null = null;
    // Smoothed seconds from an update leaving to its answer.
    let sentAt = 0, roundTrip = 0;
    return {
        get walked() { return walked; },
        /** Seconds the walker may still walk before it has to wait for an answer. */
        get room() { return Math.max(0, Math.min(update - (walked - sent), unanswered - (walked - acknowledged))); },
        /**
         * Share of full speed the link sustains when updates leave every `interval` seconds.
         * One update is in flight, so they leave a spacing of max(interval, round trip)
         * apart. An answer lands a round trip after its update left, a spacing after the
         * update before, and the walker must still be inside that earlier update's
         * unanswered allowance; each update also carries one spacing of walking.
         */
        rate(interval: number) {
            if (!roundTrip) return 1;
            const spacing = Math.max(interval, roundTrip);
            return Math.max(SLOWEST_RATE, Math.min(1, .95 * Math.min(unanswered / (spacing + roundTrip), update / spacing)));
        },
        get retrying() { return retry !== null; },
        advance(seconds: number) { walked += seconds; },
        /** The update to send now (`now` in seconds): a dropped one first, as it was. */
        next(cursor: WorldPosition, now: number): WorldMoveUpdate {
            const next = retry ?? { cursor, sample: walked };
            retry = null; sent = next.sample; sentAt = now;
            return next;
        },
        accepted(update: WorldMoveUpdate, now: number) {
            acknowledged = update.sample;
            roundTrip = roundTrip ? roundTrip * .7 + (now - sentAt) * .3 : now - sentAt;
        },
        dropped(update: WorldMoveUpdate) { retry = update; },
        /** The walker was put back on the server's cursor. */
        reset() { walked = sent = acknowledged = 0; retry = null; },
    };
}
