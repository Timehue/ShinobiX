import { defineConfig } from "@playwright/test";

const baseURL = process.env.UI_AUDIT_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
    testDir: "./e2e",
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
        reducedMotion: "reduce",
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        { name: "chromium-desktop", use: { viewport: { width: 1440, height: 900 } } },
        {
            name: "chromium-mobile",
            use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
        },
    ],
});
