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

    it('drops weaponEffectTarget if not in {self, opponent, both}', () => {
        assert.equal(pick(sanitizePvpItems([{ weaponEffectTarget: 'enemy' }])).weaponEffectTarget, undefined);
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
