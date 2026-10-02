/** Permanent personal chapters. Progress uses fresh server-witnessed activity;
 * era status gates only these new chapters, never existing game modes. */
export type EraChapterStat = 'missionCompletions' | 'pvpWins' | 'hollowGateClears' | 'sectorDiscoveries' | 'wandererQuests' | 'hiddenFinds' | 'warContribution' | 'bossContribution' | 'eliteKills' | 'huntCompletions';
export type EraDestination = 'missions' | 'arenaDistrict' | 'hollowGateShrine' | 'worldMap' | 'weeklyBoss' | 'villageWarMap' | 'hunting' | 'battleTowers';
export type EraObjective = { id: string; stats: EraChapterStat[]; required: number; label: string; hint?: string; destination: EraDestination };
export type EraProof = { kind: 'mission'; minimumRank: 'C' | 'B' | 'A' | 'S' } | { kind: 'gate' } | { kind: 'tower'; floor: number; mode?: 'story' | 'spire'; disrupt: boolean; signature?: 'avoid' | 'bait' };
export type EraCampaignObjective = EraObjective & { proof: EraProof };
export type EraCampaignStage = { id: string; name: string; briefing: string; conclusion: string; objectives: EraCampaignObjective[] };
export type EraRoute = { id: string; name: string; briefing: string; conclusion: string; objectives: EraObjective[]; stages?: EraCampaignStage[] };
export type EraChapter = { eraId: string; name: string; speaker: string; introduction: string; sealedIntroduction?: string; rewardTitle: string; admission?: { level: number; legacyStage: 4 | 5 }; routes: EraRoute[] };
export const ERA_CAMPAIGN_ORDER = ['shinobi-awakening', 'hollow-gate-opens', 'village-dominion', 'world-boss-awakening', 'mythic-legacies'] as const;

export const ERA_CHAPTERS: readonly EraChapter[] = [
    {
        eraId: 'shinobi-awakening', name: 'The Names on the First Roster', speaker: 'Academy archivist', rewardTitle: 'Keeper of the First Roster',
        introduction: 'The founding roster records the people trusted beyond the Academy. The archivist gives you two empty folders and an examination order. “Sixty field victories. Then bring your squad through the Warden chamber.”',
        routes: [
            { id: 'field', name: 'Keep the patrol account', briefing: 'Record the people behind the orders and the names that returned. Complete every field stage and the Warden examination.', conclusion: 'The archivist files your account beside the patrol roster. The names you carried back remain visible beneath your own.', objectives: [] },
            { id: 'duel', name: 'Keep the captains’ account', briefing: 'Record what the harder assignments taught your squad. Complete every field stage and the Warden examination.', conclusion: 'The archivist sends your account to the captains. The next squad will study the report that earned your place on the roster.', objectives: [] },
        ],
    },
    {
        eraId: 'hollow-gate-opens', name: 'Corrections to the Deep Map', speaker: 'Gate rescue clerk', rewardTitle: 'Bearer of the Return Map',
        introduction: 'The oldest Gate map ends at a line marked “probably safe.” A rescue clerk crosses it out. “A hundred fifty field orders and ten full descents will give us better evidence. Then face the Revenant examination.”',
        routes: [
            { id: 'field', name: 'Keep the rescue account', briefing: 'Record the routes the next rescue team will need. Complete both field surveys, all ten full descents and the Revenant examination.', conclusion: 'The clerk copies your rescue account before the merchants can ask for it. The return map belongs on the desk where missing teams are counted.', objectives: [] },
            { id: 'gate', name: 'Keep the expedition account', briefing: 'Record where the old expedition maps failed. Complete both field surveys, all ten full descents and the Revenant examination.', conclusion: 'Your expedition account replaces the uncertain line. “A map is a promise to the next team,” the clerk says, and sends it with the next descent.', objectives: [] },
        ],
    },
    {
        eraId: 'village-dominion', name: 'The Border Has Two Sides', speaker: 'Border quartermaster', rewardTitle: 'Witness of the Border',
        introduction: 'A quartermaster shows you a border map with three erased village seals. “The road needs someone we can trust through a crisis. Three hundred field victories, twenty full descents, and both upper command examinations. Bring your squad home.”',
        routes: [
            { id: 'field', name: 'Keep the road account', briefing: 'Record who depended on the supply road. Complete both operation stages, twenty full descents and both command examinations.', conclusion: 'The quartermaster pins your account under the disputed border. “The line moved again. The people still needed the road.” Your report stays after the next seal is erased.', objectives: [] },
            { id: 'front', name: 'Keep the command account', briefing: 'Record how your squad survived the crisis orders. Complete both operation stages, twenty full descents and both command examinations.', conclusion: 'Your command report keeps every squad name visible. “Holding a border and bringing people home belong in the same account,” the quartermaster says.', objectives: [] },
        ],
    },
    {
        eraId: 'world-boss-awakening', name: 'Four Seals on One Order', speaker: 'Joint muster recorder', rewardTitle: 'Bearer of the Four Seals',
        admission: { level: 70, legacyStage: 4 },
        introduction: 'Four villages signed the joint order. The recorder leaves four spaces beneath their seals. “Four hundred fifty S-rank victories. Thirty full descents. Then the Matriarch, the Sovereign and the Mirror Shogun must each witness a new clean examination. Bring your Proven Legacy and earn every seal.”',
        routes: [
            { id: 'field', name: 'Keep the approach account', briefing: 'Record who kept the muster roads open. Complete both S-rank operations, all thirty full descents and every Spire examination. This perspective requires the entire Master campaign.', conclusion: 'The recorder writes your work beneath the famous battle. “The horn reached everyone because someone kept the roads open.” Your Master account is stamped with all four seals.', objectives: [] },
            { id: 'boss', name: 'Keep the muster account', briefing: 'Record how the joint line learned to withstand endgame threats. Complete both S-rank operations, all thirty full descents and every Spire examination. This perspective requires the entire Master campaign.', conclusion: 'The recorder binds your three examination reports beneath the joint order. No village seal is larger than another. “You brought a squad through every test. You earned the four seals.”', objectives: [] },
        ],
    },
    {
        eraId: 'mythic-legacies', name: 'The First Mythic Survey', speaker: 'Hall survey keeper', rewardTitle: 'Witness of the Mythic Age',
        admission: { level: 100, legacyStage: 5 },
        sealedIntroduction: 'The keeper has cleared a blank stone. “When the world opens this age, its Grandmaster survey will ask for nine hundred S-rank victories, sixty full descents and three new upper-Spire examinations. Complete the Master account and bring your chosen Legacy to its summit. There will be room for more than the first name.”',
        introduction: 'The keeper unfolds the Grandmaster survey. “Nine hundred S-rank victories. Sixty full descents. The Revenant, the Ravager and the Emperor of the Last Eclipse must each witness a clean examination. Your level-one-hundred record and completed Legacy stand beside them. The first name did not finish this age for everyone.”',
        routes: [
            { id: 'field', name: 'Keep the roads survey', briefing: 'Trace the people behind the age. Complete both S-rank surveys, all sixty full descents and every upper-Spire examination. This perspective requires the entire Grandmaster campaign.', conclusion: 'You return with every order and examination sealed. The keeper places your Grandmaster account beside the first mythic name. “This age has more than one story. You earned your place in it.”', objectives: [] },
            { id: 'gate', name: 'Keep the deep survey', briefing: 'Compare the deep maps with the world above. Complete both S-rank surveys, all sixty full descents and every upper-Spire examination. This perspective requires the entire Grandmaster campaign.', conclusion: 'The keeper binds your sixty return maps beneath the Emperor’s examination. The Hall keeps your Grandmaster account beside the paths that came back.', objectives: [] },
        ],
    },
];

export type EraJourney = { routeId: string; startedAt: number; baselines: Record<string, number>; completedAt?: number;
    version?: 2; stageIndex?: number; stageStartedAt?: number; stageCounts?: Record<string, number>;
    completedStages?: Array<{ id: string; at: number }>; proofReceipts?: string[]; legacyCompletedAt?: number };
export type EraJourneys = Partial<Record<string, EraJourney>>;
export type EraChapterProgress = { eraId: string; available: boolean; routeId: string | null; startedAt: number | null; completedAt: number | null; ready: boolean; objectives: Array<EraObjective & { current: number; done: boolean }>;
    blockedReason?: string; legacyCompletedAt?: number; historicalRouteId?: string; campaign?: { stageIndex: number; stages: Array<EraCampaignStage & { done: boolean }>; briefing: string; recentConclusion?: string } };

export function eraObjectiveValue(objective: EraObjective, stats: Partial<Record<EraChapterStat, number>>): number {
    return objective.stats.reduce((total, stat) => total + Math.max(0, Number(stats[stat]) || 0), 0);
}

export function eraChapterProgress(chapter: EraChapter, journey: EraJourney | undefined, stats: Partial<Record<EraChapterStat, number>>, available: boolean): EraChapterProgress {
    const route = chapter.routes.find(item => item.id === journey?.routeId);
    if (chapter.routes[0]?.stages) return eraCampaignProgress(chapter, journey, available);
    const objectives = (route?.objectives ?? []).map(objective => {
        const current = journey?.completedAt ? objective.required : Math.min(objective.required, Math.max(0, eraObjectiveValue(objective, stats) - (journey?.baselines[objective.id] ?? 0)));
        return { ...objective, current, done: current >= objective.required };
    });
    return { eraId: chapter.eraId, available, routeId: route?.id ?? null, startedAt: journey?.startedAt ?? null, completedAt: journey?.completedAt ?? null, ready: !!route && objectives.every(objective => objective.done), objectives };
}

const campaignMission = (rank: 'C' | 'B' | 'A' | 'S', required: number): EraCampaignObjective => ({
    id: `missions-${rank}`, stats: [], required, label: `Claim new ${rank}-rank${rank === 'S' ? '' : ' or higher'} combat mission victories`,
    hint: rank === 'S' ? 'Only the built-in S-Rank Crisis mission counts. Lower ranks, fetch jobs, Hunter Guild hunts, duels and historical totals do not.'
        : 'Only built-in combat missions of the required rank or higher count, including the mission board’s A-Rank Hunt. Fetch jobs, Hunter Guild hunts, duels and historical totals do not.', destination: 'missions', proof: { kind: 'mission', minimumRank: rank },
});
const campaignGate = (required: number): EraCampaignObjective => ({ id: 'full-gate', stats: [], required,
    label: 'Return from full five-floor Hollow Gate victories', hint: 'Start the dive during this stage, defeat its final boss, and extract. Short variants and early extractions do not count.', destination: 'hollowGateShrine', proof: { kind: 'gate' },
});
const examination = (floor: number, signature?: 'avoid' | 'bait'): EraCampaignObjective => ({ id: `examination-${floor}`, stats: [], required: 1,
    label: `Pass the Story Tower floor ${floor} examination`,
    hint: `Start a new run after this stage opens. Your squad must clear within the floor's score par, with no knockouts, and disrupt a pylon${signature === 'avoid' ? ', while evading a signature strike' : signature === 'bait' ? ', while baiting a charge into a pillar' : ''}. All conditions must happen in the same run.`,
    destination: 'battleTowers', proof: { kind: 'tower', floor, disrupt: true, signature },
});
const spireExamination = (tier: number, signature: 'avoid' | 'bait'): EraCampaignObjective => ({
    ...examination(tier, signature), id: `spire-examination-${tier}`,
    label: `Pass the Endless Spire tier ${tier} examination`, proof: { kind: 'tower', mode: 'spire', floor: tier, disrupt: true, signature },
    hint: `Start a new public Spire run after this stage opens. Clear within that run's scoring par with no squad knockouts, disrupt a pylon, and ${signature === 'bait' ? 'bait a charge into a pillar' : 'evade a signature strike'}. All conditions must happen in the same run. Story and embedded encounters do not count.`,
});
export const ERA_CAMPAIGN_STAGES: Readonly<Record<string, EraCampaignStage[]>> = {
    'shinobi-awakening': [
        { id: 'field-record', name: 'Orders beyond the Academy', briefing: 'The founding roster records who returned, not who accepted the easiest job. Carry thirty combat orders beyond the training yard.', conclusion: 'Thirty sealed reports fill the archivist’s first folder. The next orders have heavier names beside them.', objectives: [campaignMission('C', 30)] },
        { id: 'trusted-orders', name: 'The assignments others declined', briefing: 'Bring back thirty B-rank or higher combat victories. The archivist is assembling a record of dependable field work.', conclusion: 'The second folder is complete. “I can record that you fought,” the archivist says. “Now show me how you keep a squad standing.”', objectives: [campaignMission('B', 30)] },
        { id: 'field-examination', name: 'The Warden examination', briefing: 'Return to Story Tower floor five for a new examination. Break its pylon, defeat the Warden within par, and bring every squad member through without a knockout.', conclusion: 'The Warden report arrives with every name still standing. The archivist binds your sixty orders beside it. Your place on the roster is earned.', objectives: [examination(5)] },
    ],
    'hollow-gate-opens': [
        { id: 'return-routes', name: 'Routes that survived their survey', briefing: 'Carry seventy-five B-rank or higher combat orders and return from five complete Gate descents. Every map correction needs evidence from the field.', conclusion: 'The rescue clerk replaces five uncertain routes with records of full returns. A second team has already requested copies.', objectives: [campaignMission('B', 75), campaignGate(5)] },
        { id: 'deep-survey', name: 'Beyond the rescue line', briefing: 'Complete seventy-five A-rank or higher combat orders and five more full descents. These surveys begin where the rescue team’s old ink stops.', conclusion: 'The final surveys agree where the old maps did not. The clerk closes the ledger and sends you to the Revenant chamber for the last examination.', objectives: [campaignMission('A', 75), campaignGate(5)] },
        { id: 'expedition-examination', name: 'The Revenant examination', briefing: 'Clear Story Tower floor seven within par with no squad knockouts. Disrupt a pylon and evade a signature strike during that same victory.', conclusion: 'The Revenant chamber report confirms the survey team can read danger and still finish its work. The clerk places your return map on the rescue desk, where the next expedition will find it.', objectives: [examination(7, 'avoid')] },
    ],
    'village-dominion': [
        { id: 'border-operations', name: 'A road worth holding', briefing: 'Carry one hundred fifty A-rank or higher combat orders and complete ten full Gate descents. The quartermaster needs a field record before trusting you with the border operation.', conclusion: 'The supply road has a dependable name beside its hardest orders. The quartermaster brings out the sealed crisis assignments.', objectives: [campaignMission('A', 150), campaignGate(10)] },
        { id: 'crisis-operations', name: 'The crisis ledger', briefing: 'Finish one hundred fifty S-rank combat orders and ten more full Gate descents. The border witnesses are counting who returns when the ordinary patrols turn back.', conclusion: 'The crisis ledger is complete. The quartermaster asks you to face the upper Tower commanders with the same discipline.', objectives: [campaignMission('S', 150), campaignGate(10)] },
        { id: 'vanguard-examination', name: 'The Ravager examination', briefing: 'Earn a fresh Story Tower floor nine victory within par. Your squad must suffer no knockouts, disrupt a pylon and evade a signature strike in the same run.', conclusion: 'The Ravager report reaches the border desk. The last order bears the Sovereign’s seal.', objectives: [examination(9, 'avoid')] },
        { id: 'command-examination', name: 'The Sovereign examination', briefing: 'Clear Story Tower floor ten within par and without a squad knockout. Disrupt a pylon and bait a charge into a pillar during that same run.', conclusion: 'The Sovereign’s seal is filed beneath your command report. The quartermaster leaves the names of your squad visible. The border record remembers who brought them home.', objectives: [examination(10, 'bait')] },
    ],
    'world-boss-awakening': [
        { id: 'approach-seal', name: 'First seal: the muster roads', briefing: 'Carry two hundred twenty-five S-rank combat orders and bring back fifteen full five-floor Gate victories. The joint muster needs a sustained record beyond the border campaign.', conclusion: 'The first village seals your approach ledger. The recorder opens the second operation folder; earlier victories cannot fill it.', objectives: [campaignMission('S', 225), campaignGate(15)] },
        { id: 'muster-seal', name: 'Second seal: the joint line', briefing: 'Finish another two hundred twenty-five S-rank orders and fifteen new full descents. These returns belong to the second operation, not the first.', conclusion: 'The second seal closes the field ledger: four hundred fifty S-rank victories and thirty full returns. The upper Spire now holds the examination orders.', objectives: [campaignMission('S', 225), campaignGate(15)] },
        { id: 'stormglass-examination', name: 'Third seal: the Matriarch examination', briefing: 'Pass a new Spire tier twelve examination. Disrupt a pylon and evade a signature strike while clearing within par without any squad knockout.', conclusion: 'The Matriarch report earns the third seal. The last village asks for two different examinations before it will close the joint order.', objectives: [spireExamination(12, 'avoid')] },
        { id: 'sovereign-examination', name: 'Fourth seal, part one: the Sovereign', briefing: 'Pass a new Spire tier fifteen examination. Disrupt a pylon, bait a charge into a pillar, and finish clean within par in that same victory.', conclusion: 'The Sovereign report records discipline under pressure. The Mirror Shogun still holds the final Master examination.', objectives: [spireExamination(15, 'bait')] },
        { id: 'master-examination', name: 'Fourth seal, part two: the Mirror Shogun', briefing: 'Pass a new Spire tier sixteen examination: clean, within par, with pylon disruption and signature avoidance. Earlier honors cannot replace this run.', conclusion: 'The Mirror Shogun report closes the fourth seal. Your Proven Legacy and complete Master campaign stand beneath the joint order. Return the account to the recorder.', objectives: [spireExamination(16, 'avoid')] },
    ],
    'mythic-legacies': [
        { id: 'grandmaster-roads', name: 'The Grandmaster field record', briefing: 'Carry four hundred fifty new S-rank combat orders and return from thirty complete five-floor Gate victories. Every record starts after this survey opens.', conclusion: 'The keeper binds the first thirty return maps. A second survey begins beyond the lines you have already proved.', objectives: [campaignMission('S', 450), campaignGate(30)] },
        { id: 'grandmaster-deep', name: 'The Grandmaster deep record', briefing: 'Finish another four hundred fifty S-rank orders and thirty new full descents. Both halves are mandatory before the pinnacle examinations.', conclusion: 'Nine hundred S-rank victories and sixty full returns fill the survey. Three upper-Spire witnesses now wait for fresh examination runs.', objectives: [campaignMission('S', 450), campaignGate(30)] },
        { id: 'summit-revenant', name: 'First pinnacle witness: the Revenant', briefing: 'Pass a new Spire tier seventeen examination. Clear clean within par, disrupt a pylon and evade a signature strike in that same run.', conclusion: 'The Revenant confirms the survey squad can hold its resources under late-tier pressure. The Ravager will test its formation next.', objectives: [spireExamination(17, 'avoid')] },
        { id: 'summit-ravager', name: 'Second pinnacle witness: the Ravager', briefing: 'Pass a new Spire tier eighteen examination. Clear within par without a squad knockout, disrupt a pylon and evade a signature strike during that victory.', conclusion: 'The Ravager report joins the summit record. The Emperor of the Last Eclipse holds the final Grandmaster seal.', objectives: [spireExamination(18, 'avoid')] },
        { id: 'grandmaster-examination', name: 'Final witness: the Last Eclipse', briefing: 'Pass a new Spire tier twenty examination. Your squad must disrupt a pylon, evade a signature strike and survive the Emperor’s arena with no knockout, all within the run’s scoring par.', conclusion: 'The Emperor’s report completes the Grandmaster survey. Your chosen Legacy stands at its summit; every field record and examination is sealed. The keeper leaves a place for your account beside the age’s first name.', objectives: [spireExamination(20, 'avoid')] },
    ],
};
// The two narrative perspectives share every required stage; neither bypasses an examination.
for (const chapter of ERA_CHAPTERS) {
    const stages = ERA_CAMPAIGN_STAGES[chapter.eraId];
    if (!stages) continue;
    for (const route of chapter.routes) {
        route.stages = stages;
        route.objectives = stages.flatMap(stage => stage.objectives);
    }
}

export function eraCampaignProgress(chapter: EraChapter, journey: EraJourney | undefined, available: boolean): EraChapterProgress {
    const campaignJourney = journey?.version === 2 ? journey : undefined;
    const route = chapter.routes.find(item => item.id === campaignJourney?.routeId);
    const stages = (route ?? chapter.routes[0])?.stages ?? [];
    const index = campaignJourney?.stageIndex ?? 0;
    const stage = stages[Math.min(index, stages.length - 1)];
    return { eraId: chapter.eraId, available, routeId: route?.id ?? null, startedAt: campaignJourney?.startedAt ?? null,
        completedAt: campaignJourney?.completedAt ?? null, ready: !!campaignJourney && index === stages.length,
        legacyCompletedAt: campaignJourney ? campaignJourney.legacyCompletedAt : journey?.completedAt,
        ...(journey && !campaignJourney ? { historicalRouteId: journey.routeId } : {}),
        objectives: route ? (stage?.objectives ?? []).map(objective => ({ ...objective,
            current: index >= stages.length ? objective.required : campaignJourney?.stageCounts?.[objective.id] ?? 0,
            done: index >= stages.length || (campaignJourney?.stageCounts?.[objective.id] ?? 0) >= objective.required,
        })) : [],
        campaign: { stageIndex: index, stages: stages.map((item, n) => ({ ...item, done: n < index })), briefing: stage?.briefing ?? '',
            recentConclusion: index > 0 ? stages[Math.min(index - 1, stages.length - 1)]?.conclusion : undefined },
    };
}

export function eraMilestoneSummary(milestones: Array<{ label: string; done: boolean }>, trigger: { fired: boolean } | null): string {
    const remaining = milestones.filter(milestone => !milestone.done);
    if (!remaining.length) return trigger && !trigger.fired ? 'Every community measure is met. Awaiting the first mythic awakening.' : 'Every measure is met. The new age is ready to open.';
    return `${milestones.length - remaining.length} of ${milestones.length} community measures met. Still needed: ${remaining.map(item => item.label).join('; ')}.`;
}
