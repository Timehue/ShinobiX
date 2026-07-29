import test from "node:test";
import assert from "node:assert/strict";
import type { CreatorEvent } from "../types/vn";
import {
    compactVnDirection,
    parseVnBackgroundPosition,
    sanitizeVnDirection,
    validateVnCinematicEvent,
} from "./vn-cinematic-authoring";

function event(): CreatorEvent {
    return {
        id: "admin-vn",
        name: "Admin VN",
        biome: "forest",
        icon: "x",
        eventKind: "visualNovel",
        levelReq: 1,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: ["Line"],
        vnPages: [{
            title: "Page",
            scene: "Scene",
            speaker: "Narrator",
            dialogue: ["Line"],
            image: "/scene.webp",
            choices: [],
        }],
    };
}

test("background crop accepts only bounded percentage pairs", () => {
    assert.equal(parseVnBackgroundPosition("52% 44%"), "52% 44%");
    assert.equal(parseVnBackgroundPosition("101% 44%"), undefined);
    assert.equal(parseVnBackgroundPosition("center center"), undefined);
});

test("runtime sanitization drops unsupported persisted enum values", () => {
    const clean = sanitizeVnDirection({
        mode: "cinematic",
        shot: "ultra-close",
        tone: "cold",
        backgroundPosition: "-4% 20%",
    });
    assert.deepEqual(clean, { mode: "cinematic", tone: "cold" });
});

test("automatic-only authoring metadata compacts away for backward compatibility", () => {
    assert.equal(compactVnDirection({ mode: "auto", transition: "auto" }), undefined);
    assert.deepEqual(compactVnDirection({ mode: "cinematic", shot: "wide" }), { mode: "cinematic", shot: "wide" });
});

test("authoring validation catches unsafe self-loops and range errors", () => {
    const candidate = event();
    candidate.vnPages![0].choices = [
        { text: "Loop", nextPage: 0 },
        { text: "Outside", nextPage: 4 },
    ];
    const messages = validateVnCinematicEvent(candidate).map((issue) => issue.message);
    assert.ok(messages.some((message) => message.includes("Unsafe self-loop")));
    assert.ok(messages.some((message) => message.includes("outside")));
});

test("a self-loop with a conclusion is a safe terminal aftermath", () => {
    const candidate = event();
    candidate.vnPages![0].choices = [{ text: "Conclude", nextPage: 0, conclusion: "The scene ends." }];
    assert.equal(validateVnCinematicEvent(candidate).some((issue) => issue.severity === "error"), false);
});
