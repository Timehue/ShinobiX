import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import {
    derivePetRole, petRoleOf, roleStatMult, ROLE_OF_SUBROLE, ROLE_RANGE,
    type PetRole,
} from "./pet-roles";
import { rawPetPool } from "../data/pet-pool";
import { balanceBuiltInPetTemplate } from "./pet-balance";
import { STARTER_PETS } from "../data/starter-pets";

const ROLES: PetRole[] = ["defender", "tracker", "assassin", "sage"];
const pool = rawPetPool.map(balanceBuiltInPetTemplate);

function tally(pets: Pick<Pet, "id" | "name" | "element" | "rarity">[]): Record<PetRole, number> {
    const out: Record<PetRole, number> = { defender: 0, tracker: 0, assassin: 0, sage: 0 };
    for (const p of pets) out[petRoleOf(p)]++;
    return out;
}

// ── Determinism ───────────────────────────────────────────────────────────────
test("derivePetRole is pure + deterministic", () => {
    for (const p of pool) assert.deepEqual(derivePetRole(p), derivePetRole(p));
});

test("every sub-role nests under the role it is assigned (control swings to sage only as a sage)", () => {
    for (const p of pool) {
        const { role, subRole } = derivePetRole(p);
        if (subRole === "control") {
            assert.ok(role === "tracker" || role === "sage", `${p.name}: control under ${role}`);
        } else {
            assert.equal(ROLE_OF_SUBROLE[subRole], role, `${p.name}: ${subRole} should be ${ROLE_OF_SUBROLE[subRole]}, got ${role}`);
        }
    }
});

// ── Starter coverage (owner: all 4 roles across the 5 starters) ────────────────
test("the 5 starters cover all four roles (one doubles)", () => {
    const starterRoles = STARTER_PETS.map((o) => petRoleOf(o.pet));
    const distinct = new Set(starterRoles);
    assert.equal(distinct.size, 4, `starters cover ${distinct.size}/4 roles: ${starterRoles.join(",")}`);
    assert.equal(starterRoles.length, 5, "expected 5 starters");
    // Exactly one role doubles.
    const counts = tally(STARTER_PETS.map((o) => o.pet));
    assert.deepEqual(Object.values(counts).sort(), [1, 1, 1, 2], `starter role spread ${JSON.stringify(counts)}`);
});

// ── Even distribution across the whole pool (~25% each) ────────────────────────
test("roles are close to evenly distributed across all 140 pool pets", () => {
    const counts = tally(pool);
    const total = pool.length;
    for (const role of ROLES) {
        const frac = counts[role] / total;
        assert.ok(frac >= 0.20 && frac <= 0.30, `${role} is ${(frac * 100).toFixed(1)}% (${counts[role]}/${total}) — outside 20–30%`);
    }
    // Spread between most- and least-common role stays tight.
    const vals = Object.values(counts);
    assert.ok(Math.max(...vals) - Math.min(...vals) <= total * 0.10, `role spread too wide: ${JSON.stringify(counts)}`);
});

test("each rarity tier is also roughly even (no tier is single-role)", () => {
    for (const rarity of ["standard", "rare", "legendary"] as const) {
        const counts = tally(pool.filter((p) => p.rarity === rarity));
        assert.equal(Object.values(counts).filter((c) => c === 0).length, 0, `${rarity} missing a role: ${JSON.stringify(counts)}`);
    }
});

// ── Range + stat lean sanity ───────────────────────────────────────────────────
test("ranged roles fight farther than melee roles", () => {
    assert.ok(ROLE_RANGE.sage.atkRange > ROLE_RANGE.defender.atkRange);
    assert.ok(ROLE_RANGE.tracker.atkRange > ROLE_RANGE.assassin.atkRange);
    assert.equal(ROLE_RANGE.defender.melee, true);
    assert.equal(ROLE_RANGE.tracker.melee, false);
});

test("stat lean expresses role identity (defender tankier, assassin burstier, bruiser keeps HP)", () => {
    const def = roleStatMult("defender", "tank");
    const asn = roleStatMult("assassin", "assassin");
    assert.ok(def.defense > asn.defense, "defender should out-defend assassin");
    assert.ok(asn.attack > def.attack, "assassin should out-attack defender");
    // Owner: a bruiser-defender gains HP AND attack vs a tank-defender, trading defense.
    const tank = roleStatMult("defender", "tank");
    const bruiser = roleStatMult("defender", "bruiser");
    assert.ok(bruiser.hp > tank.hp, "bruiser should have more HP than tank");
    assert.ok(bruiser.attack > tank.attack, "bruiser should have more attack than tank");
    assert.ok(bruiser.defense < tank.defense, "bruiser should have less defense than tank");
});
