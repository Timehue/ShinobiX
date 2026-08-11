import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SETUP = {
    version: 1,
    stance: "balanced",
    doctrine: "warden-pact",
    buyPolicy: "balanced",
    deployment: ["top", "mid", "bottom", "flex"],
    buildPackage: "escort-rite",
    coachOrder: "trade",
    objectiveTechnique: "secure",
    counterstrike: "cross-map",
};

const lobbyFor = (name: string, ready = false) => ({
    code: "ABCDEFGH",
    host: name,
    state: "lobby",
    you: { team: "blue", slot: 0, petIndexes: [0, 1], lanes: ["top", "mid"] },
    seats: [
        { team: "blue", slot: 0, name, ready, petCount: ready ? 2 : 0, isYou: true },
        { team: "blue", slot: 1, name: null, ready: false, petCount: 0, isYou: false },
        { team: "red", slot: 0, name: null, ready: false, petCount: 0, isYou: false },
        { team: "red", slot: 1, name: null, ready: false, petCount: 0, isYou: false },
    ],
    match: null,
    setupPreview: SETUP,
    createdAt: Date.now(),
});

const matchSlot = (id: string, name: string, role: "defender" | "tracker" | "assassin" | "sage") => ({
    pet: { id, name, level: 28, hp: 760, attack: 92, defense: 70, speed: 84, rarity: "rare", element: "Earth", role },
    role,
});

const runningLobbyFor = (name: string) => ({
    ...lobbyFor(name, true),
    state: "running",
    match: {
        seed: 987654,
        blue: [
            matchSlot("blue-a", "Blue Aegis", "defender"),
            matchSlot("blue-b", "Blue Blitz", "assassin"),
            matchSlot("blue-c", "Blue Current", "sage"),
            matchSlot("blue-d", "Blue Gale", "tracker"),
        ],
        red: [
            matchSlot("red-a", "Red Aegis", "defender"),
            matchSlot("red-b", "Red Blitz", "assassin"),
            matchSlot("red-c", "Red Current", "sage"),
            matchSlot("red-d", "Red Gale", "tracker"),
        ],
        blueSetup: SETUP,
        redSetup: SETUP,
    },
});

const onlyPrimaryProject = (projectName: string) => projectName !== "chromium-dpr1";

async function openLobby(page: Page) {
    await page.goto("/coop-harness.html");
    const opener = page.getByRole("button", { name: "Open Co-op Lobby" });
    await opener.focus();
    await opener.click();
    return { opener, dialog: page.getByRole("dialog", { name: "Co-op Hollow Warfront" }) };
}

test("co-op dialog passes Axe, traps focus, closes with Escape, and restores its launcher", async ({ page }, testInfo) => {
    test.skip(onlyPrimaryProject(testInfo.project.name));
    const { opener, dialog } = await openLobby(page);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();

    const accessibility = await new AxeBuilder({ page }).include(".wf-coop-dialog").disableRules(["color-contrast"]).analyze();
    expect(accessibility.violations).toEqual([]);

    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    for (let index = 0; index < 8; index++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
});

test("account change aborts an older create response before it can populate the new player lobby", async ({ page }, testInfo) => {
    test.skip(onlyPrimaryProject(testInfo.project.name));
    await page.route("**/api/arena/lobby", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lobby: lobbyFor("Kakashi") }) });
    });
    const { dialog } = await openLobby(page);
    await page.getByRole("button", { name: "Create a lobby" }).click();
    await page.evaluate(() => window.coopHarness.switchPlayer("Obito"));
    await expect(page.locator("#active-player")).toHaveText("Active player: Obito");
    await page.waitForTimeout(650);
    await expect(dialog.getByText("ABCDEFGH")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Create a lobby" })).toBeEnabled();
});

test("server-mapped co-op lanes are labelled and swapping never shifts a third selection", async ({ page }, testInfo) => {
    test.skip(onlyPrimaryProject(testInfo.project.name));
    await page.route("**/api/arena/lobby", async (route) => {
        const body = route.request().postDataJSON() as { name: string; action: string };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lobby: lobbyFor(body.name, body.action === "pets") }) });
    });
    const { dialog } = await openLobby(page);
    await dialog.getByRole("button", { name: "Create a lobby" }).click();
    await expect(dialog.getByText(/Server-sealed mapping: seat 1 owns roster slot 1 \/ Top and slot 2 \/ Mid/)).toBeVisible();

    const top = dialog.getByRole("button", { name: /Top lane, pick 1/ });
    const mid = dialog.getByRole("button", { name: /Mid lane, pick 2/ });
    const aegis = dialog.getByRole("button", { name: /Aegis, Defender/ });
    const blitz = dialog.getByRole("button", { name: /Blitz, Assassin/ });
    await top.click();
    await aegis.click();
    await blitz.click();
    await expect(aegis).toHaveAttribute("aria-label", /pick 1, Top lane/);
    await expect(blitz).toHaveAttribute("aria-label", /pick 2, Mid lane/);

    await top.click();
    await blitz.click();
    await expect(blitz).toHaveAttribute("aria-label", /pick 1, Top lane/);
    await expect(aegis).toHaveAttribute("aria-label", /pick 2, Mid lane/);
    await expect(top).toHaveAttribute("aria-label", /Blitz/);
    await expect(mid).toHaveAttribute("aria-label", /Aegis/);
    await expect(dialog.getByRole("button", { name: "Lock two lanes" })).toBeEnabled();
});

test("a deferred old poll cannot overwrite a newer running Start response", async ({ page }, testInfo) => {
    test.skip(onlyPrimaryProject(testInfo.project.name));
    let releaseOldPoll!: () => void;
    const oldPollRelease = new Promise<void>((resolve) => { releaseOldPoll = resolve; });
    let markPollStarted!: () => void;
    const pollStarted = new Promise<void>((resolve) => { markPollStarted = resolve; });
    let startRequests = 0;
    await page.route("**/api/arena/lobby", async (route) => {
        const body = route.request().postDataJSON() as { name: string; action: string };
        if (body.action === "poll") {
            markPollStarted();
            await oldPollRelease;
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lobby: lobbyFor(body.name, true) }) }).catch(() => undefined);
            return;
        }
        if (body.action === "start") {
            startRequests += 1;
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lobby: runningLobbyFor(body.name) }) });
            return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lobby: lobbyFor(body.name, true) }) });
    });

    const { dialog } = await openLobby(page);
    await dialog.getByRole("button", { name: "Create a lobby" }).click();
    await expect(dialog.getByRole("button", { name: "Start match" })).toBeEnabled();
    await pollStarted;
    await dialog.getByRole("button", { name: "Start match" }).click();
    const match = page.getByRole("dialog", { name: "Hollow Warfront match" });
    await expect(match).toHaveCount(1);
    releaseOldPoll();
    await page.waitForTimeout(300);
    await expect(match).toHaveCount(1);
    await expect(dialog).toBeHidden();
    expect(startRequests).toBe(1);
    await page.waitForTimeout(750);
    await page.evaluate(() => window.coopHarness.close());
    await expect(match).toHaveCount(0);
});

test("same-account remount recovers a running seal while an account swap cannot read its code", async ({ page }, testInfo) => {
    test.skip(onlyPrimaryProject(testInfo.project.name));
    let kakashiRecoveryPolls = 0;
    let obitoRecoveryPolls = 0;
    await page.route("**/api/arena/lobby", async (route) => {
        const body = route.request().postDataJSON() as { name: string; action: string; code?: string };
        if (body.action === "start" || body.action === "poll") {
            if (body.action === "poll" && body.name === "Kakashi") kakashiRecoveryPolls += 1;
            if (body.action === "poll" && body.name === "Obito") obitoRecoveryPolls += 1;
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lobby: runningLobbyFor(body.name) }) });
            return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lobby: lobbyFor(body.name, true) }) });
    });

    const { dialog } = await openLobby(page);
    await dialog.getByRole("button", { name: "Create a lobby" }).click();
    await dialog.getByRole("button", { name: "Start match" }).click();
    const match = page.getByRole("dialog", { name: "Hollow Warfront match" });
    await expect(match).toHaveCount(1);

    await page.waitForTimeout(750);
    await page.evaluate(() => window.coopHarness.close());
    await expect(match).toHaveCount(0);
    await page.evaluate(() => window.coopHarness.open());
    await expect(match).toHaveCount(1);
    expect(kakashiRecoveryPolls).toBe(1);

    await page.waitForTimeout(750);
    await page.evaluate(() => window.coopHarness.close());
    await expect(match).toHaveCount(0);
    await page.evaluate(() => window.coopHarness.switchPlayer("Obito"));
    await expect(page.locator("#active-player")).toHaveText("Active player: Obito");
    await page.evaluate(() => window.coopHarness.open());
    await expect(page.getByRole("dialog", { name: "Co-op Hollow Warfront" })).toBeVisible();
    await page.waitForTimeout(350);
    expect(obitoRecoveryPolls).toBe(0);
    await expect(page.getByRole("button", { name: "Create a lobby" })).toBeEnabled();
});
