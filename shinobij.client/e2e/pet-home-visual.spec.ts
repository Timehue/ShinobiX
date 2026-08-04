import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

type PetFixture = Record<string, unknown> & {
    id: string;
    name: string;
    element: string;
    rarity: string;
    breedingUsesMax: number;
    breedingUsesRemaining: number;
};

type RequirementFixture = {
    id: string;
    category: "care" | "adventure" | "elementalBond";
    kind: string;
    label: string;
    progress: number;
    target: number;
    element?: string;
};

type SessionFixture = {
    sessionId: string;
    state: "breeding" | "egg";
    parentIds: [string, string];
    parentNames: [string, string];
    parentElement: string;
    startedAt: number;
    readyAt: number;
    eggCreatedAt?: number;
    requirements?: RequirementFixture[];
    rulesVersion: number;
};

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function pet(
    id: string,
    templateId: string,
    name: string,
    element: string,
    rarity: string,
    uses: number,
    extra: Record<string, unknown> = {},
): PetFixture {
    return {
        id,
        templateId,
        name,
        element,
        rarity,
        level: rarity === "legendary" ? 75 : rarity === "rare" ? 60 : 50,
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
        breedingUsesMax: Math.max(uses, 8),
        breedingUsesRemaining: uses,
        ...extra,
    };
}

const basePets: PetFixture[] = [
    pet("qa-fire-1", "rare-26", "Ember Ocelot", "Fire", "rare", 8, { image: "/pet-poses/rare-26-idle.webp", nickname: "Sumi", trait: "Swift" }),
    pet("qa-fire-2", "legendary-6", "Ember Phoenix", "Fire", "legendary", 6, { image: "/pet-poses/legendary-6-idle.webp", origin: "bred", generation: 2, trait: "Battleborn" }),
    pet("qa-water-1", "rare-1", "Tideback Otter", "Water", "rare", 7, { image: "/pet-poses/rare-1-idle.webp", trait: "Guardian" }),
    pet("qa-fire-spent", "standard-26", "Ember Mole", "Fire", "standard", 0, { image: "/pet-poses/standard-26-idle.webp", paletteVariantId: "chromatic-v1", origin: "event", trait: "Lucky" }),
];

const fullRosterPet = pet("qa-wind-1", "rare-16", "Gale Heron", "Wind", "rare", 5, { image: "/pet-poses/rare-16-idle.webp" });

function requirements(progress: [number, number, number]): RequirementFixture[] {
    return [
        { id: "care", category: "care", kind: "feed", label: "Share nourishing pet feed", progress: progress[0], target: 3 },
        { id: "adventure", category: "adventure", kind: "expedition", label: "Complete an expedition together", progress: progress[1], target: 1 },
        { id: "elemental", category: "elementalBond", kind: "fire-jutsu", label: "Channel Fire techniques", progress: progress[2], target: 5, element: "Fire" },
    ];
}

function session(state: "breeding" | "egg", requirementProgress?: [number, number, number]): SessionFixture {
    const now = Date.now();
    return {
        sessionId: `qa-${state}`,
        state,
        parentIds: ["qa-fire-1", "qa-fire-2"],
        parentNames: ["Sumi", "Ember Phoenix"],
        parentElement: "Fire",
        startedAt: now - 3_600_000,
        readyAt: state === "breeding" ? now + 82_455_000 : now - 1_000,
        eggCreatedAt: state === "egg" ? now - 1_000 : undefined,
        requirements: requirementProgress ? requirements(requirementProgress) : undefined,
        rulesVersion: 1,
    };
}

function baseCharacter() {
    return {
        name: "PetHomeVisualQA",
        village: "Ashen Leaf Village",
        specialty: "Ninjutsu",
        bloodline: "Inferno Cataclysm",
        level: 1,
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
        rankTitle: "Academy Student",
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
        pets: structuredClone(basePets),
        tileCards: [],
        boneCharms: 0,
        auraStones: 0,
        mythicSeals: 0,
        clanBattleContrib: 0,
        clanEventContrib: 0,
        clanMissionContrib: 0,
        villageUpgrades: {},
        onboardingStep: "done",
        examsPassed: ["genin", "chunin", "jonin"],
        patreon: {
            userId: "qa-patron",
            tier: "shinobi-supporter",
            active: true,
            entitledCents: 1_500,
            updatedAt: Date.now(),
            source: "admin",
        },
        petBreeding: null as SessionFixture | null,
    };
}

async function installPetHomeApi(page: Page) {
    const state = {
        character: baseCharacter(),
        hatchPet: null as PetFixture | null,
        sanctuaryItems: [
            { schemaVersion: 1, pet: pet("qa-sanctuary-1", "mythic-10", "Ash Crown Phoenix", "Fire", "mythic", 7, { origin: "bred", trait: "Fateweaver", image: "/pet-portraits/breeding-mythics/mythic-10.webp" }), page: 1, storedAt: Date.now() - 86_400_000, source: "bred" },
            { schemaVersion: 1, pet: pet("qa-sanctuary-2", "rare-1", "Tideback Otter", "Water", "rare", 6, { origin: "wild", paletteVariantId: "chromatic-v1", image: "/pet-poses/rare-1-idle.webp" }), page: 1, storedAt: Date.now() - 172_800_000, source: "wild" },
        ] as Array<{ schemaVersion: 1; pet: PetFixture; page: number; storedAt: number; source: "wild" | "bred" | "roster" }>,
        saveVersion: 7,
    };

    await page.addInitScript(() => {
        localStorage.setItem("ninjav-admin-build-v1", JSON.stringify({ currentAccountName: "PetHomeVisualQA" }));
        localStorage.setItem("shinobix:activePlayerPersist", "PetHomeVisualQA");
        localStorage.setItem("shinobix:activeTokenPersist", "qa-session-token");
        localStorage.setItem("shinobix:storage-notice-ack", "1");
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname.toLowerCase();
        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        if (path === "/api/save/pethomevisualqa") {
            if (request.method() === "GET") return json(route, {
                character: state.character,
                currentBiome: "forest",
                currentSector: 0,
                acceptedMissionIds: [],
                missionProgress: {},
                triggeredEvents: [],
                _saveVersion: state.saveVersion,
            });
            state.saveVersion += 1;
            return json(route, { ok: true, _saveVersion: state.saveVersion });
        }
        if (path === "/api/pet/breeding/status") return json(route, {
            ok: true,
            session: state.character.petBreeding,
            serverTime: Date.now(),
            _saveVersion: state.saveVersion,
        });
        if (path === "/api/pet/breeding/start") {
            state.character.petBreeding = session("breeding");
            return json(route, { ok: true, character: state.character, session: state.character.petBreeding, serverTime: Date.now(), _saveVersion: ++state.saveVersion, replayed: false });
        }
        if (path === "/api/pet/breeding/hatch") {
            const child = structuredClone(state.hatchPet ?? pet("qa-child", "rare-26", "Ashglow Kit", "Fire", "rare", 7, {
                image: "/pet-poses/rare-26-idle.webp", origin: "bred", generation: 3, parentInstanceIds: ["qa-fire-1", "qa-fire-2"], trait: "Lucky",
            }));
            const destination = state.character.pets.length >= 5 ? "sanctuary" : "roster";
            if (destination === "sanctuary") state.sanctuaryItems.unshift({ schemaVersion: 1, pet: child, page: 1, storedAt: Date.now(), source: "bred" });
            state.character = { ...state.character, petBreeding: null, pets: destination === "roster" ? [...state.character.pets, child] : state.character.pets };
            return json(route, { ok: true, character: state.character, pet: child, destination, _saveVersion: ++state.saveVersion, replayed: false });
        }
        if (path === "/api/pet/sanctuary/list") return json(route, { ok: true, items: state.sanctuaryItems, total: state.sanctuaryItems.length, nextCursor: null, carriedCount: state.character.pets.length, carriedCapacity: 5 });
        if (path === "/api/pet/sanctuary/transfer") {
            const body = request.postDataJSON() as { action?: string; petId?: string };
            const petId = String(body.petId ?? "");
            if (body.action === "to-sanctuary") {
                const carriedPet = state.character.pets.find((entry) => entry.id === petId);
                if (!carriedPet) return json(route, { error: "pet-not-carried" }, 404);
                state.character = { ...state.character, pets: state.character.pets.filter((entry) => entry.id !== petId) };
                state.sanctuaryItems.unshift({ schemaVersion: 1, pet: carriedPet, page: 1, storedAt: Date.now(), source: "roster" });
                return json(route, { ok: true, action: body.action, replayed: false, pet: carriedPet, character: state.character, _saveVersion: ++state.saveVersion });
            }
            if (body.action === "to-roster") {
                if (state.character.pets.length >= 5) return json(route, { error: "carried-roster-full", message: "Your carried roster is full." }, 409);
                const storedIndex = state.sanctuaryItems.findIndex((entry) => entry.pet.id === petId);
                if (storedIndex < 0) return json(route, { error: "pet-not-in-sanctuary" }, 404);
                const [storedItem] = state.sanctuaryItems.splice(storedIndex, 1);
                state.character = { ...state.character, pets: [...state.character.pets, storedItem.pet] };
                return json(route, { ok: true, action: body.action, replayed: false, pet: storedItem.pet, character: state.character, _saveVersion: ++state.saveVersion });
            }
            return json(route, { error: "invalid-action" }, 400);
        }
        if (path === "/api/battle-lock") return json(route, { lock: null });
        return json(route, { ok: true, players: [], images: {}, categories: {}, ladder: [], leaderboard: [], announcements: [], eras: [], entries: [], wars: [] });
    });
    return state;
}

async function openHome(page: Page) {
    await page.goto("/#/home", { waitUntil: "networkidle" });
    // The SPA intentionally applies bookmarked hashes during boot rather than
    // reacting to hash-only changes after mount, so force the normal restore path.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(page.locator(".session-restore-overlay")).toHaveCount(0);
}

async function reloadHome(page: Page) {
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
    await expect.poll(async () => page.locator("img").evaluateAll((images) => images
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.getAttribute("src"))), { message: `all artwork must decode before ${name}` }).toEqual([]);
    await page.locator("img").evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
}

test("Pet Home visual lifecycle certification", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "one deterministic Chromium visual certification is sufficient");
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const state = await installPetHomeApi(page);

    await page.goto("/#/village", { waitUntil: "networkidle" });
    const homeFacility = page.getByRole("button", { name: "Enter Home" });
    await expect(homeFacility).toBeVisible();
    await shot(page, testInfo, "01-village-home-facility");
    await homeFacility.click();
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(page.locator(".pet-collection-card")).toHaveCount(4);
    await shot(page, testInfo, "02-desktop-home-collection");

    await page.getByRole("button", { name: "Sanctuary", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Companion Sanctuary" })).toBeVisible();
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(2);
    await expect(page.locator(".pet-sanctuary-card .pet-sanctuary-portrait img")).toHaveCount(2);
    await expect(page.getByText("No ownership cap")).toBeVisible();
    await shot(page, testInfo, "02b-desktop-companion-sanctuary");
    await page.locator(".pet-sanctuary-card").first().scrollIntoViewIfNeeded();
    await shot(page, testInfo, "02c-desktop-sanctuary-habitats");

    await expect(page.locator(".pet-sanctuary-ledger")).toContainText("4/5");
    await page.getByRole("button", { name: "Move to Sanctuary" }).click();
    await expect(page.getByRole("status")).toContainText("Sumi is resting safely");
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(3);
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText("3/5");
    const depositedPet = page.locator(".pet-sanctuary-card", { hasText: "Sumi" });
    await expect(depositedPet).toHaveCount(1);
    await depositedPet.getByRole("button", { name: "Add to carried" }).click();
    await expect(page.getByRole("status")).toContainText("Sumi joined your carried roster");
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(2);
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText("4/5");
    await shot(page, testInfo, "02d-sanctuary-roster-round-trip");

    await page.getByRole("button", { name: "Breeding" }).click();
    await expect(page.getByRole("heading", { name: "Breeding Barn" })).toBeVisible();
    const parent1 = page.getByLabel("First parent");
    const parent2 = page.getByLabel("Second parent");
    await expect(parent1.locator("option", { hasText: "Ember Mole" })).toHaveAttribute("disabled", "");
    await parent1.evaluate((select: HTMLSelectElement) => { select.size = 6; select.style.height = "148px"; });
    await shot(page, testInfo, "03-exhausted-counter-disabled-reason");
    await parent1.evaluate((select: HTMLSelectElement) => { select.removeAttribute("size"); select.style.removeProperty("height"); });

    await parent1.selectOption("qa-fire-1");
    await expect(parent2.locator("option", { hasText: "Tideback Otter" })).toHaveAttribute("disabled", "");
    await expect(parent2.locator("option", { hasText: "Needs Fire" })).toHaveCount(1);
    await parent2.evaluate((select: HTMLSelectElement) => { select.size = 6; select.style.height = "148px"; });
    await shot(page, testInfo, "04-parent-selection-element-mismatch");
    await parent2.evaluate((select: HTMLSelectElement) => { select.removeAttribute("size"); select.style.removeProperty("height"); });

    await parent2.selectOption("qa-fire-2");
    await expect(page.getByText("45%", { exact: true }).first()).toBeVisible();
    await shot(page, testInfo, "05-valid-parent-selection");
    await page.getByRole("button", { name: "Begin 24-hour breeding" }).click();
    const confirmation = page.getByRole("dialog", { name: /Commit Sumi and Ember Phoenix/ });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("One breeding use will be permanently consumed from each parent.");
    await expect(confirmation).toContainText("Breeding takes 24 real hours and cannot be canceled or rerolled.");
    const cancelConfirmation = confirmation.getByRole("button", { name: "Cancel" });
    const commitConfirmation = confirmation.getByRole("button", { name: "Commit parents" });
    await expect(cancelConfirmation).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(commitConfirmation).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancelConfirmation).toBeFocused();
    await shot(page, testInfo, "06-breeding-confirmation");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    state.character.petBreeding = session("breeding");
    await reloadHome(page);
    await page.getByRole("button", { name: "Breeding" }).click();
    await expect(page.locator(".breeding-countdown")).toContainText(/\d{2}:\d{2}:\d{2}/);
    await shot(page, testInfo, "07-in-progress-timer");

    state.character.petBreeding = session("egg", [0, 0, 0]);
    await reloadHome(page);
    await page.getByRole("button", { name: "Breeding" }).click();
    await expect(page.getByText("Fire egg")).toBeVisible();
    const incompleteHatch = page.getByRole("button", { name: "Complete all three bonds" });
    await expect(incompleteHatch).toBeDisabled();
    await incompleteHatch.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "08-egg-ready");

    state.character.petBreeding = session("egg", [2, 1, 3]);
    await reloadHome(page);
    await page.getByRole("button", { name: "Breeding" }).click();
    await expect(page.getByText("2/3")).toBeVisible();
    await expect(page.getByText("1/1")).toBeVisible();
    await expect(page.getByText("3/5")).toBeVisible();
    await page.getByRole("button", { name: "Complete all three bonds" }).scrollIntoViewIfNeeded();
    await shot(page, testInfo, "09-requirement-progress");

    state.character.petBreeding = session("egg", [3, 1, 5]);
    await reloadHome(page);
    await page.getByRole("button", { name: "Breeding" }).click();
    const hatchable = page.getByRole("button", { name: "Hatch companion" });
    await expect(hatchable).toBeEnabled();
    await hatchable.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "10-hatchable-egg");

    state.character.pets = [...structuredClone(basePets), structuredClone(fullRosterPet)];
    state.character.petBreeding = session("egg", [3, 1, 5]);
    await reloadHome(page);
    await page.getByRole("button", { name: "Breeding" }).click();
    const fullRoster = page.getByRole("button", { name: "Hatch to Sanctuary" });
    await expect(fullRoster).toBeEnabled();
    await expect(page.getByText(/will hatch safely into the Sanctuary/)).toBeVisible();
    await fullRoster.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "11-full-roster-routes-hatch-to-sanctuary");

    state.character.pets = structuredClone(basePets);
    state.character.petBreeding = session("egg", [3, 1, 5]);
    state.hatchPet = pet("rare-26:550e8400-e29b-41d4-a716-446655440000", "rare-26", "Ashglow Kit", "Fire", "rare", 7, {
        origin: "bred", generation: 3, parentInstanceIds: ["qa-fire-1", "qa-fire-2"], trait: "Lucky",
    });
    await reloadHome(page);
    await page.getByRole("button", { name: "Breeding" }).click();
    await page.getByRole("button", { name: "Hatch companion" }).click();
    await expect(page.getByRole("dialog", { name: "Ashglow Kit" })).toBeVisible();
    await expect(page.locator(".hatch-pet")).toBeVisible();
    await expect.poll(() => page.locator(".hatch-pet").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await shot(page, testInfo, "12-normal-hatch-reveal");

    state.character.pets = structuredClone(basePets);
    state.character.petBreeding = session("egg", [3, 1, 5]);
    state.hatchPet = pet("legendary-6:550e8400-e29b-41d4-a716-446655440001", "legendary-6", "Aurora Phoenix", "Fire", "legendary", 9, {
        origin: "bred", generation: 3, parentInstanceIds: ["qa-fire-1", "qa-fire-2"], paletteVariantId: "chromatic-v1", trait: "Battleborn",
    });
    await reloadHome(page);
    await page.getByRole("button", { name: "Breeding" }).click();
    await page.getByRole("button", { name: "Hatch companion" }).click();
    await expect(page.getByText("Chromatic miracle")).toBeVisible();
    await expect(page.locator(".hatch-pet")).toBeVisible();
    await shot(page, testInfo, "13-chromatic-hatch-reveal");

    state.character.pets = structuredClone(basePets);
    state.character.petBreeding = null;
    await reloadHome(page);
    await page.getByRole("button", { name: "Pet Yard" }).click();
    await expect(page.getByRole("heading", { name: /Pet Yard/ }).first()).toBeVisible();
    const yardHint = page.getByRole("button", { name: /got it/i });
    if (await yardHint.isVisible().catch(() => false)) await yardHint.click();
    await shot(page, testInfo, "14-existing-pet-yard-tab");

    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    await expect(page.locator(".pet-collection-card")).toHaveCount(4);
    await shot(page, testInfo, "15-mobile-home-collection");
    await page.getByRole("button", { name: "Breeding" }).click();
    await expect(page.getByRole("heading", { name: "Breeding Barn" })).toBeVisible();
    await page.getByRole("button", { name: "Begin 24-hour breeding" }).scrollIntoViewIfNeeded();
    await shot(page, testInfo, "16-mobile-breeding-barn");

    expect((await page.locator("img").evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.getAttribute("src"))))).toEqual([]);
    expect(consoleErrors).toEqual([]);
    // Forced state-to-state reloads can abort an unrelated in-flight app fetch;
    // Chromium reports that navigation artifact as a bare "Failed to fetch".
    expect(pageErrors.filter((message) => message !== "Failed to fetch")).toEqual([]);
});

test("Pet Sanctuary mobile deposit and withdrawal certification", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    test.skip(testInfo.project.name !== "chromium-mobile", "the mobile Sanctuary contract uses the touch-sized Chromium project");
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installPetHomeApi(page);

    await openHome(page);
    await page.getByRole("button", { name: "Sanctuary", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Companion Sanctuary" })).toBeVisible();
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText("4/5");
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(2);
    await expect(page.getByText("No ownership cap")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
        message: "the Sanctuary must not create horizontal overflow at 390px",
    }).toBe(true);

    await page.getByRole("button", { name: "Move to Sanctuary" }).click();
    await expect(page.getByRole("status")).toContainText("Sumi is resting safely");
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText("3/5");
    const depositedPet = page.locator(".pet-sanctuary-card", { hasText: "Sumi" });
    await depositedPet.getByRole("button", { name: "Add to carried" }).click();
    await expect(page.getByRole("status")).toContainText("Sumi joined your carried roster");
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText("4/5");
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
        message: "the round trip must preserve the mobile viewport",
    }).toBe(true);
    await shot(page, testInfo, "mobile-sanctuary-round-trip");

    expect(consoleErrors).toEqual([]);
    expect(pageErrors.filter((message) => message !== "Failed to fetch")).toEqual([]);
});
