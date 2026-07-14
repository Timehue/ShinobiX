import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { normalizeVillageLeadershipImages } from "./village-leadership.js";

const PUBLIC_DIR = path.resolve(process.cwd(), "shinobij.client/public");

test("village leadership NPCs have default portrait images attached", () => {
    const images = normalizeVillageLeadershipImages();
    const screenshotPortraits = [
        "elder-vanta",
        "mira-volt",
        "toma-reed",
        "elder-mori",
        "elder-sova",
        "captain-yura",
        "nyx",
        "shade-master-iro",
        "kite-harrow",
    ];
    for (const slug of screenshotPortraits) {
        assert.equal(existsSync(path.join(PUBLIC_DIR, "portraits", `${slug}.webp`)), true, `${slug}.webp`);
    }

    const expected = [
        ["Stormveil Village", 0, "elder-vanta"],
        ["Stormveil Village", 1, "mira-volt"],
        ["Ashen Leaf Village", 0, "elder-mori"],
        ["Ashen Leaf Village", 1, "toma-reed"],
        ["Frostfang Village", 0, "elder-sova"],
        ["Frostfang Village", 1, "captain-yura"],
        ["Moonshadow Village", 0, "shade-master-iro"],
        ["Moonshadow Village", 1, "nyx"],
    ] as const;

    for (const [village, index, slug] of expected) {
        const portrait = images[village]?.elders?.[index];
        assert.equal(portrait, `/portraits/${slug}.webp`);
        assert.equal(existsSync(path.join(PUBLIC_DIR, portrait.replace(/^\//, ""))), true, portrait);
    }
});
