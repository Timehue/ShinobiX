/*
 * Hollow Warfront — the Rite. End-to-end coverage of the autobattler.
 *
 * These pin what the mode's identity depends on: the player freely deploys all
 * four pets across ten cells, scouts two enemy positions, and watches eight
 * readable 3D fighters resolve cover, sight, range, and role decisions.
 */
import { expect, test } from "@playwright/test";

const riteUrl = "/petvfx.html?rite=1&petQuality=low";

async function openRite(page: import("@playwright/test").Page, url = riteUrl) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Set your formation" })).toBeVisible({ timeout: 30_000 });
}

async function touchTap(page: import("@playwright/test").Page, locator: import("@playwright/test").Locator) {
    const box = await locator.boundingBox();
    expect(box, "touch target must have a rendered box").not.toBeNull();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function expectReportLayerSettled(report: import("@playwright/test").Locator) {
    await expect.poll(async () => report.evaluate((layer) => {
        const style = getComputedStyle(layer);
        let transformAtRest = style.transform === "none";
        if (!transformAtRest) {
            try {
                const matrix = new DOMMatrixReadOnly(style.transform);
                transformAtRest = Math.abs(matrix.m11 - 1) < 0.001
                    && Math.abs(matrix.m12) < 0.001
                    && Math.abs(matrix.m21) < 0.001
                    && Math.abs(matrix.m22 - 1) < 0.001
                    && Math.abs(matrix.m41) < 0.001
                    && Math.abs(matrix.m42) < 0.001;
            } catch {
                transformAtRest = false;
            }
        }
        const transitionActive = layer.getAnimations().some((animation) => animation.pending
            || (animation.playState !== "idle" && animation.playState !== "finished"));
        return Number(style.opacity) === 1
            && style.visibility === "visible"
            && transformAtRest
            && !transitionActive;
    }), {
        message: "the reopened report layer must be fully opaque and transition-settled",
        timeout: 5_000,
    }).toBe(true);
}

async function expectOpponentFormationIdentity(
    report: import("@playwright/test").Locator,
    label: string,
) {
    const formation = report.getByRole("region", { name: "Opponent formation just fought" });
    const rows = await formation.evaluate(async (root) => {
        const reportLayer = root.closest<HTMLElement>(".wfr-reform-evidence");
        const reportBox = reportLayer?.getBoundingClientRect();
        const textMetric = (node: HTMLElement | null) => {
            if (!node) return null;
            const style = getComputedStyle(node);
            return {
                text: node.textContent?.trim().replace(/\s+/gu, " ") ?? "",
                fontPx: Number.parseFloat(style.fontSize),
                clientWidth: node.clientWidth,
                scrollWidth: node.scrollWidth,
                textOverflow: style.textOverflow,
            };
        };
        const images = [...root.querySelectorAll<HTMLImageElement>("li .wfr-portrait img")];
        await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
        return [...root.querySelectorAll<HTMLElement>("li")].map((row) => {
            const portrait = row.querySelector<HTMLElement>(".wfr-portrait");
            const image = portrait?.querySelector<HTMLImageElement>("img") ?? null;
            const box = row.getBoundingClientRect();
            return {
                petId: portrait?.dataset.wfrPetId ?? "",
                portraitKind: portrait?.dataset.wfrPortraitKind ?? "missing",
                image: image ? {
                    source: image.currentSrc || image.src,
                    complete: image.complete,
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                } : null,
                name: textMetric(row.querySelector<HTMLElement>("strong")),
                position: textMetric(row.querySelector<HTMLElement>("small")),
                fullyVisible: Boolean(reportBox
                    && box.left >= Math.max(0, reportBox.left) - 0.5
                    && box.top >= Math.max(0, reportBox.top) - 0.5
                    && box.right <= Math.min(innerWidth, reportBox.right) + 0.5
                    && box.bottom <= Math.min(innerHeight, reportBox.bottom) + 0.5),
            };
        });
    });

    expect(rows, `${label}: report must retain all four opponent rows`).toHaveLength(4);
    expect(rows.filter((row) => row.portraitKind !== "image"
        || !row.image?.complete
        || (row.image?.naturalWidth ?? 0) <= 0
        || (row.image?.naturalHeight ?? 0) <= 0), `${label}: every opponent portrait must be decoded placement art`).toEqual([]);
    expect(new Set(rows.map((row) => row.petId)).size, `${label}: every opponent row needs an explicit pet identity`).toBe(rows.length);
    expect(new Set(rows.map((row) => row.image?.source)).size, `${label}: distinct opponents must not share fallback art`).toBe(rows.length);
    expect(rows.filter((row) => !row.fullyVisible), `${label}: all four opponent rows must be visible together`).toEqual([]);
    expect(rows.flatMap((row) => [row.name, row.position]).filter((entry) => !entry
        || entry.fontPx < 14
        || entry.scrollWidth > entry.clientWidth
        || entry.textOverflow === "ellipsis"), `${label}: opponent names and positions must be full-size and unclipped`).toEqual([]);
}

async function expectFormationDiffRows(
    panel: import("@playwright/test").Locator,
    expectedRows: string[],
    label: string,
) {
    const geometry = await panel.evaluate((root, expected) => {
        const diff = root.querySelector<HTMLElement>(".wfr-formation-diff");
        if (!diff) return null;
        const toRect = (node: Element) => {
            const box = node.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const clips = (value: string) => /^(auto|hidden|scroll|clip)$/u.test(value);
        const diffBox = toRect(diff);
        const visibleClip = { left: Math.max(0, diffBox.x), top: Math.max(0, diffBox.y), right: Math.min(innerWidth, diffBox.right), bottom: Math.min(innerHeight, diffBox.bottom) };
        for (let ancestor = diff.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            const box = ancestor.getBoundingClientRect();
            if (clips(style.overflowX)) {
                visibleClip.left = Math.max(visibleClip.left, box.left);
                visibleClip.right = Math.min(visibleClip.right, box.right);
            }
            if (clips(style.overflowY)) {
                visibleClip.top = Math.max(visibleClip.top, box.top);
                visibleClip.bottom = Math.min(visibleClip.bottom, box.bottom);
            }
        }
        const actionRoot = root.querySelector<HTMLElement>(".wfr-deploy-actions");
        const actionSurfaces = [actionRoot, ...(actionRoot ? [...actionRoot.querySelectorAll<HTMLElement>("button")] : [])]
            .filter((node): node is HTMLElement => node !== null)
            .map((node) => ({
                label: node === actionRoot ? ".wfr-deploy-actions" : node.textContent?.trim().replace(/\s+/gu, " ") ?? "button",
                box: toRect(node),
            }));
        const intersects = (a: ReturnType<typeof toRect>, b: ReturnType<typeof toRect>) =>
            Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0
            && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0;
        const rows = [...diff.querySelectorAll<HTMLElement>(":scope > strong")].map((row) => {
            const box = toRect(row);
            return {
                text: row.textContent?.trim().replace(/\s+/gu, " ") ?? "",
                box,
                fullyInsideVisibleClip: box.x >= visibleClip.left - 0.5
                    && box.y >= visibleClip.top - 0.5
                    && box.right <= visibleClip.right + 0.5
                    && box.bottom <= visibleClip.bottom + 0.5,
                intersections: actionSurfaces.filter((surface) => intersects(box, surface.box)).map((surface) => surface.label),
            };
        });
        return {
            expectedRows: expected,
            diffBox,
            visibleClip,
            actionSurfaces,
            rows,
        };
    }, expectedRows);

    expect(geometry, `${label}: formation diff must exist`).not.toBeNull();
    expect(geometry!.rows.map((row) => row.text), `${label}: every changed pet must have exactly one previous-to-draft row`)
        .toEqual(expectedRows);
    expect(geometry!.rows.filter((row) => !row.fullyInsideVisibleClip), `${label}: every change row must be fully inside the diff's visible clip`).toEqual([]);
    expect(geometry!.rows.filter((row) => row.intersections.length > 0), `${label}: change rows must not intersect the action region or its buttons`).toEqual([]);
}

test("deployment exposes ten unrestricted cells and only two enemy positions", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once; responsive coverage runs separately");
    await openRite(page);

    await expect(page.getByText(/Starting cells decide first contact/)).toBeVisible();
    const onboarding = page.getByRole("list", { name: "Deployment steps" });
    await expect(onboarding.getByText("Inspect matchup", { exact: true })).toBeVisible();
    await expect(onboarding.getByText("Drag or tap any pet", { exact: true })).toBeVisible();
    await expect(onboarding.getByText("Lock formation", { exact: true })).toBeVisible();

    // Two positions are scouted while the other two stay sealed, so deployment
    // is an informed read rather than a solved matchup.
    const scout = page.getByRole("region", { name: "Enemy revealed deployment" });
    await expect(scout).toBeVisible();
    await expect(scout.getByText(/two stay sealed until combat/)).toBeVisible();

    await expect(page.getByLabel("Choose a pet to place").locator("button")).toHaveCount(4);
    await expect(page.getByLabel("Your deployment grid").locator("button")).toHaveCount(10);
});

test("any pet can move to any open deployment mark", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page);
    const picker = page.getByLabel("Choose a pet to place").locator("button");
    const chosenName = (await picker.nth(2).locator("strong").textContent()) ?? "";
    await picker.nth(2).click();
    await page.getByRole("button", { name: new RegExp(`Place ${chosenName} at North rear`) }).click();
    await expect(picker.nth(2)).toContainText(/North rear/i);
});

test("an occupied cell rejects movement and selects its existing pet", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page);
    const picker = page.getByLabel("Choose a pet to place").locator("button");
    const before = await picker.allTextContents();
    await picker.nth(0).click();
    await page.getByRole("button", { name: /Center rear occupied by .*tap to select/i }).click();
    expect(await picker.allTextContents()).toEqual(before);
    await expect(picker.nth(1)).toHaveAttribute("aria-pressed", "true");
});

test("cold load reveals all eight real rigs atomically at tick zero", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "cold-load interaction runs once");
    let releaseHeldModel!: () => void;
    const heldModel = new Promise<void>((resolve) => { releaseHeldModel = resolve; });
    let heldOne = false;
    await page.route(/\.glb(?:\?|$)/, async (route) => {
        if (!heldOne) {
            heldOne = true;
            await heldModel;
        }
        await route.continue();
    });

    await page.goto("/petvfx.html?rite=1&autostart=1&seed=23&petQuality=high&ritespeed=0.78&riteqa=1&ritemotionqa=1&riteforce3d=1", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
    });
    const curtain = page.getByTestId("wfr-stage-curtain");
    try {
        await expect(curtain).toBeVisible();
        await expect(curtain).toHaveCSS("opacity", "1");
        await expect(curtain).toHaveAttribute("data-stage-ready", "false");
        await expect(page.locator(".wfr-formation-hold")).toHaveCount(0);
        await expect(page.getByTestId("wfr-clock")).toHaveAttribute("data-tick", /^0(?:\.0+)?$/);

        // Some real rigs must finish while one GLTF remains withheld. This is
        // the exact partial-hydration frame which must never reach the player.
        const readyCount = async () => Number((await curtain.getAttribute("data-models-ready")) ?? "0");
        await expect.poll(readyCount, { timeout: 30_000 }).toBeGreaterThan(0);
        expect(await readyCount()).toBeLessThan(8);
        const [bounds, paint] = await Promise.all([
            curtain.boundingBox(),
            curtain.evaluate((element) => {
                const style = getComputedStyle(element);
                return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor };
            }),
        ]);
        const viewport = page.viewportSize()!;
        expect(bounds?.x ?? 1).toBeLessThanOrEqual(0);
        expect(bounds?.y ?? 1).toBeLessThanOrEqual(0);
        expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(viewport.width);
        expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(viewport.height);
        expect(`${paint.backgroundImage} ${paint.backgroundColor}`).not.toMatch(/^none rgba\(0, 0, 0, 0\)$/);
        await expect(curtain).toHaveCSS("opacity", "1");
        await expect(page.getByTestId("wfr-clock")).toHaveAttribute("data-tick", /^0(?:\.0+)?$/);
    } finally {
        releaseHeldModel();
    }

    await expect(curtain).toHaveAttribute("data-models-ready", "8", { timeout: 30_000 });
    await expect(curtain).toHaveAttribute("data-stage-ready", "true");
    await expect(curtain).toHaveCSS("visibility", "hidden", { timeout: 30_000 });
    await expect(page.locator(".wfr-formation-hold")).toBeVisible();
    await expect(page.getByTestId("wfr-clock")).toHaveAttribute("data-tick", /^0(?:\.0+)?$/);
    const tick = async () => Number((await page.getByTestId("wfr-clock").getAttribute("data-tick")) ?? "0");
    await expect.poll(tick, { timeout: 30_000 }).toBeGreaterThan(0);
});

test("eight active fighters are readable with the clash score", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=high&ritespeed=0.78&riteqa=1&ritemotionqa=1&riteforce3d=1");
    await page.getByRole("button", { name: "Lock formation" }).click();

    // Four active pets per side, with no reserve hidden outside the fight.
    await expect(page.getByRole("list", { name: "Your band" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("list", { name: "Their band" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.locator(".wfr-bar-fill")).toHaveCount(8);
    await expect(page.locator(".wfr-roster .is-reserve")).toHaveCount(0);

    // The clash is numbered and the best-of-three score is shown. Scoped to the
    // HUD: the opening card carries the same "CLASH n" text, so an unscoped
    // match is a strict-mode collision rather than a real assertion.
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText(/^BEASTBOUND · CLASH \d+$/, { timeout: 20_000 });
    await expect(page.getByLabel("Clashes won")).toBeVisible();

    // The 3D stage is actually mounted — this mode exists to show the models.
    const stageCanvas = page.locator(".wfr-canvas canvas");
    await expect(stageCanvas).toBeVisible({ timeout: 30_000 });
    await expect(stageCanvas).toHaveAttribute("data-rite-actor-render-mode", "skinned-3d", { timeout: 30_000 });
});

test("playback advances and the fighters actually take damage", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    // CI has no GPU. The software renderer draws this eight-rig scene at a small
    // fraction of local speed, so every wait below is sized for that, not for a
    // developer machine.
    test.setTimeout(300_000);
    await openRite(page);
    await page.getByRole("button", { name: "Lock formation" }).click();
    // The rite stage mounts TWO canvases once the formation locks: the live
    // .wfr-canvas-surface and an aria-hidden .wfr-canvas-static backdrop. ".wfr-canvas
    // canvas" matched one before the static layer existed and is now a strict-mode
    // collision, so name the surface the rest of this file already targets.
    await expect(page.locator(".wfr-canvas-surface")).toBeVisible({ timeout: 30_000 });

    const clock = page.getByTestId("wfr-clock");
    const tick = async () => Number((await clock.getAttribute("data-tick")) ?? "0");

    // The PLAYBACK CLOCK is the honest signal that the clash is running. It is a
    // ref driven by rAF and written straight to the DOM, so a frozen tick is the
    // single clearest symptom of the mode being broken — and unlike the health
    // bars it moves immediately, instead of waiting out the opening approach.
    // Assert it first so a real freeze fails fast and unambiguously.
    //
    // Assert ADVANCEMENT from an observed baseline, never an absolute tick. A
    // fixed threshold measures how fast the RENDERER is, not whether the clock
    // is running: CI's software renderer landed on exactly 30 against a
    // ">30 within 20s" bar and reported a healthy mode as frozen. The margin
    // keeps this sustained motion rather than one stray frame.
    const startTick = await tick();
    await expect.poll(tick, { timeout: 60_000, message: "the playback clock never advanced" })
        .toBeGreaterThan(startTick + 10);

    // Then the consequence: health must actually come off. Damage lands well
    // into the fight, and CI GPUs throttle rAF hard enough that wall-clock time
    // is a poor proxy for sim time — so poll the bars rather than sampling twice.
    const widths = () => page.locator(".wfr-bar-fill").evaluateAll(
        (nodes) => nodes.map((node) => (node as HTMLElement).style.width).join("|"),
    );
    const untouched = await widths();
    await expect.poll(widths, { timeout: 180_000, message: "no fighter ever took damage" })
        .not.toEqual(untouched);
});

test("the tactical report cannot advance before the player locks a rematch", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 200)));

    // A whole clash has to elapse before the re-form is offered, so scrub
    // playback. The simulation is already resolved — this only changes how fast
    // the resolved fight is drawn, never its outcome.
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1");
    await page.getByRole("button", { name: "Lock formation" }).click();

    // The panel GATES the handoff: it stays up until answered, so there is no
    // race against an auto-advance.
    const panel = page.getByRole("dialog", { name: "Tactical report and re-form" });
    await expect(panel).toBeVisible({ timeout: 180_000 });
    await expect(panel.getByText("Winner", { exact: true })).toBeVisible();
    await expect(panel.getByText("First KO", { exact: true })).toBeVisible();
    await expect(panel.getByText("Highest damage threat", { exact: true })).toBeVisible();
    await expect(panel.getByRole("region", { name: "Opponent formation just fought" }).getByRole("listitem")).toHaveCount(4);
    await expect(panel.getByText(/No outcome prediction/)).toBeVisible();

    // It halts the match, so it must behave like a modal: focused on open, or a
    // keyboard user is stranded tabbing the dimmed HUD behind it.
    await expect(panel).toBeFocused();
    await expect(panel).toHaveAttribute("aria-modal", "true");

    // This is a decision boundary, not a timed banner. Wait beyond the retired
    // interlude timeout and prove neither the panel nor clash number moves.
    await page.waitForTimeout(6_000);
    await expect(panel).toBeVisible();
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1");

    const lock = panel.getByRole("button", { name: "Lock & rematch" });
    await expect(lock).toBeEnabled();
    const picker = panel.getByLabel("Choose a pet to place").locator("button");
    await picker.nth(2).click();
    await panel.getByRole("button", { name: /Place .* at North rear/ }).click();
    await expect(panel.getByText(/Changes vs previous formation/)).toBeVisible();
    await expect(panel.locator(".wfr-formation-diff")).toContainText("→");
    await lock.click();

    // Committing resumes the match into the next clash rather than restarting it.
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 2", { timeout: 30_000 });
    expect(errors).toEqual([]);
});

test("Escape resets a draft but never seals or advances it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    test.setTimeout(240_000);
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1");
    await page.getByRole("button", { name: "Lock formation" }).click();

    const panel = page.getByRole("dialog", { name: "Tactical report and re-form" });
    await expect(panel).toBeVisible({ timeout: 180_000 });
    const picker = panel.getByLabel("Choose a pet to place").locator("button");
    await picker.nth(2).click();
    await panel.getByRole("button", { name: /Place .* at North rear/ }).click();
    await expect(panel.locator(".wfr-formation-diff")).toContainText("→");
    await page.keyboard.press("Escape");

    await expect(panel).toBeVisible();
    await expect(panel.locator(".wfr-formation-diff")).toContainText("No changes — holding the line");
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1");
    await panel.getByRole("button", { name: "Lock & rematch" }).click();
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 2", { timeout: 30_000 });
});

test("the re-form panel stays usable at phone width", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "this is the mobile layout check");
    test.setTimeout(240_000);
    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1");
    await page.getByRole("button", { name: "Lock formation" }).click();

    const panel = page.getByRole("dialog", { name: "Tactical report and re-form" });
    await expect(panel).toBeVisible({ timeout: 180_000 });
    await page.getByRole("button", { name: "Report read, re-form band" }).click();

    // The panel must fit the viewport and never push the page sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const box = await panel.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(page.viewportSize()!.width);

    // Both draft controls stay reachable and meet the touch-target minimum.
    for (const name of ["Reset changes", "Lock & rematch"]) {
        const button = panel.getByRole("button", { name });
        await expect(button).toBeVisible();
        const bounds = await button.boundingBox();
        expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
});

test("the exact Galaxy S25+ QHD report re-forms every pet and only Lock starts clash two", async ({ page }, testInfo) => {
    const qhdProjects = new Set(["galaxy-s25-plus-qhd-portrait", "galaxy-s25-plus-qhd-landscape"]);
    test.skip(!qhdProjects.has(testInfo.project.name), "exact QHD portrait and landscape release gate");
    test.setTimeout(300_000);

    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1");
    await touchTap(page, page.getByRole("button", { name: "Lock formation" }));

    const panel = page.getByRole("dialog", { name: "Tactical report and re-form" });
    await expect(panel).toBeVisible({ timeout: 180_000 });
    await expect(panel).toHaveAttribute("data-mobile-report-state", "required");
    const report = panel.getByRole("region", { name: "Clash 1 tactical report" });
    await expect(report.getByText("Winner", { exact: true })).toBeVisible();
    await expect(report.getByText("First KO", { exact: true })).toBeVisible();
    await expect(report.getByText("Highest damage threat", { exact: true })).toBeVisible();
    await expect(report.getByRole("region", { name: "Opponent formation just fought" }).getByRole("listitem")).toHaveCount(4);
    await expect(report.getByText(/No outcome prediction/)).toBeVisible();
    if (testInfo.project.name === "galaxy-s25-plus-qhd-portrait") {
        await expectOpponentFormationIdentity(report, "exact QHD portrait required report");
    }

    const reportFontOffenders = await report.evaluate((root) => [...root.querySelectorAll<HTMLElement>("*")]
        .filter((node) => {
            const style = getComputedStyle(node);
            const ownText = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
            return ownText && node.offsetWidth > 1 && node.offsetHeight > 1
                && style.visibility === "visible" && Number(style.opacity) > 0;
        })
        .map((node) => ({ text: node.textContent?.trim().replace(/\s+/gu, " ").slice(0, 80), px: Number.parseFloat(getComputedStyle(node).fontSize) }))
        .filter((entry) => entry.px < 14));
    expect(reportFontOffenders, "every readable report fact/copy must be at least 14 CSS px").toEqual([]);

    const reportAck = page.getByRole("button", { name: "Report read, re-form band" });
    const ackBox = await reportAck.boundingBox();
    expect(ackBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(ackBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await touchTap(page, reportAck);
    await expect(panel).toHaveAttribute("data-mobile-report-state", "available");

    const board = panel.getByLabel("Your deployment grid");
    const boardBefore = await board.boundingBox();
    const picker = panel.getByLabel("Choose a pet to place").locator("button");
    const petNames = (await picker.locator("strong").allTextContents()).map((name) => name.trim());
    const previousLocations = (await picker.locator("small").allTextContents()).map((location) => location.trim());
    const moves: Array<{ slot: number; node: string; moved: boolean }> = [];
    for (let slot = 0; slot < 4; slot += 1) {
        const pet = picker.nth(slot);
        const petName = (await pet.locator("strong").textContent())?.trim() ?? `slot-${slot}`;
        const legalNodes = await panel.locator('[data-wfr-legal-drop="true"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-wfr-node-id")).filter((node): node is string => node !== null));
        for (const node of legalNodes) {
            await touchTap(page, pet);
            const cell = panel.locator(`[data-wfr-node-id="${node}"]`);
            await touchTap(page, cell);
            const moved = await cell.getAttribute("data-wfr-legal-drop") === "false"
                && (await cell.getAttribute("aria-label") ?? "").includes(petName);
            moves.push({ slot, node, moved });
        }
    }
    expect(moves.filter((entry) => entry.moved)).toHaveLength(24);
    await expect(panel.locator(".wfr-formation-diff")).toContainText("→");
    const nextLocations = (await picker.locator("small").allTextContents()).map((location) => location.trim());
    const expectedRows = petNames.flatMap((name, index) => previousLocations[index] === nextLocations[index]
        ? []
        : [`${name}: ${previousLocations[index]} → ${nextLocations[index]}`]);
    expect(expectedRows, `${testInfo.project.name}: the matrix must finish with all four pets re-formed`).toHaveLength(4);
    await expectFormationDiffRows(panel, expectedRows, `${testInfo.project.name} four-pet re-form`);
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1");
    const boardAfterMoves = await board.boundingBox();
    const boardDelta = (left: typeof boardBefore, right: typeof boardBefore) => left && right
        ? Math.max(
            Math.abs(left.x - right.x),
            Math.abs(left.y - right.y),
            Math.abs(left.width - right.width),
            Math.abs(left.height - right.height),
        )
        : Number.POSITIVE_INFINITY;
    expect(boardDelta(boardBefore, boardAfterMoves), "the 24-move draft must not shift the board").toBeLessThanOrEqual(1);

    await touchTap(page, page.getByRole("button", { name: "Open tactical report" }));
    await expect(panel).toHaveAttribute("data-mobile-report-state", "open");
    await expectReportLayerSettled(report);
    await expect(report.getByText("Winner", { exact: true })).toBeVisible();
    await expect(report.getByRole("region", { name: "Opponent formation just fought" }).getByRole("listitem")).toHaveCount(4);
    if (testInfo.project.name === "galaxy-s25-plus-qhd-portrait") {
        await expectOpponentFormationIdentity(report, "exact QHD portrait reopened report");
    }
    const boardWhileReportOpen = await board.boundingBox();
    expect(boardDelta(boardAfterMoves, boardWhileReportOpen), "the report drawer must overlay without moving the board").toBeLessThanOrEqual(1);
    await touchTap(page, page.getByRole("button", { name: "Close tactical report" }));
    await expect(panel).toHaveAttribute("data-mobile-report-state", "available");
    await expect(report).toBeHidden();
    await page.waitForTimeout(200);

    const compactGate = await panel.evaluate((root) => {
        const rect = (node: Element | null) => {
            if (!(node instanceof HTMLElement)) return null;
            const box = node.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const controls = [...root.querySelectorAll<HTMLElement>("button")]
            .filter((node) => {
                const style = getComputedStyle(node);
                return node.offsetWidth > 1 && node.offsetHeight > 1 && style.visibility === "visible" && Number(style.opacity) > 0;
            })
            .map((node) => {
                const box = rect(node)!;
                const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                return {
                    label: node.getAttribute("aria-label") ?? node.textContent?.trim().replace(/\s+/gu, " "),
                    box,
                    centerReachable: Boolean(hit && (hit === node || node.contains(hit))),
                };
            });
        const visibleText = [...root.querySelectorAll<HTMLElement>("*")]
            .filter((node) => {
                const style = getComputedStyle(node);
                const ownText = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
                return ownText && node.offsetWidth > 1 && node.offsetHeight > 1
                    && style.visibility === "visible" && Number(style.opacity) > 0;
            })
            .map((node) => ({ text: node.textContent?.trim().replace(/\s+/gu, " ").slice(0, 80), px: Number.parseFloat(getComputedStyle(node).fontSize) }));
        const panel = rect(root);
        const board = rect(root.querySelector(".wfr-placement-board"));
        const picker = rect(root.querySelector(".wfr-pet-picker"));
        const boardStyle = getComputedStyle(root.querySelector(".wfr-placement-board") as HTMLElement);
        return {
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            panel,
            board,
            picker,
            controls,
            fontOffenders: visibleText.filter((entry) => entry.px < 14),
            boardAxisFonts: [
                Number.parseFloat(getComputedStyle(root.querySelector(".wfr-depth-labels") as HTMLElement).fontSize),
                Number.parseFloat(getComputedStyle(root.querySelector(".wfr-route-labels") as HTMLElement).fontSize),
                Number.parseFloat(getComputedStyle(root.querySelector(".wfr-placement-board") as HTMLElement, "::after").fontSize),
            ],
            boardOverflow: boardStyle.overflow,
        };
    });
    const viewport = page.viewportSize()!;
    expect(compactGate.overflowX).toBeLessThanOrEqual(1);
    expect(compactGate.panel?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(compactGate.panel?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect(compactGate.panel?.right ?? viewport.width + 2).toBeLessThanOrEqual(viewport.width + 1);
    expect(compactGate.panel?.bottom ?? viewport.height + 2).toBeLessThanOrEqual(viewport.height + 1);
    expect(compactGate.controls.filter((entry) => entry.box.width < 44 || entry.box.height < 44 || !entry.centerReachable)).toEqual([]);
    expect(compactGate.fontOffenders, "every visible re-form/decision/control label must be at least 14 CSS px").toEqual([]);
    expect(compactGate.boardAxisFonts.every((px) => px >= 14)).toBe(true);
    expect((compactGate.board?.width ?? 0) * (compactGate.board?.height ?? 0)).toBeGreaterThan((compactGate.picker?.width ?? 0) * (compactGate.picker?.height ?? 0));

    await touchTap(page, panel.getByRole("button", { name: "Reset changes" }));
    await expect(panel.locator(".wfr-formation-diff")).toContainText("No changes — holding the line");
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1");
    await touchTap(page, picker.first());
    await touchTap(page, panel.locator('[data-wfr-legal-drop="true"]').first());
    await expect(panel.locator(".wfr-formation-diff")).toContainText("→");
    await page.waitForTimeout(750);
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 1");

    await touchTap(page, panel.getByRole("button", { name: "Lock & rematch" }));
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 2", { timeout: 30_000 });
});

test("the compact 412px report keeps four distinct opponents readable after reopening", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "galaxy-s25-plus", "412 × 915 portrait release gate");
    test.setTimeout(240_000);

    await openRite(page, "/petvfx.html?rite=1&seed=23&petQuality=low&ritespeed=12&riteqa=1");
    await touchTap(page, page.getByRole("button", { name: "Lock formation" }));

    const panel = page.getByRole("dialog", { name: "Tactical report and re-form" });
    await expect(panel).toBeVisible({ timeout: 180_000 });
    await expect(panel).toHaveAttribute("data-mobile-report-state", "required");
    const report = panel.getByRole("region", { name: "Clash 1 tactical report" });
    await expectOpponentFormationIdentity(report, "412 × 915 required report");

    const reportAck = panel.getByRole("button", { name: "Report read, re-form band" });
    const reportAckBox = await reportAck.boundingBox();
    expect(reportAckBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(reportAckBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await touchTap(page, reportAck);
    await expect(panel).toHaveAttribute("data-mobile-report-state", "available");

    const board = panel.getByLabel("Your deployment grid");
    const boardBefore = await board.boundingBox();
    const picker = panel.getByLabel("Choose a pet to place").locator("button");
    const pet = picker.first();
    const petName = (await pet.locator("strong").textContent())?.trim() ?? "";
    const previousLocation = (await pet.locator("small").textContent())?.trim() ?? "";
    await touchTap(page, pet);
    await touchTap(page, panel.locator('[data-wfr-legal-drop="true"]').first());
    const nextLocation = (await pet.locator("small").textContent())?.trim() ?? "";
    expect(nextLocation).not.toBe(previousLocation);
    await expectFormationDiffRows(panel, [`${petName}: ${previousLocation} → ${nextLocation}`], "412 × 915 one-pet re-form");

    for (const name of ["Open tactical report", "Reset changes", "Lock & rematch"]) {
        const control = panel.getByRole("button", { name });
        const box = await control.boundingBox();
        expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44);
    }

    await touchTap(page, panel.getByRole("button", { name: "Open tactical report" }));
    await expect(panel).toHaveAttribute("data-mobile-report-state", "open");
    await expectReportLayerSettled(report);
    await expectOpponentFormationIdentity(report, "412 × 915 reopened report");
    await expect(panel.locator(".wfr-formation-diff")).toContainText("→");
    const boardWhileReportOpen = await board.boundingBox();
    const boardDelta = boardBefore && boardWhileReportOpen
        ? Math.max(
            Math.abs(boardBefore.x - boardWhileReportOpen.x),
            Math.abs(boardBefore.y - boardWhileReportOpen.y),
            Math.abs(boardBefore.width - boardWhileReportOpen.width),
            Math.abs(boardBefore.height - boardWhileReportOpen.height),
        )
        : Number.POSITIVE_INFINITY;
    expect(boardDelta, "the compact report drawer must overlay without moving the board").toBeLessThanOrEqual(1);
    const closeReport = panel.getByRole("button", { name: "Close tactical report" });
    const closeBox = await closeReport.boundingBox();
    expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("spectator mode traverses the same report state with a deterministic auto-lock", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "interaction runs once");
    test.setTimeout(240_000);
    await page.goto("/petvfx.html?rite=1&autostart=1&seed=23&petQuality=low&ritespeed=12&riteqa=1", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
    });
    await expect(page.getByText(/AUTO RE-FORM · locking a deterministic response/)).toBeVisible({ timeout: 180_000 });
    await expect(page.locator(".wfr-hud .wfr-duel-no")).toHaveText("BEASTBOUND · CLASH 2", { timeout: 30_000 });
});

test("the deployment panel stays usable at phone width", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "this is the mobile layout check");
    await openRite(page);
    await expect(page.getByLabel("Choose a pet to place").locator("button")).toHaveCount(4);
    await expect(page.getByLabel("Your deployment grid").locator("button")).toHaveCount(10);

    // Nothing may overflow the viewport horizontally.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The primary action stays reachable and meets the 44px touch target rule.
    const lock = page.getByRole("button", { name: "Lock formation" });
    await expect(lock).toBeVisible();
    const box = await lock.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("the live clash fits a Galaxy S25+ without shrinking the battle into the HUD", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "galaxy-s25-plus", "device-specific release check");
    await openRite(page);
    await page.getByRole("button", { name: "Lock formation" }).click();

    const root = page.locator(".wfr-root");
    const hud = page.locator(".wfr-hud");
    await expect(hud).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("list", { name: "Your band" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("list", { name: "Their band" }).getByRole("listitem")).toHaveCount(4);

    const viewport = page.viewportSize()!;
    const rootBox = await root.boundingBox();
    expect(rootBox?.width ?? 0).toBeLessThanOrEqual(viewport.width + 1);
    expect(rootBox?.height ?? 0).toBeLessThanOrEqual(viewport.height + 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The two rosters share a dedicated row under the score. They may use the
    // top fifth of the phone, but cannot cover the stage like the desktop HUD did.
    const hudBox = await hud.boundingBox();
    expect(hudBox?.height ?? viewport.height).toBeLessThan(viewport.height * 0.28);
    for (const roster of [page.getByRole("list", { name: "Your band" }), page.getByRole("list", { name: "Their band" })]) {
        const box = await roster.boundingBox();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? viewport.width + 1)).toBeLessThanOrEqual(viewport.width + 1);
    }

    // WebGL gets the full scene; a device without WebGL gets an intentional
    // reduced battle view instead of a blank screen.
    await expect(page.locator(".wfr-canvas canvas, .wfr-canvas-fallback").first()).toBeVisible({ timeout: 30_000 });
});

test("combat broadcast keeps the live action readable without camera jitter", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one deterministic viewport matrix covers broadcast geometry");
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

    for (const viewport of [
        { label: "desktop", width: 1280, height: 720 },
        { label: "reported compact portrait", width: 493, height: 617 },
        { label: "Galaxy S25+ portrait", width: 412, height: 915 },
        { label: "Galaxy S25+ landscape", width: 915, height: 412 },
    ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const quality = viewport.label === "desktop" ? "high" : "low";
        await page.goto(`/petvfx.html?rite=1&autostart=1&seed=23&petQuality=${quality}&ritespeed=0.78&ritemotionqa=1`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
        });
        const canvas = page.locator(".wfr-canvas-surface");
        await expect(canvas, `${viewport.label}: battle stage`).toBeVisible({ timeout: 30_000 });
        await expect(canvas, `${viewport.label}: complete formation`).toHaveAttribute("data-rite-initial-actors-expected", "8");
        await expect(canvas, `${viewport.label}: actor-first direction`).toHaveAttribute("data-rite-camera-mode", "actor-first-broadcast");

        const clock = page.getByTestId("wfr-clock");
        const tick = async () => Number((await clock.getAttribute("data-tick")) ?? "0");
        const start = await tick();
        await expect.poll(tick, { timeout: 60_000, message: `${viewport.label}: playback did not advance` }).toBeGreaterThan(start + 5);
        await expect(canvas, `${viewport.label}: attacker is outside the safe shot`).toHaveAttribute("data-rite-camera-focus-actor-safe", "true");
        await expect(canvas, `${viewport.label}: target is outside the safe shot`).toHaveAttribute("data-rite-camera-focus-target-safe", "true");
        expect(Number(await canvas.getAttribute("data-rite-min-living-actor-px")), `${viewport.label}: pets are thumbnail-sized`).toBeGreaterThanOrEqual(54);
        expect(Number(await canvas.getAttribute("data-rite-camera-max-delta")), `${viewport.label}: camera moves too far in one frame`).toBeLessThanOrEqual(0.12);
        expect(await canvas.getAttribute("data-rite-facing-policy"), `${viewport.label}: facing is not target-authoritative`).toBe("live-target-screen-space-hysteresis");
        expect(await canvas.getAttribute("data-rite-facing-native-sign"), `${viewport.label}: atlas orientation regressed`).toBe("-1");
        if (viewport.label === "Galaxy S25+ portrait") {
            await page.waitForFunction(() => document.querySelector<HTMLElement>(".wfr-canvas-surface")?.dataset.riteBroadcastImpactVisible === "true", undefined, { timeout: 30_000, polling: "raf" });
            expect(await canvas.getAttribute("data-rite-broadcast-focus-label"), "phone impact lacks a visible attacker-to-target sentence").toContain("→");
            expect(Number(await canvas.getAttribute("data-rite-camera-focus-actor-px")), "phone attacker is too small at contact").toBeGreaterThanOrEqual(80);
            expect(Number(await canvas.getAttribute("data-rite-camera-focus-target-px")), "phone target is too small at contact").toBeGreaterThanOrEqual(80);
        }
    }
    expect(errors).toEqual([]);
});

test("Galaxy S25+ broadcast remains stable through approach impact and recovery", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "galaxy-s25-plus", "device-specific continuous-motion release check");
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

    await page.goto("/petvfx.html?rite=1&autostart=1&seed=23&petQuality=low&ritespeed=0.78&ritemotionqa=1", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
    });
    const canvas = page.locator(".wfr-canvas-surface");
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-rite-camera-mode", "actor-first-broadcast");
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>("[data-testid='wfr-clock']")?.dataset.tick ?? "0") > 5, undefined, {
        timeout: 30_000,
        polling: "raf",
    });

    const trace = await page.evaluate(async (durationMs) => new Promise<{
        sampleCount: number;
        p95FrameGapMs: number;
        maxFrameGapMs: number;
        maxConsecutiveSlowFrames: number;
        maxCameraStepPx: number;
        facingFlipDelta: number;
        impactSamples: number;
        minImpactActorPx: number;
        minImpactTargetPx: number;
        sawCausalLabel: boolean;
        unsafeImpactSamples: number;
        unsafeExamples: string[];
    }>((resolve) => {
        const root = document.querySelector<HTMLElement>(".wfr-root")!;
        const surface = document.querySelector<HTMLElement>(".wfr-canvas-surface")!;
        const frameGaps: number[] = [];
        const startedAt = performance.now();
        const warmUntil = startedAt + 750;
        const facingStart = Number(surface.dataset.riteFacingFlips ?? "0");
        let previousAt = startedAt;
        let previousCamera: [number, number, number] | null = null;
        let maxCameraStepPx = 0;
        let slowRun = 0;
        let maxSlowRun = 0;
        let impactSamples = 0;
        let minImpactActorPx = Number.POSITIVE_INFINITY;
        let minImpactTargetPx = Number.POSITIVE_INFINITY;
        let sawCausalLabel = false;
        let unsafeImpactSamples = 0;
        const unsafeExamples: string[] = [];

        const numberVar = (name: string) => Number.parseFloat(root.style.getPropertyValue(name)) || 0;
        const sample = (now: number) => {
            if (now >= warmUntil) {
                const gap = now - previousAt;
                frameGaps.push(gap);
                if (gap > 50) {
                    slowRun += 1;
                    maxSlowRun = Math.max(maxSlowRun, slowRun);
                } else {
                    slowRun = 0;
                }

                const camera: [number, number, number] = [
                    numberVar("--wfr-camera-shift-x"),
                    numberVar("--wfr-camera-shift-y"),
                    numberVar("--wfr-camera-zoom"),
                ];
                if (previousCamera) {
                    const dx = camera[0] - previousCamera[0];
                    const dy = camera[1] - previousCamera[1];
                    const zoomPixels = (camera[2] - previousCamera[2]) * Math.min(innerWidth, innerHeight) * 0.5;
                    maxCameraStepPx = Math.max(maxCameraStepPx, Math.hypot(dx, dy, zoomPixels));
                }
                previousCamera = camera;

                if (surface.dataset.riteBroadcastImpactVisible === "true") {
                    impactSamples += 1;
                    minImpactActorPx = Math.min(minImpactActorPx, Number(surface.dataset.riteCameraFocusActorPx ?? "0"));
                    minImpactTargetPx = Math.min(minImpactTargetPx, Number(surface.dataset.riteCameraFocusTargetPx ?? "0"));
                    sawCausalLabel ||= (surface.dataset.riteBroadcastFocusLabel ?? "").includes("→");
                    if (surface.dataset.riteCameraFocusActorSafe !== "true" || surface.dataset.riteCameraFocusTargetSafe !== "true") {
                        unsafeImpactSamples += 1;
                        if (unsafeExamples.length < 3) unsafeExamples.push([
                            surface.dataset.riteCameraFocus ?? "",
                            `actorSafe=${surface.dataset.riteCameraFocusActorSafe}`,
                            `targetSafe=${surface.dataset.riteCameraFocusTargetSafe}`,
                            `anchors=${surface.dataset.riteActorLocalHpAnchors ?? ""}`,
                        ].join(" | "));
                    }
                }
            }
            previousAt = now;

            if (now - startedAt < durationMs) {
                requestAnimationFrame(sample);
                return;
            }
            const sorted = [...frameGaps].sort((a, b) => a - b);
            const p95Index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
            resolve({
                sampleCount: frameGaps.length,
                p95FrameGapMs: sorted[p95Index] ?? 0,
                maxFrameGapMs: sorted.at(-1) ?? 0,
                maxConsecutiveSlowFrames: maxSlowRun,
                maxCameraStepPx,
                facingFlipDelta: Math.max(0, Number(surface.dataset.riteFacingFlips ?? "0") - facingStart),
                impactSamples,
                minImpactActorPx: Number.isFinite(minImpactActorPx) ? minImpactActorPx : 0,
                minImpactTargetPx: Number.isFinite(minImpactTargetPx) ? minImpactTargetPx : 0,
                sawCausalLabel,
                unsafeImpactSamples,
                unsafeExamples,
            });
        };
        requestAnimationFrame(sample);
    }), 7_000);

    console.log(`[galaxy-s25-motion-trace] ${JSON.stringify(trace)}`);
    await testInfo.attach("galaxy-s25-motion-trace", {
        body: Buffer.from(JSON.stringify(trace, null, 2)),
        contentType: "application/json",
    });

    expect(trace.sampleCount, "continuous trace did not sample enough rendered frames").toBeGreaterThan(120);
    expect(trace.p95FrameGapMs, "sustained frame pacing is visibly uneven").toBeLessThanOrEqual(34);
    expect(trace.maxConsecutiveSlowFrames, "the broadcast visibly stalls for consecutive frames").toBeLessThanOrEqual(1);
    expect(trace.maxCameraStepPx, "the broadcast camera snaps between action beats").toBeLessThanOrEqual(14);
    expect(trace.facingFlipDelta, "pets oscillate between facing directions").toBeLessThanOrEqual(8);
    expect(trace.impactSamples, "the trace missed the contact beat").toBeGreaterThan(2);
    expect(trace.minImpactActorPx, "attacker becomes unreadable at contact").toBeGreaterThanOrEqual(80);
    expect(trace.minImpactTargetPx, "target becomes unreadable at contact").toBeGreaterThanOrEqual(80);
    expect(trace.sawCausalLabel, "the contact lacks a source-to-target sentence").toBe(true);
    expect(trace.unsafeImpactSamples, "the active pair leaves the HUD-safe viewport").toBe(0);
    expect(errors).toEqual([]);
});
