import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * A daily mission is recorded complete in its daily row, and its reward is
 * credited by a second write, to the save. That credit used to run once, after
 * the completion had committed, and nothing retried it. When the save lock was
 * contended (an autosave under load), the process died, or the write's reply was
 * lost, the player kept the completed mission and lost its profession XP or
 * newbie ryo for good. A repeated report could not help, because the mission
 * already read as complete.
 *
 * The completion now commits together with a pending grant. The credit stamps
 * the grant's id into serverSettlementReceipts in the same save write, and the
 * next report or daily-panel read settles anything still owed. Each case makes
 * the first credit fail AFTER the completion committed, then shows the reward
 * still lands exactly once.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'mission-reward-grant-retry-test-secret';
process.env.ADMIN_PASSWORD = 'mission-reward-grant-retry-admin';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Outcome<T> = { value: T } | { error: Error };

const PREFIX = 'missiongrantqa';
const SKIRMISH_XP = 50;
const ERRAND_RYO = 120;
const STARTING_RYO = 100;

let kv: typeof import('../_storage.js').kv;
let progress: typeof import('./_progress.js');
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let dailyHandler: Handler;
let PET_BREEDING_MIGRATION_VERSION: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    progress = await import('./_progress.js');
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    dailyHandler = (await import('./daily.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys(`*${PREFIX}*`);
    if (keys.length) await kv.del(...keys);
});

after(async () => {
    const keys = await kv.keys(`*${PREFIX}*`);
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
});

const dateKey = (at: Date) => at.toISOString().slice(0, 10);

function character(name: string, extra: Json = {}): Json {
    return {
        name,
        level: 30,
        village: 'Frostfang Village',
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
        pets: [],
        inventory: [],
        hp: 100, maxHp: 100,
        chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100,
        ryo: STARTING_RYO,
        ...extra,
    };
}

// Every report in a case runs at this instant, so a case that straddles 00:00
// UTC cannot see its seeded missions replaced by the next day's set.
const NOW = new Date();

/** A Vanguard one PvP win short of Skirmish (2 wins, 50 XP). */
async function seedVanguard(name: string): Promise<void> {
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: character(name, { profession: 'vanguard', professionXp: 0, professionRank: 1 }),
    });
    await kv.set(`missions:daily:${name}`, {
        date: dateKey(NOW),
        profession: 'vanguard',
        missions: [{
            id: `vanguard-skirmish:${dateKey(NOW)}`,
            templateId: 'vanguard-skirmish',
            kind: 'vanguard-pvp-wins',
            name: 'Skirmish',
            description: 'Win 2 PvP battles.',
            target: 2,
            progress: 1,
            xpReward: SKIRMISH_XP,
            completedAt: null,
            claimed: false,
        }],
    });
}

/** A new shinobi one mission claim short of Errand Runner (2 missions, 120 ryo). */
async function seedNewbie(name: string): Promise<void> {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: character(name) });
    await kv.set(`missions:newbie-daily:${name}`, {
        date: dateKey(NOW),
        missions: [{
            id: `newbie-missions-2:${dateKey(NOW)}`,
            templateId: 'newbie-missions-2',
            kind: 'newbie-missions',
            name: 'Errand Runner',
            description: 'Complete 2 missions.',
            target: 2,
            progress: 1,
            ryoReward: ERRAND_RYO,
            completedAt: null,
        }],
    });
}

/** Hold save:<name>'s lock the way a slow autosave would, so a fail-closed credit gives up. */
async function withSaveLockHeld<T>(name: string, fn: () => Promise<T>): Promise<T> {
    assert.ok(await kv.set(`lock:save:${name}`, 'held-by-a-slow-autosave', { nx: true, ex: 60 }), 'the save lock was free');
    try {
        return await fn();
    } finally {
        await kv.del(`lock:save:${name}`);
    }
}

async function outcome<T>(promise: Promise<T>): Promise<Outcome<T>> {
    try {
        return { value: await promise };
    } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
    }
}

function winReport(name: string) {
    return progress.reportMissionEvent({ playerName: name, profession: 'vanguard', kind: 'vanguard-pvp-wins', now: NOW });
}

function newbieReport(name: string) {
    return progress.reportNewbieEvent({ playerName: name, kind: 'newbie-missions', now: NOW });
}

async function savedCharacter(name: string): Promise<Json> {
    return ((await kv.get<Json>(`save:${name}`))?.character ?? {}) as Json;
}

async function professionXp(name: string): Promise<number> {
    return Number((await savedCharacter(name)).professionXp ?? 0);
}

async function ryo(name: string): Promise<number> {
    return Number((await savedCharacter(name)).ryo ?? 0);
}

async function owedXp(name: string): Promise<Json[]> {
    return ((await kv.get<Json>(`missions:daily:${name}`))?.pendingXpGrants ?? []) as Json[];
}

async function owedRyo(name: string): Promise<Json[]> {
    return ((await kv.get<Json>(`missions:newbie-daily:${name}`))?.pendingRyoGrants ?? []) as Json[];
}

function grantReceipts(saved: Json, kind: string): Json[] {
    const receipts = Array.isArray(saved.serverSettlementReceipts) ? saved.serverSettlementReceipts as Json[] : [];
    return receipts.filter((receipt) => (receipt.value as Json | undefined)?.kind === kind);
}

async function readPanel(name: string, as: 'player' | 'admin' = 'player'): Promise<{ statusCode: number; body?: Json }> {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await dailyHandler({
        method: 'GET',
        query: { playerName: name },
        headers: as === 'player'
            ? { 'x-player-token': issuePlayerToken(name)! }
            : { 'x-admin-password': process.env.ADMIN_PASSWORD },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

describe('a daily mission reward is paid exactly once even when its first credit fails', { concurrency: false }, () => {
    it('pays profession XP left owed by a contended save lock on the next report, once', async () => {
        const name = `${PREFIX}contended`;
        await seedVanguard(name);

        // The win completes Skirmish while an autosave holds the save lock, so
        // the credit cannot run.
        const first = await withSaveLockHeld(name, () => outcome(winReport(name)));
        const row = await kv.get<{ missions: Array<{ completedAt: number | null }> }>(`missions:daily:${name}`);
        assert.ok(row?.missions[0]?.completedAt, 'the completion committed before the credit was attempted');
        assert.equal(await professionXp(name), 0, 'nothing could be credited while the save lock was held');

        // The next report is a win that completes nothing new.
        await winReport(name);
        assert.equal(await professionXp(name), SKIRMISH_XP, 'the next report pays the XP the completion is owed');

        await winReport(name);
        assert.equal(await professionXp(name), SKIRMISH_XP, 'a later report pays nothing twice');
        assert.deepEqual(await owedXp(name), []);
        assert.equal(grantReceipts(await savedCharacter(name), 'daily-mission-xp').length, 1);

        // The report itself no longer fails: its completion had committed.
        assert.ok('value' in first, `the report failed after its completion committed: ${'error' in first ? first.error.message : ''}`);
        assert.equal(first.value.xpAwarded, SKIRMISH_XP);
        assert.deepEqual(first.value.missionsCompleted.map((mission) => mission.id), [`vanguard-skirmish:${dateKey(NOW)}`]);
    });

    it('pays it on the daily panel read and tells the player the version that read committed', async () => {
        const name = `${PREFIX}panel`;
        await seedVanguard(name);
        await withSaveLockHeld(name, () => outcome(winReport(name)));
        assert.equal(await professionXp(name), 0);

        const read = await readPanel(name);
        assert.equal(read.statusCode, 200, JSON.stringify(read.body));
        assert.equal(await professionXp(name), SKIRMISH_XP, 'the read pays what the failed credit left owed');
        const stored = await kv.get<Json>(`save:${name}`);
        assert.equal(read.body?._saveVersion, stored?._saveVersion, 'the client is handed the committed version, so its next autosave is not a 409');

        const again = await readPanel(name);
        assert.equal(await professionXp(name), SKIRMISH_XP, 'a second read pays nothing');
        assert.equal(again.body?._saveVersion, undefined, 'and has no new version to report');
    });

    it('never hands an admin the player\'s save version when the admin\'s read pays the grant', async () => {
        const name = `${PREFIX}adminread`;
        await seedVanguard(name);
        await withSaveLockHeld(name, () => outcome(winReport(name)));

        const read = await readPanel(name, 'admin');
        assert.equal(read.statusCode, 200, JSON.stringify(read.body));
        assert.equal(await professionXp(name), SKIRMISH_XP);
        assert.equal(read.body?._saveVersion, undefined, 'authFetch would adopt it as the admin\'s own base version');
    });

    it('pays newbie ryo left owed by a contended save lock on the next report, once', async () => {
        const name = `${PREFIX}newbie`;
        await seedNewbie(name);

        const first = await withSaveLockHeld(name, () => outcome(newbieReport(name)));
        assert.equal(await ryo(name), STARTING_RYO, 'nothing could be credited while the save lock was held');

        await newbieReport(name);
        assert.equal(await ryo(name), STARTING_RYO + ERRAND_RYO, 'the next report pays the ryo the completion is owed');

        await newbieReport(name);
        assert.equal(await ryo(name), STARTING_RYO + ERRAND_RYO, 'a later report pays nothing twice');
        assert.deepEqual(await owedRyo(name), []);
        assert.equal(grantReceipts(await savedCharacter(name), 'newbie-mission-ryo').length, 1);

        assert.ok('value' in first, `the report failed after its completion committed: ${'error' in first ? first.error.message : ''}`);
        assert.equal(first.value.ryoAwarded, ERRAND_RYO);
    });

    it('still pays newbie ryo owed from before the player chose a profession', async () => {
        const name = `${PREFIX}chose`;
        await seedNewbie(name);
        await withSaveLockHeld(name, () => outcome(newbieReport(name)));

        // The player picks a profession before anything retries the credit.
        const save = (await kv.get<Json>(`save:${name}`))!;
        await kv.set(`save:${name}`, {
            ...save,
            character: { ...(save.character as Json), profession: 'healer', professionXp: 0, professionRank: 1 },
        });

        // claim-mission keeps reporting newbie events after the choice.
        assert.deepEqual(await newbieReport(name), { ryoAwarded: 0, completed: [] });
        assert.equal(await ryo(name), STARTING_RYO + ERRAND_RYO, 'ryo earned as a new shinobi is still theirs');
        assert.deepEqual(await owedRyo(name), []);
    });

    it('pays nothing twice when the credit landed but clearing the owed grant failed', async () => {
        const name = `${PREFIX}cleanup`;
        await seedVanguard(name);
        await withSaveLockHeld(name, () => outcome(winReport(name)));
        assert.equal((await owedXp(name)).length, 1);

        // The credit can run, but the daily row's lock is held, so the grant
        // cannot be cleared afterwards.
        assert.ok(await kv.set(`lock:missions:daily:${name}`, 'held', { nx: true, ex: 60 }));
        let firstSettle: Awaited<ReturnType<typeof progress.settlePendingMissionXpGrants>>;
        try {
            firstSettle = await progress.settlePendingMissionXpGrants(name);
        } finally {
            await kv.del(`lock:missions:daily:${name}`);
        }
        assert.equal(firstSettle.deferred, true);
        assert.equal(firstSettle.saveVersion, Number((await kv.get<Json>(`save:${name}`))?._saveVersion));
        assert.equal(await professionXp(name), SKIRMISH_XP);
        assert.equal((await owedXp(name)).length, 1, 'the grant still reads as owed');

        const retry = await progress.settlePendingMissionXpGrants(name);
        assert.deepEqual(retry, { saveVersion: null, deferred: false }, 'the retry finds the receipt and only clears');
        assert.equal(await professionXp(name), SKIRMISH_XP, 'the retry pays nothing twice');
        assert.deepEqual(await owedXp(name), []);
    });

    it('pays nothing twice when the credit committed but its writer lost the reply', async () => {
        const name = `${PREFIX}lostreply`;
        await seedVanguard(name);
        const saveKey = `save:${name}`;
        const originalCompareSet = kv.compareSet.bind(kv);
        const originalGet = kv.get.bind(kv);
        let committed = false;
        let readbackFailed = false;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            const credits = grantReceipts(((value as Json | null)?.character ?? {}) as Json, 'daily-mission-xp').length > 0;
            if (!committed && key === saveKey && credits) {
                committed = true;
                await originalCompareSet(key, expected, value, options);
                throw new Error('simulated lost reply after the credit committed');
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        kv.get = (async <T>(key: string) => {
            if (committed && !readbackFailed && key === saveKey) {
                readbackFailed = true;
                throw new Error('simulated read-back failure');
            }
            return originalGet<T>(key);
        }) as typeof kv.get;
        let first: Outcome<Awaited<ReturnType<typeof winReport>>>;
        try {
            first = await outcome(winReport(name));
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
            kv.get = originalGet as typeof kv.get;
        }
        assert.equal(committed, true, 'the credit reached the save');
        assert.equal(readbackFailed, true, 'and its writer could not confirm it');
        assert.ok('value' in first, 'the report still answers');
        assert.equal(await professionXp(name), SKIRMISH_XP, 'the credit landed');
        assert.equal((await owedXp(name)).length, 1, 'but the daily row still reads it as owed');

        await winReport(name);
        assert.equal(await professionXp(name), SKIRMISH_XP, 'the retry finds the receipt and pays nothing twice');
        assert.deepEqual(await owedXp(name), []);
        assert.equal(grantReceipts(await savedCharacter(name), 'daily-mission-xp').length, 1);
    });

    it('credits no XP to a different profession than the one that earned it', async () => {
        const name = `${PREFIX}switched`;
        await seedVanguard(name);
        await withSaveLockHeld(name, () => outcome(winReport(name)));

        // The player becomes a Healer before anything retries the credit.
        const save = (await kv.get<Json>(`save:${name}`))!;
        await kv.set(`save:${name}`, {
            ...save,
            character: { ...(save.character as Json), profession: 'healer', professionXp: 0, professionRank: 1 },
        });

        const settled = await progress.settlePendingMissionXpGrants(name);
        assert.deepEqual(settled, { saveVersion: null, deferred: false });
        assert.equal(await professionXp(name), 0, 'Vanguard mission XP is never credited to a Healer');
        assert.deepEqual(await owedXp(name), []);
    });

    it('refuses to pay when the receipt list may have evicted the proof of an earlier credit', async () => {
        const name = `${PREFIX}agedout`;
        await seedVanguard(name);
        await withSaveLockHeld(name, () => outcome(winReport(name)));

        // Fifty newer settlements fill the capped receipt list, so a missing
        // receipt no longer proves the grant unpaid.
        const later = Date.now() + 1_000;
        const save = (await kv.get<Json>(`save:${name}`))!;
        await kv.set(`save:${name}`, {
            ...save,
            character: {
                ...(save.character as Json),
                serverSettlementReceipts: Array.from({ length: 50 }, (_, index) => ({
                    requestId: `other-settlement-${String(index).padStart(4, '0')}`,
                    fingerprint: 'other',
                    value: {},
                    settledAt: later + index,
                })),
            },
        });

        const settled = await progress.settlePendingMissionXpGrants(name);
        assert.deepEqual(settled, { saveVersion: null, deferred: false });
        assert.equal(await professionXp(name), 0, 'unprovable is refused, never paid twice');
        assert.deepEqual(await owedXp(name), [], 'it is logged for reconciliation rather than retried forever');
    });

    it('carries owed XP onto the next day\'s missions and pays it there', async () => {
        const name = `${PREFIX}rollover`;
        await seedVanguard(name);
        await withSaveLockHeld(name, () => outcome(winReport(name)));

        // Tomorrow's first report issues a fresh set. A unique-opponent report
        // without an opponent progresses nothing, so only the owed XP can land.
        const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
        const result = await progress.reportMissionEvent({ playerName: name, profession: 'vanguard', kind: 'vanguard-pvp-unique', now: tomorrow });
        assert.equal(result.xpAwarded, 0);
        const row = await kv.get<Json>(`missions:daily:${name}`);
        assert.equal(row?.date, dateKey(tomorrow), 'the row moved to the new day');
        assert.equal(await professionXp(name), SKIRMISH_XP, 'yesterday\'s owed XP moved with it and was paid');
        assert.deepEqual(await owedXp(name), []);
    });

    it('records no grant for a caller that settles the XP itself (the raid progression saga)', async () => {
        const name = `${PREFIX}deferred`;
        await seedVanguard(name);
        const row = (await kv.get<Json>(`missions:daily:${name}`))!;
        await kv.set(`missions:daily:${name}`, {
            ...row,
            missions: [{
                id: `vanguard-raid-strike:${dateKey(NOW)}`,
                templateId: 'vanguard-raid-strike',
                kind: 'vanguard-raids',
                name: 'Raid Strike',
                description: 'Successfully raid 1 village.',
                target: 1,
                progress: 0,
                xpReward: 60,
                completedAt: null,
                claimed: false,
            }],
        });

        const result = await progress.reportMissionEvent({
            playerName: name,
            profession: 'vanguard',
            kind: 'vanguard-raids',
            receiptId: `raid_${PREFIX}`,
            deferXpAward: true,
            now: NOW,
        });
        assert.equal(result.xpAwarded, 60);
        assert.equal(await professionXp(name), 0, 'the caller credits it in its own receipted write');
        assert.deepEqual(await owedXp(name), []);
    });
});
