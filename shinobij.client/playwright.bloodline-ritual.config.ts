import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e", testMatch: "bloodline-ritual.spec.ts", workers: 1,
    timeout: 30000, reporter: "line", outputDir: "test-results/bloodline-ritual",
    use: { browserName: "chromium", serviceWorkers: "block", contextOptions: { reducedMotion: "no-preference" } },
    projects: [
        { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
        { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: "landscape", use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
    ],
});
