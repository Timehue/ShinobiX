"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pvpAdapter_js_1 = require("../combat-adapters/pvpAdapter.js");
process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';
process.env.SESSION_SECRET = 'pvp-move-handler-test-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
const store = new Map();
const clone = (v) => (v === undefined || v === null) ? null : JSON.parse(JSON.stringify(v));
let moveHandler;
let issuePlayerToken;
(0, node_test_1.before)(async () => {
    const storage = await import('../_storage.js');
    const kv = storage.kv;
    kv.get = async (key) => clone(store.get(key));
    kv.set = async (key, value, options) => {
        if (options?.nx && store.has(key))
            return null;
        store.set(key, clone(value));
        return 'OK';
    };
    kv.del = async (...keys) => keys.reduce((n, key) => n + (store.delete(key) ? 1 : 0), 0);
    kv.incr = async (key) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    kv.keys = async (pattern) => {
        const prefix = pattern.replace(/\*.*$/, '');
        return [...store.keys()].filter((key) => key.startsWith(prefix));
    };
    kv.mget = async (...keys) => keys.map((key) => clone(store.get(key)));
    kv.hgetall = async (key) => clone(store.get(key));
    kv.hkeys = async (key) => Object.keys(store.get(key) ?? {});
    kv.hset = async (key, fields) => {
        store.set(key, { ...(store.get(key) ?? {}), ...clone(fields) });
        return Object.keys(fields).length;
    };
    kv.hdel = async (key, ...fields) => {
        const current = { ...(store.get(key) ?? {}) };
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
    moveHandler = (await import('./move.js')).default;
    issuePlayerToken = (await import('../_auth.js')).issuePlayerToken;
});
(0, node_test_1.beforeEach)(() => {
    store.clear();
});
function fakeReq(playerName, body) {
    const token = issuePlayerToken(playerName);
    strict_1.default.ok(token, 'test session token should be minted');
    return {
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'x-player-name': playerName,
            'x-player-token': token,
            'x-forwarded-for': '10.0.0.1',
        },
        socket: { remoteAddress: '10.0.0.1' },
    };
}
function fakeRes() {
    const out = { statusCode: 200, body: undefined, headers: {} };
    const res = {
        setHeader: (key, value) => { out.headers[key] = value; return res; },
        status: (code) => { out.statusCode = code; return res; },
        json: (body) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res, out };
}
async function postMove(playerName, body) {
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
function fighter(name, pos, patch = {}) {
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
function withExtraJutsu(base, jutsu, level = 50) {
    const character = base.character;
    const jutsuList = character.jutsu ?? [];
    const masteryList = character.jutsuMastery ?? [];
    return {
        ...base,
        character: {
            ...character,
            jutsu: [...jutsuList, jutsu],
            jutsuMastery: [...masteryList, { jutsuId: String(jutsu.id), level }],
        },
    };
}
function session(battleId, patch = {}) {
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
function seed(s) {
    store.set(`pvp:${s.battleId}`, clone(s));
}
function storedSession(battleId) {
    const found = store.get(`pvp:${battleId}`);
    strict_1.default.ok(found, `missing stored session ${battleId}`);
    return clone(found);
}
(0, node_test_1.test)('pvp adapter converts session state without changing PvP-compatible fields', () => {
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
    const combat = (0, pvpAdapter_js_1.pvpSessionToCombatBattleState)(initial);
    strict_1.default.equal(combat.battleId, 'adapter');
    strict_1.default.equal(combat.activeActorId, 'p1');
    strict_1.default.equal(combat.fighters.p1?.name, 'alice');
    strict_1.default.equal(combat.fighters.p1?.cooldowns?.blast, 2);
    strict_1.default.equal(combat.groundEffects?.[0]?.owner, 'p1');
    strict_1.default.equal(combat.meta?.biome, 'forest');
    const updated = (0, pvpAdapter_js_1.applyCombatResolveResultToPvpSession)(initial, {
        fighters: { p2: { ...combat.fighters.p2, hp: 321, shield: 12 } },
        ap: { p1: 70, p2: 100 },
        cooldowns: { p1: { blast: 1 }, p2: {} },
        log: [...initial.log, 'adapter update'],
        status: 'done',
        winner: 'p1',
        fx: [{ target: 'p2', amount: 123, kind: 'damage' }],
        fxSeq: 9,
    });
    strict_1.default.equal(updated.p2.hp, 321);
    strict_1.default.equal(updated.p2.shield, 12);
    strict_1.default.equal(updated.ap.p1, 70);
    strict_1.default.equal(updated.cooldowns.p1.blast, 1);
    strict_1.default.equal(updated.status, 'done');
    strict_1.default.equal(updated.winner, 'p1');
    strict_1.default.deepEqual(updated.fx, [{ target: 'p2', amount: 123, kind: 'damage' }]);
    strict_1.default.equal(updated.fxSeq, 9);
    strict_1.default.ok(updated.log.at(-1)?.includes('adapter update'));
});
(0, node_test_1.test)('moveToken retry returns the current session without double-applying a jutsu', async () => {
    seed(session('idem'));
    const body = { battleId: 'idem', role: 'p1', action: 'jutsu', jutsuId: 'blast', moveToken: 'same-token' };
    const first = await postMove('alice', body);
    strict_1.default.equal(first.statusCode, 200);
    const afterFirst = storedSession('idem');
    strict_1.default.equal(afterFirst.ap.p1, 40);
    strict_1.default.equal(afterFirst.p1.chakra, 975);
    strict_1.default.equal(afterFirst.p1.stamina, 985);
    strict_1.default.equal(afterFirst.cooldowns.p1.blast, 3);
    strict_1.default.ok(afterFirst.p2.hp < 5000, 'first cast should damage the opponent');
    strict_1.default.deepEqual(afterFirst.recentMoveTokens, ['same-token']);
    const second = await postMove('alice', body);
    strict_1.default.equal(second.statusCode, 200);
    const afterSecond = storedSession('idem');
    strict_1.default.equal(afterSecond.p2.hp, afterFirst.p2.hp);
    strict_1.default.equal(afterSecond.ap.p1, afterFirst.ap.p1);
    strict_1.default.equal(afterSecond.p1.chakra, afterFirst.p1.chakra);
    strict_1.default.equal(afterSecond.p1.stamina, afterFirst.p1.stamina);
    strict_1.default.equal(afterSecond.log.length, afterFirst.log.length);
    strict_1.default.deepEqual(afterSecond.recentMoveTokens, ['same-token']);
});
(0, node_test_1.test)('insufficient AP rejects without mutating fighter state or persisting the retry token', async () => {
    seed(session('no-ap', { ap: { p1: 40, p2: 100 } }));
    const out = await postMove('alice', {
        battleId: 'no-ap',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'blast',
        moveToken: 'too-expensive',
    });
    strict_1.default.equal(out.statusCode, 200);
    const body = out.body;
    strict_1.default.equal(body.rejected?.applied, false);
    strict_1.default.match(body.rejected?.reason ?? '', /Not enough AP/);
    const after = storedSession('no-ap');
    strict_1.default.equal(after.ap.p1, 40);
    strict_1.default.equal(after.p1.chakra, 1000);
    strict_1.default.equal(after.p1.stamina, 1000);
    strict_1.default.equal(after.p2.hp, 5000);
    strict_1.default.equal(after.recentMoveTokens, undefined);
});
(0, node_test_1.test)('insufficient chakra rejection is logged but does not spend AP or stamina', async () => {
    seed(session('no-chakra', { p1: fighter('alice', 0, { chakra: 10 }) }));
    const out = await postMove('alice', {
        battleId: 'no-chakra',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'blast',
        moveToken: 'no-chakra-token',
    });
    strict_1.default.equal(out.statusCode, 200);
    const body = out.body;
    strict_1.default.equal(body.rejected?.applied, false);
    strict_1.default.match(body.rejected?.reason ?? '', /not enough chakra/);
    const after = storedSession('no-chakra');
    strict_1.default.equal(after.ap.p1, 100);
    strict_1.default.equal(after.p1.chakra, 10);
    strict_1.default.equal(after.p1.stamina, 1000);
    strict_1.default.equal(after.p2.hp, 5000);
    strict_1.default.ok(after.log.at(-1)?.includes('not enough chakra'));
});
(0, node_test_1.test)('basic attack spends only AP and stamina and emits matching damage fx', async () => {
    seed(session('basic'));
    const out = await postMove('alice', {
        battleId: 'basic',
        role: 'p1',
        action: 'basicAttack',
        moveToken: 'basic-token',
    });
    strict_1.default.equal(out.statusCode, 200);
    const after = storedSession('basic');
    strict_1.default.equal(after.ap.p1, 60);
    strict_1.default.equal(after.p1.chakra, 1000);
    strict_1.default.equal(after.p1.stamina, 990);
    strict_1.default.ok(after.p2.hp < 5000, 'basic attack should damage adjacent opponent');
    strict_1.default.ok(after.log.some((line) => line.includes('alice uses Basic Attack')));
    const damageFx = after.fx?.find((fx) => fx.target === 'p2' && fx.kind === 'damage');
    strict_1.default.ok(damageFx, 'basic attack should expose server-resolved damage fx');
    strict_1.default.ok(after.log.some((line) => line.includes(`${damageFx.amount} damage`)));
});
(0, node_test_1.test)('cooldown is applied on cast and ticks when that fighter ends turn', async () => {
    seed(session('cooldown'));
    await postMove('alice', {
        battleId: 'cooldown',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'blast',
        moveToken: 'cast-token',
    });
    strict_1.default.equal(storedSession('cooldown').cooldowns.p1.blast, 3);
    const wait = await postMove('alice', {
        battleId: 'cooldown',
        role: 'p1',
        action: 'wait',
        moveToken: 'wait-token',
    });
    strict_1.default.equal(wait.statusCode, 200);
    const afterWait = storedSession('cooldown');
    strict_1.default.equal(afterWait.activePlayer, 'p2');
    strict_1.default.equal(afterWait.cooldowns.p1.blast, 2);
});
(0, node_test_1.test)('active stun on the next fighter applies the AP penalty once at handoff', async () => {
    const stun = { name: 'Stun', rounds: 1, kind: 'negative' };
    seed(session('stun', { p2: fighter('bob', 1, { statuses: [stun] }) }));
    const out = await postMove('alice', {
        battleId: 'stun',
        role: 'p1',
        action: 'wait',
        moveToken: 'wait-stun-token',
    });
    strict_1.default.equal(out.statusCode, 200);
    const after = storedSession('stun');
    strict_1.default.equal(after.activePlayer, 'p2');
    strict_1.default.equal(after.ap.p2, 60);
    strict_1.default.equal(after.p2.statuses.some((status) => status.name === 'Stun'), false);
    strict_1.default.ok(after.log.some((line) => line.includes('bob is stunned') && line.includes('60 AP')));
});
const goldenReplays = [
    {
        name: 'basic jutsu damage, AP spend, resources, cooldown, and log',
        battleId: 'golden-jutsu',
        initial: () => session('golden-jutsu'),
        steps: [{ player: 'alice', body: { battleId: 'golden-jutsu', role: 'p1', action: 'jutsu', jutsuId: 'blast', moveToken: 'golden-jutsu-1' } }],
        assertFinal: (final) => {
            strict_1.default.equal(final.p2.hp, 3720);
            strict_1.default.equal(final.ap.p1, 40);
            strict_1.default.equal(final.p1.chakra, 975);
            strict_1.default.equal(final.p1.stamina, 985);
            strict_1.default.equal(final.cooldowns.p1.blast, 3);
            strict_1.default.ok(final.log.some((line) => line.includes('alice uses Test Blast')));
            strict_1.default.ok(final.log.some((line) => line.includes('1280 damage')));
        },
    },
    {
        name: 'basic attack spend and server damage fx',
        battleId: 'golden-basic',
        initial: () => session('golden-basic'),
        steps: [{ player: 'alice', body: { battleId: 'golden-basic', role: 'p1', action: 'basicAttack', moveToken: 'golden-basic-1' } }],
        assertFinal: (final) => {
            strict_1.default.equal(final.p2.hp, 4808);
            strict_1.default.equal(final.ap.p1, 60);
            strict_1.default.equal(final.p1.chakra, 1000);
            strict_1.default.equal(final.p1.stamina, 990);
            strict_1.default.deepEqual(final.fx, [{ target: 'p2', amount: 192, kind: 'damage' }]);
            strict_1.default.ok(final.log.some((line) => line.includes('192 damage')));
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
            strict_1.default.equal(final.p1.hp, 4750);
            strict_1.default.equal(final.p1.shield, 750);
            strict_1.default.equal(final.p2.hp, 5000);
            strict_1.default.equal(final.ap.p1, 60);
            strict_1.default.equal(final.p1.chakra, 995);
            strict_1.default.equal(final.cooldowns.p1.support, 2);
            strict_1.default.deepEqual(final.fx, [{ target: 'p1', amount: 750, kind: 'heal' }]);
            strict_1.default.ok(final.log.some((line) => line.includes('Heal: alice restores 750 HP.')));
            strict_1.default.ok(final.log.some((line) => line.includes('Shield: alice gains 750 shield.')));
            strict_1.default.equal(final.log.some((line) => line.includes('damage to bob')), false);
        },
    },
    {
        name: 'insufficient AP rejection leaves stored state unchanged',
        battleId: 'golden-no-ap',
        initial: () => session('golden-no-ap', { ap: { p1: 40, p2: 100 } }),
        steps: [{ player: 'alice', body: { battleId: 'golden-no-ap', role: 'p1', action: 'jutsu', jutsuId: 'blast', moveToken: 'golden-no-ap-1' } }],
        assertFinal: (final, responses) => {
            strict_1.default.equal((responses[0]?.body).rejected?.applied, false);
            strict_1.default.match((responses[0]?.body).rejected?.reason ?? '', /Not enough AP/);
            strict_1.default.equal(final.p2.hp, 5000);
            strict_1.default.equal(final.ap.p1, 40);
            strict_1.default.equal(final.p1.chakra, 1000);
            strict_1.default.equal(final.p1.stamina, 1000);
            strict_1.default.equal(final.recentMoveTokens, undefined);
        },
    },
    {
        name: 'stun AP penalty at turn handoff',
        battleId: 'golden-stun',
        initial: () => session('golden-stun', { p2: fighter('bob', 1, { statuses: [{ name: 'Stun', rounds: 1, kind: 'negative' }] }) }),
        steps: [{ player: 'alice', body: { battleId: 'golden-stun', role: 'p1', action: 'wait', moveToken: 'golden-stun-1' } }],
        assertFinal: (final) => {
            strict_1.default.equal(final.activePlayer, 'p2');
            strict_1.default.equal(final.ap.p2, 60);
            strict_1.default.equal(final.p2.statuses.some((status) => status.name === 'Stun'), false);
            strict_1.default.ok(final.log.some((line) => line.includes('bob is stunned') && line.includes('60 AP')));
        },
    },
];
for (const replay of goldenReplays) {
    (0, node_test_1.test)(`golden replay: ${replay.name}`, async () => {
        seed(replay.initial());
        const responses = [];
        for (const step of replay.steps) {
            const response = await postMove(step.player, step.body);
            strict_1.default.equal(response.statusCode, 200);
            responses.push(response);
        }
        replay.assertFinal(storedSession(replay.battleId), responses);
    });
}
