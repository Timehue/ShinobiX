import assert from "node:assert/strict";
import test from "node:test";
import { createShowdownSession, resolveShowdownRound } from "../../../api/_pet-showdown/engine";
import { PET_CATALOG } from "../../../api/pet/_catalog";
import type { Pet } from "../../../api/_pet-sim/pet-types";
import { showdownContactEffectKind, showdownContactOutcome, showdownProjectilePath } from "./showdown-contact-vfx";

test("contact visuals distinguish damage, guarded damage, protection and a miss", () => {
    assert.equal(showdownContactOutcome({ damage: 40, guarded: false }), "hit");
    assert.equal(showdownContactOutcome({ damage: 20, guarded: true }), "block");
    assert.equal(showdownContactOutcome({ damage: 0, guarded: false, applied: "protect" }), "block");
    assert.equal(showdownContactOutcome({ damage: 0, guarded: false }), "block");
    assert.equal(showdownContactOutcome(undefined), "miss");
    assert.equal(showdownContactOutcome({ damage: 0, guarded: false, applied: "failed" }), "miss");
    assert.equal(showdownContactOutcome({ damage: 0, guarded: false, applied: "stun" }), "hit");
    assert.equal(showdownContactOutcome({ damage: 0, guarded: false, heal: 25 }), "hit");
});

test("blocked attacks cannot show successful damage or status paint in sibling VFX layers", () => {
    for (const kind of ["damage", "burn", "crush", "freeze", "stun"]) {
        assert.equal(showdownContactEffectKind(kind, { damage: 0, guarded: true, applied: "protect" }), "protect");
        assert.equal(showdownContactEffectKind(kind, { damage: 0, guarded: false }), "protect");
        assert.equal(showdownContactEffectKind(kind, undefined), null);
        assert.equal(showdownContactEffectKind(kind, { damage: 20, guarded: true }), kind);
    }
    assert.equal(showdownContactEffectKind("protect", { damage: 0, guarded: false, applied: "failed" }), null);
    assert.equal(showdownContactEffectKind("burn", { damage: 0, guarded: false, applied: "burn" }), "burn");
    assert.equal(showdownContactEffectKind("heal", { damage: 0, guarded: false, heal: 25 }), "heal");
});

test("live engine verdicts agree with contact paint for Protect, absorption and dodge", () => {
    for (const defense of ["protect", "shield", "dodge"] as const) {
        const player = { ...PET_CATALOG["standard-0"], id: "attacker", level: 30 } as unknown as Pet;
        const enemy = { ...PET_CATALOG["standard-8"], id: "defender", role: "defender", level: 30 } as unknown as Pet;
        const session = createShowdownSession({
            sessionId: "contact-test", playerName: "Tester", format: "1v1", tier: "warrior", seed: 12345,
            playerPets: [player], enemyPets: [enemy], enemyTeamName: "Foes", rewardEligible: false,
        });
        const defender = session.enemy[0];
        if (defense === "dodge") {
            defender.consumable = { id: "smoke-test", name: "Smoke", dodge: 1, mitigate: 0, thorns: 0, endure: 0, lifeline: 0, cleanse: 0 };
        } else if (defense === "shield") {
            defender.statuses.push({ kind: defense, rounds: 3, magnitude: 100000, bornRound: session.round });
        }
        const protectIndex = defender.moves.findIndex((move) => move.kind === "protect");
        assert.ok(protectIndex >= 0);
        const events = resolveShowdownRound(session,
            [{ kind: "move", petId: "attacker", moveIndex: 0, targetId: "defender" }],
            defense === "protect"
                ? [{ kind: "move", petId: "defender", moveIndex: protectIndex, targetId: "defender" }]
                : [{ kind: "rest", petId: "defender" }]);
        const action = events.find((event) => event.t === "action" && event.actorId === "attacker");
        assert.ok(action?.t === "action");
        const target = action.targets.find((entry) => entry.id === "defender");
        assert.equal(showdownContactOutcome(target), defense === "dodge" ? "miss" : "block", defense);
        assert.equal(showdownContactEffectKind(action.moveKind, target), defense === "dodge" ? null : "protect", defense);
    }
});

test("projectiles leave and arrive at visible surfaces in straight and diagonal lanes", () => {
    for (const x of [-3.6, 0, 3.6]) for (const radius of [0.62, 1.1, 1.58]) {
        const path = showdownProjectilePath(-3.6, 4.1, x, -4.1, radius, 1.58);
        assert.ok(Math.abs(Math.hypot(path.fromX + 3.6, path.fromZ - 4.1) - radius - 0.12) < 1e-8);
        assert.ok(Math.abs(Math.hypot(path.toX - x, path.toZ + 4.1) - 1.7) < 1e-8);
        assert.ok((path.toX - path.fromX) * path.dx + (path.toZ - path.fromZ) * path.dz > 0);
    }
});

test("overlapping or coincident projectile endpoints stay finite and never reverse", () => {
    for (const distance of [0, 0.05, 0.1, 0.5, 2]) {
        const path = showdownProjectilePath(0, 0, distance, 0, 1.58, 1.58);
        assert.ok(Object.values(path).every(Number.isFinite));
        assert.ok(path.toX >= path.fromX);
    }
});
