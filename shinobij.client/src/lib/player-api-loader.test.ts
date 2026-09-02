import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ./player-api is deliberately OFF the startup graph. App reaches it through
// ./player-api-loader for one call (postPlayerChallengeNotice) that can only
// run after a duel is accepted, and player-api drags ./pvp-session-runtime with
// it via `abortableDelay` — together ~13.9 KB of rendered module bytes that
// every player would otherwise download before the start screen.
//
// A single `import { ... } from "./lib/player-api"` anywhere in App silently
// pulls both back into the entry chunk, and nothing else would fail: the app
// still works, the bundle just quietly regrows. These assertions are the only
// thing standing between that edit and a size-gate regression nobody attributes
// to it.

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const loader = readFileSync(new URL("./player-api-loader.ts", import.meta.url), "utf8");

test("App does not statically import player-api (it would re-enter the startup graph)", () => {
    const staticImport = /^import\s[^;]*?\sfrom\s+["']\.\/lib\/player-api["'];/m;
    assert.equal(
        staticImport.test(app),
        false,
        'App.tsx statically imports "./lib/player-api". That pulls player-api AND '
            + "pvp-session-runtime back into the eager entry chunk. Use loadPlayerApi() "
            + "from ./lib/player-api-loader instead.",
    );
});

test("App reaches player-api through the on-demand loader", () => {
    // Other names may be imported alongside it (warmPlayerApi is), so match the
    // specifier rather than the whole clause.
    assert.match(app, /import\s+\{[^}]*\bloadPlayerApi\b[^}]*\}\s+from\s+["']\.\/lib\/player-api-loader["']/);
    assert.ok(
        app.includes("loadPlayerApi()"),
        "App imports loadPlayerApi but never calls it — the duel-notice call sites lost their loader.",
    );
});

test("the awaited pet-duel path warms the chunk before it blocks on it", () => {
    // acceptPetChallengeGlobal AWAITS the duel notice and only then routes to the
    // arena, so a cold chunk would put a network fetch in front of accepting a
    // PvP duel — a dependency the pre-extraction code never had. The warm-up must
    // therefore come first, and it must be fire-and-forget (never awaited, or it
    // becomes the very stall it exists to prevent).
    const handler = app.slice(
        app.indexOf("async function acceptPetChallengeGlobal"),
        app.indexOf("// Fetch full server player list"),
    );
    assert.ok(handler.length > 0, "acceptPetChallengeGlobal not found");

    const warm = handler.indexOf("warmPlayerApi()");
    const awaited = handler.indexOf("await (await loadPlayerApi())");
    assert.ok(warm >= 0, "the pet-duel accept path must warm the player-api chunk");
    assert.ok(awaited > warm, "the warm-up must precede the awaited notice, or it warms nothing");
    assert.doesNotMatch(
        handler.slice(warm, warm + 60),
        /await\s+warmPlayerApi/,
        "warmPlayerApi must stay fire-and-forget",
    );
});

test("the loader keeps the retry/timeout policy instead of a bare import()", () => {
    // A bare import() here would reintroduce the two failures lazyWithRetry
    // exists to prevent: a hung fetch that never settles (so the awaiting duel
    // acceptance never settles either) and a rotated chunk hash after a deploy
    // that fails every later attempt with no recovery.
    assert.match(loader, /retryDynamicImport\(\s*\(\)\s*=>\s*import\(["']\.\/player-api["']\)\s*\)/);
    assert.match(loader, /import\s+\{\s*retryDynamicImport\s*\}\s+from\s+["']\.\/lazyWithRetry["']/);
});
