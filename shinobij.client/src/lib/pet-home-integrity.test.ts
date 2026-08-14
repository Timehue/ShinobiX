import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Pet Home cross-layer integrity wiring", () => {
    it("adopts every Sanctuary and breeding mutation save version immediately", () => {
        const app = source("../App.tsx");
        const home = source("../screens/Home.tsx");
        const sanctuary = source("../components/PetSanctuary.tsx");
        const breeding = source("../components/PetBreedingBarn.tsx");

        assert.match(app, /<Home[^>]+onVersionedCharacter=\{commitVersionedCharacter\}/s);
        assert.ok(home.includes("<PetSanctuary") && home.includes("onVersionedCharacter={onVersionedCharacter}"));
        assert.ok(home.includes("<PetBreedingBarn") && (home.match(/onVersionedCharacter=\{onVersionedCharacter\}/g) ?? []).length === 2);
        assert.equal((sanctuary.match(/commitServerCharacter\(result\.character, result\._saveVersion\)/g) ?? []).length, 3);
        assert.ok((breeding.match(/commitServerCharacter\(result\.character, (result\._saveVersion|version)\)/g) ?? []).length >= 3);
        for (const component of [sanctuary, breeding]) {
            assert.ok(component.indexOf("if (onVersionedCharacter)") < component.indexOf("onServerVersion(version)"), "atomic adoption must take precedence over the compatibility fallback");
        }
    });

    it("keeps the irreversible breeding commitment explicit in the confirmation dialog", () => {
        const breeding = source("../components/PetBreedingBarn.tsx");
        assert.ok(breeding.includes("One breeding use will be permanently consumed from each parent."));
        assert.ok(breeding.includes("Breeding takes 24 real hours and cannot be canceled or rerolled."));
    });

    it("server-authorizes transfer, breeding, and release against combat assignments", () => {
        const transfer = source("../../../api/pet/sanctuary-transfer.ts");
        const breedingStart = source("../../../api/pet/breeding-start.ts");
        const progress = source("../../../api/pet/progress.ts");

        for (const route of [transfer, breedingStart]) {
            assert.ok(route.includes("battle-lock:${playerName}"));
            assert.ok(route.includes("petladder:coliseum:def:${playerName}"));
            assert.ok(route.includes("petladder:tactical:def:${playerName}"));
        }
        assert.ok(progress.includes("battle-lock:${playerName}"));
        assert.ok(progress.includes("petBusyReason(character, pet"));
        assert.ok(progress.includes("before releasing it"));
    });

    it("preserves the server save version and overflow destination when befriending", () => {
        const api = source("./hollow-gate-locked-door-api.ts");
        const tile = source("./hollow-gate-tile.ts");
        assert.ok(api.includes("saveVersion: data._saveVersion"));
        assert.ok(api.includes("destination: data.destination"));
        assert.ok(tile.includes("onVersionedCharacter(befriended.character, befriended.saveVersion)"));
        assert.ok(tile.includes('befriended.destination === "sanctuary"'));
    });
});
