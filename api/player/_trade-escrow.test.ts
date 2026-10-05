import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * P0-2 trade-escrow contract (api/player/trade.ts).
 *
 * The two-save transfer must journal through economy-tx and write the pending
 * nonce marker BEFORE the sender debit, and each of its two writes must carry
 * the trade's receipt, so that:
 *   • a retry of a half-committed transfer FINISHES it from the receipts (the
 *     credit rolls forward) instead of re-debiting (the old shape
 *     double-debited exactly there) or leaving the sender's money stuck;
 *   • a failure between debit and credit leaves a `needs-reconcile` record that
 *     the admin economy-reconcile can finish the same way.
 *
 * Source-shape pins (repo pattern for handler-ordering contracts). The behavior
 * is driven end to end in trade.test.ts; the math (allowlist, caps, burn
 * conservation) stays covered by _trade-core.test.ts.
 */

const src = readFileSync(join(process.cwd(), 'api', 'player', 'trade.ts'), 'utf8');

const indexOfOrFail = (needle: string, from = 0): number => {
    const idx = src.indexOf(needle, from);
    assert.ok(idx >= 0, `trade.ts must contain ${needle}`);
    return idx;
};
const between = (start: string, end: string): string => {
    const from = indexOfOrFail(start);
    return src.slice(from, indexOfOrFail(end, from));
};

// The two save writes, as writeBoth hands them to mutatePlayerSaves.
const DEBIT = 'character: debitWithReceipt(sender.character, terms, now)';
const CREDIT = 'character: creditWithReceipt(recipient.character, terms, now)';

describe('player trade escrow ordering', () => {
    it('commits the debit, then the credit, each with its receipt, and closes the books after both', () => {
        // mutatePlayerSaves commits in the order the names are given.
        assert.match(src, /mutatePlayerSaves<TradeReply>\(\[playerName, toSlug\]/, 'the sender\'s debit must commit first');
        const writeBoth = between('const writeBoth = ', 'const resume = ');
        const debit = writeBoth.indexOf(DEBIT);
        const credit = writeBoth.indexOf(CREDIT);
        assert.ok(debit >= 0 && credit > debit, 'writeBoth writes the debit, then the credit');
        // The mark and the budget charge ride the SENDER side's afterCommit, so
        // they run once the debit committed and before the credit is tried.
        const debitSide = writeBoth.slice(debit, credit);
        assert.match(debitSide, /markEconomyTx\(txId, 'debit-applied'/);
        assert.match(debitSide, /chargeOutboundBudget\(/, 'the budget is charged beside the debit, so finishing a trade never charges it twice');
        assert.match(writeBoth.slice(credit), /markEconomyTx\(txId, 'credit-applied'/);
        assert.match(writeBoth.slice(credit), /afterCommit: finish\(terms\)/, 'completion closes the books after both writes');
    });

    it('publishes its recovery pointer, journals and writes the pending nonce marker before the sender debit', () => {
        const fresh = src.slice(indexOfOrFail('const plan = planTrade(currency, amount, num(sender.character[currency]));'));
        const pointer = fresh.indexOf('await openTradePointer(txId, playerName, toSlug);');
        const reserve = fresh.indexOf('reserveEconomyTx(');
        const pending = fresh.indexOf('const marker = { ts: now, txId, pending: true, fp: fingerprint };');
        const write = fresh.indexOf('return writeBoth(');
        assert.ok(pointer >= 0 && reserve > pointer && pending > reserve && write > pending, 'pointer → reserve → pending marker → writes');
        // A trade that cannot publish the pointer the recovery sweep finds it by must not start.
        assert.match(fresh.slice(pointer, reserve), /catch \{\s*return answer\(503,/);
        // Only a receipt-backed journal can be finished later.
        assert.match(fresh.slice(0, pending), /const journalMeta = \{[^}]*receiptBacked: true \};/);
        assert.match(fresh.slice(reserve, pending), /meta: journalMeta,/);
    });

    it('a pending nonce is finished under the locks; only an attempt that may still be running is told to wait', () => {
        // Before the locks: a recent marker may belong to a running attempt.
        assert.match(src, /if \(prior && Date\.now\(\) - Number\(prior\.ts \?\? 0\) < TRADE_IN_FLIGHT_MS\) \{\s*return res\.status\(409\)/s);
        // Under the locks no attempt is running, so the trade is finished.
        assert.match(src, /if \(prior\.receipt\) return answer\(200[^\n]*\n\s*return resume\(/);
    });

    it('finishing a trade whose debit landed never releases its marker and never debits again', () => {
        const resume = between('const resume = ', '// The nonce is checked HERE');
        const debited = resume.slice(resume.indexOf("if (stage.stage === 'debited')"), resume.indexOf('// Nothing moved: run it for real'));
        assert.match(debited, /\[playerName\]: \{ character: sender\.character, write: false \}/, 'the sender is not written again');
        assert.doesNotMatch(debited, /releaseNonce|releaseTradeNonce|kv\.del\(nonceKey\)|debitWithReceipt/);
    });

    it('a failed credit flags needs-reconcile and keeps the pending marker', () => {
        const branch = src.slice(indexOfOrFail("if (err instanceof PlayerSavesPartialCommitError && attempt?.writes === 'both') {"));
        const handling = branch.slice(0, branch.indexOf('return { status: 502'));
        assert.match(handling, /failEconomyTx\(txId/, 'credit failure must journal for reconciliation');
        assert.doesNotMatch(
            handling,
            /kv\.del\(nonceKey\)|releaseTradeNonce|releaseNonce/,
            'the pending marker must survive a post-debit failure — deleting it re-opens the double-debit',
        );
    });

    it('a failed debit rolls the pending marker back so a real retry can run', () => {
        const release = src.slice(indexOfOrFail('const releaseNonce = async'));
        // Deleted only while it still names this trade (api/player/_trade-settlement.ts).
        assert.match(release.slice(0, release.indexOf('};')), /releaseTradeNonce\(nonceKey, txId\)/, 'releasing the nonce must delete the pending marker');
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
