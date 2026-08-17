import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
    PUBLIC_CAPABILITY_IDS,
    type PublicCapabilities,
    type PublicCapabilityId,
} from "../../shared/public-capabilities";
import {
    expectFinalActionableClearsFixedNavigation,
    expectNoLargeOverlap,
    expectViewportSafe,
} from "./helpers/adaptive-assertions";

type SavePayload = {
    character?: Record<string, unknown>;
    [key: string]: unknown;
};

type SaveFixtureCommit = {
    baseVersion: number;
    version: number;
    postedState: string;
};

function publicCapabilitiesExcept(...unavailableIds: PublicCapabilityId[]): PublicCapabilities {
    const unavailable = new Set(unavailableIds);
    return Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
        id,
        unavailable.has(id)
            ? { state: "temporarily-unavailable", reason: "temporarily-disabled" }
            : { state: "available", reason: "available" },
    ])) as PublicCapabilities;
}

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installAuthenticatedApi(page: Page, initialSave: SavePayload | null = null) {
    let save: SavePayload | null = initialSave ? structuredClone(initialSave) : null;
    let saveVersion = save ? 1 : 0;
    let acknowledgedVersion = 0;
    let lastCommit: SaveFixtureCommit | null = null;
    let battleHistoryFailure = false;
    let battleHistoryRequests = 0;
    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        // Live-capability admission fails CLOSED by design: any state other than
        // "available" — including the "unknown" you get when this call never
        // resolves — holds the player surface behind the "Checking live service
        // availability" blocker, so the shell never leaves screen "start".
        // Without this stub every test using this fixture measures that blocker
        // instead of the layout it means to assert. The sibling authenticated
        // specs, and this file's own selected-sector fixture, stub it for the
        // same reason.
        if (path === "/api/player/capabilities") {
            return json(route, { ok: true, capabilities: publicCapabilitiesExcept() });
        }
        if (path === "/api/player-auth") return json(route, { ok: true, token: "adaptive-e2e-token" });
        const requestedSavePlayer = path.toLowerCase().startsWith("/api/save/")
            ? decodeURIComponent(path.slice("/api/save/".length)).toLowerCase()
            : null;
        if (requestedSavePlayer?.startsWith("adaptiveninja")) {
            if (request.method() === "GET") {
                if (!save) return json(route, { error: "Not found" }, 404);
                return json(route, { ...save, _saveVersion: saveVersion });
            }
            if (request.method() === "POST") {
                const incoming = request.postDataJSON() as SavePayload;
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

                const persistedIncoming = { ...incoming };
                delete persistedIncoming._baseSaveVersion;
                delete persistedIncoming._saveVersion;
                delete persistedIncoming._saveAt;
                const postedState = JSON.stringify(persistedIncoming);
                const nextSave = JSON.parse(postedState) as SavePayload;

                const nextVersion = saveVersion + 1;
                save = nextSave;
                saveVersion = nextVersion;
                lastCommit = { baseVersion, version: nextVersion, postedState };
                await json(route, { ok: true, _saveVersion: nextVersion });
                acknowledgedVersion = nextVersion;
                return;
            }
        }
        if (path === "/api/battle-lock") return json(route, { lock: null });
        if (path === "/api/player/travel") return json(route, { arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 });
        if (path === "/api/world-state") return json(route, { territories: [], wars: [], standings: [] });
        if (path === "/api/clan/war/list") return json(route, { wars: [] });
        if (path === "/api/game-state") return json(route, { villageStates: {}, arenaActiveFights: [] });
        if (path === "/api/weekly-boss") return json(route, { boss: null, fightEnabled: true });
        if (path === "/api/ranked-season") return json(route, { current: null, lastSeason: null });
        if (path === "/api/pvp/combat-history") {
            battleHistoryRequests += 1;
            return battleHistoryFailure
                ? json(route, { error: "Adaptive fixture failure" }, 500)
                : json(route, { entries: [] });
        }
        if (path.startsWith("/api/legacy/")) return json(route, { error: "Legacy unavailable in adaptive fixtures" }, 404);
        if (path === "/api/towers/floors") return json(route, { floors: [] });
        if (path === "/api/card-clash/ai-start") {
            return json(route, {
                ok: true,
                matchId: "adaptive-chronicle",
                session: {
                    rulesVersion: 10,
                    turnNumber: 1,
                    firstPlayer: "p1",
                    activePlayer: "p1",
                    phase: "main1",
                    normalSummonUsed: false,
                    status: "active",
                    winner: null,
                    viewerSide: "p1",
                    activeField: null,
                    responseWindow: null,
                    p1: {
                        name: "AdaptiveNinja",
                        lifePoints: 8_000,
                        deckCount: 34,
                        handCount: 6,
                        hand: ["tc-01", "tc-02", "tc-02", "tc-03", "tc-04", "tc-05"],
                        monsterZones: [null, null, null, null, null],
                        magicTrapZones: [null, null, null, null, null],
                        graveyard: [],
                    },
                    p2: {
                        name: "Chronicle Keeper",
                        lifePoints: 8_000,
                        deckCount: 35,
                        handCount: 5,
                        monsterZones: [null, null, null, null, null],
                        magicTrapZones: [null, null, null, null, null],
                        graveyard: [],
                    },
                    log: [
                        "AdaptiveNinja and Chronicle Keeper draw five cards.",
                        "AdaptiveNinja takes the first turn and enters Main Phase 1.",
                    ],
                    events: [],
                    turnStartedAt: Date.now(),
                    matchId: "adaptive-chronicle",
                    aiDifficulty: "medium",
                    aiDeckName: "Founding Codex",
                },
            });
        }
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
        committedVersion: () => saveVersion,
        acknowledgedVersion: () => acknowledgedVersion,
        lastCommit: () => lastCommit,
        persistedStateMatchesLastPost: () => Boolean(lastCommit && save && JSON.stringify(save) === lastCommit.postedState),
        seedSaveBeforeBoot: (initial: SavePayload) => {
            if (save || lastCommit) throw new Error("The adaptive save must be seeded before authenticated boot");
            save = structuredClone(initial);
            saveVersion = 1;
        },
        patchSave: (patch: SavePayload) => {
            if (!save) throw new Error("Cannot patch the adaptive fixture before it has a save");
            saveVersion += 1;
            save = { ...save, ...patch };
        },
        patchCharacter: (patch: Record<string, unknown>) => {
            if (!save) throw new Error("Cannot patch character before the adaptive fixture has a save");
            saveVersion += 1;
            save = {
                ...save,
                character: { ...(save.character ?? {}), ...patch },
            };
        },
        readCharacter: () => {
            if (!save?.character) throw new Error("Cannot read character before the adaptive fixture has a save");
            return structuredClone(save.character);
        },
        commitCharacterPatch: (patch: Record<string, unknown>) => {
            if (!save) throw new Error("Cannot commit character before the adaptive fixture has a save");
            const character = { ...(save.character ?? {}), ...structuredClone(patch) };
            saveVersion += 1;
            save = { ...save, character };
            return { character: structuredClone(character), _saveVersion: saveVersion };
        },
        setBattleHistoryFailure: (value: boolean) => { battleHistoryFailure = value; },
        battleHistoryRequests: () => battleHistoryRequests,
    };
}

type AuthenticatedApiFixture = Awaited<ReturnType<typeof installAuthenticatedApi>>;

async function expectCommittedSave(page: Page, api: AuthenticatedApiFixture) {
    await expect.poll(() => {
        const commit = api.lastCommit();
        return Boolean(
            commit
            && api.persistedStateMatchesLastPost()
            && commit.baseVersion === commit.version - 1
            && api.committedVersion() === commit.version
            && api.acknowledgedVersion() === commit.version,
        );
    }, {
        timeout: 20_000,
        message: "the exact-version save fixture must persist and acknowledge the posted state",
    }).toBe(true);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("complementary", { name: "Device and server saves diverged" })).toHaveCount(0);
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
    await page.getByLabel("Name").fill("AdaptiveNinja");
    await page.locator("#cc-password").fill("Adaptive!Pass1234");
    await page.locator("#cc-confirm-password").fill("Adaptive!Pass1234");
    await page.getByRole("button", { name: "Enter the World" }).click();
}

async function openCentralHub(page: Page) {
    await page.goto("/#/centralHub");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Central/ })).toBeVisible();
}

function adaptiveJutsuFixtureData() {
    const jutsuIds = Array.from({ length: 15 }, (_, index) => `adaptive-max-jutsu-${index + 1}`);
    const creatorJutsus = jutsuIds.map((id, index) => ({
        id,
        name: index === 0
            ? "Transcendent Moonshadow Tempest Formation of the Twelve Unbroken Seals"
            : `Adaptive Jutsu Fixture ${String(index + 1).padStart(2, "0")}`,
        type: "Taijutsu",
        element: "None",
        ap: 60,
        range: 4,
        effectPower: 20,
        cooldown: 3,
        currentCooldown: 0,
        chakraCost: 50,
        staminaCost: 50,
        healthCost: 0,
        target: "OPPONENT",
        method: "SINGLE",
        battleDescription: "A safe layout-only fixture technique.",
        healthCostReducePerLvl: 0,
        chakraCostReducePerLvl: 0,
        staminaCostReducePerLvl: 0,
        tags: [{ name: "Wound", percent: 14 }],
        description: "Representative maximum-content jutsu fixture.",
    }));
    return { jutsuIds, creatorJutsus };
}

function subscriberSaveFixture(jutsuIds: string[], creatorJutsus: ReturnType<typeof adaptiveJutsuFixtureData>["creatorJutsus"]): SavePayload {
    const stats = {
        strength: 40, speed: 40, intelligence: 40, willpower: 40,
        bukijutsuOffense: 40, bukijutsuDefense: 40, taijutsuOffense: 40, taijutsuDefense: 40,
        genjutsuOffense: 40, genjutsuDefense: 40, ninjutsuOffense: 40, ninjutsuDefense: 40,
    };
    return {
        character: {
            name: "AdaptiveNinja",
            village: "Stormveil Village",
            specialty: "Genjutsu",
            bloodline: "Ashen Eyes",
            level: 85,
            rankTitle: "Special Jonin",
            ryo: 9_999_999,
            fateShards: 9_999,
            boneCharms: 9_999,
            auraStones: 9_999,
            mythicSeals: 9_999,
            unspentStats: 0,
            stats,
            hp: 9_000,
            maxHp: 9_000,
            chakra: 9_000,
            maxChakra: 9_000,
            stamina: 9_000,
            maxStamina: 9_000,
            onboardingStep: "done",
            academyChecklistClaimed: true,
            inventory: ["rustfang-kunai", "shinobi-vest", "dungeon-key"],
            itemStacks: [],
            equipment: {},
            pets: [],
            storyProgress: 9,
            storyVillage: "Stormveil Village",
            storyTraits: [],
            examsPassed: ["genin", "chunin"],
            profession: "healer",
            professionRank: 5,
            equippedJutsuIds: jutsuIds,
            jutsuMastery: jutsuIds.map((jutsuId) => ({ jutsuId, level: 50, xp: 0 })),
            patreon: {
                userId: "adaptive-subscriber",
                tier: "shinobi-supporter",
                active: true,
                entitledCents: 1_500,
                updatedAt: Date.now(),
            },
        },
        currentBiome: "central",
        currentSector: 40,
        activeTraining: null,
        activeJutsuTraining: null,
        acceptedMissionIds: [],
        missionProgress: {},
        triggeredEvents: [
            "builtin-awakening-lv2",
            "builtin-aura-sphere-lv9",
            "story-interlude-stormveil-village-20",
            "story-interlude-stormveil-village-30",
            "story-interlude-stormveil-village-42",
            "story-interlude-stormveil-village-58",
            "story-interlude-stormveil-village-70",
            "story-interlude-stormveil-village-80",
        ],
        pendingAiProfileId: "",
        pendingTravel: null,
        creatorJutsus,
    };
}

function maximumContentSaveFixture(
    itemIds: string[],
    creatorItems: Array<Record<string, unknown>>,
    jutsuIds: string[],
    creatorJutsus: ReturnType<typeof adaptiveJutsuFixtureData>["creatorJutsus"],
): SavePayload {
    const seeded = subscriberSaveFixture(jutsuIds.slice(0, 12), creatorJutsus);
    const character = {
        ...(seeded.character ?? {}),
        name: "AdaptiveNinjaWithAnExceptionallyLongButUnbrokenDisplayName",
        ryo: 9_999_999_999,
        fateShards: 9_999_999,
        inventory: itemIds,
        equippedJutsuIds: jutsuIds.slice(0, 12),
        jutsuMastery: jutsuIds.map((jutsuId) => ({ jutsuId, level: 50, xp: 0 })),
    };
    delete (character as Record<string, unknown>).patreon;
    return { ...seeded, character, creatorItems };
}

function mobileStorageSaveFixture(): SavePayload {
    const seeded = subscriberSaveFixture([], []);
    const character = { ...(seeded.character ?? {}) };
    delete character.patreon;
    return { ...seeded, character };
}

async function installPersistedAdaptiveSession(page: Page, accountName = "AdaptiveNinja", acknowledgeStorageNotice = true) {
    await page.addInitScript(({ name, acknowledgeNotice }) => {
        const key = name.trim().toLowerCase();
        localStorage.setItem("ninjav-admin-build-v1", JSON.stringify({ currentAccountName: name }));
        localStorage.setItem("ninjav-player-accounts-v1", JSON.stringify({ [key]: { token: "adaptive-e2e-token" } }));
        localStorage.setItem("shinobix:activePlayerPersist", name);
        localStorage.setItem("shinobix:activeTokenPersist", "adaptive-e2e-token");
        if (acknowledgeNotice) localStorage.setItem("shinobix:storage-notice-ack", "1");
        else localStorage.removeItem("shinobix:storage-notice-ack");
        localStorage.setItem("patchNotes.lastSeenVersion.v1", "2026.07.28-stat-leveling");
        localStorage.setItem("dailyBriefing.seen.v1", new Date().toISOString().slice(0, 10));
    }, { name: accountName, acknowledgeNotice: acknowledgeStorageNotice });
}

async function bootPersistedAdaptiveScreen(page: Page, api: AuthenticatedApiFixture, screen: string) {
    api.seedSaveBeforeBoot(mobileStorageSaveFixture());
    await installPersistedAdaptiveSession(page);
    await page.goto(`/#/${screen}`, { waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", screen);
    await expectCommittedSave(page, api);
}

const boundaryMatrix = [
    { width: 559, viewportClass: "xs", mobile: true },
    { width: 560, viewportClass: "sm", mobile: true },
    { width: 799, viewportClass: "sm", mobile: true },
    { width: 800, viewportClass: "sm", mobile: true },
    { width: 801, viewportClass: "sm", mobile: true },
    { width: 979, viewportClass: "sm", mobile: true },
    { width: 980, viewportClass: "md", mobile: false },
    { width: 981, viewportClass: "md", mobile: false },
    { width: 1023, viewportClass: "md", mobile: false },
    { width: 1024, viewportClass: "md", mobile: false },
    { width: 1099, viewportClass: "md", mobile: false },
    { width: 1100, viewportClass: "md", mobile: false },
    { width: 1179, viewportClass: "md", mobile: false },
    { width: 1180, viewportClass: "lg", mobile: false },
    { width: 1399, viewportClass: "lg", mobile: false },
    { width: 1400, viewportClass: "xl", mobile: false },
    { width: 2199, viewportClass: "xl", mobile: false },
    { width: 2200, viewportClass: "xxl", mobile: false },
] as const;

const requiredVisualMatrix = [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 430, height: 932 },
    { width: 667, height: 375 },
    { width: 800, height: 360 },
    { width: 844, height: 390 },
    { width: 932, height: 430 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3440, height: 1440 },
] as const;

test("shell breakpoints expose exactly one complete navigation system", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "the boundary matrix is browser-independent CSS contract coverage");
    const api = await installAuthenticatedApi(page);
    await bootPersistedAdaptiveScreen(page, api, "centralHub");

    for (const entry of boundaryMatrix) {
        await test.step(`${entry.width}px resolves to ${entry.viewportClass}`, async () => {
            await page.setViewportSize({ width: entry.width, height: 768 });
            await expect(page.locator("html")).toHaveAttribute("data-vp", entry.viewportClass);
            const mobileNav = page.locator(".mobile-bottom-nav");
            const leftRail = page.locator(".left-profile-card");
            const rightRail = page.locator(".right-menu-panel");
            if (entry.mobile) {
                await expect(mobileNav).toBeVisible();
                await expect(leftRail).toBeHidden();
                await expect(rightRail).toBeHidden();
            } else {
                await expect(mobileNav).toBeHidden();
                await expect(leftRail).toBeVisible();
                await expect(rightRail).toBeVisible();
                await expectNoLargeOverlap(leftRail, page.locator(".center-game"));
                await expectNoLargeOverlap(page.locator(".center-game"), rightRail);
            }
            await expectViewportSafe(page, {
                horizontalScrollers: [".table-scroll", ".ui-tabs", ".admin-tabs"],
            });
        });
    }
});

test("village shell remains usable across the required visual matrix", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "one engine covers the exact dynamic viewport contract; cross-engine smoke runs separately");
    const api = await installAuthenticatedApi(page);
    await bootPersistedAdaptiveScreen(page, api, "village");

    for (const viewport of requiredVisualMatrix) {
        await test.step(`${viewport.width}x${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            const mobile = viewport.width < 980;
            if (mobile) {
                await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
                await expect(page.locator(".left-profile-card")).toBeHidden();
                await expect(page.locator(".right-menu-panel")).toBeHidden();
            } else {
                await expect(page.locator(".mobile-bottom-nav")).toBeHidden();
                await expect(page.locator(".left-profile-card")).toBeVisible();
                await expect(page.locator(".right-menu-panel")).toBeVisible();
            }
            await expectViewportSafe(page, {
                horizontalScrollers: [".table-scroll", ".ui-tabs", ".admin-tabs"],
            });
        });
    }
});

test("mobile storage notice clears fixed navigation and remains dismissible", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    test.skip(testInfo.project.name !== "chromium-mobile", "one touch/mobile engine exercises the notice contract");
    const api = await installAuthenticatedApi(page);
    api.seedSaveBeforeBoot(mobileStorageSaveFixture());
    await installPersistedAdaptiveSession(page, "AdaptiveNinja", false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/centralHub", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Central/ })).toBeVisible();
    await expectCommittedSave(page, api);

    const notice = page.getByRole("region", { name: "Data storage notice" });
    const mobileNav = page.locator(".mobile-bottom-nav");
    await expect(notice).toBeVisible();
    await expect(mobileNav).toBeVisible();
    await expectNoLargeOverlap(notice, mobileNav);
    await expectViewportSafe(page);
    await notice.getByRole("button", { name: "Got it" }).click();
    await expect(notice).toBeHidden();
    await expectFinalActionableClearsFixedNavigation(page, page.locator(".center-game"), mobileNav);
    await mobileNav.getByRole("button", { name: "Travel" }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "worldMap");
});

test("dialogs remain contained across portrait and short landscape viewports", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "dynamic viewport coverage avoids repeating account setup per project");
    const api = await installAuthenticatedApi(page);
    await bootPersistedAdaptiveScreen(page, api, "centralHub");

    for (const viewport of [{ width: 320, height: 568 }, { width: 800, height: 360 }]) {
        await test.step(`${viewport.width}x${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            await page.locator(".central-card").filter({ hasText: "Ancient Archives" }).click();
            const dialog = page.getByRole("dialog", { name: "Ancient Archives" });
            await expect(dialog).toBeVisible();
            const bareBody = dialog.locator(":scope > .ui-modal-body--bare");
            await expect(bareBody).toBeVisible();
            await expect(bareBody).toHaveCSS("overflow-y", "auto");
            await expectViewportSafe(page, { horizontalScrollers: [".archives-grid"] });
            await expect(dialog.getByRole("button", { name: /Close/ })).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(dialog).toBeHidden();
        });
    }
});

test("representative empty, loading, validation, long-content, and entitlement states reflow safely", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "state fixtures are exercised once; the route smoke suite supplies engine coverage");
    await page.addInitScript(() => localStorage.setItem("shinobix:storage-notice-ack", "1"));
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.stack ?? error.message));
    page.on("console", (message) => {
        if (message.type() === "error" && /ErrorBoundary|(?:Type|Reference|Range)Error/.test(message.text())) {
            runtimeErrors.push(message.text());
        }
    });
    const api = await installAuthenticatedApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const itemIds = Array.from({ length: 18 }, (_, index) => `adaptive-max-item-${index + 1}`);
    const creatorItems = itemIds.map((id, index) => ({
        id,
        name: index === 0
            ? "Ceremonial Transcontinental Thunder-Tempered Inventory Relic With An Exceptionally Long Name"
            : `Adaptive Inventory Fixture ${String(index + 1).padStart(2, "0")}`,
        slot: "item",
        rarity: index % 5 === 0 ? "legendary" : "common",
        cost: 999_999,
        description: "Representative maximum-content inventory fixture.",
        bonuses: {},
    }));
    const { jutsuIds, creatorJutsus } = adaptiveJutsuFixtureData();
    const maximumAccountName = "AdaptiveNinjaWithAnExceptionallyLongButUnbrokenDisplayName";

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
    await page.getByRole("button", { name: "Enter the World" }).click();
    await expect(page.locator("#cc-name-error")).toBeVisible();
    await expect(page.locator("#cc-password-error")).toBeVisible();
    await expectViewportSafe(page);
    await page.getByLabel("Name").fill("AdaptiveNinja");
    await page.locator("#cc-password").fill("Adaptive!Pass1234");
    await page.getByRole("button", { name: "Enter the World" }).click();
    await expect(page.locator("#cc-confirm-error")).toBeVisible();

    api.seedSaveBeforeBoot(maximumContentSaveFixture(itemIds, creatorItems, jutsuIds, creatorJutsus));
    await installPersistedAdaptiveSession(page, maximumAccountName);
    await page.goto("/?adaptive-fixture=maximum#/centralHub", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Central/ })).toBeVisible();
    await expectCommittedSave(page, api);

    let releaseClanList: (() => void) | undefined;
    const clanListGate = new Promise<void>((resolveGate) => { releaseClanList = resolveGate; });
    let clanListRequest = 0;
    const longClanName = "The Unreasonably Long Fellowship of the Moonlit Storm Harbor Sentinels";
    await page.route("**/api/clans/list", async (route) => {
        clanListRequest += 1;
        if (clanListRequest === 1) {
            await clanListGate;
            return json(route, []);
        }
        return json(route, [{
            name: longClanName,
            village: "Stormveil Village",
            founderName: "Founder With A Deliberately Long Display Name",
            createdAt: Date.now(),
            level: 100,
            members: [],
            joinRequests: [],
            recruitment: "A maximum-length recruitment message that remains readable without widening the document or hiding the join action.",
        }]);
    });
    await page.goto("/#/village", { waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "village");
    await page.getByRole("button", { name: "Enter Clan Hall" }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "clan");
    await expect(page.getByText("Loading clans...")).toBeVisible();
    releaseClanList?.();
    await expect(page.getByText("No clans from your village exist yet.")).toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText(longClanName)).toBeVisible();
    await expectViewportSafe(page);

    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Items" }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "inventory");
    await expect(page.locator(".backpack-item")).toHaveCount(18);
    await expect(page.getByText(creatorItems[0].name, { exact: true })).toBeVisible();
    await expectViewportSafe(page);

    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Char" }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "profile");
    expect(runtimeErrors, "the maximum-profile fixture must render without a route error boundary").toEqual([]);
    await page.getByRole("button", { name: "Jutsu", exact: true }).click();
    await expect(page.locator(".jutsu-loadout-slot.is-filled")).toHaveCount(12);
    await expect(page.locator(".jutsu-loadout-slot.is-locked")).toHaveCount(3);
    await expect(page.getByText(creatorJutsus[0].name, { exact: true }).first()).toBeVisible();
    await expectViewportSafe(page, { horizontalScrollers: [".profile-mobile-tabs"] });

    const battleHistoryRequestsBeforeFailure = api.battleHistoryRequests();
    api.setBattleHistoryFailure(true);
    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Items" }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "inventory");
    await page.waitForTimeout(350);
    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Char" }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "profile");
    await page.getByRole("button", { name: "Battles", exact: true }).click();
    await expect.poll(api.battleHistoryRequests).toBeGreaterThan(battleHistoryRequestsBeforeFailure);
    const historyError = page.getByRole("alert").filter({ hasText: "server had trouble loading" });
    await expect(historyError).toBeVisible();
    await expectViewportSafe(page, { horizontalScrollers: [".profile-mobile-tabs"] });
});

test("subscriber capacity and expanded mobile drawers reflow safely", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "entitlement fixtures are exercised once; the route smoke suite supplies engine coverage");
    const { jutsuIds, creatorJutsus } = adaptiveJutsuFixtureData();
    await installPersistedAdaptiveSession(page);
    const api = await installAuthenticatedApi(page, subscriberSaveFixture(jutsuIds, creatorJutsus));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/centralHub", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Central/ })).toBeVisible();
    await expectCommittedSave(page, api);
    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Char" }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "profile");
    await page.getByRole("button", { name: "Jutsu", exact: true }).click();
    await expect(page.locator(".jutsu-loadout-slot.is-filled")).toHaveCount(15);
    await expect(page.locator(".jutsu-loadout-slot.is-locked")).toHaveCount(0);
    await expect(page.getByText("Subscriber Active", { exact: true })).toBeVisible();
    await expectViewportSafe(page, { horizontalScrollers: [".profile-mobile-tabs"] });

    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "You", exact: true }).click();
    const profileDrawer = page.getByRole("dialog", { name: "Your shinobi" });
    await expect(profileDrawer).toBeVisible();
    await expectViewportSafe(page, { overlays: [".mobile-profile-sheet-overlay"] });
    await profileDrawer.getByRole("button", { name: "Close" }).click();
    await page.waitForTimeout(350);
    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Menu", exact: true }).click();
    const mobileMenu = page.getByRole("dialog", { name: "Shinobi menu" });
    await expect(mobileMenu).toBeVisible();
    await expectViewportSafe(page, { overlays: [".mobile-menu-overlay"] });
    await mobileMenu.getByRole("button", { name: "Close menu" }).click();
});

test("capture adaptive shell and representative route evidence", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(process.env.ADAPTIVE_CAPTURE !== "1", "visual evidence capture is opt-in");
    test.skip(testInfo.project.name !== "chromium-desktop", "Chromium supplies the canonical screenshot set");
    const output = resolve(process.cwd(), "..", ".playwright-mcp", "aaa-adaptive");
    mkdirSync(output, { recursive: true });
    const shot = async (name: string) => {
        await page.waitForTimeout(250);
        await page.screenshot({ path: resolve(output, name), animations: "disabled", fullPage: false });
    };
    await page.addInitScript(() => localStorage.setItem("shinobix:storage-notice-ack", "1"));
    const api = await installAuthenticatedApi(page);

    for (const viewport of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 980, height: 768 },
        { width: 1366, height: 768 },
        { width: 3440, height: 1440 },
    ]) {
        await page.setViewportSize(viewport);
        await page.goto("/", { waitUntil: "networkidle" });
        await shot(`after-landing-${viewport.width}x${viewport.height}.png`);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
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
    await shot("after-creator-name-1366x768.png");

    await page.goto("/", { waitUntil: "networkidle" });
    await createAccount(page);
    await expectCommittedSave(page, api);
    await expect(page.locator(".app-shell")).not.toHaveAttribute("data-screen", "start");
    const introDialogue = page.locator(".icx-dialogue");
    await expect(introDialogue).toBeVisible({ timeout: 10_000 });
    await expect(introDialogue.locator(".icx-sr")).not.toHaveText("");
    await expect(introDialogue.locator(".icx-advance")).toBeVisible({ timeout: 10_000 });
    await expect(introDialogue.locator(".icx-tap-hint")).toBeVisible();
    for (const viewport of [
        { width: 320, height: 568 },
        { width: 1366, height: 768 },
        { width: 3440, height: 1440 },
    ]) {
        await page.setViewportSize(viewport);
        await expectViewportSafe(page);
        await shot(`after-visual-novel-${viewport.width}x${viewport.height}.png`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole("button", { name: /Skip/ }).click();
    await expect(page.getByRole("button", { name: /Skip/ })).toBeHidden();
    await page.goto("/#/village");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "village");
    for (const viewport of requiredVisualMatrix) {
        await page.setViewportSize(viewport);
        await shot(`after-village-${viewport.width}x${viewport.height}.png`);
    }

    const captureRoute = async (screen: string, filename: string, viewport = { width: 1366, height: 768 }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/#/${screen}`);
        await page.reload({ waitUntil: "networkidle" });
        await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", screen);
        for (let guard = 0; guard < 3; guard += 1) {
            const gotIt = page.getByRole("button", { name: /Got it/i }).last();
            if (!(await gotIt.isVisible().catch(() => false))) break;
            await gotIt.click();
        }
        await expectViewportSafe(page, { horizontalScrollers: [".table-scroll", ".ui-tabs", ".chronicle-hand"] });
        await shot(filename);
    };
    await captureRoute("worldMap", "after-world-map-1366x768.png");
    await page.getByRole("button", { name: "Travel to Harbor Gates (Sector 1)" }).click();
    await expect(page.locator(".map-instance")).toBeVisible();
    await expectViewportSafe(page, { horizontalScrollers: [".table-scroll", ".ui-tabs", ".chronicle-hand"] });
    await shot("after-sector-exploration-1366x768.png");
    await captureRoute("inventory", "after-inventory-1366x768.png");
    await captureRoute("profile", "after-profile-1366x768.png");
    await captureRoute("home", "after-pet-yard-1366x768.png");
    await captureRoute("townHall", "after-town-hall-1366x768.png");
    api.patchCharacter({ starterCardsClaimed: true, cardClashTutorialVersion: 999 });
    await captureRoute("shinobiTiles", "after-card-hall-1366x768.png");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Start Showdown vs AI" }).click();
    await expect(page.locator(".chronicle-shell--duel-active")).toBeVisible();
    await expectViewportSafe(page, { horizontalScrollers: [".chronicle-hand", ".chronicle-tabs"] });
    await shot("after-card-field-active-1366x768.png");
    const matchOptions = page.getByRole("button", { name: "Match options" });
    await matchOptions.click();
    await expect(matchOptions).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#chronicle-match-options")).toBeVisible();
    await expectViewportSafe(page, { overlays: ["#chronicle-match-options"], horizontalScrollers: [".chronicle-hand", ".chronicle-tabs"] });
    await shot("after-card-field-options-1366x768.png");
    await page.keyboard.press("Escape");
    await captureRoute("storyHall", "after-story-hall-1366x768.png");
    await openCentralHub(page);
    await page.locator(".central-card").filter({ hasText: "Ancient Archives" }).click();
    await shot("after-dialog-ancient-archives-1366x768.png");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator(".central-card").filter({ hasText: "Ancient Archives" }).click();
    await shot("after-dialog-ancient-archives-320x568.png");
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".mobile-bottom-nav").getByRole("button", { name: "Menu" }).click();
    await shot("after-mobile-menu-390x844.png");
    await page.keyboard.press("Escape");
    await shot("after-mobile-nav-390x844.png");
});

test("selected-sector projection keeps controls, receipts, traces, and responsive geometry coherent", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(
        !["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name),
        "the canonical desktop and mobile projects exercise the selected-sector projection",
    );

    const severeRuntimeErrors: string[] = [];
    page.on("pageerror", (error) => severeRuntimeErrors.push(error.stack ?? error.message));
    page.on("console", (message) => {
        if (message.type() === "error" && /ErrorBoundary|(?:Type|Reference|Range)Error|uncaught|unhandled|fatal/i.test(message.text())) {
            severeRuntimeErrors.push(message.text());
        }
    });

    const api = await installAuthenticatedApi(page);
    const fixture = mobileStorageSaveFixture();
    api.seedSaveBeforeBoot({
        ...fixture,
        currentBiome: "central",
        currentSector: 44,
        character: {
            ...(fixture.character ?? {}),
            ryo: 1_200,
            stamina: 100,
            maxStamina: 200,
            totalTilesExplored: 0,
            dailyTilesExplored: 0,
            seenHints: ["worldMap"],
        },
    });
    await installPersistedAdaptiveSession(page);
    await page.addInitScript(() => {
        localStorage.setItem("wanderers.v1", "off");
        localStorage.setItem("weeklyBossRoam.v1", "off");
        localStorage.setItem("sectorPeers.v1", "off");
        localStorage.setItem("anbuInfiltration.v1", "0");
        localStorage.setItem("villageWarMap.v1", "0");
    });

    const capabilities = publicCapabilitiesExcept("villageWar", "anbuInfiltration");
    const traceRequests: Array<{ method: string; sector: string | null; player: string | null }> = [];
    const dungeonRequests: Array<Record<string, unknown>> = [];
    const petRequests: Array<Record<string, unknown>> = [];
    const exploreRequests: Array<Record<string, unknown>> = [];
    const receiptDay = "2026-08-15";
    const receiptAt = Date.UTC(2026, 7, 15, 12, 0, 0);
    let capabilityRequests = 0;
    let sharedRequestId = "";

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === "/api/player/capabilities") {
            capabilityRequests += 1;
            return json(route, { ok: true, capabilities });
        }
        if (url.pathname === "/api/sector/traces") {
            traceRequests.push({
                method: request.method(),
                sector: url.searchParams.get("sector"),
                player: url.searchParams.get("player"),
            });
            return json(route, {
                ok: true,
                sector: 44,
                footfallToday: 3,
                signs: [{
                    id: "watchruin-sign-001",
                    name: "Roadscribe",
                    tile: 78,
                    text: "Keep to the lantern side of the ridge.",
                    at: receiptAt,
                    sparks: 2,
                }],
                mySparked: [],
                shrine: {
                    id: "ancients",
                    name: "Shrine of the Ancients",
                    theme: "ancients",
                    region: "the Watchruin Ridge",
                    lore: "Raised in the Sunken Court’s age. A hundred worn glyphs circle its base, one for each action-pattern Legacy traced to the Ancients who refused cession, the people later called the Withheld.",
                    blessing: "May your next deed be freely chosen and faithfully witnessed.",
                    tier: 1,
                    total: 30_000,
                    weekTotal: 2_500,
                    topWeek: [{ name: "Roadscribe", amount: 2_500 }],
                    lastWeek: null,
                },
            });
        }
        if (url.pathname === "/api/dungeon/run") {
            const body = request.postDataJSON() as Record<string, unknown>;
            dungeonRequests.push(body);
            sharedRequestId = typeof body.requestId === "string" ? body.requestId : "";
            const versioned = api.commitCharacterPatch({
                serverFreeDungeonProbeDate: receiptDay,
                serverFreeDungeonProbesToday: 1,
                serverFreeDungeonProbeReceipts: [{
                    requestId: sharedRequestId,
                    day: receiptDay,
                    sector: 44,
                    found: false,
                    token: "",
                    at: receiptAt,
                }],
            });
            return json(route, {
                ok: true,
                found: false,
                token: "",
                requestId: sharedRequestId,
                sector: 44,
                resolved: false,
                ...versioned,
            });
        }
        if (url.pathname === "/api/pet/encounter-start") {
            const body = request.postDataJSON() as Record<string, unknown>;
            petRequests.push(body);
            return json(route, {
                ok: true,
                requestId: sharedRequestId,
                sector: 44,
                pet: null,
                replayed: false,
            });
        }
        if (url.pathname === "/api/world/explore") {
            const body = request.postDataJSON() as Record<string, unknown>;
            exploreRequests.push(body);
            const current = api.readCharacter();
            const reward = { sector: 44, xp: 0, ryo: 35 };
            const outcome = { kind: "none" };
            const priorExplorations = Array.isArray(current.redeemedSectorExplorations)
                ? current.redeemedSectorExplorations
                : [];
            const probeReceipts = Array.isArray(current.serverFreeDungeonProbeReceipts)
                ? current.serverFreeDungeonProbeReceipts as Array<Record<string, unknown>>
                : [];
            const versioned = api.commitCharacterPatch({
                ryo: Number(current.ryo ?? 0) + reward.ryo,
                totalTilesExplored: Number(current.totalTilesExplored ?? 0) + 1,
                dailyTilesExplored: Number(current.dailyTilesExplored ?? 0) + 1,
                serverExploreDate: receiptDay,
                serverExploresToday: 1,
                serverFreeDungeonProbeReceipts: probeReceipts.map((receipt) => receipt.requestId === sharedRequestId
                    ? { ...receipt, resolvedAt: receiptAt + 1 }
                    : receipt),
                redeemedSectorExplorations: [
                    ...priorExplorations,
                    { id: sharedRequestId, sector: 44, reward, outcome, at: receiptAt + 1 },
                ],
            });
            return json(route, {
                ok: true,
                reward,
                outcome,
                replayed: false,
                fieldProgress: [],
                ...versioned,
            });
        }
        return route.fallback();
    });

    await page.goto("/#/worldMap", { waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "worldMap");
    await expectCommittedSave(page, api);

    const returnToSector = page.getByRole("button", { name: /Return to Sector 44/ });
    await expect(returnToSector).toBeVisible();
    await returnToSector.click();

    const stage = page.locator(".sector-stage-panel");
    const commandPanel = page.getByRole("complementary", { name: "Sector 44 command panel" });
    await expect(stage).toBeVisible();
    await expect(stage.getByText("Watchruin Ridge", { exact: true })).toBeVisible();
    await expect(commandPanel).toBeVisible();
    await expect(commandPanel.getByRole("heading", { name: "Watchruin Ridge", exact: true })).toBeVisible();

    const tiles = stage.locator("button.scene-tile");
    await expect(tiles).toHaveCount(144);
    const tileLabels = await tiles.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    expect(tileLabels.every((label) => typeof label === "string" && label.length > 0)).toBe(true);
    expect(new Set(tileLabels).size).toBe(144);
    await expect(stage.getByRole("button", { name: "Current tile row 7 column 7" })).toHaveCount(1);
    await page.keyboard.press("d");
    await expect(stage.getByRole("button", { name: "Current tile row 7 column 8" })).toHaveCount(1);
    await page.keyboard.press("a");
    await expect(stage.getByRole("button", { name: "Current tile row 7 column 7" })).toHaveCount(1);

    const noticeDialog = page.getByRole("alertdialog", { name: "Notice" });
    await page.keyboard.press("e");
    await expect(noticeDialog).toBeVisible();
    await expect(noticeDialog).toContainText("Sector 44 explored. +35 ryo.");
    await noticeDialog.getByRole("button", { name: "OK", exact: true }).click();
    await expect(noticeDialog).toBeHidden();

    expect(sharedRequestId).toMatch(/^[A-Za-z0-9_-]{8,96}$/);
    expect(dungeonRequests).toEqual([{
        playerName: "AdaptiveNinja",
        action: "probe-free",
        sector: 44,
        requestId: sharedRequestId,
    }]);
    expect(petRequests).toEqual([{
        playerName: "AdaptiveNinja",
        sector: 44,
        requestId: sharedRequestId,
    }]);
    expect(exploreRequests).toEqual([{
        playerName: "AdaptiveNinja",
        sector: 44,
        credit: "tile",
        requestId: sharedRequestId,
        resolveOutcome: true,
    }]);
    expect(api.readCharacter()).toMatchObject({
        ryo: 1_235,
        totalTilesExplored: 1,
        dailyTilesExplored: 1,
        redeemedSectorExplorations: [{ id: sharedRequestId, sector: 44, reward: { ryo: 35 } }],
    });

    const readDisplayedStamina = async () => {
        const label = (await page.locator(".left-profile-stat").filter({ hasText: /^Stamina / }).textContent())?.trim() ?? "";
        const match = /^Stamina\s+([\d,]+)\/([\d,]+)$/.exec(label);
        expect(match, `expected a parseable profile stamina label, received ${JSON.stringify(label)}`).not.toBeNull();
        return {
            current: Number(match![1].replaceAll(",", "")),
            max: Number(match![2].replaceAll(",", "")),
        };
    };
    const displayedStaminaBeforeRecover = await readDisplayedStamina();
    const versionBeforeRecover = api.committedVersion();
    const staminaBeforeRecover = Number(api.readCharacter().stamina);
    const maxStaminaBeforeRecover = Number(api.readCharacter().maxStamina);
    await commandPanel.getByRole("button", { name: "Recover", exact: true }).click();
    await expect(noticeDialog).toBeVisible();
    await expect(noticeDialog).toContainText("You recovered in Sector 44. +14 stamina.");
    await expect.poll(async () => (await readDisplayedStamina()).current).toBe(
        Math.min(displayedStaminaBeforeRecover.max, displayedStaminaBeforeRecover.current + 14),
    );
    await noticeDialog.getByRole("button", { name: "OK", exact: true }).click();
    await expect(noticeDialog).toBeHidden();
    await expect.poll(api.committedVersion, { timeout: 20_000 }).toBeGreaterThan(versionBeforeRecover);
    await expect.poll(() => Number(api.readCharacter().stamina), { timeout: 20_000 }).toBeGreaterThanOrEqual(
        Math.min(maxStaminaBeforeRecover, staminaBeforeRecover + 14),
    );
    await expectCommittedSave(page, api);

    await expect.poll(() => traceRequests.length).toBe(1);
    expect(traceRequests).toEqual([{ method: "GET", sector: "44", player: "AdaptiveNinja" }]);
    const signsButton = commandPanel.getByRole("button", { name: "Trail signs (1)", exact: true });
    const shrineButton = commandPanel.getByRole("button", { name: /Shrine of the Ancients/ });
    await expect(signsButton).toBeVisible();
    await expect(shrineButton).toContainText("Kindled");

    await signsButton.click();
    const signsDialog = page.getByRole("dialog", { name: "Trail signs" });
    await expect(signsDialog).toBeVisible();
    await expect(signsDialog.getByText("Keep to the lantern side of the ridge.", { exact: false })).toBeVisible();
    expect(await signsDialog.evaluate((node) => node.parentElement?.parentElement === document.body)).toBe(true);
    await expectViewportSafe(page, {
        overlays: [".sector-traces-scrim"],
        logicalStages: [".walkable-sector-map"],
    });
    await signsDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(signsDialog).toHaveCount(0);

    await shrineButton.click();
    const shrineDialog = page.getByRole("dialog", { name: "Shrine of the Ancients" });
    await expect(shrineDialog).toBeVisible();
    await expect(shrineDialog.getByText("On hand: 1,235 ryo", { exact: true })).toBeVisible();
    expect(await shrineDialog.evaluate((node) => node.parentElement?.parentElement === document.body)).toBe(true);
    await expectViewportSafe(page, {
        overlays: [".sector-traces-scrim"],
        logicalStages: [".walkable-sector-map"],
    });
    await shrineDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(shrineDialog).toHaveCount(0);

    await expectNoLargeOverlap(stage, commandPanel);
    await expectViewportSafe(page, { logicalStages: [".walkable-sector-map"] });
    const mobileNav = page.locator(".mobile-bottom-nav");
    if (testInfo.project.name === "chromium-mobile") {
        await expect(mobileNav).toBeVisible();
        await expectFinalActionableClearsFixedNavigation(page, page.locator(".map-instance"), mobileNav);
        await expectNoLargeOverlap(commandPanel.getByRole("button", { name: "Leave", exact: true }), mobileNav);
    } else {
        await expect(mobileNav).toBeHidden();
    }

    await commandPanel.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(stage).toHaveCount(0);
    await expect(commandPanel).toHaveCount(0);
    await expect(page.locator(".generated-world-map")).toBeVisible();
    await expect(page.getByRole("button", { name: /Return to Sector 44/ })).toBeVisible();
    await expectViewportSafe(page, { logicalStages: [".world-map-scroll"] });
    expect(capabilityRequests).toBeGreaterThan(0);
    expect(severeRuntimeErrors).toEqual([]);
});

test("world-map coordinate overlays stay aligned across device scale factors", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(!/^chromium-map-dpr/.test(testInfo.project.name), "dedicated DPR projects exercise this coordinate surface");
    const wheelConsoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error" && /passive|preventDefault|intervention/i.test(message.text())) {
            wheelConsoleErrors.push(message.text());
        }
    });
    const api = await installAuthenticatedApi(page);
    await bootPersistedAdaptiveScreen(page, api, "worldMap");

    const expectedDpr = Number(testInfo.project.use.deviceScaleFactor ?? 1);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(expectedDpr);
    const viewport = page.locator(".world-map-scroll");
    const map = page.locator(".generated-world-map");
    const sector = page.getByRole("button", { name: /Travel to Harbor Gates \(Sector 1\)/ });
    await expect(viewport).toBeVisible();
    await expect(map).toBeVisible();
    await expect(sector).toBeVisible();

    const assertMarkerHit = async () => {
        await expect.poll(async () => sector.evaluate((marker) => {
            const stage = marker.closest<HTMLElement>(".world-map-scroll");
            if (!stage) return { inside: false, hit: false };
            const viewportRect = stage.getBoundingClientRect();
            const markerRect = marker.getBoundingClientRect();
            const x = markerRect.left + markerRect.width / 2;
            const y = markerRect.top + markerRect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return {
                inside: x >= viewportRect.left && x <= viewportRect.right
                    && y >= viewportRect.top && y <= viewportRect.bottom,
                hit: Boolean(hit && (hit === marker || marker.contains(hit))),
            };
        }), { message: "the focused map marker must settle inside the camera and remain the hit target" })
            .toEqual({ inside: true, hit: true });
    };

    for (let guard = 0; guard < 3; guard += 1) {
        const gotIt = page.getByRole("button", { name: /Got it/i }).last();
        if (!(await gotIt.isVisible().catch(() => false))) break;
        await gotIt.click();
    }
    const stormveil = page.getByRole("button", { name: "Stormveil", exact: true });
    await stormveil.focus();
    await stormveil.press("Enter");
    await expect.poll(() => map.evaluate((node) => getComputedStyle(node).transform)).not.toBe("none");
    await assertMarkerHit();
    const beforePan = await map.evaluate((node) => getComputedStyle(node).transform);
    const box = await viewport.boundingBox();
    if (box) {
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, { steps: 4 });
        await page.mouse.up();
    }
    await expect.poll(() => map.evaluate((node) => getComputedStyle(node).transform)).not.toBe(beforePan);
    await assertMarkerHit();
    const beforeWheel = await Promise.all([
        map.evaluate((node) => getComputedStyle(node).transform),
        page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, top: document.scrollingElement?.scrollTop ?? 0 })),
    ]);
    const wheelBox = await viewport.boundingBox();
    if (wheelBox) {
        await page.mouse.move(wheelBox.x + wheelBox.width / 2, wheelBox.y + wheelBox.height / 2);
        await page.mouse.wheel(0, -240);
    }
    await expect.poll(() => map.evaluate((node) => getComputedStyle(node).transform)).not.toBe(beforeWheel[0]);
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, top: document.scrollingElement?.scrollTop ?? 0 }))).toEqual(beforeWheel[1]);
    const beforeWheelOut = await Promise.all([
        map.evaluate((node) => getComputedStyle(node).transform),
        page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, top: document.scrollingElement?.scrollTop ?? 0 })),
    ]);
    if (wheelBox) await page.mouse.wheel(0, 240);
    await expect.poll(() => map.evaluate((node) => getComputedStyle(node).transform)).not.toBe(beforeWheelOut[0]);
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, top: document.scrollingElement?.scrollTop ?? 0 }))).toEqual(beforeWheelOut[1]);
    expect(wheelConsoleErrors).toEqual([]);
    await expectViewportSafe(page, { logicalStages: [".world-map-scroll"] });
});
