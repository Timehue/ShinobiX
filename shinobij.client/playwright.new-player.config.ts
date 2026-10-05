import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    testMatch: "new-player-navigation.spec.ts",
    timeout: 90_000,
    expect: { timeout: 15_000 },
    workers: 1,
    reporter: "line",
    outputDir: "test-results/new-player-navigation",
    use: {
        baseURL: "http://127.0.0.1:5198",
        contextOptions: { reducedMotion: "reduce" },
        serviceWorkers: "block",
        screenshot: "only-on-failure",
    },
    webServer: {
        command: "npm run preview -- --host 127.0.0.1 --port 5198 --strictPort",
        url: "http://127.0.0.1:5198",
        reuseExistingServer: false,
        timeout: 120_000,
        env: { VITE_SKIP_HTTPS: "1" },
    },
    projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1366, height: 768 } } }],
});
