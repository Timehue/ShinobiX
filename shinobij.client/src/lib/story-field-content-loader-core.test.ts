import assert from "node:assert/strict";
import test from "node:test";
import { storyFieldScenes } from "../data/story-field-scenes";
import { storyReckonings } from "../data/story-reckonings";
import { STORY_FIELD_CONTENT_SCHEMA_VERSION, type StoryFieldContentPayload } from "./story-field-content-contract";
import {
    createStoryFieldContentLoader,
    createStoryFieldContentResource,
    StoryFieldContentLoadError,
    validateStoryFieldContent,
} from "./story-field-content-loader-core";

const payload = (): StoryFieldContentPayload => ({
    schemaVersion: STORY_FIELD_CONTENT_SCHEMA_VERSION,
    scenes: storyFieldScenes,
    reckonings: storyReckonings,
});
const response = (value: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });

test("field content validator preserves the authored scene and reckoning catalogs", () => {
    assert.deepEqual(validateStoryFieldContent(structuredClone(payload())), payload());
});

test("field content rejects malformed scene prose, choice metadata, and incomplete catalogs", () => {
    const mutations: Array<(value: StoryFieldContentPayload) => void> = [
        (value) => { value.scenes["story-reckoning-mira-marker"].points["sv-ridge-gate"].pages[0].dialogue = [7 as unknown as string]; },
        (value) => { (value.scenes["story-reckoning-mira-marker"].points["sv-ridge-gate"].pages[0].choices![0] as unknown as Record<string, unknown>).accept = "yes"; },
        (value) => { delete value.scenes["story-reckoning-toma-cinders"]; },
        (value) => { delete value.scenes["story-reckoning-mira-marker"].points["sv-ridge-gate"]; },
        (value) => { value.scenes["story-reckoning-mira-marker"].points["sv-ridge-gate"].pages.unshift(structuredClone(value.scenes["story-reckoning-mira-marker"].points["sv-ridge-gate"].pages.at(-1)!)); },
        (value) => { value.scenes["story-reckoning-mira-marker"].points["sv-ridge-gate"].pages.at(-1)!.choices![0].id = "sv-not-a-real-route"; },
        (value) => { value.reckonings.splice(0, 1); },
        (value) => { value.reckonings.push(value.reckonings[0]); },
    ];
    for (const mutate of mutations) {
        const invalid = structuredClone(payload());
        mutate(invalid);
        assert.throws(() => validateStoryFieldContent(invalid), StoryFieldContentLoadError);
    }
});

test("an older pending resource cannot overwrite a reset or an explicit seed", async () => {
    let resolveOld!: (value: StoryFieldContentPayload) => void;
    let resolveFresh!: (value: StoryFieldContentPayload) => void;
    const old = new Promise<StoryFieldContentPayload>((resolve) => { resolveOld = resolve; });
    const fresh = new Promise<StoryFieldContentPayload>((resolve) => { resolveFresh = resolve; });
    const resource = createStoryFieldContentResource({ load: () => old, refresh: () => fresh });
    let oldPending!: Promise<void>;
    try { resource.read(); } catch (thrown) { assert.ok(thrown instanceof Promise); oldPending = thrown; }
    resource.reset();
    let freshPending!: Promise<void>;
    try { resource.read(); } catch (thrown) { assert.ok(thrown instanceof Promise); freshPending = thrown; }
    resolveOld(payload());
    await oldPending;
    assert.throws(() => resource.read(), (thrown: unknown) => thrown === freshPending);
    resolveFresh(payload());
    await freshPending;
    assert.deepEqual(resource.read(), payload());

    const seeded = createStoryFieldContentResource({ load: () => old, refresh: () => fresh });
    try { seeded.read(); } catch (thrown) { assert.ok(thrown instanceof Promise); }
    seeded.seed(payload());
    await Promise.resolve();
    assert.deepEqual(seeded.read(), payload());
});

test("field loader retries transient failures, deduplicates callers, and refreshes explicitly", async () => {
    const calls: Array<{ url: string; cache?: RequestCache }> = [];
    let attempt = 0;
    const loader = createStoryFieldContentLoader({
        url: "/assets/field-scenes-contenthash.json",
        attempts: 2,
        retryDelayMs: 0,
        fetchContent: async (url, init) => {
            calls.push({ url, cache: init.cache });
            attempt += 1;
            return attempt === 1 ? response({}, 503) : response(payload());
        },
    });
    const [first, second] = await Promise.all([loader.load(), loader.load()]);
    assert.strictEqual(first, second);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.cache === "force-cache"));
    assert.deepEqual(await loader.refresh(), payload());
    assert.deepEqual(calls.at(-1), { url: "/assets/field-scenes-contenthash.json?field-retry=1", cache: "reload" });
});

test("field Suspense resource fails closed until an explicit retry", async () => {
    let valid = false;
    const loader = createStoryFieldContentLoader({
        url: "/field.json", attempts: 1, retryDelayMs: 0,
        fetchContent: async () => response(valid ? payload() : { malformed: true }),
    });
    const resource = createStoryFieldContentResource(loader);
    let pending: Promise<void>;
    try { resource.read(); throw new Error("read must suspend"); }
    catch (thrown) { assert.ok(thrown instanceof Promise); pending = thrown; }
    await pending!;
    assert.throws(() => resource.read(), StoryFieldContentLoadError);
    valid = true;
    resource.reset();
    try { resource.read(); throw new Error("retry must suspend"); }
    catch (thrown) { assert.ok(thrown instanceof Promise); pending = thrown; }
    await pending!;
    assert.deepEqual(resource.read(), payload());
});

test("a retired field content address is identified without retrying", async () => {
    let calls = 0;
    const loader = createStoryFieldContentLoader({
        url: "/retired.json", attempts: 3, retryDelayMs: 0,
        fetchContent: async () => { calls += 1; return response({}, 404); },
    });
    await assert.rejects(loader.load(), (error: unknown) =>
        error instanceof StoryFieldContentLoadError && error.staleDeployment && !error.retryable);
    assert.equal(calls, 1);
});
