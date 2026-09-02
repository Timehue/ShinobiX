import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

const NON_COMBAT_SCREENS = [
    "centralHub",
    "village",
    "profile",
    "inventory",
    "logbook",
    "training",
    "jutsuTraining",
    "missions",
    "bloodlineMaker",
    "clan",
    "worldMap",
    "townHall",
    "bank",
    "shop",
    "grandMarketplace",
    "hospital",
    "cafeteria",
    "storyHall",
    "sunscarFestival",
    "home",
    "pets",
    "petLadder",
    "hunting",
    "tavern",
    "hallOfLegends",
    "shinobiCouncil",
    "messages",
    "professions",
    "guides",
    "shinobiTiles",
    "echoesOfWar",
] as const;

type AuditMetrics = {
    brokenBackgrounds: string[];
    brokenImages: string[];
    clippedControls: string[];
    undersizedControls: string[];
    emptyMain: boolean;
};

async function auditVisibleScreen(page: Page, rootSelector = ".center-game"): Promise<AuditMetrics> {
    return page.locator(rootSelector).evaluate(async (main) => {
        const viewportWidth = window.innerWidth;
        const visible = (element: Element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none"
                && style.visibility !== "hidden"
                && Number(style.opacity || 1) > 0
                && rect.width > 0
                && rect.height > 0;
        };
        const label = (element: Element) => {
            const text = (element.getAttribute("aria-label") || element.textContent || element.tagName).trim();
            return text.replace(/\s+/g, " ").slice(0, 80);
        };
        const controls = Array.from(main.querySelectorAll("button, a[href], input, select, textarea")).filter(visible);
        const touchControls = Array.from(main.querySelectorAll("button, [role='button'], input:not([type='hidden']), select, textarea")).filter(visible);
        const backgroundElements = [document.querySelector(".app-background"), main, ...Array.from(main.querySelectorAll("*"))]
            .filter((element): element is Element => Boolean(element) && visible(element as Element));
        const backgroundUrls = Array.from(new Set(backgroundElements.flatMap((element) => {
            const values = [
                getComputedStyle(element).backgroundImage,
                getComputedStyle(element, "::before").backgroundImage,
                getComputedStyle(element, "::after").backgroundImage,
            ];
            return values.flatMap((value) => Array.from(value.matchAll(/url\((['"]?)(.*?)\1\)/g), (match) => match[2]));
        })));
        const brokenBackgrounds = (await Promise.all(backgroundUrls.map((url) => new Promise<string | null>((resolve) => {
            const image = new Image();
            const timeout = window.setTimeout(() => resolve(url), 5_000);
            image.onload = () => {
                window.clearTimeout(timeout);
                resolve(null);
            };
            image.onerror = () => {
                window.clearTimeout(timeout);
                resolve(url);
            };
            image.src = new URL(url, document.baseURI).href;
        })))).filter((url): url is string => Boolean(url));

        return {
            brokenBackgrounds,
            brokenImages: Array.from(main.querySelectorAll("img"))
                .filter((image) => {
                    if (!visible(image)) return false;
                    const img = image as HTMLImageElement;
                    if (img.complete) return img.naturalWidth === 0;
                    return img.loading !== "lazy";
                })
                .map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src),
            clippedControls: controls
                .filter((control) => {
                    const rect = control.getBoundingClientRect();
                    const ownsHorizontalScroll = Boolean(control.closest(
                        ".table-scroll, .ui-tabs, .admin-tabs, .profile-mobile-tabs, .chronicle-hand, .world-map-scroll, .hol-tabs, .council-tabs, .town-tabs, .clan-tabs, .user-hub-tabs, .expanded-tabs, .pet-home-tabs, .pet-arena-mode-toggle, .pet-pick-strip, .guides-filters",
                    ));
                    return !ownsHorizontalScroll && (rect.right > viewportWidth + 1 || rect.left < -1);
                })
                .map(label),
            undersizedControls: touchControls
                // Overview pins intentionally keep a compact painted box; their
                // ::after ring owns the real 44px pointer target and is asserted
                // separately in the World Map route check below.
                .filter((control) => !control.matches(".atlas-sector, .atlas-hollowGate"))
                .filter((control) => {
                    const rect = control.getBoundingClientRect();
                    const minimum = viewportWidth <= 979 ? 44 : 24;
                    return Math.min(rect.width, rect.height) < minimum;
                })
                .map(label),
            emptyMain: !(main.textContent || "").trim() && main.querySelectorAll("img, canvas, video").length === 0,
        };
    });
}

async function capture(page: Page, testInfo: TestInfo, screen: string) {
    if (process.env.UI_AUDIT_CAPTURE !== "1") return;
    await page.screenshot({
        path: testInfo.outputPath(`${String(testInfo.project.use.viewport?.width ?? 0)}-${screen}.png`),
        animations: "disabled",
        fullPage: false,
    });
}

function collectRuntimeErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
        if (response.status() === 404) errors.push(`404 ${response.url()}`);
    });
    return errors;
}

const CENTRAL_MODAL_CARDS = [
    { card: "Ancient Archives", dialog: "Ancient Archives", capture: "central-ancient-archives" },
    { card: "Awakening Stone", dialog: "Awakening Stone", capture: "ca-stone" },
    { card: "Crafter", dialog: "Crafter", capture: "central-crafter" },
    { card: "Relic Dungeons", dialog: "Relic Dungeons", capture: "central-relic-dungeons" },
    { card: "Celestial Tower", dialog: "Celestial Tower", capture: "central-celestial-tower" },
] as const;

const CENTRAL_ROUTE_CARDS = [
    { card: "Arena District", screen: "arenaDistrict", capture: "central-arena-district", ready: '[data-central-district="true"]', readyText: "Arena District" },
    { card: "Weekly Boss", screen: "weeklyBoss", capture: "central-weekly-boss", ready: ".weekly-boss-screen", readyText: "Weekly Boss" },
] as const;

for (const destination of CENTRAL_MODAL_CARDS) {
    test(`Central ${destination.card} modal is production-sized and artwork-safe`, async ({ page }, testInfo) => {
        const runtimeErrors = collectRuntimeErrors(page);
        const runtime = await installUiAuditRuntime(page);
        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: destination.card }).click();
        const dialog = page.getByRole("dialog", { name: destination.dialog });
        await expect(dialog).toBeVisible();
        await expectViewportSafe(page);
        await page.waitForTimeout(150);
        const metrics = await auditVisibleScreen(page, `[role="dialog"][aria-label="${destination.dialog}"]`);
        expect(metrics.emptyMain, `${destination.card} rendered no meaningful content`).toBe(false);
        expect(metrics.brokenBackgrounds, `${destination.card} has broken visible background artwork`).toEqual([]);
        expect(metrics.brokenImages, `${destination.card} has broken visible artwork`).toEqual([]);
        expect(metrics.clippedControls, `${destination.card} has controls clipped by the viewport`).toEqual([]);
        expect(metrics.undersizedControls, `${destination.card} has controls below the viewport touch-target minimum`).toEqual([]);
        expect(runtimeErrors, `${destination.card} emitted runtime errors`).toEqual([]);
        await capture(page, testInfo, destination.capture);
    });
}

for (const destination of CENTRAL_ROUTE_CARDS) {
    test(`Central ${destination.card} route is production-sized and artwork-safe`, async ({ page }, testInfo) => {
        const runtimeErrors = collectRuntimeErrors(page);
        const runtime = await installUiAuditRuntime(page);
        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: destination.card }).click();
        await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", destination.screen);
        await expect(page.locator(".center-game")).toBeVisible();
        await expect(page.locator(destination.ready).filter({ hasText: destination.readyText })).toBeVisible();
        await expect(page.locator(".lazy-screen-fallback")).toHaveCount(0);
        await expectViewportSafe(page, {
            horizontalScrollers: [".clan-tabs", ".pet-home-tabs", ".pet-arena-mode-toggle", ".pet-pick-strip"],
        });
        await page.waitForTimeout(150);
        const metrics = await auditVisibleScreen(page);
        expect(metrics.emptyMain, `${destination.card} rendered no meaningful content`).toBe(false);
        expect(metrics.brokenBackgrounds, `${destination.card} has broken visible background artwork`).toEqual([]);
        expect(metrics.brokenImages, `${destination.card} has broken visible artwork`).toEqual([]);
        expect(metrics.clippedControls, `${destination.card} has controls clipped by the viewport`).toEqual([]);
        expect(metrics.undersizedControls, `${destination.card} has controls below the viewport touch-target minimum`).toEqual([]);
        expect(runtimeErrors, `${destination.card} emitted runtime errors`).toEqual([]);
        await capture(page, testInfo, destination.capture);
    });
}

// Leaving a modal by navigating (one handler doing setShowPanel(false) + setScreen())
// unmounts the modal's owner while its portal is still attached. The background-inert
// sync used to see that dying backdrop, re-mark #root inert, and never take it back
// off — leaving the whole app scrollable but click-dead, which reads as a hard freeze.
const CELESTIAL_DESTINATIONS = [
    { option: "Enter Celestial Tower", screen: "endlessTower" },
    { option: "Battle Towers", screen: "battleTowers" },
    { option: "Echoes of War", screen: "echoesOfWar" },
] as const;

for (const destination of CELESTIAL_DESTINATIONS) {
    test(`navigating to ${destination.screen} from the Celestial modal leaves the app interactive`, async ({ page }) => {
        const runtime = await installUiAuditRuntime(page);
        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: "Celestial Tower" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.getByRole("button", { name: new RegExp(destination.option) }).click();
        await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", destination.screen);

        const blocked = await page.evaluate(() => [...document.body.children]
            .filter(el => (el as HTMLElement).inert === true || el.getAttribute("aria-hidden") === "true")
            .map(el => `${el.tagName.toLowerCase()}#${(el as HTMLElement).id || "?"}`));
        expect(blocked, "the modal left body children inert/aria-hidden after navigating away").toEqual([]);

        // Inert leaves the page scrollable and painted, so the only proof of
        // interactivity is that a control still accepts input. An inert subtree
        // cannot take focus, which is deterministic regardless of scroll position.
        await expect(page.locator(".lazy-screen-fallback")).toHaveCount(0);
        // Must be an ENABLED control: a disabled button refuses focus for its own
        // reasons, which would mask (or fake) the inert failure this guards.
        const button = page.locator(".center-game button:not([disabled])").first();
        await expect(button).toBeVisible();
        const focusable = await button.evaluate((element: HTMLElement) => {
            element.focus();
            return document.activeElement === element
                ? true
                : `focus refused (activeElement=${document.activeElement?.tagName.toLowerCase() ?? "none"})`;
        });
        expect(focusable, "the destination screen's controls did not accept input").toBe(true);
    });
}

test("Central Pet Colosseum card is wired to the combat destination", async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "centralHub");
    await page.locator(".central-card").filter({ hasText: "Pet Colosseum" }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "petArena");
    await expect(page.locator(".pet-arena-screen")).toContainText("Pet Colosseum");
    await expect(page.locator(".lazy-screen-fallback")).toHaveCount(0);
    expect(runtimeErrors, "Pet Colosseum navigation emitted runtime errors").toEqual([]);
});

for (const screen of NON_COMBAT_SCREENS) {
    test(`${screen} is production-sized and artwork-safe`, async ({ page }, testInfo) => {
        const runtimeErrors = collectRuntimeErrors(page);
        const runtime = await installUiAuditRuntime(page);
        await expectUiAuditBoot(page, runtime, screen);
        await expect(page.locator(".center-game")).toBeVisible();
        await expect(page.locator(".app-background")).toHaveAttribute("style", /background-image:\s*url\(.+\)/);
        await expectViewportSafe(page, {
            horizontalScrollers: [
                ".table-scroll",
                ".ui-tabs",
                ".admin-tabs",
                ".profile-mobile-tabs",
                ".chronicle-hand",
                ".hol-tabs",
                ".council-tabs",
                ".expanded-tabs",
                ".town-tabs",
                ".clan-tabs",
                ".user-hub-tabs",
                ".pet-home-tabs",
                ".pet-arena-mode-toggle",
                ".guides-filters",
            ],
            logicalStages: [".world-map-scroll"],
        });
        await page.waitForTimeout(150);
        const metrics = await auditVisibleScreen(page);
        expect(metrics.emptyMain, `${screen} rendered no meaningful main content`).toBe(false);
        expect(metrics.brokenBackgrounds, `${screen} has broken visible background artwork`).toEqual([]);
        expect(metrics.brokenImages, `${screen} has broken visible artwork`).toEqual([]);
        expect(metrics.clippedControls, `${screen} has controls clipped by the viewport`).toEqual([]);
        expect(metrics.undersizedControls, `${screen} has controls below the viewport touch-target minimum`).toEqual([]);
        if (screen === "worldMap" && (page.viewportSize()?.width ?? 0) <= 979) {
            const markerTargets = await page.locator(".atlas-sector, .atlas-hollowGate").evaluateAll((markers) => markers.map((marker) => {
                const rect = marker.getBoundingClientRect();
                const hitRing = getComputedStyle(marker, "::after");
                const left = Number.parseFloat(hitRing.left) || 0;
                const right = Number.parseFloat(hitRing.right) || 0;
                const top = Number.parseFloat(hitRing.top) || 0;
                const bottom = Number.parseFloat(hitRing.bottom) || 0;
                return {
                    label: marker.getAttribute("aria-label") ?? marker.textContent ?? "map marker",
                    width: rect.width - left - right,
                    height: rect.height - top - bottom,
                };
            }));
            expect(
                markerTargets.filter((target) => Math.min(target.width, target.height) < 44),
                "World Map overview markers need a 44px pseudo-element hit ring",
            ).toEqual([]);
        }
        expect(runtimeErrors, `${screen} emitted runtime errors`).toEqual([]);
        await capture(page, testInfo, screen);
    });
}

test("Jutsu Training opens mobile technique details with a training action", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile jutsu interaction regression");
    const runtimeErrors = collectRuntimeErrors(page);
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "jutsuTraining");

    const technique = page.locator(".jutsu-library .technique-card").first();
    const techniqueName = (await technique.locator(".technique-name").textContent())?.trim() ?? "";
    await technique.click();

    const dialog = page.locator(".jutsu-mobile-info-modal");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: techniqueName })).toBeVisible();
    await expect(dialog.locator(".jutsu-detail-description")).not.toBeEmpty();
    await expect(dialog.getByRole("button", { name: /unlock|train|battle training|another lesson/i })).toBeVisible();
    // The modal enters with a short scale animation. Audit the settled target
    // boxes so a transient sub-pixel transform cannot turn 44px into 43.99px.
    await page.waitForTimeout(150);
    await expectViewportSafe(page);

    const metrics = await auditVisibleScreen(page, ".jutsu-mobile-info-modal");
    expect(metrics.clippedControls, "the mobile jutsu dialog has controls clipped by the viewport").toEqual([]);
    expect(metrics.undersizedControls, "the mobile jutsu dialog has undersized touch targets").toEqual([]);
    expect(runtimeErrors, "the mobile jutsu dialog emitted runtime errors").toEqual([]);
    await capture(page, testInfo, "jutsu-training-info");
});

const PROFESSION_HUB_VARIANTS = [
    { id: "healer", className: "profession-hub-healer", rank: 5, xp: 3_000, capture: "professions-healer" },
    { id: "vanguard", className: "profession-hub-vanguard", rank: 5, xp: 2_500, capture: "professions-vanguard" },
    { id: "petTamer", className: "profession-hub-pet-tamer", rank: 5, xp: 2_500, capture: "professions-pet-tamer" },
] as const;

for (const profession of PROFESSION_HUB_VARIANTS) {
    test(`${profession.id} profession hub has a mobile command-center hierarchy`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "chromium-mobile", "profession variants are a focused mobile visual pass");
        const runtimeErrors = collectRuntimeErrors(page);
        const initialSave = uiAuditSave();
        initialSave.character = {
            ...initialSave.character,
            profession: profession.id,
            professionRank: profession.rank,
            professionXp: profession.xp,
            honorSeals: 27,
            dailyHonorSealsEarned: 18,
            professionRespecUsed: false,
        };
        const runtime = await installUiAuditRuntime(page, initialSave);
        await expectUiAuditBoot(page, runtime, "professions");

        const hub = page.locator(`.${profession.className}`);
        await expect(hub).toBeVisible();
        await expect(hub.locator(".profession-hero")).toBeVisible();
        await expect(hub.locator(".profession-rank-card")).toBeVisible();
        await expect(hub.locator(".profession-progress-track").first()).toHaveAttribute("role", "progressbar");
        expect((await hub.locator(".profession-rank-card").innerText())).not.toMatch(/-\d/);
        await expectViewportSafe(page, { horizontalScrollers: [".profession-rank-ladder"] });

        const metrics = await auditVisibleScreen(page);
        expect(metrics.emptyMain, `${profession.id} rendered no meaningful main content`).toBe(false);
        expect(metrics.brokenBackgrounds, `${profession.id} has broken visible background artwork`).toEqual([]);
        expect(metrics.brokenImages, `${profession.id} has broken visible artwork`).toEqual([]);
        expect(metrics.clippedControls, `${profession.id} has controls clipped by the viewport`).toEqual([]);
        expect(metrics.undersizedControls, `${profession.id} has controls below the viewport touch-target minimum`).toEqual([]);
        expect(runtimeErrors, `${profession.id} emitted runtime errors`).toEqual([]);
        await capture(page, testInfo, profession.capture);
    });
}

test("mobile shell uses five anchors and a compact keyboard-safe destination catalog", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "the persistent navigation is mobile-only");
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "village");

    const shell = page.locator(".app-shell");
    await expect(shell).toHaveAttribute("data-ui-mode", "noncombat");
    const nav = page.getByRole("navigation", { name: "Primary game navigation" });
    await expect(nav.getByRole("button")).toHaveCount(5);
    await expect(nav.getByRole("button", { name: "Village" })).toHaveAttribute("aria-current", "page");

    const menuTrigger = nav.getByRole("button", { name: /Menu/ });
    await menuTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Shinobi menu" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close menu" })).toBeFocused();
    await expect(dialog.getByRole("searchbox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Training", exact: true })).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Travel", exact: true })).toHaveCount(1);
    await expectViewportSafe(page);
    await capture(page, testInfo, "mobile-menu-catalog");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();
});

test("Inventory and Jutsu tabs keep selection, focus, and panels in sync", async ({ page }) => {
    const initialSave = uiAuditSave();
    initialSave.character = {
        ...initialSave.character,
        equippedJutsuIds: ["ashen-eyes-blood-gaze"],
        jutsuMastery: [{ jutsuId: "ashen-eyes-blood-gaze", level: 10, xp: 0 }],
    };
    const runtime = await installUiAuditRuntime(page, initialSave);
    await expectUiAuditBoot(page, runtime, "inventory");

    const firstBackpackItem = page.locator(".backpack-item").first();
    await expect(firstBackpackItem).toBeVisible();
    const backpackLayout = await firstBackpackItem.evaluate((card) => {
        const art = card.querySelector(".backpack-item-art")?.getBoundingClientRect();
        const copy = card.querySelector(".backpack-item-copy")?.getBoundingClientRect();
        const action = card.querySelector(".backpack-item-action")?.getBoundingClientRect();
        return {
            viewportWidth: window.innerWidth,
            artHeight: art?.height ?? 0,
            artBottom: art?.bottom ?? 0,
            copyTop: copy?.top ?? 0,
            copyBottom: copy?.bottom ?? 0,
            actionTop: action?.top ?? 0,
        };
    });
    expect(backpackLayout.artBottom, "item artwork must end before its text begins").toBeLessThanOrEqual(backpackLayout.copyTop + 0.5);
    expect(backpackLayout.copyBottom, "item text must end before the action row begins").toBeLessThanOrEqual(backpackLayout.actionTop + 0.5);
    if (backpackLayout.viewportWidth <= 720) {
        expect(backpackLayout.artHeight, "phone artwork should use the compact 96px stage").toBeLessThanOrEqual(96.5);
    }

    const inventoryTabs = page.getByRole("tablist", { name: "Inventory sections" });
    const itemsTab = inventoryTabs.getByRole("tab", { name: "Items" });
    const cardsTab = inventoryTabs.getByRole("tab", { name: "Chronicle Showdown" });
    await expect(itemsTab).toHaveAttribute("aria-selected", "true");
    await expect(itemsTab).toHaveAttribute("tabindex", "0");
    await expect(cardsTab).toHaveAttribute("tabindex", "-1");
    await expect(itemsTab).toHaveAttribute("aria-controls", "inventory-panel-items");
    await expect(page.locator("#inventory-panel-items")).toHaveAttribute("aria-labelledby", "inventory-tab-items");
    await itemsTab.focus();
    await itemsTab.press("ArrowRight");
    await expect(cardsTab).toBeFocused();
    await expect(cardsTab).toHaveAttribute("aria-selected", "true");
    await expect(cardsTab).toHaveAttribute("aria-controls", "inventory-panel-tile-cards");
    await expect(page.locator("#inventory-panel-tile-cards"))
        .toHaveAttribute("aria-labelledby", "inventory-tab-tile-cards");
    await expect(page.locator("#inventory-panel-tile-cards")).toBeVisible();
    await cardsTab.press("ArrowLeft");
    await expect(itemsTab).toHaveAttribute("aria-selected", "true");

    const categoryTabs = page.getByRole("tablist", { name: "Backpack categories" });
    const allTab = categoryTabs.getByRole("tab", { name: /^All/ });
    const gearTab = categoryTabs.getByRole("tab", { name: /^Gear/ });
    await allTab.focus();
    await allTab.press("ArrowRight");
    await expect(gearTab).toBeFocused();
    await expect(gearTab).toHaveAttribute("aria-selected", "true");
    await expect(gearTab).toHaveAttribute("aria-controls", "inventory-backpack-panel");
    await expect(page.locator("#inventory-backpack-panel")).toHaveAttribute("aria-labelledby", "inventory-category-gear");

    await page.goto("/#/profile");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "profile");
    if ((await page.viewportSize())!.width <= 979) {
        const dossierGrid = page.locator(".profile-dossier-grid");
        const buildSection = dossierGrid.locator(".profile-dossier-section").filter({ hasText: "Build" });
        await expect(buildSection).toBeVisible();
        const closedWidths = await dossierGrid.evaluate((grid) => ({
            grid: grid.getBoundingClientRect().width,
            sections: Array.from(grid.querySelectorAll(".profile-dossier-section"), (section) => section.getBoundingClientRect().width),
        }));
        expect(Math.min(...closedWidths.sections), "every mobile dossier accordion should fill its grid").toBeGreaterThanOrEqual(closedWidths.grid - 1);
        await buildSection.evaluate((section) => { (section as HTMLDetailsElement).open = false; });
        await buildSection.locator("summary").click();
        await expect(buildSection).toHaveAttribute("open", "");
        await expect(buildSection.locator(".profile-dossier-rows")).toBeVisible();
        const openWidths = await buildSection.evaluate((section) => ({
            content: section.clientWidth
                - Number.parseFloat(getComputedStyle(section).paddingLeft)
                - Number.parseFloat(getComputedStyle(section).paddingRight),
            rows: section.querySelector(".profile-dossier-rows")?.getBoundingClientRect().width ?? 0,
        }));
        expect(openWidths.rows, "opened Build content should fill its accordion content box").toBeGreaterThanOrEqual(openWidths.content - 0.5);
    }
    await page.locator(".profile-mobile-tabs").getByRole("button", { name: "Jutsu" }).click();
    const jutsuTabs = page.getByRole("tablist", { name: "Jutsu workspace" });
    const loadoutTab = jutsuTabs.getByRole("tab", { name: /^Loadout/ });
    const collectionTab = jutsuTabs.getByRole("tab", { name: /^Learned Jutsu/ });
    await loadoutTab.focus();
    await loadoutTab.press("End");
    await expect(collectionTab).toBeFocused();
    await expect(collectionTab).toHaveAttribute("aria-selected", "true");
    await expect(collectionTab).toHaveAttribute("aria-controls", "jutsu-workspace-collection");
    await expect(page.locator("#jutsu-workspace-collection"))
        .toHaveAttribute("aria-labelledby", "jutsu-workspace-tab-collection");
    await expect(page.locator("#jutsu-workspace-collection")).toBeVisible();
    await collectionTab.press("Home");
    await expect(loadoutTab).toHaveAttribute("aria-selected", "true");
    await expect(loadoutTab).toHaveAttribute("aria-controls", "jutsu-workspace-loadout");
    await expect(page.locator("#jutsu-workspace-loadout"))
        .toHaveAttribute("aria-labelledby", "jutsu-workspace-tab-loadout");
    await expect(page.locator("#jutsu-workspace-loadout")).toBeVisible();
});

test("Mission Hall Field board follows D-to-S progression and is alphabetized within rank", async ({ page }, testInfo) => {
    const runtimeErrors = collectRuntimeErrors(page);
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "missions");
    const missionTabs = page.locator(".mission-hall .expanded-tabs");
    await expect(missionTabs).toBeVisible();
    expect(await missionTabs.evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth + 1), "mobile mission tabs should fit without horizontal scrolling").toBe(true);
    const missionTabButtons = missionTabs.getByRole("tab");
    await expect(missionTabButtons).toHaveCount(5);
    const combatTab = page.locator('button[data-tab="combat"]');
    const fieldTab = page.locator('button[data-tab="field"]');
    await combatTab.click();
    await expect(combatTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#mission-tab-panel")).toHaveAttribute("aria-labelledby", "mission-tab-combat");

    if ((page.viewportSize()?.width ?? 0) <= 700) {
        const tabRects = await missionTabButtons.evaluateAll((tabs) => tabs.map((tab) => {
            const rect = tab.getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        }));
        expect(Math.max(...tabRects.map((rect) => rect.top)) - Math.min(...tabRects.map((rect) => rect.top)), "mobile mission tabs should stay in one row").toBeLessThanOrEqual(1);
        expect(Math.max(...tabRects.map((rect) => rect.width)) - Math.min(...tabRects.map((rect) => rect.width)), "mobile mission tabs should have equal widths").toBeLessThanOrEqual(1);
        expect(tabRects.every((rect, index) => index === 0 || rect.left > tabRects[index - 1].left), "mobile mission tabs should preserve source order").toBe(true);
        expect(tabRects.every((rect) => rect.height >= 44), "mobile mission tabs should retain touch-safe heights").toBe(true);

        const firstCombatCard = page.locator(".mh-combat-card").first();
        await expect(firstCombatCard).toBeVisible();
        const compactMetrics = await firstCombatCard.evaluate((card) => {
            const cardRect = card.getBoundingClientRect();
            const actionRect = card.querySelector(".mh-combat-btn")?.getBoundingClientRect();
            return { cardHeight: cardRect.height, actionWidth: actionRect?.width ?? 0, actionHeight: actionRect?.height ?? 0 };
        });
        expect(compactMetrics.cardHeight, "mobile combat cards should remain compact").toBeLessThanOrEqual(110);
        expect(Math.min(compactMetrics.actionWidth, compactMetrics.actionHeight), "mobile combat actions should meet the 44px touch target").toBeGreaterThanOrEqual(44);
    }

    await combatTab.focus();
    await combatTab.press("ArrowRight");
    await expect(fieldTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#mission-tab-panel")).toHaveAttribute("aria-labelledby", "mission-tab-field");

    const fieldCards = page.locator(".mh-field-card");
    await expect(fieldCards.first()).toBeVisible();
    expect(await fieldCards.count()).toBeGreaterThan(0);

    if ((page.viewportSize()?.width ?? 0) <= 700) {
        const compactFieldMetrics = await fieldCards.first().evaluate((card) => {
            const cardRect = card.getBoundingClientRect();
            const rankRect = card.querySelector(".mh-field-rank")?.getBoundingClientRect();
            const artRect = card.querySelector(".mh-field-art img")?.getBoundingClientRect();
            const actionRect = card.querySelector(".mh-field-primary-action")?.getBoundingClientRect();
            return {
                cardHeight: cardRect.height,
                alignedTop: Math.max(rankRect?.top ?? 0, artRect?.top ?? 0, actionRect?.top ?? 0)
                    - Math.min(rankRect?.top ?? 0, artRect?.top ?? 0, actionRect?.top ?? 0),
                rankWidth: rankRect?.width ?? 0,
                artWidth: artRect?.width ?? 0,
                actionWidth: actionRect?.width ?? 0,
                actionHeight: actionRect?.height ?? 0,
            };
        });
        expect(
            compactFieldMetrics.cardHeight,
            "mobile field cards should match the compact combat-card rhythm",
        ).toBeLessThanOrEqual(110);
        expect(
            compactFieldMetrics.alignedTop,
            "mobile field card columns should share one row",
        ).toBeLessThanOrEqual(1);
        expect(
            compactFieldMetrics.rankWidth,
            "mobile field rank rail should match combat cards",
        ).toBeGreaterThanOrEqual(48);
        expect(
            compactFieldMetrics.artWidth,
            "mobile field art should match combat avatars",
        ).toBeGreaterThanOrEqual(68);
        expect(
            Math.min(compactFieldMetrics.actionWidth, compactFieldMetrics.actionHeight),
            "mobile field actions should meet the 44px touch target",
        ).toBeGreaterThanOrEqual(44);
    }

    const renderedOrder = await fieldCards.evaluateAll((cards) => cards.map((card) => ({
        rank: card.querySelector(".mh-field-rank")?.textContent?.trim() ?? "",
        name: card.querySelector(".mh-field-title-row h4")?.textContent?.trim() ?? "",
    })));
    const rankOrder = new Map([
        ["D Rank", 0],
        ["C Rank", 1],
        ["B Rank", 2],
        ["A Rank", 3],
        ["S Rank", 4],
    ]);
    const expectedOrder = [...renderedOrder].sort((left, right) =>
        (rankOrder.get(left.rank) ?? Number.MAX_SAFE_INTEGER) - (rankOrder.get(right.rank) ?? Number.MAX_SAFE_INTEGER)
        || left.name.localeCompare(right.name));
    expect(renderedOrder, "field missions are not ordered D, C, B, A, S and then alphabetically by name").toEqual(expectedOrder);

    await fieldCards.last().scrollIntoViewIfNeeded();
    const artwork = fieldCards.locator(".mh-field-art img");
    await expect.poll(() => artwork.evaluateAll((images) => images.every((image) => {
        const source = (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src;
        return source.includes("/sector-map/s") && (image as HTMLImageElement).naturalWidth > 0;
    }))).toBe(true);

    await expectViewportSafe(page, { horizontalScrollers: [".expanded-tabs"] });
    expect(runtimeErrors, "the Field board emitted runtime errors").toEqual([]);
    await capture(page, testInfo, "missions-field");
});

test("Mission Hall accepted Field cards keep their compact mobile action layout", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) > 700, "mobile Field-card regression");
    const runtimeErrors = collectRuntimeErrors(page);
    const initialSave = uiAuditSave();
    initialSave.acceptedMissionIds = ["fetch-d-supply-trail"];
    initialSave.missionProgress = { "fetch-d-supply-trail": 1, "fetch-d-supply-trail:raids": 0 };
    const runtime = await installUiAuditRuntime(page, initialSave);
    await expectUiAuditBoot(page, runtime, "missions");
    await page.locator('button[data-tab="field"]').click();

    const card = page.locator(".mh-field-card.mh-field-accepted").filter({ hasText: "D Rank Supply Trail Sweep" });
    await expect(card).toBeVisible();
    await expect(card.locator(".mh-fetch-progress-wrap")).toBeVisible();
    await expect(card.getByRole("button", { name: "Go to Sector 18" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Abandon" })).toBeVisible();

    const metrics = await card.evaluate((element) => {
        const cardRect = element.getBoundingClientRect();
        const primaryRect = element.querySelector(".mh-field-primary-action")?.getBoundingClientRect();
        const secondaryRect = element.querySelector(".mh-field-secondary-action")?.getBoundingClientRect();
        return {
            cardHeight: cardRect.height,
            primaryTarget: Math.min(primaryRect?.width ?? 0, primaryRect?.height ?? 0),
            secondaryWidth: secondaryRect?.width ?? 0,
            secondaryHeight: secondaryRect?.height ?? 0,
        };
    });
    expect(metrics.cardHeight, "in-progress mobile Field cards should remain compact").toBeLessThanOrEqual(110);
    expect(metrics.primaryTarget, "travel/claim rail should retain its 44px touch target").toBeGreaterThanOrEqual(44);
    expect(metrics.secondaryWidth, "Abandon should remain readable beside progress").toBeGreaterThanOrEqual(60);
    expect(metrics.secondaryHeight, "Abandon should meet the audit's minimum control height").toBeGreaterThanOrEqual(24);
    await expectViewportSafe(page, { horizontalScrollers: [".expanded-tabs"] });
    expect(runtimeErrors, "the accepted Field card emitted runtime errors").toEqual([]);
});

test("user directory routes into a production-safe public profile", async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "village");
    // The desktop rail offers Users directly; the mobile shell keeps it inside
    // the Menu sheet. count() does not auto-wait, and the rail can mount up to
    // ~1.9s after expectUiAuditBoot resolves, so sampling it straight away used
    // to read zero on a slow boot and then wait out the test clicking a "Menu"
    // trigger the desktop shell never renders. Wait for whichever shell booted
    // before branching on it. Same fix as user-hub-social-lists.spec.ts.
    const users = page.getByRole("button", { name: "Users", exact: true }).filter({ visible: true });
    const menuTrigger = page.getByRole("button", { name: "Menu", exact: true }).filter({ visible: true });
    await expect(users.or(menuTrigger).first()).toBeVisible();
    if (await users.count() === 0) {
        await menuTrigger.click();
    }
    await users.click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "userHub");
    await expectViewportSafe(page);
    const directoryMetrics = await auditVisibleScreen(page);
    expect(directoryMetrics.emptyMain, "userHub rendered no meaningful main content").toBe(false);
    expect(directoryMetrics.brokenBackgrounds, "userHub has broken visible background artwork").toEqual([]);
    expect(directoryMetrics.brokenImages, "userHub has broken visible artwork").toEqual([]);
    expect(directoryMetrics.clippedControls, "userHub has controls clipped by the viewport").toEqual([]);
    expect(directoryMetrics.undersizedControls, "userHub has controls below the viewport touch-target minimum").toEqual([]);
    const rival = page.locator(".user-hub-row").filter({ hasText: "RivalNinja" }).first();
    await expect(rival).toBeVisible();
    await rival.locator(".user-hub-name").click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "userView");
    await expect(page.locator(".center-game")).toBeVisible();
    await expectViewportSafe(page);
    const metrics = await auditVisibleScreen(page);
    expect(metrics.emptyMain, "userView rendered no meaningful main content").toBe(false);
    expect(metrics.brokenBackgrounds, "userView has broken visible background artwork").toEqual([]);
    expect(metrics.brokenImages, "userView has broken visible artwork").toEqual([]);
    expect(metrics.clippedControls, "userView has controls clipped by the viewport").toEqual([]);
    expect(metrics.undersizedControls, "userView has controls below the viewport touch-target minimum").toEqual([]);
    await capture(page, testInfo, "userView");
});

test.describe("Awakening Stone cinematic", () => {
    test.use({ reducedMotion: "no-preference" });

    test("reveals a newly awakened element returned by the server", async ({ page }) => {
        const runtimeErrors = collectRuntimeErrors(page);
        const initialSave = uiAuditSave();
        const initialCharacter = {
            ...(initialSave.character ?? {}),
            element: undefined,
            elements: [],
            claimedAwakenings: [],
        };
        initialSave.character = initialCharacter;
        const runtime = await installUiAuditRuntime(page, initialSave);
        let requestedKind = "";

        await page.route("**/api/awakening/roll", async (route) => {
            requestedKind = String((route.request().postDataJSON() as { kind?: string }).kind ?? "");
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    character: {
                        ...initialCharacter,
                        element: "Lightning",
                        elements: ["Lightning"],
                        claimedAwakenings: ["awakening-free-lv2"],
                    },
                    _saveVersion: 2,
                }),
            });
        });

        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        await page.getByRole("button", { name: /Awaken Element/ }).click();

        const cinematic = page.getByRole("dialog", { name: "Lightning Release" });
        await expect(cinematic).toBeVisible();
        await expect(cinematic).toHaveAttribute("data-mode", "awakening");
        await expect(cinematic).toHaveAttribute("data-element", "lightning");
        await expect(cinematic.locator("#central-awakening-result")).toHaveText("Lightning");
        await expect(cinematic.locator(".ca-sigil img")).toHaveAttribute(
            "src",
            "/assets/awakening-element-lightning-v1.webp",
        );
        expect(requestedKind).toBe("awakening-free-lv2");
        expect(runtimeErrors, "Awakening reveal emitted runtime errors").toEqual([]);

    });

    test("plays only after a successful reroll and reveals the committed element", async ({ page }, testInfo) => {
        const runtimeErrors = collectRuntimeErrors(page);
        const initialSave = uiAuditSave();
        const initialCharacter = {
            ...(initialSave.character ?? {}),
            element: "Water",
            elements: ["Water", "Wind"],
            claimedAwakenings: ["awakening-free-lv2", "awakening-free-lv20"],
        };
        initialSave.character = initialCharacter;
        const runtime = await installUiAuditRuntime(page, initialSave);
        let requestedKind = "";
        let requestCount = 0;

        await page.route("**/api/awakening/roll", async (route) => {
            requestCount += 1;
            requestedKind = String((route.request().postDataJSON() as { kind?: string }).kind ?? "");
            if (requestCount === 1) {
                await route.fulfill({
                    status: 400,
                    contentType: "application/json",
                    body: JSON.stringify({ error: "The stone rejected this reroll." }),
                });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    character: {
                        ...initialCharacter,
                        element: "Fire",
                        elements: ["Fire", "Wind"],
                        fateShards: Number(initialCharacter.fateShards) - 10,
                    },
                    _saveVersion: 2,
                }),
            });
        });

        await expectUiAuditBoot(page, runtime, "centralHub");
        await expect(page.locator(".ca-cinematic")).toHaveCount(0);

        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        await expect(page.getByRole("dialog", { name: "Awakening Stone" })).toBeVisible();
        await expect(page.locator(".ca-cinematic")).toHaveCount(0);

        await page.getByRole("button", { name: /^Reroll Element 1 element/ }).click();
        await expect(page.getByText("❌ The stone rejected this reroll.")).toBeVisible();
        await expect(page.locator(".ca-cinematic")).toHaveCount(0);
        expect(
            runtimeErrors.filter((message) => !/status of 400/i.test(message)),
            "The simulated rejected reroll emitted an unexpected error",
        ).toEqual([]);
        runtimeErrors.length = 0;

        await page.getByRole("button", { name: /^Reroll Element 1 element/ }).click();
        const cinematic = page.getByRole("dialog", { name: "Fire Release" });
        await expect(cinematic).toBeVisible();
        await expect(cinematic).toHaveAttribute("data-element", "fire");
        await expect(cinematic.locator(".ca-sigil[data-element='fire']")).toHaveCount(1);
        await expect(cinematic.locator(".ca-sigil[data-element='water']")).toHaveCount(0);
        await expect(cinematic.locator("#central-awakening-result")).toHaveText("Fire");
        await expect(cinematic.locator(".ca-sigil img")).toHaveAttribute(
            "src",
            "/assets/awakening-element-fire-v1.webp",
        );
        await expect(cinematic.locator(".ca-backdrop")).toHaveCSS(
            "background-image",
            /awakening-stone-cinematic-v1\.webp/,
        );
        await expect(cinematic.locator(".ca-sigil img")).toHaveJSProperty("complete", true);
        expect(requestedKind).toBe("paid-single");
        expect(runtimeErrors, "Awakening reroll reveal emitted runtime errors").toEqual([]);

        if (process.env.UI_AUDIT_CAPTURE === "1") {
            await page.waitForTimeout(1_350);
            await page.screenshot({
                path: testInfo.outputPath("awakening-stone-fire.png"),
                animations: "allow",
                fullPage: false,
            });
        }

    });

    test("rerolls both elements for 15 shards and reveals both committed natures", async ({ page }) => {
        const runtimeErrors = collectRuntimeErrors(page);
        const initialSave = uiAuditSave();
        const initialCharacter = {
            ...(initialSave.character ?? {}),
            element: "Water",
            elements: ["Water", "Wind"],
            claimedAwakenings: ["awakening-free-lv2", "awakening-free-lv20"],
        };
        initialSave.character = initialCharacter;
        const runtime = await installUiAuditRuntime(page, initialSave);
        let requestedKind = "";

        await page.route("**/api/awakening/roll", async (route) => {
            requestedKind = String((route.request().postDataJSON() as { kind?: string }).kind ?? "");
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    character: {
                        ...initialCharacter,
                        element: "Earth",
                        elements: ["Earth", "Lightning"],
                        fateShards: Number(initialCharacter.fateShards) - 15,
                    },
                    _saveVersion: 2,
                }),
            });
        });

        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        await page.getByRole("button", { name: /Reroll Elements/ }).click();

        const cinematic = page.getByRole("dialog", { name: "Elemental Convergence" });
        await expect(cinematic).toBeVisible();
        await expect(cinematic).toHaveAttribute("data-mode", "reroll");
        await expect(cinematic).toHaveAttribute("data-element", "earth");
        await expect(cinematic.locator(".ca-sigil[data-element='earth']")).toHaveCount(1);
        await expect(cinematic.locator(".ca-sigil[data-element='lightning']")).toHaveCount(1);
        await expect(cinematic.locator("#central-awakening-result")).toHaveText("Earth · Lightning");
        expect(requestedKind).toBe("paid-both");
        expect(runtimeErrors, "Two-element reroll reveal emitted runtime errors").toEqual([]);
    });
});
