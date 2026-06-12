import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizePvpItems, sanitizeJutsuList } from './session.js';

type Item = Record<string, unknown>;

const pick = (out: unknown[]): Item => out[0] as Item;

describe('sanitizePvpItems', () => {
    it('returns [] for non-array input', () => {
        assert.deepEqual(sanitizePvpItems(null), []);
        assert.deepEqual(sanitizePvpItems(undefined), []);
        assert.deepEqual(sanitizePvpItems('weapon'), []);
        assert.deepEqual(sanitizePvpItems({ id: 'a' }), []);
    });

    it('drops non-object entries', () => {
        assert.deepEqual(sanitizePvpItems([null, undefined, 'x', 42, true]), []);
    });

    it('passes a normal weapon through with values intact', () => {
        const w = {
            id: 'iron-katana', name: 'Iron Katana', slot: 'hand',
            weaponEp: 30, weaponRange: 1, apCost: 40, weaponElement: 'Fire',
        };
        const out = pick(sanitizePvpItems([w]));
        assert.equal(out.id, 'iron-katana');
        assert.equal(out.weaponEp, 30);
        assert.equal(out.weaponRange, 1);
        assert.equal(out.apCost, 40);
        assert.equal(out.weaponElement, 'Fire');
    });

    it('clamps weaponEp to [0, 600]', () => {
        assert.equal(pick(sanitizePvpItems([{ weaponEp: 999999 }])).weaponEp, 600);
        assert.equal(pick(sanitizePvpItems([{ weaponEp: -100 }])).weaponEp, 0);
        assert.equal(pick(sanitizePvpItems([{ weaponEp: 'free' }])).weaponEp, 0);
    });

    it('clamps weaponRange to [0, 30]', () => {
        assert.equal(pick(sanitizePvpItems([{ weaponRange: 999 }])).weaponRange, 30);
        assert.equal(pick(sanitizePvpItems([{ weaponRange: -5 }])).weaponRange, 0);
    });

    it('clamps apCost to [0, 200]', () => {
        assert.equal(pick(sanitizePvpItems([{ apCost: 9999 }])).apCost, 200);
        assert.equal(pick(sanitizePvpItems([{ apCost: -1 }])).apCost, 0);
    });

    it('clamps weaponEffectValue to [0, 100]', () => {
        assert.equal(pick(sanitizePvpItems([{ weaponEffectValue: 9999 }])).weaponEffectValue, 100);
        assert.equal(pick(sanitizePvpItems([{ weaponEffectValue: -10 }])).weaponEffectValue, 0);
    });

    it('filters weaponTags against the known tag whitelist', () => {
        const item = {
            weaponTags: [
                { name: 'Heal', percent: 50 },
                { name: 'NotARealTag', percent: 99 },
                { name: 'Stun' },
                { name: 'Increase Damage Given', percent: 75 },
            ],
        };
        const out = pick(sanitizePvpItems([item]));
        const tags = out.weaponTags as Array<Record<string, unknown>>;
        assert.equal(tags.length, 3, 'NotARealTag should be filtered out');
        assert.ok(tags.find(t => t.name === 'Heal'));
        assert.ok(tags.find(t => t.name === 'Stun'));
        assert.ok(tags.find(t => t.name === 'Increase Damage Given'));
    });

    it('caps weaponTags at 10 entries', () => {
        const many = { weaponTags: Array.from({ length: 30 }, () => ({ name: 'Heal' })) };
        const out = pick(sanitizePvpItems([many]));
        assert.equal((out.weaponTags as unknown[]).length, 10);
    });

    it('caps tag percent at 100 and amount at 10000', () => {
        const item = { weaponTags: [{ name: 'Increase Damage Given', percent: 9999, amount: 99999999 }] };
        const out = pick(sanitizePvpItems([item]));
        const tag = (out.weaponTags as Array<Record<string, unknown>>)[0]!;
        assert.equal(tag.percent, 100);
        assert.equal(tag.amount, 10000);
    });

    it('drops weaponEffect if not in the known tag set, keeps it otherwise', () => {
        assert.equal(pick(sanitizePvpItems([{ weaponEffect: 'FakeEffect' }])).weaponEffect, undefined);
        assert.equal(pick(sanitizePvpItems([{ weaponEffect: 'Poison' }])).weaponEffect, 'Poison');
    });

    it('drops weaponElement if not a real element', () => {
        assert.equal(pick(sanitizePvpItems([{ weaponElement: 'Plasma' }])).weaponElement, undefined);
        assert.equal(pick(sanitizePvpItems([{ weaponElement: 'Lightning' }])).weaponElement, 'Lightning');
    });

    it('drops weaponEffectTarget if not in {self, opponent, enemy, both}', () => {
        // Unrecognized tokens get dropped
        assert.equal(pick(sanitizePvpItems([{ weaponEffectTarget: 'all' }])).weaponEffectTarget, undefined);
        assert.equal(pick(sanitizePvpItems([{ weaponEffectTarget: 'nobody' }])).weaponEffectTarget, undefined);
        // All four valid tokens are preserved — 'enemy' is a legacy alias of
        // 'opponent' kept for compatibility with the GameItem client type.
        assert.equal(pick(sanitizePvpItems([{ weaponEffectTarget: 'self' }])).weaponEffectTarget, 'self');
        assert.equal(pick(sanitizePvpItems([{ weaponEffectTarget: 'opponent' }])).weaponEffectTarget, 'opponent');
        assert.equal(pick(sanitizePvpItems([{ weaponEffectTarget: 'enemy' }])).weaponEffectTarget, 'enemy');
        assert.equal(pick(sanitizePvpItems([{ weaponEffectTarget: 'both' }])).weaponEffectTarget, 'both');
    });

    it('drops non-string id/name/slot so the equippedPvpItem lookup stays type-safe', () => {
        const item = { id: { evil: true }, name: 42, slot: ['hand'] };
        const out = pick(sanitizePvpItems([item]));
        assert.equal(out.id, undefined);
        assert.equal(out.name, undefined);
        assert.equal(out.slot, undefined);
    });

    it('fully neutralizes a tampered god-weapon', () => {
        const evil = {
            id: 'godkiller', name: 'Tampered', slot: 'hand',
            weaponEp: 999999,
            weaponRange: 999,
            apCost: 0,
            weaponElement: 'Plasma',
            weaponEffect: 'OneShot',
            weaponEffectValue: 9999,
            weaponEffectTarget: 'all',
            weaponTags: [
                { name: 'InstantKill', percent: 100 },
                { name: 'Increase Damage Given', percent: 9999 },
            ],
        };
        const out = pick(sanitizePvpItems([evil]));
        assert.equal(out.weaponEp, 600);
        assert.equal(out.weaponRange, 30);
        assert.equal(out.apCost, 0); // 0 is in-range; balance fix would need its own change
        assert.equal(out.weaponElement, undefined);
        assert.equal(out.weaponEffect, undefined);
        assert.equal(out.weaponEffectValue, 100);
        assert.equal(out.weaponEffectTarget, undefined);
        const tags = out.weaponTags as Array<Record<string, unknown>>;
        assert.equal(tags.length, 1);
        assert.equal(tags[0]!.name, 'Increase Damage Given');
        assert.equal(tags[0]!.percent, 100);
    });

    it('leaves field absent (vs null/undefined) untouched', () => {
        // Items in the wild often omit optional fields entirely. Sanitizer
        // should not invent values for fields that weren't supplied.
        const out = pick(sanitizePvpItems([{ id: 'plain', name: 'Plain', slot: 'body' }]));
        assert.equal('weaponEp' in out, false);
        assert.equal('weaponRange' in out, false);
        assert.equal('apCost' in out, false);
        assert.equal('weaponTags' in out, false);
    });
});

// Smoke test on sanitizeJutsuList so it stays covered alongside its sibling.
describe('sanitizeJutsuList (smoke)', () => {
    it('clamps effectPower to [0, 600]', () => {
        const out = sanitizeJutsuList([{ id: 'x', effectPower: 999999 }]) as Array<Record<string, unknown>>;
        assert.equal(out[0]!.effectPower, 600);
    });
    it('strips a second Pierce in the same loadout', () => {
        const out = sanitizeJutsuList([
            { id: 'a', tags: [{ name: 'Pierce' }] },
            { id: 'b', tags: [{ name: 'Pierce' }] },
        ]) as Array<Record<string, unknown>>;
        const aTags = out[0]!.tags as Array<Record<string, unknown>>;
        const bTags = out[1]!.tags as Array<Record<string, unknown>>;
        assert.ok(aTags.some(t => t.name === 'Pierce'));
        assert.ok(!bTags.some(t => t.name === 'Pierce'));
    });
});

const jutsuTags = (out: unknown[], i = 0) =>
    ((out[i] as Record<string, unknown>).tags as Array<Record<string, unknown>>).map(t => String(t.name));

describe('sanitizeJutsuList — canonicalizes alias tag names before sealing', () => {
    it('rewrites every alias to its canonical name', () => {
        const out = sanitizeJutsuList([{
            id: 'aliases', ap: 60, effectPower: 36,
            tags: [
                { name: 'Vamp' },             // → Siphon
                { name: 'Seal' },             // → Bloodline Seal
                { name: 'Afterburn' },        // → Ignition
                { name: 'Time Compression' }, // → Lag
                { name: 'Time Dilation' },    // → Overclock
            ],
        }]);
        const names = jutsuTags(out);
        assert.deepEqual(names, ['Siphon', 'Bloodline Seal', 'Ignition', 'Lag', 'Overclock']);
    });
});

describe('sanitizeJutsuList — strips post-damage tags that can never resolve', () => {
    it('drops Wound / Siphon from a zero-damage 40-AP utility jutsu', () => {
        const out = sanitizeJutsuList([{
            id: 'utility', ap: 40, effectPower: 0,
            tags: [{ name: 'Wound' }, { name: 'Siphon' }, { name: 'Increase Damage Taken' }],
        }]);
        const names = jutsuTags(out);
        assert.ok(!names.includes('Wound'), 'Wound cannot resolve with no damage → stripped');
        assert.ok(!names.includes('Siphon'), 'Siphon cannot resolve with no damage → stripped');
        assert.ok(names.includes('Increase Damage Taken'), 'status debuffs that do resolve are kept');
    });

    it('keeps Wound / Siphon on a damaging jutsu', () => {
        const out = sanitizeJutsuList([{
            id: 'dmg', ap: 60, effectPower: 36, tags: [{ name: 'Wound' }, { name: 'Siphon' }],
        }]);
        const names = jutsuTags(out);
        assert.ok(names.includes('Wound') && names.includes('Siphon'));
    });

    it('keeps Wound on a Pierce jutsu even at zero effect power', () => {
        const out = sanitizeJutsuList([{
            id: 'pierce', effectPower: 0, tags: [{ name: 'Pierce' }, { name: 'Wound' }],
        }]);
        const names = jutsuTags(out);
        assert.ok(names.includes('Wound'), 'pierce deals damage, so Wound can resolve');
    });

    it('canonicalizes Vamp before the can-resolve check (alias of Siphon)', () => {
        const stripped = jutsuTags(sanitizeJutsuList([{ id: 'u', ap: 40, effectPower: 0, tags: [{ name: 'Vamp' }] }]));
        assert.ok(!stripped.includes('Siphon'), 'Vamp→Siphon stripped from a zero-damage jutsu');
    });
});

describe('sanitizeJutsuList — clamps the legacy EP-100 fixed-effect sentinel', () => {
    const ep = (out: unknown[], i = 0) => Number((out[i] as Record<string, unknown>).effectPower);

    it('clamps a 60-AP control jutsu (Stun) from EP 100 down to standard 40', () => {
        const out = sanitizeJutsuList([{ id: 'stun', ap: 60, effectPower: 100, tags: [{ name: 'Stun' }] }]);
        assert.equal(ep(out), 40, 'EP-100 sentinel becomes standard 60-AP damage');
    });

    it('clamps Copy / Mirror (forced 60-AP control) the same way', () => {
        assert.equal(ep(sanitizeJutsuList([{ id: 'c', ap: 60, effectPower: 100, tags: [{ name: 'Copy' }] }])), 40);
        assert.equal(ep(sanitizeJutsuList([{ id: 'm', ap: 60, effectPower: 100, tags: [{ name: 'Mirror' }] }])), 40);
    });

    it('leaves a normal damage jutsu untouched (no fixed-effect tag)', () => {
        assert.equal(ep(sanitizeJutsuList([{ id: 'nuke', ap: 60, effectPower: 50, tags: [{ name: 'Wound' }] }])), 50);
        assert.equal(ep(sanitizeJutsuList([{ id: 'std', ap: 60, effectPower: 36, tags: [] }])), 36);
    });

    it('does not raise a low EP — only clamps the sentinel down', () => {
        // A control tag on an already-standard jutsu keeps its EP.
        assert.equal(ep(sanitizeJutsuList([{ id: 'ok', ap: 60, effectPower: 40, tags: [{ name: 'Stun' }] }])), 40);
    });
});

describe('sanitizePvpItems — canonicalizes weapon tags + effect', () => {
    it('rewrites weaponTags aliases and the weaponEffect to canonical names', () => {
        const out = pick(sanitizePvpItems([{
            id: 'w', name: 'Cursed Blade', slot: 'hand',
            weaponEffect: 'Afterburn',
            weaponTags: [{ name: 'Vamp', percent: 30 }, { name: 'Seal' }],
        }]));
        assert.equal(out.weaponEffect, 'Ignition');
        const tags = (out.weaponTags as Array<Record<string, unknown>>).map(t => String(t.name));
        assert.deepEqual(tags, ['Siphon', 'Bloodline Seal']);
    });
});
