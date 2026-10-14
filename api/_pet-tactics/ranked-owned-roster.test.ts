import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankedArenaQueue, type RankedArenaDependencies } from './ranked.js';
import { tacticsPreset } from '../../shared/pet-tactics-roster.js';
import { tacticsRoomKey, type TacticsSession } from './session.js';
import { cinematicView, petSheets } from './engine.js';

function harness() {
    const rows = new Map<string, any>();
    const petIds = ['standard-0', 'rare-24', 'mythic-9', 'starter-fire'];
    const pets = petIds.map((templateId, i) => ({ id: `my-${i}`, templateId, name: `Companion ${i}`, nickname: i === 0 ? 'Foxglove' : undefined, rarity: 'standard' }));
    const builds = petIds.map((id, i) => ({ ...tacticsPreset(id), ownedPetId: pets[i].id }));
    for (const name of ['alice', 'bob', 'carol']) rows.set(`save:${name}`, { character: { name, level: 40, pets: structuredClone(pets), petRankedRating: 1000 } });
    const deps: RankedArenaDependencies = { store: {
        get: async (key: string) => structuredClone(rows.get(key) ?? null),
        set: async (key: string, value: unknown) => { rows.set(key, structuredClone(value)); return 'OK'; },
        del: async (key: string) => Number(rows.delete(key)),
        delIfEqual: async (key: string, value: unknown) => rows.get(key) === value && rows.delete(key),
    } as RankedArenaDependencies['store'], lock: async (_key, fn) => fn(), now: () => 1_900_000_000_000,
        roomId: () => 'aabbccdd', matchToken: () => '50dd9962-a37a-4583-9467-c78df7b11020', seed: () => 123 };
    return { rows, deps, builds };
}
test('matchmaking binds the selected carried instances and their saved names into the sealed battle', async () => {
    const { rows, deps, builds } = harness();
    assert.equal((await rankedArenaQueue('alice', 'join', { builds }, deps)).state, 'queued');
    const result = await rankedArenaQueue('bob', 'join', { builds }, deps);
    const session: TacticsSession = rows.get(tacticsRoomKey(String(result.roomId)));
    assert.deepEqual(session.battle!.teams.a.map(p => p.ownedPetId), builds.map(b => b.ownedPetId));
    assert.equal(session.battle!.teams.b[0].name, 'Foxglove');
});
test('a queued companion sent on expedition cannot be matched from the stale queue snapshot', async () => {
    const { rows, deps, builds } = harness();
    await rankedArenaQueue('alice', 'join', { builds }, deps);
    rows.get('save:alice').character.pets[0].expedition = { endsAt: 1 };
    assert.equal((await rankedArenaQueue('bob', 'join', { builds }, deps)).state, 'queued');
    assert.equal((await rankedArenaQueue('alice', 'poll', {}, deps)).state, 'idle');
});
test('missing or foreign builds never create a loan-pet ranked admission', async () => {
    const { rows, deps, builds } = harness();
    await assert.rejects(() => rankedArenaQueue('alice', 'join', {}, deps), /four distinct/);
    rows.get('save:alice').character.pets = [];
    await assert.rejects(() => rankedArenaQueue('alice', 'join', { builds }, deps), /carrying/);
});

test('ranked seals chosen custom moves and saving a future kit cannot rewrite the queued team', async () => {
    const { rows, deps, builds } = harness();
    const selected = builds.map(build => ({ ...tacticsPreset(build.speciesId, 1), ownedPetId: build.ownedPetId, item: 'focus-lens' as const }));
    await rankedArenaQueue('alice', 'join', { builds: selected }, deps);
    rows.get('save:alice').character.pets[0].rankedBuild = builds[0];
    const result = await rankedArenaQueue('bob', 'join', { builds }, deps);
    const session: TacticsSession = rows.get(tacticsRoomKey(String(result.roomId)));
    const seat = session.names.a === 'alice' ? 'a' : 'b';
    assert.deepEqual(session.battle!.teams[seat][0].moves.map(move => move.id), selected[0].moveIds);
    assert.equal(session.battle!.teams[seat][0].item, 'focus-lens');
});

test('ranked seals saved cosmetics for both sides and ignores client preview metadata', async () => {
    const { rows, deps, builds } = harness();
    rows.get('save:alice').character.pets[0].loadout = { collar: 'collar-prismatic' };
    rows.get('save:alice').character.pets[0].paletteVariantId = 'chromatic';
    rows.get('save:bob').character.pets[0].loadout = { collar: 'collar-crimson' };
    const preview = builds.map(build => ({ ...build, appearance: { collarId: 'collar-azure', paletteVariantId: 'preview' } }));
    await rankedArenaQueue('alice', 'join', { builds: preview }, deps);
    const result = await rankedArenaQueue('bob', 'join', { builds }, deps);
    const session: TacticsSession = rows.get(tacticsRoomKey(String(result.roomId)));
    const battle = session.battle!;
    const alice = session.names.a === 'alice' ? 'a' : 'b';
    const bob = alice === 'a' ? 'b' : 'a';
    const expected = { collarId: 'collar-prismatic', paletteVariantId: 'chromatic' };
    assert.deepEqual(petSheets(battle, alice)[0].appearance, expected);
    assert.deepEqual(cinematicView(battle, alice, 'bob').player[0].appearance, expected);
    assert.deepEqual(cinematicView(battle, bob, 'alice').enemy[0].appearance, expected);
    assert.deepEqual(cinematicView(battle, alice, 'bob').enemy[0].appearance, { collarId: 'collar-crimson' });
    assert.deepEqual(battle.teams[alice][1].appearance, {}, 'an empty appearance is also sealed');
    rows.get('save:alice').character.pets[0].loadout.collar = 'collar-azure';
    const refreshed = structuredClone(battle);
    assert.deepEqual(cinematicView(refreshed, bob, 'alice').enemy[0].appearance, expected, 'reload and later equipment changes retain the match snapshot');
    const sheet = petSheets(refreshed, alice)[0];
    sheet.appearance!.collarId = 'tampered';
    assert.deepEqual(refreshed.teams[alice][0].appearance, expected, 'public projections cannot mutate the sealed cosmetics');
});
