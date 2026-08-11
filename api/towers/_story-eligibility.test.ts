import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    STORY_TOWER_MIN_LEVEL,
    storyTowerEligibility,
    storyTowerMemberRequirements,
} from './_story-eligibility.js';

describe('Story Tower entry progression authority', () => {
    it('allows floor 1 for a fresh level-30 character', () => {
        assert.deepEqual(storyTowerEligibility({ level: 30 }, 1), {
            eligible: true,
            replay: false,
        });
    });

    it('allows only the next sequential uncleared floor', () => {
        assert.deepEqual(storyTowerEligibility({ level: 42, battleTowerBestFloor: 2 }, 3), {
            eligible: true,
            replay: false,
        });
        assert.deepEqual(storyTowerEligibility({ level: 42, battleTowerBestFloor: 1 }, 4), {
            eligible: false,
            replay: false,
            requiredFloor: 4,
        });
    });

    it('allows an authoritative cleared-floor replay even above a stale best-floor field', () => {
        assert.deepEqual(storyTowerEligibility({
            level: 42,
            battleTowerBestFloor: 1,
            battleTowerClearedFloors: [5],
        }, 5), {
            eligible: true,
            replay: true,
        });
    });

    it('rejects an under-level character even on floor 1', () => {
        assert.deepEqual(storyTowerEligibility({ level: STORY_TOWER_MIN_LEVEL - 1 }, 1), {
            eligible: false,
            replay: false,
            requiredLevel: STORY_TOWER_MIN_LEVEL,
        });
    });

    it('rejects a party carry when any live ready-room member lacks the floor', () => {
        assert.deepEqual(storyTowerMemberRequirements([
            { member: 'host', character: { level: 50, battleTowerBestFloor: 9 } },
            { member: 'newcomer', character: { level: 35, battleTowerBestFloor: 0 } },
        ], 10), [{ member: 'newcomer', requiredFloor: 10 }]);
    });
});
