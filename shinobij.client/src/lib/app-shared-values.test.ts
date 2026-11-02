import assert from "node:assert/strict";
import { test } from "node:test";
import { createCharacter } from "./create-character";
import { gainXp } from "./character-level-projection";
import { playerLensDiscipline } from "./player-lens-discipline";
import { stringifyServerSavePayload } from "./server-save-payload";
import { trainingRecommendation } from "./training-recommendation";
import { EXAM_LEVEL_GATES } from "../constants/game";
import type { SavedBloodline } from "../types/combat";

const rookie = () => createCharacter("Rookie", "Stormveil Village", "Ninjutsu", "Ashen Eyes");

test("legacy gainXp cannot award XP and respects the next exam hold", () => {
    const input = { ...rookie(), unspentStats: 25_000 };
    const snapshot = structuredClone(input);
    const result = gainXp(input, 1_000_000);
    assert.deepEqual(result, gainXp(input, 0));
    assert.equal(result.level, EXAM_LEVEL_GATES[0].level);
    assert.equal(result.hp, result.maxHp);
    assert.deepEqual(input, snapshot);
});

test("level projection preserves injured vitals when earned points do not raise the level", () => {
    const input = { ...rookie(), hp: 7, chakra: 8, stamina: 9 };
    const result = gainXp(input, 1_000_000);
    assert.equal(result.level, input.level);
    assert.equal(result.hp, 7);
    assert.equal(result.chakra, 8);
    assert.equal(result.stamina, 9);
});

test("discipline falls back to specialty and then Ninjutsu for an unknown bloodline", () => {
    const input = { ...rookie(), bloodline: "unknown", specialty: "Taijutsu" as const };
    assert.equal(playerLensDiscipline(input), "Taijutsu");
    assert.equal(playerLensDiscipline({ ...input, specialty: "Any" }), "Ninjutsu");
});

test("discipline follows an equipped custom bloodline over the starter and specialty", () => {
    const blade = { id: "blade", type: "Bukijutsu", ap: 60, effectPower: 40 };
    const utility = { id: "mist", type: "Any", ap: 40, effectPower: 0 };
    const custom = { id: "custom", name: "Blood Mist", jutsus: [blade, utility] } as unknown as SavedBloodline;
    const input = { ...rookie(), specialty: "Genjutsu" as const, equippedBloodlineId: custom.id };
    assert.equal(playerLensDiscipline(input, [custom]), "Bukijutsu");
    assert.equal(playerLensDiscipline({ ...input, equippedBloodlineId: undefined }, [custom]), "Genjutsu");
    const utilityOnly = { ...custom, jutsus: [utility] };
    assert.equal(playerLensDiscipline(input, [utilityOnly]), "Genjutsu");
    const strayType = { ...custom, jutsus: [{ ...blade, type: "Medical" }] } as unknown as SavedBloodline;
    assert.equal(playerLensDiscipline(input, [strayType]), "Genjutsu");
    assert.equal(trainingRecommendation(input, [strayType]).discipline, "Genjutsu");
});

test("server save serialization strips embedded images throughout a snapshot while retaining URLs", () => {
    const input = { image: "data:image/webp;base64,AAAA", nested: [{ avatar: "data:image/png;base64,BBBB" }], url: "https://example.test/avatar.webp", other: "data:text/plain,hello" };
    assert.deepEqual(JSON.parse(stringifyServerSavePayload(input)), {
        image: "", nested: [{ avatar: "" }], url: input.url, other: input.other,
    });
    assert.equal(input.image, "data:image/webp;base64,AAAA");
});
