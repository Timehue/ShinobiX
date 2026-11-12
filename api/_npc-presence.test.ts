import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import { readFileSync } from 'node:fs';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-presence-test-session-secret-32-chars';

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let presence: typeof import('./_npc-presence.js');
let journeys: typeof import('./_npc-journeys.js');
let roam: typeof import('./_npc-roam.js');
let roster: typeof import('../shared/npc-village-roster.js');
let walk: typeof import('../shared/sector-walk-mask.js');
let geo: typeof import('../shared/sector-geo.js');
let links: typeof import('../shared/sector-links.js');

before(async () => {
    links = await import('../shared/sector-links.js');
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    presence = await import('./_npc-presence.js');
    journeys = await import('./_npc-journeys.js');
    roam = await import('./_npc-roam.js');
    roster = await import('../shared/npc-village-roster.js');
    walk = await import('../shared/sector-walk-mask.js');
    geo = await import('../shared/sector-geo.js');
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
});

/** Every test starts with an empty world and no journeys. */
function clearWorld() {
    journeys.resetNpcJourneysForTest();
    roam.npcHuntRegistry().clear();
    for (const npc of roster.NPC_VILLAGE_ROSTER) online.remove(npc.name);
    journeys.setNpcTravelMsForTest(journeys.NPC_TRAVEL_MS);
}
beforeEach(() => clearWorld());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CH = 'Cinderhold Village';
/** An NPC on the map at `sector`/`tile`, on a journey from there. */
function placeWalker(npc: (typeof roster.NPC_VILLAGE_ROSTER)[number], sector: number, tile: number, now: number) {
    online.upsert({ name: npc.name, sector, character: { name: npc.name, village: CH, level: 30 }, tile, tileSector: sector });
    journeys.ensureNpcJourney(npc, now, online.get(npc.name));
}
/** Road hops of a walkable path between two tiles of one sector. */
const tilesBetween = (sector: number, a: number, b: number) => (walk.walkPath(sector, a, b)?.length ?? Infinity) - 1;

test('with no ownership answer yet (storage down since boot) the tick waits: no journey is dropped, no NPC shown', async (t) => {
    const ownership = await import('./_npc-ownership.js');
    const npc = roster.NPC_VILLAGE_ROSTER[11]!;
    // Start while this NPC is on duty: every NPC logs off for hours each day, and
    // an off-duty NPC rightly has no journey, which is not what this test proves.
    let now = Date.now();
    while (presence.npcOffDuty(npc.id, now)) now += 60_000;
    placeWalker(npc, 58, walk.nearestWalkableTile(58, 60), now);
    ownership.forgetNpcOwnership();
    const mget = kv.mget.bind(kv);
    t.after(() => { (kv as { mget: typeof kv.mget }).mget = mget; ownership.forgetNpcOwnership(); });
    (kv as { mget: typeof kv.mget }).mget = (async (...keys: string[]) => {
        if (keys.length && keys.every((k) => k.startsWith('auth:'))) throw new Error('storage down');
        return mget(...keys);
    }) as typeof kv.mget;
    assert.equal(await presence.refreshNpcPresence(now), 0, 'nothing shown while ownership is unknown');
    assert.equal(ownership.npcOwnershipKnown(), false);
    assert.ok(journeys.npcJourneyOf(npc.id), 'its journey is kept, not dropped as "a player\'s account"');
    assert.ok(online.get(npc.name), 'its row is left alone');
    (kv as { mget: typeof kv.mget }).mget = mget;
    await presence.refreshNpcPresence(now + 1);
    assert.equal(ownership.npcOwnershipKnown(), true);
    assert.ok(journeys.npcJourneyOf(npc.id), 'and once storage answers it simply carries on');
});

test('a live world boss never has more than three Cinderhold watchers, at any moment of a window, and a hunter is never one', () => {
    const boss = roam.NPC_ROAM_SECTORS.find((s) => !geo.CINDERHOLD_SECTORS.includes(s))!;
    const start = Date.UTC(2026, 10, 9, 12);
    const hunter = roster.NPC_VILLAGE_ROSTER[0]!.id;
    for (let minute = 0; minute < 30; minute += 1) {
        const now = start + minute * 60_000;
        const opts = { bossSector: boss, notWatching: new Set([hunter]) };
        const posts = presence.npcPosts(now, undefined, [], new Set(), opts);
        const previous = presence.npcPosts(now - presence.NPC_POST_WINDOW_MS, undefined, [], new Set(), opts);
        const watching = roster.NPC_VILLAGE_ROSTER.filter((npc) => presence.npcPostFor(npc.id, now, posts, previous)?.duty === 'boss').map((npc) => npc.id);
        assert.equal(watching.length, roam.NPC_BOSS_WATCHERS, `minute ${minute}: ${watching.length} watchers`);
        assert.ok(!watching.includes(hunter), 'a hunter keeps to its rival');
    }
});

test('war duty only: each front takes its squad, a live boss its three watchers, and nobody else has a post', async () => {
    const { NPC_WAR_DEFENDER_RANKS } = await import('./_npc-war-roster.js');
    const now = Date.UTC(2026, 10, 9, 12);
    const boss = roam.NPC_ROAM_SECTORS.find((s) => s !== 58 && !geo.CINDERHOLD_SECTORS.includes(s))!;
    const posts = presence.npcPosts(now, undefined, [58], new Set(), { bossSector: boss });
    const at = (sector: number) => [...posts].filter(([, p]) => p.sector === sector).map(([id]) => id);
    assert.equal(at(58).length, presence.NPC_FRONT_SQUAD, 'the front keeps its full squad');
    assert.ok(at(58).every((id) => posts.get(id)!.duty === 'front'));
    assert.ok(at(58).every((id) => NPC_WAR_DEFENDER_RANKS.includes(roster.NPC_VILLAGE_ROSTER.find((n) => n.id === id)!.rank)));
    assert.equal(at(boss).length, roam.NPC_BOSS_WATCHERS, 'three are sent to the boss');
    assert.ok(at(boss).every((id) => posts.get(id)!.duty === 'boss' && !at(58).includes(id)));
    assert.equal(posts.size, presence.NPC_FRONT_SQUAD + roam.NPC_BOSS_WATCHERS, 'everyone else is on a journey, not at a post');
    for (const { sector, tile } of posts.values()) assert.equal(walk.nearestWalkableTile(sector, tile), tile);
    assert.equal(presence.npcPosts(now).size, 0, 'no war and no boss: no posts at all');
    // A boss on a screen that is not a walkable map gets no watchers.
    for (const sector of [54, 99]) {
        const away = presence.npcPosts(now, undefined, [], new Set(), { bossSector: sector });
        assert.equal([...away.values()].filter((p) => p.sector === sector).length, 0, `nobody follows the boss into ${sector}`);
    }
});

test('the roam ground is the whole walkable world (owner 2026-11-11): Cinderhold, every village block, outskirts and the castle city, never the festival or Death\'s Gate screens', async () => {
    const { HOME_SECTORS } = await import('./_war-map-sectors.js');
    const homes = new Set(Object.values(HOME_SECTORS).flat());
    const walkable = geo.PLAYABLE_WILD_SECTOR_IDS.filter((s) => !links.NON_WALKABLE_SECTORS.includes(s));
    for (const sector of walkable) {
        if (!roam.npcRoadRoute(geo.CINDERHOLD_GATE_SECTOR, sector)) continue;
        assert.ok(roam.NPC_ROAM_SECTORS.includes(sector), `${sector} is roam ground`);
    }
    for (const group of [[...homes], geo.OUTSKIRTS_SECTORS, geo.CASTLE_SECTORS, geo.CINDERHOLD_SECTORS]) {
        assert.ok(group.some((s) => roam.NPC_ROAM_SECTORS.includes(s)), `${group.join(',')} are open to journeys`);
    }
    for (const sector of roam.NPC_ROAM_SECTORS) {
        assert.ok(![geo.FESTIVAL_SECTOR, 99].includes(sector), `${sector} excluded`);
        const route = roam.npcRoadRoute(geo.CINDERHOLD_GATE_SECTOR, sector)!;
        assert.ok(route, `a road leads to ${sector}`);
        assert.equal(route.length - 1, roam.npcRoadDistance(geo.CINDERHOLD_GATE_SECTOR, sector));
        for (let i = 1; i < route.length; i++) {
            const [a, b] = [route[i - 1]!, route[i]!];
            assert.ok(links.SECTOR_ROAD_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a)), `${a}-${b} is a road`);
        }
    }
    // A route keeps out of a war front when another way exists.
    const route = roam.npcRoadRoute(67, 33)!;
    const middle = route[Math.floor(route.length / 2)]!;
    const around = roam.npcRoadRoute(67, 33, new Set([middle]));
    if (around) assert.ok(!around.slice(1, -1).includes(middle), 'detours round the front');
    // The old 2-per-sector roam cap and the 40% roam share are gone.
    assert.equal('NPC_ROAM_SECTOR_CAP' in roam, false);
    assert.equal('npcRoamPick' in roam, false);
    assert.equal('NPC_ROAM_PERCENT' in roam, false);
});

test('destinations: purposeful places spread over the whole map, every one walkable and never a gatherer\'s spot', () => {
    const spots = journeys.JOURNEY_SPOTS;
    const kinds = new Set(spots.map((s) => s.purpose));
    for (const kind of ['gather', 'shrine', 'stronghold', 'rift', 'gate', 'crossroads', 'castle', 'home', 'bridge', 'cairn'] as const) {
        assert.ok(kinds.has(kind), `somewhere to ${kind}`);
    }
    const sectors = new Set(spots.map((s) => s.sector));
    assert.ok(sectors.size >= roam.NPC_ROAM_SECTORS.length - 2, `${sectors.size} of ${roam.NPC_ROAM_SECTORS.length} sectors have somewhere to go`);
    for (const spot of spots) {
        assert.ok(walk.isWalkableTile(spot.sector, spot.tile), `${spot.purpose} ${spot.sector}:${spot.tile} walkable`);
        assert.equal(roam.isNodeApproachTile(spot.sector, spot.tile), false);
        if (spot.purpose === 'home') assert.ok(geo.CINDERHOLD_SECTORS.includes(spot.sector));
        if (spot.purpose === 'gate') assert.ok(geo.OUTSKIRTS_SECTORS.includes(spot.sector), 'another village\'s gate');
    }
    // Personality steers the kind of place: medics pray, the aggressive scout.
    const tally = (personality: 'medic' | 'aggressive', purpose: string) => {
        let n = 0;
        for (let leg = 0; leg < 400; leg++) if (journeys.npcJourneyPick('probe', personality, 1, leg, 40, Date.UTC(2026, 10, 9), [], new Set()).purpose === purpose) n++;
        return n;
    };
    assert.ok(tally('medic', 'shrine') > tally('aggressive', 'shrine'), 'medics favour shrines');
    assert.ok(tally('aggressive', 'stronghold') > tally('medic', 'stronghold'), 'the aggressive favour strongholds');
    // Seeded: the same NPC, seed and leg always plan the same stop.
    const a = journeys.npcJourneyPick('renji', 'guardian', 7, 3, 58, 0, [], new Set());
    assert.deepEqual(journeys.npcJourneyPick('renji', 'guardian', 7, 3, 58, 0, [], new Set()), a);
    // Never where it stands, a war front, or a recent stop.
    for (let leg = 0; leg < 200; leg++) {
        const goal = journeys.npcJourneyPick('renji', 'aggressive', 2, leg, 58, 0, [40, 41], new Set([18]));
        assert.ok(![58, 18, 40, 41].includes(goal.sector), `leg ${leg} -> ${goal.sector}`);
        assert.ok(goal.dwellMs >= 60_000 && goal.dwellMs <= 8 * 60_000, `dwells a few minutes (${goal.dwellMs} ms)`);
        assert.ok(goal.reason.length > 0);
    }
});

test('the tick shows free NPCs like players and leaves a controlled one to its admin', async () => {
    const { npcPossessKey } = await import('./_npc-possession.js');
    const controlled = roster.NPC_VILLAGE_ROSTER[0]!;
    await kv.set(npcPossessKey(controlled.id), { by: 'admin', at: Date.now(), expiresAt: Date.now() + 60_000 });
    try {
        const now = Date.now();
        const away = presence.npcsOffDuty(now);
        away.delete(controlled.id);
        const shown = await presence.refreshNpcPresence(now);
        assert.equal(shown, 29 - away.size, 'everyone free and logged in is shown');
        assert.equal(online.get(controlled.name), null);
        for (const id of away) assert.equal(online.get(roster.NPC_VILLAGE_ROSTER.find((n) => n.id === id)!.name), null, 'a logged-off NPC is not in the world');
        const free = roster.NPC_VILLAGE_ROSTER.find((n) => n.id !== controlled.id && !away.has(n.id))!;
        const row = online.get(free.name)!;
        assert.ok(roam.NPC_GROUND_SECTORS.has(row.sector), `${row.sector} is home or the roam ground`);
        assert.equal(row.character?.village, CH);
        assert.equal(row.character?.name, free.name);
        assert.equal(row.character?.ryo, undefined, 'only the slim public presence fields');
    } finally { await kv.del(npcPossessKey(controlled.id)); }
});

test('every free NPC is out on a journey with a destination and a purpose, spread over the world, not parked at home', async () => {
    const now = Date.now();
    await presence.refreshNpcPresence(now);
    const onMap = roster.NPC_VILLAGE_ROSTER.filter((npc) => online.get(npc.name));
    assert.ok(onMap.length >= 10);
    const reasons = new Set(Object.values(journeys.NPC_JOURNEY_REASONS));
    const sectors = new Set<number>();
    for (const npc of onMap) {
        const journey = journeys.npcJourneyOf(npc.id);
        assert.ok(journey, `${npc.id} is on a journey`);
        assert.equal(journey.held, null);
        assert.ok(reasons.has(journey.reason), `${npc.id}: ${journey.reason}`);
        assert.ok(roam.NPC_GROUND_SECTORS.has(journey.sector), 'its destination is on the roam ground');
        assert.ok(walk.isWalkableTile(journey.sector, journey.tile));
        sectors.add(online.get(npc.name)!.sector);
    }
    const atHome = onMap.filter((npc) => geo.CINDERHOLD_SECTORS.includes(online.get(npc.name)!.sector)).length;
    assert.ok(atHome < onMap.length / 2, `a fresh start puts ${atHome} of ${onMap.length} in Cinderhold, not all thirty`);
    assert.ok(sectors.size >= Math.min(10, onMap.length - 2), `they start all over the map (${sectors.size} sectors)`);
    // A restart in the same hour starts them in the same places (seeded), not at random.
    const first = new Map(onMap.map((npc) => [npc.id, online.get(npc.name)!.sector]));
    clearWorld();
    await presence.refreshNpcPresence(now);
    for (const npc of onMap) assert.equal(online.get(npc.name)?.sector, first.get(npc.id), `${npc.id} restarts where its seed says`);
    // Gathering at the start is shown and claims nothing.
    for (const npc of onMap) {
        const row = online.get(npc.name)!, journey = journeys.npcJourneyOf(npc.id)!;
        if (row.activity) assert.equal(journey.activity, row.activity);
    }
});

test('after a restart an NPC carries on from the sector its boot-snapshot row was in', async () => {
    const now = Date.now();
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => [0, 1].every((m) => !presence.npcOffDuty(n.id, now + m * 60_000)))!;
    const store = online as unknown as { restore(rows: unknown[]): number };
    assert.equal(store.restore([{ name: npc.id, displayName: npc.name, sector: 40, lastSeenAt: online.clockNow(), connectedAt: online.clockNow() }]), 1);
    assert.equal(online.get(npc.name), null, 'a boot row is hidden until verified');
    await presence.refreshNpcPresence(now);
    const row = online.get(npc.name)!;
    assert.equal(row.sector, 40, 'it resumes where the snapshot had it');
    assert.equal(walk.nearestWalkableTile(40, row.tile!), row.tile);
    assert.ok(journeys.npcJourneyOf(npc.id), 'and sets off on a journey from there');
});

test('the walker walks a player\'s pace, tile by tile on walkable ground, and leaves and enters sectors by the real roads', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[6]!;
    const goal = roam.NPC_ROAM_SECTORS.find((s) => (roam.npcRoadDistance(67, s) ?? 0) === 3 && !geo.CINDERHOLD_SECTORS.includes(s))!;
    const route = roam.npcRoadRoute(67, goal)!;
    const goalTile = walk.nearestWalkableTile(goal, 78);
    let now = Date.UTC(2026, 10, 11, 9);
    placeWalker(npc, 67, walk.nearestWalkableTile(67, 30), now);
    journeys.setNpcJourneyErrand(npc.id, { purpose: 'boss', sector: goal, tile: goalTile });
    // A copy: the store mutates its row in place.
    const snap = () => ({ ...online.get(npc.name)! });
    // Every road crossing, seen as it happens: where it stood and where the store put it.
    const crossings: { from: number; tile: number; to: number; arrivalAt: number; clock: number; landedSector: number; landedTile: number; traveling: unknown }[] = [];
    const startTravel = online.startTravel.bind(online);
    online.startTravel = (name, destination, arrivalAt, origin, arrivalTile, position) => {
        const row = online.get(name);
        const before = row ? { sector: row.sector, tile: row.tile } : null; // the store edits its row in place
        const clock = online.clockNow();
        const out = startTravel(name, destination, arrivalAt, origin, arrivalTile, position);
        if (before && out && name.toLowerCase() === npc.name.toLowerCase()) crossings.push({ from: before.sector, tile: before.tile!, to: destination, arrivalAt, clock,
            landedSector: out.sector, landedTile: out.tile!, traveling: out.travelingUntil });
        return out;
    };
    let last = snap();
    const visited = [67];
    let walkedTiles = 0, walkingMs = 0;
    try {
        for (let i = 0; i < 400; i++) {
            const seqBefore = last.movementSeq ?? 0;
            const crossedBefore = crossings.length;
            now += journeys.NPC_WALK_TICK_MS;
            const report = journeys.stepNpcJourneys(now);
            const row = snap();
            for (const c of crossings.slice(crossedBefore)) {
                // Through the road's own exit tile, over the border at once (a walking
                // player's crossing: no lease, so it never vanishes), onto the arrival tile.
                const exit = links.sectorExits(c.from).find((e) => e.destinationSector === c.to)!;
                assert.ok(exit, `${c.from} -> ${c.to} is a real road`);
                assert.equal(c.tile, exit.tile, 'it leaves through the road\'s exit tile');
                assert.ok(c.arrivalAt <= c.clock, 'no road lease: it arrives the moment it crosses');
                assert.equal(c.traveling, undefined, 'never left travelling, so the next sector shows it at once');
                assert.equal(c.landedSector, c.to);
                assert.equal(c.landedTile, roam.npcStandTile(c.to, links.travelArrivalTile(c.from, c.to)!), 'it lands on the arrival tile');
                visited.push(c.to);
            }
            if (crossings.length > crossedBefore) {
                assert.ok(walk.isWalkableTile(row.sector, row.tile!), `on walkable ground after the border (${row.sector}:${row.tile})`);
                last = row; if (report.arrived) break; continue;
            }
            if (row.sector === last.sector && row.tile !== last.tile) {
                const steps = tilesBetween(row.sector, last.tile!, row.tile!);
                assert.ok(steps >= 1 && steps <= 4, `a half-second covers ${steps} tiles (pace ${journeys.NPC_WALK_TILES_PER_SECOND}/s)`);
                assert.ok((row.movementSeq ?? 0) > seqBefore, 'a real movement the client animates');
                walkedTiles += steps;
                walkingMs += journeys.NPC_WALK_TICK_MS;
            }
            assert.ok(walk.isWalkableTile(row.sector, row.tile!), `on walkable ground (${row.sector}:${row.tile})`);
            last = row;
            if (report.arrived) break;
        }
    } finally { online.startTravel = startTravel; }
    assert.ok(crossings.length >= 3, `it crossed ${crossings.length} borders`);
    assert.deepEqual(visited, route, 'road by road along the route, every sector on the way');
    assert.equal(last.sector, goal);
    assert.equal(last.tile, goalTile, 'it stops at its destination');
    const pace = walkedTiles / (walkingMs / 1000);
    assert.ok(pace > journeys.NPC_WALK_TILES_PER_SECOND - 1.2 && pace <= journeys.NPC_WALK_TILES_PER_SECOND + 0.5, `pace ${pace.toFixed(2)} tiles/s`);
    assert.equal(journeys.npcJourneyOf(npc.id)?.phase, 'dwelling', 'and stays there while the errand lasts');
});

test('every step reaches the sector as a player\'s world move does, so the continuous world draws it walking', async () => {
    const notify = await import('./_realtime/notify.js');
    const { worldPositionModel } = await import('../shared/continuous-world-layout.js');
    const model = worldPositionModel();
    const npc = roster.NPC_VILLAGE_ROSTER[7]!;
    const sector = 67, start = walk.nearestWalkableTile(sector, 30), goal = walk.nearestWalkableTile(sector, 78);
    let now = Date.UTC(2026, 10, 11, 9);
    placeWalker(npc, sector, start, now);
    journeys.setNpcJourneyErrand(npc.id, { purpose: 'boss', sector, tile: goal });
    const emits: { room: string; event: string; payload: Record<string, unknown> }[] = [];
    notify.setRealtimeEmitter((room, event, payload) => emits.push({ room, event, payload: payload as Record<string, unknown> }));
    try {
        for (let i = 0; i < 20; i++) { now += journeys.NPC_WALK_TICK_MS; journeys.stepNpcJourneys(now); }
    } finally { notify.setRealtimeEmitter(null); }
    const tiles = emits.filter((e) => e.event === 'presence:move');
    const worlds = emits.filter((e) => e.event === 'presence:world');
    assert.ok(tiles.length >= 2, `it walked (${tiles.length} steps)`);
    // One world delta per step, in step order, on the same sequence the row carries.
    assert.deepEqual(worlds.map((e) => [e.room, e.payload.tile, e.payload.sequence]), tiles.map((e) => [e.room, e.payload.tile, e.payload.sequence]));
    for (const w of worlds) {
        const position = model.read(w.payload.worldPosition);
        assert.ok(position, 'a world position the client can read');
        assert.deepEqual(model.location(position), { sector, tile: w.payload.tile }, 'standing on the tile it stepped to');
    }
    const sequences = worlds.map((e) => Number(e.payload.sequence));
    assert.ok(sequences.every((s, i) => i === 0 || s > sequences[i - 1]!), 'each newer than the last, so the peer layer adopts it');
    assert.equal(online.get(npc.name)!.worldPosition, undefined, 'the row keeps no cursor (that marks an admin driving it)');
});

test('unless attacked: an attack, the duel opening and the fight pin a walking NPC where it stands, and it carries on after', async () => {
    const holds = await import('./_npc-attack-hold.js');
    const npc = roster.NPC_VILLAGE_ROSTER[8]!;
    let now = Date.UTC(2026, 10, 11, 10);
    placeWalker(npc, 58, walk.nearestWalkableTile(58, 60), now);
    journeys.setNpcJourneyErrand(npc.id, { purpose: 'boss', sector: 40, tile: walk.nearestWalkableTile(40, 78) });
    journeys.setNpcTravelMsForTest(0);
    const step = () => { now += journeys.NPC_WALK_TICK_MS; journeys.stepNpcJourneys(now); return online.get(npc.name)!; };
    step();
    // What production does (player/attack.ts, then _npc-duel.ts sealNpcDuel): no
    // attack flag on the row, an in-memory hold instead, the duel's after the attack's.
    holds.pinNpc(npc.id, 'attack:ambusher', Date.now() + holds.NPC_ATTACK_HOLD_MS);
    const held = { ...online.get(npc.name)! }; // the store mutates its row in place
    assert.equal(held.pendingAttacker ?? null, null);
    for (let i = 0; i < 10; i++) {
        const row = step();
        assert.equal(row.sector, held.sector);
        assert.equal(row.tile, held.tile, 'it stands still for its attacker');
    }
    holds.pinNpc(npc.id, 'duel:test-battle', Date.now() + holds.NPC_DUEL_HOLD_MS);
    holds.unpinNpc(npc.id, 'attack:ambusher');
    for (let i = 0; i < 10; i++) assert.equal(step().tile, held.tile, 'and while the duel waits for its seat to join');
    holds.unpinNpc(npc.id, 'duel:test-battle');
    online.setInBattle(npc.name, true);
    for (let i = 0; i < 10; i++) assert.equal(step().tile, held.tile, 'and stays put through the fight');
    online.setInBattle(npc.name, false);
    let moved = false;
    for (let i = 0; i < 6 && !moved; i++) { const row = step(); moved = row.tile !== held.tile || row.sector !== held.sector; }
    assert.ok(moved, 'after the fight it walks on');
    assert.equal(journeys.npcJourneyOf(npc.id)?.sector, 40, 'toward the same destination');
    // Beaten (api/_npc-duel-driver.ts claimAsNpc): it stays where it fell until the tick takes it to hospital.
    journeys.holdNpcJourney(npc.id, 'wounded');
    const fell = { ...online.get(npc.name)! };
    for (let i = 0; i < 10; i++) assert.equal(step().tile, fell.tile, 'a beaten NPC walks nowhere');
});

test('a meadow that stops blooming sends its gatherer on before its stop is over', async () => {
    const { HARVEST_BLOOM_MS, harvestBloom } = await import('../shared/resource-nodes.js');
    const npc = roster.NPC_VILLAGE_ROSTER[9]!;
    // A meadow on the roam ground and a bloom window followed by a dormant one.
    let found: { meadow: (typeof roam.NPC_GATHER_NODES)[number]; end: number } | null = null;
    for (const meadow of roam.NPC_GATHER_NODES.filter((n) => n.activity === 'harvesting')) {
        for (let cycle = 990_000; cycle < 990_200 && !found; cycle++) {
            const end = (cycle + 1) * HARVEST_BLOOM_MS;
            if (harvestBloom(meadow, end - 1).present && !harvestBloom(meadow, end).present) found = { meadow, end };
        }
        if (found) break;
    }
    assert.ok(found, 'a meadow whose bloom ends');
    const { meadow, end } = found;
    const now = end - 2 * 60_000; // two minutes before the bloom ends, a six-minute stop
    const stand = roam.npcNodeStandTiles(meadow)[0]!;
    placeWalker(npc, meadow.sector, stand, now);
    journeys.settleNpcJourneyForTest(npc.id, { purpose: 'gather', sector: meadow.sector, tile: stand, reason: 'to gather',
        dwellMs: 6 * 60_000, activity: 'harvesting', nodeId: meadow.id }, now);
    journeys.stepNpcJourneys(now + 60_000);
    assert.equal(journeys.npcJourneyOf(npc.id)?.phase, 'dwelling', 'it cuts while the meadow blooms');
    journeys.stepNpcJourneys(end + 1_000);
    assert.equal(journeys.npcJourneyOf(npc.id)?.phase, 'walking', 'nothing left to cut: it moves on, as a player would');
});

test('a journey whose row aged out under a long hold comes back where it last stood, not at its goal', () => {
    const npc = roster.NPC_VILLAGE_ROSTER[10]!;
    const now = Date.UTC(2026, 10, 11, 13);
    placeWalker(npc, 58, walk.nearestWalkableTile(58, 60), now);
    journeys.setNpcJourneyErrand(npc.id, { purpose: 'boss', sector: 40, tile: walk.nearestWalkableTile(40, 78) });
    journeys.stepNpcJourneys(now + journeys.NPC_WALK_TICK_MS);
    const stood = { sector: online.get(npc.name)!.sector, tile: online.get(npc.name)!.tile! };
    journeys.holdNpcJourney(npc.id, 'possessed');
    journeys.stepNpcJourneys(now + 2 * journeys.NPC_WALK_TICK_MS);
    online.remove(npc.name); // an admin stopped sending beats
    assert.deepEqual(journeys.ensureNpcJourney(npc, now + 3 * journeys.NPC_WALK_TICK_MS, null), stood);
    assert.notDeepEqual(stood, { sector: 40, tile: walk.nearestWalkableTile(40, 78) }, 'which is not its goal');
});

test('off duty, wounded and admin-controlled NPCs are off their journeys; a wounded one comes back in Cinderhold', async () => {
    const { npcPossessKey } = await import('./_npc-possession.js');
    const wounds = await import('./_npc-wounds.js');
    const now = Date.now();
    const free = roster.NPC_VILLAGE_ROSTER.filter((n) => [0, 1, 2].every((h) => !presence.npcOffDuty(n.id, now + h * 3_600_000)));
    const [controlled, hurt] = [free[0]!, free[1]!];
    await presence.refreshNpcPresence(now);
    assert.ok(journeys.npcJourneyOf(controlled.id) && journeys.npcJourneyOf(hurt.id));
    for (const id of presence.npcsOffDuty(now)) assert.equal(journeys.npcJourneyOf(id), null, 'an NPC off duty is on no journey');
    await kv.set(npcPossessKey(controlled.id), { by: 'admin', at: now, expiresAt: now + 60_000 });
    await wounds.woundNpc(hurt.id, now, 'someone');
    try {
        await presence.refreshNpcPresence(now + 1);
        assert.equal(journeys.npcJourneyOf(controlled.id)?.held, 'possessed', 'the walker stands down for the admin');
        const before = online.get(controlled.name)!;
        journeys.setNpcTravelMsForTest(0);
        for (let i = 1; i <= 20; i++) journeys.stepNpcJourneys(now + i * 500);
        assert.equal(online.get(controlled.name)?.tile, before.tile, 'and never moves it');
        assert.equal(journeys.npcJourneyOf(hurt.id), null, 'a wounded NPC is off the map and off its journey');
        assert.equal(online.get(hurt.name), null);
        // Healed, it comes back in Cinderhold (its hospital), not where it fell.
        await kv.del(wounds.npcWoundKey(hurt.id));
        await presence.refreshNpcPresence(now + 2);
        assert.ok(geo.CINDERHOLD_SECTORS.includes(online.get(hurt.name)!.sector), `back from hospital in ${online.get(hurt.name)!.sector}`);
    } finally { await kv.del(npcPossessKey(controlled.id)); await kv.del(wounds.npcWoundKey(hurt.id)); }
    // Released, it sets off on a new leg from where the admin left it.
    await presence.refreshNpcPresence(now + 2);
    assert.equal(journeys.npcJourneyOf(controlled.id)?.held, null);
});

test('a rival hunt and a world-boss watch are journeys with that purpose; a war order overrides both and holds the NPC', async (t) => {
    const { NPC_CAMPAIGN_ASSIGNMENTS_KEY } = await import('./_npc-campaign-assignments.js');
    const now = Date.now();
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => [0, 1, 5, 10].every((m) => !presence.npcOffDuty(n.id, now + m * 60_000)))!;
    t.after(() => kv.del(NPC_CAMPAIGN_ASSIGNMENTS_KEY));
    roam.npcHuntRegistry().set(npc.id, { npc: npc.id, target: 'somerival', sector: 58, since: now, follows: 0, until: now + 600_000, homes: [] });
    online.upsert({ name: npc.name, sector: 70, character: { name: npc.name, village: CH }, tile: 60, tileSector: 70 });
    await presence.refreshNpcPresence(now);
    const hunting = journeys.npcJourneyOf(npc.id)!;
    assert.equal(hunting.purpose, 'hunt');
    assert.equal(hunting.sector, 58, 'the hunter heads for its rival\'s sector');
    journeys.setNpcTravelMsForTest(0);
    let at = now;
    for (let i = 0; i < 400 && online.get(npc.name)!.sector !== 58; i++) journeys.stepNpcJourneys(at += 500);
    assert.equal(online.get(npc.name)!.sector, 58, 'and walks there road by road');
    // The hunt ends: the next step picks a stop of its own.
    roam.npcHuntRegistry().delete(npc.id);
    await presence.refreshNpcPresence(now + 1);
    journeys.stepNpcJourneys(at += 500);
    assert.notEqual(journeys.npcJourneyOf(npc.id)!.purpose, 'hunt');
    // A war order wins: straight there on one lease, as it always has, and the walker holds off.
    await kv.set(NPC_CAMPAIGN_ASSIGNMENTS_KEY, { assignments: { [npc.id]: { kind: 'strike', warId: 'w', generation: 1, sector: 18, since: now, until: now + 300_000 } }, wars: {} });
    journeys.setNpcTravelMsForTest(60_000);
    await presence.refreshNpcPresence(now + 2);
    assert.equal(online.get(npc.name)!.travelDestinationSector, 18, 'a war order goes straight there');
    assert.equal(journeys.npcJourneyOf(npc.id)!.held, 'order');
});

test('a world-boss watcher walks to the boss and stays while it watches', async () => {
    const now = Date.UTC(2026, 10, 11, 13);
    const npc = roster.NPC_VILLAGE_ROSTER[11]!;
    placeWalker(npc, 67, walk.nearestWalkableTile(67, 40), now);
    journeys.setNpcJourneyErrand(npc.id, { purpose: 'boss', sector: 58, tile: walk.nearestWalkableTile(58, 70) });
    journeys.setNpcTravelMsForTest(0);
    let at = now;
    for (let i = 0; i < 200; i++) journeys.stepNpcJourneys(at += 500);
    assert.equal(online.get(npc.name)!.sector, 58);
    for (let i = 0; i < 2000; i++) journeys.stepNpcJourneys(at += 500); // well past any stop's dwell
    assert.equal(online.get(npc.name)!.sector, 58, 'it stays while it is watching');
    journeys.setNpcJourneyErrand(npc.id, null);
    journeys.stepNpcJourneys(at += 500);
    assert.notEqual(journeys.npcJourneyOf(npc.id)!.purpose, 'boss', 'then moves on');
});

test('an attacker flag with no duel behind it lapses, so a closed tab never freezes an NPC', async (t) => {
    const now = Date.now();
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => [0, 1, 2].every((m) => !presence.npcOffDuty(n.id, now + m * 60_000)))!;
    await presence.refreshNpcPresence(now);
    assert.ok(online.get(npc.name));
    assert.equal(online.setPendingAttacker(npc.name, { name: 'gone-attacker' }), true);
    await presence.refreshNpcPresence(now + 10_000);
    assert.ok(online.get(npc.name)!.pendingAttacker, 'a fresh attack is kept while its duel is created');
    const pinned = online.get(npc.name)!.tile;
    journeys.stepNpcJourneys(now + 10_500);
    assert.equal(online.get(npc.name)!.tile, pinned, 'and the NPC stays where it was attacked');
    await presence.refreshNpcPresence(now + 10_000 + presence.NPC_PENDING_ATTACKER_TTL_MS);
    assert.equal(online.get(npc.name)!.pendingAttacker, null, 'the stale flag is dropped');
    t.after(() => online.clearPendingAttacker(npc.name));
});

test('every NPC logs off for a stretch each day, at its own hour', () => {
    const day = 24 * 60 * 60 * 1000, step = 10 * 60 * 1000;
    const base = Date.UTC(2026, 10, 1);
    for (const npc of roster.NPC_VILLAGE_ROSTER) {
        let off = 0;
        for (let t = base; t < base + 7 * day; t += step) if (presence.npcOffDuty(npc.id, t)) off += step;
        const hoursPerDay = off / 7 / (60 * 60 * 1000);
        assert.ok(hoursPerDay >= presence.NPC_OFF_DUTY_MIN_HOURS - 1 && hoursPerDay <= presence.NPC_OFF_DUTY_MAX_HOURS + 1, `${npc.id}: ${hoursPerDay.toFixed(1)} h a day`);
    }
    for (let t = base; t < base + 2 * day; t += 60 * 60 * 1000) {
        const away = presence.npcsOffDuty(t).size;
        assert.ok(away >= 1 && away <= 20, `${away} away at ${new Date(t).toISOString()}`);
    }
});

test('over a simulated day every one of the thirty visits many sectors across the map, comes home now and then, and two never stand on one tile', () => {
    const t0 = Date.UTC(2026, 10, 12, 0);
    journeys.setNpcTravelMsForTest(0);
    for (const npc of roster.NPC_VILLAGE_ROSTER) {
        const start = journeys.ensureNpcJourney(npc, t0, null);
        online.upsert({ name: npc.name, sector: start.sector, character: { name: npc.name, village: CH, level: 30 }, tile: start.tile, tileSector: start.sector });
    }
    const seen = new Map(roster.NPC_VILLAGE_ROSTER.map((npc) => [npc.id, new Set<number>()]));
    const purposes = new Map(roster.NPC_VILLAGE_ROSTER.map((npc) => [npc.id, new Set<string>()]));
    let crowded = 0;
    const STEP = 4_000;
    for (let at = t0, i = 0; at < t0 + 24 * 3_600_000; at += STEP, i++) {
        journeys.stepNpcJourneys(at);
        if (i % 15) continue; // sample once a minute
        const standing = new Map<string, string>();
        const perSector = new Map<number, number>();
        for (const npc of roster.NPC_VILLAGE_ROSTER) {
            const row = online.get(npc.name);
            if (!row) {
                // Rows go stale only on the store's real clock; keep them fresh across the run.
                continue;
            }
            seen.get(npc.id)!.add(row.sector);
            const journey = journeys.npcJourneyOf(npc.id)!;
            purposes.get(npc.id)!.add(journey.purpose);
            perSector.set(row.sector, (perSector.get(row.sector) ?? 0) + 1);
            if (journey.phase === 'dwelling' && row.sector === journey.sector) {
                const key = `${row.sector}:${row.tile}`;
                assert.equal(standing.get(key), undefined, `${npc.id} and ${standing.get(key)} on one tile ${key}`);
                standing.set(key, npc.id);
            }
        }
        if ([...perSector].some(([sector, n]) => n >= 3 && !geo.CINDERHOLD_SECTORS.includes(sector))) crowded++;
        if (i % 600 === 0) for (const npc of roster.NPC_VILLAGE_ROSTER) {
            const row = online.get(npc.name);
            if (row) online.upsert({ name: npc.name, sector: row.sector, character: null, tile: row.tile, tileSector: row.sector });
        }
    }
    const union = new Set<number>();
    for (const npc of roster.NPC_VILLAGE_ROSTER) {
        const sectors = seen.get(npc.id)!;
        sectors.forEach((s) => union.add(s));
        assert.ok(sectors.size >= 20, `${npc.id} visited ${sectors.size} sectors in a day`);
        assert.ok([...sectors].some((s) => geo.CINDERHOLD_SECTORS.includes(s)), `${npc.id} came home at least once`);
        assert.ok([...sectors].some((s) => !geo.CINDERHOLD_SECTORS.includes(s)), `${npc.id} went out`);
        assert.ok(purposes.get(npc.id)!.size >= 4, `${npc.id} did several kinds of thing: ${[...purposes.get(npc.id)!].join(',')}`);
    }
    assert.ok(union.size >= roam.NPC_ROAM_SECTORS.length - 6, `between them they covered ${union.size} of ${roam.NPC_ROAM_SECTORS.length} sectors`);
    assert.ok(crowded > 0, 'no per-sector cap: three or more share a wild sector now and then');
});

test('the walker touches no storage, and costs microseconds a step', async () => {
    const now0 = Date.UTC(2026, 10, 12, 6);
    journeys.setNpcTravelMsForTest(0);
    for (const npc of roster.NPC_VILLAGE_ROSTER) {
        placeWalker(npc, 67, walk.nearestWalkableTile(67, 50), now0);
        // Everyone walking at once: the worst case.
        journeys.setNpcJourneyErrand(npc.id, { purpose: 'boss', sector: 40, tile: walk.nearestWalkableTile(40, 78) });
    }
    const methods = ['get', 'mget', 'set', 'del', 'hset', 'hget', 'hgetall', 'keys', 'incr', 'compareSet', 'compareSetMany', 'getMany', 'setMany'] as const;
    const store = kv as unknown as Record<string, (...args: unknown[]) => unknown>;
    const spies = methods.filter((m) => typeof store[m] === 'function').map((m) => mock.method(store, m));
    let moves = 0;
    const started = process.hrtime.bigint();
    const STEPS = 200;
    try {
        for (let i = 1; i <= STEPS; i++) moves += journeys.stepNpcJourneys(now0 + i * journeys.NPC_WALK_TICK_MS).moves;
    } finally { spies.forEach((s) => s.mock.restore()); }
    const microsPerStep = Number(process.hrtime.bigint() - started) / 1000 / STEPS;
    assert.ok(moves > 0, 'they walked');
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0, 'no storage call from the walker');
    const source = readFileSync('api/_npc-journeys.ts', 'utf8');
    assert.doesNotMatch(source, /from '\.\/_storage|from '\.\/_storage-projection|kv\./, 'the walker module never imports storage');
    console.log(`[npc-walker] 30 walking NPCs: ${microsPerStep.toFixed(0)} µs a step, ${(microsPerStep * 1000 / journeys.NPC_WALK_TICK_MS / 1000).toFixed(2)} ms of CPU a second`);
    assert.ok(microsPerStep < 20_000, `${microsPerStep.toFixed(0)} µs a step`);
});

test('a gathering stop: one tile off the node\'s spot, the pose shown while it works, claiming nothing, and gone when it moves on', async () => {
    const nodes = await import('../shared/resource-nodes.js');
    const { toPlayerRecord } = await import('./_realtime/presence-input.js');
    journeys.setNpcTravelMsForTest(0);
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.personality === 'medic')!;
    let at = Date.UTC(2026, 10, 12, 8);
    placeWalker(npc, 67, walk.nearestWalkableTile(67, 50), at);
    let found = false;
    for (let i = 0; i < 40_000 && !found; i++) {
        journeys.stepNpcJourneys(at += 2_000);
        const j = journeys.npcJourneyOf(npc.id)!;
        found = j.phase === 'dwelling' && j.purpose === 'gather' && online.get(npc.name)!.sector === j.sector;
        if (i % 1000 === 0) { const row = online.get(npc.name)!; online.upsert({ name: npc.name, sector: row.sector, character: null, tile: row.tile, tileSector: row.sector }); }
    }
    assert.ok(found, 'a medic stops to gather within a day');
    const journey = journeys.npcJourneyOf(npc.id)!;
    const row = online.get(npc.name)!;
    const node = [...nodes.RESOURCE_NODES, ...nodes.HARVEST_NODES].find((n) => n.sector === row.sector && Math.max(Math.abs((row.tile! % 12) - (n.approach % 12)), Math.abs(Math.floor(row.tile! / 12) - Math.floor(n.approach / 12))) === 1)!;
    assert.ok(node, 'beside a node');
    assert.equal(row.activity, journey.activity, 'its presence row says what it is doing');
    assert.notEqual(row.tile, node.approach, 'never on the spot a player gathers from');
    assert.notEqual(row.tile, node.target);
    assert.equal(toPlayerRecord(row).activity, journey.activity, 'sector-mates see it');
    assert.deepEqual(await kv.keys('world:resource-node:*'), [], 'no node row was written or claimed');
    for (const file of ['api/_npc-roam.ts', 'api/_npc-presence.ts', 'api/_npc-journeys.ts']) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), /_shared-resource-nodes|SharedResource|sharedResource|withPlayerResourceNodes|resource-pool/, `${file} never touches node claims`);
    }
    for (let i = 0; i < 300 && journeys.npcJourneyOf(npc.id)!.phase === 'dwelling'; i++) journeys.stepNpcJourneys(at += 2_000);
    journeys.stepNpcJourneys(at += 500);
    assert.equal(online.get(npc.name)?.activity, undefined, 'done gathering, it walks on without the pose');
});

test('activity is server-owned: a beat can neither set it nor carry it out of the sector', async () => {
    const { toPlayerRecord } = await import('./_realtime/presence-input.js');
    online.upsert({ name: 'gatherfaker', sector: 58, character: { name: 'gatherfaker', level: 30 }, tile: 5, tileSector: 58, activity: 'mining' } as never);
    assert.equal(online.get('gatherfaker')!.activity, undefined, 'a client cannot claim to be gathering');
    assert.equal('activity' in toPlayerRecord(online.get('gatherfaker')!), false);
    online.setActivity('gatherfaker', 'bogus' as never);
    assert.equal(online.get('gatherfaker')!.activity, undefined, 'only the three gathering kinds');
    online.setActivity('gatherfaker', 'fishing');
    online.upsert({ name: 'gatherfaker', sector: 58, character: null, tile: 6, tileSector: 58 });
    assert.equal(online.get('gatherfaker')!.activity, 'fishing', 'an ordinary beat keeps the server value');
    online.startTravel('gatherfaker', 59, online.clockNow() + 60_000, 58);
    assert.equal(online.get('gatherfaker')!.activity, undefined, 'travelling ends it');
    for (const file of ['api/player/heartbeat.ts', 'api/_realtime/socket.ts']) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), /\bactivity\b/, `${file} never forwards a client activity`);
    }
    online.remove('gatherfaker');
});

test('an NPC taken over mid-gather stops showing the gathering pose while the admin walks it', async (t) => {
    const { npcPossessKey } = await import('./_npc-possession.js');
    const npc = roster.NPC_VILLAGE_ROSTER[3]!;
    const now = Date.now();
    online.upsert({ name: npc.name, sector: 70, character: { name: npc.name, village: CH }, tile: 60, tileSector: 70 });
    online.setActivity(npc.name, 'mining'); // it was gathering
    await kv.set(npcPossessKey(npc.id), { by: 'admin', at: now, expiresAt: now + 60_000 });
    t.after(async () => { await kv.del(npcPossessKey(npc.id)); online.remove(npc.name); });
    await presence.refreshNpcPresence(now);
    assert.equal(online.get(npc.name)!.activity, undefined, 'possession ends the gathering pose');
    online.upsert({ name: npc.name, sector: 70, character: null, tile: 61, tileSector: 70 });
    assert.equal(online.get(npc.name)!.activity, undefined);
    assert.equal(online.get(npc.name)!.tile, 61, 'the admin\'s walk is left alone');
});

test('the tick derives inBattle from the combat stores, like a player heartbeat', async () => {
    const now = Date.now();
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => !presence.npcOffDuty(n.id, now) && !presence.npcOffDuty(n.id, now + 60_000))!;
    await presence.refreshNpcPresence(now);
    online.setInBattle(npc.name, true); // a flag left from before a restart, with no fight behind it
    await presence.refreshNpcPresence(now + 60_000);
    assert.notEqual(online.get(npc.name, now + 60_000)!.inBattle, true, 'no proof of a fight, so the NPC is free again');
});

test('without session tokens, or with the kill switch, no NPC is shown and the walker stands still', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[2]!;
    placeWalker(npc, 58, walk.nearestWalkableTile(58, 60), Date.now());
    journeys.setNpcJourneyErrand(npc.id, { purpose: 'boss', sector: 40, tile: walk.nearestWalkableTile(40, 78) });
    const secret = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
        assert.equal(await presence.refreshNpcPresence(), 0);
        assert.equal(presence.runNpcWalkerStep(Date.now() + 2_000), null);
    } finally { process.env.SESSION_SECRET = secret; }
    process.env.DISABLE_NPC_VILLAGE = '1';
    try { assert.equal(presence.runNpcWalkerStep(Date.now() + 4_000), null); }
    finally { delete process.env.DISABLE_NPC_VILLAGE; }
    assert.ok(presence.runNpcWalkerStep(Date.now() + 6_000), 'on again, it walks');
});

test('NPCs retain their authored identity and use the sprite walking pace with no enable flags', async (t) => {
    const env = ['ENABLE_SECTOR_MODEL_DISPLAY', 'ENABLE_PLAYER_GAIT_PILOT', 'R2_PUBLIC_BASE'] as const;
    const previous = env.map(key => process.env[key]);
    t.after(() => env.forEach((key, i) => previous[i] === undefined
        ? delete process.env[key] : process.env[key] = previous[i]));
    delete process.env.ENABLE_SECTOR_MODEL_DISPLAY;
    delete process.env.ENABLE_PLAYER_GAIT_PILOT;
    process.env.R2_PUBLIC_BASE = 'https://art.example.invalid';
    const { cinderholdWorldModel } = await import('../shared/cinderhold-world-models.js');
    const { buildNpcSave } = await import('./_npc-village-seed.js');
    const { sectorGaitTilesPerSecond } = await import('../shared/sector-gait-rates.js');
    for (const npc of roster.NPC_VILLAGE_ROSTER) {
        const model = cinderholdWorldModel(npc.id, npc.avatar);
        assert.ok(model, npc.id);
        assert.deepEqual((buildNpcSave(npc, 30).character as { playerModel?: unknown }).playerModel, model);
    }
    const npc = roster.NPC_VILLAGE_ROSTER[0]!;
    const sector = 67, start = walk.nearestWalkableTile(sector, 30), goal = walk.nearestWalkableTile(sector, 78);
    assert.notEqual(start, goal);
    let now = Date.UTC(2026, 10, 11, 9);
    placeWalker(npc, sector, start, now);
    journeys.setNpcJourneyErrand(npc.id, { purpose: 'boss', sector, tile: goal });
    let distance = 0;
    for (let i = 1; i <= 12; i++) {
        now += journeys.NPC_WALK_TICK_MS;
        distance += journeys.stepNpcJourneys(now).tiles;
        assert.ok(distance <= Math.floor(i * journeys.NPC_WALK_TICK_MS / 1000 * sectorGaitTilesPerSecond.walk));
    }
    assert.ok(distance >= 1);
});

