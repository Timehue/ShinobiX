import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-authority-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
let startHandler: Handler;
let resultHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let token = '';
const PLAYER = 'petauthorityprobe';

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(body: Record<string, unknown>) {
    return {
        method: 'POST', body,
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    token = auth.issuePlayerToken(PLAYER)!;
    startHandler = (await import('./battle-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, level: 1, ryo: 0, professionRank: 0,
            pets: [{
                id: 'owned-pet', name: 'Owned Pet', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
                hp: 300, attack: 60, defense: 40, speed: 35,
                jutsus: [{ name: 'Strike', power: 50, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
            }],
        },
    });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('casual pet start ignores a chosen seed, seals pet-strength reward, and permits only one active receipt', async () => {
    const body = {
        playerName: PLAYER,
        playerPetIds: ['owned-pet'],
        opponentPetIds: ['generic-ai-pet-sparrow'],
        mode: '1v1',
        seed: 0,
        reportKey: 'caller-selected',
    };
    const first = response();
    await startHandler(request(body), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.ok(Number(first.out.body?.seed) > 0);
    assert.notEqual(first.out.body?.reportKey, 'caller-selected');

    const stored = await kv.get<{ rewardRyo?: number }>(`pet:battle-token:${PLAYER}:${String(first.out.body?.token)}`);
    assert.ok(Number(stored?.rewardRyo) >= 20);

    const duplicate = response();
    await startHandler(request(body), duplicate.res);
    assert.equal(duplicate.out.statusCode, 200);
    assert.equal(duplicate.out.body?.token, first.out.body?.token);
    assert.equal(duplicate.out.body?.seed, first.out.body?.seed);

    const settled = response();
    await resultHandler(request({
        playerName: PLAYER,
        outcome: 'draw',
        reportKey: first.out.body?.reportKey,
        battleToken: first.out.body?.token,
    }), settled.res);
    assert.equal(settled.out.statusCode, 200);

    const next = response();
    await startHandler(request(body), next.res);
    assert.equal(next.out.statusCode, 200);
});
