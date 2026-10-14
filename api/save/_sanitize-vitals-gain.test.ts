import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { settleVitalsRegen } from '../_elapsed-state.js';

// These tests pin the bounded legacy sanitizer itself. Release mode defaults
// to the stricter receipt-backed raw-save boundary and is covered separately.
process.env.STRICT_RAW_SAVE_LEDGER = '0';

/*
 * Vitals gain cap. hp / chakra / stamina used to be clamped only to their max,
 * which let any client autosave jump straight to full between fights. Now an
 * incoming vital may not exceed the stored value plus the idle regen that could
 * have elapsed since the stored `_saveAt` (1/s, the rate api/_elapsed-state.ts
 * settles offline, plus an Aura Sphere bonus) plus a grace window, plus credit
 * for a client-applied pill consumed in the same save. Server-written heals
 * (hospital, cafeteria, missions, combat) land on the STORED value first, so
 * they are never clamped here.
 */

type Char = Record<string, unknown>;
const NOW = 1_800_000_000_000;
const GRACE_SEC = 60;

function base(over: Char = {}): Char {
    return {
        name: 'vitals', level: 1, hp: 100, maxHp: 1000, chakra: 100, maxChakra: 1000, stamina: 100, maxStamina: 1000,
        stats: { strength: 10, speed: 10, intelligence: 10, willpower: 10 },
        inventory: [], itemStacks: [],
        ...over,
    };
}

function sanitize(incoming: Char, existing: Char, storedAgeSec: number, now = NOW): Record<string, any> {
    return sanitizeCharacterSave(
        { character: incoming },
        { character: existing, _saveAt: now - storedAgeSec * 1000 },
        { now },
    ).character as Record<string, any>;
}

test('vitals: a rise within elapsed regen (+grace) passes untouched', () => {
    // 30 s elapsed at 1/s, +60 s grace => up to +90 allowed.
    const out = sanitize(base({ hp: 190, chakra: 185, stamina: 180 }), base(), 30);
    assert.equal(out.hp, 190);
    assert.equal(out.chakra, 185);
    assert.equal(out.stamina, 180);
});

test('vitals: a jump to full with no cause is clamped to stored + elapsed regen + grace', () => {
    const out = sanitize(base({ hp: 1000, chakra: 1000, stamina: 1000 }), base(), 10);
    const ceiling = 100 + 10 + GRACE_SEC;
    assert.equal(out.hp, ceiling, 'hp clamped');
    assert.equal(out.chakra, ceiling, 'chakra clamped');
    assert.equal(out.stamina, ceiling, 'stamina clamped');
});

test('vitals: the ceiling never exceeds the max (long idle still caps at full)', () => {
    const out = sanitize(base({ hp: 1000 }), base(), 3_600);
    assert.equal(out.hp, 1000);
});

test('vitals: decreases (damage / spending) always pass', () => {
    const out = sanitize(base({ hp: 1, chakra: 0, stamina: 5 }), base(), 0);
    assert.equal(out.hp, 1);
    assert.equal(out.chakra, 0);
    assert.equal(out.stamina, 5);
});

test('vitals: an equipped Aura Sphere raises the allowed regen rate exactly like offline settlement', () => {
    const stored = base({ equipment: { aura: 'aura-sphere' }, auraSphereLevel: 1 });
    // level 1 sphere => +1/s, so 20 s elapsed + 60 s grace at 2/s => +160.
    const out = sanitize({ ...stored, hp: 1000 }, stored, 20);
    assert.equal(out.hp, 100 + (20 + GRACE_SEC) * 2);
});

test('vitals: a consumed Chakra Pill / Soldier Pill in the same save justifies its +25', () => {
    const stored = base({ itemStacks: [{ itemId: 'Chakra Pill', count: 2 }, { itemId: 'Soldier Pill', count: 1 }] });
    const incoming = base({
        itemStacks: [{ itemId: 'Chakra Pill', count: 1 }],
        chakra: 100 + GRACE_SEC + 25,
        stamina: 100 + GRACE_SEC + 25,
        hp: 100 + GRACE_SEC + 25,
    });
    const out = sanitize(incoming, stored, 0);
    assert.equal(out.chakra, 100 + GRACE_SEC + 25, 'one Chakra Pill consumed => +25 chakra credit');
    assert.equal(out.stamina, 100 + GRACE_SEC + 25, 'one Soldier Pill consumed => +25 stamina credit');
    assert.equal(out.hp, 100 + GRACE_SEC, 'pills never justify an hp rise');
});

test('vitals: a pill that is still owned earns no credit', () => {
    const stored = base({ inventory: ['Chakra Pill'] });
    const out = sanitize(base({ inventory: ['Chakra Pill'], chakra: 1000 }), stored, 0);
    assert.equal(out.chakra, 100 + GRACE_SEC);
});

test('vitals: hospitalized stays at hp 0 regardless of what the client sends', () => {
    const stored = base({ hp: 0, hospitalized: true, hospitalizedUntil: NOW + 30_000, hospitalizedAt: NOW - 30_000 });
    const stillAdmitted = sanitize({ ...stored, hp: 1000 }, stored, 30);
    assert.equal(stillAdmitted.hp, 0, 'admitted: hp pinned to 0');
    const selfDischarge = sanitize({ ...stored, hp: 1000, hospitalized: false }, stored, 30);
    assert.equal(selfDischarge.hospitalized, true, 'early self-discharge rejected');
    assert.equal(selfDischarge.hp, 0, 'rejected discharge keeps hp at 0');
});

test('vitals: a stored record without _saveAt is never clamped (age unknowable)', () => {
    const out = sanitizeCharacterSave({ character: base({ hp: 1000 }) }, { character: base() }, { now: NOW }).character as Record<string, any>;
    assert.equal(out.hp, 1000);
});

test('vitals: a server-side level-up refill in the same save is not clamped', () => {
    // A stored ledger whose earned points already sit above level 1 (the
    // rise-only recompute is seeded from the STORED level) => applyDerivedLevel
    // raises the level and refills vitals to the new maxima in this save.
    const bigStats = { strength: 1500, speed: 1500, intelligence: 1500, willpower: 1500 };
    const stored = base({ level: 1, levelLedgerMigrated: true, stats: bigStats, unspentStats: 0, totalStatsTrained: 5960 });
    const incoming = { ...stored, hp: 1, chakra: 1, stamina: 1 };
    const out = sanitize(incoming, stored, 0);
    assert.ok(out.level > 1, `level should rise (got ${out.level})`);
    assert.equal(out.hp, out.maxHp, 'level-up refill kept at the new max');
});

/*
 * An open Hollow Gate dive on the STORED save. The dive earns no idle recovery
 * (canRegenVitals, api/_elapsed-state.ts), the client neither regenerates nor
 * autosaves on its screens, and every in-dive heal is server-written. So a
 * mid-dive save gets neither the regen nor the grace, only pill credits (owner
 * ruling 2026-10-14). Otherwise a forged save could heal the HP the dive's next
 * fight starts from.
 */
// A fresh run per call: the run sanitizer writes to the run object in place.
const dive = (over: Char = {}): Char => ({
    runToken: 'live-dive-token', serverSeed: 'dive-seed', floor: 3, keys: 1, torch: 6, threat: 20, entryCurrencies: {}, ...over,
});
const TEN_MINUTES = 600;

test('vitals: an open dive on the stored save allows no regen and no grace, however long it idled', () => {
    const stored = base({ hollowGateRun: dive() });
    // Outside a dive, ten idle minutes would allow 100 + 600 + 60 = 760.
    const out = sanitize({ ...stored, hp: 1000, chakra: 1000, stamina: 1000 }, stored, TEN_MINUTES);
    assert.equal(out.hp, 100, 'hp held at the stored value');
    assert.equal(out.chakra, 100, 'chakra held at the stored value');
    assert.equal(out.stamina, 100, 'stamina held at the stored value');
});

test('vitals: an Aura Sphere adds nothing mid-dive', () => {
    // A level-300 sphere scales both the regen and the grace six-fold outside a dive.
    const stored = base({ hollowGateRun: dive(), equipment: { aura: 'aura-sphere' }, auraSphereLevel: 300 });
    const out = sanitize({ ...stored, hp: 1000 }, stored, TEN_MINUTES);
    assert.equal(out.hp, 100);
});

test('vitals: mid-dive, a consumed pill still justifies exactly its +25', () => {
    const stored = base({ hollowGateRun: dive(), itemStacks: [{ itemId: 'Chakra Pill', count: 2 }, { itemId: 'Soldier Pill', count: 1 }] });
    const out = sanitize(
        { ...stored, itemStacks: [{ itemId: 'Chakra Pill', count: 1 }], hp: 1000, chakra: 1000, stamina: 1000 },
        stored,
        TEN_MINUTES,
    );
    assert.equal(out.chakra, 125, 'one Chakra Pill => +25 chakra and nothing more');
    assert.equal(out.stamina, 125, 'one Soldier Pill => +25 stamina and nothing more');
    assert.equal(out.hp, 100, 'no pill justifies an hp rise');
});

test('vitals: the STORED dive decides, so a save cannot clear, swap or finish its own run to dodge the cap', () => {
    const stored = base({ hollowGateRun: dive() });
    const forgedRuns: unknown[] = [null, dive({ runToken: 'forged-token' }), dive({ completed: true })];
    for (const hollowGateRun of forgedRuns) {
        const out = sanitize({ ...stored, hollowGateRun, hp: 1000 }, stored, TEN_MINUTES);
        assert.equal(out.hp, 100, `incoming run ${JSON.stringify(hollowGateRun)}`);
    }
    const withoutRun: Char = { ...stored, hp: 1000 };
    delete withoutRun.hollowGateRun;
    assert.equal(sanitize(withoutRun, stored, TEN_MINUTES).hp, 100, 'incoming run omitted');
});

test('vitals: a save that marks its own dive completed cannot unlock the next save', () => {
    // One save is always judged by the stored run, so the way around it is to
    // make a forged `completed: true` STICK and send a second save. The run
    // sanitizer keeps `completed` server-owned for a token-bound dive.
    const stored = base({ hollowGateRun: dive() });
    const first = sanitize({ ...stored, hollowGateRun: dive({ completed: true }), hp: 1000 }, stored, TEN_MINUTES);
    assert.equal(first.hollowGateRun.completed, undefined, 'the forged completed flag is not kept');
    const second = sanitize({ ...first, hp: 1000 }, first, TEN_MINUTES);
    assert.equal(second.hp, 100, 'the next save is still capped');
});

test('vitals: once the dive is over, the regen allowance is back unchanged', () => {
    // Extraction and death null the run (api/hollow-gate/settle.ts); a stored run
    // already marked completed is over too.
    for (const hollowGateRun of [null, dive({ completed: true })]) {
        const stored = base({ hollowGateRun });
        const out = sanitize({ ...stored, hp: 1000 }, stored, 30);
        assert.equal(out.hp, 100 + 30 + GRACE_SEC, `stored run ${JSON.stringify(hollowGateRun)}`);
    }
});

test('vitals: the dive rule drops the allowance on exactly the records the server stops regenerating', () => {
    // Both read hasActiveHollowGateRun. This fails if either side forks its own
    // copy of the predicate and the two drift apart.
    const shapes: unknown[] = [undefined, null, {}, { floor: 2 }, { completed: true }, dive(), dive({ completed: true })];
    for (const hollowGateRun of shapes) {
        const stored = base({ hollowGateRun });
        const { excluded } = settleVitalsRegen({ character: stored, _saveAt: NOW - 30_000 }, { now: NOW, battleLocked: false });
        const capped = sanitize({ ...stored, hp: 1000 }, stored, 30).hp === 100;
        assert.equal(capped, excluded, `stored run ${JSON.stringify(hollowGateRun)}`);
    }
});
