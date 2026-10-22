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
    // A trade's burn is recorded by the shared helper, which both the route and
    // the admin reconcile reach (pinned below), so it is recorded exactly once.
    { file: 'api/player/_trade-settlement.ts', sources: ['trade.burn'] },
    { file: 'api/village/treasury/transfer.ts', sources: ['village.gift.burn'] },
    { file: 'api/clan/treasury/transfer.ts', sources: ['clan.gift.burn'] },
    { file: 'api/village/upgrade.ts', sources: ['village.upgrade'] },
    { file: 'api/festival/black-market.ts', sources: ['blackmarket.stake', 'blackmarket.payout'] },
    { file: 'api/festival/rally.ts', sources: ['sunscar.rally'] },
    { file: 'api/festival/caravan.ts', sources: ['sunscar.caravan'] },
    { file: 'api/bank/claim-interest.ts', sources: ['bank.interest'] },
    { file: 'api/inventory/sell.ts', sources: [] },
    // The legacy /shop/settle door (card packs and catalog items) stays pinned;
    // the live store buys through /shop/purchase, pinned with its own tag below.
    { file: 'api/shop/settle.ts', sources: ['shop.card-pack', 'shop.item-purchase', 'shop.card-pack-rebate'] },
    { file: 'api/missions/claim-mission.ts', sources: [] },

    // ── 2026-10 economy rebalance (framework I-19) ──────────────────────────
    // Shop and premium writers. The purchase tag is 'shop.purchase', not
    // 'shop.item-purchase': settle.ts owns that literal (one tag per file).
    { file: 'api/shop/purchase.ts', sources: ['shop.purchase'] },
    { file: 'api/shop/sell.ts', sources: ['shop.sell'] },
    { file: 'api/bloodlines/forge.ts', sources: ['bloodline.forge'] },
    { file: 'api/awakening/roll.ts', sources: ['awakening.reroll'] },
    { file: 'api/tebex/webhook.ts', sources: ['tebex.shards'] },
    // PvP: casual win/loss purses, the bounty posting fee, the ranked purse and
    // the sleeping-camp KO.
    { file: 'api/pvp/claim-rewards.ts', sources: ['pvp.win', 'pvp.loss'] },
    { file: 'api/pvp/bounty.ts', sources: ['pvp.bounty.burn'] },
    { file: 'api/pvp/_player-ranked-journal.ts', sources: ['pvp.ranked'] },
    { file: 'api/player/sleeper-kill.ts', sources: ['pvp.sleeper'] },
    { file: 'api/cron/_ranked-season.ts', sources: ['ranked.season'] },
    // The level-scaled ordinary AI purse (#25), the largest repeatable PvE ryo source.
    { file: 'api/missions/report-ai-fight.ts', sources: ['ai-fight.win'] },
    // Daily login, the hospital pay-skip fee, Exchange legs and fee, the
    // Cafeteria, respecs and profile purchases.
    { file: 'api/player/daily-login.ts', sources: ['daily.login'] },
    { file: 'api/player/heal.ts', sources: ['hospital.pay-skip'] },
    { file: 'api/festival/_exchange.ts', sources: ['sunscar.exchange', 'exchange.fee'] },
    { file: 'api/player/cafeteria.ts', sources: ['cafeteria.meal', 'cafeteria.cook'] },
    { file: 'api/player/stat-respec.ts', sources: ['profile.respec-stats'] },
    { file: 'api/player/profile-title.ts', sources: ['profile.purchase-title', 'profile.purchase-title-style', 'profile.purchase-title-icon'] },
    // The Crafter's fee sink and currency recipes, the mastery respec fee.
    { file: 'api/craft/forge.ts', sources: ['craft.fee', 'craft.currency'] },
    { file: 'api/profession/mastery.ts', sources: ['profession.respec'] },
    // Pets. The arena and Warfront purses are per-win and skip econ:txns.
    { file: 'api/missions/report-pet-event.ts', sources: ['expedition.claim'] },
    { file: 'api/pet/showdown.ts', sources: ['pet.arena'] },
    { file: 'api/pet/battle-result.ts', sources: ['pet.warfront'] },
    { file: 'api/pet/gauntlet.ts', sources: ['pet.gauntlet', 'pet.gauntlet.fee'] },
    { file: 'api/pet/progress.ts', sources: ['pet.nickname.fee'] },
    // The Chronicle Point faucet and the card-pack sinks.
    { file: 'api/card-clash/open-pack.ts', sources: ['cardpack.open', 'cardpack.duplicate'] },
    { file: 'api/card-clash/ai-move.ts', sources: ['echoes.win'] },
    // Village and clan: the Kage stake and its refund, the Clan Exchange shelves.
    { file: 'api/village/kage-challenge.ts', sources: ['kage.stake'] },
    { file: 'api/village/_kage-inactivity.ts', sources: ['kage.stake-refund'] },
    { file: 'api/clan/exchange/purchase.ts', sources: ['clan.exchange'] },
    // War: village and sector purses, ANBU raids, map control, the agenda and
    // the occupation tax.
    { file: 'api/war/claim-reward.ts', sources: ['war.purse.village', 'war.purse.sector'] },
    { file: 'api/_anbu-infiltration-store.ts', sources: ['war.anbu.raid'] },
    { file: 'api/village/claim-map-control.ts', sources: ['village.map-control'] },
    { file: 'api/village/claim-daily-agenda.ts', sources: ['village.agenda'] },
    { file: 'api/_war-tax-apply.ts', sources: ['village.tax'] },
    // Endless: paid entry (sink), milestone currencies and cash-out. A
    // lifetime-first Fate Shard milestone has its own source (bounded grant,
    // at most 100 per account) so it can be kept out of repeatable-FS alarms.
    { file: 'api/endless/run.ts', sources: ['endless.entry', 'endless.milestone', 'endless.milestone.first', 'endless.cashout'] },
    { file: 'api/dungeon/run.ts', sources: ['dungeon.clear'] },
    // Hollow Gate: one net txn per currency at the end of a run.
    { file: 'api/hollow-gate/settle.ts', sources: ['hollowgate.extract', 'hollowgate.death'] },
    // Weekly boss payout, world boss package, clan boss member + podium pay and
    // the Vanguard raid bonus record from their committed credits only.
    { file: 'api/weekly-boss.ts', sources: ['weeklyboss.payout'] },
    { file: 'api/world-boss-event/_reward.ts', sources: ['worldboss.reward'] },
    { file: 'api/cron/_clan-boss-weekly.ts', sources: ['clanboss.member', 'clanboss.treasury'] },
    { file: 'api/missions/_raid-progression.ts', sources: ['raid.vanguard'] },
    // Owner amendment A7: the activity purses (Spire, Dojo Circuit seals, Team
    // Arena, tournaments, L80 crisis) all record through this one helper.
    { file: 'api/_activity-purse.ts', sources: ['spire.purse', 'dojo.purse', 'arena.purse', 'tournament.purse', 'crisis80.purse'] },
    // The road: favours, merchant and medic, quests, ambushes, gifts; chests.
    { file: 'api/sector/wanderer-service.ts', sources: ['wanderer.favor', 'wanderer.merchant', 'wanderer.medic'] },
    { file: 'api/sector/wanderer-quest.ts', sources: ['wanderer.quest'] },
    { file: 'api/sector/wanderer-ambush.ts', sources: ['wanderer.ambush'] },
    { file: 'api/sector/wanderer-gift.ts', sources: ['wanderer.gift'] },
    { file: 'api/world/open-chest.ts', sources: ['world.chest'] },
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
        for (const file of ['api/player/_trade-settlement.ts', 'api/village/treasury/transfer.ts', 'api/clan/treasury/transfer.ts', 'api/pvp/bounty.ts']) {
            const src = read(file);
            const burnCalls = src.split('recordEconomyTxn(').slice(1)
                .filter(chunk => /source: '[a-z.]*burn'/.test(chunk.slice(0, 400)));
            assert.ok(burnCalls.length > 0, `${file} must log its burn`);
            for (const call of burnCalls) {
                assert.match(call.slice(0, 400), /delta: -/, `${file} logs a burn as a positive delta`);
            }
        }
    });

    it('a card-pack spend is logged as a NEGATIVE delta and its rebate as a positive one', () => {
        const chunks = read('api/card-clash/open-pack.ts').split('recordEconomyTxn(').slice(1).map((chunk) => chunk.slice(0, 400));
        const spend = chunks.filter((chunk) => /source: 'cardpack\.open'/.test(chunk));
        const rebate = chunks.filter((chunk) => /source: 'cardpack\.duplicate'/.test(chunk));
        assert.equal(spend.length, 1, 'open-pack records its spend once');
        assert.equal(rebate.length, 1, 'open-pack records its duplicate rebate once');
        assert.match(spend[0], /delta: -/, 'the pack spend is a sink');
        assert.doesNotMatch(rebate[0], /delta: -/, 'the duplicate rebate is a faucet');
    });

    it('the road merchant and medic are logged as ryo sinks', () => {
        const src = read('api/sector/wanderer-service.ts');
        // Each call's own object literal, up to the `})` that closes it.
        const calls = src.split('recordEconomyTxn(').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('})') + 2));
        for (const source of ['wanderer.merchant', 'wanderer.medic']) {
            const ryoCalls = calls.filter((call) => call.includes(`source: '${source}'`) && call.includes(`currency: 'ryo'`));
            assert.equal(ryoCalls.length, 1, `${source} logs its ryo once`);
            assert.match(ryoCalls[0], /delta: -/, `${source} logs its ryo spend as a positive delta`);
        }
    });

    it('the shop purchase, the occupation tax and the hospital fee are logged as NEGATIVE deltas', () => {
        for (const [file, source] of [['api/shop/purchase.ts', 'shop.purchase'], ['api/_war-tax-apply.ts', 'village.tax'], ['api/player/heal.ts', 'hospital.pay-skip']] as const) {
            const calls = read(file).split('recordEconomyTxn(').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('})') + 2))
                .filter((call) => call.includes(`source: '${source}'`));
            assert.equal(calls.length, 1, `${file} records '${source}' once`);
            assert.match(calls[0], /delta: -/, `${file} logs the sink '${source}' as a positive delta`);
        }
    });

    it('the Black Market also records its Bone Charm and Aura Stone payouts', () => {
        const src = read('api/festival/black-market.ts');
        assert.match(src, /currency: 'boneCharms'/);
        assert.match(src, /currency: 'auraStones'/);
    });

    it('both doors that complete a player trade record it through the shared helper', () => {
        assert.match(read('api/player/trade.ts'), /recordTradeCompletion\(/, 'the trade route must record the trades it completes');
        const helper = read('api/player/_trade-settlement.ts');
        assert.match(helper.slice(helper.indexOf('export async function reconcilePlayerTrade')), /recordTradeCompletion\(/,
            'the admin reconcile must record the trades it completes');
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
