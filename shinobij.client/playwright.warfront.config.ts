import { defineConfig } from "@playwright/test";
import { warfrontE2ePort } from "./e2e-ports";

const port = warfrontE2ePort();
const baseURL = `http://127.0.0.1:${port}`;
// The snapshot helper deliberately refuses to overwrite an existing directory.
// Process-scoped roots keep each QA artifact immutable while allowing repeated
// local runs against the same deterministic port.
const releasePreviewRoot = `.playwright-dist-warfront-${port}-${process.pid}`;
const webServerCommand = `npm run build:warfront-e2e && node scripts/prepare-e2e-preview.mjs ${releasePreviewRoot} dist-perf && npm run preview -- --host 127.0.0.1 --port ${port} --outDir ${releasePreviewRoot}`;

export default defineConfig({
    testDir: "./e2e-warfront",
    // Hosted runners can be substantially slower during first-load asset decode.
    // Keep explicit release-scale budgets while exercising real phone, tablet,
    // desktop, and high-DPI CSS viewports rather than DPR-only duplicates.
    timeout: 120_000,
    expect: { timeout: 30_000 },
    workers: 1,
    reporter: "line",
    use: {
        baseURL,
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: {
        // Every environment receives the same immutable release candidate.
        // This prevents first-request Vite transforms from delaying DOM ready
        // and ensures local QA cannot certify source that differs from CI.
        command: webServerCommand,
        url: `${baseURL}/petvfx.html`,
        env: { VITE_SKIP_HTTPS: "1" },
        reuseExistingServer: !process.env.CI,
        // This command runs a full `build:warfront-e2e` AND the ~370 MB verified
        // snapshot before preview binds — minutes of work, not server boot.
        timeout: 600_000,
    },
    projects: [
        { name: "desktop", use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
        { name: "desktop-retina", use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
        { name: "tablet", use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1.25, hasTouch: true } },
        { name: "phone", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } },
    ],
});
