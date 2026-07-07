import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { COMBAT_MISSIONS } from './missions/_mission-catalog.js';
import { clientTrustedCombatMissionRewardAllowed, weeklyBossClientDamageEnabled } from './_release-flags.js';

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
});
