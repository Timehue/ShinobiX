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
const jutsuTags = (out, i = 0) => out[i].tags.map(t => String(t.name));
(0, node_test_1.describe)('sanitizeJutsuList — canonicalizes alias tag names before sealing', () => {
    (0, node_test_1.it)('rewrites every alias to its canonical name', () => {
        const out = (0, session_js_1.sanitizeJutsuList)([{
                id: 'aliases', ap: 60, effectPower: 36,
                tags: [
                    { name: 'Vamp' }, // → Siphon
                    { name: 'Seal' }, // → Bloodline Seal
                    { name: 'Afterburn' }, // → Ignition
                    { name: 'Time Compression' }, // → Lag
                    { name: 'Time Dilation' }, // → Overclock
                ],
            }]);
        const names = jutsuTags(out);
        node_assert_1.strict.deepEqual(names, ['Siphon', 'Bloodline Seal', 'Ignition', 'Lag', 'Overclock']);
    });
});
(0, node_test_1.describe)('sanitizeJutsuList — strips post-damage tags that can never resolve', () => {
    (0, node_test_1.it)('drops Wound / Siphon from a zero-damage 40-AP utility jutsu', () => {
        const out = (0, session_js_1.sanitizeJutsuList)([{
                id: 'utility', ap: 40, effectPower: 0,
                tags: [{ name: 'Wound' }, { name: 'Siphon' }, { name: 'Increase Damage Taken' }],
            }]);
        const names = jutsuTags(out);
        node_assert_1.strict.ok(!names.includes('Wound'), 'Wound cannot resolve with no damage → stripped');
        node_assert_1.strict.ok(!names.includes('Siphon'), 'Siphon cannot resolve with no damage → stripped');
        node_assert_1.strict.ok(names.includes('Increase Damage Taken'), 'status debuffs that do resolve are kept');
    });
    (0, node_test_1.it)('keeps Wound / Siphon on a damaging jutsu', () => {
        const out = (0, session_js_1.sanitizeJutsuList)([{
                id: 'dmg', ap: 60, effectPower: 36, tags: [{ name: 'Wound' }, { name: 'Siphon' }],
            }]);
        const names = jutsuTags(out);
        node_assert_1.strict.ok(names.includes('Wound') && names.includes('Siphon'));
    });
    (0, node_test_1.it)('keeps Wound on a Pierce jutsu even at zero effect power', () => {
        const out = (0, session_js_1.sanitizeJutsuList)([{
                id: 'pierce', effectPower: 0, tags: [{ name: 'Pierce' }, { name: 'Wound' }],
            }]);
        const names = jutsuTags(out);
        node_assert_1.strict.ok(names.includes('Wound'), 'pierce deals damage, so Wound can resolve');
    });
    (0, node_test_1.it)('canonicalizes Vamp before the can-resolve check (alias of Siphon)', () => {
        const stripped = jutsuTags((0, session_js_1.sanitizeJutsuList)([{ id: 'u', ap: 40, effectPower: 0, tags: [{ name: 'Vamp' }] }]));
        node_assert_1.strict.ok(!stripped.includes('Siphon'), 'Vamp→Siphon stripped from a zero-damage jutsu');
    });
});
(0, node_test_1.describe)('sanitizeJutsuList — clamps the legacy EP-100 fixed-effect sentinel', () => {
    const ep = (out, i = 0) => Number(out[i].effectPower);
    (0, node_test_1.it)('clamps a 60-AP control jutsu (Stun) from EP 100 down to standard 40', () => {
        const out = (0, session_js_1.sanitizeJutsuList)([{ id: 'stun', ap: 60, effectPower: 100, tags: [{ name: 'Stun' }] }]);
        node_assert_1.strict.equal(ep(out), 40, 'EP-100 sentinel becomes standard 60-AP damage');
    });
    (0, node_test_1.it)('clamps Copy / Mirror (forced 60-AP control) the same way', () => {
        node_assert_1.strict.equal(ep((0, session_js_1.sanitizeJutsuList)([{ id: 'c', ap: 60, effectPower: 100, tags: [{ name: 'Copy' }] }])), 40);
        node_assert_1.strict.equal(ep((0, session_js_1.sanitizeJutsuList)([{ id: 'm', ap: 60, effectPower: 100, tags: [{ name: 'Mirror' }] }])), 40);
    });
    (0, node_test_1.it)('leaves a normal damage jutsu untouched (no fixed-effect tag)', () => {
        node_assert_1.strict.equal(ep((0, session_js_1.sanitizeJutsuList)([{ id: 'nuke', ap: 60, effectPower: 50, tags: [{ name: 'Wound' }] }])), 50);
        node_assert_1.strict.equal(ep((0, session_js_1.sanitizeJutsuList)([{ id: 'std', ap: 60, effectPower: 36, tags: [] }])), 36);
    });
    (0, node_test_1.it)('does not raise a low EP — only clamps the sentinel down', () => {
        // A control tag on an already-standard jutsu keeps its EP.
        node_assert_1.strict.equal(ep((0, session_js_1.sanitizeJutsuList)([{ id: 'ok', ap: 60, effectPower: 40, tags: [{ name: 'Stun' }] }])), 40);
    });
});
(0, node_test_1.describe)('sanitizeJutsuList — bloodline weatherElement affinity', () => {
    const we = (out) => out[0].weatherElement;
    (0, node_test_1.it)('keeps a valid base weather element', () => {
        node_assert_1.strict.equal(we((0, session_js_1.sanitizeJutsuList)([{ id: 'j', element: 'Crystal', weatherElement: 'Fire' }])), 'Fire');
    });
    (0, node_test_1.it)("keeps 'None' so the flavor element gets no weather interaction", () => {
        node_assert_1.strict.equal(we((0, session_js_1.sanitizeJutsuList)([{ id: 'j', element: 'Crystal', weatherElement: 'None' }])), 'None');
    });
    (0, node_test_1.it)('drops a junk weatherElement (falls back to the cosmetic element)', () => {
        node_assert_1.strict.equal(we((0, session_js_1.sanitizeJutsuList)([{ id: 'j', element: 'Crystal', weatherElement: 'Crystal' }])), undefined);
        node_assert_1.strict.equal(we((0, session_js_1.sanitizeJutsuList)([{ id: 'j', element: 'Fire', weatherElement: 42 }])), undefined);
    });
    (0, node_test_1.it)('leaves jutsu without a weatherElement untouched', () => {
        node_assert_1.strict.equal(we((0, session_js_1.sanitizeJutsuList)([{ id: 'j', element: 'Fire' }])), undefined);
    });
});
(0, node_test_1.describe)('sanitizePvpItems — canonicalizes weapon tags + effect', () => {
    (0, node_test_1.it)('rewrites weaponTags aliases and the weaponEffect to canonical names', () => {
        const out = pick((0, session_js_1.sanitizePvpItems)([{
                id: 'w', name: 'Cursed Blade', slot: 'hand',
                weaponEffect: 'Afterburn',
                weaponTags: [{ name: 'Vamp', percent: 30 }, { name: 'Seal' }],
            }]));
        node_assert_1.strict.equal(out.weaponEffect, 'Ignition');
        const tags = out.weaponTags.map(t => String(t.name));
        node_assert_1.strict.deepEqual(tags, ['Siphon', 'Bloodline Seal']);
    });
});
