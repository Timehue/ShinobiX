import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
    createFirstPactProgress,
    type FirstPactAftermathId,
    type FirstPactProgress,
} from "../../shared/first-pact-contract";
import { installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

// Native roles are derived from the numeric variant, not a saved role label.
const PACT_IDS = ["pact-rill-0", "pact-moss-1", "pact-kite-2", "pact-bramble-3"] as const;

function pet(id: string, name: string, nickname: string, role: "defender" | "tracker" | "assassin" | "sage") {
    return {
        id,
        name,
        nickname,
        role,
        rarity: "rare",
        level: 70,
        xp: 0,
        maxLevel: 100,
        hp: 500,
        attack: 80,
        defense: 80,
        speed: 80,
        jutsus: [],
        unlockedForPve: true,
        happiness: 90,
    };
}

function completedReturnProgress(): FirstPactProgress {
    const base = createFirstPactProgress(1_700_000_000_000);
    return {
        ...base,
        chapter: 4,
        mainStep: "return-to-threshold",
        courtStanding: 1_600,
        flags: ["crossed-celestial-threshold"],
        lastPosition: { x: 67, y: 16, district: "bell-quarter" },
        mainQuest: {
            omens: ["bell", "aqueduct", "gardens"],
            battleProofs: ["court-menagerie", "lattice-guardian"],
            pactVow: "open-road",
            latticeCompanionIds: [...PACT_IDS],
            pactCompanionIds: [...PACT_IDS],
            pactCompanionNames: ["Rill", "Moss", "Kite", "Bramble"],
        },
        stableQuest: {
            status: "complete",
            tournamentWins: 3,
            battleProofs: ["stable-first-bell", "stable-second-bell", "stable-final-bell"],
        },
        finalTrial: { wins: 4, battleProofs: ["one", "two", "three", "four"] },
        writs: ["writ-silencing", "writ-audit", "writ-pruning", "writ-impound"],
        writProofs: ["silencing", "audit", "pruning", "impound"],
        findings: ["writ-silencing", "writ-audit", "writ-pruning", "writ-impound"],
        aftermathVisits: [],
    };
}

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installCompletedReturn(page: Page) {
    const save = uiAuditSave();
    save.character = {
        ...save.character,
        level: 100,
        activePetId: PACT_IDS[0],
        pets: [
            // The vow sealed "Rill"; this later nickname proves archival copy
            // and present-day companion behavior read from different sources.
            pet(PACT_IDS[0], "Riverback Hound", "Rook", "defender"),
            pet(PACT_IDS[1], "Mosswing Owl", "Moss", "tracker"),
            pet(PACT_IDS[2], "Gale Lynx", "Kite", "assassin"),
            pet(PACT_IDS[3], "Cedar Tortoise", "Bramble", "sage"),
        ],
    };
    save.triggeredEvents = [
        ...(save.triggeredEvents as string[]),
        "story-interlude-stormveil-village-88",
        "story-interlude-stormveil-village-92",
        "story-stormveil-village-100-8",
    ];
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem("lastScreen.v1", "firstPact"));

    let progress = completedReturnProgress();
    const visits: FirstPactAftermathId[] = [];
    await page.route("**/api/first-pact/state", async (route) => {
        const body = route.request().postDataJSON() as { action?: string; aftermathId?: FirstPactAftermathId };
        if (body.action === "visit-aftermath" && body.aftermathId) {
            const replayed = progress.aftermathVisits.includes(body.aftermathId);
            if (!replayed) {
                visits.push(body.aftermathId);
                progress = { ...progress, aftermathVisits: [...progress.aftermathVisits, body.aftermathId] };
            }
            return json(route, { ok: true, progress, replayed });
        }
        return json(route, { ok: true, progress });
    });
    return { visits, progress: () => progress };
}

async function openNpcConversation(page: Page, screen: Locator, npcLabel: string, dialogName: string) {
    const conversation = page.getByRole("dialog", { name: dialogName });
    const interactable = screen.getByRole("button", { name: `${npcLabel}. Interact`, exact: true });
    await interactable.click();
    await expect(conversation).toBeVisible();
    return conversation;
}

async function advanceConversationToAction(conversation: Locator, actionName: string) {
    const action = conversation.getByRole("button", { name: actionName, exact: true });
    for (let step = 0; step < 6 && !(await action.isVisible()); step += 1) {
        const next = conversation.getByRole("button", { name: "Continue", exact: true });
        await expect(next).toBeVisible();
        await next.click();
    }
    await expect(action).toBeVisible();
    return action;
}

test("First Pact Chronicle remembers the sealed four and an optional aftermath visit survives reload", async ({ page }, testInfo) => {
    test.skip(!["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "desktop and phone certify the expanded First Pact return");
    const state = await installCompletedReturn(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const screen = page.locator(".first-pact-screen");
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await screen.getByRole("button", { name: "Chronicle", exact: true }).click();
    const chronicle = page.getByRole("dialog", { name: "First Pact Chronicle" });
    await expect(chronicle).toContainText("Rill · Moss · Kite · Bramble");
    await expect(chronicle).not.toContainText("Rook");
    await expect(chronicle).toContainText("Return visits");
    await expect(chronicle).toContainText("0 / 5");
    await chronicle.getByRole("button", { name: "Close", exact: true }).click();

    const isu = screen.getByRole("button", { name: "Isu, Bell Warden. Interact", exact: true });
    // Isu is stationary. Opening the toolbar journal must not queue a map walk
    // that resumes on Close. Let several 105ms movement ticks elapse before
    // checking that the player is still beside him and using a normal click.
    await page.waitForTimeout(1_000);
    await expect(isu).toBeVisible();
    if (testInfo.project.name === "chromium-mobile") {
        const geometry = await page.evaluate(() => {
            const screenRect = document.querySelector(".first-pact-screen")?.getBoundingClientRect();
            const questRect = document.querySelector(".fp-quest-card")?.getBoundingClientRect();
            const isuRect = document.querySelector('[aria-label="Isu, Bell Warden. Interact"]')?.getBoundingClientRect();
            const intersects = !!questRect && !!isuRect
                && questRect.left < isuRect.right && questRect.right > isuRect.left
                && questRect.top < isuRect.bottom && questRect.bottom > isuRect.top;
            return {
                screen: screenRect && { left: screenRect.left, right: screenRect.right },
                quest: questRect && { left: questRect.left, right: questRect.right, top: questRect.top, bottom: questRect.bottom },
                isu: isuRect && { left: isuRect.left, right: isuRect.right, top: isuRect.top, bottom: isuRect.bottom },
                intersects,
                viewportWidth: innerWidth,
            };
        });
        expect(geometry.screen?.left).toBeGreaterThanOrEqual(0);
        expect(geometry.screen?.right).toBeLessThanOrEqual(geometry.viewportWidth);
        expect(geometry.quest?.left).toBeGreaterThanOrEqual(0);
        expect(geometry.quest?.right).toBeLessThanOrEqual(geometry.viewportWidth);
        expect(geometry.intersects).toBe(false);
    }
    const conversation = await openNpcConversation(page, screen, "Isu, Bell Warden", "Conversation with Isu");
    const inspect = await advanceConversationToAction(conversation, "Inspect the rejected muzzle beneath the bell");
    await inspect.click();

    const aftermath = page.getByRole("dialog", { name: "Reading The bell rope" });
    await expect(aftermath).toContainText("rejected muzzle");
    await aftermath.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(aftermath).toContainText("Rook backs toward the open street");
    await page.screenshot({
        path: testInfo.outputPath(`first-pact-aftermath-${testInfo.project.name}.png`),
        fullPage: true,
    });
    await expect.poll(() => state.visits).toEqual(["writ-silencing"]);
    await aftermath.getByRole("button", { name: "Step back", exact: true }).click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".first-pact-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Chronicle", exact: true }).click();
    const restored = page.getByRole("dialog", { name: "First Pact Chronicle" });
    await expect(restored).toContainText("1 / 5");
    expect(state.progress().aftermathVisits).toEqual(["writ-silencing"]);
});

test("a completed crossing repairs its authoritative grant on reload and applies the returned character", async ({ page }, testInfo) => {
    test.skip(!["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "desktop and phone certify First Pact completion recovery");
    const save = uiAuditSave();
    const currentPets = [
        pet(PACT_IDS[0], "Before the repair", "Rook", "defender"),
        pet(PACT_IDS[1], "Mosswing Owl", "Moss", "tracker"),
        pet(PACT_IDS[2], "Gale Lynx", "Kite", "assassin"),
        pet(PACT_IDS[3], "Cedar Tortoise", "Bramble", "sage"),
    ];
    save.character = { ...save.character, level: 100, activePetId: PACT_IDS[0], pets: currentPets };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem("lastScreen.v1", "firstPact"));
    const progress = {
        ...completedReturnProgress(),
        mainStep: "complete" as const,
        flags: [...completedReturnProgress().flags, "first-pact-complete"],
        mainQuest: { ...completedReturnProgress().mainQuest, completedAt: 1_700_000_100_000 },
    };
    const repairedCharacter = {
        ...save.character,
        pets: [
            { ...currentPets[0], name: "After the repair" },
            ...currentPets.slice(1),
        ],
        auraStones: Number(save.character.auraStones ?? 0) + 15,
        serverTitles: ["Pactbound", "Road Unclosed"],
    };
    let stateReads = 0;
    await page.route("**/api/first-pact/state", async (route) => {
        const body = route.request().postDataJSON() as { action?: string };
        if (body.action !== "state") return json(route, { ok: true, progress });
        stateReads += 1;
        if (stateReads === 1) {
            return json(route, {
                error: "The crossing is preserved, but its reward could not be recorded. Try again.",
                progress,
            }, 503);
        }
        return json(route, { ok: true, progress, character: repairedCharacter, _saveVersion: 991 });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert")).toContainText("reward could not be recorded");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".first-pact-screen")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("img", { name: "After the repair, your following companion" })).toBeVisible();
    await expect.poll(() => stateReads).toBe(2);
    await page.waitForTimeout(500);
    expect(stateReads).toBe(2);
});
