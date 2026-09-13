import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

// A lazy screen whose chunk will not load gets ONE automatic page reload (the
// stale-deploy fix), then the "A new version is available" card. The guard used
// to be cleared by the root boundary's mount on every boot, which comes before
// any lazy chunk loads, so a chunk that failed every time reloaded the page
// forever: every ~4.4 s in Chromium, 8 times in 35 s (measured 2026-09-13).
// See src/lib/chunk-load-recovery.ts.
//
// This exercises the error boundaries and each engine's dynamic-import
// failure, not layout, so it runs once per engine at the desktop viewport.
const ENGINE_PROJECTS = new Set(["chromium-desktop", "firefox-desktop", "webkit-desktop"]);

test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!ENGINE_PROJECTS.has(testInfo.project.name), "one run per browser engine");
});

const manifest = JSON.parse(readFileSync(new URL("../dist/.vite/manifest.json", import.meta.url), "utf8"));
const arenaChunk = `/${manifest["src/screens/WeeklyBossArena.tsx"].file}`;
const NEW_VERSION_CARD = { name: "A new version is available" } as const;

function countDocumentLoads(page: Page): () => number {
    let loads = 0;
    page.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads += 1;
    });
    return () => loads;
}

async function openWeeklyBossFromHub(page: Page) {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "centralHub");
    await page.locator(".central-card").filter({ hasText: "Weekly Boss" }).click();
}

const reloadStamp = (page: Page) => page.evaluate(() => sessionStorage.getItem("__sj_chunk_reloaded"));

test("a chunk that never loads reloads once, then stays on the new-version card", async ({ page }) => {
    test.setTimeout(90_000);
    const documentLoads = countDocumentLoads(page);
    await page.route((url) => url.pathname === arenaChunk, (route) => route.abort("failed"));

    await openWeeklyBossFromHub(page);
    // lazyWithRetry spends ~3.6 s retrying before the boundary sees the error.
    await expect.poll(documentLoads, { timeout: 30_000 }).toBe(2);

    // The reload restores #/weeklyBoss, whose chunk fails again. The boundary
    // renders its card even on the way to a reload, so the card alone proves
    // nothing; it has to still be there, with no third load, after the moment
    // the old guard would have reloaded (immediately after the card rendered).
    const card = page.getByRole("heading", NEW_VERSION_CARD);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(4_000);
    await expect(card).toBeVisible();
    expect(documentLoads(), "page reloads after the first automatic one").toBe(2);
    expect(await reloadStamp(page)).toMatch(/^\d+$/);
});

test("a chunk that 404s before a deploy reloads once, then loads", async ({ page }) => {
    test.setTimeout(90_000);
    const documentLoads = countDocumentLoads(page);
    // The shape of a stale deploy: server.ts answers a chunk URL the running
    // build no longer has with a no-store 404. After the reload it is served.
    await page.route(
        (url) => url.pathname === arenaChunk,
        (route) => documentLoads() < 2
            ? route.fulfill({
                status: 404,
                contentType: "text/plain",
                headers: { "cache-control": "no-store" },
                body: "Static asset not found",
            })
            : route.continue(),
    );

    await openWeeklyBossFromHub(page);
    await expect.poll(documentLoads, { timeout: 30_000 }).toBe(2);

    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "weeklyBoss");
    await expect(page.locator(".weekly-boss-screen").filter({ hasText: "Weekly Boss" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", NEW_VERSION_CARD)).toHaveCount(0);
    expect(documentLoads()).toBe(2);
    expect(await reloadStamp(page)).toMatch(/^\d+$/);
});
