import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { villageTaxEnabled, utcDateString } from './_war-tax-apply.js';
import { applyPlayerTax } from './_war-tax.js';
import { computeTax, TAX_EXEMPTION_RYO, TAX_BURN_SHARE, TAX_DAILY_CAP_RYO } from './_war-economy.js';

const TODAY = '2026-08-06';

describe('village tax: the gate', () => {
    it('is on by default with the Sector Map campaign', () => {
        assert.equal(villageTaxEnabled({}), true);
    });

    it('has a dedicated kill switch', () => {
        assert.equal(villageTaxEnabled({ DISABLE_VILLAGE_TAX: '1' }), false);
    });

    it('rides the whole system’s kill switch too', () => {
        assert.equal(villageTaxEnabled({ DISABLE_VILLAGE_WAR: '1' }), false);
    });
});

describe('village tax: the rate a player is actually charged', () => {
    const rich = { ryo: 1_000_000, bankRyo: 0, level: 50, lastTaxDate: '' };

    it('is ZERO for a village holding all 8 of its sectors', () => {
        // This is why shipping the tax on is safe: every village starts at 8.
        const out = applyPlayerTax(rich, { sectorsControlled: 8, today: TODAY });
        assert.equal(out.taxed, false);
        assert.equal(out.nextRyo, rich.ryo);
    });

    it('does not compound a lost war with a personal tax', () => {
        const weakened = applyPlayerTax(rich, { sectorsControlled: 6, today: TODAY });
        const routed = applyPlayerTax(rich, { sectorsControlled: 0, today: TODAY });
        const occupier = applyPlayerTax(rich, { sectorsControlled: 9, today: TODAY });
        assert.equal(weakened.owed, 0);
        assert.equal(routed.owed, 0);
        assert.equal(occupier.owed, Math.floor((rich.ryo - TAX_EXEMPTION_RYO) * 0.01));
    });

    it('applies the Treasury-Vault discount, so the charge matches the War Map display', () => {
        const full = applyPlayerTax(rich, { sectorsControlled: 9, today: TODAY });
        const vaulted = applyPlayerTax(rich, { sectorsControlled: 9, today: TODAY, rateMultiplier: 0.7 });
        assert.ok(vaulted.owed < full.owed);
        assert.equal(vaulted.owed, Math.floor((rich.ryo - TAX_EXEMPTION_RYO) * 0.01 * 0.7));
    });

    it('a maxed Treasury Vault can zero the tax outright', () => {
        const out = applyPlayerTax(rich, { sectorsControlled: 9, today: TODAY, rateMultiplier: 0 });
        assert.equal(out.taxed, false);
    });

    it('leaves Academy Students completely alone — no debit, no write', () => {
        const student = applyPlayerTax({ ryo: 5_000_000, bankRyo: 0, level: 5, lastTaxDate: '' }, { sectorsControlled: 9, today: TODAY });
        assert.equal(student.taxed, false);
        assert.equal(student.noWrite, true, 'not even a date stamp');
        assert.equal(student.nextRyo, 5_000_000);
    });

    it('never touches wealth under the exemption', () => {
        const poor = applyPlayerTax({ ryo: TAX_EXEMPTION_RYO, bankRyo: 0, level: 50, lastTaxDate: '' }, { sectorsControlled: 9, today: TODAY });
        assert.equal(poor.taxed, false);
        assert.equal(poor.nextRyo, TAX_EXEMPTION_RYO);
    });
});

describe('village tax: no Kage seated, no tax', () => {
    const rich = { ryo: 1_000_000, bankRyo: 0, level: 50, lastTaxDate: '' };

    it('charges nothing while the Kage seat is empty, even at the worst tier', () => {
        // A leaderless village is modelled as rateMultiplier 0, the same shape the
        // Treasury Vault uses — nobody can spend the treasury, so nobody funds it.
        const out = applyPlayerTax(rich, { sectorsControlled: 9, today: TODAY, rateMultiplier: 0 });
        assert.equal(out.taxed, false);
        assert.equal(out.nextRyo, rich.ryo);
        assert.equal(out.toTreasury, 0);
        assert.equal(out.toBurn, 0);
    });

    it('still STAMPS the day, so no arrears build up while the seat is empty', () => {
        // This is the load-bearing half: without the stamp, seating a Kage would
        // immediately bill everyone for up to 3 ungoverned days of catch-up.
        const out = applyPlayerTax(rich, { sectorsControlled: 9, today: TODAY, rateMultiplier: 0 });
        assert.equal(out.nextLastTaxDate, TODAY);
    });

    it('a leaderless stretch is not billed retroactively once a Kage is seated', () => {
        // Day 1..3 leaderless (stamped, untaxed), then a Kage takes the seat.
        let last = '';
        for (const day of ['2026-08-03', '2026-08-04', '2026-08-05']) {
            const untaxed = applyPlayerTax({ ...rich, lastTaxDate: last }, { sectorsControlled: 9, today: day, rateMultiplier: 0 });
            assert.equal(untaxed.taxed, false, `${day} untaxed`);
            last = untaxed.nextLastTaxDate;
        }
        const governed = applyPlayerTax({ ...rich, lastTaxDate: last }, { sectorsControlled: 9, today: TODAY });
        // One day owed, not three — the stamps closed out the ungoverned stretch.
        const oneDay = Math.floor((rich.ryo - TAX_EXEMPTION_RYO) * 0.01);
        assert.equal(governed.owed, oneDay);
    });

    it('resumes charging normally the day a Kage takes the seat', () => {
        const seated = applyPlayerTax(rich, { sectorsControlled: 9, today: TODAY, rateMultiplier: 1 });
        assert.equal(seated.taxed, true);
        assert.ok(seated.toTreasury > 0, 'the treasury a Kage can actually spend gets funded');
    });
});

describe('village tax: debit mechanics', () => {
    it('takes wallet first, then bank', () => {
        const out = applyPlayerTax({ ryo: 10_000, bankRyo: 1_000_000, level: 50, lastTaxDate: '' }, { sectorsControlled: 9, today: TODAY });
        assert.equal(out.fromWallet, 10_000, 'wallet drained first');
        assert.ok(out.fromBank > 0, 'remainder comes out of the bank');
        assert.equal(out.nextRyo, 0);
        assert.equal(out.fromWallet + out.fromBank, out.owed);
    });

    it('cannot push a player negative when they cannot cover it', () => {
        const out = applyPlayerTax({ ryo: 6_000, bankRyo: 0, level: 50, lastTaxDate: '' }, { sectorsControlled: 9, today: TODAY });
        assert.ok(out.nextRyo >= 0 && out.nextBankRyo >= 0);
        assert.equal(out.fromWallet + out.fromBank, Math.min(out.owed, 6_000));
    });

    it('splits what was ACTUALLY collected, not what was owed', () => {
        // Owed far exceeds the balance, so burn+treasury must sum to the debit.
        const out = applyPlayerTax({ ryo: 20_000, bankRyo: 0, level: 50, lastTaxDate: '' }, { sectorsControlled: 9, today: TODAY });
        const debited = out.fromWallet + out.fromBank;
        assert.equal(out.toBurn + out.toTreasury, debited);
        assert.equal(out.toBurn, Math.round(debited * TAX_BURN_SHARE));
    });

    it('is idempotent within a UTC day', () => {
        const first = applyPlayerTax({ ryo: 1_000_000, bankRyo: 0, level: 50, lastTaxDate: '' }, { sectorsControlled: 9, today: TODAY });
        assert.equal(first.taxed, true);
        const second = applyPlayerTax(
            { ryo: first.nextRyo, bankRyo: first.nextBankRyo, level: 50, lastTaxDate: first.nextLastTaxDate },
            { sectorsControlled: 9, today: TODAY },
        );
        assert.equal(second.taxed, false, 'same day = no second debit');
        assert.equal(second.nextRyo, first.nextRyo);
    });

    it('caps catch-up so a returning player is not wiped out', () => {
        const away = applyPlayerTax({ ryo: 100_000_000, bankRyo: 0, level: 50, lastTaxDate: '2026-01-01' }, { sectorsControlled: 20, today: TODAY });
        const perDay = Math.min(Math.floor((100_000_000 - TAX_EXEMPTION_RYO) * 0.02), TAX_DAILY_CAP_RYO);
        assert.equal(away.owed, perDay * 3, 'months away still only owes the 3-day cap');
    });

    it('honours the per-day ryo cap for the very wealthy', () => {
        const t = computeTax({ ryo: 1_000_000_000, bankRyo: 0, sectors: 20, level: 50, daysOwed: 1 });
        assert.equal(t.owed, TAX_DAILY_CAP_RYO);
    });
});

describe('utcDateString', () => {
    it('formats a UTC day key', () => {
        assert.equal(utcDateString(Date.UTC(2026, 7, 6, 23, 59, 0)), '2026-08-06');
        assert.equal(utcDateString(Date.UTC(2026, 7, 7, 0, 0, 0)), '2026-08-07');
    });
});
