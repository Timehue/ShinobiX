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

/**
 * What a Postgres jsonb read hands back: the JSON form, with every object's keys
 * in jsonb order (shorter keys first, then bytewise) rather than insertion order.
 */
function postgresRead(value: unknown): unknown {
    const order = (entry: unknown): unknown => {
        if (Array.isArray(entry)) return entry.map(order);
        if (!entry || typeof entry !== 'object') return entry;
        return Object.fromEntries(Object.entries(entry)
            .sort(([a], [b]) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)))
            .map(([key, child]) => [key, order(child)]));
    };
    return value === null ? null : order(JSON.parse(JSON.stringify(value)));
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
    // Historical proof fixture: fresh cinematic admission is permanently shut.
    // Preserve the pre-cutover result, retry and parent-payment regressions.
    void authToken; void ip;
    const { createCasualPveBattleSeal } = await import('./_casual-pve-seal.js');
    const { buildDungeonRareBeast } = await import('./_dungeon-battle.js');
    const { replayCasualPetDuel } = await import('./_duel-replay.js');
    const { randomUUID } = await import('node:crypto');
    const token = randomUUID().replace(/-/g, '');
    const reportKey = `pet:${token}`;
    const seed = 771;
    const params = { mode: '1v1' as const, seed, damageMult: 1, hpMult: 1, revive: false, applyItems: true, accuracy: true, terrain: null };
    const save = await kv.get<{ character: ReturnType<typeof readyCharacter> }>(`save:${playerName}`);
    const seal = createCasualPveBattleSeal(save!.character.pets as never, [buildDungeonRareBeast()], params);
    await kv.set(`pet:battle-token:${playerName}:${token}`, {
        playerName, opponentName: 'Sealed Rare Beast', opponentLevel: 55, rewardRyo: 0,
        reportKey, seed, mode: '1v1', createdAt: Date.now(), playerPetIds: [PLAYER_PET_ID],
        opponentPetIds: ['dungeon-rare-beast'], dungeon: { authorityVersion: 1, runToken },
        settlementPolicy: 'parent-mode', sealedParams: params, casualPveSeal: seal,
        authoritativeOutcome: replayCasualPetDuel(seal.playerPets, seal.opponentPets, params, []).outcome,
    }, { ex: 900 });
    await kv.set(`pet:battle-active:${playerName}`, token, { ex: 900 });
    return { statusCode: 200, body: { token, reportKey, seed, dungeon: true, opponentPets: [buildDungeonRareBeast()] } };
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
    it('refuses every new cinematic Dungeon admission without minting a token', async () => {
        const name = 'dungeonretiredadmit';
        const runToken = 'retiredrun0001';
        await installSave(name, runToken);
        const rejected = response();
        await startHandler(request({ playerName: name, playerPetIds: [PLAYER_PET_ID], mode: '1v1', dungeon: { token: runToken } }, issuePlayerToken(name)!, '127.0.3.1'), rejected.res);
        assert.equal(rejected.out.statusCode, 410);
        assert.match(String(rejected.out.body?.error), /Pet Arena command/);
        assert.equal(await kv.get(`pet:battle-active:${name}`), null);
        assert.equal((await kv.get<Record<string, unknown>>(`save:${name}`))?._saveVersion, 1);
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

    it('settles a Rare Beast result once Postgres has reordered the sealed token', async (t) => {
        // The fixed Beast snapshot is compared with the one sealed in the battle
        // token. jsonb returns that token with its keys reordered (hp, id, xp,
        // name, ...), so comparing JSON text refused every Rare Beast result.
        const playerName = 'dungeonpetjsonbprobe';
        const runToken = 'dungeonpetjsonb01';
        const authToken = issuePlayerToken(playerName)!;
        await installSave(playerName, runToken);
        const started = await startDungeonBattle(playerName, authToken, runToken, '127.0.12.1');
        assert.equal(started.statusCode, 200);
        const realGet = kv.get.bind(kv);
        t.mock.method(kv, 'get', async (key: string) => postgresRead(await realGet(key)));
        const settled = await reportDungeonBattle(playerName, authToken, started, '127.0.12.2');
        assert.equal(settled.statusCode, 200, JSON.stringify(settled.body));
        assert.equal(settled.body?.outcome, 'win', 'the sealed server replay still decides the result');
    });

    it('keeps the idle recovery the player earned since their last save', async () => {
        // The terminal write is a save write. A raw one fenced the regeneration
        // cursor and erased the HP, chakra and stamina recovered since the last
        // save. Re-seed a tired save after the start, so whatever recovery the
        // committed save holds came from the result's own write.
        const playerName = 'dungeonpetregenprobe';
        const runToken = 'dungeonpetregen01';
        const authToken = issuePlayerToken(playerName)!;
        await installSave(playerName, runToken);
        const started = await startDungeonBattle(playerName, authToken, runToken, '127.0.4.4');
        assert.equal(started.statusCode, 200);
        const at = Date.now() - 30_000;
        const current = (await kv.get<Record<string, unknown>>(`save:${playerName}`))!;
        await kv.set(`save:${playerName}`, {
            ...current,
            _saveAt: at,
            _regenAt: at,
            character: {
                ...(current.character as Record<string, unknown>),
                hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100,
            },
        });

        const settled = await reportDungeonBattle(playerName, authToken, started, '127.0.4.5');
        assert.equal(settled.statusCode, 200, JSON.stringify(settled.body));
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = save?.character as Record<string, unknown>;
        assert.equal((character.activeDungeonRun as Record<string, unknown>).petDefeated, true, 'the terminal still landed');
        for (const [where, shown] of [['committed save', character], ['reply', settled.body?.character]] as Array<[string, Record<string, unknown> | undefined]>) {
            assert.ok(Number(shown?.hp) >= 40, `${where}: hp ${shown?.hp} lost the idle recovery`);
            assert.ok(Number(shown?.chakra) >= 50, `${where}: chakra ${shown?.chakra} lost the idle recovery`);
            assert.ok(Number(shown?.stamina) >= 30, `${where}: stamina ${shown?.stamina} lost the idle recovery`);
        }
        assert.equal(settled.body?._saveVersion, save?._saveVersion);
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

    it('keeps fresh admission closed after a historical Dungeon settlement', async () => {
        const playerName = 'dungeonpetnextadmit';
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

        const rejected = response();
        await startHandler(request({ playerName, playerPetIds: [PLAYER_PET_ID], mode: '1v1', dungeon: { token: 'dungeonpetnext002' } }, authToken, '127.0.11.4'), rejected.res);
        assert.equal(rejected.out.statusCode, 410, 'historical cleanup cannot reopen fresh cinematic admission');
    });

});
