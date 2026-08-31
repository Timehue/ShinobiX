import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    testMatch: "pet-mentor-guide.spec.ts",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    reporter: "line",
    use: {
        baseURL: "https://127.0.0.1:5174",
        ignoreHTTPSErrors: true,
        serviceWorkers: "block",
        reducedMotion: "reduce",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium-desktop",
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "chromium-phone",
            use: { ...devices["Pixel 7"] },
        },
    ],
});
