import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { PvpFighter } from '../pvp/session.js';
import { endSoloPveTurn } from './_engine.js';
import { createSoloPveSession, type SoloPveSession } from './_session.js';
import { GRID_H, GRID_W } from '../combat-core/constants.js';
import { canonicalHollowGateDepth, type HollowGateHoundKind } from '../../shared/hollow-gate-contract.js';
import {
    hollowGateCombatDirective,
    hollowGateHazardDamage,
    type HollowGateCombatDirective,
    type HollowGateCombatDirectorInput,
} from '../../shared/hollow-gate-combat-director.js';

/*
 * Hollow Gate Alpha, phase II ("Riftstalker"). Rifts open on even turns and
 * inhale on odd ones; the inhale turn tells the player "the lane pattern
 * reverses on the next turn". The lane set was `x % 2 === turn % 2` evaluated
 * only on even turns — always the even columns — so every opening hit the same
 * lanes and one step made the whole phase harmless. The authoring commit
 * (810febac8) computed that turn-derived `hazardParity` beside the reversal
 * copy; every other Alpha phase moves its safe ground between pulses.
 *
 * These tests pin the repair against the engine that actually deals the
 * damage, and pin that NOTHING else moved: the pre-fix director is kept below,
 * verbatim, as the golden reference.
 */

// ── The pre-fix director, verbatim (shared/hollow-gate-combat-director.ts at 665beb244) ──
const EMPTY: readonly number[] = Object.freeze([]);
const tilesWhere = (width: number, height: number, predicate: (x: number, y: number) => boolean): number[] => {
    const tiles: number[] = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (predicate(x, y)) tiles.push(y * width + x);
    return tiles;
};
const hpRatio = (hp: number, maxHp: number) => Math.max(0, Math.min(1, Number(hp) / Math.max(1, Number(maxHp) || 1)));
const distance = (a: number, b: number, width: number) => {
    const ax = a % width, ay = Math.floor(a / width), bx = b % width, by = Math.floor(b / width);
    const aq = ax, ar = ay - ((ax - (ax & 1)) / 2), bq = bx, br = by - ((bx - (bx & 1)) / 2);
    return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
};
function legacyAlphaPhase(enemyHp: number, enemyMaxHp: number): 1 | 2 | 3 {
    const ratio = hpRatio(enemyHp, enemyMaxHp);
    return ratio <= 0.35 ? 3 : ratio <= 0.7 ? 2 : 1;
}
function legacyAlpha(turn: number, phase: 1 | 2 | 3, width: number, height: number): HollowGateCombatDirective {
    if (phase === 1) {
        const charging = turn % 3 === 0, safeColumn = (turn * 2 + 1) % width;
        const safeTiles = charging ? tilesWhere(width, height, (x) => Math.abs(x - safeColumn) <= 1) : EMPTY;
        const safe = new Set(safeTiles);
        return { floor: 5, phase, phaseName: "Guardian", title: charging ? "Gate-Eater's Howl is charging" : "The Alpha tests the surviving wards", instruction: charging ? "Stand inside the violet ward column before the Alpha acts." : "Read the ward lines. The Alpha howls every third turn.", tone: "alpha", hazardTiles: charging ? tilesWhere(width, height, (x, y) => !safe.has(y * width + x)) : EMPTY, safeTiles, hazardDamagePct: charging ? 0.07 : 0, incomingDamageMultiplier: 1, outgoingDamageMultiplier: 1, musicIntensity: "pressure", signature: "Gate-Eater's Howl" };
    }
    if (phase === 2) {
        const open = turn % 2 === 0, parity = turn % 2;
        const hazardTiles = open ? tilesWhere(width, height, (x) => x % 2 === parity) : EMPTY;
        const hazard = new Set(hazardTiles);
        return { floor: 5, phase, phaseName: "Riftstalker", title: open ? "The Alpha tears open alternating rift lanes" : "The rifts inhale", instruction: open ? "Cross onto an unmarked lane before the Alpha pounces." : "Reposition now. The lane pattern reverses on the next turn.", tone: "alpha", hazardTiles, safeTiles: open ? tilesWhere(width, height, (x, y) => !hazard.has(y * width + x)) : EMPTY, hazardDamagePct: open ? 0.08 : 0, incomingDamageMultiplier: 1.1, outgoingDamageMultiplier: open ? 1.12 : 1.04, musicIntensity: "climax", signature: "Rift-Hunt Pounce" };
    }
    const parity = turn % 2, safeTiles = tilesWhere(width, height, (x, y) => (x + y) % 2 === parity), safe = new Set(safeTiles);
    return { floor: 5, phase, phaseName: "Gate-Eater", title: "The Alpha devours the arena one seal at a time", instruction: "Move onto a glowing seal. The safe pattern flips every turn, so finish the fight fast.", tone: "alpha", hazardTiles: tilesWhere(width, height, (x, y) => !safe.has(y * width + x)), safeTiles, hazardDamagePct: 0.09, incomingDamageMultiplier: 1.18, outgoingDamageMultiplier: 1.3, musicIntensity: "climax", signature: "Last Shrine Devourer" };
}
function legacyDirective(input: HollowGateCombatDirectorInput): HollowGateCombatDirective {
    const floor = canonicalHollowGateDepth(input.floor), turn = Math.max(1, Math.floor(Number(input.turn) || 1));
    const width = Math.max(3, Math.floor(input.gridWidth ?? 12)), height = Math.max(3, Math.floor(input.gridHeight ?? 10));
    if (input.kind === "boss") return legacyAlpha(turn, legacyAlphaPhase(input.enemyHp, input.enemyMaxHp), width, height);
    if (floor === 1) {
        const active = turn % 3 === 0, lane = turn % 4;
        const hazardTiles = active ? tilesWhere(width, height, (x) => x % 4 === lane || x % 4 === (lane + 1) % 4) : EMPTY;
        return { floor, phase: 1, phaseName: "First Ward", title: active ? "Broken wards are collapsing" : "Cinders gather along the ward lines", instruction: active ? "Leave the orange fracture lanes before Ashfang takes its turn." : "Watch the floor. The fractured lanes ignite every third turn.", tone: "ward", hazardTiles, safeTiles: active ? tilesWhere(width, height, (x) => !hazardTiles.some((tile) => tile % width === x)) : EMPTY, hazardDamagePct: active ? 0.04 : 0, incomingDamageMultiplier: active ? 1.08 : 1, outgoingDamageMultiplier: active ? 1.12 : 1, musicIntensity: active ? "pressure" : "calm", signature: "Cinder Pounce" };
    }
    if (floor === 2) {
        const lit = turn % 3 === 1;
        return { floor, phase: 1, phaseName: lit ? "Lanternlight" : "Veil-Slip", title: lit ? "The memory lanterns expose Veilrunner" : "The lanterns go dark", instruction: lit ? "Strike now: the Hound takes 25% more damage while the names burn." : "Hold your guard. Veilrunner hunts harder between extinguished lanterns.", tone: "lantern", hazardTiles: EMPTY, safeTiles: EMPTY, hazardDamagePct: 0, incomingDamageMultiplier: lit ? 0.9 : 1.14, outgoingDamageMultiplier: lit ? 1.25 : 0.92, musicIntensity: lit ? "pressure" : "calm", signature: "Lantern-Slip Rend" };
    }
    if (floor === 3) {
        const high = turn % 2 === 0;
        return { floor, phase: 1, phaseName: high ? "Black Tide" : "Low Water", title: high ? "The reliquary floods from both edges" : "The black water recedes", instruction: high ? "Reach the blue-lit center before Shrineback acts." : "Use the opening to reposition before the next high tide.", tone: "tide", hazardTiles: high ? tilesWhere(width, height, (_x, y) => y <= 1 || y >= height - 2) : EMPTY, safeTiles: high ? tilesWhere(width, height, (_x, y) => y > 1 && y < height - 2) : EMPTY, hazardDamagePct: high ? 0.05 : 0, incomingDamageMultiplier: high ? 1.08 : 0.95, outgoingDamageMultiplier: high ? 0.96 : 1.1, musicIntensity: high ? "pressure" : "calm", signature: "Reliquary Breaker" };
    }
    if (floor === 4) {
        const gap = distance(input.playerPos, input.enemyPos, width), hunted = gap >= 4, pressuring = gap <= 1;
        return { floor, phase: 1, phaseName: hunted ? "Pack Pursuit" : pressuring ? "Broken Hunt" : "Circling Pack", title: hunted ? "Riftmaw has your scent" : pressuring ? "You turn the hunt against Riftmaw" : "Spectral paws circle just beyond sight", instruction: hunted ? "Close the distance. Riftmaw deals 22% more damage to isolated prey." : pressuring ? "Stay close: pressure breaks the phantom pack and boosts your damage." : "Do not let four hexes open between you and the Hound.", tone: "hunt", hazardTiles: EMPTY, safeTiles: EMPTY, hazardDamagePct: 0, incomingDamageMultiplier: hunted ? 1.22 : pressuring ? 0.9 : 1.05, outgoingDamageMultiplier: pressuring ? 1.18 : 1, musicIntensity: hunted ? "climax" : "pressure", signature: "Moonless Execution" };
    }
    return legacyAlpha(turn, 1, width, height);
}
// ── end of the golden reference ──

const KINDS: HollowGateHoundKind[] = ['battle', 'elite', 'ambush', 'beast', 'boss'];
const sorted = (tiles: readonly number[]) => [...tiles].sort((a, b) => a - b);

describe('Hollow Gate director: only the phase II lane sequence changed', () => {
    it('matches the pre-fix director everywhere except phase II openings on turns 4, 8, 12, …', () => {
        let compared = 0;
        let changed = 0;
        for (const floor of [1, 2, 3, 4, 5]) for (const kind of KINDS) for (let turn = 1; turn <= 24; turn += 1) {
            for (const enemyHp of [100, 71, 70, 50, 36, 35, 10, 0]) for (const [playerPos, enemyPos] of [[0, 60], [5, 6], [40, 44], [119, 0]]) {
                const input = { floor, kind, turn, enemyHp, enemyMaxHp: 100, playerPos, enemyPos, gridWidth: GRID_W, gridHeight: GRID_H };
                const next = hollowGateCombatDirective(input);
                const prev = legacyDirective(input);
                compared += 1;
                const phaseTwoOpening = kind === 'boss' && prev.phase === 2 && turn % 2 === 0;
                if (!phaseTwoOpening || turn % 4 === 2) {
                    assert.deepEqual(next, prev, `floor ${floor} ${kind} turn ${turn} hp ${enemyHp}`);
                    continue;
                }
                changed += 1;
                // Turns ≡ 0 (mod 4): the same directive with the lanes reversed.
                const { hazardTiles: nh, safeTiles: ns, ...nRest } = next;
                const { hazardTiles: ph, safeTiles: ps, ...pRest } = prev;
                assert.deepEqual(nRest, pRest, 'copy, cadence, damage %, multipliers and music are untouched');
                assert.deepEqual(sorted(nh), sorted(ps));
                assert.deepEqual(sorted(ns), sorted(ph));
            }
        }
        assert.equal(compared, 5 * KINDS.length * 24 * 8 * 4);
        assert.ok(changed > 0);
    });
});

function fighter(name: string, pos: number, over: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name, hp: 1_000, maxHp: 1_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, shield: 0, statuses: [], pos,
        character: { level: 60, specialty: 'Taijutsu', stats: { taijutsuOffense: 800, taijutsuDefense: 500 }, jutsu: [], pvpItems: [], equipment: {} },
        ...over,
    };
}

/** An Alpha fight at the END of the Alpha's own turn in `round` — the exact
 *  moment the engine resolves the directive's hazard (endSoloPveTurn). */
function alphaAtEnemyTurnEnd(round: number, alphaHp: number, playerPos: number): SoloPveSession {
    const session = createSoloPveSession({
        sessionId: 'alpha-lanes',
        ownerSlug: 'lanes',
        encounter: { kind: 'hollow-gate', id: 'alpha', metadata: { floor: 5, combatKind: 'boss' } },
        player: fighter('Runner', playerPos),
        enemy: fighter('Hollow Hound Alpha', 0, { hp: alphaHp, maxHp: 1_000 }),
        now: 1_800_000_000_000,
    });
    session.round = round;
    session.activeSide = 'enemy';
    return session;
}

/** What the arena shows for that same state (MissionArenaFight computes the
 *  directive from the session's round, the Alpha's HP and the player's tile). */
function displayed(session: SoloPveSession): HollowGateCombatDirective {
    return hollowGateCombatDirective({
        floor: 5, kind: 'boss', turn: session.round, enemyHp: session.enemy.hp, enemyMaxHp: session.enemy.maxHp,
        playerPos: session.player.pos, enemyPos: session.enemy.pos, gridWidth: GRID_W, gridHeight: GRID_H,
    });
}

function resolve(session: SoloPveSession): number {
    const before = session.player.hp;
    endSoloPveTurn(session);
    return before - session.player.hp;
}

describe('Hollow Gate Alpha phase II in the engine that deals the damage', () => {
    const evenTile = 2 * GRID_W + 4; // column 4
    const oddTile = 2 * GRID_W + 5; // column 5

    it('an odd lane is no longer permanently safe: it tears on turns 4 and 8', () => {
        for (const round of [4, 8]) {
            const s = alphaAtEnemyTurnEnd(round, 600, oddTile);
            const shown = displayed(s);
            assert.ok(shown.hazardTiles.includes(oddTile), `round ${round} marks the odd lane`);
            assert.equal(resolve(s), 80, 'and the engine deals exactly the warned 8%');
            const safe = alphaAtEnemyTurnEnd(round, 600, evenTile);
            assert.ok(displayed(safe).safeTiles.includes(evenTile));
            assert.equal(resolve(safe), 0);
        }
        for (const round of [2, 6]) {
            assert.equal(resolve(alphaAtEnemyTurnEnd(round, 600, evenTile)), 80);
            assert.equal(resolve(alphaAtEnemyTurnEnd(round, 600, oddTile)), 0);
        }
    });

    it('inhale turns deal nothing on any tile', () => {
        for (const round of [3, 5, 7]) for (const tile of [evenTile, oddTile, 0, GRID_W * GRID_H - 1]) {
            assert.equal(resolve(alphaAtEnemyTurnEnd(round, 600, tile)), 0);
        }
    });

    it('the engine damage always equals the displayed directive\'s damage for the same state', () => {
        for (let round = 1; round <= 12; round += 1) for (const hp of [1_000, 710, 700, 360, 350, 100]) for (const tile of [0, evenTile, oddTile, 77]) {
            const s = alphaAtEnemyTurnEnd(round, hp, tile);
            const expected = hollowGateHazardDamage(displayed(s), tile, s.player.maxHp);
            assert.equal(resolve(s), expected, `round ${round} hp ${hp} tile ${tile}`);
        }
    });

    it('a threshold the player crosses mid-turn is shown before, and resolved with, the new phase', () => {
        // Round 4 in phase I is between howls: nothing to dodge. The player's
        // hit drops the Alpha to 69% during their own turn; the arena
        // recomputes from the new HP at once and the engine resolves the SAME
        // phase II opening at the end of the Alpha's turn.
        const s = alphaAtEnemyTurnEnd(4, 710, oddTile);
        assert.equal(displayed(s).phase, 1);
        assert.deepEqual(displayed(s).hazardTiles, []);
        s.enemy = { ...s.enemy, hp: 690 };
        const shown = displayed(s);
        assert.equal(shown.phase, 2);
        assert.ok(shown.hazardTiles.includes(oddTile));
        assert.equal(resolve(s), 80);
        // Across 35% the Alpha switches to phase III's checkerboard the same way.
        const deep = alphaAtEnemyTurnEnd(4, 360, oddTile);
        deep.enemy = { ...deep.enemy, hp: 340 };
        const deepShown = displayed(deep);
        assert.equal(deepShown.phase, 3);
        assert.ok(deepShown.hazardTiles.includes(oddTile), 'column 5, row 2 is off the phase III seal at turn 4');
        assert.equal(resolve(deep), hollowGateHazardDamage(deepShown, oddTile, 1_000));
        assert.equal(hollowGateHazardDamage(deepShown, oddTile, 1_000), 90);
    });

    it('a save/resume reproduces the same directive and the same damage', () => {
        const original = alphaAtEnemyTurnEnd(8, 500, oddTile);
        const restored = JSON.parse(JSON.stringify(original)) as SoloPveSession;
        assert.deepEqual(displayed(restored), displayed(original));
        assert.equal(resolve(restored), resolve(original));
        assert.equal(restored.player.hp, original.player.hp);
    });
});
