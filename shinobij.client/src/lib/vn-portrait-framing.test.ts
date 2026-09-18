import test from "node:test";
import assert from "node:assert/strict";
import { vnPortraitFrame } from "./vn-portrait-framing";

test("known full-length NPCs share reviewed conversational framing across revisions", () => {
    const base = "/portraits/cinematic/kite-harrow.webp";
    assert.ok(vnPortraitFrame(base));
    assert.deepEqual(vnPortraitFrame(`${base}?v=current#portrait`), vnPortraitFrame(base));
    assert.deepEqual(vnPortraitFrame("/portraits/cinematic/storywide/elder-sova-canon.webp"),
        vnPortraitFrame("/portraits/cinematic/storywide/elder-sova-solemn-canon.webp"));
});

test("player images and custom authoring do not inherit NPC crops", () => {
    const base = "/portraits/cinematic/kite-harrow.webp";
    assert.equal(vnPortraitFrame(base, true), undefined);
    assert.equal(vnPortraitFrame(`https://example.test${base}`), undefined);
    assert.equal(vnPortraitFrame("data:image/webp;base64,AA"), undefined);
    assert.equal(vnPortraitFrame("/portraits/cinematic/custom-character.webp"), undefined);
});

test("waist-up portraits and Bel's essential rescue composition keep their original fit", () => {
    for (const source of ["/portraits/cinematic/toma-reed.webp", "/portraits/cinematic/storywide/mira-volt-neutral.webp",
        "/portraits/cinematic/echoes/sela-cutout-v1.webp", "/portraits/cinematic/side-stories/houndmaster-bel-nara-rescue-v1.webp"]) {
        assert.equal(vnPortraitFrame(source), undefined);
    }
});
