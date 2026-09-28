import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'stat-allocation-gain-window-session-secret';

/*
 * The generic save's per-minute stat window (api/save/[name].ts,
 * MAX_STAT_PER_MINUTE) guards against a client inventing stat points. Spending
 * the player's own banked pool is not a gain, so a big honest allocation must
 * go through; every way of CREATING points must still hit the window.
 */

type Save = { character: Record<string, unknown>; _saveVersion: number; _saveAt: number };
let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./[name].js').default;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

const STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];
const baseStats = (over: Record<string, number> = {}) => ({ ...Object.fromEntries(STAT_KEYS.map((k) => [k, 10])), ...over });

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./[name].js')).default as unknown as typeof handler;
    ({ issuePlayerToken } = await import('../_auth.js'));
});

let previousLedger: string | undefined;
beforeEach(() => { previousLedger = process.env.STRICT_RAW_SAVE_LEDGER; });
after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    if (previousLedger === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
    else process.env.STRICT_RAW_SAVE_LEDGER = previousLedger;
});

async function seed(name: string, character: Record<string, unknown>) {
    await kv.del(`save:${name}`, `save-gains:${name}`);
    for (const key of await kv.keys(`*${name}*`)) await kv.del(key);
    await kv.set(`save:${name}`, {
        _saveVersion: 1, _saveAt: Date.now(),
        // Level 100: lower levels cap each stat well under 1,500, so the window
        // could never be reached there in the first place.
        character: { name, level: 100, ryo: 0, inventory: [], itemStacks: [], equipment: {}, levelLedgerMigrated: true, ...character },
    });
}

async function postSave(name: string, patch: Record<string, unknown>) {
    const stored = await kv.get<Save>(`save:${name}`);
    assert.ok(stored);
    const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.status = code; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; },
        end() { return res; },
    };
    await handler({
        method: 'POST', query: { name },
        headers: { 'x-player-name': name, 'x-player-token': issuePlayerToken(name)! },
        socket: { remoteAddress: '127.0.0.87' },
        body: JSON.parse(JSON.stringify({ ...stored, character: { ...stored.character, ...patch }, _baseSaveVersion: stored._saveVersion })),
    } as never, res as never);
    return { ...out, stored: await kv.get<Save>(`save:${name}`) };
}

test('allocating a large banked pool into one stat is accepted, not rate-limited', async () => {
    process.env.STRICT_RAW_SAVE_LEDGER = '1';
    const name = 'statwindowhonest';
    await seed(name, { stats: baseStats(), unspentStats: 3000 });
    // 2,000 into one stat in one save: over the 1,500/minute cap, but every
    // point comes out of the player's own pool.
    const first = await postSave(name, { stats: baseStats({ strength: 2010 }), unspentStats: 1000 });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((first.stored?.character.stats as Record<string, number>).strength, 2010);
    assert.equal(first.stored?.character.unspentStats, 1000);
    // And again within the same minute: allocations never fill the window.
    // Wait for the accepted save's actual aligned burst window to roll over.
    const nextSaveInMs = first.body?.nextSaveInMs;
    assert.ok(typeof nextSaveInMs === 'number' && nextSaveInMs > 0 && nextSaveInMs <= 3000);
    await new Promise((resolve) => setTimeout(resolve, nextSaveInMs + 25));
    const second = await postSave(name, { stats: baseStats({ strength: 2010, speed: 1010 }), unspentStats: 0 });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal((second.stored?.character.stats as Record<string, number>).speed, 1010);
});

test('points that do not come from the pool are still refused', async () => {
    process.env.STRICT_RAW_SAVE_LEDGER = '1';
    const name = 'statwindowforged';
    await seed(name, { stats: baseStats(), unspentStats: 0 });
    const forged = await postSave(name, { stats: baseStats({ strength: 2010 }), unspentStats: 0 });
    // The entitlement guard restores the stored stats; nothing was created.
    assert.equal((forged.stored?.character.stats as Record<string, number>).strength, 10);
});

test('the legacy unchecked path still hits the per-minute window', async () => {
    // Old saves with an incomplete stat map take incoming stats as-is (no
    // entitlement check) when the strict ledger is off. The window is the only
    // guard there, and exempting allocations must not open it.
    process.env.STRICT_RAW_SAVE_LEDGER = '0';
    const name = 'statwindowlegacy';
    await seed(name, { stats: { strength: 10 }, unspentStats: 0 });
    const out = await postSave(name, { stats: { strength: 2010 }, unspentStats: 0 });
    assert.equal(out.status, 429, JSON.stringify(out.body));
    assert.match(String(out.body?.error), /Stat strength gain rate-limited/);
    assert.equal((out.stored?.character.stats as Record<string, number>).strength, 10);
});
