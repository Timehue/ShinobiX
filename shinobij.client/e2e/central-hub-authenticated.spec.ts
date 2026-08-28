import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { PUBLIC_CAPABILITY_IDS } from "../../shared/public-capabilities";

type SavePayload = {
    character?: Record<string, unknown>;
    [key: string]: unknown;
};

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

async function installAuthenticatedApi(page: Page) {
    let save: SavePayload | null = null;
    let saveVersion = 0;
    let failNextAwakeningSave = false;

    await page.addInitScript(() => {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (key?.startsWith("ninjav-save-conflict-v1:")) localStorage.removeItem(key);
        }
        localStorage.setItem("shinobix:storage-notice-ack", "1");
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;

        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        if (path === "/api/player/capabilities") {
            return json(route, {
                ok: true,
                capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
                    id,
                    { state: "available", reason: "available" },
                ])),
            });
        }
        if (path === "/api/player-auth") return json(route, { ok: true, token: "e2e-session-token" });

        if (path.toLowerCase() === "/api/save/auditninja") {
            if (request.method() === "GET") {
                return save ? json(route, { ...save, _saveVersion: saveVersion }) : json(route, { error: "Not found" }, 404);
            }
            if (request.method() === "POST") {
                const incoming = request.postDataJSON() as SavePayload;
                const incomingBloodlineCount = Array.isArray(incoming.savedBloodlines) ? incoming.savedBloodlines.length : 0;
                const savedBloodlineCount = Array.isArray(save?.savedBloodlines) ? save.savedBloodlines.length : 0;
                // Forge acknowledgements can schedule an unrelated background
                // autosave. Fail only the ownership-expanding Awakening write so
                // that autosave cannot consume this one-shot regression fixture.
                if (failNextAwakeningSave && incomingBloodlineCount > savedBloodlineCount) {
                    failNextAwakeningSave = false;
                    return json(route, { error: "Injected persistence failure" }, 500);
                }
                saveVersion += 1;
                save = {
                    ...incoming,
                    character: {
                        ...(incoming.character ?? {}),
                        onboardingStep: "done",
                        ryo: 1_000_000,
                        fateShards: 500,
                        boneCharms: 500,
                        auraStones: 500,
                        mythicSeals: 500,
                        element: "Water",
                        elements: ["Water", "Wind"],
                        inventory: [
                            ...((incoming.character?.inventory as string[] | undefined) ?? []),
                            "dungeon-key",
                        ],
                    },
                };
                return json(route, { ok: true, _saveVersion: saveVersion });
            }
        }

        if (path === "/api/battle-lock") return json(route, { lock: null });
        if (path === "/api/world-state") return json(route, { territories: [], wars: [], standings: [] });
        if (path === "/api/clan/war/list") return json(route, { wars: [] });
        if (path === "/api/game-state") return json(route, { villageStates: {}, arenaActiveFights: [] });
        if (path === "/api/weekly-boss") return json(route, { boss: null, fightEnabled: true });
        if (path === "/api/ranked-season") return json(route, { current: null, lastSeason: null });
        if (path === "/api/legacy/status") return json(route, { enabled: false });
        if (path === "/api/towers/floors") return json(route, { floors: [] });

        return json(route, {
            ok: true,
            players: [],
            images: {},
            categories: {},
            ladder: [],
            leaderboard: [],
            announcements: [],
            eras: [],
            entries: [],
        });
    });

    return {
        hasSave: () => save !== null,
        getSave: () => save,
        getSaveVersion: () => saveVersion,
        failNextAwakeningSave: () => { failNextAwakeningSave = true; },
    };
}

async function createAccount(page: Page) {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByTestId("start-create").click();
    await page.getByRole("button", { name: "Choose Village" }).click();
    await page.locator(".cc-village-card").first().click();
    await page.getByRole("button", { name: "Choose Bloodline" }).click();
    await page.locator(".cc-bloodline-card").first().click();
    await page.getByRole("button", { name: "Choose Avatar" }).click();
    await page.locator(".cc-avatar-card").first().click();
    await page.getByRole("button", { name: "Preview Shinobi" }).click();
    await page.getByRole("button", { name: "Name and Password" }).click();
    await page.getByLabel("Name").fill("AuditNinja");
    await page.locator("#cc-password").fill("Audit!Pass1234");
    await page.locator("#cc-confirm-password").fill("Audit!Pass1234");
    await page.getByRole("button", { name: "Enter the World" }).click();
}

async function returnToCentral(page: Page) {
    await page.goto("/#/centralHub");
    // Hash-only navigation does not reload the SPA, and this app intentionally
    // restores bookmarked screens only during boot.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Central\s*The Thousand Gates/i })).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
}

test("authenticated player can open every Central Hub system", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "one full authenticated route certification is sufficient");
    const api = await installAuthenticatedApi(page);
    await createAccount(page);
    await expect.poll(api.hasSave).toBe(true);
    await expect.poll(() => page.evaluate(() => {
        const raw = localStorage.getItem("ninjav-admin-build-v1");
        return raw ? JSON.parse(raw).currentAccountName : "";
    })).toBe("AuditNinja");
    await returnToCentral(page);
    await capture(page, testInfo, "central-premium-desktop");

    const navigations = [
        { tile: "Arena District", heading: "Arena District" },
        { tile: "Shinobi Council Hall", heading: "Shinobi Council Hall" },
        { tile: "Grand Marketplace", heading: "Grand Marketplace" },
        { tile: "Hunter Guild", heading: /Hunter Guild/ },
        { tile: "Hall of Legends", heading: "Hall of Legends" },
        { tile: "Pet Colosseum", heading: "Pet Colosseum" },
        { tile: "Weekly Boss", heading: "Weekly Boss" },
    ] as const;

    for (const destination of navigations) {
        await page.locator(".central-card").filter({ hasText: destination.tile }).click();
        await expect(page.getByRole("heading", { name: destination.heading }).first()).toBeVisible();
        if (destination.tile === "Hunter Guild") {
            const rankUp = page.locator(".rank-up-btn");
            await expect(rankUp).toContainText(/^Rank Up → /);
            await expect(rankUp).not.toContainText("?");
            await capture(page, testInfo, "hunter-guild-rank-up-desktop");
        }
        if (destination.tile === "Shinobi Council Hall") {
            await capture(page, testInfo, "council-hall-premium-desktop");
            await page.getByRole("button", { name: "Return to Central" }).click();
            await expect(page.getByRole("heading", { name: /Central\s*The Thousand Gates/i })).toBeVisible();
            continue;
        }
        await returnToCentral(page);
    }

    for (const name of ["Ancient Archives", "Awakening Stone", "Crafter", "Relic Dungeons", "Celestial Tower"]) {
        const opener = page.locator(".central-card").filter({ hasText: name });
        await opener.click();
        const dialog = page.getByRole("dialog", { name });
        await expect(dialog).toBeVisible();
        if (name === "Awakening Stone") {
            const rerollButtons = dialog.locator(".aw-roll-row .aw-paid-btn");
            await expect(rerollButtons).toHaveCount(2);
            await expect(dialog.getByRole("button", { name: /^Reroll Element 1 element/ })).toBeVisible();
            await expect(dialog.getByRole("button", { name: /^Reroll Elements Both elements/ })).toBeVisible();
            await capture(page, testInfo, "awakening-stone-premium-desktop");
            const forge = dialog.getByRole("heading", { name: /Bloodline Awakening/i });
            await forge.scrollIntoViewIfNeeded();
            await expect(forge).toBeVisible();
            const sRankForge = dialog.locator(".aw-forge-card.rank-s");
            await sRankForge.scrollIntoViewIfNeeded();
            await expect(sRankForge).toBeVisible();
            await dialog.screenshot({ path: testInfo.outputPath("awakening-stone-forge-premium-desktop.png"), animations: "disabled" });
        }
        if (name === "Relic Dungeons") await capture(page, testInfo, "relic-dungeons-premium-desktop");
        await expect(dialog.locator(":focus")).toHaveCount(1);
        await expect.poll(() => page.evaluate(() => (document.querySelector("#root") as HTMLElement | null)?.inert)).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        await expect.poll(() => page.evaluate(() => (document.querySelector("#root") as HTMLElement | null)?.inert ?? false)).toBe(false);
    }

    const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

const bloodlineAwakeningContracts = [
    { rank: "B Rank", rankClass: "rank-b", currency: "boneCharms", jutsuCount: 4, pointBudget: 7, percentChoices: ["25%", "30%"] },
    { rank: "A Rank", rankClass: "rank-a", currency: "auraStones", jutsuCount: 5, pointBudget: 10, percentChoices: ["25%", "30%"] },
    { rank: "S Rank", rankClass: "rank-s", currency: "mythicSeals", jutsuCount: 5, pointBudget: 11, percentChoices: ["30%", "35%"] },
] as const;

for (const contract of bloodlineAwakeningContracts) {
    test(`${contract.rank} Awakening ritual opens its rank-specific builder`, async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const isDesktopContract = testInfo.project.name === "chromium-desktop";
        const isMobileSCertification = testInfo.project.name === "chromium-mobile" && contract.rank === "S Rank";
        test.skip(!isDesktopContract && !isMobileSCertification, "desktop covers every rank; mobile certifies the densest S Rank editor");
        const api = await installAuthenticatedApi(page);
        await createAccount(page);
        await expect.poll(api.hasSave).toBe(true);
        const preAwakeningCharacter = api.getSave()?.character as Record<string, unknown>;
        const preAwakeningEquipped = [...(preAwakeningCharacter.equippedJutsuIds as string[] ?? [])];
        const preAwakeningMastery = [...(preAwakeningCharacter.jutsuMastery as Array<{ jutsuId: string; level: number }> ?? [])];
        const preAwakeningBloodlines = structuredClone((api.getSave()?.savedBloodlines as unknown[] | undefined) ?? []);
        await returnToCentral(page);

        let requestedRank = "";
        await page.route("**/api/bloodlines/forge", async (route) => {
            const requestBody = route.request().postDataJSON() as { rank?: string };
            requestedRank = requestBody.rank ?? "";
            const currentSave = api.getSave();
            const currentCharacter = currentSave?.character ?? {};
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    ok: true,
                    rank: contract.rank,
                    currency: contract.currency,
                    cost: 100,
                    balance: 400,
                    character: { ...currentCharacter, [contract.currency]: 400 },
                    _saveVersion: api.getSaveVersion() + 1,
                }),
            });
        });

        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        const dialog = page.getByRole("dialog", { name: "Awakening Stone" });
        await expect(dialog).toBeVisible();
        const ritualCard = dialog.locator(`.aw-forge-card.${contract.rankClass}`);
        const builderSpec = ritualCard.getByLabel(`${contract.rank} builder limits`);
        await expect(builderSpec).toContainText(`${contract.jutsuCount}Techniques`);
        await expect(builderSpec).toContainText(`${contract.pointBudget}Point cap`);
        await expect(builderSpec).toContainText(`${contract.percentChoices.join(" / ")}Tag power`);
        await ritualCard.locator(".aw-forge-btn").click();

        await expect.poll(() => requestedRank).toBe(contract.rank);
        await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "bloodlineMaker");
        await expect(page.getByRole("heading", { name: "Bloodline Awakening" })).toBeVisible();
        await expect(page.getByText("Ritual attuned")).toBeVisible();
        await expect(page.getByRole("button", { name: /Awakening Stone/ })).toBeVisible();

        const summary = page.getByLabel("Awakening summary");
        await expect(summary.locator("span").filter({ hasText: "Ritual grade" }).locator("strong")).toHaveText(contract.rank);
        await expect(summary.locator("span").filter({ hasText: "Techniques" }).locator("strong")).toHaveText(String(contract.jutsuCount));
        await expect(summary.locator("span").filter({ hasText: "Build budget" }).locator("strong")).toHaveText(`0/${contract.pointBudget}`);
        await expect(page.locator(".bloodline-rank-locked")).toContainText(contract.rank);
        await expect(page.locator(".bloodline-rank-locked")).toContainText("Locked");
        await expect(page.locator(".bloodline-wizard-step")).toHaveCount(contract.jutsuCount + 2);
        await expect(page.locator(".bloodline-awakening-build-meter b")).toHaveText(`0 / ${contract.pointBudget}`);

        await page.locator(".bloodline-wizard-step").filter({ hasText: "Jutsu 1" }).click();
        await expect(page.getByRole("heading", { name: `Jutsu 1 of ${contract.jutsuCount}` })).toBeVisible();
        await page.locator(".tag-picker select:not(.tag-percent-select)").first().selectOption("Poison");

        const percentSelect = page.locator(".tag-percent-select").first();
        await expect(percentSelect).toBeVisible();
        await expect(percentSelect.locator("option")).toHaveText([...contract.percentChoices]);
        await expect(percentSelect).toHaveValue(contract.percentChoices.at(-1)!.replace("%", ""));
        await expect(page.locator(".bloodline-points-total")).toHaveText("Jutsu Points: 0.5");
        await expect(page.locator(".bloodline-awakening-build-meter b")).toHaveText(`0.5 / ${contract.pointBudget}`);
        await expect(page.getByLabel("Jutsu target")).toHaveValue("OPPONENT");
        await expect(page.getByLabel("Jutsu method")).toHaveValue("SINGLE");
        await expect(page.getByRole("button", { name: "40 AP Utility" })).toBeVisible();
        await expect(page.getByRole("button", { name: "60 AP Damage" })).toBeVisible();

        await page.screenshot({
            path: testInfo.outputPath(`bloodline-awakening-${contract.rank.charAt(0).toLowerCase()}-builder.png`),
            fullPage: false,
            animations: "disabled",
        });

        await page.locator(".inline-grid").scrollIntoViewIfNeeded();
        await page.screenshot({
            path: testInfo.outputPath(`bloodline-awakening-${contract.rank.charAt(0).toLowerCase()}-editor.png`),
            fullPage: false,
            animations: "disabled",
        });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

        await page.locator(".bloodline-wizard-step").filter({ hasText: "Details" }).click();
        await page.locator(".bloodline-wizard-panel > input").first().fill(`${contract.rank} Audit Legacy`);
        await page.locator(".bloodline-wizard-step").filter({ hasText: "Review" }).click();
        const saveButton = page.getByRole("button", { name: "Awaken Bloodline" });
        await expect(saveButton).toBeEnabled();
        if (contract.rank === "B Rank") {
            api.failNextAwakeningSave();
            await saveButton.click();
            const failure = page.getByRole("alertdialog", { name: "Notice" });
            await expect(failure).toContainText("was not saved");
            await expect(failure).toContainText("current bloodline is unchanged");
            await failure.getByRole("button", { name: "OK" }).click();
            await expect(saveButton).toBeEnabled();
            expect(api.getSave()?.savedBloodlines).toEqual(preAwakeningBloodlines);
            expect((api.getSave()?.character as Record<string, unknown>).equippedBloodlineId).toBe(preAwakeningCharacter.equippedBloodlineId);
        }
        await saveButton.click();

        await expect.poll(() => {
            const bloodlines = api.getSave()?.savedBloodlines;
            return Array.isArray(bloodlines) ? (bloodlines[0] as Record<string, unknown> | undefined)?.rank : undefined;
        }).toBe(contract.rank);
        const savedBloodline = (api.getSave()?.savedBloodlines as Array<Record<string, unknown>>)[0]!;
        const savedJutsus = savedBloodline.jutsus as Array<Record<string, unknown>>;
        const savedTags = savedJutsus[0]!.tags as Array<Record<string, unknown>>;
        expect(savedBloodline.totalPoints).toBe(0.5);
        expect(savedJutsus).toHaveLength(contract.jutsuCount);
        expect(savedTags[0]).toMatchObject({ name: "Poison", percent: Number(contract.percentChoices.at(-1)!.replace("%", "")) });
        const savedCharacter = api.getSave()?.character as Record<string, unknown>;
        expect(savedCharacter.equippedBloodlineId).toBe(savedBloodline.id);
        expect(savedCharacter.equippedJutsuIds).toEqual(preAwakeningEquipped);
        const savedMastery = savedCharacter.jutsuMastery as Array<{ jutsuId: string; level: number }>;
        for (const previous of preAwakeningMastery) {
            expect(savedMastery).toContainEqual(expect.objectContaining(previous));
        }
        for (const jutsu of savedJutsus) {
            expect(savedMastery).toContainEqual(expect.objectContaining({ jutsuId: jutsu.id, level: 1 }));
        }
    });
}

test("Central premium destinations stay within the mobile viewport", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-mobile", "the phone layout needs one focused certification");
    const api = await installAuthenticatedApi(page);
    await createAccount(page);
    await expect.poll(api.hasSave).toBe(true);
    await returnToCentral(page);

    async function expectNoHorizontalOverflow() {
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }

    await expectNoHorizontalOverflow();
    await capture(page, testInfo, "central-premium-mobile");

    for (const name of ["Awakening Stone", "Relic Dungeons"]) {
        await page.locator(".central-card").filter({ hasText: name }).click();
        const dialog = page.getByRole("dialog", { name });
        await expect(dialog).toBeVisible();
        await expectNoHorizontalOverflow();
        await capture(page, testInfo, `${name.toLowerCase().replaceAll(" ", "-")}-mobile`);
        if (name === "Awakening Stone") {
            const rerollButtons = dialog.locator(".aw-roll-row .aw-paid-btn");
            await expect(rerollButtons).toHaveCount(2);
            const rerollMetrics = await rerollButtons.evaluateAll((buttons) => buttons.map((button) => {
                const rect = button.getBoundingClientRect();
                return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
            }));
            const viewportWidth = page.viewportSize()?.width ?? 390;
            expect(rerollMetrics.every((button) => button.width >= 250)).toBe(true);
            expect(rerollMetrics.every((button) => button.height >= 60)).toBe(true);
            expect(rerollMetrics.every((button) => button.left >= 0 && button.right <= viewportWidth)).toBe(true);
            const forge = dialog.getByRole("heading", { name: /Bloodline Awakening/i });
            await forge.scrollIntoViewIfNeeded();
            await expect(forge).toBeVisible();
            const sRankForge = dialog.locator(".aw-forge-card.rank-s");
            await sRankForge.scrollIntoViewIfNeeded();
            await expect(sRankForge).toBeVisible();
            await expectNoHorizontalOverflow();
            await dialog.screenshot({ path: testInfo.outputPath("awakening-stone-forge-mobile.png"), animations: "disabled" });
        }
        await page.keyboard.press("Escape");
    }

    await page.locator(".central-card").filter({ hasText: "Shinobi Council Hall" }).click();
    await expect(page.getByRole("heading", { name: "Shinobi Council Hall" })).toBeVisible();
    await expectNoHorizontalOverflow();
    await capture(page, testInfo, "council-hall-premium-mobile");
    await page.getByRole("button", { name: "Return to Central" }).click();
    await expect(page.getByRole("heading", { name: /Central\s*The Thousand Gates/i })).toBeVisible();
});
