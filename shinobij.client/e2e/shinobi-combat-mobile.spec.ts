import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { previewRootFor, smokeE2ePort } from "../e2e-ports";

let productionCss = "";

test.beforeAll(() => {
    // Test files are discovered before Playwright starts its preview server.
    // Load built CSS only after that lifecycle boundary so a concurrent build
    // cannot leave worker startup looking at a temporarily empty dist folder.
    const previewRoot = previewRootFor(smokeE2ePort());
    const assetsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", previewRoot, "assets");
    const assets = readdirSync(assetsDirectory);
    const names = [
        assets.find((entry) => /^index-.*\.css$/.test(entry)),
        assets.find((entry) => /^battle-skin-.*\.css$/.test(entry)),
    ];
    if (names.some((name) => !name)) {
        throw new Error("Build the client before running the combat HUD visual contract");
    }
    productionCss = names.map((name) => readFileSync(join(assetsDirectory, name!), "utf8")).join("\n");
});

function sideHud(name: string, side: "player" | "enemy") {
    return `
        <aside class="combat-side-hud ${side === "player" ? "combat-side-hud--active" : ""}" data-side="${side}" tabindex="0" aria-label="${name} combat status">
            <div class="combat-hud-header"><h3>${name}</h3><span class="combat-hud-village">Leaf</span><span class="combat-hud-turn-badge">${side === "player" ? "Acting" : "Waiting"}</span></div>
            <div class="combat-avatar">${side === "player" ? "PN" : "EN"}</div>
            <div class="resource-line resource-line--hp"><span class="resource-label">HP <small>900 / 1000</small></span><div class="hud-bar hp-bar"><span style="width:90%"></span></div></div>
            <div class="resource-line resource-line--chakra"><span class="resource-label">Chakra <small>80 / 100</small></span><div class="hud-bar chakra-bar"><span style="width:80%"></span></div></div>
            <div class="resource-line resource-line--stamina"><span class="resource-label">Stamina <small>70 / 100</small></span><div class="hud-bar stamina-bar"><span style="width:70%"></span></div></div>
            <div class="resource-line resource-line--shield"><span class="resource-label">Shield <small>1500</small></span><div class="hud-bar shield-bar"><span style="width:100%"></span></div></div>
            <div class="combat-mobile-effects"><span class="cme-chip cme-pos">Guard <small>2r</small></span></div>
            <div class="combat-hud-meta"><span>Round 2</span></div>
            <div class="combat-effect-panel effects-buff"><h4>Buffs</h4><div class="effect-pill"><span>Damage dealt ↑</span><small>20% · 1r</small></div><div class="effect-pill"><span>Damage taken ↓</span><small>20% · 2r</small></div><div class="effect-pill"><span>Reflect</span><small>20% · 2r</small></div></div>
            <div class="combat-effect-panel effects-debuff"><h4>Debuffs</h4><div class="effect-pill"><span>Damage taken ↑</span><small>23% · 1r</small></div><div class="effect-pill"><span>Poison</span><small>23% · 1r</small></div></div>
            <div class="combat-hud-stats"><span class="chs-stat">Level 100</span><span class="chs-stat">Power 9,999</span></div>
        </aside>`;
}

function actionCards(count = 12) {
    return Array.from({ length: count }, (_, index) => `
        <div class="combat-jutsu-card-wrap">
            <button class="combat-jutsu-button" type="button">
                <span class="combat-jutsu-thumb"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect width='16' height='9' fill='%231e40af'/%3E%3Ccircle cx='8' cy='4.5' r='3' fill='%23fbbf24'/%3E%3C/svg%3E" alt="" /></span>
                <span class="combat-jutsu-name">Windmill Shuriken Line ${index + 1}</span>
                <small class="combat-jutsu-info">40 AP · R4 · CD 7</small>
            </button>
            <button class="combat-jutsu-help" type="button" aria-label="Details for Windmill Shuriken Line ${index + 1}"><span class="combat-help-glyph" aria-hidden="true">?</span></button>
        </div>
    `).join("");
}

async function mountCombatFixture(page: Page, mode: "solo" | "pvp", viewport: { width: number; height: number }) {
    await page.setViewportSize(viewport);
    await page.setContent(`
        <!doctype html>
        <html lang="en">
        <head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Combat HUD fixture</title></head>
        <body>
        <div id="combat" class="arena-fullscreen pvp-battle-layout shinobi-combat-shell shinobi-combat-shell--${mode} combat-instance">
            <div class="combat-layout">
                ${sideHud("Player Ninja", "player")}
                <main class="combat-main-area bt-actions">
                    <div class="arena-top-panel"><div class="arena-title-panel"><h2>Forest</h2><p>Round 2 | Shinobi Duel</p></div></div>
                    <div class="twp-strip"><span class="twp-strip-label">Terrain</span><span class="twp-strip-value">Forest cover</span></div>
                    <div class="dual-ap-panel">
                        <div><strong>Player AP</strong><div class="hud-bar ap-display-bar"><span style="width:80%"></span></div><small>80/100 | Active</small></div>
                        <div class="round-timer-display"><div class="round-timer-ring"><span class="round-timer-num">24</span></div><small>Turn Timer</small></div>
                        <div><strong>Enemy AP</strong><div class="hud-bar enemy-ap-display-bar"><span style="width:60%"></span></div><small>60/100 | Waiting</small></div>
                    </div>
                    <div class="combat-board-stage"><div class="hex-battlefield hex-forest"><span>TACTICAL BOARD</span></div></div>
                    <div class="battle-tabbar"><button class="battle-tab battle-tab-active">Actions</button><button class="battle-tab">Battle Log</button></div>
                    <div class="basic-action-bar shinobi-command-bar"><button><span>Attack</span></button><button><span>Move</span></button><button><span>Wait</span></button></div>
                    <div class="jutsu-layout-card combat-jutsu-bar"><div class="combat-equipped-jutsu-grid">${actionCards()}</div></div>
                    <div class="combat-text-log"><div class="combat-log-header">Battle Log</div></div>
                </main>
                ${sideHud("Enemy Ninja", "enemy")}
            </div>
        </div>
        </body>
        </html>
    `);
    await page.addStyleTag({ content: productionCss });
    await page.evaluate((width) => {
        document.documentElement.dataset.vp = width < 560 ? "xs" : width < 980 ? "sm" : width < 1180 ? "md" : width < 1400 ? "lg" : width < 2200 ? "xl" : "xxl";
    }, viewport.width);
}

async function box(page: Page, selector: string) {
    const value = await page.locator(selector).boundingBox();
    expect(value, `${selector} should be rendered`).not.toBeNull();
    return value!;
}

const mobilePortraits = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
];

const desktopSideDossierViewports = [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1400, height: 900 },
    { width: 1440, height: 900 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
];

const compactDesktopViewports = [
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
];

for (const mode of ["solo", "pvp"] as const) {
    test(`${mode} phone combat restores the fighter/AP/fighter HUD without changing the desktop shell`, async ({ page }, testInfo) => {
        for (const viewport of mobilePortraits) {
            await mountCombatFixture(page, mode, viewport);

            const player = await box(page, '[data-side="player"]');
            const ap = await box(page, ".dual-ap-panel");
            const enemy = await box(page, '[data-side="enemy"]');
            const board = await box(page, ".combat-board-stage");
            const avatar = page.locator('[data-side="player"] .combat-avatar');
            const hp = page.locator('[data-side="player"] .resource-line--hp');
            const command = await box(page, ".shinobi-command-bar button:first-child");
            const tab = await box(page, ".battle-tab:first-child");

            expect(Math.abs(player.y - ap.y)).toBeLessThanOrEqual(2);
            expect(Math.abs(enemy.y - ap.y)).toBeLessThanOrEqual(2);
            expect(player.x + player.width).toBeLessThanOrEqual(ap.x + 1);
            expect(ap.x + ap.width).toBeLessThanOrEqual(enemy.x + 1);
            expect(board.y).toBeGreaterThan(player.y + player.height);
            await expect(avatar).toBeVisible();
            await expect(hp).toBeVisible();
            expect((await avatar.boundingBox())?.width).toBeGreaterThanOrEqual(28);
            expect(command.height).toBeGreaterThanOrEqual(44);
            expect(tab.height).toBeGreaterThanOrEqual(44);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

            if (viewport.width <= 430) {
                const firstCard = page.locator(".combat-jutsu-card-wrap").first();
                const cardBox = await box(page, ".combat-jutsu-card-wrap");
                const castBox = await firstCard.locator(".combat-jutsu-button").boundingBox();
                const artBox = await firstCard.locator(".combat-jutsu-thumb img").boundingBox();
                const detailsBox = await firstCard.locator(".combat-jutsu-help").boundingBox();
                const glyphBox = await firstCard.locator(".combat-help-glyph").boundingBox();
                expect(castBox).not.toBeNull();
                expect(artBox).not.toBeNull();
                expect(detailsBox).not.toBeNull();
                expect(glyphBox).not.toBeNull();
                expect(Math.abs(castBox!.width - cardBox.width)).toBeLessThanOrEqual(1);
                expect(Math.abs(castBox!.height - cardBox.height)).toBeLessThanOrEqual(1);
                expect(Math.abs(artBox!.width - castBox!.width)).toBeLessThanOrEqual(1);
                expect(Math.abs(artBox!.height - castBox!.height)).toBeLessThanOrEqual(1);
                expect(detailsBox!.width).toBeGreaterThanOrEqual(44);
                expect(detailsBox!.height).toBeGreaterThanOrEqual(44);
                expect(Math.abs(detailsBox!.x + detailsBox!.width - (cardBox.x + cardBox.width))).toBeLessThanOrEqual(1);
                expect(Math.abs(detailsBox!.y - cardBox.y)).toBeLessThanOrEqual(1);
                expect(glyphBox!.width).toBeLessThanOrEqual(24);
                expect(glyphBox!.height).toBeLessThanOrEqual(24);
                await expect(firstCard.locator(".combat-jutsu-thumb img")).toHaveCSS("object-fit", "cover");
            }

            if (viewport.width === 390) {
                await testInfo.attach(`${mode}-mobile-combat-hud`, {
                    body: await page.screenshot(),
                    contentType: "image/png",
                });
            }
        }

        await mountCombatFixture(page, mode, { width: 667, height: 375 });
        const landscapePlayer = await box(page, '[data-side="player"]');
        const landscapeEnemy = await box(page, '[data-side="enemy"]');
        const landscapeAp = await box(page, ".dual-ap-panel");
        await expect(page.locator(".combat-main-area")).toHaveCSS("display", "grid");
        expect(Math.abs(landscapePlayer.y - landscapeEnemy.y)).toBeLessThanOrEqual(2);
        expect(landscapeAp.y).toBeGreaterThan(landscapePlayer.y + landscapePlayer.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(667);

        await mountCombatFixture(page, mode, { width: 980, height: 800 });
        await expect(page.locator(".combat-main-area")).toHaveCSS("display", "grid");
        await expect(page.locator('[data-side="player"] .combat-avatar')).toBeHidden();
    });

    test(`${mode} compact desktop preserves statuses and readable populated action cards`, async ({ page }) => {
        for (const viewport of compactDesktopViewports) {
            await mountCombatFixture(page, mode, viewport);

            const dossier = page.locator('[data-side="player"]');
            const statusStrip = dossier.locator(".combat-mobile-effects");
            await expect(dossier.locator(".combat-effect-panel").first()).toBeHidden();
            await expect(statusStrip).toBeVisible();
            await expect(statusStrip.locator(".cme-chip").first()).toContainText("Guard");
            const statusWidths = await statusStrip.evaluate((strip) => ({
                content: strip.scrollWidth,
                viewport: strip.clientWidth,
            }));
            expect(statusWidths.content).toBeLessThanOrEqual(statusWidths.viewport + 1);

            const cards = page.locator(".combat-jutsu-card-wrap");
            const firstCard = await cards.first().boundingBox();
            const details = await cards.first().locator(".combat-jutsu-help").boundingBox();
            expect(firstCard).not.toBeNull();
            expect(details).not.toBeNull();
            expect(firstCard!.width).toBeGreaterThanOrEqual(118);
            expect(firstCard!.width).toBeLessThanOrEqual(133);
            expect(details!.width).toBeGreaterThanOrEqual(44);
            expect(details!.height).toBeGreaterThanOrEqual(44);
            await expect(cards.first().locator(".combat-jutsu-name")).toHaveCSS("white-space", "normal");

            const centerHitsCastButton = await cards.first().evaluate((card) => {
                const cast = card.querySelector<HTMLElement>(".combat-jutsu-button");
                if (!cast) return false;
                const rect = cast.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return Boolean(hit?.closest(".combat-jutsu-button"));
            });
            expect(centerHitsCastButton).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        }
    });

    test(`${mode} desktop combat keeps effects readable with a persistent lower command deck`, async ({ page }, testInfo) => {
        for (const viewport of desktopSideDossierViewports) {
            await mountCombatFixture(page, mode, viewport);

            const dossier = page.locator('[data-side="player"]');
            const effectPanel = dossier.locator(".effects-buff");
            const effectHeading = await box(page, '[data-side="player"] .effects-buff h4');
            const effectPills = dossier.locator(".effects-buff .effect-pill");
            const firstEffect = await effectPills.first().boundingBox();

            await expect(effectPanel).toHaveCSS("display", "block");
            expect(firstEffect).not.toBeNull();
            expect(firstEffect!.y).toBeGreaterThanOrEqual(effectHeading.y + effectHeading.height - 1);
            expect(firstEffect!.width).toBeGreaterThanOrEqual(140);
            await expect(effectPills.first().locator("span")).toHaveCSS("word-break", "normal");
            expect(await effectPills.evaluateAll((pills) => pills.every((pill) => pill.scrollWidth <= pill.clientWidth + 1))).toBe(true);

            const cards = page.locator(".combat-jutsu-card-wrap");
            const firstCard = await cards.first().boundingBox();
            const lastCard = await cards.last().boundingBox();
            const tray = await box(page, ".combat-jutsu-bar");
            const board = await box(page, ".combat-board-stage");
            const details = await cards.first().locator(".combat-jutsu-help").boundingBox();
            expect(firstCard).not.toBeNull();
            expect(lastCard).not.toBeNull();
            expect(details).not.toBeNull();
            expect(firstCard!.width).toBeGreaterThanOrEqual(100);
            expect(firstCard!.width).toBeLessThanOrEqual(220);
            expect(details!.width).toBeGreaterThanOrEqual(43.9);
            expect(details!.height).toBeGreaterThanOrEqual(43.9);
            expect(lastCard!.x).toBeGreaterThanOrEqual(tray.x - 1);
            expect(lastCard!.x + lastCard!.width).toBeLessThanOrEqual(tray.x + tray.width + 1);
            expect(tray.x).toBeLessThan(board.x);
            expect(board.height).toBeGreaterThanOrEqual(240);
            await expect(cards.first().locator(".combat-jutsu-name")).toHaveCSS("white-space", "normal");

            const trayScroll = await page.locator(".combat-equipped-jutsu-grid").evaluate((element) => ({
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
                overflowY: getComputedStyle(element).overflowY,
            }));
            expect(trayScroll.scrollHeight).toBeGreaterThanOrEqual(trayScroll.clientHeight);
            expect(trayScroll.overflowY).toBe("auto");

            const centerHitsCastButton = await cards.first().evaluate((card) => {
                const cast = card.querySelector<HTMLElement>(".combat-jutsu-button");
                if (!cast) return false;
                const rect = cast.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return Boolean(hit?.closest(".combat-jutsu-button"));
            });
            expect(centerHitsCastButton).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        }

        if (mode === "solo") {
            await testInfo.attach("solo-desktop-combat-hud", {
                body: await page.screenshot(),
                contentType: "image/png",
            });
        }
    });
}

test("ambient screen help stays operable without intercepting the board at 200% zoom", async ({ page }) => {
    for (const viewport of [{ width: 720, height: 450 }, { width: 512, height: 384 }]) {
        await mountCombatFixture(page, "solo", viewport);
        await page.evaluate(() => {
            const hint = document.createElement("div");
            hint.className = "onboarding-coach-banner screen-hint-banner";
            hint.setAttribute("role", "note");
            hint.setAttribute("aria-label", "Mission Hall contextual tip");
            hint.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:520px;width:calc(100% - 24px);padding:10px 14px;display:flex;z-index:8500";
            hint.innerHTML = `
                <div class="screen-hint-inline" style="display:contents">
                    <span>Mission Hall - accept work, finish the objective, then return here to claim the posted reward.</span>
                    <button type="button">Got it</button>
                </div>
                <button type="button" class="screen-hint-battle-trigger" style="display:none" aria-label="Review Mission Hall tip" aria-haspopup="dialog" aria-expanded="false">
                    <span aria-hidden="true">?</span><span aria-hidden="true">Tip</span>
                </button>`;
            document.body.append(hint);
        });

        const board = await box(page, ".combat-board-stage");
        const trigger = await box(page, ".screen-hint-battle-trigger");
        await expect(page.locator(".screen-hint-inline")).toBeHidden();
        await expect(page.locator(".screen-hint-battle-trigger")).toBeVisible();
        expect(trigger.width).toBeGreaterThanOrEqual(44);
        expect(trigger.height).toBeGreaterThanOrEqual(44);
        expect(trigger.x >= board.x + board.width || trigger.y + trigger.height <= board.y).toBe(true);
        expect(await page.evaluate(() => {
            const boardNode = document.querySelector<HTMLElement>(".combat-board-stage");
            if (!boardNode) return false;
            const rect = boardNode.getBoundingClientRect();
            return Boolean(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(".combat-board-stage"));
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    }
});

test("populated desktop combat has no automated WCAG A/AA violations", async ({ page }) => {
    await mountCombatFixture(page, "solo", { width: 1440, height: 900 });
    const audit = await new AxeBuilder({ page })
        .include("#combat")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
    expect(audit.violations).toEqual([]);
});
