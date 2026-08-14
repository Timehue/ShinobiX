import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'clan-save-version-echo-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let exchangeHandler: Handler;
let mentorHandler: Handler;
let missionHandler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    exchangeHandler = (await import('./exchange/purchase.js')).default as unknown as Handler;
    mentorHandler = (await import('./mentor.js')).default as unknown as Handler;
    missionHandler = (await import('./mission/claim.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'save:echo*',
        'save:clan-echo*',
        'clan-mentor:echo*',
        'clan-mentor-of:echo*',
        'clan:mission-claimed:echo*',
        'clan:missions-claimed:echo*',
        'audit:clan-exchange:echo*',
        'audit:clan-mentor:*',
        'audit:clan-mission-claim:echo*',
        'audit:clan-points:echo*',
    ]) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
});

function fakeReq(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
        query: {},
    } as never;
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(handler: Handler, body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler(fakeReq(body), res);
    return out;
}

function assertEchoesStoredVersion(out: ResponseOut, stored: Record<string, unknown> | null) {
    assert.equal(out.statusCode, 200);
    assert.ok(stored, 'the mutation must persist a player save');
    assert.equal(out.body?._saveVersion, stored._saveVersion, 'response must echo the exact committed save version');
    assert.deepEqual(out.body?.character, stored.character, 'response character and version must describe the same committed record');
}

describe('clan full-character mutation version echoes', { concurrency: false }, () => {
    it('exchange purchase echoes the version from the record written under its save lock', async () => {
        await kv.set('save:echoexchange', {
            _saveVersion: 3,
            character: { name: 'EchoExchange', clan: 'Echo Exchange', clanPoints: 500, ryo: 10 },
        });
        await kv.set('save:clan-echoexchange', { name: 'Echo Exchange', level: 1, xp: 0, treasury: {} });

        const out = await post(exchangeHandler, {
            playerName: 'EchoExchange',
            clan: 'Echo Exchange',
            itemId: 'smallRyoPouch',
        });
        const stored = await kv.get<Record<string, unknown>>('save:echoexchange');
        assertEchoesStoredVersion(out, stored);
        assert.equal(out.body?._saveVersion, 4);
    });

    it('mentor claim echoes the final sensei version after payout and Clan Point credit', async () => {
        await kv.set('save:echosensei', {
            _saveVersion: 5,
            character: { name: 'EchoSensei', clan: 'Echo Mentors', honorSeals: 0, clanEventContrib: 0, clanPoints: 0 },
        });
        await kv.set('save:echostudent', {
            _saveVersion: 2,
            character: { name: 'EchoStudent', clan: 'Echo Mentors', onboardingStep: 'done', level: 1, ryo: 0 },
        });
        await kv.set('clan-mentor:echosensei', {
            students: [{ studentSlug: 'echostudent', studentName: 'EchoStudent', startedAt: Date.now() - 1_000, claimed: {} }],
        });

        const out = await post(mentorHandler, {
            action: 'claim',
            playerName: 'EchoSensei',
            studentName: 'EchoStudent',
        });
        const stored = await kv.get<Record<string, unknown>>('save:echosensei');
        assertEchoesStoredVersion(out, stored);
        assert.equal(out.body?._saveVersion, 7, 'sensei payout and Clan Point award each advance the save exactly once');
    });

    it('mission claim and idempotent replay echo the final caller version without another bump', async () => {
        await kv.set('save:echomission', {
            _saveVersion: 1,
            character: { name: 'EchoMission', clan: 'Echo Mission', clanPoints: 0 },
        });
        await kv.set('save:clan-echomission', {
            name: 'Echo Mission',
            level: 1,
            xp: 0,
            treasury: {},
            members: [{ name: 'EchoMission', battleContrib: 20, level: 10 }],
        });
        const body = { playerName: 'EchoMission', clan: 'Echo Mission', missionKey: 'battle' };

        const first = await post(missionHandler, body);
        const committed = await kv.get<Record<string, unknown>>('save:echomission');
        assertEchoesStoredVersion(first, committed);
        assert.equal(first.body?._saveVersion, 3, 'contribution and claimant awards are distinct idempotent credits');

        const replay = await post(missionHandler, body);
        const afterReplay = await kv.get<Record<string, unknown>>('save:echomission');
        assertEchoesStoredVersion(replay, afterReplay);
        assert.equal(afterReplay?._saveVersion, committed?._saveVersion, 'replay must not manufacture another save version');
    });
});
