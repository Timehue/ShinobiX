import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { stripNonCombatFields } from '../pvp/session.js';

// P0.4 leak guard: Battle Towers progress fields must NOT ride into the
// unauthenticated PvP session GET / SSE spectator feed (stripNonCombatFields is
// what guards that surface). This is the §18-B leak the plan flagged — locked
// here so a future refactor can't silently re-expose them.
describe('Battle Towers data-model leak guard', () => {
    const ALL_BATTLE_TOWER_FIELDS = [
        'battleTowerBestFloor',
        'battleTowerRating',
        'battleTowerClearedFloors',
        'battleTowerClaimedRewards',
        'battleTowerAssistRewardsClaimed',
    ];

    function charWithTowerFields(): Record<string, unknown> {
        return {
            name: 'Tester',
            level: 50,
            stats: { taijutsuOffense: 1000 },
            jutsu: [{ id: 'j1' }],
            battleTowerBestFloor: 15,
            battleTowerRating: 4200,
            battleTowerClearedFloors: [1, 2, 3, 5, 10],
            battleTowerClaimedRewards: ['floor-5', 'floor-10'],
            battleTowerAssistRewardsClaimed: ['run-abc'],
        };
    }

    it('strips every battleTower* field from the session/spectator projection', () => {
        const out = stripNonCombatFields(charWithTowerFields());
        for (const f of ALL_BATTLE_TOWER_FIELDS) {
            assert.ok(!(f in out), `${f} must be stripped from the unauth session feed`);
        }
    });

    it('keeps the combat-relevant fields intact', () => {
        const out = stripNonCombatFields(charWithTowerFields());
        assert.ok('stats' in out, 'stats survive');
        assert.ok('jutsu' in out, 'jutsu survive');
        assert.equal(out.name, 'Tester');
        assert.equal(out.level, 50);
    });
});
