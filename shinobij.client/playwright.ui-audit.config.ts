import { defineConfig } from "@playwright/test";
import { previewRootFor, uiAuditE2ePort } from "./e2e-ports";

// Full non-combat artwork/layout audit. The gated smoke suite
// (playwright.config.ts) keeps the screen walk on one desktop and one mobile
// project so a missing asset still reddens CI; this config is the deep pass —
// same two viewports, but its own port, its own snapshot root, and serialized
// workers so the screen-by-screen walk stays readable.
//
// The port comes from e2e-ports.ts rather than a literal, so this suite gets the
// same per-worktree window every other suite has (CI keeps a fixed port). That
// is what stops two concurrent worktrees from certifying against each other's
// preview server, and it is why the snapshot root is derived from the port.
//
// Point UI_AUDIT_BASE_URL at an already-running server (e.g. `npm run dev`) to
// skip the preview build entirely.
const externalBaseURL = process.env.UI_AUDIT_BASE_URL;
const port = uiAuditE2ePort();
const previewRoot = previewRootFor(port);
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: "./e2e",
    // Without this the config inherits the whole smoke suite, which is not what
    // a UI audit run is for and is how these specs ended up doubling the gate.
    testMatch: ["**/non-combat-ui-audit.spec.ts", "**/item-artwork-coverage.spec.ts"],
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
        // Same immutable-snapshot contract as the smoke suite: a parallel build
        // briefly empties dist, which would blank the very pages this audit is
        // checking for missing artwork.
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
