import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { transferBankRyo } from './_wallet-transfer.js';

describe('_wallet-transfer', () => {
    it('moves ryo into the bank without changing the total', () => {
        const result = transferBankRyo({ ryo: 900, bankRyo: 100 }, 'deposit', 250);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.walletRyo, 650);
        assert.equal(result.bankRyo, 350);
        assert.equal(result.walletRyo + result.bankRyo, 1000);
    });

    it('moves ryo out of the bank without changing the total', () => {
        const result = transferBankRyo({ ryo: 200, bankRyo: 800 }, 'withdraw', 300);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.walletRyo, 500);
        assert.equal(result.bankRyo, 500);
    });

    it('rejects invalid and overdrawn transfers', () => {
        assert.equal(transferBankRyo({ ryo: 10, bankRyo: 10 }, 'deposit', 0).ok, false);
        assert.equal(transferBankRyo({ ryo: 10, bankRyo: 10 }, 'deposit', 11).ok, false);
        assert.equal(transferBankRyo({ ryo: 10, bankRyo: 10 }, 'withdraw', 11).ok, false);
    });
});
