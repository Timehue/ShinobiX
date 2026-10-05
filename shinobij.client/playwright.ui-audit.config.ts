import { defineConfig } from "@playwright/test";
import { previewRootFor, uiAuditE2ePort } from "./e2e-ports";

// Full non-combat artwork/layout audit. The gated smoke suite
// (playwright.config.ts) keeps the screen walk on one desktop and one mobile
// project so a missing asset still reddens CI; this config is the deep pass —
// Google's six Android form-factor anchors plus Google Play Games on PC's
// landscape ratios, its own port, its own snapshot root, and serialized workers
// so the screen-by-screen walk stays readable.
//
// The port comes from e2e-ports.ts rather than a literal, so this suite gets the
// same per-worktree window every other suite has (CI keeps a fixed port). That
// is what stops two concurrent worktrees from certifying against each other's
// preview server, and it is why the snapshot root is derived from the port.
//
// Point UI_AUDIT_BASE_URL at an already-running server (e.g. `npm run dev`) to
// skip the preview build entirely.
const externalBaseURL = process.env.UI_AUDIT_BASE_URL;
const port = uiAuditE2ePort();
const previewRoot = previewRootFor(port);
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: "./e2e",
    // Without this the config inherits the whole smoke suite, which is not what
    // a UI audit run is for and is how these specs ended up doubling the gate.
    testMatch: ["**/non-combat-ui-audit.spec.ts", "**/item-artwork-coverage.spec.ts"],
    timeout: 60_000,
    expect: { timeout: 12_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: "line",
    outputDir: "test-results/ui-audit",
    use: {
        baseURL,
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        colorScheme: "dark",
        locale: "en-US",
        // In contextOptions or not at all: a top-level `reducedMotion` is
        // silently ignored (see playwright.config.ts).
        contextOptions: { reducedMotion: "reduce" },
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: externalBaseURL ? undefined : {
        // Same immutable-snapshot contract as the smoke suite: a parallel build
        // briefly empties dist, which would blank the very pages this audit is
        // checking for missing artwork.
        command: `node scripts/prepare-e2e-preview.mjs ${previewRoot} && npm run preview -- --host 127.0.0.1 --port ${port} --outDir ${previewRoot}`,
        url: baseURL,
        env: { VITE_SKIP_HTTPS: "1" },
        reuseExistingServer: false,
        // This command SNAPSHOTS the whole build (about 548 MB / 5,841 files,
        // copied then hash-verified) before vite preview binds, so the budget covers far
        // more than server boot. Measured at ~14s warm on 2026-09-01; raised to
        // 300s because the gate has twice died here with a bare
        // "Timed out waiting ..." and no specs executed, which reads like a
        // browser catastrophe rather than a slow step. A leftover
        // .playwright-dist-* or an orphaned port both fail FAST with an explicit
        // error instead, so neither explains that signature.
        timeout: 300_000,
    },
    projects: [
        // Keep these canonical project names: broader e2e files route setup
        // and assertions by name. Their touch-enabled viewports also cover the
        // Android 16:10 and 9:21 anchors, respectively.
        {
            name: "chromium-desktop",
            use: { viewport: { width: 1280, height: 800 }, isMobile: true, hasTouch: true },
        },
        {
            name: "chromium-mobile",
            use: { viewport: { width: 432, height: 1008 }, isMobile: true, hasTouch: true },
        },
        { name: "chromium-anchor-landscape-4-3", use: { viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true } },
        { name: "chromium-anchor-landscape-21-9", use: { viewport: { width: 1680, height: 720 }, isMobile: true, hasTouch: true } },
        { name: "chromium-anchor-portrait-3-4", use: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
        { name: "chromium-anchor-portrait-10-16", use: { viewport: { width: 640, height: 1024 }, isMobile: true, hasTouch: true } },
        // Level Up's current Google Play Games on PC guidance sets 16:9 as
        // the minimum landscape ratio and recommends 16:10, 21:9, and 3:2.
        // These projects emulate actual mouse/keyboard desktops (no touch).
        { name: "chromium-pc-landscape-16-9", use: { viewport: { width: 1920, height: 1080 }, isMobile: false, hasTouch: false } },
        { name: "chromium-pc-landscape-16-10", use: { viewport: { width: 1920, height: 1200 }, isMobile: false, hasTouch: false } },
        { name: "chromium-pc-landscape-21-9", use: { viewport: { width: 2520, height: 1080 }, isMobile: false, hasTouch: false } },
        { name: "chromium-pc-landscape-3-2", use: { viewport: { width: 1440, height: 960 }, isMobile: false, hasTouch: false } },
    ],
});
