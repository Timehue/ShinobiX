import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Telemetry is best-effort by design — recordEconomyTxn swallows its own errors
 * so a logging hiccup can never fail a reward write. The cost of that choice is
 * that a MISSING call is completely silent: the faucet/sink ledger simply reads
 * lower, and looks healthy while doing it.
 *
 * api/_treasury-gift-tax.ts was written to close exactly that blind spot on the
 * treasury channel ("the burn would have looked like it was working in
 * telemetry, because the volume that mattered never touched it"). This file pins
 * the currency paths that must stay instrumented, so removing a call is a test
 * failure rather than a number that quietly stops moving.
 *
 * This is a floor, not a census — most currency writers are still uninstrumented.
 * Add to it when you instrument another path; never delete a row to make a
 * refactor pass.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8');

const INSTRUMENTED: { file: string; sources: string[] }[] = [
    { file: 'api/player/trade.ts', sources: ['trade.burn'] },
    { file: 'api/village/treasury/transfer.ts', sources: ['village.gift.burn'] },
    { file: 'api/clan/treasury/transfer.ts', sources: ['clan.gift.burn'] },
    { file: 'api/village/upgrade.ts', sources: ['village.upgrade'] },
    { file: 'api/festival/black-market.ts', sources: ['blackmarket.stake', 'blackmarket.payout'] },
    { file: 'api/festival/sunscar.ts', sources: ['sunscar.dice'] },
    { file: 'api/bank/claim-interest.ts', sources: [] },
    { file: 'api/inventory/sell.ts', sources: [] },
    { file: 'api/shop/settle.ts', sources: [] },
    { file: 'api/missions/claim-mission.ts', sources: [] },
];

describe('economy telemetry coverage', () => {
    for (const entry of INSTRUMENTED) {
        it(`${entry.file} still records its currency deltas`, () => {
            const src = read(entry.file);
            assert.match(src, /recordEconomyTxn\(/, `${entry.file} lost its telemetry call`);
            for (const source of entry.sources) {
                assert.ok(
                    src.includes(`'${source}'`),
                    `${entry.file} must tag its txn with source '${source}' — the ledger groups by it`,
                );
            }
        });
    }

    it('every burn is logged as a NEGATIVE delta', () => {
        // A burn recorded as a positive delta would count destroyed currency as
        // created, inverting the one number the ledger exists to report.
        for (const file of ['api/player/trade.ts', 'api/village/treasury/transfer.ts', 'api/clan/treasury/transfer.ts']) {
            const src = read(file);
            const burnCalls = src.split('recordEconomyTxn(').slice(1)
                .filter(chunk => /source: '[a-z.]*burn'/.test(chunk.slice(0, 400)));
            assert.ok(burnCalls.length > 0, `${file} must log its burn`);
            for (const call of burnCalls) {
                assert.match(call.slice(0, 400), /delta: -/, `${file} logs a burn as a positive delta`);
            }
        }
    });

    it('the treasury gift burn is attributed to the taxed currency, not hardcoded ryo', () => {
        // Honor Seals are exempt and every other treasury currency is taxed, so a
        // hardcoded 'ryo' would misfile every shard, charm and stone burn.
        for (const file of ['api/village/treasury/transfer.ts', 'api/clan/treasury/transfer.ts']) {
            const src = read(file);
            const call = src.slice(src.indexOf('recordEconomyTxn('));
            assert.match(call.slice(0, 400), /currency: String\(transfer\.result\.currency\)/, `${file} hardcodes the burn currency`);
        }
    });
});
