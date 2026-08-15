import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    anbuInfiltrationEnabled,
    clanBossEnabled,
    clanBossPartiesEnabled,
    playerAiImageGenerationEnabled,
    villageWarMapEnabled,
} from './_release-flags.js';

describe('_release-flags', () => {
    it('keeps player AI image generation admin-only unless explicitly enabled', () => {
        assert.equal(playerAiImageGenerationEnabled({}), false);
        assert.equal(playerAiImageGenerationEnabled({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '0' }), false);
        assert.equal(playerAiImageGenerationEnabled({ ENABLE_PLAYER_AI_IMAGE_GENERATION: '1' }), true);
    });

    it('ships public combat features on and honors only exact kill-switch values', () => {
        for (const enabled of [
            villageWarMapEnabled,
            clanBossEnabled,
            anbuInfiltrationEnabled,
        ]) {
            assert.equal(enabled({}), true);
            assert.equal(enabled({ DISABLE_VILLAGE_WAR: '0', DISABLE_CLAN_BOSS: 'true', DISABLE_ANBU_INFILTRATION: 'yes' }), true);
        }
        assert.equal(villageWarMapEnabled({ DISABLE_VILLAGE_WAR: '1' }), false);
        assert.equal(clanBossEnabled({ DISABLE_CLAN_BOSS: '1' }), false);
        assert.equal(anbuInfiltrationEnabled({ DISABLE_ANBU_INFILTRATION: '1' }), false);
    });

    it('ignores obsolete positive flags and always gives the kill switch priority', () => {
        assert.equal(villageWarMapEnabled({ ENABLE_VILLAGE_WAR: '0' }), true);
        assert.equal(villageWarMapEnabled({ ENABLE_VILLAGE_WAR: '1', DISABLE_VILLAGE_WAR: '1' }), false);
        assert.equal(clanBossEnabled({ ENABLE_CLAN_BOSS: '0' }), true);
        assert.equal(clanBossEnabled({ ENABLE_CLAN_BOSS: '1', DISABLE_CLAN_BOSS: '1' }), false);
    });

    it('makes the party-only switch inherit the core Clan Boss switch', () => {
        assert.equal(clanBossPartiesEnabled({}), true);
        assert.equal(clanBossPartiesEnabled({ DISABLE_CLAN_BOSS_PARTIES: '1' }), false);
        assert.equal(clanBossPartiesEnabled({ DISABLE_CLAN_BOSS: '1' }), false);
        assert.equal(clanBossPartiesEnabled({ DISABLE_CLAN_BOSS: '1', DISABLE_CLAN_BOSS_PARTIES: '0' }), false);
        assert.equal(clanBossPartiesEnabled({ DISABLE_CLAN_BOSS: '0', DISABLE_CLAN_BOSS_PARTIES: 'true' }), true);
    });
});
