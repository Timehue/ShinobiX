import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * P0-2 trade-escrow contract (api/player/trade.ts).
 *
 * The two-save transfer must journal through economy-tx and write the pending
 * nonce marker BEFORE the sender debit, so that:
 *   • a retry of a half-committed transfer returns 409 `pending` instead of
 *     re-debiting (the old shape double-debited exactly there);
 *   • a failure between debit and credit leaves a `needs-reconcile` record
 *     (admin economy-reconcile) instead of silently burning the funds.
 *
 * Source-shape pins (repo pattern for handler-ordering contracts): behavior
 * math (allowlist, caps, burn conservation) stays covered by _trade-core.test.ts.
 */

const src = readFileSync(join(process.cwd(), 'api', 'player', 'trade.ts'), 'utf8');

const indexOfOrFail = (needle: string | RegExp): number => {
    const idx = typeof needle === 'string' ? src.indexOf(needle) : (src.search(needle));
    assert.ok(idx >= 0, `trade.ts must contain ${needle}`);
    return idx;
};

describe('player trade escrow ordering', () => {
    it('journals reserve → debit → mark → credit → complete, in that order', () => {
        const reserve = indexOfOrFail('reserveEconomyTx(');
        const debit = indexOfOrFail(/kv\.set\(senderKey,/);
        const mark = indexOfOrFail("markEconomyTx(txId, 'debit-applied')");
        const credit = indexOfOrFail(/kv\.set\(recipientKey,/);
        const complete = indexOfOrFail('completeEconomyTx(txId)');
        assert.ok(reserve < debit && debit < mark && mark < credit && credit < complete,
            'escrow journal steps must bracket the two save writes');
    });

    it('writes the pending nonce marker before the sender debit', () => {
        const pending = indexOfOrFail('pending: true');
        const debit = indexOfOrFail(/kv\.set\(senderKey,/);
        assert.ok(pending < debit, 'the pending nonce marker must precede the debit write');
    });

    it('a pending (receipt-less) nonce refuses to re-run instead of re-debiting', () => {
        assert.match(src, /if \(prior\) \{\s*return res\.status\(409\)/s);
    });

    it('a failed credit flags needs-reconcile and keeps the pending marker', () => {
        const creditCatch = src.slice(indexOfOrFail(/kv\.set\(recipientKey,/));
        assert.match(creditCatch, /failEconomyTx\(txId/, 'credit failure must journal for reconciliation');
        assert.doesNotMatch(
            creditCatch.slice(0, creditCatch.indexOf('completeEconomyTx')),
            /kv\.del\(nonceKey\)/,
            'the pending marker must survive a post-debit failure — deleting it re-opens the double-debit',
        );
    });

    it('a failed debit rolls the pending marker back so a real retry can run', () => {
        const debitIdx = indexOfOrFail(/kv\.set\(senderKey,/);
        const between = src.slice(debitIdx, indexOfOrFail("markEconomyTx(txId, 'debit-applied')"));
        assert.match(between, /kv\.del\(nonceKey\)/, 'pre-debit failure must roll back the pending marker');
    });

    it('both save locks stay failClosed', () => {
        const matches = src.match(/failClosed:\s*true/g) ?? [];
        assert.ok(matches.length >= 2, 'both nested save locks must be failClosed');
    });
});
