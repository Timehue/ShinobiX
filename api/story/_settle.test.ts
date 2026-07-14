import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAcademySparSettlement, applyStoryBossSettlement, storyOpponentId } from './_settle.js';
import type { AiFightToken } from '../missions/_ai-fight-token.js';
import { sanitizeCharacterSave } from '../save/[name].js';

const token = (opponentId: string): AiFightToken => ({
    playerName: 'tester', tokenId: 'abc', mintedAt: 1, maxXp: 150, maxRyo: 150, opponentId,
});

const character = (overrides: Record<string, unknown> = {}) => ({
    name: 'Tester', village: 'Stormveil Village', level: 50, xp: 0, ryo: 100,
    auraDust: 3, storyProgress: 0, hp: 100, maxHp: 100, stamina: 80,
    maxStamina: 100, chakra: 70, maxChakra: 100, inventory: [],
    ...overrides,
});

test('story settlement requires the exact next opponent and grants the canonical milestone once', () => {
    const c = character();
    const settled = applyStoryBossSettlement(c, token(storyOpponentId('Stormveil Village', 4)), 40);
    assert.equal(settled.ok, true);
    if (!settled.ok) return;
    assert.equal(settled.progress, 1);
    assert.equal(settled.xp, 120);
    assert.equal(settled.ryo, 75);
    assert.equal(settled.character.ryo, 175);
    assert.equal(settled.character.auraDust, 15);
    assert.equal(settled.character.storyProgress, 1);
    assert.equal(settled.character.hp, 65);
});

test('story settlement rejects skipped, mismatched, under-level, and completed milestones', () => {
    assert.equal(applyStoryBossSettlement(character(), token(storyOpponentId('Stormveil Village', 15)), 100).ok, false);
    assert.equal(applyStoryBossSettlement(character({ level: 3 }), token(storyOpponentId('Stormveil Village', 4)), 100).ok, false);
    assert.equal(applyStoryBossSettlement(character({ storyProgress: 9 }), token('anything'), 100).ok, false);
});

test('finale stamps the village title and grants one Hollow Gate Key', () => {
    const c = character({ level: 100, storyProgress: 8, inventory: ['hollow-gate-key'] });
    const settled = applyStoryBossSettlement(c, token(storyOpponentId('Stormveil Village', 100)), 20);
    assert.equal(settled.ok, true);
    if (!settled.ok) return;
    assert.equal(settled.finale, true);
    assert.equal(settled.character.storyProgress, 9);
    assert.equal(settled.character.storyTitle, 'Stormbreaker');
    assert.equal((settled.character.inventory as string[]).filter((id) => id === 'hollow-gate-key').length, 1);
});

test('all four finales grant their canonical title and remain one-shot on replay', () => {
    const villages = new Map([
        ['Stormveil Village', 'Stormbreaker'],
        ['Ashen Leaf Village', 'Root Liberator'],
        ['Frostfang Village', 'Oathbreaker'],
        ['Moonshadow Village', 'Moon Unmasked'],
    ]);
    for (const [village, title] of villages) {
        const fightToken = token(storyOpponentId(village, 100));
        const first = applyStoryBossSettlement(character({ village, level: 100, storyProgress: 8 }), fightToken, 20);
        assert.equal(first.ok, true, `${village}: finale should settle`);
        if (!first.ok) continue;
        assert.equal(first.character.storyTitle, title);
        assert.equal((first.character.inventory as string[]).filter((id) => id === 'hollow-gate-key').length, 1);
        assert.equal(applyStoryBossSettlement(first.character, fightToken, 20).ok, false, `${village}: replay must not pay twice`);
    }
});

test('generic saves cannot skip story progress or forge the redemption ledger', () => {
    const out = sanitizeCharacterSave(
        { character: { ...character(), storyProgress: 9, redeemedStoryBattles: [{ token: 'forged' }] } },
        { character: { ...character(), storyProgress: 2, redeemedStoryBattles: [{ token: 'server', progress: 2 }] } },
    ).character as Record<string, unknown>;
    assert.equal(out.storyProgress, 2);
    assert.deepEqual(out.redeemedStoryBattles, [{ token: 'server', progress: 2 }]);
});

test('Academy spar is a one-step canonical grant bound to its temporary opponent token', () => {
    const c = character({ level: 1, onboardingStep: 'academySpar', maxHp: 100, hp: 100 });
    const settled = applyAcademySparSettlement(c, token(`temp-academy-spar-${Date.now()}`));
    assert.equal(settled.ok, true);
    if (!settled.ok) return;
    assert.equal(settled.xp, 60);
    assert.equal(settled.ryo, 30);
    assert.equal(settled.character.onboardingStep, 'cafeteria');
    assert.equal(settled.character.academySparClaimed, true);
    assert.equal(settled.character.hp, Number(settled.character.maxHp) - 25);
    assert.equal(applyAcademySparSettlement({ ...c, onboardingStep: 'cafeteria' }, token(`temp-academy-spar-${Date.now()}`)).ok, false);
    assert.equal(applyAcademySparSettlement({ ...c, academySparClaimed: true }, token(`temp-academy-spar-${Date.now()}`)).ok, false);
});
