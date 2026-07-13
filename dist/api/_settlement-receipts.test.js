"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const _settlement_receipts_js_1 = require("./_settlement-receipts.js");
(0, node_test_1.default)('settlement request IDs are strict and receipt lookup distinguishes replay from conflict', () => {
    const requestId = '0123456789abcdef';
    strict_1.default.equal((0, _settlement_receipts_js_1.parseSettlementRequestId)(` ${requestId} `), requestId);
    strict_1.default.equal((0, _settlement_receipts_js_1.parseSettlementRequestId)('too-short'), null);
    strict_1.default.equal((0, _settlement_receipts_js_1.parseSettlementRequestId)('0123456789abcde!'), null);
    const character = (0, _settlement_receipts_js_1.appendSettlementReceipt)({}, [], {
        requestId,
        fingerprint: 'shop:item:kunai:1',
        value: { kind: 'item-purchase', totalCost: 10 },
        settledAt: 1,
    });
    strict_1.default.equal((0, _settlement_receipts_js_1.inspectSettlementReceipt)(character, requestId, 'shop:item:kunai:1').status, 'replay');
    strict_1.default.equal((0, _settlement_receipts_js_1.inspectSettlementReceipt)(character, requestId, 'shop:item:other:1').status, 'conflict');
    strict_1.default.equal((0, _settlement_receipts_js_1.inspectSettlementReceipt)(character, 'fedcba9876543210', 'new').status, 'fresh');
});
(0, node_test_1.default)('receipt history is immutable, bounded, and malformed stored data fails closed', () => {
    let character = {};
    for (let index = 0; index < _settlement_receipts_js_1.SERVER_SETTLEMENT_RECEIPT_LIMIT + 5; index += 1) {
        const inspected = (0, _settlement_receipts_js_1.inspectSettlementReceipt)(character, `${index}`.padStart(16, '0'), `action:${index}`);
        strict_1.default.equal(inspected.status, 'fresh');
        character = (0, _settlement_receipts_js_1.appendSettlementReceipt)(character, inspected.receipts, {
            requestId: `${index}`.padStart(16, '0'),
            fingerprint: `action:${index}`,
            value: { index },
            settledAt: index + 1,
        });
    }
    strict_1.default.equal(character.serverSettlementReceipts.length, _settlement_receipts_js_1.SERVER_SETTLEMENT_RECEIPT_LIMIT);
    strict_1.default.equal((0, _settlement_receipts_js_1.inspectSettlementReceipt)({ serverSettlementReceipts: [{}] }, '0123456789abcdef', 'x').status, 'invalid');
});
