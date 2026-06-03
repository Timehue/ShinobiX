"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const presence_input_js_1 = require("./presence-input.js");
(0, node_test_1.test)('normalizeSector: floors, clamps to >=0, falls back on garbage', () => {
    strict_1.default.equal((0, presence_input_js_1.normalizeSector)(40), 40);
    strict_1.default.equal((0, presence_input_js_1.normalizeSector)('7'), 7);
    strict_1.default.equal((0, presence_input_js_1.normalizeSector)(3.9), 3);
    strict_1.default.equal((0, presence_input_js_1.normalizeSector)(-5), 0);
    strict_1.default.equal((0, presence_input_js_1.normalizeSector)(undefined), 40);
    strict_1.default.equal((0, presence_input_js_1.normalizeSector)('nope', 12), 12);
});
(0, node_test_1.test)('capTravelingUntil: undefined/0 → undefined', () => {
    strict_1.default.equal((0, presence_input_js_1.capTravelingUntil)(undefined, 1000), undefined);
    strict_1.default.equal((0, presence_input_js_1.capTravelingUntil)(0, 1000), undefined);
});
(0, node_test_1.test)('capTravelingUntil: past value → undefined (not traveling)', () => {
    strict_1.default.equal((0, presence_input_js_1.capTravelingUntil)(500, 1000), undefined);
});
(0, node_test_1.test)('capTravelingUntil: near-future value passes through', () => {
    strict_1.default.equal((0, presence_input_js_1.capTravelingUntil)(1000 + 5_000, 1000), 6_000);
});
(0, node_test_1.test)('capTravelingUntil: caps an exploit far-future value to now+MAX', () => {
    const now = 1_000;
    strict_1.default.equal((0, presence_input_js_1.capTravelingUntil)(now + 999_999_999, now), now + presence_input_js_1.MAX_TRAVEL_WINDOW_MS);
});
(0, node_test_1.test)('slimPresenceCharacter: keeps only display fields, drops fat blobs', () => {
    const slim = (0, presence_input_js_1.slimPresenceCharacter)({
        name: 'Naru', level: 30, village: 'Leaf', specialty: 'Ninjutsu',
        avatarImage: 'data:image/png;base64,AAAA....(huge)', inventory: [1, 2, 3],
        jutsu: [{ a: 1 }], ryo: 99999,
    });
    strict_1.default.ok(slim);
    strict_1.default.equal(slim.name, 'Naru');
    strict_1.default.equal(slim.level, 30);
    strict_1.default.equal(slim.village, 'Leaf');
    strict_1.default.equal('avatarImage' in slim, false);
    strict_1.default.equal('inventory' in slim, false);
    strict_1.default.equal('jutsu' in slim, false);
    strict_1.default.equal('ryo' in slim, false);
});
(0, node_test_1.test)('slimPresenceCharacter: pets are slimmed to public fields', () => {
    const slim = (0, presence_input_js_1.slimPresenceCharacter)({
        name: 'X', pets: [{ id: 'p1', name: 'Kit', level: 5, attack: 10, secretSauce: 'nope' }],
    });
    const pets = slim.pets;
    strict_1.default.equal(pets[0].id, 'p1');
    strict_1.default.equal(pets[0].attack, 10);
    strict_1.default.equal('secretSauce' in pets[0], false);
});
(0, node_test_1.test)('slimPresenceCharacter: non-object → null', () => {
    strict_1.default.equal((0, presence_input_js_1.slimPresenceCharacter)(null), null);
    strict_1.default.equal((0, presence_input_js_1.slimPresenceCharacter)('hi'), null);
    strict_1.default.equal((0, presence_input_js_1.slimPresenceCharacter)(undefined), null);
});
(0, node_test_1.test)('toPlayerRecord: shapes a stored entry, omits avatar blob', () => {
    const p = {
        name: 'naru', displayName: 'Naru', sector: 12,
        character: { level: 30, village: 'Leaf', specialty: 'Taijutsu', avatarImage: 'data:...' },
        lastSeenAt: 5000, connectedAt: 1000, pendingAttacker: null,
        travelingUntil: 9999, inBattle: true,
    };
    const r = (0, presence_input_js_1.toPlayerRecord)(p);
    strict_1.default.equal(r.name, 'Naru'); // display-cased
    strict_1.default.equal(r.sector, 12);
    strict_1.default.equal(r.currentSector, 12);
    strict_1.default.equal(r.level, 30);
    strict_1.default.equal(r.village, 'Leaf');
    strict_1.default.equal(r.specialty, 'Taijutsu');
    strict_1.default.equal(r.lastSeenAt, 5000);
    strict_1.default.equal(r.travelingUntil, 9999);
    strict_1.default.equal(r.inBattle, true);
    strict_1.default.deepEqual(r.character, { avatarImage: '' }); // no blob leak
});
(0, node_test_1.test)('toPlayerRecord: null character → safe defaults', () => {
    const p = {
        name: 'x', displayName: 'X', sector: 0, character: null,
        lastSeenAt: 1, connectedAt: 1, pendingAttacker: null,
    };
    const r = (0, presence_input_js_1.toPlayerRecord)(p);
    strict_1.default.equal(r.level, 1);
    strict_1.default.equal(r.village, '');
    strict_1.default.equal(r.specialty, 'Ninjutsu');
    strict_1.default.equal(r.inBattle, false);
    strict_1.default.equal(r.travelingUntil, 0);
});
