import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { PUBLIC_CAPABILITY_IDS } from "../../shared/public-capabilities";
import { PET_CAP_BASE } from "../src/lib/entitlements";

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
    pet("qa-fire-1", "rare-26", "Ember Ocelot", "Fire", "rare", 8, {
        image: "/pet-poses/rare-26-idle.webp",
        nickname: "Sumi",
        trait: "Swift",
        loadout: { pvp: "pvp-aegis-pendant", consumable: "consum-smoke-pellet" },
    }),
    pet("qa-fire-2", "legendary-6", "Ember Phoenix", "Fire", "legendary", 6, { image: "/pet-poses/legendary-6-idle.webp", origin: "bred", generation: 2, trait: "Battleborn" }),
    pet("qa-water-1", "rare-1", "Tideback Otter", "Water", "rare", 7, { image: "/pet-poses/rare-1-idle.webp", trait: "Guardian" }),
    pet("qa-fire-spent", "standard-26", "Ember Mole", "Fire", "standard", 0, { image: "/pet-poses/standard-26-idle.webp", paletteVariantId: "chromatic-v1", origin: "event", trait: "Lucky" }),
];

const SUPPORTER_PET_CAP = 6;
const fullRosterPets = [
    pet("qa-wind-1", "rare-16", "Gale Heron", "Wind", "rare", 5, { image: "/pet-poses/rare-16-idle.webp" }),
    pet("qa-earth-1", "rare-21", "Stoneback Tanuki", "Earth", "rare", 5, { image: "/pet-poses/rare-21-idle.webp" }),
];

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
        totalPetWins: 27,
        dailyPetWins: 1,
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
        // This certification deliberately mutates its mocked server fixture
        // between hard reloads. The unload guard correctly preserves the old
        // document as a recovery draft, but that synthetic draft must not cover
        // the next fixture state or intercept Pet Home controls.
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (key?.startsWith("ninjav-save-conflict-v1:")) localStorage.removeItem(key);
        }
        localStorage.setItem("ninjav-admin-build-v1", JSON.stringify({ currentAccountName: "PetHomeVisualQA" }));
        localStorage.setItem("shinobix:activePlayerPersist", "PetHomeVisualQA");
        localStorage.setItem("shinobix:activeTokenPersist", "qa-session-token");
        localStorage.setItem("shinobix:storage-notice-ack", "1");
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname.toLowerCase();
        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        // Live-capability ADMISSIONS fail closed: an unresolved check leaves
        // availability "unknown", which holds boot restore and polling shut so
        // the shell never reaches Pet Home. (It no longer raises a full-screen
        // blocker — that is reserved for an explicit "unavailable" — but the
        // stalled boot is just as fatal here.) Grant the full public set so
        // these tests measure the screen.
        if (path === "/api/player/capabilities") {
            return json(route, {
                ok: true,
                capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
                    id,
                    { state: "available", reason: "available" },
                ])),
            });
        }
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
            const destination = state.character.pets.length >= SUPPORTER_PET_CAP ? "sanctuary" : "roster";
            if (destination === "sanctuary") state.sanctuaryItems.unshift({ schemaVersion: 1, pet: child, page: 1, storedAt: Date.now(), source: "bred" });
            state.character = { ...state.character, petBreeding: null, pets: destination === "roster" ? [...state.character.pets, child] : state.character.pets };
            return json(route, { ok: true, character: state.character, pet: child, destination, _saveVersion: ++state.saveVersion, replayed: false });
        }
        if (path === "/api/pet/sanctuary/list") return json(route, { ok: true, items: state.sanctuaryItems, total: state.sanctuaryItems.length, nextCursor: null, carriedCount: state.character.pets.length, carriedCapacity: SUPPORTER_PET_CAP });
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
                if (state.character.pets.length >= SUPPORTER_PET_CAP) return json(route, { error: "carried-roster-full", message: "Your carried roster is full." }, 409);
                const storedIndex = state.sanctuaryItems.findIndex((entry) => entry.pet.id === petId);
                if (storedIndex < 0) return json(route, { error: "pet-not-in-sanctuary" }, 404);
                const [storedItem] = state.sanctuaryItems.splice(storedIndex, 1);
                state.character = { ...state.character, pets: [...state.character.pets, storedItem.pet] };
                return json(route, { ok: true, action: body.action, replayed: false, pet: storedItem.pet, character: state.character, _saveVersion: ++state.saveVersion });
            }
            return json(route, { error: "invalid-action" }, 400);
        }
        if (path === "/api/pet/warfront-start") {
            const body = request.postDataJSON() as { resumeOnly?: boolean };
            if (body.resumeOnly) return route.fulfill({ status: 204 });
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
    await expect(page.getByRole("heading", { name: "Pet Home", exact: true })).toBeVisible();
    await expect(page.locator(".session-restore-overlay")).toHaveCount(0);
}

async function reloadHome(page: Page) {
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Pet Home", exact: true })).toBeVisible();
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
    const homeFacility = page.getByRole("button", { name: "Enter Pet Home" });
    await expect(homeFacility).toBeVisible();
    await shot(page, testInfo, "01-village-home-facility");
    await homeFacility.click();
    await expect(page.getByRole("heading", { name: "Pet Home", exact: true })).toBeVisible();
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

    await expect(page.locator(".pet-sanctuary-ledger")).toContainText(`4/${SUPPORTER_PET_CAP}`);
    await page.getByRole("button", { name: "Move to Sanctuary" }).click();
    await expect(page.locator(".pet-sanctuary-message")).toContainText("Sumi is resting safely");
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(3);
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText(`3/${SUPPORTER_PET_CAP}`);
    const depositedPet = page.locator(".pet-sanctuary-card", { hasText: "Sumi" });
    await expect(depositedPet).toHaveCount(1);
    await depositedPet.getByRole("button", { name: "Add to carried" }).click();
    await expect(page.locator(".pet-sanctuary-message")).toContainText("Sumi joined your carried roster");
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(2);
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText(`4/${SUPPORTER_PET_CAP}`);
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

    state.character.pets = [...structuredClone(basePets), ...structuredClone(fullRosterPets)];
    state.character.petBreeding = session("egg", [3, 1, 5]);
    await reloadHome(page);
    await page.getByRole("button", { name: "Breeding" }).click();
    const fullRoster = page.getByRole("button", { name: "Hatch to Sanctuary" });
    await expect(fullRoster).toBeEnabled();
    await expect(page.getByText(/will hatch safely into the Sanctuary/)).toBeVisible();
    await fullRoster.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "11-full-roster-routes-hatch-to-sanctuary");
    await fullRoster.click();
    await expect(page.getByRole("dialog", { name: "Ashglow Kit" })).toBeVisible();
    await expect(page.getByText(/resting safely in the Sanctuary/)).toBeVisible();
    await page.getByRole("button", { name: "Rest well" }).click();
    await page.getByRole("button", { name: "Sanctuary", exact: true }).click();
    await expect(page.locator(".pet-sanctuary-card", { hasText: "Ashglow Kit" })).toBeVisible();

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
    const readiness = page.locator(".pet-battle-readiness");
    await expect(readiness.getByRole("heading", { name: "Battle Deployment" })).toBeVisible();
    await expect(readiness).toContainText("Pet Colosseum");
    await expect(readiness).toContainText("Hollow Warfront");
    await expect(readiness).toContainText("Aegis Pendant");
    await expect(readiness).toContainText("27 victories");
    await expect(readiness.getByRole("button", { name: /Deploy Sumi/ })).toBeEnabled();
    await expect(readiness.getByRole("button", { name: /Add Sumi to Squad/ })).toBeEnabled();
    await shot(page, testInfo, "14-existing-pet-yard-tab");
    await readiness.screenshot({ path: testInfo.outputPath("14a-battle-deployment-console.png"), animations: "disabled" });

    await readiness.getByRole("button", { name: /Add Sumi to Squad/ }).click();
    await expect(page.getByRole("heading", { name: "Hollow Warfront", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Hollow Warfront/ })).toHaveAttribute("aria-current", "page");
    const deployedWarfrontPet = page.locator(".pet-pick", { hasText: "Sumi" });
    await expect(deployedWarfrontPet).toHaveClass(/selected/);
    await expect(deployedWarfrontPet.locator(".pet-pick-order")).toHaveText("1");
    await page.getByRole("button", { name: "Pet Yard" }).click();
    await expect(page.getByRole("heading", { name: /Pet Yard/ }).first()).toBeVisible();

    await page.locator(".pet-battle-readiness").getByRole("button", { name: /Deploy Sumi/ }).click();
    await expect(page.getByRole("heading", { name: "The Colosseum", exact: true })).toBeVisible();
    await expect(page.locator(".showdown-roster-card", { hasText: "Sumi" })).toHaveClass(/picked/);
    await page.getByRole("button", { name: /Pet Arena/ }).click();
    await page.getByRole("button", { name: "Pet Yard" }).click();
    await expect(page.getByRole("heading", { name: /Pet Yard/ }).first()).toBeVisible();

    await page.getByRole("button", { name: "Pet Arena" }).click();
    await expect(page.getByRole("heading", { name: "Pet Colosseum", exact: true })).toBeVisible();
    await expect(page.locator(".pet-arena-selector")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /Hollow Warfront/ })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
        message: "the redesigned Pet Arena must not create desktop horizontal overflow",
    }).toBe(true);
    await shot(page, testInfo, "14b-desktop-pet-arena-command-deck");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
        message: "the redesigned Pet Arena must not create mobile horizontal overflow",
    }).toBe(true);
    await expect(page.locator(".pet-home-tabs button")).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Breeding Barn" })).toBeVisible();
    await expect.poll(() => page.locator(".pet-home-tabs").evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth + 1), {
        message: "all five Pet Home destinations should fit without a clipped mobile tab rail",
    }).toBe(true);
    const activityRows = await page.locator(".pet-arena-activity-nav button").evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    expect(new Set(activityRows).size).toBe(1);
    await expect.poll(() => page.locator('.pet-arena-selector[data-side="player"] .pet-pick-strip').evaluate((strip) => strip.scrollWidth > strip.clientWidth), {
        message: "mobile pet selection should use a compact horizontal touch carousel",
    }).toBe(true);
    await shot(page, testInfo, "14c-mobile-pet-arena-command-deck");
    await page.setViewportSize({ width: 1366, height: 768 });

    const arenaReturn = page.locator(".pet-arena-return");
    await expect(arenaReturn).toContainText("Village");
    await arenaReturn.click();
    await expect(page.locator(".stormveil-village-screen")).toBeVisible();

    await page.goto("/#/centralHub", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".central-hub")).toBeVisible();
    await page.locator(".central-card", { hasText: "Pet Colosseum" }).click();
    await expect(page.getByRole("heading", { name: "Pet Colosseum", exact: true })).toBeVisible();
    await expect(page.locator(".pet-arena-return")).toContainText("Central · The Gates");
    await page.locator(".pet-arena-return").click();
    await expect(page.locator(".central-hub")).toBeVisible();

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

test("Pet battle readiness mirrors server admission and lineage rules", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "the Warfront admission contract is certified once in desktop Chromium");
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const state = await installPetHomeApi(page);
    state.character.pets = [...structuredClone(basePets), ...structuredClone(fullRosterPets)];
    const selectedPet = state.character.pets[0];
    const past = Date.now() - 60_000;
    selectedPet.training = { type: "strength", endsAt: past };

    await openHome(page);
    await page.getByRole("button", { name: "Pet Yard" }).click();
    const yardHint = page.getByRole("button", { name: /got it/i });
    if (await yardHint.isVisible().catch(() => false)) await yardHint.click();
    let readiness = page.locator(".pet-battle-readiness");
    let warfront = readiness.locator('[data-circuit="warfront"]');
    let colosseum = readiness.locator('[data-circuit="colosseum"]');
    await expect(warfront).toContainText("Training results unclaimed");
    await expect(warfront.getByRole("button", { name: /Collect training results/ })).toBeDisabled();
    await expect(colosseum.getByRole("button", { name: /Deploy Sumi/ })).toBeEnabled();

    delete selectedPet.training;
    selectedPet.expedition = { type: "scout", startedAt: past - 60_000, endsAt: past, durationMs: 60_000 };
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Pet Yard/ }).first()).toBeVisible();
    readiness = page.locator(".pet-battle-readiness");
    warfront = readiness.locator('[data-circuit="warfront"]');
    colosseum = readiness.locator('[data-circuit="colosseum"]');
    await expect(warfront).toContainText("Expedition results unclaimed");
    await expect(warfront.getByRole("button", { name: /Collect expedition results/ })).toBeDisabled();
    await expect(colosseum.getByRole("button", { name: /Deploy Sumi/ })).toBeEnabled();

    delete selectedPet.expedition;
    state.character.petBreeding = session("breeding");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Pet Yard/ }).first()).toBeVisible();
    readiness = page.locator(".pet-battle-readiness");
    warfront = readiness.locator('[data-circuit="warfront"]');
    colosseum = readiness.locator('[data-circuit="colosseum"]');
    await expect(warfront).toContainText("Committed to the Breeding Barn");
    await expect(warfront.getByRole("button", { name: /Breeding in progress/ })).toBeDisabled();
    await expect(colosseum.getByRole("button", { name: /Committed to the Breeding Barn/ })).toBeDisabled();

    await page.goto("/#/centralHub", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".central-hub")).toBeVisible();
    await page.locator(".central-card", { hasText: "Pet Colosseum" }).click();
    await expect(page.getByRole("heading", { name: "Pet Colosseum", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Enter the Colosseum/ }).click();
    await expect(page.getByRole("heading", { name: "The Colosseum", exact: true })).toBeVisible();
    const breedingColosseumPet = page.locator(".showdown-roster-card", { hasText: "Sumi" });
    await expect(breedingColosseumPet).toBeDisabled();
    await expect(breedingColosseumPet).toContainText("Breeding barn");

    state.character.petBreeding = null;
    selectedPet.breedingSessionId = "completed-breeding-session";
    await openHome(page);
    await page.getByRole("button", { name: "Pet Yard" }).click();
    readiness = page.locator(".pet-battle-readiness");
    await expect(readiness.getByRole("button", { name: /Deploy Sumi/ })).toBeEnabled();
    await expect(readiness.getByRole("button", { name: /Add Sumi to Squad/ })).toBeEnabled();
    await readiness.getByRole("button", { name: /Deploy Sumi/ }).click();
    await expect(page.getByRole("heading", { name: "The Colosseum", exact: true })).toBeVisible();
    const bredColosseumPet = page.locator(".showdown-roster-card", { hasText: "Sumi" });
    await expect(bredColosseumPet).toBeEnabled();
    await expect(bredColosseumPet).toHaveClass(/picked/);

    delete selectedPet.breedingSessionId;
    selectedPet.training = { type: "strength", endsAt: past };
    await openHome(page);
    await page.getByRole("button", { name: "Pet Arena" }).click();
    const warfrontTab = page.getByRole("button", { name: /Hollow Warfront/ });
    await expect(warfrontTab).toBeEnabled();
    await expect(page.locator(".pet-arena-readiness")).toContainText("5 companions");
    await warfrontTab.click();
    await expect(page.getByRole("heading", { name: "Hollow Warfront", exact: true })).toBeVisible();
    await expect(page.locator(".pet-pick", { hasText: "Sumi" })).toHaveCount(0);
    await expect(page.locator(".pet-pick")).toHaveCount(5);
    await expect(page.getByText("Your team (4/4)")).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors.filter((message) => message !== "Failed to fetch")).toEqual([]);
});

test("a base roster unlocks Tactical while lapsed Supporter overflow stays preserved", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "the entitlement transition is certified once in desktop Chromium");
    const state = await installPetHomeApi(page);
    state.character.patreon = { ...state.character.patreon, active: false };
    state.character.pets = structuredClone(basePets);

    // Sized off PET_CAP_BASE rather than literals. This spec was written when the
    // base cap was 4; when the cap became 5 the hardcoded "4/4" stopped matching
    // anything, and WHICH pet falls into overflow moved as well -- so read that
    // off the same ordering the entitlement uses (array order, no active ids set).
    const fullRoster = [...basePets, ...fullRosterPets];
    const overflowPets = fullRoster.slice(PET_CAP_BASE) as (PetFixture & { nickname?: string })[];
    expect(overflowPets.length).toBeGreaterThan(0);
    const overflowPetName = overflowPets[0].nickname ?? overflowPets[0].name;
    const carried = (owned: number) => Math.min(owned, PET_CAP_BASE);

    await openHome(page);
    await page.getByRole("button", { name: "Pet Yard" }).click();
    await expect(page.getByText(new RegExp(`${carried(basePets.length)}/${PET_CAP_BASE} combat-carried · ${basePets.length} owned`))).toBeVisible();
    await page.getByRole("button", { name: "Pet Arena" }).click();
    await expect(page.getByRole("button", { name: /Hollow Warfront/ })).toBeEnabled();
    await expect(page.getByText(/Locked: 3\/4 pets/)).toHaveCount(0);

    state.character.pets = [...structuredClone(basePets), ...structuredClone(fullRosterPets)];
    await openHome(page);
    await page.getByRole("button", { name: "Pet Yard" }).click();
    await expect(page.getByText(new RegExp(`${carried(fullRoster.length)}/${PET_CAP_BASE} combat-carried · ${fullRoster.length} owned`))).toBeVisible();
    await expect(page.getByText(new RegExp(`${overflowPets.length} preserved overflow`))).toBeVisible();
    await page.getByRole("button", { name: `Select ${overflowPetName}` }).click();
    const overflowReadiness = page.locator(".pet-battle-readiness");
    await expect(overflowReadiness.locator('[data-circuit="colosseum"]')).toContainText("Resting in Sanctuary");
    await expect(overflowReadiness.locator('[data-circuit="warfront"]')).toContainText("Resting in Sanctuary");

    await page.getByRole("button", { name: "Pet Arena" }).click();
    await page.getByRole("button", { name: /Enter the Colosseum/ }).click();
    const overflowColosseumPet = page.locator(".showdown-roster-card", { hasText: overflowPetName });
    await expect(overflowColosseumPet).toBeDisabled();
    await expect(overflowColosseumPet).toContainText("Resting in Sanctuary");
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
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText(`4/${SUPPORTER_PET_CAP}`);
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(2);
    await expect(page.getByText("No ownership cap")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
        message: "the Sanctuary must not create horizontal overflow at 390px",
    }).toBe(true);

    await page.getByRole("button", { name: "Move to Sanctuary" }).click();
    await expect(page.locator(".pet-sanctuary-message")).toContainText("Sumi is resting safely");
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText(`3/${SUPPORTER_PET_CAP}`);
    const depositedPet = page.locator(".pet-sanctuary-card", { hasText: "Sumi" });
    await depositedPet.getByRole("button", { name: "Add to carried" }).click();
    await expect(page.locator(".pet-sanctuary-message")).toContainText("Sumi joined your carried roster");
    await expect(page.locator(".pet-sanctuary-ledger")).toContainText(`4/${SUPPORTER_PET_CAP}`);
    await expect(page.locator(".pet-sanctuary-card")).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
        message: "the round trip must preserve the mobile viewport",
    }).toBe(true);
    await shot(page, testInfo, "mobile-sanctuary-round-trip");

    expect(consoleErrors).toEqual([]);
    expect(pageErrors.filter((message) => message !== "Failed to fetch")).toEqual([]);
});
