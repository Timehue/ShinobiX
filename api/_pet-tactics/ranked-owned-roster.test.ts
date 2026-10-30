import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankedArenaQueue, type RankedArenaDependencies } from './ranked.js';
import { tacticsRoomKey, tacticsView, type TacticsSession } from './session.js';

// Owner ruling 2026-10-26: ranked Pet Arena fights with each player's real
// companions on the Coliseum engine. The queue names four carried pets; the
// server seals them from the save at pairing.
function harness() {
    const rows = new Map<string, any>();
    const templates = ['standard-0', 'rare-24', 'mythic-9', 'starter-fire'];
    const pets = templates.map((templateId, i) => ({
        id: `my-${i}`, templateId, name: `Companion ${i}`, nickname: i === 0 ? 'Foxglove' : undefined,
        rarity: 'standard', level: 30 + i, element: 'Fire', role: 'assassin', hp: 800, attack: 120, defense: 90, speed: 100,
        jutsus: [{ name: 'Ember Bite', power: 90, kind: 'damage' }],
    }));
    const petIds = pets.map(pet => pet.id);
    for (const name of ['alice', 'bob', 'carol']) rows.set(`save:${name}`, { character: { name, level: 40, pets: structuredClone(pets), petRankedRating: 1000 } });
    const deps: RankedArenaDependencies = { store: {
        get: async (key: string) => structuredClone(rows.get(key) ?? null),
        set: async (key: string, value: unknown) => { rows.set(key, structuredClone(value)); return 'OK'; },
        del: async (key: string) => Number(rows.delete(key)),
        delIfEqual: async (key: string, value: unknown) => rows.get(key) === value && rows.delete(key),
    } as RankedArenaDependencies['store'], lock: async (_key, fn) => fn(), now: () => 1_900_000_000_000,
        roomId: () => 'aabbccdd', matchToken: () => '50dd9962-a37a-4583-9467-c78df7b11020', seed: () => 123 };
    return { rows, deps, petIds };
}
const seatOf = (session: TacticsSession, name: string) => session.names.a === name ? 'a' as const : 'b' as const;

test('matchmaking seals the chosen carried companions, with their real levels and names', async () => {
    const { rows, deps, petIds } = harness();
    assert.equal((await rankedArenaQueue('alice', 'join', { petIds }, deps)).state, 'queued');
    const result = await rankedArenaQueue('bob', 'join', { petIds }, deps);
    const session: TacticsSession = rows.get(tacticsRoomKey(String(result.roomId)));
    assert.equal(session.engine, 'showdown-v1');
    const bob = seatOf(session, 'bob');
    const team = bob === 'a' ? session.arena!.player : session.arena!.enemy;
    assert.deepEqual(team.map(p => p.id), petIds.map(id => `${bob}:${id}`));
    assert.deepEqual(team.map(p => p.level), [30, 31, 32, 33], 'real levels, not a normalized level-50 sheet');
    assert.equal(team[0].name, 'Foxglove');
    const token = rows.get(`pet:ranked-token:${result.matchToken}`);
    assert.deepEqual(token.aTeam.map((p: { id: string }) => p.id), petIds, 'settlement credits the owner\'s own pet ids');
    assert.equal(token.aTeam[0].level, 30);
});

test('a queued companion sent on expedition cannot be matched from the stale queue snapshot', async () => {
    const { rows, deps, petIds } = harness();
    await rankedArenaQueue('alice', 'join', { petIds }, deps);
    rows.get('save:alice').character.pets[0].expedition = { endsAt: Date.now() + 60_000 };
    assert.equal((await rankedArenaQueue('bob', 'join', { petIds }, deps)).state, 'queued');
    assert.equal((await rankedArenaQueue('alice', 'poll', {}, deps)).state, 'idle');
});

test('a player who keeps polling stays in the queue; only a tab that stopped polling is pruned', async () => {
    const { deps, petIds } = harness();
    let now = 1_900_000_000_000;
    deps.now = () => now;
    assert.equal((await rankedArenaQueue('alice', 'join', { petIds }, deps)).state, 'queued');
    // On an empty server the entry used to be dropped three minutes after the
    // JOIN, and the client then blamed the player's companions.
    for (let minute = 2; minute <= 12; minute += 2) {
        now = 1_900_000_000_000 + minute * 60_000;
        assert.equal((await rankedArenaQueue('alice', 'poll', {}, deps)).state, 'queued', `still searching at minute ${minute}`);
    }
    now += 3 * 60_000 + 1;
    assert.equal((await rankedArenaQueue('alice', 'poll', {}, deps)).state, 'idle', 'three silent minutes is an abandoned tab');
});

test('missing or foreign companions never create a ranked admission', async () => {
    const { rows, deps, petIds } = harness();
    await assert.rejects(() => rankedArenaQueue('alice', 'join', {}, deps), /four different companions/);
    rows.get('save:alice').character.pets = [];
    await assert.rejects(() => rankedArenaQueue('alice', 'join', { petIds }, deps), /carrying/);
});

test('ranked seals saved cosmetics for both sides, and later save edits cannot change the match', async () => {
    const { rows, deps, petIds } = harness();
    rows.get('save:alice').character.pets[0].loadout = { collar: 'collar-prismatic' };
    rows.get('save:alice').character.pets[0].paletteVariantId = 'chromatic';
    rows.get('save:bob').character.pets[0].loadout = { collar: 'collar-crimson' };
    await rankedArenaQueue('alice', 'join', { petIds, appearance: { collarId: 'collar-azure' } }, deps);
    const result = await rankedArenaQueue('bob', 'join', { petIds }, deps);
    const session: TacticsSession = rows.get(tacticsRoomKey(String(result.roomId)));
    const alice = seatOf(session, 'alice'), bob = seatOf(session, 'bob');
    const expected = { collarId: 'collar-prismatic', paletteVariantId: 'chromatic' };
    assert.deepEqual(tacticsView(session, alice, 0).battle.player[0].appearance, expected);
    assert.deepEqual(tacticsView(session, bob, 0).battle.enemy[0].appearance, expected);
    assert.deepEqual(tacticsView(session, alice, 0).battle.enemy[0].appearance, { collarId: 'collar-crimson' });
    assert.deepEqual(tacticsView(session, alice, 0).battle.player[1].appearance, {}, 'an empty appearance is also sealed');
    rows.get('save:alice').character.pets[0].loadout.collar = 'collar-azure';
    const reloaded: TacticsSession = rows.get(tacticsRoomKey(String(result.roomId)));
    assert.deepEqual(tacticsView(reloaded, bob, 0).battle.enemy[0].appearance, expected, 'the match keeps its snapshot');
});
