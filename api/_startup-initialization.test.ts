import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStartupRecovery } from './_startup-recovery.js';
import { initializeClanBoss, initializeTerritory, STARTUP_LEASE_SECONDS } from './_startup-initialization.js';
import { kv } from './_storage.js';
import { currentKvLockContext, poisonKvLockContext, assertKvLockContext } from './_kv-lock-context.js';
import { WAR_VILLAGES, homeSectorsForVillage } from './_war-map-sectors.js';
import { ANNOUNCEMENTS_KEY, type Announcement } from './_announce.js';
import { CB_REWARDS, CB_WEEK_MS, clanBossWeekId, clanBossWeekKey, clanBossProgressKey, clanBossMemberRewards, type ClanBossProgress } from './clan-boss/_storage.js';
import type { ResourceGatheringState } from '../shared/resource-gathering.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const NOW = Date.UTC(2026, 6, 27, 3);
const unavailable = () => Object.assign(new Error('simulated outage'), { code: 'ECONNRESET' });

function controller() {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const recovery = createStartupRecovery({
        random: () => 0, report: () => undefined,
        schedule(fn, ms) { timers.push({ fn, ms }); return { unref() {} } as ReturnType<typeof setTimeout>; },
        cancel() { timers.length = 0; },
    });
    async function tick(advance?: (ms: number) => void) {
        await flush();
        const timer = timers.shift();
        assert.ok(timer, 'recovery remains pending');
        advance?.(timer.ms);
        timer.fn();
        await flush();
    }
    return { recovery, timers, tick };
}

beforeEach(async () => {
    delete process.env.DISABLE_CLAN_BOSS;
    delete process.env.DISABLE_SCHEDULED_JOBS;
    delete process.env.DISABLE_VILLAGE_WAR;
    for (const key of await kv.keys('*')) await kv.del(key);
});

it('retries unavailable and exhausted storage with the real startup job after failure to acquire its lease', async t => {
    t.mock.method(Date, 'now', () => NOW);
    const set = kv.set.bind(kv);
    let failures = 2;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (String(args[0]).startsWith('cron:lease:startup:') && failures > 0) {
            failures--;
            throw Object.assign(new Error('connection rejected'), { code: failures === 1 ? 'ECONNREFUSED' : '53300' });
        }
        return set(...args);
    });
    const { recovery, tick } = controller();
    const outcome = recovery.start('boss', initializeClanBoss);
    await tick(); await tick();
    assert.equal(await outcome, 'complete');
    assert.ok(await kv.get(clanBossWeekKey(clanBossWeekId(NOW))));
});

it('a retained startup lease is incomplete until expiry; an old 20-hour daily lease does not strand boot recovery', async t => {
    let now = NOW;
    t.mock.method(Date, 'now', () => now);
    const week = clanBossWeekId(now);
    await kv.set(`cron:lease:clan-boss-weekly:${week}`, 'crashed-daily-worker', { ex: 20 * 60 * 60 });
    await kv.set(`cron:lease:startup:clan-boss:${week}`, 'crashed-startup-worker', { ex: STARTUP_LEASE_SECONDS });
    const { recovery, tick, timers } = controller();
    const outcome = recovery.start('boss', initializeClanBoss);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await flush();
    assert.equal(settled, false);
    assert.equal(timers.length, 1);
    assert.equal(await kv.get(clanBossWeekKey(week)), null);
    for (let i = 0; i < 15 && !settled; i++) await tick(ms => { now += ms; });
    assert.equal(await outcome, 'complete');
    assert.ok(now - NOW >= STARTUP_LEASE_SECONDS * 1000);
    assert.equal(await kv.get(`cron:lease:clan-boss-weekly:${week}`), 'crashed-daily-worker');
});

it('replays partially committed territory seeding from a fresh lease context without overwriting owners or resources', async t => {
    t.mock.method(Date, 'now', () => NOW);
    t.mock.method(console, 'log', () => undefined);
    const sectors = WAR_VILLAGES.flatMap(village => [...homeSectorsForVillage(village)]);
    const conqueredKey = `world:territory:${sectors[1]}`;
    const conquered = { sector: sectors[1], ownerVillage: 'Stormveil Village', ownerClan: 'Existing Clan', hp: 123, warSupply: 7, guards: ['guard'], updatedAt: 10 };
    await kv.set(conqueredKey, conquered);
    const firstKey = `world:territory:${sectors[0]}`;
    await kv.set(firstKey, { sector: sectors[0], controlScore: 0, hp: 321, warSupply: 9, guards: ['home-guard'], terrainBuffStat: 'speed', updatedAt: 11 });
    const compareSet = kv.compareSet.bind(kv);
    const writes = new Map<string, number>();
    const contexts = new Set<unknown>();
    let fail = true;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        assertKvLockContext();
        contexts.add(currentKvLockContext()?.health);
        const result = await compareSet(...args);
        writes.set(args[0], (writes.get(args[0]) ?? 0) + Number(result));
        if (fail && args[0] === firstKey) {
            fail = false;
            throw poisonKvLockContext(currentKvLockContext()!, unavailable());
        }
        return result;
    });
    const { recovery, tick } = controller();
    const outcome = recovery.start('territory', initializeTerritory);
    await flush();
    const partial = await kv.get<Record<string, unknown>>(firstKey);
    assert.equal(partial?.ownerVillage, WAR_VILLAGES[0]);
    assert.equal(partial?.hp, 321);
    await tick();
    assert.equal(await outcome, 'complete');
    assert.ok(contexts.size >= 2, 'retry has a fresh unpoisoned lease context');
    assert.equal(writes.get(firstKey), 1);
    assert.equal(writes.has(conqueredKey), false);
    assert.deepEqual(await kv.get(conqueredKey), conquered);
    assert.equal((await kv.get<Record<string, unknown>>(firstKey))?.warSupply, 9);
    assert.deepEqual((await kv.get<Record<string, unknown>>(firstKey))?.guards, ['home-guard']);
    assert.equal((await kv.keys('world:territory:*')).length, 32);
    await initializeTerritory();
    assert.equal(writes.size, 31, 'repeated initialization commits no additional territory');
});

it('a committed boss spawn survives a lost acknowledgement, without creating or announcing a second boss', async t => {
    t.mock.method(Date, 'now', () => NOW);
    const set = kv.set.bind(kv);
    const weekKey = clanBossWeekKey(clanBossWeekId(NOW));
    let created = 0;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        const result = await set(...args);
        if (args[0] === weekKey && args[2]?.nx && result === 'OK') {
            created++;
            throw poisonKvLockContext(currentKvLockContext()!, unavailable());
        }
        return result;
    });
    const { recovery, tick } = controller();
    const outcome = recovery.start('boss', initializeClanBoss);
    await tick();
    assert.equal(await outcome, 'complete');
    assert.equal(created, 1);
    // Spawn announcements are existing best-effort behavior: this lost-ack path
    // creates the boss but does not repair a missed announcement or invent state.
    assert.equal(((await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? []).filter(a => a.type === 'clan-boss-spawn').length, 0);
});

it('recovers after partial boss work and a failed lease release leave its own claim behind until expiry', async t => {
    let now = NOW;
    t.mock.method(Date, 'now', () => now);
    const keys = kv.keys.bind(kv);
    let failScan = true;
    t.mock.method(kv, 'keys', async (pattern: string) => {
        if (failScan && pattern === 'clan-boss:week:*') {
            failScan = false;
            throw poisonKvLockContext(currentKvLockContext()!, unavailable());
        }
        return keys(pattern);
    });
    const delIfEqual = kv.delIfEqual.bind(kv);
    let failRelease = true;
    t.mock.method(kv, 'delIfEqual', async (...args: Parameters<typeof kv.delIfEqual>) => {
        if (failRelease && String(args[0]).startsWith('cron:lease:startup:clan-boss:')) {
            failRelease = false;
            throw unavailable();
        }
        return delIfEqual(...args);
    });
    const { recovery, tick } = controller();
    const outcome = recovery.start('boss', initializeClanBoss);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await flush();
    const weekId = clanBossWeekId(now);
    assert.ok(await kv.get(clanBossWeekKey(weekId)), 'the boss was committed before scan failure');
    assert.ok(await kv.get(`cron:lease:startup:clan-boss:${weekId}`), 'cleanup failed and left the owner claim');
    for (let i = 0; i < 15 && !settled; i++) await tick(ms => { now += ms; });
    assert.equal(await outcome, 'complete');
    assert.ok(now - NOW >= STARTUP_LEASE_SECONDS * 1000);
    assert.equal(await kv.get(`cron:lease:startup:clan-boss:${weekId}`), null);
    assert.equal(((await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? []).filter(a => a.type === 'clan-boss-spawn').length, 1);
});

it('two startup controllers sharing storage converge without duplicate boss announcements or territory commits', async t => {
    t.mock.method(Date, 'now', () => NOW);
    t.mock.method(console, 'log', () => undefined);
    const compareSet = kv.compareSet.bind(kv);
    let commits = 0;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => { const result = await compareSet(...args); commits += Number(result); return result; });
    const a = controller(), b = controller();
    const promises = [a.recovery.start('boss', initializeClanBoss), b.recovery.start('boss', initializeClanBoss), a.recovery.start('territory', initializeTerritory), b.recovery.start('territory', initializeTerritory)];
    await flush();
    while (a.timers.length) await a.tick();
    while (b.timers.length) await b.tick();
    assert.deepEqual(await Promise.all(promises), ['complete', 'complete', 'complete', 'complete']);
    assert.equal(commits, 32);
    assert.equal((await kv.keys('clan-boss:week:*')).length, 1);
    assert.equal(((await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? []).filter(a => a.type === 'clan-boss-spawn').length, 1);
});

it('retries a resolved but unfinished weekly pass, and committed rewards replay exactly once after an outage', async t => {
    t.mock.method(Date, 'now', () => NOW);
    const ended = '2026-W30';
    await kv.set(clanBossWeekKey(ended), { weekId: ended, bossId: 'oni-warlord', spawnedAt: NOW - CB_WEEK_MS, endsAt: NOW - 1 });
    const progress: ClanBossProgress = {
        clanName: 'Recovery Clan', weekId: ended, bossId: 'oni-warlord', weekStartedAt: NOW - CB_WEEK_MS,
        poolMax: 10000, pool: 0, killedAt: NOW - 1000, totalRounds: 1, participants: ['recoverymember'],
        memberAttempts: { recoverymember: 1 }, updatedAt: NOW - 1000,
        assaults: [{ runId: 'recovery-run', by: 'recoverymember', party: ['recoverymember'], damage: 10000, rounds: 1, wiped: false, clean: false, at: NOW - 1000 }],
    };
    await kv.set(clanBossProgressKey(ended, progress.clanName), progress);
    await kv.set('save:clan-recoveryclan', { name: progress.clanName, level: 1, xp: 0, members: [{ name: 'recoverymember' }], treasury: { ryo: 100, fateShards: 0, boneCharms: 0 } });
    const resourceGathering: ResourceGatheringState = {
        fishingXp: 250, miningXp: 100, date: '2026-07-27', attemptsToday: 2,
        nodes: { 'pond-2': { attempts: 2, refillAt: NOW + 5000 } }, receipts: [],
        active: { id: 'existing-field-attempt', nodeId: 'pond-2', activity: 'fishing', startedAt: NOW, expiresAt: NOW + 90_000, skillLevel: 3, mode: 'active', template: 2, hookAt: NOW + 1000, movementSequence: 0 },
    };
    const gatheringToolUses = { 'tool-basic-fishing-pole': 97 };
    await kv.set('save:recoverymember', { character: { name: 'recoverymember', clan: progress.clanName, ryo: 50, fateShards: 0, resourceGathering, gatheringToolUses }, _saveVersion: 1 });
    const keys = kv.keys.bind(kv);
    let omitFirstScan = true;
    t.mock.method(kv, 'keys', async (pattern: string) => {
        if (pattern === 'clan-boss:week:*' && omitFirstScan) { omitFirstScan = false; return []; }
        return keys(pattern);
    });
    const set = kv.set.bind(kv);
    let failFinalWrite = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (failFinalWrite && args[0] === clanBossWeekKey(ended) && (args[1] as { settled?: boolean }).settled) {
            failFinalWrite = false;
            throw poisonKvLockContext(currentKvLockContext()!, unavailable());
        }
        return set(...args);
    });
    const { recovery, tick } = controller();
    const outcome = recovery.start('boss', initializeClanBoss);
    await flush();
    assert.equal((await kv.get<{ settled?: boolean }>(clanBossWeekKey(ended)))?.settled, undefined);
    await tick(); // rewards commit, final settled flag fails
    const clanPaid = await kv.get<Record<string, unknown>>('save:clan-recoveryclan');
    const memberPaid = await kv.get<{ character: Record<string, unknown> }>('save:recoverymember');
    assert.equal((clanPaid?.treasury as { ryo: number }).ryo, 100 + CB_REWARDS[1].ryo);
    assert.equal(memberPaid?.character.ryo, 50 + clanBossMemberRewards(progress)[0]!.ryo);
    assert.deepEqual(memberPaid?.character.resourceGathering, resourceGathering, 'reward replay preserves the new active gathering attempt and skill/node state');
    assert.deepEqual(memberPaid?.character.gatheringToolUses, gatheringToolUses, 'reward replay does not consume tool durability');
    await tick();
    assert.equal(await outcome, 'complete');
    assert.deepEqual(await kv.get('save:clan-recoveryclan'), clanPaid);
    assert.deepEqual(await kv.get('save:recoverymember'), memberPaid);
    assert.equal((await kv.get<{ settled?: boolean }>(clanBossWeekKey(ended)))?.settled, true);
    const announcements = (await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? [];
    assert.equal(announcements.filter(a => a.type === 'clan-boss-spawn').length, 1);
    assert.equal(announcements.filter(a => a.type === 'clan-boss-results').length, 1);
});

it('releases a stale week identity when successful lease acquisition crosses Monday, then initializes the current week', async t => {
    let now = Date.UTC(2026, 6, 26, 23, 59, 59);
    t.mock.method(Date, 'now', () => now);
    const oldWeek = clanBossWeekId(now);
    const set = kv.set.bind(kv);
    let delayed = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        const result = await set(...args);
        if (delayed && String(args[0]).startsWith('cron:lease:startup:clan-boss:')) {
            delayed = false;
            await flush();
            now = NOW;
        }
        return result;
    });
    const { recovery, tick } = controller();
    const outcome = recovery.start('boss', initializeClanBoss);
    await flush(); await flush();
    assert.equal(await kv.get(clanBossWeekKey(oldWeek)), null);
    assert.equal(await kv.get(`cron:lease:startup:clan-boss:${oldWeek}`), null);
    await tick();
    assert.equal(await outcome, 'complete');
    assert.ok(await kv.get(clanBossWeekKey(clanBossWeekId(NOW))));
    assert.equal(await kv.get(clanBossWeekKey(oldWeek)), null);
});

it('recomputes the boss week after a delayed retry and honors kill switches without acquiring leases', async t => {
    let now = Date.UTC(2026, 6, 26, 23, 59, 59);
    t.mock.method(Date, 'now', () => now);
    const oldWeek = clanBossWeekId(now);
    const set = kv.set.bind(kv);
    let fail = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (fail) { fail = false; throw unavailable(); }
        return set(...args);
    });
    const { recovery, tick } = controller();
    const outcome = recovery.start('boss', initializeClanBoss);
    await tick(() => { now = NOW; });
    assert.equal(await outcome, 'complete');
    assert.notEqual(oldWeek, clanBossWeekId(now));
    assert.equal(await kv.get(clanBossWeekKey(oldWeek)), null);
    assert.ok(await kv.get(clanBossWeekKey(clanBossWeekId(now))));
    t.mock.method(kv, 'set', async () => { throw new Error('kill switch must avoid storage'); });
    process.env.DISABLE_CLAN_BOSS = '1';
    process.env.DISABLE_VILLAGE_WAR = '1';
    assert.equal(await initializeClanBoss(), true);
    assert.equal(await initializeTerritory(), true);
    delete process.env.DISABLE_CLAN_BOSS;
    process.env.DISABLE_SCHEDULED_JOBS = '1';
    assert.equal(await initializeClanBoss(), true);
});
