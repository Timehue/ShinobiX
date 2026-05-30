"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const session_js_1 = require("./session.js");
const pick = (out) => out[0];
(0, node_test_1.describe)('sanitizePvpItems', () => {
    (0, node_test_1.it)('returns [] for non-array input', () => {
        node_assert_1.strict.deepEqual((0, session_js_1.sanitizePvpItems)(null), []);
        node_assert_1.strict.deepEqual((0, session_js_1.sanitizePvpItems)(undefined), []);
        node_assert_1.strict.deepEqual((0, session_js_1.sanitizePvpItems)('weapon'), []);
        node_assert_1.strict.deepEqual((0, session_js_1.sanitizePvpItems)({ id: 'a' }), []);
    });
    (0, node_test_1.it)('drops non-object entries', () => {
        node_assert_1.strict.deepEqual((0, session_js_1.sanitizePvpItems)([null, undefined, 'x', 42, true]), []);
    });
    (0, node_test_1.it)('passes a normal weapon through with values intact', () => {
        const w = {
            id: 'iron-katana', name: 'Iron Katana', slot: 'hand',
            weaponEp: 30, weaponRange: 1, apCost: 40, weaponElement: 'Fire',
        };
        const out = pick((0, session_js_1.sanitizePvpItems)([w]));
        node_assert_1.strict.equal(out.id, 'iron-katana');
        node_assert_1.strict.equal(out.weaponEp, 30);
        node_assert_1.strict.equal(out.weaponRange, 1);
        node_assert_1.strict.equal(out.apCost, 40);
        node_assert_1.strict.equal(out.weaponElement, 'Fire');
    });
    (0, node_test_1.it)('clamps weaponEp to [0, 600]', () => {
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEp: 999999 }])).weaponEp, 600);
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEp: -100 }])).weaponEp, 0);
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEp: 'free' }])).weaponEp, 0);
    });
    (0, node_test_1.it)('clamps weaponRange to [0, 30]', () => {
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponRange: 999 }])).weaponRange, 30);
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponRange: -5 }])).weaponRange, 0);
    });
    (0, node_test_1.it)('clamps apCost to [0, 200]', () => {
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ apCost: 9999 }])).apCost, 200);
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ apCost: -1 }])).apCost, 0);
    });
    (0, node_test_1.it)('clamps weaponEffectValue to [0, 100]', () => {
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffectValue: 9999 }])).weaponEffectValue, 100);
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffectValue: -10 }])).weaponEffectValue, 0);
    });
    (0, node_test_1.it)('filters weaponTags against the known tag whitelist', () => {
        const item = {
            weaponTags: [
                { name: 'Heal', percent: 50 },
                { name: 'NotARealTag', percent: 99 },
                { name: 'Stun' },
                { name: 'Increase Damage Given', percent: 75 },
            ],
        };
        const out = pick((0, session_js_1.sanitizePvpItems)([item]));
        const tags = out.weaponTags;
        node_assert_1.strict.equal(tags.length, 3, 'NotARealTag should be filtered out');
        node_assert_1.strict.ok(tags.find(t => t.name === 'Heal'));
        node_assert_1.strict.ok(tags.find(t => t.name === 'Stun'));
        node_assert_1.strict.ok(tags.find(t => t.name === 'Increase Damage Given'));
    });
    (0, node_test_1.it)('caps weaponTags at 10 entries', () => {
        const many = { weaponTags: Array.from({ length: 30 }, () => ({ name: 'Heal' })) };
        const out = pick((0, session_js_1.sanitizePvpItems)([many]));
        node_assert_1.strict.equal(out.weaponTags.length, 10);
    });
    (0, node_test_1.it)('caps tag percent at 100 and amount at 10000', () => {
        const item = { weaponTags: [{ name: 'Increase Damage Given', percent: 9999, amount: 99999999 }] };
        const out = pick((0, session_js_1.sanitizePvpItems)([item]));
        const tag = out.weaponTags[0];
        node_assert_1.strict.equal(tag.percent, 100);
        node_assert_1.strict.equal(tag.amount, 10000);
    });
    (0, node_test_1.it)('drops weaponEffect if not in the known tag set, keeps it otherwise', () => {
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffect: 'FakeEffect' }])).weaponEffect, undefined);
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffect: 'Poison' }])).weaponEffect, 'Poison');
    });
    (0, node_test_1.it)('drops weaponElement if not a real element', () => {
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponElement: 'Plasma' }])).weaponElement, undefined);
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponElement: 'Lightning' }])).weaponElement, 'Lightning');
    });
    (0, node_test_1.it)('drops weaponEffectTarget if not in {self, opponent, enemy, both}', () => {
        // Unrecognized tokens get dropped
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffectTarget: 'all' }])).weaponEffectTarget, undefined);
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffectTarget: 'nobody' }])).weaponEffectTarget, undefined);
        // All four valid tokens are preserved — 'enemy' is a legacy alias of
        // 'opponent' kept for compatibility with the GameItem client type.
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffectTarget: 'self' }])).weaponEffectTarget, 'self');
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffectTarget: 'opponent' }])).weaponEffectTarget, 'opponent');
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffectTarget: 'enemy' }])).weaponEffectTarget, 'enemy');
        node_assert_1.strict.equal(pick((0, session_js_1.sanitizePvpItems)([{ weaponEffectTarget: 'both' }])).weaponEffectTarget, 'both');
    });
    (0, node_test_1.it)('drops non-string id/name/slot so the equippedPvpItem lookup stays type-safe', () => {
        const item = { id: { evil: true }, name: 42, slot: ['hand'] };
        const out = pick((0, session_js_1.sanitizePvpItems)([item]));
        node_assert_1.strict.equal(out.id, undefined);
        node_assert_1.strict.equal(out.name, undefined);
        node_assert_1.strict.equal(out.slot, undefined);
    });
    (0, node_test_1.it)('fully neutralizes a tampered god-weapon', () => {
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
        const out = pick((0, session_js_1.sanitizePvpItems)([evil]));
        node_assert_1.strict.equal(out.weaponEp, 600);
        node_assert_1.strict.equal(out.weaponRange, 30);
        node_assert_1.strict.equal(out.apCost, 0); // 0 is in-range; balance fix would need its own change
        node_assert_1.strict.equal(out.weaponElement, undefined);
        node_assert_1.strict.equal(out.weaponEffect, undefined);
        node_assert_1.strict.equal(out.weaponEffectValue, 100);
        node_assert_1.strict.equal(out.weaponEffectTarget, undefined);
        const tags = out.weaponTags;
        node_assert_1.strict.equal(tags.length, 1);
        node_assert_1.strict.equal(tags[0].name, 'Increase Damage Given');
        node_assert_1.strict.equal(tags[0].percent, 100);
    });
    (0, node_test_1.it)('leaves field absent (vs null/undefined) untouched', () => {
        // Items in the wild often omit optional fields entirely. Sanitizer
        // should not invent values for fields that weren't supplied.
        const out = pick((0, session_js_1.sanitizePvpItems)([{ id: 'plain', name: 'Plain', slot: 'body' }]));
        node_assert_1.strict.equal('weaponEp' in out, false);
        node_assert_1.strict.equal('weaponRange' in out, false);
        node_assert_1.strict.equal('apCost' in out, false);
        node_assert_1.strict.equal('weaponTags' in out, false);
    });
});
// Smoke test on sanitizeJutsuList so it stays covered alongside its sibling.
(0, node_test_1.describe)('sanitizeJutsuList (smoke)', () => {
    (0, node_test_1.it)('clamps effectPower to [0, 600]', () => {
        const out = (0, session_js_1.sanitizeJutsuList)([{ id: 'x', effectPower: 999999 }]);
        node_assert_1.strict.equal(out[0].effectPower, 600);
    });
    (0, node_test_1.it)('strips a second Pierce in the same loadout', () => {
        const out = (0, session_js_1.sanitizeJutsuList)([
            { id: 'a', tags: [{ name: 'Pierce' }] },
            { id: 'b', tags: [{ name: 'Pierce' }] },
        ]);
        const aTags = out[0].tags;
        const bTags = out[1].tags;
        node_assert_1.strict.ok(aTags.some(t => t.name === 'Pierce'));
        node_assert_1.strict.ok(!bTags.some(t => t.name === 'Pierce'));
    });
});
