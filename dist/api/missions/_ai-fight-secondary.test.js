"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _ai_fight_secondary_js_1 = require("./_ai-fight-secondary.js");
const _ai_fight_token_js_1 = require("./_ai-fight-token.js");
const base = {
    profession: 'vanguard', masterySpec: {}, inventory: ['old'], stamina: 90, maxStamina: 100,
    honorSeals: 1, auraDust: 2, boneCharms: 3, fateShards: 4,
    totalAiKills: 5, dailyAiKills: 6, totalVillageRaids: 7,
    defeatedAiIds: [], aiKills: {},
};
(0, node_test_1.describe)('_ai-fight-secondary', () => {
    (0, node_test_1.it)('atomically grants the sealed defense reward and counters', () => {
        const token = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('P', 't', 1, { battleKind: 'defense', opponentId: 'enemy' });
        const next = (0, _ai_fight_secondary_js_1.applyAiFightSecondaryRewards)(base, token, true);
        node_assert_1.strict.deepEqual(next.inventory, ['old', 'territory-control-scroll']);
        node_assert_1.strict.equal(next.stamina, 100);
        node_assert_1.strict.equal(next.honorSeals, 21);
        node_assert_1.strict.equal(next.auraDust, 10);
        node_assert_1.strict.equal(next.boneCharms, 5);
        node_assert_1.strict.equal(next.fateShards, 4);
        node_assert_1.strict.equal(next.totalAiKills, 6);
        node_assert_1.strict.equal(next.dailyAiKills, 7);
        node_assert_1.strict.deepEqual(next.defeatedAiIds, ['enemy']);
        node_assert_1.strict.deepEqual(next.aiKills, { enemy: 1 });
    });
    (0, node_test_1.it)('grants raid counters and profession-neutral charm substitute', () => {
        const token = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('P', 't', 1, { battleKind: 'raidAi', opponentId: 'enemy' });
        const next = (0, _ai_fight_secondary_js_1.applyAiFightSecondaryRewards)({ ...base, profession: 'healer' }, token, true);
        node_assert_1.strict.equal(next.honorSeals, 1);
        node_assert_1.strict.equal(next.auraDust, 6);
        node_assert_1.strict.equal(next.boneCharms, 4);
        node_assert_1.strict.equal(next.totalVillageRaids, 8);
    });
    (0, node_test_1.it)('pays nothing for practice or after the hard ceiling', () => {
        const practice = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('P', 't', 1, { battleKind: 'practice' });
        const mission = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('P', 't', 1, { battleKind: 'mission' });
        node_assert_1.strict.equal((0, _ai_fight_secondary_js_1.applyAiFightSecondaryRewards)(base, practice, true), base);
        node_assert_1.strict.equal((0, _ai_fight_secondary_js_1.applyAiFightSecondaryRewards)(base, mission, false), base);
    });
    (0, node_test_1.it)('only grants the Ironclad roll to a valid capstone owner', () => {
        const token = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('P', 't', 1, { battleKind: 'mission' });
        const next = (0, _ai_fight_secondary_js_1.applyAiFightSecondaryRewards)({ ...base, masterySpec: { ironclad: 1 } }, token, true, true);
        node_assert_1.strict.equal(next.boneCharms, 4);
    });
});
