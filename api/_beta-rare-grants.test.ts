import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { betaRareGrantKey, betaRareGrantTally, applyBetaMetric } from './_beta-metrics.js';
import { buildDailyBetaReport, formatDailyBetaReport } from './_beta-report.js';
import type { BetaMetricsSnapshot } from './_beta-metrics.js';

describe('rare-grant normalization', () => {
    it('counts the scarce tiers of every vocabulary in the repo', () => {
        // ItemRarity, PetRarity, MarketplaceCardRarity and Chronicle disagree on
        // names; all of their scarce tiers must survive.
        for (const [domain, rarity] of [
            ['pet', 'rare'], ['pet', 'legendary'], ['pet', 'mythic'],
            ['item', 'epic'], ['item', 'named'], ['card', 'legendary'],
        ] as const) {
            assert.equal(betaRareGrantKey(domain, rarity), `${domain}:${rarity}`);
        }
    });

    it('drops the ordinary tiers, whatever each vocabulary calls them', () => {
        for (const ordinary of ['standard', 'common', 'uncommon', 'basic', 'normal', '']) {
            assert.equal(betaRareGrantKey('pet', ordinary), null, `${ordinary} is not a rare grant`);
        }
        // casing and padding are not a way in
        assert.equal(betaRareGrantKey('pet', '  COMMON '), null);
        assert.equal(betaRareGrantKey('pet', 'Legendary'), 'pet:legendary');
    });

    it('refuses an unknown domain and an unreadable rarity rather than inventing scarcity', () => {
        assert.equal(betaRareGrantKey('wallet', 'legendary'), null);
        for (const junk of [null, undefined, 42, {}, 'a'.repeat(40), 'legendary; drop', 'rare:extra']) {
            assert.equal(betaRareGrantKey('pet', junk), null, `${JSON.stringify(junk)} must not count`);
        }
    });

    it('tallies a batch, keeping only what is scarce', () => {
        assert.deepEqual(
            betaRareGrantTally('card', ['common', 'rare', 'rare', 'legendary', 'common', undefined]),
            { 'card:rare': 2, 'card:legendary': 1 },
        );
        assert.deepEqual(betaRareGrantTally('card', []), {});
        assert.deepEqual(betaRareGrantTally('card', ['common', 'common']), {});
    });
});

describe('rare grants aggregate into the day', () => {
    it('accumulates across emissions and across days', () => {
        let day = applyBetaMetric(null, { event: 'card.pack_opened', rareGrants: { 'card:rare': 2 } });
        day = applyBetaMetric(day, { event: 'card.pack_opened', rareGrants: { 'card:rare': 1, 'card:legendary': 1 } });
        assert.deepEqual(day.rareGrants, { 'card:rare': 3, 'card:legendary': 1 });
    });

    it('re-validates on the way in, so a hand-built map cannot smuggle in an ordinary tier', () => {
        const day = applyBetaMetric(null, {
            event: 'pet.acquired',
            rareGrants: { 'pet:common': 99, 'wallet:legendary': 99, 'pet:mythic': 1, garbage: 5 },
        });
        assert.deepEqual(day.rareGrants, { 'pet:mythic': 1 });
    });

    it('leaves the tally untouched when an emission carries no grants', () => {
        const day = applyBetaMetric(null, { event: 'mission.claimed', ryo: 100 });
        assert.deepEqual(day.rareGrants, {});
        assert.equal(day.rewardTotals.ryo, 100);
    });

    it('backfills a day stored before this field existed', () => {
        // Days written by the previous schema have no rareGrants key at all.
        const legacy = { date: '2026-08-01', updatedAt: 1, events: { 'mission.claimed': 3 }, levelBands: {}, sources: {}, rewardTotals: {} };
        const next = applyBetaMetric(legacy as never, { event: 'pet.acquired', rareGrants: { 'pet:rare': 1 } });
        assert.deepEqual(next.rareGrants, { 'pet:rare': 1 });
        assert.equal(next.events['mission.claimed'], 3, 'existing counts survive the migration');
    });
});

describe('the daily report shows rare grants', () => {
    const snapshot = (rareGrants: Record<string, number>): BetaMetricsSnapshot => ({
        generatedAt: Date.UTC(2026, 7, 28, 12),
        days: 1,
        daily: [],
        totals: { events: {}, levelBands: {}, sources: {}, rewardTotals: {}, rareGrants },
    });

    it('renders the tally on its own line, not folded into reward totals', () => {
        const text = formatDailyBetaReport(buildDailyBetaReport(snapshot({ 'pet:mythic': 1, 'card:legendary': 4 })));
        assert.match(text, /Rare grants: card:legendary=4, pet:mythic=1/);
        assert.match(text, /Reward totals: none/, 'scarcity must not be hidden inside payout totals');
    });

    it('says none rather than omitting the line on a quiet day', () => {
        assert.match(formatDailyBetaReport(buildDailyBetaReport(snapshot({}))), /Rare grants: none/);
    });
});

describe('rare grants are emitted where scarce things are handed out', () => {
    const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'api', ...parts), 'utf8');

    it('card packs report the tier they actually yielded', () => {
        const pack = read('card-clash', 'open-pack.ts');
        assert.match(pack, /event: 'card\.pack_opened'/);
        assert.match(pack, /betaRareGrantTally\('card',/);
    });

    it('both pet acquisition paths report, and neither counts a replay', () => {
        for (const [file, guard] of [['befriend.ts', /!result\.value\.replayed/], ['breeding-hatch.ts', /!result\.replayed/]] as const) {
            const src = read('pet', file);
            assert.match(src, /event: 'pet\.acquired'/, `${file} must report the grant`);
            assert.match(src, /betaRareGrantTally\('pet',/, `${file} must tally the rarity`);
            assert.match(src, guard, `${file} must not count a replayed grant`);
        }
    });
});
