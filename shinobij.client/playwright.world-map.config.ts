import { defineConfig } from "@playwright/test";

// A focused source-server check: no shared production output is rebuilt or
// snapshotted while the responsive camera and shell are being iterated on.
const externalBaseURL = process.env.WORLD_MAP_QA_BASE_URL;
const port = Number(process.env.WORLD_MAP_QA_PORT ?? 5179);
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;
const phonesAndTablets = [
    [320, 568], [360, 640], [390, 844], [430, 932],
    [568, 320], [667, 375], [844, 390], [768, 1024], [1024, 768],
] as const;

export default defineConfig({
    testDir: "./e2e",
    testMatch: "**/world-map-mobile.spec.ts",
    timeout: 60_000,
    expect: { timeout: 12_000 },
    fullyParallel: true,
    workers: 2,
    retries: 0,
    reporter: "line",
    outputDir: "test-results/world-map-mobile",
    use: {
        baseURL,
        // In contextOptions or not at all: a top-level `reducedMotion` is
        // silently ignored (see playwright.config.ts).
        contextOptions: { reducedMotion: "reduce" },
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: externalBaseURL ? undefined : {
        command: `node node_modules/vite/bin/vite.js --config scripts/vite.world-map-qa.config.mjs --configLoader runner --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        env: { VITE_SKIP_HTTPS: "1" },
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [
        ...phonesAndTablets.map(([width, height]) => ({
            name: `chromium-${width}x${height}`,
            use: { browserName: "chromium" as const, viewport: { width, height }, isMobile: true, hasTouch: true },
        })),
        {
            name: "webkit-390x844",
            use: { browserName: "webkit", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
        },
        {
            name: "chromium-desktop",
            use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
        },
    ],
});
