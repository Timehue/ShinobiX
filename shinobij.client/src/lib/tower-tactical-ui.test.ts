import assert from "node:assert/strict";
import test from "node:test";
import {
    buildTowerMilestoneReceipt,
    buildTowerThreatSummary,
    buildTowerTileLabel,
    clampTowerPan,
    clampTowerZoom,
    estimateTowerActionDamage,
    projectTowerClearScore,
} from "./tower-tactical-ui";

test("story Tower milestone receipts are progression records, never wearable titles", () => {
    const receipt = buildTowerMilestoneReceipt("tower-floor-5");
    assert.equal(receipt, "Milestone recorded · Floor 5");
    assert.doesNotMatch(receipt, /title/i);
});

test("tower zoom stays between fit and the render ceiling", () => {
    assert.equal(clampTowerZoom(0.25), 1);
    assert.equal(clampTowerZoom(1.75), 1.75);
    assert.equal(clampTowerZoom(4), 2.5);
    assert.equal(clampTowerZoom(2, 1.4), 1.4);
});

test("tower pan reaches every overflow edge without losing the board", () => {
    assert.deepEqual(
        clampTowerPan({ x: 500, y: -500 }, { width: 320, height: 240 }, { width: 520, height: 440 }),
        { x: 100, y: -100 },
    );
    assert.deepEqual(
        clampTowerPan({ x: 50, y: -20 }, { width: 640, height: 480 }, { width: 520, height: 440 }),
        { x: 0, y: 0 },
    );
});

test("tower tile names combine position, occupant, terrain, danger, and legal action", () => {
    const label = buildTowerTileLabel({
        position: 13,
        width: 6,
        occupant: "Ash Warden",
        objective: true,
        danger: ["Boss strike at round end"],
        validAction: "Attack Ash Warden",
    });
    assert.match(label, /row 3, column 2/i);
    assert.match(label, /Occupied by Ash Warden/);
    assert.match(label, /Objective tile/);
    assert.match(label, /Danger: Boss strike at round end/);
    assert.match(label, /Available: Attack Ash Warden/);
});

test("threat summary orders immediate impacts before future gates", () => {
    assert.deepEqual(buildTowerThreatSummary({
        round: 7,
        strikeLabel: "Sovereign barrage",
        strikeTiles: 7,
        hazardTiles: 2,
        ringTiles: 6,
        reinforcementRound: 8,
        reinforcementCount: 3,
        nextBossPhase: 40,
        roundCap: 9,
    }), [
        "End of round 7: Sovereign barrage hits 7 tiles",
        "2 hazard tiles erupt at round end",
        "6 outer tiles are outside the safe ring",
        "3 reinforcements arrive in round 8",
        "Next boss phase at 40% HP",
        "2 rounds remain before the floor closes",
    ]);
});

test("Tower score projection mirrors speed, survival, no-death, and elite-route stakes", () => {
    const safe = projectTowerClearScore({
        floor: 6, round: 3, roundBudget: 8,
        squadHpRemaining: 9_000, squadHpMax: 10_000, deaths: 0,
    });
    const elite = projectTowerClearScore({
        floor: 6, round: 3, roundBudget: 8,
        squadHpRemaining: 9_000, squadHpMax: 10_000, deaths: 0, scoreMultiplier: 1.25,
    });
    assert.equal(safe.paceLabel, "5 rounds ahead of par");
    assert.equal(safe.noDeathBonusActive, true);
    assert.equal(elite.score, Math.round(safe.score * 1.25));
});

test("target forecast accounts for target shield before HP damage", () => {
    const stats = {
        strength: 100, speed: 100, intelligence: 100, willpower: 100,
        taijutsuOffense: 100, taijutsuDefense: 100,
    };
    const result = estimateTowerActionDamage({
        attacker: { hp: 1000, maxHp: 1000, character: { stats } },
        target: { hp: 1000, maxHp: 1000, shield: 150, character: { stats } },
        effectPower: 10,
        type: "Taijutsu",
        actionId: "basic-attack",
    });
    assert.ok(result.rawDamage > 150);
    assert.equal(result.shieldAbsorbed, 150);
    assert.equal(result.hpDamage, result.rawDamage - 150);
});
