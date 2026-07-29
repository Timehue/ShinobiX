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

test("phase transition copy only fires while escalating", () => {
    assert.match(hollowGatePhaseTransitionText(1, 2) ?? "", /RIFTSTALKER/);
    assert.match(hollowGatePhaseTransitionText(2, 3) ?? "", /GATE-EATER/);
    assert.equal(hollowGatePhaseTransitionText(3, 2), null);
});
