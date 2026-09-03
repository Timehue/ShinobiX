import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'world-sector-raid-integration-secret-32b';

/*
 * The open-world sector raid, END TO END, through the real handlers.
 *
 * Every piece of this flow had unit coverage; the CHAIN had none — the
 * 2026-08-30 audit found no test anywhere that drove `requireWorldCoLocation`,
 * and no e2e spec that touches the sector attack at all. So "can I attack
 * someone standing in my sector and does it actually work" was not a question
 * anyone could answer from evidence.
 *
 * This drives it for real, in order, with nothing stubbed but the clock-free
 * in-memory KV:
 *   1. /api/player/attack       — the admission gate (restored 2026-08-30)
 *   2. /api/pvp/session         — must stamp rewardAuthority 'world'
 *   3. /api/pvp/move  ×2        — the join handshake both fighters owe
 *   4. pvpSessionMayReward      — true only once both have joined
 *
 * The negative cases matter as much as the happy path: a raid claimed from the
 * WRONG sector must not earn world authority, and a claim must not survive
 * being released.
 */

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let attackHandler: typeof import('./attack.js').default;
let clearHandler: typeof import('./clear-attack.js').default;
let sessionHandler: typeof import('../pvp/session.js').default;
let moveHandler: typeof import('../pvp/move.js').default;
let pvpSessionMayReward: typeof import('../pvp/session.js').pvpSessionMayReward;

const SECTOR = 12;

function response() {
    const out: { statusCode: number; body: Record<string, any> } = { statusCode: 200, body: {} };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function character(name: string) {
    return {
        name,
        level: 30,
        village: 'Leaf',
        maxHp: 500, maxChakra: 500, maxStamina: 500,
        hp: 500, chakra: 500, stamina: 500,
        stats: {}, equipment: {}, inventory: [], itemStacks: [],
        jutsu: [], jutsuMastery: [],
    };
}

let ipSeed = 0;
const nextIp = () => `10.30.0.${++ipSeed}`;

async function post(
    handler: (req: never, res: never) => Promise<unknown>,
    actor: string,
    body: Record<string, unknown>,
) {
    const ip = nextIp();
    const { out, res } = response();
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: {
            'x-player-name': actor,
            'x-player-token': issuePlayerToken(actor),
            'x-forwarded-for': ip,
        },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

/** The exact body shape App.tsx's sectorAttackPlayer sends. */
function worldRaidBody(battleId: string, p1: string, p2: string, rewardSector = SECTOR) {
    return {
        battleId,
        useCurrentVitals: true,
        requireWorldCoLocation: true,
        baseRewards: true,
        rewardSector,
        p1Character: { ...character(p1), name: p1 },
        p2Character: { ...character(p2), name: p2 },
    };
}

async function seed(...names: string[]) {
    for (const name of names) {
        await kv.set(`save:${name}`, { _saveVersion: 1, character: character(name) });
    }
}

function place(name: string, sector: number) {
    onlineStore.upsert({ name, sector, character: { name, level: 30 } });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    attackHandler = (await import('./attack.js')).default as unknown as typeof attackHandler;
    clearHandler = (await import('./clear-attack.js')).default as unknown as typeof clearHandler;
    sessionHandler = (await import('../pvp/session.js')).default as unknown as typeof sessionHandler;
    moveHandler = (await import('../pvp/move.js')).default as unknown as typeof moveHandler;
    ({ pvpSessionMayReward } = await import('../pvp/session.js'));
});

beforeEach(() => {
    for (const player of onlineStore.list()) onlineStore.remove(player.name);
});

let battleSeed = 0;
const nextBattleId = () => `wsr${++battleSeed}${'0'.repeat(20)}`;

test('a co-located raid runs the whole chain: claim → world-authorized session → both join → rewardable', async () => {
    const raider = 'wsraider';
    const quarry = 'wsquarry';
    await seed(raider, quarry);
    place(raider, SECTOR);
    place(quarry, SECTOR);

    // 1. the gate
    const claim = await post(attackHandler, raider, { targetName: quarry, attacker: { name: raider } });
    assert.equal(claim.statusCode, 200, `claim rejected: ${JSON.stringify(claim.body)}`);

    // 2. the session — and the claim must NOT block its own creator
    const requestedId = nextBattleId();
    const created = await post(sessionHandler, raider, worldRaidBody(requestedId, raider, quarry));
    assert.equal(created.statusCode, 200, `session refused: ${JSON.stringify(created.body)}`);
    // The handler owns the id; the client fights whatever it hands back.
    const battleId = String(created.body.battleId);
    assert.ok(battleId, 'the session must name the battle it created');
    const session = created.body.session as Record<string, any>;
    assert.equal(session.rewardAuthority, 'world',
        'a co-located raid must earn world reward authority — otherwise the winner is paid nothing');
    assert.equal(session.rewardSector, SECTOR, 'the sector must be sealed into the session');
    assert.equal(session.worldAttacker?.name, raider, 'the attacker side must be sealed');

    // 3. the join handshake both fighters owe
    assert.equal(pvpSessionMayReward(session as never), false, 'nothing is rewardable before both join');
    for (const [actor, role] of [[raider, 'p1'], [quarry, 'p2']] as const) {
        const joined = await post(moveHandler, actor, {
            battleId, role, action: 'join', moveToken: `join-${battleId}-${role}`,
        });
        assert.equal(joined.statusCode, 200, `${role} could not join: ${JSON.stringify(joined.body)}`);
    }

    // 4. the fight is now live and payable
    const live = await kv.get<Record<string, any>>(`pvp:${battleId}`);
    assert.equal(live?.joined?.p1, true, 'p1 join must persist');
    assert.equal(live?.joined?.p2, true, 'p2 join must persist');
    assert.equal(pvpSessionMayReward(live as never), true,
        'both joined + world authority ⇒ the winner can actually be paid');
    assert.equal(live?.status, 'active');
});

test('a raid claimed from the WRONG sector gets no world authority (and so pays nothing)', async () => {
    const raider = 'wsraider2';
    const quarry = 'wsquarry2';
    await seed(raider, quarry);
    place(raider, SECTOR);
    place(quarry, SECTOR);

    // Presence says sector 12; the body claims the fight happened in 40.
    const battleId = nextBattleId();
    const created = await post(sessionHandler, raider, worldRaidBody(battleId, raider, quarry, 40));
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    const session = created.body.session as Record<string, any>;
    assert.notEqual(session.rewardAuthority, 'world',
        'the server must not take the client\'s word for where the fight happened');
});

test('a released claim really is released — the target is attackable again', async () => {
    const raider = 'wsraider3';
    const rival = 'wsrival3';
    const quarry = 'wsquarry3';
    await seed(raider, rival, quarry);
    place(raider, SECTOR);
    place(rival, SECTOR);
    place(quarry, SECTOR);

    assert.equal((await post(attackHandler, raider, { targetName: quarry, attacker: { name: raider } })).statusCode, 200);
    // While held, a rival is locked out...
    assert.equal((await post(attackHandler, rival, { targetName: quarry, attacker: { name: rival } })).statusCode, 409);
    // ...and once the failed raid releases it, they are not.
    assert.equal((await post(clearHandler, raider, { name: quarry })).statusCode, 200);
    assert.equal((await post(attackHandler, rival, { targetName: quarry, attacker: { name: rival } })).statusCode, 200,
        'a released claim must not leave the target permanently unattackable');
});

/*
 * The other end of the same chain: what the fight COSTS.
 *
 * A sector raid is a continuous engagement — makePvpFighter hydrates both
 * fighters from their saves — but until 2026-09-03 nothing ever wrote the
 * vitals back, so raiding and losing were both free. These two drive the real
 * handlers through to a real knockout and read the two SAVES afterwards.
 */
test('a real KO writes both bodies: the winner keeps his damage, the loser is admitted', async () => {
    const raider = 'wsraider4';
    const quarry = 'wsquarry4';
    await seed(raider, quarry);
    place(raider, SECTOR);
    place(quarry, SECTOR);

    assert.equal((await post(attackHandler, raider, { targetName: quarry, attacker: { name: raider } })).statusCode, 200);
    const created = await post(sessionHandler, raider, worldRaidBody(nextBattleId(), raider, quarry));
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    const battleId = String(created.body.battleId);

    // The seal that tells terminal settlement this fight carried real vitals.
    assert.equal((created.body.session as Record<string, any>).continuousVitals, true,
        'a sector raid must seal continuousVitals — without it nothing settles');

    for (const [actor, role] of [[raider, 'p1'], [quarry, 'p2']] as const) {
        assert.equal((await post(moveHandler, actor, {
            battleId, role, action: 'join', moveToken: `join-${battleId}-${role}`,
        })).statusCode, 200);
    }

    // Put them toe to toe with the quarry one hit from falling, and hand the
    // turn to the raider — the coin flip is genuinely random. Positions, HP and
    // whose turn it is are all ordinary live-row state; the KO itself, the
    // terminal transition and the settlement below are entirely the real code.
    const live = (await kv.get<Record<string, any>>(`pvp:${battleId}`))!;
    await kv.set(`pvp:${battleId}`, {
        ...live,
        activePlayer: 'p1',
        roundOpener: 'p1',
        p1: { ...live.p1, pos: 62, hp: 320 },
        p2: { ...live.p2, pos: 63, hp: 1 },
    });

    const killing = await post(moveHandler, raider, {
        battleId, role: 'p1', action: 'basicAttack', moveToken: `ko-${battleId}`,
    });
    assert.equal(killing.statusCode, 200, JSON.stringify(killing.body));
    assert.equal(killing.body.status, 'done', 'the killing blow must terminalize the battle');
    assert.equal(killing.body.winner, 'p1');

    const loser = (await kv.get<Record<string, any>>(`save:${quarry}`))!.character;
    assert.equal(loser.hp, 0, 'the loser is knocked out, not left standing at full HP');
    assert.equal(loser.hospitalized, true, 'the loser goes to the Hospital needing to be healed');
    assert.ok(Number(loser.hospitalizedAt) > 0, 'admission is stamped');
    assert.equal(Number(loser.hospitalizedUntil) - Number(loser.hospitalizedAt), 60_000,
        'the stay matches every other defeat path');

    const winner = (await kv.get<Record<string, any>>(`save:${raider}`))!.character;
    assert.equal(winner.hp, 320, 'the winner walks away carrying exactly the damage he took');
    assert.notEqual(winner.hospitalized, true, 'winning is not an admission');
    assert.ok(Number(winner.stamina) < 500, 'the stamina the swing cost is gone too');
});

test('a spar over the same handlers leaves both saves untouched', async () => {
    const one = 'wsspar1';
    const two = 'wsspar2';
    await seed(one, two);
    place(one, SECTOR);
    place(two, SECTOR);

    // Same shape, minus the continuous-engagement flag: a fresh-start contest.
    const created = await post(sessionHandler, one, {
        battleId: nextBattleId(),
        useCurrentVitals: false,
        p1Character: { ...character(one), name: one },
        p2Character: { ...character(two), name: two },
    });
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    const battleId = String(created.body.battleId);
    assert.equal((created.body.session as Record<string, any>).continuousVitals, false,
        'a spar must NOT seal continuousVitals — it reset both fighters on entry');

    for (const [actor, role] of [[one, 'p1'], [two, 'p2']] as const) {
        await post(moveHandler, actor, { battleId, role, action: 'join', moveToken: `join-${battleId}-${role}` });
    }
    const live = (await kv.get<Record<string, any>>(`pvp:${battleId}`))!;
    await kv.set(`pvp:${battleId}`, {
        ...live,
        activePlayer: 'p1',
        roundOpener: 'p1',
        p1: { ...live.p1, pos: 62, hp: 200 },
        p2: { ...live.p2, pos: 63, hp: 1 },
    });
    const killing = await post(moveHandler, one, {
        battleId, role: 'p1', action: 'basicAttack', moveToken: `ko-${battleId}`,
    });
    assert.equal(killing.body.status, 'done');

    const loser = (await kv.get<Record<string, any>>(`save:${two}`))!.character;
    assert.equal(loser.hp, 500, 'a spar loss must not cost HP');
    assert.notEqual(loser.hospitalized, true, 'a spar loss must not hospitalize');
});
