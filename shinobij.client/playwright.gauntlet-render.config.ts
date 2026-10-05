import { defineConfig } from "@playwright/test";

const port = 50973;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: "./e2e",
    testMatch: ["**/pet-gauntlet-board.spec.ts"],
    // The cold Vite transform of the legacy visual harness is CPU-heavy on this project.
    timeout: 300_000,
    expect: { timeout: 20_000 },
    fullyParallel: false,
    workers: 1,
    reporter: "line",
    outputDir: "test-results/gauntlet-render",
    use: {
        baseURL,
        browserName: "chromium",
        launchOptions: { headless: false, args: ["--window-size=1188,848"] },
        viewport: { width: 1188, height: 848 },
        contextOptions: { reducedMotion: "no-preference" },
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: {
        command: `npx vite --config vite.gauntlet-render.config.ts --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        env: { VITE_SKIP_HTTPS: "1" },
        reuseExistingServer: false,
        timeout: 300_000,
    },
});
