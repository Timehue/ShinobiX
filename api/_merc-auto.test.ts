import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMercAutoDeploy, claimAndResolveMerc } from './_merc-auto.js';
import { defaultVillageWarRecord, villageWarKey } from './_war-state.js';
import type { RoamTarget } from './_merc-roam.js';

// Targeting (pickMercTarget) is unit-tested in _merc-roam.test.ts. These cover the
// cron's gating + dual-pass dispatch without touching kv (the deploy paths, the
// war/contest lists and the retired-hire sweep are all injected, and
// card/flipped/empty cases short-circuit before any kv read). Band selection and
// war binding against a real (memory) store live in _merc-auto.context.test.ts.
//
// Owner redesign 2026-10-08: in a Combat sector war the band is the DEFENDER's
// and it hunts the ATTACKING village's players.

/** No kv in this file: the tick's retired-hire sweep is stubbed out. */
const NO_SWEEP = { sweepRetiredHires: async () => undefined };

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

test('runMercAutoDeploy deploys nothing under the exact Village War Map kill switch', async () => {
    await withVillageWarDisabled(true, async () => {
        let swept = 0;
        // listContests would throw if it ran — proves the gate short-circuits first.
        const r = await runMercAutoDeploy({
            sweepRetiredHires: async () => { swept++; },
            listContests: async () => { throw new Error('gate should short-circuit'); },
        });
        assert.equal(r.enabled, false);
        assert.equal(r.deployed, 0);
        // The retired Honor-Seal sweep still runs: the all-out village war a
        // stranded hire freezes is not stopped by the Sector Map switch.
        assert.equal(swept, 1);
    });
});

test('runMercAutoDeploy defaults on and skips card/flipped sieges plus empty village wars', async () => {
    await withVillageWarDisabled(false, async () => {
        let sectorDeploys = 0;
        let villageDeploys = 0;
        const r = await runMercAutoDeploy({
            ...NO_SWEEP,
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

const SECTOR_WAR = { id: 'c1', sector: 5, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'combat', flipped: false, startedAt: 500, declarationGeneration: 1 };
const BAND = async () => ({ tierId: 'merc-ronin', player: 'kage', level: 20 });
const camp = (name: string, sector: number) => ({ name, displayName: name, sector, createdAt: 1 });
const targetsIn = (village: Record<string, string>) => async (names: readonly string[], enemy: string): Promise<RoamTarget[]> =>
    names.filter((n) => village[n] === enemy).map((n) => ({ name: n, village: enemy, hp: 100, maxHp: 200 }));

test('sector war: the DEFENDER\'s band asks for its own band, bound to this contest instance', async () => {
    await withVillageWarDisabled(false, async () => {
        const asked: Array<{ village: string; context: unknown }> = [];
        await runMercAutoDeploy({
            ...NO_SWEEP,
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => [],
            onlineAll: () => [],
            bandOf: async (village, _now, context) => { asked.push({ village, context }); return null; },
        });
        assert.deepEqual(asked, [{ village: 'D Village', context: { kind: 'sector', contestId: 'c1', instance: 'g1.s500', sector: 5 } }]);
    });
});

test('sector war: the defender\'s band snipes the lowest-HP ATTACKER online in the sector', async () => {
    await withVillageWarDisabled(false, async () => {
        const deploys: Array<Record<string, unknown>> = [];
        const r = await runMercAutoDeploy({
            ...NO_SWEEP,
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: (sector) => sector === 5 ? ['raider', 'holdout'] : [],
            onlineAll: () => [],
            listSleepers: async () => [],
            bandOf: async () => ({ key: 'id:mh_band-0001', tierId: 'merc-oni', player: 'dkage', level: 95 }),
            targetsOf: targetsIn({ raider: 'A Village', holdout: 'D Village' }),
            deploy: async (a) => { deploys.push({ ...a }); return { winner: 'merc', attackerPoints: 0, defenderPoints: 5, mercsRemaining: 3 }; },
        });
        assert.equal(r.deployed, 1);
        assert.deepEqual(deploys, [{
            village: 'D Village', tierId: 'merc-oni', hirer: 'dkage', bandKey: 'id:mh_band-0001',
            sector: 5, targetPlayer: 'raider', targetVillage: 'A Village',
            contestId: 'c1', instance: 'g1.s500', mercLevel: 95, now: 1000,
        }], 'the defender band, aimed at the attacker — never the defender in the sector');
    });
});

test('sector war: an attacker sleeper camp pitched in the contested sector is raided (no live attackers needed)', async () => {
    await withVillageWarDisabled(false, async () => {
        const raids: Array<{ targetPlayer: string; sector: number; attackerVillage: string }> = [];
        const r = await runMercAutoDeploy({
            ...NO_SWEEP,
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => [],
            onlineAll: () => [],
            bandOf: BAND,
            listSleepers: async () => [camp('zed', 5), camp('friend', 5), camp('elsewhere', 6)],
            targetsOf: targetsIn({ zed: 'A Village', friend: 'D Village', elsewhere: 'A Village' }),
            deploy: async () => { throw new Error('no live target → no deploy'); },
            raidSleeper: async (a) => { raids.push({ targetPlayer: a.targetPlayer, sector: a.sector, attackerVillage: a.attackerVillage }); return true; },
        });
        assert.equal(r.deployed, 0);
        assert.equal(r.raided, 1);
        assert.deepEqual(raids, [{ targetPlayer: 'zed', sector: 5, attackerVillage: 'D Village' }], 'only the ATTACKING camper IN the contested sector; the raiding (defending) village rides along for the victim notice');
    });
});

test('sector war: a village / sector-0 logout is never raided, and only one camp per contest per tick', async () => {
    await withVillageWarDisabled(false, async () => {
        const raids: string[] = [];
        const r = await runMercAutoDeploy({
            ...NO_SWEEP,
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => [],
            onlineAll: () => [],
            bandOf: BAND,
            // 'home' logged out in the village (a camp can never really have sector 0 — the
            // store refuses it — but the tick must not trust the list either).
            listSleepers: async () => [camp('home', 0), camp('ann', 5), camp('bob', 5)],
            targetsOf: targetsIn({ home: 'A Village', ann: 'A Village', bob: 'A Village' }),
            deploy: async () => null,
            raidSleeper: async (a) => { raids.push(a.targetPlayer); return true; },
        });
        assert.equal(r.raided, 1, 'one raid per contest per tick');
        assert.equal(raids.length, 1);
        assert.notEqual(raids[0], 'home', 'safe-zone logout is untouchable');
    });
});

test('sector war: a refused raid (cooldown / camp gone / already hospitalized) counts nothing — no double hit', async () => {
    await withVillageWarDisabled(false, async () => {
        let attempts = 0;
        const r = await runMercAutoDeploy({
            ...NO_SWEEP,
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => [],
            onlineAll: () => [],
            bandOf: BAND,
            listSleepers: async () => [camp('zed', 5)],
            targetsOf: targetsIn({ zed: 'A Village' }),
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
            ...NO_SWEEP,
            now: 1000,
            listContests: async () => [SECTOR_WAR],
            listVillageWars: async () => [],
            onlineNames: () => ['awake'],
            onlineAll: () => [],
            listSleepers: async () => [camp('zed', 5)],
            targetsOf: targetsIn({ awake: 'A Village', zed: 'A Village' }),
            deploy: async (a: { targetPlayer: string }) => { live.push(a.targetPlayer); return { winner: 'merc' as const, attackerPoints: 0, defenderPoints: 1, mercsRemaining: 1 }; },
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
            ...NO_SWEEP,
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

test('village war: a band is asked for the war INSTANCE, and the deploy names it', async () => {
    await withVillageWarDisabled(false, async () => {
        const asked: unknown[] = [];
        const deploys: Array<Record<string, unknown>> = [];
        await runMercAutoDeploy({
            ...NO_SWEEP,
            now: 1000,
            listContests: async () => [],
            listVillageWars: async () => [{ villages: ['A Village', 'D Village'], id: 'avillage-vs-dvillage', generation: 3 }],
            onlineNames: () => [],
            onlineAll: () => ['dee'],
            listSleepers: async () => [],
            bandOf: async (village, _now, context) => { asked.push(context); return village === 'A Village' ? { key: 'id:mh_vw-0001', tierId: 'merc-ronin', player: 'kage', level: 75 } : null; },
            targetsOf: targetsIn({ dee: 'D Village' }),
            deployVillage: async (a) => { deploys.push({ ...a }); return null; },
        });
        assert.deepEqual(asked, [
            { kind: 'village', warId: 'avillage-vs-dvillage', generation: 3 },
            { kind: 'village', warId: 'avillage-vs-dvillage', generation: 3 },
        ]);
        assert.equal(deploys.length, 1);
        assert.deepEqual(deploys[0].war, { id: 'avillage-vs-dvillage', generation: 3 });
        assert.equal(deploys[0].bandKey, 'id:mh_vw-0001');
    });
});

// ── One failing war context never costs the rest of the tick its turn ───────────

test('a throw in one contest does not abort the tick: the next contest and the village wars still run', async () => {
    await withVillageWarDisabled(false, async () => {
        const deployed: string[] = [];
        const villageDeployed: string[] = [];
        const errors: unknown[][] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => { errors.push(args); };
        try {
            const r = await runMercAutoDeploy({
                ...NO_SWEEP,
                now: 1000,
                listContests: async () => [
                    { ...SECTOR_WAR, id: 'boom', sector: 7 },
                    { ...SECTOR_WAR, id: 'ok', sector: 8 },
                ],
                listVillageWars: async () => [{ villages: ['B Village', 'C Village'] }],
                onlineNames: () => ['raider'],
                onlineAll: () => ['bee', 'cee'],
                listSleepers: async () => [],
                bandOf: BAND,
                targetsOf: async (names, enemy) => names.map((n) => ({ name: n, village: enemy, hp: 10, maxHp: 100 })),
                deploy: async (a) => {
                    if (a.contestId === 'boom') throw new Error('save lock contended');
                    deployed.push(a.contestId);
                    return { winner: 'merc', attackerPoints: 0, defenderPoints: 5, mercsRemaining: 1 };
                },
                deployVillage: async (a) => {
                    if (a.village === 'B Village') throw new Error('war row busy');
                    villageDeployed.push(a.village);
                    return { winner: 'merc', enemyWarHp: 100, mercsRemaining: 1 };
                },
            });
            assert.deepEqual(deployed, ['ok'], 'the contest after the failing one still deploys');
            assert.deepEqual(villageDeployed, ['C Village'], 'and so does the other side of the village war');
            assert.equal(r.deployed, 2);
        } finally {
            console.error = originalError;
        }
        assert.equal(errors.length, 2, 'each failure is logged once');
    });
});

test('the retired Honor-Seal hire sweep runs every tick, and its failure does not stop the tick', async () => {
    await withVillageWarDisabled(false, async () => {
        let swept = 0;
        let deploys = 0;
        const originalError = console.error;
        console.error = () => undefined;
        try {
            const r = await runMercAutoDeploy({
                now: 1000,
                sweepRetiredHires: async () => { swept++; throw new Error('war rows unreadable'); },
                listContests: async () => [SECTOR_WAR],
                listVillageWars: async () => [],
                onlineNames: () => ['raider'],
                onlineAll: () => [],
                listSleepers: async () => [],
                bandOf: BAND,
                targetsOf: targetsIn({ raider: 'A Village' }),
                deploy: async () => { deploys++; return { winner: 'stall', attackerPoints: 0, defenderPoints: 0, mercsRemaining: 2 }; },
            });
            assert.equal(r.deployed, 1);
        } finally {
            console.error = originalError;
        }
        assert.equal(swept, 1);
        assert.equal(deploys, 1);
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
