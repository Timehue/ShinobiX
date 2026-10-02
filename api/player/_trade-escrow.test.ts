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

// The two save writes, as the decision hands them to mutatePlayerSaves.
const DEBIT = 'character: { ...sender.character, [currency]: senderBalance }';
const CREDIT = '[currency]: num(recipient.character[currency]) + plan.credit';

describe('player trade escrow ordering', () => {
    it('journals reserve → debit → mark → credit → complete, in that order', () => {
        // mutatePlayerSaves commits in the order the names are given.
        assert.match(src, /mutatePlayerSaves<TradeReply>\(\[playerName, toSlug\]/, 'the sender\'s debit must commit first');
        const reserve = indexOfOrFail('reserveEconomyTx(');
        const debit = indexOfOrFail(DEBIT);
        const mark = indexOfOrFail("markEconomyTx(txId, 'debit-applied')");
        const credit = indexOfOrFail(CREDIT);
        const complete = indexOfOrFail('completeEconomyTx(txId)');
        assert.ok(reserve < debit && debit < mark && mark < credit && credit < complete,
            'escrow journal steps must bracket the two save writes');
        // The mark rides the SENDER side's afterCommit, so it runs once the
        // debit committed and before the credit is tried; completion rides the
        // decision's, after both.
        assert.match(src.slice(debit, credit), /afterCommit: async \(\) => \{ await markEconomyTx\(txId, 'debit-applied'\)/);
        assert.match(src.slice(credit), /afterCommit: async \(\) => \{\s*await completeEconomyTx\(txId\)/);
    });

    it('writes the pending nonce marker before the sender debit', () => {
        const pending = indexOfOrFail('const marker = { ts: now, txId, pending: true, fp: fingerprint };');
        const debit = indexOfOrFail(DEBIT);
        assert.ok(pending < debit, 'the pending nonce marker must precede the debit write');
    });

    it('a pending (receipt-less) nonce refuses to re-run instead of re-debiting', () => {
        assert.match(src, /if \(prior\) \{\s*return res\.status\(409\)/s);
    });

    it('a failed credit flags needs-reconcile and keeps the pending marker', () => {
        const branch = src.slice(indexOfOrFail('if (err instanceof PlayerSavesPartialCommitError && attempt) {'));
        const handling = branch.slice(0, branch.indexOf('return { status: 502'));
        assert.match(handling, /failEconomyTx\(txId/, 'credit failure must journal for reconciliation');
        assert.doesNotMatch(
            handling,
            /kv\.del\(nonceKey\)/,
            'the pending marker must survive a post-debit failure — deleting it re-opens the double-debit',
        );
    });

    it('a failed debit rolls the pending marker back so a real retry can run', () => {
        const release = src.slice(indexOfOrFail('const releaseNonce = async'));
        assert.match(release.slice(0, release.indexOf('};')), /kv\.del\(nonceKey\)/, 'releasing the nonce must delete the pending marker');
        assert.match(src, /onConflict: \(error\) => releaseNonce\(error,/, 'a lost compare-and-set moved nothing, so it releases');
        // A debit that threw may have landed. Only a proven miss may release.
        assert.match(src, /if \(await debitProvablyMissed\(senderKey, readVersion\)\) return releaseNonce\(error,/);
    });

    it('both save locks stay failClosed', () => {
        assert.match(src, /mutatePlayerSaves<TradeReply>\(/, 'both saves are locked by mutatePlayerSaves');
        const shared = readFileSync(join(process.cwd(), 'api', 'save', '_mutate-player-save.ts'), 'utf8');
        assert.match(shared, /const lockOptions = \{ failClosed: true/, 'mutatePlayerSaves must take every save lock failClosed');
    });
});
