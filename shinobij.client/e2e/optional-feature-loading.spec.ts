import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { STARTER_PETS } from "../src/data/starter-pets";
import { ASCENSION_STONE_ID, AWAKENING_STONE_ID, evolvePet, evolutionLineFor } from "../src/data/pet-evolutions";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

const manifest = JSON.parse(readFileSync(new URL("../dist/.vite/manifest.json", import.meta.url), "utf8")) as Record<string, { file: string; css?: string[] }>;
const evolutionChunk = `/${manifest["src/components/PetEvolutionCutscene.tsx"].file}`;
const bindingChunk = `/${manifest["src/components/WildPetBinding.tsx"].file}`;
const crisisChunk = `/${manifest["src/screens/WorldCrisis80.tsx"].file}`;
const crisisCss = `/${manifest["src/screens/WorldCrisis80.tsx"].css!.find(asset => readFileSync(new URL(`../dist/${asset}`, import.meta.url), "utf8").includes(".reckoning{"))!}`;
const starter = { ...STARTER_PETS[0].pet, level: 90, evolutionStage: 0 as const, unlockedForPve: true, happiness: 100 };

function petSave() {
    const save = uiAuditSave();
    save.character = { ...save.character, unspentStats: 0, statPoints: 0, pets: [starter], activePetId: starter.id, inventory: [AWAKENING_STONE_ID, ASCENSION_STONE_ID] };
    return save;
}

function countRequests(page: Page, pathname: string) {
    let count = 0;
    page.on("request", r => { if (new URL(r.url()).pathname === pathname) count++; });
    return () => count;
}

async function openGrowth(page: Page) {
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: /Growth & training/ }).click();
    await expect(page.getByRole("heading", { name: "Growth & training" })).toBeVisible();
}

async function confirmEvolution(page: Page) {
    const hideMenu = page.getByRole("button", { name: /^Hide menu$/i });
    if (await hideMenu.isVisible()) await hideMenu.click();
    await page.getByRole("button", { name: /Evolve into/ }).click();
    await page.getByRole("alertdialog", { name: "Confirm", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
}

test("Pet Yard care defers evolution code and reuses its growth warm-up", async ({ page }, info) => {
    const requests = countRequests(page, evolutionChunk);
    const runtime = await installUiAuditRuntime(page, petSave());
    await expectUiAuditBoot(page, runtime, "pets");
    await expect(page.locator(".pet-yard-refined")).toBeVisible();
    expect(requests()).toBe(0);
    await page.screenshot({ path: info.outputPath("care-cold.png"), fullPage: true });
    await openGrowth(page);
    await expect.poll(requests).toBe(1);
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Care", exact: true }).click();
    await openGrowth(page);
    expect(requests()).toBe(1);
    await page.screenshot({ path: info.outputPath("growth-warm.png"), fullPage: true });
});

test("slow evolution loading precedes the stone request and preserves repeated reveals", async ({ page }, info) => {
    test.setTimeout(120_000);
    test.skip(!["chromium-desktop", "chromium-mobile", "webkit-mobile"].includes(info.project.name), "desktop and phone presentation paths");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const save = petSave();
    const runtime = await installUiAuditRuntime(page, save);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(url => url.pathname === evolutionChunk, async route => { await gate; await route.continue(); });
    let evolutionRequests = 0;
    let pet = starter;
    await page.route("**/api/pet/evolve", async route => {
        evolutionRequests++;
        const next = evolvePet(pet, evolutionRequests === 1 ? 1 : 2, evolutionLineFor(starter.id)!);
        pet = next as typeof starter;
        const inventory = evolutionRequests === 1 ? [ASCENSION_STONE_ID] : [];
        save.character = { ...save.character, pets: [next], inventory };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(save.character, version);
        await route.fulfill({ json: { pet: next, _saveVersion: version } });
    });
    try {
        await expectUiAuditBoot(page, runtime, "pets");
        await openGrowth(page);
        await confirmEvolution(page);
        await expect(page.getByRole("button", { name: "Evolving…", exact: true })).toBeDisabled();
        expect(evolutionRequests).toBe(0);
        await page.screenshot({ path: info.outputPath("evolution-waiting.png"), fullPage: true });
        // Cross the first import timeout: the shared in-flight download can
        // still succeed on a later attempt without duplicating the mutation.
        await page.waitForTimeout(13_000);
        expect(evolutionRequests).toBe(0);
        release();
        for (let iteration = 1; iteration <= 2; iteration++) {
            const cutscene = page.locator(".pet-evo-cutscene");
            await expect(cutscene).toBeVisible();
            await expect(cutscene.getByRole("button", { name: /Skip/ })).toBeVisible();
            expect(evolutionRequests).toBe(iteration);
            const skip = cutscene.getByRole("button", { name: /Skip/ });
            if (info.project.use.hasTouch) await skip.tap();
            else await skip.click();
            await page.screenshot({ path: info.outputPath(`evolution-${iteration}.png`) });
            await cutscene.getByRole("button", { name: "Continue", exact: true }).click();
            await expect(cutscene).toHaveCount(0);
            await expect(page.getByRole("heading", { name: "Growth & training" })).toBeVisible();
            if (iteration === 1) await confirmEvolution(page);
        }
    } finally { release(); }
});

test("a failed evolution warm-up keeps the stone and leaves care usable", async ({ page }, info) => {
    test.setTimeout(90_000);
    const save = petSave();
    const runtime = await installUiAuditRuntime(page, save);
    let writes = 0;
    await page.route("**/api/pet/evolve", route => { writes++; return route.fulfill({ status: 500, json: { error: "Must not be requested" } }); });
    await page.route(url => url.pathname === evolutionChunk, route => route.abort("failed"));
    await expectUiAuditBoot(page, runtime, "pets");
    await openGrowth(page);
    await confirmEvolution(page);
    await expect(page.getByText(/Evolution presentation could not load/)).toBeVisible({ timeout: 30_000 });
    expect(writes).toBe(0);
    expect(save.character!.inventory).toContain(AWAKENING_STONE_ID);
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Care", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Care & companionship" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("care-after-failed-evolution.png"), fullPage: true });
});

test("Crisis retains the current view during a slow tab load and reuses the module", async ({ page }, info) => {
    test.setTimeout(90_000);
    const requests = countRequests(page, crisisChunk);
    const runtime = await installUiAuditRuntime(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(url => url.pathname === crisisChunk, async route => { await gate; await route.continue(); });
    try {
        await expectUiAuditBoot(page, runtime, "worldCrisis");
        await expect(page.getByRole("heading", { level: 1, name: "The Fourfold Breach" })).toBeVisible();
        expect(requests()).toBe(0);
        const tabs = page.locator(".crisis-chronicle-tabs");
        await expect(tabs).toHaveCSS("display", "flex");
        await expect(tabs).toHaveCSS("flex-direction", page.viewportSize()!.width <= 620 ? "column" : "row");
        await expect(tabs.getByRole("button", { name: /Level 37/ })).toHaveCSS("color", "rgb(255, 241, 189)");
        await page.getByRole("button", { name: /Level 80/ }).click();
        await expect(page.getByRole("button", { name: /Level 80/ })).toHaveAttribute("aria-busy", "true");
        await expect(page.getByRole("heading", { level: 1, name: "The Fourfold Breach" })).toBeVisible();
        await page.screenshot({ path: info.outputPath("crisis-slow-tab.png"), fullPage: true });
        release();
        await expect(page.getByRole("heading", { level: 1, name: "The Hollow Gate Reckoning" })).toBeVisible();
        await page.getByRole("button", { name: /Level 37/ }).click();
        await page.getByRole("button", { name: /Level 80/ }).click();
        await expect(page.getByRole("heading", { level: 1, name: "The Hollow Gate Reckoning" })).toBeVisible();
        expect(requests()).toBe(1);
        await page.screenshot({ path: info.outputPath("crisis-warm-tab.png"), fullPage: true });
    } finally { release(); }
});

test("failed Crisis stylesheet warm-up recovers before an unstyled tab can appear", async ({ page }, info) => {
    test.setTimeout(90_000);
    let documents = 0;
    let failCss = true;
    page.on("request", r => { if (r.isNavigationRequest() && r.resourceType() === "document") documents++; });
    const runtime = await installUiAuditRuntime(page);
    await page.route(url => url.pathname === crisisCss, route => failCss ? route.abort("failed") : route.continue());
    await expectUiAuditBoot(page, runtime, "worldCrisis");
    await page.getByRole("button", { name: /Level 80/ }).click();
    await expect.poll(() => documents, { timeout: 30_000 }).toBe(2);
    await expect(page.getByRole("heading", { level: 1, name: "The Fourfold Breach" })).toBeVisible();
    await expect(page.locator(".reckoning")).toHaveCount(0);
    failCss = false;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Level 80/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "The Hollow Gate Reckoning" })).toBeVisible();
    expect(await page.locator(".reckoning__outskirts").evaluate(n => getComputedStyle(n).backgroundImage)).toContain("reckoning-outskirts");
    await page.screenshot({ path: info.outputPath("crisis-after-css-recovery.png"), fullPage: true });
});

test("a cold World Map leaves wild battle code deferred", async ({ page }, info) => {
    const requests = countRequests(page, bindingChunk);
    const save = { ...uiAuditSave(), currentSector: 40 };
    const runtime = await installUiAuditRuntime(page, save);
    await expectUiAuditBoot(page, runtime, "worldMap");
    await expect(page.locator(".generated-world-map")).toBeVisible();
    expect(requests()).toBe(0);
    await page.screenshot({ path: info.outputPath("world-map-cold.png"), fullPage: true });
});

test("leaving Pet Yard during pending evolution loading cancels the stone request", async ({ page }, info) => {
    test.skip(!["chromium-desktop", "chromium-mobile", "webkit-mobile"].includes(info.project.name));
    const runtime = await installUiAuditRuntime(page, petSave());
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let writes = 0;
    await page.route(url => url.pathname === evolutionChunk, async route => {
        await gate;
        const response = await route.fetch();
        await route.fulfill({ response, body: `${await response.text()}\n;globalThis.__loadingEvolutionEvaluated = true;` });
    });
    await page.route("**/api/pet/evolve", route => { writes++; return route.fulfill({ status: 500, json: { error: "Must not be requested" } }); });
    try {
        await expectUiAuditBoot(page, runtime, "pets");
        await openGrowth(page);
        await confirmEvolution(page);
        await page.getByRole("button", { name: "Back to Village", exact: true }).click();
        await expect(page.locator('.app-shell[data-screen="village"]')).toBeVisible();
        release();
        await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __loadingEvolutionEvaluated?: boolean }).__loadingEvolutionEvaluated)).toBe(true);
        await expect(page.locator('.app-shell[data-screen="village"]')).toBeVisible();
        expect(writes).toBe(0);
    } finally { release(); }
});

test("a direct cold Level 80 focus loads the styled chronicle", async ({ page }, info) => {
    const requests = countRequests(page, crisisChunk);
    const runtime = await installUiAuditRuntime(page);
    await page.addInitScript(() => sessionStorage.setItem("worldCrisis.focus", "80"));
    await expectUiAuditBoot(page, runtime, "worldCrisis");
    await expect(page.getByRole("heading", { level: 1, name: "The Hollow Gate Reckoning" })).toBeVisible();
    await expect(page.locator(".crisis-chronicle-tabs")).toHaveCSS("display", "flex");
    expect(requests()).toBe(1);
    await page.screenshot({ path: info.outputPath("crisis-cold-80.png"), fullPage: true });
});

test("a real map encounter warms binding during its story and returns after battle", async ({ page }, info) => {
    test.setTimeout(150_000);
    test.skip(!["chromium-desktop", "chromium-mobile", "webkit-mobile"].includes(info.project.name));
    const requests = countRequests(page, bindingChunk);
    const save = { ...petSave(), currentSector: 40 };
    const runtime = await installUiAuditRuntime(page, save);
    const wildPet = { ...STARTER_PETS[1].pet, id: "standard-1-17500000", name: "Moonfang", trait: "Loyal" };
    let requestId = "";
    let battleStarts = 0;
    let forfeits = 0;
    const versioned = () => {
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(save.character, version);
        return { character: save.character, _saveVersion: version };
    };
    await page.route("**/api/dungeon/run", async route => {
        requestId = route.request().postDataJSON().requestId;
        await route.fulfill({ json: { ok: true, found: false, token: "", requestId, sector: 40, resolved: false, ...versioned() } });
    });
    await page.route("**/api/pet/encounter-start", route => route.fulfill({ json: { ok: true, requestId, sector: 40, pet: wildPet, token: "wildbindingqatoken001", replayed: false } }));
    await page.route("**/api/world/explore", route => route.fulfill({ json: { ok: true, outcome: { kind: "external", source: "pet" }, reward: { sector: 40, xp: 0, ryo: 0 }, fieldProgress: [], ...versioned() } }));
    const fighter = (id: string, name: string, templateId: string) => ({
        id, name, templateId, element: "Fire", role: "tracker", rarity: "standard", level: 1,
        hp: 365, maxHp: 365, stamina: 80, maxStamina: 80, meter: 0, ko: false, guarding: false, benched: false,
        speed: 30, skipsNextAction: false, canSwitchOut: true, statuses: [], readiness: 0,
        moves: [{ name: "Swift Strike", power: 45, kind: "damage", cost: 12, signature: false, effect: "A swift basic strike", priority: 1, hold: 0, element: "None", cls: "physical" }],
    });
    await page.route("**/api/pet/wild-binding", async route => {
        const action = route.request().postDataJSON().action;
        if (action === "start") battleStarts++;
        if (action === "forfeit") forfeits++;
        await route.fulfill({ json: {
            ok: true, state: { sessionId: "wildbindingqatoken001", format: "1v1", tier: "scrapper", round: 0, attritionAt: 12, turnCap: 20, finished: false, outcome: null,
                player: [fighter(starter.id, starter.name, "standard-0")], enemy: [fighter(wildPet.id, wildPet.name, "standard-1")], enemyTeamName: "Moonfang" },
            wild: { name: "Moonfang", rarity: "standard", hpPercent: 100, resolvePercent: 35, trait: "Loyal", tutorial: false, seals: [] },
        } });
    });
    await expectUiAuditBoot(page, runtime, "worldMap");
    expect(requests()).toBe(0);
    await page.getByRole("button", { name: /Return to Sector 40/ }).click();
    await page.keyboard.press("e");
    const story = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Skip", exact: true }) });
    await expect(story).toBeVisible();
    await expect.poll(requests).toBe(1);
    expect(battleStarts).toBe(0);
    await page.screenshot({ path: info.outputPath("wild-encounter-story.png"), fullPage: true });
    await story.getByRole("button", { name: "Skip", exact: true }).click();
    await page.getByRole("button", { name: "Face the wild pet", exact: true }).click();
    await expect(page.getByTestId("pet-showdown-root")).toBeVisible();
    expect(battleStarts).toBe(1);
    await page.screenshot({ path: info.outputPath("wild-encounter-battle.png") });
    await page.getByRole("button", { name: "Forfeit the battle", exact: true }).click();
    await page.getByRole("button", { name: "Yes, concede", exact: true }).click();
    await expect(page.locator(".sector-stage-panel")).toBeVisible();
    expect(forfeits).toBe(1);
    expect(requests()).toBe(1);
});
