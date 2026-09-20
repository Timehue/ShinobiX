import assert from "node:assert/strict";
import { test } from "node:test";
import {
    hollowGateAlphaPhase,
    hollowGateCombatDirective,
    hollowGateHazardDamage,
    hollowGatePhaseTransitionText,
} from "./hollow-gate-combat-director";

test("Alpha fight has three stable health-threshold phases", () => {
    assert.equal(hollowGateAlphaPhase(100, 100), 1);
    assert.equal(hollowGateAlphaPhase(70, 100), 2);
    assert.equal(hollowGateAlphaPhase(36, 100), 2);
    assert.equal(hollowGateAlphaPhase(35, 100), 3);
    assert.equal(hollowGateAlphaPhase(0, 100), 3);
});

test("each floor produces a distinct normal-combat mechanic", () => {
    const directives = Array.from({ length: 4 }, (_, index) => hollowGateCombatDirective({
        floor: index + 1,
        kind: "battle",
        turn: 6,
        enemyHp: 100,
        enemyMaxHp: 100,
        playerPos: 100,
        enemyPos: 10,
    }));
    assert.equal(new Set(directives.map((directive) => directive.tone)).size, 4);
    assert.equal(new Set(directives.map((directive) => directive.signature)).size, 4);
    assert.ok(directives.some((directive) => directive.incomingDamageMultiplier !== 1));
    assert.ok(directives.some((directive) => directive.outgoingDamageMultiplier !== 1));
});

test("Alpha phases change lane pattern, pressure, and adaptive music", () => {
    const base = { floor: 5, kind: "boss" as const, turn: 6, enemyMaxHp: 100, playerPos: 0, enemyPos: 60 };
    const phaseOne = hollowGateCombatDirective({ ...base, enemyHp: 100 });
    const phaseTwo = hollowGateCombatDirective({ ...base, enemyHp: 60 });
    const phaseThree = hollowGateCombatDirective({ ...base, enemyHp: 20 });

    assert.deepEqual([phaseOne.phase, phaseTwo.phase, phaseThree.phase], [1, 2, 3]);
    assert.ok(phaseOne.hazardTiles.length > 0);
    assert.ok(phaseTwo.hazardTiles.length > 0);
    assert.ok(phaseThree.hazardTiles.length > 0);
    assert.equal(phaseOne.musicIntensity, "pressure");
    assert.equal(phaseThree.musicIntensity, "climax");
    assert.ok(phaseThree.incomingDamageMultiplier > phaseOne.incomingDamageMultiplier);
    assert.ok(phaseThree.outgoingDamageMultiplier > phaseOne.outgoingDamageMultiplier);
});

test("hazards only damage actors standing on warned tiles", () => {
    const directive = hollowGateCombatDirective({
        floor: 3,
        kind: "battle",
        turn: 2,
        enemyHp: 100,
        enemyMaxHp: 100,
        playerPos: 0,
        enemyPos: 60,
    });
    assert.ok(directive.hazardTiles.includes(0));
    assert.equal(hollowGateHazardDamage(directive, 0, 1_000), 50);
    assert.equal(hollowGateHazardDamage(directive, 60, 1_000), 0);
});

const W = 12;
const H = 10;
const alphaAt = (turn: number, enemyHp = 60) => hollowGateCombatDirective({
    floor: 5, kind: "boss", turn, enemyHp, enemyMaxHp: 100, playerPos: 0, enemyPos: 60, gridWidth: W, gridHeight: H,
});
const columnsOf = (tiles: readonly number[]) => [...new Set(tiles.map((tile) => tile % W))].sort((a, b) => a - b);
const EVEN = [0, 2, 4, 6, 8, 10];
const ODD = [1, 3, 5, 7, 9, 11];

test("Alpha phase II: successive rift openings alternate lane sets (turns 2/4/6/8)", () => {
    // The inhale turn promises "the lane pattern reverses on the next turn".
    // Before the fix every opening marked the even columns, so one step onto
    // an odd column made the whole phase harmless.
    assert.deepEqual(columnsOf(alphaAt(2).hazardTiles), EVEN);
    assert.deepEqual(columnsOf(alphaAt(4).hazardTiles), ODD);
    assert.deepEqual(columnsOf(alphaAt(6).hazardTiles), EVEN);
    assert.deepEqual(columnsOf(alphaAt(8).hazardTiles), ODD);
    for (let turn = 2; turn <= 40; turn += 2) {
        const now = alphaAt(turn), next = alphaAt(turn + 2);
        assert.equal(now.hazardTiles.filter((tile) => next.hazardTiles.includes(tile)).length, 0, `pulse ${turn} and the next share no lane`);
        assert.deepEqual([...now.safeTiles].sort((a, b) => a - b), [...next.hazardTiles].sort((a, b) => a - b), `this pulse's safe lanes are the next pulse's rifts (${turn})`);
    }
});

test("Alpha phase II: inhale turns carry no hazard, no damage, and the reversal warning", () => {
    for (const turn of [1, 3, 5, 7, 9, 11]) {
        const directive = alphaAt(turn);
        assert.equal(directive.phase, 2);
        assert.deepEqual(directive.hazardTiles, []);
        assert.equal(directive.hazardDamagePct, 0);
        for (let tile = 0; tile < W * H; tile += 1) assert.equal(hollowGateHazardDamage(directive, tile, 1_000), 0);
        assert.match(directive.instruction, /reverses on the next turn/);
    }
});

test("Alpha phase II: open-turn hazard and safe sets are disjoint, valid, cover the grid, and match damage", () => {
    for (const turn of [2, 4, 6, 8, 10, 12]) {
        const directive = alphaAt(turn);
        const hazard = new Set(directive.hazardTiles), safe = new Set(directive.safeTiles);
        assert.equal([...hazard].filter((tile) => safe.has(tile)).length, 0);
        assert.equal(hazard.size + safe.size, W * H);
        for (const tile of [...hazard, ...safe]) assert.ok(Number.isInteger(tile) && tile >= 0 && tile < W * H);
        for (let tile = 0; tile < W * H; tile += 1) {
            assert.equal(hollowGateHazardDamage(directive, tile, 1_000), hazard.has(tile) ? 80 : 0, `turn ${turn} tile ${tile}`);
        }
        // Cadence, damage and multipliers are exactly as authored.
        assert.equal(directive.hazardDamagePct, 0.08);
        assert.equal(directive.incomingDamageMultiplier, 1.1);
        assert.equal(directive.outgoingDamageMultiplier, 1.12);
    }
    assert.equal(alphaAt(3).outgoingDamageMultiplier, 1.04);
});

test("Alpha phase II lanes follow the absolute turn, whether phase II begins on an odd or an even turn", () => {
    // Entering on an even turn opens at once; entering on an odd turn inhales
    // first. Either way the lanes are a pure function of (turn, HP): no
    // phase-entry state, so a reload or a second client derives the same set.
    for (const entry of [3, 4, 7, 10]) {
        const beforeEntry = hollowGateCombatDirective({ floor: 5, kind: "boss", turn: entry - 1, enemyHp: 71, enemyMaxHp: 100, playerPos: 0, enemyPos: 60, gridWidth: W, gridHeight: H });
        assert.equal(beforeEntry.phase, 1);
        const atEntry = alphaAt(entry, 70);
        assert.equal(atEntry.phase, 2);
        assert.equal(atEntry.hazardTiles.length > 0, entry % 2 === 0);
        const firstOpen = entry % 2 === 0 ? entry : entry + 1;
        assert.deepEqual(columnsOf(alphaAt(firstOpen, 69).hazardTiles), (firstOpen / 2) % 2 === 1 ? EVEN : ODD);
        assert.deepEqual(alphaAt(firstOpen, 69), alphaAt(firstOpen, 36), "HP inside phase II never changes the lanes");
    }
});

test("Alpha thresholds: 70% enters phase II and 35% enters phase III, pattern switching with them", () => {
    assert.equal(alphaAt(4, 71).phase, 1);
    assert.equal(alphaAt(4, 70).phase, 2);
    assert.equal(alphaAt(4, 36).phase, 2);
    assert.equal(alphaAt(4, 35).phase, 3);
    // Phase I at turn 4 is between howls (every third turn): nothing to dodge.
    assert.deepEqual(alphaAt(4, 71).hazardTiles, []);
    assert.deepEqual(columnsOf(alphaAt(4, 70).hazardTiles), ODD);
    // Phase III is its own flipping checkerboard, untouched by this fix.
    const three = alphaAt(4, 35);
    assert.equal(three.hazardDamagePct, 0.09);
    for (const tile of three.hazardTiles) assert.notEqual(((tile % W) + Math.floor(tile / W)) % 2, 0);
});

test("the directive is deterministic for the same state (reload/resume)", () => {
    for (const turn of [2, 3, 4, 5, 6]) {
        const a = alphaAt(turn), b = alphaAt(turn);
        assert.deepEqual(a, b);
        assert.deepEqual(JSON.parse(JSON.stringify(a)), a, "survives a JSON round trip unchanged");
    }
});

test("phase transition copy only fires while escalating", () => {
    assert.match(hollowGatePhaseTransitionText(1, 2) ?? "", /RIFTSTALKER/);
    assert.match(hollowGatePhaseTransitionText(2, 3) ?? "", /GATE-EATER/);
    assert.equal(hollowGatePhaseTransitionText(3, 2), null);
});
