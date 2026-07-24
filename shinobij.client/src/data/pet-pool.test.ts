import { test } from "node:test";
import assert from "node:assert/strict";
import { rawPetPool } from "./pet-pool";
import { balanceBuiltInPetTemplate, normalizePetTemplate } from "../lib/pet-balance";

// The flavor map in pet-pool.ts is keyed by template NAME — a typo in a key
// would silently ship a species with no description (dead data the Pet Yard
// panel just hides). Lock in that every template carries one line.
test("every wild pet template ships one line of flavor", () => {
    for (const pet of rawPetPool) {
        assert.ok(
            (pet.description ?? "").trim().length > 0,
            `${pet.id} (${pet.name}) has no description — check the wildPetFlavor key`,
        );
    }
});

// Pets befriended before the flavor pass have no description in the save;
// normalizePetTemplate must backfill it from the template (and never clobber
// a description the pet already carries, e.g. a local admin edit).
test("normalizePetTemplate backfills flavor onto pre-flavor saved pets", () => {
    const pool = rawPetPool.map(balanceBuiltInPetTemplate);
    const template = pool.find((pet) => pet.name === "Thunder Drake");
    assert.ok(template, "Thunder Drake template exists");
    const { description: _dropped, ...bare } = template;
    const saved = { ...bare, id: `${template.id}-1700000000000` };
    assert.equal(normalizePetTemplate(saved, pool).description, template.description);
    const edited = { ...saved, description: "Kennel master's note." };
    assert.equal(normalizePetTemplate(edited, pool).description, "Kennel master's note.");
});
