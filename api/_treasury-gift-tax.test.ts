import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planTreasuryGift, TREASURY_GIFT_TAX_PCT, GIFT_TAX_EXEMPT_CURRENCIES } from './_treasury-gift-tax.js';
import { TRADE_TAX_PCT } from './player/_trade-core.js';

/*
 * The treasury path used to be a strictly better laundering channel than the
 * designed one: donate up to 10,000,000 ryo at 0%, gift it back out at 0%, no
 * shared-connection check, and clan creation is free. The 10% trade burn would
 * have read as healthy in telemetry while the volume that mattered bypassed it.
 */

describe('treasury gift tax', () => {
    it('matches the direct-trade burn, so neither channel undercuts the other', () => {
        assert.equal(TREASURY_GIFT_TAX_PCT, TRADE_TAX_PCT);
    });

    it('burns the tax on laundering-capable currencies', () => {
        for (const currency of ['ryo', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals']) {
            const split = planTreasuryGift(currency, 1000);
            assert.equal(split.debit, 1000, `${currency}: the pool always loses the full amount`);
            assert.equal(split.credit, 900, `${currency} credit`);
            assert.equal(split.burned, 100, `${currency} burn`);
            assert.equal(split.exempt, false);
        }
    });

    it('leaves Honor Seals untaxed — that leg is village supply, not wealth transfer', () => {
        // Seals are Vanguard PvP earnings that fund SHARED village upgrades.
        // Taxing a leader handing them to a member would tax the design itself.
        assert.deepEqual(GIFT_TAX_EXEMPT_CURRENCIES, ['honorSeals']);
        const split = planTreasuryGift('honorSeals', 1000);
        assert.equal(split.credit, 1000);
        assert.equal(split.burned, 0);
        assert.equal(split.exempt, true);
    });

    it('never credits more than the pool lost, and the burn absorbs the rounding', () => {
        for (const amount of [1, 3, 7, 9, 99, 1001, 123457]) {
            const split = planTreasuryGift('ryo', amount);
            assert.equal(split.credit + split.burned, split.debit, `amount ${amount} must conserve`);
            assert.ok(split.credit <= amount, `amount ${amount} must never over-credit`);
            assert.ok(split.credit >= 0 && split.burned >= 0, `amount ${amount} must stay non-negative`);
        }
    });

    it('is junk-safe', () => {
        for (const bad of [0, -5, NaN, undefined, null, 'free']) {
            const split = planTreasuryGift('ryo', bad);
            assert.equal(split.credit, 0);
            assert.equal(split.burned, 0);
        }
    });
});

describe('treasury gift tax — wired into both treasuries', () => {
    const village = readFileSync(join(process.cwd(), 'api', 'village', 'treasury', 'transfer.ts'), 'utf8');
    const clan = readFileSync(join(process.cwd(), 'api', 'clan', 'treasury', 'transfer.ts'), 'utf8');
    const villageDonate = readFileSync(join(process.cwd(), 'api', 'village', 'treasury', 'donate.ts'), 'utf8');
    const clanDonate = readFileSync(join(process.cwd(), 'api', 'clan', 'treasury', 'donate.ts'), 'utf8');

    it('both gift legs credit the TAXED amount, not the raw one', () => {
        for (const [name, src] of [['village', village], ['clan', clan]] as const) {
            assert.match(src, /planTreasuryGift\(key, amount\)/, `${name} must split the gift`);
            assert.match(src, /\+ split\.credit/, `${name} must credit the post-burn amount`);
        }
    });

    it('both gift legs carry the shared-connection guard', () => {
        for (const [name, src] of [['village', village], ['clan', clan]] as const) {
            assert.match(src, /hasRecentIpOrFpOverlap\(actorName, recipientName\)/, `${name} gift needs the alt guard`);
            // Ruling 8: player experience first — a broken lookup must not block
            // a legitimate gift, so the guard fails OPEN.
            assert.match(src, /catch \(err\) \{ if \(err instanceof SettlementValidationError\) throw err; \}/, `${name} guard must fail open`);
        }
    });

    it('donate caps match the gift cap so one call cannot pool a bulk transfer', () => {
        for (const [name, src] of [['village', villageDonate], ['clan', clanDonate]] as const) {
            assert.match(src, /ryo: 200_000,/, `${name} donate cap must match the 200k gift cap`);
            assert.doesNotMatch(src, /ryo: 10_000_000,/, `${name} still allows a 10M single-call donation`);
        }
    });
});
