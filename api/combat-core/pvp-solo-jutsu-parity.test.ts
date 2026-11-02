import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { before, beforeEach, describe, test } from 'node:test';
import { JUTSU_CATALOG } from '../pvp/_jutsu-catalog.js';
import { LEGACY_JUTSU_CATALOG } from '../pvp/_legacy-jutsu-catalog.js';
import type { CombatJutsu } from './types.js';
import type { PvpFighter, PvpGroundEffect, PvpSession } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import { filledDiskTiles } from './aoe.js';
import { groundFieldOpeningHit } from './resolve-jutsu-action.js';
import { GRID_H, GRID_W } from './constants.js';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';
// A newer path in the move handler validates the role key by its canonical name
// before the stubbed kv below is reached, so the handler 500s on every action
// without this. The value is never used — every read and write is intercepted.
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'x';
process.env.SESSION_SECRET = 'pvp-solo-parity-test-secret-32-bytes';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

const store = new Map<string, unknown>();
const clone = <T>(value: T): T => structuredClone(value);

type Handler = (req: never, res: never) => Promise<unknown>;
let moveHandler: Handler;
let applyGroundEffectToFighter: typeof import('../pvp/move.js').applyGroundEffectToFighter;
let applyJutsu: typeof import('../pvp/move.js').applyJutsu;
let reconcileGroundStatuses: typeof import('../pvp/move.js').reconcileGroundStatuses;
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
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
    // Session persistence moved from kv.set to a compare-and-set. This stub was
    // never extended, so every parity action fell through to the real Supabase
    // client and the handler 500d on a failed fetch. Deep equality is required:
    // kv.get hands back a clone, so the caller's `expected` is never the same
    // reference as the stored row.
    kv.compareSet = async (key: string, expected: unknown, next: unknown, options?: { ex?: number }) => {
        void options;
        const current = store.has(key) ? store.get(key) : null;
        if (!isDeepStrictEqual(current ?? null, expected ?? null)) return false;
        store.set(key, clone(next));
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
                removed += 1;
            }
        }
        store.set(key, current);
        return removed;
    };

    const move = await import('../pvp/move.js');
    moveHandler = move.default as unknown as Handler;
    ({ applyGroundEffectToFighter, applyJutsu, reconcileGroundStatuses } = move);
    issuePlayerToken = (await import('../_auth.js')).issuePlayerToken;
});

beforeEach(() => store.clear());

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

function fighter(name: string, pos: number, jutsu: CombatJutsu, masteryLevel = 50, level = 100): PvpFighter {
    return {
        name,
        hp: 1_000_000,
        maxHp: 1_000_000,
        chakra: 10_000,
        maxChakra: 10_000,
        stamina: 10_000,
        maxStamina: 10_000,
        shield: 0,
        statuses: [],
        pos,
        character: {
            name,
            level,
            specialty: 'Ninjutsu',
            stats,
            jutsu: [clone(jutsu)],
            jutsuMastery: [{ jutsuId: jutsu.id, level: masteryLevel }],
            pvpItems: [],
            equipment: {},
        },
    };
}

function pvpSession(id: string, jutsu: CombatJutsu): PvpSession {
    return {
        battleId: id,
        p1: fighter(`caster${id}`, 52, jutsu),
        p2: fighter(`target${id}`, 53, jutsu),
        round: 1,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        groundEffects: [],
        log: ['Battle begins.'],
        // The move handler refuses to advance combat until both fighters have
        // joined. Without this every parity case was rejected before the jutsu
        // ran, so all six cases compared "PvP did nothing" against a Solo engine
        // that has no join handshake — which reads as 217 diverging jutsu but is
        // really one missing membership flag.
        joined: { p1: true, p2: true },
        status: 'active',
        winner: null,
        // A LIVE duel. A frozen 2023 clock reads as a lapsed duel (F08,
        // api/pvp/_lapse-rules.ts) and would be terminalized as a draw before
        // the move under test is ever judged.
        createdAt: Date.now() - 5_000,
        lastMoveAt: Date.now() - 1_000,
        biome: 'central',
        weatherPositiveElement: '',
        weatherNegativeElement: '',
    };
}

function soloSession(id: string, jutsu: CombatJutsu): SoloPveSession {
    return createSoloPveSession({
        sessionId: id,
        ownerSlug: `caster${id}`,
        encounter: { kind: 'parity-neutral', id },
        player: fighter(`caster${id}`, 52, jutsu),
        enemy: fighter(`target${id}`, 53, jutsu),
        now: 1_700_000_000_000,
        environment: { biome: 'central', blockedTiles: [] },
    });
}

function fakeReq(playerName: string, body: Record<string, unknown>) {
    const token = issuePlayerToken(playerName);
    assert.ok(token);
    return {
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'x-player-name': playerName,
            'x-player-token': token,
            'x-forwarded-for': '10.0.0.2',
        },
        socket: { remoteAddress: '10.0.0.2' },
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

function normalizedStatuses(statuses: PvpFighter['statuses']) {
    return statuses
        .map(({ name, kind, rounds, activeRound, percent, amount, discipline }) => ({
            name, kind, rounds,
            ...(activeRound === undefined ? {} : { activeRound }),
            ...(percent === undefined ? {} : { percent }),
            ...(amount === undefined ? {} : { amount }),
            ...(discipline === undefined ? {} : { discipline }),
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function normalizedZones(zones: PvpSession['groundEffects']) {
    return (zones ?? []).map((zone) => ({
        owner: zone.owner === 'p1' ? 'caster' : 'target',
        name: zone.name,
        tiles: [...zone.tiles].sort((a, b) => a - b),
        rounds: zone.rounds,
        castPulseConsumed: zone.castPulseConsumed === true,
        tags: zone.tags.map((tag) => ({ ...tag })).sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function normalizedVfx(value: unknown, runtime: 'pvp' | 'solo') {
    const entries = Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
    return entries.map((entry) => ({
        key: String(entry.key ?? ''),
        anchor: entry.anchor,
        tiles: Array.isArray(entry.tiles) ? [...entry.tiles].sort((a, b) => Number(a) - Number(b)) : [],
        persistent: entry.persistent === true,
    }));
}

type NormalizedCast = ReturnType<typeof normalizePvp>;

function normalizePvp(before: PvpSession, after: PvpSession, applied: boolean) {
    return {
        applied,
        rejection: applied ? null : 'rejected',
        apSpent: before.ap.p1 - after.ap.p1,
        actionsAdded: after.actionsThisTurn - before.actionsThisTurn,
        chakraSpent: before.p1.chakra - after.p1.chakra,
        staminaSpent: before.p1.stamina - after.p1.stamina,
        caster: {
            hp: after.p1.hp, shield: after.p1.shield, pos: after.p1.pos,
            statuses: normalizedStatuses(after.p1.statuses),
        },
        target: {
            hp: after.p2.hp, shield: after.p2.shield, pos: after.p2.pos,
            statuses: normalizedStatuses(after.p2.statuses),
        },
        cooldown: after.cooldowns.p1,
        zones: normalizedZones(after.groundEffects),
        status: after.status,
        winner: after.winner === 'p1' ? 'caster' : after.winner === 'p2' ? 'target' : after.winner,
        damageToHp: before.p2.hp - after.p2.hp,
        damageToShield: Math.max(0, before.p2.shield - after.p2.shield),
        healing: Math.max(0, after.p1.hp - before.p1.hp),
        shielding: Math.max(0, after.p1.shield - before.p1.shield),
        vfx: normalizedVfx(after.vfx, 'pvp'),
        targetFxDamage: (after.fx ?? []).filter((event) => event.target === 'p2' && event.kind === 'damage')
            .reduce((sum, event) => sum + event.amount, 0),
    };
}

function normalizeSolo(before: SoloPveSession, after: SoloPveSession, applied: boolean): NormalizedCast {
    const event = after.events.at(-1);
    return {
        applied,
        rejection: applied ? null : 'rejected',
        apSpent: before.ap.player - after.ap.player,
        actionsAdded: after.actionsThisTurn - before.actionsThisTurn,
        chakraSpent: before.player.chakra - after.player.chakra,
        staminaSpent: before.player.stamina - after.player.stamina,
        caster: {
            hp: after.player.hp, shield: after.player.shield, pos: after.player.pos,
            statuses: normalizedStatuses(after.player.statuses),
        },
        target: {
            hp: after.enemy.hp, shield: after.enemy.shield, pos: after.enemy.pos,
            statuses: normalizedStatuses(after.enemy.statuses),
        },
        cooldown: after.cooldowns.player,
        zones: normalizedZones(after.groundEffects),
        status: after.status,
        winner: after.winner === 'player' ? 'caster' : after.winner === 'enemy' ? 'target' : after.winner,
        damageToHp: before.enemy.hp - after.enemy.hp,
        damageToShield: Math.max(0, before.enemy.shield - after.enemy.shield),
        healing: Math.max(0, after.player.hp - before.player.hp),
        shielding: Math.max(0, after.player.shield - before.player.shield),
        vfx: normalizedVfx(event?.vfx, 'solo'),
        targetFxDamage: (after.fx ?? []).filter((entry) => entry.target === 'enemy' && entry.kind === 'damage')
            .reduce((sum, entry) => sum + entry.amount, 0),
    };
}

type ParitySetup = {
    casterPos?: number;
    targetPos?: number;
    ap?: number;
    actionsThisTurn?: number;
    chakra?: number;
    stamina?: number;
    casterHp?: number;
    targetHp?: number;
    targetShield?: number;
    casterStatuses?: PvpFighter['statuses'];
    targetStatuses?: PvpFighter['statuses'];
    cooldown?: number;
    round?: number;
    tile?: number;
    masteryLevel?: number;
    level?: number;
    roundOpener?: 'p1' | 'p2';
};

function applySetupToPvp(session: PvpSession, jutsu: CombatJutsu, setup: ParitySetup) {
    session.roundOpener = setup.roundOpener ?? session.roundOpener;
    session.p1.pos = setup.casterPos ?? session.p1.pos;
    session.p2.pos = setup.targetPos ?? session.p2.pos;
    session.ap.p1 = setup.ap ?? session.ap.p1;
    session.actionsThisTurn = setup.actionsThisTurn ?? session.actionsThisTurn;
    session.p1.chakra = setup.chakra ?? session.p1.chakra;
    session.p1.stamina = setup.stamina ?? session.p1.stamina;
    session.p1.hp = setup.casterHp ?? session.p1.hp;
    session.p2.hp = setup.targetHp ?? session.p2.hp;
    session.p2.shield = setup.targetShield ?? session.p2.shield;
    session.p1.statuses = clone(setup.casterStatuses ?? session.p1.statuses);
    session.p2.statuses = clone(setup.targetStatuses ?? session.p2.statuses);
    session.round = setup.round ?? session.round;
    session.cooldowns.p1[jutsu.id] = setup.cooldown ?? 0;
    session.p1.character.level = setup.level ?? session.p1.character.level;
    session.p1.character.jutsuMastery = [{ jutsuId: jutsu.id, level: setup.masteryLevel ?? 50 }];
}

function applySetupToSolo(session: SoloPveSession, jutsu: CombatJutsu, setup: ParitySetup) {
    session.player.pos = setup.casterPos ?? session.player.pos;
    session.enemy.pos = setup.targetPos ?? session.enemy.pos;
    session.ap.player = setup.ap ?? session.ap.player;
    session.actionsThisTurn = setup.actionsThisTurn ?? session.actionsThisTurn;
    session.player.chakra = setup.chakra ?? session.player.chakra;
    session.player.stamina = setup.stamina ?? session.player.stamina;
    session.player.hp = setup.casterHp ?? session.player.hp;
    session.enemy.hp = setup.targetHp ?? session.enemy.hp;
    session.enemy.shield = setup.targetShield ?? session.enemy.shield;
    session.player.statuses = clone(setup.casterStatuses ?? session.player.statuses);
    session.enemy.statuses = clone(setup.targetStatuses ?? session.enemy.statuses);
    session.round = setup.round ?? session.round;
    session.cooldowns.player[jutsu.id] = setup.cooldown ?? 0;
    session.player.character.level = setup.level ?? session.player.character.level;
    session.player.character.jutsuMastery = [{ jutsuId: jutsu.id, level: setup.masteryLevel ?? 50 }];
}

async function runParityCase(jutsu: CombatJutsu, index: number, setup: ParitySetup = {}) {
    const id = `parity-${index}`;
    const pvpBefore = pvpSession(id, jutsu);
    applySetupToPvp(pvpBefore, jutsu, setup);
    store.set(`pvp:${id}`, clone(pvpBefore));
    const { res, out } = fakeRes();
    await moveHandler(fakeReq(pvpBefore.p1.name, {
        battleId: id,
        role: 'p1',
        action: 'jutsu',
        jutsuId: jutsu.id,
        ...(jutsu.target === 'EMPTY_GROUND' || jutsu.tags?.some((tag) => tag.name === 'Move') ? { tile: setup.tile ?? 64 } : {}),
        moveToken: `token-${index}`,
    }), res);
    assert.equal(out.statusCode, 200);
    const pvpAfter = clone((store.get(`pvp:${id}`) ?? out.body) as PvpSession);
    const pvpApplied = !(out.body as PvpSession).rejected;

    const soloBefore = soloSession(id, jutsu);
    applySetupToSolo(soloBefore, jutsu, setup);
    const soloResult = applySoloPveAction(soloBefore, {
        type: 'jutsu',
        jutsuId: jutsu.id,
        ...(jutsu.target === 'EMPTY_GROUND' || jutsu.tags?.some((tag) => tag.name === 'Move') ? { tile: setup.tile ?? 64 } : {}),
    });
    return {
        pvp: normalizePvp(pvpBefore, pvpAfter, pvpApplied),
        solo: normalizeSolo(soloBefore, soloResult.session, soloResult.applied),
        // Diagnostics only — deliberately outside the compared shapes. A bare
        // "diverged" across 217 cases says nothing about WHY one side refused,
        // and the refusal reason is usually the whole answer.
        pvpRejection: (out.body as PvpSession).rejected?.reason ?? null,
        soloRejection: soloResult.applied ? null : (soloResult.reason ?? 'unspecified'),
    };
}

function customJutsu(id: string, overrides: Partial<CombatJutsu>): CombatJutsu {
    const base = clone(Object.values(JUTSU_CATALOG)[0]);
    return {
        ...base,
        id,
        name: id,
        element: 'None',
        target: 'OPPONENT',
        method: 'SINGLE',
        ap: 40,
        range: 4,
        effectPower: 30,
        cooldown: 7,
        chakraCost: 25,
        staminaCost: 0,
        isUtility: false,
        tags: [],
        ...overrides,
    };
}

function parityStatus(name: string, kind: 'positive' | 'negative', percent = 20, rounds = 2, activeRound = 1): PvpFighter['statuses'][number] {
    return { name, kind, percent, rounds, activeRound };
}

function assertParity(result: { pvp: NormalizedCast; solo: NormalizedCast }, label: string) {
    assert.deepEqual(result.solo, result.pvp, label);
}

describe('authoritative PvP/Solo-PvE jutsu parity', () => {
    test('every executable built-in and legacy jutsu has a neutral behavioral parity case', async () => {
        const catalog = new Map<string, CombatJutsu>();
        for (const jutsu of [...Object.values(JUTSU_CATALOG), ...Object.values(LEGACY_JUTSU_CATALOG)]) {
            catalog.set(jutsu.id, jutsu);
        }
        assert.equal(catalog.size, 217, 'starting census; the live total remains derived from the catalogs');

        let index = 0;
        for (const jutsu of catalog.values()) {
            const result = await runParityCase(jutsu, index++);
            assert.deepEqual(result.solo, result.pvp,
                `${jutsu.id} (${jutsu.name}) diverged`
                + ` [pvp refused: ${result.pvpRejection ?? 'no'};`
                + ` solo refused: ${result.soloRejection ?? 'no'}]`);
        }
    });

    test('eligibility gates and adjusted AP stay identical', async () => {
        const cases: Array<[string, CombatJutsu, ParitySetup]> = [
            ['Lag then Overclock', customJutsu('target-ap-status', {}), {
                casterStatuses: [parityStatus('Lag', 'negative', 50), parityStatus('Overclock', 'positive', 20)],
            }],
            ['insufficient adjusted AP', customJutsu('target-no-ap', {}), { ap: 39 }],
            ['chakra gate', customJutsu('target-no-chakra', { chakraCost: 50 }), { chakra: 49 }],
            ['stamina gate', customJutsu('target-no-stamina', { type: 'Taijutsu', chakraCost: 0, staminaCost: 50 }), { stamina: 49 }],
            ['cooldown gate', customJutsu('target-cooldown', {}), { cooldown: 1 }],
            ['range gate', customJutsu('target-range', { range: 2 }), { casterPos: 0, targetPos: 119 }],
            ['elemental seal', customJutsu('target-seal', { element: 'Fire' }), { casterStatuses: [parityStatus('Elemental Seal', 'negative')] }],
            ['action cap', customJutsu('target-action-cap', {}), { actionsThisTurn: 5 }],
        ];
        let index = 1000;
        for (const [label, jutsu, setup] of cases) {
            const result = await runParityCase(jutsu, index++, setup);
            assertParity(result, label);
        }
        // Lag (+10) and Overclock (-10) are flat and cancel exactly, so a 40 AP
        // cast still costs 40 — the stored 50/20 percents are never read.
        const adjusted = await runParityCase(cases[0][1], index++, cases[0][2]);
        assert.equal(adjusted.pvp.apSpent, 40);
        assert.equal(adjusted.pvp.actionsAdded, 1);
    });

    test('circle, spiral, immediate ground application, displacement, and VFX stay identical', async () => {
        const circle = await runParityCase(customJutsu('target-circle', {
            target: 'EMPTY_GROUND', method: 'AOE_CIRCLE', effectPower: 45,
        }), 1100, { tile: 64 });
        assertParity(circle, 'circle footprint');
        assert.ok(circle.pvp.damageToHp > 0);
        assert.equal(circle.pvp.zones.length, 0);
        assert.ok(circle.pvp.vfx[0]?.tiles.length > 1);

        const ground = await runParityCase(customJutsu('target-ground', {
            target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT', effectPower: 0,
            tags: [{ name: 'Poison', percent: 12 }],
        }), 1101, { tile: 64 });
        assertParity(ground, 'ground zone');
        assert.equal(ground.pvp.zones.length, 1);
        assert.ok(ground.pvp.zones[0].tiles.length > 1);
        assert.ok(ground.pvp.target.statuses.some((status) => status.name === 'Poison'));
        assert.equal(ground.pvp.vfx[0]?.persistent, true);
        assert.equal(ground.pvp.vfx[0]?.tiles.length, ground.pvp.zones[0].tiles.length);

        const spiral = await runParityCase(customJutsu('target-spiral', {
            target: 'EMPTY_GROUND', method: 'AOE_SPIRAL', effectPower: 0,
            tags: [{ name: 'Move' }, { name: 'Poison', percent: 9 }],
        }), 1102, { tile: 64 });
        assertParity(spiral, 'spiral footprint');
        assert.ok(ground.pvp.zones[0].tiles.length > spiral.pvp.zones[0].tiles.length,
            'Instant Effect now fills the caster range; Spiral keeps its radius-two landing zone');

        for (const [index, name] of [[1103, 'Push'], [1104, 'Pull']] as const) {
            const displaced = await runParityCase(customJutsu(`target-${name.toLowerCase()}`, {
                effectPower: 0, tags: [{ name, percent: 0 }],
            }), index, { casterPos: 52, targetPos: 54 });
            assertParity(displaced, name);
            assert.notEqual(displaced.pvp.target.pos, 54, `${name} must move the target`);
        }
    });

    describe('damaging ground fields', () => {
        const recoil = [{ name: 'Recoil', percent: 30 }];
        const field = (id: string, overrides: Partial<CombatJutsu> = {}) => customJutsu(id, {
            target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT', ap: 60, effectPower: 40,
            chakraCost: 0, staminaCost: 77, tags: recoil, ...overrides,
        });
        const spiral = (id: string, overrides: Partial<CombatJutsu> = {}) => field(id, {
            method: 'AOE_SPIRAL', tags: [{ name: 'Move' }, ...recoil], ...overrides,
        });
        const fieldRecoil = (cast: NormalizedCast) => cast.target.statuses.filter((status) => status.name === 'Recoil');

        test('a 60 AP field hits an enemy inside once, charges once, and keeps its field Recoil', async () => {
            const result = await runParityCase(field('field-inside'), 1500, { tile: 64 });
            assertParity(result, 'field inside');
            assert.ok(result.pvp.damageToHp > 0, 'the opening hit must land');
            assert.equal(result.pvp.apSpent, 60);
            assert.equal(result.pvp.actionsAdded, 1);
            assert.equal(result.pvp.staminaSpent, 77);
            assert.equal(result.pvp.zones.length, 1);
            assert.equal(result.pvp.targetFxDamage, result.pvp.damageToHp, 'the floating number shows the hit');
            assert.deepEqual(fieldRecoil(result.pvp).map((status) => status.rounds), [1],
                'only the field pulse carries Recoil, never a second direct status');
            assert.equal(result.pvp.zones[0].castPulseConsumed, true);
        });

        test('the spiral shows its floating number and the solo event records the hit', async () => {
            const result = await runParityCase(spiral('spiral-fx', { range: 10 }), 1514, {
                casterPos: 0, targetPos: 53, tile: 52,
            });
            assert.equal(result.pvp.targetFxDamage, result.pvp.damageToHp);
            const jutsu = field('field-resolution');
            const solo = applySoloPveAction(soloSession('field-resolution', jutsu), {
                type: 'jutsu', jutsuId: jutsu.id, tile: 64,
            }) as { resolution?: { resolvedDamage?: number } };
            assert.ok((solo.resolution?.resolvedDamage ?? 0) > 0, 'solo keeps the hit in its resolution facts');
        });

        test('a reaction on the opening hit reaches the caster', async () => {
            const reflect = [parityStatus('Reflect', 'positive', 30, 3)];
            for (const [index, cast] of [
                [1515, field('field-reflect')],
                [1516, spiral('spiral-reflect', { range: 10 })],
            ] as const) {
                const setup = index === 1515
                    ? { tile: 64, targetStatuses: reflect }
                    : { casterPos: 0, targetPos: 53, tile: 52, targetStatuses: reflect };
                const result = await runParityCase(cast, index, setup);
                assert.ok(result.pvp.caster.hp < 1_000_000, 'PvP keeps the caster state the resolver returned');
                assert.equal(result.pvp.caster.hp, result.solo.caster.hp);
            }
        });

        test('the opening hit is the same damage as a direct cast of that jutsu', async () => {
            const hit = await runParityCase(field('field-formula'), 1501, { tile: 64 });
            const direct = await runParityCase(customJutsu('direct-formula', {
                ap: 60, effectPower: 40, chakraCost: 0, staminaCost: 77,
            }), 1502);
            assert.equal(hit.pvp.damageToHp, direct.pvp.damageToHp);
            assert.notEqual(hit.pvp.damageToHp, 40, 'Effect Power must not be treated as flat HP');
        });

        test('an enemy outside the footprint takes nothing and the field still lands', async () => {
            const result = await runParityCase(field('field-outside', { range: 1 }), 1503, {
                casterPos: 52, targetPos: 56, tile: 53,
            });
            assertParity(result, 'field outside');
            assert.equal(result.pvp.damageToHp, 0);
            assert.equal(result.pvp.apSpent, 60);
            assert.equal(result.pvp.zones.length, 1);
            assert.deepEqual(fieldRecoil(result.pvp), []);
        });

        test('a 40 AP utility field stays status-only, with or without stored power', async () => {
            for (const [index, overrides] of [
                [1504, { ap: 40, effectPower: 0, isUtility: true }],
                [1505, { ap: 40, effectPower: 40, isUtility: undefined }],
                [1506, { ap: 60, effectPower: 40, isUtility: true }],
                [1507, { ap: 60, effectPower: 0, isUtility: false }],
            ] as Array<[number, Partial<CombatJutsu>]>) {
                const result = await runParityCase(field(`field-utility-${index}`, overrides), index, { tile: 64 });
                assertParity(result, `utility ${index}`);
                assert.equal(result.pvp.damageToHp, 0, `case ${index}`);
                assert.equal(fieldRecoil(result.pvp).length, 1, `case ${index}`);
            }
        });

        test('a spiral hits from its landing tile, not from where the dash began', async () => {
            const inside = await runParityCase(spiral('spiral-inside', { range: 10 }), 1508, {
                casterPos: 0, targetPos: 53, tile: 52,
            });
            assertParity(inside, 'spiral inside');
            assert.ok(inside.pvp.damageToHp > 0);
            assert.equal(inside.pvp.caster.pos, 52);
            assert.equal(inside.pvp.apSpent, 60);
            assert.equal(inside.pvp.zones[0].tiles.length, filledDiskTiles(52, 2, GRID_W, GRID_H).length);

            const outside = await runParityCase(spiral('spiral-outside', { range: 10 }), 1509, {
                casterPos: 0, targetPos: 60, tile: 52,
            });
            assertParity(outside, 'spiral outside');
            assert.equal(outside.pvp.damageToHp, 0);
            assert.equal(outside.pvp.zones.length, 1);
        });

        test('Debuff Prevent blocks the field statuses but not the opening hit', async () => {
            const result = await runParityCase(field('field-prevent'), 1510, {
                tile: 64, targetStatuses: [parityStatus('Debuff Prevent', 'positive', 0, 3)],
            });
            assertParity(result, 'field Debuff Prevent');
            assert.ok(result.pvp.damageToHp > 0);
            assert.deepEqual(fieldRecoil(result.pvp), []);
        });

        test('shields absorb the hit', async () => {
            const shielded = await runParityCase(field('field-shield'), 1511, { tile: 64, targetShield: 50 });
            // Numbers only: PvP's reaction plate on a shielded hit has no solo twin.
            assert.equal(shielded.pvp.damageToShield, 50);
            assert.equal(shielded.solo.damageToShield, 50);
            assert.equal(shielded.pvp.damageToHp, shielded.solo.damageToHp);
        });

        test('a solo knockout ends the fight without a stray pulse', () => {
            const jutsu = field('field-ko');
            const before = soloSession('field-ko', jutsu);
            before.enemy.hp = 1;
            const { applied, session } = applySoloPveAction(before, { type: 'jutsu', jutsuId: jutsu.id, tile: 64 });
            assert.equal(applied, true);
            assert.equal(session.status, 'done');
            assert.equal(session.winner, 'player');
            assert.deepEqual(session.enemy.statuses, []);
        });

        test('Push that carries the target out of the field skips the cast pulse', async () => {
            const result = await runParityCase(spiral('spiral-push', {
                range: 10, tags: [{ name: 'Move' }, { name: 'Push', percent: 0 }, ...recoil],
            }), 1513, { casterPos: 0, targetPos: 54, tile: 52 });
            assertParity(result, 'spiral Push');
            assert.ok(result.pvp.damageToHp > 0);
            assert.notEqual(result.pvp.target.pos, 54);
            assert.deepEqual(fieldRecoil(result.pvp), []);
            assert.equal(result.pvp.zones[0].castPulseConsumed, false,
                'a target pushed out took no pulse, so the field keeps its full duration');

            const ground = await runParityCase(field('field-push', {
                tags: [{ name: 'Push', percent: 0 }, ...recoil],
            }), 1518, { casterPos: 52, targetPos: 56, tile: 53 });
            assertParity(ground, 'field Push');
            assert.ok(ground.pvp.damageToHp > 0);
            assert.notEqual(ground.pvp.target.pos, 56);
            assert.deepEqual(fieldRecoil(ground.pvp), []);
            assert.equal(ground.pvp.zones[0].castPulseConsumed, false);
        });

        test('a round closer hits on cast, while its first pulse still waits for the handoff', async () => {
            const result = await runParityCase(field('field-closer'), 1519, { tile: 64, roundOpener: 'p2' });
            assert.ok(result.pvp.damageToHp > 0);
            assert.deepEqual(fieldRecoil(result.pvp), []);
            assert.equal(result.pvp.zones[0].castPulseConsumed, false);
        });

        test('a cast that kills its own caster through Poison lands no hit', () => {
            const jutsu = field('field-spend-ko');
            const before = soloSession('field-spend-ko', jutsu);
            before.player.hp = 1;
            before.player.statuses = [parityStatus('Poison', 'negative', 30, 3)];
            before.enemy.hp = 1;
            const { session } = applySoloPveAction(before, { type: 'jutsu', jutsuId: jutsu.id, tile: 64 });
            assert.equal(session.winner, 'enemy');
            assert.equal(session.enemy.hp, 1);
        });

        test('other tags on an authored instant field keep direct-cast timing, like a spiral', () => {
            const stun = [{ name: 'Stun', percent: 0 }, ...recoil];
            const castOn = (method: string) => {
                const hit = groundFieldOpeningHit(field('field-timing', { method, tags: stun }));
                assert.ok(hit);
                const self = fighter('caster', 52, hit);
                return applyJutsu(self, fighter('target', 53, hit), hit, 1, 'central', 3).opponent.statuses;
            };
            const instant = castOn('INSTANT_EFFECT').find((status) => status.name === 'Stun');
            const spiralCast = castOn('AOE_SPIRAL').find((status) => status.name === 'Stun');
            assert.equal(instant?.activeRound, 4);
            assert.deepEqual(instant, spiralCast);
        });

        test('a utility field fires none of its other tags, because it has no opening hit', async () => {
            const result = await runParityCase(field('field-utility-shield', {
                ap: 40, effectPower: 40, isUtility: true, tags: [...recoil, { name: 'Shield', percent: 0 }],
            }), 1517, { tile: 64 });
            assertParity(result, 'utility Shield');
            assert.equal(result.pvp.caster.shield, 0);
        });

        test('a later pulse deals no damage, and Recoil stays separate self-damage until the target leaves', () => {
            const jutsu = field('field-later');
            const effect: PvpGroundEffect = {
                id: 'later', owner: 'p1', name: 'Later', tiles: [53], rounds: 2,
                tags: [{ name: 'Recoil', percent: 30 }],
            };
            const pulsed = applyGroundEffectToFighter(fighter('target', 53, jutsu), effect, 2);
            assert.equal(pulsed.fighter.hp, 1_000_000, 'a pulse refreshes statuses and never damages');
            const again = applyGroundEffectToFighter(pulsed.fighter, effect, 3);
            assert.equal(again.fighter.hp, 1_000_000);
            assert.equal(again.fighter.statuses.length, 1, 'a refresh does not stack');

            const attack = customJutsu('recoil-attack', { ap: 60, effectPower: 40 });
            const struck = applyJutsu(again.fighter, fighter('caster', 52, attack), attack, 1, 'central', 3);
            assert.ok(struck.self.hp < 1_000_000, 'attacking from inside the field costs the attacker HP');

            const stepped = { ...again.fighter, pos: 60 };
            assert.deepEqual(reconcileGroundStatuses(stepped, [effect], 'p2').statuses, [],
                'leaving the field removes the field status');
        });
    });

    test('resource spending, poison-on-spend, status timing, and cooldown ordering stay identical', async () => {
        const result = await runParityCase(customJutsu('target-ordering', {
            chakraCost: 50,
            cooldown: 10,
            tags: [{ name: 'Lag', percent: 25 }, { name: 'Heal', percent: 20 }],
        }), 1200, {
            casterHp: 999_950,
            casterStatuses: [parityStatus('Poison', 'negative', 10, 3)],
        });
        assertParity(result, 'resource/status ordering');
        assert.equal(result.pvp.chakraSpent, 50);
        assert.ok(result.pvp.caster.hp < 999_950, 'poison must react after the same-cast heal reaches its cap');
        assert.equal(result.pvp.cooldown['target-ordering'], 10);
        const lag = result.pvp.target.statuses.find((status) => status.name === 'Lag');
        assert.deepEqual(lag && { rounds: lag.rounds, activeRound: lag.activeRound, percent: lag.percent }, {
            rounds: 1, activeRound: 2, percent: 25,
        });
    });

    test('mastery and level boundaries remain differential-parity pinned', async () => {
        const jutsu = customJutsu('target-mastery', { effectPower: 60, chakraCost: 25 });
        let index = 1300;
        for (const masteryLevel of [0, 1, 49, 50]) {
            for (const level of [1, 50, 100]) {
                const result = await runParityCase(jutsu, index++, { masteryLevel, level });
                assertParity(result, `mastery ${masteryLevel}, level ${level}`);
            }
        }
    });

    test('the normalized contract rejects mutations to every fragile compared field', async () => {
        const baseline = (await runParityCase(customJutsu('target-mutation-sentinel', {
            target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT', effectPower: 0,
            cooldown: 10, tags: [{ name: 'Poison', percent: 12 }],
        }), 1400, { tile: 64 })).pvp;
        const mutations: Array<[string, (value: NormalizedCast) => void]> = [
            ['AP', (value) => { value.apSpent += 1; }],
            ['resource', (value) => { value.chakraSpent += 1; }],
            ['cooldown', (value) => { value.cooldown['target-mutation-sentinel'] = 9; }],
            ['footprint', (value) => { value.zones[0].tiles.pop(); }],
            ['immediate status', (value) => { value.target.statuses.pop(); }],
            ['status duration', (value) => { value.target.statuses[0].rounds += 1; }],
            ['VFX', (value) => { value.vfx[0].persistent = false; }],
        ];
        for (const [label, mutate] of mutations) {
            const changed = clone(baseline);
            mutate(changed);
            assert.throws(() => assert.deepEqual(changed, baseline), `${label} mutation must be detected`);
        }
    });
});
