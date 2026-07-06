"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
const sanitize = (incoming, existing) => (0, _name__js_1.sanitizeCharacterSave)({ character: incoming }, existing ? { character: existing } : null).character;
(0, node_test_1.test)('clan point fields cannot be forged on a first save', () => {
    const out = sanitize({
        clanPoints: 999_999,
        weeklyClanPoints: 999_999,
        weeklyClanPointsWeek: '2026-W01',
        lifetimeClanPoints: 999_999,
        clanPointHistory: [{ id: 'forged', amount: 999_999 }],
        clanExchangePurchases: { weekly: { '2026-W01': { weaponCache: 1 } } },
    }, null);
    strict_1.default.equal('clanPoints' in out, false);
    strict_1.default.equal('weeklyClanPoints' in out, false);
    strict_1.default.equal('weeklyClanPointsWeek' in out, false);
    strict_1.default.equal('lifetimeClanPoints' in out, false);
    strict_1.default.equal('clanPointHistory' in out, false);
    strict_1.default.equal('clanExchangePurchases' in out, false);
});
(0, node_test_1.test)('clan point fields preserve the stored server-owned copy', () => {
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
    strict_1.default.equal(out.clanPoints, stored.clanPoints);
    strict_1.default.equal(out.weeklyClanPoints, stored.weeklyClanPoints);
    strict_1.default.equal(out.weeklyClanPointsWeek, stored.weeklyClanPointsWeek);
    strict_1.default.equal(out.lifetimeClanPoints, stored.lifetimeClanPoints);
    strict_1.default.deepEqual(out.clanPointHistory, stored.clanPointHistory);
    strict_1.default.deepEqual(out.clanExchangePurchases, stored.clanExchangePurchases);
});
