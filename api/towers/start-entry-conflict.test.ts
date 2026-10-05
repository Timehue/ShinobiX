import test, { before } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'tower-entry-conflict-test-secret';

let handler: (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let issueToken: typeof import('../_auth.js').issuePlayerToken;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    issueToken = (await import('../_auth.js')).issuePlayerToken;
    handler = (await import('./start.js')).default as unknown as typeof handler;
});

async function start(host: string, token: string) {
    const output: { status: number; body?: Record<string, any> } = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (value: number) => { output.status = value; return res; },
        json: (value: Record<string, any>) => { output.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { hostName: host, mode: 'story', floor: 1 },
        headers: { 'x-player-token': token, 'x-player-name': host },
        socket: { remoteAddress: '127.0.0.31' },
    } as never, res as never);
    return output;
}

test('a direct Story start whose entry debit loses its race twice is a clean, retryable 409', async (t) => {
    const host = 'towerconflict';
    const saveKey = `save:${host}`;
    await kv.set(`auth:${host}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    await kv.set(saveKey, {
        _saveVersion: 1,
        character: { name: host, level: 100, ryo: 100000, hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
            stats: { taijutsuOffense: 2000, taijutsuDefense: 2000, speed: 2000 }, specialty: 'Taijutsu', jutsu: [], inventory: [], equipped: {}, battleTowerAscension: 1 },
    });
    const token = issueToken(host)!;

    // Another writer commits this save during both entry-debit attempts.
    const realCompareSet = kv.compareSet.bind(kv);
    let lost = 0;
    const losing = t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
        if (key === saveKey && lost < 2) { lost += 1; return false; }
        return realCompareSet(key, expected, value, options);
    });
    const refused = await start(host, token);
    assert.equal(lost, 2, 'the debit re-ran once before giving up');
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body?.errorCode, 'save-version-conflict');
    assert.equal((await kv.get<Record<string, any>>(saveKey))!.character.ryo, 100000, 'nothing was charged');
    losing.mock.restore();

    // The lease was released and no publication was left "inconclusive", so the
    // player can start straight away instead of waiting out a recovery grace.
    const retried = await start(host, token);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    const charged = 100000 - (await kv.get<Record<string, any>>(saveKey))!.character.ryo;
    assert.equal(charged, retried.body?.chargedRyo, 'the retry charges exactly one entry');
});

test('a Story start keeps the idle recovery the host earned before the run began', async () => {
    // The entry fee is charged under the run's own battle lease. A plain settle
    // saw that lease as a battle and credited nothing, and the fee's version
    // write then fenced the regeneration cursor and discarded the recovery.
    const host = 'towerrested';
    const saveKey = `save:${host}`;
    await kv.set(`auth:${host}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    const at = Date.now() - 30_000;
    await kv.set(saveKey, {
        _saveVersion: 1,
        _saveAt: at,
        _regenAt: at,
        character: { name: host, level: 100, ryo: 100000, hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100,
            stats: { taijutsuOffense: 2000, taijutsuDefense: 2000, speed: 2000 }, specialty: 'Taijutsu', jutsu: [], inventory: [], equipped: {}, battleTowerAscension: 1 },
    });

    const started = await start(host, issueToken(host)!);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const saved = (await kv.get<Record<string, any>>(saveKey))!;
    // The day's first Story entry is free, but its reservation is still written.
    assert.equal(saved._saveVersion, 2, 'the entry reservation was still written');
    assert.equal(100000 - saved.character.ryo, started.body?.chargedRyo, 'exactly the fee the start reported');
    assert.ok(saved.character.hp >= 40, `hp ${saved.character.hp} lost the idle recovery`);
    assert.ok(saved.character.chakra >= 50, `chakra ${saved.character.chakra} lost the idle recovery`);
    assert.ok(saved.character.stamina >= 30, `stamina ${saved.character.stamina} lost the idle recovery`);
    const lease = await kv.get<{ startedAt: number }>(`battle-lock:${host}`);
    assert.ok(lease, 'the run holds its battle lease');
    const cursor = Number(saved._regenAt);
    assert.ok(cursor <= lease!.startedAt, `cursor ${cursor} credited time inside the run`);
    assert.equal((cursor - at) % 1_000, 0, `cursor ${cursor} was fenced to the write, not carried`);
});
