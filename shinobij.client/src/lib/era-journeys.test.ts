import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealEraChapter } from './era-journeys';
import { eraMilestoneSummary } from '../../../shared/era-chapters';
import { ERA_CHAPTERS, eraChapterProgress, type EraJourney } from '../../../shared/era-chapters';
test('era summary reports mandatory blockers instead of averaged nearness', () => {
    assert.match(eraMilestoneSummary([{ label: 'Missions', done: true }, { label: 'Duels', done: false }], { fired: true }), /1 of 2.*Duels/);
    assert.match(eraMilestoneSummary([{ label: 'Waived', done: true }], { fired: false }), /Awaiting the first mythic awakening/);
});

test('campaign receipts require the current version and matching stage; an old title is not a new completion', async () => {
    const chapter = ERA_CHAPTERS[0]!;
    const journey: EraJourney = { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: 3, stageStartedAt: 2000, stageCounts: {}, completedStages: [], proofReceipts: [], completedAt: 3000 };
    const valid = { ok: true, _saveVersion: 2, chapter: eraChapterProgress(chapter, journey, {}, true), character: { name: 'Mika', eraJourneys: { [chapter.eraId]: journey }, serverTitles: [chapter.rewardTitle] } };
    const fetcher = (data: unknown) => (async () => new Response(JSON.stringify(data))) as typeof fetch;
    assert.equal((await sealEraChapter('Mika', chapter.eraId, 'complete', undefined, fetcher(valid))).saveVersion, 2);
    for (const override of [{ version: undefined }, { stageIndex: 1 }, { completedAt: 4000 }]) {
        const data = { ...valid, character: { ...valid.character, eraJourneys: { [chapter.eraId]: { ...journey, ...override } } } };
        await assert.rejects(sealEraChapter('Mika', chapter.eraId, 'complete', undefined, fetcher(data)), /could not be verified/);
    }
});
test('era client rejects a foreign character, invalid version, or unearned completion', async () => {
    for (const extra of [{ character: { name: 'SomeoneElse' } }, { _saveVersion: -1 }, { character: { name: 'Mika', eraJourneys: { 'shinobi-awakening': { routeId: 'field', completedAt: 1 } }, serverTitles: [] } }]) {
        const data = { ok: true, _saveVersion: 1, chapter: { eraId: 'shinobi-awakening', routeId: 'field' }, ...extra };
        await assert.rejects(sealEraChapter('Mika', 'shinobi-awakening', 'complete', undefined, (async () => new Response(JSON.stringify(data), { status: 200 })) as typeof fetch), /could not be verified/);
    }
});
