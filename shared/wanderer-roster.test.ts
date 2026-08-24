import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    WANDERER_ARCHETYPES,
    WANDERER_BUCKET_MS,
    WANDERER_GRID,
    WANDERER_MAX_INDEX,
    WANDERER_SECTOR_COUNT,
    parseWandererId,
    relocateWandererInto,
    resolveWandererById,
    rollWanderers,
    wandererDayBucketFromMs,
    wandererPresenceGate,
    wandererRelocationSector,
    type Wanderer,
} from './wanderer-roster.js';

/*
 * The roster roll is the ONLY authority on who is standing in a sector: every
 * player in that sector renders it, and the server re-derives it before paying
 * for an encounter (api/sector/_wanderer-encounter.ts). Two properties carry
 * that whole contract — the roll is a pure function of (sector, bucket), and an
 * id resolves back to exactly the wanderer it names or to nothing at all.
 *
 * Until this file existed the module was covered only indirectly, through the
 * client re-export in shinobij.client/src/lib/wanderers.ts.
 */

const BUCKET = wandererDayBucketFromMs(1_800_000_000_000);

/** A (sector, bucket) pair that actually rolls `count` wanderers. */
function findSectorWith(count: number, bucket = BUCKET): number {
    for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector++) {
        if (rollWanderers(sector, bucket).length === count) return sector;
    }
    throw new Error(`no sector rolls ${count} wanderers in bucket ${bucket}`);
}

test('the roll is a pure function of (sector, dayBucket) — same inputs, identical cast', () => {
    for (let sector = 1; sector <= 20; sector++) {
        const a = rollWanderers(sector, BUCKET);
        const b = rollWanderers(sector, BUCKET);
        assert.deepEqual(b, a, `sector ${sector} rolled a different cast the second time`);
    }
});

test('nothing about the caller leaks into the roll — a new window reshuffles, the same window does not', () => {
    const sector = findSectorWith(1);
    const here = rollWanderers(sector, BUCKET);
    // A different sector in the same window, and the same sector in the next
    // window, are both independent draws.
    assert.notDeepEqual(rollWanderers(sector, BUCKET + 1), here);
    // The window is the 6h bucket, so every millisecond inside one agrees.
    const startMs = BUCKET * WANDERER_BUCKET_MS;
    assert.equal(wandererDayBucketFromMs(startMs), BUCKET);
    assert.equal(wandererDayBucketFromMs(startMs + WANDERER_BUCKET_MS - 1), BUCKET);
    assert.equal(wandererDayBucketFromMs(startMs + WANDERER_BUCKET_MS), BUCKET + 1);
});

test('every rolled wanderer is well formed and stands on the interior of the board', () => {
    let seen = 0;
    for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector++) {
        const roster = rollWanderers(sector, BUCKET);
        assert.ok(roster.length <= WANDERER_MAX_INDEX + 1, `sector ${sector} over-rolled`);
        roster.forEach((w: Wanderer, i) => {
            seen++;
            assert.equal(w.id, `w-${sector}-${BUCKET}-${i}`);
            const meta = WANDERER_ARCHETYPES[w.archetype];
            assert.ok(meta, `unknown archetype ${w.archetype}`);
            assert.ok(meta.weight > 0, 'only the natural cast is ever rolled — synthed NPCs are weight 0');
            assert.equal(w.verb, meta.verb);
            assert.equal(w.tellTint, meta.tellTint);
            assert.equal(w.avatarKey, w.archetype);
            assert.ok(meta.names.includes(w.name));
            assert.ok(meta.greetings.includes(w.greeting));
            assert.ok(w.level >= 3 && w.level <= 95, `level ${w.level} out of band`);
            assert.ok(w.waypoints.includes(w.homeTile), 'home is always on the patrol route');
            for (const tile of w.waypoints) {
                const col = tile % WANDERER_GRID;
                const row = Math.floor(tile / WANDERER_GRID);
                assert.ok(col >= 1 && col <= 10 && row >= 1 && row <= 10, `tile ${tile} is on the board edge`);
            }
        });
        // Two wanderers never share a home tile.
        if (roster.length === 2) assert.notEqual(roster[0].homeTile, roster[1].homeTile);
    }
    assert.ok(seen > 0, 'the sweep found no wanderers at all — the roll is broken');
    assert.equal(rollWanderers(0, BUCKET).length, 0, 'sector 0 is the village — never a road');
    assert.equal(rollWanderers(Number.NaN, BUCKET).length, 0);
});

test('id parsing accepts only real natural ids', () => {
    assert.deepEqual(parseWandererId('w-12-4567-1'), { sector: 12, dayBucket: 4567, index: 1 });
    assert.deepEqual(parseWandererId('w-1-0-0'), { sector: 1, dayBucket: 0, index: 0 });
    for (const bad of ['merc-12-1', 'w-12-4567', 'w-12-4567-1-2', 'w--4567-1', 'w-12-4567-x', ' w-12-4567-1', '', 'w-12-4567-1 ']) {
        assert.equal(parseWandererId(bad), null, `"${bad}" should not parse as a wanderer id`);
    }
    assert.equal(parseWandererId(undefined as unknown as string), null);
});

test('resolveWandererById returns the exact wanderer the id names, or nothing', () => {
    const nowMs = BUCKET * WANDERER_BUCKET_MS + 1_000;
    const sector = findSectorWith(1);
    const [expected] = rollWanderers(sector, BUCKET);

    assert.deepEqual(resolveWandererById(expected.id, nowMs), expected);

    // A stale or future window resolves to nothing, so a client cannot be paid
    // for an NPC the world no longer contains.
    assert.equal(resolveWandererById(`w-${sector}-${BUCKET - 1}-0`, nowMs), null);
    assert.equal(resolveWandererById(`w-${sector}-${BUCKET + 1}-0`, nowMs), null);
    // An index past the rolled count, and one past the hard ceiling.
    assert.equal(resolveWandererById(`w-${sector}-${BUCKET}-1`, nowMs), null);
    assert.equal(resolveWandererById(`w-${sector}-${BUCKET}-${WANDERER_MAX_INDEX + 1}`, nowMs), null);
    // Forged sectors.
    assert.equal(resolveWandererById(`w-0-${BUCKET}-0`, nowMs), null);
    assert.equal(resolveWandererById(`w-${WANDERER_SECTOR_COUNT + 1}-${BUCKET}-0`, nowMs), null);
    // A synthesised NPC id never resolves through the natural roll.
    assert.equal(resolveWandererById('merc-frostfang-3', nowMs), null);

    // An EMPTY sector resolves nothing at index 0 even with a perfect id.
    const empty = (() => {
        for (let s = 1; s <= WANDERER_SECTOR_COUNT; s++) if (!rollWanderers(s, BUCKET).length) return s;
        throw new Error('no empty sector in this window');
    })();
    assert.equal(resolveWandererById(`w-${empty}-${BUCKET}-0`, nowMs), null);
});

test('relocation is deterministic and always moves the wanderer somewhere else', () => {
    for (let from = 1; from <= WANDERER_SECTOR_COUNT; from++) {
        const dest = wandererRelocationSector('w-3-100-0', from);
        assert.equal(wandererRelocationSector('w-3-100-0', from), dest, 'same inputs → same destination');
        assert.notEqual(dest, from, 'a relocation never puts the wanderer back where it was');
        assert.ok(dest >= 1 && dest <= WANDERER_SECTOR_COUNT, `destination ${dest} out of range`);
    }
});

test('a relocated wanderer holds still in its new sector', () => {
    const [w] = rollWanderers(findSectorWith(1), BUCKET);
    const moved = relocateWandererInto(w, 21);
    assert.deepEqual(relocateWandererInto(w, 21), moved, 'the re-home is deterministic, so nothing jitters');
    assert.equal(moved.id, w.id);
    assert.equal(moved.name, w.name);
    assert.ok(moved.waypoints.includes(moved.homeTile));
    assert.notDeepEqual(relocateWandererInto(w, 22).waypoints, moved.waypoints);
});

test('the presence gate is stable per key and honours its chance', () => {
    assert.equal(wandererPresenceGate('rift:a:5:100', 1), true, 'chance 1 is always present');
    assert.equal(wandererPresenceGate('rift:a:5:100', 0), false, 'chance 0 is never present');
    const key = 'rift:storyline-a:7:4200';
    assert.equal(wandererPresenceGate(key, 0.4), wandererPresenceGate(key, 0.4), 'same key → same answer, so nothing flickers');
    // Over many keys the gate lands near the requested rate rather than always
    // on one side of it.
    let hits = 0;
    for (let i = 0; i < 400; i++) if (wandererPresenceGate(`rift:x:${i}:${BUCKET}`, 0.4)) hits++;
    assert.ok(hits > 100 && hits < 220, `presence rate ${hits}/400 is nowhere near 40%`);
});
