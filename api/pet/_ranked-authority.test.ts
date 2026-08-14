import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'ranked-pet-authority-test-secret-32-bytes';
process.env.ENABLE_PET_RANKED_SERVER_V1 = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const A = 'rankedauthorityalpha';
const B = 'rankedauthoritybravo';
const C = 'rankedauthoritycharlie';
const D = 'rankedauthoritydelta';
const MATCH = '1234567890abcdef1234567890abcdef';
const BUSY_MATCH = '2234567890abcdef1234567890abcdef';
const CONFLICT_MATCH = '3234567890abcdef1234567890abcdef';
const LOST_ACK_MATCH = '4234567890abcdef1234567890abcdef';
const TOKEN_REJECT_MATCH = '5234567890abcdef1234567890abcdef';
const DISABLED_RECOVERY_MATCH = '6234567890abcdef1234567890abcdef';
const STALE_LEGACY_MATCH = '7234567890abcdef1234567890abcdef';

let startHandler: Handler;
let resultHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let aToken = '';
let cToken = '';

const pet = (id: string, patch: Record<string, unknown> = {}) => ({
    id,
    name: id,
    rarity: 'standard',
    level: 24,
    xp: 0,
    maxLevel: 100,
    hp: 620,
    attack: 72,
    defense: 45,
    speed: 57,
    element: 'Fire',
    jutsus: [{ name: 'Fang', power: 95, cooldown: 2, currentCooldown: 0, kind: 'damage' }],
    unlockedForPve: true,
    loadout: { pvp: 'guard-vest', consumable: 'pet-tonic' },
    ...patch,
});

const character = (name: string, patch: Record<string, unknown> = {}) => ({
    name,
    level: 24,
    activePetId: `${name}-p1`,
    petRankedRating: 1000,
    petRankedWins: 0,
    petRankedLosses: 0,
    pets: [1, 2, 3, 4, 5].map((index) => pet(`${name}-p${index}`)),
    ...patch,
});

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

function request(token: string, body: Record<string, unknown> = {}) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function save(name: string, value = character(name)) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: value });
}

async function pair(a: string, b: string, matchId: string) {
    const createdAt = Date.now();
    await Promise.all([
        kv.set(`pvp:pet-ranked-queue:match:${a}`, {
            matchId, opponent: b, opponentElo: 1000, opponentLevel: 24, initiator: true, createdAt,
        }, { ex: 90 }),
        kv.set(`pvp:pet-ranked-queue:match:${b}`, {
            matchId, opponent: a, opponentElo: 1000, opponentLevel: 24, initiator: false, createdAt,
        }, { ex: 90 }),
    ]);
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const { startRankedSeason } = await import('../cron/_ranked-season.js');
    await startRankedSeason(Date.now());
    const auth = await import('../_auth.js');
    aToken = auth.issuePlayerToken(A)!;
    cToken = auth.issuePlayerToken(C)!;
    startHandler = (await import('./ranked-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_PET_RANKED_SERVER_V1;
});

test('ranked start ignores forged inputs, settles the queue-owned match, and resumes one receipt', async () => {
    await Promise.all([save(A), save(B)]);
    await pair(A, B, MATCH);

    const first = response();
    await startHandler(request(aToken, {
        opponentName: 'offline-victim-not-in-queue',
        petId: `${A}-p4`,
        seed: 1,
        outcome: 'win',
        reward: 999_999,
        aRating: 999_999,
    }), first.res);

    assert.equal(first.out.statusCode, 200);
    assert.equal(first.out.body?.matchToken, MATCH);
    assert.equal(first.out.body?.opponentName, B);
    assert.equal(first.out.body?.playerPetId, `${A}-p1`, 'server active/entitlement order owns selection');
    assert.notEqual(first.out.body?.seed, 1, 'caller seed is not an engine input');
    assert.equal(first.out.body?.settled, true);
    assert.equal('outcome' in (first.out.body ?? {}), false, 'start is not a seed-shopping oracle');
    assert.equal('reward' in (first.out.body ?? {}), false);
    assert.equal('engineDigest' in (first.out.body ?? {}), false);

    const token = await kv.get<Record<string, any>>(`pet:ranked-token:${MATCH}`);
    assert.equal(token?.a, A);
    assert.equal(token?.b, B);
    assert.equal(token?.seed, first.out.body?.seed);
    assert.equal(token?.aPetId, `${A}-p1`);
    assert.equal(token?.bPetId, `${B}-p1`);
    assert.match(String(token?.resolution?.engineDigest), /^[a-f0-9]{64}$/);
    assert.equal(token?.resolution?.reward?.ryo, 0);
    assert.equal(Number(token?.resolution?.reward?.aDelta) + Number(token?.resolution?.reward?.bDelta), 0);
    assert.equal(await kv.get(`pet:battle-active:${A}`), MATCH);
    assert.equal(await kv.get(`pet:battle-active:${B}`), MATCH);

    const aAfter = await kv.get<Record<string, any>>(`save:${A}`);
    const bAfter = await kv.get<Record<string, any>>(`save:${B}`);
    assert.equal(aAfter?.character.serverSettlementReceipts.length, 1);
    assert.equal(bAfter?.character.serverSettlementReceipts.length, 1);
    assert.equal(aAfter?.character.pets[0].loadout.consumable, undefined);
    assert.equal(bAfter?.character.pets[0].loadout.consumable, undefined);
    assert.equal(await kv.get(`pvp:pet-ranked-queue:match:${A}`), null);
    assert.equal(await kv.get(`pvp:pet-ranked-queue:match:${B}`), null);

    const newerQueue = {
        matchId: CONFLICT_MATCH,
        opponent: C,
        opponentElo: 1000,
        opponentLevel: 24,
        initiator: true,
        createdAt: Date.now(),
    };
    await kv.set(`pvp:pet-ranked-queue:match:${A}`, newerQueue, { ex: 90 });
    const resumed = response();
    await startHandler(request(aToken, { opponentName: 'another-forgery', seed: 2_147_483_647 }), resumed.res);
    assert.equal(resumed.out.statusCode, 200);
    assert.equal(resumed.out.body?.resumed, true);
    assert.equal(resumed.out.body?.matchToken, MATCH);
    assert.equal(resumed.out.body?.seed, first.out.body?.seed);
    assert.deepEqual(
        await kv.get(`pvp:pet-ranked-queue:match:${A}`),
        newerQueue,
        'late replay cannot delete a newer queue pairing',
    );
    await kv.del(`pvp:pet-ranked-queue:match:${A}`);
    const aAfterResume = await kv.get<Record<string, any>>(`save:${A}`);
    const bAfterResume = await kv.get<Record<string, any>>(`save:${B}`);
    assert.equal(aAfterResume?.character.serverSettlementReceipts.length, 1);
    assert.equal(bAfterResume?.character.serverSettlementReceipts.length, 1);

    const authoritativeForA = token?.resolution?.winner === 'draw'
        ? 'draw'
        : token?.resolution?.winner === 'a' ? 'win' : 'loss';
    const forged = authoritativeForA === 'win' ? 'loss' : 'win';
    const result = response();
    await resultHandler(request(aToken, {
        playerName: A,
        ranked: true,
        matchToken: MATCH,
        outcome: forged,
        // reportKey is intentionally absent: the private token is the receipt.
    }), result.res);
    assert.equal(result.out.statusCode, 200);
    assert.equal(result.out.body?.outcome, authoritativeForA, 'client outcome is ignored');
    assert.equal(result.out.body?.reward, 0);
    assert.equal(await kv.get(`pet:battle-active:${A}`), null);
    assert.equal(await kv.get(`pet:battle-active:${B}`), null);
    assert.equal((await kv.get<Record<string, any>>(`save:${A}`))?.character.serverSettlementReceipts.length, 1);
    assert.equal((await kv.get<Record<string, any>>(`save:${B}`))?.character.serverSettlementReceipts.length, 1);
});

test('ranked start rejects busy entitlement slots even when a ready overflow pet is forged in the body', async () => {
    const busyPets = [1, 2, 3, 4].map((index) => pet(`${C}-p${index}`, { training: { endsAt: 1 } }));
    busyPets.push(pet(`${C}-p5`));
    await Promise.all([
        save(C, character(C, { pets: busyPets })),
        save(D),
    ]);
    await pair(C, D, BUSY_MATCH);

    const out = response();
    await startHandler(request(cToken, { opponentName: D, petId: `${C}-p5`, seed: 1 }), out.res);
    assert.equal(out.out.statusCode, 409);
    assert.match(String(out.out.body?.error), /entitlement-eligible pet.*breeding, training, or on an expedition/i);
    assert.equal(await kv.get(`pet:ranked-token:${BUSY_MATCH}`), null);
    assert.equal(await kv.get(`pet:battle-active:${C}`), null);
    assert.equal(await kv.get(`pet:battle-active:${D}`), null);
});

test('ranked start fails closed and leaves no economic preparation on a foreign active conflict', async () => {
    await Promise.all([save(C), save(D)]);
    const now = Date.now();
    await kv.set(`pvp:pet-ranked-queue:match:${C}`, {
        matchId: CONFLICT_MATCH, opponent: D, opponentElo: 1000, opponentLevel: 24, initiator: true, createdAt: now,
    }, { ex: 90 });
    await kv.del(`pvp:pet-ranked-queue:match:${D}`);

    const missing = response();
    await startHandler(request(cToken), missing.res);
    assert.equal(missing.out.statusCode, 409);
    assert.match(String(missing.out.body?.error), /reciprocal server-ranked pairing/i);
    assert.equal(await kv.get(`pet:ranked-token:${CONFLICT_MATCH}`), null);

    await pair(C, D, CONFLICT_MATCH);
    await kv.set(`pet:battle-active:${D}`, 'casual-battle-token', { ex: 900 });
    const conflict = response();
    await startHandler(request(cToken), conflict.res);
    assert.equal(conflict.out.statusCode, 409);
    assert.match(String(conflict.out.body?.error), /already committed to another pet battle/i);
    assert.equal(await kv.get(`pet:battle-active:${C}`), null, 'second-key conflict exact-releases the first starting intent');
    assert.equal(await kv.get(`pet:battle-active:${D}`), 'casual-battle-token', 'foreign lease is preserved');
    assert.equal(await kv.get(`pet:ranked-token:${CONFLICT_MATCH}`), null);
    assert.equal(await kv.get(`pet:ranked-preparation:${CONFLICT_MATCH}`), null);
    await kv.delIfEqual(`pet:battle-active:${D}`, 'casual-battle-token');
    const recovery = response();
    await startHandler(request(cToken), recovery.res);
    assert.equal(recovery.out.statusCode, 200, 'the still-reciprocal pair may start only after the foreign mode clears');
    assert.equal(recovery.out.body?.matchToken, CONFLICT_MATCH);
    await kv.delIfEqual(`pet:battle-active:${C}`, CONFLICT_MATCH);
    await kv.delIfEqual(`pet:battle-active:${D}`, CONFLICT_MATCH);
});

test('either participant resumes a preclaim while fresh ranked admission is disabled', async () => {
    await Promise.all([save(C), save(D)]);
    await pair(C, D, DISABLED_RECOVERY_MATCH);
    const originalSet = kv.set.bind(kv);
    let failures = 0;
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (key === `pet:ranked-preparation:${DISABLED_RECOVERY_MATCH}`) {
            failures += 1;
            throw new Error('simulated-preparation-mirror-crash');
        }
        return originalSet(key, value, options);
    }) as typeof kv.set;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
        const crashed = response();
        await startHandler(request(cToken), crashed.res);
        assert.equal(crashed.out.statusCode, 503);
        assert.ok(failures >= 1);
        assert.equal(await kv.get(`pet:battle-active:${C}`), null, 'no lease exists before preparation durability');

        kv.set = originalSet as typeof kv.set;
        process.env.DISABLE_PET_RANKED_SERVER_V1 = '1';
        const recovered = response();
        await startHandler(request(cToken), recovered.res);
        assert.equal(recovered.out.statusCode, 200);
        assert.equal(recovered.out.body?.matchToken, DISABLED_RECOVERY_MATCH);
        assert.equal(recovered.out.body?.resumed, true);
        assert.equal((await kv.get<Record<string, any>>(`save:${C}`))?.character.serverSettlementReceipts.length, 1);
        assert.equal((await kv.get<Record<string, any>>(`save:${D}`))?.character.serverSettlementReceipts.length, 1);
    } finally {
        console.error = originalConsoleError;
        kv.set = originalSet as typeof kv.set;
        delete process.env.DISABLE_PET_RANKED_SERVER_V1;
        await kv.delIfEqual(`pet:battle-active:${C}`, DISABLED_RECOVERY_MATCH);
        await kv.delIfEqual(`pet:battle-active:${D}`, DISABLED_RECOVERY_MATCH);
    }
});

test('ranked start absorbs a lost completed-token acknowledgement without double settlement', async () => {
    await Promise.all([save(C), save(D)]);
    await pair(C, D, LOST_ACK_MATCH);
    const originalSet = kv.set.bind(kv);
    let lost = false;
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        const result = await originalSet(key, value, options);
        if (key === `pet:ranked-token:${LOST_ACK_MATCH}` && !lost) {
            lost = true;
            throw new Error('simulated-lost-token-ack');
        }
        return result;
    }) as typeof kv.set;
    try {
        const out = response();
        await startHandler(request(cToken, { seed: 1, opponentName: 'forged' }), out.res);
        assert.equal(out.out.statusCode, 200);
        assert.equal(out.out.body?.matchToken, LOST_ACK_MATCH);
        assert.equal(out.out.body?.resumed, undefined);
        assert.equal(lost, true);
        assert.ok(await kv.get(`pet:ranked-token:${LOST_ACK_MATCH}`));
        assert.equal((await kv.get<Record<string, any>>(`save:${C}`))?.character.serverSettlementReceipts.length, 1);
        assert.equal((await kv.get<Record<string, any>>(`save:${D}`))?.character.serverSettlementReceipts.length, 1);
    } finally {
        kv.set = originalSet as typeof kv.set;
        await kv.delIfEqual(`pet:battle-active:${C}`, LOST_ACK_MATCH);
        await kv.delIfEqual(`pet:battle-active:${D}`, LOST_ACK_MATCH);
    }
});

test('ranked start preserves completed authority when replay-token publication fails', async () => {
    await Promise.all([save(C), save(D)]);
    await pair(C, D, TOKEN_REJECT_MATCH);
    const originalSet = kv.set.bind(kv);
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (key === `pet:ranked-token:${TOKEN_REJECT_MATCH}`) {
            throw new Error('simulated-token-write-before-commit');
        }
        return originalSet(key, value, options);
    }) as typeof kv.set;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    let restored = false;
    try {
        const out = response();
        await startHandler(request(cToken), out.res);
        assert.equal(out.out.statusCode, 503);
        assert.equal(await kv.get(`pet:ranked-token:${TOKEN_REJECT_MATCH}`), null);
        assert.equal(await kv.get(`pet:battle-active:${C}`), TOKEN_REJECT_MATCH);
        assert.equal(await kv.get(`pet:battle-active:${D}`), TOKEN_REJECT_MATCH);
        assert.equal((await kv.get<Record<string, any>>(`save:${C}`))?.character.serverSettlementReceipts.length, 1);
        assert.equal((await kv.get<Record<string, any>>(`save:${D}`))?.character.serverSettlementReceipts.length, 1);

        kv.set = originalSet as typeof kv.set;
        restored = true;
        const retry = response();
        await startHandler(request(cToken), retry.res);
        assert.equal(retry.out.statusCode, 200);
        assert.equal(retry.out.body?.matchToken, TOKEN_REJECT_MATCH);
        assert.equal(retry.out.body?.resumed, true);
        assert.ok(await kv.get(`pet:ranked-token:${TOKEN_REJECT_MATCH}`));
        assert.equal((await kv.get<Record<string, any>>(`save:${C}`))?.character.serverSettlementReceipts.length, 1);
        assert.equal((await kv.get<Record<string, any>>(`save:${D}`))?.character.serverSettlementReceipts.length, 1);
    } finally {
        console.error = originalConsoleError;
        if (!restored) kv.set = originalSet as typeof kv.set;
        await kv.delIfEqual(`pet:battle-active:${C}`, TOKEN_REJECT_MATCH);
        await kv.delIfEqual(`pet:battle-active:${D}`, TOKEN_REJECT_MATCH);
    }
});

test('a stale legacy token cannot open an unregistered journal after season admission closes', async () => {
    await Promise.all([save(C), save(D)]);
    const engine = await import('./_ranked-engine.js');
    const cPet = engine.snapshotPetForRanked(pet(`${C}-p1`))!;
    const dPet = engine.snapshotPetForRanked(pet(`${D}-p1`))!;
    const legacy = engine.resolveAuthoritativePetRankedMatch({
        matchId: STALE_LEGACY_MATCH,
        a: C,
        b: D,
        aCharacter: character(C),
        bCharacter: character(D),
        aPet: cPet,
        bPet: dPet,
        seed: 789,
        now: Date.now(),
    });
    await kv.set(`pet:ranked-token:${STALE_LEGACY_MATCH}`, legacy, { ex: 900 });
    await kv.set(`pet:battle-active:${C}`, STALE_LEGACY_MATCH);
    const { closePetRankedSeasonGate } = await import('./_ranked-preparation.js');
    await closePetRankedSeasonGate(kv, 1, Date.now());

    const out = response();
    await startHandler(request(cToken), out.res);
    assert.equal(out.out.statusCode, 409);
    assert.match(String(out.out.body?.error), /season is closing/i);
    assert.equal(await kv.get(`pet:ranked-journal:${STALE_LEGACY_MATCH}`), null);
    assert.equal(await kv.get(`pet:battle-active:${C}`), STALE_LEGACY_MATCH);

    await kv.delIfEqual(`pet:battle-active:${C}`, STALE_LEGACY_MATCH);
    await kv.del(`pet:ranked-token:${STALE_LEGACY_MATCH}`);
});
