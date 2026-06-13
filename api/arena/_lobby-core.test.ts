import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    newLobby, codeFromBytes, openSeat, slotOf, chooseOwnedPets, snapshotPet,
    autoArenaRoles, resolveMatch, startBlock, publicView, AI_POOL, CODE_ALPHABET, CODE_LEN,
    type PetSnapshot,
} from './_lobby-core.js';

/*
 * Unit coverage for the co-op arena lobby core. The load-bearing invariants are
 * SERVER AUTHORITY (a client can't seat itself with pets it doesn't own) and
 * DETERMINISM (role assignment + match resolution are a pure function of the
 * sealed roster, so every client agrees). The handler (lobby.ts) only wires
 * kv/auth/lock around these.
 */

const pet = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
    id: 'p1', name: 'Pet', rarity: 'rare', level: 20, hp: 600, attack: 80, defense: 40, speed: 60, element: 'Fire', ...over,
});

test('newLobby seats the host at blue0 and leaves the rest open', () => {
    const lobby = newLobby('ABCD', 'host', 1000);
    assert.equal(lobby.host, 'host');
    assert.equal(lobby.state, 'lobby');
    assert.equal(slotOf(lobby, 'blue', 0).name, 'host');
    assert.equal(lobby.slots.filter((s) => s.name).length, 1);
    assert.equal(lobby.seed, null);
    assert.equal(lobby.match, null);
});

test('codeFromBytes is in-alphabet and the right length', () => {
    const code = codeFromBytes([0, 1, 2, 3, 4, 5]);
    assert.equal(code.length, CODE_LEN);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `${ch} not in alphabet`);
    assert.equal(codeFromBytes([0, 0, 0, 0]), 'AAAA');
});

test('openSeat fills team-up order then opponents, honors preference, and detects full', () => {
    const lobby = newLobby('ABCD', 'host', 1000);
    assert.deepEqual(openSeat(lobby), { team: 'blue', slot: 1 });          // friend joins host's team first
    slotOf(lobby, 'blue', 1).name = 'ally';
    assert.deepEqual(openSeat(lobby), { team: 'red', slot: 0 });
    assert.deepEqual(openSeat(lobby, 'red'), { team: 'red', slot: 0 });    // preference respected
    slotOf(lobby, 'red', 0).name = 'foe1';
    slotOf(lobby, 'red', 1).name = 'foe2';
    assert.equal(openSeat(lobby), null);                                   // full
});

test('chooseOwnedPets rejects wrong count, unowned ids, and double-picking one instance', () => {
    const owned = [pet({ id: 'a' }), pet({ id: 'b' }), pet({ id: 'c' })];
    assert.equal(chooseOwnedPets(owned, ['a']), null);                     // need exactly 2
    assert.equal(chooseOwnedPets(owned, ['a', 'b', 'c']), null);
    assert.equal(chooseOwnedPets(owned, ['a', 'z']), null);                // z not owned
    assert.equal(chooseOwnedPets(owned, ['a', 'a']), null);                // only one 'a' owned
    const ok = chooseOwnedPets(owned, ['a', 'b']);
    assert.ok(ok && ok.length === 2 && ok[0].id === 'a' && ok[1].id === 'b');
    // two distinct instances sharing a template id CAN both be picked
    const dup = [pet({ id: 'x' }), pet({ id: 'x' })];
    assert.ok(chooseOwnedPets(dup, ['x', 'x']));
});

test('chooseOwnedPets snapshots + clamps stats (no client-injected buffs)', () => {
    const owned = [pet({ id: 'a', attack: 999999999, defense: -50, hp: 'lots' as unknown as number }), pet({ id: 'b' })];
    const out = chooseOwnedPets(owned, ['a', 'b'])!;
    assert.equal(out[0].attack, 100000);   // clamped to the cap
    assert.equal(out[0].defense, 0);        // floored
    assert.equal(out[0].hp, 600);           // non-numeric → default
});

test('autoArenaRoles assigns each role once, by stats, deterministically', () => {
    const pets: PetSnapshot[] = [
        { id: 'tank', name: 'T', rarity: 'r', level: 20, hp: 900, attack: 50, defense: 95, speed: 40, element: 'Earth' },
        { id: 'dps', name: 'D', rarity: 'r', level: 20, hp: 600, attack: 130, defense: 30, speed: 120, element: 'Fire' },
        { id: 'healer', name: 'H', rarity: 'r', level: 20, hp: 650, attack: 35, defense: 50, speed: 60, element: 'Water' },
        { id: 'mid', name: 'M', rarity: 'r', level: 20, hp: 700, attack: 80, defense: 55, speed: 70, element: 'Wind' },
    ];
    const roles = autoArenaRoles(pets);
    assert.deepEqual(roles, ['defender', 'assassin', 'sage', 'tracker']);
    assert.deepEqual(autoArenaRoles(pets), roles);                          // deterministic
    assert.deepEqual([...roles].sort(), ['assassin', 'defender', 'sage', 'tracker']); // each exactly once
});

test('resolveMatch seals 4v4 — player pets used, empty seats AI-filled, pairs share a seal', () => {
    const lobby = newLobby('ABCD', 'host', 1000);
    slotOf(lobby, 'blue', 0).pets = [pet({ id: 'h1' }), pet({ id: 'h2' })].map((p) => snapshotPet(p));
    slotOf(lobby, 'blue', 0).ready = true;
    // blue1, red0, red1 left open → AI fill
    const match = resolveMatch(lobby, 42);
    assert.equal(match.seed, 42);
    assert.equal(match.blue.length, 4);
    assert.equal(match.red.length, 4);
    // host's pair occupies blue slots 0-1 (same spawn seal)
    assert.equal(match.blue[0].pet.id, 'h1');
    assert.equal(match.blue[1].pet.id, 'h2');
    // remaining seats drew from the AI pool
    assert.ok(AI_POOL.some((a) => a.id === match.blue[2].pet.id));
    assert.ok(AI_POOL.some((a) => a.id === match.red[0].pet.id));
    // every fighter has a role; the team has all four roles
    assert.deepEqual([...match.blue.map((s) => s.role)].sort(), ['assassin', 'defender', 'sage', 'tracker']);
});

test('resolveMatch is identical for the same sealed lobby (every client agrees)', () => {
    const lobby = newLobby('ABCD', 'host', 1000);
    assert.deepEqual(resolveMatch(lobby, 7), resolveMatch(lobby, 7));
});

test('startBlock gates start correctly', () => {
    const lobby = newLobby('ABCD', 'host', 1000);
    assert.match(startBlock(lobby, 'host')!, /pick your two pets/i);        // host hasn't picked
    assert.equal(startBlock(lobby, 'someone-else'), 'Only the host can start the match.');
    slotOf(lobby, 'blue', 0).ready = true;
    assert.equal(startBlock(lobby, 'host'), null);                          // host ready, rest AI → ok
    slotOf(lobby, 'red', 0).name = 'foe'; slotOf(lobby, 'red', 0).ready = false;
    assert.match(startBlock(lobby, 'host')!, /waiting for all players/i);   // a joiner hasn't picked
    slotOf(lobby, 'red', 0).ready = true;
    assert.equal(startBlock(lobby, 'host'), null);
    lobby.state = 'running';
    assert.equal(startBlock(lobby, 'host'), 'Match already started.');
});

test('publicView hides rosters pre-start, exposes the seal once running', () => {
    const lobby = newLobby('ABCD', 'host', 1000);
    slotOf(lobby, 'blue', 0).pets = [pet({ id: 'h1' }), pet({ id: 'h2' })].map((p) => snapshotPet(p));
    slotOf(lobby, 'blue', 0).ready = true;
    const pre = publicView(lobby, 'host');
    assert.equal(pre.match, null);                                          // no roster leak pre-start
    assert.equal(pre.seats.find((s) => s.team === 'blue' && s.slot === 0)!.petCount, 2);
    assert.deepEqual(pre.you, { team: 'blue', slot: 0 });
    assert.equal(pre.seats.find((s) => s.isYou)!.name, 'host');

    lobby.state = 'running';
    lobby.match = resolveMatch(lobby, 5);
    const live = publicView(lobby, 'host');
    assert.ok(live.match && live.match.seed === 5 && live.match.blue.length === 4);
});
