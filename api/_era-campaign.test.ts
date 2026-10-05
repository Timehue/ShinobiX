import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERA_CHAPTERS, ERA_CAMPAIGN_STAGES, eraChapterProgress, type EraJourney } from '../shared/era-chapters.js';
import { readEraJourneys, recordEraCampaignEvidence, type EraCampaignEvidence } from './_era-campaign.js';
process.env.ENABLE_LEGACY = '1';
const start = 1000;
function character(id = 'shinobi-awakening'): { eraJourneys: Record<string, EraJourney> } {
    return { eraJourneys: { [id]: { version: 2, routeId: 'field', startedAt: start, baselines: {}, stageIndex: 0, stageStartedAt: start, stageCounts: {}, completedStages: [], proofReceipts: [] } satisfies EraJourney } };
}
function mission(n: number, missionId = 'combat-c-patrol', at = 2000): EraCampaignEvidence { return { kind: 'mission', receiptId: `mission:run-${n}`, missionId, at }; }
function tower(floor: number, receiptId = `tower:${floor}`): Extract<EraCampaignEvidence, { kind: 'tower' }> { return { kind: 'tower', receiptId, at: 2000, startedAt: 2000, floor, story: true, clean: true, withinPar: true, disrupted: true, avoided: true, baited: true }; }
function gate(n: number): Extract<EraCampaignEvidence, { kind: 'gate' }> { return { kind: 'gate', receiptId: `gate:${n}`, at: 2000, startedAt: 2000, depth: 5, floor: 5, bossResolved: true, extracted: true }; }

test('I needs sixty qualified victories in order and a fresh joint examination; totals and replay cannot skip stages', () => {
    let c = character();
    const initial = c;
    for (const evidence of [mission(0, 'combat-d-rank-bandit'), mission(1, 'admin-custom'), mission(2, 'combat-s-crisis', 999), tower(5)]) {
        assert.equal(recordEraCampaignEvidence(c, evidence, 2000), c);
    }
    assert.equal(eraChapterProgress(ERA_CHAPTERS[0]!, c.eraJourneys['shinobi-awakening'], { missionCompletions: 999999 }, true).ready, false);
    for (let n = 0; n < 30; n++) c = recordEraCampaignEvidence(c, mission(n), 2000);
    assert.equal(c.eraJourneys['shinobi-awakening']!.stageIndex, 1);
    assert.deepEqual(c.eraJourneys['shinobi-awakening']!.stageCounts, {});
    assert.equal(recordEraCampaignEvidence(c, mission(0, 'combat-s-crisis'), 2000), c, 'same run cannot credit the next stage');
    assert.equal(recordEraCampaignEvidence(c, mission(31), 2000), c, 'C-rank fails the B-rank stage');
    for (let n = 30; n < 60; n++) c = recordEraCampaignEvidence(c, mission(n, 'combat-b-escort'), 2000);
    assert.equal(c.eraJourneys['shinobi-awakening']!.stageIndex, 2);
    const exam = tower(5);
    for (const override of [{ floor: 4 }, { story: false }, { clean: false }, { withinPar: false }, { disrupted: false }, { startedAt: 1999 }]) {
        assert.equal(recordEraCampaignEvidence(c, { ...exam, ...override }, 2000), c);
    }
    c = recordEraCampaignEvidence(c, exam, 2000);
    assert.equal(c.eraJourneys['shinobi-awakening']!.stageIndex, 3);
    assert.equal(c.eraJourneys['shinobi-awakening']!.completedAt, undefined, 'final title requires sealing the account');
    assert.equal(eraChapterProgress(ERA_CHAPTERS[0]!, c.eraJourneys['shinobi-awakening'], {}, true).ready, true);
    assert.equal(recordEraCampaignEvidence(c, exam, 2000), c);
    assert.deepEqual(readEraJourneys(c.eraJourneys), c.eraJourneys);
    assert.equal(initial.eraJourneys['shinobi-awakening']!.stageIndex, 0, 'source save is not mutated before commit');
});

test('II and III require every workload stage, full Gate wins and their exact same-run Tower feats', () => {
    for (const id of ['hollow-gate-opens', 'village-dominion']) {
        let c = character(id);
        let n = 100;
        for (const [index, stage] of ERA_CAMPAIGN_STAGES[id]!.entries()) {
            for (const objective of stage.objectives) {
                const proof = objective.proof;
                if (proof.kind === 'mission') {
                    assert.equal(recordEraCampaignEvidence(c, mission(n++, 'combat-c-patrol'), 2000), c);
                    for (let i = 0; i < objective.required; i++) c = recordEraCampaignEvidence(c, mission(n++, { C: 'combat-c-patrol', B: 'combat-b-escort', A: 'combat-a-hunt', S: 'combat-s-crisis' }[proof.minimumRank]), 2000);
                    assert.equal(c.eraJourneys[id]!.stageIndex, index, 'mission volume cannot substitute for full descents');
                } else if (proof.kind === 'gate') {
                    for (const override of [{ depth: 3, floor: 3 }, { floor: 4 }, { bossResolved: false }, { extracted: false }, { startedAt: 999 }]) assert.equal(recordEraCampaignEvidence(c, { ...gate(n++), ...override }, 2000), c);
                    for (let i = 0; i < objective.required; i++) c = recordEraCampaignEvidence(c, gate(n++), 2000);
                } else {
                    const evidence = tower(proof.floor);
                    assert.equal(recordEraCampaignEvidence(c, { ...evidence, ...(proof.signature === 'bait' ? { baited: false } : { avoided: false }) }, 2000), c);
                    c = recordEraCampaignEvidence(c, evidence, 2000);
                }
            }
            assert.equal(c.eraJourneys[id]!.stageIndex, index + 1);
            assert.deepEqual(c.eraJourneys[id]!.stageCounts, {});
            readEraJourneys(c.eraJourneys);
        }
    }
});

test('historical short chapters are preserved separately and damaged campaign authority fails closed', () => {
    const old = { routeId: 'duel', startedAt: 1000, baselines: { duel: 100 }, completedAt: 1100 };
    readEraJourneys({ 'shinobi-awakening': old });
    const progress = eraChapterProgress(ERA_CHAPTERS[0]!, old, { pvpWins: 999 }, true);
    assert.equal(progress.ready, false); assert.equal(progress.completedAt, null); assert.equal(progress.legacyCompletedAt, 1100);
    assert.equal(progress.historicalRouteId, 'duel', 'migration retains the perspective the server permits');
    const base = character().eraJourneys['shinobi-awakening']!;
    for (const override of [{ stageIndex: 3, completedStages: [] }, { stageCounts: { 'missions-C': 31 } }, { proofReceipts: ['same', 'same'] }, { completedAt: 2000 }, { stageStartedAt: 999 }]) {
        assert.throws(() => readEraJourneys({ 'shinobi-awakening': { ...base, ...override } }), /Invalid/);
    }
    const c = character();
    process.env.ENABLE_LEGACY = '0';
    try { assert.equal(recordEraCampaignEvidence(c, mission(1), 2000), c); } finally { process.env.ENABLE_LEGACY = '1'; }
});

test('impossible run and completion timelines cannot become campaign proof', () => {
    const c = character();
    for (const startedAt of [NaN, Infinity, 0, 2001]) {
        assert.throws(() => recordEraCampaignEvidence(c, { ...tower(5), startedAt }, 2000), /timeline/);
        assert.throws(() => recordEraCampaignEvidence(c, { ...gate(1), startedAt }, 2000), /timeline/);
    }
    const stages = ERA_CAMPAIGN_STAGES['shinobi-awakening']!;
    const finished = { ...c.eraJourneys['shinobi-awakening'], stageIndex: stages.length, stageStartedAt: 2000,
        completedStages: stages.map(stage => ({ id: stage.id, at: 2000 })), completedAt: 1500 };
    assert.throws(() => readEraJourneys({ 'shinobi-awakening': finished }), /Invalid/);
});

test('IV and V require all S-rank workloads, full descents and distinct fresh public Spire examinations', () => {
    for (const [id, missionTotal, gateTotal] of [['world-boss-awakening', 450, 30], ['mythic-legacies', 900, 60]] as const) {
        let c = character(id);
        let n = 0, missionCount = 0, gateCount = 0;
        const stages = ERA_CAMPAIGN_STAGES[id]!;
        assert.equal(stages.length, 5);
        assert.deepEqual(ERA_CHAPTERS.find(chapter => chapter.eraId === id)!.routes[0]!.stages,
            ERA_CHAPTERS.find(chapter => chapter.eraId === id)!.routes[1]!.stages, 'perspectives cannot bypass a trial');
        for (const [index, stage] of stages.entries()) {
            for (const objective of stage.objectives) {
                if (objective.proof.kind === 'mission') {
                    assert.equal(recordEraCampaignEvidence(c, mission(n++, 'combat-a-hunt'), 2000), c);
                    for (let i = 0; i < objective.required; i++) {
                        const proof = mission(n++, 'combat-s-crisis');
                        c = recordEraCampaignEvidence(c, proof, 2000);
                        assert.equal(recordEraCampaignEvidence(c, proof, 2000), c);
                        missionCount++;
                    }
                    assert.equal(c.eraJourneys[id]!.stageIndex, index, 'missions cannot substitute for Gates');
                } else if (objective.proof.kind === 'gate') {
                    for (const override of [{ depth: 3, floor: 3 }, { bossResolved: false }, { extracted: false }, { startedAt: 999 }]) {
                        assert.equal(recordEraCampaignEvidence(c, { ...gate(n++), ...override }, 2000), c);
                    }
                    for (let i = 0; i < objective.required; i++) { c = recordEraCampaignEvidence(c, gate(n++), 2000); gateCount++; }
                } else {
                    const proof = { ...tower(objective.proof.floor, `spire:${n++}`), story: false, spire: true, humanMembers: 4 };
                    for (const override of [{ story: true, spire: false }, { story: true }, { spire: false }, { humanMembers: 1 }, { humanMembers: 3 }, { clean: false }, { withinPar: false }, { disrupted: false }, { floor: 1 }, { startedAt: 1999 },
                        objective.proof.signature === 'bait' ? { baited: false } : { avoided: false }]) {
                        assert.equal(recordEraCampaignEvidence(c, { ...proof, ...override }, 2000), c);
                    }
                    c = recordEraCampaignEvidence(c, proof, 2000);
                    assert.equal(recordEraCampaignEvidence(c, proof, 2000), c);
                }
            }
            assert.equal(c.eraJourneys[id]!.stageIndex, index + 1);
            assert.deepEqual(c.eraJourneys[id]!.stageCounts, {});
            readEraJourneys(c.eraJourneys);
        }
        assert.equal(missionCount, missionTotal); assert.equal(gateCount, gateTotal);
        assert.equal(c.eraJourneys[id]!.proofReceipts!.length, missionTotal + gateTotal + 3);
        assert.equal(c.eraJourneys[id]!.completedAt, undefined, 'final proof still requires atomic title sealing');
        assert.equal(eraChapterProgress(ERA_CHAPTERS.find(chapter => chapter.eraId === id)!, c.eraJourneys[id], {}, true).ready, true);
    }
});
