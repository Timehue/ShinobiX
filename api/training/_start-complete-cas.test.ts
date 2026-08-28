import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'training-cas-regression-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;

let startHandler: Handler;
let completeHandler: Handler;
let kv: typeof import('../_storage.js').kv;

const TEST_PREFIX = 'trainingcas';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(body: Json) {
    return {
        method: 'POST',
        body,
        query: {},
        headers: {
            'content-type': 'application/json',
            'x-admin-password': ADMIN_PASSWORD,
            'x-forwarded-for': '127.0.0.77',
        },
        socket: { remoteAddress: '127.0.0.77' },
    } as never;
}

function character(name: string, stamina = 40): Json {
    return {
        name,
        level: 1,
        stamina,
        stats: { strength: 10, speed: 10, intelligence: 10, willpower: 10 },
        unspentStats: 0,
        totalStatsTrained: 0,
    };
}

function activeLease(token: string, now = Date.now()): Json {
    return {
        label: '15 Minutes strength Training',
        stat: 'strength',
        xp: 0,
        statGain: 6,
        staminaCost: 5,
        startedAt: now - 20 * 60_000,
        endsAt: now - 5 * 60_000,
        expiresAt: now + 24 * 60 * 60_000,
        durationMs: 15 * 60_000,
        token,
    };
}

async function post(handler: Handler, body: Json) {
    const { out, res } = response();
    await handler(request(body), res);
    return out;
}

async function seedSave(name: string, record: Json): Promise<void> {
    await kv.set(`save:${name}`, record);
}

function dailyStartKey(name: string): string {
    return `training-start-count:${name}:${new Date().toISOString().slice(0, 10)}`;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    startHandler = (await import('./start.js')).default as unknown as Handler;
    completeHandler = (await import('./complete.js')).default as unknown as Handler;
});

after(async () => {
    for (const key of await kv.keys(`*${TEST_PREFIX}*`)) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('training start/complete exact-CAS authority', { concurrency: false }, () => {
    it('commits a first start from the exact predecessor, then publishes one cache token', async () => {
        const name = `${TEST_PREFIX}firststart`;
        await seedSave(name, { _saveVersion: 1, character: character(name) });

        const out = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?._saveVersion, 2);
        assert.equal((out.body?.character as Json).stamina, 35);
        const token = String(out.body?.token ?? '');
        assert.match(token, /^[a-f0-9]{32}$/);

        const saved = await kv.get<Json>(`save:${name}`);
        assert.equal(saved?._saveVersion, 2);
        assert.equal((saved?.character as Json).stamina, 35);
        assert.equal((saved?.activeTraining as Json).token, token);
        assert.equal((await kv.get<Json>(`training-active:${name}`))?.token, token);
        assert.equal((await kv.get<Json>(`training-token:${name}:${token}`))?.playerName, name);
        assert.deepEqual(await kv.keys(`training-token:${name}:*`), [`training-token:${name}:${token}`]);
        assert.equal(await kv.get<number>(dailyStartKey(name)), 1, 'a committed start consumes exactly one daily slot');
    });

    it('releases the daily reservation when stamina or active-training validation rejects the start', async () => {
        const noStaminaName = `${TEST_PREFIX}nostamina`;
        await seedSave(noStaminaName, { _saveVersion: 1, character: character(noStaminaName, 0) });

        const noStamina = await post(startHandler, { playerName: noStaminaName, stat: 'strength', tierId: '15m' });
        assert.equal(noStamina.statusCode, 409, JSON.stringify(noStamina.body));
        assert.equal(await kv.get(dailyStartKey(noStaminaName)), null);

        const activeName = `${TEST_PREFIX}alreadyactive`;
        await seedSave(activeName, {
            _saveVersion: 1,
            character: character(activeName),
            activeTraining: activeLease('alreadyactive0123456789abcdef'),
        });

        const alreadyActive = await post(startHandler, { playerName: activeName, stat: 'strength', tierId: '15m' });
        assert.equal(alreadyActive.statusCode, 409, JSON.stringify(alreadyActive.body));
        assert.equal(await kv.get(dailyStartKey(activeName)), null);
    });

    it('releases the daily reservation when the save CAS throws before committing', async () => {
        const name = `${TEST_PREFIX}startcasthrow`;
        const saveKey = `save:${name}`;
        await seedSave(name, { _saveVersion: 1, character: character(name) });
        const compareSet = kv.compareSet.bind(kv);
        const consoleError = console.error;
        kv.compareSet = (async (key, expected, value, options) => {
            if (key === saveKey) throw new Error('injected definitive save CAS failure');
            return compareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        console.error = () => undefined;

        let out: Awaited<ReturnType<typeof post>>;
        try {
            out = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
        } finally {
            kv.compareSet = compareSet as typeof kv.compareSet;
            console.error = consoleError;
        }

        assert.equal(out.statusCode, 500, JSON.stringify(out.body));
        assert.equal(await kv.get(dailyStartKey(name)), null);
        assert.equal((await kv.get<Json>(saveKey))?._saveVersion, 1);
        assert.deepEqual(await kv.keys(`training-token:${name}:*`), []);
    });

    it('preserves the daily reservation when a committed CAS and both exact readbacks are unavailable', async () => {
        const name = `${TEST_PREFIX}startdoubleunreadable`;
        const saveKey = `save:${name}`;
        await seedSave(name, { _saveVersion: 1, character: character(name) });
        const compareSet = kv.compareSet.bind(kv);
        const get = kv.get.bind(kv);
        const consoleError = console.error;
        let acknowledgementLost = false;
        let failedReadbacks = 0;
        kv.compareSet = (async (key, expected, value, options) => {
            if (key === saveKey && !acknowledgementLost) {
                acknowledgementLost = true;
                assert.equal(await compareSet(key, expected, value, options), true, 'the training save commits');
                throw new Error('injected committed CAS acknowledgement loss');
            }
            return compareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        kv.get = (async (key) => {
            if (key === saveKey && acknowledgementLost && failedReadbacks < 2) {
                failedReadbacks += 1;
                throw new Error('injected exact readback outage');
            }
            return get(key);
        }) as typeof kv.get;
        console.error = () => undefined;

        let out: Awaited<ReturnType<typeof post>>;
        try {
            out = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
        } finally {
            kv.compareSet = compareSet as typeof kv.compareSet;
            kv.get = get as typeof kv.get;
            console.error = consoleError;
        }

        assert.equal(out.statusCode, 500, JSON.stringify(out.body));
        assert.equal(failedReadbacks, 2, 'the helper and handler each attempted exact recovery');
        assert.equal(await kv.get<number>(dailyStartKey(name)), 1, 'an ambiguous committed start keeps its reservation');
        const saved = await kv.get<Json>(saveKey);
        assert.equal(saved?._saveVersion, 2);
        assert.equal((saved?.character as Json).stamina, 35);
        assert.match(String((saved?.activeTraining as Json).token ?? ''), /^[a-f0-9]{32}$/);
    });

    it('does not treat a failed cleanup read as proof that a failed delete committed', async () => {
        const name = `${TEST_PREFIX}cleanupunreadable`;
        const dailyKey = dailyStartKey(name);
        await seedSave(name, { _saveVersion: 1, character: character(name, 0) });
        const del = kv.del.bind(kv);
        const get = kv.get.bind(kv);
        const consoleError = console.error;
        let deleteAttempted = false;
        kv.del = (async (...keys) => {
            if (keys.includes(dailyKey)) {
                deleteAttempted = true;
                throw new Error('injected precommit daily delete failure');
            }
            return del(...keys);
        }) as typeof kv.del;
        kv.get = (async (key) => {
            if (key === dailyKey && deleteAttempted) throw new Error('injected cleanup readback outage');
            return get(key);
        }) as typeof kv.get;
        console.error = () => undefined;

        let out: Awaited<ReturnType<typeof post>>;
        try {
            out = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
        } finally {
            kv.del = del as typeof kv.del;
            kv.get = get as typeof kv.get;
            console.error = consoleError;
        }

        assert.equal(out.statusCode, 500, JSON.stringify(out.body));
        assert.equal(deleteAttempted, true);
        assert.equal(await kv.get<number>(dailyKey), 1, 'an unconfirmed failed delete is not reported as released');
    });

    it('fails closed when the daily reservation lock is already held', async () => {
        const name = `${TEST_PREFIX}dailylockheld`;
        const dailyKey = dailyStartKey(name);
        const lockKey = `lock:${dailyKey}`;
        await seedSave(name, { _saveVersion: 1, character: character(name) });
        await kv.set(lockKey, 'another-request', { ex: 10 });
        const consoleError = console.error;
        console.error = () => undefined;

        let out: Awaited<ReturnType<typeof post>>;
        try {
            out = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
        } finally {
            console.error = consoleError;
            await kv.del(lockKey);
        }

        assert.equal(out.statusCode, 500, JSON.stringify(out.body));
        assert.equal(await kv.get(dailyKey), null);
        assert.equal((await kv.get<Json>(`save:${name}`))?._saveVersion, 1);
    });

    it('keeps exactly the winning slot when concurrent starts reserve before save validation', async () => {
        const name = `${TEST_PREFIX}concurrentcount`;
        await seedSave(name, { _saveVersion: 1, character: character(name) });

        const results = await Promise.all([
            post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' }),
            post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' }),
        ]);

        assert.deepEqual(results.map((out) => out.statusCode).sort(), [200, 409]);
        assert.equal(await kv.get<number>(dailyStartKey(name)), 1, 'the rejected concurrent reservation releases only its own slot');
        assert.equal((await kv.get<Json>(`save:${name}`))?._saveVersion, 2);
        assert.equal((await kv.keys(`training-token:${name}:*`)).length, 1);
    });

    it('keeps a committed start usable when both post-CAS cache publications fail', async () => {
        const name = `${TEST_PREFIX}cacheoutage`;
        await seedSave(name, { _saveVersion: 3, character: character(name) });
        const set = kv.set.bind(kv);
        const consoleError = console.error;
        kv.set = (async (key, value, options) => {
            if (key === `training-active:${name}` || key.startsWith(`training-token:${name}:`)) {
                throw new Error('injected training cache outage');
            }
            return set(key, value, options);
        }) as typeof kv.set;
        console.error = () => undefined;

        let started: Awaited<ReturnType<typeof post>>;
        try {
            started = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
        } finally {
            kv.set = set as typeof kv.set;
            console.error = consoleError;
        }
        assert.equal(started.statusCode, 200, JSON.stringify(started.body));
        assert.equal(started.body?._saveVersion, 4);
        const token = String(started.body?.token ?? '');
        assert.equal(await kv.get(`training-token:${name}:${token}`), null);
        assert.equal(await kv.get(`training-active:${name}`), null);
        assert.equal((await kv.get<Json>(`save:${name}`))?.activeTraining instanceof Object, true);

        // Complete reconstructs the sealed grant from the protected save lease;
        // neither acceleration row is payout authority.
        const completed = await post(completeHandler, { playerName: name, token, cancel: true });
        assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
        assert.equal(completed.body?._saveVersion, 5);
        assert.equal((await kv.get<Json>(`save:${name}`))?.activeTraining, null);
    });

    it('holds the save lock through delayed cache publication so completion cannot be resurrected', async () => {
        const name = `${TEST_PREFIX}publishfence`;
        const activeKey = `training-active:${name}`;
        await seedSave(name, { _saveVersion: 5, character: character(name) });
        const set = kv.set.bind(kv);
        let pausePublication!: () => void;
        let releasePublication!: () => void;
        const publicationPaused = new Promise<void>((resolve) => { pausePublication = resolve; });
        const publicationRelease = new Promise<void>((resolve) => { releasePublication = resolve; });
        let delayed = false;
        kv.set = (async (key, value, options) => {
            if (key === activeKey && !delayed) {
                delayed = true;
                pausePublication();
                await publicationRelease;
            }
            return set(key, value, options);
        }) as typeof kv.set;

        const startPromise = post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
        try {
            await publicationPaused;
            const durable = await kv.get<Json>(`save:${name}`);
            const token = String((durable?.activeTraining as Json).token ?? '');
            assert.match(token, /^[a-f0-9]{32}$/);

            let completionSettled = false;
            const completionPromise = post(completeHandler, { playerName: name, token, cancel: true })
                .finally(() => { completionSettled = true; });
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            assert.equal(completionSettled, false, 'completion waits for start cache publication and lock release');

            releasePublication();
            const [started, completed] = await Promise.all([startPromise, completionPromise]);
            assert.equal(started.statusCode, 200, JSON.stringify(started.body));
            assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
            assert.equal((await kv.get<Json>(`save:${name}`))?.activeTraining, null);
            assert.notEqual((await kv.get<Json>(activeKey))?.token, token, 'the spent cache is not resurrected');
        } finally {
            releasePublication();
            kv.set = set as typeof kv.set;
            await startPromise.catch(() => undefined);
        }
    });

    it('commits a first completion once, returns its version, and replays without another grant', async () => {
        const name = `${TEST_PREFIX}firstcomplete`;
        const token = 'firstcomplete0123456789abcdef';
        const lease = activeLease(token);
        await seedSave(name, { _saveVersion: 7, character: character(name), activeTraining: lease });
        await kv.set(`training-token:${name}:${token}`, {
            playerName: name,
            stat: 'strength',
            tierId: '15m',
            startedAt: lease.startedAt,
            endsAt: lease.endsAt,
            sealedGain: 6,
            sealedXp: 0,
        });
        await kv.set(`training-active:${name}`, lease);

        const first = await post(completeHandler, { playerName: name, token });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(first.body?.alreadyGranted, false);
        assert.equal(first.body?._saveVersion, 8);
        assert.equal(((first.body?.character as Json).stats as Json).strength, 16);

        const stored = await kv.get<Json>(`save:${name}`);
        assert.equal(stored?.activeTraining, null);
        assert.deepEqual(stored?._trainingReceipts, [token]);
        assert.equal(await kv.get(`training-token:${name}:${token}`), null);

        const replay = await post(completeHandler, { playerName: name, token });
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.alreadyGranted, true);
        assert.equal(replay.body?._saveVersion, 8, 'idempotent replay must not manufacture a version bump');
        assert.equal((((await kv.get<Json>(`save:${name}`))?.character as Json).stats as Json).strength, 16);
    });

    it('replays a tokenless legacy completion from its durable server markers', async () => {
        const name = `${TEST_PREFIX}legacyreplay`;
        const now = Date.now();
        await seedSave(name, {
            _saveVersion: 14,
            character: character(name),
            activeTraining: {
                label: '15 Minutes strength Training',
                stat: 'strength',
                xp: 0,
                statGain: 6,
                startedAt: now - 20 * 60_000,
                endsAt: now - 5 * 60_000,
                durationMs: 15 * 60_000,
            },
        });

        const first = await post(completeHandler, { playerName: name, legacy: true });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(first.body?.alreadyGranted, false);
        assert.equal(first.body?._saveVersion, 15);
        const legacyToken = String(first.body?.token ?? '');
        assert.match(legacyToken, /^legacy[A-Za-z0-9]+$/);

        const replay = await post(completeHandler, { playerName: name, legacy: true });
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.alreadyGranted, true);
        assert.equal(replay.body?.token, legacyToken);
        assert.equal(replay.body?._saveVersion, 15);
        assert.equal((((await kv.get<Json>(`save:${name}`))?.character as Json).stats as Json).strength, 16);
    });

    // Regression: the build retired on 2026-07-12 minted a token but never wrote
    // startedAt/expiresAt. The modern validator needs both fields, and the legacy
    // parser used to refuse anything carrying a token, so these leases matched
    // NEITHER path — 409 on every collect, while the client refused to start a new
    // session because a lease was present. 14 live saves sat unable to train for
    // ~7 weeks. The client sends `legacy: !activeTraining.token`, so the real
    // request for this shape arrives with legacy:false and the token echoed.
    it('collects a token-bearing lease that predates startedAt/expiresAt', async () => {
        const name = `${TEST_PREFIX}strandedlease`;
        const staleToken = '760cdb928fbe421781da30579188f615';
        await seedSave(name, {
            _saveVersion: 21,
            character: character(name),
            activeTraining: {
                label: '4 Hours strength Training',
                stat: 'strength',
                xp: 220,
                statGain: 84,
                staminaCost: 35,
                endsAt: Date.now() - 48 * 24 * 60 * 60_000,
                durationMs: 4 * 60 * 60_000,
                token: staleToken,
            },
        });

        const collected = await post(completeHandler, { playerName: name, token: staleToken, legacy: false });
        assert.equal(collected.statusCode, 200, JSON.stringify(collected.body));
        assert.equal(collected.body?.alreadyGranted, false);
        assert.equal(collected.body?.applied, 84);

        const saved = await kv.get<Json>(`save:${name}`);
        assert.equal(((saved?.character as Json).stats as Json).strength, 94);
        // The lease must clear, or the client keeps refusing to start new training.
        assert.equal(saved?.activeTraining ?? null, null);

        // A second click must not pay twice now that the lease is gone.
        const again = await post(completeHandler, { playerName: name, token: staleToken, legacy: false });
        assert.equal(again.statusCode, 409, JSON.stringify(again.body));
        assert.equal(((((await kv.get<Json>(`save:${name}`))?.character as Json).stats as Json).strength), 94);
    });

    it('re-reads a successor autosave and debits the successor exactly once on start', async () => {
        const name = `${TEST_PREFIX}startrace`;
        const saveKey = `save:${name}`;
        await seedSave(name, { _saveVersion: 10, character: character(name, 40), rootMarker: 'original' });
        const compareSet = kv.compareSet.bind(kv);
        let injected = false;
        let saveAttempts = 0;
        kv.compareSet = (async (key, expected, value, options) => {
            if (key === saveKey) {
                saveAttempts += 1;
                if (!injected) {
                    injected = true;
                    const predecessor = expected as Json;
                    const predecessorCharacter = predecessor.character as Json;
                    const successor: Json = {
                        ...predecessor,
                        _saveVersion: 11,
                        rootMarker: 'successor-autosave',
                        character: { ...predecessorCharacter, stamina: 37, autosaveMarker: 'newest' },
                    };
                    assert.equal(await compareSet(key, expected, successor), true);
                }
            }
            return compareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        try {
            const out = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.equal(out.body?._saveVersion, 12);
            assert.equal((out.body?.character as Json).stamina, 32);
            assert.equal((out.body?.character as Json).autosaveMarker, 'newest');
            assert.equal(saveAttempts, 2);
        } finally {
            kv.compareSet = compareSet as typeof kv.compareSet;
        }

        const stored = await kv.get<Json>(saveKey);
        assert.equal(stored?.rootMarker, 'successor-autosave');
        assert.equal((stored?.character as Json).stamina, 32);
        assert.equal((stored?.character as Json).autosaveMarker, 'newest');
        assert.equal((await kv.keys(`training-token:${name}:*`)).length, 1, 'the losing proposal never publishes an orphan token');
    });

    it('recovers a committed start whose acknowledgement is lost before a successor autosave', async () => {
        const name = `${TEST_PREFIX}startlostack`;
        const saveKey = `save:${name}`;
        await seedSave(name, { _saveVersion: 50, character: character(name, 40) });
        const compareSet = kv.compareSet.bind(kv);
        let injected = false;
        kv.compareSet = (async (key, expected, value, options) => {
            if (key === saveKey && !injected) {
                injected = true;
                assert.equal(await compareSet(key, expected, value, options), true, 'the training save commits');
                const committed = value as Json;
                const committedCharacter = committed.character as Json;
                assert.equal(await compareSet(key, value, {
                    ...committed,
                    _saveVersion: 52,
                    rootMarker: 'post-commit-successor',
                    character: { ...committedCharacter, autosaveMarker: 'newest' },
                }), true, 'a successor autosave lands before readback');
                throw new Error('injected lost acknowledgement');
            }
            return compareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        try {
            const out = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.equal(out.body?._saveVersion, 52);
            assert.equal((out.body?.character as Json).stamina, 35);
            assert.equal((out.body?.character as Json).autosaveMarker, 'newest');
        } finally {
            kv.compareSet = compareSet as typeof kv.compareSet;
        }

        const stored = await kv.get<Json>(saveKey);
        assert.equal(stored?.rootMarker, 'post-commit-successor');
        assert.equal((stored?.character as Json).stamina, 35, 'the debit is not replayed');
        assert.equal((await kv.keys(`training-token:${name}:*`)).length, 1);
    });

    it('does not overwrite a successor training lease that wins the start CAS', async () => {
        const name = `${TEST_PREFIX}successorlease`;
        const saveKey = `save:${name}`;
        const successor = activeLease('successorlease0123456789abcdef');
        await seedSave(name, { _saveVersion: 20, character: character(name, 40) });
        const compareSet = kv.compareSet.bind(kv);
        let injected = false;
        kv.compareSet = (async (key, expected, value, options) => {
            if (key === saveKey && !injected) {
                injected = true;
                const predecessor = expected as Json;
                assert.equal(await compareSet(key, expected, {
                    ...predecessor,
                    _saveVersion: 21,
                    activeTraining: successor,
                }), true);
            }
            return compareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        try {
            const out = await post(startHandler, { playerName: name, stat: 'strength', tierId: '15m' });
            assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        } finally {
            kv.compareSet = compareSet as typeof kv.compareSet;
        }

        const stored = await kv.get<Json>(saveKey);
        assert.equal((stored?.activeTraining as Json).token, successor.token);
        assert.equal((stored?.character as Json).stamina, 40);
        assert.deepEqual(await kv.keys(`training-token:${name}:*`), []);
    });

    it('re-reads a successor autosave and applies a completion grant exactly once', async () => {
        const name = `${TEST_PREFIX}completerace`;
        const saveKey = `save:${name}`;
        const token = 'completerace0123456789abcdef';
        const lease = activeLease(token);
        await seedSave(name, { _saveVersion: 30, character: character(name, 40), activeTraining: lease });
        await kv.set(`training-token:${name}:${token}`, {
            playerName: name,
            stat: 'strength',
            tierId: '15m',
            startedAt: lease.startedAt,
            endsAt: lease.endsAt,
            sealedGain: 6,
            sealedXp: 0,
        });
        await kv.set(`training-active:${name}`, lease);
        const compareSet = kv.compareSet.bind(kv);
        let injected = false;
        let saveAttempts = 0;
        kv.compareSet = (async (key, expected, value, options) => {
            if (key === saveKey) {
                saveAttempts += 1;
                if (!injected) {
                    injected = true;
                    const predecessor = expected as Json;
                    const predecessorCharacter = predecessor.character as Json;
                    const successor: Json = {
                        ...predecessor,
                        _saveVersion: 31,
                        rootMarker: 'successor-autosave',
                        character: {
                            ...predecessorCharacter,
                            stamina: 39,
                            autosaveMarker: 'newest',
                            stats: { ...(predecessorCharacter.stats as Json), strength: 11 },
                        },
                    };
                    assert.equal(await compareSet(key, expected, successor), true);
                }
            }
            return compareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        try {
            const out = await post(completeHandler, { playerName: name, token });
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.equal(out.body?._saveVersion, 32);
            assert.equal(((out.body?.character as Json).stats as Json).strength, 17);
            assert.equal((out.body?.character as Json).autosaveMarker, 'newest');
            assert.equal(saveAttempts, 2);
        } finally {
            kv.compareSet = compareSet as typeof kv.compareSet;
        }

        const stored = await kv.get<Json>(saveKey);
        assert.equal(stored?.rootMarker, 'successor-autosave');
        assert.equal(stored?.activeTraining, null);
        assert.deepEqual(stored?._trainingReceipts, [token]);
        assert.equal(((stored?.character as Json).stats as Json).strength, 17);
        assert.equal((stored?.character as Json).totalStatsTrained, 6);
    });

    it('recovers a committed receipt whose acknowledgement is lost before a successor autosave', async () => {
        const name = `${TEST_PREFIX}completelostack`;
        const saveKey = `save:${name}`;
        const token = 'completelostack0123456789abcdef';
        const lease = activeLease(token);
        await seedSave(name, { _saveVersion: 60, character: character(name), activeTraining: lease });
        await kv.set(`training-token:${name}:${token}`, {
            playerName: name,
            stat: 'strength',
            tierId: '15m',
            startedAt: lease.startedAt,
            endsAt: lease.endsAt,
            sealedGain: 6,
            sealedXp: 0,
        });
        await kv.set(`training-active:${name}`, lease);
        const compareSet = kv.compareSet.bind(kv);
        let injected = false;
        kv.compareSet = (async (key, expected, value, options) => {
            if (key === saveKey && !injected) {
                injected = true;
                assert.equal(await compareSet(key, expected, value, options), true, 'the receipt save commits');
                const committed = value as Json;
                const committedCharacter = committed.character as Json;
                assert.equal(await compareSet(key, value, {
                    ...committed,
                    _saveVersion: 62,
                    rootMarker: 'post-receipt-successor',
                    character: { ...committedCharacter, autosaveMarker: 'newest' },
                }), true, 'a successor autosave lands before readback');
                throw new Error('injected lost acknowledgement');
            }
            return compareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        try {
            const out = await post(completeHandler, { playerName: name, token });
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.equal(out.body?.alreadyGranted, true);
            assert.equal(out.body?._saveVersion, 62);
            assert.equal(((out.body?.character as Json).stats as Json).strength, 16);
            assert.equal((out.body?.character as Json).autosaveMarker, 'newest');
        } finally {
            kv.compareSet = compareSet as typeof kv.compareSet;
        }

        const stored = await kv.get<Json>(saveKey);
        assert.equal(stored?.rootMarker, 'post-receipt-successor');
        assert.deepEqual(stored?._trainingReceipts, [token]);
        assert.equal(((stored?.character as Json).stats as Json).strength, 16, 'the grant is not replayed');
        assert.equal((stored?.character as Json).totalStatsTrained, 6);
    });

    it('cannot retire a successor active-cache row during completion replay cleanup', async () => {
        const name = `${TEST_PREFIX}cleanupfence`;
        const token = 'cleanupfence0123456789abcdef';
        const activeKey = `training-active:${name}`;
        const oldLease = activeLease(token);
        const successor = activeLease('cleanupsuccessor0123456789abcd');
        await seedSave(name, {
            _saveVersion: 40,
            character: character(name),
            activeTraining: null,
            _trainingReceipts: [token],
        });
        await kv.set(activeKey, oldLease);
        const compareSet = kv.compareSet.bind(kv);
        let injected = false;
        kv.compareSet = (async (key, expected, value, options) => {
            if (key === activeKey && !injected) {
                injected = true;
                assert.equal(await compareSet(key, expected, successor), true);
            }
            return compareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        try {
            const out = await post(completeHandler, { playerName: name, token });
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.equal(out.body?.alreadyGranted, true);
        } finally {
            kv.compareSet = compareSet as typeof kv.compareSet;
        }

        assert.equal((await kv.get<Json>(activeKey))?.token, successor.token);
        assert.equal((await kv.get<Json>(`save:${name}`))?._saveVersion, 40);
    });
});
