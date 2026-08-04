import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { playerAiImageGenerationEnabled, weeklyBossClientDamageEnabled } from './_release-flags.js';

describe('_release-flags', () => {
    it('keeps weekly boss client-reported contribution disabled unless explicitly enabled', () => {
        assert.equal(weeklyBossClientDamageEnabled({}), false);
        assert.equal(weeklyBossClientDamageEnabled({ ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE: '0' }), false);
        assert.equal(weeklyBossClientDamageEnabled({ ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE: '1' }), true);
    });

    it('keeps player AI image generation admin-only unless explicitly enabled', () => {
        assert.equal(playerAiImageGenerationEnabled({}), false);
        assert.equal(playerAiImageGenerationEnabled({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '0' }), false);
        assert.equal(playerAiImageGenerationEnabled({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '1' }), true);
    });
});
