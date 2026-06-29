import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeRng } from './_sim.js';
import { buildTowerEncounter, pickTowerElements, type SquadMemberInput } from './_encounter.js';
import { runTowerFloor } from './_engine.js';
import { getActor } from './_tower-session.js';
import { FLOOR_CATALOG, type TowerFloor } from './_floor-catalog.js';
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
        character: { specialty: 'Taijutsu', maxHp: 1500, stats: { taijutsuOffense: 2500, taijutsuDefense: 2500, strength: 100, speed: 100 } },
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
