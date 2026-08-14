/*
 * Lazy boundary for the story-trigger rules graph.
 *
 * Main chapter/interlude prose is compiled into content-addressed per-village
 * payloads by scripts/generate-story-content.mts. The trigger module requests
 * only the active village after this small rules chunk resolves, so story data
 * remains off startup and no player downloads another village speculatively.
 *
 * A failed module import clears the cache so the next story beat retries. Idle
 * prefetch warms only these rules, never a narrative payload.
 */

type StoryTriggerModule = typeof import("./story-trigger");

let _mod: Promise<StoryTriggerModule> | null = null;

export function loadStoryTrigger(): Promise<StoryTriggerModule> {
    if (!_mod) {
        _mod = import("./story-trigger");
        _mod.catch(() => { _mod = null; });
    }
    return _mod;
}

const _prefetch = () => { void loadStoryTrigger().catch(() => undefined); };
if (typeof window !== "undefined") {
    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(_prefetch, { timeout: 8_000 });
    } else {
        setTimeout(_prefetch, 3_000);
    }
}
