/**
 * Tower combat VFX emission (server half).
 *
 * The engine authors cosmetic plates alongside each resolved action and each
 * round-end DoT tick, and the client draws them (BattleTowerFight). These are
 * DISPLAY ONLY: combat, settlement, and the log never read them back, so the
 * guards below pin two things — that plates are emitted at all (they were
 * silently absent for the whole life of the tower engine), and that emitting
 * them cannot perturb the fight.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from './_sim.js';
import { createTowerSession, type TowerActor, type TowerSession, type TowerMap } from './_tower-session.js';
import type { TowerFloor } from './_floor-catalog.js';
import { applyAction, endTurn, startRound, BASIC_ATTACK_AP } from './_engine.js';

const MAP8: TowerMap = { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };
const FIGHTER = { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 1200, taijutsuDefense: 1200 } };

function makeActor(id: string, side: TowerActor['side'], pos: number, over: Partial<TowerActor> = {}): TowerActor {
    return {
        id, side, name: id, ownerSlug: null, ai: true,
        hp: 4000, maxHp: 4000, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300,
        shield: 0, statuses: [], cooldowns: {}, pos,
        character: { ...FIGHTER },
        ...over,
    };
}
function makeFloor(over: Partial<TowerFloor> = {}): TowerFloor {
    return {
        id: 1, name: 'Test', biome: 'forest', objective: 'defeat-all', roundBudget: 8,
        map: { width: 8, height: 8 }, fieldRule: { kind: 'none' }, enemies: [],
        firstClearReward: {}, ...over,
    };
}
/** sq-1 at tile 0, en-1 at tile 1 — adjacent, so a basic attack is legal. */
function duel(over: Partial<Parameters<typeof createTowerSession>[0]> = {}): TowerSession {
    return createTowerSession({
        towerId: 't', runId: 'r', floor: 1, seed: 123, partySize: 1, map: MAP8,
        actors: [makeActor('sq-1', 'squad', 0, { ai: false }), makeActor('en-1', 'enemy', 1)],
        objectiveKind: 'defeat-all', now: 1000, ...over,
    });
}

describe('tower combat VFX', () => {
    it('a resolved attack publishes a plate anchored on the victim', () => {
        const session = duel();
        startRound(session);
        session.activeAp = 100;
        const before = session.vfxSeq ?? 0;

        const result = applyAction(session, makeFloor(), { actorId: 'sq-1', type: 'attack', targetId: 'en-1' }, makeRng(1));

        assert.equal(result.applied, true, 'the attack itself must still resolve');
        assert.ok((session.vfxSeq ?? 0) > before, 'vfxSeq must advance so the client can tell this batch is new');
        assert.equal(session.vfx?.length, 1);
        const plate = session.vfx![0];
        assert.equal(plate.target, 'en-1', 'the plate must anchor on the struck ACTOR, not a side');
        assert.equal(plate.anchor, 'target');
        assert.ok(plate.key, 'a plate needs a registry key or the client falls back to a generic burst');
    });

    it('a rejected command publishes nothing', () => {
        const session = duel();
        // Not this actor's turn — the resolver refuses before touching anything.
        const result = applyAction(session, makeFloor(), { actorId: 'en-1', type: 'attack', targetId: 'sq-1' }, makeRng(1));
        assert.equal(result.applied, false);
        assert.equal(session.vfx, undefined, 'a refused intent must not paint the board');
        assert.equal(session.vfxSeq, undefined);
    });

    it('movement anchors on the destination tile rather than an actor', () => {
        const session = duel();
        startRound(session);
        session.activeAp = 100;
        applyAction(session, makeFloor(), { actorId: 'sq-1', type: 'move', tile: 8 }, makeRng(1));
        const plate = session.vfx?.[0];
        assert.ok(plate, 'a move must still emit a plate');
        assert.equal(plate!.target, undefined, 'a tile-anchored plate carries no actor id');
        assert.deepEqual(plate!.tiles, [8]);
    });

    it('round-end DoT ticks surface the plates the shared PvP helper already returns', () => {
        const session = duel();
        // A bleeding defender: applyDoTs (api/pvp/move.ts) authors a wound plate
        // for this tick, which the tower engine used to discard.
        const victim = session.actors.find(a => a.id === 'en-1')!;
        victim.statuses = [{ name: 'Wound', rounds: 3, amount: 90, kind: 'negative', activeRound: 1 }];
        const hpBefore = victim.hp;

        endTurn(session, makeFloor());

        assert.ok(victim.hp < hpBefore, 'the DoT must still actually tick — this is the real damage path');
        assert.ok((session.vfxSeq ?? 0) > 0, 'the tick must publish its plates');
        assert.ok(
            session.vfx?.some(p => p.target === 'en-1'),
            'the bleeding actor must get a plate anchored on itself',
        );
    });

    it('a boss phase and the triggering attack publish one combined visual beat', () => {
        const session = duel({ bossId: 'en-1', bossPhases: [90] });
        const boss = session.actors.find(actor => actor.id === 'en-1')!;
        boss.hp = 3601;
        boss.character = { ...FIGHTER, mechanic: 'enrage' };
        startRound(session);
        session.activeAp = 100;

        const result = applyAction(session, makeFloor({ objective: 'defeat-boss' }), {
            actorId: 'sq-1', type: 'attack', targetId: 'en-1',
        }, makeRng(1));

        assert.equal(result.applied, true);
        assert.deepEqual(session.phaseState.triggeredPhases, [90]);
        assert.ok(session.vfx?.some(plate => plate.key === 'buff' && plate.anchor === 'area'), 'enrage has a phase burst');
        assert.ok(session.vfx?.some(plate => plate.key === 'impact' && plate.target === 'en-1'), 'the triggering hit remains visible');
    });

    it('DoT, boss-strike, geyser, and regeneration payoffs remain visible together at round end', () => {
        const session = duel({ bossId: 'en-1' });
        const boss = session.actors.find(actor => actor.id === 'en-1')!;
        const squad = session.actors.find(actor => actor.id === 'sq-1')!;
        boss.hp = 3000;
        boss.character = { ...FIGHTER, mechanic: 'regen' };
        startRound(session);
        squad.statuses = [{ name: 'Wound', rounds: 3, amount: 90, kind: 'negative', activeRound: 1 }];
        session.map.dynamicHazards = [{ kind: 'geyser', tiles: [0], pct: 4, everyRounds: 2, firstRound: 1 }];
        const squadHp = squad.hp;
        session.bossStrike = { tiles: [0], round: session.round, pct: 10, kind: 'volley', label: 'test volley' };
        session.activeIndex = session.turnQueue.length - 1;

        endTurn(session, makeFloor({ objective: 'defeat-boss' }));

        assert.ok(session.actors.find(actor => actor.id === 'sq-1')!.hp < squadHp, 'the strike dealt its sealed damage');
        assert.ok(boss.hp > 3000, 'the boss regenerated');
        assert.ok(session.vfx?.some(plate => plate.key === 'wound' && plate.target === 'sq-1'), 'the DoT tick remains visible');
        assert.ok(session.vfx?.some(plate => plate.key === 'heavy' && plate.tiles?.includes(0)), 'detonation has an impact plate');
        assert.ok(session.vfx?.some(plate => plate.key === 'magma' && plate.tiles?.includes(0)), 'geyser eruption has a payoff plate');
        assert.ok(session.vfx?.some(plate => plate.key === 'heal' && plate.target === 'en-1'), 'regen has a heal plate');
    });

    it('the plate shape is mirrored on the client (separate build roots)', () => {
        // api/ and shinobij.client/ compile independently, so TowerVfxEvent is
        // hand-mirrored — the same drift gap _combat-formula-parity.test.ts
        // exists to close. A field added on one side and forgotten on the other
        // would silently stop rendering. Static text read: imports nothing.
        const fields = (src: string): string[] => {
            const body = src.slice(src.indexOf('TowerVfxEvent = {'));
            return [...body.slice(0, body.indexOf('};')).matchAll(/^\s*(\w+)\??:/gm)].map(m => m[1]).sort();
        };
        const server = readFileSync(join(process.cwd(), 'api', 'towers', '_tower-session.ts'), 'utf8');
        const client = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'towers-api.ts'), 'utf8');
        assert.deepEqual(fields(server), fields(client), 'TowerVfxEvent drifted between server and client');
        assert.deepEqual(fields(server), ['anchor', 'key', 'persistent', 'target', 'tiles']);

        // ...and the session must expose BOTH the payload and the sequence, or
        // the screen cannot tell a new batch from a re-poll of the same one.
        for (const [label, src] of [['server', server], ['client', client]] as const) {
            assert.match(src, /vfx\?:\s*TowerVfxEvent\[\]/, `${label} session lost its vfx payload`);
            assert.match(src, /vfxSeq\?:\s*number/, `${label} session lost its vfx sequence`);
        }
    });

    it('VFX are inert: stripping them leaves combat byte-identical', () => {
        // The strongest statement we can make cheaply — run the same scripted
        // exchange twice and compare everything EXCEPT the cosmetic fields. If
        // authoring a plate ever perturbed damage, ordering, or resources, the
        // deep-equal below would break.
        const play = (): TowerSession => {
            const session = duel();
            startRound(session);
            const floor = makeFloor();
            session.activeAp = 100;
            applyAction(session, floor, { actorId: 'sq-1', type: 'attack', targetId: 'en-1' }, makeRng(7));
            session.activeAp = BASIC_ATTACK_AP;
            applyAction(session, floor, { actorId: 'sq-1', type: 'attack', targetId: 'en-1' }, makeRng(7));
            endTurn(session, floor);
            return session;
        };
        const stripCosmetic = (s: TowerSession) => {
            const { vfx: _vfx, vfxSeq: _vfxSeq, ...rest } = s;
            return rest;
        };
        assert.deepEqual(stripCosmetic(play()), stripCosmetic(play()), 'the fight must be deterministic apart from VFX');
        assert.ok(play().vfx?.length, 'and the run must actually have produced plates');
    });
});
