import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ERA_CHAPTERS } from '../../shared/era-chapters.js';
import { recordEraCampaignEvidence } from '../_era-campaign.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';
process.env.ADMIN_PASSWORD = 'era-test-admin';
process.env.SESSION_SECRET = 'era-journey-isolated-test-secret-at-least-32-characters';
let handler: typeof import('./journey.js').default;
let kv: typeof import('../_storage.js').kv;
before(async () => { kv = (await import('../_storage.js')).kv; handler = (await import('./journey.js')).default as unknown as typeof handler; });
async function call(playerName: string, action?: string, eraId = 'shinobi-awakening', routeId = 'field', headers: Record<string, string> = { 'x-admin-password': 'era-test-admin' }) {
    const out = { status: 200, data: {} as any };
    const res = { setHeader() {}, status(status: number) { out.status = status; return this; }, json(data: unknown) { out.data = data; return this; }, end() { return this; } };
    await handler({ method: action ? 'POST' : 'GET', query: { playerName }, body: { playerName, action, eraId, routeId }, headers, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}
async function player(name: string) {
    await kv.set(`save:${name}`, { character: { name, level: 50, village: 'Stormveil Village', hp: 100, chakra: 100, stamina: 100, maxHp: 100, maxChakra: 100, maxStamina: 100, serverTitles: [], earnedTitles: [] } });
    await kv.set(`legacy:stats:${name}`, { missionCompletions: 100, huntCompletions: 100, hollowGateClears: 100, sectorDiscoveries: 100, updatedAt: Date.now() });
}
async function finishFirstCampaign(name: string) {
    const record = await kv.get<any>(`save:${name}`);
    let character = record.character;
    for (let n = 0; n < 60; n++) character = recordEraCampaignEvidence(character, { kind: 'mission', receiptId: `mission:${name}:${n}`, missionId: n < 30 ? 'combat-c-patrol' : 'combat-b-escort', at: Date.now() });
    character = recordEraCampaignEvidence(character, { kind: 'tower', receiptId: `tower:${name}:exam`, at: Date.now(), startedAt: Date.now(), floor: 5, story: true, clean: true, withinPar: true, disrupted: true, avoided: false, baited: false });
    await kv.set(`save:${name}`, { ...record, character });
}
async function finishCampaign(name: string, index: number) {
    const chapter = ERA_CHAPTERS[index]!;
    const record = await kv.get<any>(`save:${name}`);
    let character = record.character;
    let n = 0;
    for (const stage of chapter.routes[0]!.stages!) for (const objective of stage.objectives) {
        for (let i = 0; i < objective.required; i++) {
            const proof = objective.proof, at = Date.now();
            character = recordEraCampaignEvidence(character, proof.kind === 'mission'
                ? { kind: 'mission', receiptId: `${index}:mission:${n++}`, at, missionId: 'combat-s-crisis' }
                : proof.kind === 'gate'
                    ? { kind: 'gate', receiptId: `${index}:gate:${n++}`, at, startedAt: at, depth: 5, floor: 5, bossResolved: true, extracted: true }
                    : { kind: 'tower', receiptId: `${index}:tower:${n++}`, at, startedAt: at, floor: proof.floor, story: proof.mode !== 'spire', spire: proof.mode === 'spire', humanMembers: 4, clean: true, withinPar: true, disrupted: true, avoided: true, baited: true });
        }
    }
    await kv.set(`save:${name}`, { ...record, character });
}
async function finishThrough(name: string, last: number) {
    for (let index = 0; index <= last; index++) {
        assert.equal((await call(name, 'start', ERA_CHAPTERS[index]!.eraId)).status, 200);
        await finishCampaign(name, index);
        assert.equal((await call(name, 'complete', ERA_CHAPTERS[index]!.eraId)).status, 200);
    }
}
async function endgamePlayer(name: string) {
    await player(name);
    const record = await kv.get<any>(`save:${name}`);
    await kv.set(`save:${name}`, { ...record, character: { ...record.character, level: 100, legacy: { legacyId: 'first-steps', stage: 5 } } });
}

test('fresh proof, atomic cosmetic reward, and replay-safe start/completion', async () => {
    await player('erafresh');
    assert.equal((await call('erafresh', 'complete')).status, 409);
    const started = await call('erafresh', 'start');
    assert.equal(started.status, 200);
    assert.equal(started.data.chapter.objectives[0].current, 0);
    assert.equal((await call('erafresh', 'complete')).status, 409, 'historical activity cannot claim a new chapter');
    const replayStart = await call('erafresh', 'start');
    assert.deepEqual(replayStart.data.character.eraJourneys, started.data.character.eraJourneys);
    assert.equal(replayStart.data._saveVersion, started.data._saveVersion);
    assert.equal((await call('erafresh', 'start', 'shinobi-awakening', 'duel')).status, 409);
    await kv.set('legacy:stats:erafresh', { missionCompletions: 103, updatedAt: Date.now() });
    assert.equal((await call('erafresh', 'complete')).status, 409, 'aggregate Legacy counters cannot prove rank or examinations');
    await finishFirstCampaign('erafresh');
    const complete = await call('erafresh', 'complete');
    assert.equal(complete.status, 200);
    assert.ok(complete.data.character.eraJourneys['shinobi-awakening'].completedAt);
    assert.deepEqual(complete.data.character.serverTitles, [ERA_CHAPTERS[0].rewardTitle]);
    const replay = await call('erafresh', 'complete');
    assert.equal(replay.status, 200);
    assert.equal(replay.data._saveVersion, complete.data._saveVersion);
    assert.deepEqual(replay.data.character.serverTitles, complete.data.character.serverTitles);
});

test('Era V requires world unlock and the complete personal ladder; historical counters cannot finish it', async () => {
    await endgamePlayer('eralate');
    await kv.set('game:era-state', { overrides: {} });
    assert.equal((await call('eralate', 'start', 'mythic-legacies')).status, 409);
    const sealed = await call('eralate');
    assert.equal(sealed.data.chapters.find((item: any) => item.eraId === 'mythic-legacies').available, false);
    await finishThrough('eralate', 3);
    assert.equal((await call('eralate', 'start', 'mythic-legacies')).status, 409, 'personal IV cannot replace world V');
    await kv.set('game:era-state', { overrides: { 'mythic-legacies': { status: 'unlocked' } } });
    assert.equal((await call('eralate', 'start', 'mythic-legacies')).status, 200);
    await kv.set('legacy:stats:eralate', { missionCompletions: 999999, sectorDiscoveries: 999999, hollowGateClears: 999999, updatedAt: Date.now() });
    assert.equal((await call('eralate', 'complete', 'mythic-legacies')).status, 409);
    await finishCampaign('eralate', 4);
    const completed = await call('eralate', 'complete', 'mythic-legacies');
    assert.equal(completed.status, 200);
    assert.deepEqual(completed.data.character.serverTitles, ERA_CHAPTERS.map(chapter => chapter.rewardTitle));
    const replay = await call('eralate', 'complete', 'mythic-legacies');
    assert.equal(replay.data._saveVersion, completed.data._saveVersion);
    await kv.set('game:era-state', { overrides: {} });
});

test('unknown routes, unauthenticated access, damaged authority and flag-off fail closed', async () => {
    await player('eraguard');
    assert.equal((await call('eraguard', 'start', 'shinobi-awakening', 'forged')).status, 400);
    assert.equal((await call('eraguard', undefined, undefined, undefined, {})).status, 401);
    const { issuePlayerToken } = await import('../_auth.js');
    assert.equal((await call('eraguard', undefined, undefined, undefined, { 'x-player-name': 'eraowner', 'x-player-token': issuePlayerToken('eraowner')! })).status, 403);
    await kv.set('save:eraguard', { character: { name: 'eraguard', eraJourneys: { 'shinobi-awakening': { routeId: 'field', startedAt: Date.now(), baselines: {} } } } });
    assert.equal((await call('eraguard', 'complete')).status, 500);
    process.env.ENABLE_LEGACY = '0';
    try { assert.equal((await call('eraguard')).status, 404); } finally { process.env.ENABLE_LEGACY = '1'; }
});

test('all five campaigns remain independent of an unavailable aggregate counter sidecar', async t => {
    await endgamePlayer('erasidecar');
    await finishThrough('erasidecar', 2);
    const originalGet = kv.get.bind(kv);
    const patched = t.mock.method(kv, 'get', async (key: string) => {
        if (key === 'legacy:stats:erasidecar') throw new Error('injected-era-counter-read-failure');
        return originalGet(key);
    });
    let view = await call('erasidecar');
    assert.equal(view.status, 200);
    assert.equal(view.data.chapters.find((chapter: any) => chapter.eraId === 'world-boss-awakening').available, true);
    assert.equal((await call('erasidecar', 'start', 'world-boss-awakening', 'field')).status, 200);
    const committed = await originalGet('save:erasidecar');
    view = await call('erasidecar');
    assert.equal(view.status, 200);
    assert.equal(view.data.chapters.find((chapter: any) => chapter.eraId === 'shinobi-awakening').available, true);
    const campaign = view.data.chapters.find((chapter: any) => chapter.eraId === 'world-boss-awakening');
    assert.equal(campaign.available, true); assert.equal(campaign.ready, false);
    assert.equal(campaign.objectives[0].current, 0);
    assert.equal(campaign.objectives[0].required, 225);
    assert.equal((await call('erasidecar', 'complete', 'world-boss-awakening', 'field')).status, 409, 'aggregate totals never supply campaign evidence');
    assert.deepEqual(await originalGet('save:erasidecar'), committed);
    patched.mock.restore();
    view = await call('erasidecar');
    assert.equal(view.data.chapters.find((chapter: any) => chapter.eraId === 'world-boss-awakening').available, true);
});

test('IV/V admission enforces levels, any known Legacy stage and modern predecessor completion', async () => {
    await endgamePlayer('eraadmission');
    assert.match((await call('eraadmission', 'start', 'world-boss-awakening')).data.error, /Era III/);
    await finishThrough('eraadmission', 2);
    let saved = await kv.get<any>('save:eraadmission');
    for (const legacy of [undefined, { legacyId: 'forged', stage: 5 }, { legacyId: 'first-steps', stage: 3 }, { legacyId: 'first-steps', stage: 6 }]) {
        await kv.set('save:eraadmission', { ...saved, character: { ...saved.character, legacy } });
        assert.match((await call('eraadmission', 'start', 'world-boss-awakening')).data.error, /Stage IV/);
    }
    await kv.set('save:eraadmission', { ...saved, character: { ...saved.character, level: 69 } });
    assert.match((await call('eraadmission', 'start', 'world-boss-awakening')).data.error, /level 70/);
    await kv.set('save:eraadmission', { ...saved, character: { ...saved.character, level: 70, legacy: { legacyId: 'first-steps', stage: 4 } } });
    assert.equal((await call('eraadmission', 'start', 'world-boss-awakening')).status, 200, 'basic rarity Proven identity qualifies');
    await finishCampaign('eraadmission', 3);
    assert.equal((await call('eraadmission', 'complete', 'world-boss-awakening')).status, 200);
    await kv.set('game:era-state', { overrides: { 'mythic-legacies': { status: 'unlocked' } } });
    const blocked = (await call('eraadmission', 'start', 'mythic-legacies')).data.error;
    assert.match(blocked, /level 100/); assert.match(blocked, /Stage V/);
    saved = await kv.get<any>('save:eraadmission');
    await kv.set('save:eraadmission', { ...saved, character: { ...saved.character, level: 100, legacy: { legacyId: 'first-steps', stage: 5 } } });
    assert.equal((await call('eraadmission', 'start', 'mythic-legacies')).status, 200);
    await kv.set('game:era-state', { overrides: {} });
});

test('historic IV/V titles and perspectives survive migration but never unlock a successor or skip fresh proof', async () => {
    await endgamePlayer('eraoldmaster');
    await finishThrough('eraoldmaster', 2);
    const saved = await kv.get<any>('save:eraoldmaster');
    await kv.set('save:eraoldmaster', { ...saved, character: { ...saved.character,
        serverTitles: [...saved.character.serverTitles, ERA_CHAPTERS[3]!.rewardTitle, ERA_CHAPTERS[4]!.rewardTitle],
        earnedTitles: [...saved.character.earnedTitles, ERA_CHAPTERS[3]!.rewardTitle, ERA_CHAPTERS[4]!.rewardTitle],
        eraJourneys: { ...saved.character.eraJourneys,
            'world-boss-awakening': { routeId: 'boss', startedAt: 1000, completedAt: 2000, baselines: { muster: 1000 } },
            'mythic-legacies': { routeId: 'gate', startedAt: 1000, completedAt: 2000, baselines: { survey: 2, witnesses: 1 } } } } });
    await kv.set('game:era-state', { overrides: { 'mythic-legacies': { status: 'unlocked' } } });
    assert.equal((await call('eraoldmaster', 'start', 'mythic-legacies', 'gate')).status, 409);
    assert.equal((await call('eraoldmaster', 'start', 'world-boss-awakening', 'field')).status, 409);
    const migrated = await call('eraoldmaster', 'start', 'world-boss-awakening', 'boss');
    assert.equal(migrated.status, 200);
    const journey = migrated.data.character.eraJourneys['world-boss-awakening'];
    assert.equal(journey.version, 2); assert.equal(journey.legacyCompletedAt, 2000); assert.equal(journey.completedAt, undefined);
    assert.equal(migrated.data.character.serverTitles.length, 5);
    assert.equal((await call('eraoldmaster', 'complete', 'world-boss-awakening', 'boss')).status, 409);
    await finishCampaign('eraoldmaster', 3);
    const sealed = await call('eraoldmaster', 'complete', 'world-boss-awakening', 'boss');
    assert.equal(sealed.status, 200); assert.equal(sealed.data.character.serverTitles.length, 5);
    const summit = await call('eraoldmaster', 'start', 'mythic-legacies', 'gate');
    assert.equal(summit.status, 200); assert.equal(summit.data.character.eraJourneys['mythic-legacies'].legacyCompletedAt, 2000);
    assert.equal((await call('eraoldmaster', 'complete', 'mythic-legacies', 'gate')).status, 409);
    await kv.set('game:era-state', { overrides: {} });
});

test('a rejected reward save cannot leave completion without its title', async t => {
    await player('eraatomic');
    await call('eraatomic', 'start');
    await kv.set('legacy:stats:eraatomic', { missionCompletions: 103, updatedAt: Date.now() });
    await finishFirstCampaign('eraatomic');
    const original = kv.compareSet.bind(kv);
    const patched = t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown) => {
        if (key === 'save:eraatomic') throw new Error('injected-era-save-failure');
        return original(key, expected, value);
    });
    assert.equal((await call('eraatomic', 'complete')).status, 500);
    const record = await kv.get<any>('save:eraatomic');
    assert.equal(record.character.eraJourneys['shinobi-awakening'].completedAt, undefined);
    assert.deepEqual(record.character.serverTitles, []);
    patched.mock.restore();
    assert.equal((await call('eraatomic', 'complete')).status, 200);
});

test('II and III are sequential campaigns; old short completion cannot unlock the next', async () => {
    await player('erasequence');
    assert.equal((await call('erasequence', 'start', 'hollow-gate-opens')).status, 409);
    assert.equal((await call('erasequence', 'start', 'village-dominion')).status, 409);
    const record = await kv.get<any>('save:erasequence');
    await kv.set('save:erasequence', { ...record, character: { ...record.character, serverTitles: [ERA_CHAPTERS[0]!.rewardTitle], earnedTitles: [ERA_CHAPTERS[0]!.rewardTitle], eraJourneys: { 'shinobi-awakening': { routeId: 'field', startedAt: 1000, baselines: { orders: 100 }, completedAt: 2000 } } } });
    assert.equal((await call('erasequence', 'start', 'hollow-gate-opens')).status, 409);
    const migrated = await call('erasequence', 'start');
    assert.equal(migrated.status, 200);
    const journey = migrated.data.character.eraJourneys['shinobi-awakening'];
    assert.equal(journey.version, 2); assert.equal(journey.legacyCompletedAt, 2000); assert.equal(journey.completedAt, undefined);
    assert.deepEqual(migrated.data.character.serverTitles, [ERA_CHAPTERS[0]!.rewardTitle]);
    assert.equal((await call('erasequence', 'complete')).status, 409);
    await finishFirstCampaign('erasequence');
    await call('erasequence', 'complete');
    assert.equal((await call('erasequence', 'start', 'hollow-gate-opens')).status, 200);
    assert.equal((await call('erasequence', 'start', 'village-dominion')).status, 409);
    const progress = await call('erasequence');
    assert.equal(progress.data.chapters.find((item: any) => item.eraId === 'hollow-gate-opens').available, true);
    assert.match(progress.data.chapters.find((item: any) => item.eraId === 'village-dominion').blockedReason, /Era II/);
});
