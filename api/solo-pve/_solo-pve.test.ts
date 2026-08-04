import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { PvpFighter } from '../pvp/session.js';
import { hydrateCharacterFromSave } from '../pvp/session.js';
import type { AdminCombatContent } from '../_admin-content.js';
import { buildSoloPveAiEncounter } from './_ai-encounter.js';
import { applySoloPveAction } from './_engine.js';
import { executeSoloPveAction, type SoloPveLock } from './_action-service.js';
import {
    createSoloPveSession,
    SOLO_PVE_RUNTIME,
    type SoloPveSession,
} from './_session.js';
import {
    readSoloPveSession,
    soloPveSessionKey,
    writeSoloPveSession,
    type SoloPveKv,
} from './_store.js';

const NOW = 1_800_000_000_000;

function makeFighter(name: string, pos: number, over: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name,
        hp: 1_000,
        maxHp: 1_000,
        chakra: 500,
        maxChakra: 500,
        stamina: 500,
        maxStamina: 500,
        shield: 0,
        statuses: [],
        pos,
        character: {
            level: 100,
            specialty: 'Taijutsu',
            stats: { taijutsuOffense: 1_200, taijutsuDefense: 600 },
            jutsu: [],
            pvpItems: [],
            equipment: {},
        },
        ...over,
    };
}

function makeSession(over: Partial<SoloPveSession> = {}): SoloPveSession {
    return {
        ...createSoloPveSession({
            sessionId: 'solo-test',
            ownerSlug: 'alice',
            encounter: { kind: 'generic-ai', id: 'academy-rival', level: 20 },
            player: makeFighter('Alice', 62),
            enemy: makeFighter('Rival', 63, {
                character: { level: 20, specialty: 'Taijutsu', stats: { taijutsuOffense: 600, taijutsuDefense: 400 }, jutsu: [], pvpItems: [], equipment: {} },
            }),
            now: NOW,
            difficultyEnemyLevel: 20,
        }),
        ...over,
    };
}

function fakeKv(): SoloPveKv & { data: Map<string, unknown> } {
    const data = new Map<string, unknown>();
    return {
        data,
        async get<T>(key: string) { return (data.get(key) ?? null) as T | null; },
        async set(key: string, value: unknown) { data.set(key, structuredClone(value)); return 'OK'; },
    };
}

describe('solo-PvE session and store boundaries', () => {
    it('mints an explicit runtime with independent state and version metadata', () => {
        const session = makeSession();
        assert.equal(session.runtime, SOLO_PVE_RUNTIME);
        assert.equal(session.schemaVersion, 1);
        assert.equal(session.version, 1);
        assert.equal(session.activeSide, 'player');
        assert.equal(session.settlementState, 'pending');
        assert.deepEqual(session.recentMoveTokens, []);
        assert.deepEqual(session.events, []);
        assert.equal(session.eventSeq, 0);
    });

    it('uses a solo-only keyspace and rejects non-solo records', async () => {
        const kv = fakeKv();
        const session = makeSession();
        await writeSoloPveSession(session, { kv });
        assert.ok(kv.data.has('solo-pve:solo-test'));
        assert.equal(soloPveSessionKey('abc'), 'solo-pve:abc');
        assert.deepEqual(await readSoloPveSession('solo-test', { kv }), session);

        kv.data.set('solo-pve:tower-shaped', { runId: 'tower-shaped', status: 'active' });
        assert.equal(await readSoloPveSession('tower-shaped', { kv }), null);
        await assert.rejects(() => writeSoloPveSession({ runtime: 'tower' } as never, { kv }), /non-solo-pve/);
    });

    it('does not couple the foundation to Tower modules', async () => {
        for (const file of ['_session.ts', '_store.ts', '_engine.ts', '_action-service.ts', '_ai-encounter.ts', 'action.ts', 'state.ts']) {
            const source = await readFile(resolve(process.cwd(), 'api', 'solo-pve', file), 'utf8');
            assert.doesNotMatch(source, /(?:from|import\()\s*['"]\.\.\/towers\//, `${file} imports Tower`);
        }
    });
});

describe('generic AI solo-PvE encounter seal', () => {
    it('hydrates the exact canonical player fighter and seals the enemy without Tower fields', () => {
        const playerJutsu = { id: 'authored-player-hit', name: 'Player Hit', type: 'Taijutsu', ap: 40, effectPower: 25, isUtility: false };
        const enemyJutsu = { id: 'authored-enemy-hit', name: 'Enemy Hit', type: 'Ninjutsu', ap: 40, range: 3, effectPower: 22, isUtility: false };
        const item = { id: 'test-kunai', name: 'Test Kunai', slot: 'thrown', weaponEp: 15 };
        const admin = {
            jutsu: new Map([[playerJutsu.id, playerJutsu], [enemyJutsu.id, enemyJutsu]]),
            items: new Map([[item.id, item]]),
        } as unknown as AdminCombatContent;
        const saveCharacter = {
            name: 'Alice', level: 30, specialty: 'Taijutsu',
            hp: 777, maxHp: 1_000, chakra: 250, maxChakra: 500, stamina: 240, maxStamina: 500,
            stats: { taijutsuOffense: 500, taijutsuDefense: 400 },
            equippedJutsuIds: [playerJutsu.id],
            equipment: { thrown: item.id },
            inventory: [item.id, item.id],
        };
        const save = { character: saveCharacter, creatorJutsus: [], creatorItems: [], savedBloodlines: [] };
        const profile = {
            id: 'catalog-rival', name: 'Catalog Rival', level: 20, hp: 2_000, chakra: 500, stamina: 500,
            armorRawDR: 0.1,
            stats: { ninjutsuOffense: 600, ninjutsuDefense: 500, willpower: 300, speed: 250 },
            jutsuIds: [enemyJutsu.id],
        };
        const session = buildSoloPveAiEncounter({
            sessionId: 'ai-solo-1', playerName: 'alice', save, profile, now: NOW, admin,
            env: { ...process.env, DISABLE_PVE_DIFFICULTY_GUARD_AI_FIGHT: '1' },
        });
        const expected = hydrateCharacterFromSave(saveCharacter, {}, save, admin);
        assert.deepEqual(session.player.character, expected);
        assert.equal(session.player.hp, 777, 'normal Arena current HP is preserved');
        assert.equal(session.itemCharges[item.id], 2);
        assert.equal((session.enemy.character.jutsu as Array<{ id: string; isUtility?: boolean }>)[0]?.id, enemyJutsu.id);
        assert.equal((session.enemy.character.jutsu as Array<{ id: string; isUtility?: boolean }>)[0]?.isUtility, false);
        assert.equal(session.runtime, 'solo-pve');
        assert.equal('towerId' in session, false);
        assert.equal('floor' in session, false);
        assert.equal('actors' in session, false);
    });

    it('ignores a forged host loadout byte-for-byte', () => {
        const saveCharacter = {
            name: 'Alice', level: 12, specialty: 'Ninjutsu', hp: 300, maxHp: 500,
            chakra: 200, maxChakra: 250, stamina: 180, maxStamina: 250,
            stats: { ninjutsuOffense: 160, ninjutsuDefense: 140 },
            equippedJutsuIds: [], equipment: {}, inventory: [],
        };
        const save = { character: saveCharacter, creatorJutsus: [], creatorItems: [], savedBloodlines: [] };
        const profile = { id: 'sealed-rival', name: 'Rival', level: 5, hp: 500, chakra: 300, stamina: 300, stats: {}, jutsuIds: [] };
        const common = { playerName: 'alice', save, profile, now: NOW, admin: null, env: { ...process.env, DISABLE_PVE_DIFFICULTY_GUARD_AI_FIGHT: '1' } };
        const honest = buildSoloPveAiEncounter({ ...common, sessionId: 'honest', hostLoadout: {} });
        const forged = buildSoloPveAiEncounter({
            ...common,
            sessionId: 'forged',
            hostLoadout: {
                level: 100, hp: 9_999_999, maxHp: 9_999_999,
                stats: { ninjutsuOffense: 9_999_999 },
                jutsu: [{ id: 'forged-nuke', effectPower: 9_999_999 }],
                pvpItems: [{ id: 'forged-potion', restoreChakra: 9_999_999 }],
                equipment: { potion: 'forged-potion' },
                damageMultiplier: 999,
            },
        });
        assert.deepEqual(forged.player, honest.player);
        assert.deepEqual(forged.itemCharges, honest.itemCharges);
    });
});

describe('solo-PvE engine', () => {
    it('resolves only a server-sealed jutsu through the shared resolver', () => {
        const session = makeSession();
        session.player.character.jutsu = [{
            id: 'sealed-strike', name: 'Sealed Strike', type: 'Taijutsu', effectPower: 35,
            ap: 40, range: 1, chakraCost: 10, staminaCost: 0, cooldown: 2, tags: [], isUtility: false,
        }];
        const resolved = applySoloPveAction(session, { type: 'jutsu', jutsuId: 'sealed-strike' });
        assert.equal(resolved.applied, true);
        assert.ok(resolved.session.enemy.hp < session.enemy.hp);
        assert.equal(resolved.session.player.chakra, session.player.chakra - 10);
        assert.equal(resolved.session.cooldowns.player['sealed-strike'], 2);

        const forged = applySoloPveAction(session, { type: 'jutsu', jutsuId: 'client-invented-nuke' });
        assert.equal(forged.applied, false);
        assert.equal(forged.reason, 'no-jutsu');
        assert.deepEqual(forged.session, session);
    });

    it('validates movement against the sealed board and occupied tile', () => {
        const session = makeSession();
        const occupied = applySoloPveAction(session, { type: 'move', tile: session.enemy.pos });
        assert.equal(occupied.applied, false);
        assert.equal(occupied.reason, 'occupied');

        const adjacent = 50;
        assert.equal(applySoloPveAction(session, { type: 'move', tile: adjacent }).applied, true);
        assert.equal(applySoloPveAction(session, { type: 'move', tile: 0 }).reason, 'invalid-move');
    });

    it('runs the enemy turn on the server and returns control to the player', () => {
        const session = makeSession();
        const resolved = applySoloPveAction(session, { type: 'wait' });
        assert.equal(resolved.applied, true);
        assert.equal(resolved.session.activeSide, 'player');
        assert.equal(resolved.session.round, 2);
        assert.ok(resolved.session.player.hp < session.player.hp, 'enemy acted');
        assert.ok((resolved.session.difficultyGuard?.dealtThisTurn ?? 0) <= 450, 'server meters the sealed enemy-turn budget');
    });

    it('enforces the sealed per-turn PvE damage guard', () => {
        const session = makeSession({
            difficultyGuard: { enemyLevel: 1, playerHpTurnStart: 1_000, dealtThisTurn: 0 },
            enemy: makeFighter('Overtuned Enemy', 63, {
                character: { level: 100, specialty: 'Taijutsu', stats: { taijutsuOffense: 2_500, taijutsuDefense: 2_500 }, jutsu: [], pvpItems: [], equipment: {} },
            }),
        });
        const resolved = applySoloPveAction(session, { type: 'wait' });
        assert.ok(resolved.session.player.hp >= 700, 'easy-band turn cap limits the whole chained AI turn');
    });

    it('spends a sealed consumable charge exactly once', () => {
        const player = makeFighter('Alice', 62, {
            hp: 500,
            character: {
                level: 100,
                specialty: 'Taijutsu',
                stats: { taijutsuOffense: 1_200, taijutsuDefense: 600 },
                jutsu: [],
                pvpItems: [{ id: 'potion-1', name: 'Potion', slot: 'potion', restoreChakra: 50 }],
                equipment: { potion: 'potion-1' },
            },
        });
        const session = createSoloPveSession({
            sessionId: 'items', ownerSlug: 'alice', encounter: { kind: 'test', id: 'items' },
            player, enemy: makeFighter('Rival', 63), now: NOW, itemCharges: { 'potion-1': 1 },
        });
        const first = applySoloPveAction(session, { type: 'item', itemId: 'potion-1' });
        assert.equal(first.applied, true);
        assert.equal(first.session.itemCharges['potion-1'], 0);
        assert.equal(first.session.itemsUsed['potion-1'], 1);
        const replay = applySoloPveAction(first.session, { type: 'item', itemId: 'potion-1' });
        assert.equal(replay.applied, false);
        assert.equal(replay.reason, 'out-of-item');
        assert.equal(replay.session.itemsUsed['potion-1'], 1);
    });

    it('resolves movement rings, ground zones, barriers, and displacement through canonical rules', () => {
        const moving = makeSession();
        moving.player.character.jutsu = [{
            id: 'ring-dash', name: 'Ring Dash', type: 'Taijutsu', target: 'EMPTY_GROUND', method: 'AOE_CIRCLE',
            effectPower: 20, ap: 60, range: 4, chakraCost: 10, tags: [{ name: 'Move' }, { name: 'Wound', percent: 10 }],
        }];
        const dash = applySoloPveAction(moving, { type: 'jutsu', jutsuId: 'ring-dash', tile: 51 });
        assert.equal(dash.applied, true);
        assert.equal(dash.session.player.pos, 51);
        assert.ok(dash.session.enemy.hp < moving.enemy.hp, 'landing ring catches the adjacent enemy');

        const ground = makeSession();
        ground.player.character.jutsu = [{
            id: 'poison-zone', name: 'Poison Zone', type: 'Ninjutsu', target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT',
            effectPower: 0, ap: 40, range: 4, tags: [{ name: 'Poison', percent: 12 }],
        }];
        const zone = applySoloPveAction(ground, { type: 'jutsu', jutsuId: 'poison-zone', tile: 51 });
        assert.equal(zone.applied, true);
        assert.equal(zone.session.groundEffects.length, 1);
        assert.ok(zone.session.groundEffects[0]!.tiles.includes(ground.enemy.pos));
        assert.ok(zone.session.enemy.statuses.some((status) => status.name === 'Poison'));

        const barrier = makeSession();
        barrier.enemy.statuses.push({ name: 'Barrier', rounds: 2, amount: 50, kind: 'positive' });
        const blocked = applySoloPveAction(barrier, { type: 'move', tile: 50 });
        assert.equal(blocked.applied, false);
        assert.equal(blocked.reason, 'occupied');

        const displaced = makeSession();
        displaced.player.character.jutsu = [{
            id: 'push', name: 'Push', type: 'Ninjutsu', target: 'OPPONENT', method: 'SINGLE',
            effectPower: 10, ap: 40, range: 2, tags: [{ name: 'Push' }],
        }];
        const pushed = applySoloPveAction(displaced, { type: 'jutsu', jutsuId: 'push' });
        assert.equal(pushed.applied, true);
        assert.notEqual(pushed.session.enemy.pos, displaced.enemy.pos);
    });

    it('persists bounded exact action events and returns rejection evidence without mutation', () => {
        const session = makeSession();
        const accepted = applySoloPveAction(session, { type: 'basicAttack' });
        assert.equal(accepted.event?.kind, 'action');
        assert.equal(accepted.session.eventSeq, 1);
        assert.equal(accepted.session.events.length, 1);
        const event = accepted.session.events[0]!;
        assert.equal(event.before.enemy.hp, session.enemy.hp);
        assert.equal(event.after.enemy.hp, accepted.session.enemy.hp);
        assert.deepEqual(event.log, accepted.session.log.slice(1));
        assert.equal(event.vfx[0]?.target, 'enemy');

        const rejected = applySoloPveAction(session, { type: 'move', tile: 0 });
        assert.equal(rejected.applied, false);
        assert.equal(rejected.event?.kind, 'rejected');
        assert.equal(rejected.event?.kind === 'rejected' ? rejected.event.reason : '', 'invalid-move');
        assert.deepEqual(rejected.session, session);

        const seeded = makeSession({ events: Array.from({ length: 80 }, () => structuredClone(event)), eventSeq: 80 });
        const bounded = applySoloPveAction(seeded, { type: 'basicAttack' });
        assert.equal(bounded.session.events.length, 80);
        assert.equal(bounded.session.events.at(-1)?.seq, 81);
    });

    it('applies both-target consumables to the opponent and the user', () => {
        const player = makeFighter('Alice', 62, {
            character: {
                level: 100, specialty: 'Ninjutsu', stats: {}, jutsu: [],
                pvpItems: [{ id: 'smoke', name: 'Smoke Bomb', slot: 'item', weaponEffect: 'Decrease Damage Given', weaponEffectValue: 25, weaponEffectTarget: 'both', apCost: 20 }],
                equipment: { item: 'smoke' },
            },
        });
        const session = createSoloPveSession({ sessionId: 'smoke', ownerSlug: 'alice', encounter: { kind: 'test', id: 'smoke' }, player, enemy: makeFighter('Rival', 63), now: NOW, itemCharges: { smoke: 1 } });
        const result = applySoloPveAction(session, { type: 'item', itemId: 'smoke' });
        assert.equal(result.applied, true);
        assert.ok(result.session.player.statuses.some((status) => status.name === 'Decrease Damage Given'));
        assert.ok(result.session.enemy.statuses.some((status) => status.name === 'Decrease Damage Given'));
    });

    it('uses deterministic band-aware clear, cleanse, and healing decisions', () => {
        const clearSession = makeSession();
        clearSession.enemy.character.level = 60;
        clearSession.player.statuses.push({ name: 'Increase Damage Given', rounds: 2, percent: 20, kind: 'positive' });
        const cleared = applySoloPveAction(clearSession, { type: 'wait' });
        assert.equal(cleared.session.events.find((event) => event.actor === 'enemy')?.action, 'clear');
        assert.ok(!cleared.session.player.statuses.some((status) => status.name === 'Increase Damage Given'));

        const cleanseSession = makeSession();
        cleanseSession.enemy.character.level = 60;
        cleanseSession.enemy.statuses.push(
            { name: 'Poison', rounds: 3, percent: 5, kind: 'negative' },
            { name: 'Wound', rounds: 3, amount: 5, kind: 'negative' },
        );
        const cleansed = applySoloPveAction(cleanseSession, { type: 'wait' });
        assert.equal(cleansed.session.events.find((event) => event.actor === 'enemy')?.action, 'cleanse');

        const healSession = makeSession({ enemy: makeFighter('Rival', 63, { hp: 300, character: { level: 25, specialty: 'Ninjutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} } }) });
        const healed = applySoloPveAction(healSession, { type: 'wait' });
        assert.equal(healed.session.events.find((event) => event.actor === 'enemy')?.action, 'basicHeal');
        assert.ok(healed.session.enemy.hp > healSession.enemy.hp);

        const first = applySoloPveAction(makeSession(), { type: 'wait' });
        const second = applySoloPveAction(makeSession(), { type: 'wait' });
        assert.deepEqual(second, first);
    });

    it('summons a sealed independent companion and runs its deterministic phase before the enemy', () => {
        const session = createSoloPveSession({
            sessionId: 'companion',
            ownerSlug: 'alice',
            encounter: { kind: 'test', id: 'companion' },
            player: makeFighter('Alice', 62),
            enemy: makeFighter('Rival', 63),
            now: NOW,
            companion: {
                petId: 'pet-1', name: 'Fang', hp: 300, damage: 120, happiness: 100, loyal: false,
                moves: [{ name: 'Bite', kind: 'damage', power: 45, cooldown: 1, rounds: 2, signature: true }],
                pveGearId: '',
            },
        });
        const summoned = applySoloPveAction(session, { type: 'summon' });
        assert.equal(summoned.applied, true);
        assert.equal(summoned.session.ap.player, 100, 'summoning is free like the normal Arena');
        assert.equal(summoned.session.actionsThisTurn, 0);
        assert.equal(summoned.session.pendingCompanion, undefined);
        assert.equal(summoned.session.companion?.petId, 'pet-1');
        assert.deepEqual(summoned.session.companionUsage, { petId: 'pet-1' });

        const enemyBefore = summoned.session.enemy.hp;
        const advanced = applySoloPveAction(summoned.session, { type: 'wait' });
        assert.ok(advanced.session.enemy.hp < enemyBefore, 'the pet damages the enemy on its own phase');
        const tail = advanced.session.events.slice(1).map((event) => event.actor);
        assert.equal(tail[0], 'player');
        assert.ok(tail.indexOf('companion') > tail.indexOf('player'));
        assert.ok(tail.indexOf('enemy') > tail.indexOf('companion'));
        assert.equal(advanced.session.companion?.roundsLeft, 3);

        const replay = applySoloPveAction(summoned.session, { type: 'summon' });
        assert.equal(replay.applied, false);
        assert.equal(replay.reason, 'already-summoned');

        const exposed = structuredClone(summoned.session);
        exposed.sessionId = 'companion-target';
        exposed.companion!.hp = Math.floor(exposed.companion!.maxHp * 0.3);
        exposed.companion!.pos = 51;
        const countered = applySoloPveAction(exposed, { type: 'wait' });
        assert.ok(countered.session.events.some((event) => event.actor === 'enemy' && event.target === 'companion'), 'the enemy can target the independent pet actor');
    });
});

describe('solo-PvE action service', () => {
    it('commits one versioned move under a fail-closed lock', async () => {
        let stored = makeSession();
        let lockOptions: Parameters<SoloPveLock>[2];
        const lock: SoloPveLock = async (_target, fn, options) => { lockOptions = options; return fn(); };
        const result = await executeSoloPveAction({
            sessionId: stored.sessionId,
            ownerSlug: stored.ownerSlug,
            expectedVersion: 1,
            moveToken: 'move-token-0001',
            action: { type: 'basicAttack' },
        }, {
            read: async () => structuredClone(stored),
            write: async (next) => { stored = structuredClone(next); },
            lock,
            now: () => NOW + 1_000,
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.applied, true);
        assert.equal(stored.version, 2);
        assert.deepEqual(stored.recentMoveTokens, ['move-token-0001']);
        assert.equal(lockOptions?.failClosed, true);
    });

    it('returns a duplicate retry without replaying or writing', async () => {
        const stored = makeSession({ version: 2, recentMoveTokens: ['move-token-0001'] });
        let writes = 0;
        const result = await executeSoloPveAction({
            sessionId: stored.sessionId,
            ownerSlug: stored.ownerSlug,
            expectedVersion: 1,
            moveToken: 'move-token-0001',
            action: { type: 'basicAttack' },
        }, {
            read: async () => structuredClone(stored),
            write: async () => { writes += 1; },
            lock: async (_target, fn) => fn(),
            now: () => NOW + 1_000,
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.duplicate, true);
        assert.equal(writes, 0);
    });

    it('serializes concurrent same-version actions so exactly one commits', async () => {
        let stored = makeSession();
        let tail: Promise<unknown> = Promise.resolve();
        const serialLock: SoloPveLock = (_target, fn) => {
            const run = tail.then(fn, fn);
            tail = run.then(() => undefined, () => undefined);
            return run;
        };
        const deps = {
            read: async () => structuredClone(stored),
            write: async (next: SoloPveSession) => { stored = structuredClone(next); },
            lock: serialLock,
            now: () => NOW + 1_000,
        };
        const [first, second] = await Promise.all([
            executeSoloPveAction({ sessionId: stored.sessionId, ownerSlug: 'alice', expectedVersion: 1, moveToken: 'move-token-race-a', action: { type: 'basicAttack' } }, deps),
            executeSoloPveAction({ sessionId: stored.sessionId, ownerSlug: 'alice', expectedVersion: 1, moveToken: 'move-token-race-b', action: { type: 'basicAttack' } }, deps),
        ]);
        assert.deepEqual([first.status, second.status].sort(), [200, 409]);
        assert.equal(stored.version, 2);
        assert.equal(stored.recentMoveTokens.length, 1);
    });

    it('ignores forged fighter and outcome fields attached to an action object', async () => {
        let stored = makeSession();
        const beforeMaxHp = stored.player.maxHp;
        const result = await executeSoloPveAction({
            sessionId: stored.sessionId,
            ownerSlug: 'alice',
            expectedVersion: 1,
            moveToken: 'move-token-tamper',
            action: { type: 'basicAttack', hp: 9_999_999, winner: 'player', reward: 9_999_999 } as never,
        }, {
            read: async () => structuredClone(stored),
            write: async (next) => { stored = structuredClone(next); },
            lock: async (_target, fn) => fn(),
            now: () => NOW + 1_000,
        });
        assert.equal(result.status, 200);
        assert.equal(stored.player.maxHp, beforeMaxHp);
        assert.equal(stored.status, 'active');
        assert.equal(stored.winner, null);
        assert.equal('reward' in stored, false);
    });

    it('rejects stale versions, wrong owners, and expired sessions without mutation', async () => {
        const stored = makeSession({ version: 4 });
        let writes = 0;
        const deps = {
            read: async () => structuredClone(stored),
            write: async () => { writes += 1; },
            lock: (async (_target, fn) => fn()) as SoloPveLock,
            now: () => NOW + 1_000,
        };
        const stale = await executeSoloPveAction({ sessionId: stored.sessionId, ownerSlug: 'alice', expectedVersion: 3, moveToken: 'move-token-stale', action: { type: 'wait' } }, deps);
        assert.equal(stale.status, 409);
        assert.equal(stale.body.session?.version, 4);
        const wrong = await executeSoloPveAction({ sessionId: stored.sessionId, ownerSlug: 'mallory', expectedVersion: 4, moveToken: 'move-token-owner', action: { type: 'wait' } }, deps);
        assert.equal(wrong.status, 403);
        const expired = await executeSoloPveAction({ sessionId: stored.sessionId, ownerSlug: 'alice', expectedVersion: 4, moveToken: 'move-token-expire', action: { type: 'wait' } }, { ...deps, now: () => stored.expiresAt + 1 });
        assert.equal(expired.status, 410);
        assert.equal(writes, 0);
    });

    it('stores terminal outcome and inventory evidence for reconnect and retry', async () => {
        let stored = makeSession({ enemy: makeFighter('Rival', 63, { hp: 1 }) });
        const result = await executeSoloPveAction({
            sessionId: stored.sessionId,
            ownerSlug: 'alice',
            expectedVersion: 1,
            moveToken: 'move-token-terminal',
            action: { type: 'basicAttack' },
        }, {
            read: async () => structuredClone(stored),
            write: async (next) => { stored = structuredClone(next); },
            lock: async (_target, fn) => fn(),
            now: () => NOW + 5_000,
        });
        assert.equal(result.body.applied, true);
        assert.equal(stored.status, 'done');
        assert.deepEqual(stored.terminalEvidence, {
            finishedAt: NOW + 5_000,
            finalMoveToken: 'move-token-terminal',
            finalVersion: 2,
            finalEventSeq: 1,
            winner: 'player',
            outcome: 'win',
            itemsUsed: {},
            settlementState: 'pending',
        });
        assert.ok(stored.expiresAt >= NOW + 6 * 24 * 60 * 60 * 1_000);

        const retry = await executeSoloPveAction({
            sessionId: stored.sessionId,
            ownerSlug: 'alice',
            expectedVersion: 1,
            moveToken: 'move-token-terminal',
            action: { type: 'basicAttack' },
        }, {
            read: async () => structuredClone(stored),
            write: async () => assert.fail('duplicate terminal retry must not write'),
            lock: async (_target, fn) => fn(),
            now: () => NOW + 6_000,
        });
        assert.equal(retry.body.duplicate, true);
        assert.deepEqual(retry.body.session?.terminalEvidence, stored.terminalEvidence);
    });
});
