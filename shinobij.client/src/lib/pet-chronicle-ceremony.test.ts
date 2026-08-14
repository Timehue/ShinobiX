import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
    petChronicleCeremonyCopy,
    petChronicleCeremonyFromSettlement,
    petChronicleProgressCopy,
    petChronicleProgressFromSettlement,
} from "./pet-chronicle-ceremony";

test("Living Witness ceremony is driven only by a server receipt", () => {
    assert.equal(petChronicleCeremonyFromSettlement({}), null);
    assert.equal(petChronicleCeremonyFromSettlement({ chronicleCards: [], witnessedPets: [] }), null);

    const receipt = petChronicleCeremonyFromSettlement({
        chronicleCards: ["pet-witness-fire", "pet-witness-fire"],
        witnessedPets: [{
            cardId: "pet-witness-fire",
            petId: "pet-1",
            petName: "Sumi",
            element: "Fire",
            wins: 10,
        }],
    });
    assert.ok(receipt);
    assert.deepEqual(receipt.cardIds, ["pet-witness-fire"]);
    assert.deepEqual(receipt.grantedCardIds, ["pet-witness-fire"]);
    const copy = petChronicleCeremonyCopy(receipt);
    assert.match(copy.witnessLine, /Sumi.*10 hard-won arena victories/);
    assert.match(copy.recordLine, /witnessed by your companion and recorded by Ihara/);
    assert.match(copy.recordLine, /Emberbound Witness.*Card Hall collection/);
});

test("a witnessed deed can be celebrated before the Card Hall card is pressed", () => {
    const receipt = petChronicleCeremonyFromSettlement({
        witnessedPets: [{
            cardId: "pet-witness-water",
            petId: "pet-2",
            petName: "Mizu",
            element: "Water",
            wins: 10,
        }],
    });
    assert.ok(receipt);
    assert.deepEqual(receipt.grantedCardIds, []);
    assert.match(petChronicleCeremonyCopy(receipt).recordLine, /will be pressed when your Card Hall record is open/);
});

test("multi-pet Warfront ceremonies wrap every earned witness card", () => {
    const css = readFileSync(new URL("../styles/pet-chronicle-ceremony.css", import.meta.url), "utf8");
    assert.match(css, /\.pet-chronicle-ceremony__cards \{[\s\S]*flex-wrap: wrap;[\s\S]*justify-content: center;/);
});

test("Living Witness progress is rendered only from a complete server receipt", () => {
    assert.equal(petChronicleProgressFromSettlement({}), null);
    assert.equal(petChronicleProgressFromSettlement({ livingWitnessProgress: [{ petId: "pet-1", wins: 9 }] }), null);

    const receipt = petChronicleProgressFromSettlement({
        livingWitnessProgress: [{
            sourceReceipt: "pet-casual:sealed-token",
            petId: "pet-1",
            petName: "Mizu",
            cardId: "pet-witness-water",
            wins: 1,
            threshold: 10,
            deedRecorded: false,
            cardPressed: false,
        }],
    });
    assert.ok(receipt);
    assert.equal(receipt.entries[0]?.wins, 1);
    const copy = petChronicleProgressCopy(receipt.entries[0]!);
    assert.equal(copy.label, "Living Witness 1/10");
    assert.match(copy.status, /Arena deed witnessed/);
    assert.match(copy.detail, /Mizu.*Living Chronicle/);
});

test("Living Witness completion copy distinguishes a pressed card from a pre-Hall deed", () => {
    const base = {
        sourceReceipt: "pet-casual:tenth",
        petId: "pet-1",
        petName: "Mizu",
        cardId: "pet-witness-water",
        wins: 10,
        threshold: 10,
        deedRecorded: true,
        cardPressed: false,
    };
    assert.match(petChronicleProgressCopy(base).status, /Card Hall pressing awaits/);
    assert.match(petChronicleProgressCopy({ ...base, cardPressed: true }).status, /Chronicle card pressed/);
});
