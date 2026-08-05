import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4174";

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
        command: "npm run dev -- --host 127.0.0.1 --port 4174",
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
