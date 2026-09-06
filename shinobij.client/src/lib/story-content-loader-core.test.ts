import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { storylines } from "../data/storylines";
import { storyInterludesByVillage } from "../data/story-interludes";
import { ECHOES_ERA_INTROS, ECHOES_SCENES, ECHOES_WITNESS_CONTENT } from "../data/echoes-of-war-scenes";
import { storyEpiloguesByVillage } from "../data/story-epilogues";
import { storyFieldScenes } from "../data/story-field-scenes";
import { storyReckonings } from "../data/story-reckonings";
import { storyRoadEvents } from "../data/story-road-events";
import {
    ECHOES_CONTENT_KEY,
    ECHOES_CONTENT_SCHEMA_VERSION,
    STORY_CONTENT_SCHEMA_VERSION,
    STORY_CONTENT_VILLAGES,
    storyContentSlug,
    type EchoesContentPayload,
    type StoryContentPayload,
    type StoryContentVillage,
} from "./story-content-contract";
import { createStoryContentLoader, createStoryContentResource, StoryContentLoadError, validateEchoesContentPayload, validateStoryContentPayload } from "./story-content-loader-core";
import { STORY_FIELD_CONTENT_SCHEMA_VERSION } from "./story-field-content-contract";
import { validateStoryFieldContent } from "./story-field-content-loader-core";
import { STORY_ROAD_CONTENT_SCHEMA_VERSION } from "./story-road-content-contract";
import { validateStoryRoadContent } from "./story-road-content-loader-core";

function payload(village: StoryContentVillage = "Stormveil Village"): StoryContentPayload {
    return {
        schemaVersion: STORY_CONTENT_SCHEMA_VERSION,
        village,
        chapters: storylines[village],
        interludes: storyInterludesByVillage[village],
    };
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("generated content-addressed payloads exactly mirror every authored story export", () => {
    const directory = new URL("../generated/story-content/", import.meta.url);
    const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
    const storyFiles = files.filter((file) => !file.startsWith("epilogues-") && !file.startsWith("field-scenes-") && !file.startsWith("road-events-") && !file.startsWith(`${ECHOES_CONTENT_KEY}-`));
    const epilogueFiles = files.filter((file) => file.startsWith("epilogues-"));
    const fieldFiles = files.filter((file) => file.startsWith("field-scenes-"));
    const echoesFiles = files.filter((file) => file.startsWith(`${ECHOES_CONTENT_KEY}-`));
    const roadFiles = files.filter((file) => file.startsWith("road-events-"));
    assert.equal(storyFiles.length, STORY_CONTENT_VILLAGES.length);
    assert.equal(epilogueFiles.length, STORY_CONTENT_VILLAGES.length);
    assert.equal(fieldFiles.length, 1);
    assert.equal(echoesFiles.length, 1);
    assert.equal(roadFiles.length, 1);
    for (const village of STORY_CONTENT_VILLAGES) {
        const slug = storyContentSlug(village);
        const matches = storyFiles.filter((file) => file.startsWith(`${slug}-`));
        assert.equal(matches.length, 1, `${village} must have one content-addressed payload`);
        assert.match(matches[0], /^[a-z-]+-[a-f0-9]{12}\.json$/);
        const parsed = JSON.parse(readFileSync(new URL(matches[0], directory), "utf8"));
        assert.deepEqual(validateStoryContentPayload(parsed, village), JSON.parse(JSON.stringify(payload(village))));
        const epilogueMatches = epilogueFiles.filter((file) => file.startsWith(`epilogues-${slug}-`));
        assert.equal(epilogueMatches.length, 1, `${village} must have one content-addressed epilogue payload`);
        assert.match(epilogueMatches[0], /^epilogues-[a-z-]+-[a-f0-9]{12}\.json$/);
        assert.deepEqual(JSON.parse(readFileSync(new URL(epilogueMatches[0], directory), "utf8")), storyEpiloguesByVillage[village]);
    }
    assert.match(fieldFiles[0], /^field-scenes-[a-f0-9]{12}\.json$/);
    const fieldPayload = JSON.parse(readFileSync(new URL(fieldFiles[0], directory), "utf8"));
    assert.deepEqual(validateStoryFieldContent(fieldPayload), JSON.parse(JSON.stringify({
        schemaVersion: STORY_FIELD_CONTENT_SCHEMA_VERSION,
        scenes: storyFieldScenes,
        reckonings: storyReckonings,
    })));
    assert.match(roadFiles[0], /^road-events-[a-f0-9]{12}\.json$/);
    const roadPayload = JSON.parse(readFileSync(new URL(roadFiles[0], directory), "utf8"));
    assert.deepEqual(validateStoryRoadContent(roadPayload), JSON.parse(JSON.stringify({
        schemaVersion: STORY_ROAD_CONTENT_SCHEMA_VERSION,
        events: storyRoadEvents,
    })));
});

test("the generated Echoes of War payload exactly mirrors the authored scenes module", () => {
    const directory = new URL("../generated/story-content/", import.meta.url);
    const matches = readdirSync(directory).filter((file) => file.startsWith(`${ECHOES_CONTENT_KEY}-`) && file.endsWith(".json"));
    assert.equal(matches.length, 1, "the campaign must have one content-addressed payload");
    assert.match(matches[0], /^echoes-of-war-[a-f0-9]{12}\.json$/);
    const parsed = JSON.parse(readFileSync(new URL(matches[0], directory), "utf8"));
    const authored: EchoesContentPayload = {
        schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION,
        scope: ECHOES_CONTENT_KEY,
        scenes: ECHOES_SCENES,
        eras: ECHOES_ERA_INTROS,
        witness: ECHOES_WITNESS_CONTENT,
    };
    assert.deepEqual(validateEchoesContentPayload(parsed), JSON.parse(JSON.stringify(authored)));
});

test("a malformed Echoes of War payload fails closed", () => {
    for (const invalid of [
        { schemaVersion: 999, scope: ECHOES_CONTENT_KEY, scenes: ECHOES_SCENES },
        { schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION, scope: "village", scenes: ECHOES_SCENES },
        { schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION, scope: ECHOES_CONTENT_KEY, scenes: {} },
        {
            schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION,
            scope: ECHOES_CONTENT_KEY,
            scenes: { "echoes-1-tovin": { preShowdown: [], defeat: [], firstVictory: [], rematch: [] } },
        },
        {
            schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION,
            scope: ECHOES_CONTENT_KEY,
            scenes: { "echoes-1-tovin": { preShowdown: [{ title: "T", scene: "S", speaker: "V", dialogue: ["ok"], extra: true }], defeat: [], firstVictory: [], rematch: [] } },
        },
        // Valid scenes but the era intros are missing or malformed: still fail closed.
        { schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION, scope: ECHOES_CONTENT_KEY, scenes: ECHOES_SCENES },
        { schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION, scope: ECHOES_CONTENT_KEY, scenes: ECHOES_SCENES, eras: {} },
        { schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION, scope: ECHOES_CONTENT_KEY, scenes: ECHOES_SCENES, eras: { "echoes-age-1": [] } },
        { schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION, scope: ECHOES_CONTENT_KEY, scenes: ECHOES_SCENES, eras: { "echoes-age-1": [{ title: "T", scene: "S", speaker: "V", dialogue: ["ok"], extra: true }] } },
    ]) {
        assert.throws(() => validateEchoesContentPayload(invalid), StoryContentLoadError);
    }
});

test("the authored Echoes witness payload validates as an exact bounded contract", () => {
    const authored: EchoesContentPayload = {
        schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION,
        scope: ECHOES_CONTENT_KEY,
        scenes: ECHOES_SCENES,
        eras: ECHOES_ERA_INTROS,
        witness: ECHOES_WITNESS_CONTENT,
    };
    assert.deepEqual(validateEchoesContentPayload(authored), authored);

    const malformed = structuredClone(authored) as unknown as {
        witness: Record<string, { choices: Array<{ id: string }> }>;
    };
    malformed.witness["echoes-age-1"].choices[0].id = "who-paid";
    assert.throws(() => validateEchoesContentPayload(malformed), StoryContentLoadError);
});

test("loader fetches one village with immutable-cache semantics and deduplicates callers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const loader = createStoryContentLoader({
        urlFor: (village) => `/assets/${storyContentSlug(village)}-12345678.json`,
        fetchContent: async (url, init) => { calls.push({ url, init }); return jsonResponse(payload()); },
        retryDelayMs: 0,
    });
    const [first, second] = await Promise.all([loader.load("Stormveil Village"), loader.load("Stormveil Village")]);
    assert.strictEqual(first, second);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/assets/stormveil-12345678.json");
    assert.equal(calls[0].init.cache, "force-cache");
    assert.equal(calls[0].init.credentials, "same-origin");
});

test("retryable fetch failure retries, then a rejected cache entry can recover", async () => {
    let calls = 0;
    const loader = createStoryContentLoader({
        urlFor: () => "/story.json",
        fetchContent: async () => {
            calls += 1;
            if (calls <= 3) throw new TypeError("offline");
            return jsonResponse(payload());
        },
        attempts: 3,
        retryDelayMs: 0,
    });
    await assert.rejects(loader.load("Stormveil Village"), (error: unknown) => error instanceof StoryContentLoadError && error.retryable);
    assert.equal(calls, 3);
    assert.equal((await loader.load("Stormveil Village")).village, "Stormveil Village");
    assert.equal(calls, 4);
});

test("malformed or cross-village payloads fail closed without wasteful retries", async () => {
    for (const invalid of [
        { schemaVersion: 999, village: "Stormveil Village", chapters: [], interludes: [] },
        payload("Ashen Leaf Village"),
    ]) {
        let calls = 0;
        const loader = createStoryContentLoader({
            urlFor: () => "/story.json",
            fetchContent: async () => { calls += 1; return jsonResponse(invalid); },
            attempts: 3,
            retryDelayMs: 0,
        });
        await assert.rejects(loader.load("Stormveil Village"), StoryContentLoadError);
        assert.equal(calls, 1);
    }
});

test("strict schema rejects corrupt optional line, cinematic, choice, and battle metadata", () => {
    const firstChapterChoice = (value: StoryContentPayload) => value.chapters[0].pages!.find((page) => page.choices?.length)!.choices![0] as unknown as Record<string, unknown>;
    const mutations: Array<(value: StoryContentPayload) => void> = [
        (value) => { (value.chapters[0].pages![0] as unknown as Record<string, unknown>).lines = [{ speaker: "Narrator", text: 42 }]; },
        (value) => { (value.chapters[0].pages![0] as unknown as Record<string, unknown>).cinematic = { shot: "extreme-close" }; },
        (value) => { firstChapterChoice(value).conclusion = 42; },
        (value) => { firstChapterChoice(value).forbidTrait = false; },
        (value) => { firstChapterChoice(value).battle = "boss"; },
        (value) => { firstChapterChoice(value).battle = { bossHp: "100" }; },
        (value) => { (value.interludes[0].pages.at(-1)!.choices![0] as unknown as Record<string, unknown>).lane = "chaotic"; },
    ];
    for (const mutate of mutations) {
        const invalid = structuredClone(payload());
        mutate(invalid);
        assert.throws(() => validateStoryContentPayload(invalid, "Stormveil Village"), StoryContentLoadError);
    }
});

test("a rejected Suspense resource retries only after an explicit same-screen reset", async () => {
    let calls = 0;
    let valid = false;
    const loader = createStoryContentLoader({
        urlFor: () => "/story.json",
        fetchContent: async () => { calls += 1; return jsonResponse(valid ? payload() : { malformed: true }); },
        attempts: 3,
        retryDelayMs: 0,
    });
    const resource = createStoryContentResource({ load: loader.load, refresh: loader.refresh });
    let pending: Promise<void>;
    try { resource.read("Stormveil Village"); throw new Error("read must suspend"); }
    catch (thrown) { assert.ok(thrown instanceof Promise); pending = thrown; }
    await pending!;
    assert.throws(() => resource.read("Stormveil Village"), StoryContentLoadError);
    assert.equal(calls, 1, "malformed content must not retry or render-loop");

    valid = true;
    resource.reset("Stormveil Village");
    try { resource.read("Stormveil Village"); throw new Error("retry must suspend"); }
    catch (thrown) { assert.ok(thrown instanceof Promise); pending = thrown; }
    await pending!;
    assert.equal(resource.read("Stormveil Village").village, "Stormveil Village");
    assert.equal(calls, 2);
});

test("a retired content address is classified as a stale deployment without retrying", async () => {
    let calls = 0;
    const loader = createStoryContentLoader({
        urlFor: () => "/assets/retired.json",
        fetchContent: async () => { calls += 1; return jsonResponse({}, 404); },
        attempts: 3,
        retryDelayMs: 0,
    });
    await assert.rejects(loader.load("Stormveil Village"), (error: unknown) =>
        error instanceof StoryContentLoadError && error.staleDeployment && !error.retryable,
    );
    assert.equal(calls, 1);
});

test("explicit refresh bypasses a malformed immutable response without weakening normal caching", async () => {
    const calls: Array<{ url: string; cache: RequestCache | undefined }> = [];
    let corrected = false;
    const loader = createStoryContentLoader({
        urlFor: () => "/assets/stormveil-contenthash.json",
        fetchContent: async (url, init) => {
            calls.push({ url, cache: init.cache });
            return jsonResponse(corrected ? payload() : { malformed: true });
        },
        attempts: 3,
        retryDelayMs: 0,
    });
    await assert.rejects(loader.load("Stormveil Village"), StoryContentLoadError);
    corrected = true;
    assert.equal((await loader.refresh("Stormveil Village")).village, "Stormveil Village");
    assert.deepEqual(calls, [
        { url: "/assets/stormveil-contenthash.json", cache: "force-cache" },
        { url: "/assets/stormveil-contenthash.json?story-retry=1", cache: "reload" },
    ]);
    await loader.load("Stormveil Village");
    assert.equal(calls.length, 2, "the corrected refresh result remains deduplicated");
});
