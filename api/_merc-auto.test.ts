import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMercAutoDeploy, claimAndResolveMerc } from './_merc-auto.js';
import { defaultVillageWarRecord, villageWarKey } from './_war-state.js';
import type { RoamTarget } from './_merc-roam.js';

// Targeting (pickMercTarget) is unit-tested in _merc-roam.test.ts. These cover the
// cron's gating + dual-pass dispatch without touching kv (the deploy paths + the
// war/contest lists are all injected, and card/flipped/empty cases short-circuit
// before any kv read).

async function withVillageWarDisabled<T>(disabled: boolean, run: () => Promise<T>): Promise<T> {
    const prior = process.env.DISABLE_VILLAGE_WAR;
    if (disabled) process.env.DISABLE_VILLAGE_WAR = '1';
    else delete process.env.DISABLE_VILLAGE_WAR;
    try {
        return await run();
    } finally {
        if (prior === undefined) delete process.env.DISABLE_VILLAGE_WAR;
        else process.env.DISABLE_VILLAGE_WAR = prior;
    }
}

test('runMercAutoDeploy is a no-op under the exact Village War Map kill switch', async () => {
    await withVillageWarDisabled(true, async () => {
        // listContests would throw if it ran — proves the gate short-circuits first.
        const r = await runMercAutoDeploy({ listContests: async () => { throw new Error('gate should short-circuit'); } });
        assert.equal(r.enabled, false);
        assert.equal(r.deployed, 0);
    });
});

test('runMercAutoDeploy defaults on and skips card/flipped sieges plus empty village wars', async () => {
    await withVillageWarDisabled(false, async () => {
        let sectorDeploys = 0;
        let villageDeploys = 0;
        const r = await runMercAutoDeploy({
            listContests: async () => [
                { id: 'x', sector: 5, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'card', flipped: false }, // not combat
                { id: 'y', sector: 6, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'combat', flipped: true },  // already flipped
            ],
            listVillageWars: async () => [],
            onlineNames: () => [],
            onlineAll: () => [],
            deploy: async () => { sectorDeploys++; return { winner: 'merc', attackerPoints: 5, defenderPoints: 0, mercsRemaining: 1 }; },
            deployVillage: async () => { villageDeploys++; return { winner: 'merc', enemyWarHp: 100, mercsRemaining: 1 }; },
        });
        assert.equal(r.enabled, true);
        assert.equal(sectorDeploys, 0, 'a card/flipped contest is never sniped');
        assert.equal(villageDeploys, 0, 'no active village wars → no village-war deploys');
    });
});

// ── Sleeper-camp raids (mercs hit players who logged out in the wild) ─────────
// The camp list, the band, the name→target hydration and the raid itself are all
// injected, so these run without kv. `targetsOf` mirrors liveMercTargets: only
// names in the enemy village come back as marks.

const SECTOR_WAR = { id: 'c1', sector: 5, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'combat', flipped: false };
const BAND = async () => ({ tierId: 'merc-ronin', player: 'kage', level: 20 });
const camp = (name: string, sector: number) => ({ name, displayName: name, sector, createdAt: 1 });
const targetsIn = (village: Record<string, string>) => async (names: readonly string[], enemy: string): Promise<RoamTarget[]> =>
    names.filter((n) => village[n] === enemy).map((n) => ({ name: n, village: enemy, hp: 100, maxHp: 200 }));

test('sector war: an enemy sleeper camp pitched in the contested sector is raided (no live defenders needed)', async () => {
    await withVillageWarDisabled(false, async () => {
        const raids: Array<{ targetPlayer: string; sector: number; attackerVillage: string }> = [];
        const r = await runMercAutoDeploy({
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => [],
            onlineAll: () => [],
            bandOf: BAND,
            listSleepers: async () => [camp('zed', 5), camp('friend', 5), camp('elsewhere', 6)],
            targetsOf: targetsIn({ zed: 'D Village', friend: 'A Village', elsewhere: 'D Village' }),
            deploy: async () => { throw new Error('no live target → no deploy'); },
            raidSleeper: async (a) => { raids.push({ targetPlayer: a.targetPlayer, sector: a.sector, attackerVillage: a.attackerVillage }); return true; },
        });
        assert.equal(r.deployed, 0);
        assert.equal(r.raided, 1);
        assert.deepEqual(raids, [{ targetPlayer: 'zed', sector: 5, attackerVillage: 'A Village' }], 'only the ENEMY camper IN the contested sector; the raiding village rides along for the victim notice');
    });
});

test('sector war: a village / sector-0 logout is never raided, and only one camp per siege per tick', async () => {
    await withVillageWarDisabled(false, async () => {
        const raids: string[] = [];
        const r = await runMercAutoDeploy({
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => [],
            onlineAll: () => [],
            bandOf: BAND,
            // 'home' logged out in the village (a camp can never really have sector 0 — the
            // store refuses it — but the tick must not trust the list either).
            listSleepers: async () => [camp('home', 0), camp('ann', 5), camp('bob', 5)],
            targetsOf: targetsIn({ home: 'D Village', ann: 'D Village', bob: 'D Village' }),
            deploy: async () => null,
            raidSleeper: async (a) => { raids.push(a.targetPlayer); return true; },
        });
        assert.equal(r.raided, 1, 'one raid per siege per tick');
        assert.equal(raids.length, 1);
        assert.notEqual(raids[0], 'home', 'safe-zone logout is untouchable');
    });
});

test('sector war: a refused raid (cooldown / camp gone / already hospitalized) counts nothing — no double hit', async () => {
    await withVillageWarDisabled(false, async () => {
        let attempts = 0;
        const r = await runMercAutoDeploy({
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => [],
            onlineAll: () => [],
            bandOf: BAND,
            listSleepers: async () => [camp('zed', 5)],
            targetsOf: targetsIn({ zed: 'D Village' }),
            deploy: async () => null,
            raidSleeper: async () => { attempts++; return false; },
        });
        assert.equal(attempts, 1);
        assert.equal(r.raided, 0);
    });
});

test('sector war: a live snipe and a sleeper raid can both land in one tick; no band → neither', async () => {
    await withVillageWarDisabled(false, async () => {
        const live: string[] = [];
        const raids: string[] = [];
        const deps = {
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => ['awake'],
            onlineAll: () => [],
            listSleepers: async () => [camp('zed', 5)],
            targetsOf: targetsIn({ awake: 'D Village', zed: 'D Village' }),
            deploy: async (a: { targetPlayer: string }) => { live.push(a.targetPlayer); return { winner: 'merc' as const, attackerPoints: 1, defenderPoints: 0, mercsRemaining: 1 }; },
            raidSleeper: async (a: { targetPlayer: string }) => { raids.push(a.targetPlayer); return true; },
        };
        const r = await runMercAutoDeploy({ ...deps, bandOf: BAND });
        assert.deepEqual({ deployed: r.deployed, raided: r.raided }, { deployed: 1, raided: 1 });
        assert.deepEqual(live, ['awake']);
        assert.deepEqual(raids, ['zed']);

        const none = await runMercAutoDeploy({ ...deps, bandOf: async () => null });
        assert.deepEqual({ deployed: none.deployed, raided: none.raided }, { deployed: 0, raided: 0 }, 'a spent band raids nobody');
    });
});

test('village war: each side raids one enemy sleeper camp anywhere in the wild, pinned to its real sector', async () => {
    await withVillageWarDisabled(false, async () => {
        const raids: Array<{ targetPlayer: string; sector: number; attackerVillage: string }> = [];
        const r = await runMercAutoDeploy({
            now: 1000,
            listContests: async () => [],
            listVillageWars: async () => [{ villages: ['A Village', 'D Village'] }],
            onlineNames: () => [],
            onlineAll: () => [],
            bandOf: async (village) => village === 'A Village' ? { tierId: 'merc-ronin', player: 'kage', level: 20 } : null,
            listSleepers: async () => [camp('zed', 11), camp('ally', 3)],
            targetsOf: targetsIn({ zed: 'D Village', ally: 'A Village' }),
            deployVillage: async () => null,
            raidSleeper: async (a) => { raids.push({ targetPlayer: a.targetPlayer, sector: a.sector, attackerVillage: a.attackerVillage }); return true; },
        });
        assert.equal(r.raided, 1);
        assert.deepEqual(raids, [{ targetPlayer: 'zed', sector: 11, attackerVillage: 'A Village' }], "only A's band has mercs, and it raids only D's camper");
    });
});

// ── The band member is War Resources: never spend one without a fight ────────
// claimMercFromBand used to commit inside the target's save lock and the fight
// was set up AFTER it, so a throw in the hydration/seal (or a save that
// hydrated to no character) consumed a mercenary the village had paid for, with
// no battle and no refund.


const MERC_NOW = 1_800_000_000_000;
const MERC_VILLAGE = 'Moonshadow Village';
const MERC_TARGET = 'defender-one';
const MERC_TARGET_VILLAGE = 'Frostfang Village';

function mercStore(bandCount: number) {
    const m = new Map<string, unknown>();
    m.set(`save:${MERC_TARGET}`, { character: { name: MERC_TARGET, village: MERC_TARGET_VILLAGE, hp: 50, maxHp: 100 } });
    m.set(villageWarKey(MERC_VILLAGE), {
        ...defaultVillageWarRecord(MERC_VILLAGE),
        mercLeases: [{ tierId: 'merc-ronin', player: 'kage', expiresAt: MERC_NOW + 86_400_000, count: bandCount }],
    });
    return {
        m,
        get: async <T = unknown>(k: string): Promise<T | null> => (m.has(k) ? (m.get(k) as T) : null),
        set: async (k: string, v: unknown) => { m.set(k, v); return 'OK'; },
    };
}
const mercArgs = {
    village: MERC_VILLAGE, tierId: 'merc-ronin', hirer: 'kage', sector: 6,
    targetPlayer: MERC_TARGET, targetVillage: MERC_TARGET_VILLAGE, mercLevel: 20, now: MERC_NOW,
};
const bandCount = (store: ReturnType<typeof mercStore>): number => {
    const leases = (store.m.get(villageWarKey(MERC_VILLAGE)) as { mercLeases: Array<{ count: number }> }).mercLeases;
    return leases.reduce((n, l) => n + l.count, 0);
};

test('a merc is claimed only once the fight is certain — a throw in the setup costs nothing', async () => {
    const store = mercStore(3);
    let stamped = 0;
    await assert.rejects(() => claimAndResolveMerc(mercArgs, {
        store,
        lock: (_k, fn) => fn(),
        isOnCooldown: async () => false,
        stampCooldown: async () => { stamped++; return 'OK'; },
        prepareFighter: async () => { throw new Error('admin content unavailable'); },
        runFight: () => { throw new Error('must not fight'); },
    }), /admin content unavailable/);
    assert.equal(bandCount(store), 3, 'the band is untouched — no merc spent without a battle');
    assert.equal(stamped, 0, 'and the target keeps no phantom cooldown');
});

test('a target whose save hydrates to no character rejects BEFORE a band member is spent', async () => {
    const store = mercStore(3);
    let stamped = 0;
    const r = await claimAndResolveMerc(mercArgs, {
        store,
        lock: (_k, fn) => fn(),
        isOnCooldown: async () => false,
        stampCooldown: async () => { stamped++; return 'OK'; },
        prepareFighter: async () => null,   // the old `if (!targetChar) return null`
        runFight: () => { throw new Error('must not fight'); },
    });
    assert.equal(r, null);
    assert.equal(bandCount(store), 3);
    assert.equal(stamped, 0);
});

test('a fight that throws AFTER the claim returns the merc to its band', async () => {
    const store = mercStore(3);
    await assert.rejects(() => claimAndResolveMerc(mercArgs, {
        store,
        lock: (_k, fn) => fn(),
        isOnCooldown: async () => false,
        stampCooldown: async () => 'OK',
        prepareFighter: async () => ({ sealed: true }),
        runFight: () => { throw new Error('engine blew up'); },
    }), /engine blew up/);
    assert.equal(bandCount(store), 3, 'the unfought merc is restored');
});

test('a fight that throws after emptying the band re-creates the lease at its original expiry', async () => {
    const store = mercStore(1);
    await assert.rejects(() => claimAndResolveMerc(mercArgs, {
        store,
        lock: (_k, fn) => fn(),
        isOnCooldown: async () => false,
        stampCooldown: async () => 'OK',
        prepareFighter: async () => ({ sealed: true }),
        runFight: () => { throw new Error('engine blew up'); },
    }), /engine blew up/);
    const leases = (store.m.get(villageWarKey(MERC_VILLAGE)) as { mercLeases: Array<{ count: number; expiresAt: number }> }).mercLeases;
    assert.equal(leases.length, 1);
    assert.equal(leases[0].count, 1);
    assert.equal(leases[0].expiresAt, MERC_NOW + 86_400_000, 'the 2-day contract clock is not restarted');
});

test('the happy path still spends exactly one merc and stamps the target cooldown', async () => {
    const store = mercStore(3);
    let stamped = 0;
    const r = await claimAndResolveMerc(mercArgs, {
        store,
        lock: (_k, fn) => fn(),
        isOnCooldown: async () => false,
        stampCooldown: async () => { stamped++; return 'OK'; },
        prepareFighter: async () => ({ sealed: true }),
        runFight: () => ({ winner: 'merc', mercWon: true, playerWon: false } as never),
    });
    assert.equal(r?.mercsRemaining, 2);
    assert.equal(bandCount(store), 2);
    assert.equal(stamped, 1);
});

test('a target who slipped onto the cooldown between the snapshot and the claim costs no merc', async () => {
    const store = mercStore(3);
    let checks = 0;
    const r = await claimAndResolveMerc(mercArgs, {
        store,
        lock: (_k, fn) => fn(),
        // Free on the authorize pass, on cooldown by the commit pass.
        isOnCooldown: async () => (checks++ > 0),
        stampCooldown: async () => 'OK',
        prepareFighter: async () => ({ sealed: true }),
        runFight: () => { throw new Error('must not fight'); },
    });
    assert.equal(r, null);
    assert.equal(bandCount(store), 3);
});
