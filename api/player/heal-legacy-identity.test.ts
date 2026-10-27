import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'legacy-heal-identity-session-secret-32-bytes';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let handler: typeof import('./heal.js').default;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./heal.js')).default as unknown as typeof handler;
});
beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    (await import('../_ratelimit.js')).__resetRateLimitsForTest();
});

function response() {
    const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.status = code; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; },
        end() { return res; },
    };
    return { out, res };
}

for (const [healerName, targetName] of [
    ['__proto__', 'legacypatient'], ['constructor', 'legacypatient'],
    ['legacymedic', '__proto__'], ['legacymedic', 'constructor'],
]) {
    test(`cross-heal ${healerName} to ${targetName} preserves ownership and pays once`, async () => {
        await kv.set(`save:${healerName}`, { _saveVersion: 1, character: {
            name: healerName, profession: 'healer', professionXp: 0, professionRank: 1,
            village: 'Ember Village', chakra: 100,
        } });
        await kv.set(`save:${targetName}`, { _saveVersion: 1, character: {
            name: targetName, profession: 'vanguard', village: 'Ember Village',
            hp: 20, maxHp: 100, chakra: 5, maxChakra: 80, stamina: 5, maxStamina: 70,
            hospitalized: true, hospitalizedAt: Date.now(), hospitalizedUntil: Date.now() + 60_000,
        } });
        const request = {
            method: 'POST', query: {},
            body: { healerName, targetName, requestId: 'legacy_cross_heal_receipt_0001' },
            headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(healerName)! },
            socket: { remoteAddress: '127.0.0.1' },
        };
        const first = response();
        await handler(request as never, first.res as never);
        assert.equal(first.out.status, 200, JSON.stringify(first.out.body));
        type Save = { _saveVersion: number; character: {
            name: string; chakra: number; professionXp?: number; hp?: number;
            hospitalized?: boolean; serverSettlementReceipts: unknown[];
        } };
        const healer = await kv.get<Save>(`save:${healerName}`);
        const target = await kv.get<Save>(`save:${targetName}`);
        assert.equal(healer?.character.name, healerName);
        assert.equal(healer?.character.chakra, 80);
        assert.ok(Number(healer?.character.professionXp) > 0);
        assert.equal(healer?.character.serverSettlementReceipts.length, 1);
        assert.equal(target?.character.name, targetName);
        assert.equal(target?.character.hp, 100);
        assert.equal(target?.character.hospitalized, false);
        assert.equal(target?.character.serverSettlementReceipts.length, 1);

        const replay = response();
        await handler(request as never, replay.res as never);
        assert.equal(replay.out.status, 200, JSON.stringify(replay.out.body));
        assert.equal(replay.out.body?.replayed, true);
        assert.deepEqual(await kv.get(`save:${healerName}`), healer);
        assert.deepEqual(await kv.get(`save:${targetName}`), target);
    });
}
