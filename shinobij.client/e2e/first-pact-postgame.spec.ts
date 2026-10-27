import { expect, test, type Route } from "@playwright/test";
import { createFirstPactProgress, type FirstPactProgress } from "../../shared/first-pact-contract";
import { installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const ROLES = ["defender", "sage", "tracker", "assassin", "defender", "assassin"] as const;
const TEMPLATES = ["standard-0", "standard-1", "standard-2", "standard-3", "standard-4", "rare-1"];
const rental = (index: number) => ({
    id: `rental-${index}-${TEMPLATES[index]}`, templateId: TEMPLATES[index], name: `Rental ${index + 1}`,
    rarity: "legendary", level: 100, element: "Fire", role: ROLES[index], hp: 900, attack: 140, defense: 120, speed: 110, jutsus: [],
});

function ownPet(id: string, role: string) {
    return { id, name: id, role, rarity: "rare", level: 90, xp: 0, maxLevel: 100, hp: 500, attack: 80, defense: 80, speed: 80, jutsus: [], unlockedForPve: true, happiness: 90 };
}

test("Orin's Stable Exhibition drafts four rentals through the squad dialog", async ({ page }, testInfo) => {
    test.skip(!["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name), "desktop and phone certify the First Pact postgame");
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const save = uiAuditSave();
    save.character = { ...save.character, level: 100, pets: ["own-a", "own-b", "own-c", "own-d"].map((id, i) => ownPet(id, ROLES[i])), activePetId: "own-a" };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem("lastScreen.v1", "firstPact"));

    const base = createFirstPactProgress(1_700_000_000_000);
    const progress: FirstPactProgress = {
        ...base, chapter: 4, mainStep: "complete", courtStanding: 1_600,
        flags: ["crossed-celestial-threshold", "first-pact-complete"],
        // Beside Orin's desk, so the conversation opens without a long walk.
        lastPosition: { x: 44, y: 43, district: base.lastPosition.district },
        stableQuest: { status: "complete", tournamentWins: 3, battleProofs: [] },
        finalTrial: { wins: 4, battleProofs: [] },
    };
    const pool = TEMPLATES.map((_, index) => rental(index));
    let exhibition: Record<string, unknown> | null = null;
    const bodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/first-pact/state", async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        bodies.push(body);
        if (body.action === "exhibition-start") {
            exhibition = { runId: "run-e2e", status: "drafting", round: 0, length: 7, pool, team: [], offered: null, nextRoundId: null };
        }
        if (body.action === "exhibition-draft") {
            const ids = body.petIds as string[];
            exhibition = { runId: "run-e2e", status: "active", round: 0, length: 7, pool: [], team: ids.map((id) => pool.find((pet) => pet.id === id)), offered: null, nextRoundId: "exhibition-1" };
        }
        return json(route, { ok: true, progress, ...(exhibition ? { exhibition } : {}) });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const screen = page.locator(".first-pact-screen");
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await screen.getByRole("button", { name: "Registrar Orin, Colosseum Registrar. Interact", exact: true }).click();
    const conversation = page.getByRole("dialog", { name: "Conversation with Registrar Orin" });
    await expect(conversation).toBeVisible();
    const open = conversation.getByRole("button", { name: "Open the Exhibition ledger", exact: true });
    for (let step = 0; step < 6 && !(await open.isVisible()); step += 1) await conversation.getByRole("button", { name: "Continue", exact: true }).click();
    await open.click();

    const squad = page.getByRole("dialog", { name: "Prepare tournament squad" });
    await expect(squad).toContainText("Draft four rentals");
    await expect(squad).toContainText("Your own companions stay home");
    const rentals = squad.locator(".fp-roster button");
    await expect(rentals).toHaveCount(6);
    for (const index of [0, 1, 2, 3]) await rentals.nth(index).click();
    await expect(squad).toContainText("Partners");
    await squad.getByRole("button", { name: "Draft these four", exact: true }).click();
    await expect(squad.getByRole("button", { name: "Ring the bell", exact: true })).toBeEnabled();
    await expect(squad).toContainText("Round 1 of 7");
    expect(bodies.find((body) => body.action === "exhibition-draft")?.petIds).toEqual(pool.slice(0, 4).map((pet) => pet.id));
    await page.screenshot({ path: testInfo.outputPath(`first-pact-exhibition-${testInfo.project.name}.png`), fullPage: true });
    expect(pageErrors).toEqual([]);
});
