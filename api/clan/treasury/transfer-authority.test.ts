import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Actual transfer handler, token verification, locks and settlement writes;
// only persistence is replaced by the guarded per-process QA memory store.
const priorEnvironment = Object.fromEntries(
    ['NODE_ENV', 'SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET', 'ADMIN_PASSWORD']
        .map(key => [key, process.env[key]]),
);
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };
type Member = { name: string; isFounder?: boolean; battleContrib?: number };
type Clan = {
    founderName: string;
    members: Member[];
    roleOverrides: Record<string, string>;
    treasury: { ryo: number; items: Array<{ itemId: string; count: number }> };
};
type PlayerSave = { _saveVersion: number; character: { name: string; clan: string; level: number; ryo: number; inventory: string[] } };

let handler: Handler;
let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: typeof import('../../_auth.js').issuePlayerToken;
let safeName: typeof import('../../_utils.js').safeName;
let clanRecordKey: typeof import('../../_utils.js').clanRecordKey;
let sequence = 0;

before(async () => {
    const storage = await import('../../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('../../_auth.js'));
    ({ safeName, clanRecordKey } = await import('../../_utils.js'));
    handler = (await import('./transfer.js')).default as unknown as Handler;
});

after(() => {
    for (const [key, value] of Object.entries(priorEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

async function fixture() {
    const suffix = ++sequence;
    const clanName = `Authority Clan ${suffix}`;
    const actor = `Rin Vale ${suffix}`;
    const recipient = `Mio Tide ${suffix}`;
    const actorSlug = safeName(actor);
    const clanKey = clanRecordKey(clanName);
    const recipientKey = `save:${safeName(recipient)}`;
    const clan: Clan = {
        founderName: `Aka Ito ${suffix}`,
        members: [
            { name: `Aka Ito ${suffix}`, isFounder: true },
            { name: actor, battleContrib: 2_000 },
            { name: `Other One ${suffix}`, battleContrib: 1_000 },
            { name: `Other Two ${suffix}`, battleContrib: 900 },
            { name: `Other Three ${suffix}`, battleContrib: 800 },
            { name: recipient },
        ],
        roleOverrides: {},
        treasury: { ryo: 100, items: [{ itemId: 'rustfang-kunai', count: 1 }] },
    };
    const actorRow = clan.members.find(member => member.name === actor)!;
    const writeClan = () => kv.set(clanKey, clan);
    await writeClan();
    for (const name of [actor, recipient]) {
        await kv.set(`save:${safeName(name)}`, {
            _saveVersion: 1,
            character: { name, clan: clanName, level: 20, ryo: 10, inventory: [] },
        } satisfies PlayerSave);
        await kv.set(`auth-session:${safeName(name)}`, 0);
    }
    const token = issuePlayerToken(actor);
    assert.ok(token);
    let requestSequence = 0;
    const post = async (body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<ResponseOut> => {
        const out: ResponseOut = { statusCode: 200 };
        const response = {
            setHeader: () => response,
            status: (code: number) => { out.statusCode = code; return response; },
            json: (value: Record<string, unknown>) => { out.body = value; return response; },
            end: () => response,
        };
        await handler({
            method: 'POST',
            headers: { 'x-player-name': actorSlug, 'x-player-token': token, ...headers },
            socket: { remoteAddress: '127.0.0.1' },
            body: {
                clanName, recipientName: recipient, currency: 'ryo', amount: 25,
                requestId: `clan-authority-${suffix}-${++requestSequence}`,
                ...body,
            },
        } as never, response as never);
        return out;
    };
    const records = async () => ({
        clan: await kv.get<Clan>(clanKey),
        recipient: await kv.get<PlayerSave>(recipientKey),
    });
    const expectDenied = async (body: Record<string, unknown> = {}) => {
        const before = await records();
        const result = await post(body);
        const after = await records();
        assert.equal(result.statusCode, 403, JSON.stringify({
            error: result.body?.error,
            treasuryBefore: before.clan?.treasury,
            treasuryAfter: after.clan?.treasury,
            recipientRyoBefore: before.recipient?.character.ryo,
            recipientRyoAfter: after.recipient?.character.ryo,
        }));
        assert.match(String(result.body?.error), /Only clan leadership/);
        assert.deepEqual(after, before, 'a leadership refusal must leave both authoritative records unchanged');
        assert.equal((await kv.keys(`xfer:out:${actorSlug}:*`)).length, 0, 'a refused gift must not spend outbound budget');
    };
    const expectGift = async () => {
        const result = await post();
        assert.equal(result.statusCode, 200, String(result.body?.error));
        const after = await records();
        assert.equal(after.clan?.treasury.ryo, 75);
        assert.equal(after.recipient?.character.ryo, 32);
        assert.equal(result.body?.burned, 3);
        assert.equal(result.body?.amount, 22);
        // The officer's client adopts any top-level _saveVersion as its own
        // save's version; the member's would wedge every later autosave.
        assert.equal('_saveVersion' in (result.body ?? {}), false, "the recipient's save version must not reach the officer");
    };
    return { actor, actorSlug, actorRow, clan, clanKey, post, records, writeClan, expectDenied, expectGift };
}

describe('clan treasury appointed leadership authority', { concurrency: false }, () => {
    it('rejects the top contributor without an appointment before moving ryo', async () => {
        const f = await fixture();
        await f.expectDenied();
    });

    it('rejects contribution-ranked officer slots without appointments', async () => {
        const f = await fixture();
        f.actorRow.battleContrib = 850;
        await f.writeClan();
        await f.expectDenied();
    });

    it('rejects the same unauthorized path for treasury items', async () => {
        const f = await fixture();
        await f.expectDenied({ currency: undefined, itemId: 'rustfang-kunai' });
    });

    for (const role of ['Leader', 'Officer']) {
        it(`allows an explicitly appointed ${role} with lower contribution`, async () => {
            const f = await fixture();
            f.actorRow.battleContrib = 0;
            f.clan.roleOverrides[f.actor] = role;
            await f.writeClan();
            await f.expectGift();
        });
    }

    for (const keyShape of ['slug', 'mixed-display']) {
        it(`recognizes an appointment stored under a ${keyShape} name`, async () => {
            const f = await fixture();
            f.actorRow.battleContrib = 0;
            f.clan.roleOverrides[keyShape === 'slug' ? f.actorSlug : f.actor.toUpperCase()] = 'Officer';
            await f.writeClan();
            await f.expectGift();
        });
    }

    it('recognizes the canonical founder before a stale Member override', async () => {
        const f = await fixture();
        f.clan.founderName = f.actor.toUpperCase();
        f.clan.roleOverrides[f.actor] = 'Member';
        await f.writeClan();
        await f.expectGift();
    });

    it('revokes a removed appointment for a new request from the same authenticated session', async () => {
        const f = await fixture();
        f.clan.roleOverrides[f.actor] = 'Officer';
        await f.writeClan();
        await f.expectGift();
        // Preserve the completed transfer and its receipt; only the appointment changes.
        const current = (await f.records()).clan!;
        await kv.set(f.clanKey, { ...current, roleOverrides: {} });
        const before = await f.records();
        const next = await f.post();
        assert.equal(next.statusCode, 403, 'a fresh gift must re-read the removed appointment');
        assert.deepEqual(await f.records(), before);
    });

    it('requires current roster membership even when an old appointment remains', async () => {
        const f = await fixture();
        f.clan.roleOverrides[f.actor] = 'Leader';
        f.clan.members = f.clan.members.filter(member => member.name !== f.actor);
        await f.writeClan();
        await f.expectDenied();
    });

    it('does not grant Founder authority from a non-founder member flag', async () => {
        const f = await fixture();
        f.actorRow.isFounder = true;
        await f.writeClan();
        await f.expectDenied();
    });

    it('accepts only Leader or Officer appointments for a non-founder', async () => {
        const f = await fixture();
        f.clan.roleOverrides[f.actor] = 'Founder';
        await f.writeClan();
        await f.expectDenied();
    });

    it('ignores request-supplied founder claims for an ordinary member', async () => {
        const f = await fixture();
        f.actorRow.battleContrib = 0;
        await f.writeClan();
        await f.expectDenied({ isFounder: true, founderName: f.actor, role: 'Founder' });
    });

    it('a gift to yourself returns your character with its save version, which the Clan Hall commits', async () => {
        const f = await fixture();
        f.clan.roleOverrides[f.actor] = 'Officer';
        await f.writeClan();
        const result = await f.post({ recipientName: f.actor });
        assert.equal(result.statusCode, 200, String(result.body?.error));
        const own = await kv.get<PlayerSave>(`save:${f.actorSlug}`);
        assert.equal(own?.character.ryo, 32);
        assert.deepEqual(result.body?.character, own?.character);
        assert.equal(result.body?._saveVersion, own?._saveVersion);
    });

    it('does not accept a founder name header with another member token', async () => {
        const f = await fixture();
        const before = await f.records();
        const result = await f.post({}, { 'x-player-name': f.clan.founderName });
        assert.equal(result.statusCode, 401);
        assert.deepEqual(await f.records(), before);
    });
});
