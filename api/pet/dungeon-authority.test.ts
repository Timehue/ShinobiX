import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'dungeon-pet-authority-test-secret-32';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let startHandler: Handler;
let resultHandler: Handler;
let dungeonRunHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

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

function request(body: Record<string, unknown>, authToken: string, remoteAddress: string) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': authToken },
        socket: { remoteAddress },
    } as never;
}

const PLAYER_PET_ID = 'dungeon-pet-hero';

function readyCharacter(playerName: string, runToken: string) {
    return {
        name: playerName,
        level: 80,
        ryo: 321,
        totalPetWins: 7,
        dailyPetWins: 2,
        lastDailyReset: '2000-01-01',
        activePetId: PLAYER_PET_ID,
        tileCards: [],
        itemStacks: [{ itemId: 'pet-treat', count: 2 }],
        pets: [{
            id: PLAYER_PET_ID,
            name: 'Dungeon Sentinel',
            nickname: 'Keystone',
            element: 'Water',
            rarity: 'rare',
            level: 80,
            xp: 0,
            maxLevel: 100,
            hp: 10_000,
            attack: 10_000,
            defense: 10_000,
            speed: 1_000,
            unlockedForPve: true,
            chronicleArenaWins: 9,
            loadout: { consumable: 'pet-treat' },
            jutsus: [{ name: 'Tidal Verdict', power: 500, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
        }],
        activeDungeonRun: {
            token: runToken,
            startedAt: 1,
            entry: 'key',
            combatAuthorityVersion: 1,
            wardenDefeated: true,
            wardenProofId: 'wardenproof0001',
            cardAuthorityVersion: 1,
            cardLastOutcome: 'player',
            cardLastProofId: 'cardproof000001',
            cardSettledAt: 2,
            cardDefeated: true,
            cardProofId: 'cardproof000001',
            cardDefeatedAt: 2,
        },
    };
}

async function installSave(playerName: string, runToken: string) {
    await kv.set(`save:${playerName}`, { _saveVersion: 1, character: readyCharacter(playerName, runToken) });
}

async function startDungeonBattle(playerName: string, authToken: string, runToken: string, ip: string) {
    const started = response();
    await startHandler(request({
        playerName,
        playerPetIds: [PLAYER_PET_ID],
        opponentPetIds: ['forged-client-beast'],
        opponentName: 'forged-opponent',
        opponentLevel: 100,
        seed: 0,
        mode: '1v1',
        dungeon: { token: runToken },
    }, authToken, ip), started.res);
    return started.out;
}

async function reportDungeonBattle(
    playerName: string,
    authToken: string,
    started: Out,
    ip: string,
) {
    const settled = response();
    await resultHandler(request({
        playerName,
        outcome: 'loss',
        reportKey: started.body?.reportKey,
        battleToken: started.body?.token,
        inputLog: [],
    }, authToken, ip), settled.res);
    return settled.out;
}

async function settleDungeonRun(playerName: string, authToken: string, runToken: string, ip: string) {
    const settled = response();
    await dungeonRunHandler(request({
        playerName,
        action: 'settle',
        token: runToken,
    }, authToken, ip), settled.res);
    return settled.out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    startHandler = (await import('./battle-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
    dungeonRunHandler = (await import('../dungeon/run.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('Dungeon Rare Beast server authority', () => {
    it('requires the exact proved run, fixes the Beast and refuses cross-authority resume', async () => {
        const playerName = 'dungeonpetstartprobe';
        const runToken = 'dungeonpetstart01';
        const authToken = issuePlayerToken(playerName)!;
        await kv.set(`save:${playerName}`, {
            _saveVersion: 1,
            character: {
                ...readyCharacter(playerName, runToken),
                activeDungeonRun: { token: runToken },
            },
        });
        const premature = await startDungeonBattle(playerName, authToken, runToken, '127.0.3.1');
        assert.equal(premature.statusCode, 409);
        assert.match(String(premature.body?.error), /Warden win/);

        await installSave(playerName, runToken);
        const started = await startDungeonBattle(playerName, authToken, runToken, '127.0.3.2');
        assert.equal(started.statusCode, 200);
        assert.equal(started.body?.dungeon, true);
        assert.notEqual(started.body?.seed, 0, 'the caller cannot choose the replay seed');
        const opponents = started.body?.opponentPets as Array<Record<string, unknown>>;
        assert.equal(opponents.length, 1);
        assert.deepEqual(
            { id: opponents[0]?.id, name: opponents[0]?.name, rarity: opponents[0]?.rarity, level: opponents[0]?.level },
            { id: 'dungeon-rare-beast', name: 'Sealed Rare Beast', rarity: 'rare', level: 55 },
        );
        const battleToken = String(started.body?.token ?? '');
        const seal = await kv.get<Record<string, unknown>>(`pet:battle-token:${playerName}:${battleToken}`);
        assert.deepEqual(seal?.dungeon, { authorityVersion: 1, runToken });
        assert.deepEqual(seal?.opponentPetIds, ['dungeon-rare-beast']);
        assert.equal(seal?.rewardRyo, 0);

        const ordinary = response();
        await startHandler(request({
            playerName,
            playerPetIds: [PLAYER_PET_ID],
            opponentPetIds: ['generic-ai-pet-sparrow'],
            mode: '1v1',
        }, authToken, '127.0.3.3'), ordinary.res);
        assert.equal(ordinary.out.statusCode, 410, 'retired picked-AI admission stays closed even while Dungeon owns the active lease');
        assert.notEqual(ordinary.out.body?.resumed, true);

        const prior = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        await kv.set(`save:${playerName}`, {
            ...prior,
            character: readyCharacter(playerName, 'dungeonpetstart02'),
        });
        const differentRun = await startDungeonBattle(playerName, authToken, 'dungeonpetstart02', '127.0.3.4');
        assert.equal(differentRun.statusCode, 409);
        assert.notEqual(differentRun.body?.resumed, true);

        const mixed = response();
        await startHandler(request({
            playerName,
            playerPetIds: [PLAYER_PET_ID],
            mode: '1v1',
            dungeon: { token: 'dungeonpetstart02' },
            hollowGate: { token: 'hollowtoken01', runId: 'hollowrun01' },
        }, authToken, '127.0.3.5'), mixed.res);
        assert.equal(mixed.out.statusCode, 400);
    });

    it('heals a pointer-first crash whose active battle seal is missing', async () => {
        const playerName = 'dungeonpetorphanpointer';
        const runToken = 'dungeonpetorphan01';
        const authToken = issuePlayerToken(playerName)!;
        await installSave(playerName, runToken);
        await kv.set(`pet:battle-active:${playerName}`, 'missingseal0001', { ex: 900 });

        const started = await startDungeonBattle(playerName, authToken, runToken, '127.0.3.6');
        assert.equal(started.statusCode, 200);
        const battleToken = String(started.body?.token ?? '');
        assert.ok(battleToken);
        assert.notEqual(battleToken, 'missingseal0001');
        assert.ok(await kv.get(`pet:battle-token:${playerName}:${battleToken}`));
        assert.equal(await kv.get(`pet:battle-active:${playerName}`), battleToken);
    });

    it('replays the sealed outcome and terminalizes without Coliseum, Legacy, or witness rewards', async () => {
        const playerName = 'dungeonpetsettleprobe';
        const runToken = 'dungeonpetsettle01';
        const authToken = issuePlayerToken(playerName)!;
        await installSave(playerName, runToken);
        const started = await startDungeonBattle(playerName, authToken, runToken, '127.0.4.1');
        assert.equal(started.statusCode, 200);

        const settled = await reportDungeonBattle(playerName, authToken, started, '127.0.4.2');
        assert.equal(settled.statusCode, 200);
        assert.equal(settled.body?.outcome, 'win', 'the sealed server replay overrides the forged client loss');
        assert.equal(settled.body?.reward, 0);
        assert.deepEqual(settled.body?.chronicleCards, []);
        assert.deepEqual(settled.body?.witnessedPets, []);
        assert.deepEqual(settled.body?.livingWitnessProgress, []);

        const battleToken = String(started.body?.token ?? '');
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = save?.character as Record<string, unknown>;
        const activeRun = character.activeDungeonRun as Record<string, unknown>;
        const pet = (character.pets as Array<Record<string, unknown>>)[0];
        assert.equal(save?._saveVersion, 2);
        assert.equal(character.ryo, 321);
        assert.equal(character.totalPetWins, 7);
        assert.equal(character.dailyPetWins, 2);
        assert.equal(activeRun.petDefeated, true);
        assert.equal(activeRun.petProofId, battleToken);
        assert.equal((pet.loadout as Record<string, unknown>).consumable, undefined);
        assert.equal(pet.chronicleArenaWins, 9);
        assert.deepEqual(character.tileCards, []);
        assert.ok(await kv.get(`pet:dungeon-result:${playerName}:${battleToken}`));
        assert.equal(await kv.get(`pet:battle-token:${playerName}:${battleToken}`), null);
        assert.equal(await kv.get(`pet:battle-active:${playerName}`), null);
        assert.equal(await kv.get(`legacy:stats:${playerName}`), null);

        const realNow = Date.now;
        Date.now = () => realNow() + 6_000;
        try {
            const replayed = await reportDungeonBattle(playerName, authToken, started, '127.0.4.3');
            assert.equal(replayed.statusCode, 200);
            assert.equal(replayed.body?.replayed, true);
            assert.equal(replayed.body?.outcome, 'win');
            const afterReplay = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            assert.equal(afterReplay?._saveVersion, 2);
        } finally {
            Date.now = realNow;
        }
    });

    it('settles concurrent reports once and retains the token across a result-receipt outage', async () => {
        const concurrentPlayer = 'dungeonpetconcurrent';
        const concurrentRun = 'dungeonpetconcur01';
        const concurrentAuth = issuePlayerToken(concurrentPlayer)!;
        await installSave(concurrentPlayer, concurrentRun);
        const concurrentStart = await startDungeonBattle(concurrentPlayer, concurrentAuth, concurrentRun, '127.0.5.1');
        assert.equal(concurrentStart.statusCode, 200);

        const realNow = Date.now;
        let tick = realNow() + 30_000;
        Date.now = () => { tick += 6_001; return tick; };
        try {
            const [first, second] = await Promise.all([
                reportDungeonBattle(concurrentPlayer, concurrentAuth, concurrentStart, '127.0.5.2'),
                reportDungeonBattle(concurrentPlayer, concurrentAuth, concurrentStart, '127.0.5.3'),
            ]);
            assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 200]);
        } finally {
            Date.now = realNow;
        }
        const concurrentSave = await kv.get<Record<string, unknown>>(`save:${concurrentPlayer}`);
        const concurrentCharacter = concurrentSave?.character as Record<string, unknown>;
        assert.equal(concurrentSave?._saveVersion, 2, 'the terminal save commits exactly once');
        assert.equal((concurrentCharacter.itemStacks as Array<Record<string, unknown>>)[0]?.count, 2);
        assert.equal(((concurrentCharacter.pets as Array<Record<string, unknown>>)[0]?.loadout as Record<string, unknown>).consumable, undefined);

        const outagePlayer = 'dungeonpetreceiptoutage';
        const outageRun = 'dungeonpetoutage01';
        const outageAuth = issuePlayerToken(outagePlayer)!;
        await installSave(outagePlayer, outageRun);
        const outageStart = await startDungeonBattle(outagePlayer, outageAuth, outageRun, '127.0.6.1');
        assert.equal(outageStart.statusCode, 200);
        const outageToken = String(outageStart.body?.token ?? '');
        const receiptKey = `pet:dungeon-result:${outagePlayer}:${outageToken}`;
        const originalSet = kv.set.bind(kv);
        kv.set = (async (key, value, options) => {
            if (key === receiptKey) throw new Error('injected Dungeon result receipt outage');
            return originalSet(key, value, options);
        }) as typeof kv.set;
        try {
            const failed = await reportDungeonBattle(outagePlayer, outageAuth, outageStart, '127.0.6.2');
            assert.equal(failed.statusCode, 503);
            assert.ok(await kv.get(`pet:battle-token:${outagePlayer}:${outageToken}`), 'retry authority stays live');
            assert.equal(await kv.get(`pet:battle-active:${outagePlayer}`), outageToken);
            const partiallySettled = await kv.get<Record<string, unknown>>(`save:${outagePlayer}`);
            assert.equal(partiallySettled?._saveVersion, 2, 'the atomic save landed before the receipt outage');
        } finally {
            kv.set = originalSet as typeof kv.set;
        }

        const retryNow = Date.now;
        Date.now = () => retryNow() + 6_000;
        try {
            const recovered = await reportDungeonBattle(outagePlayer, outageAuth, outageStart, '127.0.6.3');
            assert.equal(recovered.statusCode, 200);
            assert.ok(await kv.get(receiptKey));
            assert.equal(await kv.get(`pet:battle-token:${outagePlayer}:${outageToken}`), null);
            const recoveredSave = await kv.get<Record<string, unknown>>(`save:${outagePlayer}`);
            const recoveredCharacter = recoveredSave?.character as Record<string, unknown>;
            assert.equal(recoveredSave?._saveVersion, 2, 'receipt repair does not write the terminal twice');
            assert.equal((recoveredCharacter.itemStacks as Array<Record<string, unknown>>)[0]?.count, 2, 'receipt repair does not spend another consumable');
        } finally {
            Date.now = retryNow;
        }
    });

    it('replays durable results and clears either cleanup-crash lease shape after parent settlement', async () => {
        const runCleanupCrash = async (variant: 'token-live' | 'token-gone', index: number) => {
            const playerName = `dungeonpetcleanup${index}`;
            const runToken = `dungeonpetcleanup0${index}`;
            const authToken = issuePlayerToken(playerName)!;
            await installSave(playerName, runToken);
            const started = await startDungeonBattle(playerName, authToken, runToken, `127.0.7.${index}`);
            assert.equal(started.statusCode, 200);
            const battleToken = String(started.body?.token ?? '');
            const tokenKey = `pet:battle-token:${playerName}:${battleToken}`;
            const activeKey = `pet:battle-active:${playerName}`;

            const originalDel = kv.del.bind(kv);
            const originalDelIfEqual = kv.delIfEqual.bind(kv);
            kv.del = (async (key) => {
                if (variant === 'token-live' && key === tokenKey) return 0;
                return originalDel(key);
            }) as typeof kv.del;
            kv.delIfEqual = (async (key, expected) => {
                if (key === activeKey && expected === battleToken) return false;
                return originalDelIfEqual(key, expected);
            }) as typeof kv.delIfEqual;
            try {
                const first = await reportDungeonBattle(playerName, authToken, started, `127.0.8.${index}`);
                assert.equal(first.statusCode, 200);
            } finally {
                kv.del = originalDel as typeof kv.del;
                kv.delIfEqual = originalDelIfEqual as typeof kv.delIfEqual;
            }

            assert.equal(await kv.get(activeKey), battleToken, 'the injected crash leaves the global lease');
            assert.equal(
                Boolean(await kv.get(tokenKey)),
                variant === 'token-live',
                'the two crash variants differ only in whether the short token was deleted',
            );

            const claimed = await settleDungeonRun(playerName, authToken, runToken, `127.0.9.${index}`);
            assert.equal(claimed.statusCode, 200);
            const claimedCharacter = claimed.body?.character as Record<string, unknown>;
            assert.equal(claimedCharacter.activeDungeonRun, null);

            const realNow = Date.now;
            Date.now = () => realNow() + 6_000;
            try {
                const replayed = await reportDungeonBattle(playerName, authToken, started, `127.0.10.${index}`);
                assert.equal(replayed.statusCode, 200);
                assert.equal(replayed.body?.replayed, true);
                assert.equal(replayed.body?.outcome, 'win');
            } finally {
                Date.now = realNow;
            }
            assert.equal(await kv.get(tokenKey), null);
            assert.equal(await kv.get(activeKey), null, 'durable replay heals the stale global lease');
        };

        await runCleanupCrash('token-live', 1);
        await runCleanupCrash('token-gone', 2);
    });

    it('retires a completed Dungeon lease before admitting a new social pet battle', async () => {
        const playerName = 'dungeonpetnextadmit';
        const opponentName = 'dungeonpetnextfoe';
        const opponentPetId = 'dungeon-pet-next-foe';
        const runToken = 'dungeonpetnext001';
        const authToken = issuePlayerToken(playerName)!;
        await installSave(playerName, runToken);
        const started = await startDungeonBattle(playerName, authToken, runToken, '127.0.11.1');
        assert.equal(started.statusCode, 200);
        const oldBattleToken = String(started.body?.token ?? '');
        const oldTokenKey = `pet:battle-token:${playerName}:${oldBattleToken}`;
        const activeKey = `pet:battle-active:${playerName}`;

        const originalDel = kv.del.bind(kv);
        const originalDelIfEqual = kv.delIfEqual.bind(kv);
        kv.del = (async (key) => key === oldTokenKey ? 0 : originalDel(key)) as typeof kv.del;
        kv.delIfEqual = (async (key, expected) => (
            key === activeKey && expected === oldBattleToken ? false : originalDelIfEqual(key, expected)
        )) as typeof kv.delIfEqual;
        try {
            const first = await reportDungeonBattle(playerName, authToken, started, '127.0.11.2');
            assert.equal(first.statusCode, 200);
        } finally {
            kv.del = originalDel as typeof kv.del;
            kv.delIfEqual = originalDelIfEqual as typeof kv.delIfEqual;
        }
        assert.ok(await kv.get(oldTokenKey));
        assert.equal(await kv.get(activeKey), oldBattleToken);

        const claimed = await settleDungeonRun(playerName, authToken, runToken, '127.0.11.3');
        assert.equal(claimed.statusCode, 200);

        const playerSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const playerCharacter = playerSave?.character as Record<string, unknown>;
        const playerPet = (playerCharacter.pets as Array<Record<string, unknown>>)[0];
        await kv.set(`save:${opponentName}`, {
            _saveVersion: 1,
            character: {
                ...playerCharacter,
                name: opponentName,
                activePetId: opponentPetId,
                activeDungeonRun: null,
                pets: [{ ...playerPet, id: opponentPetId, name: 'Social Recovery Foil', nickname: 'Foil' }],
            },
        });

        const next = response();
        await startHandler(request({
            playerName,
            playerPetIds: [PLAYER_PET_ID],
            opponentName,
            opponentPetIds: [opponentPetId],
            mode: '1v1',
        }, authToken, '127.0.11.4'), next.res);
        assert.equal(next.out.statusCode, 200);
        const nextToken = String(next.out.body?.token ?? '');
        assert.ok(nextToken);
        assert.notEqual(nextToken, oldBattleToken);
        assert.equal(await kv.get(oldTokenKey), null);
        assert.equal(await kv.get(activeKey), nextToken);
        assert.ok(await kv.get(`pet:battle-token:${playerName}:${nextToken}`));
    });
});
