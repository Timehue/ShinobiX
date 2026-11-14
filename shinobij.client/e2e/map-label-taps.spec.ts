import { expect, test, type Page } from "@playwright/test";
import { installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";
import { walkUntilOnMap } from "./helpers/world-camera";

/*
 * The labels hanging under pieces on a sector board are the words a phone
 * player aims at, so a tap on one must reach its piece. A building's name
 * used to fall through to the canvas and walk the player, and a wanderer
 * crossing the world boss's pill took that tap for itself.
 */
const SECTOR = 42;
const PHONE_PROJECTS = new Set(["chromium-mobile", "webkit-mobile"]);

function worldBossState() {
    const now = Date.now();
    return {
        event: {
            eventId: "e2e-world-boss", bossId: "hollow-beast", bossName: "Chicxulub", status: "roaming",
            startedAt: now - 60_000, roamEndsAt: now + 3_600_000, endsAt: now + 7_200_000, endedAt: null,
            spawnSector: SECTOR, targetVillage: null, targetSector: null, destinationReached: false,
            hp: 900_000, hpMax: 1_000_000, currentSector: SECTOR, nextSector: null, nextHopInMs: 600_000,
            movementPaused: true, threatenedVillage: null, minedCrystalNodeIds: [], crystalNodesMined: 0,
            crystalNodeCount: 0, hollowShardsDeposited: 0, topCachesPending: false, retreatPenaltyUntil: 0,
            active: true, participantCount: 1,
        },
        queue: { waitingCount: 0, queued: false, match: null },
        serverNow: now,
    };
}

/** What /api/sector/buildings projects for one building with no work begun. */
function buildingsView() {
    const standing = { metAt: 0, trust: 0, visits: 0, visitDay: "" };
    const building = {
        id: "midlands-tea-house", sector: SECTOR, name: "Fieldside Tea House", kind: "workplace",
        keeper: "Host Mina", role: "Tea-table host", description: "A public stop beside the herb rows.",
        services: ["tea"], left: 26, top: 84, width: 26, height: 18, footprint: [], approach: 110, art: "teahouse", region: "midlands",
    };
    return {
        ok: true,
        view: {
            sector: SECTOR, saveVersion: 0, serverNow: Date.now(),
            progress: { version: 1, standing: {}, repairs: 0, deliveries: 0, watches: 0, surveys: 0, day: "", repairsToday: 0, deliveriesToday: 0, rewardsToday: 0, shardClaims: 0, receipts: [], titles: [] },
            buildings: [{
                building, greeting: "Sit a while.", standing, services: [],
                shared: { version: 1, revision: 0, repairs: 0, stage: 0, updatedAt: 0, contributors: [], reports: [] },
                materials: [], relationship: { title: "Stranger", text: "", benefits: [] }, conditions: "", register: [], recipes: [], leads: [],
            }],
        },
    };
}

async function bootInSector(page: Page) {
    const save = { ...uiAuditSave(), currentSector: SECTOR };
    const now = Date.now();
    const bucket = Math.floor(now / (6 * 60 * 60 * 1000));
    const wandererCooldowns: Record<string, number> = {};
    for (const offset of [-1, 0, 1]) {
        for (const index of [0, 1, 2]) wandererCooldowns[`w-${SECTOR}-${bucket + offset}-${index}`] = now + 30 * 24 * 60 * 60 * 1000;
    }
    save.character = { ...save.character, wandererCooldowns };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem("legacyRumors.seen.v1:auditninja", JSON.stringify([10, 20, 30, 40, 45]));
    });
    await page.route("**/api/world-boss-event**", route => route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify(worldBossState()),
    }));
    await page.route("**/api/sector/buildings**", route => route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify(buildingsView()),
    }));
    await page.goto("/#/worldMap", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "worldMap", { timeout: 45_000 });
    await expect.poll(async () => await page.locator(".generated-world-map").count() > 0
        || await page.locator(".sector-hud").isVisible(), { timeout: 45_000 }).toBe(true);
    if (await page.locator(".generated-world-map").count() > 0) {
        await page.getByRole("button", { name: /, world boss event$/ }).click();
    }
}

/** A real hit-test at the middle of the element: what would a finger land on? */
async function centreOf(page: Page, selector: string) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, `${selector} has no box`).not.toBeNull();
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

test("tapping a building's name opens that building", async ({ page }, info) => {
    test.skip(!PHONE_PROJECTS.has(info.project.name), "these are phone tap checks");
    test.setTimeout(120_000);
    await bootInSector(page);
    const name = page.locator(".sector-building-threshold .sector-building-name", { hasText: "Fieldside Tea House" });
    await expect(name).toBeVisible();
    await name.scrollIntoViewIfNeeded();
    // A phone shows ~7 tiles around the player: walk up to the tea house first.
    await walkUntilOnMap(page, name);
    const point = await centreOf(page, ".sector-building-threshold .sector-building-name");
    const landed = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, point);
    expect(String(landed)).toContain("sector-building-name");
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("dialog")).toBeVisible();
});

test("a wanderer crossing the boss's pill does not take its tap", async ({ page }, info) => {
    test.skip(!PHONE_PROJECTS.has(info.project.name), "these are phone tap checks");
    test.setTimeout(120_000);
    await bootInSector(page);
    await expect(page.locator(".sector-world-boss-name")).toBeVisible();
    const point = await centreOf(page, ".sector-world-boss-name");
    // Stand a wanderer's box right on the pill, above the boss's layer.
    await page.evaluate(({ x, y }) => {
        const figure = document.createElement("div");
        figure.className = "sector-wanderer-figure";
        figure.style.cssText = `position:fixed;left:${x - 30}px;top:${y - 30}px;width:60px;height:60px;z-index:99999;pointer-events:auto`;
        figure.addEventListener("click", () => { document.body.dataset.wandererTapped = "1"; });
        document.body.append(figure);
    }, point);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("dialog", { name: "Chicxulub" })).toBeVisible();
    expect(await page.evaluate(() => document.body.dataset.wandererTapped)).toBeUndefined();

    // Beside the pill the wanderer is still the wanderer's.
    await page.evaluate(() => { document.querySelector<HTMLElement>("body > .sector-wanderer-figure")?.click(); });
    expect(await page.evaluate(() => document.body.dataset.wandererTapped)).toBe("1");
});
