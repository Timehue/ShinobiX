"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _lobby_core_js_1 = require("./_lobby-core.js");
/*
 * Unit coverage for the co-op arena lobby core. The load-bearing invariants are
 * SERVER AUTHORITY (a client can't seat itself with pets it doesn't own) and
 * DETERMINISM (role assignment + match resolution are a pure function of the
 * sealed roster, so every client agrees). The handler (lobby.ts) only wires
 * kv/auth/lock around these.
 */
const pet = (over = {}) => ({
    id: 'p1', name: 'Pet', rarity: 'rare', level: 20, hp: 600, attack: 80, defense: 40, speed: 60, element: 'Fire', ...over,
});
(0, node_test_1.test)('newLobby seats the host at blue0 and leaves the rest open', () => {
    const lobby = (0, _lobby_core_js_1.newLobby)('ABCD', 'host', 1000);
    strict_1.default.equal(lobby.host, 'host');
    strict_1.default.equal(lobby.state, 'lobby');
    strict_1.default.equal((0, _lobby_core_js_1.slotOf)(lobby, 'blue', 0).name, 'host');
    strict_1.default.equal(lobby.slots.filter((s) => s.name).length, 1);
    strict_1.default.equal(lobby.seed, null);
    strict_1.default.equal(lobby.match, null);
});
(0, node_test_1.test)('codeFromBytes is in-alphabet and the right length', () => {
    const code = (0, _lobby_core_js_1.codeFromBytes)([0, 1, 2, 3, 4, 5]);
    strict_1.default.equal(code.length, _lobby_core_js_1.CODE_LEN);
    for (const ch of code)
        strict_1.default.ok(_lobby_core_js_1.CODE_ALPHABET.includes(ch), `${ch} not in alphabet`);
    strict_1.default.equal((0, _lobby_core_js_1.codeFromBytes)([0, 0, 0, 0]), 'AAAA');
});
(0, node_test_1.test)('openSeat fills team-up order then opponents, honors preference, and detects full', () => {
    const lobby = (0, _lobby_core_js_1.newLobby)('ABCD', 'host', 1000);
    strict_1.default.deepEqual((0, _lobby_core_js_1.openSeat)(lobby), { team: 'blue', slot: 1 }); // friend joins host's team first
    (0, _lobby_core_js_1.slotOf)(lobby, 'blue', 1).name = 'ally';
    strict_1.default.deepEqual((0, _lobby_core_js_1.openSeat)(lobby), { team: 'red', slot: 0 });
    strict_1.default.deepEqual((0, _lobby_core_js_1.openSeat)(lobby, 'red'), { team: 'red', slot: 0 }); // preference respected
    (0, _lobby_core_js_1.slotOf)(lobby, 'red', 0).name = 'foe1';
    (0, _lobby_core_js_1.slotOf)(lobby, 'red', 1).name = 'foe2';
    strict_1.default.equal((0, _lobby_core_js_1.openSeat)(lobby), null); // full
});
(0, node_test_1.test)('chooseOwnedPets rejects wrong count, unowned ids, and double-picking one instance', () => {
    const owned = [pet({ id: 'a' }), pet({ id: 'b' }), pet({ id: 'c' })];
    strict_1.default.equal((0, _lobby_core_js_1.chooseOwnedPets)(owned, ['a']), null); // need exactly 2
    strict_1.default.equal((0, _lobby_core_js_1.chooseOwnedPets)(owned, ['a', 'b', 'c']), null);
    strict_1.default.equal((0, _lobby_core_js_1.chooseOwnedPets)(owned, ['a', 'z']), null); // z not owned
    strict_1.default.equal((0, _lobby_core_js_1.chooseOwnedPets)(owned, ['a', 'a']), null); // only one 'a' owned
    const ok = (0, _lobby_core_js_1.chooseOwnedPets)(owned, ['a', 'b']);
    strict_1.default.ok(ok && ok.length === 2 && ok[0].id === 'a' && ok[1].id === 'b');
    // two distinct instances sharing a template id CAN both be picked
    const dup = [pet({ id: 'x' }), pet({ id: 'x' })];
    strict_1.default.ok((0, _lobby_core_js_1.chooseOwnedPets)(dup, ['x', 'x']));
});
(0, node_test_1.test)('chooseOwnedPets snapshots + clamps stats (no client-injected buffs)', () => {
    const owned = [pet({ id: 'a', attack: 999999999, defense: -50, hp: 'lots' }), pet({ id: 'b' })];
    const out = (0, _lobby_core_js_1.chooseOwnedPets)(owned, ['a', 'b']);
    strict_1.default.equal(out[0].attack, 100000); // clamped to the cap
    strict_1.default.equal(out[0].defense, 0); // floored
    strict_1.default.equal(out[0].hp, 600); // non-numeric → default
});
(0, node_test_1.test)('autoArenaRoles assigns each role once, by stats, deterministically', () => {
    const pets = [
        { id: 'tank', name: 'T', rarity: 'r', level: 20, hp: 900, attack: 50, defense: 95, speed: 40, element: 'Earth' },
        { id: 'dps', name: 'D', rarity: 'r', level: 20, hp: 600, attack: 130, defense: 30, speed: 120, element: 'Fire' },
        { id: 'healer', name: 'H', rarity: 'r', level: 20, hp: 650, attack: 35, defense: 50, speed: 60, element: 'Water' },
        { id: 'mid', name: 'M', rarity: 'r', level: 20, hp: 700, attack: 80, defense: 55, speed: 70, element: 'Wind' },
    ];
    const roles = (0, _lobby_core_js_1.autoArenaRoles)(pets);
    strict_1.default.deepEqual(roles, ['defender', 'assassin', 'sage', 'tracker']);
    strict_1.default.deepEqual((0, _lobby_core_js_1.autoArenaRoles)(pets), roles); // deterministic
    strict_1.default.deepEqual([...roles].sort(), ['assassin', 'defender', 'sage', 'tracker']); // each exactly once
});
(0, node_test_1.test)('resolveMatch seals 4v4 — player pets used, empty seats AI-filled, pairs share a seal', () => {
    const lobby = (0, _lobby_core_js_1.newLobby)('ABCD', 'host', 1000);
    (0, _lobby_core_js_1.slotOf)(lobby, 'blue', 0).pets = [pet({ id: 'h1' }), pet({ id: 'h2' })].map((p) => (0, _lobby_core_js_1.snapshotPet)(p));
    (0, _lobby_core_js_1.slotOf)(lobby, 'blue', 0).ready = true;
    // blue1, red0, red1 left open → AI fill
    const match = (0, _lobby_core_js_1.resolveMatch)(lobby, 42);
    strict_1.default.equal(match.seed, 42);
    strict_1.default.equal(match.blue.length, 4);
    strict_1.default.equal(match.red.length, 4);
    // host's pair occupies blue slots 0-1 (same spawn seal)
    strict_1.default.equal(match.blue[0].pet.id, 'h1');
    strict_1.default.equal(match.blue[1].pet.id, 'h2');
    // remaining seats drew from the AI pool
    strict_1.default.ok(_lobby_core_js_1.AI_POOL.some((a) => a.id === match.blue[2].pet.id));
    strict_1.default.ok(_lobby_core_js_1.AI_POOL.some((a) => a.id === match.red[0].pet.id));
    // every fighter has a role; the team has all four roles
    strict_1.default.deepEqual([...match.blue.map((s) => s.role)].sort(), ['assassin', 'defender', 'sage', 'tracker']);
});
(0, node_test_1.test)('resolveMatch is identical for the same sealed lobby (every client agrees)', () => {
    const lobby = (0, _lobby_core_js_1.newLobby)('ABCD', 'host', 1000);
    strict_1.default.deepEqual((0, _lobby_core_js_1.resolveMatch)(lobby, 7), (0, _lobby_core_js_1.resolveMatch)(lobby, 7));
});
(0, node_test_1.test)('startBlock gates start correctly', () => {
    const lobby = (0, _lobby_core_js_1.newLobby)('ABCD', 'host', 1000);
    strict_1.default.match((0, _lobby_core_js_1.startBlock)(lobby, 'host'), /pick your two pets/i); // host hasn't picked
    strict_1.default.equal((0, _lobby_core_js_1.startBlock)(lobby, 'someone-else'), 'Only the host can start the match.');
    (0, _lobby_core_js_1.slotOf)(lobby, 'blue', 0).ready = true;
    strict_1.default.equal((0, _lobby_core_js_1.startBlock)(lobby, 'host'), null); // host ready, rest AI → ok
    (0, _lobby_core_js_1.slotOf)(lobby, 'red', 0).name = 'foe';
    (0, _lobby_core_js_1.slotOf)(lobby, 'red', 0).ready = false;
    strict_1.default.match((0, _lobby_core_js_1.startBlock)(lobby, 'host'), /waiting for all players/i); // a joiner hasn't picked
    (0, _lobby_core_js_1.slotOf)(lobby, 'red', 0).ready = true;
    strict_1.default.equal((0, _lobby_core_js_1.startBlock)(lobby, 'host'), null);
    lobby.state = 'running';
    strict_1.default.equal((0, _lobby_core_js_1.startBlock)(lobby, 'host'), 'Match already started.');
});
(0, node_test_1.test)('publicView hides rosters pre-start, exposes the seal once running', () => {
    const lobby = (0, _lobby_core_js_1.newLobby)('ABCD', 'host', 1000);
    (0, _lobby_core_js_1.slotOf)(lobby, 'blue', 0).pets = [pet({ id: 'h1' }), pet({ id: 'h2' })].map((p) => (0, _lobby_core_js_1.snapshotPet)(p));
    (0, _lobby_core_js_1.slotOf)(lobby, 'blue', 0).ready = true;
    const pre = (0, _lobby_core_js_1.publicView)(lobby, 'host');
    strict_1.default.equal(pre.match, null); // no roster leak pre-start
    strict_1.default.equal(pre.seats.find((s) => s.team === 'blue' && s.slot === 0).petCount, 2);
    strict_1.default.deepEqual(pre.you, { team: 'blue', slot: 0 });
    strict_1.default.equal(pre.seats.find((s) => s.isYou).name, 'host');
    lobby.state = 'running';
    lobby.match = (0, _lobby_core_js_1.resolveMatch)(lobby, 5);
    const live = (0, _lobby_core_js_1.publicView)(lobby, 'host');
    strict_1.default.ok(live.match && live.match.seed === 5 && live.match.blue.length === 4);
});
