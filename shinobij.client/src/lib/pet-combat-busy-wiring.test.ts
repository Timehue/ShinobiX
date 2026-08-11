import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("client PvE summon surfaces reuse the centralized combat-busy mirror", () => {
    for (const relativePath of ["../screens/Arena.tsx", "../screens/StoryBoss.tsx"] as const) {
        const source = readFileSync(resolve("shinobij.client/src/lib", relativePath), "utf8");
        assert.match(source, /clientPetCombatBusyReason/, `${relativePath} must enforce the shared client mirror`);
        assert.match(source, /activeCarriedPets/, `${relativePath} must project only entitlement-active carried pets`);
        assert.doesNotMatch(
            source,
            /isPetOnExpedition\(activeBattlePet\)/,
            `${relativePath} must not use the running-timer-only expedition helper for PvE summons`,
        );
    }
});

test("the breeding UI delegates its combat-busy subset to the same mirror", () => {
    const source = readFileSync(resolve("shinobij.client/src/lib/pet-breeding.ts"), "utf8");
    assert.match(source, /clientPetCombatBusyReason/);
    assert.doesNotMatch(source, /if \(pet\.(?:training|expedition)\)/);
});
