import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";
import { WORLD_GEO_VERSION } from "../../shared/sector-geo";
import { rawPetPool } from "../src/data/pet-pool";

const load = createRequire(import.meta.url);
const { createShowdownSession, showdownStateView }: typeof import("../../api/_pet-showdown/engine") = load("../../dist/api/_pet-showdown/engine.js");

test("the Lone Black Cat keeps its species from the road into the duel", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const fallback = testInfo.project.name !== "chromium-desktop";
    const hatchery = testInfo.project.name === "chromium-mobile";
    // This roster window places a Lone Beast in sector 72. Against a standard
    // companion its seeded species is the Black Cat (standard-2).
    const start = Date.parse("2026-10-29T03:00:00Z");
    await page.clock.setFixedTime(start);
    const save = uiAuditSave();
    save.currentSector = 72;
    // Start beside the beast's home tile (55), inside the mobile camera.
    save.currentTile = 67;
    save.worldGeoV = WORLD_GEO_VERSION;
    save.currentBiome = "volcano";
    save.seenHints = ["worldMap"];
    const kite = { ...rawPetPool.find(pet => pet.id === "standard-38")!, id: "kite", templateId: "standard-38", level: 100 };
    save.character = {
        ...save.character,
        activePetId: "kite",
        pets: [kite],
        ...(hatchery && { petBreeding: { state: "breeding", parentIds: ["kite"], readyAt: start + 60_000 } }),
        wandererMemories: { beast: 3 },
    };
    const runtime = await installUiAuditRuntime(page, save);
    if (testInfo.project.name.startsWith("webkit")) {
        await page.addInitScript(() => {
            const getContext = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
                return kind === "webgl2" ? null : Reflect.apply(getContext, this, [kind, ...args]);
            } as typeof getContext;
        });
    }
    if (fallback) {
        for (const file of ["warfront-impostors/roster/standard-2.webp", "warfront-lod/roster/standard-2.glb", "pet-portraits/shinobi-v1/standard-2.webp"]) {
            await page.route(`**/${file}*`, route => route.fulfill({ status: 404, body: "" }));
        }
    }
    const models: string[] = [];
    page.on("request", request => { if (/\.glb(?:\?|$)/.test(request.url())) models.push(request.url()); });
    await expectUiAuditBoot(page, runtime, "worldMap");
    const back = page.getByRole("button", { name: /Return to Sector 72/ });
    await expect(back.or(page.locator(".continuous-world-map")).first()).toBeVisible();
    if (await back.isVisible()) await back.click();
    await expect(page.locator(".continuous-world-map")).toHaveAttribute("aria-busy", "false");

    const card = page.locator(".world-wanderer-dialog");
    if (hatchery) {
        await page.locator(".sector-wanderer-figure").filter({ hasText: "Lone Beast" }).click();
        await expect(card.getByRole("button", { name: "View in 3D" })).toHaveCount(0);
        await card.getByRole("button", { name: "Send out your pet" }).click();
        await expect(card).toContainText("None of your carried pets can answer yet");
        await card.getByRole("button", { name: "Close" }).click();
        await page.locator(".sector-wanderer-figure").filter({ hasText: "Lone Beast" }).click();
        await page.clock.setFixedTime(start + 61_000);
        await expect(card.getByRole("heading", { name: "Lone Black Cat" })).toBeVisible();
    }
    const figure = page.locator(".sector-wanderer-figure").filter({ hasText: "Lone Black Cat" });
    const cat = figure.locator(".sector-avatar-body img");
    await expect(cat).toHaveAttribute("src", fallback ? /\/pet-poses\/standard-2-idle\.webp/ : /\/warfront-impostors\/roster\/standard-2\.webp/);
    await expect.poll(() => cat.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    if (!fallback) await page.locator(".continuous-world-map").screenshot({ path: testInfo.outputPath("road.png") });
    if (!hatchery) await figure.click();

    await expect(card.getByRole("heading", { name: "Lone Black Cat" })).toBeVisible();
    const portrait = card.getByRole("img", { name: "Lone Black Cat" });
    await expect(portrait).toHaveAttribute("src", fallback ? /\/standard-2-idle\.webp/ : /\/standard-2\.webp/);
    await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(card).toContainText("Kite Magpie");
    await expect(card).toContainText("You recognize the stance");
    await expect(card.getByRole("button", { name: "Send out your pet" })).toBeVisible();
    expect(models.filter(url => url.includes("/standard-2.glb"))).toHaveLength(0);
    await card.getByRole("button", { name: "View in 3D" }).click();
    if (fallback) {
        await expect(card.getByRole("status")).toHaveText("3D preview unavailable");
        await expect(card.getByRole("img", { name: "Lone Black Cat" })).toBeVisible();
        await expect(card.getByRole("button", { name: "Send out your pet" })).toBeEnabled();
        if (testInfo.project.name.startsWith("webkit")) expect(models.filter(url => url.includes("/standard-2.glb"))).toHaveLength(0);
    } else {
        await expect(card.locator("canvas")).toHaveAttribute("data-preview-model", /\/warfront-lod\/roster\/standard-2\.glb/);
        await card.screenshot({ path: testInfo.outputPath("model.png") });
        await card.getByRole("button", { name: "Show portrait" }).click();
        await expect(card.locator("canvas")).toHaveCount(0);
    }
    const enemy = { ...rawPetPool.find(pet => pet.id === "standard-2")!, templateId: "standard-2", level: 100 };
    const state = showdownStateView(createShowdownSession({
        sessionId: "road-cat-duel", playerName: "AuditNinja", format: "1v1", tier: "warrior", seed: 42,
        playerPets: [kite], enemyPets: [enemy], enemyTeamName: "Lone Black Cat", rewardEligible: false,
    }));
    const starts: unknown[] = [];
    await page.route("**/api/pet/showdown", route => {
        starts.push(route.request().postDataJSON());
        return route.fulfill({ json: { state, petIds: ["kite"], character: save.character, _saveVersion: runtime.currentVersion() + 1 } });
    });
    await card.getByRole("button", { name: "Send out your pet" }).click();
    await expect(page.getByTestId("pet-showdown-root")).toContainText("Lone Black Cat", { timeout: 45_000 });
    await expect(page.getByRole("region", { name: "Battle commands" })).toBeVisible();
    expect(starts).toEqual([{ action: "wanderer", playerName: "AuditNinja", wanderer: { id: "w-72-83020-0", sector: 72 } }]);
});
