"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _rift_quest_js_1 = require("./_rift-quest.js");
async function loadClientRifts() {
    // COMPUTED specifier (via a variable) so tsc does not statically pull the
    // client module into the cpanel compile; tsx resolves it at runtime.
    const specifier = '../../shinobij.client/src/data/hollow-rifts.js';
    const mod = (await import(specifier));
    return mod.hollowRifts;
}
async function loadClientTargetSector() {
    const specifier = '../../shinobij.client/src/lib/hollow-rifts.js';
    const mod = (await import(specifier));
    return mod.riftTargetSector;
}
(0, node_test_1.test)('riftQuestRyo follows the wanderer-quest band', () => {
    strict_1.default.equal((0, _rift_quest_js_1.riftQuestRyo)(50, 8), 8 * 170); // weight*(20+lvl*3)
    strict_1.default.equal((0, _rift_quest_js_1.riftQuestRyo)(1, 8), 8 * 23);
    strict_1.default.equal((0, _rift_quest_js_1.riftQuestRyo)(0, 8), 8 * 23); // level floors at 1
});
(0, node_test_1.test)('riftBossKilled needs one foe-kill past the sealed baseline', () => {
    strict_1.default.equal((0, _rift_quest_js_1.riftBossKilled)(10, 11), true);
    strict_1.default.equal((0, _rift_quest_js_1.riftBossKilled)(10, 10), false);
    strict_1.default.equal((0, _rift_quest_js_1.riftBossKilled)(10, 9), false);
});
(0, node_test_1.test)('riftTargetSector is deterministic, wilderness-ranged, and skips villages', () => {
    const villages = new Set([11, 31, 38, 47]);
    for (const player of ['Aki', 'Rill', 'ZZZ', 'a', 'player-two']) {
        const s = (0, _rift_quest_js_1.riftTargetSector)(player, 'rift-hollow-stalker');
        strict_1.default.equal(s, (0, _rift_quest_js_1.riftTargetSector)(player, 'rift-hollow-stalker'), 'stable per call');
        strict_1.default.ok(s >= 1 && s <= 55, `${player}: ${s} in 1..55`);
        strict_1.default.ok(!villages.has(s), `${player}: ${s} not a village outskirts`);
    }
});
(0, node_test_1.test)('the daily cap + cooldown are sane', () => {
    strict_1.default.ok(Number.isInteger(_rift_quest_js_1.RIFT_DAILY_CAP) && _rift_quest_js_1.RIFT_DAILY_CAP > 0 && _rift_quest_js_1.RIFT_DAILY_CAP <= 10);
    strict_1.default.ok(_rift_quest_js_1.RIFT_COOLDOWN_MS > 0 && _rift_quest_js_1.RIFT_COOLDOWN_MS <= 24 * 60 * 60 * 1000);
});
(0, node_test_1.test)('client rifts and the server catalog agree exactly', async () => {
    const rifts = await loadClientRifts();
    strict_1.default.ok(rifts.length >= 1);
    const clientIds = new Set();
    for (const rift of rifts) {
        clientIds.add(rift.id);
        strict_1.default.match(rift.id, /^rift-[a-z-]+$/, rift.id);
        const def = _rift_quest_js_1.RIFT_QUESTS[rift.id];
        strict_1.default.ok(def, `server def missing for ${rift.id}`);
        strict_1.default.equal(def.levelReq, rift.levelReq, rift.id);
        strict_1.default.equal(def.floors, rift.floors, rift.id);
        strict_1.default.equal(def.bossAiId, rift.bossAiId, rift.id);
        strict_1.default.equal(def.bossName, rift.bossName, rift.id);
        strict_1.default.equal(def.weight, rift.reward.weight, rift.id);
        strict_1.default.equal(def.fateShards, rift.reward.fateShards ?? 0, rift.id);
        strict_1.default.equal(def.boneCharms, rift.reward.boneCharms ?? 0, rift.id);
        strict_1.default.ok((0, _rift_quest_js_1.isRiftQuestId)(rift.id));
        strict_1.default.ok(rift.floors >= 1 && rift.floors <= 3, `${rift.id}: 1-3 floors`);
        strict_1.default.match(rift.bossAiId, /^rift-boss-[a-z-]+$/, `${rift.id}: boss id shape`);
    }
    strict_1.default.deepEqual(Object.keys(_rift_quest_js_1.RIFT_QUESTS).sort(), [...clientIds].sort(), 'catalog has extra/missing ids');
});
(0, node_test_1.test)('server and client compute the SAME target sector (seal == display)', async () => {
    const clientTarget = await loadClientTargetSector();
    for (const [player, id] of [['Aki', 'rift-hollow-stalker'], ['Rill', 'rift-hollow-stalker']]) {
        strict_1.default.equal((0, _rift_quest_js_1.riftTargetSector)(player, id), clientTarget(player, id), `${player}/${id}`);
    }
});
(0, node_test_1.test)('rift VN is well-formed: intro has an accept option, descent has a descend option', async () => {
    const rifts = await loadClientRifts();
    for (const rift of rifts) {
        strict_1.default.ok(rift.intro.length >= 1 && rift.descent.length >= 1, `${rift.id}`);
        for (const page of [...rift.intro, ...rift.descent])
            strict_1.default.ok(page.dialogue.length >= 1, `${rift.id} page dialogue`);
        strict_1.default.equal((rift.intro[rift.intro.length - 1].choices ?? []).filter((c) => c.accept).length, 1, `${rift.id}: one accept`);
        strict_1.default.equal((rift.descent[rift.descent.length - 1].choices ?? []).filter((c) => c.descend).length, 1, `${rift.id}: one descend`);
    }
});
