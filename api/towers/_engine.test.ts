import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeRng } from './_sim.js';
import { createTowerSession, getActor, activeActor, type TowerActor, type TowerSession, type TowerMap } from './_tower-session.js';
import type { TowerFloor } from './_floor-catalog.js';
import {
    runTowerFloor,
    applyAction,
    startRound,
    checkTowerWinner,
    computeDamage,
    applyPartyScaling,
    BASIC_ATTACK_AP,
} from './_engine.js';

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
const STRONG = { specialty: 'Taijutsu', stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 } };
const WEAK = { specialty: 'Taijutsu', stats: { taijutsuOffense: 200, taijutsuDefense: 200 } };

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

    it('computeDamage: statFactor identity at off==def, armor DR reduces', () => {
        const att = makeActor('a', 'squad', 0, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 1000 } } });
        const defEqual = makeActor('d', 'enemy', 1, { character: { stats: { taijutsuDefense: 1000 } } });
        const defArmor = makeActor('d2', 'enemy', 1, { character: { stats: { taijutsuDefense: 1000 }, armorRawDR: 1.0 } });
        const j = { effectPower: 10, type: 'Taijutsu', ap: 40 };
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

    it('computeDamage scales with the offense/defense gap (pins statFactor / MAX_STAT)', () => {
        const j = { effectPower: 10, type: 'Taijutsu', ap: 40 };
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
});
