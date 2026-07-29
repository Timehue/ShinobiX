import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

type SavePayload = {
    character?: Record<string, unknown>;
    [key: string]: unknown;
};

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

async function installAuthenticatedApi(page: Page) {
    let save: SavePayload | null = null;
    let saveVersion = 0;

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;

        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        if (path === "/api/player-auth") return json(route, { ok: true, token: "e2e-session-token" });

        if (path.toLowerCase() === "/api/save/auditninja") {
            if (request.method() === "GET") {
                return save ? json(route, { ...save, _saveVersion: saveVersion }) : json(route, { error: "Not found" }, 404);
            }
            if (request.method() === "POST") {
                const incoming = request.postDataJSON() as SavePayload;
                saveVersion += 1;
                save = {
                    ...incoming,
                    character: {
                        ...(incoming.character ?? {}),
                        onboardingStep: "done",
                        ryo: 1_000_000,
                        fateShards: 500,
                        boneCharms: 500,
                        auraStones: 500,
                        mythicSeals: 500,
                        inventory: [
                            ...((incoming.character?.inventory as string[] | undefined) ?? []),
                            "dungeon-key",
                        ],
                    },
                };
                return json(route, { ok: true, _saveVersion: saveVersion });
            }
        }

        if (path === "/api/battle-lock") return json(route, { lock: null });
        if (path === "/api/world-state") return json(route, { territories: [], wars: [], standings: [] });
        if (path === "/api/clan/war/list") return json(route, { wars: [] });
        if (path === "/api/game-state") return json(route, { villageStates: {}, arenaActiveFights: [] });
        if (path === "/api/weekly-boss") return json(route, { boss: null, fightEnabled: true });
        if (path === "/api/ranked-season") return json(route, { current: null, lastSeason: null });
        if (path === "/api/legacy/status") return json(route, { enabled: false });
        if (path === "/api/towers/floors") return json(route, { floors: [] });

        return json(route, {
            ok: true,
            players: [],
            images: {},
            categories: {},
            ladder: [],
            leaderboard: [],
            announcements: [],
            eras: [],
            entries: [],
        });
    });

    return {
        hasSave: () => save !== null,
    };
}

async function createAccount(page: Page) {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByTestId("start-create").click();
    await page.getByRole("button", { name: "Choose Village" }).click();
    await page.locator(".cc-village-card").first().click();
    await page.getByRole("button", { name: "Choose Bloodline" }).click();
    await page.locator(".cc-bloodline-card").first().click();
    await page.getByRole("button", { name: "Choose Avatar" }).click();
    await page.locator(".cc-avatar-card").first().click();
    await page.getByRole("button", { name: "Preview Shinobi" }).click();
    await page.getByRole("button", { name: "Name and Password" }).click();
    await page.getByLabel("Name").fill("AuditNinja");
    await page.locator("#cc-password").fill("Audit!Pass1234");
    await page.locator("#cc-confirm-password").fill("Audit!Pass1234");
    await page.getByRole("button", { name: "Enter the World" }).click();
}

async function returnToCentral(page: Page) {
    await page.goto("/#/centralHub");
    // Hash-only navigation does not reload the SPA, and this app intentionally
    // restores bookmarked screens only during boot.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Central — The Thousand Gates" })).toBeVisible();
}

test("authenticated player can open every Central Hub system", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "one full authenticated route certification is sufficient");
    const api = await installAuthenticatedApi(page);
    await createAccount(page);
    await expect.poll(api.hasSave).toBe(true);
    await expect.poll(() => page.evaluate(() => {
        const raw = localStorage.getItem("ninjav-admin-build-v1");
        return raw ? JSON.parse(raw).currentAccountName : "";
    })).toBe("AuditNinja");
    await returnToCentral(page);

    const navigations = [
        { tile: "Arena District", heading: "Arena District" },
        { tile: "Shinobi Council Hall", heading: "Shinobi Council Hall" },
        { tile: "Grand Marketplace", heading: "Grand Marketplace" },
        { tile: "Hunter Guild", heading: /Hunter Guild/ },
        { tile: "Hall of Legends", heading: "Hall of Legends" },
        { tile: "Pet Coliseum", heading: /Pet Coliseum|Tactical Pet Arena/ },
        { tile: "Weekly Boss", heading: "Weekly Boss" },
    ] as const;

    for (const destination of navigations) {
        await page.getByRole("button", { name: new RegExp(`^${destination.tile}`) }).click();
        await expect(page.getByRole("heading", { name: destination.heading }).first()).toBeVisible();
        await returnToCentral(page);
    }

    for (const name of ["Ancient Archives", "Awakening Stone", "Crafter", "Relic Dungeons", "Celestial Tower"]) {
        const opener = page.locator(".central-card").filter({ hasText: name });
        await opener.click();
        const dialog = page.getByRole("dialog", { name });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator(":focus")).toHaveCount(1);
        await expect.poll(() => page.evaluate(() => (document.querySelector("#root") as HTMLElement | null)?.inert)).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        await expect.poll(() => page.evaluate(() => (document.querySelector("#root") as HTMLElement | null)?.inert ?? false)).toBe(false);
    }

    const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
