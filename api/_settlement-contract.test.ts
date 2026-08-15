import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * P0-2 settlement-contract characterization
 * (docs/architecture/reward-settlement-contract.md).
 *
 * Every known payout endpoint is inventoried with the idempotency mechanism it
 * uses and a source marker proving that mechanism is still present. If a
 * rewrite drops an endpoint's replay protection — or a new payout endpoint
 * ships without joining this table — this fails.
 *
 * Markers are deliberately coarse (helper names / receipt field names): the
 * goal is drift detection, not behavior simulation. Behavior lives in each
 * endpoint's own unit tests.
 */

type Mechanism =
    | 'in-save-receipt'      // receipt/stamp/latch written in the payout write
    | 'single-use-token'     // consume gated on delete rowcount
    | 'economy-tx'           // reserve → complete journal (multi-record settlements)
    | 'nx-marker'            // legacy NX once-marker (no new users)
    | 'state-machine';       // payout write transitions the gating state

const INVENTORY: ReadonlyArray<{ file: string; mechanism: Mechanism; markers: readonly (string | RegExp)[] }> = [
    { file: 'shop/settle.ts', mechanism: 'in-save-receipt', markers: ['parseSettlementRequestId'] },
    { file: 'inventory/sell.ts', mechanism: 'in-save-receipt', markers: ['parseSettlementRequestId'] },
    { file: 'craft/forge.ts', mechanism: 'in-save-receipt', markers: ['redeemedCrafts'] },
    { file: 'craft/named.ts', mechanism: 'in-save-receipt', markers: ['redeemedNamedForges'] },
    { file: 'missions/report-ai-fight.ts', mechanism: 'in-save-receipt', markers: ['redeemedAiFightRewards'] },
    { file: 'missions/claim-mission.ts', mechanism: 'in-save-receipt', markers: ['claimedServerMissions'] },
    { file: 'missions/report-raid.ts', mechanism: 'single-use-token', markers: ['consumeSingleUseToken'] },
    { file: 'missions/report-pet-event.ts', mechanism: 'single-use-token', markers: ['redeemedPetExpeditionTokens'] },
    { file: 'world/explore.ts', mechanism: 'in-save-receipt', markers: ['redeemedSectorExplorations'] },
    { file: 'world/open-chest.ts', mechanism: 'in-save-receipt', markers: ['redeemedAncientChests'] },
    { file: 'pet/befriend.ts', mechanism: 'in-save-receipt', markers: ['redeemedPetEncounters'] },
    { file: 'pet/battle-result.ts', mechanism: 'single-use-token', markers: ['redeemedPetBattleTokens', 'redeemedPetRankedMatchTokens'] },
    { file: 'pet/showdown.ts', mechanism: 'in-save-receipt', markers: ['redeemedPetBattleTokens'] },
    { file: 'pet/gauntlet.ts', mechanism: 'in-save-receipt', markers: ['redeemedPetGauntletRuns'] },
    { file: 'story/settle.ts', mechanism: 'in-save-receipt', markers: ['redeemedStoryBattles'] },
    { file: 'hollow-gate/settle.ts', mechanism: 'in-save-receipt', markers: ['redeemedHollowGateRuns'] },
    { file: 'hollow-gate/combat-settle.ts', mechanism: 'nx-marker', markers: [/hg-combat-paid|nx:\s*true/] },
    { file: 'hunter/rank-up.ts', mechanism: 'in-save-receipt', markers: ['actionId'] },
    { file: 'pvp/claim-rewards.ts', mechanism: 'in-save-receipt', markers: ['serverSettlementReceipts'] },
    { file: 'weekly-boss.ts', mechanism: 'nx-marker', markers: [/nx:\s*true/] },
    { file: 'towers/settle.ts', mechanism: 'nx-marker', markers: [/[Rr]eceipt/] },
    { file: 'festival/sunscar.ts', mechanism: 'state-machine', markers: ['beginDurableSettlement', 'completeDurableSettlement'] },
    { file: 'events/claim.ts', mechanism: 'in-save-receipt', markers: ['claimBuiltinEvent'] },
    { file: 'achievements/sync.ts', mechanism: 'in-save-receipt', markers: ['mutatePlayerSave'] },
    { file: 'player/daily-login.ts', mechanism: 'in-save-receipt', markers: ['lastLoginRewardDate'] },
    { file: 'bank/claim-interest.ts', mechanism: 'in-save-receipt', markers: ['lastBankInterestAt'] },
    { file: 'clan/mission/claim.ts', mechanism: 'in-save-receipt', markers: [/[Ee]conomic[-]?[Rr]eceipt/] },
    { file: 'clan/exchange/purchase.ts', mechanism: 'state-machine', markers: ['refundClanExchangeTreasuryPurchase'] },
    { file: 'clan/treasury/transfer.ts', mechanism: 'state-machine', markers: ['settleCrossKeyTransfer'] },
    { file: 'village/treasury/transfer.ts', mechanism: 'state-machine', markers: ['settleCrossKeyTransfer'] },
    { file: 'card-clash/open-pack.ts', mechanism: 'state-machine', markers: ['mutatePlayerSave'] },
    { file: 'card-clash/ai-move.ts', mechanism: 'in-save-receipt', markers: ['redeemedCardClashAiSessions'] },
    { file: 'player/trade.ts', mechanism: 'economy-tx', markers: ['reserveEconomyTx', 'failEconomyTx', 'trade:nonce:'] },
    { file: 'cron/_ranked-season.ts', mechanism: 'in-save-receipt', markers: ['SEASON_SETTLEMENT_RECEIPTS_FIELD', 'settleRankedSeasonCharacter'] },
];

const read = (rel: string) => readFileSync(join(process.cwd(), 'api', rel), 'utf8');

describe('reward-settlement contract inventory', () => {
    for (const entry of INVENTORY) {
        it(`${entry.file} keeps its ${entry.mechanism} idempotency mechanism`, () => {
            const source = read(entry.file);
            for (const marker of entry.markers) {
                if (typeof marker === 'string') {
                    assert.ok(
                        source.includes(marker),
                        `${entry.file} lost its settlement marker "${marker}" — `
                        + 'see docs/architecture/reward-settlement-contract.md before changing replay protection',
                    );
                } else {
                    assert.match(source, marker);
                }
            }
        });
    }

    it('a settled Showdown session survives its own response, so a dropped reply can be retried', () => {
        // The reward is written under the save lock with a receipt BEFORE the
        // response is known to have landed. Deleting the session at that moment
        // made a dropped reply unrecoverable: the retry found nothing and the
        // client told the winner "no result was recorded" for a fight they had
        // won and been paid for. The endpoint must RETAIN the finished session
        // so the retry hits the already-resolved branch, which the receipt makes
        // idempotent.
        const source = read('pet/showdown.ts');
        const settlingStart = source.indexOf('Finishing turn');
        const settlingEnd = source.indexOf("return res.status(200).json({ ok: true, events, state: viewOf(session), ...settlement });", settlingStart);
        assert.ok(settlingStart >= 0 && settlingEnd > settlingStart, 'the terminal settlement block must remain discoverable');
        const settling = source.slice(settlingStart, settlingEnd);
        assert.doesNotMatch(
            settling,
            /kv\.del\(key\)/,
            'the settling turn must not delete the session — a dropped response would be unrecoverable',
        );
        assert.match(
            settling,
            /if \(!replayed\) await kv\.set\(key, session, \{ ex: SESSION_TTL_SECONDS \}\)/,
            'the settling turn must persist the finished session to its normal TTL',
        );
        assert.match(
            source,
            /if \(session\.finished\) \{/,
            'the retry path (already-resolved -> no new events -> settle) must still exist',
        );
    });

    it('every currency-mutating settlement passes failClosed to its lock (spot inventory)', () => {
        // The full lock audit lives in docs/audits/concurrency-and-locking-audit.md;
        // this pins the currency-path convention on the highest-value endpoints.
        for (const rel of ['player/trade.ts', 'pvp/claim-rewards.ts']) {
            assert.match(read(rel), /failClosed:\s*true/, `${rel} must lock failClosed`);
        }
        for (const rel of ['clan/treasury/transfer.ts', 'village/treasury/transfer.ts']) {
            assert.match(read(rel), /settleCrossKeyTransfer/, `${rel} must use the shared cross-key settlement lock`);
        }
        const shared = read('_cross-key-settlement.ts');
        assert.match(shared, /failClosed:\s*true/, 'shared cross-key settlement helper must lock failClosed');
    });
});
