"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _mission_catalog_js_1 = require("./missions/_mission-catalog.js");
const _release_flags_js_1 = require("./_release-flags.js");
(0, node_test_1.describe)('_release-flags', () => {
    (0, node_test_1.it)('keeps weekly boss client-reported contribution disabled unless explicitly enabled', () => {
        node_assert_1.strict.equal((0, _release_flags_js_1.weeklyBossClientDamageEnabled)({}), false);
        node_assert_1.strict.equal((0, _release_flags_js_1.weeklyBossClientDamageEnabled)({ ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE: '0' }), false);
        node_assert_1.strict.equal((0, _release_flags_js_1.weeklyBossClientDamageEnabled)({ ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE: '1' }), true);
    });
    (0, node_test_1.it)('allows only tutorial-tier client-resolved combat mission rewards by default', () => {
        const byKey = new Map(_mission_catalog_js_1.COMBAT_MISSIONS.map((m) => [m.key, m]));
        node_assert_1.strict.equal((0, _release_flags_js_1.clientTrustedCombatMissionRewardAllowed)(byKey.get('combat-e-drill'), {}), true);
        node_assert_1.strict.equal((0, _release_flags_js_1.clientTrustedCombatMissionRewardAllowed)(byKey.get('combat-d-errand'), {}), true);
        node_assert_1.strict.equal((0, _release_flags_js_1.clientTrustedCombatMissionRewardAllowed)(byKey.get('combat-c-patrol'), {}), false);
        node_assert_1.strict.equal((0, _release_flags_js_1.clientTrustedCombatMissionRewardAllowed)(byKey.get('combat-s-crisis'), {}), false);
    });
    (0, node_test_1.it)('can temporarily allow legacy combat mission rewards with an explicit release flag', () => {
        const sRank = _mission_catalog_js_1.COMBAT_MISSIONS.find((m) => m.key === 'combat-s-crisis');
        node_assert_1.strict.equal((0, _release_flags_js_1.clientTrustedCombatMissionRewardAllowed)(sRank, { ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS: '1' }), true);
    });
    (0, node_test_1.it)('requires a server-combat token for higher-rank mission claims', () => {
        const high = { key: 'combat-s-crisis', min: 70, xp: 700, ryo: 600, territoryScrolls: 1, aiProfileId: 'boss' };
        node_assert_1.strict.equal((0, _release_flags_js_1.combatMissionClaimAuthorityAllowed)(high, null, {}), false);
        node_assert_1.strict.equal((0, _release_flags_js_1.combatMissionClaimAuthorityAllowed)(high, { authority: 'legacy-client' }, {}), false);
        node_assert_1.strict.equal((0, _release_flags_js_1.combatMissionClaimAuthorityAllowed)(high, { authority: 'server-combat', runId: 'mission-1' }, {}), true);
    });
    (0, node_test_1.it)('keeps player AI image generation admin-only unless explicitly enabled', () => {
        node_assert_1.strict.equal((0, _release_flags_js_1.playerAiImageGenerationEnabled)({}), false);
        node_assert_1.strict.equal((0, _release_flags_js_1.playerAiImageGenerationEnabled)({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '0' }), false);
        node_assert_1.strict.equal((0, _release_flags_js_1.playerAiImageGenerationEnabled)({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '1' }), true);
    });
});
