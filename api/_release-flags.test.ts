import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { COMBAT_MISSIONS } from './missions/_mission-catalog.js';
import { clientTrustedCombatMissionRewardAllowed, combatMissionClaimAuthorityAllowed, playerAiImageGenerationEnabled, weeklyBossClientDamageEnabled } from './_release-flags.js';

describe('_release-flags', () => {
    it('keeps weekly boss client-reported contribution disabled unless explicitly enabled', () => {
        assert.equal(weeklyBossClientDamageEnabled({}), false);
        assert.equal(weeklyBossClientDamageEnabled({ ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE: '0' }), false);
        assert.equal(weeklyBossClientDamageEnabled({ ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE: '1' }), true);
    });

    it('allows only tutorial-tier client-resolved combat mission rewards by default', () => {
        const byKey = new Map(COMBAT_MISSIONS.map((m) => [m.key, m]));
        assert.equal(clientTrustedCombatMissionRewardAllowed(byKey.get('combat-e-drill')!, {}), true);
        assert.equal(clientTrustedCombatMissionRewardAllowed(byKey.get('combat-d-errand')!, {}), true);
        assert.equal(clientTrustedCombatMissionRewardAllowed(byKey.get('combat-c-patrol')!, {}), false);
        assert.equal(clientTrustedCombatMissionRewardAllowed(byKey.get('combat-s-crisis')!, {}), false);
    });

    it('can temporarily allow legacy combat mission rewards with an explicit release flag', () => {
        const sRank = COMBAT_MISSIONS.find((m) => m.key === 'combat-s-crisis')!;
        assert.equal(clientTrustedCombatMissionRewardAllowed(sRank, { ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS: '1' }), true);
    });

    it('requires a server-combat token for higher-rank mission claims', () => {
        const high = { key: 'combat-s-crisis', min: 70, xp: 700, ryo: 600, territoryScrolls: 1, aiProfileId: 'boss' };
        assert.equal(combatMissionClaimAuthorityAllowed(high, null, {}), false);
        assert.equal(combatMissionClaimAuthorityAllowed(high, { authority: 'legacy-client' }, {}), false);
        assert.equal(combatMissionClaimAuthorityAllowed(high, { authority: 'server-combat', runId: 'mission-1' }, {}), true);
    });

    it('keeps player AI image generation admin-only unless explicitly enabled', () => {
        assert.equal(playerAiImageGenerationEnabled({}), false);
        assert.equal(playerAiImageGenerationEnabled({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '0' }), false);
        assert.equal(playerAiImageGenerationEnabled({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '1' }), true);
    });
});
