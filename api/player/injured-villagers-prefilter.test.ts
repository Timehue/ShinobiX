import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

// The healer list skips the full save of anyone whose stored vitals are
// "certainly healthy". That is only safe if settlement can never turn such a
// player into an injured one; this checks it against the real settleSaveRecord.

const THRESHOLD = 0.99;

function seeded(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

test('a player the pre-filter skips is never injured after settlement', async () => {
    const { certainlyHealthyVitals } = await import('./injured-villagers.js');
    const { settleSaveRecord } = await import('../_elapsed-state.js');
    const random = seeded(373);
    const now = Date.UTC(2026, 9, 13, 12);
    let skipped = 0;
    for (let i = 0; i < 4000; i++) {
        const maxHp = [1, 50, 100, 101, 240, 999, 12_000][Math.floor(random() * 7)]!;
        const hp = Math.floor(random() * (maxHp * 1.2 + 2)) - 1; // includes over-max and negative
        const record: Record<string, unknown> = {
            _saveAt: now - Math.floor(random() * 6 * 3600_000),
            ...(random() < 0.5 ? { _regenAt: now - Math.floor(random() * 3600_000) } : {}),
            character: {
                name: `p${i}`, village: 'Stormveil Village', level: 10,
                hp, maxHp,
                chakra: 10, maxChakra: 100, stamina: 10, maxStamina: 100,
                ...(random() < 0.2 ? { hospitalized: true, hospitalizedUntil: now + 60_000 } : {}),
                ...(random() < 0.2 ? { auraSphereLevel: 300 } : {}),
            },
        };
        const battleLocked = random() < 0.2;
        if (!certainlyHealthyVitals({ hp, maxHp })) continue;
        skipped++;
        const settled = settleSaveRecord(record, { now, battleLocked }).record as { character: { hp: number; maxHp: number } };
        const ratio = Number(settled.character.hp ?? 0) / Number(settled.character.maxHp ?? 0);
        assert.ok(ratio > THRESHOLD, `skipped player ${i} became injured: ${hp}/${maxHp} -> ${settled.character.hp}/${settled.character.maxHp}`);
    }
    assert.ok(skipped > 500, 'the fuzz must exercise the skip path');
});

test('unusual vitals always take the full read', async () => {
    const { certainlyHealthyVitals } = await import('./injured-villagers.js');
    for (const row of [null, {}, { hp: 99.5, maxHp: 100 }, { hp: 100, maxHp: 100.5 }, { hp: '100', maxHp: 100 }, { hp: 100, maxHp: 0 }, { hp: 99, maxHp: 100 }]) {
        assert.equal(certainlyHealthyVitals(row as Record<string, unknown> | null), false, JSON.stringify(row));
    }
    assert.equal(certainlyHealthyVitals({ hp: 100, maxHp: 100 }), true);
});

test('the handler reads full saves only for players the pre-filter cannot clear', () => {
    const source = readFileSync(join(process.cwd(), 'api', 'player', 'injured-villagers.ts'), 'utf8');
    assert.match(source, /readKvProjection\(kv, playerKeys, \{ hp: \['character', 'hp'\], maxHp: \['character', 'maxHp'\] \}\)/);
    assert.match(source, /kv\.mget\(\.\.\.candidateSlugs\.map\(slug => `save:\$\{slug\}`\)\)/);
});
