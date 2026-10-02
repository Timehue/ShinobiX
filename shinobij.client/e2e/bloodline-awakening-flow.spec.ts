import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { applyBloodlineForgePurchase, type BloodlineForgeRank, type PendingBloodlineForge } from "../../api/bloodlines/_forge";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

const ranks = [
    { rank: "B Rank", material: "boneCharms", count: 4, budget: 7 },
    { rank: "A Rank", material: "auraStones", count: 5, budget: 10 },
    { rank: "S Rank", material: "mythicSeals", count: 5, budget: 11 },
] as const;

for (const tier of ranks) {
    test(`${tier.rank}: confirmed purchase plays ritual then opens the locked builder`, async ({ page }) => {
        await page.clock.install();
        const runtimeErrors: string[] = [];
        const missingRitualAssets: string[] = [];
        page.on("pageerror", error => runtimeErrors.push(error.message));
        page.on("response", response => {
            const path = new URL(response.url()).pathname;
            if (response.status() >= 400 && (/awakening-(bone|aura|mythic)-altar/.test(path) || path.startsWith("/sfx/"))) {
                missingRitualAssets.push(path);
            }
        });
        const save = uiAuditSave();
        const character = { ...save.character, boneCharms: 140, auraStones: 140, mythicSeals: 140, element: "Water", elements: ["Water", "Wind"] };
        save.character = character;
        const runtime = await installUiAuditRuntime(page, save);
        await page.addInitScript(() => localStorage.setItem("audioMuted", "0"));
        let requests = 0;
        let debit = 0;
        await page.route("**/api/bloodlines/forge", async route => {
            requests++;
            const body = route.request().postDataJSON();
            expect(body.rank).toBe(tier.rank);
            expect(body.resumeOnly).toBeUndefined();
            const result = applyBloodlineForgePurchase(character, [], body.rank, randomUUID(), Date.now());
            expect(result.ok).toBe(true);
            if (!result.ok) return route.abort();
            debit = result.cost;
            const version = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(result.character, version);
            await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rank: result.entitlement.rank,
                character: result.character, resumed: result.resumed, _saveVersion: version }) });
        });
        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        // Hold the auto-close while assertions and WebKit actionability run.
        await page.clock.pauseAt(new Date(Date.now() + 1000));
        await page.locator(`.aw-forge-card.rank-${tier.rank[0].toLowerCase()} button`).click();
        const ritual = page.getByRole("dialog", { name: `${tier.rank} Attuned` });
        await expect(ritual).toBeVisible();
        await expect(page.locator('.app-shell[data-screen="centralHub"]')).toBeVisible();
        await expect(page.getByRole("dialog", { name: "Awakening Stone" })).toHaveCount(0);
        expect(requests).toBe(1);
        expect(runtimeErrors).toEqual([]);
        expect(missingRitualAssets).toEqual([]);
        expect(debit).toBe(100);
        await expect.poll(() => ritual.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(768);
        if (tier.rank === "B Rank") await ritual.getByRole("button", { name: "Skip to builder" }).click();
        else if (tier.rank === "A Rank") await page.keyboard.press("Escape");
        await page.clock.runFor(tier.rank === "S Rank" ? 4000 : 400);
        await page.clock.resume();
        await expect(page.locator('.app-shell[data-screen="bloodlineMaker"]')).toBeVisible();
        await expect(ritual).toHaveCount(0);
        const summary = page.getByLabel("Awakening summary");
        await expect(summary).toContainText(tier.rank);
        await expect(summary).toContainText("Water");
        await expect(page.locator(".bloodline-rank-locked")).toContainText(tier.rank);
        await expect(page.locator(".bloodline-awakening-hero-stats > span").nth(2)).toContainText(String(tier.count));
        await expect(page.locator(".bloodline-awakening-build-meter")).toContainText(`${tier.budget} points remaining`);
        await expect(page.locator("#root")).not.toHaveAttribute("inert");
        await expect(page.locator("body")).not.toHaveClass(/ui-scroll-locked/);
        // The next screen's Central control must actually respond after modal cleanup.
        await page.getByRole("button", { name: "Central", exact: false }).filter({ has: page.locator("span") }).first().click();
        await expect(page.locator('.app-shell[data-screen="centralHub"]')).toBeVisible();
        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        await expect(page.locator(`.aw-forge-card.rank-${tier.rank[0].toLowerCase()} .aw-forge-material`)).toContainText("40 held in inventory");
        expect(requests).toBe(1);
        expect(runtimeErrors).toEqual([]);
        expect(missingRitualAssets).toEqual([]);
    });
}

test("resume uses the paid entitlement without charging again", async ({ page }) => {
    await page.clock.install();
    const save = uiAuditSave();
    const character = { ...save.character, auraStones: 17, element: "Fire", elements: ["Fire"] };
    save.character = character;
    const runtime = await installUiAuditRuntime(page, save);
    const pending: PendingBloodlineForge[] = [{ id: randomUUID(), rank: "A Rank", issuedAt: Date.now() }];
    let requests = 0;
    await page.route("**/api/bloodlines/forge", async route => {
        requests++;
        const body = route.request().postDataJSON();
        expect(body.resumeOnly).toBe(true);
        const result = applyBloodlineForgePurchase(character, pending, body.rank, randomUUID(), Date.now(), true);
        expect(result.ok).toBe(true);
        if (!result.ok) return route.abort();
        expect(result.cost).toBe(0);
        expect(result.balance).toBe(17);
        runtime.commitServerCharacter(result.character, runtime.currentVersion());
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rank: "A Rank", resumed: true,
            character: result.character, _saveVersion: runtime.currentVersion() }) });
    });
    await expectUiAuditBoot(page, runtime, "centralHub");
    await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.locator(".aw-forge-card.rank-a button").click();
    const ritual = page.getByRole("dialog", { name: "A Rank Rekindled" });
    await expect(ritual).toBeVisible();
    await ritual.getByRole("button", { name: "Skip to builder" }).click();
    await page.clock.runFor(400);
    await page.clock.resume();
    await expect(page.locator('.app-shell[data-screen="bloodlineMaker"]')).toBeVisible();
    await expect(page.getByLabel("Awakening summary")).toContainText("Fire");
    expect(requests).toBe(1);
});

test("reduced motion reaches the real builder with the confirmed rank and element", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const save = uiAuditSave();
    const character = { ...save.character, mythicSeals: 140, element: "Lightning", elements: ["Lightning"] };
    save.character = character;
    const runtime = await installUiAuditRuntime(page, save);
    let requests = 0;
    await page.route("**/api/bloodlines/forge", async route => {
        requests++;
        const result = applyBloodlineForgePurchase(character, [], "S Rank", randomUUID(), Date.now());
        expect(result.ok).toBe(true);
        if (!result.ok) return route.abort();
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(result.character, version);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rank: "S Rank",
            character: result.character, _saveVersion: version }) });
    });
    await expectUiAuditBoot(page, runtime, "centralHub");
    await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
    await page.locator(".aw-forge-card.rank-s button").click();
    await expect(page.locator('.app-shell[data-screen="bloodlineMaker"]')).toBeVisible();
    await expect(page.locator(".bl-ritual")).toHaveCount(0);
    await expect(page.getByLabel("Awakening summary")).toContainText("Lightning");
    await expect(page.locator(".bloodline-rank-locked")).toContainText("S Rank");
    expect(requests).toBe(1);
});

for (const failure of ["rejected", "mismatched rank", "stale version"] as const) {
    test(`${failure} response cannot reveal a rank or open the builder`, async ({ page }) => {
        const save = uiAuditSave();
        save.character = { ...save.character, mythicSeals: 140 };
        const runtime = await installUiAuditRuntime(page, save);
        await page.route("**/api/bloodlines/forge", route => route.fulfill({
            status: failure === "rejected" ? 409 : 200, contentType: "application/json",
            body: JSON.stringify(failure === "rejected" ? { ok: false, error: "No paid ritual is available." } : {
                ok: true, rank: failure === "mismatched rank" ? "A Rank" as BloodlineForgeRank : "S Rank",
                character: { ...save.character, mythicSeals: 40 },
                _saveVersion: failure === "stale version" ? runtime.currentVersion() - 1 : runtime.currentVersion() + 1,
            }),
        }));
        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        await page.locator(".aw-forge-card.rank-s button").click();
        await expect(page.locator(".aw-forge-card.rank-s button")).toBeEnabled();
        await expect(page.getByRole("dialog", { name: "Awakening Stone" })).toBeVisible();
        await expect(page.locator(".bl-ritual")).toHaveCount(0);
        await expect(page.locator('.app-shell[data-screen="bloodlineMaker"]')).toHaveCount(0);
        await expect(page.locator(".aw-forge-card.rank-s .aw-forge-material")).toContainText("140 held in inventory");
    });
}

for (const pending of ["element", "bloodline"] as const) {
    test(`a pending ${pending} request blocks the other ritual`, async ({ page }) => {
        const save = uiAuditSave();
        save.character = { ...save.character, mythicSeals: 140, fateShards: 100, element: "Water", elements: ["Water", "Wind"],
            claimedAwakenings: ["awakening-free-lv2", "awakening-free-lv20"] };
        const runtime = await installUiAuditRuntime(page, save);
        const gate = Promise.withResolvers<void>();
        let requests = 0;
        await page.route(pending === "element" ? "**/api/awakening/roll" : "**/api/bloodlines/forge", async route => {
            requests++;
            await gate.promise;
            await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Ritual interrupted for audit." }) });
        });
        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        const elementButton = page.getByRole("button", { name: /^Reroll Element 1 element/ });
        const bloodlineButton = page.locator(".aw-forge-card.rank-s button");
        await (pending === "element" ? elementButton : bloodlineButton).click();
        try {
            await expect.poll(() => requests).toBe(1);
            await expect(pending === "element" ? bloodlineButton : elementButton).toBeDisabled({ timeout: 1500 });
        } finally { gate.resolve(); }
        await expect(page.locator(".aw-msg-error")).toContainText("Ritual interrupted for audit.");
        await expect(elementButton).toBeEnabled();
        await expect(bloodlineButton).toBeEnabled();
    });
}
