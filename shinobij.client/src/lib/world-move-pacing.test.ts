import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldMovementGate, WORLD_WALK_MAX_CREDIT, WORLD_WALK_SPEED } from '../../../api/_realtime/world-movement';
import type { OnlinePlayer } from '../../../api/_realtime/types';
import { worldPositionModel, CONTINUOUS_WORLD_SPACE, WORLD_LAYOUT_VERSION } from '../../../shared/continuous-world-layout';
import { buildWorldNavigation, createWorldWalker } from '../../../shared/continuous-world-navigation';
import { createWorldMovePacer, WORLD_UNANSWERED_TILES, WORLD_UPDATE_TILES, type WorldMoveUpdate } from './world-move-pacing';

const model = worldPositionModel(), nodes = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).byId;
// The longest road, walked end to end and back: it crosses into another sector, as on a phone.
const road = [...CONTINUOUS_WORLD_SPACE.roads].sort((a, b) => b.length - a.length)[0]!;
const ends = [`${road.a.sector}:${road.a.tile}`, `${road.b.sector}:${road.b.tile}`];
/** The rule this replaced: wait once 1.4 tiles past the last acknowledged update. */
const BEFORE = { update: Infinity, unanswered: 1.4 };

type Walk = { rtt: number; jitter?: number; interval?: number; seconds?: number; seed?: number; govern?: boolean;
    limits?: { update: number; unanswered: number }; drop?: (arrival: number) => boolean };
/**
 * The controller's send loop (continuous-world-controller.ts) at 60 fps against the
 * real server gate: one update in flight, a new one every `interval` ms, and each
 * one-way trip half the round trip, give or take half of `jitter`. `stalls` is the
 * share of frames the walker had somewhere to go but stood still.
 */
function walk({ rtt, jitter = 40, interval = 125, seconds = 20, seed = 7, govern = true, limits, drop = () => false }: Walk) {
    const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const gate = createWorldMovementGate(), walker = createWorldWalker(nodes, ends[0]!), pace = createWorldMovePacer(WORLD_WALK_SPEED, limits);
    const start = model.read({ layoutVersion: WORLD_LAYOUT_VERSION, from: ends[0]!, to: ends[0]!, progress: 0 })!;
    const player = { name: 'pacer', displayName: 'Pacer', ...model.location(start), worldPosition: start, character: null,
        lastSeenAt: 0, connectedAt: 0, pendingAttacker: null, movementSeq: 0 } as OnlinePlayer;
    const pending: { at: number; run: () => void }[] = [], carried: number[] = [];
    let goal = 1, lastSend = -Infinity, inFlight = false, refused = 0, arrivals = 0, frames = 0, stalls = 0;
    for (let now = 0; now < seconds * 1000; now += 1000 / 60) {
        for (const event of pending.filter(e => e.at <= now)) { pending.splice(pending.indexOf(event), 1); event.run(); }
        if (!walker.moving) { goal = 1 - goal; assert(walker.go(ends[goal]!)); }
        const before = walker.travelled; walker.tick(Math.min(govern ? pace.rate(interval / 1000) / 60 : 1 / 60, pace.room));
        pace.advance((walker.travelled - before) / WORLD_WALK_SPEED);
        frames++; if (walker.travelled === before) stalls++;
        if (inFlight || now - lastSend <= interval) continue;
        lastSend = now; inFlight = true;
        const update: WorldMoveUpdate = pace.next(walker.cursor(WORLD_LAYOUT_VERSION), now / 1000);
        const up = Math.max(1, rtt / 2 + (random() - .5) * jitter), down = Math.max(1, rtt / 2 + (random() - .5) * jitter);
        pending.push({ at: now + up, run: () => {
            const result = drop(++arrivals) ? null : gate.admit(player, update.cursor, player.movementSeq, now + up);
            if (result?.ok) { carried.push(result.distance); player.worldPosition = result.position; player.sector = result.sector; player.tile = result.tile; player.movementSeq = (player.movementSeq ?? 0) + 1; }
            pending.push({ at: now + up + down, run: () => {
                inFlight = false;
                if (!result) pace.dropped(update);
                else if (result.ok) pace.accepted(update, (now + up + down) / 1000);
                else { refused++; walker.stop(); walker.restore(player.worldPosition!); pace.reset(); assert(walker.go(ends[goal]!)); }
            } });
        } });
    }
    return { speed: walker.travelled / seconds / WORLD_WALK_SPEED, stalls: stalls / frames, refused, carried };
}

test('a phone round trip no longer freezes the walk between replies', () => {
    // [round trip ms, least share of full speed now, most share under the old rule]
    for (const [rtt, now, before] of [[60, .99, 1], [120, .97, .92], [160, .88, .75], [200, .7, .6]] as const) {
        const paced = walk({ rtt }), old = walk({ rtt, govern: false, limits: BEFORE });
        assert.equal(paced.refused, 0, `${rtt} ms: the server refused a step`);
        assert(paced.speed >= now, `${rtt} ms: ${(paced.speed * 100).toFixed(0)}% of full speed`);
        assert(paced.stalls < .03, `${rtt} ms: stood still ${(paced.stalls * 100).toFixed(0)}% of frames`);
        assert(old.speed <= before, `${rtt} ms: the old rule managed ${(old.speed * 100).toFixed(0)}%`);
        if (rtt >= 160) assert(old.stalls > .2, `${rtt} ms: the old rule stood still ${(old.stalls * 100).toFixed(0)}% of frames`);
    }
});

test('on a link too slow for full speed, the walk slows down instead of dashing and freezing', () => {
    const governed = walk({ rtt: 300 }), dashing = walk({ rtt: 300, govern: false });
    assert(governed.stalls < .03, `${(governed.stalls * 100).toFixed(0)}% of frames stood still`);
    assert(dashing.stalls > .1, `${(dashing.stalls * 100).toFixed(0)}% of frames stood still without the governor`);
    assert(governed.speed > dashing.speed * .9, `${(governed.speed * 100).toFixed(0)}% vs ${(dashing.speed * 100).toFixed(0)}% of full speed`);
});

test('a jittery connection is never refused, so a walk never snaps back', () => {
    // Up to ±100 ms a leg. At the old 2-tile server credit, waiting only for a full next
    // update was refused 4-15 times a minute under this jitter.
    for (const rtt of [60, 120, 160, 200, 260]) for (const seed of [7, 99]) for (const jitter of [120, 200]) {
        assert.equal(walk({ rtt, jitter, seed }).refused, 0, `${rtt} ms ± ${jitter / 2}, seed ${seed}`);
    }
});

test('no update carries more than the per-update allowance the server leaves room for', () => {
    assert(WORLD_UPDATE_TILES < WORLD_UNANSWERED_TILES && WORLD_UNANSWERED_TILES <= WORLD_WALK_MAX_CREDIT);
    for (const rtt of [20, 160, 260, 400]) {
        const { carried, refused } = walk({ rtt });
        assert.equal(refused, 0, `${rtt} ms`);
        assert(Math.max(...carried) <= WORLD_UPDATE_TILES + 1e-9, `${rtt} ms: ${Math.max(...carried)} tiles in one update`);
    }
});

test('a dropped update is re-sent unchanged, so the next one still fits the server budget', () => {
    // Every third arrival is lost (the socket throttle, a 409 offline, a dead connection).
    const { carried, refused, speed } = walk({ rtt: 160, drop: arrival => arrival % 3 === 0 });
    assert.equal(refused, 0);
    assert(Math.max(...carried) <= WORLD_UPDATE_TILES + 1e-9, `${Math.max(...carried)} tiles in one update`);
    assert(speed > .5, `${(speed * 100).toFixed(0)}% of full speed`);
});

test('the pacer waits for a full next update or a full unanswered allowance, whichever comes first', () => {
    const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
    // Limits pinned so the arithmetic below holds whatever the shipped constants are.
    const limits = { update: 1.4, unanswered: 2 }, update = limits.update / 6.5, unanswered = limits.unanswered / 6.5;
    const pace = createWorldMovePacer(6.5, limits), cursor = { layoutVersion: 'v', from: 'a', to: 'a', progress: 0 };
    pace.advance(.1); near(pace.room, update - .1);
    assert.equal(pace.rate(.125), 1, 'full speed until a round trip is measured');
    const first = pace.next(cursor, 10);
    assert.equal(first.sample, .1);
    // Still walking while `first` is unanswered: the next update has room, the unanswered limit binds.
    near(pace.room, unanswered - .1);
    pace.advance(.1); near(pace.room, unanswered - .2);
    // Its answer frees the unanswered ground; now the next update's own limit binds.
    pace.accepted(first, 10.05); near(pace.room, update - .1);
    assert.equal(pace.rate(.125), 1, 'a 50 ms round trip sustains full speed');
    const second = pace.next(cursor, 10.2);
    pace.advance(pace.room); assert.equal(pace.room, 0);
    pace.dropped(second);
    assert.equal(pace.retrying, true);
    assert.equal(pace.next({ ...cursor, from: 'b', to: 'b' }, 10.6), second, 'the dropped update goes first, unchanged');
    assert.equal(pace.retrying, false);
    // A slow answer: the smoothed round trip rises and the sustainable pace falls.
    pace.accepted(second, 11);
    assert(pace.rate(.125) < 1 && pace.rate(.125) >= .4, `${pace.rate(.125)}`);
    pace.reset(); near(pace.room, update); assert.equal(pace.walked, 0);
});
