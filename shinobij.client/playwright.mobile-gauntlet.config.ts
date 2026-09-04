import { defineConfig, devices } from "@playwright/test";
import { mobileGauntletE2ePort, previewRootFor } from "./e2e-ports";

// Route fixtures isolate the audit from backend data. An explicit base URL can
// reuse a running server; otherwise the suite snapshots the verified build on
// a worktree-specific port, matching the repository's other E2E configurations.
const externalBaseURL = process.env.MOBILE_GAUNTLET_BASE_URL;
const port = mobileGauntletE2ePort();
const previewRoot = previewRootFor(port);
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;
const chromium = devices["Desktop Chrome"];

export default defineConfig({
    testDir: "./e2e",
    testMatch: ["**/non-combat-ui-audit.spec.ts", "**/adaptive-shell.spec.ts", "**/ui-gallery.capture.spec.ts"],
    timeout: 60_000,
    expect: { timeout: 12_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: "line",
    outputDir: "test-results/mobile-gauntlet",
    use: {
        ...chromium,
        baseURL,
        colorScheme: "dark",
        locale: "en-US",
        reducedMotion: "reduce",
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: externalBaseURL ? undefined : {
        command: `node scripts/prepare-e2e-preview.mjs ${previewRoot} && npm run preview -- --host 127.0.0.1 --port ${port} --outDir ${previewRoot}`,
        url: baseURL,
        env: { VITE_SKIP_HTTPS: "1" },
        reuseExistingServer: false,
        timeout: 300_000,
    },
    projects: [
        {
            name: "chromium-360x800",
            use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true },
        },
        {
            // Keep the canonical project name: several mobile-only interaction
            // contracts intentionally run once rather than at every viewport.
            name: "chromium-mobile",
            use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
        },
        {
            name: "chromium-430x932",
            use: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true },
        },
        {
            name: "chromium-844x390",
            use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
        },
        {
            name: "chromium-desktop",
            use: { viewport: { width: 1440, height: 900 } },
        },
    ],
});
