import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import type { PublicCapabilities } from "../../shared/public-capabilities";

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const stats = {
    strength: 40, speed: 40, intelligence: 40, willpower: 40,
    bukijutsuOffense: 40, bukijutsuDefense: 40, taijutsuOffense: 40, taijutsuDefense: 40,
    genjutsuOffense: 40, genjutsuDefense: 40, ninjutsuOffense: 40, ninjutsuDefense: 40,
};

const baseCharacter = {
    name: "VisualNinja", village: "Ember", specialty: "Ninjutsu", bloodline: "None",
    level: 85, rankTitle: "Special Jonin", ryo: 1800, unspentStats: 0, stats,
    hp: 8900, maxHp: 8900, chakra: 9000, maxChakra: 9000, stamina: 9000, maxStamina: 9000,
    onboardingStep: "done", academyChecklistClaimed: true, inventory: [], itemStacks: [], equipment: {},
    pets: [], jutsuMastery: [{ jutsuId: "strike", level: 10 }], equippedJutsuIds: ["strike"],
    pendingCombatMissionClaims: [], storyProgress: 9, storyVillage: "Ember", storyTraits: [],
    examsPassed: ["genin", "chunin"], totalPvpKills: 25, totalStatsTrained: 600,
    totalMissionsCompleted: 80, totalAiKills: 80, totalTilesExplored: 120,
    lastLoginRewardDate: new Date().toISOString().slice(0, 10), profession: "healer", professionRank: 5,
};

type RuntimeSavePayload = {
    character: Record<string, unknown>;
    [key: string]: unknown;
};

type RuntimeSaveCommit = {
    baseVersion: number;
    version: number;
    postedState: string;
};

const allAvailable: PublicCapabilities = {
    gameplay: { state: "available", reason: "available" },
    gameplayMutations: { state: "available", reason: "available" },
    registrations: { state: "available", reason: "available" },
    villageWar: { state: "available", reason: "available" },
    anbuInfiltration: { state: "available", reason: "available" },
    clanBoss: { state: "available", reason: "available" },
    clanBossParties: { state: "available", reason: "available" },
    legacy: { state: "available", reason: "available" },
    petBreedingStarts: { state: "available", reason: "available" },
    weeklyBossGuardCycle: { state: "available", reason: "available" },
};

function spine(focus: string) {
    const requiredCapabilityIds = ["gameplay", "gameplayMutations"] as const;
    const selected = focus === "auto" ? "auto" : focus;
    const resolved = focus === "auto" ? "ranked-pvp" : focus;
    const focused = focus === "towers-spire"
        ? { id: "focus-towers-week", title: "Challenge Battle Tower floor 31", why: "Tower floors test squad construction and tactical consistency on your own schedule.", commitment: "15–30 min", progress: "Best floor 30 • Endless wave 42", screen: "battleTowers", cta: "Review Towers", eligibility: "eligible", context: "towers", requiredCapabilityIds }
        : focus === "companions"
            ? { id: "focus-companion-week", title: "Choose your first companion", why: "Care, expeditions, and arena practice build a companion identity separate from ordinary shinobi combat.", commitment: "10–20 min", progress: "No companion active", screen: "pets", cta: "Visit Pet Yard", eligibility: "eligible", blocker: "Choose a companion at the Pet Yard first.", context: "companions", requiredCapabilityIds }
            : { id: "focus-ranked-week", title: "Play a focused Ranked PvP set", why: "A short set turns ordinary PvP execution into season standing and a durable competitive record.", commitment: "10–20 min", progress: "1320 rating • 25 ranked wins", screen: "battleArena", cta: "Open Ranked PvP", eligibility: "eligible", context: "pvp", requiredCapabilityIds };
    const long = focus === "towers-spire"
        ? { ...focused, id: "focus-towers-long", title: "Climb toward Spire tier 7", commitment: "Multi-session", progress: "Highest Spire tier 6", cta: "Open Towers and Spire" }
        : focus === "companions"
            ? { ...focused, id: "focus-companion-long", title: "Grow your companion arena record", commitment: "Multi-session", screen: "petLadder", cta: "Review Pet Ladder", eligibility: "blocked", runtimeModeId: "pet-ladder-showdown" }
        : { ...focused, id: "focus-special-jonin-prestige", title: "Pursue the Special Jonin distinction", why: "This optional ceremony recognizes prestige; it does not block leveling, stats, jutsu, or content.", commitment: "Multi-session", progress: "25/100 PvP kills", screen: "logbook", cta: "Review Optional Prestige" };
    const routine = { id: "routine", title: "Run a level-appropriate mission", why: "A short mission advances your current build.", commitment: "5–10 min", screen: "missions", cta: "Open Missions", eligibility: "eligible", context: "progression", requiredCapabilityIds };
    return { generatedAt: Date.now(), returningPlayer: false, selectedFocus: selected, resolvedFocus: resolved, horizons: { now: [{ ...routine, id: "now", horizon: "now" }], today: [{ ...routine, id: "today", horizon: "today" }], "this-week": [{ ...focused, horizon: "this-week" }], "long-term": [{ ...long, horizon: "long-term" }] } };
}

async function installRuntime(page: Page) {
    let save: RuntimeSavePayload = {
        character: { ...baseCharacter },
        currentBiome: "central",
        currentSector: 40,
        acceptedMissionIds: [],
        missionProgress: {},
        triggeredEvents: ["builtin-aura-sphere-lv9"],
    };
    let capabilities: PublicCapabilities = structuredClone(allAvailable);
    let capabilityRequestCount = 0;
    let sectorCampaignRequestCount = 0;
    let saveVersion = 1;
    let acknowledgedVersion = 0;
    let lastCommit: RuntimeSaveCommit | null = null;
    await page.addInitScript(() => {
        localStorage.setItem("ninjav-admin-build-v1", JSON.stringify({ currentAccountName: "VisualNinja" }));
        localStorage.setItem("ninjav-player-accounts-v1", JSON.stringify({ visualninja: { token: "visual-session-token" } }));
        localStorage.setItem("shinobix:activePlayerPersist", "VisualNinja");
        localStorage.setItem("shinobix:activeTokenPersist", "visual-session-token");
        localStorage.setItem("shinobix:storage-notice-ack", "1");
        localStorage.setItem("patchNotes.lastSeenVersion.v1", "2026.07.28-stat-leveling");
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem("e2e:showBriefing") === "1") localStorage.removeItem("dailyBriefing.seen.v1");
        else localStorage.setItem("dailyBriefing.seen.v1", today);
    });
    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname.toLowerCase();
        if (path === "/api/save/visualninja") {
            if (request.method() === "GET") return json(route, { ...save, _saveVersion: saveVersion });
            const incoming = request.postDataJSON() as RuntimeSavePayload;
            const rawBaseVersion = incoming._baseSaveVersion;
            if (!Number.isSafeInteger(rawBaseVersion) || Number(rawBaseVersion) < 0) {
                return json(route, {
                    error: "Your game client is out of date. Please refresh the page to keep saving.",
                    code: "CLIENT_REFRESH_REQUIRED",
                }, 426);
            }
            const baseVersion = Number(rawBaseVersion);
            if (baseVersion !== saveVersion) {
                return json(route, {
                    error: "Save conflict — another tab or device wrote first.",
                    currentVersion: saveVersion,
                }, 409);
            }
            const persisted = { ...incoming };
            delete persisted._baseSaveVersion;
            delete persisted._saveVersion;
            delete persisted._saveAt;
            if (!persisted.character || typeof persisted.character !== "object") {
                return json(route, { error: "A valid character is required." }, 400);
            }
            const postedState = JSON.stringify(persisted);
            const nextVersion = saveVersion + 1;
            save = JSON.parse(postedState) as RuntimeSavePayload;
            saveVersion = nextVersion;
            lastCommit = {
                baseVersion,
                version: nextVersion,
                postedState,
            };
            await json(route, { ok: true, _saveVersion: nextVersion });
            acknowledgedVersion = nextVersion;
            return;
        }
        if (path === "/api/player/capabilities") {
            capabilityRequestCount += 1;
            return json(route, { ok: true, capabilities });
        }
        if (["/api/village/war-map", "/api/village/sector-war", "/api/village/sector-pet", "/api/sector/merc-roam"].includes(path)) {
            sectorCampaignRequestCount += 1;
        }
        if (path === "/api/player/activity-spine") return json(route, { ok: true, spine: spine(url.searchParams.get("focus") ?? "auto") });
        if (path === "/api/player-auth") return json(route, { ok: true, token: "visual-session-token" });
        if (path === "/api/player/daily-login") return json(route, { ok: true, alreadyClaimed: true, granted: { ryo: 0, fateShards: 0 }, balances: { ryo: 1800, fateShards: 0 }, streak: 2, daysUntilShardBonus: 5 });
        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        if (path === "/api/battle-lock") return json(route, { lock: null });
        if (path === "/api/weekly-boss") return json(route, { boss: null, fightEnabled: true });
        if (path === "/api/ranked-season") return json(route, { current: null, lastSeason: null });
        if (path === "/api/legacy/status") return json(route, { enabled: true });
        if (path === "/api/towers/floors") return json(route, { floors: [] });
        return json(route, { ok: true, images: {}, categories: {}, players: [], leaderboard: [], announcements: [], entries: [], eras: [], wars: [], territories: [], standings: [], villageStates: {}, arenaActiveFights: [] });
    });
    return {
        setCharacter: (next: Record<string, unknown>) => {
            saveVersion += 1;
            save = { ...save, character: { ...baseCharacter, ...next } };
        },
        disableVillageWar: () => { capabilities = { ...allAvailable, villageWar: { state: "temporarily-unavailable", reason: "temporarily-disabled" } }; },
        capabilityRequests: () => capabilityRequestCount,
        sectorCampaignRequests: () => sectorCampaignRequestCount,
        committedVersion: () => saveVersion,
        acknowledgedVersion: () => acknowledgedVersion,
        lastCommit: () => lastCommit,
        persistedStateMatchesLastPost: () => Boolean(lastCommit && JSON.stringify(save) === lastCommit.postedState),
    };
}

type RuntimeFixture = Awaited<ReturnType<typeof installRuntime>>;

async function expectRuntimeSaveCommitted(page: Page, runtime: RuntimeFixture) {
    await expect.poll(() => {
        const commit = runtime.lastCommit();
        return Boolean(
            commit
            && runtime.persistedStateMatchesLastPost()
            && commit.baseVersion === commit.version - 1
            && runtime.committedVersion() === commit.version
            && runtime.acknowledgedVersion() === commit.version,
        );
    }, {
        timeout: 20_000,
        message: "the visual fixture must persist and acknowledge the exact posted save before reload",
    }).toBe(true);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("complementary", { name: "Device and server saves diverged" })).toHaveCount(0);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(name), fullPage: false });
}

async function loadScreen(page: Page, hash: string) {
    await page.goto(`/?visual-screen=${encodeURIComponent(hash)}#/${hash}`, { waitUntil: "networkidle" });
}

test("product truth and player focus visual matrix", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "single Chromium visual evidence run");
    const runtime = await installRuntime(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loadScreen(page, "centralHub");
    await expectRuntimeSaveCommitted(page, runtime);
    await expect(page.locator(".right-menu-panel.open")).toBeVisible();
    await capture(page, testInfo, "01-desktop-menu-expanded-1440x900.png");
    await page.getByRole("button", { name: "Hide Menu" }).click();
    await expect(page.locator(".right-menu-panel.closed")).toBeVisible();
    await capture(page, testInfo, "02-desktop-menu-collapsed-1440x900.png");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
    await capture(page, testInfo, "03-desktop-menu-150-percent.png");
    await page.evaluate(() => { document.documentElement.style.zoom = ""; });

    for (const [width, height, name] of [[390, 844, "04-mobile-menu-390x844.png"], [430, 932, "05-mobile-menu-430x932.png"], [768, 1024, "06-tablet-menu-768x1024.png"]] as const) {
        await page.setViewportSize({ width, height });
        await page.reload({ waitUntil: "networkidle" });
        await page.locator(".mobile-nav-btn.menu-btn").click();
        await expect(page.getByRole("dialog", { name: "Shinobi menu" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const accessibility = await new AxeBuilder({ page }).include(".mobile-menu-overlay").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
        await capture(page, testInfo, name);
        if (width === 390) {
            await page.getByRole("heading", { name: "System" }).scrollIntoViewIfNeeded();
            await expect.poll(() => page.locator(".mobile-menu-overlay").evaluate((element) => element.scrollTop > 0)).toBe(true);
            await page.getByRole("button", { name: "Close menu" }).click();
            await expect(page.locator(".mobile-bottom-nav").getByRole("button", { name: "Menu", exact: true })).toBeFocused();
            await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Menu", exact: true }).click();
            await page.getByRole("dialog", { name: "Shinobi menu" }).getByRole("button", { name: "Logbook" }).click();
            await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "logbook");
        } else {
            await page.getByRole("button", { name: "Close menu" }).click();
        }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => localStorage.setItem("e2e:showBriefing", "1"));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("dialog", { name: "Daily Briefing" })).toBeVisible();
    await expect(page.getByLabel("Mastery focus")).toHaveValue("auto");
    await capture(page, testInfo, "07-activity-spine-auto.png");
    await page.getByLabel("Mastery focus").selectOption("towers-spire");
    await expect(page.getByText("Challenge Battle Tower floor 31")).toBeVisible();
    await capture(page, testInfo, "08-activity-spine-endgame-focus.png");
    await page.getByLabel("Mastery focus").selectOption("companions");
    await expect(page.getByText(/Choose a companion at the Pet Yard first/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Visit Pet Yard" }).first()).toBeEnabled();
    await page.getByRole("button", { name: "Close briefing" }).click();

    await page.evaluate(() => { localStorage.removeItem("e2e:showBriefing"); });
    runtime.setCharacter({ level: 80, rankTitle: "Special Jonin", examsPassed: ["genin", "chunin"], totalPvpKills: 25 });
    await loadScreen(page, "logbook");
    await expect(page.getByRole("heading", { name: "Prestige Milestones" })).toBeVisible();
    await expect(page.getByText("Optional Prestige").first()).toBeVisible();
    await expect(page.getByText(/does not block leveling, stats, jutsu, or content/i).first()).toBeVisible();
    const specialJoninPrestige = page.getByRole("heading", { name: /Special Jonin Distinction Optional Prestige/ });
    await expect(specialJoninPrestige).toBeVisible();
    await specialJoninPrestige.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await capture(page, testInfo, "09-level-80-logbook-optional-prestige.png");

    runtime.setCharacter({ level: 20, rankTitle: "Genin", examsPassed: [], totalPvpKills: 0, elements: [], element: "" });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(/cannot level past 20 until you pass this exam/i)).toBeVisible();
    await capture(page, testInfo, "10-genin-real-progression-hold.png");

    runtime.setCharacter({ level: 85, rankTitle: "Special Jonin", examsPassed: ["genin", "chunin"] });
    await page.evaluate(() => localStorage.setItem("rankUp.celebrated.v1", "4"));
    await loadScreen(page, "centralHub");
    await page.getByRole("button", { name: /Celestial Tower Endless PvE climb/ }).click();
    await page.getByRole("button", { name: /Battle Towers Curated squad floors/ }).click();
    await expect(page.locator("h1", { hasText: "Battle Towers" })).toBeVisible();
    await expect(page.getByLabel("Live service status")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/desktop-first|soft-launch|staffed beta/i);
    await capture(page, testInfo, "11-live-towers-no-stale-warning.png");

    await loadScreen(page, "townHall");
    const warActions = page.locator(".town-war-actions");
    await expect(warActions.getByRole("button", { name: "War Hall" })).toBeEnabled();
    await expect(warActions.getByRole("button", { name: "Sector Map" })).toBeEnabled();
    const capabilityRequestsBeforeDisable = runtime.capabilityRequests();
    runtime.disableVillageWar();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(runtime.capabilityRequests).toBeGreaterThan(capabilityRequestsBeforeDisable);
    await expect(warActions.getByRole("button", { name: "Sector Map" })).toBeDisabled();
    await expect(page.getByText("Sector campaign operations are temporarily unavailable. The legacy War Hall remains open.")).toBeVisible();
    await capture(page, testInfo, "12-disabled-capability-truthful-status.png");

    const sectorRequestsBeforeRestore = runtime.sectorCampaignRequests();
    await loadScreen(page, "villageWarMap");
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "worldMap");
    await page.waitForTimeout(500);
    expect(runtime.sectorCampaignRequests()).toBe(sectorRequestsBeforeRestore);
});
