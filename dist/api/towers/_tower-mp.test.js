"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _tower_session_js_1 = require("./_tower-session.js");
const _engine_js_1 = require("./_engine.js");
const _tower_mp_js_1 = require("./_tower-mp.js");
const MAP = { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };
function human(id, pos) {
    return {
        id, side: 'squad', name: id, ownerSlug: id, ai: false,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, pos, character: { specialty: 'Taijutsu', stats: {} },
    };
}
function enemy(id, pos) {
    return { ...human(id, pos), side: 'enemy', ownerSlug: null, ai: true };
}
function mk(actors) {
    return (0, _tower_session_js_1.createTowerSession)({ towerId: 't', runId: 'r', floor: 1, seed: 1, partySize: 2, map: MAP, actors, objectiveKind: 'defeat-all', now: 1000 });
}
(0, node_test_1.describe)('Battle Towers co-op AFK auto-pass', () => {
    (0, node_test_1.it)('passes an AFK human after the deadline and advances to the next human', () => {
        const s = mk([human('a', 0), human('b', 8), enemy('e', 63)]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.equal(s.turnQueue[s.activeIndex], 'a', 'human a is up first');
        (0, _tower_mp_js_1.stampTurnClock)(s, 1000);
        // still inside the window → no pass
        node_assert_1.strict.equal((0, _tower_mp_js_1.autoPassAfkHumans)(s, 1000 + _tower_mp_js_1.TURN_AFK_MS - 1), false);
        node_assert_1.strict.equal(s.turnQueue[s.activeIndex], 'a');
        // past the deadline → a is passed, the next human (b) is up
        node_assert_1.strict.equal((0, _tower_mp_js_1.autoPassAfkHumans)(s, 1000 + _tower_mp_js_1.TURN_AFK_MS + 1), true);
        node_assert_1.strict.equal(s.turnQueue[s.activeIndex], 'b', 'advanced to the next human');
        // and b gets a FRESH window (only one absent player passes per call)
        node_assert_1.strict.equal((0, _tower_mp_js_1.autoPassAfkHumans)(s, 1000 + _tower_mp_js_1.TURN_AFK_MS + 1), false);
    });
    (0, node_test_1.it)('no-ops when the active actor is AI or the run is done', () => {
        const aiTurn = mk([enemy('e', 0), human('a', 8)]);
        (0, _engine_js_1.startRound)(aiTurn);
        // turn queue puts the human first (squad before enemy), so force an enemy-active case:
        const onlyEnemyActive = mk([human('a', 0), enemy('e', 1)]);
        (0, _engine_js_1.startRound)(onlyEnemyActive);
        onlyEnemyActive.status = 'done';
        node_assert_1.strict.equal((0, _tower_mp_js_1.autoPassAfkHumans)(onlyEnemyActive, 9_999_999), false);
    });
});
