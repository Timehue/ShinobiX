import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { installUiAuditRuntime, uiAuditSave, type UiAuditSave } from "./helpers/ui-audit-runtime";

const QUEST_ID = "story-reckoning-mira-marker";
const START_POINT = "sv-ridge-gate";
const START_CHOICE = "sv-take-high-line";

type FieldVisit = { pointId: string; choiceId: string };
type FieldProgress = { version: 1; visits: FieldVisit[] };

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function configureReader(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem("vnReaderMode.v1", "classic");
        localStorage.setItem("vnTextSpeed.v1", "instant");
        localStorage.setItem("vnAutoRead.v1", "0");
    });
}

async function advanceUntil(novel: Locator, target: Locator) {
    for (let step = 0; step < 12 && !(await target.isVisible()); step += 1) {
        await novel.getByRole("button", { name: "Next", exact: true }).click();
    }
    await expect(target).toBeVisible();
}

async function installFieldRuntime(page: Page, firstFieldResult: "temporary-error" | "stale-success" = "temporary-error") {
    const initial = uiAuditSave();
    const emptyProgress: FieldProgress = { version: 1, visits: [] };
    initial.currentSector = 1;
    initial.currentBiome = "coast";
    initial.seenHints = ["worldMap"];
    initial.triggeredEvents = [
        ...(initial.triggeredEvents as string[]),
        "story-interlude-stormveil-village-88",
        "story-interlude-stormveil-village-92",
    ];
    initial.character = {
        ...initial.character,
        activeStoryReckoning: {
            id: QUEST_ID,
            stage: "task",
            metric: "totalTilesExplored",
            baseline: 120,
            target: 12,
            dropItemId: "event-kesa-marker",
            fieldWork: emptyProgress,
        },
        storyFieldRecords: { [QUEST_ID]: emptyProgress },
    };

    await installUiAuditRuntime(page, initial);
    let save: UiAuditSave = structuredClone(initial);
    let saveVersion = 7;
    let fieldAttempts = 0;
    let abandonAttempts = 0;
    const fieldBodies: Record<string, unknown>[] = [];

    // These handlers are registered after the shared audit runtime, so they
    // provide the two pieces this scenario needs: durable choice authority and
    // a save GET that returns that authority again after a browser reload.
    await page.route("**/api/save/**", async (route) => {
        const request = route.request();
        if (new URL(request.url()).pathname.toLowerCase() !== "/api/save/auditninja") return route.fallback();
        if (request.method() === "GET") return json(route, { ...save, _saveVersion: saveVersion });

        const incoming = request.postDataJSON() as UiAuditSave;
        const authoritative = save.character ?? {};
        save = {
            ...incoming,
            character: {
                ...(incoming.character ?? {}),
                activeStoryReckoning: authoritative.activeStoryReckoning,
                storyFieldRecords: authoritative.storyFieldRecords,
                storyTraits: authoritative.storyTraits,
            },
        };
        delete save._baseSaveVersion;
        delete save._saveVersion;
        delete save._saveAt;
        saveVersion += 1;
        return json(route, { ok: true, _saveVersion: saveVersion });
    });

    await page.route("**/api/sector/story-reckoning", async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        if (body.action === "abandon") {
            abandonAttempts += 1;
            const current = save.character ?? {};
            const character = { ...current, activeStoryReckoning: null };
            save = { ...save, character };
            saveVersion += 1;
            return json(route, { ok: true, character, _saveVersion: saveVersion });
        }
        if (body.action !== "field-act") return route.fallback();
        fieldAttempts += 1;
        fieldBodies.push(body);
        const current = save.character ?? {};
        const recorded = ((current.storyFieldRecords as Record<string, FieldProgress> | undefined)?.[QUEST_ID]?.visits ?? [])
            .some((visit) => visit.pointId === START_POINT && visit.choiceId === START_CHOICE);
        if (recorded) return json(route, {
            ok: true, replayed: true, complete: false,
            activeStoryReckoning: current.activeStoryReckoning, character: current, _saveVersion: saveVersion,
        });
        if (fieldAttempts === 1 && firstFieldResult === "temporary-error") return json(route, { error: "Temporary field ledger outage" }, 503);

        const progress: FieldProgress = { version: 1, visits: [{ pointId: START_POINT, choiceId: START_CHOICE }] };
        const activeStoryReckoning = {
            ...(current.activeStoryReckoning as Record<string, unknown>),
            fieldWork: progress,
        };
        const character = {
            ...current,
            activeStoryReckoning,
            storyFieldRecords: { [QUEST_ID]: progress },
            storyTraits: (current.storyTraits as string[]).filter((trait) => !trait.startsWith("sf-")),
        };
        save = { ...save, character };
        saveVersion += 1;
        return json(route, {
            ok: true,
            complete: false,
            activeStoryReckoning,
            character,
            _saveVersion: firstFieldResult === "stale-success" && fieldAttempts === 1 ? 1 : saveVersion,
        });
    });

    return {
        fieldAttempts: () => fieldAttempts,
        fieldBodies: () => fieldBodies,
        abandonAttempts: () => abandonAttempts,
        setReturnStage: () => {
            const progress: FieldProgress = { version: 1, visits: [
                { pointId: START_POINT, choiceId: START_CHOICE },
                { pointId: "sv-broken-cable-span", choiceId: "sv-broken-cable-span-continue" },
                { pointId: "sv-signal-cairn", choiceId: "sv-signal-cairn-recover" },
            ] };
            const current = save.character ?? {};
            save = { ...save, character: {
                ...current,
                activeStoryReckoning: { id: QUEST_ID, stage: "return", metric: "totalTilesExplored", baseline: 120, target: 12, dropItemId: "event-kesa-marker", fieldWork: progress },
                storyFieldRecords: { [QUEST_ID]: progress },
            } };
            saveVersion += 1;
        },
    };
}

async function abandonFromJournal(page: Page) {
    const journal = page.getByRole("complementary", { name: "Personal quest" });
    await journal.getByRole("button", { name: "Abandon reckoning" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Confirm" });
    await expect(confirmation).toContainText("progress and recovered keepsake will remain");
    await confirmation.getByRole("button", { name: "Abandon", exact: true }).click();
    await expect(journal.getByRole("button", { name: "Abandon reckoning" })).toHaveCount(0);
}

test("field work saves a route choice, resumes its next objective, and replays history read-only", async ({ page }, testInfo) => {
    test.skip(!["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "covered at desktop and mobile widths in Chromium");
    await configureReader(page);
    const runtime = await installFieldRuntime(page);
    await page.goto("/#/worldMap", { waitUntil: "networkidle" });

    const journal = page.getByRole("complementary", { name: "Personal quest" });
    await expect(journal).toBeVisible();
    await expect(journal).toContainText("Kesa's Marker");
    await expect(journal).toContainText("Ridge Gate · Sector 1");
    await journal.getByRole("button", { name: "Explore Ridge Gate" }).click();

    const novel = page.locator(".visual-novel.admin-vn-play");
    await expect(novel.getByRole("heading", { level: 2 })).toHaveText("Two Ways Up");
    const highLine = novel.getByRole("button", { name: /Take the high line/ });
    await advanceUntil(novel, highLine);
    await expect(highLine).toBeEnabled();
    await highLine.click();

    const failure = page.locator(".story-field-status");
    await expect(failure).toContainText("Your choice could not be saved");
    await expect(novel).toBeVisible();
    expect(runtime.fieldAttempts()).toBe(1);
    await failure.getByRole("button", { name: "Retry", exact: true }).click();

    await expect(novel).toHaveCount(0);
    await expect(journal).toContainText("Rig the crossing with Mira's dry coil.");
    await expect(journal).toContainText("Broken Cable Span · Sector 2");
    expect(runtime.fieldAttempts()).toBe(2);
    expect(runtime.fieldBodies()).toEqual([
        { action: "field-act", playerName: "AuditNinja", questId: QUEST_ID, pointId: START_POINT, choiceId: START_CHOICE },
        { action: "field-act", playerName: "AuditNinja", questId: QUEST_ID, pointId: START_POINT, choiceId: START_CHOICE },
    ]);
    await page.screenshot({ path: testInfo.outputPath('field-objective.png') });

    if ((page.viewportSize()?.width ?? 1000) <= 480) {
        const layout = await journal.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const buttons = [...element.querySelectorAll("button")]
                .map((button) => button.getBoundingClientRect())
                .filter((button) => button.width > 0 && button.height > 0);
            return {
                left: box.left,
                right: box.right,
                viewport: window.innerWidth,
                minimumButtonHeight: Math.min(...buttons.map((button) => button.height)),
            };
        });
        expect(layout.left).toBeGreaterThanOrEqual(0);
        expect(layout.right).toBeLessThanOrEqual(layout.viewport);
        expect(layout.minimumButtonHeight).toBeGreaterThanOrEqual(44);
    }

    await page.reload({ waitUntil: "networkidle" });
    const restoredJournal = page.getByRole("complementary", { name: "Personal quest" });
    await expect(restoredJournal).toContainText("Broken Cable Span · Sector 2");
    await restoredJournal.getByText("Your route so far", { exact: true }).click();
    await restoredJournal.getByRole("button", { name: "Ridge Gate", exact: true }).click();

    await expect(novel.getByRole("heading", { level: 2 })).toHaveText("Two Ways Up");
    await expect(novel.getByRole("button", { name: /Take the high line/ })).toHaveCount(0);
    await expect(novel.getByRole("button", { name: /^Battle in/ })).toHaveCount(0);
    await expect(novel.getByRole("button", { name: /Claim Reward/ })).toHaveCount(0);
    if ((page.viewportSize()?.width ?? 1000) <= 480) {
        const next = novel.getByRole("button", { name: "Next", exact: true });
        const hint = page.locator(".screen-hint-battle-trigger");
        await expect(next).toBeVisible();
        if (await hint.isVisible()) {
            const nextBox = await next.boundingBox();
            const hintBox = await hint.boundingBox();
            expect(nextBox).not.toBeNull();
            expect(hintBox).not.toBeNull();
            const overlapWidth = Math.max(0, Math.min(nextBox!.x + nextBox!.width, hintBox!.x + hintBox!.width) - Math.max(nextBox!.x, hintBox!.x));
            const overlapHeight = Math.max(0, Math.min(nextBox!.y + nextBox!.height, hintBox!.y + hintBox!.height) - Math.max(nextBox!.y, hintBox!.y));
            expect(overlapWidth * overlapHeight, "The contextual tip must leave Next unobstructed").toBe(0);
        }
    }
    await advanceUntil(novel, novel.getByText(`Your choice: Take the high line. Trust the cable and reach the signal cairn before the rain.`, { exact: true }));
    await expect(novel.getByText("Your choice: Take the picker road. Reset the public storm rail and ask where the pieces went.", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('field-history.png') });
    expect(runtime.fieldAttempts()).toBe(2);
});

test("the journal can abandon an opening or return-stage field reckoning", async ({ page }, testInfo) => {
    test.skip(!["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "covered at desktop and mobile widths in Chromium");
    await configureReader(page);
    const runtime = await installFieldRuntime(page);
    await page.goto("/#/worldMap", { waitUntil: "networkidle" });

    await expect(page.getByRole("complementary", { name: "Personal quest" })).toContainText("Ridge Gate · Sector 1");
    await abandonFromJournal(page);
    expect(runtime.abandonAttempts()).toBe(1);

    runtime.setReturnStage();
    await page.reload({ waitUntil: "networkidle" });
    const returned = page.getByRole("complementary", { name: "Personal quest" });
    await expect(returned).toContainText("Return to Mira Volt at the village outskirts.");
    await abandonFromJournal(page);
    expect(runtime.abandonAttempts()).toBe(2);
});

test("a stale successful field response stays open until same-choice replay is adopted", async ({ page }, testInfo) => {
    test.skip(!["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "covered at desktop and mobile widths in Chromium");
    await configureReader(page);
    const runtime = await installFieldRuntime(page, "stale-success");
    await page.goto("/#/worldMap", { waitUntil: "networkidle" });

    const journal = page.getByRole("complementary", { name: "Personal quest" });
    await journal.getByRole("button", { name: "Explore Ridge Gate" }).click();
    const novel = page.locator(".visual-novel.admin-vn-play");
    const highLine = novel.getByRole("button", { name: /Take the high line/ });
    await advanceUntil(novel, highLine);
    await highLine.click();

    const recovery = page.locator(".story-field-status");
    await expect(recovery).toContainText("Your choice was sealed, but this view could not refresh");
    await expect(novel).toBeVisible();
    expect(runtime.fieldAttempts()).toBe(1);
    await recovery.getByRole("button", { name: "Retry", exact: true }).click();

    await expect(novel).toHaveCount(0);
    await expect(journal).toContainText("Broken Cable Span · Sector 2");
    expect(runtime.fieldAttempts()).toBe(2);
    expect(runtime.fieldBodies()).toEqual([
        { action: "field-act", playerName: "AuditNinja", questId: QUEST_ID, pointId: START_POINT, choiceId: START_CHOICE },
        { action: "field-act", playerName: "AuditNinja", questId: QUEST_ID, pointId: START_POINT, choiceId: START_CHOICE },
    ]);
});
