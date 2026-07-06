import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';

type Char = Record<string, unknown>;
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave({ character: incoming }, existing ? { character: existing } : null).character as Record<string, unknown>;

test('clan point fields cannot be forged on a first save', () => {
    const out = sanitize({
        clanPoints: 999_999,
        weeklyClanPoints: 999_999,
        weeklyClanPointsWeek: '2026-W01',
        lifetimeClanPoints: 999_999,
        clanPointHistory: [{ id: 'forged', amount: 999_999 }],
        clanExchangePurchases: { weekly: { '2026-W01': { weaponCache: 1 } } },
    }, null);

    assert.equal('clanPoints' in out, false);
    assert.equal('weeklyClanPoints' in out, false);
    assert.equal('weeklyClanPointsWeek' in out, false);
    assert.equal('lifetimeClanPoints' in out, false);
    assert.equal('clanPointHistory' in out, false);
    assert.equal('clanExchangePurchases' in out, false);
});

test('clan point fields preserve the stored server-owned copy', () => {
    const stored = {
        clanPoints: 325,
        weeklyClanPoints: 125,
        weeklyClanPointsWeek: '2026-W02',
        lifetimeClanPoints: 925,
        clanPointHistory: [{ id: 'mission:leaf:battle:claim:aya', source: 'clanMissionClaim', amount: 25, weekKey: '2026-W02', ts: 1768000000000 }],
        clanExchangePurchases: { weekly: { '2026-W02': { smallRyoPouch: 1 } }, monthly: {}, oneTime: {} },
    };

    const out = sanitize({
        clanPoints: 999_999,
        weeklyClanPoints: 999_999,
        weeklyClanPointsWeek: '2099-W99',
        lifetimeClanPoints: 999_999,
        clanPointHistory: [],
        clanExchangePurchases: {},
    }, stored);

    assert.equal(out.clanPoints, stored.clanPoints);
    assert.equal(out.weeklyClanPoints, stored.weeklyClanPoints);
    assert.equal(out.weeklyClanPointsWeek, stored.weeklyClanPointsWeek);
    assert.equal(out.lifetimeClanPoints, stored.lifetimeClanPoints);
    assert.deepEqual(out.clanPointHistory, stored.clanPointHistory);
    assert.deepEqual(out.clanExchangePurchases, stored.clanExchangePurchases);
});
