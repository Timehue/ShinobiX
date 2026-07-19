import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TowerSession } from '../towers/_tower-session.js';
import { STORY_LEVELS, STORY_REWARDS, storyOpponentId } from './_settle.js';
import {
    createStoryCombatBinding,
    settleStoryCombatBinding,
    storyBossEligibility,
    storyBossEnemyTemplate,
    storyCombatRewardFingerprint,
    storySessionSurvivingHp,
    validateCompletedStoryCombatSession,
    STORY_VILLAGE_BIOMES,
    type StoryCombatBinding,
} from './_authoritative-story-combat.js';

const NOW = 1_700_000_000_000;
const VILLAGE = 'Stormveil Village';

function makeCharacter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { name: 'Hero', village: VILLAGE, level: 10, storyProgress: 0, ...overrides };
}

function makeBinding(overrides: Partial<StoryCombatBinding> = {}): StoryCombatBinding {
    return { ...createStoryCombatBinding({ runId: 'story-run-1', playerName: 'hero', village: VILLAGE, progressIndex: 0, now: NOW }), ...overrides };
}

function makeSession(overrides: Partial<TowerSession> = {}): TowerSession {
    return {
        runId: 'story-run-1',
        status: 'done',
        winner: 'squad',
        actors: [
            { side: 'squad', ownerSlug: 'hero', hp: 321 } as unknown as TowerSession['actors'][number],
            { side: 'tower', ownerSlug: null, hp: 0 } as unknown as TowerSession['actors'][number],
        ],
        ...overrides,
    } as TowerSession;
}

function validate(params: {
    binding?: StoryCombatBinding | null;
    session?: TowerSession | null;
    playerName?: string;
    character?: Record<string, unknown>;
    now?: number;
} = {}) {
    return validateCompletedStoryCombatSession({
        binding: params.binding === undefined ? makeBinding() : params.binding,
        session: params.session === undefined ? makeSession() : params.session,
        playerName: params.playerName ?? 'hero',
        character: params.character ?? makeCharacter(),
        now: params.now ?? NOW + 1000,
    });
}

test('a completed winning bound session for the current milestone validates', () => {
    const result = validate();
    assert.equal(result.ok, true);
});

test('hostile paths are rejected with the specific reason', () => {
    assert.deepEqual(validate({ binding: null }), { ok: false, reason: 'invalid-binding' });
    assert.deepEqual(validate({ binding: makeBinding({ version: 2 as unknown as 1 }) }), { ok: false, reason: 'invalid-binding' });
    assert.deepEqual(validate({ playerName: 'impostor' }), { ok: false, reason: 'wrong-player' });
    // Save progressed past the sealed milestone → the old session cannot pay the next chapter.
    assert.deepEqual(validate({ character: makeCharacter({ storyProgress: 1 }) }), { ok: false, reason: 'wrong-milestone' });
    // Village swap between start and settle is also milestone drift.
    assert.deepEqual(validate({ character: makeCharacter({ village: 'Frostfang Village' }) }), { ok: false, reason: 'wrong-milestone' });
    assert.deepEqual(validate({ session: makeSession({ runId: 'other-run' }) }), { ok: false, reason: 'wrong-run' });
    assert.deepEqual(validate({ session: null }), { ok: false, reason: 'wrong-run' });
    assert.deepEqual(validate({ now: NOW + 46 * 60 * 1000 }), { ok: false, reason: 'expired' });
    assert.deepEqual(validate({ binding: makeBinding({ status: 'won', settledAt: NOW }) }), { ok: false, reason: 'already-settled' });
    assert.deepEqual(validate({ session: makeSession({ status: 'active' as TowerSession['status'] }) }), { ok: false, reason: 'not-complete' });
    assert.deepEqual(validate({ session: makeSession({ winner: 'tower' as TowerSession['winner'] }) }), { ok: false, reason: 'not-won' });
    assert.deepEqual(
        validate({ session: makeSession({ actors: [{ side: 'squad', ownerSlug: 'someone-else', hp: 100 } as unknown as TowerSession['actors'][number]] }) }),
        { ok: false, reason: 'not-a-member' },
    );
    assert.deepEqual(validate({ binding: makeBinding({ rewardFingerprint: 'tampered' }) }), { ok: false, reason: 'reward-drift' });
});

test('settling flips the binding once and is idempotent', () => {
    const settled = settleStoryCombatBinding(makeBinding(), NOW + 500);
    assert.equal(settled.status, 'won');
    assert.equal(settled.settledAt, NOW + 500);
    // A second settle (or settling a non-active binding) is a no-op.
    assert.deepEqual(settleStoryCombatBinding(settled, NOW + 900), settled);
    const lost = makeBinding({ status: 'lost' });
    assert.deepEqual(settleStoryCombatBinding(lost, NOW + 900), lost);
});

test('surviving HP comes from the server-recorded squad actor, floored at 0', () => {
    assert.equal(storySessionSurvivingHp(makeSession(), 'hero'), 321);
    assert.equal(storySessionSurvivingHp(makeSession({ actors: [{ side: 'squad', ownerSlug: 'hero', hp: -5 } as unknown as TowerSession['actors'][number]] }), 'hero'), 0);
    assert.equal(storySessionSurvivingHp(makeSession(), 'someone-else'), 0);
});

test('reward fingerprint tracks the milestone reward row and opponent', () => {
    const fp = storyCombatRewardFingerprint(VILLAGE, 0);
    assert.equal(fp, storyCombatRewardFingerprint(VILLAGE, 0));
    assert.notEqual(fp, storyCombatRewardFingerprint(VILLAGE, 1));
    assert.notEqual(fp, storyCombatRewardFingerprint('Frostfang Village', 0));
});

test('eligibility mirrors the settlement gates', () => {
    assert.equal(storyBossEligibility(makeCharacter()).ok, true);
    const done = storyBossEligibility(makeCharacter({ storyProgress: STORY_LEVELS.length }));
    assert.deepEqual(done, { ok: false, status: 409, error: 'Village story is already complete.' });
    const underleveled = storyBossEligibility(makeCharacter({ storyProgress: 1, level: 5 }));
    assert.equal(underleveled.ok, false);
    assert.equal((underleveled as { status: number }).status, 403);
    const noCatalog = storyBossEligibility(makeCharacter({ village: 'Nowhere Village' }));
    assert.deepEqual(noCatalog, { ok: false, status: 409, error: 'Player village has no story catalog.' });
});

test('boss template is milestone-derived, display name is cosmetic only', () => {
    for (let progress = 0; progress < STORY_LEVELS.length; progress++) {
        const template = storyBossEnemyTemplate({ village: VILLAGE, progressIndex: progress });
        assert.equal(template.level, STORY_LEVELS[progress]);
        assert.equal(template.visual, storyOpponentId(VILLAGE, STORY_LEVELS[progress]));
        assert.equal(template.boss, true);
        assert.ok(template.hp >= 250 && template.hp <= 14_000, `hp in range for chapter ${progress}`);
        assert.ok((template.jutsu?.length ?? 0) > 0, 'boss has a moveset');
    }
    const named = storyBossEnemyTemplate({ village: VILLAGE, progressIndex: 0, displayName: '  Captain Reika  ' });
    const anonymous = storyBossEnemyTemplate({ village: VILLAGE, progressIndex: 0 });
    assert.equal(named.name, 'Captain Reika');
    assert.deepEqual({ ...named, name: anonymous.name }, anonymous);
    // Chapter difficulty must be monotonically non-decreasing in HP.
    const hps = Array.from({ length: STORY_LEVELS.length }, (_, i) => storyBossEnemyTemplate({ village: VILLAGE, progressIndex: i }).hp);
    for (let i = 1; i < hps.length; i++) assert.ok(hps[i] >= hps[i - 1], `hp ramp at chapter ${i}`);
});

test('every story village maps to a valid tower biome and reward row', () => {
    for (const village of Object.keys(STORY_VILLAGE_BIOMES)) {
        assert.ok(['forest', 'snow', 'volcano', 'shadow', 'central'].includes(STORY_VILLAGE_BIOMES[village]));
    }
    assert.equal(STORY_REWARDS.length, STORY_LEVELS.length);
});
