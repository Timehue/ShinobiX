import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCombatResolveResultToPvpSession, pvpSessionToCombatBattleState } from '../combat-adapters/pvpAdapter.js';
import type { PvpFighter, PvpSession, PvpStatus } from './session.js';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';
process.env.SESSION_SECRET = 'pvp-move-handler-test-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

const store = new Map<string, unknown>();
const clone = <T>(v: T): T => (v === undefined || v === null) ? null as T : JSON.parse(JSON.stringify(v));

type Handler = (req: never, res: never) => Promise<unknown>;
let moveHandler: Handler;
let issuePlayerToken: (name: string, ttlMs?: number) => string | null;

before(async () => {
    const storage = await import('../_storage.js');
    const kv = storage.kv;
    kv.get = async <T,>(key: string) => clone(store.get(key)) as T | null;
    kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((n, key) => n + (store.delete(key) ? 1 : 0), 0);
    kv.incr = async (key: string) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    kv.keys = async (pattern: string) => {
        const prefix = pattern.replace(/\*.*$/, '');
        return [...store.keys()].filter((key) => key.startsWith(prefix));
    };
    kv.mget = async (...keys: string[]) => keys.map((key) => clone(store.get(key))) as never;
    kv.hgetall = async <T,>(key: string) => clone(store.get(key)) as T | null;
    (kv as unknown as Record<string, unknown>).hkeys = async (key: string) => Object.keys((store.get(key) as object) ?? {});
    (kv as unknown as Record<string, unknown>).hset = async (key: string, fields: Record<string, unknown>) => {
        store.set(key, { ...((store.get(key) as object) ?? {}), ...clone(fields) as object });
        return Object.keys(fields).length;
    };
    (kv as unknown as Record<string, unknown>).hdel = async (key: string, ...fields: string[]) => {
        const current = { ...((store.get(key) as Record<string, unknown>) ?? {}) };
        let removed = 0;
        for (const field of fields) {
            if (field in current) {
                delete current[field];
                removed++;
            }
        }
        store.set(key, current);
        return removed;
    };

    moveHandler = (await import('./move.js')).default as unknown as Handler;
    issuePlayerToken = (await import('../_auth.js')).issuePlayerToken;
});

beforeEach(() => {
    store.clear();
});

function fakeReq(playerName: string, body: Record<string, unknown>) {
    const token = issuePlayerToken(playerName);
    assert.ok(token, 'test session token should be minted');
    return {
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'x-player-name': playerName,
            'x-player-token': token,
            'x-forwarded-for': '10.0.0.1',
        },
        socket: { remoteAddress: '10.0.0.1' },
    } as never;
}

function fakeRes() {
    const out = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, unknown> };
    const res = {
        setHeader: (key: string, value: unknown) => { out.headers[key] = value; return res; },
        status: (code: number) => { out.statusCode = code; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function postMove(playerName: string, body: Record<string, unknown>) {
    const { res, out } = fakeRes();
    await moveHandler(fakeReq(playerName, body), res);
    return out;
}

const stats = {
    strength: 500,
    speed: 500,
    intelligence: 500,
    willpower: 500,
    bukijutsuOffense: 500,
    bukijutsuDefense: 500,
    taijutsuOffense: 500,
    taijutsuDefense: 500,
    genjutsuOffense: 500,
    genjutsuDefense: 500,
    ninjutsuOffense: 500,
    ninjutsuDefense: 500,
};

const blast = {
    id: 'blast',
    name: 'Test Blast',
    type: 'Ninjutsu',
    target: 'OPPONENT',
    range: 1,
    ap: 60,
    cooldown: 3,
    chakraCost: 25,
    staminaCost: 15,
    effectPower: 30,
    isUtility: false,
    tags: [],
};

const supportJutsu = {
    id: 'support',
    name: 'Test Support',
    type: 'Ninjutsu',
    target: 'SELF',
    range: 0,
    ap: 40,
    cooldown: 2,
    chakraCost: 5,
    staminaCost: 0,
    effectPower: 0,
    isUtility: true,
    tags: [{ name: 'Heal' }, { name: 'Shield' }],
};

function fighter(name: string, pos: number, patch: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name,
        hp: 5000,
        maxHp: 5000,
        chakra: 1000,
        maxChakra: 1000,
        stamina: 1000,
        maxStamina: 1000,
        shield: 0,
        statuses: [],
        character: {
            name,
            level: 100,
            specialty: 'Ninjutsu',
            stats,
            jutsu: [blast],
            jutsuMastery: [{ jutsuId: 'blast', level: 50 }],
        },
        pos,
        ...patch,
    };
}

function withExtraJutsu(base: PvpFighter, jutsu: Record<string, unknown>, level = 50): PvpFighter {
    const character = base.character as Record<string, unknown>;
    const jutsuList = (character.jutsu as unknown[] | undefined) ?? [];
    const masteryList = (character.jutsuMastery as unknown[] | undefined) ?? [];
    return {
        ...base,
        character: {
            ...character,
            jutsu: [...jutsuList, jutsu],
            jutsuMastery: [...masteryList, { jutsuId: String(jutsu.id), level }],
        },
    };
}

function session(battleId: string, patch: Partial<PvpSession> = {}): PvpSession {
    return {
        battleId,
        p1: fighter('alice', 0),
        p2: fighter('bob', 1),
        round: 1,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['Battle begins.'],
        status: 'active',
        winner: null,
        createdAt: Date.now(),
        lastMoveAt: Date.now(),
        ...patch,
    };
}

function seed(s: PvpSession): void {
    store.set(`pvp:${s.battleId}`, clone(s));
}

function storedSession(battleId: string): PvpSession {
    const found = store.get(`pvp:${battleId}`);
    assert.ok(found, `missing stored session ${battleId}`);
    return clone(found) as PvpSession;
}

test('pvp adapter converts session state without changing PvP-compatible fields', () => {
    const initial = session('adapter', {
        cooldowns: { p1: { blast: 2 }, p2: {} },
        groundEffects: [{
            id: 'zone-1',
            owner: 'p1',
            name: 'Test Zone',
            tiles: [1, 2],
            rounds: 2,
            tags: [{ name: 'Poison', percent: 6 }],
        }],
        biome: 'forest',
        weatherPositiveElement: 'Fire',
    });
    const combat = pvpSessionToCombatBattleState(initial);
    assert.equal(combat.battleId, 'adapter');
    assert.equal(combat.activeActorId, 'p1');
    assert.equal(combat.fighters.p1?.name, 'alice');
    assert.equal(combat.fighters.p1?.cooldowns?.blast, 2);
    assert.equal(combat.groundEffects?.[0]?.owner, 'p1');
    assert.equal(combat.meta?.biome, 'forest');

    const updated = applyCombatResolveResultToPvpSession(initial, {
        fighters: { p2: { ...combat.fighters.p2!, hp: 321, shield: 12 } },
        ap: { p1: 70, p2: 100 },
        cooldowns: { p1: { blast: 1 }, p2: {} },
        log: [...initial.log, 'adapter update'],
        status: 'done',
        winner: 'p1',
        fx: [{ target: 'p2', amount: 123, kind: 'damage' }],
        fxSeq: 9,
    });
    assert.equal(updated.p2.hp, 321);
    assert.equal(updated.p2.shield, 12);
    assert.equal(updated.ap.p1, 70);
    assert.equal(updated.cooldowns.p1.blast, 1);
    assert.equal(updated.status, 'done');
    assert.equal(updated.winner, 'p1');
    assert.deepEqual(updated.fx, [{ target: 'p2', amount: 123, kind: 'damage' }]);
    assert.equal(updated.fxSeq, 9);
    assert.ok(updated.log.at(-1)?.includes('adapter update'));
});

test('moveToken retry returns the current session without double-applying a jutsu', async () => {
    seed(session('idem'));
    const body = { battleId: 'idem', role: 'p1', action: 'jutsu', jutsuId: 'blast', moveToken: 'same-token' };

    const first = await postMove('alice', body);
    assert.equal(first.statusCode, 200);
    const afterFirst = storedSession('idem');
    assert.equal(afterFirst.ap.p1, 40);
    assert.equal(afterFirst.p1.chakra, 975);
    assert.equal(afterFirst.p1.stamina, 985);
    assert.equal(afterFirst.cooldowns.p1.blast, 3);
    assert.ok(afterFirst.p2.hp < 5000, 'first cast should damage the opponent');
    assert.deepEqual(afterFirst.recentMoveTokens, ['same-token']);

    const second = await postMove('alice', body);
    assert.equal(second.statusCode, 200);
    const afterSecond = storedSession('idem');
    assert.equal(afterSecond.p2.hp, afterFirst.p2.hp);
    assert.equal(afterSecond.ap.p1, afterFirst.ap.p1);
    assert.equal(afterSecond.p1.chakra, afterFirst.p1.chakra);
    assert.equal(afterSecond.p1.stamina, afterFirst.p1.stamina);
    assert.equal(afterSecond.log.length, afterFirst.log.length);
    assert.deepEqual(afterSecond.recentMoveTokens, ['same-token']);
});

test('insufficient AP rejects without mutating fighter state or persisting the retry token', async () => {
    seed(session('no-ap', { ap: { p1: 40, p2: 100 } }));

    const out = await postMove('alice', {
        battleId: 'no-ap',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'blast',
        moveToken: 'too-expensive',
    });

    assert.equal(out.statusCode, 200);
    const body = out.body as PvpSession;
    assert.equal(body.rejected?.applied, false);
    assert.match(body.rejected?.reason ?? '', /Not enough AP/);
    const after = storedSession('no-ap');
    assert.equal(after.ap.p1, 40);
    assert.equal(after.p1.chakra, 1000);
    assert.equal(after.p1.stamina, 1000);
    assert.equal(after.p2.hp, 5000);
    assert.equal(after.recentMoveTokens, undefined);
});

test('insufficient chakra rejection is logged but does not spend AP or stamina', async () => {
    seed(session('no-chakra', { p1: fighter('alice', 0, { chakra: 10 }) }));

    const out = await postMove('alice', {
        battleId: 'no-chakra',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'blast',
        moveToken: 'no-chakra-token',
    });

    assert.equal(out.statusCode, 200);
    const body = out.body as PvpSession;
    assert.equal(body.rejected?.applied, false);
    assert.match(body.rejected?.reason ?? '', /not enough chakra/);
    const after = storedSession('no-chakra');
    assert.equal(after.ap.p1, 100);
    assert.equal(after.p1.chakra, 10);
    assert.equal(after.p1.stamina, 1000);
    assert.equal(after.p2.hp, 5000);
    assert.ok(after.log.at(-1)?.includes('not enough chakra'));
});

test('basic attack spends only AP and stamina and emits matching damage fx', async () => {
    seed(session('basic'));

    const out = await postMove('alice', {
        battleId: 'basic',
        role: 'p1',
        action: 'basicAttack',
        moveToken: 'basic-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('basic');
    assert.equal(after.ap.p1, 60);
    assert.equal(after.p1.chakra, 1000);
    assert.equal(after.p1.stamina, 990);
    assert.ok(after.p2.hp < 5000, 'basic attack should damage adjacent opponent');
    assert.ok(after.log.some((line) => line.includes('alice uses Basic Attack')));
    const damageFx = after.fx?.find((fx) => fx.target === 'p2' && fx.kind === 'damage');
    assert.ok(damageFx, 'basic attack should expose server-resolved damage fx');
    assert.ok(after.log.some((line) => line.includes(`${damageFx.amount} damage`)));
});

test('cooldown is applied on cast and ticks when that fighter ends turn', async () => {
    seed(session('cooldown'));

    await postMove('alice', {
        battleId: 'cooldown',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'blast',
        moveToken: 'cast-token',
    });
    assert.equal(storedSession('cooldown').cooldowns.p1.blast, 3);

    const wait = await postMove('alice', {
        battleId: 'cooldown',
        role: 'p1',
        action: 'wait',
        moveToken: 'wait-token',
    });

    assert.equal(wait.statusCode, 200);
    const afterWait = storedSession('cooldown');
    assert.equal(afterWait.activePlayer, 'p2');
    assert.equal(afterWait.cooldowns.p1.blast, 2);
});

test('active stun on the next fighter applies the AP penalty once at handoff', async () => {
    const stun: PvpStatus = { name: 'Stun', rounds: 1, kind: 'negative' };
    seed(session('stun', { p2: fighter('bob', 1, { statuses: [stun] }) }));

    const out = await postMove('alice', {
        battleId: 'stun',
        role: 'p1',
        action: 'wait',
        moveToken: 'wait-stun-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('stun');
    assert.equal(after.activePlayer, 'p2');
    assert.equal(after.ap.p2, 60);
    assert.equal(after.p2.statuses.some((status) => status.name === 'Stun'), false);
    assert.ok(after.log.some((line) => line.includes('bob is stunned') && line.includes('60 AP')));
});

type ReplayStep = { player: string; body: Record<string, unknown> };
type ReplayCase = {
    name: string;
    battleId: string;
    initial: () => PvpSession;
    steps: ReplayStep[];
    assertFinal: (final: PvpSession, responses: Array<{ statusCode: number; body: unknown }>) => void;
};

const goldenReplays: ReplayCase[] = [
    {
        name: 'basic jutsu damage, AP spend, resources, cooldown, and log',
        battleId: 'golden-jutsu',
        initial: () => session('golden-jutsu'),
        steps: [{ player: 'alice', body: { battleId: 'golden-jutsu', role: 'p1', action: 'jutsu', jutsuId: 'blast', moveToken: 'golden-jutsu-1' } }],
        assertFinal: (final) => {
            assert.equal(final.p2.hp, 3720);
            assert.equal(final.ap.p1, 40);
            assert.equal(final.p1.chakra, 975);
            assert.equal(final.p1.stamina, 985);
            assert.equal(final.cooldowns.p1.blast, 3);
            assert.ok(final.log.some((line) => line.includes('alice uses Test Blast')));
            assert.ok(final.log.some((line) => line.includes('1280 damage')));
        },
    },
    {
        name: 'basic attack spend and server damage fx',
        battleId: 'golden-basic',
        initial: () => session('golden-basic'),
        steps: [{ player: 'alice', body: { battleId: 'golden-basic', role: 'p1', action: 'basicAttack', moveToken: 'golden-basic-1' } }],
        assertFinal: (final) => {
            assert.equal(final.p2.hp, 4808);
            assert.equal(final.ap.p1, 60);
            assert.equal(final.p1.chakra, 1000);
            assert.equal(final.p1.stamina, 990);
            assert.deepEqual(final.fx, [{ target: 'p2', amount: 192, kind: 'damage' }]);
            assert.ok(final.log.some((line) => line.includes('192 damage')));
        },
    },
    {
        name: 'support jutsu applies pending heal and shield without damaging opponent',
        battleId: 'golden-support',
        initial: () => session('golden-support', {
            p1: withExtraJutsu(fighter('alice', 0, { hp: 4000 }), supportJutsu),
        }),
        steps: [{ player: 'alice', body: { battleId: 'golden-support', role: 'p1', action: 'jutsu', jutsuId: 'support', moveToken: 'golden-support-1' } }],
        assertFinal: (final) => {
            assert.equal(final.p1.hp, 4750);
            assert.equal(final.p1.shield, 750);
            assert.equal(final.p2.hp, 5000);
            assert.equal(final.ap.p1, 60);
            assert.equal(final.p1.chakra, 995);
            assert.equal(final.cooldowns.p1.support, 2);
            assert.deepEqual(final.fx, [{ target: 'p1', amount: 750, kind: 'heal' }]);
            assert.ok(final.log.some((line) => line.includes('Heal: alice restores 750 HP.')));
            assert.ok(final.log.some((line) => line.includes('Shield: alice gains 750 shield.')));
            assert.equal(final.log.some((line) => line.includes('damage to bob')), false);
        },
    },
    {
        name: 'insufficient AP rejection leaves stored state unchanged',
        battleId: 'golden-no-ap',
        initial: () => session('golden-no-ap', { ap: { p1: 40, p2: 100 } }),
        steps: [{ player: 'alice', body: { battleId: 'golden-no-ap', role: 'p1', action: 'jutsu', jutsuId: 'blast', moveToken: 'golden-no-ap-1' } }],
        assertFinal: (final, responses) => {
            assert.equal((responses[0]?.body as PvpSession).rejected?.applied, false);
            assert.match((responses[0]?.body as PvpSession).rejected?.reason ?? '', /Not enough AP/);
            assert.equal(final.p2.hp, 5000);
            assert.equal(final.ap.p1, 40);
            assert.equal(final.p1.chakra, 1000);
            assert.equal(final.p1.stamina, 1000);
            assert.equal(final.recentMoveTokens, undefined);
        },
    },
    {
        name: 'stun AP penalty at turn handoff',
        battleId: 'golden-stun',
        initial: () => session('golden-stun', { p2: fighter('bob', 1, { statuses: [{ name: 'Stun', rounds: 1, kind: 'negative' }] }) }),
        steps: [{ player: 'alice', body: { battleId: 'golden-stun', role: 'p1', action: 'wait', moveToken: 'golden-stun-1' } }],
        assertFinal: (final) => {
            assert.equal(final.activePlayer, 'p2');
            assert.equal(final.ap.p2, 60);
            assert.equal(final.p2.statuses.some((status) => status.name === 'Stun'), false);
            assert.ok(final.log.some((line) => line.includes('bob is stunned') && line.includes('60 AP')));
        },
    },
];

for (const replay of goldenReplays) {
    test(`golden replay: ${replay.name}`, async () => {
        seed(replay.initial());
        const responses: Array<{ statusCode: number; body: unknown }> = [];
        for (const step of replay.steps) {
            const response = await postMove(step.player, step.body);
            assert.equal(response.statusCode, 200);
            responses.push(response);
        }
        replay.assertFinal(storedSession(replay.battleId), responses);
    });
}
