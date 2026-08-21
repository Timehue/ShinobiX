import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

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

async function auditVisibleScreen(page: Page): Promise<AuditMetrics> {
    return page.locator(".center-game").evaluate(async (main) => {
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
                .filter((image) => visible(image) && (!(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0))
                .map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src),
            clippedControls: controls
                .filter((control) => {
                    const rect = control.getBoundingClientRect();
                    const ownsHorizontalScroll = Boolean(control.closest(
                        ".table-scroll, .ui-tabs, .admin-tabs, .profile-mobile-tabs, .chronicle-hand, .world-map-scroll",
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

for (const screen of NON_COMBAT_SCREENS) {
    test(`${screen} is production-sized and artwork-safe`, async ({ page }, testInfo) => {
        const runtimeErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") runtimeErrors.push(message.text());
        });
        page.on("pageerror", (error) => runtimeErrors.push(error.message));
        page.on("response", (response) => {
            if (response.status() === 404) runtimeErrors.push(`404 ${response.url()}`);
        });
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
    const users = page.getByRole("button", { name: "Users", exact: true }).filter({ visible: true });
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await expect(users.or(menu)).toBeVisible();
    if (await menu.isVisible()) {
        await menu.click();
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
