// Offline audit observations plus recovery checks after the engagement fix.
// Run: node --import tsx docs/audits/eras-2026-10-01/probe.mts
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;

const { kv } = await import('../../../api/_storage.js');
const era = await import('../../../api/_era.js');
const { ANNOUNCEMENTS_KEY, HALL_KEY } = await import('../../../api/_announce.js');
const def = era.ERA_BY_ID.get('mythic-legacies')!;
const observations: Record<string, unknown> = {};

assert.equal(await era.currentEraNumber(), 4);
observations.defaultCurrentEra = await era.currentEraNumber();

await kv.set(era.ERA_STATE_KEY, { overrides: { [def.id]: { status: 'locked' } } });
await era.bumpEraContributionOnce('missions', 'offline:locked-mission');
await era.acknowledgeEraContribution('missions', 'offline:locked-mission');
assert.equal((await era.readEraContributions()).missions, 1);
observations.missionsCountedWhileEraLocked = 1;

await kv.set(era.ERA_STATE_KEY, { overrides: {} });
await era.recordEraTrigger('first-mythic-awakening', { player: 'OfflineFinisher', village: 'Stormveil Village' });
assert.equal((await era.getEraViews()).find(v => v.id === def.id)?.status, 'milestone_active');
assert.equal((await era.getEraViews()).find(v => v.id === def.id)?.trigger?.firedBy, 'OfflineFinisher');
observations.triggerBankedBeforeMilestones = true;

await kv.set('save:OfflineFinisher', { character: { name: 'OfflineFinisher', earnedTitles: [], serverTitles: [] } });
const bystander = { character: { name: 'OfflineBystander', ryo: 100 } };
await kv.set('save:OfflineBystander', bystander);
for (const m of def.milestones) await kv.set(`era:contrib:${m.metric}`, m.required);
assert.deepEqual(await era.checkEraUnlocks(), [def.id]);
assert.equal(await era.currentEraNumber(), 5);
assert.deepEqual(await kv.get('save:OfflineBystander'), bystander);
const finisher = await kv.get<{ character: { serverTitles: string[] } }>('save:OfflineFinisher');
assert.ok(finisher?.character.serverTitles.includes(def.trigger!.title));
assert.equal((await kv.get<unknown[]>(HALL_KEY))?.length, 1);
observations.normalUnlock = { currentEra: 5, finisherTitle: def.trigger!.title, bystanderSaveUnchanged: true, hallEntries: 1 };

// Re-arm only isolated test storage. Fail each delivery to observe recovery.
const effectMarker = `era:effects-done:${def.id}`;
const announcementMarker = `era:announced:${def.id}`;
await kv.del(effectMarker);
await kv.del(announcementMarker);
await kv.del(ANNOUNCEMENTS_KEY);
const originalSet = kv.set.bind(kv);
kv.set = (async (key: string, ...args: unknown[]) => {
    if (key === ANNOUNCEMENTS_KEY) throw new Error('offline-audit-announcement-write-failure');
    return originalSet(key, ...args as [unknown, never]);
}) as typeof kv.set;
try { await era.completeEraEffects(def); } finally { kv.set = originalSet; }
await era.checkEraUnlocks();
assert.equal(await kv.get(effectMarker), true);
assert.equal((await kv.get<unknown[]>(ANNOUNCEMENTS_KEY))?.length, 1);
observations.failedAnnouncement = { effectsMarkedDoneAfterRecovery: true, announcementRecoveredBySweep: true };

await kv.del(effectMarker);
await kv.set('save:OfflineFinisher', { character: { name: 'OfflineFinisher', earnedTitles: [], serverTitles: [] } });
kv.set = (async (key: string, ...args: unknown[]) => {
    if (key === 'save:OfflineFinisher') throw new Error('offline-audit-title-write-failure');
    return originalSet(key, ...args as [unknown, never]);
}) as typeof kv.set;
try { await era.completeEraEffects(def); } finally { kv.set = originalSet; }
await era.checkEraUnlocks();
const afterFailure = await kv.get<{ character: { serverTitles: string[] } }>('save:OfflineFinisher');
assert.equal(await kv.get(effectMarker), true);
assert.deepEqual(afterFailure?.character.serverTitles, [def.trigger!.title]);
observations.failedTitle = { effectsMarkedDoneAfterRecovery: true, titleRecoveredBySweep: true };

console.log(JSON.stringify(observations, null, 2));
