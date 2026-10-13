import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1';
let createVillageCampaign: typeof import('../api/_village-war-campaign.js').createVillageCampaign;
let analyzeCampaignBalance: typeof import('./village-war-balance-audit.mjs').analyzeCampaignBalance;
let campaignScore: typeof import('../shared/village-war-campaign.js').campaignScore;
before(async () => {
    ({ createVillageCampaign } = await import('../api/_village-war-campaign.js'));
    ({ analyzeCampaignBalance } = await import('./village-war-balance-audit.mjs'));
    ({ campaignScore } = await import('../shared/village-war-campaign.js'));
});
const villages = ['Ashen Leaf Village', 'Moonshadow Village'];
test('personal budgets scale with participation and 72-intel discovery still cannot win through support alone', () => {
    const c = createVillageCampaign(villages, 1000, 47), baseline = structuredClone(c), report = analyzeCampaignBalance(c, villages[0]);
    assert.deepEqual(c, baseline, 'the audit cannot mutate its source campaign');
    assert.deepEqual(report.participation.map(s => s.fullDiscoveryDay), [null, null, 4, 2, 1]);
    for (const s of report.participation) {
        assert.equal(s.supportOnlyFinalScore.total, 0);
        assert.ok(s.days.every(day => day.attempts <= s.participants * 4 && day.cumulativeIntel <= 72));
    }
    assert.deepEqual(report.participation.map(s => s.rawSupportBudget), [350, 700, 1050, 3500, 17500]);
    assert.deepEqual(report.participation[2].days[0], { day: 1, attempts: 12, rawSupport: 210, intel: 18, cumulativeIntel: 18, revealed: 0 });
});
test('pet and card objective pools have equal value to combat and shrine control remains the largest bounded objective pool', () => {
    const report = analyzeCampaignBalance(createVillageCampaign(villages, 1000, 47), villages[0]);
    assert.deepEqual(report.objectivePools.strongholdsByMode, { combat: 600, pet: 600, card: 600 });
    assert.equal(report.objectivePools.shrine, 12500); assert.equal(report.objectivePools.allStrongholds, 1800);
    assert.equal(report.worldWinsToExceedEntireShrinePool, 626);
});
test('the support ceiling is monotonic and never exceeds one fifth of the final score across PvP budgets', () => {
    const c = createVillageCampaign(villages, 1000, 47); c.pve[villages[0]] = 1200;
    let previous = 0;
    for (let pvp = 0; pvp <= 6000; pvp++) {
        c.pvp[villages[0]] = pvp; const score = campaignScore(c, villages[0]);
        assert.ok(score.pve >= previous && score.pve <= 1200); assert.ok(score.pve * 5 <= score.total); previous = score.pve;
    }
    assert.equal(previous, 1200);
});
