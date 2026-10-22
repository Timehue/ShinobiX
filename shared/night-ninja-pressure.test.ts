import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ordinaryWandererEncounter, type Wanderer } from './wanderer-roster.js';
import { ordinaryPveLevel, rollOrdinaryPveEncounter } from './ordinary-pve-encounter.js';

function road(id: string, archetype: 'nightblade' | 'bandit'): Wanderer {
    return { id, archetype, name: 'Tsukika the Quiet Blade', avatarKey: archetype, verb: 'attack',
        level: 80, greeting: 'The road falls silent.', tellTint: '#aaa', sector: 66, tile: 0 } as Wanderer;
}

test('night ninja preview and authoritative shared descriptor promote a real combat tier, never merely a label', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
        const w = road(`night-${seed}`, 'nightblade');
        const base = rollOrdinaryPveEncounter({ sourceId: w.id, playerLevel: 100, sector: 66, displayName: w.name, archetype: 'assassin', portraitKey: w.avatarKey });
        const actual = ordinaryWandererEncounter(w, 100, 66)!;
        const expected = base.difficulty === 'weaker' ? 'standard' : base.difficulty === 'standard' ? 'dangerous' : 'elite';
        assert.equal(actual.difficulty, expected);
        assert.ok(actual.level >= base.level);
        assert.ok(actual.level <= 98);
        assert.equal(actual.profileId, 'builtin-ai-shadow-weaver');
        assert.equal(actual.displayName, w.name);
        assert.equal(actual.baseXp, base.baseXp);
        assert.equal(actual.baseRyo, base.baseRyo);
        assert.match(actual.id, new RegExp(`-night-${expected}$`));
        assert.deepEqual(ordinaryWandererEncounter(w, 100, 66), actual, 'preview and start deterministic');
        seen.add(base.difficulty);
    }
    assert.equal(seen.size, 4);
});

test('night classification preserves novices, early-region relief and ordinary bandit distribution', () => {
    for (let seed = 0; seed < 100; seed++) for (const [level, sector] of [[17, 14], [100, 3], [25, 14]]) {
        const w = road(`protected-${seed}`, 'nightblade');
        const actual = ordinaryWandererEncounter(w, level, sector)!;
        const base = rollOrdinaryPveEncounter({ sourceId: w.id, playerLevel: level, sector, displayName: w.name, archetype: 'assassin', portraitKey: w.avatarKey });
        assert.deepEqual(actual, base);
        assert.ok(actual.level <= ordinaryPveLevel(level, sector, 'elite', 1));
    }
    for (let seed = 0; seed < 100; seed++) {
        const w = road(`bandit-${seed}`, 'bandit');
        assert.deepEqual(ordinaryWandererEncounter(w, 100, 66), rollOrdinaryPveEncounter({ sourceId: w.id, playerLevel: 100, sector: 66, displayName: w.name }));
    }
});
