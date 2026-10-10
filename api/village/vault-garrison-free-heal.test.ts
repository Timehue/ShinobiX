import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'vault-garrison-heal-test-admin';
process.env.SESSION_SECRET = 'vault-garrison-heal-test-secret-32-bytes';

/*
 * The ANBU Vault infiltration and the sector-war garrison assault, driven
 * through their mounted handlers over the in-memory KV.
 *
 * Both seat the player at the HP their save holds, and both stay open while the
 * player does anything else: nothing battle-locks the save. Every settlement
 * used to write the fight's end HP back as an absolute value, so HP lost in
 * another fight while one of these was open came back when it settled, on
 * every path: the mode's own report, a walk-out through /api/pve/fight-outcome,
 * the request that ends the fight, the next garrison-start after a lapse, and
 * the lapse reconciler. A 1,000 HP save went back to 8,100. Their HP is now
 * decrease-only (sessionHpIsDecreaseOnly). The cases in the "HP lost elsewhere"
 * blocks, and the in-fight heal, fail on the code before that change.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body: Json };

const SECTOR = 12;
const ATTACKER_VILLAGE = 'Moonshadow Village';
const DEFENDER_VILLAGE = 'Frostfang Village';
const CONTEST_ID = `${SECTOR}:moonshadowvillage-vs-frostfangvillage`;
const CONTEST_KEY = `shared:sector-war:${CONTEST_ID}`;
const TERRITORY_KEY = `world:territory:${SECTOR}`;
const ANBU_SLUG = 'healtestanbu';
const MAX_HP = 9_000;
/** The engine's abandon (a walk-out or a lapse) costs 10% of max HP. */
const WALK_OUT_HP = MAX_HP - MAX_HP / 10;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let sectorWar: Handler;
let infiltration: Handler;
let fightOutcome: Handler;
let soloPveAction: Handler;
let reconcileLapsedBattle: typeof import('../_battle-lapse.js').reconcileLapsedBattle;
let RAID_RYO_REWARD: number;
let AI_FIGHT_HOSPITAL_DURATION_MS: number;
let nameSeed = 0;
let ipSeed = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    sectorWar = (await import('./sector-war.js')).default as unknown as Handler;
    infiltration = (await import('./anbu-infiltration.js')).default as unknown as Handler;
    fightOutcome = (await import('../pve/fight-outcome.js')).default as unknown as Handler;
    soloPveAction = (await import('../solo-pve/action.js')).default as unknown as Handler;
    ({ reconcileLapsedBattle } = await import('../_battle-lapse.js'));
    ({ RAID_RYO_REWARD } = await import('../_anbu-infiltration.js'));
    ({ AI_FIGHT_HOSPITAL_DURATION_MS } = await import('../missions/_ai-fight-outcome.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

/** A new player per case: the start and report rate limits outlive the KV wipe. */
const freshName = (prefix: string) => `${prefix}${++nameSeed}`;

async function call(handler: Handler, player: string, body: Json, admin = false): Promise<Out> {
    const out: Out = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (value: Json) => { out.body = value; return res; },
        end: () => res,
    };
    const ip = `10.93.0.${(++ipSeed % 250) + 1}`;
    const auth: Json = admin
        ? { 'x-admin-password': process.env.ADMIN_PASSWORD }
        : { 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '' };
    await handler({
        method: 'POST',
        body: { playerName: player, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...auth },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

async function seedPlayer(name: string, hp: number): Promise<void> {
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: {
            name, village: ATTACKER_VILLAGE, level: 100,
            maxHp: MAX_HP, hp, maxChakra: 500, chakra: 500, maxStamina: 500, stamina: 500,
            stats: {}, jutsu: [], pvpItems: [], equipment: {}, inventory: [], itemStacks: [],
        },
    });
}

async function seedAnbu(): Promise<void> {
    await kv.set('game:village-state:frostfangvillage', { anbuAppointees: [ANBU_SLUG] });
    await kv.set(`save:${ANBU_SLUG}`, {
        character: {
            name: 'Frostfang Anbu', village: DEFENDER_VILLAGE, level: 100,
            maxHp: 12_000, hp: 12_000, maxChakra: 1_000, maxStamina: 1_000,
            stats: {}, jutsu: [], pvpItems: [], equipment: {},
        },
    });
}

async function seedGarrisonWar(attacker: string, hp = MAX_HP): Promise<void> {
    const now = Date.now();
    const startedAt = now - 3 * 60 * 60 * 1000; // past the 2h liveness idle
    await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: DEFENDER_VILLAGE, updatedAt: now });
    await kv.set(CONTEST_KEY, {
        id: CONTEST_ID, sector: SECTOR, attackerVillage: ATTACKER_VILLAGE, defenderVillage: DEFENDER_VILLAGE,
        winCondition: 'combat', attackerPoints: 0, defenderPoints: 0,
        startedAt, endsAt: startedAt + 72 * 60 * 60 * 1000, updatedAt: startedAt,
        lastLiveBattleAt: startedAt, flipped: false, appliedBattles: [],
    });
    await seedPlayer(attacker, hp);
    await seedAnbu();
}

async function seedVault(raider: string, hp = MAX_HP): Promise<void> {
    await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: DEFENDER_VILLAGE, updatedAt: Date.now() });
    await seedPlayer(raider, hp);
    await seedAnbu();
}

async function character(name: string): Promise<Json> {
    return ((await kv.get<Json>(`save:${name}`))?.character ?? {}) as Json;
}

/** Another fight, settled while this one is still open, changes the save. */
async function hurtElsewhere(name: string, patch: Json): Promise<void> {
    const record = await kv.get<Json>(`save:${name}`);
    await kv.set(`save:${name}`, { ...record, _saveVersion: Number(record?._saveVersion ?? 1) + 1, character: { ...record?.character, ...patch } });
}

/** End the open fight as the engine would, with the player on `endHp`
 *  (or on whatever the engine left them, when it is omitted). */
async function finishFight(runId: string, outcome: 'win' | 'loss', endHp?: number): Promise<void> {
    const key = `solo-pve:${runId}`;
    const session = await kv.get<Json>(key);
    if (!session) throw new Error('session not found');
    const winner = outcome === 'win' ? 'player' : 'enemy';
    await kv.set(key, {
        ...session,
        status: 'done', winner, outcome,
        player: { ...session.player, hp: endHp ?? session.player.hp },
        itemsUsed: {},
        terminalEvidence: {
            finishedAt: Date.now(), finalMoveToken: 'heal-test-terminal', finalVersion: Number(session.version ?? 1), finalEventSeq: 0,
            winner, outcome, itemsUsed: {}, settlementState: 'pending',
        },
    });
}

/** Run `fn` with the wall clock `aheadMs` ahead (the memory store expires against Date.now). */
async function later<T>(aheadMs: number, fn: () => Promise<T>): Promise<T> {
    const realNow = Date.now;
    Date.now = () => realNow() + aheadMs;
    try { return await fn(); } finally { Date.now = realNow; }
}

async function startGarrison(attacker: string): Promise<{ runId: string; seatHp: number; version: number }> {
    const started = await call(sectorWar, attacker, { action: 'garrison-start', sector: SECTOR });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    return { runId: started.body.runId, seatHp: Number(started.body.session?.player?.hp), version: Number(started.body.session?.version) };
}

async function startVault(raider: string): Promise<{ runId: string; seatHp: number }> {
    // As admin, which skips the stronghold walk, the level gate and the daily
    // attempt (none of them is the subject here). The run is still the raider's.
    const started = await call(infiltration, raider, { action: 'start', sector: SECTOR }, true);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    return { runId: started.body.runId, seatHp: Number(started.body.session?.player?.hp) };
}

describe('garrison assault — HP lost elsewhere while it is open never comes back', { concurrency: false }, () => {
    it('a won assault, reported: the contest still scores, the save keeps its loss', async () => {
        const attacker = freshName('garrheal');
        await seedGarrisonWar(attacker);
        const { runId, seatHp } = await startGarrison(attacker);
        assert.equal(seatHp, MAX_HP);
        await hurtElsewhere(attacker, { hp: 1_000 });
        await finishFight(runId, 'win', 3_600);

        const resolved = await call(sectorWar, attacker, { action: 'garrison-resolve', runId });
        assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
        assert.equal(resolved.body.points, 2, 'the garrison weight is unchanged');
        assert.equal((await character(attacker)).hp, 1_000, 'it used to write the fight\'s 3,600 back');
    });

    it('a walk-out through /api/pve/fight-outcome', async () => {
        const attacker = freshName('garrheal');
        await seedGarrisonWar(attacker);
        const { runId } = await startGarrison(attacker);
        await hurtElsewhere(attacker, { hp: 1_000 });

        const walked = await call(fightOutcome, attacker, { runId });
        assert.equal(walked.status, 200, JSON.stringify(walked.body));
        assert.equal((await character(attacker)).hp, 1_000, `it used to write the walk-out's ${WALK_OUT_HP} back`);
    });

    it('the request that ends the fight, settled by the Solo-PvE terminal hook', async () => {
        const attacker = freshName('garrheal');
        await seedGarrisonWar(attacker);
        const { runId, version } = await startGarrison(attacker);
        await hurtElsewhere(attacker, { hp: 1_000 });

        const acted = await call(soloPveAction, attacker, {
            sessionId: runId, type: 'abandon', expectedVersion: version, moveToken: `heal-hook-${runId}`,
        });
        assert.equal(acted.status, 200, JSON.stringify(acted.body));
        const run = await kv.get<Json>(`sector-war-garrison:${runId}`);
        assert.ok(run?.settlement, 'settled by the fight\'s own final request');
        assert.equal((await character(attacker)).hp, 1_000);
    });

    it('a lapsed assault, settled by the next garrison-start', async () => {
        const attacker = freshName('garrheal');
        await seedGarrisonWar(attacker);
        await startGarrison(attacker);
        await hurtElsewhere(attacker, { hp: 1_000 });

        const again = await later(46 * 60 * 1000, () => call(sectorWar, attacker, { action: 'garrison-start', sector: SECTOR }));
        assert.equal(again.status, 200, JSON.stringify(again.body));
        assert.equal(again.body.settledPrevious, true);
        assert.equal(again.body.result?.outcome, 'garrison', 'walking away is still a held garrison');
        assert.equal((await character(attacker)).hp, 1_000);
    });

    it('a player knocked out elsewhere stays down and keeps the stay they were given', async () => {
        const attacker = freshName('garrheal');
        await seedGarrisonWar(attacker);
        const { runId } = await startGarrison(attacker);
        const until = Date.now() + 50_000;
        await hurtElsewhere(attacker, { hp: 0, hospitalized: true, hospitalizedAt: Date.now() - 10_000, hospitalizedUntil: until });
        await finishFight(runId, 'win', 3_600);

        const resolved = await call(sectorWar, attacker, { action: 'garrison-resolve', runId });
        assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
        const after = await character(attacker);
        assert.equal(after.hp, 0, 'it used to stand them back up at 3,600, still in a hospital bed');
        assert.equal(after.hospitalized, true);
        assert.equal(after.hospitalizedUntil, until);
    });
});

describe('garrison assault — what a fight costs', { concurrency: false }, () => {
    it('settled at once, it writes the HP the fight left, as before', async () => {
        const attacker = freshName('garrcost');
        await seedGarrisonWar(attacker);
        const { runId } = await startGarrison(attacker);
        await finishFight(runId, 'win', 3_600);

        const resolved = await call(sectorWar, attacker, { action: 'garrison-resolve', runId });
        assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
        assert.equal((await character(attacker)).hp, 3_600);
    });

    it('healing done inside the assault stays inside it', async () => {
        // The assault hands out a full chakra pool, and the engine's own Basic
        // Heal spends 10 of it to lift the attacker above the HP they brought.
        const attacker = freshName('garrcost');
        await seedGarrisonWar(attacker, 3_000);
        const { runId, seatHp, version } = await startGarrison(attacker);
        assert.equal(seatHp, 3_000, 'the attacker brings the HP their save holds');
        const healed = await call(soloPveAction, attacker, {
            sessionId: runId, type: 'basicHeal', expectedVersion: version, moveToken: `heal-cast-${runId}`,
        });
        assert.equal(healed.status, 200, JSON.stringify(healed.body));
        const healedHp = Number(healed.body.session?.player?.hp);
        assert.equal(healedHp, 3_000 + MAX_HP / 10, 'Basic Heal restores 10% of max HP');
        await finishFight(runId, 'win'); // ends on the healed HP

        const resolved = await call(sectorWar, attacker, { action: 'garrison-resolve', runId });
        assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
        assert.equal((await character(attacker)).hp, 3_000, `it used to bank the healed ${healedHp}`);
    });

    it('a knockout still admits the attacker for the standard stay', async () => {
        const attacker = freshName('garrcost');
        await seedGarrisonWar(attacker);
        const { runId } = await startGarrison(attacker);
        await hurtElsewhere(attacker, { hp: 1_000 });
        await finishFight(runId, 'loss', 0);

        const resolved = await call(sectorWar, attacker, { action: 'garrison-resolve', runId });
        assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
        const after = await character(attacker);
        assert.equal(after.hp, 0);
        assert.equal(after.hospitalized, true);
        assert.equal(Number(after.hospitalizedUntil) - Number(after.hospitalizedAt), AI_FIGHT_HOSPITAL_DURATION_MS);
    });
});

describe('ANBU Vault raid — HP lost elsewhere while it is open never comes back', { concurrency: false }, () => {
    it('a won raid, reported: the raid still pays, the save keeps its loss', async () => {
        const raider = freshName('vaultheal');
        await seedVault(raider);
        const { runId, seatHp } = await startVault(raider);
        assert.equal(seatHp, MAX_HP);
        await hurtElsewhere(raider, { hp: 1_000 });
        await finishFight(runId, 'win', 3_600);

        const reported = await call(infiltration, raider, { action: 'report', runId });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal(reported.body.won, true);
        assert.equal(reported.body.ryo, RAID_RYO_REWARD, 'the raid reward is unchanged');
        const after = await character(raider);
        assert.equal(after.ryo, RAID_RYO_REWARD);
        assert.equal(after.hp, 1_000, 'it used to write the fight\'s 3,600 back');
    });

    it('a lost raid the raider walked away from on their feet', async () => {
        const raider = freshName('vaultheal');
        await seedVault(raider);
        const { runId } = await startVault(raider);
        await hurtElsewhere(raider, { hp: 1_000 });
        await finishFight(runId, 'loss', 5_000);

        const reported = await call(infiltration, raider, { action: 'report', runId });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal(reported.body.won, false);
        assert.equal((await character(raider)).hp, 1_000, 'it used to write the fight\'s 5,000 back');
    });

    it('a walk-out through /api/pve/fight-outcome', async () => {
        const raider = freshName('vaultheal');
        await seedVault(raider);
        const { runId } = await startVault(raider);
        await hurtElsewhere(raider, { hp: 1_000 });

        const walked = await call(fightOutcome, raider, { runId });
        assert.equal(walked.status, 200, JSON.stringify(walked.body));
        assert.equal((await character(raider)).hp, 1_000, `it used to write the walk-out's ${WALK_OUT_HP} back`);
    });

    it('a raid left to lapse, settled by the lapse reconciler', async () => {
        const raider = freshName('vaultheal');
        await seedVault(raider);
        const { runId } = await startVault(raider);
        await hurtElsewhere(raider, { hp: 1_000 });

        const reconciled = await later(46 * 60 * 1000, () => reconcileLapsedBattle({ kind: 'solo-pve', sessionId: runId } as never, raider));
        assert.equal(reconciled.transitioned, true, JSON.stringify(reconciled));
        assert.equal(reconciled.settled, true, JSON.stringify(reconciled));
        assert.equal((await character(raider)).hp, 1_000);
    });
});

describe('ANBU Vault raid — what a fight costs', { concurrency: false }, () => {
    it('settled at once, it writes the HP the fight left, as before', async () => {
        const raider = freshName('vaultcost');
        await seedVault(raider);
        const { runId } = await startVault(raider);
        await finishFight(runId, 'win', 3_600);

        const reported = await call(infiltration, raider, { action: 'report', runId });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal((await character(raider)).hp, 3_600);
    });

    it('a knockout still admits the raider for the standard stay', async () => {
        const raider = freshName('vaultcost');
        await seedVault(raider);
        const { runId } = await startVault(raider);
        await finishFight(runId, 'loss', 0);

        const reported = await call(infiltration, raider, { action: 'report', runId });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        const after = await character(raider);
        assert.equal(after.hp, 0);
        assert.equal(after.hospitalized, true);
        assert.equal(Number(after.hospitalizedUntil) - Number(after.hospitalizedAt), AI_FIGHT_HOSPITAL_DURATION_MS);
    });
});
