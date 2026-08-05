import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4176";

export default defineConfig({
    testDir: "./e2e",
    testMatch: "adaptive-shell.spec.ts",
    timeout: 120_000,
    expect: { timeout: 15_000 },
    workers: 1,
    reporter: "line",
    outputDir: "test-results/adaptive-dpr",
    use: {
        baseURL,
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: {
        command: "npm run dev -- --host 127.0.0.1 --port 4176 --strictPort",
        url: baseURL,
        env: { VITE_SKIP_HTTPS: "1" },
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [
        { name: "chromium-map-dpr1", use: { deviceScaleFactor: 1 } },
        { name: "chromium-map-dpr125", use: { deviceScaleFactor: 1.25 } },
        { name: "chromium-map-dpr15", use: { deviceScaleFactor: 1.5 } },
        { name: "chromium-map-dpr2", use: { deviceScaleFactor: 2 } },
    ],
});
