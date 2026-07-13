"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _forge_js_1 = require("./_forge.js");
const id = '12345678-1234-1234-1234-123456789abc';
(0, node_test_1.test)('forge purchase debits the rank-specific authoritative material and seals an entitlement', () => {
    const result = (0, _forge_js_1.applyBloodlineForgePurchase)({ auraStones: 140, mythicSeals: 999 }, [], 'A Rank', id, 12345);
    strict_1.default.equal(result.ok, true);
    if (!result.ok)
        return;
    strict_1.default.equal(result.character.auraStones, 40);
    strict_1.default.equal(result.character.mythicSeals, 999);
    strict_1.default.deepEqual(result.entitlement, { id, rank: 'A Rank', issuedAt: 12345 });
    strict_1.default.deepEqual(result.pending, [result.entitlement]);
});
(0, node_test_1.test)('forge purchase fails closed on insufficient balance or invalid rank', () => {
    strict_1.default.deepEqual((0, _forge_js_1.applyBloodlineForgePurchase)({ mythicSeals: 99 }, [], 'S Rank', id, 12345), { ok: false, status: 409, error: 'Not enough mythicSeals.' });
    strict_1.default.deepEqual((0, _forge_js_1.applyBloodlineForgePurchase)({ mythicSeals: 999 }, [], 'SS Rank', id, 12345), { ok: false, status: 400, error: 'Invalid bloodline rank.' });
});
(0, node_test_1.test)('pending forge parser strips malformed, duplicate, and excess entries', () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
        id: `12345678-1234-1234-1234-123456789ab${index}`,
        rank: 'B Rank',
        issuedAt: index + 1,
    }));
    const parsed = (0, _forge_js_1.readPendingBloodlineForges)([entries[0], entries[0], { id: 'bad', rank: 'S Rank', issuedAt: 1 }, ...entries.slice(1)]);
    strict_1.default.equal(parsed.length, 3);
    strict_1.default.equal(new Set(parsed.map((entry) => entry.id)).size, 3);
});
