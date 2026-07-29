import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CreatorEvent } from "../types/vn";
import { resolveCinematicActorImage, resolveVnPresentation } from "./vn-presentation";
import { isPremiumVnEvent } from "./vn-storywide-direction";

function event(id = "story-ashen-leaf-village-4-0"): CreatorEvent {
    return {
        id,
        name: "Test",
        biome: "volcano",
        icon: "x",
        levelReq: 4,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: ["Test"],
        vnPages: [{ title: "Page", scene: "Scene", speaker: "Toma Reed", dialogue: ["Line"] }],
    };
}

test("pilot direction selects premium art and semantic title cue", () => {
    const e = event();
    const page = e.vnPages![0];
    const p = resolveVnPresentation({
        event: e,
        page,
        pageIndex: 0,
        lineIndex: 0,
        speaker: "Toma Reed",
        speakingSide: "left",
        pageImage: "/old.webp",
    });
    assert.equal(p.premium, true);
    assert.equal(p.backgroundImage, "/scenes/story/cinematic/ashen-register-hall-wide.webp");
    assert.equal(p.cue, "title");
    assert.equal(p.focus, "left");
});

test("black flower reveal is silent until the authored reveal line", () => {
    const e = event();
    const page = { ...e.vnPages![0], title: "The Black Flower" };
    const base = {
        event: e,
        page,
        pageIndex: 7,
        speaker: "Toma Reed",
        speakingSide: "left" as const,
        pageImage: "/old.webp",
    };
    const before = resolveVnPresentation({ ...base, lineIndex: 0 });
    const reveal = resolveVnPresentation({ ...base, lineIndex: 2 });
    assert.equal(before.cue, "none");
    assert.match(before.backgroundImage, /ashen-register-wall/);
    assert.equal(reveal.cue, "reveal");
    assert.equal(reveal.tone, "hollow");
    assert.match(reveal.backgroundImage, /ashen-black-flower-reveal/);
});

test("Harrow's quartered-circle evidence gets its own delayed camera reveal", () => {
    const e = event("story-interlude-ashen-leaf-village-20");
    const page = e.vnPages![0];
    const base = {
        event: e,
        page,
        pageIndex: 1,
        speaker: "Kite Harrow",
        speakingSide: "right" as const,
        pageImage: "/old.webp",
    };
    const before = resolveVnPresentation({ ...base, lineIndex: 2 });
    const reveal = resolveVnPresentation({ ...base, lineIndex: 3 });
    assert.match(before.backgroundImage, /ashen-register-annex/);
    assert.equal(before.cue, "none");
    assert.match(reveal.backgroundImage, /ashen-annex-charts/);
    assert.equal(reveal.cue, "omen");
    assert.equal(reveal.focus, "center");
});

test("choice point gets a decision cue but reduced motion removes strong movement", () => {
    const e = event();
    const page = e.vnPages![0];
    const p = resolveVnPresentation({
        event: e,
        page,
        pageIndex: 1,
        lineIndex: 0,
        speaker: "Narrator",
        speakingSide: null,
        pageImage: "/old.webp",
        choicePoint: true,
        reducedMotion: true,
    });
    assert.equal(p.cue, "decision");
    assert.equal(p.backgroundMotion, "none");
    assert.equal(p.atmosphere, "none");
    assert.equal(p.transition, "crossfade");
});

test("generic VNs get deterministic automatic presentation without premium actor overrides", () => {
    const e = event("creator-generic");
    const page = e.vnPages![0];
    const a = resolveVnPresentation({ event: e, page, pageIndex: 3, lineIndex: 0, speaker: "Toma Reed", speakingSide: "right", pageImage: "/old.webp" });
    const b = resolveVnPresentation({ event: e, page, pageIndex: 3, lineIndex: 0, speaker: "Toma Reed", speakingSide: "right", pageImage: "/old.webp" });
    assert.deepEqual(a, b);
    assert.equal(a.premium, false);
    assert.equal(a.focus, "right");
    assert.equal(resolveCinematicActorImage(e.id, "Toma Reed", "/fallback.webp"), "/fallback.webp");
});

test("pilot recurring actors resolve to the cinematic package", () => {
    assert.equal(isPremiumVnEvent("story-interlude-ashen-leaf-village-20"), true);
    assert.equal(
        resolveCinematicActorImage("story-interlude-ashen-leaf-village-20", "Kite Harrow", "/fallback.webp"),
        "/portraits/cinematic/kite-harrow.webp",
    );
});

test("premium pilot asset package is complete", () => {
    const publicRoot = existsSync(resolve(process.cwd(), "shinobij.client/public"))
        ? resolve(process.cwd(), "shinobij.client/public")
        : resolve(process.cwd(), "public");
    const assets = [
        "scenes/story/cinematic/ashen-register-hall-wide.webp",
        "scenes/story/cinematic/ashen-register-wall.webp",
        "scenes/story/cinematic/ashen-black-flower-reveal.webp",
        "scenes/story/cinematic/ashen-old-grove-trial.webp",
        "scenes/story/cinematic/ashen-register-annex.webp",
        "scenes/story/cinematic/ashen-annex-charts.webp",
        "scenes/story/cinematic/ashen-annex-steps.webp",
        "portraits/cinematic/toma-reed.webp",
        "portraits/cinematic/registry-duty-clerk.webp",
        "portraits/cinematic/elder-mori.webp",
        "portraits/cinematic/kite-harrow.webp",
    ];

    for (const asset of assets) {
        assert.equal(existsSync(resolve(publicRoot, asset)), true, `Missing pilot asset: ${asset}`);
    }
});
