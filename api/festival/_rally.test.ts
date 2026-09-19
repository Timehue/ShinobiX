import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../pet/_catalog.js';
import { beginChampionshipRace, checkpointChampionship, ownedRallyPet, prepareChampionship, rallyDaily, rallyProgress } from './_rally.js';
import { rallyStandings } from '../../shared/sunscar/rally-championship.js';
import { rallyProfile } from '../../shared/sunscar/rally-profiles.js';

const now = Date.UTC(2026, 8, 15, 12);
const character = () => ({ name: 'racer', level: 30, ryo: 1000, pets: [{ ...PET_CATALOG['starter-fire'], id: 'my-fire', templateId: 'starter-fire' }] });
test('only owned, registered, available pets can enter', () => {
    assert.equal(ownedRallyPet(character(), 'my-fire').templateId, 'starter-fire');
    assert.throws(() => ownedRallyPet(character(), 'rare-1'), /own companions/);
    assert.throws(() => ownedRallyPet({ pets: [{ id: 'x', name: 'fake' }] }, 'x'), /registered/);
    const c = character();
    assert.throws(() => ownedRallyPet({ ...c, pets: [{ ...c.pets[0], expedition: { endsAt: now + 1000 } }] }, 'my-fire'), /busy/);
});
test('racing uses saved pet stats and freezes them for the championship', () => {
    const c = character();
    const trainedPet = Object.assign(c.pets[0], { speed: 220, attack: 300, defense: 250, hp: 2000 });
    const expected = rallyProfile({ id: 'starter-fire', name: String(PET_CATALOG['starter-fire'].name) }, trainedPet);
    assert.deepEqual(ownedRallyPet(c, 'my-fire').profile, expected);
    const prepared = prepareChampionship(c, 'racer', 'my-fire', now);
    const run = rallyProgress(prepared).current!;
    trainedPet.speed = 1;
    const begun = beginChampionshipRace(prepared, run.id, now);
    assert.deepEqual(rallyProgress(begun).current!.race!.racers[0].pet.profile, expected);
});
test('daily courses are three unique seeded courses and preparation does not spend entry', () => {
    assert.deepEqual(rallyDaily('racer', now), rallyDaily('racer', now + 5000));
    assert.equal(new Set(rallyDaily('racer', now).tracks).size, 3);
    const prepared = prepareChampionship(character(), 'racer', 'my-fire', now);
    assert.equal(rallyProgress(prepared).lastEntryDay, null);
    const run = rallyProgress(prepared).current!;
    assert.throws(() => beginChampionshipRace(prepared, run.id, now + 86400000), /new festival day/);
    const begun = beginChampionshipRace(prepared, run.id, now);
    assert.equal(rallyProgress(begun).lastEntryDay, '2026-09-15');
    assert.deepEqual(beginChampionshipRace(begun, run.id, now + 1000), begun);
    assert.throws(() => prepareChampionship(begun, 'racer', 'my-fire', now), /Resume/);
});
test('three verified races form one championship and pay exactly once', () => {
    let c = prepareChampionship(character(), 'racer', 'my-fire', now);
    const id = rallyProgress(c).current!.id;
    let clock = now;
    let finalBody: Record<string, unknown> = {};
    for (let index = 0; index < 3; index++) {
        c = beginChampionshipRace(c, id, clock);
        let run = rallyProgress(c).current!;
        assert.equal(run.raceIndex, index);
        while (run.status === 'racing') {
            const fromTick = run.race!.tick;
            finalBody = { runId: id, raceIndex: index, fromTick, toTick: fromTick + 300, actions: [] };
            clock += 5000;
            c = checkpointChampionship(c, finalBody, clock).character;
            run = rallyProgress(c).current!;
        }
        assert.equal(run.results.length, index + 1);
        if (index < 2) assert.equal(c.ryo, 1000);
    }
    const progress = rallyProgress(c);
    assert.equal(progress.current!.status, 'complete');
    assert.equal(rallyStandings(progress.current!.results).length, 4);
    assert.equal(progress.championships, 1);
    assert.equal(c.ryo, 1000 + progress.current!.reward!.ryo);
    assert.equal(checkpointChampionship(c, finalBody, clock).paid, 0);
    assert.deepEqual(checkpointChampionship(c, finalBody, clock).character, c);
    assert.throws(() => prepareChampionship(c, 'racer', 'my-fire', clock), /daily Grand Prix/);
    assert.ok(prepareChampionship(c, 'racer', 'my-fire', clock + 86400000));
});
test('clock acceleration, rewinds, altered stats and client placement are not accepted as authority', () => {
    let c = prepareChampionship(character(), 'racer', 'my-fire', now);
    const id = rallyProgress(c).current!.id;
    c = beginChampionshipRace(c, id, now);
    const body = { runId: id, raceIndex: 0, fromTick: 0, toTick: 600, actions: [], place: 1, ryo: 999999, profile: { speed: 99999 } };
    assert.throws(() => checkpointChampionship(c, body, now), /official clock/);
    const advanced = checkpointChampionship(c, body, now + 10000);
    assert.equal(advanced.paid, 0);
    assert.ok(rallyProgress(advanced.character).current!.race!.racers[0].speed < 30);
    assert.throws(() => checkpointChampionship(advanced.character, { ...body, toTick: 900 }, now + 15000), /checkpoint was saved/);
    assert.equal(checkpointChampionship(advanced.character, body, now + 15000).replay, true);
    const resumed = JSON.parse(JSON.stringify(advanced.character));
    assert.deepEqual(rallyProgress(resumed), rallyProgress(advanced.character));
});
