import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let kv: typeof import('../_storage.js').kv;
let loadOrIssueDailyMissions: typeof import('./_progress.js').loadOrIssueDailyMissions;
let loadOrIssueNewbieDailies: typeof import('./_progress.js').loadOrIssueNewbieDailies;
let reportMissionEvent: typeof import('./_progress.js').reportMissionEvent;
let settlePendingMissionXpGrants: typeof import('./_progress.js').settlePendingMissionXpGrants;
let reportNewbieEvent: typeof import('./_progress.js').reportNewbieEvent;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ loadOrIssueDailyMissions, loadOrIssueNewbieDailies, reportMissionEvent, reportNewbieEvent, settlePendingMissionXpGrants } = await import('./_progress.js'));
});

// Hold a real panel read before its issuance write while a completion arrives.
// Without the shared lease the reporter completes first and the panel erases it.
async function duringPanelRead<T>(key: string, panel: () => Promise<T>, report: () => Promise<unknown>) {
    const originalGet = kv.get.bind(kv);
    let release!: () => void;
    let entered!: () => void;
    const resume = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let held = false;
    kv.get = async <U>(candidate: string): Promise<U | null> => {
        const result = await originalGet<U>(candidate);
        if (candidate === key && !held) { held = true; entered(); await resume; }
        return result;
    };
    let panelPromise: Promise<T> | undefined;
    let reportPromise: Promise<unknown> | undefined;
    try {
        panelPromise = panel();
        await started;
        reportPromise = report();
        // The old unprotected issuance lets the reporter write within this gap.
        await new Promise(resolve => setTimeout(resolve, 80));
        release();
        await Promise.all([panelPromise, reportPromise]);
    } finally {
        release();
        await Promise.allSettled([panelPromise, reportPromise]);
        kv.get = originalGet;
    }
}

test('initial panel issuance preserves concurrent deferred XP receipts and exact retries', async () => {
    const playerName = 'dailyissuancerace';
    const now = new Date('2026-10-04T15:00:00Z');
    const key = `missions:daily:${playerName}`;
    const character = { level: 30, profession: 'healer', professionRank: 1, professionXp: 0, village: 'Leaf' };
    await kv.set(`save:${playerName}`, { character });
    let completed: Awaited<ReturnType<typeof reportMissionEvent>> | undefined;
    let finalReceipt = '';
    await duringPanelRead(key, () => loadOrIssueDailyMissions(playerName, 'healer', now, character), async () => {
        const issued = await loadOrIssueDailyMissions(playerName, 'healer', now, character);
        assert.ok(issued);
        const mission = issued.missions[0];
        for (let i = 0; i < mission.target; i++) {
            finalReceipt = `daily-race-${i}`;
            completed = await reportMissionEvent({ playerName, profession: 'healer', kind: mission.kind,
                targetName: `patient${i}`, receiptId: finalReceipt, deferXpAward: true, now });
        }
    });
    assert.ok(completed && completed.xpAwarded > 0);
    const state = await kv.get<import('./_progress.js').DailyMissionsState>(key);
    assert.ok(state?.missions.some(mission => mission.completedAt));
    const receipt = state?.eventReceipts?.find(entry => entry.id === finalReceipt);
    assert.equal(receipt?.xpAwarded, completed.xpAwarded);
    assert.ok(receipt);
    const retry = await reportMissionEvent({ playerName, profession: 'healer', kind: receipt.kind,
        receiptId: finalReceipt, deferXpAward: true, now });
    assert.equal(retry.replayed, true);
    assert.equal(retry.xpAwarded, completed.xpAwarded);
});

test('same-day eligibility repair cannot erase concurrent completion receipts', async () => {
    const playerName = 'dailyrepairrace';
    const now = new Date('2026-10-04T15:00:00Z');
    const key = `missions:daily:${playerName}`;
    const character = { level: 30, profession: 'healer', professionRank: 1, professionXp: 0, village: 'Leaf' };
    await kv.set(`save:${playerName}`, { character });
    const state = await loadOrIssueDailyMissions(playerName, 'healer', now, character);
    assert.ok(state);
    const mission = state.missions[0];
    state.missions[0] = { ...mission, progress: mission.target - 1,
        ...(mission.uniqueTargets ? { uniqueTargets: Array.from({ length: mission.target - 1 }, (_, i) => `patient${i}`) } : {}) };
    state.missions[1] = { ...state.missions[1], templateId: 'unavailable-test-mission',
        eligibility: { requiredProfession: 'healer', minLevel: 100 } };
    await kv.set(key, state);
    await duringPanelRead(key, () => loadOrIssueDailyMissions(playerName, 'healer', now, character), () =>
        reportMissionEvent({ playerName, profession: 'healer', kind: mission.kind, targetName: 'finalpatient',
            receiptId: 'repair-race-completion', deferXpAward: true, now }));
    const saved = await kv.get<import('./_progress.js').DailyMissionsState>(key);
    assert.ok(saved?.missions.find(entry => entry.id === mission.id)?.completedAt);
    assert.ok(saved?.eventReceipts?.find(entry => entry.id === 'repair-race-completion')?.xpAwarded);
});

test('newbie daily issuance preserves concurrent completion and its ryo', async () => {
    const playerName = 'newbiedailyissuancerace';
    const now = new Date('2026-10-04T15:00:00Z');
    const key = `missions:newbie-daily:${playerName}`;
    await kv.set(`save:${playerName}`, { character: { level: 5, ryo: 0 } });
    await duringPanelRead(key, () => loadOrIssueNewbieDailies(playerName, now), async () => {
        const state = await loadOrIssueNewbieDailies(playerName, now);
        const mission = state.missions[0];
        for (let i = 0; i < mission.target; i++) await reportNewbieEvent({ playerName, kind: mission.kind, now });
    });
    const saved = await kv.get<import('./_progress.js').NewbieDailyState>(key);
    assert.ok(saved?.missions.some(mission => mission.completedAt));
    const save = await kv.get<{ character: { ryo: number } }>(`save:${playerName}`);
    assert.ok(save && save.character.ryo > 0);
});

test('a panel repair preserves a newly owed XP grant until its save credit succeeds exactly once', async () => {
    const playerName = 'dailyowedgrantrace';
    const now = new Date('2026-10-04T15:00:00Z');
    const key = `missions:daily:${playerName}`;
    const character = { level: 30, profession: 'healer', professionRank: 1, professionXp: 0, village: 'Leaf' };
    await kv.set(`save:${playerName}`, { character });
    const state = await loadOrIssueDailyMissions(playerName, 'healer', now, character);
    assert.ok(state);
    const mission = state.missions[0];
    state.missions[0] = { ...mission, progress: mission.target - 1,
        ...(mission.uniqueTargets ? { uniqueTargets: Array.from({ length: mission.target - 1 }, (_, i) => `patient${i}`) } : {}) };
    state.missions[1] = { ...state.missions[1], templateId: 'unavailable-test-mission',
        eligibility: { requiredProfession: 'healer', minLevel: 100 } };
    await kv.set(key, state);
    const saveLock = `lock:save:${playerName}`;
    assert.ok(await kv.set(saveLock, 'held-by-a-slow-autosave', { nx: true, ex: 60 }));
    try {
        await duringPanelRead(key, () => loadOrIssueDailyMissions(playerName, 'healer', now, character), () =>
            reportMissionEvent({ playerName, profession: 'healer', kind: mission.kind, targetName: 'finalpatient', now }));
        const saved = await kv.get<import('./_progress.js').DailyMissionsState>(key);
        assert.ok(saved?.missions.find(entry => entry.id === mission.id)?.completedAt);
        assert.equal(saved?.pendingXpGrants?.length, 1, 'the race cannot erase the completion reward it still owes');
        assert.equal(saved.pendingXpGrants[0].xp, mission.xpReward);
    } finally {
        await kv.del(saveLock);
    }
    await settlePendingMissionXpGrants(playerName);
    await settlePendingMissionXpGrants(playerName);
    const save = await kv.get<{ character: { professionXp: number } }>(`save:${playerName}`);
    assert.equal(save?.character.professionXp, mission.xpReward, 'the preserved grant is paid exactly once');
    const saved = await kv.get<import('./_progress.js').DailyMissionsState>(key);
    assert.equal(saved?.pendingXpGrants?.length ?? 0, 0);
});
