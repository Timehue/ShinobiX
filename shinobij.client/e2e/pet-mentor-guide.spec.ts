import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PUBLIC_CAPABILITY_IDS } from "../../shared/public-capabilities";
import { PET_TUTORIAL_LESSON_IDS } from "../../shared/pet-tutorial";

// Mirrored from shared/wanderer-roster.ts rather than imported: that module
// reaches sideways to `./sector-geo.js`, an extension the Playwright runner's
// TypeScript resolution refuses, so importing it fails collection outright.
// shared/wanderer-roster.test.ts pins both values on the source side.
const WANDERER_BUCKET_MS = 6 * 60 * 60 * 1000;
const WANDERER_MAX_INDEX = 1;

/**
 * Keep the road empty for the sector this fixture drops the player into.
 *
 * The bandit archetype WALKS AT YOU and opens a blocking Fight/Flee encounter
 * whose scrim then eats every click on the sector floor -- including Tomoe's
 * road prompt, which is what this file is here to certify. The cast is
 * deterministic per (sector, 6h bucket), so this is not flake that retries
 * away: it lands on whole runs whose bucket happened to roll a bandit.
 *
 * The supported way to keep an NPC off the road is its own anti-farm cooldown,
 * which is real character state the sector floor already honours. Neighbouring
 * buckets are seeded too because the page reads the bucket off `serverNow()`,
 * not this process's clock. Mirrors the same helper in adaptive-shell.spec.ts.
 */
function quietRoadCooldowns(sector: number, now = Date.now()): Record<string, number> {
    const expiry = now + 30 * 24 * 60 * 60 * 1000;
    const cooldowns: Record<string, number> = {};
    for (const offset of [-1, 0, 1]) {
        const bucket = Math.floor(now / WANDERER_BUCKET_MS) + offset;
        for (let index = 0; index <= WANDERER_MAX_INDEX; index++) {
            cooldowns[`w-${sector}-${bucket}-${index}`] = expiry;
        }
    }
    return cooldowns;
}

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function pet(id: string, name: string, element: string) {
    return {
        id,
        templateId: "rare-26",
        name,
        element,
        rarity: "rare",
        level: 45,
        xp: 0,
        maxLevel: 100,
        hp: 420,
        attack: 72,
        defense: 58,
        speed: 64,
        jutsus: [],
        unlockedForPve: true,
        trait: "Loyal",
        happiness: 88,
        origin: "wild",
        generation: 0,
        breedingUsesMax: 8,
        breedingUsesRemaining: 8,
    };
}

function character(completedLessonIds: string[] = []) {
    return {
        name: "PetMentorQA",
        village: "Ashen Leaf Village",
        specialty: "Ninjutsu",
        bloodline: "Inferno Cataclysm",
        level: 40,
        xp: 0,
        ryo: 50_000,
        bankRyo: 0,
        honorSeals: 0,
        auraDust: 0,
        auraSphereLevel: 1,
        fateShards: 0,
        hp: 1_000,
        maxHp: 1_000,
        chakra: 1_000,
        maxChakra: 1_000,
        stamina: 1_000,
        maxStamina: 1_000,
        rankTitle: "Jonin",
        storyProgress: 99,
        storyVillage: "Ashen Leaf Village",
        stats: {
            strength: 60, speed: 60, intelligence: 60, willpower: 60,
            bukijutsuOffense: 60, bukijutsuDefense: 60,
            taijutsuOffense: 60, taijutsuDefense: 60,
            genjutsuOffense: 60, genjutsuDefense: 60,
            ninjutsuOffense: 60, ninjutsuDefense: 60,
        },
        unspentStats: 0,
        equippedJutsuIds: [],
        inventory: [],
        equipment: {},
        jutsuMastery: [],
        pets: [
            pet("mentor-fire", "Ember Ocelot", "Fire"),
            pet("mentor-water", "Tideback Otter", "Water"),
            pet("mentor-wind", "Gale Heron", "Wind"),
            pet("mentor-earth", "Stoneback Tanuki", "Earth"),
        ],
        activePetId: "mentor-fire",
        tileCards: [],
        boneCharms: 0,
        auraStones: 0,
        mythicSeals: 0,
        totalPetWins: 27,
        dailyPetWins: 1,
        clanBattleContrib: 0,
        clanEventContrib: 0,
        clanMissionContrib: 0,
        villageUpgrades: {},
        onboardingStep: "done",
        examsPassed: ["genin", "chunin", "jonin"],
        profession: "petTamer",
        professionRank: 5,
        professionXp: 0,
        petTutorialProgress: { version: 1, completedLessonIds, lastSeenLevel: 0 },
    };
}

async function installApi(page: Page, currentSector = 0, completedLessonIds: string[] = []) {
    let saveVersion = 1;
    const savedCharacter = { ...character(completedLessonIds), wandererCooldowns: quietRoadCooldowns(currentSector) };

    await page.addInitScript(() => {
        // WebKit rejects this large intercepted autosave before page.route can
        // fulfill it. Keep the UI test deterministic inside the page instead.
        let mockedSaveVersion = 1;
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const requestUrl = typeof input === "string"
                ? input
                : input instanceof URL
                    ? input.href
                    : input.url;
            const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
            if (method === "POST" && new URL(requestUrl, window.location.href).pathname.toLowerCase() === "/api/save/petmentorqa") {
                mockedSaveVersion += 1;
                return new Response(JSON.stringify({ ok: true, _saveVersion: mockedSaveVersion }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }
            return nativeFetch(input, init);
        };
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (key?.startsWith("ninjav-save-conflict-v1:")) localStorage.removeItem(key);
        }
        localStorage.setItem("ninjav-admin-build-v1", JSON.stringify({ currentAccountName: "PetMentorQA" }));
        localStorage.setItem("shinobix:activePlayerPersist", "PetMentorQA");
        localStorage.setItem("shinobix:activeTokenPersist", "qa-session-token");
        localStorage.setItem("shinobix:storage-notice-ack", "1");
        localStorage.setItem("dailyBriefing.seen.v1", new Date().toISOString().slice(0, 10));
        localStorage.setItem("patchNotes.lastSeenVersion.v1", "2026.07.28-stat-leveling");
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname.toLowerCase();
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
        if (path === "/api/save/petmentorqa") {
            if (request.method() === "GET") {
                return json(route, {
                    character: savedCharacter,
                    currentBiome: "forest",
                    currentSector,
                    acceptedMissionIds: [],
                    missionProgress: {},
                    triggeredEvents: [
                        "builtin-awakening-lv2",
                        "builtin-aura-sphere-lv9",
                        "story-interlude-ashen-leaf-village-20",
                        "story-interlude-ashen-leaf-village-30",
                        "story-interlude-ashen-leaf-village-42",
                        "story-interlude-ashen-leaf-village-58",
                        "story-interlude-ashen-leaf-village-70",
                        "story-interlude-ashen-leaf-village-80",
                    ],
                    _saveVersion: saveVersion,
                });
            }
            saveVersion += 1;
            return json(route, { ok: true, _saveVersion: saveVersion });
        }
        if (path === "/api/pet/warfront-start") {
            const body = request.postDataJSON() as { resumeOnly?: boolean };
            if (body.resumeOnly) return route.fulfill({ status: 204 });
        }
        if (path === "/api/battle-lock") return json(route, { lock: null });
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
            wars: [],
        });
    });
}

async function openArena(page: Page) {
    await page.goto("/#/village", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter Pet Home" }).click();
    await expect(page.getByRole("heading", { name: "Pet Home", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pet Arena" }).click();
    await expect(page.getByRole("heading", { name: "Pet Colosseum", exact: true })).toBeVisible();
    await expect(page.locator(".session-restore-overlay")).toHaveCount(0);
}

async function assertFitsViewport(page: Page) {
    const dialog = page.getByRole("dialog", { name: "Tamer Tomoe & Kuro" });
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height + 1);
    expect(await page.locator("body").evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(viewport!.width);
}

test("Tomoe appears on the active road while a paced lesson is waiting", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "the road behavior only needs one browser certification");
    await installApi(page, 1);
    await page.goto("/#/worldMap", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });

    const tomoe = page.locator('.sector-wanderer-figure[title^="Tamer Tomoe ·"]');
    await expect(tomoe).toBeVisible();
    const roadPrompt = page.getByRole("button", { name: /Tamer Tomoe & Kuro/ });
    await expect(roadPrompt).toBeVisible();
    const roadArt = roadPrompt.locator("img");
    await expect(roadArt).toBeVisible();
    expect(await roadArt.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThanOrEqual(700);
    const roadAccessibility = await new AxeBuilder({ page })
        .include(".pet-mentor-road-prompt")
        .withTags(["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa"])
        .analyze();
    expect(roadAccessibility.violations).toEqual([]);
    await roadPrompt.focus();
    await expect(roadPrompt).toBeFocused();
    await page.screenshot({
        path: testInfo.outputPath("tomoe-road-encounter.png"),
        fullPage: true,
        animations: "disabled",
    });
    await roadPrompt.click();
    await expect(page.getByRole("dialog", { name: "Tamer Tomoe & Kuro" })).toBeVisible();
});

test("Tomoe provides a complete, responsive seven-chapter pet battle course", async ({ page }, testInfo: TestInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await installApi(page);
    await openArena(page);
    const opener = page.getByRole("button", { name: "Open Tamer Tomoe's pet battle field guide" });
    await expect(opener).toBeVisible();
    expect(await opener.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await opener.click();

    const guide = page.getByRole("dialog", { name: "Tamer Tomoe & Kuro" });
    await expect(guide).toBeVisible();
    await expect(guide.getByRole("heading", { name: "Tamer Tomoe & Kuro" })).toBeVisible();
    const prologueArt = guide.getByRole("img", { name: /Tomoe and Kuro studying a fresh trail/i });
    await expect(prologueArt).toBeVisible();
    expect(await prologueArt.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThanOrEqual(1200);
    await expect(guide.getByText("A trail found at blue hour")).toBeVisible();
    await expect(guide.getByRole("button", { name: "Close Tomoe's field guide" })).toBeFocused();
    await expect(guide.getByRole("navigation", { name: "Pet battle lessons" }).getByRole("button")).toHaveCount(7);
    await expect(guide.getByText("0 / 7 lessons")).toBeVisible();
    await guide.getByRole("button", { name: "Page 2: Why Kuro carries two tails" }).click();
    await expect(guide.getByText(/born with one tail/i)).toBeVisible();
    await expect(guide.getByText(/no hidden stat bonus/i)).toBeVisible();
    const guideBounds = await guide.boundingBox();
    const curriculumBounds = await guide.getByRole("navigation", { name: "Pet battle lessons" }).boundingBox();
    const lessonBounds = await guide.locator(".pet-mentor-lesson").boundingBox();
    expect(guideBounds).not.toBeNull();
    expect(curriculumBounds).not.toBeNull();
    expect(lessonBounds).not.toBeNull();
    if (testInfo.project.name === "chromium-phone") {
        expect(curriculumBounds!.width).toBeGreaterThanOrEqual(guideBounds!.width - 2);
        expect(lessonBounds!.width).toBeGreaterThanOrEqual(guideBounds!.width - 2);
        expect(lessonBounds!.x).toBeLessThanOrEqual(guideBounds!.x + 1);
    }
    const guideAccessibility = await new AxeBuilder({ page })
        .include(".pet-mentor-modal")
        .withTags(["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa"])
        .analyze();
    expect(guideAccessibility.violations).toEqual([]);
    await assertFitsViewport(page);

    while (await guide.getByRole("button", { name: "Next lesson page →" }).count()) {
        await guide.getByRole("button", { name: "Next lesson page →" }).click();
    }
    await guide.getByRole("button", { name: "Complete lesson & continue" }).click();
    await expect(guide.getByText("1 / 7 lessons")).toBeVisible();
    await expect(guide.getByText("The bell between lessons")).toBeVisible();

    await guide.getByRole("button", { name: /Warfront/ }).click();
    const warfrontHeading = guide.getByRole("heading", { name: "Command Beastbound Warfront" });
    await expect(warfrontHeading).toBeVisible();
    await expect(warfrontHeading).toBeInViewport();
    expect(await guide.locator(".pet-mentor-lesson").evaluate((lesson) => lesson.scrollTop)).toBeLessThanOrEqual(1);
    // Hollow Warfront is the RITE now — four a side at once, best of three
    // clashes. The lesson used to teach Ward Towers and lane redirects, which
    // are rules the mode no longer has (docs/hollow-warfront-rite.md).
    await expect(guide).toContainText(/two clashes out of three/i);
    await expect(guide).not.toContainText(/Ward Tower/i);
    await expect(guide.locator(".pet-mentor-hero")).toBeInViewport();
    const modalBody = await guide.locator(".ui-modal-body--bare").evaluate((body) => ({
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        scrollTop: body.scrollTop,
    }));
    expect(modalBody.scrollTop).toBe(0);
    expect(modalBody.scrollHeight).toBeLessThanOrEqual(modalBody.clientHeight + 1);
    await assertFitsViewport(page);

    await page.screenshot({
        path: testInfo.outputPath(`tomoe-field-guide-${testInfo.project.name}.png`),
        fullPage: true,
        animations: "disabled",
    });

    await guide.getByRole("button", { name: "Close Tomoe's field guide" }).click();
    await expect(guide).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
});

test("the completed course reveals Tomoe and Kuro's illustrated farewell", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "the epilogue asset only needs one browser certification");
    await installApi(page, 0, [...PET_TUTORIAL_LESSON_IDS]);
    await openArena(page);
    await page.getByRole("button", { name: "Open Tamer Tomoe's pet battle field guide" }).click();

    const guide = page.getByRole("dialog", { name: "Tamer Tomoe & Kuro" });
    await expect(guide.getByText("The bell at dawn")).toBeVisible();
    const finaleArt = guide.getByRole("img", { name: /Tomoe and Kuro departing at dawn/i });
    await expect(finaleArt).toBeVisible();
    expect(await finaleArt.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThanOrEqual(1200);
    await expect(guide.getByText(/next lesson is no longer theirs to give/i)).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath("tomoe-field-guide-epilogue.png"),
        fullPage: true,
        animations: "disabled",
    });
});
