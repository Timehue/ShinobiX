/** Formula scenarios using the shipped scorer and a server-generated campaign.
 * This measures budgets and discovery timing, not fight win rates or live retention. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advanceCampaign, campaignScore, campaignView, reserveCampaignOperation, scoreCampaignBattle,
    WAR_DAY_MS, WAR_OPERATION_CAPS, type VillageCampaign, type WarBattleMode } from '../shared/village-war-campaign.js';

function fresh(source: VillageCampaign): VillageCampaign {
    const c = structuredClone(source);
    c.pvp = {}; c.pve = {}; c.intel = {}; c.receipts = {}; c.admissions = {}; c.usage = {};
    for (const o of [...c.shrine, ...c.strongholds]) { o.bouts = 0; o.wins = {}; delete o.bonusSettled; delete o.bonusWinner; delete o.closingControlVillage; delete o.controlCapturedAt; }
    return c;
}
export function participationScenario(source: VillageCampaign, village: string, participants: number) {
    const c = fresh(source), days: { day: number; attempts: number; rawSupport: number; intel: number; cumulativeIntel: number; revealed: number }[] = [];
    for (let day = 0; day < Math.ceil((c.endsAt - c.startsAt) / WAR_DAY_MS); day++) {
        const now = c.startsAt + day * WAR_DAY_MS + 1000, before = c.intel[village] ?? 0, supportBefore = c.pve[village] ?? 0;
        for (let slot = 0; slot < WAR_OPERATION_CAPS.player; slot++) for (let player = 0; player < participants; player++) {
            const actor = `audit-${player}`;
            const kind = (['espionage', 'supply', 'sabotage'] as const).find(operation => reserveCampaignOperation(c, village, actor, operation, now));
            if (!kind) break;
            scoreCampaignBattle(c, { receipt: `operation-${day}-${player}-${slot}`, village, player: actor, createdAt: now, at: now + 1, operation: kind, pve: true });
        }
        const view = campaignView(c, [village, 'opponent'], village, now + 2);
        days.push({ day: day + 1, attempts: view.operationAllowance.total, rawSupport: (c.pve[village] ?? 0) - supportBefore,
            intel: view.intel - before, cumulativeIntel: view.intel, revealed: 3 - view.hiddenStrongholds });
    }
    return { participants, days, fullDiscoveryDay: days.find(day => day.revealed === 3)?.day ?? null,
        supportOnlyFinalScore: campaignScore(c, village), rawSupportBudget: c.pve[village] ?? 0 };
}
function objectivePool(source: VillageCampaign, village: string, mode?: WarBattleMode) {
    const c = fresh(source);
    c.strongholds = mode ? c.strongholds.filter(o => o.mode === mode) : [];
    c.shrine = mode ? [] : c.shrine;
    for (const objective of [...c.shrine, ...c.strongholds]) {
        for (let bout = 0; bout < objective.limit; bout++) scoreCampaignBattle(c, { receipt: `${objective.id}-${bout}`, village, player: 'audit-winner',
            createdAt: objective.opensAt + 1, at: objective.opensAt + 2, objectiveId: objective.id });
        if (!objective.village) { objective.controlTimeMs = { [village]: objective.closesAt - objective.opensAt }; }
    }
    advanceCampaign(c, c.endsAt);
    // The shrine pool is its extra rewards only; ordinary role rewards are uncapped.
    const normalShrinePoints = c.version === 3 ? c.shrine.reduce((sum, o) => sum + o.limit * 5, 0) : 0;
    return campaignScore(c, village).pvp - normalShrinePoints;
}
export function analyzeCampaignBalance(source: VillageCampaign, village: string) {
    const world = fresh(source);
    const worldWin = scoreCampaignBattle(world, { receipt: 'world-win', village, player: 'audit-winner', createdAt: world.startsAt + 1, at: world.startsAt + 2 });
    const shrinePool = objectivePool(source, village);
    const modePools = Object.fromEntries((['combat', 'pet', 'card'] as const).map(mode => [mode, objectivePool(source, village, mode)]));
    return { evidenceTier: 'configured-formula scenarios; not production telemetry', campaignVersion: source.version,
        assumptions: ['Every admitted mission succeeds within its admission day.', 'Players coordinate round-robin admissions, prioritize intel, and complete their orders sequentially.',
            'Objective maxima assume one village wins every scored bout and leads every window in accumulated uncontested time.',
            'Shrine pools include extra rewards only; ordinary role victory points and enemy deductions continue after the shared cap.', 'Legitimate world PvP stays uncapped as requested.'],
        durationDays: (source.endsAt - source.startsAt) / WAR_DAY_MS,
        shrineWindowHours: source.shrine.map(o => (o.closesAt - o.opensAt) / 3_600_000),
        shrineElapsedHours: source.shrine.map(o => [(o.opensAt - source.startsAt) / 3_600_000, (o.closesAt - source.startsAt) / 3_600_000]),
        objectivePools: { shrine: shrinePool, shrinePerWindow: shrinePool / source.shrine.length,
            strongholdsByMode: modePools, allStrongholds: Object.values(modePools).reduce((a, b) => a + b, 0) },
        worldWinPoints: worldWin, worldWinsToExceedEntireShrinePool: Math.floor(shrinePool / worldWin) + 1,
        participation: [1, 2, 3, 10, 50].map(players => participationScenario(source, village, players)) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1';
    const { createVillageCampaign } = await import('../api/_village-war-campaign.js');
    const villages = ['Ashen Leaf Village', 'Moonshadow Village'];
    const report = analyzeCampaignBalance(createVillageCampaign(villages, 1_700_000_000_000, 47), villages[0]);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (process.argv[2]) writeFileSync(resolve(process.argv[2]), json); else process.stdout.write(json);
}
