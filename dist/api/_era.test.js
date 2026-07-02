"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _era_defs_js_1 = require("./_era-defs.js");
const _era_js_1 = require("./_era.js");
const MYTHIC_ERA = _era_defs_js_1.ERA_BY_ID.get('mythic-legacies');
(0, node_test_1.test)('era roster: five numbered eras, 1-4 launch unlocked, 5 gated with a credited trigger', () => {
    strict_1.default.equal(_era_defs_js_1.ERA_DEFS.length, 5);
    strict_1.default.deepEqual(_era_defs_js_1.ERA_DEFS.map((e) => e.number), [1, 2, 3, 4, 5]);
    for (const e of _era_defs_js_1.ERA_DEFS.slice(0, 4))
        strict_1.default.equal(e.initialStatus, 'unlocked');
    strict_1.default.equal(MYTHIC_ERA.initialStatus, 'milestone_active');
    strict_1.default.ok(MYTHIC_ERA.milestones.length >= 3, 'anti-chore rule: milestones span multiple categories');
    strict_1.default.ok(new Set(MYTHIC_ERA.milestones.map((m) => m.metric)).size === MYTHIC_ERA.milestones.length);
    strict_1.default.ok(MYTHIC_ERA.trigger, 'era 5 needs its credited finisher');
});
(0, node_test_1.test)('milestone evaluation: all floors must be met, overrides retune live', () => {
    const done = Object.fromEntries(MYTHIC_ERA.milestones.map((m) => [m.metric, m.required]));
    strict_1.default.equal((0, _era_js_1.eraMilestonesMet)(MYTHIC_ERA, done), true);
    const short = { ...done, missions: MYTHIC_ERA.milestones[0].required - 1 };
    strict_1.default.equal((0, _era_js_1.eraMilestonesMet)(MYTHIC_ERA, short), false);
    // Admin lowers the missions floor → the same counters now pass.
    strict_1.default.equal((0, _era_js_1.eraMilestonesMet)(MYTHIC_ERA, short, { milestoneOverrides: { missions: 10 } }), true);
    // Override of 0 waives a milestone entirely.
    strict_1.default.equal((0, _era_js_1.effectiveRequired)(MYTHIC_ERA, 'missions', { milestoneOverrides: { missions: 0 } }), 0);
});
(0, node_test_1.test)('status override wins over the definition', () => {
    strict_1.default.equal((0, _era_js_1.effectiveStatus)(MYTHIC_ERA), 'milestone_active');
    strict_1.default.equal((0, _era_js_1.effectiveStatus)(MYTHIC_ERA, { status: 'locked' }), 'locked');
    strict_1.default.equal((0, _era_js_1.effectiveStatus)(MYTHIC_ERA, { status: 'unlocked' }), 'unlocked');
});
(0, node_test_1.test)('view builder: progress clamps to required, trigger + credit surface', () => {
    const views = (0, _era_js_1.buildEraViews)({ overrides: { 'mythic-legacies': { milestoneOverrides: { pvpWins: 100 } } } }, { missions: 999_999, pvpWins: 50 }, { 'mythic-legacies': { player: 'Rill', village: 'Moonshadow', ts: 1 } });
    const v = views.find((x) => x.id === 'mythic-legacies');
    const missions = v.milestones.find((m) => m.metric === 'missions');
    strict_1.default.equal(missions.current, missions.required, 'current clamps to required');
    strict_1.default.equal(missions.done, true);
    const pvp = v.milestones.find((m) => m.metric === 'pvpWins');
    strict_1.default.equal(pvp.required, 100, 'override applied to the view');
    strict_1.default.equal(pvp.done, false);
    strict_1.default.equal(v.trigger?.fired, true);
    strict_1.default.equal(v.trigger?.firedBy, 'Rill');
    const era1 = views.find((x) => x.number === 1);
    strict_1.default.equal(era1.status, 'unlocked');
    strict_1.default.equal(era1.milestones.length, 0);
});
