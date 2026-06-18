import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlayerRead, classifyPlayerAction, type PlayerActionRecord, type ReadStatus } from "./combat-ai-tactics";

const base = {
    turn: 5,
    hp: 1000,
    maxHp: 1000,
    ap: 100,
    shield: 0,
    statuses: [] as ReadStatus[],
    recentActions: [] as PlayerActionRecord[],
};

test("buildPlayerRead — clean state has no reads", () => {
    const r = buildPlayerRead(base);
    assert.equal(r.lowHp, false);
    assert.equal(r.lowAp, false);
    assert.equal(r.shielded, false);
    assert.equal(r.buffCount, 0);
    assert.equal(r.meaningfulBuffCount, 0);
    assert.equal(r.dotCount, 0);
    assert.equal(r.stunned, false);
    assert.equal(r.sealed, false);
    assert.equal(r.justPoweredUp, false);
    assert.equal(r.aggression, 0);
    assert.equal(r.favorsSustain, false);
});

test("buildPlayerRead — lowHp / lowAp / shield thresholds", () => {
    assert.equal(buildPlayerRead({ ...base, hp: 350 }).lowHp, true);   // 35%
    assert.equal(buildPlayerRead({ ...base, hp: 351 }).lowHp, false);
    assert.equal(buildPlayerRead({ ...base, ap: 49 }).lowAp, true);
    assert.equal(buildPlayerRead({ ...base, ap: 50 }).lowAp, false);
    assert.equal(buildPlayerRead({ ...base, shield: 1 }).shielded, true);
});

test("buildPlayerRead — meaningful buffs exclude trivia, count amps/defense", () => {
    const r = buildPlayerRead({
        ...base,
        statuses: [
            { name: "Increase Damage Given", kind: "positive" },
            { name: "Decrease Damage Taken", kind: "positive" },
            { name: "Move", kind: "positive" }, // not meaningful
        ],
    });
    assert.equal(r.buffCount, 3);
    assert.equal(r.meaningfulBuffCount, 2);
    assert.equal(r.offensiveBuffs, 1); // IDG
    assert.equal(r.hasDefensiveBuff, true); // DDT
});

test("buildPlayerRead — dot count, stun and seal flags", () => {
    const r = buildPlayerRead({
        ...base,
        statuses: [
            { name: "Wound", kind: "negative" },
            { name: "Poison", kind: "negative" },
            { name: "Stun", kind: "negative" },
            { name: "Bloodline Seal", kind: "negative" },
        ],
    });
    assert.equal(r.dotCount, 2);
    assert.equal(r.stunned, true);
    assert.equal(r.sealed, true);
});

test("buildPlayerRead — justPoweredUp when last action was setup", () => {
    const shielded = buildPlayerRead({ ...base, recentActions: [{ kind: "attack", turn: 4 }, { kind: "shield", turn: 5 }] });
    assert.equal(shielded.lastAction, "shield");
    assert.equal(shielded.justPoweredUp, true);
    const attacked = buildPlayerRead({ ...base, recentActions: [{ kind: "shield", turn: 4 }, { kind: "attack", turn: 5 }] });
    assert.equal(attacked.justPoweredUp, false);
});

test("buildPlayerRead — aggression and turtle read over the window", () => {
    const aggro = buildPlayerRead({ ...base, recentActions: [
        { kind: "attack", turn: 2 }, { kind: "attack", turn: 3 }, { kind: "weapon", turn: 4 }, { kind: "attack", turn: 5 },
    ] });
    assert.equal(aggro.aggression, 1);
    assert.equal(aggro.favorsSustain, false);

    const turtle = buildPlayerRead({ ...base, recentActions: [
        { kind: "shield", turn: 2 }, { kind: "heal", turn: 3 }, { kind: "cleanse", turn: 4 }, { kind: "attack", turn: 5 },
    ] });
    assert.equal(turtle.favorsSustain, true);
    assert.ok(turtle.aggression < 0.5);
});

test("classifyPlayerAction — id and option mapping", () => {
    assert.equal(classifyPlayerAction("clear"), "clear");
    assert.equal(classifyPlayerAction("cleanse"), "cleanse");
    assert.equal(classifyPlayerAction("basicHeal"), "heal");
    assert.equal(classifyPlayerAction("move"), "move");
    assert.equal(classifyPlayerAction("dash"), "move");
    assert.equal(classifyPlayerAction("starter-universal-flicker"), "move");
    assert.equal(classifyPlayerAction("wait"), "wait");
    assert.equal(classifyPlayerAction("item-x", { isWeapon: true }), "weapon");
    assert.equal(classifyPlayerAction("item-x", { isItem: true }), "item");
    assert.equal(classifyPlayerAction("some-jutsu", { isSelfSupport: true }), "shield");
    assert.equal(classifyPlayerAction("some-jutsu", { dealtDamage: false }), "buff");
    assert.equal(classifyPlayerAction("some-jutsu", { dealtDamage: true }), "attack");
    assert.equal(classifyPlayerAction("unknown-jutsu"), "attack");
});
