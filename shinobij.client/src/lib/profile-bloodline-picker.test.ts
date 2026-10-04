import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { profileBloodlinePickerChoices } from "./profile-bloodline-picker";
import { getOwnedBloodlines } from "./bloodline";
import type { Character } from "../types/character";
import type { SavedBloodline } from "../types/combat";

const ASHEN_EYES = "starter-bloodline-ashen-eyes";
const IRON_FANG = "starter-bloodline-iron-fang";

const bloodline = (id: string, rank: SavedBloodline["rank"] = "A Rank"): SavedBloodline => ({
    id,
    name: id,
    rank,
    specialElement: "Wood",
    jutsus: [],
    totalPoints: 0,
});

const supporter = { active: true } as Character["patreon"];

const character = (overrides: Partial<Character> = {}) => ({
    bloodline: "Ashen Eyes",
    equippedBloodlineId: "custom-a",
    patreon: supporter,
    ...overrides,
} as Pick<Character, "bloodline" | "equippedBloodlineId" | "patreon">);

describe("getOwnedBloodlines", () => {
    it("lists the original starter first, then every stored bloodline", () => {
        const ids = getOwnedBloodlines(character(), [bloodline("custom-a"), bloodline("custom-b")]).map((entry) => entry.id);
        assert.deepEqual(ids, [ASHEN_EYES, "custom-a", "custom-b"]);
    });

    it("maps the legacy Blue Blade Eyes name onto the Ashen Eyes starter", () => {
        const ids = getOwnedBloodlines(character({ bloodline: "Blue Blade Eyes" }), []).map((entry) => entry.id);
        assert.deepEqual(ids, [ASHEN_EYES]);
    });

    it("never offers a built-in bloodline the character did not start with", () => {
        const ids = getOwnedBloodlines(character(), [bloodline("custom-a")]).map((entry) => entry.id);
        assert.equal(ids.includes(IRON_FANG), false);
    });

    it("lists only stored bloodlines when the starter name is unknown", () => {
        const ids = getOwnedBloodlines(character({ bloodline: "" }), [bloodline("custom-a")]).map((entry) => entry.id);
        assert.deepEqual(ids, ["custom-a"]);
    });
});

describe("profileBloodlinePickerChoices", () => {
    it("offers an active supporter every owned bloodline", () => {
        const choices = profileBloodlinePickerChoices(character(), [bloodline("custom-a"), bloodline("custom-b", "S Rank")]);
        assert.deepEqual(choices?.map((entry) => entry.id), [ASHEN_EYES, "custom-a", "custom-b"]);
    });

    it("is hidden for a player without the subscription", () => {
        assert.equal(profileBloodlinePickerChoices(character({ patreon: undefined }), [bloodline("custom-a")]), null);
        assert.equal(profileBloodlinePickerChoices(character({ patreon: { active: false } as Character["patreon"] }), [bloodline("custom-a")]), null);
    });

    it("is hidden once an admin-comped subscription has expired", () => {
        const lapsed = { active: true, expiresAt: Date.now() - 1_000 } as Character["patreon"];
        assert.equal(profileBloodlinePickerChoices(character({ patreon: lapsed }), [bloodline("custom-a")]), null);
    });

    it("is hidden when the supporter owns only one bloodline", () => {
        assert.equal(profileBloodlinePickerChoices(character({ equippedBloodlineId: ASHEN_EYES }), []), null);
    });

    it("still shows a legacy active built-in so the control can display it", () => {
        const choices = profileBloodlinePickerChoices(character({ equippedBloodlineId: IRON_FANG }), [bloodline("custom-a")]);
        assert.deepEqual(choices?.map((entry) => entry.id), [IRON_FANG, ASHEN_EYES, "custom-a"]);
    });
});

describe("Profile bloodline picker wiring", () => {
    it("saves through the same authoritative bloodline write as the Bloodline Maker", () => {
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        const profile = readFileSync(new URL("../screens/Profile.tsx", import.meta.url), "utf8");

        assert.match(app, /<Profile[\s\S]*?onSaveBloodlines=\{saveBloodlinesToServer\}/);
        assert.match(app, /<BloodlineMaker[\s\S]*?onSaveBloodlines=\{saveBloodlinesToServer\}/);
        assert.match(app, /bloodlineEquipIntent: target\.equippedBloodlineId/);
        assert.match(profile, /profileBloodlinePickerChoices\(character, savedBloodlines\)/);
        // Built from the latest character (idle regen replaces it every second) and
        // re-applied to the newest state only after the server acknowledges it.
        assert.match(profile, /useLayoutEffect\(\(\) => \{ latestCharacterRef\.current = character; \}, \[character\]\)/);
        assert.match(profile, /await onSaveBloodlines\(savedBloodlines, equipOwnedBloodline\(latest, target, savedBloodlines\)\)[\s\S]*?updateCharacter\(\(prev\) => [^\n]*equipOwnedBloodline\(prev, target, savedBloodlines\)/);
    });
});
