import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    newLobby, codeFromBytes, openSeat, slotOf, chooseOwnedPetRecords, chooseOwnedPets, snapshotPet,
    autoArenaRoles, resolveMatch, startBlock, publicView, AI_POOL, CODE_ALPHABET, CODE_LEN,
    COOP_WARFRONT_SETUP_VERSION, sealedCoopWarfrontSetup,
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
    const code = codeFromBytes([0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(code.length, CODE_LEN);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `${ch} not in alphabet`);
    assert.equal(codeFromBytes(Array(CODE_LEN).fill(0)), 'AAAAAAAA');
    assert.equal(codeFromBytes(Array(CODE_LEN).fill(255)), '99999999');
    assert.ok(CODE_ALPHABET.length ** CODE_LEN >= 2 ** 40, 'join codes must retain at least 40 bits of search space');
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
    assert.equal(chooseOwnedPetRecords(owned, ['a', 'b'])?.[0], owned[0],
        'the handler can inspect availability before snapshotting strips transient leases');
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

test('autoArenaRoles uses each pet NATIVE role when present (players field their own comp)', () => {
    const s = (role: PetSnapshot['role'], i: number): PetSnapshot =>
        ({ id: 'p' + i, name: 'P', rarity: 'r', level: 20, hp: 700, attack: 80, defense: 50, speed: 60, element: 'Fire', role });
    // An all-assassin-ish party is NOT force-rebalanced — the native roles win.
    assert.deepEqual(autoArenaRoles([s('assassin', 0), s('assassin', 1), s('defender', 2), s('sage', 3)]),
        ['assassin', 'assassin', 'defender', 'sage']);
    // If ANY pet lacks a native role (e.g. a pre-feature save), fall back to the
    // balanced stat-profile so the match still gets a full spread.
    const mixed: PetSnapshot[] = [s('assassin', 0), s('assassin', 1), s('defender', 2),
        { id: 'p3', name: 'P', rarity: 'r', level: 20, hp: 900, attack: 50, defense: 95, speed: 40, element: 'Earth' }];
    assert.deepEqual([...autoArenaRoles(mixed)].sort(), ['assassin', 'defender', 'sage', 'tracker']);
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

test('resolveMatch server-seals the same versioned authored playbook for both sides', () => {
    const match = resolveMatch(newLobby('ABCD', 'host', 1000), 42);
    const expected = {
        version: COOP_WARFRONT_SETUP_VERSION,
        stance: 'balanced',
        doctrine: 'warden-pact',
        buyPolicy: 'balanced',
        deployment: ['top', 'mid', 'bottom', 'flex'],
        buildPackage: 'escort-rite',
        coachOrder: 'trade',
        objectiveTechnique: 'secure',
        counterstrike: 'cross-map',
    };
    assert.deepEqual(sealedCoopWarfrontSetup(), expected);
    assert.deepEqual(match.blueSetup, expected);
    assert.deepEqual(match.redSetup, expected);
    assert.deepEqual(match.blueSetup, match.redSetup);
    assert.notEqual(match.blueSetup, match.redSetup);
    assert.notEqual(match.blueSetup.deployment, match.redSetup.deployment);
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
    assert.deepEqual(pre.you, {
        team: 'blue', slot: 0, petIndexes: [0, 1], lanes: ['top', 'mid'],
    });
    assert.deepEqual(pre.setupPreview, sealedCoopWarfrontSetup(),
        'the pre-lock lane labels must come from the same versioned server setup');
    assert.equal(pre.seats.find((s) => s.isYou)!.name, 'host');

    lobby.state = 'running';
    lobby.match = resolveMatch(lobby, 5);
    const live = publicView(lobby, 'host');
    assert.ok(live.match && live.match.seed === 5 && live.match.blue.length === 4);
    assert.equal(publicView(lobby, 'code-guesser').match, null,
        'an unseated caller must never receive a running seed or roster');
});

test('both co-op clients recover the identical stored authored seal', () => {
    const lobby = newLobby('ABCD', 'host', 1000);
    slotOf(lobby, 'blue', 1).name = 'ally';
    lobby.state = 'running';
    lobby.seed = 77;
    lobby.match = resolveMatch(lobby, 77);

    const hostView = publicView(lobby, 'host');
    const allyView = publicView(lobby, 'ally');
    assert.deepEqual(hostView.match, allyView.match);
    assert.deepEqual(hostView.match?.blueSetup, hostView.match?.redSetup);

    const recovered = structuredClone(lobby);
    assert.deepEqual(publicView(recovered, 'host').match, hostView.match,
        'polling a persisted lobby must preserve the stored playbook exactly');
});

test('lobby start persists only the server-resolved setup source', () => {
    const source = readFileSync(join(process.cwd(), 'api', 'arena', 'lobby.ts'), 'utf8');
    const resolve = source.indexOf('lobby.match = resolveMatch(lobby, seed)');
    const persist = source.indexOf('await persistLobby(key, lobby, now)', resolve);
    const respond = source.indexOf('publicView(lobby, me)', persist);
    assert.ok(resolve >= 0 && persist > resolve && respond > persist,
        'the same resolved payload must be stored before either client receives it');
    assert.doesNotMatch(source, /body[^\n]*(blueSetup|redSetup)|(blueSetup|redSetup)[^\n]*body/,
        'a co-op client must never supply either side of the authored seal');
});

test('lobby coordination is uncached, fail-closed, bounded, and rate limited', () => {
    const storage = readFileSync(join(process.cwd(), 'api', '_storage.ts'), 'utf8');
    const source = readFileSync(join(process.cwd(), 'api', 'arena', 'lobby.ts'), 'utf8');
    assert.match(storage, /'arena:lobby:'/, 'workers must never reuse a stale lobby snapshot');
    assert.match(source, /withKvLock<LockOut>\(key,[\s\S]*\{ failClosed: true \}\)/,
        'every lobby mutation must abort under lock contention');
    assert.match(source, /OPEN_LOBBY_LIFETIME_MS[\s\S]*ABSOLUTE_LOBBY_LIFETIME_MS[\s\S]*lobbyExpiresAt/,
        'writes must preserve an absolute lifecycle instead of refreshing forever');
    assert.match(source, /arena-lobby-create[\s\S]*arena-lobby-poll[\s\S]*arena-lobby-join/,
        'enumeration and mutation surfaces need separate durable budgets');
    assert.match(source, /Only match participants may recover a running lobby/);
});
