import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { PUBLIC_CAPABILITY_IDS } from "../../shared/public-capabilities";
import { PET_CAP_BASE } from "../src/lib/entitlements";
import AxeBuilder from "@axe-core/playwright";

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

// Live-capability ADMISSIONS fail closed: an unresolved check leaves
// availability "unknown", which holds boot restore and polling shut so the shell
// never reaches Pet Home. (It no longer raises a full-screen blocker — that is
// reserved for an explicit "unavailable" — but the stalled boot is just as fatal
// here.) Grant the full public set so these tests measure the screen.
const CAPABILITIES_REPLY = {
    ok: true,
    capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
        id,
        { state: "available", reason: "available" },
    ])),
};

// Every call this fixture does not model.
const GENERIC_REPLY = { ok: true, players: [], images: {}, categories: {}, ladder: [], leaderboard: [], announcements: [], eras: [], entries: [], wars: [] };

// `/api/images?ids=1` must be a parseable manifest (src/lib/shared-image-manifest.ts).
// The generic reply is not one, so the avatar warm-up rejected it and kept
// retrying, feeding extra requests through the interception path every test.
const EMPTY_IMAGE_MANIFEST = { version: "1", ids: [] as string[] };

// The stateless shell traffic every fresh document sends in its first second,
// measured across this whole spec on 2026-09-18. None of it depends on the
// fixture's state, so each call gets GENERIC_REPLY whether the page or the route
// answers it. Paths that read or write fixture state are deliberately absent.
const SHELL_BOOT_PATHS = [
    "/api/world-state",
    "/api/game-state",
    "/api/player/heartbeat",
    "/api/player/roster",
    "/api/pvp/session",
    "/api/battle/lock",
    "/api/village/tax",
    "/api/village/intel",
    "/api/missions/ai-fight-start",
    "/api/achievements/sync",
    "/api/messages",
    "/api/world-crisis",
    "/api/world-crisis-80",
    "/api/save/admin%201",
    "/api/save/admin%202",
];

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

    await page.addInitScript((replies) => {
        // WebKit's page.route drops /api/* requests sent just after a fresh
        // document starts. They reject with "<url> due to access control
        // checks." before the route below runs, and the rejection surfaces as a
        // pageerror. CI has lost world-state, images and capabilities this way,
        // and local runs have lost game-state and heartbeat. It is a
        // Playwright/WebKit interception gap, not an app failure, so the
        // stateless shell calls are answered here, inside the page — the same
        // bypass pet-mentor-guide.spec.ts uses for its autosave. Anything not
        // listed, including every test's own page.route override, still goes to
        // the network and is answered by page.route.
        const nativeFetch = window.fetch.bind(window);
        const reply = (body: unknown) => new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
                window.location.href,
            );
            if (url.origin === window.location.origin) {
                const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
                const path = url.pathname.toLowerCase();
                if (method === "GET" && path === "/api/player/capabilities") return reply(replies.capabilities);
                if (method === "GET" && path === "/api/images") return reply(url.searchParams.get("ids") === "1" ? replies.imageManifest : {});
                if (replies.shellBootPaths.includes(path)) return reply(replies.generic);
            }
            return nativeFetch(input, init);
        };

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
    }, { capabilities: CAPABILITIES_REPLY, imageManifest: EMPTY_IMAGE_MANIFEST, generic: GENERIC_REPLY, shellBootPaths: SHELL_BOOT_PATHS });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname.toLowerCase();
        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        if (path === "/api/player/capabilities") return json(route, CAPABILITIES_REPLY);
        if (path === "/api/images" && request.method() === "GET") {
            return json(route, url.searchParams.get("ids") === "1" ? EMPTY_IMAGE_MANIFEST : {});
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
        return json(route, GENERIC_REPLY);
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

// A fetch aborted by navigation rejects with a bare "Failed to fetch", which
// this spec already tolerates for pageErrors (see the comment at its first use).
// The SAME abort also reaches the console, because src/lib/pet-glb-atlas.ts
// console.errors a rejected atlas load — so a spec that filters one and not the
// other fails ~1-in-3 on its own navigation. Scoped to the transport artifact
// only: a genuinely broken atlas throws "Pet atlas HTTP <status>" or "Missing
// embedded pet atlas", neither of which this hides.
function withoutAbortedFetches(messages: string[]): string[] {
    return messages.filter((message) => !message.endsWith("Failed to fetch"));
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
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Battle & techniques" }).click();
    const readiness = page.locator(".pet-battle-readiness");
    await expect(readiness.getByRole("heading", { name: "Battle Deployment" })).toBeVisible();
    await expect(readiness).toContainText("Pet Colosseum");
    await expect(readiness).toContainText("Beastbound Warfront");
    await expect(readiness).toContainText("Aegis Pendant");
    await expect(readiness).toContainText("27 victories");
    await expect(readiness.getByRole("button", { name: /Deploy Sumi/ })).toBeEnabled();
    await expect(readiness.getByRole("button", { name: /Add Sumi to Squad/ })).toBeEnabled();
    await shot(page, testInfo, "14-existing-pet-yard-tab");
    await readiness.screenshot({ path: testInfo.outputPath("14a-battle-deployment-console.png"), animations: "disabled" });

    await readiness.getByRole("button", { name: /Add Sumi to Squad/ }).click();
    await expect(page.getByRole("heading", { name: "Beastbound Warfront", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Beastbound Warfront/ })).toHaveAttribute("aria-current", "page");
    const deployedWarfrontPet = page.locator(".pet-pick", { hasText: "Sumi" });
    await expect(deployedWarfrontPet).toHaveClass(/selected/);
    await expect(deployedWarfrontPet.locator(".pet-pick-order")).toHaveText("1");
    await page.getByRole("button", { name: "Pet Yard" }).click();
    await expect(page.getByRole("heading", { name: /Pet Yard/ }).first()).toBeVisible();

    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Battle & techniques" }).click();
    await page.locator(".pet-battle-readiness").getByRole("button", { name: /Deploy Sumi/ }).click();
    await expect(page.getByRole("heading", { name: "The Colosseum", exact: true })).toBeVisible();
    await expect(page.locator(".showdown-roster-card", { hasText: "Sumi" })).toHaveClass(/picked/);
    await page.getByRole("button", { name: /Pet Arena/ }).click();
    await page.getByRole("button", { name: "Pet Yard" }).click();
    await expect(page.getByRole("heading", { name: /Pet Yard/ }).first()).toBeVisible();

    await page.getByRole("button", { name: "Pet Arena" }).click();
    await expect(page.getByRole("heading", { name: "Pet Colosseum", exact: true })).toBeVisible();
    await expect(page.locator(".pet-arena-selector")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /Beastbound Warfront/ })).toBeEnabled();
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
    expect(withoutAbortedFetches(consoleErrors)).toEqual([]);
    expect(withoutAbortedFetches(pageErrors)).toEqual([]);
});

test("Pet battle readiness mirrors server admission and lineage rules", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(!["chromium-desktop", "desktop"].includes(testInfo.project.name), "the Warfront admission contract is certified once in desktop Chromium");
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
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Battle & techniques" }).click();
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
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Battle & techniques" }).click();
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
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Battle & techniques" }).click();
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
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Battle & techniques" }).click();
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
    const warfrontTab = page.getByRole("button", { name: /Beastbound Warfront/ });
    await expect(warfrontTab).toBeEnabled();
    await expect(page.locator(".pet-arena-readiness")).toContainText("5 companions");
    await warfrontTab.click();
    await expect(page.getByRole("heading", { name: "Beastbound Warfront", exact: true })).toBeVisible();
    await expect(page.locator(".pet-pick", { hasText: "Sumi" })).toHaveCount(0);
    await expect(page.locator(".pet-pick")).toHaveCount(5);
    await expect(page.getByText("Your team (4/4)")).toBeVisible();

    expect(withoutAbortedFetches(consoleErrors)).toEqual([]);
    expect(withoutAbortedFetches(pageErrors)).toEqual([]);
});

test("a base roster unlocks Tactical while lapsed Supporter overflow stays preserved", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    test.skip(!["chromium-desktop", "desktop"].includes(testInfo.project.name), "the entitlement transition is certified once in desktop Chromium");
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
    await expect(page.locator(".pet-yard-roster-count").filter({ hasText: `${carried(basePets.length)} / ${PET_CAP_BASE}` })).toBeVisible();
    await page.getByRole("button", { name: "Pet Arena" }).click();
    await expect(page.getByRole("button", { name: /Beastbound Warfront/ })).toBeEnabled();
    // The rendered locked copy is "Locked · N/M pets" (middle dot, from the
    // <small> in PetArena.tsx); the separate "Locked: N/M available pets" string
    // is a title ATTRIBUTE that getByText cannot see at all. This assertion was
    // written with the colon form, so it matched nothing and passed no matter
    // what the UI did. Widened to any locked count so it fails if Tactical is
    // ever locked here.
    await expect(page.getByText(/Locked . \d+\/\d+ pets/)).toHaveCount(0);

    state.character.pets = [...structuredClone(basePets), ...structuredClone(fullRosterPets)];
    await openHome(page);
    await page.getByRole("button", { name: "Pet Yard" }).click();
    await expect(page.locator(".pet-yard-roster-count").filter({ hasText: `${carried(fullRoster.length)} / ${PET_CAP_BASE}` })).toBeVisible();
    await expect(page.getByText(new RegExp(`${overflowPets.length} preserved overflow`))).toBeVisible();
    await page.getByRole("button", { name: `Select ${overflowPetName}` }).click();
    await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Battle & techniques" }).click();
    const overflowReadiness = page.locator(".pet-battle-readiness");
    await expect(overflowReadiness.locator('[data-circuit="colosseum"]')).toContainText("Resting in Sanctuary");
    await expect(overflowReadiness.locator('[data-circuit="warfront"]')).toContainText("Resting in Sanctuary");

    await page.getByRole("button", { name: "Pet Arena" }).click();
    await page.getByRole("button", { name: /Enter the Colosseum/ }).click();
    const overflowColosseumPet = page.locator(".showdown-roster-card", { hasText: overflowPetName });
    await expect(overflowColosseumPet).toBeDisabled();
    await expect(overflowColosseumPet).toContainText("Resting in Sanctuary");
});

test("the training gate tells overflow and a Supporter's sixth carried pet apart", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(!["chromium-desktop", "chromium-mobile", "desktop", "phone"].includes(testInfo.project.name), "the training-gate copy is certified on desktop and touch");
    const state = await installPetHomeApi(page);
    // Six pets in array order with no active ids set: a Supporter carries all six
    // but only the first five can train; after a lapse the sixth is overflow.
    state.character.pets = [...structuredClone(basePets), ...structuredClone(fullRosterPets)];
    const sixthPetName = fullRosterPets[fullRosterPets.length - 1].name;
    const sixthPetCard = page.locator(".pet-slot-card", { hasText: sixthPetName });
    const trainingHint = page.locator(".pet-yard-workbench p.hint[role='status']", { hasText: "start training" });
    const openTraining = async () => {
        await openHome(page);
        await page.getByRole("button", { name: "Pet Yard" }).click();
        await page.getByRole("button", { name: `Select ${sixthPetName}` }).click();
        await page.getByRole("navigation", { name: "Pet Yard activities" }).getByRole("button", { name: "Growth & training" }).click();
    };
    const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

    state.character.patreon = { ...state.character.patreon, active: false };
    await openTraining();
    await expect(sixthPetCard).toContainText("Preserved overflow");
    await expect(page.getByRole("button", { name: "Move into carried roster", exact: true })).toBeDisabled();
    await expect(trainingHint).toHaveText("This companion is preserved overflow. Move it into your carried roster through the Sanctuary to start training.");
    await expect.poll(noHorizontalScroll).toBe(true);

    state.character.patreon = { ...state.character.patreon, active: true };
    await openTraining();
    // Text, not visibility: the phone layout hides the roster count.
    await expect(page.locator(".pet-yard-roster-count")).toContainText(`${SUPPORTER_PET_CAP} / ${SUPPORTER_PET_CAP}`);
    await expect(sixthPetCard).not.toContainText("Preserved overflow");
    await expect(page.getByRole("button", { name: "Move into active five", exact: true })).toBeDisabled();
    await expect(trainingHint).toHaveText("This companion is carried but outside your active five. Set it as Active or as your 2v2 Partner, or rest another companion in the Sanctuary, to start training.");
    await expect.poll(noHorizontalScroll).toBe(true);

    // The advice is true: Set as Active pulls the sixth pet into the training five.
    await page.getByRole("button", { name: "Set as Active", exact: true }).click();
    await expect(trainingHint).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start Training", exact: true })).toBeEnabled();
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

    expect(withoutAbortedFetches(consoleErrors)).toEqual([]);
    expect(withoutAbortedFetches(pageErrors)).toEqual([]);
});

test("refined companion and Sunscar pages", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = await installPetHomeApi(page);
    state.character.level = 1;
    state.character.ryo = 1_250_000;
    state.character.fateShards = 350;
    state.character.pets[0].jutsus = [{ name: "Ember Fang", kind: "damage", power: 24, cooldown: 3 }];
    const marketAssets = [
        { id: "qa-blade", kind: "item", category: "weapons", rarity: "legendary", name: "Dawnreaver, the Last Ember", description: "A blade tempered in the final light of the desert.", image: "/items/shop-ashen-dragon-katana-v1.webp", level: 60, stats: [{ label: "Attack", value: "+120" }] },
        { id: "qa-pet", kind: "pet", category: "pets", rarity: "rare", name: "Ember Ocelot", description: "A swift companion of the southern wilds.", image: "/pet-poses/rare-26-idle.webp", level: 60, stats: [{ label: "Breeding Uses Remaining", value: "8" }] },
        { id: "qa-hide", kind: "item", category: "materials", rarity: "uncommon", name: "Torn Hide", description: "A sturdy crafting material.", image: "/items/hunt-torn-hide-v1.webp", stats: [] },
    ];
    const listings = marketAssets.map((asset, i) => ({ id: `listing-${i}`, asset, quantity: i === 2 ? 12 : 1, price: [425_000, 120_000, 41][i], currency: i === 2 ? "fateShards" : "ryo", fee: 0, proceeds: 0, seller: "miraa", sellerName: "Miraa", state: "active", createdAt: Date.now() - i * 1000 }));
    const activity: typeof listings = [];
    const inventory = [{ ...marketAssets[2], quantity: 22 }];
    await page.route("**/api/festival/exchange", async route => {
        const body = route.request().postDataJSON();
        if (body.action === "buy") {
            const listing = listings.find(row => row.id === body.listingId)!;
            if (listing.currency === "fateShards") state.character.fateShards -= listing.price;
            else state.character.ryo -= listing.price;
            listing.state = "sold";
            activity.push(listing);
        }
        if (body.action === "list") {
            activity.push({ ...listings[2], id: "my-listing", seller: "pethomevisualqa", sellerName: "PetHomeVisualQA", price: Number(body.price), currency: body.currency, state: "active" });
        }
        if (body.action === "cancel") activity.find(row => row.id === body.listingId)!.state = "cancelled";
        return json(route, { ok: true, character: state.character, _saveVersion: ++state.saveVersion, listings: listings.filter(row => row.state === "active"), activity, inventory, creatorItems: [], recoveryErrors: [] });
    });
    async function fit(name: string, selector: string) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await expect.poll(() => page.locator(`${selector} img`).evaluateAll(images => images.filter(image => !image.complete || !image.naturalWidth).map(image => image.src))).toEqual([]);
        await page.locator(`${selector} img`).evaluateAll(images => Promise.all(images.map(image => image.decode())));
        await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
        const scan = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(scan.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
        if (name.startsWith("yard-") && name !== "yard-expeditions") {
            await page.locator(".pet-yard-workbench").scrollIntoViewIfNeeded();
            await page.screenshot({ path: testInfo.outputPath(`${name}-controls.png`), animations: "disabled" });
        }
        if (name === "sunscar-festival") {
            await page.locator(".sunscar-market-row").scrollIntoViewIfNeeded();
            await page.screenshot({ path: testInfo.outputPath("sunscar-trading-quarter.png"), animations: "disabled" });
        }
    }
    await page.goto("/#/pets", { waitUntil: "networkidle", timeout: 120_000 });
    await expect(page.locator(".pet-yard-refined")).toBeVisible();
    const hint = page.getByRole("button", { name: /got it/i });
    if (await hint.isVisible()) await hint.click();
    const activities = page.getByRole("navigation", { name: "Pet Yard activities" });
    await expect(page.getByRole("heading", { name: "Care & companionship" })).toBeVisible();
    await expect(page.locator(".pet-expedition-board")).toHaveCount(0);
    await expect(page.locator(".pet-loadout-panel")).toHaveCount(0);
    await fit("yard-care", ".pet-yard-refined");
    await activities.getByRole("button", { name: /Growth & training/ }).click();
    await expect(page.getByLabel("Duration", { exact: true })).toBeVisible();
    const initialGrowth = await page.getByLabel("Vitality points", { exact: true }).textContent();
    await page.getByRole("button", { name: "Add Vitality point", exact: true }).click();
    await expect(page.getByLabel("Vitality points", { exact: true })).not.toHaveText(initialGrowth!);
    await page.getByRole("button", { name: "Remove staged Vitality point", exact: true }).click();
    await expect(page.getByLabel("Vitality points", { exact: true })).toHaveText(initialGrowth!);
    await fit("yard-growth", ".pet-yard-refined");
    await activities.getByRole("button", { name: "Equipment", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Loadout", exact: true })).toBeVisible();
    await fit("yard-equipment", ".pet-yard-refined");
    await activities.getByRole("button", { name: "Battle & techniques", exact: true }).click();
    await expect(page.getByText("Ember Fang", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deploy Sumi" })).toBeEnabled();
    await fit("yard-techniques", ".pet-yard-refined");
    await activities.getByRole("button", { name: "Expeditions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Expedition Board", exact: true })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Expedition route" }).getByRole("radio")).toHaveCount(3);
    await fit("yard-expeditions", ".pet-yard-refined");
    // Entry notifications must still land on the selected companion's expedition.
    await activities.getByRole("button", { name: "Care", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("shinobix:open-pet-expedition", { detail: { petId: "qa-fire-1" } })));
    await expect(page.getByRole("heading", { name: "Expedition Board", exact: true })).toBeVisible();

    await page.goto("/#/sunscarFestival", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".sunscar-hub-refined")).toBeVisible();
    await fit("sunscar-festival", ".sunscar-hub-refined");
    await page.getByRole("button", { name: "Enter the Exchange" }).click();
    await expect(page.locator(".sx-listing")).toHaveCount(3);
    await fit("sunscar-market", ".sx-refined");
    await page.getByRole("button", { name: "Pets", exact: true }).click();
    await expect(page.locator(".sx-listing")).toHaveCount(1);
    await page.locator(".sx-listing").click();
    await expect(page.getByRole("dialog")).toContainText("Breeding Uses Remaining");
    await fit("market-inspection", ".sx-dialog");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "All treasures", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search the Exchange" }).fill("no such treasure");
    await expect(page.getByText("No treasures match these filters")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("combobox", { name: "Listing currency", exact: true }).selectOption("fateShards");
    await expect(page.locator(".sx-listing")).toHaveCount(1);
    await page.locator(".sx-listing").click();
    await page.getByRole("button", { name: "Buy for 41 Fate Shards", exact: true }).click();
    await expect(page.locator(".sx-success")).toContainText("Purchase complete");
    await expect(page.locator(".sx-wallet")).toContainText("309 Fate Shards");
    await page.getByRole("button", { name: "Sell an asset", exact: true }).click();
    await page.getByText("Torn Hide", { exact: true }).click();
    await page.getByLabel("Total asking price", { exact: false }).fill("200");
    await page.getByRole("button", { name: /Review listing/ }).click();
    await fit("market-sale-review", ".sx-dialog");
    await page.getByRole("button", { name: "Publish listing", exact: true }).click();
    await expect(page.locator(".sx-success")).toContainText("Listing published");
    await page.getByText("Torn Hide", { exact: true }).click();
    await page.getByRole("button", { name: "Cancel listing & return goods", exact: true }).click();
    await expect(page.locator(".sx-success")).toContainText("Listing cancelled");
    await page.getByRole("button", { name: "Sunscar Festival", exact: false }).click();
    await expect(page.locator(".sunscar-hub-refined")).toBeVisible();
    expect(withoutAbortedFetches(errors)).toEqual([]);
});

test("refined integration companion actions and recovery", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(!['desktop', 'phone', 'chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name), 'Interaction coverage uses desktop and touch; visual coverage runs at all four widths.');
    const state = await installPetHomeApi(page);
    state.character.fateShards = 30;
    state.character.pets[0].training = { type: 'bond', startedAt: Date.now() - 100_000, endsAt: Date.now() - 1000, durationMs: 900_000, sealedXp: 35 };
    const requests: Array<Record<string, unknown>> = [];
    let trainingAttempts = 0;
    await page.route('**/api/pet/progress', async route => {
        const body = route.request().postDataJSON();
        requests.push(body);
        const current = state.character.pets.find(p => p.id === body.petId)!;
        if (body.action === 'complete-training') {
            if (++trainingAttempts === 1) return json(route, { error: 'Training desk unavailable. Please retry.' }, 503);
            delete current.training;
            current.xp = Number(current.xp) + 35;
        } else if (body.action === 'allocate-growth') current.growthAllocation = body.allocation;
        else if (body.action === 'nickname') {
            await new Promise(resolve => setTimeout(resolve, 250));
            current.nickname = body.nickname;
            state.character.fateShards -= 10;
        } else if (body.action === 'equip') current.loadout = { ...(current.loadout as object), [body.slot]: body.itemId };
        return json(route, { ok: true, pet: current, character: state.character, settledTraining: body.action === 'complete-training' ? 'bond' : null, _saveVersion: ++state.saveVersion });
    });
    await page.goto('/#/pets', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Select Sumi', exact: true }).click();
    await page.getByRole('button', { name: 'Collect Results', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Training desk unavailable');
    await page.locator('.game-alert-ok').click();
    await expect(page.getByRole('button', { name: 'Collect Results', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Collect Results', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('completed bond training');
    await page.locator('.game-alert-ok').click();
    await expect(page.getByRole('button', { name: 'Start Training', exact: true })).toBeVisible();
    await expect(page.locator('.pet-xp-line')).toContainText('35/');
    await page.getByRole('button', { name: 'Add Vitality point', exact: true }).click();
    await page.getByRole('button', { name: 'Commit Build', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Commit Build', exact: true })).toBeDisabled();
    expect(state.character.pets[0].growthAllocation).toMatchObject({ vitality: 1 });
    const nav = page.getByRole('navigation', { name: 'Pet Yard activities' });
    await nav.getByRole('button', { name: 'Care', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Rename companion' }).click();
    await page.getByLabel('Nickname', { exact: true }).fill('Unsubmitted name');
    await page.getByRole('button', { name: 'Select Ember Phoenix', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Rename companion' }).click();
    await expect(page.getByLabel('Nickname', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Select Sumi', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Rename companion' }).click();
    await page.getByLabel('Nickname', { exact: true }).fill('Kohaku');
    await page.getByRole('button', { name: 'Rename', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(page.getByRole('button', { name: 'Select Kohaku', exact: true })).toBeVisible();
    expect(requests.filter(request => request.action === 'nickname')).toHaveLength(1);
    expect(state.character.fateShards).toBe(20);
    await nav.getByRole('button', { name: 'Equipment', exact: true }).click();
    if (testInfo.project.name === 'phone') {
        await expect(page.locator('#pet-yard-section')).toBeFocused();
        await expect.poll(() => page.locator('#pet-yard-section').evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(160);
    }
    await page.locator('#pet-pvp-gear').selectOption('');
    await expect(page.getByText('No arena gear owned. Visit the Grand Marketplace to find some.', { exact: true })).toBeVisible();
    expect(requests.at(-1)).toMatchObject({ action: 'equip', petId: 'qa-fire-1', slot: 'pvp' });
    const scan = await new AxeBuilder({ page }).include('.pet-yard-refined').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);

    // A subscription lapse must not strand rewards on a preserved sixth pet.
    state.character.patreon.active = false;
    state.character.pets.push(...structuredClone(fullRosterPets));
    const overflow = state.character.pets[5];
    overflow.expedition = { type: 'scout', startedAt: Date.now() - 100_000, endsAt: Date.now() - 1000, token: 'qa-return', risk: 'safe', provision: 'none', choiceVersion: 1, place: 'Cactus Flats' };
    let claims = 0;
    await page.route('**/api/missions/report-pet-event', async route => {
        const body = route.request().postDataJSON();
        expect(body).toMatchObject({ petId: overflow.id, expeditionToken: 'qa-return', returnChoice: 'secure' });
        if (++claims === 1) return json(route, { error: 'The return desk is unavailable.' }, 503);
        delete overflow.expedition;
        overflow.xp = Number(overflow.xp) + 40;
        return json(route, { ok: true, character: state.character, _saveVersion: ++state.saveVersion, petXpEarned: 40, story: 'Returned safely from Cactus Flats.' });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Select Stoneback Tanuki/ }).click();
    await expect(page.getByRole('button', { name: 'Secure haul', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Secure haul', exact: true }).click();
    await expect(page.locator('#pet-expedition-claim-error')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Secure haul', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Returned safely from Cactus Flats');
    await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Select Stoneback Tanuki', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Launch expedition', exact: true })).toBeDisabled();
    state.character.pets = [];
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Go to World Map', exact: true })).toBeVisible();
    await expect(nav).toHaveCount(0);
});

test("refined integration festival navigation, crate, and market retry", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(!['desktop', 'phone', 'chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name), 'Interaction coverage uses desktop and touch.');
    const state = await installPetHomeApi(page);
    state.character.ryo = 1_000_000;
    await page.route('**/api/festival/rally?*', route => json(route, { ok: true, progress: { reputation: 0, best: {}, history: [] }, daily: { day: new Date().toISOString().slice(0, 10), seed: 1, tracks: ['grand-circuit'], rivals: [] }, serverNow: Date.now() }));
    await page.route('**/api/festival/caravan?*', route => json(route, { ok: true, progress: { reputation: 0, deliveries: 0, chains: {}, history: [] }, daily: { seed: 1, weather: 'clear', contracts: [{ id: 'market-goods', title: 'The morning market', employer: 'Miraa', cargo: 'Market goods', description: 'Carry supplies through the dunes.', destination: 'Cactus Flats', difficulty: 1, reputationRequired: 0, payoutFactor: 1, nodes: 8, supplies: 18, objective: { kind: 'cargo', target: 70, label: 'Deliver at least 70% cargo' } }] }, serverNow: Date.now(), character: state.character, _saveVersion: ++state.saveVersion }));
    let pulls = 0;
    await page.route('**/api/festival/black-market', async route => {
        ++pulls;
        state.character.ryo -= 70_000;
        return json(route, { ok: true, reward: { tier: 'haul', label: 'A Tidy Haul', ryo: 5000, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0 }, dailyUsed: pulls, character: state.character, _saveVersion: ++state.saveVersion });
    });
    const lots = Array.from({ length: 13 }, (_, i) => ({ id: `audit-${i}`, asset: { id: `audit-item-${i}`, name: `Desert keepsake ${i + 1}`, kind: 'item', category: 'materials', rarity: 'uncommon', description: 'A keepsake from the trading quarter.', image: i === 12 ? '/qa-missing-art.webp' : '/items/hunt-torn-hide-v1.webp', stats: [] }, price: i === 0 ? 2_000_000 : 100, quantity: 1, currency: 'ryo', seller: 'miraa', sellerName: 'Miraa', state: 'active', createdAt: Date.now() - i }));
    const trades: unknown[] = [];
    const purchases: Record<string, unknown>[] = [];
    let browseAttempts = 0;
    await page.route('**/qa-missing-art.webp', route => route.fulfill({ status: 404 }));
    await page.route('**/api/festival/exchange', async route => {
        const body = route.request().postDataJSON();
        if (body.action === 'browse' && ++browseAttempts === 1) return json(route, { error: 'Trading desk temporarily unavailable.' }, 503);
        if (body.action === 'buy') {
            purchases.push(body);
            const lot = lots.find(lot => lot.id === body.listingId)!;
            if (purchases.length === 1) return json(route, { error: 'Trade confirmation interrupted.', pending: true }, 503);
            state.character.ryo -= lot.price;
            lot.state = 'sold';
            trades.push(lot);
        }
        return json(route, { ok: true, character: state.character, _saveVersion: ++state.saveVersion, listings: lots.filter(lot => lot.state === 'active'), activity: trades, inventory: [], creatorItems: [], recoveryErrors: [] });
    });
    await page.goto('/#/sunscarFestival', { waitUntil: 'networkidle' });
    for (const [selector, title, back] of [
        ['.sunscar-attraction-rally button', 'Pet Rally', '.sunscar-rally .sunscar-back'],
        ['.sunscar-attraction-caravan button', 'Caravan Run', '.caravan-mode .sunscar-back'],
    ]) {
        await page.locator(selector).click();
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeFocused();
        await expect.poll(() => page.getByRole('heading', { name: title, exact: true }).evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(360);
        await page.locator(back).click();
        await expect(page.locator(selector)).toBeFocused();
    }
    await page.getByRole('button', { name: 'Buy a sealed crate', exact: true }).click();
    const crate = page.getByRole('dialog', { name: 'The Broker’s crate' });
    await expect(crate).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open the crate', exact: true })).toBeFocused();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Open the crate', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A Tidy Haul', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Return to the festival', exact: true })).toBeFocused();
    const scan = await new AxeBuilder({ page }).include('.bm-crate-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(scan.violations).toEqual([]);
    await crate.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await page.screenshot({ path: testInfo.outputPath('broker-reward-viewport.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(crate).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Buy a sealed crate', exact: true })).toBeFocused();
    expect(pulls).toBe(1);
    await page.getByRole('button', { name: 'Enter the Exchange', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sunscar Exchange', exact: true })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'The trade ledger is unavailable' })).toBeVisible();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.locator('.sx-listing')).toHaveCount(12);
    await page.locator('.sx-listing').first().click();
    await expect(page.getByRole('dialog')).toContainText(/You need more ryo/i);
    await expect(page.getByRole('button', { name: /^Buy for 2,000,000 ryo$/i })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('.sx-listing').first()).toBeFocused();
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browse the Exchange', exact: true })).toBeFocused();
    await expect(page.locator('.sx-listing')).toHaveCount(1);
    await expect(page.locator('.sx-asset-monogram')).toHaveText('Dk');
    await page.locator('.sx-listing').click();
    await page.getByRole('button', { name: /^Buy for 100 ryo$/i }).click();
    await expect(page.getByRole('dialog')).toContainText('Trade confirmation interrupted');
    await expect(page.getByRole('button', { name: /^Buy for 100 ryo$/i })).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Retry saved trade', exact: true }).click();
    await expect(page.locator('.sx-success')).toBeFocused();
    expect(purchases).toHaveLength(2);
    expect(purchases[1]).toEqual(purchases[0]);
    expect(state.character.ryo).toBe(929_900);
    await expect(page.getByRole('dialog')).toHaveCount(0);
});
