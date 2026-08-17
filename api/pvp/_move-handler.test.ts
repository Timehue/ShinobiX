import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { applyCombatResolveResultToPvpSession, pvpSessionToCombatBattleState } from '../combat-adapters/pvpAdapter.js';
import type { PvpFighter, PvpSession, PvpStatus } from './session.js';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';
process.env.SESSION_SECRET = 'pvp-move-handler-test-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

const store = new Map<string, unknown>();
const clone = <T>(v: T): T => (v === undefined || v === null) ? null as T : JSON.parse(JSON.stringify(v));
let beforeCompareSet: ((key: string, expected: unknown, value: unknown) => Promise<void> | void) | null = null;

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
    kv.compareSet = async (key: string, expected: unknown, value: unknown) => {
        await beforeCompareSet?.(key, clone(expected), clone(value));
        const current = store.has(key) ? clone(store.get(key)) : null;
        if (!isDeepStrictEqual(current, expected)) return false;
        store.set(key, clone(value));
        return true;
    };
    kv.del = async (...keys: string[]) => keys.reduce((n, key) => n + (store.delete(key) ? 1 : 0), 0);
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
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
    beforeCompareSet = null;
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

const buffedElementAttack = {
    id: 'buffed-element',
    name: 'Buffed Element',
    type: 'Ninjutsu',
    element: 'Lava',
    target: 'OPPONENT',
    range: 1,
    ap: 60,
    cooldown: 3,
    chakraCost: 25,
    staminaCost: 15,
    effectPower: 30,
    isUtility: false,
    tags: [{ name: 'Increase Damage Given', percent: 20 }],
};

const crystalAttack = {
    id: 'crystal-lance',
    name: 'Crystal Lance',
    type: 'Ninjutsu',
    element: 'Crystal',
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

const pushJutsu = {
    id: 'push-test',
    name: 'Push Test',
    type: 'Ninjutsu',
    element: 'None',
    target: 'OPPONENT',
    range: 1,
    ap: 40,
    cooldown: 1,
    chakraCost: 5,
    staminaCost: 0,
    effectPower: 0,
    isUtility: false,
    tags: [{ name: 'Push', percent: 0 }],
};

const flickerJutsu = {
    id: 'flicker',
    name: 'Flicker',
    type: 'Taijutsu',
    element: 'None',
    target: 'EMPTY_GROUND',
    range: 5,
    ap: 20,
    cooldown: 2,
    chakraCost: 25,
    staminaCost: 25,
    effectPower: 1,
    method: 'SINGLE',
    tags: [{ name: 'Move', percent: 0 }],
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

function withEquippedItem(base: PvpFighter, item: Record<string, unknown>, slotKey: string): PvpFighter {
    const character = base.character as Record<string, unknown>;
    return {
        ...base,
        character: {
            ...character,
            pvpItems: [...((character.pvpItems as unknown[] | undefined) ?? []), item],
            equipment: {
                ...((character.equipment as Record<string, string | undefined> | undefined) ?? {}),
                [slotKey]: String(item.id),
            },
        },
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
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        createdAt: Date.now(),
        lastMoveAt: Date.now(),
        ...patch,
    };
}

test('a ranked tombstone returns terminal control instead of dereferencing fighters', async () => {
    store.set('pvp:tombstone-control', {
        version: 'player-ranked-session-close-tombstone-v1',
        battleId: 'tombstone-control',
        matchId: 'player-ranked-tombstone',
        transitionId: 'season-close',
    });

    const out = await postMove('alice', {
        battleId: 'tombstone-control',
        role: 'p1',
        action: 'wait',
        moveToken: 'must-not-dereference',
    });

    assert.equal(out.statusCode, 409);
    assert.match(String((out.body as { error?: string }).error), /no longer active/i);
});

test('an unsolicited opponent cannot claim an AFK win before both fighters join', async () => {
    seed(session('unjoined-afk', {
        activePlayer: 'p2',
        joined: { p1: true, p2: false },
        createdAt: Date.now() - 120_000,
        lastMoveAt: Date.now() - 120_000,
    }));

    const claim = await postMove('alice', {
        battleId: 'unjoined-afk',
        role: 'p1',
        action: 'claim-afk-win',
        moveToken: 'unjoined-afk-claim',
    });
    assert.equal(claim.statusCode, 200);
    // Matches the rejection's meaning, not its exact prose — the copy became
    // "Waiting for both fighters to join before combat can advance."
    assert.match(String((claim.body as PvpSession).rejected?.reason), /both fighters/i);
    assert.equal(storedSession('unjoined-afk').status, 'active');
});

test('join is an authenticated, idempotent membership handshake even out of turn', async () => {
    seed(session('join-handshake', {
        activePlayer: 'p1',
        joined: { p1: true, p2: false },
        // A different fighter can choose this predictable string as an action
        // token. Membership authority must be the joined bit, not token history.
        recentMoveTokens: ['join-join-handshake-p2'],
    }));
    const joined = await postMove('bob', {
        battleId: 'join-handshake',
        role: 'p2',
        action: 'join',
        moveToken: 'join-handshake-p2',
    });
    assert.equal(joined.statusCode, 200);
    assert.deepEqual(storedSession('join-handshake').joined, { p1: true, p2: true });
    assert.equal(storedSession('join-handshake').stateRevision, 1,
        'the first mutation upgrades a bounded legacy row to revision 1');

    const replay = await postMove('bob', {
        battleId: 'join-handshake',
        role: 'p2',
        action: 'join',
        moveToken: 'join-handshake-p2',
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(storedSession('join-handshake').stateRevision, 1,
        'an idempotent replay must not mint a projection revision');
});

test('join exact-clears a stale sessionless pointer and recovers in the same request', async () => {
    const battleId = 'join-stale-pointer';
    seed(session(battleId, {
        joined: { p1: true, p2: false },
        realFighters: { p1: true, p2: true },
    }));
    store.set('pvp:pending-session:bob', JSON.stringify({
        version: 1,
        playerName: 'bob',
        battleId: 'expired-old-battle',
        role: 'p2',
        createdAt: Date.now() - 60_000,
        phase: 'active',
    }));

    const joined = await postMove('bob', {
        battleId,
        role: 'p2',
        action: 'join',
        moveToken: 'join-stale-pointer-token',
    });
    assert.equal(joined.statusCode, 200);
    assert.equal(storedSession(battleId).joined?.p2, true);
    const pointer = JSON.parse(String(store.get('pvp:pending-session:bob')));
    assert.equal(pointer.battleId, battleId);
    assert.equal(pointer.phase, 'active');
});

test('join preserves a prior draw pointer until its exact completion ACK is durable', async () => {
    const oldBattleId = 'join-prior-kage-draw';
    const newBattleId = 'join-after-kage-draw';
    const old = session(oldBattleId, {
        status: 'done',
        winner: 'draw',
        endedAt: Date.now(),
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
    });
    seed(old);
    seed(session(newBattleId, {
        joined: { p1: true, p2: false },
        realFighters: { p1: true, p2: true },
    }));
    store.set('pvp:pending-session:bob', JSON.stringify({
        version: 1,
        playerName: 'bob',
        battleId: oldBattleId,
        role: 'p2',
        createdAt: old.createdAt,
        phase: 'active',
        recoveryExpiresAt: Number(old.endedAt) + 48 * 60 * 60 * 1_000,
    }));

    const blocked = await postMove('bob', {
        battleId: newBattleId,
        role: 'p2',
        action: 'join',
        moveToken: 'join-draw-pending',
    });
    assert.equal(blocked.statusCode, 409);
    assert.equal(storedSession(newBattleId).joined?.p2, false);
    assert.equal(JSON.parse(String(store.get('pvp:pending-session:bob'))).battleId, oldBattleId);

    const completedAt = Date.now();
    store.set(`pvp:rewarded:bob:${oldBattleId}`, {
        version: 2,
        outcome: 'draw',
        claimedAt: completedAt,
        completionRequired: true,
        completionState: 'completed',
        completedAt,
        serverCreditsState: 'completed',
        serverCreditsCompletedAt: completedAt,
    });
    const joined = await postMove('bob', {
        battleId: newBattleId,
        role: 'p2',
        action: 'join',
        moveToken: 'join-draw-completed',
    });
    assert.equal(joined.statusCode, 200);
    assert.equal(storedSession(newBattleId).joined?.p2, true);
    assert.equal(JSON.parse(String(store.get('pvp:pending-session:bob'))).battleId, newBattleId);
});

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

test('duplicate-token retry repairs an action receipt missing after combat CAS', async () => {
    const previous = process.env.DISABLE_COMBAT_RECEIPTS;
    process.env.DISABLE_COMBAT_RECEIPTS = '0';
    try {
        const { withPvpActionReceiptReplay, pvpActionReceiptKey } = await import('./_action-receipt-replay.js');
        const pre = session('receipt-crash', { stateRevision: 8 });
        const post = {
            ...pre,
            ap: { ...pre.ap, p1: 60 },
            actionsThisTurn: 1,
            log: [...pre.log, 'alice attacks bob.'],
        };
        const candidate = withPvpActionReceiptReplay(pre, post, {
            role: 'p1',
            actionId: 'basicAttack',
            actionName: 'Basic Attack',
            actionType: 'basicAttack',
            moveToken: 'receipt-crash-token',
        }, 1234);
        seed({
            ...candidate,
            stateRevision: 9,
            recentMoveTokens: ['receipt-crash-token'],
        });

        const out = await postMove('alice', {
            battleId: 'receipt-crash',
            role: 'p1',
            action: 'basicAttack',
            moveToken: 'receipt-crash-token',
        });

        assert.equal(out.statusCode, 200);
        const key = pvpActionReceiptKey('receipt-crash', 9);
        const receipt = store.get(key) as { moveToken?: string; createdAt?: number } | undefined;
        assert.equal(receipt?.moveToken, 'receipt-crash-token');
        assert.equal(receipt?.createdAt, 1234);
        assert.equal(storedSession('receipt-crash').ap.p1, 60,
            'repair must not reapply the committed action');
    } finally {
        process.env.DISABLE_COMBAT_RECEIPTS = previous ?? '1';
    }
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
    const attackVfx = after.vfx?.find((fx) => fx.target === 'p2' && fx.key === 'impact');
    assert.ok(attackVfx, 'basic attack should expose enemy-targeted combat vfx');
    assert.equal(attackVfx.anchor, 'target');
    assert.equal(after.vfxSeq, 1);
    assert.ok(after.log.some((line) => line.includes(`${damageFx.amount} damage`)));
});

test('damaging jutsu with incidental support tags keeps its elemental VFX', async () => {
    seed(session('element-vfx', {
        p1: withExtraJutsu(fighter('alice', 0), buffedElementAttack),
    }));

    const out = await postMove('alice', {
        battleId: 'element-vfx',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'buffed-element',
        moveToken: 'element-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('element-vfx');
    assert.equal(after.vfx?.[0]?.key, 'magma');
    assert.equal(after.vfx?.[0]?.target, 'p2');
    assert.equal(after.vfx?.[0]?.anchor, 'target');
});

test('60 AP core-element jutsu emit their literal elemental VFX even with status tags', async () => {
    const fireUltimate = {
        ...blast,
        id: 'fire-ultimate',
        name: 'Fire Ultimate',
        element: 'Fire',
        tags: [{ name: 'Wound', percent: 30 }],
    };
    seed(session('fire-ultimate-vfx', {
        p1: withExtraJutsu(fighter('alice', 0), fireUltimate),
    }));

    const out = await postMove('alice', {
        battleId: 'fire-ultimate-vfx',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'fire-ultimate',
        moveToken: 'fire-ultimate-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('fire-ultimate-vfx');
    assert.equal(after.vfx?.[0]?.key, 'fire60');
    assert.equal(after.vfx?.[0]?.target, 'p2');
    assert.equal(after.vfx?.[0]?.anchor, 'target');
    assert.equal(after.vfx?.[0]?.intensity, 'heavy');
});

test('a saved Bloodline visual choice overrides the automatic 60 AP element VFX', async () => {
    const chosenVisual = {
        ...blast,
        id: 'chosen-visual',
        name: 'Chosen Visual',
        element: 'Fire',
        visualEffect: 'shield',
        tags: [{ name: 'Wound', percent: 30 }],
    };
    seed(session('chosen-visual-vfx', {
        p1: withExtraJutsu(fighter('alice', 0), chosenVisual),
    }));

    const out = await postMove('alice', {
        battleId: 'chosen-visual-vfx',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'chosen-visual',
        moveToken: 'chosen-visual-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('chosen-visual-vfx');
    assert.equal(after.vfx?.[0]?.key, 'shield');
    assert.equal(after.vfx?.[0]?.target, 'p2');
    assert.equal(after.vfx?.[0]?.anchor, 'target');
    assert.equal(after.vfx?.[0]?.intensity, 'heavy');
});

test('custom bloodline element names resolve to the nearest shipped VFX family', async () => {
    seed(session('custom-element-vfx', {
        p1: withExtraJutsu(fighter('alice', 0), crystalAttack),
    }));

    const out = await postMove('alice', {
        battleId: 'custom-element-vfx',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'crystal-lance',
        moveToken: 'custom-element-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('custom-element-vfx');
    assert.equal(after.vfx?.[0]?.key, 'metal');
    assert.equal(after.vfx?.[0]?.target, 'p2');
    assert.equal(after.vfx?.[0]?.anchor, 'target');
});

test('bloodline displacement tags emit wind VFX on the opponent', async () => {
    seed(session('push-vfx', {
        p1: withExtraJutsu(fighter('alice', 0), pushJutsu),
    }));

    const out = await postMove('alice', {
        battleId: 'push-vfx',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'push-test',
        moveToken: 'push-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('push-vfx');
    assert.equal(after.vfx?.[0]?.key, 'wind');
    assert.equal(after.vfx?.[0]?.target, 'p2');
    assert.equal(after.vfx?.[0]?.anchor, 'target');
});

test('pure movement jutsu leaves combat VFX empty so the board trail owns the read', async () => {
    seed(session('flicker-vfx', {
        p1: withExtraJutsu(fighter('alice', 0), flickerJutsu),
    }));

    const out = await postMove('alice', {
        battleId: 'flicker-vfx',
        role: 'p1',
        action: 'jutsu',
        jutsuId: 'flicker',
        tile: 12,
        moveToken: 'flicker-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('flicker-vfx');
    assert.equal(after.p1.pos, 12);
    assert.equal(after.vfx, undefined);
    assert.equal(after.vfxSeq, undefined);
});

test('thrown status weapons layer delivery VFX with their status effect', async () => {
    const serpentDust = {
        id: 'test-serpent-dust',
        name: 'Serpent Dust',
        slot: 'thrown',
        weaponRange: 4,
        weaponCooldown: 0,
        weaponEp: 0,
        weaponEffect: 'Poison',
        weaponEffectValue: 55,
        apCost: 20,
    };
    seed(session('throw-status-vfx', {
        p1: withEquippedItem(fighter('alice', 0), serpentDust, 'thrown'),
    }));

    const out = await postMove('alice', {
        battleId: 'throw-status-vfx',
        role: 'p1',
        action: 'weapon',
        itemId: 'test-serpent-dust',
        moveToken: 'throw-status-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('throw-status-vfx');
    assert.equal(after.vfx?.[0]?.key, 'throwable');
    assert.equal(after.vfx?.[0]?.target, 'p2');
    assert.ok(after.vfx?.some(vfx => vfx.key === 'poison' && vfx.target === 'p2' && vfx.anchor === 'target' && vfx.intensity === 'minor'));
});

test('named hand weapons layer delivery VFX with caster-side tag effects', async () => {
    const copyBlade = {
        id: 'test-copy-blade',
        name: 'Copy Blade',
        slot: 'hand',
        weaponRange: 1,
        weaponCooldown: 0,
        weaponEp: 24,
        weaponTags: [{ name: 'Copy', percent: 0 }],
        apCost: 20,
    };
    seed(session('named-weapon-vfx', {
        p1: withEquippedItem(fighter('alice', 0), copyBlade, 'hand'),
    }));

    const out = await postMove('alice', {
        battleId: 'named-weapon-vfx',
        role: 'p1',
        action: 'weapon',
        itemId: 'test-copy-blade',
        moveToken: 'named-weapon-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('named-weapon-vfx');
    assert.equal(after.vfx?.[0]?.key, 'namedWeapon');
    assert.equal(after.vfx?.[0]?.target, 'p2');
    assert.ok(after.vfx?.some(vfx => vfx.key === 'reflect' && vfx.target === 'p1' && vfx.anchor === 'caster' && vfx.intensity === 'minor'));
});

test('both-target consumables emit matching self and opponent VFX', async () => {
    const smokeBomb = {
        id: 'test-smoke-bomb',
        name: 'Smoke Bomb',
        slot: 'item',
        weaponCooldown: 0,
        weaponEffect: 'Decrease Damage Given',
        weaponEffectValue: 100,
        weaponEffectTarget: 'both',
        apCost: 20,
    };
    seed(session('smoke-vfx', {
        p1: withEquippedItem(fighter('alice', 0), smokeBomb, 'item1'),
    }));

    const out = await postMove('alice', {
        battleId: 'smoke-vfx',
        role: 'p1',
        action: 'item',
        itemId: 'test-smoke-bomb',
        moveToken: 'smoke-vfx-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('smoke-vfx');
    assert.ok(after.vfx?.some(vfx => vfx.key === 'debuff' && vfx.target === 'p2' && vfx.anchor === 'target'));
    assert.ok(after.vfx?.some(vfx => vfx.key === 'debuff' && vfx.target === 'p1' && vfx.anchor === 'caster' && vfx.intensity === 'minor'));
});

test('successful flee spends the adjusted Overclock cost without negative terminal AP', async () => {
    const originalRandomInt = crypto.randomInt;
    crypto.randomInt = (() => 0) as typeof crypto.randomInt;
    syncBuiltinESMExports();
    try {
        seed(session('flee-overclock-success', {
            p1: fighter('alice', 0, {
                statuses: [{ name: 'Overclock', rounds: 1, percent: 20, kind: 'positive', activeRound: 1 }],
            }),
            ap: { p1: 80, p2: 100 },
        }));

        const out = await postMove('alice', {
            battleId: 'flee-overclock-success',
            role: 'p1',
            action: 'flee',
            moveToken: 'flee-overclock-success-token',
        });
        assert.equal(out.statusCode, 200);

        const after = storedSession('flee-overclock-success');
        assert.equal(after.status, 'done');
        assert.equal(after.winner, 'p2');
        assert.equal(after.fleedBy, 'p1');
        assert.equal(after.ap.p1, 0, '80 AP with 20% Overclock must spend the adjusted 80 AP, not raw 100 AP');
        assert.equal(after.actionsThisTurn, 1);
        assert.equal(after.log.filter(line => /alice fled the battle/i.test(line)).length, 1);
    } finally {
        crypto.randomInt = originalRandomInt;
        syncBuiltinESMExports();
    }
});

test('consumable-authority v1 refuses a real casual fighter even if a stale worker left a positive charge', async () => {
    const smokeBomb = {
        id: 'test-v1-smoke-bomb',
        name: 'Smoke Bomb',
        slot: 'item',
        weaponCooldown: 0,
        weaponEffect: 'Decrease Damage Given',
        weaponEffectValue: 100,
        weaponEffectTarget: 'both',
        apCost: 20,
    };
    seed(session('smoke-v1-disabled', {
        p1: withEquippedItem(fighter('alice', 0), smokeBomb, 'item1'),
        pvpConsumableAuthorityVersion: 1,
        realFighters: { p1: true, p2: true },
        itemCharges: { p1: { 'test-v1-smoke-bomb': 3 }, p2: {} },
        itemsUsed: { p1: {}, p2: {} },
    }));

    const out = await postMove('alice', {
        battleId: 'smoke-v1-disabled',
        role: 'p1',
        action: 'item',
        itemId: 'test-v1-smoke-bomb',
        moveToken: 'smoke-v1-disabled-token',
    });

    assert.equal(out.statusCode, 200);
    const after = storedSession('smoke-v1-disabled');
    assert.match(after.log.at(-1) ?? '', /out of Smoke Bomb/i);
    assert.equal(after.ap.p1, 100);
    assert.equal(after.itemsUsed?.p1['test-v1-smoke-bomb'], undefined);
    assert.equal(after.itemCharges?.p1['test-v1-smoke-bomb'], 3);
});

test('terminal retry restores a missing battle receipt body with stable endedAt', async () => {
    const previous = process.env.DISABLE_COMBAT_RECEIPTS;
    process.env.DISABLE_COMBAT_RECEIPTS = '0';
    try {
        const battleId = 'terminal-receipt-repair';
        seed(session(battleId, {
            stateRevision: 2,
            p2: fighter('bob', 1, { hp: 1 }),
        }));
        // Model the legacy marker-before-body crash. New PvP replay authority
        // must ignore this orphan marker and CAS the receipt body itself.
        store.set(`receipt:wrote:${battleId}`, { ts: 1 });
        const body = {
            battleId,
            role: 'p1',
            action: 'basicAttack',
            moveToken: 'terminal-receipt-token',
        };
        const first = await postMove('alice', body);
        assert.equal(first.statusCode, 200);
        const terminal = storedSession(battleId);
        assert.equal(terminal.status, 'done');
        assert.ok(Number(terminal.endedAt) > 0);
        const receiptKey = `receipt:battle:${battleId}`;
        const firstReceipt = clone(store.get(receiptKey)) as { endedAt?: number };
        assert.equal(firstReceipt.endedAt, terminal.endedAt);

        store.delete(receiptKey);
        const replay = await postMove('alice', body);
        assert.equal(replay.statusCode, 200);
        const repaired = clone(store.get(receiptKey)) as { endedAt?: number };
        assert.equal(repaired.endedAt, terminal.endedAt,
            'replay must use the immutable terminal timestamp, not fresh wall time');
    } finally {
        process.env.DISABLE_COMBAT_RECEIPTS = previous ?? '1';
    }
});

test('a final move paused past its lease cannot overwrite an advanced session', async () => {
    const originalRandomInt = crypto.randomInt;
    crypto.randomInt = (() => 0) as typeof crypto.randomInt;
    syncBuiltinESMExports();
    try {
        const initial = session('lease-expired-terminal', { stateRevision: 4 });
        const successor = session('lease-expired-terminal', {
            stateRevision: 5,
            round: 7,
            activePlayer: 'p2',
            log: ['A successor committed after the old lease expired.'],
        });
        seed(initial);
        let raced = false;
        beforeCompareSet = (key, expected, candidate) => {
            if (key !== 'pvp:lease-expired-terminal' || raced) return;
            raced = true;
            assert.equal((expected as PvpSession).stateRevision, 4);
            assert.equal((candidate as PvpSession).status, 'done', 'the paused request had derived a terminal candidate');
            assert.equal((candidate as PvpSession).stateRevision, 5, 'only the exact-CAS candidate may mint the successor revision');
            store.set(key, clone(successor));
        };

        const out = await postMove('alice', {
            battleId: 'lease-expired-terminal',
            role: 'p1',
            action: 'flee',
            moveToken: 'lease-expired-terminal-token',
        });

        assert.equal(out.statusCode, 200);
        assert.equal(raced, true);
        assert.deepEqual(storedSession('lease-expired-terminal'), successor);
        assert.match(String((out.body as PvpSession).rejected?.reason), /battle advanced/i);
        assert.equal([...store.keys()].some((key) => key.includes('vanguard-rewarded:lease-expired-terminal')), false,
            'a losing terminal candidate must not run reward effects');
    } finally {
        crypto.randomInt = originalRandomInt;
        syncBuiltinESMExports();
    }
});

test('a ranked close fence that wins before the final CAS is never overwritten', async () => {
    const originalRandomInt = crypto.randomInt;
    crypto.randomInt = (() => 0) as typeof crypto.randomInt;
    syncBuiltinESMExports();
    try {
        const initial = session('ranked-close-terminal', {
            stateRevision: 8,
            ranked: false,
            rankedKind: 'player',
            playerRankedAuthorityVersion: 2,
            rankedMatchId: 'player-ranked-close-handler',
            rankedSeasonId: 3,
            rankedSeasonEpoch: 9,
            rewardAuthority: 'ranked',
            baseRewards: false,
        });
        const fenced = session('ranked-close-terminal', {
            ...initial,
            stateRevision: 9,
            rankedCloseFence: {
                version: 'player-ranked-session-close-fence-v1',
                matchId: 'player-ranked-close-handler',
                seasonId: 3,
                seasonEpoch: 9,
                transitionId: 'ranked-season-3-4',
                fencedAt: Date.now(),
            },
        });
        seed(initial);
        beforeCompareSet = (key) => {
            if (key !== 'pvp:ranked-close-terminal') return;
            store.set(key, clone(fenced));
            beforeCompareSet = null;
        };

        const out = await postMove('alice', {
            battleId: 'ranked-close-terminal',
            role: 'p1',
            action: 'flee',
            moveToken: 'ranked-close-terminal-token',
        });

        assert.equal(out.statusCode, 409);
        assert.deepEqual(storedSession('ranked-close-terminal'), fenced);
        assert.match(String((out.body as { error?: string }).error), /no-contest/i);
    } finally {
        crypto.randomInt = originalRandomInt;
        syncBuiltinESMExports();
    }
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
            assert.equal(final.vfx?.[0]?.target, 'p2');
            assert.equal(final.vfx?.[0]?.key, 'impact');
            assert.equal(final.vfx?.[0]?.anchor, 'target');
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
            assert.equal(final.vfx?.[0]?.target, 'p1');
            assert.equal(final.vfx?.[0]?.key, 'heal');
            assert.equal(final.vfx?.[0]?.anchor, 'caster');
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
