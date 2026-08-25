/*
 * Behavioural tests for the audio delivery picker.
 *
 * The codec answers below are not invented — they are what a real WebKit and a
 * real Chromium reported for these exact canPlayType strings:
 *   webkit     oggVorbis:(no)      oggOpus:(no)      aac:probably  mp3:probably
 *   chromium   oggVorbis:probably  oggOpus:probably  aac:probably  mp3:probably
 * Getting this wrong is silent audio on every iPhone, which no other test in the
 * repo would catch.
 */
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { musicDeliverySrc, resetAudioDeliveryProbe, sfxDeliveryPath } from "./audio-delivery";

type Answers = { ogg: string; aac: string };

/** Install a fake <audio> whose canPlayType mimics a named engine. */
function stubEngine(answers: Answers): void {
    (globalThis as { document?: unknown }).document = {
        createElement: () => ({
            canPlayType: (type: string) => {
                if (type.includes("ogg")) return answers.ogg;
                if (type.includes("mp4")) return answers.aac;
                return "";
            },
        }),
    };
    resetAudioDeliveryProbe();
}

const CHROMIUM: Answers = { ogg: "probably", aac: "probably" };
const WEBKIT: Answers = { ogg: "", aac: "probably" };
const NEITHER: Answers = { ogg: "", aac: "" };

afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    resetAudioDeliveryProbe();
});

const WAV = "/sfx/production/ambience-shrine.wav";
const OGG = "/music/vn/stormveil-reasons-in-rain.ogg";
const MP3 = "/music/showdown-lantern-duel.mp3";

test("Chromium takes gapless Vorbis for looping ambience", () => {
    stubEngine(CHROMIUM);
    assert.equal(sfxDeliveryPath(WAV), "/sfx/production/ambience-shrine.ogg");
});

test("WebKit takes AAC for sfx, because it decodes no Ogg container at all", () => {
    stubEngine(WEBKIT);
    assert.equal(sfxDeliveryPath(WAV), "/sfx/production/ambience-shrine.m4a");
});

test("a browser with neither codec still gets the shipped .wav master", () => {
    stubEngine(NEITHER);
    assert.equal(sfxDeliveryPath(WAV), WAV, "falling through to silence would be worse than 2 MB");
});

test("music: only WebKit is redirected, so no working browser can regress", () => {
    stubEngine(CHROMIUM);
    assert.equal(musicDeliverySrc(OGG), OGG, "Ogg-capable browsers keep the authored file");

    stubEngine(WEBKIT);
    assert.equal(musicDeliverySrc(OGG), "/music/vn/stormveil-reasons-in-rain.m4a");

    stubEngine(NEITHER);
    assert.equal(musicDeliverySrc(OGG), OGG, "with no AAC either, changing the URL helps nobody");
});

test("music: non-Ogg tracks pass through untouched", () => {
    for (const answers of [CHROMIUM, WEBKIT, NEITHER]) {
        stubEngine(answers);
        assert.equal(musicDeliverySrc(MP3), MP3, ".mp3 already plays on every engine");
    }
});

test("without a DOM nothing is rewritten", () => {
    // Unit tests and any SSR-ish context must not invent URLs that may not exist.
    resetAudioDeliveryProbe();
    assert.equal(sfxDeliveryPath(WAV), WAV);
    assert.equal(musicDeliverySrc(OGG), OGG);
});

test("the probe is computed once, not per cue", () => {
    let calls = 0;
    (globalThis as { document?: unknown }).document = {
        createElement: () => {
            calls += 1;
            return { canPlayType: () => "probably" };
        },
    };
    resetAudioDeliveryProbe();
    sfxDeliveryPath(WAV);
    sfxDeliveryPath(WAV);
    musicDeliverySrc(OGG);
    assert.equal(calls, 1, "canPlayType forces a codec-registry lookup; cache it");
});
