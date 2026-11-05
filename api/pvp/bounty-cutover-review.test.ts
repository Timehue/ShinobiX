import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.BOUNTY_OWNER_REFUNDS_ENABLED = '1';
process.env.ADMIN_PASSWORD = 'isolated-narrow-review-admin';
process.env.SESSION_SECRET = 'isolated-narrow-review-session';
let kv: typeof import('../_storage.js').kv;
let refunds: typeof import('./_bounty-deleted-target.js');
let authHandler: any;
let bountyHandler: any;
type Row = import('./_bounty-deleted-target.js').BountyOwnerRefund;
const KEY = 'pvp:bounties';
before(async () => {
    ({ kv } = await import('../_storage.js'));
    refunds = await import('./_bounty-deleted-target.js');
    authHandler = (await import('../player-auth.js')).default;
    bountyHandler = (await import('./bounty.js')).default;
});
beforeEach(async () => { for (const key of await kv.keys('*')) await kv.del(key); });
async function post(handler: any, body: object, admin = false) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() {}, status(code: number) { out.status = code; return this; }, json(value: any) { out.body = value; return this; }, end() {} };
    await handler({ method: 'POST', body, query: {}, headers: admin ? { 'x-admin-password': process.env.ADMIN_PASSWORD } : {},
        socket: { remoteAddress: '127.0.0.97' } }, res);
    return out;
}

test('a credential change refuses a concurrent bounty debit, then a retry publishes a durable identity', async (t) => {
    assert.equal((await post(authHandler, { action: 'register', name: 'kaze', password: 'Original1' })).status, 200);
    for (const name of ['kaze', 'departed']) await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, level: 100, ryo: 10_000, examsPassed: ['jonin'] } });
    assert.equal((await kv.get<any>('auth:kaze')).bountyOwnerId, undefined);
    let release!: () => void;
    let signal!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const hashing = new Promise<void>(resolve => { signal = resolve; });
    const scrypt = crypto.scrypt;
    crypto.scrypt = ((...args: any[]) => {
        const callback = args.pop();
        const held = args[0] === 'Replacement2';
        (scrypt as any)(...args, (error: Error | null, derived: Buffer) => {
            if (held) { signal(); void gate.then(() => callback(error, derived)); }
            else callback(error, derived);
        });
    }) as typeof crypto.scrypt;
    let changed: Awaited<ReturnType<typeof post>> | undefined;
    let ownerId: string | undefined;
    const requestId = crypto.randomUUID();
    const change = post(authHandler, { action: 'change', name: 'kaze', oldPassword: 'Original1', newPassword: 'Replacement2' });
    try {
        let timer: ReturnType<typeof setTimeout>;
        await Promise.race([hashing, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('password change did not reach held hash')), 5_000); })]);
        clearTimeout(timer!);
        const placed = await post(bountyHandler, { action: 'place', playerName: 'kaze', target: 'departed', amount: 2_000, requestId }, true);
        assert.equal(placed.status, 503, JSON.stringify(placed.body));
        assert.equal(placed.body.retryable, true);
        assert.equal((await kv.get<any>('auth:kaze')).bountyOwnerId, undefined);
        assert.equal((await kv.get<any>('save:kaze')).character.ryo, 10_000);
        assert.equal(await kv.get(KEY), null, 'no debit, head or escrow is published while auth is busy');
    } finally {
        release();
        changed = await change;
        crypto.scrypt = scrypt;
    }
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const retry = await post(bountyHandler, { action: 'place', playerName: 'kaze', target: 'departed', amount: 2_000, requestId }, true);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    ownerId = (await kv.get<any>('auth:kaze')).bountyOwnerId;
    assert.ok(ownerId);
    const nextChange = await post(authHandler, { action: 'change', name: 'kaze', oldPassword: 'Replacement2', newPassword: 'ThirdPass3' });
    assert.equal(nextChange.status, 200, JSON.stringify(nextChange.body));
    const afterId = (await kv.get<any>('auth:kaze')).bountyOwnerId;
    const refund = await refunds.refundBountyOnDeletedTarget('departed');
    const balance = (await kv.get<any>('save:kaze')).character.ryo;
    const keys = await kv.keys(`${refunds.BOUNTY_OWNER_REFUND_PREFIX}*`);
    const escrow = await kv.get<Row>(keys[0]);
    t.diagnostic(JSON.stringify({ scenario: 'password-change-versus-first-identity', placementPublishedId: !!ownerId,
        passwordChangeStatus: changed.status, idPreserved: afterId === ownerId, afterIdMissing: afterId === undefined,
        refunded: refund.refunded, balance, hold: escrow?.entries[0].hold }));
    assert.equal(afterId, ownerId, 'current-version password change must not erase the new identity');
    assert.equal(balance, 9_700, 'rightful owner should regain the stake, with only the fee spent');
});

test('duplicate legacy claim IDs must fail closed or preserve the combined escrow amount', async (t) => {
    const id = 'deleted-target:departed:50:duplicate';
    const first = { id, winner: 'kaze', head: { target: 'departed', amount: 1_000, contributors: ['kaze'], updatedAt: 50 }, at: 100, refundHold: 'missing-owner' };
    const second = { id, winner: 'rival', head: { target: 'departed', amount: 2_000, contributors: ['rival'], updatedAt: 50 }, at: 100, refundHold: 'missing-owner' };
    const original = { bounties: [], pendingClaims: [first, second] };
    await kv.set(KEY, original);
    let failure: string | null = null;
    let moved: number | null = null;
    try { moved = await refunds.migrateLegacyBountyRefunds(); }
    catch (error) { failure = String(error); }
    const after = await kv.get<any>(KEY);
    let separateEscrow = 0;
    for (const key of await kv.keys(`${refunds.BOUNTY_OWNER_REFUND_PREFIX}*`)) separateEscrow += (await kv.get<Row>(key))!.head.amount;
    const boardEscrow = (after.pendingClaims ?? []).reduce((sum: number, claim: any) => sum + claim.head.amount, 0);
    t.diagnostic(JSON.stringify({ scenario: 'duplicate-legacy-ids', failure, moved, before: 3_000, boardEscrow, separateEscrow, after: boardEscrow + separateEscrow }));
    assert.match(failure!, /Duplicate legacy refund ID/);
    assert.equal(moved, null);
    assert.deepEqual(after, original);
    assert.equal(separateEscrow, 0);
    assert.equal(boardEscrow + separateEscrow, 3_000, 'migration must preserve both amounts even when IDs collide');
});

test('inspect-only migration must identify raw malformed refunds that normalization drops', async (t) => {
    const raw = { bounties: [], pendingClaims: [{ id: 'deleted-target:departed:malformed', winner: '',
        head: { target: 'departed', amount: 2_000, contributors: ['kaze'], updatedAt: 50 }, at: 100 }] };
    await kv.set(KEY, raw);
    const argv = process.argv;
    const exitCode = process.exitCode;
    let inspectExit: typeof process.exitCode;
    const log = console.log;
    const lines: string[] = [];
    let failure: string | null = null;
    process.argv = [process.execPath, 'scripts/migrate-bounty-refund-escrow.mts'];
    console.log = (...args) => { lines.push(args.join(' ')); };
    try {
        const script = pathToFileURL(resolve('scripts/migrate-bounty-refund-escrow.mts')).href;
        await import(script + '?isolated-narrow-review');
        inspectExit = process.exitCode;
    }
    catch (error) { failure = String(error); }
    finally { process.argv = argv; console.log = log; process.exitCode = exitCode; }
    assert.deepEqual(await kv.get(KEY), raw, 'inspection remains read-only');
    await assert.rejects(refunds.migrateLegacyBountyRefunds(), /manual inspection/, 'apply already rejects this malformed row');
    t.diagnostic(JSON.stringify({ scenario: 'inspect-malformed-raw-refund', failure, lines, rawRefundCount: 1, amount: 2_000 }));
    assert.equal(inspectExit, 1, 'blocked inspection has a nonzero exit status');
    const identified = failure !== null || lines.some(line => /malformed|blocker|departed:malformed/.test(line));
    assert.equal(identified, true, 'inspection must not report an empty clean queue when raw escrow is malformed');
});

test('migration rejects a later duplicate before transferring an earlier valid claim', async () => {
    const claim = (id: string, amount: number) => ({ id, winner: 'kaze', head: { target: 'departed', amount, contributors: ['kaze'], updatedAt: 50 }, at: 100 });
    const raw = { bounties: [], pendingClaims: [claim('deleted-target:departed:valid', 500), claim('deleted-target:departed:duplicate', 1_000), claim('deleted-target:departed:duplicate', 2_000)] };
    await kv.set(KEY, raw);
    await assert.rejects(refunds.migrateLegacyBountyRefunds(), /Duplicate legacy refund ID/);
    assert.deepEqual(await kv.get(KEY), raw);
    assert.deepEqual(await kv.keys(`${refunds.BOUNTY_OWNER_REFUND_PREFIX}*`), []);
});

test('migration preserves unrelated raw claims and board metadata exactly', async () => {
    const untouched = { id: 'duel:unrelated', winner: 'hunter', head: { target: 'elsewhere', amount: 500, contributors: ['rival'], updatedAt: 10 }, at: 20, operatorEvidence: { note: 'retain' } };
    const legacy = { id: 'deleted-target:departed:valid', winner: 'kaze', head: { target: 'departed', amount: 2_000, contributors: ['kaze'], updatedAt: 50 }, at: 100 };
    const raw = { bounties: [], pendingClaims: [untouched, legacy], operatorEvidence: ['retain board field'] };
    await kv.set(KEY, raw);
    assert.equal(await refunds.migrateLegacyBountyRefunds(), 1);
    assert.deepEqual(await kv.get(KEY), { ...raw, pendingClaims: [untouched] });
});

test('identity publication requires the auth lease even for direct helper callers', async () => {
    await kv.set('auth:kaze', { hash: 'fixture', salt: 'fixture' });
    const { bountyOwnerProof } = await import('./_bounty-owner-identity.js');
    await assert.rejects(bountyOwnerProof('kaze'), /auth lease/);
    assert.equal((await kv.get<any>('auth:kaze')).bountyOwnerId, undefined);
});
