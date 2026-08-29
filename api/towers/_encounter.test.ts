import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeRng } from './_sim.js';
import { buildTowerEncounter, pickTowerElements, scatterTerrain, type SquadMemberInput } from './_encounter.js';
import { checkTowerWinner, runTowerFloor, startRound, towerNeighbors } from './_engine.js';
import { getActor, type TowerMap } from './_tower-session.js';
import { CLAN_BOSS_FLOORS, FLOOR_CATALOG, type TowerFloor } from './_floor-catalog.js';
import { getSpireFloor } from './_spire-catalog.js';
import { hasEnemyTemplate, getEnemyTemplate, ENEMY_TEMPLATE_IDS } from './_enemy-templates.js';

function smallFloor(over: Partial<TowerFloor> = {}): TowerFloor {
    return {
        id: 1, name: 'T', biome: 'forest', objective: 'defeat-all', roundBudget: 25,
        map: { width: 8, height: 8 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-bandit', count: 2 }], firstClearReward: {}, ...over,
    };
}
function strongMember(id: string): SquadMemberInput {
    return {
        id, name: id, ownerSlug: `slug-${id}`, ai: true,
        character: { specialty: 'Taijutsu', maxHp: 12000, stats: { taijutsuOffense: 2500, taijutsuDefense: 2500, strength: 100, speed: 100 } },
    };
}
function build(floor: TowerFloor, squad: SquadMemberInput[], over: Partial<Parameters<typeof buildTowerEncounter>[0]> = {}) {
    return buildTowerEncounter({ floor, squad, runId: 'tower-test', seed: 42, partySize: squad.length, now: 1000, ...over });
}

describe('Battle Towers encounter builder (P1.B)', () => {
    it('builds squad + enemy actors with sane sides and in-bounds positions', () => {
        const s = build(smallFloor(), [strongMember('sq-0'), strongMember('sq-1')]);
        assert.equal(s.actors.filter(a => a.side === 'squad').length, 2);
        assert.equal(s.actors.filter(a => a.side === 'enemy').length, 2);
        for (const a of s.actors) {
            assert.ok(a.pos >= 0 && a.pos < s.map.width * s.map.height, `pos in bounds for ${a.id}`);
            assert.ok(a.hp > 0 && a.hp === a.maxHp, `full hp for ${a.id}`);
        }
        // squad on the left edge, enemies on the right edge → no shared tiles
        const positions = s.actors.map(a => a.pos);
        assert.equal(new Set(positions).size, positions.length, 'no spawn overlap');
    });

    it('divides the map: squad spawns on the LEFT half, the enemy team on the RIGHT half', () => {
        const floor = smallFloor({ objective: 'defeat-boss', enemies: [{ aiId: 'grunt-bandit', count: 3 }], boss: { aiId: 'boss-warden', phases: [50] } });
        const s = build(floor, [strongMember('sq-0'), strongMember('sq-1')]);
        const W = s.map.width, mid = Math.floor(W / 2);
        for (const a of s.actors) {
            const col = a.pos % W;
            if (a.side === 'squad') assert.ok(col < mid, `squad ${a.id} on left half (col ${col} < ${mid})`);
            if (a.side === 'enemy') assert.ok(col >= mid, `enemy ${a.id} on right half (col ${col} >= ${mid})`);
        }
        const pos = s.actors.map(a => a.pos);
        assert.equal(new Set(pos).size, pos.length, 'no spawn overlap across the divide');
    });

    it('spawns VARY by seed (random within each half), not a fixed edge-pin', () => {
        const mk = (seed: number) => build(
            smallFloor({ objective: 'defeat-boss', enemies: [{ aiId: 'grunt-bandit', count: 2 }], boss: { aiId: 'boss-warden', phases: [50] } }),
            [strongMember('sq-0')], { seed });
        const squadSpawns = new Set([1, 2, 3, 4, 5].map(seed => mk(seed).actors.find(a => a.id === 'sq-0')!.pos));
        assert.ok(squadSpawns.size >= 2, 'squad spawn varies across seeds');
    });

    it('runs an end-to-end floor: a strong squad clears defeat-all', () => {
        const s = runTowerFloor(build(smallFloor(), [strongMember('sq-0'), strongMember('sq-1')]), smallFloor(), makeRng(1));
        assert.equal(s.winner, 'squad');
        assert.equal(s.status, 'done');
        assert.ok(s.objectiveState.completed);
    });

    it('is deterministic (same inputs → byte-identical encounter + run)', () => {
        const a = runTowerFloor(build(smallFloor(), [strongMember('sq-0')]), smallFloor(), makeRng(7));
        const b = runTowerFloor(build(smallFloor(), [strongMember('sq-0')]), smallFloor(), makeRng(7));
        assert.equal(JSON.stringify(a), JSON.stringify(b));
    });

    it('party-scales enemy HP for a duo vs the 4-balance baseline', () => {
        const full = build(smallFloor({ balanceFor: 4 }), [strongMember('a'), strongMember('b'), strongMember('c'), strongMember('d')], { partySize: 4 });
        const duo = build(smallFloor({ balanceFor: 4 }), [strongMember('a'), strongMember('b')], { partySize: 2 });
        const fullHp = getActor(full, 'en-0')!.maxHp;
        const duoHp = getActor(duo, 'en-0')!.maxHp;
        assert.equal(fullHp, getEnemyTemplate('grunt-bandit').hp, 'full party = unscaled template HP');
        assert.ok(duoHp < fullHp, `duo enemy HP ${duoHp} < full ${fullHp}`);
        assert.equal(getActor(duo, 'en-0')!.character.towerDmgScale, 0.6);
    });

    it('seals delayed pods and deploys them only at their authored round', () => {
        const floor = smallFloor({
            balanceFor: 4,
            enemies: [
                { aiId: 'grunt-bandit', count: 1 },
                { aiId: 'grunt-archer', count: 2, spawnRound: 2 },
            ],
        });
        const s = build(floor, [strongMember('sq-0'), strongMember('sq-1')], { partySize: 2 });
        assert.equal(s.actors.filter(a => a.side === 'enemy').length, 1, 'round-1 pod is on the board');
        assert.equal(s.pendingEnemyWaves?.length, 1);
        assert.equal(s.pendingEnemyWaves?.[0]?.round, 2);
        assert.equal(s.pendingEnemyWaves?.[0]?.actors.length, 2);
        assert.equal(s.pendingEnemyWaves?.[0]?.actors[0]?.character.towerDmgScale, 0.6, 'delayed actors are party-scaled too');

        const first = s.actors.find(a => a.side === 'enemy')!;
        first.hp = 0;
        checkTowerWinner(s, floor);
        assert.equal(s.status, 'active', 'a pending wave prevents a premature clear');

        startRound(s);
        assert.equal(s.actors.filter(a => a.side === 'enemy' && a.hp > 0).length, 0, 'round 1 does not deploy round-2 actors');
        s.round = 2;
        startRound(s);
        const livingEnemies = s.actors.filter(a => a.side === 'enemy' && a.hp > 0);
        assert.equal(livingEnemies.length, 2);
        assert.equal(s.pendingEnemyWaves, undefined);
        assert.equal(new Set(s.actors.filter(a => a.hp > 0).map(a => a.pos)).size, s.actors.filter(a => a.hp > 0).length, 'reinforcements never overlap living actors');
        assert.ok(s.log.some(line => line.includes('2 reinforcements')));
    });

    it('runs through delayed waves before awarding a defeat-all clear', () => {
        const floor = smallFloor({
            enemies: [
                { aiId: 'grunt-bandit', count: 1 },
                { aiId: 'grunt-archer', count: 1, spawnRound: 2 },
            ],
        });
        const out = runTowerFloor(build(floor, [strongMember('sq-0'), strongMember('sq-1')]), floor, makeRng(19));
        assert.equal(out.winner, 'squad');
        assert.equal(out.pendingEnemyWaves, undefined);
        assert.ok(out.log.some(line => line.includes('reinforcement')));
    });

    it('places a boss (with phases) and an npc when the floor has them', () => {
        const bossFloor = smallFloor({ objective: 'defeat-boss', enemies: [], boss: { aiId: 'boss-warden', phases: [33, 66] } });
        const s = build(bossFloor, [strongMember('sq-0')]);
        assert.equal(s.phaseState.bossId, 'boss');
        assert.deepEqual(s.phaseState.pendingPhases, [66, 33]);
        assert.ok(getActor(s, 'boss'));

        const npcFloor = smallFloor({ objective: 'protect-npc', npc: { aiId: 'npc-genin', pos: 9 } });
        const s2 = build(npcFloor, [strongMember('sq-0')]);
        const npc = s2.actors.find(a => a.side === 'npc');
        assert.ok(npc, 'npc placed');
        assert.equal(npc!.pos, 9);
        assert.equal(s2.objectiveState.npcAlive, true);
    });

    it('every aiId referenced by the shipped floor catalog has a real enemy template', () => {
        for (const floor of FLOOR_CATALOG) {
            for (const pod of floor.enemies) {
                assert.ok(hasEnemyTemplate(pod.aiId), `missing template for enemy "${pod.aiId}" on floor ${floor.id}`);
            }
            if (floor.boss) assert.ok(hasEnemyTemplate(floor.boss.aiId), `missing boss template "${floor.boss.aiId}" on floor ${floor.id}`);
            if (floor.npc) assert.ok(hasEnemyTemplate(floor.npc.aiId), `missing npc template "${floor.npc.aiId}" on floor ${floor.id}`);
        }
    });
});

describe('Battle Towers static terrain scatter', () => {
    const SPAWN_LEFT_COLS = 3; // mirrors _encounter
    const mkMap = (): TowerMap => ({ width: 20, height: 14, blockedTiles: [], hazardTiles: [], objectiveTiles: [] });

    it('places non-adjacent pillars off the spawn band + edges, deterministically', () => {
        const run = (seed: number) => { const m = mkMap(); scatterTerrain(m, 20, 14, seed, new Set(), 8); return m.blockedTiles; };
        const a = run(123), b = run(123);
        assert.deepEqual(a, b, 'deterministic per seed');
        assert.ok(a.length >= 1 && a.length <= 8, `placed ${a.length} pillars (<= requested)`);
        const set = new Set(a);
        // non-adjacency invariant ⇒ pillars can never wall off the board
        for (const t of a) for (const nb of towerNeighbors(t, 20, 14)) {
            assert.ok(!set.has(nb), `pillars ${t} and ${nb} must not be adjacent`);
        }
        for (const t of a) {
            const col = t % 20, row = Math.floor(t / 20);
            assert.ok(col > SPAWN_LEFT_COLS && col < 19, `pillar col ${col} clear of spawn band + last col`);
            assert.ok(row >= 1 && row <= 12, `pillar row ${row} off the edge rows`);
        }
    });

    it('never blocks a reserved tile and never exceeds the 10% board cap', () => {
        const reserved = new Set([100, 101, 102, 150]);
        const m = mkMap(); scatterTerrain(m, 20, 14, 7, reserved, 8);
        for (const r of reserved) assert.ok(!m.blockedTiles.includes(r), `reserved tile ${r} left clear`);
        const m2 = mkMap(); scatterTerrain(m2, 20, 14, 1, new Set(), 9999);
        assert.ok(m2.blockedTiles.length <= Math.floor(20 * 14 * 0.10), 'clamped to 10% of the board');
        const m3 = mkMap(); scatterTerrain(m3, 20, 14, 1, new Set(), 0);
        assert.deepEqual(m3.blockedTiles, [], 'count 0 is a no-op (byte-identical clear board)');
    });

    it('shipped terrain floors: no spawn is trapped and the board stays connected (non-adjacent)', () => {
        for (const floor of FLOOR_CATALOG) {
            if (!floor.terrainPillars) continue;
            for (const seed of [1, 55, 4242]) {
                const s = buildTowerEncounter({ floor, squad: [strongMember('h'), strongMember('i')], runId: 'r', seed, partySize: 4, now: 1 });
                const W = s.map.width, H = s.map.height;
                const blocked = new Set(s.map.blockedTiles);
                assert.ok(blocked.size >= 1 && blocked.size <= floor.terrainPillars!, `floor ${floor.id} seed ${seed}: ${blocked.size} pillars`);
                for (const a of s.actors) assert.ok(!blocked.has(a.pos), `floor ${floor.id} seed ${seed}: ${a.id} spawned on a pillar`);
                for (const t of s.map.blockedTiles) for (const nb of towerNeighbors(t, W, H)) {
                    assert.ok(!blocked.has(nb), `floor ${floor.id} seed ${seed}: adjacent pillars ${t},${nb} (could wall off the board)`);
                }
            }
        }
    });

    it('a terrain floor is deterministic end-to-end and a strong squad still clears it (BFS, no stall)', () => {
        const floor = FLOOR_CATALOG.find(f => f.terrainPillars && f.objective === 'defeat-all')!;
        const squad = [strongMember('a'), strongMember('b'), strongMember('c'), strongMember('d')];
        const mk = () => runTowerFloor(buildTowerEncounter({ floor, squad, runId: 'r', seed: 99, partySize: 4, now: 1 }), floor, makeRng(99));
        const a = mk(), b = mk();
        assert.equal(JSON.stringify(a), JSON.stringify(b), 'terrain run replays byte-identically');
        assert.equal(a.winner, 'squad', 'squad pathed around the pillars and cleared');
        assert.equal(a.status, 'done');
    });
});

describe('Battle Towers board objects (fonts / shrines)', () => {
    it('shipped object floors place every object on a free tile (shrines mid-board), deterministically', () => {
        for (const floor of FLOOR_CATALOG) {
            if (!floor.boardObjects?.length) continue;
            for (const seed of [1, 55, 4242]) {
                const s = buildTowerEncounter({ floor, squad: [strongMember('h'), strongMember('i')], runId: 'r', seed, partySize: 4, now: 1 });
                const W = s.map.width;
                const objects = s.map.boardObjects ?? [];
                assert.equal(objects.length, floor.boardObjects.length, `floor ${floor.id} seed ${seed}: all objects on the map`);
                const featureTiles = new Set((s.map.features ?? []).flatMap(f => f.tiles));
                const blocked = new Set(s.map.blockedTiles);
                const seen = new Set<number>();
                for (const o of objects) {
                    assert.equal(o.tiles?.length, 1, `floor ${floor.id} seed ${seed}: ${o.kind} got a tile`);
                    const t = o.tiles![0]!;
                    assert.ok(!featureTiles.has(t) && !blocked.has(t), `floor ${floor.id} seed ${seed}: ${o.kind} clear of features/pillars`);
                    assert.ok(!seen.has(t), `floor ${floor.id} seed ${seed}: objects never stack`);
                    seen.add(t);
                    if (o.kind === 'shrine') {
                        const col = t % W;
                        assert.ok(col >= Math.floor(W / 3) && col <= Math.ceil((2 * W) / 3) - 1, `floor ${floor.id} seed ${seed}: shrine mid-board (col ${col})`);
                    }
                    for (const a of s.actors) assert.ok(a.pos !== t, `floor ${floor.id} seed ${seed}: no spawn on the ${o.kind}`);
                }
                const again = buildTowerEncounter({ floor, squad: [strongMember('h'), strongMember('i')], runId: 'r', seed, partySize: 4, now: 1 });
                assert.deepEqual(again.map.boardObjects, objects, `floor ${floor.id} seed ${seed}: placement is deterministic`);
            }
        }
    });
});

describe('Battle Towers per-run elements (3 of 5, seeded)', () => {
    const VALID = new Set(['Fire', 'Water', 'Earth', 'Lightning', 'Wind']);

    it('picks exactly 3 distinct valid elements', () => {
        for (const seed of [1, 42, 9999, 0x7fffffff]) {
            const els = pickTowerElements(seed);
            assert.equal(els.length, 3, `seed ${seed}`);
            assert.equal(new Set(els).size, 3, `seed ${seed}: distinct`);
            for (const e of els) assert.ok(VALID.has(e), `seed ${seed}: ${e} valid`);
        }
    });

    it('is deterministic per seed (settle recompute reproduces it)', () => {
        assert.deepEqual(pickTowerElements(12345), pickTowerElements(12345));
        // and varies across seeds (not a constant)
        assert.notDeepEqual(pickTowerElements(1), pickTowerElements(4));
    });

    it('assigns the seeded elements to a floor\'s pylons (catalog elements are placeholders)', () => {
        const floor = FLOOR_CATALOG.find(f => f.features?.some(x => x.kind === 'pylon'))!;
        const session = buildTowerEncounter({ floor, squad: [strongMember('a')], runId: 'r', seed: 777, partySize: 4, now: 1 });
        const want = pickTowerElements(777);
        const pylons = (session.map.features ?? []).filter(f => f.kind === 'pylon') as Array<{ element: string }>;
        assert.ok(pylons.length > 0);
        for (const p of pylons) assert.ok(want.includes(p.element), `pylon element ${p.element} ∈ ${want.join(',')}`);
    });
});

describe('Battle Towers feature placement (non-overlapping, off the spawn band)', () => {
    const SPAWN_LEFT_COLS = 3; // mirrors _encounter

    it('features never overlap, avoid the player spawn band, and no actor spawns on one', () => {
        for (const floor of FLOOR_CATALOG) {
            for (const seed of [1, 55, 4242]) {
                const session = buildTowerEncounter({ floor, squad: [strongMember('h')], runId: 'r', seed, partySize: 4, now: 1 });
                const feats = session.map.features ?? [];
                const W = session.map.width;

                // (a) no two feature tiles collide
                const seen = new Set<number>();
                for (const f of feats) {
                    for (const t of f.tiles) {
                        assert.ok(!seen.has(t), `floor ${floor.id} seed ${seed}: feature overlap at ${t}`);
                        seen.add(t);
                        // (b) never in the player spawn band (left columns)
                        assert.ok((t % W) > SPAWN_LEFT_COLS, `floor ${floor.id} seed ${seed}: feature in spawn band at col ${t % W}`);
                        // and on-board
                        assert.ok(t >= 0 && t < W * session.map.height, `floor ${floor.id}: feature tile ${t} off-board`);
                    }
                }

                // (c) no actor stands on a feature tile at spawn
                for (const a of session.actors) {
                    assert.ok(!seen.has(a.pos), `floor ${floor.id} seed ${seed}: ${a.id} spawned on a feature (${a.pos})`);
                }
            }
        }
    });

    it('keeps every shipped compact, standard, and major arena collision-free under a full squad', () => {
        const shipped: Array<{ label: string; floor: TowerFloor }> = [
            ...FLOOR_CATALOG.map(floor => ({ label: `story ${floor.id}`, floor })),
            ...CLAN_BOSS_FLOORS.map(floor => ({ label: `clan ${floor.id}`, floor })),
            ...Array.from({ length: 20 }, (_, index) => {
                const floor = getSpireFloor(index + 1)!;
                return { label: `spire ${index + 1}`, floor };
            }),
        ];
        const squad = ['a', 'b', 'c', 'd'].map(strongMember);

        for (const { label, floor } of shipped) {
            for (const seed of [1, 7, 19, 55, 144, 377, 1597, 4242]) {
                const session = buildTowerEncounter({
                    floor, squad, runId: `layout-${label}`, seed, partySize: 4, now: 1,
                });
                const boardSize = session.map.width * session.map.height;
                const reserved = new Set<number>();
                const claim = (tile: number, owner: string) => {
                    assert.ok(tile >= 0 && tile < boardSize, `${label} seed ${seed}: ${owner} tile ${tile} is in bounds`);
                    assert.ok(!reserved.has(tile), `${label} seed ${seed}: ${owner} overlaps tile ${tile}`);
                    reserved.add(tile);
                };

                for (const feature of session.map.features ?? []) {
                    assert.equal(feature.tiles.length, 7, `${label} seed ${seed}: ${feature.kind} has a complete flower`);
                    for (const tile of feature.tiles) claim(tile, `feature ${feature.kind}`);
                }
                for (const tile of session.map.blockedTiles) claim(tile, 'terrain pillar');
                for (const object of session.map.boardObjects ?? []) {
                    assert.equal(object.tiles?.length, 1, `${label} seed ${seed}: ${object.kind} receives one tile`);
                    for (const tile of object.tiles ?? []) claim(tile, `board object ${object.kind}`);
                }
                for (const hazard of session.map.dynamicHazards ?? []) {
                    for (const tile of hazard.tiles) claim(tile, `dynamic hazard ${hazard.kind}`);
                }

                const expectedHazardTiles = (floor.dynamicHazards ?? []).reduce((sum, hazard) => sum + hazard.count, 0);
                const actualHazardTiles = (session.map.dynamicHazards ?? []).reduce((sum, hazard) => sum + hazard.tiles.length, 0);
                assert.equal(actualHazardTiles, expectedHazardTiles, `${label} seed ${seed}: all authored hazard vents are placed`);

                const sealedActors = [
                    ...session.actors,
                    ...(session.pendingEnemyWaves ?? []).flatMap(wave => wave.actors),
                ];
                const actorTiles = new Set<number>();
                for (const actor of sealedActors) {
                    assert.ok(actor.pos >= 0 && actor.pos < boardSize, `${label} seed ${seed}: ${actor.id} is in bounds`);
                    assert.ok(!reserved.has(actor.pos), `${label} seed ${seed}: ${actor.id} avoids board content at ${actor.pos}`);
                    assert.ok(!actorTiles.has(actor.pos), `${label} seed ${seed}: ${actor.id} has a unique sealed spawn at ${actor.pos}`);
                    actorTiles.add(actor.pos);
                }
            }
        }
    });
});

// Regression guard for the per-rank STAT CAP: tower combat routes through applyJutsu,
// which clamps each fighter's stats to statCapForLevel(level). Every enemy template MUST
// carry a level whose rank-band cap is >= its biggest stat, or its hand-tuned stats get
// gutted to the Academy ceiling in combat (the boss-over-nerf bug). statCapForLevel here
// mirrors api/pvp/move.ts (and shinobij.client/src/constants/game.ts).
describe('enemy templates fit their rank-band stat cap (no combat over-clamp)', () => {
    const statCapForLevel = (level: number) => {
        const lvl = Math.max(1, Math.floor(Number(level) || 1));
        if (lvl >= 80) return 2500;
        if (lvl >= 50) return 2100;
        if (lvl >= 30) return 1300;
        if (lvl >= 15) return 700;
        return 350;
    };
    for (const id of ENEMY_TEMPLATE_IDS) {
        it(`${id}: every stat fits statCapForLevel(level)`, () => {
            const tpl = getEnemyTemplate(id);
            assert.ok(typeof tpl.level === 'number' && tpl.level >= 1, `${id} has no level`);
            const cap = statCapForLevel(tpl.level);
            for (const [k, v] of Object.entries(tpl.stats)) {
                assert.ok(v <= cap, `${id}.${k}=${v} exceeds the level-${tpl.level} rank cap ${cap} — it would be clamped in combat; raise the template's level`);
            }
        });
    }
});
