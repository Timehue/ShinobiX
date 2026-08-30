import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNamedItem, debitNamedForge, makeNamedForgeReceipt, resolveNamedForgeReplay, rollNamedForge, shuffled } from './_named.js';
import { NAMED_ITEM_LEVEL_REQ } from '../../shared/item-level-gate.js';
import { NAMED_FORGE_CURRENCY_POINTS, namedForgePointTotal } from '../../shared/named-forge-economy.js';

describe('named forge authority', () => {
    it('debits exactly 1000 points with the canonical shared currency values', () => {
        assert.deepEqual(NAMED_FORGE_CURRENCY_POINTS, {
            boneCharms: 2,
            fateShards: 5,
            auraStones: 15,
            mythicSeals: 75,
        });
        assert.equal(debitNamedForge({ boneCharms: 499 }), null);
        assert.equal(debitNamedForge({ boneCharms: 500 })?.boneCharms, 0);

        const wallet = { boneCharms: 5, auraStones: 67 };
        const mixed = debitNamedForge(wallet)!;
        assert.equal(namedForgePointTotal(wallet) - namedForgePointTotal(mixed), 1000);
        assert.equal(mixed.boneCharms, 0);
        assert.equal(mixed.auraStones, 1, 'the solver preserves the 15-point remainder instead of overcharging');
    });

    it('rejects a wallet that cannot form an exact whole-material payment', () => {
        assert.equal(namedForgePointTotal({ auraStones: 67 }), 1005);
        assert.equal(debitNamedForge({ auraStones: 67 }), null);
        assert.equal(debitNamedForge({ mythicSeals: 14 }), null);
    });
    it('builds combat fields only from the sealed roll', () => {
        const item = buildNamedItem({ kind: 'weapon', ep: 31, range: 4, offenseVal: 170, tags: [{ name: 'Wound', percent: 36 }] }, 'Blade', 'Lore');
        assert.equal(item.weaponEp, 31); assert.equal(item.apCost, 40); assert.equal(item.bonuses.ninjutsuOffense, 170);
        assert.equal(item.levelReq, NAMED_ITEM_LEVEL_REQ, 'named weapons carry the same Level 90 gate as named armor');
    });

    it('recovers the exact forged item from an idempotency receipt', () => {
        const token = 'forgeToken123456';
        const item = { id: 'named-weapon-1234', name: 'Storm Fang' };
        const receipt = makeNamedForgeReceipt(token, item.id);
        assert.equal(receipt, `${token}:${item.id}`);
        assert.deepEqual(resolveNamedForgeReplay([receipt], token, [{ id: 'other' }, item]), { matched: true, item });
        assert.deepEqual(resolveNamedForgeReplay([receipt], 'differentToken12', [item]), { matched: false, item: null });
    });

    it('recognizes legacy token-only receipts without inventing an item', () => {
        const token = 'legacyToken12345';
        assert.deepEqual(resolveNamedForgeReplay([token], token, [{ id: 'named-weapon-unrelated' }]), { matched: true, item: null });
    });

    /*
     * Hand gear grants stats + its special roll, never damage reduction (owner
     * ruling 2026-08-16) — matching the built-in gloves, which carry no
     * armorQuality. The `gloves` equip slot is deliberately absent from BOTH
     * armour-DR sums (client getCharacterArmorRawDR, server ARMOR_SLOTS in
     * api/pvp/_multipliers.ts), so an armorQuality on a gauntlet was a promise
     * nothing kept — the description advertised "7% damage reduction" and the
     * wearer got 0%.
     */
    const armorRoll = (slot: 'hand' | 'body') => ({
        kind: 'armor' as const, slot, armorQuality: 'Legendary' as const,
        offenseVal: 30, defenseVal: 30,
        special: { kind: 'Reflect', bonusKey: 'reflectPercent', value: 1.5 },
    });

    it('a forged GAUNTLET carries no armorQuality and never claims damage reduction', () => {
        const item = buildNamedItem(armorRoll('hand'), '', '') as { armorQuality?: string; description?: string; bonuses: Record<string, number> };
        assert.equal(item.armorQuality, undefined, 'hand gear is not armour — no quality tier');
        assert.ok(!/damage reduction/i.test(String(item.description)), `the description must not promise DR: ${item.description}`);
        assert.equal(item.bonuses.taijutsuOffense, 30, 'it still grants its offense roll');
        assert.equal(item.bonuses.taijutsuDefense, 30, 'and its defense roll');
        assert.equal(item.bonuses.reflectPercent, 1.5, 'and its special roll');
    });

    it('forged BODY armour is unchanged — it keeps its quality and its DR claim', () => {
        const item = buildNamedItem(armorRoll('body'), '', '') as { armorQuality?: string; description?: string };
        assert.equal(item.armorQuality, 'Legendary');
        assert.match(String(item.description), /7% damage reduction/);
    });
});

describe('named forge tag fairness', () => {
    // Regression guard for a real bug: tag order used to come from
    // `[...WEAPON_TAGS].sort(() => randomInt(3) - 1)`. A random comparator does
    // not produce a uniform permutation, so some of the twelve tags surfaced
    // materially more often than others — silently, and dependent on V8's sort.
    it('draws every weapon tag with even probability', () => {
        const counts = new Map<string, number>();
        const DRAWS = 24_000;
        for (let i = 0; i < DRAWS; i += 1) {
            const roll = rollNamedForge('weapon');
            if (roll.kind !== 'weapon') continue;
            for (const tag of roll.tags) counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
        }
        assert.equal(counts.size, 12, 'every tag should be reachable');

        // Each draw yields 1 tag half the time and 2 the other half, so the
        // expected count per tag is DRAWS * 1.5 / 12. A uniform shuffle lands
        // well inside 15%; the old comparator shuffle did not.
        const expected = (DRAWS * 1.5) / 12;
        for (const [name, seen] of counts) {
            const drift = Math.abs(seen - expected) / expected;
            assert.ok(drift < 0.15, `${name} drew ${seen} vs ~${Math.round(expected)} expected (${(drift * 100).toFixed(1)}% off)`);
        }
    });

    it('never reintroduces a comparator-based shuffle', () => {
        // process.cwd(), not import.meta.url: this build root compiles to
        // CommonJS and tsc rejects import.meta outright. npm test runs from the
        // repo root, matching api/_cross-build-parity.test.ts.
        const src = readFileSync(join(process.cwd(), 'api', 'craft', '_named.ts'), 'utf8');
        // Comments are stripped first: the doc comment on shuffled() quotes the
        // very pattern being banned, and matching that would be a false alarm.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        assert.doesNotMatch(code, /\.sort\(\s*\(\s*\)\s*=>/, 'use shuffled() (Fisher-Yates), not sort() with a random comparator');
    });

    it('shuffled() returns a permutation, never drops or duplicates', () => {
        const source = ['a', 'b', 'c', 'd', 'e', 'f'];
        for (let i = 0; i < 200; i += 1) {
            const out = shuffled(source);
            assert.equal(out.length, source.length);
            assert.deepEqual([...out].sort(), [...source].sort());
        }
    });
});
