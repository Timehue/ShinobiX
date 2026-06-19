"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const session_js_1 = require("../pvp/session.js");
// P0.4 leak guard: Battle Towers progress fields must NOT ride into the
// unauthenticated PvP session GET / SSE spectator feed (stripNonCombatFields is
// what guards that surface). This is the §18-B leak the plan flagged — locked
// here so a future refactor can't silently re-expose them.
(0, node_test_1.describe)('Battle Towers data-model leak guard', () => {
    const ALL_BATTLE_TOWER_FIELDS = [
        'battleTowerBestFloor',
        'battleTowerRating',
        'battleTowerClearedFloors',
        'battleTowerClaimedRewards',
        'battleTowerAssistRewardsClaimed',
    ];
    function charWithTowerFields() {
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
    (0, node_test_1.it)('strips every battleTower* field from the session/spectator projection', () => {
        const out = (0, session_js_1.stripNonCombatFields)(charWithTowerFields());
        for (const f of ALL_BATTLE_TOWER_FIELDS) {
            node_assert_1.strict.ok(!(f in out), `${f} must be stripped from the unauth session feed`);
        }
    });
    (0, node_test_1.it)('keeps the combat-relevant fields intact', () => {
        const out = (0, session_js_1.stripNonCombatFields)(charWithTowerFields());
        node_assert_1.strict.ok('stats' in out, 'stats survive');
        node_assert_1.strict.ok('jutsu' in out, 'jutsu survive');
        node_assert_1.strict.equal(out.name, 'Tester');
        node_assert_1.strict.equal(out.level, 50);
    });
});
