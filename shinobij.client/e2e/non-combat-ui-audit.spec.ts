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
                        ".table-scroll, .ui-tabs, .admin-tabs, .profile-mobile-tabs, .chronicle-hand, .world-map-scroll, .hol-tabs, .council-tabs, .expanded-tabs, .pet-home-tabs, .pet-arena-mode-toggle, .pet-pick-strip",
                    ));
                    return !ownsHorizontalScroll && (rect.right > viewportWidth + 1 || rect.left < -1);
                })
                .map(label),
            undersizedControls: controls
                .filter((control) => {
                    const rect = control.getBoundingClientRect();
                    return Math.min(rect.width, rect.height) < 24;
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
    { card: "Awakening Stone", dialog: "Awakening Stone", capture: "central-awakening-stone" },
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
        expect(metrics.undersizedControls, `${destination.card} has controls below the 24px target minimum`).toEqual([]);
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
        expect(metrics.undersizedControls, `${destination.card} has controls below the 24px target minimum`).toEqual([]);
        expect(runtimeErrors, `${destination.card} emitted runtime errors`).toEqual([]);
        await capture(page, testInfo, destination.capture);
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
            ],
            logicalStages: [".world-map-scroll"],
        });
        await page.waitForTimeout(150);
        const metrics = await auditVisibleScreen(page);
        expect(metrics.emptyMain, `${screen} rendered no meaningful main content`).toBe(false);
        expect(metrics.brokenBackgrounds, `${screen} has broken visible background artwork`).toEqual([]);
        expect(metrics.brokenImages, `${screen} has broken visible artwork`).toEqual([]);
        expect(metrics.clippedControls, `${screen} has controls clipped by the viewport`).toEqual([]);
        expect(metrics.undersizedControls, `${screen} has controls below the 24px WCAG target minimum`).toEqual([]);
        expect(runtimeErrors, `${screen} emitted runtime errors`).toEqual([]);
        await capture(page, testInfo, screen);
    });
}

test("user directory routes into a production-safe public profile", async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, "village");
    let users = page.getByRole("button", { name: "Users", exact: true }).filter({ visible: true });
    if (await users.count() === 0) {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        users = page.getByRole("button", { name: "Users", exact: true }).filter({ visible: true });
    }
    await users.click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "userHub");
    await expectViewportSafe(page);
    const directoryMetrics = await auditVisibleScreen(page);
    expect(directoryMetrics.emptyMain, "userHub rendered no meaningful main content").toBe(false);
    expect(directoryMetrics.brokenBackgrounds, "userHub has broken visible background artwork").toEqual([]);
    expect(directoryMetrics.brokenImages, "userHub has broken visible artwork").toEqual([]);
    expect(directoryMetrics.clippedControls, "userHub has controls clipped by the viewport").toEqual([]);
    expect(directoryMetrics.undersizedControls, "userHub has controls below the 24px WCAG target minimum").toEqual([]);
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
    expect(metrics.undersizedControls, "userView has controls below the 24px WCAG target minimum").toEqual([]);
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
        await expect(cinematic.locator(".central-awakening-sigil img")).toHaveAttribute(
            "src",
            "/assets/awakening-element-lightning-v1.webp",
        );
        expect(requestedKind).toBe("awakening-free-lv2");
        expect(runtimeErrors, "Awakening reveal emitted runtime errors").toEqual([]);

        await cinematic.getByRole("button", { name: "Skip reveal" }).click();
        await expect(cinematic).toBeHidden();
    });

    test("plays only after a successful reroll and reveals the committed element", async ({ page }, testInfo) => {
        const runtimeErrors = collectRuntimeErrors(page);
        const initialSave = uiAuditSave();
        const initialCharacter = {
            ...(initialSave.character ?? {}),
            element: "Water",
            elements: ["Water"],
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
                        elements: ["Fire"],
                        fateShards: Number(initialCharacter.fateShards) - 10,
                    },
                    _saveVersion: 2,
                }),
            });
        });

        await expectUiAuditBoot(page, runtime, "centralHub");
        await expect(page.locator(".central-awakening-cinematic")).toHaveCount(0);

        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        await expect(page.getByRole("dialog", { name: "Awakening Stone" })).toBeVisible();
        await expect(page.locator(".central-awakening-cinematic")).toHaveCount(0);

        await page.getByRole("button", { name: /Reroll Element/ }).click();
        await expect(page.getByText("❌ The stone rejected this reroll.")).toBeVisible();
        await expect(page.locator(".central-awakening-cinematic")).toHaveCount(0);
        expect(runtimeErrors, "The simulated rejected reroll emitted an unexpected error").toEqual([
            expect.stringMatching(/status of 400/i),
        ]);
        runtimeErrors.length = 0;

        await page.getByRole("button", { name: /Reroll Element/ }).click();
        const cinematic = page.getByRole("dialog", { name: "Fire Release" });
        await expect(cinematic).toBeVisible();
        await expect(cinematic).toHaveAttribute("data-element", "fire");
        await expect(cinematic.locator(".central-awakening-sigil[data-element='fire']")).toHaveCount(1);
        await expect(cinematic.locator(".central-awakening-sigil[data-element='water']")).toHaveCount(0);
        await expect(cinematic.locator("#central-awakening-result")).toHaveText("Fire");
        await expect(cinematic.locator(".central-awakening-sigil img")).toHaveAttribute(
            "src",
            "/assets/awakening-element-fire-v1.webp",
        );
        await expect(cinematic.locator(".central-awakening-backdrop")).toHaveCSS(
            "background-image",
            /awakening-stone-cinematic-v1\.webp/,
        );
        await expect(cinematic.locator(".central-awakening-sigil img")).toHaveJSProperty("complete", true);
        expect(requestedKind).toBe("paid");
        expect(runtimeErrors, "Awakening reroll reveal emitted runtime errors").toEqual([]);

        if (process.env.UI_AUDIT_CAPTURE === "1") {
            await page.waitForTimeout(1_350);
            await page.screenshot({
                path: testInfo.outputPath("awakening-stone-fire.png"),
                animations: "allow",
                fullPage: false,
            });
        }

        await cinematic.getByRole("button", { name: "Skip reveal" }).click();
        await expect(cinematic).toBeHidden();
    });
});
