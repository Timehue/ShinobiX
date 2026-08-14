import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeRng } from './_sim.js';
import { createTowerSession, getActor, activeActor, type TowerActor, type TowerSession, type TowerMap } from './_tower-session.js';
import type { TowerFloor } from './_floor-catalog.js';
import {
    runTowerFloor,
    runAiUntilHuman,
    applyAction,
    startRound,
    endTurn,
    checkTowerWinner,
    computeDamage,
    applyPartyScaling,
    pickAiAction,
    towerNeighbors,
    BASIC_ATTACK_AP,
} from './_engine.js';
import { COMBAT_RESOURCES_V2, v2ResourceRegen } from '../_combat-resources.js';
import { hexDistance } from '../pvp/_aoe.js';
import { applyJutsu } from '../pvp/move.js';
import { towerActorToPvpFighter } from '../combat-adapters/clanBossAdapter.js';
import { getEnemyTemplate } from './_enemy-templates.js';

const MAP8: TowerMap = { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };

function makeActor(id: string, side: TowerActor['side'], pos: number, over: Partial<TowerActor> = {}): TowerActor {
    return {
        id, side, name: id, ownerSlug: null, ai: true,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, pos,
        character: { specialty: 'Taijutsu', stats: {} },
        ...over,
    };
}
function templateEnemy(templateId: string, pos: number, over: Partial<TowerActor> = {}): TowerActor {
    const template = getEnemyTemplate(templateId);
    return makeActor(templateId, 'enemy', pos, {
        hp: template.hp,
        maxHp: template.hp,
        character: {
            level: template.level,
            specialty: template.specialty,
            stats: { ...template.stats },
            jutsu: template.jutsu?.map(jutsu => ({ ...jutsu })),
            combatRole: template.role,
            aiTargetMode: template.targetMode,
        },
        ...over,
    });
}
// level: 100 so the per-rank stat cap (move.ts perRankStatCap, Special Jonin = 2500)
// is a no-op for these fixtures — these engine tests exercise win/loss + scaling with
// an intended raw stat gap, not the anti-twink clamp (which is unit-tested separately).
const STRONG = { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 } };
const WEAK = { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 200, taijutsuDefense: 200 } };

function makeFloor(objective: TowerFloor['objective'], over: Partial<TowerFloor> = {}): TowerFloor {
    return {
        id: 1, name: 'Test', biome: 'forest', objective, roundBudget: 8,
        map: { width: 8, height: 8 }, fieldRule: { kind: 'none' }, enemies: [],
        firstClearReward: {}, ...over,
    };
}
function makeSession(actors: TowerActor[], over: Partial<Parameters<typeof createTowerSession>[0]> = {}): TowerSession {
    return createTowerSession({
        towerId: 't', runId: 'r', floor: 1, seed: 123, partySize: 4, map: MAP8,
        actors, objectiveKind: 'defeat-all', now: 1000, ...over,
    });
}

// sq at col 0 (pos 0, 8), enemies at col 1 (pos 1, 9) → each pair adjacent (dist 1).
function frontline(squadChar = STRONG, enemyChar = WEAK): TowerActor[] {
    return [
        makeActor('sq-1', 'squad', 0, { character: squadChar }),
        makeActor('sq-2', 'squad', 8, { character: squadChar }),
        makeActor('en-1', 'enemy', 1, { character: enemyChar }),
        makeActor('en-2', 'enemy', 9, { character: enemyChar }),
    ];
}

describe('Battle Towers engine (P1.A2)', () => {
    it('runs a full floor deterministically (same seed/inputs → byte-identical)', () => {
        const a = runTowerFloor(makeSession(frontline()), makeFloor('defeat-all'), makeRng(999));
        const b = runTowerFloor(makeSession(frontline()), makeFloor('defeat-all'), makeRng(999));
        assert.equal(JSON.stringify(a), JSON.stringify(b));
        assert.equal(a.status, 'done');
    });

    it('a stronger squad clears a defeat-all floor', () => {
        const s = runTowerFloor(makeSession(frontline()), makeFloor('defeat-all'), makeRng(1));
        assert.equal(s.winner, 'squad');
        assert.equal(getActor(s, 'en-1')?.hp, 0);
        assert.equal(getActor(s, 'en-2')?.hp, 0);
        assert.ok(s.objectiveState.completed);
    });

    it('a wiped squad loses (enemy wins)', () => {
        const s = runTowerFloor(makeSession(frontline(WEAK, STRONG)), makeFloor('defeat-all'), makeRng(2));
        assert.equal(s.winner, 'enemy');
        assert.equal(s.status, 'done');
    });

    it('defeat-boss wins when the boss dies even if trash lingers', () => {
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: STRONG }),
            makeActor('boss', 'enemy', 1, { character: WEAK, hp: 300, maxHp: 300 }),
            makeActor('en-1', 'enemy', 63, { character: WEAK }), // far corner, never engaged
        ];
        const s = runTowerFloor(
            makeSession(actors, { objectiveKind: 'defeat-boss', bossId: 'boss' }),
            makeFloor('defeat-boss', { id: 5 }),
            makeRng(3),
        );
        assert.equal(s.winner, 'squad');
        assert.equal(getActor(s, 'boss')?.hp, 0);
        assert.ok((getActor(s, 'en-1')?.hp ?? 0) > 0, 'trash never had to die');
    });

    it('focus-fire (aiTargetMode) picks the priority victim, not just the nearest', () => {
        // Boss at pos 9 (col 1, row 1); pos 1 and pos 8 are BOTH hex-neighbours of 9 (dist 1).
        // Two squad members equidistant: one full HP, one badly wounded.
        const mkBoss = (mode?: string) => makeActor('boss', 'enemy', 9, {
            character: { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 }, ...(mode ? { aiTargetMode: mode } : {}) },
        });
        const full = () => makeActor('sq-a', 'squad', 1, { hp: 1000, maxHp: 1000 }); // lower id, nearest-tiebreak winner
        const hurt = () => makeActor('sq-b', 'squad', 8, { hp: 60, maxHp: 1000 });   // wounded, higher id
        assert.equal(hexDistance(9, 1, 8), 1, 'sq-a adjacent to boss');
        assert.equal(hexDistance(9, 8, 8), 1, 'sq-b adjacent to boss');

        // lowest-hp focus → strikes the wounded sq-b even though sq-a is the nearest-tiebreak pick.
        const sFocus = makeSession([mkBoss('lowest-hp'), full(), hurt()], { bossId: 'boss' });
        sFocus.activeAp = 100; sFocus.actionsThisTurn = 0;
        const focusAction = pickAiAction(sFocus, getActor(sFocus, 'boss')!, makeRng(1));
        assert.equal(focusAction.type, 'attack');
        assert.equal((focusAction as { targetId: string }).targetId, 'sq-b', 'focus-fire hits the wounded target');

        // Control: no aiTargetMode → nearest-opponent tie-break by id → sq-a (unchanged behaviour).
        const sPlain = makeSession([mkBoss(), full(), hurt()], { bossId: 'boss' });
        sPlain.activeAp = 100; sPlain.actionsThisTurn = 0;
        const plainAction = pickAiAction(sPlain, getActor(sPlain, 'boss')!, makeRng(1));
        assert.equal((plainAction as { targetId: string }).targetId, 'sq-a', 'nearest policy is unchanged when no mode is set');
    });

    it('role-authored AI uses ranged, ground-control, and conditional defense techniques', () => {
        const target = () => makeActor('sq-1', 'squad', 0, { character: STRONG });

        const archerSession = makeSession([templateEnemy('grunt-archer', 4), target()]);
        archerSession.activeAp = 100;
        const archerAction = pickAiAction(archerSession, getActor(archerSession, 'grunt-archer')!, makeRng(1));
        assert.equal(archerAction.type, 'jutsu');
        assert.equal((archerAction as { jutsuId: string }).jutsuId, 'archer-volley', 'artillery attacks from range instead of walking into melee');

        const acolyteSession = makeSession([templateEnemy('grunt-acolyte', 3), target()]);
        acolyteSession.activeAp = 100;
        const acolyteAction = pickAiAction(acolyteSession, getActor(acolyteSession, 'grunt-acolyte')!, makeRng(1));
        assert.equal(acolyteAction.type, 'jutsu');
        assert.equal((acolyteAction as { jutsuId: string }).jutsuId, 'acolyte-mire');
        assert.equal((acolyteAction as { tile: number }).tile, 0, 'controller aims its zone at the selected target tile');

        const shieldman = templateEnemy('grunt-blocker', 1, { hp: 500 });
        const shieldSession = makeSession([shieldman, target()]);
        shieldSession.activeAp = 100;
        const shieldAction = pickAiAction(shieldSession, shieldman, makeRng(1));
        assert.equal(shieldAction.type, 'jutsu');
        assert.equal((shieldAction as { jutsuId: string }).jutsuId, 'shieldman-brace', 'vanguard braces only after crossing its HP gate');
    });

    it('artillery centers a targeted AOE on the largest legal hostile cluster', () => {
        const archer = templateEnemy('grunt-archer', 0);
        const squad = [
            makeActor('sq-lone', 'squad', 1, { character: { ...STRONG, stats: { ...STRONG.stats, taijutsuDefense: 0, bukijutsuDefense: 0, genjutsuDefense: 0, ninjutsuDefense: 0 } } }),
            makeActor('sq-cluster-a', 'squad', 17, { character: STRONG }),
            makeActor('sq-cluster-b', 'squad', 18, { character: STRONG }),
            makeActor('sq-cluster-c', 'squad', 19, { character: STRONG }),
        ];
        const s = makeSession([archer, ...squad]);
        s.activeAp = 100;
        const action = pickAiAction(s, archer, makeRng(1));
        assert.equal(action.type, 'jutsu');
        assert.equal((action as { jutsuId: string }).jutsuId, 'archer-volley');
        assert.equal((action as { targetId: string }).targetId, 'sq-cluster-b',
            'AOE value outranks the squishiest lone victim while single-target focus remains unchanged');
    });

    it('AI seeks a contested shrine it can reach instead of only chasing the far target', () => {
        const shrineTile = 24; // (0,3), left; the combat target sits far right
        const mkMap = (withObjects: boolean): TowerMap => ({
            width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [],
            ...(withObjects ? { boardObjects: [{ kind: 'shrine', percent: 10, tiles: [shrineTile], label: 'Shrine' }] } : {}),
        });
        const build = (withObjects: boolean) => {
            const s = makeSession([
                makeActor('en-1', 'enemy', 27, { character: { specialty: 'Taijutsu', stats: {} } }), // no jutsu → move branch
                makeActor('sq-1', 'squad', 31, { character: STRONG }),                                 // far right
            ], { map: mkMap(withObjects) });
            s.activeAp = 100; s.actionsThisTurn = 0;
            return s;
        };
        const seek = build(true);
        const a = pickAiAction(seek, getActor(seek, 'en-1')!, makeRng(1));
        assert.equal(a.type, 'move');
        assert.ok(hexDistance((a as { tile: number }).tile, shrineTile, 8) < hexDistance(27, shrineTile, 8), 'moves TOWARD the shrine');
        // Control: with no board objects the enemy heads for the target (far right) — old policy.
        const plain = build(false);
        const b = pickAiAction(plain, getActor(plain, 'en-1')!, makeRng(1));
        assert.equal(b.type, 'move');
        assert.ok(hexDistance((b as { tile: number }).tile, 31, 8) < hexDistance(27, 31, 8), 'without objects, approaches the target');
    });

    it('AI standing in a hazard flees to a safe (non-hazard) tile', () => {
        const hazard = [27, 26, 28]; // the actor is on 27; two neighbours are also lethal
        const s = makeSession([
            makeActor('en-1', 'enemy', 27, { character: { specialty: 'Taijutsu', stats: {} } }),
            makeActor('sq-1', 'squad', 31, { character: STRONG }),
        ], { map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [], features: [{ kind: 'hazard', tiles: hazard, percent: 12, label: 'Fire' }] } });
        s.activeAp = 100; s.actionsThisTurn = 0;
        const a = pickAiAction(s, getActor(s, 'en-1')!, makeRng(1));
        assert.equal(a.type, 'move');
        assert.ok(!hazard.includes((a as { tile: number }).tile), 'flees onto a safe tile off the hazard');
    });

    it('BFS pathing routes AI around a wall that would stall the greedy step', () => {
        // 8x8 board with a vertical wall on column 4 (rows 0-6), gap only at row 7 (pos 60).
        // A greedy one-step would jam at the wall (no distance-reducing free neighbour) and the
        // fight would time out as a loss; BFS detours through the gap so the squad engages + wins.
        const wall = [4, 12, 20, 28, 36, 44, 52]; // col 4, rows 0..6
        const walledMap: TowerMap = { width: 8, height: 8, blockedTiles: wall, hazardTiles: [], objectiveTiles: [] };
        const actors = [
            makeActor('sq-1', 'squad', 27, { character: STRONG }), // (3,3), left of the wall
            makeActor('en-1', 'enemy', 29, { character: WEAK }),   // (5,3), right of the wall
        ];
        const run = () => runTowerFloor(
            makeSession(actors.map(a => ({ ...a, character: { ...a.character } })), { map: { ...walledMap, blockedTiles: [...wall] } }),
            makeFloor('defeat-all'), makeRng(5),
        );
        const s = run();
        assert.equal(s.winner, 'squad', 'squad pathed around the wall and cleared (no stall-timeout)');
        assert.equal(getActor(s, 'en-1')?.hp, 0);
        // and the terrain run stays deterministic (BFS is a pure function of board state)
        assert.equal(JSON.stringify(run()), JSON.stringify(s), 'terrain run is byte-identical across replays');
    });

    it('a boss strike telegraphs at round start and detonates on a caught squad member', () => {
        const mkBoss = () => makeActor('boss', 'enemy', 27, {
            hp: 100000, maxHp: 100000,
            character: { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 800, taijutsuDefense: 800 }, bossStrike: { kind: 'nova', pct: 12, radius: 1, everyRounds: 2, firstRound: 2 } },
        });
        const mkSq = () => makeActor('sq-1', 'squad', 28, { character: STRONG }); // 28 is a neighbour of 27 → stays adjacent (attacks) inside the nova

        // Telegraph: at the cadence round, startRound primes the strike and paints its disk.
        const tele = makeSession([mkBoss(), mkSq()], { bossId: 'boss' });
        tele.round = 2; startRound(tele);
        assert.ok(tele.bossStrike && tele.bossStrike.round === 2, 'strike primed at the cadence round');
        assert.ok((tele.map.nextRoundHazardTiles ?? []).includes(27), 'nova centre telegraphed at round start');

        // Off-cadence + no-config bosses never prime → no telegraph (byte-identical wire).
        const off = makeSession([mkBoss(), mkSq()], { bossId: 'boss' }); off.round = 3; startRound(off);
        assert.equal(off.bossStrike, undefined, 'no strike off-cadence');
        const plain = makeActor('boss', 'enemy', 27, { hp: 100000, maxHp: 100000, character: { specialty: 'Taijutsu', level: 100, stats: {} } });
        const none = makeSession([plain, mkSq()], { bossId: 'boss' }); none.round = 2; startRound(none);
        assert.equal(none.bossStrike, undefined, 'a boss with no strike config never primes');
        assert.ok(!(none.map.nextRoundHazardTiles ?? []).length, 'no telegraph without a strike');

        // Detonation: run the floor; the adjacent shinobi eats the nova (logged), deterministically.
        const run = () => runTowerFloor(makeSession([mkBoss(), mkSq()], { bossId: 'boss', objectiveKind: 'defeat-boss' }), makeFloor('defeat-boss', { id: 5 }), makeRng(7));
        const a = run();
        assert.ok(a.log.some(l => l.includes('nova')), 'the nova detonated on a caught squad member');
        assert.equal(JSON.stringify(run()), JSON.stringify(a), 'strike run is byte-identical across replays');
    });

    it('phase pillars erupt at the gate, non-adjacent to everything, never on units', () => {
        const mkActors = () => [
            makeActor('sq-1', 'squad', 0, { character: STRONG }),
            makeActor('boss', 'enemy', 1, {
                hp: 1000, maxHp: 1000,
                character: { specialty: 'Taijutsu', level: 100, stats: { taijutsuDefense: 200 }, phasePillars: 2 },
            }),
        ];
        const run = () => runTowerFloor(
            makeSession(mkActors(), { bossId: 'boss', bossPhases: [50], objectiveKind: 'defeat-boss' }),
            makeFloor('defeat-boss', { id: 5 }), makeRng(11),
        );
        const s = run();
        assert.ok(s.map.blockedTiles.length >= 1 && s.map.blockedTiles.length <= 2, `pillars dropped at the gate (${s.map.blockedTiles.length})`);
        assert.ok(s.log.some(l => l.includes('shatters the arena')), 'the eruption is narrated');
        const blocked = new Set(s.map.blockedTiles);
        for (const t of s.map.blockedTiles) {
            for (const nb of towerNeighbors(t, 8, 8)) assert.ok(!blocked.has(nb), `pillars ${t},${nb} must not touch (connectivity invariant)`);
        }
        for (const a of s.actors) assert.ok(!blocked.has(a.pos), `no pillar under ${a.id}`);
        assert.equal(JSON.stringify(run()), JSON.stringify(s), 'pillar drops replay byte-identically');
    });

    it('fonts restore the tile-holder at round end, honouring the absolute cap + heal-cut', () => {
        const font = { kind: 'font' as const, resource: 'hp' as const, percent: 8, cap: 50, tiles: [0], label: 'Healing Spring' };
        const mkMap = (): TowerMap => ({ width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [], boardObjects: [{ ...font }] });
        // 8% of 2000 = 160, but cap 50 wins; healcut 50% halves it to 25.
        const wounded = () => makeActor('sq-1', 'squad', 0, { hp: 1000, maxHp: 2000, character: STRONG });
        const foe = () => makeActor('en-1', 'enemy', 63, { character: WEAK });
        const s = makeSession([wounded(), foe()], { map: mkMap() });
        startRound(s); endTurn(s, makeFloor('defeat-all')); endTurn(s, makeFloor('defeat-all'));
        assert.equal(getActor(s, 'sq-1')!.hp, 1050, 'restore = min(cap 50, 8% of max)');
        const sCut = makeSession([wounded(), foe()], { map: mkMap() });
        sCut.modifierStack = [{ kind: 'healcut', value: 50, label: 'test' }];
        startRound(sCut); endTurn(sCut, makeFloor('defeat-all')); endTurn(sCut, makeFloor('defeat-all'));
        assert.equal(getActor(sCut, 'sq-1')!.hp, 1025, 'spire heal-cut halves the font restore');
        // an enemy standing on it benefits too (symmetric), with NO heal-cut
        const sFoe = makeSession([makeActor('sq-1', 'squad', 63, { character: STRONG }), makeActor('en-1', 'enemy', 0, { hp: 100, maxHp: 500, character: WEAK })], { map: mkMap() });
        sFoe.modifierStack = [{ kind: 'healcut', value: 50, label: 'test' }];
        startRound(sFoe); endTurn(sFoe, makeFloor('defeat-all')); endTurn(sFoe, makeFloor('defeat-all'));
        assert.equal(getActor(sFoe, 'en-1')!.hp, 140, 'enemy restore = min(cap, 8% of 500)=40, uncut');
    });

    it('a held shrine buffs its team, is capped, and never compounds an enraged attacker', () => {
        const shrine = { kind: 'shrine' as const, percent: 10, tiles: [8], label: 'Battle Shrine' };
        const mkMap = (): TowerMap => ({ width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [], boardObjects: [{ ...shrine }] });
        const atk = { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 1000 } };
        const J = { effectPower: 10, type: 'Taijutsu', ap: 60 };
        // holder on the shrine (pos 8) + attacker adjacent to the foe
        const mkActors = (hold: boolean, enraged = false) => [
            makeActor('sq-1', 'squad', 0, { character: { ...atk, ...(enraged ? { enrage: 1 } : {}) } }),
            makeActor('sq-2', 'squad', hold ? 8 : 16, { character: STRONG }),
            makeActor('en-1', 'enemy', 1, { hp: 100000, maxHp: 100000, character: { stats: { taijutsuDefense: 1000 } } }),
        ];
        const dmgAfterAttack = (actors: TowerActor[]) => {
            const s = makeSession(actors, { map: mkMap() });
            startRound(s);
            const r = applyAction(s, makeFloor('defeat-all'), { actorId: 'sq-1', type: 'attack', targetId: 'en-1' }, makeRng(1));
            assert.equal(r.applied, true);
            return 100000 - getActor(s, 'en-1')!.hp;
        };
        const held = dmgAfterAttack(mkActors(true));
        const unheld = dmgAfterAttack(mkActors(false));
        assert.ok(held > unheld, `held shrine hits harder (${held} > ${unheld})`);
        assert.ok(held <= Math.ceil(unheld * 1.12) + 1, 'bonus stays within the SHRINE_TEAM_CAP');
        const enragedHeld = dmgAfterAttack(mkActors(true, true));
        const enragedBase = dmgAfterAttack(mkActors(false, true));
        assert.equal(enragedHeld, enragedBase, 'an enraged attacker gains NOTHING from a shrine');
    });

    it('aegis grants a capped shield at each phase gate that the squad must burn through', () => {
        const mkActors = () => [
            makeActor('sq-1', 'squad', 0, { character: STRONG }),
            makeActor('boss', 'enemy', 1, {
                hp: 2000, maxHp: 2000,
                character: { specialty: 'Taijutsu', level: 100, stats: { taijutsuDefense: 200 }, aegis: { shieldPct: 12 } },
            }),
        ];
        const s = runTowerFloor(
            makeSession(mkActors(), { bossId: 'boss', bossPhases: [50], objectiveKind: 'defeat-boss' }),
            makeFloor('defeat-boss', { id: 5 }), makeRng(21),
        );
        assert.ok(s.log.some(l => l.includes('raises an aegis')), 'the aegis is narrated at the gate');
        assert.equal(s.winner, 'squad', 'the shield delays but never prevents the kill');
        assert.equal(getActor(s, 'boss')!.hp, 0);
    });

    it('a geyser erupts on its cadence: telegraphs a round ahead + scalds whoever stands on it', () => {
        const geyserMap = (): TowerMap => ({ width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [], dynamicHazards: [{ kind: 'geyser', tiles: [28], pct: 8, everyRounds: 2, firstRound: 2 }] });
        const pair = () => [makeActor('sq-1', 'squad', 27, { character: STRONG }), makeActor('en-1', 'enemy', 28, { character: WEAK, hp: 6000, maxHp: 6000 })];
        const tele = makeSession(pair(), { map: geyserMap() });
        tele.round = 2; startRound(tele);
        assert.ok((tele.map.nextRoundHazardTiles ?? []).includes(28), 'vent telegraphed on the cadence round');
        const off = makeSession(pair(), { map: geyserMap() });
        off.round = 3; startRound(off);
        assert.ok(!(off.map.nextRoundHazardTiles ?? []).includes(28), 'no telegraph off-cadence');
        // Full run: the adjacent enemy attacks (stays on the vent) and gets scalded at the cadence round-end.
        const s = runTowerFloor(makeSession(pair(), { map: geyserMap(), objectiveKind: 'defeat-all' }), makeFloor('defeat-all'), makeRng(3));
        assert.ok(s.log.some(l => l.includes('scalded by an erupting geyser')), 'the geyser scalded a unit standing on it');
    });

    it('a seismic-slam strike hurls the caught squad member back', () => {
        const mk = () => [
            makeActor('boss', 'enemy', 27, { hp: 100000, maxHp: 100000, character: { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 800, taijutsuDefense: 800 }, bossStrike: { kind: 'slam', pct: 6, radius: 1, everyRounds: 2, firstRound: 2 } } }),
            makeActor('sq-1', 'squad', 28, { character: STRONG }), // adjacent → in the radius-1 slam
        ];
        const s = runTowerFloor(makeSession(mk(), { bossId: 'boss', objectiveKind: 'defeat-boss' }), makeFloor('defeat-boss', { id: 9 }), makeRng(4));
        assert.ok(s.log.some(l => l.includes('seismic slam')), 'the slam detonated');
        assert.ok(s.log.some(l => l.includes('hurled back')), 'a caught shinobi was knocked back');
    });

    it('the closing ring telegraphs more lethal outer tiles as it contracts', () => {
        const boss = () => makeActor('boss', 'enemy', 40, { character: { specialty: 'Taijutsu', level: 100, stats: {} } });
        const sq = () => makeActor('sq-1', 'squad', 0, { character: STRONG });
        const ringMap = (): TowerMap => ({ width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [], closingRing: { pct: 5, fromRound: 1, minRadius: 2 } });
        const early = makeSession([boss(), sq()], { map: ringMap(), bossId: 'boss' }); early.round = 1; startRound(early);
        const late = makeSession([boss(), sq()], { map: ringMap(), bossId: 'boss' }); late.round = 8; startRound(late);
        const nEarly = (early.map.nextRoundHazardTiles ?? []).length;
        const nLate = (late.map.nextRoundHazardTiles ?? []).length;
        assert.equal(nEarly, 0, 'the ring paints nothing before it starts closing');
        assert.ok(nLate > 0, 'the contracted ring paints lethal outer tiles');
    });

    it('computeDamage: statFactor identity at off==def, armor DR reduces', () => {
        const att = makeActor('a', 'squad', 0, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 1000 } } });
        const defEqual = makeActor('d', 'enemy', 1, { character: { stats: { taijutsuDefense: 1000 } } });
        const defArmor = makeActor('d2', 'enemy', 1, { character: { stats: { taijutsuDefense: 1000 }, armorRawDR: 1.0 } });
        const j = { effectPower: 10, type: 'Taijutsu', ap: 60 }; // 60 AP = real damage jutsu (40 AP is the utility convention → 0 dmg)
        const base = computeDamage(att, defEqual, j, 50);
        const armored = computeDamage(att, defArmor, j, 50);
        assert.ok(base > 0);
        assert.ok(armored < base, 'armor reduces damage');
    });

    it('rejects friendly-fire, out-of-range, and not-your-turn', () => {
        const s = makeSession(frontline());
        startRound(s);
        const active = activeActor(s)!; // sq-1
        // friendly fire on sq-2
        assert.equal(applyAction(s, makeFloor('defeat-all'), { actorId: active.id, type: 'attack', targetId: 'sq-2' }, makeRng(1)).applied, false);
        // out of range: en-2 is at pos 9, sq-1 at pos 0 → dist > 1
        assert.equal(applyAction(s, makeFloor('defeat-all'), { actorId: active.id, type: 'attack', targetId: 'en-2' }, makeRng(1)).applied, false);
        // not your turn: en-1 acting out of turn
        assert.equal(applyAction(s, makeFloor('defeat-all'), { actorId: 'en-1', type: 'attack', targetId: 'sq-1' }, makeRng(1)).applied, false);
        // valid: sq-1 attacks adjacent en-1
        const ok = applyAction(s, makeFloor('defeat-all'), { actorId: active.id, type: 'attack', targetId: 'en-1' }, makeRng(1));
        assert.equal(ok.applied, true);
        assert.ok(s.activeAp === 100 - BASIC_ATTACK_AP);
    });

    // Increase Generals is a self-buff resolved by api/pvp/move.ts applyJutsu, which the
    // tower reuses for ALL combat (runJutsu → applyJutsu). This proves the buff's stat
    // lift actually flows through the actor→fighter→applyJutsu delegation, not just in
    // isolated PvP (api/pvp/_increase-generals.test.ts covers applyJutsu directly).
    it('Increase Generals raises tower damage (self-buff flows through applyJutsu delegation)', () => {
        const attackerChar = { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 2500 } };
        const defenderChar = { specialty: 'Taijutsu', level: 100, stats: { taijutsuDefense: 1000 } };

        function attackOnce(attackerStatuses: TowerActor['statuses']): number {
            const actors = [
                makeActor('sq-1', 'squad', 0, { character: attackerChar, statuses: attackerStatuses }),
                makeActor('en-1', 'enemy', 1, { character: defenderChar, hp: 100_000, maxHp: 100_000 }),
            ];
            const s = makeSession(actors);
            startRound(s);
            assert.equal(activeActor(s)!.id, 'sq-1', 'squad acts first');
            const before = getActor(s, 'en-1')!.hp;
            const r = applyAction(s, makeFloor('defeat-all'), { actorId: 'sq-1', type: 'attack', targetId: 'en-1' }, makeRng(1));
            assert.equal(r.applied, true, 'basic attack applies');
            return before - getActor(s, 'en-1')!.hp;
        }

        const baseline = attackOnce([]);
        const buffed = attackOnce([{ name: 'Increase Generals', percent: 30, rounds: 2, kind: 'positive' }]);
        assert.ok(baseline > 0, `baseline tower attack should deal damage (got ${baseline})`);
        assert.ok(buffed > baseline, `Increase Generals should raise tower damage (buffed ${buffed} vs baseline ${baseline})`);
    });

    // AOE_BURST — target-centred, no movement/ground tile. resolveHit → applyAoeSplash
    // (radius 1) hits the struck foe plus the 6 hexes touching them at full damage, but
    // NOT enemies two hexes out.
    it('AOE_BURST splashes full damage to the touching hexes (radius 1), not beyond', () => {
        // sq-1 @0, en-1 @1 (target, dist 1 → in range), en-2 @2 (touches en-1, dist 1),
        // en-3 @3 (two hexes from en-1, dist 2 → must NOT be caught by radius 1).
        const burst = { id: 'j-burst', name: 'Nova', type: 'Taijutsu', method: 'AOE_BURST', target: 'OPPONENT', ap: 60, range: 4, effectPower: 20 };
        const single = { ...burst, id: 'j-single', method: 'SINGLE' };
        const atkChar = { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 2500 }, jutsu: [burst, single] };
        const defChar = { specialty: 'Taijutsu', level: 100, stats: { taijutsuDefense: 500 } };

        function cast(jutsuId: string) {
            const actors = [
                makeActor('sq-1', 'squad', 0, { character: atkChar as unknown as TowerActor['character'] }),
                makeActor('en-1', 'enemy', 1, { character: defChar as unknown as TowerActor['character'], hp: 100_000, maxHp: 100_000 }),
                makeActor('en-2', 'enemy', 2, { character: defChar as unknown as TowerActor['character'], hp: 100_000, maxHp: 100_000 }),
                makeActor('en-3', 'enemy', 3, { character: defChar as unknown as TowerActor['character'], hp: 100_000, maxHp: 100_000 }),
            ];
            const s = makeSession(actors);
            startRound(s);
            assert.equal(activeActor(s)!.id, 'sq-1');
            const r = applyAction(s, makeFloor('defeat-all'), { actorId: 'sq-1', type: 'jutsu', jutsuId, targetId: 'en-1' }, makeRng(1));
            assert.equal(r.applied, true, `${jutsuId} applies`);
            return {
                primary: 100_000 - getActor(s, 'en-1')!.hp,
                touching: 100_000 - getActor(s, 'en-2')!.hp,
                far: 100_000 - getActor(s, 'en-3')!.hp,
            };
        }

        const b = cast('j-burst');
        const sng = cast('j-single');
        assert.ok(b.primary > 0, 'AOE_BURST damages the primary target');
        assert.ok(b.touching > 0, `AOE_BURST splashes a touching enemy (got ${b.touching})`);
        assert.equal(b.touching, b.primary, 'splash is FULL damage (equals the primary hit)');
        assert.equal(b.far, 0, 'radius 1 does NOT reach an enemy two hexes away');
        assert.equal(sng.touching, 0, 'a SINGLE-method jutsu does NOT splash at all');
    });

    // The 20 starter AOE Burst jutsu each carry ONE rider tag (Wound/Ignition/…). Prove
    // applyAoeSplash applies the tag to EVERY splashed enemy (via applyJutsu), not just the
    // primary — so a real starter AOE jutsu bleeds/ignites the whole touched cluster.
    it('AOE_BURST applies its rider tag (Wound) to splash victims, not just the primary', () => {
        const burst = { id: 'j-wound-aoe', name: 'Shrapnel', type: 'Bukijutsu', method: 'AOE_BURST', target: 'OPPONENT', ap: 60, range: 4, effectPower: 20, tags: [{ name: 'Wound', percent: 14 }] };
        const atkChar = { specialty: 'Bukijutsu', level: 100, stats: { bukijutsuOffense: 2500 }, jutsu: [burst] };
        const defChar = { specialty: 'Bukijutsu', level: 100, stats: { bukijutsuDefense: 500 } };
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: atkChar as unknown as TowerActor['character'] }),
            makeActor('en-1', 'enemy', 1, { character: defChar as unknown as TowerActor['character'], hp: 100_000, maxHp: 100_000 }),
            makeActor('en-2', 'enemy', 2, { character: defChar as unknown as TowerActor['character'], hp: 100_000, maxHp: 100_000 }),
        ];
        const s = makeSession(actors);
        startRound(s);
        const r = applyAction(s, makeFloor('defeat-all'), { actorId: 'sq-1', type: 'jutsu', jutsuId: 'j-wound-aoe', targetId: 'en-1' }, makeRng(1));
        assert.equal(r.applied, true);
        const en2 = getActor(s, 'en-2')!;
        assert.ok(100_000 - en2.hp > 0, 'the touching enemy takes splash damage');
        assert.ok(en2.statuses.some((st) => st.name === 'Wound'), 'the touching enemy ALSO gets the Wound rider tag from the splash');
    });

    it('tower player-side jutsu action matches PvP resolver plus tower resource/AP/cooldown shell', () => {
        const stats = {
            strength: 900,
            speed: 900,
            intelligence: 900,
            willpower: 900,
            ninjutsuOffense: 900,
            ninjutsuDefense: 900,
        };
        const jutsu = {
            id: 'tower-parity-blast',
            name: 'Tower Parity Blast',
            type: 'Ninjutsu',
            target: 'OPPONENT',
            range: 3,
            ap: 60,
            cooldown: 3,
            chakraCost: 25,
            staminaCost: 15,
            effectPower: 32,
            isUtility: false,
            tags: [{ name: 'Wound', percent: 25 }],
        };
        const actor = makeActor('sq-1', 'squad', 0, {
            hp: 5000,
            maxHp: 5000,
            chakra: 1000,
            maxChakra: 1000,
            stamina: 1000,
            maxStamina: 1000,
            character: {
                name: 'sq-1',
                level: 100,
                specialty: 'Ninjutsu',
                stats,
                jutsu: [jutsu],
                jutsuMastery: [{ jutsuId: 'tower-parity-blast', level: 50 }],
            },
        });
        const target = makeActor('boss', 'enemy', 1, {
            hp: 6000,
            maxHp: 6000,
            character: {
                name: 'boss',
                level: 100,
                specialty: 'Ninjutsu',
                stats,
                jutsu: [],
                jutsuMastery: [],
            },
        });
        const expected = applyJutsu(towerActorToPvpFighter(actor), towerActorToPvpFighter(target), jutsu, 1, 'central', 1);

        const s = makeSession([actor, target]);
        startRound(s);
        const applied = applyAction(s, makeFloor('defeat-all'), {
            actorId: 'sq-1',
            type: 'jutsu',
            jutsuId: 'tower-parity-blast',
            targetId: 'boss',
        }, makeRng(1));

        assert.equal(applied.applied, true);
        const afterActor = getActor(s, 'sq-1')!;
        const afterTarget = getActor(s, 'boss')!;
        assert.equal(afterTarget.hp, expected.opponent.hp);
        assert.deepEqual(afterTarget.statuses, expected.opponent.statuses);
        assert.equal(afterTarget.statuses.filter(status => status.name === 'Wound').length, 1, 'Wound applies once and does not double-tick on cast');
        assert.equal(afterActor.hp, expected.self.hp);
        assert.equal(afterActor.chakra, expected.self.chakra - 25);
        assert.equal(afterActor.stamina, expected.self.stamina - 15);
        assert.equal(s.activeAp, 40);
        assert.equal(s.actionsThisTurn, 1);
        assert.equal(afterActor.cooldowns['tower-parity-blast'], 3);
        assert.ok(s.log.some(line => line.includes('sq-1 uses Tower Parity Blast')));
        for (const line of expected.lines) assert.ok(s.log.includes(line), `tower log should include PvP line: ${line}`);
    });

    it('move is adjacent-only and blocked by occupants', () => {
        const s = makeSession(frontline());
        startRound(s);
        const active = activeActor(s)!; // sq-1 at pos 0
        // move two tiles away → rejected (not adjacent)
        assert.equal(applyAction(s, makeFloor('defeat-all'), { actorId: active.id, type: 'move', tile: 2 }, makeRng(1)).applied, false);
        // move onto an occupied adjacent tile (en-1 at pos 1) → blocked
        assert.equal(applyAction(s, makeFloor('defeat-all'), { actorId: active.id, type: 'move', tile: 1 }, makeRng(1)).applied, false);
        // move to an empty adjacent tile (pos 8 is sq-2... use a free neighbor): pos 0 neighbors incl. tiles in row 1
        const free = [16].find(t => !s.actors.some(a => a.pos === t)); // pos 16 = (0,2)
        // pos 0 → pos 8 is the only down neighbor and it's occupied by sq-2; just assert the blocked/adjacent guards held
        assert.ok(free !== undefined);
    });

    it('party scaling cuts enemy HP + damage for a duo', () => {
        const s = makeSession(frontline(), { partySize: 2 });
        const beforeHp = getActor(s, 'en-1')!.maxHp;
        applyPartyScaling(s, makeFloor('defeat-all')); // balanceFor defaults to 4 → factor 0.6
        const en = getActor(s, 'en-1')!;
        assert.equal(en.maxHp, Math.round(beforeHp * 0.6));
        assert.ok(en.hp <= en.maxHp);
        assert.equal(en.character.towerDmgScale, 0.6);
    });

    it('a full party (==balanceFor) is not scaled', () => {
        const s = makeSession(frontline(), { partySize: 4 });
        const before = getActor(s, 'en-1')!.maxHp;
        applyPartyScaling(s, makeFloor('defeat-all'));
        assert.equal(getActor(s, 'en-1')!.maxHp, before);
    });

    it('protect-npc fails the floor if the npc dies', () => {
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: WEAK }),
            makeActor('npc-1', 'npc', 8, { character: WEAK, hp: 50, maxHp: 50 }),
            makeActor('en-1', 'enemy', 9, { character: STRONG }),
            makeActor('en-2', 'enemy', 1, { character: STRONG }),
        ];
        const s = runTowerFloor(
            makeSession(actors, { objectiveKind: 'protect-npc' }),
            makeFloor('protect-npc'),
            makeRng(7),
        );
        assert.equal(s.winner, 'enemy', 'losing the npc (or the squad) fails the floor');
        assert.ok(s.objectiveState.failed);
    });

    it('protect-npc is a timed hold while kill-escort still requires a full clear', () => {
        const build = (objectiveKind: TowerFloor['objective']) => makeSession([
            makeActor('sq-1', 'squad', 0, { character: STRONG }),
            makeActor('npc-1', 'npc', 8, { character: STRONG }),
            makeActor('en-1', 'enemy', 63, { hp: 1_000_000, maxHp: 1_000_000, character: WEAK }),
        ], { objectiveKind });
        const hold = build('protect-npc');
        hold.objectiveState.roundsSurvived = 7;
        checkTowerWinner(hold, makeFloor('protect-npc', { roundBudget: 8 }));
        assert.equal(hold.status, 'active', 'the defense cannot clear a round early');
        hold.objectiveState.roundsSurvived = 8;
        checkTowerWinner(hold, makeFloor('protect-npc', { roundBudget: 8 }));
        assert.equal(hold.winner, 'squad', 'living through the full hold clears with attackers still present');

        const escort = build('kill-escort');
        escort.objectiveState.roundsSurvived = 8;
        checkTowerWinner(escort, makeFloor('kill-escort', { roundBudget: 8 }));
        assert.equal(escort.status, 'active', 'the escort remains a kill-all objective');
    });

    it('computeDamage scales with the offense/defense gap (pins statFactor / MAX_STAT)', () => {
        const j = { effectPower: 10, type: 'Taijutsu', ap: 60 }; // 60 AP = real damage jutsu (40 AP is the utility convention → 0 dmg)
        const att = makeActor('a', 'squad', 0, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 3000 } } });
        const lowDef = makeActor('d1', 'enemy', 1, { character: { stats: { taijutsuDefense: 0 } } });
        const eqDef = makeActor('d2', 'enemy', 1, { character: { stats: { taijutsuDefense: 3000 } } });
        const highDef = makeActor('d3', 'enemy', 1, { character: { stats: { taijutsuDefense: 9000 } } });
        const hi = computeDamage(att, lowDef, j, 50);
        const eq = computeDamage(att, eqDef, j, 50);
        const lo = computeDamage(att, highDef, j, 50);
        assert.ok(hi > eq && eq > lo, `expected ${hi} > ${eq} > ${lo}`);
    });

    it('defeat-boss with no bossId still clears on a full wipe (C1 regression)', () => {
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: STRONG }),
            makeActor('en-1', 'enemy', 1, { character: WEAK, hp: 100, maxHp: 100 }),
        ];
        const s = runTowerFloor(makeSession(actors, { objectiveKind: 'defeat-boss' }), makeFloor('defeat-boss'), makeRng(5));
        assert.equal(s.winner, 'squad', 'a genuine wipe must clear, not score a loss');
    });

    it('reach-tile wins when a squad actor is already on the goal tile (H1 regression)', () => {
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: WEAK }),
            makeActor('en-1', 'enemy', 63, { character: WEAK, hp: 1_000_000, maxHp: 1_000_000 }),
        ];
        const s = makeSession(actors, { objectiveKind: 'reach-tile' });
        startRound(s);
        checkTowerWinner(s, makeFloor('reach-tile', { goalTile: 0 })); // sq-1 spawns on tile 0
        assert.equal(s.winner, 'squad');
    });

    it('applyPartyScaling is idempotent (L1 regression — no double-scaling)', () => {
        const s = makeSession(frontline(), { partySize: 2 });
        const floor = makeFloor('defeat-all');
        applyPartyScaling(s, floor);
        const once = getActor(s, 'en-1')!.maxHp;
        applyPartyScaling(s, floor); // second call must be a no-op
        assert.equal(getActor(s, 'en-1')!.maxHp, once);
    });

    it('runAiUntilHuman advances AI turns and stops at a live human (live driver)', () => {
        const actors = [
            makeActor('sq-0', 'squad', 0, { ai: true, character: STRONG }),   // AI ally
            makeActor('sq-1', 'squad', 8, { ai: false, character: STRONG }),  // live human
            makeActor('en-0', 'enemy', 1, { character: WEAK }),
        ];
        const s = makeSession(actors);
        startRound(s);
        runAiUntilHuman(s, makeFloor('defeat-all'), makeRng(1));
        if (s.status === 'active') {
            assert.equal(activeActor(s)?.ai, false, 'stops on a human turn');
            assert.equal(activeActor(s)?.id, 'sq-1');
        }
    });

    it('runAiUntilHuman never leaves an all-AI run stuck active (timeout safety net)', () => {
        // No live human → the driver must reach a terminal state, never freeze on an active board.
        const s = makeSession([
            makeActor('sq-1', 'squad', 0, { ai: true, character: WEAK }),
            makeActor('en-1', 'enemy', 1, { character: STRONG }),
        ]);
        startRound(s);
        runAiUntilHuman(s, makeFloor('defeat-all'), makeRng(3));
        assert.equal(s.status, 'done', 'an all-AI run always resolves');
    });
});

describe('Battle Towers environmental features (pylons / wards / hazards)', () => {
    // A Fire-jutsu attacker on tile 0 vs a tanky enemy on tile 1 (adjacent). Returns the
    // single-hit damage dealt, optionally with battlefield features in play.
    const FIRE_CASTER = {
        specialty: 'Ninjutsu',
        stats: { ninjutsuOffense: 2500, ninjutsuDefense: 2500 },
        jutsu: [{ id: 'fireball', element: 'Fire', type: 'Ninjutsu', effectPower: 40, ap: 60, range: 1 }],
    };
    function fireballDamage(features: TowerMap['features'], fieldRule?: TowerMap['fieldRule']): number {
        const attacker = makeActor('sq-1', 'squad', 0, { ai: false, ownerSlug: 'me', character: FIRE_CASTER });
        const enemy = makeActor('en-1', 'enemy', 1, { character: WEAK, hp: 100000, maxHp: 100000 });
        const session = makeSession([attacker, enemy], { map: { ...MAP8, features, ...(fieldRule ? { fieldRule } : {}) } });
        startRound(session);
        const res = applyAction(session, makeFloor('defeat-all'),
            { actorId: 'sq-1', type: 'jutsu', jutsuId: 'fireball', targetId: 'en-1' }, makeRng(1));
        assert.ok(res.applied, 'fireball applied');
        return 100000 - getActor(session, 'en-1')!.hp;
    }

    it('a Flame Pylon boosts the matching element and weakens the opposite', () => {
        const base = fireballDamage([]);
        const boosted = fireballDamage([{ kind: 'pylon', tiles: [0], element: 'Fire', weakenElement: 'Water', percent: 25 }]);
        const weakened = fireballDamage([{ kind: 'pylon', tiles: [0], element: 'Water', weakenElement: 'Fire', percent: 25 }]);
        assert.ok(boosted > base, 'Fire on a Fire pylon hits harder');
        assert.ok(weakened < base, 'Fire on a Water pylon hits softer');
        // ~+25% / ~-25% (allow ±1 for floor rounding)
        assert.ok(Math.abs(boosted - Math.floor(base * 1.25)) <= 1, `boosted≈+25% (base ${base}, got ${boosted})`);
        assert.ok(Math.abs(weakened - Math.floor(base * 0.75)) <= 1, `weakened≈-25% (base ${base}, got ${weakened})`);
    });

    it('a pylon does nothing unless the attacker stands on it', () => {
        const base = fireballDamage([]);
        const offPylon = fireballDamage([{ kind: 'pylon', tiles: [5], element: 'Fire', weakenElement: 'Water', percent: 25 }]);
        assert.equal(offPylon, base, 'pylon on a different tile has no effect');
    });

    it('a ward reduces damage taken by a unit on its tile', () => {
        const base = fireballDamage([]);
        const warded = fireballDamage([{ kind: 'ward', tiles: [1], percent: 20 }]); // enemy stands on tile 1
        assert.ok(warded < base, 'a warded target takes less');
        assert.ok(Math.abs(warded - Math.floor(base * 0.8)) <= 1, `ward≈-20% (base ${base}, got ${warded})`);
    });

    it('a hazard chips a unit standing on it at round end', () => {
        const sq = makeActor('sq-1', 'squad', 0, { character: WEAK });   // on the hazard
        const sq2 = makeActor('sq-2', 'squad', 8, { character: WEAK });
        const en = makeActor('en-1', 'enemy', 63, { character: WEAK });  // far corner
        const session = makeSession([sq, sq2, en], { map: { ...MAP8, features: [{ kind: 'hazard', tiles: [0], percent: 10 }] } });
        startRound(session);
        const floor = makeFloor('defeat-all');
        const startHp = getActor(session, 'sq-1')!.hp;
        const r0 = session.round;
        let guard = 0;
        while (session.round === r0 && session.status === 'active' && guard++ < 20) endTurn(session, floor);
        const after = getActor(session, 'sq-1')!.hp;
        assert.equal(after, startHp - Math.floor(startHp * 0.1), 'lost 10% maxHp to the hazard at round end');
        assert.ok(getActor(session, 'sq-2')!.hp === startHp, 'a unit off the hazard is untouched');
    });

    it('floor-wide buff and debuff rules use the shared damage statuses', () => {
        const base = fireballDamage([]);
        const buffed = fireballDamage([], { kind: 'buff', tag: 'Increase Damage Given', percent: 15 });
        // Shared amp tags use the canonical diminishing-returns pool (K_AMP=0.5),
        // not a raw linear multiplier.
        const amp = (raw: number) => 1 + raw / (raw + 0.5);
        assert.ok(Math.abs(buffed - Math.floor(base * amp(0.15))) <= 1, `field buff uses the shared amp pool (base ${base}, got ${buffed})`);

        const squad = makeActor('sq-1', 'squad', 1, { ai: false, ownerSlug: 'me', character: WEAK, hp: 100000, maxHp: 100000 });
        const enemy = makeActor('en-1', 'enemy', 0, { character: FIRE_CASTER });
        const exposedSession = makeSession([enemy, squad], {
            map: { ...MAP8, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 10 } },
        });
        startRound(exposedSession);
        exposedSession.activeIndex = exposedSession.turnQueue.indexOf('en-1');
        const result = applyAction(exposedSession, makeFloor('defeat-all'),
            { actorId: 'en-1', type: 'jutsu', jutsuId: 'fireball', targetId: 'sq-1' }, makeRng(1));
        assert.ok(result.applied, 'enemy fireball applied');
        const exposed = 100000 - getActor(exposedSession, 'sq-1')!.hp;
        assert.ok(Math.abs(exposed - Math.floor(base * amp(0.10))) <= 1, `field debuff uses the shared amp pool (base ${base}, got ${exposed})`);
        assert.equal(getActor(exposedSession, 'en-1')!.statuses.some(s => s.source === 'tower-field'), false,
            'a player debuff is not also granted to enemies');
    });

    it('a Drain field rule reuses the shared HP+chakra tick each round', () => {
        const sq = makeActor('sq-1', 'squad', 0, { character: WEAK });
        const enemy = makeActor('en-1', 'enemy', 63, { character: WEAK });
        const session = makeSession([sq, enemy], {
            map: { ...MAP8, fieldRule: { kind: 'hazard', tag: 'Drain', percent: 5 } },
        });
        const floor = makeFloor('defeat-all');
        startRound(session);
        assert.equal(getActor(session, 'sq-1')!.statuses.find(s => s.source === 'tower-field')?.name, 'Drain');
        assert.equal(getActor(session, 'en-1')!.statuses.some(s => s.source === 'tower-field'), false,
            'the floor hazard challenges the squad rather than draining enemies for free');
        const hp = getActor(session, 'sq-1')!.hp;
        const round = session.round;
        let guard = 0;
        while (session.round === round && session.status === 'active' && guard++ < 20) endTurn(session, floor);
        assert.equal(getActor(session, 'sq-1')!.hp, hp - 5);
        // Chakra is subsequently refreshed by the next-round resource hook; the
        // shared Drain log pins that the HP+chakra tick itself executed.
        assert.ok(session.log.some(line => line.includes('drained 5 HP+chakra')));
    });

    it('features stay deterministic (settle recompute reproduces them byte-for-byte)', () => {
        const features: TowerMap['features'] = [
            { kind: 'pylon', tiles: [3], element: 'Fire', weakenElement: 'Water', percent: 25 },
            { kind: 'ward', tiles: [10], percent: 20 },
            { kind: 'hazard', tiles: [4], percent: 8 },
        ];
        const build = () => makeSession(frontline(), { map: { ...MAP8, features } });
        const a = runTowerFloor(build(), makeFloor('defeat-all'), makeRng(777));
        const b = runTowerFloor(build(), makeFloor('defeat-all'), makeRng(777));
        assert.equal(JSON.stringify(a), JSON.stringify(b));
    });
});

describe('Battle Towers boss mechanics (bulwark / regen / summon / enrage)', () => {
    function attacker() {
        return makeActor('sq-1', 'squad', 0, { ai: false, ownerSlug: 'me', character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 } } });
    }
    const bossFloor = makeFloor('defeat-boss', { id: 5 });

    it('bulwark: boss takes HALF damage while a guard lives, full when it is alone', () => {
        const hit = (guardHp: number) => {
            const boss = makeActor('boss', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, character: { specialty: 'Taijutsu', stats: { taijutsuDefense: 200 }, mechanic: 'bulwark' } });
            const guard = makeActor('en-1', 'enemy', 8, { hp: guardHp, maxHp: Math.max(1, guardHp), character: WEAK });
            const s = makeSession([attacker(), boss, guard], { objectiveKind: 'defeat-boss', bossId: 'boss' });
            startRound(s);
            applyAction(s, bossFloor, { actorId: 'sq-1', type: 'attack', targetId: 'boss' }, makeRng(1));
            return 1_000_000 - getActor(s, 'boss')!.hp;
        };
        const guarded = hit(100);   // a guard is alive → bulwark halves it
        const alone = hit(0);       // guard already down → full damage
        assert.ok(guarded > 0 && alone > 0);
        assert.ok(Math.abs(guarded - Math.floor(alone * 0.5)) <= 1, `guarded≈half (${guarded} vs ${alone})`);
    });

    it('enrage: a stack ramps the boss outgoing damage ~+35%', () => {
        const bossHit = (enrage: number) => {
            const boss = makeActor('boss', 'enemy', 1, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 }, mechanic: 'enrage', enrage } });
            const tgt = makeActor('sq-1', 'squad', 0, { hp: 1_000_000, maxHp: 1_000_000, character: WEAK });
            const s = makeSession([tgt, boss], { objectiveKind: 'defeat-boss', bossId: 'boss' });
            startRound(s); endTurn(s, bossFloor); // advance to the boss's turn
            applyAction(s, bossFloor, { actorId: 'boss', type: 'attack', targetId: 'sq-1' }, makeRng(1));
            return 1_000_000 - getActor(s, 'sq-1')!.hp;
        };
        const base = bossHit(0);
        const raged = bossHit(1);
        assert.ok(raged > base, 'enraged boss hits harder');
        assert.ok(Math.abs(raged - Math.floor(base * 1.35)) <= 1, `enrage≈+35% (${base} → ${raged})`);
    });

    it('summon: crossing a phase gate spawns reinforcements', () => {
        const boss = makeActor('boss', 'enemy', 1, {
            hp: 610, maxHp: 1000,
            character: {
                specialty: 'Taijutsu', stats: { taijutsuDefense: 200 }, mechanic: 'summon', summonCount: 2,
                summonTemplate: {
                    name: 'Add', specialty: 'Ninjutsu', level: 80, hp: 200, stats: { ninjutsuOffense: 777 },
                    visual: 'acolyte', role: 'controller', targetMode: 'support', armorRawDR: 0.2,
                    maxChakra: 345, maxStamina: 234,
                    jutsu: [{ id: 'add-bolt', name: 'Add Bolt', type: 'Ninjutsu', ap: 40, range: 3, effectPower: 20 }],
                },
            },
        });
        const s = makeSession([attacker(), boss], { objectiveKind: 'defeat-boss', bossId: 'boss', bossPhases: [60] });
        startRound(s);
        applyAction(s, bossFloor, { actorId: 'sq-1', type: 'attack', targetId: 'boss' }, makeRng(1));
        assert.ok(getActor(s, 'boss')!.hp < 600, 'boss dropped past the 60% gate');
        const adds = s.actors.filter(a => a.id.startsWith('add-'));
        assert.ok(adds.length >= 1 && adds.every(a => a.side === 'enemy'), 'spawned enemy adds');
        assert.ok(adds.every(a => a.character.combatRole === 'controller' && a.character.aiTargetMode === 'support'));
        assert.ok(adds.every(a => Array.isArray(a.character.jutsu) && a.character.jutsu.length === 1), 'authored add kit survives phase spawning');
        assert.ok(adds.every(a => a.maxChakra === 345 && a.maxStamina === 234 && a.character.armorRawDR === 0.2));
    });

    it('summon: surrounding the boss cannot suppress its phase reinforcements', () => {
        const bossPos = 27;
        const adjacent = towerNeighbors(bossPos, 8, 8);
        const attackerPos = adjacent[0]!;
        const boss = makeActor('boss', 'enemy', bossPos, {
            hp: 610, maxHp: 1000,
            character: {
                specialty: 'Taijutsu', stats: { taijutsuDefense: 200 }, mechanic: 'summon', summonCount: 3,
                summonTemplate: { name: 'Add', specialty: 'Taijutsu', level: 40, hp: 200, stats: {}, visual: 'bandit' },
            },
        });
        const blockers = adjacent.slice(1).map((pos, index) => makeActor(`box-${index}`, 'enemy', pos));
        const s = makeSession([
            makeActor('sq-1', 'squad', attackerPos, { ai: false, character: STRONG }),
            boss,
            ...blockers,
        ], { objectiveKind: 'defeat-boss', bossId: 'boss', bossPhases: [60] });
        startRound(s);
        assert.ok(applyAction(s, bossFloor, { actorId: 'sq-1', type: 'attack', targetId: 'boss' }, makeRng(1)).applied);
        const adds = s.actors.filter(actor => actor.id.startsWith('add-'));
        assert.equal(adds.length, 3, 'the full authored phase wave arrives');
        assert.ok(adds.every(actor => hexDistance(actor.pos, bossPos, 8) >= 2), 'boxed portals expand to the nearest legal ring');
    });

    it('regen: the boss heals at round end', () => {
        const boss = makeActor('boss', 'enemy', 1, { hp: 500, maxHp: 1000, character: { specialty: 'Taijutsu', stats: {}, mechanic: 'regen' } });
        const s = makeSession([makeActor('sq-1', 'squad', 0, { character: WEAK }), makeActor('sq-2', 'squad', 8, { character: WEAK }), boss], { objectiveKind: 'defeat-boss', bossId: 'boss' });
        startRound(s);
        const r0 = s.round; let guard = 0;
        while (s.round === r0 && s.status === 'active' && guard++ < 20) endTurn(s, bossFloor);
        assert.ok(getActor(s, 'boss')!.hp > 500, 'regen healed the boss at round end');
    });

    it('SPIRE regen scales with CURRENT hp (self-limiting); STORY regen is % of max (byte-identical)', () => {
        const seal = { ascensionTier: 5, hpMult: 1, dmgMult: 1, roundCap: 20, enrageCap: 2, modifierStack: [] };
        // One round of pure regen (squad does nothing — endTurn just cycles the queue), measured as the boss's HP gain.
        const oneRoundHeal = (curHp: number, spire: boolean): number => {
            const boss = makeActor('boss', 'enemy', 40, { hp: curHp, maxHp: 10000, character: { specialty: 'Taijutsu', stats: {}, mechanic: 'regen' } });
            const s = makeSession([makeActor('sq-1', 'squad', 0, { character: WEAK }), boss], { objectiveKind: 'defeat-boss', bossId: 'boss', ...(spire ? { ascension: seal } : {}) });
            startRound(s);
            const r0 = s.round; let g = 0;
            while (s.round === r0 && s.status === 'active' && g++ < 30) endTurn(s, bossFloor);
            return getActor(s, 'boss')!.hp - curHp;
        };
        const spireLow = oneRoundHeal(1000, true);   // spire: 7% of 1000 ≈ 70
        const spireHigh = oneRoundHeal(9000, true);  // spire: 7% of 9000 ≈ 630
        const storyLow = oneRoundHeal(1000, false);  // story: 7% of MAX (10000) ≈ 700 — unchanged
        assert.ok(spireHigh > spireLow + 300, `spire regen self-limits with current hp (${spireHigh} >> ${spireLow})`);
        assert.ok(spireLow > 0 && spireLow < 200, `a wounded spire boss regens little (${spireLow})`);
        assert.ok(storyLow > 600, `story regen stays % of max, byte-identical (${storyLow})`);
    });
});

// ─── Real loadout: resource costs / cooldowns / weapons / consumables / terrain ───
describe('Battle Towers loadout combat (jutsu resources / cooldowns / weapons / items)', () => {
    const floor = makeFloor('defeat-all');
    // sq-1 (caster) adjacent to a high-HP dummy enemy that survives the fight.
    function caster(jutsu: Record<string, unknown>[], over: Record<string, unknown> = {}) {
        return makeActor('sq-1', 'squad', 0, { chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, character: { specialty: 'Ninjutsu', stats: { ninjutsuOffense: 2000 }, jutsu, ...over } });
    }
    const bigEnemy = () => makeActor('en-1', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, character: { stats: {} } });

    it('a jutsu deducts its chakra + stamina cost', () => {
        const sq = caster([{ id: 'fb', type: 'Ninjutsu', effectPower: 40, ap: 60, range: 2, chakraCost: 30, staminaCost: 10 }]);
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'fb', targetId: 'en-1' }, makeRng(1));
        assert.ok(r.applied);
        assert.equal(getActor(s, 'sq-1')!.chakra, 70);
        assert.equal(getActor(s, 'sq-1')!.stamina, 90);
        assert.ok(getActor(s, 'en-1')!.hp < 1_000_000, 'dealt real damage');
    });

    it('blocks a jutsu the actor cannot afford (chakra)', () => {
        const sq = caster([{ id: 'fb', type: 'Ninjutsu', effectPower: 40, ap: 60, range: 2, chakraCost: 300 }], {});
        sq.chakra = 0; // 0 + v2 turn-start regen still < 300 → unaffordable under both flags
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'fb', targetId: 'en-1' }, makeRng(1));
        assert.equal(r.applied, false);
        assert.equal(r.reason, 'no-chakra');
    });

    it('arms a cooldown on cast, blocks reuse, then ticks down on the next turn', () => {
        const sq = caster([{ id: 'cdj', type: 'Ninjutsu', effectPower: 30, ap: 30, range: 2, cooldown: 2 }]);
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'cdj', targetId: 'en-1' }, makeRng(1)).applied);
        assert.equal(getActor(s, 'sq-1')!.cooldowns['cdj'], 2, 'cooldown armed');
        const again = applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'cdj', targetId: 'en-1' }, makeRng(1));
        assert.equal(again.reason, 'on-cooldown');
        // sq-1's turn ends → enemy's "turn" → round rolls over → sq-1 up again (ticks its cd).
        endTurn(s, floor); endTurn(s, floor);
        assert.equal(activeActor(s)!.id, 'sq-1');
        assert.equal(getActor(s, 'sq-1')!.cooldowns['cdj'], 1, 'cooldown ticked down a turn');
    });

    it('a 40-AP utility jutsu deals zero direct damage', () => {
        const sq = caster([{ id: 'buff', type: 'Ninjutsu', effectPower: 40, ap: 40, range: 2 }]);
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'buff', targetId: 'en-1' }, makeRng(1));
        assert.ok(r.applied);
        assert.equal(getActor(s, 'en-1')!.hp, 1_000_000, 'utility jutsu does no phantom damage');
    });

    it('an equipped weapon strikes for its weaponEp', () => {
        const sq = makeActor('sq-1', 'squad', 0, { character: { specialty: 'Bukijutsu', stats: { bukijutsuOffense: 1500 }, pvpItems: [{ id: 'sword', slot: 'hand', weaponEp: 30, weaponRange: 1, apCost: 40 }], equipment: { hand: 'sword' } } });
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'sword' }, makeRng(1));
        assert.ok(r.applied, 'weapon attack applied');
        assert.ok(getActor(s, 'en-1')!.hp < 1_000_000, 'weapon dealt damage');
    });

    it('weapon use applies PvP-style cooldowns before another swing', () => {
        const sq = makeActor('sq-1', 'squad', 0, { character: { specialty: 'Bukijutsu', stats: { bukijutsuOffense: 1500 }, pvpItems: [{ id: 'sword', slot: 'hand', weaponEp: 30, weaponRange: 1, apCost: 20, weaponCooldown: 5 }], equipment: { hand: 'sword' } } });
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'sword' }, makeRng(1)).applied);
        assert.equal(getActor(s, 'sq-1')!.cooldowns.sword, 5);
        assert.equal(applyAction(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'sword' }, makeRng(1)).reason, 'on-cooldown');
    });

    it('a thrown weapon spends a charge and respects cooldown before ammo re-check', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            itemCharges: { kunai: 1 },
            character: { specialty: 'Bukijutsu', stats: { bukijutsuOffense: 1500 }, pvpItems: [{ id: 'kunai', slot: 'thrown', weaponEp: 20, weaponRange: 4, apCost: 40 }], equipment: { thrown: 'kunai' } },
        });
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'kunai' }, makeRng(1)).applied);
        assert.equal(getActor(s, 'sq-1')!.itemCharges!['kunai'], 0, 'charge spent');
        assert.equal(getActor(s, 'sq-1')!.itemsUsed!['kunai'], 1, 'spent throwable recorded for settlement');
        const out = applyAction(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'kunai' }, makeRng(1));
        assert.equal(out.reason, 'on-cooldown');
    });

    it('a thrown weapon with no sealed charge is rejected before spending', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            itemCharges: { kunai: 0 },
            character: { specialty: 'Bukijutsu', stats: { bukijutsuOffense: 1500 }, pvpItems: [{ id: 'kunai', slot: 'thrown', weaponEp: 20, weaponRange: 4, apCost: 40 }], equipment: { thrown: 'kunai' } },
        });
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.equal(applyAction(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'kunai' }, makeRng(1)).reason, 'out-of-ammo');
    });

    it('a potion restores chakra/stamina and spends a charge', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            chakra: 10, maxChakra: 100, stamina: 50, maxStamina: 100, itemCharges: { pot: 2 },
            character: { specialty: 'Ninjutsu', stats: {}, pvpItems: [{ id: 'pot', slot: 'potion', restoreChakra: 50, restoreStamina: 20, apCost: 35 }], equipment: { potion: 'pot' } },
        });
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'item', itemId: 'pot' }, makeRng(1));
        assert.ok(r.applied);
        // v2 regenerates chakra/stamina at turn start (before the potion), so totals are higher.
        assert.equal(getActor(s, 'sq-1')!.chakra, COMBAT_RESOURCES_V2 ? Math.min(100, 10 + v2ResourceRegen(1) + 50) : 60);
        assert.equal(getActor(s, 'sq-1')!.stamina, COMBAT_RESOURCES_V2 ? Math.min(100, 50 + v2ResourceRegen(1) + 20) : 70);
        assert.equal(getActor(s, 'sq-1')!.itemCharges!['pot'], 1, 'one charge spent');
        assert.equal(getActor(s, 'sq-1')!.itemsUsed!['pot'], 1, 'spent potion recorded for settlement');
    });

    it('combat-item cooldowns block reuse without spending an extra charge', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            itemCharges: { pill: 2 },
            character: { specialty: 'Ninjutsu', stats: {}, pvpItems: [{ id: 'pill', slot: 'item', weaponTags: [{ name: 'Increase Damage Given', percent: 15 }], apCost: 20, weaponCooldown: 5 }], equipment: { item: 'pill' } },
        });
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'item', itemId: 'pill' }, makeRng(1)).applied);
        assert.equal(getActor(s, 'sq-1')!.cooldowns.pill, 5);
        assert.equal(getActor(s, 'sq-1')!.itemCharges!.pill, 1);
        assert.equal(getActor(s, 'sq-1')!.itemsUsed!.pill, 1);
        assert.equal(applyAction(s, floor, { actorId: 'sq-1', type: 'item', itemId: 'pill' }, makeRng(1)).reason, 'on-cooldown');
        assert.equal(getActor(s, 'sq-1')!.itemCharges!.pill, 1, 'cooldown rejection did not spend a charge');
        assert.equal(getActor(s, 'sq-1')!.itemsUsed!.pill, 1, 'cooldown rejection did not record another spend');
    });

    it('Smoke Bomb applies its both-target damage-given debuff and records the spend', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            itemCharges: { smoke: 1 },
            character: { specialty: 'Ninjutsu', stats: {}, pvpItems: [{ id: 'smoke', name: 'Smoke Bomb', slot: 'item', weaponEffect: 'Decrease Damage Given', weaponEffectValue: 100, weaponEffectTarget: 'both', apCost: 20, weaponCooldown: 9 }], equipment: { item: 'smoke' } },
        });
        const en = bigEnemy();
        const s = makeSession([sq, en]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'item', itemId: 'smoke' }, makeRng(1)).applied);
        const actor = getActor(s, 'sq-1')!;
        const enemy = getActor(s, 'en-1')!;
        assert.ok(actor.statuses.some(st => st.name === 'Decrease Damage Given' && st.kind === 'negative' && st.percent === 100), 'user is smoke-debuffed');
        assert.ok(enemy.statuses.some(st => st.name === 'Decrease Damage Given' && st.kind === 'negative' && st.percent === 100), 'enemy is smoke-debuffed');
        assert.equal(actor.itemCharges!.smoke, 0);
        assert.equal(actor.itemsUsed!.smoke, 1);
        assert.equal(actor.cooldowns.smoke, 9);
    });

    it('biome terrain gives the matching discipline +10%', () => {
        const j = { id: 'tj', type: 'Taijutsu', effectPower: 40, ap: 60, range: 1 };
        const hit = (biome: string) => {
            const sq = makeActor('sq-1', 'squad', 0, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 1500 }, jutsu: [j] } });
            const en = makeActor('en-1', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, character: { stats: {} } });
            const s = makeSession([sq, en], { map: { ...MAP8, biome } });
            startRound(s);
            applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'tj', targetId: 'en-1' }, makeRng(1));
            return 1_000_000 - getActor(s, 'en-1')!.hp;
        };
        const forest = hit('forest');   // Taijutsu match → 1.1×
        const central = hit('central'); // no terrain bonus
        assert.ok(forest > central, 'forest boosts Taijutsu');
        assert.ok(Math.abs(forest - Math.floor(central * 1.1)) <= 2, `forest≈+10% (${central} → ${forest})`);
    });
});

// ─── Tag / status combat (reuses PvP applyJutsu + applyDoTs/tickStatuses) ─────
describe('Battle Towers tag/status combat (heal / DoT / buff / stun / self-cast)', () => {
    const floor = makeFloor('defeat-all');
    function caster(jutsu: Record<string, unknown>[], over: Partial<TowerActor> = {}) {
        return makeActor('sq-1', 'squad', 0, { chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, character: { specialty: 'Ninjutsu', stats: { ninjutsuOffense: 1500 }, jutsu }, ...over });
    }
    const bigEnemy = (over: Partial<TowerActor> = {}) => makeActor('en-1', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, chakra: 1000, maxChakra: 1000, character: { stats: {} }, ...over });
    const cast = (s: TowerSession, jutsuId: string, targetId = 'en-1') => applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId, targetId }, makeRng(1));

    it('a Heal-tag jutsu heals the caster', () => {
        const sq = caster([{ id: 'mend', name: 'Mend', type: 'Ninjutsu', ap: 40, range: 2, target: 'OPPONENT', tags: [{ name: 'Heal' }] }], { hp: 200, maxHp: 5000 });
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.ok(cast(s, 'mend').applied);
        assert.ok(getActor(s, 'sq-1')!.hp > 200, 'caster healed');
    });

    it('a self-target jutsu resolves on the caster (no foe needed)', () => {
        const sq = caster([{ id: 'guard', name: 'Inner Guard', type: 'Ninjutsu', ap: 40, range: 0, target: 'SELF', tags: [{ name: 'Heal' }] }], { hp: 100, maxHp: 5000 });
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        // targetId is ignored for a SELF jutsu — it always resolves on the caster.
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'guard', targetId: 'sq-1' }, makeRng(1));
        assert.ok(r.applied);
        assert.ok(getActor(s, 'sq-1')!.hp > 100, 'self-heal applied');
    });

    it('a Stun-tag jutsu applies Stun to the enemy', () => {
        const sq = caster([{ id: 'flash', name: 'Flash', type: 'Ninjutsu', ap: 40, range: 2, target: 'OPPONENT', tags: [{ name: 'Stun' }] }]);
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.ok(cast(s, 'flash').applied);
        assert.ok(getActor(s, 'en-1')!.statuses.some(st => st.name === 'Stun'), 'enemy is stunned');
    });

    it('an Increase-Damage-Given jutsu buffs the caster', () => {
        const sq = caster([{ id: 'rage', name: 'Rage', type: 'Ninjutsu', ap: 40, range: 2, target: 'OPPONENT', tags: [{ name: 'Increase Damage Given', percent: 30 }] }]);
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.ok(cast(s, 'rage').applied);
        assert.ok(getActor(s, 'sq-1')!.statuses.some(st => st.name === 'Increase Damage Given'), 'caster gains the buff');
    });

    it('Poison bleeds the enemy over rounds (DoT ticks at round end)', () => {
        const sq = caster([{ id: 'venom', name: 'Venom', type: 'Ninjutsu', ap: 40, range: 2, target: 'OPPONENT', tags: [{ name: 'Poison', percent: 10 }] }]);
        const s = makeSession([sq, bigEnemy()]);
        startRound(s);
        assert.ok(cast(s, 'venom').applied);
        assert.ok(getActor(s, 'en-1')!.statuses.some(st => st.name === 'Poison'), 'enemy poisoned');
        // Drive rounds: Poison defers one round (activeRound = round+1), then ticks at round end.
        let guard = 0;
        while (s.round < 3 && s.status === 'active' && guard++ < 60) endTurn(s, floor);
        if (COMBAT_RESOURCES_V2) {
            // v2: poison feeds on EXERTION — a turtling enemy (no costed casts) takes none.
            assert.equal(getActor(s, 'en-1')!.hp, 1_000_000, 'v2 poison does not bleed a turtling target');
        } else {
            assert.ok(getActor(s, 'en-1')!.hp < 1_000_000, 'poison bled the enemy');
        }
    });
});

// ─── AOE jutsu + full consumables (heal/buff potions) ────────────────────────
describe('Battle Towers AOE + consumables', () => {
    const floor = makeFloor('defeat-all');

    it('an AOE jutsu splashes the foes around the struck target', () => {
        const sq = makeActor('sq-1', 'squad', 0, { hp: 5000, maxHp: 5000, chakra: 300, maxChakra: 300, character: { specialty: 'Ninjutsu', stats: { ninjutsuOffense: 1500 }, jutsu: [{ id: 'nova', name: 'Nova', type: 'Ninjutsu', ap: 60, range: 3, effectPower: 60, method: 'AOE_CIRCLE' }] } });
        const e1 = makeActor('en-1', 'enemy', 1, { hp: 100_000, maxHp: 100_000, character: { stats: {} } });
        const e2 = makeActor('en-2', 'enemy', 2, { hp: 100_000, maxHp: 100_000, character: { stats: {} } });
        const s = makeSession([sq, e1, e2]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'nova', targetId: 'en-1' }, makeRng(1)).applied);
        assert.ok(getActor(s, 'en-1')!.hp < 100_000, 'primary target hit');
        assert.ok(getActor(s, 'en-2')!.hp < 100_000, 'adjacent foe caught in the blast');
    });

    it('a single-target jutsu does NOT splash neighbors', () => {
        const sq = makeActor('sq-1', 'squad', 0, { hp: 5000, maxHp: 5000, chakra: 300, maxChakra: 300, character: { specialty: 'Ninjutsu', stats: { ninjutsuOffense: 1500 }, jutsu: [{ id: 'bolt', name: 'Bolt', type: 'Ninjutsu', ap: 60, range: 3, effectPower: 60, method: 'SINGLE' }] } });
        const e1 = makeActor('en-1', 'enemy', 1, { hp: 100_000, maxHp: 100_000, character: { stats: {} } });
        const e2 = makeActor('en-2', 'enemy', 2, { hp: 100_000, maxHp: 100_000, character: { stats: {} } });
        const s = makeSession([sq, e1, e2]);
        startRound(s);
        applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'bolt', targetId: 'en-1' }, makeRng(1));
        assert.equal(getActor(s, 'en-2')!.hp, 100_000, 'neighbor untouched by a single-target jutsu');
    });

    it('a Heal-tag potion (no restore values) heals the caster + spends a charge', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            hp: 200, maxHp: 5000, itemCharges: { 'heal-pot': 2 },
            character: { specialty: 'Ninjutsu', stats: {}, jutsu: [], pvpItems: [{ id: 'heal-pot', name: 'Salve', slot: 'potion', weaponTags: [{ name: 'Heal' }], apCost: 35 }], equipment: { potion: 'heal-pot' } },
        });
        const en = makeActor('en-1', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, character: { stats: {} } });
        const s = makeSession([sq, en]);
        startRound(s);
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'item', itemId: 'heal-pot' }, makeRng(1));
        assert.ok(r.applied);
        assert.ok(getActor(s, 'sq-1')!.hp > 200, 'heal potion healed the caster');
        assert.equal(getActor(s, 'sq-1')!.itemCharges!['heal-pot'], 1, 'charge spent');
    });

    it('a ground-target jutsu places a persistent zone that poisons units standing in it', () => {
        const sq = makeActor('sq-1', 'squad', 0, { hp: 5000, maxHp: 5000, chakra: 300, maxChakra: 300, character: { specialty: 'Ninjutsu', stats: {}, jutsu: [{ id: 'mire', name: 'Poison Mire', type: 'Ninjutsu', ap: 60, range: 4, target: 'EMPTY_GROUND', tags: [{ name: 'Poison', percent: 10 }] }] } });
        const en = makeActor('en-1', 'enemy', 3, { hp: 1_000_000, maxHp: 1_000_000, chakra: 1000, maxChakra: 1000, character: { stats: {} } });
        const s = makeSession([sq, en]);
        startRound(s);
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'mire', tile: 3 }, makeRng(1));
        assert.ok(r.applied, 'ground jutsu placed at the tile');
        assert.equal((s.groundEffects ?? []).length, 1, 'a persistent zone was created');
        assert.ok(getActor(s, 'en-1')!.statuses.some(st => st.name === 'Poison'), 'a unit standing in the zone is poisoned on cast');
        // Drive rounds: the zone re-applies + the poison bleeds, then the zone expires.
        let guard = 0;
        while (s.round < 3 && s.status === 'active' && guard++ < 60) endTurn(s, floor);
        if (COMBAT_RESOURCES_V2) {
            assert.equal(getActor(s, 'en-1')!.hp, 1_000_000, 'v2 zone poison does not bleed a turtling target');
        } else {
            assert.ok(getActor(s, 'en-1')!.hp < 1_000_000, 'the zone bled the enemy');
        }
        assert.equal((s.groundEffects ?? []).length, 0, 'the 2-round zone expired');
    });

    it('rejects an out-of-range ground jutsu; a no-ground-tag ground jutsu STRIKES the tile (PvE parity) instead of bouncing', () => {
        // A damage-dealing EMPTY_GROUND jutsu with no ground-effect tag (Wound, not Poison/
        // Recoil/Decrease Damage Given) used to bounce with `no-ground-tags`. It now resolves
        // as a direct strike on the hostile standing on the target tile — matching the PvE Arena.
        const jutsu = [
            { id: 'far', name: 'Far Mire', type: 'Ninjutsu', ap: 60, range: 2, target: 'EMPTY_GROUND', tags: [{ name: 'Poison' }] },
            { id: 'strike', name: 'Ambush Strike', type: 'Ninjutsu', ap: 60, range: 4, effectPower: 40, target: 'EMPTY_GROUND', method: 'SINGLE', tags: [{ name: 'Wound', percent: 20 }] },
        ];
        const mkSq = () => makeActor('sq-1', 'squad', 0, { chakra: 300, maxChakra: 300, character: { specialty: 'Ninjutsu', level: 100, stats: { ninjutsuOffense: 2500, ninjutsuDefense: 2500 }, jutsu } });
        const s = makeSession([mkSq(), makeActor('en-1', 'enemy', 3, { hp: 9999, maxHp: 9999, character: { specialty: 'Taijutsu', level: 100, stats: { taijutsuDefense: 200 } } })]);
        startRound(s);
        // Out of range still rejects.
        assert.equal(applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'far', tile: 60 }, makeRng(1)).reason, 'out-of-range');
        assert.equal(applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'far', tile: Number.NaN }, makeRng(1)).reason, 'bad-tile');
        assert.equal(getActor(s, 'sq-1')!.pos, 0, 'malformed ground anchors cannot corrupt actor position');
        // No ground-effect tag, but lands ON the enemy → strikes it instead of bouncing.
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'strike', tile: 3 }, makeRng(1));
        assert.ok(r.applied, 'no-ground-tag ground jutsu resolves (no no-ground-tags bounce)');
        assert.ok(getActor(s, 'en-1')!.hp < 9999, 'the enemy on the target tile was struck');
        assert.equal((s.groundEffects ?? []).length, 0, 'a non-ground-tagged jutsu lays no persistent zone');
        // Cast on an EMPTY tile → whiffs harmlessly (still applies / costs AP), never bounces.
        const s2 = makeSession([mkSq(), makeActor('en-1', 'enemy', 1, { hp: 9999, maxHp: 9999, character: { stats: {} } })]);
        startRound(s2);
        const whiff = applyAction(s2, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'strike', tile: 2 }, makeRng(1));
        assert.ok(whiff.applied, 'empty-tile ground jutsu whiffs but still applies');
        assert.equal(getActor(s2, 'en-1')!.hp, 9999, 'a whiff deals no damage to the off-tile enemy');
    });

    it('a Move-tag jutsu (Flicker) relocates the caster to an open tile instead of bouncing on no-ground-tags', () => {
        // Flicker: EMPTY_GROUND target (normalizeJutsu forces this for any Move jutsu) +
        // a Move tag that is NOT a ground-effect tag — so it must repose the caster, not lay a zone.
        const flicker = { id: 'flicker', name: 'Flicker', type: 'Taijutsu', ap: 20, range: 5, cooldown: 2, chakraCost: 25, staminaCost: 25, target: 'EMPTY_GROUND', method: 'SINGLE', tags: [{ name: 'Move', percent: 0 }] };
        const mk = () => makeSession([
            makeActor('sq-1', 'squad', 0, { chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, character: { specialty: 'Taijutsu', stats: {}, jutsu: [flicker] } }),
            makeActor('en-1', 'enemy', 1, { hp: 9999, maxHp: 9999, character: { stats: {} } }),
        ]);
        // Happy path: flicker to an open tile in range.
        const s = mk(); startRound(s);
        const r = applyAction(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'flicker', tile: 3 }, makeRng(1));
        assert.ok(r.applied, 'Flicker applied (no no-ground-tags bounce)');
        assert.equal(getActor(s, 'sq-1')!.pos, 3, 'caster relocated to the target tile');
        assert.equal((s.groundEffects ?? []).length, 0, 'a pure Move jutsu lays no ground zone');
        assert.equal(getActor(s, 'sq-1')!.chakra, 275, 'chakra spent');
        // Rejections: out of range, onto an occupant, onto the caster's own tile.
        const s2 = mk(); startRound(s2);
        assert.equal(applyAction(s2, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'flicker', tile: 63 }, makeRng(1)).reason, 'out-of-range');
        assert.equal(applyAction(s2, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'flicker', tile: 1 }, makeRng(1)).reason, 'blocked');
        assert.equal(applyAction(s2, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'flicker', tile: 0 }, makeRng(1)).reason, 'bad-tile');
        assert.equal(applyAction(s2, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'flicker', tile: Number.NaN }, makeRng(1)).reason, 'bad-tile');
        assert.equal(getActor(s2, 'sq-1')!.pos, 0, 'malformed movement anchors cannot corrupt actor position');
    });
});

// ─── Basic actions: heal / cleanse / clear / dash (ported from PvP) ───────────
describe('Battle Towers basic actions', () => {
    const floor = makeFloor('defeat-all');

    it('heal restores 10% max HP, costs chakra, goes on cooldown', () => {
        const sq = makeActor('sq-1', 'squad', 0, { hp: 1000, maxHp: 5000, chakra: 100, maxChakra: 100, character: { specialty: 'Ninjutsu', stats: {} } });
        const s = makeSession([sq, makeActor('en-1', 'enemy', 1, { character: WEAK })]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'heal' }, makeRng(1)).applied);
        assert.equal(getActor(s, 'sq-1')!.hp, 1500);
        assert.equal(getActor(s, 'sq-1')!.chakra, 90);
        assert.equal(applyAction(s, floor, { actorId: 'sq-1', type: 'heal' }, makeRng(1)).reason, 'on-cooldown');
    });

    it('cleanse strips the actor\'s own debuffs but keeps buffs', () => {
        const sq = makeActor('sq-1', 'squad', 0, { statuses: [{ name: 'Poison', rounds: 2, kind: 'negative' }, { name: 'Increase Damage Given', rounds: 2, kind: 'positive' }], character: { specialty: 'Ninjutsu', stats: {} } });
        const s = makeSession([sq, makeActor('en-1', 'enemy', 1, { character: WEAK })]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'cleanse' }, makeRng(1)).applied);
        const st = getActor(s, 'sq-1')!.statuses;
        assert.ok(!st.some(x => x.kind === 'negative'), 'debuffs gone');
        assert.ok(st.some(x => x.name === 'Increase Damage Given'), 'buffs kept');
    });

    it('clear strips a hostile target\'s buffs', () => {
        const en = makeActor('en-1', 'enemy', 1, { statuses: [{ name: 'Reflect', rounds: 2, kind: 'positive' }], character: WEAK });
        const s = makeSession([makeActor('sq-1', 'squad', 0, { character: { specialty: 'Ninjutsu', stats: {} } }), en]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'clear', targetId: 'en-1' }, makeRng(1)).applied);
        assert.ok(!getActor(s, 'en-1')!.statuses.some(x => x.kind === 'positive'), 'enemy buffs cleared');
    });

    it('dash relocates up to 3 hexes and rejects farther', () => {
        const s = makeSession([makeActor('sq-1', 'squad', 0, { character: { specialty: 'Ninjutsu', stats: {} } }), makeActor('en-1', 'enemy', 30, { character: WEAK })]);
        startRound(s);
        assert.ok(applyAction(s, floor, { actorId: 'sq-1', type: 'dash', tile: 3 }, makeRng(1)).applied);
        assert.equal(getActor(s, 'sq-1')!.pos, 3);
        assert.equal(applyAction(s, floor, { actorId: 'sq-1', type: 'dash', tile: 60 }, makeRng(1)).reason, 'out-of-range');
    });

    it('rejects malformed or off-board movement tiles without corrupting the board', () => {
        for (const type of ['move', 'dash'] as const) {
            for (const tile of [Number.NaN, Number.POSITIVE_INFINITY, -1, 64]) {
                const s = makeSession([
                    makeActor('sq-1', 'squad', 0, { character: { specialty: 'Ninjutsu', stats: {} } }),
                    makeActor('en-1', 'enemy', 30, { character: WEAK }),
                ]);
                startRound(s);
                const result = applyAction(s, floor, { actorId: 'sq-1', type, tile }, makeRng(1));
                assert.equal(result.reason, 'bad-tile', `${type} rejects ${String(tile)}`);
                assert.equal(getActor(s, 'sq-1')!.pos, 0);
                assert.equal(Number.isFinite(getActor(s, 'sq-1')!.pos), true);
            }
        }
    });

    it('Push shoves the target AWAY, Pull drags it TOWARD, Debuff Prevent blocks it (PvP parity)', () => {
        const shove = (name: 'Push' | 'Pull') => ({ id: name.toLowerCase(), name, type: 'Taijutsu', ap: 40, range: 3, effectPower: 10, tags: [{ name }] });
        // Attacker centred so the target has room to be shoved either way.
        const mk = (targetOver: Partial<TowerActor> = {}) => {
            const s = makeSession([
                makeActor('sq-1', 'squad', 27, { character: { specialty: 'Taijutsu', stats: {}, jutsu: [shove('Push'), shove('Pull')] } }), // col 3 row 3
                makeActor('en-1', 'enemy', 29, { hp: 9999, maxHp: 9999, character: { stats: {} }, ...targetOver }),                          // col 5 row 3
            ]);
            startRound(s);
            return s;
        };
        const distNow = (s: TowerSession) => hexDistance(getActor(s, 'en-1')!.pos, getActor(s, 'sq-1')!.pos, 8);

        const push = mk(); const beforeP = distNow(push);
        assert.ok(applyAction(push, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'push', targetId: 'en-1' }, makeRng(1)).applied);
        assert.ok(distNow(push) > beforeP, `push moved the target away (${distNow(push)} > ${beforeP})`);

        const pull = mk(); const beforeL = distNow(pull);
        assert.ok(applyAction(pull, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'pull', targetId: 'en-1' }, makeRng(1)).applied);
        assert.ok(distNow(pull) < beforeL, `pull moved the target closer (${distNow(pull)} < ${beforeL})`);

        const warded = mk({ statuses: [{ name: 'Debuff Prevent', rounds: 2, kind: 'positive' }] });
        const posBefore = getActor(warded, 'en-1')!.pos;
        applyAction(warded, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'push', targetId: 'en-1' }, makeRng(1));
        assert.equal(getActor(warded, 'en-1')!.pos, posBefore, 'Debuff Prevent blocks displacement (PvP parity)');
    });
});
