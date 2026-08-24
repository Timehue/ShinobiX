import { defineConfig } from "@playwright/test";

const port = process.env.CLAN_INTEGRITY_PORT ?? "35180";
const baseURL = `http://127.0.0.1:${port}`;

// Focused built-client journey for the Clan Hall's destructive and
// resource-spending controls. It uses a dedicated preview server instead of
// the immutable full-suite snapshot so it can run while another release task
// owns or refreshes that snapshot directory. Serving the already-built dist
// also avoids HMR reloads while concurrent workspace edits are still landing.
export default defineConfig({
    testDir: "./e2e",
    testMatch: "clan-integrity-ux.spec.ts",
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: "line",
    use: {
        baseURL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        reducedMotion: "reduce",
        serviceWorkers: "block",
    },
    webServer: {
        command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { VITE_SKIP_HTTPS: "1" },
    },
    projects: [
        { name: "chromium-desktop", use: { browserName: "chromium", viewport: { width: 1366, height: 768 } } },
        { name: "chromium-mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});
