import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';
import { JUTSU_CATALOG } from '../pvp/_jutsu-catalog.js';
import { LEGACY_JUTSU_CATALOG } from '../pvp/_legacy-jutsu-catalog.js';
import type { CombatJutsu } from './types.js';
import type { PvpFighter, PvpSession } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';
process.env.SESSION_SECRET = 'pvp-solo-parity-test-secret-32-bytes';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

const store = new Map<string, unknown>();
const clone = <T>(value: T): T => structuredClone(value);

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
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
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
                removed += 1;
            }
        }
        store.set(key, current);
        return removed;
    };

    moveHandler = (await import('../pvp/move.js')).default as unknown as Handler;
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

function fighter(name: string, pos: number, jutsu: CombatJutsu): PvpFighter {
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
            level: 100,
            specialty: 'Ninjutsu',
            stats,
            jutsu: [clone(jutsu)],
            jutsuMastery: [{ jutsuId: jutsu.id, level: 50 }],
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
        status: 'active',
        winner: null,
        createdAt: 1_700_000_000_000,
        lastMoveAt: 1_700_000_000_000,
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
    };
}

async function runParityCase(jutsu: CombatJutsu, index: number) {
    const id = `parity-${index}`;
    const pvpBefore = pvpSession(id, jutsu);
    store.set(`pvp:${id}`, clone(pvpBefore));
    const { res, out } = fakeRes();
    await moveHandler(fakeReq(pvpBefore.p1.name, {
        battleId: id,
        role: 'p1',
        action: 'jutsu',
        jutsuId: jutsu.id,
        ...(jutsu.target === 'EMPTY_GROUND' || jutsu.tags?.some((tag) => tag.name === 'Move') ? { tile: 64 } : {}),
        moveToken: `token-${index}`,
    }), res);
    assert.equal(out.statusCode, 200);
    const pvpAfter = clone((store.get(`pvp:${id}`) ?? out.body) as PvpSession);
    const pvpApplied = !(out.body as PvpSession).rejected;

    const soloBefore = soloSession(id, jutsu);
    const soloResult = applySoloPveAction(soloBefore, {
        type: 'jutsu',
        jutsuId: jutsu.id,
        ...(jutsu.target === 'EMPTY_GROUND' || jutsu.tags?.some((tag) => tag.name === 'Move') ? { tile: 64 } : {}),
    });
    return {
        pvp: normalizePvp(pvpBefore, pvpAfter, pvpApplied),
        solo: normalizeSolo(soloBefore, soloResult.session, soloResult.applied),
    };
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
            assert.deepEqual(result.solo, result.pvp, `${jutsu.id} (${jutsu.name}) diverged`);
        }
    });
});
