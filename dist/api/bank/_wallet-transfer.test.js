"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _wallet_transfer_js_1 = require("./_wallet-transfer.js");
(0, node_test_1.describe)('_wallet-transfer', () => {
    (0, node_test_1.it)('moves ryo into the bank without changing the total', () => {
        const result = (0, _wallet_transfer_js_1.transferBankRyo)({ ryo: 900, bankRyo: 100 }, 'deposit', 250);
        node_assert_1.strict.equal(result.ok, true);
        if (!result.ok)
            return;
        node_assert_1.strict.equal(result.walletRyo, 650);
        node_assert_1.strict.equal(result.bankRyo, 350);
        node_assert_1.strict.equal(result.walletRyo + result.bankRyo, 1000);
    });
    (0, node_test_1.it)('moves ryo out of the bank without changing the total', () => {
        const result = (0, _wallet_transfer_js_1.transferBankRyo)({ ryo: 200, bankRyo: 800 }, 'withdraw', 300);
        node_assert_1.strict.equal(result.ok, true);
        if (!result.ok)
            return;
        node_assert_1.strict.equal(result.walletRyo, 500);
        node_assert_1.strict.equal(result.bankRyo, 500);
    });
    (0, node_test_1.it)('rejects invalid and overdrawn transfers', () => {
        node_assert_1.strict.equal((0, _wallet_transfer_js_1.transferBankRyo)({ ryo: 10, bankRyo: 10 }, 'deposit', 0).ok, false);
        node_assert_1.strict.equal((0, _wallet_transfer_js_1.transferBankRyo)({ ryo: 10, bankRyo: 10 }, 'deposit', 11).ok, false);
        node_assert_1.strict.equal((0, _wallet_transfer_js_1.transferBankRyo)({ ryo: 10, bankRyo: 10 }, 'withdraw', 11).ok, false);
    });
});
