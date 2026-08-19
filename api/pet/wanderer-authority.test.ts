import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'wanderer-pet-authority-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
let startHandler: Handler;
let resultHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let resolveNaturalWorldWanderer: typeof import('../missions/_world-ai-fight.js').resolveNaturalWorldWanderer;
let wandererDayBucketFromMs: typeof import('../sector/_wanderer-encounter.js').wandererDayBucketFromMs;
let wandererUseCooldownKey: typeof import('../sector/_wanderer-encounter.js').wandererUseCooldownKey;

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

function request(body: Record<string, unknown>, token: string, suffix: number) {
    return {
        method: 'POST', body,
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: `198.51.100.${suffix}` },
    } as never;
}

function pet(id: string) {
    return {
        id, name: 'Proof Hound', rarity: 'rare', element: 'Earth', level: 32,
        xp: 0, maxLevel: 100, hp: 510, attack: 90, defense: 78, speed: 54,
        jutsus: [{ name: 'Proof Fang', power: 88, cooldown: 2, currentCooldown: 0, kind: 'damage' }],
        unlockedForPve: true,
        loadout: { pvp: 'test-gear', consumable: 'test-tonic' },
    };
}

function findWanderer(character: Record<string, unknown>, verb: string, now = Date.now()) {
    const bucket = wandererDayBucketFromMs(now);
    for (let sector = 1; sector <= 80; sector += 1) {
        for (let index = 0; index <= 1; index += 1) {
            const id = `w-${sector}-${bucket}-${index}`;
            const found = resolveNaturalWorldWanderer(id, character, sector, now);
            if (found?.verb === verb) return { id, sector, found };
        }
    }
    throw new Error(`No deterministic ${verb} wanderer found in the current bucket.`);
}

async function savePlayer(playerName: string, sector: number, playerPet = pet(`${playerName}-pet`)) {
    const character = {
        name: playerName,
        level: 32,
        currentSector: sector,
        starterCardsClaimed: true,
        ryo: 77,
        totalPetWins: 5,
        dailyPetWins: 2,
        tileCards: [],
        pets: [playerPet],
    };
    await kv.set(`save:${playerName}`, { _saveVersion: 1, currentSector: sector, character });
    onlineStore.upsert({ name: playerName, sector, character: { name: playerName, hp: 100, maxHp: 100 } });
    return { character, playerPet };
}

// Whether TODAY's deterministic wanderer bucket rolls at least one petDuel
// wanderer somewhere across the sector range. resolveNaturalWorldWanderer's
// RNG is seeded per (sector, dayBucket) with petDuel at ~10% relative weight;
// empirically a handful of days per year roll zero across every sector (e.g.
// 2026-08-18 did — verified with a standalone probe script, not a bug: the
// live handler re-derives dayBucket from the real clock, so a test here can't
// fake a different day the way it can fake other inputs). Every test below
// needs a real petDuel wanderer for today specifically, so skip cleanly on
// those rare days instead of failing red. See memory
// project_combat_regression_audit_2026_08_18 for the full writeup.
// Populated by before() once resolveNaturalWorldWanderer/wandererDayBucketFromMs
// are loaded (module top-level can't top-level-await under this build's CJS output).
let PET_DUEL_SKIP_TODAY: string | false = false;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ resolveNaturalWorldWanderer } = await import('../missions/_world-ai-fight.js'));
    ({ wandererDayBucketFromMs, wandererUseCooldownKey } = await import('../sector/_wanderer-encounter.js'));
    startHandler = (await import('./battle-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
    // Must match every test character's lock-relevant shape exactly
    // (starterCardsClaimed + non-empty pets) — resolveNaturalWorldWanderer's
    // weighted archetype pool excludes locked verbs before rolling, so a
    // differently-locked probe character re-normalizes the weights and can
    // roll a different archetype than the real test characters would at the
    // very same (sector, bucket, index).
    try {
        findWanderer({ starterCardsClaimed: true, pets: [{ id: 'probe' }] }, 'petDuel');
    } catch {
        PET_DUEL_SKIP_TODAY = "No petDuel wanderer rolled in today's bucket across the sector range — rare (~1-2%/day), not a regression.";
    }
});

after(() => {
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('wanderpet')) onlineStore.remove(player.name);
    }
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('fresh and response-loss recovery return one immutable Showdown proof, then settle no progression', async (t) => {
    if (PET_DUEL_SKIP_TODAY) return t.skip(PET_DUEL_SKIP_TODAY);
    const playerName = 'wanderpetrecovery';
    const auth = issuePlayerToken(playerName)!;
    const fixture = pet('wanderpet-recovery-pet');
    const base = { name: playerName, level: 32, starterCardsClaimed: true, pets: [fixture] };
    const encounter = findWanderer(base, 'petDuel');
    await savePlayer(playerName, encounter.sector, fixture);
    const body = {
        playerName,
        mode: '1v1',
        playerPetIds: [fixture.id],
        wanderer: { id: encounter.id, sector: encounter.sector },
    };

    const first = response();
    await startHandler(request(body, auth, 31), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.equal(first.out.body?.resumed, false);
    assert.equal(first.out.body?.outcome === 'win' || first.out.body?.outcome === 'loss', true);
    assert.ok(first.out.body?.showdownScript);
    assert.equal((first.out.body?.wanderer as Record<string, unknown>)?.verb, 'petDuel');
    assert.equal((first.out.body?.wanderer as Record<string, unknown>)?.sector, encounter.sector);
    const firstCharacter = first.out.body?.character as Record<string, unknown>;
    assert.equal(Number((firstCharacter.wandererCooldowns as Record<string, unknown>)[encounter.id]), first.out.body?.cooldownUntil);
    assert.equal(Number((firstCharacter.wandererMoves as Record<string, unknown>)[encounter.id]), first.out.body?.moveToSector);
    assert.equal(first.out.body?._saveVersion, 2);

    const token = String(first.out.body?.token ?? '');
    const tokenData = await kv.get<Record<string, unknown>>(`pet:battle-token:${playerName}:${token}`);
    assert.equal(tokenData?.settlementPolicy, 'casual-no-progression');
    assert.equal((tokenData?.wanderer as Record<string, unknown>)?.id, encounter.id);
    assert.equal((tokenData?.wandererParticipatingPets as Array<{ loadout?: { consumable?: string } }>)[0]?.loadout?.consumable, undefined);
    const cooldownProof = await kv.get<Record<string, unknown>>(wandererUseCooldownKey(playerName, encounter.id));
    assert.equal(cooldownProof?.proofId, `pet-wanderer:${token}`);

    const resumed = response();
    await startHandler(request(body, auth, 32), resumed.res);
    assert.equal(resumed.out.statusCode, 200);
    assert.equal(resumed.out.body?.resumed, true);
    for (const field of ['token', 'reportKey', 'seed', 'outcome', 'cooldownUntil', 'moveToSector'] as const) {
        assert.deepEqual(resumed.out.body?.[field], first.out.body?.[field], field);
    }
    assert.deepEqual(resumed.out.body?.showdownScript, first.out.body?.showdownScript);
    assert.equal(resumed.out.body?._saveVersion, 2, 'resume must not bump the save version');

    const serverOutcome = String(first.out.body?.outcome);
    const settled = response();
    await resultHandler(request({
        playerName,
        battleToken: token,
        reportKey: first.out.body?.reportKey,
        outcome: serverOutcome === 'win' ? 'loss' : 'win',
        inputLog: [{ kind: 'move', moveIndex: 999 }],
    }, auth, 33), settled.res);
    assert.equal(settled.out.statusCode, 200);
    assert.equal(settled.out.body?.outcome, serverOutcome);
    assert.equal(settled.out.body?.reward, 0);
    assert.equal(settled.out.body?.totalPetWins, 5);
    const saved = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const character = saved?.character as Record<string, unknown>;
    assert.equal(character.ryo, 77);
    assert.equal(character.totalPetWins, 5);
    assert.equal(character.dailyPetWins, 2);
    assert.equal((((character.pets as Array<Record<string, unknown>>)[0].loadout) as Record<string, unknown>).consumable, 'test-tonic');
    assert.equal(await kv.get(`legacy:stats:${playerName}`), null);

    const settledVersion = saved?._saveVersion;
    const activeKey = `pet:battle-active:${playerName}`;
    assert.equal(await kv.get(`pet:battle-token:${playerName}:${token}`), null);
    await kv.set(activeKey, token, { ex: 15 * 60 });
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6_000;
    const originalDelIfEqual = kv.delIfEqual.bind(kv);
    let cleanupFailed = false;
    kv.delIfEqual = (async (key, expected) => {
        if (key === activeKey && expected === token && !cleanupFailed) {
            cleanupFailed = true;
            return false;
        }
        return originalDelIfEqual(key, expected);
    }) as typeof kv.delIfEqual;
    try {
        const interruptedReplay = response();
        await resultHandler(request({
            playerName,
            battleToken: token,
            reportKey: first.out.body?.reportKey,
            outcome: serverOutcome === 'win' ? 'loss' : 'win',
        }, auth, 34), interruptedReplay.res);
        assert.equal(interruptedReplay.out.statusCode, 503);
        assert.equal(await kv.get(activeKey), token, 'failed cleanup keeps the exact pointer retryable');
    } finally {
        kv.delIfEqual = originalDelIfEqual as typeof kv.delIfEqual;
    }
    Date.now = () => realDateNow() + 12_000;
    try {
        const settlementReplay = response();
        await resultHandler(request({
            playerName,
            battleToken: token,
            reportKey: first.out.body?.reportKey,
            outcome: serverOutcome === 'win' ? 'loss' : 'win',
        }, auth, 35), settlementReplay.res);
        assert.equal(settlementReplay.out.statusCode, 200);
        assert.equal(settlementReplay.out.body?.replayed, true);
        assert.equal(settlementReplay.out.body?._saveVersion, settledVersion);
        assert.equal((await kv.get<Record<string, unknown>>(`save:${playerName}`))?._saveVersion, settledVersion);
        assert.equal(await kv.get(activeKey), null, 'receipt replay heals a token-gone, pointer-live crash window');
    } finally {
        Date.now = realDateNow;
    }

    const spent = response();
    await startHandler(request(body, auth, 39), spent.res);
    assert.equal(spent.out.statusCode, 409);
    assert.match(String(spent.out.body?.error), /already been settled/i);
});

test('near-expiry start recovery refreshes the exact token and active-pointer leases', async (t) => {
    if (PET_DUEL_SKIP_TODAY) return t.skip(PET_DUEL_SKIP_TODAY);
    const playerName = 'wanderpetleaserefresh';
    const auth = issuePlayerToken(playerName)!;
    const fixture = pet('wanderpet-lease-pet');
    const realDateNow = Date.now;
    const baseNow = realDateNow();
    Date.now = () => baseNow;
    try {
        const encounter = findWanderer(
            { name: playerName, level: 32, starterCardsClaimed: true, pets: [fixture] },
            'petDuel',
            baseNow,
        );
        await savePlayer(playerName, encounter.sector, fixture);
        const body = {
            playerName,
            mode: '1v1',
            playerPetIds: [fixture.id],
            wanderer: { id: encounter.id, sector: encounter.sector },
        };
        const first = response();
        await startHandler(request(body, auth, 36), first.res);
        assert.equal(first.out.statusCode, 200);
        const token = String(first.out.body?.token ?? '');

        Date.now = () => baseNow + (15 * 60 * 1_000) - 1_000;
        const recovered = response();
        await startHandler(request(body, auth, 37), recovered.res);
        assert.equal(recovered.out.statusCode, 200);
        assert.equal(recovered.out.body?.resumed, true);
        for (const field of ['token', 'reportKey', 'seed', 'outcome'] as const) {
            assert.deepEqual(recovered.out.body?.[field], first.out.body?.[field], field);
        }
        assert.deepEqual(recovered.out.body?.showdownScript, first.out.body?.showdownScript);

        // Both original 15-minute leases would now be expired. Recovery must
        // have refreshed the unchanged values atomically before returning.
        Date.now = () => baseNow + (15 * 60 * 1_000) + 1_000;
        assert.ok(await kv.get(`pet:battle-token:${playerName}:${token}`));
        assert.equal(await kv.get(`pet:battle-active:${playerName}`), token);
        const settled = response();
        await resultHandler(request({
            playerName,
            battleToken: token,
            reportKey: first.out.body?.reportKey,
            outcome: first.out.body?.outcome,
        }, auth, 38), settled.res);
        assert.equal(settled.out.statusCode, 200);
        assert.ok(settled.out.body?.character);
    } finally {
        Date.now = realDateNow;
    }
});

test('conflicting opponent, PvP, ranked, HG, Dungeon and party contexts fail before proof publication', async (t) => {
    if (PET_DUEL_SKIP_TODAY) return t.skip(PET_DUEL_SKIP_TODAY);
    const playerName = 'wanderpetconflict';
    const auth = issuePlayerToken(playerName)!;
    const fixture = pet('wanderpet-conflict-pet');
    const encounter = findWanderer({ name: playerName, level: 32, starterCardsClaimed: true, pets: [fixture] }, 'petDuel');
    await savePlayer(playerName, encounter.sector, fixture);
    const base = { playerName, mode: '1v1', playerPetIds: [fixture.id], wanderer: { id: encounter.id, sector: encounter.sector } };
    const conflicts = [
        { opponentName: 'rival' },
        { opponentLevel: 100 },
        { opponentPetIds: ['forged'] },
        { seed: 7 },
        { pvpChallengeId: 'challenge-proof' },
        { ranked: true, matchToken: 'ranked-proof' },
        { hollowGate: { runId: 'gate', token: 'gate-token' } },
        { dungeon: { token: 'dungeon-token' } },
        { mode: '2v2' },
        { wanderer: { id: encounter.id.replace(/^w-\d+-/, 'w-81-'), sector: encounter.sector } },
    ];
    for (let index = 0; index < conflicts.length; index += 1) {
        const rejected = response();
        await startHandler(request({ ...base, ...conflicts[index] }, auth, 40 + index), rejected.res);
        assert.equal(rejected.out.statusCode, 400);
    }
    assert.equal(await kv.get(`pet:wanderer-duel:${playerName}:${encounter.id}`), null);
    assert.equal(await kv.get(wandererUseCooldownKey(playerName, encounter.id)), null);
});

test('wrong verb, saved sector, live presence, stale bucket and unreachable roster index fail closed', async (t) => {
    if (PET_DUEL_SKIP_TODAY) return t.skip(PET_DUEL_SKIP_TODAY);
    const cases = [
        { name: 'wanderpetwrongverb', kind: 'verb' },
        { name: 'wanderpetwrongsave', kind: 'save' },
        { name: 'wanderpetwrongpresence', kind: 'presence' },
        { name: 'wanderpetstalebucket', kind: 'stale' },
        { name: 'wanderpetbadindex', kind: 'index' },
    ] as const;
    for (let i = 0; i < cases.length; i += 1) {
        const { name, kind } = cases[i];
        const auth = issuePlayerToken(name)!;
        const fixture = pet(`${name}-pet`);
        const baseChar = { name, level: 32, starterCardsClaimed: true, pets: [fixture] };
        const encounter = findWanderer(baseChar, kind === 'verb' ? 'attack' : 'petDuel');
        await savePlayer(name, encounter.sector, fixture);
        let id = encounter.id;
        let sector = encounter.sector;
        if (kind === 'save') {
            const save = await kv.get<Record<string, unknown>>(`save:${name}`);
            await kv.set(`save:${name}`, { ...save, currentSector: sector === 80 ? 79 : sector + 1 });
        } else if (kind === 'presence') {
            onlineStore.remove(name);
            onlineStore.upsert({
                name,
                sector: sector === 80 ? 79 : sector + 1,
                character: { name, hp: 100, maxHp: 100 },
            });
        } else if (kind === 'stale') {
            const parts = id.split('-');
            parts[2] = String(Number(parts[2]) - 1);
            id = parts.join('-');
        } else if (kind === 'index') {
            id = id.replace(/-[01]$/, '-2');
        }
        const rejected = response();
        await startHandler(request({ playerName: name, mode: '1v1', playerPetIds: [fixture.id], wanderer: { id, sector } }, auth, 60 + i), rejected.res);
        assert.equal(rejected.out.statusCode, kind === 'index' ? 400 : 409, `${kind}: ${String(rejected.out.body?.error)}`);
        assert.equal(await kv.get(wandererUseCooldownKey(name, id)), null);
    }
});

test('a failed immutable-session publication cannot spend the cooldown or mutate the save', async (t) => {
    if (PET_DUEL_SKIP_TODAY) return t.skip(PET_DUEL_SKIP_TODAY);
    const playerName = 'wanderpetpublishfail';
    const auth = issuePlayerToken(playerName)!;
    const fixture = pet('wanderpet-publish-pet');
    const encounter = findWanderer({ name: playerName, level: 32, starterCardsClaimed: true, pets: [fixture] }, 'petDuel');
    await savePlayer(playerName, encounter.sector, fixture);
    const key = `pet:wanderer-duel:${playerName}:${encounter.id}`;
    const originalSet = kv.set.bind(kv);
    kv.set = (async (target: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (target === key) throw new Error('injected-session-publication-failure');
        return originalSet(target, value, options);
    }) as typeof kv.set;
    try {
        const failed = response();
        await startHandler(request({
            playerName, mode: '1v1', playerPetIds: [fixture.id],
            wanderer: { id: encounter.id, sector: encounter.sector },
        }, auth, 70), failed.res);
        assert.equal(failed.out.statusCode, 500);
    } finally {
        kv.set = originalSet as typeof kv.set;
    }
    assert.equal(await kv.get(key), null);
    assert.equal(await kv.get(wandererUseCooldownKey(playerName, encounter.id)), null);
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    assert.equal(save?._saveVersion, 1);
    assert.equal((save?.character as Record<string, unknown>).wandererCooldowns, undefined);
});

test('a save-write failure after proof and cooldown publication recovers the exact session once', async (t) => {
    if (PET_DUEL_SKIP_TODAY) return t.skip(PET_DUEL_SKIP_TODAY);
    const playerName = 'wanderpetpostpublish';
    const auth = issuePlayerToken(playerName)!;
    const fixture = pet('wanderpet-post-publish-pet');
    const encounter = findWanderer({ name: playerName, level: 32, starterCardsClaimed: true, pets: [fixture] }, 'petDuel');
    await savePlayer(playerName, encounter.sector, fixture);
    const saveKey = `save:${playerName}`;
    const sessionKey = `pet:wanderer-duel:${playerName}:${encounter.id}`;
    const cooldownKey = wandererUseCooldownKey(playerName, encounter.id);
    const body = {
        playerName, mode: '1v1', playerPetIds: [fixture.id],
        wanderer: { id: encounter.id, sector: encounter.sector },
    };
    const originalCompareSet = kv.compareSet.bind(kv);
    let injected = false;
    kv.compareSet = (async (key, expected, value, options) => {
        if (key === saveKey && !injected && await kv.get(cooldownKey) !== null) {
            injected = true;
            throw new Error('injected-post-publication-save-failure');
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;
    try {
        const failed = response();
        await startHandler(request(body, auth, 75), failed.res);
        assert.equal(failed.out.statusCode, 500);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(injected, true, 'failure must occur only after the cooldown proof is readable');
    const retained = await kv.get<Record<string, unknown>>(sessionKey);
    assert.ok(retained);
    assert.ok(await kv.get(`pet:battle-token:${playerName}:${String(retained.token)}`));
    assert.equal(await kv.get(`pet:battle-active:${playerName}`), retained.token);
    assert.ok(await kv.get(cooldownKey));
    assert.equal((await kv.get<Record<string, unknown>>(saveKey))?._saveVersion, 1);

    const recovered = response();
    await startHandler(request(body, auth, 76), recovered.res);
    assert.equal(recovered.out.statusCode, 200);
    assert.equal(recovered.out.body?.resumed, true);
    for (const field of ['token', 'reportKey', 'seed', 'outcome'] as const) {
        assert.deepEqual(recovered.out.body?.[field], retained[field], field);
    }
    assert.deepEqual(recovered.out.body?.showdownScript, retained.showdownScript);
    assert.equal(recovered.out.body?._saveVersion, 2);
    const authoritative = recovered.out.body?.character as Record<string, unknown>;
    assert.equal(Number((authoritative.wandererCooldowns as Record<string, unknown>)[encounter.id]), retained.cooldownUntil);

    const replay = response();
    await startHandler(request(body, auth, 77), replay.res);
    assert.equal(replay.out.statusCode, 200);
    assert.equal(replay.out.body?._saveVersion, 2, 'successful recovery must not rewrite the save');
    assert.equal((await kv.get<Record<string, unknown>>(saveKey))?._saveVersion, 2);
});

test('an unrelated active battle blocks cooldown, then the retained NX session recovers unchanged', async (t) => {
    if (PET_DUEL_SKIP_TODAY) return t.skip(PET_DUEL_SKIP_TODAY);
    const playerName = 'wanderpetactive';
    const auth = issuePlayerToken(playerName)!;
    const fixture = pet('wanderpet-active-pet');
    const encounter = findWanderer({ name: playerName, level: 32, starterCardsClaimed: true, pets: [fixture] }, 'petDuel');
    await savePlayer(playerName, encounter.sector, fixture);
    await kv.set(`pet:battle-token:${playerName}:otherbattle`, { playerName, reportKey: 'pet:otherbattle' }, { ex: 900 });
    await kv.set(`pet:battle-active:${playerName}`, 'otherbattle', { ex: 900 });
    const body = { playerName, mode: '1v1', playerPetIds: [fixture.id], wanderer: { id: encounter.id, sector: encounter.sector } };

    const blocked = response();
    await startHandler(request(body, auth, 80), blocked.res);
    assert.equal(blocked.out.statusCode, 409);
    assert.equal(await kv.get(wandererUseCooldownKey(playerName, encounter.id)), null);
    const retained = await kv.get<Record<string, unknown>>(`pet:wanderer-duel:${playerName}:${encounter.id}`);
    assert.ok(retained?.token);

    await kv.del(`pet:battle-token:${playerName}:otherbattle`, `pet:battle-active:${playerName}`);
    const recovered = response();
    await startHandler(request(body, auth, 81), recovered.res);
    assert.equal(recovered.out.statusCode, 200);
    assert.equal(recovered.out.body?.resumed, true);
    assert.equal(recovered.out.body?.token, retained?.token);
    assert.deepEqual(recovered.out.body?.showdownScript, retained?.showdownScript);
});
