"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const _transfer_js_1 = require("./_transfer.js");
(0, node_test_1.describe)('bank transfer validation', () => {
    (0, node_test_1.it)('accepts only the two supported actions', () => {
        node_assert_1.strict.equal((0, _transfer_js_1.parseBankTransferAction)('deposit'), 'deposit');
        node_assert_1.strict.equal((0, _transfer_js_1.parseBankTransferAction)('withdraw'), 'withdraw');
        node_assert_1.strict.equal((0, _transfer_js_1.parseBankTransferAction)('credit'), null);
        node_assert_1.strict.equal((0, _transfer_js_1.parseBankTransferAction)(undefined), null);
    });
    (0, node_test_1.it)('accepts bounded positive safe integers only', () => {
        node_assert_1.strict.equal((0, _transfer_js_1.parseBankTransferAmount)(1), 1);
        node_assert_1.strict.equal((0, _transfer_js_1.parseBankTransferAmount)(_transfer_js_1.BANK_TRANSFER_MAX_AMOUNT), _transfer_js_1.BANK_TRANSFER_MAX_AMOUNT);
        for (const invalid of [0, -1, 1.5, NaN, Infinity, `${_transfer_js_1.BANK_TRANSFER_MAX_AMOUNT}`, _transfer_js_1.BANK_TRANSFER_MAX_AMOUNT + 1]) {
            node_assert_1.strict.equal((0, _transfer_js_1.parseBankTransferAmount)(invalid), null, `expected ${String(invalid)} to be rejected`);
        }
    });
});
(0, node_test_1.describe)('applyBankTransfer', () => {
    (0, node_test_1.it)('deposits the exact amount without changing total wealth or the input', () => {
        const current = { name: 'alice', ryo: 12_500, bankRyo: 4_000, level: 12 };
        const out = (0, _transfer_js_1.applyBankTransfer)(current, 'deposit', 2_500);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.equal(out.ryo, 10_000);
        node_assert_1.strict.equal(out.bankRyo, 6_500);
        node_assert_1.strict.equal(out.ryo + out.bankRyo, current.ryo + current.bankRyo);
        node_assert_1.strict.equal(out.character.level, 12);
        node_assert_1.strict.deepEqual(current, { name: 'alice', ryo: 12_500, bankRyo: 4_000, level: 12 });
    });
    (0, node_test_1.it)('withdraws the exact amount without changing total wealth', () => {
        const out = (0, _transfer_js_1.applyBankTransfer)({ ryo: 500, bankRyo: 9_500 }, 'withdraw', 4_000);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.equal(out.ryo, 4_500);
        node_assert_1.strict.equal(out.bankRyo, 5_500);
        node_assert_1.strict.equal(out.ryo + out.bankRyo, 10_000);
    });
    (0, node_test_1.it)('rejects insufficient funds without returning a character to persist', () => {
        node_assert_1.strict.deepEqual((0, _transfer_js_1.applyBankTransfer)({ ryo: 9, bankRyo: 100 }, 'deposit', 10), {
            ok: false, status: 400, error: 'Not enough ryo.',
        });
        node_assert_1.strict.deepEqual((0, _transfer_js_1.applyBankTransfer)({ ryo: 100, bankRyo: 9 }, 'withdraw', 10), {
            ok: false, status: 400, error: 'Not enough banked ryo.',
        });
    });
    (0, node_test_1.it)('fails closed on malformed or overflowing stored balances', () => {
        node_assert_1.strict.equal((0, _transfer_js_1.applyBankTransfer)({ ryo: '100', bankRyo: 0 }, 'deposit', 1).ok, false);
        node_assert_1.strict.equal((0, _transfer_js_1.applyBankTransfer)({ ryo: 100, bankRyo: -1 }, 'deposit', 1).ok, false);
        node_assert_1.strict.equal((0, _transfer_js_1.applyBankTransfer)({ ryo: 100, bankRyo: Number.MAX_SAFE_INTEGER }, 'deposit', 1).ok, false);
        node_assert_1.strict.equal((0, _transfer_js_1.applyBankTransfer)({ ryo: Number.MAX_SAFE_INTEGER, bankRyo: 100 }, 'withdraw', 1).ok, false);
    });
    (0, node_test_1.it)('treats absent legacy balance fields as zero', () => {
        const out = (0, _transfer_js_1.applyBankTransfer)({ name: 'legacy', ryo: 10 }, 'deposit', 10);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.equal(out.ryo, 0);
        node_assert_1.strict.equal(out.bankRyo, 10);
    });
});
(0, node_test_1.describe)('bank transfer endpoint contract', () => {
    const handlerSource = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'bank', 'transfer.ts'), 'utf8');
    const bankScreenSource = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'screens', 'Bank.tsx'), 'utf8');
    (0, node_test_1.it)('requires player auth, a strict rate limit, and the fail-closed save mutation helper', () => {
        node_assert_1.strict.match(handlerSource, /await authedPlayer\(req, playerName\)/);
        node_assert_1.strict.match(handlerSource, /enforceRateLimitKv[\s\S]+strict:\s*true/);
        node_assert_1.strict.match(handlerSource, /await mutatePlayerSave\(playerName/);
        node_assert_1.strict.match(handlerSource, /character:\s*out\.character/);
        node_assert_1.strict.match(handlerSource, /_saveVersion:\s*out\._saveVersion/);
        node_assert_1.strict.match(handlerSource, /if \(action === 'deposit'\)[\s\S]+temporarily unavailable/);
    });
    (0, node_test_1.it)('replaces client state from the response without a local bank-move fallback', () => {
        const start = bankScreenSource.indexOf('async function moveRyo');
        const end = bankScreenSource.indexOf('async function claimInterest', start);
        node_assert_1.strict.ok(start >= 0 && end > start, 'moveRyo function must remain present');
        const moveSource = bankScreenSource.slice(start, end);
        node_assert_1.strict.match(moveSource, /fetch\("\/api\/bank\/transfer"/);
        node_assert_1.strict.match(moveSource, /updateCharacter\(data\.character\)/);
        node_assert_1.strict.doesNotMatch(moveSource, /updateCharacter\([^)]*\.\.\.character/);
        node_assert_1.strict.doesNotMatch(moveSource, /character\.ryo\s*[+-]\s*value/);
        node_assert_1.strict.doesNotMatch(moveSource, /character\.bankRyo\s*[+-]\s*value/);
    });
});
