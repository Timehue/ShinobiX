import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { aiOpponentEnemyTemplate, type EnemyJutsu } from './_authoritative-pve.js';

/*
 * Step 1 of the generic AI-fight migration (docs/runbooks/combat-mode-migration.md):
 * the server-side enemy template for a generic AI opponent.
 *
 * The contract that matters: a generic AI fight is a REAL, winnable opponent
 * (finite HP, the profile's own stat sheet and jutsu) — NOT the score-attack
 * boss weeklyBossEnemyTemplate builds. These pin that faithful mapping so the
 * later steps (encounter build, client play, session-derived reward) rest on a
 * verified foundation.
 */

const profile = {
    id: 'ai-shadow-weaver',
    name: 'Shadow Weaver',
    level: 55,
    hp: 4200,
    chakra: 900,
    stamina: 800,
    armorRawDR: 0.14,
    isBossAi: false,
    stats: {
        strength: 300, speed: 420, intelligence: 610, willpower: 380,
        genjutsuOffense: 1700, genjutsuDefense: 1200,
        ninjutsuOffense: 900, ninjutsuDefense: 700,
        taijutsuOffense: 200, taijutsuDefense: 150,
        bukijutsuOffense: 180, bukijutsuDefense: 140,
    },
};

describe('aiOpponentEnemyTemplate', () => {
    it('is a WINNABLE opponent: finite authored HP, never the boss score-attack HP', () => {
        const t = aiOpponentEnemyTemplate(profile);
        assert.equal(t.hp, 4200, 'uses the profile\'s explicit finite HP');
        assert.ok(t.hp < 1_000_000, 'a normal AI fight is not a 99M-HP score attack');
    });

    it('derives specialty from the dominant offense axis', () => {
        assert.equal(aiOpponentEnemyTemplate(profile).specialty, 'Genjutsu');
        const taijutsu = aiOpponentEnemyTemplate({ ...profile, stats: { ...profile.stats, genjutsuOffense: 100, taijutsuOffense: 2000 } });
        assert.equal(taijutsu.specialty, 'Taijutsu');
    });

    it('preserves the whole authored stat sheet, not just the main axis', () => {
        const t = aiOpponentEnemyTemplate(profile);
        assert.equal(t.stats.genjutsuOffense, 1700);
        assert.equal(t.stats.speed, 420);
        assert.equal(t.stats.taijutsuDefense, 150, 'off-axis stats survive too');
    });

    it('carries level (for the per-rank cap), armor, and pools from the profile', () => {
        const t = aiOpponentEnemyTemplate(profile);
        assert.equal(t.level, 55);
        assert.ok(Math.abs((t.armorRawDR ?? 0) - 0.14) < 1e-9);
        assert.equal(t.maxChakra, 900);
        assert.equal(t.maxStamina, 800);
        assert.equal(t.boss, false);
    });

    it('uses the caller-resolved authored jutsu when provided', () => {
        const jutsu: EnemyJutsu[] = [{ id: 'shadow-bind', name: 'Shadow Bind', type: 'Genjutsu', ap: 60, effectPower: 40 }];
        const t = aiOpponentEnemyTemplate(profile, jutsu);
        assert.deepEqual(t.jutsu, jutsu, 'the real loadout is used verbatim');
    });

    it('falls back to a generic signature so the opponent can always act', () => {
        const t = aiOpponentEnemyTemplate(profile, []);
        assert.ok(Array.isArray(t.jutsu) && t.jutsu!.length >= 1, 'never left basic-attacks-only by mistake');
        assert.match(String(t.jutsu![0].id), /signature/);
    });

    it('flags an authored boss AI as a boss', () => {
        assert.equal(aiOpponentEnemyTemplate({ ...profile, isBossAi: true }).boss, true);
    });

    it('clamps hostile / malformed input instead of trusting it', () => {
        const t = aiOpponentEnemyTemplate({
            id: 'x', name: 'z'.repeat(500), level: 9999, hp: -50, armorRawDR: 99,
            stats: { genjutsuOffense: -100, speed: 'NaN' as unknown as number },
        });
        assert.ok(t.level <= 100, 'level clamped to the cap');
        assert.ok(t.hp >= 50, 'negative HP floored to a playable value');
        assert.ok((t.armorRawDR ?? 0) <= 1.5, 'armor clamped');
        assert.ok(t.stats.genjutsuOffense >= 0 && t.stats.speed >= 0, 'stats non-negative');
        assert.ok(t.name.length <= 80, 'name length bounded');
    });

    it('never throws on null/empty input', () => {
        assert.ok(aiOpponentEnemyTemplate(null).hp >= 50);
        assert.ok(aiOpponentEnemyTemplate({}).specialty);
    });
});
