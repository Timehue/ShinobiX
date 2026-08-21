import { defineConfig } from "@playwright/test";
import { warfrontE2ePort } from "./e2e-ports";

const port = warfrontE2ePort();
const baseURL = `http://127.0.0.1:${port}`;
const releasePreviewRoot = `.playwright-dist-warfront-${port}`;
const webServerCommand = process.env.CI
    ? `npm run build:warfront-e2e && node scripts/prepare-e2e-preview.mjs ${releasePreviewRoot} dist-perf && npm run preview -- --host 127.0.0.1 --port ${port} --outDir ${releasePreviewRoot}`
    : `npm run dev -- --host 127.0.0.1 --port ${port}`;

export default defineConfig({
    testDir: "./e2e-warfront",
    // CI renders this 3D scene through software WebGL (SwiftShader, no GPU on
    // the runner), which is far slower than any developer machine: the same
    // four specs pass locally in 2.7 min against a real GPU. The tell was that
    // every assertion carrying an explicit 30s wait passed on CI while the ones
    // falling back to the 12s default failed -- first-load waits had already
    // been bumped to 30s by whoever hit this before. Adopt that proven number as
    // the default instead of leaving the rest of the suite on a GPU-speed
    // budget, and give the whole test room for the slower frames.
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
