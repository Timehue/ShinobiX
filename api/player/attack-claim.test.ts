process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'attack-claim-test-secret-32-bytes-long';

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The open-world attack claim: /api/player/attack as an admission GATE, and
 * /api/player/clear-attack as its release.
 *
 * Both handlers were fully built and registered but had no caller — commit
 * 416757ce0 replaced the client's attack POST with the new challenge POST when
 * shared-KV sessions landed. Nothing failed, because the challenge is what
 * routes the defender into the fight; only the gate was lost. These tests pin
 * what the gate is FOR, so it cannot go quietly dead a second time.
 */

let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let attackHandler: (req: never, res: never) => Promise<unknown>;
let clearHandler: (req: never, res: never) => Promise<unknown>;
let ATTACKABLE_MIN_LEVEL: number;

before(async () => {
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ ATTACKABLE_MIN_LEVEL } = await import('../_realtime/presence-gating.js'));
    attackHandler = (await import('./attack.js')).default as unknown as typeof attackHandler;
    clearHandler = (await import('./clear-attack.js')).default as unknown as typeof clearHandler;
});

type ResponseOut = { statusCode: number; body: Record<string, unknown> };

async function post(
    handler: (req: never, res: never) => Promise<unknown>,
    actor: string,
    body: Record<string, unknown>,
    ip: string,
): Promise<ResponseOut> {
    const token = issuePlayerToken(actor);
    assert.ok(token, 'test session token should be minted');
    const out: ResponseOut = { statusCode: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.statusCode = code; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body,
        headers: { 'x-player-name': actor, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

let ipSeed = 0;
const nextIp = () => `10.20.0.${++ipSeed}`;

/*
 * /api/player/attack is rate limited 6-per-60s keyed on the ACTOR NAME (not the
 * IP), and the limiter's window outlives a single test. So every test mints its
 * own attacker slug — reusing one across tests silently turns later cases into
 * 429s that look like gate failures.
 */
let actorSeed = 0;
const nextRaider = () => `raider${++actorSeed}`;

function place(name: string, sector: number, level: number, extra: Record<string, unknown> = {}) {
    onlineStore.upsert({ name, sector, character: { name, level, ...extra } });
}

beforeEach(() => {
    for (const player of onlineStore.list()) onlineStore.remove(player.name);
});

test('attack: a co-located target is claimable, and the claim is what marks them engaged', async () => {
    const raider = nextRaider();
    place(raider, 12, 40);
    place('quarry', 12, 40);

    const out = await post(attackHandler, raider, { targetName: 'quarry', attacker: { name: raider } }, nextIp());
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.equal(out.body.ok, true);

    const engaged = onlineStore.get('quarry')?.pendingAttacker as { name?: string } | null;
    assert.equal(engaged?.name, raider,
        'the claim must stamp pendingAttacker — that is what sessionOpponentBlock reads');
});

test('attack: the newcomer floor is level 10, and it applies on the world path', async () => {
    // Owner ruling 2026-08-30: a player is protected only until level 10. The
    // gate must agree with the session chokepoint's ATTACKABLE_MIN_LEVEL check,
    // so a raid this refuses is exactly one that would have been refused there.
    // Explicitly NOT ACADEMY_MIN_LEVEL (15) — that would protect levels 10-14,
    // which the ruling rejects.
    const raider = nextRaider();
    place(raider, 12, 40);
    place('rookie', 12, ATTACKABLE_MIN_LEVEL - 1);

    const out = await post(attackHandler, raider, { targetName: 'rookie', attacker: { name: raider } }, nextIp());
    assert.equal(out.statusCode, 403, JSON.stringify(out.body));
    assert.match(String(out.body.error), /newcomer protection/i);
    assert.equal(onlineStore.get('rookie')?.pendingAttacker ?? null, null,
        'a refused claim must not leave the target engaged');

    place('genin', 12, ATTACKABLE_MIN_LEVEL);
    const allowed = await post(attackHandler, raider, { targetName: 'genin', attacker: { name: raider } }, nextIp());
    assert.equal(allowed.statusCode, 200, 'exactly at the threshold is attackable');
});

test('attack: refuses a target in another sector or in a safe zone', async () => {
    const raider = nextRaider();
    place(raider, 12, 40);
    place('elsewhere', 13, 40);
    place('intown', 0, 40);

    const crossSector = await post(attackHandler, raider, { targetName: 'elsewhere', attacker: { name: raider } }, nextIp());
    assert.equal(crossSector.statusCode, 409, JSON.stringify(crossSector.body));

    const safeZone = await post(attackHandler, raider, { targetName: 'intown', attacker: { name: raider } }, nextIp());
    assert.equal(safeZone.statusCode, 409, JSON.stringify(safeZone.body));
    assert.match(String(safeZone.body.error), /safe zone/i);
});

test('attack: a second raider is refused while the first still holds the claim', async () => {
    const first = nextRaider();
    const second = nextRaider();
    place(first, 12, 40);
    place(second, 12, 40);
    place('quarry', 12, 40);

    assert.equal((await post(attackHandler, first, { targetName: 'quarry', attacker: { name: first } }, nextIp())).statusCode, 200);
    const contested = await post(attackHandler, second, { targetName: 'quarry', attacker: { name: second } }, nextIp());
    assert.equal(contested.statusCode, 409, JSON.stringify(contested.body));
    assert.match(String(contested.body.error), /already engaged/i);
});

test('attack: cannot claim on someone else\'s behalf', async () => {
    const raider = nextRaider();
    place(raider, 12, 40);
    place('quarry', 12, 40);
    const out = await post(attackHandler, raider, { targetName: 'quarry', attacker: { name: 'someoneelse' } }, nextIp());
    assert.equal(out.statusCode, 403, JSON.stringify(out.body));
});

test('clear-attack: the attacker who stamped a claim may release it', async () => {
    // The failure path this exists for: the claim lands, then session creation is
    // refused. Without a release the target shows a phantom "under attack" and
    // reads as engaged to everyone else until their next heartbeat drains it.
    const raider = nextRaider();
    place(raider, 12, 40);
    place('quarry', 12, 40);
    assert.equal((await post(attackHandler, raider, { targetName: 'quarry', attacker: { name: raider } }, nextIp())).statusCode, 200);

    const released = await post(clearHandler, raider, { name: 'quarry' }, nextIp());
    assert.equal(released.statusCode, 200, JSON.stringify(released.body));
    assert.equal(onlineStore.get('quarry')?.pendingAttacker ?? null, null);
});

test('clear-attack: the target may still clear their own flag, and a bystander may not', async () => {
    const raider = nextRaider();
    place(raider, 12, 40);
    place('quarry', 12, 40);
    place('nosy', 12, 40);
    assert.equal((await post(attackHandler, raider, { targetName: 'quarry', attacker: { name: raider } }, nextIp())).statusCode, 200);

    const bystander = await post(clearHandler, 'nosy', { name: 'quarry' }, nextIp());
    assert.equal(bystander.statusCode, 403, JSON.stringify(bystander.body));
    assert.ok(onlineStore.get('quarry')?.pendingAttacker, 'a bystander must not be able to break an engagement');

    const own = await post(clearHandler, 'quarry', { name: 'quarry' }, nextIp());
    assert.equal(own.statusCode, 200, JSON.stringify(own.body));
    assert.equal(onlineStore.get('quarry')?.pendingAttacker ?? null, null);
});
