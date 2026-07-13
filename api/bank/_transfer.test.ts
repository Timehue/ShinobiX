import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    applyBankTransfer,
    BANK_TRANSFER_MAX_AMOUNT,
    parseBankTransferAction,
    parseBankTransferAmount,
} from './_transfer.js';

describe('bank transfer validation', () => {
    it('accepts only the two supported actions', () => {
        assert.equal(parseBankTransferAction('deposit'), 'deposit');
        assert.equal(parseBankTransferAction('withdraw'), 'withdraw');
        assert.equal(parseBankTransferAction('credit'), null);
        assert.equal(parseBankTransferAction(undefined), null);
    });

    it('accepts bounded positive safe integers only', () => {
        assert.equal(parseBankTransferAmount(1), 1);
        assert.equal(parseBankTransferAmount(BANK_TRANSFER_MAX_AMOUNT), BANK_TRANSFER_MAX_AMOUNT);
        for (const invalid of [0, -1, 1.5, NaN, Infinity, `${BANK_TRANSFER_MAX_AMOUNT}`, BANK_TRANSFER_MAX_AMOUNT + 1]) {
            assert.equal(parseBankTransferAmount(invalid), null, `expected ${String(invalid)} to be rejected`);
        }
    });
});

describe('applyBankTransfer', () => {
    it('deposits the exact amount without changing total wealth or the input', () => {
        const current = { name: 'alice', ryo: 12_500, bankRyo: 4_000, level: 12 };
        const out = applyBankTransfer(current, 'deposit', 2_500);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.ryo, 10_000);
        assert.equal(out.bankRyo, 6_500);
        assert.equal(out.ryo + out.bankRyo, current.ryo + current.bankRyo);
        assert.equal(out.character.level, 12);
        assert.deepEqual(current, { name: 'alice', ryo: 12_500, bankRyo: 4_000, level: 12 });
    });

    it('withdraws the exact amount without changing total wealth', () => {
        const out = applyBankTransfer({ ryo: 500, bankRyo: 9_500 }, 'withdraw', 4_000);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.ryo, 4_500);
        assert.equal(out.bankRyo, 5_500);
        assert.equal(out.ryo + out.bankRyo, 10_000);
    });

    it('rejects insufficient funds without returning a character to persist', () => {
        assert.deepEqual(applyBankTransfer({ ryo: 9, bankRyo: 100 }, 'deposit', 10), {
            ok: false, status: 400, error: 'Not enough ryo.',
        });
        assert.deepEqual(applyBankTransfer({ ryo: 100, bankRyo: 9 }, 'withdraw', 10), {
            ok: false, status: 400, error: 'Not enough banked ryo.',
        });
    });

    it('fails closed on malformed or overflowing stored balances', () => {
        assert.equal(applyBankTransfer({ ryo: '100', bankRyo: 0 }, 'deposit', 1).ok, false);
        assert.equal(applyBankTransfer({ ryo: 100, bankRyo: -1 }, 'deposit', 1).ok, false);
        assert.equal(applyBankTransfer({ ryo: 100, bankRyo: Number.MAX_SAFE_INTEGER }, 'deposit', 1).ok, false);
        assert.equal(applyBankTransfer({ ryo: Number.MAX_SAFE_INTEGER, bankRyo: 100 }, 'withdraw', 1).ok, false);
    });

    it('treats absent legacy balance fields as zero', () => {
        const out = applyBankTransfer({ name: 'legacy', ryo: 10 }, 'deposit', 10);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.ryo, 0);
        assert.equal(out.bankRyo, 10);
    });
});

describe('bank transfer endpoint contract', () => {
    const handlerSource = readFileSync(join(process.cwd(), 'api', 'bank', 'transfer.ts'), 'utf8');
    const bankScreenSource = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'Bank.tsx'), 'utf8');

    it('requires player auth, a strict rate limit, and the fail-closed save mutation helper', () => {
        assert.match(handlerSource, /await authedPlayer\(req, playerName\)/);
        assert.match(handlerSource, /enforceRateLimitKv[\s\S]+strict:\s*true/);
        assert.match(handlerSource, /await mutatePlayerSave\(playerName/);
        assert.match(handlerSource, /character:\s*out\.character/);
        assert.match(handlerSource, /_saveVersion:\s*out\._saveVersion/);
        assert.match(handlerSource, /if \(action === 'deposit'\)[\s\S]+temporarily unavailable/);
    });

    it('replaces client state from the response without a local bank-move fallback', () => {
        const start = bankScreenSource.indexOf('async function moveRyo');
        const end = bankScreenSource.indexOf('async function claimInterest', start);
        assert.ok(start >= 0 && end > start, 'moveRyo function must remain present');
        const moveSource = bankScreenSource.slice(start, end);
        assert.match(moveSource, /fetch\("\/api\/bank\/transfer"/);
        assert.match(moveSource, /updateCharacter\(data\.character\)/);
        assert.doesNotMatch(moveSource, /updateCharacter\([^)]*\.\.\.character/);
        assert.doesNotMatch(moveSource, /character\.ryo\s*[+-]\s*value/);
        assert.doesNotMatch(moveSource, /character\.bankRyo\s*[+-]\s*value/);
    });
});
