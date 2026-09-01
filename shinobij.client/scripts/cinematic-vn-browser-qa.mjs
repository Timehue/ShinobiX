import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? process.env.CINEMATIC_VN_BASE_URL ?? "https://vite.dev.localhost:4173";
const outputDir = path.resolve("tmp", "imagegen", "vn-improvements", "browser-qa");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const reports = [];

const expectedBackdrop = {
    stormveil: {
        standard: "stormveil-civic.webp",
        crisis: "stormveil-blackout.webp",
        aftermath: "stormveil-aftermath.webp",
    },
    ashen: {
        standard: "ashen-civic.webp",
        crisis: "ashen-ashfall.webp",
        aftermath: "ashen-aftermath.webp",
    },
    frostfang: {
        standard: "frostfang-civic.webp",
        crisis: "frostfang-whiteout.webp",
        aftermath: "frostfang-aftermath.webp",
    },
    moonshadow: {
        standard: "moonshadow-civic.webp",
        crisis: "moonshadow-blackout.webp",
        aftermath: "moonshadow-aftermath.webp",
    },
};

const expectedDialogue = {
    standard: "The civic hall keeps its composure",
    crisis: "Alarm bells answer a blackout",
    aftermath: "After the battle, recovery crews",
};

async function openPreview({
    name,
    width,
    height,
    village,
    state,
    reducedMotion = false,
    hollow = false,
    expectedActor,
    expectedBackground,
    expectedDialogueText,
    expectedActorCount = 2,
    chapter,
    playerAvatar,
}) {
    const page = await browser.newPage({
        ignoreHTTPSErrors: true,
        viewport: { width, height },
        reducedMotion: reducedMotion ? "reduce" : "no-preference",
    });
    const consoleErrors = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.addInitScript(() => {
        window.localStorage.setItem("vnTextSpeed.v1", "instant");
        window.localStorage.setItem("vnReaderMode.v1", "cinematic");
        window.localStorage.setItem("vnAutoRead.v1", "0");
        const NativeAudio = window.Audio;
        window.__vnQaAudio = [];
        window.Audio = function (...args) {
            const element = new NativeAudio(...args);
            window.__vnQaAudio.push(element);
            return element;
        };
        window.Audio.prototype = NativeAudio.prototype;
    });
    const url = new URL(baseUrl);
    url.searchParams.set("preview", "vn");
    url.searchParams.set("village", village);
    url.searchParams.set("state", state);
    if (chapter) url.searchParams.set("chapter", chapter);
    if (hollow) url.searchParams.set("hollow", "1");
    if (playerAvatar) url.searchParams.set("avatar", playerAvatar);
    // Vite keeps its HMR transport open in development, so DOM readiness plus
    // explicit stage/image waits is a more deterministic contract than the
    // browser-wide network-idle heuristic.
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 90_000 });
    assert.equal(response?.status(), 200, `${name}: preview did not load`);
    await page.locator(".cvn-root").waitFor({ state: "visible" });
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    await page.waitForTimeout(800);

    const metrics = await page.evaluate(() => {
        const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const buttons = Array.from(document.querySelectorAll("button"))
            .filter(visible)
            .map((button) => {
                const rect = button.getBoundingClientRect();
                return {
                    label: button.getAttribute("aria-label") || button.textContent?.trim() || "button",
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
            });
        return {
            overlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")),
            horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
            actorImages: Array.from(document.querySelectorAll(".cvn-actor img")).map((image) => ({
                src: image.getAttribute("src"),
                decoded: image.complete && image.naturalWidth > 0,
                width: image.naturalWidth,
                height: image.naturalHeight,
                className: image.className,
            })),
            buttons,
            reducedClass: document.querySelector(".cvn-root")?.classList.contains("is-reduced") ?? false,
            atmosphereCount: document.querySelectorAll(".cvn-atmosphere").length,
            rootClass: document.querySelector(".cvn-root")?.className ?? "",
            background: document.querySelector(".cvn-root")?.style.getPropertyValue("--cvn-background") ?? "",
            dialogueText: document.querySelector(".cvn-dialogue-text")?.textContent?.trim() ?? "",
            dialogueBox: (() => {
                const element = document.querySelector(".cvn-dialogue-shell");
                if (!element) return null;
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            })(),
            floatingSceneVisible: (() => {
                const element = document.querySelector(".cvn-scene-caption");
                return element ? visible(element) : false;
            })(),
            dialogueSceneVisible: (() => {
                const element = document.querySelector(".cvn-dialogue-scene");
                return element ? visible(element) : false;
            })(),
            actorBoxes: Array.from(document.querySelectorAll(".cvn-actor"))
                .filter(visible)
                .map((actor) => {
                    const rect = actor.getBoundingClientRect();
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
                }),
            playerBox: (() => {
                const actor = document.querySelector(".cvn-actor.is-player");
                if (!actor) return null;
                const rect = actor.getBoundingClientRect();
                return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            })(),
        };
    });

    assert.equal(metrics.overlay, false, `${name}: framework error overlay`);
    assert.ok(metrics.horizontalOverflow <= 1, `${name}: ${metrics.horizontalOverflow}px horizontal overflow`);
    assert.equal(metrics.actorImages.length, expectedActorCount, `${name}: unexpected actor count`);
    assert.ok(metrics.actorImages.every((image) => image.decoded), `${name}: actor image failed to decode`);
    assert.ok(metrics.buttons.every((button) => button.width >= 44 && button.height >= 44), `${name}: undersized control ${JSON.stringify(metrics.buttons)}`);
    const backdrop = expectedBackground ?? expectedBackdrop[village][state];
    assert.match(metrics.background, new RegExp(backdrop.replace(".", "\\.")), `${name}: expected backdrop was not routed`);
    assert.match(metrics.dialogueText, new RegExp(expectedDialogueText ?? expectedDialogue[state]), `${name}: dialogue line was not rendered`);
    if (width <= 800 && height > width) {
        assert.equal(metrics.floatingSceneVisible, false, `${name}: floating scene caption still covers mobile artwork`);
        assert.equal(metrics.dialogueSceneVisible, true, `${name}: mobile dialogue card lost the scene context`);
        assert.ok(metrics.dialogueBox, `${name}: mobile dialogue card is missing`);
        assert.ok((metrics.dialogueBox?.left ?? -1) >= 0 && (metrics.dialogueBox?.right ?? width + 1) <= width, `${name}: dialogue card leaves the viewport`);
        assert.ok((metrics.dialogueBox?.bottom ?? height + 1) <= height, `${name}: dialogue card falls below the viewport`);
        assert.ok(
            metrics.actorBoxes.every((actor) => actor.bottom <= (metrics.dialogueBox?.top ?? height) + 2),
            `${name}: mobile actor overlaps the dialogue card ${JSON.stringify({ actors: metrics.actorBoxes, dialogue: metrics.dialogueBox })}`,
        );
    }
    if (expectedActor) {
        assert.ok(
            metrics.actorImages.some((image) => image.src?.includes(expectedActor)),
            `${name}: authored actor ${expectedActor} was not rendered`,
        );
    }
    if (playerAvatar) {
        assert.ok(metrics.playerBox, `${name}: player upload was not put on stage`);
        assert.ok(
            metrics.actorImages.some((image) => image.className.includes(`cvn-avatar-${playerAvatar}`)),
            `${name}: ${playerAvatar} upload did not receive aspect-aware framing`,
        );
        assert.ok(metrics.playerBox.left < width && metrics.playerBox.right > 0, `${name}: player framing left the viewport`);
    }
    assert.deepEqual(consoleErrors, [], `${name}: console errors`);
    if (reducedMotion) {
        assert.equal(metrics.reducedClass, true, `${name}: reduced-motion class missing`);
        assert.equal(metrics.atmosphereCount, 0, `${name}: atmosphere should be absent in reduced motion`);
    }

    await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
    reports.push({ name, width, height, village, state, ...metrics });
    return page;
}

try {
    const mobile = await openPreview({
        name: "moonshadow-crisis-390x844",
        width: 390,
        height: 844,
        village: "moonshadow",
        state: "crisis",
    });
    const settings = mobile.getByRole("button", { name: "Visual novel settings" });
    assert.equal(await settings.isVisible(), true, "mobile: settings button missing");
    assert.equal(await mobile.getByRole("button", { name: "Classic" }).isVisible().catch(() => false), false, "mobile: desktop Classic control should be hidden");
    await mobile.getByRole("button", { name: "Unmute game audio" }).click();
    assert.equal(await mobile.getByRole("button", { name: "Mute game audio" }).isVisible(), true, "mobile: audio state did not unlock");
    await mobile.waitForFunction(() => window.__vnQaAudio?.some((audio) => audio.src.includes("/music/vn/moonshadow-name-under-glass.ogg")));
    const scoreBeforeAdvance = await mobile.evaluate(() => {
        const audio = window.__vnQaAudio.find((candidate) => candidate.src.includes("/music/vn/moonshadow-name-under-glass.ogg"));
        return audio ? { src: audio.src, currentTime: audio.currentTime, loop: audio.loop, volume: audio.volume } : null;
    });
    assert.ok(scoreBeforeAdvance?.loop, "mobile: VN score did not use a looping audio deck");
    assert.ok((scoreBeforeAdvance?.volume ?? 1) <= 0.18, "mobile: VN score exceeded its dialogue-safe base volume");
    await mobile.locator(".cvn-root").focus();
    await mobile.keyboard.press("Shift+Tab");
    assert.equal(await mobile.evaluate(() => Boolean(document.querySelector(".cvn-root")?.contains(document.activeElement))), true, "mobile: reverse tab escaped the immersive dialog");
    await mobile.keyboard.press("Tab");
    assert.equal(await mobile.evaluate(() => Boolean(document.querySelector(".cvn-root")?.contains(document.activeElement))), true, "mobile: forward tab escaped the immersive dialog");
    await settings.click();
    const menu = mobile.locator(".cvn-settings-menu");
    await menu.waitFor({ state: "visible" });
    assert.match(await menu.innerText(), /Text: Instant/);
    assert.match(await menu.innerText(), /Text size: Default/);
    assert.match(await menu.innerText(), /Contrast: Standard/);
    assert.match(await menu.innerText(), /Auto-read: Off/);
    assert.match(await menu.innerText(), /Classic reader/);
    const menuBox = await menu.boundingBox();
    assert.ok(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, "mobile: settings menu leaves viewport");
    await mobile.screenshot({ path: path.join(outputDir, "moonshadow-settings-390x844.png") });
    await menu.getByRole("button", { name: "Text size: Default" }).click();
    assert.equal(await mobile.locator(".cvn-root").evaluate((root) => root.classList.contains("text-large")), true, "mobile: large-text setting was not applied");
    await menu.getByRole("button", { name: "Contrast: Standard" }).click();
    assert.equal(await mobile.locator(".cvn-root").evaluate((root) => root.classList.contains("contrast-high")), true, "mobile: high-contrast setting was not applied");
    await menu.getByRole("button", { name: "Auto-read: Off" }).click();
    assert.equal(await mobile.locator(".cvn-auto-status").isVisible(), true, "mobile: auto-read status/off control missing");
    await mobile.locator(".cvn-auto-status").click();
    assert.equal(await mobile.locator(".cvn-auto-status").count(), 0, "mobile: auto-read could not be disabled from the stage");
    assert.match(await mobile.locator(".cvn-dialogue-text").innerText(), /Alarm bells answer a blackout/);
    await settings.click();
    await menu.waitFor({ state: "visible" });
    await menu.getByRole("button", { name: "Classic reader" }).click();
    await mobile.locator(".visual-novel.admin-vn-play").waitFor({ state: "visible" });
    assert.equal(await mobile.locator(".cvn-root").count(), 0, "mobile: cinematic stage remained mounted in Classic mode");
    await mobile.screenshot({ path: path.join(outputDir, "moonshadow-classic-390x844.png") });
    await mobile.getByRole("button", { name: "Cinematic" }).click();
    await mobile.locator(".cvn-root").waitFor({ state: "visible" });
    await mobile.close();

    const scenarios = [
        { name: "moonshadow-crisis-320x568", width: 320, height: 568, village: "moonshadow", state: "crisis" },
        { name: "stormveil-standard-430x932", width: 430, height: 932, village: "stormveil", state: "standard" },
        { name: "stormveil-player-square-430x932", width: 430, height: 932, village: "stormveil", state: "standard", playerAvatar: "square" },
        { name: "frostfang-aftermath-768x1024", width: 768, height: 1024, village: "frostfang", state: "aftermath" },
        { name: "ashen-crisis-1366x768", width: 1366, height: 768, village: "ashen", state: "crisis" },
        {
            name: "frostfang-pale-pack-one-bell-1366x768",
            width: 1366,
            height: 768,
            village: "frostfang",
            state: "standard",
            chapter: "pale-pack",
            playerAvatar: "square",
            expectedActor: "pale-pack-runner.webp",
            expectedBackground: "frostfang-pale-pack-cavern-mouth.webp",
            expectedDialogueText: "They've done this before",
        },
        {
            name: "road-border-smoke-1366x768",
            width: 1366,
            height: 768,
            village: "stormveil",
            state: "standard",
            chapter: "road",
            playerAvatar: "square",
            expectedActor: "pell-marrow.webp",
            expectedBackground: "story-road-border-smoke.webp",
            expectedDialogueText: "Miller's Ford",
        },
        {
            name: "rift-legacy-echo-1366x768",
            width: 1366,
            height: 768,
            village: "moonshadow",
            state: "standard",
            chapter: "rift",
            playerAvatar: "square",
            expectedActor: "senna-graveward.webp",
            expectedBackground: "rift-giver-legacy-echo.webp",
            expectedDialogueText: "Hold this brush",
        },
        {
            name: "chronicle-scribe-1366x768",
            width: 1366,
            height: 768,
            village: "stormveil",
            state: "standard",
            chapter: "scribe",
            playerAvatar: "square",
            expectedActor: "scribe-ihara.webp",
            expectedBackground: "chronicle-scribe.webp",
            expectedDialogueText: "Hold up, you",
        },
        {
            name: "hidden-dungeon-1366x768",
            width: 1366,
            height: 768,
            village: "moonshadow",
            state: "standard",
            chapter: "dungeon",
            playerAvatar: "square",
            expectedActor: "dungeon-warden.webp",
            expectedBackground: "builtin-hidden-dungeon.webp",
            expectedDialogueText: "Field record",
        },
        {
            name: "pet-encounter-1366x768",
            width: 1366,
            height: 768,
            village: "stormveil",
            state: "standard",
            chapter: "pet",
            expectedActorCount: 1,
            expectedActor: "generic-ai-pet-guardhound-idle.webp",
            expectedBackground: "sys-pet-encounter.webp",
            expectedDialogueText: "A branch snaps",
            completionAction: "Meet Companion",
        },
        {
            name: "ancient-chest-1366x768",
            width: 1366,
            height: 768,
            village: "ashen",
            state: "standard",
            chapter: "chest",
            expectedActorCount: 0,
            expectedBackground: "sys-ancient-chest.webp",
            expectedDialogueText: "You clear two loose stones",
            completionAction: "Open Chest",
        },
        {
            name: "stormveil-hollow-finale-1366x768",
            width: 1366,
            height: 768,
            village: "stormveil",
            state: "crisis",
            hollow: true,
            expectedActor: "kage-raiko-veyr-hollow.webp",
        },
        { name: "moonshadow-aftermath-1920x1080", width: 1920, height: 1080, village: "moonshadow", state: "aftermath" },
        { name: "moonshadow-player-wide-1920x1080", width: 1920, height: 1080, village: "moonshadow", state: "standard", playerAvatar: "wide" },
    ];
    for (const scenario of scenarios) {
        const page = await openPreview(scenario);
        if (scenario.hollow) {
            await page.getByRole("button", { name: "Unmute game audio" }).click();
            await page.waitForFunction(() => window.__vnQaAudio?.some((audio) => audio.src.includes("/music/vn/hollow-gate-four-debts.ogg")));
            const scoreBefore = await page.evaluate(() => {
                const audio = window.__vnQaAudio.find((candidate) => candidate.src.includes("/music/vn/hollow-gate-four-debts.ogg"));
                return audio ? { src: audio.src, currentTime: audio.currentTime } : null;
            });
            await page.getByRole("button", { name: "Next" }).click();
            await page.waitForFunction(() => document.querySelector(".cvn-actor.is-right")?.classList.contains("is-speaking"));
            assert.match(await page.locator(".cvn-dialogue-text").innerText(), /No one calls this victory/);
            await page.waitForTimeout(250);
            const scoreAfter = await page.evaluate(() => {
                const audio = window.__vnQaAudio.find((candidate) => candidate.src.includes("/music/vn/hollow-gate-four-debts.ogg"));
                return audio ? { src: audio.src, currentTime: audio.currentTime } : null;
            });
            assert.equal(scoreAfter?.src, scoreBefore?.src, `${scenario.name}: score route changed between lines`);
            assert.ok(
                (scoreAfter?.currentTime ?? 0) + 0.05 >= (scoreBefore?.currentTime ?? 0),
                `${scenario.name}: score restarted between lines`,
            );
            await page.screenshot({ path: path.join(outputDir, `${scenario.name}-speaking.png`) });
        }
        if (scenario.completionAction) {
            for (let step = 0; step < 20; step += 1) {
                const completion = page.getByRole("button", { name: scenario.completionAction });
                if (await completion.isVisible().catch(() => false)) break;
                const advance = page.getByRole("button", { name: /^(Next|Continue)$/ }).last();
                assert.equal(await advance.isVisible().catch(() => false), true, `${scenario.name}: story could not reach its completion handoff`);
                await advance.click();
                await page.waitForTimeout(50);
            }
            assert.equal(
                await page.getByRole("button", { name: scenario.completionAction }).isVisible().catch(() => false),
                true,
                `${scenario.name}: ${scenario.completionAction} handoff missing`,
            );
            // Let the finale's entrance transform settle before preserving the
            // visual artifact; an in-flight scale/slide is intentionally clipped
            // by the immersive viewport and is not the resting layout.
            await page.waitForTimeout(900);
            // Playwright scrolls the active control into view before clicking;
            // reset that test-only document scroll so fixed immersive framing is
            // captured from the same origin as a normal pointer interaction.
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(100);
            await page.screenshot({ path: path.join(outputDir, `${scenario.name}-finale.png`) });
        }
        if (scenario.width >= 801) {
            assert.equal(await page.getByRole("button", { name: "Visual novel settings" }).isVisible().catch(() => false), false, `${scenario.name}: mobile settings should be hidden`);
            assert.equal(await page.getByRole("button", { name: "Classic" }).isVisible(), true, `${scenario.name}: desktop Classic control missing`);
            assert.equal(await page.getByRole("button", { name: "Text: Instant" }).isVisible(), true, `${scenario.name}: desktop text-speed control missing`);
        }
        await page.close();
    }

    const reduced = await openPreview({
        name: "moonshadow-reduced-430x932",
        width: 430,
        height: 932,
        village: "moonshadow",
        state: "aftermath",
        reducedMotion: true,
    });
    await reduced.close();
} finally {
    await browser.close();
}

console.log(JSON.stringify(reports, null, 2));
