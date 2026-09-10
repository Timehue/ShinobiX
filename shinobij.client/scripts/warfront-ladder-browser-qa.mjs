import { chromium, expect as baseExpect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ladderRoles, petLite, resolveLadderWarfront, snapshotLadderPet } from "../../api/pet-ladder/_core.ts";
// Run with: node --import tsx shinobij.client/scripts/warfront-ladder-browser-qa.mjs

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expect = baseExpect.configure({ timeout: 30_000 });
const output = resolve(clientRoot, "..", "output", "warfront-ladder-qa");
await mkdir(output, { recursive: true });
const url = process.env.WARFRONT_LADDER_QA_URL ?? "http://127.0.0.1:5179";
let server;
let browser;
const checks = [];
const recordCheckOnly = process.argv.includes("--record-check");
try {
    if (!process.env.WARFRONT_LADDER_QA_URL) {
        const vite = resolve(clientRoot, "node_modules/vite/bin/vite.js");
        const config = resolve(clientRoot, "scripts/vite.warfront-ladder-qa.config.mjs");
        await new Promise((resolveBuild, rejectBuild) => {
            const build = spawn(process.execPath, [vite, "build", "--mode", "warfront-qa", "--config", config, "--configLoader", "runner"], { cwd: clientRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
            let output = "";
            build.stdout.on("data", (chunk) => { output += chunk; });
            build.stderr.on("data", (chunk) => { output += chunk; });
            build.on("error", rejectBuild);
            build.on("exit", (code) => code === 0 ? resolveBuild() : rejectBuild(new Error(`QA build failed: ${output.slice(-6000)}`)));
        });
        process.stdout.write("Focused ladder QA bundle built; starting preview.\n");
        server = spawn(process.execPath, [vite, "preview", "--config", config, "--configLoader", "runner"], {
            cwd: clientRoot, env: { ...process.env, VITE_SKIP_HTTPS: "1" }, windowsHide: true, stdio: "ignore",
        });
        for (let attempt = 0; attempt < 100; attempt++) {
            if (server.exitCode != null) throw new Error(`QA dev server exited ${server.exitCode}`);
            try { if ((await fetch(`${url}/warfront-ladder-qa.html`)).ok) break; } catch { /* starting */ }
            if (attempt === 99) throw new Error("QA dev server did not start");
            await new Promise((resolveWait) => setTimeout(resolveWait, 300));
        }
    }
    browser = await chromium.launch({ headless: true });
    for (const viewport of (recordCheckOnly ? [{ width: 320, height: 740 }] : [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }])) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: "block" });
        const page = await context.newPage();
        page.setDefaultTimeout(60_000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let defense = { formation: [0, 1, 2, 3], deployment: [3, 4, 7, 8], reformAfterClash: null, reforms: [] };
        let releaseSave;
        let savedBody;
        let sealedPets;
        let verdict;
        let challengeBody;
        let rank = 2;
        let challengesLeft = 10;
        let oldOfferRelease;
        let holdOldOffer = false;
        let oldOfferStarted = false;
        const oldOfferGate = new Promise((resolveGate) => { oldOfferRelease = resolveGate; });
        const saveGate = new Promise((resolveGate) => { releaseSave = resolveGate; });
        const summary = ["Cinder Cub", "Ripple Seal", "Tempest Hawk", "Pebble Tortoise"].map((name) => ({ name, element: "Fire", level: 30, rarity: "standard", role: "defender" }));
        await page.route("**/api/pet-ladder**", async (route) => {
            const request = route.request();
            if (request.method() === "POST") {
                const body = request.postDataJSON();
                expect(body.mode).toBe("tactical");
                expect(body.warfrontRules).toBe("beastbound-rite-v1");
                if (body.action === "defense") {
                    savedBody = body;
                    await saveGate;
                    defense = body.warfrontPlan;
                    const owned = JSON.parse(await page.locator("#qa-pets").textContent());
                    sealedPets = body.petIds.map((id) => snapshotLadderPet(owned.find((pet) => pet.id === id)));
                    await route.fulfill({ json: { ok: true, defense: sealedPets.map(petLite), warfrontPlan: defense } });
                } else if (body.action === "offer") {
                    if (holdOldOffer && body.name === "Warfront QA") { oldOfferStarted = true; await oldOfferGate; }
                    await route.fulfill({ json: { offer: [{ kind: "player", id: "rival", name: "Rival Commander", rank: 1, summary }] } });
                } else if (body.action === "challenge") {
                    challengeBody = body;
                    expect(body.targetId).toBe("rival");
                    const blue = { slug: "warfront-qa", name: body.name, mode: "tactical", pets: sealedPets, roles: ladderRoles(sealedPets), warfrontPlan: defense, updatedAt: 1 };
                    const enemyPets = sealedPets.map((pet, index) => ({ ...pet, id: `rival-${index}`, hp: Math.round(pet.hp * 0.7), attack: Math.round(pet.attack * 0.7) }));
                    const red = { ...blue, slug: "rival", name: "Rival Commander", pets: enemyPets, roles: ladderRoles(enemyPets), warfrontPlan: { ...defense, deployment: [8, 5, 0, 3] } };
                    verdict = resolveLadderWarfront(blue, red, 1297);
                    const won = verdict.winner === "blue";
                    rank = won ? 1 : 2;
                    challengesLeft -= 1;
                    await route.fulfill({ json: { won, mode: "tactical", targetId: "rival", rank, challengesLeft, replay: {
                        kind: "warfront", seed: 1297,
                        blue: blue.pets.map((pet, i) => ({ pet, role: blue.roles[i] })),
                        red: red.pets.map((pet, i) => ({ pet, role: red.roles[i] })),
                        bluePlan: verdict.bluePlan, redPlan: verdict.redPlan,
                    } } });
                } else throw new Error(`Unexpected QA mutation: ${body.action}`);
            } else {
                const secondAccount = new URL(request.url()).searchParams.get("name") === "Second QA";
                const ownRecord = secondAccount ? { wins: 13, losses: 7, defended: 5, defeated: 2 } : { wins: verdict?.winner === "blue" ? 1 : 0, losses: verdict?.winner === "red" ? 1 : 0, defended: 0, defeated: 0 };
                const rivalRow = { rank: rank === 1 && !secondAccount ? 2 : 1, slug: "rival", name: "Rival Commander", record: { wins: 8, losses: 2, defended: 4, defeated: 1 }, summary };
                const ownRow = { rank, slug: "warfront-qa", name: "Warfront QA", record: ownRecord, summary };
                await route.fulfill({ json: {
                    mode: "tactical", total: 2,
                    ladder: secondAccount ? [rivalRow] : [ownRow, rivalRow].sort((left, right) => left.rank - right.rank),
                    you: { rank: secondAccount ? 1001 : rank, record: ownRecord, hasDefense: true, defense: summary, defensePetIds: ["qa-0", "qa-1", "qa-2", "qa-3"], challengesLeft: secondAccount ? 10 : challengesLeft, band: 10, warfrontPlan: secondAccount ? { ...defense, deployment: [3, 4, 7, 8] } : defense },
                    notifications: [],
                } });
            }
        });
        await page.goto(`${url}/warfront-ladder-qa.html?district=1&petQuality=low`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        const card = page.getByRole("button", { name: /Beastbound Warfront 4v4 offline ranked ladder/ });
        await expect(card).toBeVisible();
        await card.click();
        await expect(page.locator(".pl-tab.is-active")).toContainText("Beastbound Warfront");
        const board = page.getByRole("group", { name: "Warfront starting positions" });
        const picker = page.getByRole("group", { name: "Pet to position" });
        const challenge = page.getByRole("button", { name: "Challenge for rank" });
        const save = page.getByRole("button", { name: "Update defense (4/4)", exact: true });
        await expect(board.getByRole("button")).toHaveCount(10);
        const heroBadge = await page.locator(".pl-hero-badge").boundingBox();
        const heroTitle = await page.locator(".pl-hero-title").boundingBox();
        expect(heroBadge.y + heroBadge.height).toBeLessThanOrEqual(heroTitle.y);
        await expect(challenge).toBeEnabled();
        await expect(page.locator(".pl-row.is-you")).toContainText("Warfront QA");
        await picker.getByRole("button").nth(2).click();
        await board.getByRole("button", { name: /^Back file 1, empty$/ }).click();
        await expect(board.getByRole("button", { name: /^Back file 1, / })).toHaveAttribute("aria-pressed", "true");
        await expect(challenge).toBeDisabled();
        await picker.getByRole("button").nth(0).click();
        await board.getByRole("button", { name: /^Back file 1, / }).click();
        await expect(board.getByRole("button", { name: /^Front file 2, / })).toContainText("3.");
        await expect(board.getByRole("button", { name: /^Back file 1, / })).toContainText("1.");
        await board.scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, `formation-${viewport.width}.png`), fullPage: true });
        await page.locator(".pl-setup").screenshot({ path: resolve(output, `formation-detail-${viewport.width}.png`) });
        await page.locator(".pl-hero").screenshot({ path: resolve(output, `hero-${viewport.width}.png`) });
        await save.click();
        await expect(save).toBeDisabled();
        await expect(board.getByRole("button").first()).toBeDisabled();
        await expect(picker.getByRole("button").first()).toBeDisabled();
        await expect(challenge).toBeDisabled();
        releaseSave();
        await expect(challenge).toBeEnabled();
        expect(savedBody.warfrontPlan.deployment).toEqual([0, 4, 3, 8]);
        expect(savedBody.warfrontRules).toBe("beastbound-rite-v1");
        process.stdout.write(`${viewport.width}px: district navigation and saved formation passed.\n`);
        const petCards = page.locator(".pl-pet-grid .pl-pet");
        await petCards.nth(3).click();
        await expect(page.getByRole("button", { name: "Update defense (3/4)", exact: true })).toBeDisabled();
        await expect(challenge).toBeDisabled();
        await petCards.nth(3).click();
        const ladderOverflow = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
        expect(ladderOverflow.width).toBeLessThanOrEqual(ladderOverflow.viewport + 1);
        if (viewport.width !== 320) {
            let workersCreated = 0;
            page.on("worker", () => { workersCreated += 1; });
            await challenge.click();
            await page.getByRole("button", { name: /^Rival Commander/ }).click();
            await expect(page.getByTestId("wfr-stage-curtain")).toHaveAttribute("data-stage-ready", "true", { timeout: 60_000 });
            // The production replay is a fullscreen portal; drive this external
            // fixture control directly to mimic a background account refresh.
            await page.getByRole("button", { name: "Rerender QA account" }).evaluate((button) => button.click());
            await expect(page.getByRole("heading", { name: /The Rite is (yours|lost)/ })).toBeVisible({ timeout: 150_000 });
            await expect(page.getByRole("heading", { name: verdict.winner === "blue" ? "The Rite is yours" : "The Rite is lost", exact: true })).toBeVisible();
            await expect(page.locator(".wfr-result-line")).toContainText(`Clashes ${verdict.blueRounds}–${verdict.redRounds}`);
            await expect(page.locator(".wfr-recap li")).toHaveCount(verdict.clashes.length);
            expect(workersCreated).toBe(1);
            await expect.poll(() => page.workers().length).toBe(0);
            await page.screenshot({ path: resolve(output, `ranked-result-${viewport.width}.png`), fullPage: true });
            await page.getByRole("button", { name: "Leave the Warfront", exact: true }).click();
            await expect(page.locator(".pl-rank-num")).toHaveText(`#${rank}`);
            await expect(page.locator(".pl-charges-n")).toContainText("9");
            await expect(page.locator(".pl-outcome")).toContainText(verdict.winner === "blue" ? "Victory!" : "Defeated.");
            await expect(page.locator("canvas")).toHaveCount(0);
            expect(challengeBody.name).toBe("Warfront QA");
            process.stdout.write(`${viewport.width}px: complete ranked replay agrees with server score; exit restored rank and released canvas/worker.\n`);
        }
        // Delay a response across an account switch without unmounting PetLadder
        // in the harness. No offer, draft positions, or result may cross accounts.
        holdOldOffer = true;
        await challenge.click();
        await expect.poll(() => oldOfferStarted).toBe(true);
        await page.getByRole("button", { name: "Switch QA account" }).click();
        await expect(page.locator(".pl-rank-num")).toHaveText("#1001");
        await expect(page.locator(".pl-stat-n").first()).toHaveText("13");
        await expect(page.locator(".pl-outcome")).toHaveCount(0);
        const oldResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.request().postDataJSON()?.action === "offer");
        oldOfferRelease();
        await (await oldResponse).finished();
        await page.evaluate(() => new Promise((resolveFrames) => requestAnimationFrame(() => requestAnimationFrame(resolveFrames))));
        await expect(challenge).toBeEnabled();
        await expect(page.getByText("Choose your opponent", { exact: true })).toHaveCount(0);
        await expect(board.getByRole("button", { name: /^Back file 1, empty$/ })).toBeVisible();
        await page.getByRole("button", { name: "← Arena District", exact: true }).click();
        await expect(card).toBeVisible();
        await card.scrollIntoViewIfNeeded();
        const districtOverflow = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
        expect(districtOverflow.width).toBeLessThanOrEqual(districtOverflow.viewport + 1);
        await page.screenshot({ path: resolve(output, `district-${viewport.width}.png`), fullPage: true });
        expect(errors).toEqual([]);
        checks.push({ viewport, ladderOverflow, districtOverflow, heroBadge, heroTitle, deployment: savedBody.warfrontPlan.deployment,
            rankedReplay: verdict ? { winner: verdict.winner, blueRounds: verdict.blueRounds, redRounds: verdict.redRounds, rank, challengesLeft, workersCreated: 1 } : "covered at desktop and phone widths",
            accountIsolation: true, districtNavigation: true, errors });
        await context.close();
    }
    await writeFile(resolve(output, recordCheckOnly ? "record-checks.json" : "checks.json"), JSON.stringify(checks, null, 2));
    process.stdout.write(`${JSON.stringify(checks, null, 2)}\nScreenshots: ${output}\n`);
} catch (error) {
    for (const context of browser?.contexts() ?? []) {
        for (const page of context.pages()) {
            await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true, timeout: 5_000 }).catch(() => undefined);
            await writeFile(resolve(output, "failure.html"), await page.content().catch(() => "Page content unavailable"));
        }
    }
    throw error;
} finally {
    await browser?.close();
    server?.kill();
}
