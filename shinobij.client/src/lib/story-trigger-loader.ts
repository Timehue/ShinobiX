/*
 * Lazy boundary for the story-trigger graph.
 *
 * lib/story-trigger statically reaches the full story prose — data/storylines
 * via its own import, data/story-interludes (~200 KB) and lib/story-epilogue →
 * data/story-epilogues (~60 KB) — so a static import from App.tsx forced all
 * of it into the boot-critical entry chunk. Routing every App call site
 * through this cached dynamic import moves the interlude/epilogue prose and
 * the trigger logic into their own async chunk instead.
 *
 * The cache is cleared on a failed fetch so a transient network blip retries
 * on the next story beat instead of wedging story triggers for the session
 * (same policy as lib/lazyWithRetry for screens). The idle prefetch warms the
 * chunk shortly after boot — off the critical path — so by the time a beat
 * can actually fire the module is already local and `.then` resolves in a
 * microtask.
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
