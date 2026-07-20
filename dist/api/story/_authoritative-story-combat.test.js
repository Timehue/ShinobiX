"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _settle_js_1 = require("./_settle.js");
const _authoritative_story_combat_js_1 = require("./_authoritative-story-combat.js");
const NOW = 1_700_000_000_000;
const VILLAGE = 'Stormveil Village';
function makeCharacter(overrides = {}) {
    return { name: 'Hero', village: VILLAGE, level: 10, storyProgress: 0, ...overrides };
}
function makeBinding(overrides = {}) {
    return { ...(0, _authoritative_story_combat_js_1.createStoryCombatBinding)({ runId: 'story-run-1', playerName: 'hero', village: VILLAGE, progressIndex: 0, now: NOW }), ...overrides };
}
function makeSession(overrides = {}) {
    return {
        runId: 'story-run-1',
        status: 'done',
        winner: 'squad',
        actors: [
            { side: 'squad', ownerSlug: 'hero', hp: 321 },
            { side: 'tower', ownerSlug: null, hp: 0 },
        ],
        ...overrides,
    };
}
function validate(params = {}) {
    return (0, _authoritative_story_combat_js_1.validateCompletedStoryCombatSession)({
        binding: params.binding === undefined ? makeBinding() : params.binding,
        session: params.session === undefined ? makeSession() : params.session,
        playerName: params.playerName ?? 'hero',
        character: params.character ?? makeCharacter(),
        now: params.now ?? NOW + 1000,
    });
}
(0, node_test_1.test)('a completed winning bound session for the current milestone validates', () => {
    const result = validate();
    strict_1.default.equal(result.ok, true);
});
(0, node_test_1.test)('hostile paths are rejected with the specific reason', () => {
    strict_1.default.deepEqual(validate({ binding: null }), { ok: false, reason: 'invalid-binding' });
    strict_1.default.deepEqual(validate({ binding: makeBinding({ version: 2 }) }), { ok: false, reason: 'invalid-binding' });
    strict_1.default.deepEqual(validate({ playerName: 'impostor' }), { ok: false, reason: 'wrong-player' });
    // Save progressed past the sealed milestone → the old session cannot pay the next chapter.
    strict_1.default.deepEqual(validate({ character: makeCharacter({ storyProgress: 1 }) }), { ok: false, reason: 'wrong-milestone' });
    // Village swap between start and settle is also milestone drift.
    strict_1.default.deepEqual(validate({ character: makeCharacter({ village: 'Frostfang Village' }) }), { ok: false, reason: 'wrong-milestone' });
    strict_1.default.deepEqual(validate({ session: makeSession({ runId: 'other-run' }) }), { ok: false, reason: 'wrong-run' });
    strict_1.default.deepEqual(validate({ session: null }), { ok: false, reason: 'wrong-run' });
    strict_1.default.deepEqual(validate({ now: NOW + 46 * 60 * 1000 }), { ok: false, reason: 'expired' });
    strict_1.default.deepEqual(validate({ binding: makeBinding({ status: 'won', settledAt: NOW }) }), { ok: false, reason: 'already-settled' });
    strict_1.default.deepEqual(validate({ session: makeSession({ status: 'active' }) }), { ok: false, reason: 'not-complete' });
    strict_1.default.deepEqual(validate({ session: makeSession({ winner: 'tower' }) }), { ok: false, reason: 'not-won' });
    strict_1.default.deepEqual(validate({ session: makeSession({ actors: [{ side: 'squad', ownerSlug: 'someone-else', hp: 100 }] }) }), { ok: false, reason: 'not-a-member' });
    strict_1.default.deepEqual(validate({ binding: makeBinding({ rewardFingerprint: 'tampered' }) }), { ok: false, reason: 'reward-drift' });
});
(0, node_test_1.test)('settling flips the binding once and is idempotent', () => {
    const settled = (0, _authoritative_story_combat_js_1.settleStoryCombatBinding)(makeBinding(), NOW + 500);
    strict_1.default.equal(settled.status, 'won');
    strict_1.default.equal(settled.settledAt, NOW + 500);
    // A second settle (or settling a non-active binding) is a no-op.
    strict_1.default.deepEqual((0, _authoritative_story_combat_js_1.settleStoryCombatBinding)(settled, NOW + 900), settled);
    const lost = makeBinding({ status: 'lost' });
    strict_1.default.deepEqual((0, _authoritative_story_combat_js_1.settleStoryCombatBinding)(lost, NOW + 900), lost);
});
(0, node_test_1.test)('surviving HP comes from the server-recorded squad actor, floored at 0', () => {
    strict_1.default.equal((0, _authoritative_story_combat_js_1.storySessionSurvivingHp)(makeSession(), 'hero'), 321);
    strict_1.default.equal((0, _authoritative_story_combat_js_1.storySessionSurvivingHp)(makeSession({ actors: [{ side: 'squad', ownerSlug: 'hero', hp: -5 }] }), 'hero'), 0);
    strict_1.default.equal((0, _authoritative_story_combat_js_1.storySessionSurvivingHp)(makeSession(), 'someone-else'), 0);
});
(0, node_test_1.test)('reward fingerprint tracks the milestone reward row and opponent', () => {
    const fp = (0, _authoritative_story_combat_js_1.storyCombatRewardFingerprint)(VILLAGE, 0);
    strict_1.default.equal(fp, (0, _authoritative_story_combat_js_1.storyCombatRewardFingerprint)(VILLAGE, 0));
    strict_1.default.notEqual(fp, (0, _authoritative_story_combat_js_1.storyCombatRewardFingerprint)(VILLAGE, 1));
    strict_1.default.notEqual(fp, (0, _authoritative_story_combat_js_1.storyCombatRewardFingerprint)('Frostfang Village', 0));
});
(0, node_test_1.test)('eligibility mirrors the settlement gates', () => {
    strict_1.default.equal((0, _authoritative_story_combat_js_1.storyBossEligibility)(makeCharacter()).ok, true);
    const done = (0, _authoritative_story_combat_js_1.storyBossEligibility)(makeCharacter({ storyProgress: _settle_js_1.STORY_LEVELS.length }));
    strict_1.default.deepEqual(done, { ok: false, status: 409, error: 'Village story is already complete.' });
    const underleveled = (0, _authoritative_story_combat_js_1.storyBossEligibility)(makeCharacter({ storyProgress: 1, level: 5 }));
    strict_1.default.equal(underleveled.ok, false);
    strict_1.default.equal(underleveled.status, 403);
    const noCatalog = (0, _authoritative_story_combat_js_1.storyBossEligibility)(makeCharacter({ village: 'Nowhere Village' }));
    strict_1.default.deepEqual(noCatalog, { ok: false, status: 409, error: 'Player village has no story catalog.' });
});
(0, node_test_1.test)('boss template is milestone-derived, display name is cosmetic only', () => {
    for (let progress = 0; progress < _settle_js_1.STORY_LEVELS.length; progress++) {
        const template = (0, _authoritative_story_combat_js_1.storyBossEnemyTemplate)({ village: VILLAGE, progressIndex: progress });
        strict_1.default.equal(template.level, _settle_js_1.STORY_LEVELS[progress]);
        strict_1.default.equal(template.visual, (0, _settle_js_1.storyOpponentId)(VILLAGE, _settle_js_1.STORY_LEVELS[progress]));
        strict_1.default.equal(template.boss, true);
        strict_1.default.ok(template.hp >= 250 && template.hp <= 14_000, `hp in range for chapter ${progress}`);
        strict_1.default.ok((template.jutsu?.length ?? 0) > 0, 'boss has a moveset');
    }
    const named = (0, _authoritative_story_combat_js_1.storyBossEnemyTemplate)({ village: VILLAGE, progressIndex: 0, displayName: '  Captain Reika  ' });
    const anonymous = (0, _authoritative_story_combat_js_1.storyBossEnemyTemplate)({ village: VILLAGE, progressIndex: 0 });
    strict_1.default.equal(named.name, 'Captain Reika');
    strict_1.default.deepEqual({ ...named, name: anonymous.name }, anonymous);
    // Chapter difficulty must be monotonically non-decreasing in HP.
    const hps = Array.from({ length: _settle_js_1.STORY_LEVELS.length }, (_, i) => (0, _authoritative_story_combat_js_1.storyBossEnemyTemplate)({ village: VILLAGE, progressIndex: i }).hp);
    for (let i = 1; i < hps.length; i++)
        strict_1.default.ok(hps[i] >= hps[i - 1], `hp ramp at chapter ${i}`);
});
(0, node_test_1.test)('every story village maps to a valid tower biome and reward row', () => {
    for (const village of Object.keys(_authoritative_story_combat_js_1.STORY_VILLAGE_BIOMES)) {
        strict_1.default.ok(['forest', 'snow', 'volcano', 'shadow', 'central'].includes(_authoritative_story_combat_js_1.STORY_VILLAGE_BIOMES[village]));
    }
    strict_1.default.equal(_settle_js_1.STORY_REWARDS.length, _settle_js_1.STORY_LEVELS.length);
});
