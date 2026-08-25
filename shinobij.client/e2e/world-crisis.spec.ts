import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { PUBLIC_CAPABILITY_IDS } from "../../shared/public-capabilities";

type SavePayload = {
    character?: Record<string, unknown>;
    [key: string]: unknown;
};

const CRISIS_ID = "fourfold-breach-v1";
const VILLAGES = [
    "Stormveil Village",
    "Ashen Leaf Village",
    "Frostfang Village",
    "Moonshadow Village",
] as const;

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

function activeCrisisProjection() {
    const villages = Object.fromEntries(VILLAGES.map((village, index) => [village, {
        village,
        defenses: 18 + index * 3,
        target: 100,
        lastDefendedAt: Date.now() - index * 8_000,
        completedAt: null,
        remaining: 82 - index * 3,
        progressPercent: 18 + index * 3,
        integrityPercent: 51 + index * 3,
        attackersActive: true,
    }]));
    return {
        schemaVersion: 1,
        crisisId: CRISIS_ID,
        runId: "e2e-fourfold-run",
        status: "active",
        phase: "first-signal",
        triggerLevel: 37,
        armedAt: Date.now() - 40_000,
        awakenedAt: Date.now() - 30_000,
        awakenedBy: "FirstSignal",
        awakenedVillage: "Stormveil Village",
        resolvedAt: null,
        targetPerVillage: 100,
        villages,
        awakeningAnnouncementId: 9101,
        resolutionAnnouncementId: null,
        revision: 9,
        updatedAt: Date.now(),
        totalDefenses: 90,
        totalTarget: 400,
        globalProgressPercent: 23,
        topDefenders: [
            { player: "FirstSignal", village: "Stormveil Village", wins: 7, lastAt: Date.now() - 4_000 },
        ],
    };
}

function activeReckoningProjection() {
    const villages = Object.fromEntries(VILLAGES.map((village, index) => [village, {
        village,
        defenses: 44 + index * 6,
        shinobiDefenses: 27 + index * 3,
        companionDefenses: 17 + index * 3,
        target: 180,
        lastDefendedAt: Date.now() - index * 7_000,
        completedAt: null,
        remaining: 136 - index * 6,
        progressPercent: 24 + index * 3,
        integrityPercent: 46 + index * 3,
        attackersActive: true,
    }]));
    return {
        schemaVersion: 1,
        crisisId: "hollow-gate-reckoning-v1",
        runId: "e2e-hollow-gate-reckoning-run",
        status: "active",
        phase: "collection-cells",
        triggerLevel: 80,
        armedAt: Date.now() - 50_000,
        awakenedAt: Date.now() - 40_000,
        awakenedBy: "FirstWitness",
        awakenedVillage: "Stormveil Village",
        resolvedAt: null,
        targetPerVillage: 180,
        villages,
        awakeningAnnouncementId: 9180,
        resolutionAnnouncementId: null,
        revision: 12,
        updatedAt: Date.now(),
        totalDefenses: 212,
        totalShinobiDefenses: 126,
        totalCompanionDefenses: 86,
        totalTarget: 720,
        globalProgressPercent: 29,
        topDefenders: [
            { player: "FirstWitness", village: "Stormveil Village", wins: 11, shinobiWins: 7, companionWins: 4, lastAt: Date.now() - 3_000 },
        ],
    };
}

async function installAuthenticatedApi(page: Page) {
    let save: SavePayload | null = null;
    let saveVersion = 0;
    let active = false;
    let active80 = false;
    let aiFightStart: Record<string, unknown> | null = null;
    let reckoningStart: Record<string, unknown> | null = null;

    await page.addInitScript(() => {
        localStorage.setItem("shinobix:storage-notice-ack", "1");
        localStorage.removeItem("worldCrisis.herald.seen");
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;

        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        if (path === "/api/player/capabilities") {
            return json(route, {
                ok: true,
                capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
                    id,
                    { state: "available", reason: "available" },
                ])),
            });
        }
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
                    character: { ...(incoming.character ?? {}), onboardingStep: "done" },
                };
                return json(route, { ok: true, _saveVersion: saveVersion });
            }
        }

        if (path === "/api/world-crisis") {
            return active
                ? json(route, { crisis: activeCrisisProjection() })
                : json(route, { crisis: { ...activeCrisisProjection(), status: "armed", awakenedBy: null } });
        }
        if (path === "/api/world-crisis-80") {
            return active80
                ? json(route, { crisis: activeReckoningProjection() })
                : json(route, { crisis: { ...activeReckoningProjection(), status: "armed", awakenedBy: null } });
        }
        if (path === "/api/announcements") {
            return json(route, {
                latestId: active80 ? 9180 : active ? 9101 : 0,
                announcements: active80 ? [{
                    id: 9180,
                    ts: Date.now() - 40_000,
                    type: "world_crisis_80_awakened",
                    importance: "mythic",
                    title: "The Hollow Gate Reckoning",
                    message: "FirstWitness reached level 80. Collection Cells and pursuit packs are moving toward every witness ledger.",
                    player: "FirstWitness",
                    village: "Stormveil Village",
                    meta: { crisisId: "hollow-gate-reckoning-v1" },
                }] : active ? [{
                    id: 9101,
                    ts: Date.now() - 30_000,
                    type: "world_crisis_awakened",
                    importance: "mythic",
                    title: "The Fourfold Breach",
                    message: "FirstSignal crossed level 37. Recall wardens are marching on all four village outskirts.",
                    player: "FirstSignal",
                    village: "Stormveil Village",
                    meta: { crisisId: CRISIS_ID },
                }] : [],
            });
        }
        if (path === "/api/missions/ai-fight-start" && request.method() === "POST") {
            const requestBody = request.postDataJSON() as Record<string, unknown>;
            if (!requestBody.worldEncounter) return json(route, { error: "No active fight." }, 404);
            aiFightStart = requestBody;
            return json(route, { error: "E2E stops after verifying the sealed combat request." }, 503);
        }
        if (path === "/api/world-crisis-80/combat-start" && request.method() === "POST") {
            reckoningStart = request.postDataJSON() as Record<string, unknown>;
            return json(route, { error: "E2E stops after verifying the sealed 1v3 request." }, 503);
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
        activate: () => { active = true; },
        activate80: () => { active80 = true; },
        hasSave: () => save !== null,
        aiFightStart: () => aiFightStart,
        reckoningStart: () => reckoningStart,
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

async function expectNoHorizontalOverflow(page: Page) {
    await expect.poll(() => page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("World News report calls every shinobi into the server-authoritative outskirts defense", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(!["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "desktop and phone certify the crisis journey");
    const runtimeFailures: string[] = [];
    page.on("pageerror", (error) => runtimeFailures.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeFailures.push(message.text());
    });

    const api = await installAuthenticatedApi(page);
    await createAccount(page);
    await expect.poll(api.hasSave).toBe(true);
    const skipIntro = page.getByRole("button", { name: /Skip/ });
    if (await skipIntro.isVisible()) await skipIntro.click();
    api.activate();

    await page.evaluate(() => sessionStorage.setItem("hall.initialTab", "news"));
    await page.goto("/#/hallOfLegends", { waitUntil: "networkidle" });
    // Hash-only navigation leaves the current onboarding overlay mounted; boot
    // is where saved deep links are restored and the server-owned save wins.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "World News", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "World News", exact: true }).click();
    await expect(page.getByRole("button", { name: "Watch The Fourfold Breach world news report" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Watch The Fourfold Breach world news report" }).click();
    await expect(page.getByRole("dialog", { name: "The Fourfold Breach world news report" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "A field record crossed the line" })).toBeVisible();
    await page.getByRole("button", { name: "Scene 4: Every shinobi is called" }).click();
    await expect(page.getByText("The event is open to everyone at the same time.")).toBeVisible();
    await page.getByRole("button", { name: "Defend your outskirts" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "The Fourfold Breach" })).toBeVisible();
    await expect(page.getByText("VILLAGE OBJECTIVE")).toBeVisible();
    await expect(page.getByRole("heading", { name: "The villages answer together" })).toBeVisible();
    await expect(page.getByText("Difficulty and contribution are sealed by the server.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
        path: testInfo.outputPath(`fourfold-breach-${testInfo.project.name}.png`),
        fullPage: true,
        animations: "disabled",
    });

    const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

    await page.getByRole("button", { name: "Intercept the recall warden" }).click();
    await expect.poll(api.aiFightStart).not.toBeNull();
    expect(api.aiFightStart()).toMatchObject({
        playerName: "AuditNinja",
        battleKind: "world",
        sector: 0,
        worldEncounter: {
            kind: "world-crisis",
            sector: 0,
        },
    });
    expect(runtimeFailures).toEqual([]);
});

test("Level-80 World News opens the global 1v3 and 3v3 Hollow Gate Reckoning", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(!["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "desktop and phone certify the level-80 reckoning journey");
    const runtimeFailures: string[] = [];
    page.on("pageerror", (error) => runtimeFailures.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeFailures.push(message.text());
    });

    const api = await installAuthenticatedApi(page);
    await createAccount(page);
    await expect.poll(api.hasSave).toBe(true);
    const skipIntro = page.getByRole("button", { name: /Skip/ });
    if (await skipIntro.isVisible()) await skipIntro.click();
    api.activate80();

    await page.evaluate(() => sessionStorage.setItem("hall.initialTab", "news"));
    await page.goto("/#/hallOfLegends", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "World News", exact: true }).click();
    await page.getByRole("button", { name: "Watch The Hollow Gate Reckoning world news report" }).click();
    await expect(page.getByRole("dialog", { name: "The Hollow Gate Reckoning world news report" })).toBeVisible();
    const cinematicArt = page.locator(".crisis-cinematic__reckoning-art");
    await expect(cinematicArt).toBeVisible();
    await expect.poll(() => cinematicArt.evaluate((image: HTMLImageElement) => image.naturalWidth > 1500)).toBe(true);
    await page.getByRole("button", { name: "Scene 2: Hollow Gate is not a creature" }).click();
    await expect(page.getByText("The Gate is the Court's civic lattice", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Scene 4: Every player can answer" }).click();
    await expect(page.getByText("Either server-verified victory advances your village's witness ledger.")).toBeVisible();
    await page.getByRole("button", { name: "Choose a defense front →" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "The Hollow Gate Reckoning" })).toBeVisible();
    await expect(page.getByText("ELITE SHINOBI OPERATION · 1 VS 3")).toBeVisible();
    await expect(page.getByText("COMPANION OPERATION · 3 VS 3")).toBeVisible();
    await expect(page.getByText("Both fronts share one village target.", { exact: false })).toBeVisible();
    await expect(page.locator(".reckoning__operation-art")).toHaveCount(2);
    await expect.poll(() => page.locator(".reckoning__operation-art").evaluateAll((images: HTMLImageElement[]) => images.every((image) => image.naturalWidth > 1500))).toBe(true);
    await expect.poll(() => page.locator(".reckoning__outskirts").evaluate((node) => getComputedStyle(node).backgroundImage.includes("reckoning-outskirts"))).toBe(true);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
        path: testInfo.outputPath(`hollow-gate-reckoning-${testInfo.project.name}.png`),
        fullPage: true,
        animations: "disabled",
    });

    if (testInfo.project.name === "chromium-desktop") {
        const ledgerHeading = page.getByRole("heading", { level: 2, name: "Every ledger must remain in village hands" });
        await ledgerHeading.scrollIntoViewIfNeeded();
        await expect(ledgerHeading).toBeVisible();
        await page.screenshot({
            path: testInfo.outputPath("hollow-gate-reckoning-chromium-desktop-ledgers.png"),
            fullPage: true,
            animations: "disabled",
        });
    }

    const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

    await page.getByRole("button", { name: "Deploy against all three" }).click();
    await expect.poll(api.reckoningStart).not.toBeNull();
    expect(api.reckoningStart()).toMatchObject({
        playerName: "AuditNinja",
        sourceId: "hollow-gate-reckoning-v1:stormveil:triad",
    });
    expect(api.reckoningStart()).not.toHaveProperty("enemies");
    expect(api.reckoningStart()).not.toHaveProperty("floor");
    expect(runtimeFailures).toEqual([]);
});
