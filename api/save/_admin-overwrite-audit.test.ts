import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'admin-overwrite-audit-full-password';
process.env.ADMIN_CONTENT_PASSWORD = 'admin-overwrite-audit-content-password';
process.env.SESSION_SECRET = 'admin-overwrite-audit-session-secret';
process.env.ADMIN_SESSION_SECRET = 'admin-overwrite-audit-admin-session-secret';

/*
 * A raw admin save overwrite (`POST /api/save/<name>?signal=1`) leaves an
 * `audit:admin` record: who (role + credential kind), which save, and a compact
 * diff of the fields it changed. It never records a credential, and a refused
 * overwrite records nothing.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;

const PLAYER = 'overwriteauditee';
const SAVE_KEY = `save:${PLAYER}`;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let readAudit: typeof import('../_audit.js').readAudit;
let auditKey: typeof import('../_audit.js').auditKey;
let issueAdminToken: typeof import('../_auth.js').issueAdminToken;

async function postAdmin(body: Json, headers: Record<string, string>) {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(value: Json) { out.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        query: { name: PLAYER, signal: '1' },
        headers: { 'content-type': 'application/json', ...headers },
        body,
        socket: { remoteAddress: '127.0.0.84' },
    } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./[name].js')).default as unknown as Handler;
    ({ readAudit, auditKey } = await import('../_audit.js'));
    ({ issueAdminToken } = await import('../_auth.js'));
});

beforeEach(async () => {
    await kv.del(SAVE_KEY, `admin-lock:${PLAYER}`, `reset-signal:${PLAYER}`, `ledger:currency:${PLAYER}`, auditKey('admin'));
});

test('an admin overwrite records actor role, target and the changed fields only', async () => {
    await kv.set(SAVE_KEY, {
        _saveVersion: 4,
        character: { name: PLAYER, level: 12, ryo: 222, village: 'Stormveil Village' },
        currentSector: 40,
    });

    const out = await postAdmin({
        _saveVersion: 4,
        character: { name: PLAYER, level: 30, ryo: 222, village: 'Stormveil Village' },
        currentSector: 41,
    }, { 'x-admin-password': process.env.ADMIN_PASSWORD! });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));

    const [entry, ...rest] = await readAudit('admin');
    assert.equal(rest.length, 0, 'exactly one record per overwrite');
    assert.equal(entry.action, 'save.overwrite');
    assert.equal(entry.actor, 'admin:full');
    assert.equal(entry.entityType, 'player');
    assert.equal(entry.entityId, PLAYER);
    const meta = entry.meta as Json;
    assert.equal(meta.role, 'full');
    assert.equal(meta.via, 'password');
    assert.equal(meta.created, false);
    assert.equal(meta.fromVersion, 4);
    assert.equal(meta.toVersion, 5);
    const changed = meta.changedFields as string[];
    assert.ok(changed.includes('character.level'), JSON.stringify(changed));
    assert.ok(changed.includes('currentSector'), JSON.stringify(changed));
    assert.ok(!changed.includes('character.ryo'), 'an unchanged field is not listed');
    assert.ok(!changed.some((f) => f.startsWith('_save')), 'bookkeeping fields are not a change');
    assert.equal((entry.before as Json)['character.level'], 12);
    assert.equal((entry.after as Json)['character.level'], 30);

    const raw = JSON.stringify(await kv.get(auditKey('admin')));
    assert.ok(!raw.includes(process.env.ADMIN_PASSWORD!), 'the admin password never reaches the log');
});

test('a token-authenticated overwrite records the credential kind, never the token', async () => {
    const token = issueAdminToken('full');
    assert.ok(token, 'test admin token must be issued');
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, level: 1 } });
    const out = await postAdmin(
        { _saveVersion: 1, character: { name: PLAYER, level: 2 } },
        { 'x-admin-token': token! },
    );
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const [entry] = await readAudit('admin');
    assert.equal(entry.actor, 'admin:full');
    assert.equal((entry.meta as Json).via, 'token');
    assert.ok(!JSON.stringify(entry).includes(token!), 'the admin token never reaches the log');
});

test('a refused (stale) overwrite leaves no audit record', async () => {
    await kv.set(SAVE_KEY, { _saveVersion: 9, character: { name: PLAYER, level: 5 } });
    const out = await postAdmin(
        { _saveVersion: 3, character: { name: PLAYER, level: 99 } },
        { 'x-admin-password': process.env.ADMIN_PASSWORD! },
    );
    assert.equal(out.statusCode, 409);
    assert.deepEqual(await readAudit('admin'), []);
});

test('creating a save through the admin path is recorded as a creation', async () => {
    const out = await postAdmin(
        { character: { name: PLAYER, level: 1, ryo: 0 } },
        { 'x-admin-password': process.env.ADMIN_PASSWORD! },
    );
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const [entry] = await readAudit('admin');
    assert.equal((entry.meta as Json).created, true);
    assert.equal((entry.meta as Json).fromVersion, null);
    assert.ok(((entry.meta as Json).changedFields as string[]).includes('character'));
});
