import assert from "node:assert/strict";
import test from "node:test";
import { storyRoadEvents } from "../data/story-road-events";
import { STORY_ROAD_CONTENT_SCHEMA_VERSION, type StoryRoadContentPayload } from "./story-road-content-contract";
import {
    createStoryRoadContentLoader,
    createStoryRoadContentResource,
    validateStoryRoadContent,
} from "./story-road-content-loader-core";
import { StoryFieldContentLoadError } from "./story-field-content-loader-core";

const payload = (): StoryRoadContentPayload => ({
    schemaVersion: STORY_ROAD_CONTENT_SCHEMA_VERSION,
    events: storyRoadEvents,
});
const response = (value: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });

test("road content validator preserves the complete authored catalog", () => {
    assert.deepEqual(validateStoryRoadContent(structuredClone(payload())), payload());
});

test("road content rejects malformed metadata, pages, choices, traits, and bosses", () => {
    const mutations: Array<(value: StoryRoadContentPayload) => void> = [
        (value) => { value.events.splice(2, 1); },
        (value) => { [value.events[0], value.events[1]] = [value.events[1], value.events[0]]; },
        (value) => { value.events[0].minProgress = 1; },
        (value) => { value.events[0].pages[0].dialogue = []; },
        (value) => { value.events[0].pages[0].choices = structuredClone(value.events[0].pages.at(-1)!.choices); },
        (value) => { value.events[0].pages.at(-1)!.choices![0].nextPage = 0; },
        (value) => { value.events[0].pages.at(-1)!.choices![0].trait = "rd26-wrong-level"; },
        (value) => { value.events[1].pages.at(-1)!.choices![0].trait = value.events[0].pages.at(-1)!.choices![0].trait; },
        (value) => { (value.events[0].pages.at(-1)!.choices![0].battle as unknown as Record<string, unknown>).extra = true; },
    ];
    for (const mutate of mutations) {
        const invalid = structuredClone(payload());
        mutate(invalid);
        assert.throws(() => validateStoryRoadContent(invalid), StoryFieldContentLoadError);
    }
});

test("road loader retries transient failures, deduplicates callers, and refreshes past cache", async () => {
    const calls: Array<{ url: string; cache?: RequestCache }> = [];
    let attempt = 0;
    const loader = createStoryRoadContentLoader({
        url: "/assets/road-contenthash.json", attempts: 2, retryDelayMs: 0,
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
    assert.deepEqual(calls.at(-1), { url: "/assets/road-contenthash.json?road-retry=1", cache: "reload" });
});

test("road resource reset fences an older response and permits explicit recovery", async () => {
    let resolveOld!: (value: StoryRoadContentPayload) => void;
    let resolveFresh!: (value: StoryRoadContentPayload) => void;
    const old = new Promise<StoryRoadContentPayload>((resolve) => { resolveOld = resolve; });
    const fresh = new Promise<StoryRoadContentPayload>((resolve) => { resolveFresh = resolve; });
    const resource = createStoryRoadContentResource({ load: () => old, refresh: () => fresh });
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
});

test("road resource fails closed until reset after invalid content", async () => {
    let valid = false;
    const loader = createStoryRoadContentLoader({
        url: "/road.json", attempts: 1, retryDelayMs: 0,
        fetchContent: async () => response(valid ? payload() : { malformed: true }),
    });
    const resource = createStoryRoadContentResource(loader);
    let pending!: Promise<void>;
    try { resource.read(); } catch (thrown) { assert.ok(thrown instanceof Promise); pending = thrown; }
    await pending;
    assert.throws(() => resource.read(), StoryFieldContentLoadError);
    valid = true;
    resource.reset();
    try { resource.read(); } catch (thrown) { assert.ok(thrown instanceof Promise); pending = thrown; }
    await pending;
    assert.deepEqual(resource.read(), payload());
});

test("a retired road content address is stale and is not retried", async () => {
    let calls = 0;
    const loader = createStoryRoadContentLoader({
        url: "/retired.json", attempts: 3, retryDelayMs: 0,
        fetchContent: async () => { calls += 1; return response({}, 404); },
    });
    await assert.rejects(loader.load(), (error: unknown) =>
        error instanceof StoryFieldContentLoadError && error.staleDeployment && !error.retryable);
    assert.equal(calls, 1);
});
