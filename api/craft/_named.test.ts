import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNamedItem, debitNamedForge, makeNamedForgeReceipt, NAMED_WEAPON_EP_MAX, NAMED_WEAPON_EP_MIN, resolveNamedForgeReplay, rollNamedForge, shuffled } from './_named.js';
import { NAMED_ITEM_LEVEL_REQ } from '../../shared/item-level-gate.js';
import { NAMED_FORGE_CURRENCY_POINTS, namedForgePointTotal } from '../../shared/named-forge-economy.js';
import { WEAPON_EP_CEILING } from '../combat-core/formulas.js';
import { budgetItemBonuses } from '../_item-budget.js';
import { NAMED_ARMOR_QUALITIES, NAMED_ARMOR_SLOTS, NAMED_ARMOR_SPECIALS, NAMED_ARMOR_STATS, NAMED_GAUNTLET_OFFENSE, NAMED_WEAPON_EP_VALUES, NAMED_WEAPON_OFFENSE, NAMED_WEAPON_RANGES, NAMED_WEAPON_TAG_APPEARANCE_PERCENT, NAMED_WEAPON_TAG_STRENGTH, NAMED_WEAPON_WOUND_STRENGTH, namedWeaponTagStrength } from '../../shared/named-forge-roll.js';

describe('named forge authority', () => {
    it('debits exactly 200 Fate Shards and preserves all other currencies', () => {
        assert.deepEqual(NAMED_FORGE_CURRENCY_POINTS, { fateShards: 5 });
        const wallet = { fateShards: 206, boneCharms: 32, auraStones: 17, mythicSeals: 1000 };
        const paid = debitNamedForge(wallet)!;
        assert.deepEqual(paid, { ...wallet, fateShards: 6 });
        assert.deepEqual(wallet, { fateShards: 206, boneCharms: 32, auraStones: 17, mythicSeals: 1000 });
        assert.equal(namedForgePointTotal(wallet) - namedForgePointTotal(paid), 1000);
    });

    it('never substitutes other materials for missing Fate Shards', () => {
        for (const wallet of [{ boneCharms: 5000 }, { auraStones: 5000 }, { mythicSeals: 5000 }, { fateShards: 199, boneCharms: 5000, auraStones: 5000, mythicSeals: 5000 }]) {
            assert.equal(debitNamedForge(wallet), null);
            assert.equal(namedForgePointTotal(wallet), (wallet.fateShards ?? 0) * 5);
        }
        assert.deepEqual(debitNamedForge({ fateShards: 200 }), { fateShards: 0 });
        for (const fateShards of [NaN, Infinity, -1, 'bad', 199.99]) assert.equal(debitNamedForge({ fateShards }), null);
    });
    it('builds combat fields only from the sealed roll', () => {
        const item = buildNamedItem({ kind: 'weapon', ep: 31, range: 4, offenseVal: 170, tags: [{ name: 'Wound', percent: 36 }] }, 'Blade', 'Lore');
        assert.equal(item.weaponEp, 31); assert.equal(item.apCost, 40); assert.equal(item.bonuses.ninjutsuOffense, 170);
        assert.equal(item.levelReq, NAMED_ITEM_LEVEL_REQ, 'named weapons carry the same Level 90 gate as named armor');
    });

    it('describes Heal/Shield/Drain by the flat amount the blade grants, not the rolled percent', () => {
        const solo = buildNamedItem({ kind: 'weapon', ep: 25, range: 4, offenseVal: 170, tags: [{ name: 'Shield', percent: 37 }] }, 'Ward', '');
        assert.match(solo.description, /Shield 450\b/);
        const dual = buildNamedItem({ kind: 'weapon', ep: 25, range: 4, offenseVal: 170, tags: [{ name: 'Drain', percent: 18 }, { name: 'Wound', percent: 17 }] }, 'Leech', '');
        assert.match(dual.description, /Drain 75 HP \+ chakra per turn, Wound 17% of damage dealt/);
    });

    it('describes each percent tag exactly as rolled (owner ruling 2026-10-16)', () => {
        const text = (name: string, percent: number) =>
            buildNamedItem({ kind: 'weapon', ep: 25, range: 4, offenseVal: 170, tags: [{ name, percent }] }, 'Blade', '').description;
        assert.match(text('Wound', 30), /Tags: Wound 30% of damage dealt\./);
        assert.match(text('Increase Damage Given', 40), /Tags: Increase Damage Given 40%\./);
        assert.match(text('Increase Generals', 38), /Tags: Increase Generals 38%\./);
        assert.match(text('Poison', 12), /Tags: Poison 12%\./);
    });

    it('puts the percent sign on an armor special, but not on Shield', () => {
        const reflect = buildNamedItem({ kind: 'armor', slot: 'body', armorQuality: 'Mythic', offenseVal: 30, defenseVal: 30, special: { kind: 'Increase Damage', bonusKey: 'damagePercent', value: 1.2 } }, '', '');
        assert.match(reflect.description, /Increase Damage 1\.2%\./);
        const shield = buildNamedItem({ kind: 'armor', slot: 'body', armorQuality: 'Mythic', offenseVal: 30, defenseVal: 30, special: { kind: 'Shield', bonusKey: 'shield', value: 120 } }, '', '');
        assert.match(shield.description, /Shield 120\./);
    });

    it('rolls a named blade at 24-27 EP in half-point steps, both ends reachable (owner rulings 2026-09-25, 2026-10-06)', () => {
        assert.deepEqual([NAMED_WEAPON_EP_MIN, NAMED_WEAPON_EP_MAX], [24, 27]);
        assert.ok(NAMED_WEAPON_EP_MAX <= WEAPON_EP_CEILING, 'a new forge stays under the saved-weapon ceiling');
        const seen = new Set<number>();
        // 700 draws miss one of seven values with odds near 1e-46.
        for (let i = 0; i < 700; i += 1) {
            const roll = rollNamedForge('weapon');
            assert.ok(roll.kind === 'weapon', `rolled ${JSON.stringify(roll)}`);
            assert.ok(Number.isInteger(roll.ep * 2) && roll.ep >= 24 && roll.ep <= 27, `rolled EP ${roll.ep}`);
            seen.add(roll.ep);
        }
        assert.deepEqual([...seen].sort((a, b) => a - b), [24, 24.5, 25, 25.5, 26, 26.5, 27]);
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
        assert.match(String(item.description), /7% armor protection.*diminishing returns/);
    });
});

describe('named forge tag fairness', () => {
    // Regression guard for a real bug: tag order used to come from
    // `[...WEAPON_TAGS].sort(() => randomInt(3) - 1)`. A random comparator does
    // not produce a uniform permutation, so some of the twelve tags surfaced
    // materially more often than others — silently, and dependent on V8's sort.
    it('draws every weapon tag with even probability', () => {
        const counts = new Map<string, number>();
        const epCounts = new Map<number, number>();
        const rangeCounts = new Map<number, number>();
        const offenseCounts = new Map<number, number>();
        const tagCountCounts = new Map<number, number>();
        const strengthCounts = new Map<string, number>();
        const count = <T>(table: Map<T, number>, value: T) => table.set(value, (table.get(value) ?? 0) + 1);
        const DRAWS = 24_000;
        for (let i = 0; i < DRAWS; i += 1) {
            const roll = rollNamedForge('weapon');
            if (roll.kind !== 'weapon') continue;
            count(epCounts, roll.ep);
            count(rangeCounts, roll.range);
            count(offenseCounts, roll.offenseVal);
            count(tagCountCounts, roll.tags.length);
            assert.equal(new Set(roll.tags.map(tag => tag.name)).size, roll.tags.length, 'dual tags are distinct');
            for (const tag of roll.tags) {
                const strength = namedWeaponTagStrength(tag.name, roll.tags.length);
                if (tag.name === 'Poison') assert.equal(tag.percent, 12);
                else assert.ok(Number.isInteger(tag.percent) && tag.percent >= strength.min && tag.percent <= strength.max, `${tag.name} ${tag.percent} outside ${strength.min}-${strength.max}`);
                count(strengthCounts, `${tag.name === 'Wound' ? 'wound' : 'tag'}:${roll.tags.length}:${tag.percent}`);
            }
            for (const tag of roll.tags) counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
        }
        assert.equal(counts.size, 12, 'every tag should be reachable');
        // Owner ruling 2026-10-16: both ends of every range are reachable.
        assert.deepEqual(NAMED_WEAPON_TAG_STRENGTH, { single: { min: 30, max: 40 }, dual: { min: 12, max: 22 } });
        assert.deepEqual(NAMED_WEAPON_WOUND_STRENGTH, { single: { min: 22, max: 30 }, dual: { min: 15, max: 20 } });
        for (const [kind, table] of [['tag', NAMED_WEAPON_TAG_STRENGTH], ['wound', NAMED_WEAPON_WOUND_STRENGTH]] as const) {
            for (const [tagCount, range] of [[1, table.single], [2, table.dual]] as const) {
                for (const end of [range.min, range.max]) assert.ok(strengthCounts.has(`${kind}:${tagCount}:${end}`), `${kind} ${tagCount}-tag never rolled ${end}`);
            }
        }

        // Each draw yields 1 tag half the time and 2 the other half, so the
        // expected count per tag is DRAWS * 1.5 / 12. A uniform shuffle lands
        // well inside 15%; the old comparator shuffle did not.
        assert.equal(NAMED_WEAPON_TAG_APPEARANCE_PERCENT, 12.5);
        const expected = DRAWS * NAMED_WEAPON_TAG_APPEARANCE_PERCENT / 100;
        for (const [name, seen] of counts) {
            const drift = Math.abs(seen - expected) / expected;
            assert.ok(drift < 0.15, `${name} drew ${seen} vs ~${Math.round(expected)} expected (${(drift * 100).toFixed(1)}% off)`);
        }
        for (const [table, outcomes] of [[epCounts, NAMED_WEAPON_EP_VALUES.length], [rangeCounts, NAMED_WEAPON_RANGES.length], [offenseCounts, NAMED_WEAPON_OFFENSE.max - NAMED_WEAPON_OFFENSE.min + 1], [tagCountCounts, 2]] as const) {
            assert.equal(table.size, outcomes);
            for (const seen of table.values()) assert.ok(Math.abs(seen - DRAWS / outcomes) < DRAWS / outcomes * 0.15);
        }
    });

    it('matches armor grade, stats, and special odds for every supported slot', () => {
        const counts = new Map<string, number>();
        const count = (field: string, value: string | number) => {
            const key = `${field}:${value}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        };
        const draws = 24_000;
        for (let i = 0; i < draws; i += 1) {
            const slot = NAMED_ARMOR_SLOTS[i % NAMED_ARMOR_SLOTS.length];
            const roll = rollNamedForge('armor', slot);
            assert.equal(roll.kind, 'armor');
            if (roll.kind !== 'armor') continue;
            assert.equal(roll.slot, slot);
            count('grade', roll.armorQuality);
            // Gauntlets roll their own offense (owner ruling 2026-10-16).
            count(slot === 'hand' ? 'gauntletOffense' : 'offense', roll.offenseVal);
            count('defense', roll.defenseVal);
            count('special', roll.special.kind);
            const spec = NAMED_ARMOR_SPECIALS.find(row => row.kind === roll.special.kind)!;
            assert.equal(roll.special.bonusKey, spec.bonusKey);
            assert.ok(roll.special.value >= spec.min && roll.special.value <= spec.max);
            if (spec.decimals === 0) assert.ok(Number.isInteger(roll.special.value));
            const item = buildNamedItem(roll, '', '') as { armorQuality?: string; bonuses: Record<string, number> };
            assert.equal(item.bonuses[spec.bonusKey], roll.special.value);
            assert.equal(item.armorQuality, slot === 'hand' ? undefined : roll.armorQuality);
        }
        const range = (r: { min: number; max: number }) => Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i);
        const statValues = range(NAMED_ARMOR_STATS);
        const handDraws = draws / NAMED_ARMOR_SLOTS.length;
        for (const [field, values, total] of [
            ['grade', NAMED_ARMOR_QUALITIES, draws], ['special', NAMED_ARMOR_SPECIALS.map(row => row.kind), draws],
            ['offense', statValues, draws - handDraws], ['gauntletOffense', range(NAMED_GAUNTLET_OFFENSE), handDraws], ['defense', statValues, draws],
        ] as const) {
            const expected = total / values.length;
            // 21 gauntlet values over 4,000 draws: ~190 each, so give it a wider band.
            const band = field === 'gauntletOffense' ? 0.3 : 0.15;
            for (const value of values) assert.ok(Math.abs((counts.get(`${field}:${value}`) ?? 0) - expected) < expected * band, `${field}:${value} should be uniform`);
        }
        const seen = [...counts.keys()].filter(key => key.startsWith('gauntletOffense:')).map(key => Number(key.split(':')[1]));
        assert.equal(Math.min(...seen), NAMED_GAUNTLET_OFFENSE.min);
        assert.equal(Math.max(...seen), NAMED_GAUNTLET_OFFENSE.max);
    });

    it('named gauntlets average the built-in legendary gauntlets\' 75 offense, and the budget keeps the best roll', () => {
        assert.deepEqual(NAMED_GAUNTLET_OFFENSE, { min: 65, max: 85 });
        assert.equal((NAMED_GAUNTLET_OFFENSE.min + NAMED_GAUNTLET_OFFENSE.max) / 2, 75);
        const best = buildNamedItem({ kind: 'armor', slot: 'hand', armorQuality: 'Mythic', offenseVal: 85, defenseVal: 35, special: { kind: 'Shield', bonusKey: 'shield', value: 150 } }, '', '');
        assert.deepEqual(budgetItemBonuses(best).bonuses, best.bonuses, 'the combat budget must not shave a legitimate gauntlet roll');
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
