"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _merc_roam_js_1 = require("./_merc-roam.js");
(0, node_test_1.test)('pickMercTarget snipes the LOWEST-HP enemy but has NO min-health gate', () => {
    const cands = [
        { name: 'full', village: 'D Village', hp: 100, maxHp: 100 }, // full HP — still attackable now
        { name: 'hurt', village: 'D Village', hp: 30, maxHp: 100 }, // lowest fraction — the mark
        { name: 'mid', village: 'D Village', hp: 60, maxHp: 100 },
        { name: 'ally', village: 'A Village', hp: 5, maxHp: 100 }, // wrong village — ignored
        { name: 'dead', village: 'D Village', hp: 0, maxHp: 100 }, // already down — ignored
    ];
    strict_1.default.equal((0, _merc_roam_js_1.pickMercTarget)(cands, 'D Village')?.name, 'hurt');
    strict_1.default.equal(_merc_roam_js_1.MERC_TARGET_COOLDOWN_MS, 15 * 60 * 1000);
});
(0, node_test_1.test)('pickMercTarget attacks a FULL-HP enemy when it is the only one present', () => {
    strict_1.default.equal((0, _merc_roam_js_1.pickMercTarget)([{ name: 'solo', village: 'D Village', hp: 100, maxHp: 100 }], 'D Village')?.name, 'solo');
});
(0, node_test_1.test)('pickMercTarget returns null when no living enemy-village player is present', () => {
    strict_1.default.equal((0, _merc_roam_js_1.pickMercTarget)([{ name: 'ally', village: 'A Village', hp: 10, maxHp: 100 }], 'D Village'), null);
    strict_1.default.equal((0, _merc_roam_js_1.pickMercTarget)([], 'D Village'), null);
});
(0, node_test_1.test)('pickMercTarget breaks ties by name (deterministic)', () => {
    const cands = [
        { name: 'zed', village: 'D Village', hp: 10, maxHp: 100 },
        { name: 'amy', village: 'D Village', hp: 10, maxHp: 100 },
    ];
    strict_1.default.equal((0, _merc_roam_js_1.pickMercTarget)(cands, 'D Village')?.name, 'amy');
});
(0, node_test_1.test)('mercNpcId / parseMercNpcId round-trip the band (village slug + tier)', () => {
    const id = (0, _merc_roam_js_1.mercNpcId)('Stormveil Village', 'oni', 2);
    strict_1.default.equal(id, 'merc-stormveilvillage-oni-2');
    strict_1.default.deepEqual((0, _merc_roam_js_1.parseMercNpcId)(id), { villageSlug: 'stormveilvillage', tierId: 'oni' });
});
(0, node_test_1.test)('parseMercNpcId rejects ids that are not roaming mercs', () => {
    strict_1.default.equal((0, _merc_roam_js_1.parseMercNpcId)('w-12-345-0'), null); // a wanderer id
    strict_1.default.equal((0, _merc_roam_js_1.parseMercNpcId)('merc-foo'), null); // missing parts
    strict_1.default.equal((0, _merc_roam_js_1.parseMercNpcId)(''), null);
});
(0, node_test_1.test)('synthRoamingMercs emits one NPC per remaining merc, with stable per-band ids', () => {
    const bands = [
        { village: 'A Village', tierId: 'ronin', level: 75, count: 3, context: 'sector' },
        { village: 'B Village', tierId: 'oni', level: 95, count: 2, context: 'village' },
    ];
    const mercs = (0, _merc_roam_js_1.synthRoamingMercs)(bands);
    strict_1.default.equal(mercs.length, 5);
    strict_1.default.equal(mercs[0].id, 'merc-avillage-ronin-0');
    strict_1.default.equal(mercs[0].context, 'sector');
    strict_1.default.equal(mercs[3].village, 'B Village');
    strict_1.default.equal(mercs[3].context, 'village');
});
(0, node_test_1.test)('synthRoamingMercs caps how many render in one sector', () => {
    const bands = [{ village: 'A Village', tierId: 'warlord', level: 100, count: 50, context: 'sector' }];
    strict_1.default.equal((0, _merc_roam_js_1.synthRoamingMercs)(bands).length, _merc_roam_js_1.ROAMING_MERC_RENDER_CAP);
});
