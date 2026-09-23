import test from "node:test";
import assert from "node:assert/strict";
import { petCombatModel } from "./pet-3d-models";
import { advanceCombatBodyYaw, attackClipWindow, motionOwnsLocomotion, petDeathChoreography, resolveCombatBodyFacing, resolveCombatBodyYaw, resolveOpponentFacing } from "./pet-combat-performance";

test("a scheduled contact freezes the authored extension rather than the start of the swing", () => {
    const impact = attackClipWindow('strike', true)!;
    assert.ok(impact.start >= 0.5 && impact.start <= 0.56);
    assert.equal(impact.end, attackClipWindow('recover')!.start);
    assert.deepEqual(attackClipWindow('windup', true), attackClipWindow('windup'));
});

const rotateLocalForward = (x: number, z: number, yaw: number): [number, number] => [
    x * Math.cos(yaw) + z * Math.sin(yaw),
    -x * Math.sin(yaw) + z * Math.cos(yaw),
];

test("attack clip windows preserve anticipation, contact, and recovery order", () => {
    const windup = attackClipWindow("windup")!;
    const strike = attackClipWindow("strike")!;
    const recover = attackClipWindow("recover")!;
    assert.equal(windup.start, 0);
    assert.equal(windup.end, strike.start);
    assert.equal(strike.end, recover.start);
    assert.ok(recover.end < 1);
});

test("residual movement cannot layer locomotion over committed actions", () => {
    assert.equal(motionOwnsLocomotion("idle", true), true);
    assert.equal(motionOwnsLocomotion("run", false), true);
    assert.equal(motionOwnsLocomotion("windup", true), false);
    assert.equal(motionOwnsLocomotion("strike", true), false);
    assert.equal(motionOwnsLocomotion("recover", true), false);
    assert.equal(motionOwnsLocomotion("guard", true), false);
    assert.equal(motionOwnsLocomotion("rest", true), false);
});

test("dash travel reacquires the opponent before contact", () => {
    const launch = resolveCombatBodyFacing({ faceX: 1, faceZ: 0, moveX: 0, moveZ: 1, motion: "dash", motionAge: 0, allowTravelFacing: true });
    const contact = resolveCombatBodyFacing({ faceX: 1, faceZ: 0, moveX: 0, moveZ: 1, motion: "dash", motionAge: 0.58, allowTravelFacing: true });
    assert.ok(launch[1] > 0.99);
    assert.ok(contact[0] > 0.99);
});

test("ordinary quadruped travel can turn without ever facing away from combat", () => {
    const facing = resolveCombatBodyFacing({ faceX: 1, faceZ: 0, moveX: -1, moveZ: 0, motion: "run", motionAge: 1, allowTravelFacing: true });
    const alignment = facing[0];
    assert.ok(alignment > 0.7, `body alignment ${alignment} should keep the opponent in its forward cone`);
});

test("opposing pets receive reciprocal headings that point directly at each other", () => {
    const player = resolveOpponentFacing(-3.4, 2.6, 1.2, -1.5);
    const enemy = resolveOpponentFacing(1.2, -1.5, -3.4, 2.6);
    const playerToEnemy = [4.6, -4.1] as const;
    const enemyToPlayer = [-4.6, 4.1] as const;
    assert.ok(player[0] * playerToEnemy[0] + player[1] * playerToEnemy[1] > Math.hypot(...playerToEnemy) * 0.999);
    assert.ok(enemy[0] * enemyToPlayer[0] + enemy[1] * enemyToPlayer[1] > Math.hypot(...enemyToPlayer) * 0.999);
    assert.ok(Math.abs(player[0] + enemy[0]) < 1e-9);
    assert.ok(Math.abs(player[1] + enemy[1]) < 1e-9);
});

test("reviewed mesh forward axes face the opponent from either side of the arena", () => {
    const models = [
        { id: "rare-42", name: "Thunder Jerboa", localForward: [Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)], evolutionStage: 0 as const },
        { id: "rare-43", name: "Static Meerkat", localForward: [Math.SQRT1_2, Math.SQRT1_2], evolutionStage: 0 as const },
        { id: "mythic-3", name: "Solar Stag", localForward: [-1, 0], evolutionStage: 0 as const },
        { id: "starter-fire", name: "Ember Wolf", localForward: [1, 0], evolutionStage: 1 as const },
        { id: "starter-water", name: "Abyssal Leviathan", localForward: [Math.SQRT1_2, Math.SQRT1_2], evolutionStage: 2 as const },
        { id: "starter-lightning", name: "Bolt Fang", localForward: [-Math.SQRT1_2, Math.SQRT1_2], evolutionStage: 1 as const },
        { id: "legendary-2", name: "Umbra Fox", localForward: [Math.SQRT1_2, Math.SQRT1_2], evolutionStage: 0 as const },
        { id: "legendary-4", name: "Ironfang Tiger", localForward: [0, 1], evolutionStage: 0 as const },
        { id: "mythic-9", name: "Worldroot Colossus", localForward: [0, 1], evolutionStage: 0 as const },
        { id: "legendary-29", name: "Verdant Treant", localForward: [0, 1], evolutionStage: 0 as const },
        { id: "starter-lightning", name: "Raijin Hound", localForward: [0, 1], evolutionStage: 2 as const },
    ];
    for (const { localForward, ...pet } of models) {
        const model = petCombatModel({ ...pet, rarity: "legendary" })!;
        for (const side of [1, -1]) {
            const target = resolveOpponentFacing(-3.4 * side, 2.6 * side, 1.2 * side, -1.5 * side);
            const forward = rotateLocalForward(localForward[0], localForward[1], resolveCombatBodyYaw(target[0], target[1], model.yawOffset));
            assert.ok(forward[0] * target[0] + forward[1] * target[1] > 0.999999, `${pet.name} must face its opponent on side ${side}`);
        }
    }
});

test("locked duel locomotion preserves the opponent heading instead of the travel tangent", () => {
    const opponent = resolveOpponentFacing(-3.4, 2.6, 1.2, -1.5);
    const body = resolveCombatBodyFacing({
        faceX: opponent[0],
        faceZ: opponent[1],
        moveX: -1,
        moveZ: 0,
        motion: "run",
        motionAge: 1,
        allowTravelFacing: false,
    });
    assert.ok(body[0] * opponent[0] + body[1] * opponent[1] > 0.999999);
});

test("bounded combat yaw takes the short arc and can never exceed one readable frame", () => {
    const cap = 55 * Math.PI / 180;
    const acrossWrap = advanceCombatBodyYaw(179 * Math.PI / 180, -179 * Math.PI / 180, 1 / 60, 50, cap);
    const wrapStep = Math.atan2(Math.sin(acrossWrap - 179 * Math.PI / 180), Math.cos(acrossWrap - 179 * Math.PI / 180));
    assert.ok(Math.abs(wrapStep - 2 * Math.PI / 180) < 1e-9, "the body should take the two-degree path across the wrap");

    const reversal = advanceCombatBodyYaw(0, Math.PI, 0.25, 100, cap);
    assert.ok(Math.abs(reversal) <= cap + 1e-9, "a dropped frame must not turn into a 180-degree flip");
    assert.equal(advanceCombatBodyYaw(reversal, Math.PI, 0, 100, cap), reversal, "a zero-time frame must be inert");
});

test("death choreography recoils, falls once, impacts, and settles", () => {
    const start = petDeathChoreography(0, 2, "quadruped");
    const recoil = petDeathChoreography(0.08, 2, "quadruped");
    const falling = petDeathChoreography(0.45, 2, "quadruped");
    const impact = petDeathChoreography(0.9, 2, "quadruped");
    const settled = petDeathChoreography(1.4, 2, "quadruped");
    assert.equal(start.fall, 0);
    assert.ok(recoil.lift > 0);
    assert.ok(falling.fall > 0 && falling.fall < 1);
    assert.ok(impact.impact > 0);
    assert.equal(settled.fall, 1);
    assert.ok(settled.sink > 0);
    assert.ok(settled.impact < 1e-9);
});
