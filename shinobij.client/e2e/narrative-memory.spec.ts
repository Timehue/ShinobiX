import { expect, test, type Locator, type Page } from "@playwright/test";
import { installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

async function configureClassicReader(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem("vnReaderMode.v1", "classic");
        localStorage.setItem("vnTextSpeed.v1", "instant");
        localStorage.setItem("vnAutoRead.v1", "0");
    });
}

async function openFirstChapter(page: Page) {
    const save = uiAuditSave();
    save.character = { ...save.character, storyProgress: 0, storyTraits: [] };
    await installUiAuditRuntime(page, save);
    await configureClassicReader(page);
    await page.goto("/#/village", { waitUntil: "domcontentloaded" });
    const novel = page.locator(".visual-novel.admin-vn-play");
    await expect(novel).toBeVisible();
    await expect(novel.getByRole("heading", { level: 2 })).toHaveText("The Challenge Board");
    return novel;
}

async function nextLine(novel: Locator) {
    const line = novel.locator(".vn-dialogue > p");
    const before = await line.innerText();
    await novel.getByRole("button", { name: "Next", exact: true }).click();
    await expect(line).not.toHaveText(before);
}

test("Back remembers a chosen branch and cannot reveal or select a different reason", async ({ page }) => {
    const novel = await openFirstChapter(page);
    const strongest = novel.getByRole("button", { name: /To be the strongest name on this board/ });
    for (let index = 0; index < 12 && !(await strongest.isVisible()); index += 1) {
        await nextLine(novel);
    }
    await expect(strongest).toBeEnabled();
    await strongest.click();
    await expect(novel.getByRole("heading", { level: 2 })).toHaveText("A Ladder Reason");
    await novel.getByRole("button", { name: "Back", exact: true }).click();
    await expect(novel.getByRole("heading", { level: 2 })).toHaveText("The Reason Line");
    await expect(novel.getByText("A Shield Reason", { exact: true })).toHaveCount(0);
    await expect(novel.getByRole("button", { name: /So nobody else has to/ })).toHaveCount(0);
    await expect(strongest).toBeEnabled();
    await strongest.click();
    await expect(novel.getByRole("heading", { level: 2 })).toHaveText("A Ladder Reason");
});

test("Story Hall resumes a dismissed chapter in the same session", async ({ page }) => {
    const novel = await openFirstChapter(page);
    await nextLine(novel);
    const rememberedLine = await novel.locator(".vn-dialogue > p").innerText();
    await novel.getByRole("button", { name: "Skip visual novel scene", exact: true }).click();
    await expect(novel).toHaveCount(0);
    await page.getByRole("button", { name: "Enter Story Hall", exact: true }).click();
    const resume = page.getByRole("button", { name: "Resume current chapter", exact: true });
    await expect(resume).toBeVisible();
    await resume.click();
    await expect(novel).toBeVisible();
    await expect(novel.locator(".vn-dialogue > p")).toHaveText(rememberedLine);
});

async function installPendingEnding(page: Page, progress: number) {
    const save = uiAuditSave();
    save.character = {
        ...save.character,
        storyProgress: progress,
        storyEpilogues: [{
            version: 1,
            chapterEventId: "story-stormveil-village-100-8",
            lane: "honorable",
            status: "pending",
            presentationTraits: [],
        }],
    };
    save.triggeredEvents = [
        ...(save.triggeredEvents as string[]),
        "story-interlude-stormveil-village-88",
        "story-interlude-stormveil-village-92",
    ];
    const runtime = await installUiAuditRuntime(page, save);
    await configureClassicReader(page);
    return runtime;
}

test("a pending ending recovers on load, finishes without another battle, and stays seen after reload", async ({ page }) => {
    const runtime = await installPendingEnding(page, 9);
    let contentAttempts = 0;
    await page.route("**/assets/epilogues-stormveil-*.json", async (route) => {
        contentAttempts += 1;
        if (contentAttempts <= 3) {
            await route.fulfill({ status: 503, body: "Temporary content outage" });
        } else {
            await route.continue();
        }
    });
    await page.goto("/#/village", { waitUntil: "domcontentloaded" });
    const novel = page.locator(".visual-novel.admin-vn-play");
    await expect(novel.locator(".act-label")).toHaveText("EPILOGUE", { timeout: 20_000 });
    expect(contentAttempts).toBeGreaterThanOrEqual(4);
    await expect(novel.getByRole("button", { name: /^Battle in/ })).toHaveCount(0);
    await expect(novel.getByRole("button", { name: /Claim Reward/ })).toHaveCount(0);
    const versionBeforeCompletion = runtime.currentVersion();
    for (let index = 0; index < 40 && await novel.isVisible(); index += 1) {
        const next = novel.getByRole("button", { name: "Next", exact: true });
        if (await next.isVisible()) await nextLine(novel);
        else {
            await novel.locator(".vn-controls").getByRole("button", { name: "Continue", exact: true }).click();
            break;
        }
    }
    await expect(novel).toHaveCount(0);
    const complete = page.locator(".vn-finale-panel");
    await expect(complete.getByRole("button", { name: /Enter Battle|Claim Reward/ })).toHaveCount(0);
    if (await complete.isVisible()) {
        await complete.getByRole("button", { name: /^Continue(?: to Story Hall)?$/ }).click();
    }
    await expect(complete).toHaveCount(0);
    await expect.poll(() => {
        const commit = runtime.lastCommit();
        if (!commit || runtime.currentVersion() <= versionBeforeCompletion) return false;
        const state = JSON.parse(commit.postedState);
        return state.character?.storyEpilogues?.some((row: { status?: string }) => row.status === "seen");
    }).toBe(true);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".act-label").filter({ hasText: /^EPILOGUE$/ })).toHaveCount(0);
    await expect(page.locator(".vn-finale-panel")).toHaveCount(0);
});

test("a pending ending cannot precede the sealed finale victory", async ({ page }) => {
    await installPendingEnding(page, 8);
    await page.goto("/#/village", { waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.locator(".act-label").filter({ hasText: /^EPILOGUE$/ })).toHaveCount(0);
});

test("a stalled story battle launch does not reopen its pre-battle conversation", async ({ page }) => {
    test.setTimeout(90_000);
    let startRequested = false;
    let releaseStart: (() => void) | undefined;
    const heldStart = new Promise<void>((resolve) => { releaseStart = resolve; });
    await openFirstChapter(page);
    await page.route("**/api/story/boss-start", async (route) => {
        startRequested = true;
        await heldStart;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "QA delayed start" }) });
    });
    try {
        for (let step = 0; step < 70 && !startRequested; step += 1) {
            const novel = page.locator(".visual-novel.admin-vn-play");
            if (!(await novel.isVisible())) {
                await expect.poll(() => startRequested).toBe(true);
                break;
            }
            const choice = novel.locator(".vn-choice-btn").first();
            if (await choice.isVisible()) {
                await expect(choice).toBeEnabled();
                await choice.click();
            } else if (await novel.locator(".vn-conclusion").isVisible()) {
                await novel.locator(".vn-conclusion").getByRole("button", { name: "Continue", exact: true }).click();
            } else {
                await nextLine(novel);
            }
        }
        await expect.poll(() => startRequested).toBe(true);
        // Keep the request in flight long enough for the narrative selector's
        // post-close effects to run; it must remain paused for the launch.
        await page.waitForTimeout(500);
        await expect(page.locator(".visual-novel.admin-vn-play")).toHaveCount(0);
        await expect(page.locator(".cvn-root")).toHaveCount(0);
    } finally {
        releaseStart?.();
    }
});
