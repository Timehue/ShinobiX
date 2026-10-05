import { defineConfig } from "@playwright/test";

// Focused browser harness for controller navigation primitives. The spec uses
// a self-contained DOM fixture and a simulated standard Gamepad API, so it
// intentionally does not start the game preview server.
export default defineConfig({
    testDir: "./e2e",
    testMatch: ["**/gamepad-navigation.spec.ts"],
    timeout: 10_000,
    expect: { timeout: 3_000 },
    fullyParallel: true,
    workers: 4,
    reporter: "line",
    use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 800, height: 600 },
        trace: "retain-on-failure",
    },
});
