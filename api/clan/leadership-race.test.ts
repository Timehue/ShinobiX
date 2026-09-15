import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const priorEnvironment = Object.fromEntries(['NODE_ENV', 'SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET', 'ADMIN_PASSWORD']
    .map((key) => [key, process.env[key]]));
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Mode = 'kick' | 'upgrade';
type Clan = {
    name: string; founderName: string; members: Array<{ name: string; isFounder?: boolean }>;
    roleOverrides: Record<string, string>; treasury: { ryo: number; warSupply: number };
    upgrades: Record<string, number>;
};
type Player = { _saveVersion: number; character: { name: string; clan: string | null; clanFounder: boolean } };
let kv: typeof import('../_storage.js').kv;
let withKvLock: typeof import('../_lock.js').withKvLock;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let handlers: Record<Mode, Handler>;
let sequence = 0;

before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ withKvLock } = await import('../_lock.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handlers = {
        kick: (await import('./kick.js')).default as unknown as Handler,
        upgrade: (await import('./upgrade/purchase.js')).default as unknown as Handler,
    };
});

after(() => {
    for (const [key, value] of Object.entries(priorEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

async function fixture(mode: Mode, role: 'Officer' | 'Leader' | 'Founder' = 'Officer') {
    const suffix = ++sequence;
    const name = `Race Clan ${suffix}`;
    const clanKey = `save:clan-raceclan${suffix}`;
    const founder = `racefounder${suffix}`;
    const actor = role === 'Founder' ? founder : `raceofficer${suffix}`;
    const target = `racetarget${suffix}`;
    const clan: Clan = {
        name, founderName: founder,
        members: [{ name: founder, isFounder: true }, ...(actor === founder ? [] : [{ name: actor }]), { name: target }],
        roleOverrides: role === 'Founder' ? {} : { [actor]: role },
        treasury: { ryo: 5_000, warSupply: 10 }, upgrades: { trainingGrounds: 0 },
    };
    await kv.set(clanKey, clan);
    for (const player of new Set([founder, actor, target])) {
        await kv.set(`save:${player}`, {
            _saveVersion: 1, character: { name: player, clan: name, clanFounder: player === founder },
        } satisfies Player);
    }
    const token = issuePlayerToken(actor);
    assert.ok(token);
    const post = async (options: { target?: string; admin?: boolean } = {}) => {
        const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
        const response = {
            setHeader: () => response,
            status: (code: number) => { out.statusCode = code; return response; },
            json: (value: Record<string, unknown>) => { out.body = value; return response; },
            end: () => response,
        };
        await handlers[mode]({
            method: 'POST', query: {},
            headers: options.admin ? { 'x-admin-password': process.env.ADMIN_PASSWORD! } : { 'x-player-token': token },
            socket: { remoteAddress: '127.0.0.1' },
            body: { playerName: actor, clan: name, targetName: options.target ?? target, upgradeKey: 'trainingGrounds' },
        } as never, response as never);
        return out;
    };
    const records = async () => ({
        clan: await kv.get<Clan>(clanKey), actor: await kv.get<Player>(`save:${actor}`), target: await kv.get<Player>(`save:${target}`),
    });
    return { clan, clanKey, actor, target, founder, post, records };
}

describe('clan leadership is checked after acquiring shared mutation authority', { concurrency: false }, () => {
    for (const mode of ['kick', 'upgrade'] as const) {
        for (const change of ['demotion', 'roster removal'] as const) {
            it(`${mode} refuses an actor whose ${change} commits while their request waits for the clan lock`, { timeout: 5_000 }, async () => {
                const f = await fixture(mode);
                const held = deferred();
                const release = deferred();
                const attempted = deferred();
                const holder = withKvLock(f.clanKey, async () => { held.resolve(); await release.promise; }, { failClosed: true });
                await held.promise;
                const originalSet = kv.set.bind(kv);
                kv.set = async (key, value, options) => {
                    const result = await originalSet(key, value, options);
                    if (key === `lock:${f.clanKey}` && options?.nx && !result) attempted.resolve();
                    return result;
                };
                const pending = f.post();
                try {
                    await Promise.race([
                        attempted.promise,
                        pending.then((result) => { throw new Error(`Handler returned ${result.statusCode} before contending for the held clan lock.`); }),
                    ]);
                    const changed: Clan = change === 'demotion'
                        ? { ...f.clan, roleOverrides: {} }
                        : { ...f.clan, members: f.clan.members.filter((member) => member.name !== f.actor) };
                    // The latter deliberately retains stale personal clan/role
                    // mirrors: canonical roster removal must still revoke access.
                    await kv.set(f.clanKey, changed);
                    const before = await f.records();
                    release.resolve();
                    await holder;
                    const result = await pending;
                    const after = await f.records();
                    assert.deepEqual({ status: result.statusCode, records: after }, { status: 403, records: before });
                } finally {
                    release.resolve();
                    await holder;
                    await pending;
                    kv.set = originalSet;
                }
            });
        }

        for (const role of ['Officer', 'Leader', 'Founder', 'Admin'] as const) {
            it(`${mode} retains a successful ${role} action and its original effects`, async () => {
                const f = await fixture(mode, role === 'Admin' ? 'Officer' : role);
                const before = await f.records();
                const result = await f.post({ admin: role === 'Admin' });
                assert.equal(result.statusCode, 200, String(result.body?.error));
                const after = await f.records();
                assert.deepEqual(after.actor, before.actor);
                if (mode === 'upgrade') {
                    assert.deepEqual(after.clan?.treasury, { ryo: 2_500, warSupply: 5 });
                    assert.equal(after.clan?.upgrades.trainingGrounds, 1);
                    assert.deepEqual(after.target, before.target);
                } else {
                    assert.equal(after.target?.character.clan, null);
                    assert.equal(after.clan?.members.some((member) => member.name === f.target), false);
                    assert.equal(after.clan?.members.some((member) => member.name === f.founder), true);
                    assert.deepEqual(after.clan?.treasury, before.clan?.treasury);
                }
            });
        }

        it(`${mode} recognizes display-name roster and appointment keys for a slug-authenticated officer`, async () => {
            const f = await fixture(mode);
            const displayName = `Race Officer ${f.actor.replace('raceofficer', '')}`;
            await kv.set(f.clanKey, {
                ...f.clan,
                members: f.clan.members.map((member) => member.name === f.actor ? { ...member, name: displayName } : member),
                roleOverrides: { [displayName]: 'Officer' },
            });
            assert.equal((await f.post()).statusCode, 200);
        });

        it(`${mode} recognizes the canonical founder display name even when its personal mirror is false`, async () => {
            const f = await fixture(mode, 'Founder');
            const displayName = `Race Founder ${f.actor.replace('racefounder', '')}`;
            await kv.set(f.clanKey, {
                ...f.clan, founderName: displayName,
                members: f.clan.members.map((member) => member.name === f.actor ? { ...member, name: displayName } : member),
            });
            const actor = (await kv.get<Player>(`save:${f.actor}`))!;
            await kv.set(`save:${f.actor}`, { ...actor, character: { ...actor.character, clanFounder: false } });
            assert.equal((await f.post()).statusCode, 200);
        });

        it(`${mode} does not grant founder authority from a stale personal mirror`, async () => {
            const f = await fixture(mode);
            await kv.set(f.clanKey, { ...f.clan, roleOverrides: {} });
            const actor = (await kv.get<Player>(`save:${f.actor}`))!;
            await kv.set(`save:${f.actor}`, { ...actor, character: { ...actor.character, clanFounder: true } });
            const before = await f.records();
            assert.equal((await f.post()).statusCode, 403);
            assert.deepEqual(await f.records(), before);
        });

        it(`${mode} fails closed without any mutation when the clan lock remains held`, { timeout: 5_000 }, async () => {
            const f = await fixture(mode);
            const held = deferred();
            const release = deferred();
            const holder = withKvLock(f.clanKey, async () => { held.resolve(); await release.promise; }, { failClosed: true });
            await held.promise;
            try {
                const before = await f.records();
                assert.equal((await f.post()).statusCode, 500);
                assert.deepEqual(await f.records(), before);
            } finally {
                release.resolve();
                await holder;
            }
        });
    }

    it('an officer cannot kick another officer', async () => {
        const f = await fixture('kick');
        await kv.set(f.clanKey, { ...f.clan, roleOverrides: { ...f.clan.roleOverrides, [f.target]: 'Officer' } });
        const before = await f.records();
        assert.equal((await f.post()).statusCode, 403);
        assert.deepEqual(await f.records(), before);
    });

    for (const admin of [false, true]) {
        it(`the founder cannot be kicked (${admin ? 'admin' : 'player'} request)`, async () => {
            const f = await fixture('kick');
            const before = await f.records();
            assert.equal((await f.post({ target: f.founder, admin })).statusCode, 403);
            assert.deepEqual(await f.records(), before);
        });
    }

    it('self-kick still requires the separate Leave action', async () => {
        const f = await fixture('kick');
        assert.equal((await f.post({ target: f.actor })).statusCode, 400);
    });
});
