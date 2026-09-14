import assert from "node:assert/strict";
import { test } from "node:test";
import { createCharacter } from "./create-character";
import { gainXp } from "./character-level-projection";
import { playerLensDiscipline } from "./player-lens-discipline";
import { stringifyServerSavePayload } from "./server-save-payload";
import { EXAM_LEVEL_GATES } from "../constants/game";

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

test("server save serialization strips embedded images throughout a snapshot while retaining URLs", () => {
    const input = { image: "data:image/webp;base64,AAAA", nested: [{ avatar: "data:image/png;base64,BBBB" }], url: "https://example.test/avatar.webp", other: "data:text/plain,hello" };
    assert.deepEqual(JSON.parse(stringifyServerSavePayload(input)), {
        image: "", nested: [{ avatar: "" }], url: input.url, other: input.other,
    });
    assert.equal(input.image, "data:image/webp;base64,AAAA");
});
