import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as server from '../api/player/_daily-login.ts';
import * as preview from '../shinobij.client/src/lib/daily-login-preview.ts';

/*
 * The Daily Briefing previews the next login claim from
 * shinobij.client/src/lib/daily-login-preview.ts, which re-declares the server's
 * ryo curve and shard schedule (api/player/_daily-login.ts) so the briefing does
 * not pull in server code. This pins the two together. It lives in scripts/
 * because api/** is compiled by tsconfig.server.json, which excludes the client.
 */

describe('daily login preview mirrors the server reward', () => {
    it('the ryo curve matches at every level', () => {
        for (let level = 0; level <= 100; level += 1) {
            assert.equal(preview.dailyLoginRyo(level), server.dailyLoginRyo(level), `L${level}`);
        }
    });

    it('the shard schedule matches', () => {
        assert.equal(preview.STREAK_SHARD_INTERVAL, server.STREAK_SHARD_INTERVAL);
        assert.equal(preview.STREAK_SHARD_REWARD, server.STREAK_SHARD_REWARD);
        assert.deepEqual([...preview.STREAK_EARLY_SHARD_DAYS], [...server.STREAK_EARLY_SHARD_DAYS]);
        assert.equal(preview.STREAK_EARLY_SHARD_REWARD, server.STREAK_EARLY_SHARD_REWARD);
        for (let day = -1; day <= 60; day += 1) {
            assert.equal(preview.loginShardsForClaimDay(day), server.loginShardsForClaimDay(day), `claim day ${day}`);
        }
    });
});
