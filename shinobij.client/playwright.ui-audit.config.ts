import { defineConfig } from "@playwright/test";

const externalBaseURL = process.env.UI_AUDIT_BASE_URL;
const port = process.env.UI_AUDIT_PORT ?? "43320";
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;
const previewRoot = `.playwright-dist-ui-${port}-${process.pid}`;

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
    webServer: externalBaseURL ? undefined : {
        command: `node scripts/prepare-e2e-preview.mjs ${previewRoot} && npm run preview -- --host 127.0.0.1 --port ${port} --outDir ${previewRoot}`,
        url: baseURL,
        env: { VITE_SKIP_HTTPS: "1" },
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [
        { name: "chromium-desktop", use: { viewport: { width: 1440, height: 900 } } },
        {
            name: "chromium-mobile",
            use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
        },
    ],
});
