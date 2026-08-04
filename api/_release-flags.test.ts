import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { playerAiImageGenerationEnabled } from './_release-flags.js';

describe('_release-flags', () => {
    it('keeps player AI image generation admin-only unless explicitly enabled', () => {
        assert.equal(playerAiImageGenerationEnabled({}), false);
        assert.equal(playerAiImageGenerationEnabled({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '0' }), false);
        assert.equal(playerAiImageGenerationEnabled({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '1' }), true);
    });
});
