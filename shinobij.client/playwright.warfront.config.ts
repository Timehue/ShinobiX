import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4174";
const releasePreviewRoot = ".playwright-warfront-dist";
const webServerCommand = process.env.CI
    ? `node scripts/prepare-e2e-preview.mjs ${releasePreviewRoot} && npm run preview -- --host 127.0.0.1 --port 4174 --outDir ${releasePreviewRoot}`
    : "npm run dev -- --host 127.0.0.1 --port 4174";

export default defineConfig({
    testDir: "./e2e-warfront",
    timeout: 80_000,
    expect: { timeout: 12_000 },
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
        // Hosted CI receives the already-built release candidate and snapshots
        // it before serving, so this suite cannot accidentally certify source
        // that differs from the client artifact. Local iteration keeps Vite's
        // faster development server.
        command: webServerCommand,
        url: `${baseURL}/petvfx.html`,
        env: { VITE_SKIP_HTTPS: "1" },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    projects: [
        { name: "chromium-dpr1", use: { deviceScaleFactor: 1 } },
        { name: "chromium-dpr125", use: { deviceScaleFactor: 1.25 } },
        { name: "chromium-dpr15", use: { deviceScaleFactor: 1.5 } },
        { name: "chromium-dpr2", use: { deviceScaleFactor: 2 } },
    ],
});
