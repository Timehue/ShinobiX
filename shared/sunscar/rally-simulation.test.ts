import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../../api/pet/_catalog.js';
import { rallyProfile } from './rally-profiles.js';
import { RALLY_RIVALS } from './rally-rivals.js';
import { RALLY_TRACKS, rallyPath } from './rally-tracks.js';
import { createRallyRace, rallyResult, replayRallyCheckpoint, restoreRallyRace, stepRally, validateRallyActions } from './rally-simulation.js';
import { RALLY_ATTACK, RALLY_VERSION, type RallyElement, type RallyPet, type RallyState } from './rally-types.js';
import { RALLY_SHOT_PROFILES, rallyShotTarget } from './rally-combat.js';

export function raceFixture(trackId = 'grand-circuit', element: RallyElement = 'Fire') {
    const pet = (id: string): RallyPet => {
        const catalog = PET_CATALOG[id];
        return { id, templateId: id, name: String(catalog.name), element: catalog.element as RallyElement, profile: rallyProfile({ id, name: String(catalog.name) }) };
    };
    return createRallyRace(345, trackId, [
        { id: 'player', pet: { ...pet('starter-fire'), element }, rivalId: null },
        ...RALLY_RIVALS.slice(0, 3).map(r => ({ id: r.id, pet: pet(r.petId), rivalId: r.id })),
    ]);
}
test('every rival uses a real catalog pet and five elements have normalized species profiles', () => {
    for (const rival of RALLY_RIVALS) assert.ok(PET_CATALOG[rival.petId], rival.petId);
    for (const [id, pet] of Object.entries(PET_CATALOG)) {
        const p = rallyProfile({ id, name: String(pet.name) });
        const values = [p.speed, p.acceleration, p.agility, p.endurance, p.stability];
        assert.equal(values.reduce((a, b) => a + b), 300);
        assert.ok(values.every(n => n >= 40 && n <= 85));
    }
});
test('saved stats give small, finite, capped racing bonuses', () => {
    const species = { id: 'starter-fire', name: 'Ember Hound' };
    const base = rallyProfile(species);
    const trained = rallyProfile(species, { speed: 220, attack: 300, defense: 250, hp: 2000 });
    for (const key of ['speed', 'acceleration', 'agility', 'endurance', 'stability'] as const) assert.equal(trained[key] - base[key], 8, key);
    assert.deepEqual(rallyProfile(species, { speed: 1e12, attack: 1e12, defense: 1e12, hp: 1e12 }), trained);
    assert.deepEqual(rallyProfile(species, { speed: NaN, attack: -1, defense: Infinity, hp: '2000' }), base);
    const basicRace = raceFixture(), trainedRace = raceFixture();
    basicRace.racers[0].pet.profile = base; trainedRace.racers[0].pet.profile = trained;
    for (let i = 0; i < 180; i++) { stepRally(basicRace); stepRally(trainedRace); }
    assert.ok(trainedRace.racers[0].distance > basicRace.racers[0].distance);
    assert.ok(trainedRace.racers[0].speed / basicRace.racers[0].speed < 1.025, 'top pace advantage stays below 2.5%');
});

function shotFixture(element: RallyElement = 'Fire') {
    const state = raceFixture('grand-circuit', element);
    state.racers.forEach((racer, i) => { racer.rivalId = null; racer.distance = i === 1 ? 8 : -i * 10; racer.lane = racer.targetLane = 0; racer.speed = 15; });
    state.racers[0].attackCharge = 100;
    return state;
}
test('Burst produces 28% higher pace, costs stamina and releases cleanly', () => {
    const plain = shotFixture(), burst = shotFixture();
    for (let tick = 0; tick < 120; tick++) {
        stepRally(plain);
        stepRally(burst, tick === 0 ? [{ tick, kind: 'burst-on' }] : []);
    }
    assert.ok(Math.abs(burst.racers[0].speed / plain.racers[0].speed - 1.28) < .001);
    assert.ok(burst.racers[0].distance > plain.racers[0].distance + 6);
    const stamina = burst.racers[0].stamina;
    stepRally(burst, [{ tick: burst.tick, kind: 'burst-off' }]);
    assert.equal(burst.racers[0].burst, false);
    assert.ok(burst.racers[0].stamina > stamina);
});
test('every elemental shot consumes a full charge, slows the shooter briefly, and hits once', () => {
    for (const element of ['Fire', 'Lightning', 'Wind', 'Earth', 'Water'] as const) {
        const state = shotFixture(element), plain = structuredClone(state);
        stepRally(state, [{ tick: 0, kind: 'attack' }, { tick: 0, kind: 'attack' }]); stepRally(plain);
        assert.equal(state.racers[0].shotsFired, 1);
        assert.ok(state.racers[0].attackCharge < 1);
        assert.ok(state.racers[0].speed < plain.racers[0].speed * .92);
        assert.equal(state.shots[0].element, element);
        for (let i = 1; i < 36; i++) stepRally(state, [{ tick: i, kind: 'attack' }]);
        assert.equal(state.racers[0].shotsFired, 1);
        assert.equal(state.racers[0].shotsHit, 1);
        assert.ok(state.racers[1].slowTicks > 0);
        assert.equal(state.shots.length, 0);
        for (let i = 36; i < 120; i++) stepRally(state);
        assert.equal(state.racers[0].recoilTicks, 0);
        assert.equal(state.racers[1].slowTicks, 0);
    }
});
test('shots recharge in exactly eight seconds, cannot stack slows, and expire after missing', () => {
    const state = shotFixture();
    state.racers[1].lane = state.racers[1].targetLane = 1;
    stepRally(state, [{ tick: 0, kind: 'attack' }]);
    while (state.tick < RALLY_ATTACK.chargeTicks - 1) stepRally(state);
    assert.ok(state.racers[0].attackCharge < 100);
    assert.equal(state.shots.length, 0);
    assert.equal(state.racers[0].shotsHit, 0);
    stepRally(state); assert.equal(state.racers[0].attackCharge, 100);
    stepRally(state, [{ tick: state.tick, kind: 'attack' }]); assert.equal(state.racers[0].shotsFired, 2);
    const protectedRace = shotFixture(); protectedRace.racers[1].shieldTicks = 90;
    stepRally(protectedRace, [{ tick: 0, kind: 'attack' }]);
    for (let i = 1; i < 30; i++) stepRally(protectedRace);
    assert.equal(protectedRace.racers[1].slowTicks, 0);
});
test('jumping dodges a shot, Earth armor blocks one, and Defense reduces slow duration', () => {
    const jumping = shotFixture(); jumping.racers[1].jump = 2; jumping.racers[1].verticalSpeed = 4;
    const armored = shotFixture(); armored.racers[1].armor = true;
    const sturdy = shotFixture(), soft = shotFixture();
    sturdy.racers[1].pet.profile.stability = 90; soft.racers[1].pet.profile.stability = 40;
    for (const state of [jumping, armored, sturdy, soft]) {
        stepRally(state, [{ tick: 0, kind: 'attack' }]);
        for (let i = 1; i < 25; i++) stepRally(state);
    }
    assert.equal(jumping.racers[0].shotsHit, 0);
    assert.equal(armored.racers[1].slowTicks, 0); assert.equal(armored.racers[1].armor, false);
    assert.ok(sturdy.racers[1].slowTicks < soft.racers[1].slowTicks);
});
test('an in-flight shot survives checkpoint serialization with identical results', () => {
    const direct = shotFixture();
    const midway = replayRallyCheckpoint(direct, 10, [{ tick: 0, kind: 'attack' }]);
    assert.equal(midway.shots.length, 1);
    const replay = replayRallyCheckpoint(JSON.parse(JSON.stringify(midway)), 120, []);
    for (let i = 0; i < 120; i++) stepRally(direct, i === 0 ? [{ tick: 0, kind: 'attack' }] : []);
    assert.deepEqual(replay, direct);
});
test('legacy saved races restore without losing progress or granting a ready shot', () => {
    const old = raceFixture() as unknown as Record<string, any>;
    old.version = 1; old.tick = 300; delete old.shots; delete old.events;
    for (const racer of old.racers) for (const field of ['attackCharge', 'recoilTicks', 'slowTicks', 'shieldTicks', 'shotsFired', 'shotsHit', 'slowSpeed', 'cleanJumps', 'staminaEarned', 'shortcutTimeGained', 'attackTimeGained']) delete racer[field];
    const restored = restoreRallyRace(old as RallyState);
    assert.equal(restored.version, RALLY_VERSION); assert.equal(restored.tick, 300);
    assert.equal(restored.racers[0].attackCharge, 0);
    stepRally(restored);
    assert.ok(Number.isFinite(restored.racers[0].speed));
    assert.equal(old.version, 1, 'restore does not mutate the saved object');
});
test('elemental tradeoffs stay bounded and targeting respects width, range, and nearest rivals', () => {
    for (const profile of Object.values(RALLY_SHOT_PROFILES)) {
        const impact = (1 - profile.slowSpeed) * profile.duration;
        assert.ok(impact >= .179 && impact <= .22);
    }
    const state = shotFixture('Wind');
    state.racers[1].lane = state.racers[1].targetLane = .4;
    assert.equal(rallyShotTarget(state, state.racers[0])?.id, state.racers[1].id);
    state.racers[0].pet.element = 'Lightning';
    assert.equal(rallyShotTarget(state, state.racers[0]), undefined);
    state.racers[1].lane = state.racers[1].targetLane = 0;
    state.racers[2].distance = 5;
    assert.equal(rallyShotTarget(state, state.racers[0])?.id, state.racers[2].id);
    state.racers[1].distance = state.racers[2].distance = 100;
    assert.equal(rallyShotTarget(state, state.racers[0]), undefined);
});
test('shots report hits, blocks, dodges and misses without crediting blocked attacks', () => {
    for (const kind of ['shot-hit', 'shot-blocked', 'shot-dodged', 'shot-missed'] as const) {
        const state = shotFixture();
        if (kind === 'shot-blocked') state.racers[1].armor = true;
        if (kind === 'shot-missed') state.racers[1].distance = 150;
        stepRally(state, [{ tick: 0, kind: 'attack' }]);
        if (kind === 'shot-dodged') state.racers[1].lane = state.racers[1].targetLane = 1;
        for (let i = 1; i < 70; i++) stepRally(state);
        assert.ok(state.events.some(event => event.racerId === 'player' && event.kind === kind), kind);
        assert.equal(state.racers[0].shotsHit, kind === 'shot-hit' ? 1 : 0);
        assert.equal(state.racers[0].attackTimeGained > 0, kind === 'shot-hit');
        assert.ok(state.events.length <= 12);
    }
});
test('clean obstacle jumps earn stamina once; empty jumps and side-lane misses earn none', () => {
    const state = shotFixture(), player = state.racers[0];
    player.distance = 77.9; player.jump = 1.5; player.verticalSpeed = 2; player.stamina = 50;
    stepRally(state);
    assert.equal(player.cleanJumps, 1); assert.equal(player.staminaEarned, 4);
    for (let i = 0; i < 60; i++) stepRally(state, [{ tick: state.tick, kind: 'jump' }]);
    assert.equal(player.cleanJumps, 1); assert.equal(player.staminaEarned, 4);
    const side = shotFixture(); side.racers[0].distance = 77.9; side.racers[0].lane = side.racers[0].targetLane = 1;
    side.racers[0].jump = 1.5; stepRally(side); assert.equal(side.racers[0].cleanJumps, 0);
    const capped = shotFixture(); Object.assign(capped.racers[0], { distance: 77.9, jump: 1.5, verticalSpeed: 2, stamina: 99 });
    stepRally(capped); assert.equal(capped.racers[0].stamina, 100); assert.ok(capped.racers[0].staminaEarned < 1);
});
test('successful shortcuts restore seven stamina and accumulate estimated boost advantage', () => {
    const state = shotFixture(), player = state.racers[0];
    Object.assign(player, { distance: 343.9, lane: 1, targetLane: 1, jump: 1, verticalSpeed: 2, speed: 18, stamina: 40 });
    stepRally(state);
    assert.equal(player.shortcuts, 1); assert.equal(player.staminaEarned, 7);
    const replay = replayRallyCheckpoint(JSON.parse(JSON.stringify(state)), 61, []);
    while (state.tick < 61) stepRally(state);
    assert.deepEqual(replay, state);
    assert.ok(player.shortcutTimeGained > .4 && player.shortcutTimeGained <= .49);
    assert.equal(player.staminaEarned, 7);
});
test('legacy in-flight shots keep their old trajectory and strength on restore', () => {
    const old = shotFixture() as unknown as Record<string, any>;
    old.version = 2;
    old.shots = [{ ownerId: 'player', element: 'Water', distance: 0, lane: 0, remaining: 42, slowTicks: 60 }];
    delete old.events;
    const restored = restoreRallyRace(old as RallyState);
    assert.equal(restored.shots[0].slowSpeed, .78); assert.equal(restored.shots[0].speed, 38);
    assert.equal(restored.shots[0].width, .34); assert.deepEqual(restored.events, []);
    stepRally(restored); assert.ok(Number.isFinite(restored.shots[0].distance));
});
test('each once-per-race technique changes the race in its advertised way', () => {
    for (const element of ['Fire', 'Lightning'] as const) {
        const active = shotFixture(element), plain = shotFixture(element);
        for (let i = 0; i < 120; i++) {
            stepRally(active, i === 0 ? [{ tick: 0, kind: 'technique' }] : []); stepRally(plain);
        }
        assert.ok(active.racers[0].distance > plain.racers[0].distance + 2, element);
    }
    const flash = shotFixture('Lightning'), plain = shotFixture('Lightning');
    stepRally(flash, [{ tick: 0, kind: 'technique' }, { tick: 0, kind: 'left' }]);
    stepRally(plain, [{ tick: 0, kind: 'left' }]);
    assert.ok(Math.abs(flash.racers[0].lane) > Math.abs(plain.racers[0].lane) * 2);
    for (const element of ['Wind', 'Water'] as const) {
        const active = shotFixture(element), normal = shotFixture(element);
        active.racers[0].distance = normal.racers[0].distance = 640;
        for (let i = 0; i < 60; i++) {
            stepRally(active, i === 0 ? [{ tick: 0, kind: 'technique' }] : []); stepRally(normal);
        }
        assert.ok(active.racers[0].distance > normal.racers[0].distance + 1, `${element} ignores deep sand`);
    }
    const wind = shotFixture('Wind'), normalJump = shotFixture('Wind');
    stepRally(wind, [{ tick: 0, kind: 'technique' }, { tick: 0, kind: 'jump' }]);
    stepRally(normalJump, [{ tick: 0, kind: 'jump' }]);
    for (let i = 1; i < 30; i++) { stepRally(wind); stepRally(normalJump); }
    assert.ok(wind.racers[0].jump > normalJump.racers[0].jump + .5);
    const earth = shotFixture('Earth'); earth.racers[0].distance = 77.9;
    stepRally(earth, [{ tick: 0, kind: 'technique' }]);
    assert.equal(earth.racers[0].hits, 0); assert.equal(earth.racers[0].armor, false);
    const water = shotFixture('Water'); water.racers[0].stagger = 30;
    stepRally(water, [{ tick: 0, kind: 'technique' }]);
    assert.equal(water.racers[0].stagger, 28);
});
test('race creation validates course and entrants', () => {
    assert.throws(() => createRallyRace(1, 'missing', []));
    assert.throws(() => createRallyRace(1, 'grand-circuit', []));
    assert.equal(raceFixture().racers.length, 4);
});
test('seeded simulation matches replay checkpoints exactly', () => {
    const direct = raceFixture();
    const actions = [{ tick: 0, kind: 'burst-on' }, { tick: 40, kind: 'left' }, { tick: 290, kind: 'jump' }, { tick: 300, kind: 'technique' }] as const;
    const replay = replayRallyCheckpoint(direct, 600, actions);
    for (let i = 0; i < 600; i++) stepRally(direct, actions.filter(a => a.tick === i));
    assert.deepEqual(direct, replay);
});
test('forged checkpoints, duplicated intents and backwards inputs are rejected', () => {
    for (const input of [[{ tick: -1, kind: 'left' }], [{ tick: 1, kind: 'win' }], [{ tick: 5, kind: 'left' }, { tick: 3, kind: 'jump' }], [{ tick: 0, kind: 'jump' }, { tick: 0, kind: 'jump' }]]) assert.throws(() => validateRallyActions(input, 0, 100));
    assert.throws(() => validateRallyActions([], 0, 601));
    assert.throws(() => validateRallyActions([], 50, 50));
});
test('burst drains and exhausts; repeated technique cannot extend or refill it', () => {
    const state = raceFixture();
    stepRally(state, [{ tick: 0, kind: 'burst-on' }, { tick: 0, kind: 'technique' }]);
    for (let i = 1; i < 239; i++) stepRally(state, [{ tick: i, kind: 'technique' }]);
    assert.equal(state.racers[0].techniqueTicks, 1);
    assert.ok(state.racers[0].stamina < 40);
    for (let i = 239; i < 480; i++) stepRally(state);
    assert.equal(state.racers[0].techniqueTicks, 0);
    assert.equal(state.racers[0].burst, false);
    assert.ok(state.racers.every(r => r.stamina >= 0 && r.stamina <= 100));
});
test('jump spamming cannot create flight and lane transitions interpolate', () => {
    const state = raceFixture();
    stepRally(state, [{ tick: 0, kind: 'left' }, { tick: 0, kind: 'jump' }]);
    assert.ok(state.racers[0].lane < 0 && state.racers[0].lane > -1);
    let highest = 0;
    for (let i = 1; i < 240; i++) {
        stepRally(state, [{ tick: i, kind: 'jump' }]);
        highest = Math.max(highest, state.racers[0].jump);
    }
    assert.ok(highest < 3 && highest > 1);
});
test('all four courses finish with actual ranked race times and active AI', () => {
    let rivalShots = 0;
    for (const track of RALLY_TRACKS) {
        const state = raceFixture(track.id);
        while (!state.finished) stepRally(state);
        const result = rallyResult(state);
        assert.equal(result.placements.length, 4);
        assert.deepEqual(result.placements.map(r => r.points), [10, 7, 5, 3]);
        assert.ok(result.placements.every(r => r.tick > 2500 && r.tick < 8500), track.name);
        assert.ok(state.racers.slice(1).every(r => r.techniqueUsed && r.aiDecision > 50));
        assert.ok(state.racers.slice(1).some(r => r.shortcuts > 0), `${track.id}: ${state.racers.slice(1).map(r => `${r.id} (${r.shotsFired} shots, ${r.hits} hits)`).join(', ')}`);
        rivalShots += state.racers.slice(1).reduce((shots, racer) => shots + racer.shotsFired, 0);
    }
    assert.ok(rivalShots > 0, 'rivals also charge and fire shots using the same rules');
});
test('course paths have continuous seams and no dead-end gaps', () => {
    for (const track of RALLY_TRACKS) {
        assert.equal(track.sections[0].from, 0);
        assert.equal(track.sections.at(-1)!.to, track.length);
        for (let i = 1; i < track.sections.length; i++) {
            const seam = track.sections[i].from;
            assert.equal(track.sections[i - 1].to, seam);
            assert.ok(Math.abs(rallyPath(track, seam - .001).x - rallyPath(track, seam + .001).x) < .01);
        }
        assert.ok(track.obstacles.every(o => o.at > 30 && o.at < track.length - 25));
    }
});
