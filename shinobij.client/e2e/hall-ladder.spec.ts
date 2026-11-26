import { expect, test, type Page, type Route } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function openTower(page: Page, cleared: number, seenFloor?: number) {
  const save = uiAuditSave();
  save.character = { ...save.character, starterCardsClaimed: true, cardClashTutorialVersion: 999, hallLadder: { cleared } };
  const runtime = await installUiAuditRuntime(page, save);
  if (seenFloor !== undefined) {
    const name = String(save.character.name).trim().toLowerCase();
    await page.addInitScript(([key, floor]) => { if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, floor); }, [`hallLadder.seenFloor.v1:${name}`, String(seenFloor)]);
  }
  const startBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/card-clash/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    if (path === "/api/card-clash/sync-progression") return json(route, { granted: [], character: save.character, _saveVersion: runtime.currentVersion() });
    if (path === "/api/card-clash/keeper-run") return json(route, { ok: true, keeperPath: { clears: 0, best: 0, run: null } });
    if (path === "/api/card-clash/ai-start") {
      startBodies.push(body);
      return json(route, { ok: false, error: "The duelist is not seated in this audit." }, 409);
    }
    return json(route, { ok: false, error: "Unexpected Hall Ladder audit route." }, 404);
  });
  await expectUiAuditBoot(page, runtime, "shinobiTiles");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const tower = page.getByRole("region", { name: "The Hall Tower", exact: true });
  await expect.poll(() => tower.locator(".hall-tower__stage").evaluate((el) => {
    const src = getComputedStyle(el).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1];
    if (!src) return 0;
    const img = new Image();
    img.src = src;
    return img.decode().then(() => img.naturalWidth, () => 0);
  })).toBeGreaterThan(0);
  return { tower, startBodies };
}

test("the Hall Tower shows the climb, teaches the duelist's lesson and asks the server for one bout", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Kiri beaten (bouts 1-3) and Tobei's first bout won: Tobei's second is next.
  const { tower, startBodies } = await openTower(page, 4, 1);
  await expect(tower.getByText("Floor 2 of 6.", { exact: false })).toBeVisible();
  await expect(tower.getByRole("button", { name: /^Floor 1, Kiri, The Hall Apprentice: beaten/ })).toBeVisible();
  await expect(tower.getByRole("button", { name: /^Floor 2, Tobei, The Scroll Keeper: 1 of 3 bouts won/ })).toHaveAttribute("aria-pressed", "true");
  // Floors above stand empty: no duelist is named or shown before it is reached.
  await expect(tower.getByRole("button", { name: /Suzume/ })).toHaveCount(0);
  await expect(tower.getByText("Tobei's lesson: Summoning and Tributes")).toBeVisible();
  // Unwon bouts say what their first win pays; a won one does not.
  await expect(tower.getByText("Bout 2: Medium · first win 10 Chronicle Points")).toBeVisible();
  await expect(tower.getByText("Bout 3: Medium, +2,000 Health · first win 30 Chronicle Points")).toBeVisible();
  await expect(tower.getByText("Bout 1: Easy (won)")).toBeVisible();
  // Each duelist stands on their own floor, inside the painting, one above the other.
  const art = (await tower.locator(".hall-tower").boundingBox())!;
  const kiri = (await tower.getByRole("button", { name: /^Floor 1, Kiri/ }).boundingBox())!;
  const tobei = (await tower.getByRole("button", { name: /^Floor 2, Tobei/ }).boundingBox())!;
  expect(tobei.y + tobei.height).toBeLessThan(kiri.y + kiri.height);
  for (const figure of [kiri, tobei]) {
    expect(figure.y).toBeGreaterThanOrEqual(art.y);
    expect(figure.y + figure.height).toBeLessThanOrEqual(art.y + art.height);
    expect(figure.height).toBeLessThan(art.height * 0.15);
  }

  const portrait = tower.getByRole("img", { name: "Tobei, The Scroll Keeper" });
  await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // Every portrait on the tower has painted before the capture.
  await expect.poll(() => tower.locator("img").evaluateAll((imgs) =>
    Promise.all((imgs as HTMLImageElement[]).map((img) => img.decode().then(() => img.naturalWidth > 0, () => false)))
      .then((loaded) => loaded.every(Boolean)))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await tower.screenshot({ path: testInfo.outputPath("hall-tower.png") });

  await tower.getByRole("button", { name: "Fight Tobei: Bout 2" }).click();
  await expect.poll(() => startBodies.length).toBe(1);
  // Only the bout index leaves the browser: the server picks duelist, deck and difficulty.
  expect(startBodies[0].hallLadder).toEqual({ bout: 4 });
  expect(startBodies[0]).not.toHaveProperty("echoes");
  expect(startBodies[0]).not.toHaveProperty("keeperRun");
  await expect(page.getByText("The duelist is not seated in this audit.")).toBeVisible();

  // A beaten floor offers a rematch of each won bout.
  await tower.getByRole("button", { name: /^Floor 1, Kiri/ }).click();
  await expect(tower.getByRole("button", { name: "Rematch" })).toHaveCount(3);
  await expect(tower.getByText("Kiri's lesson: Your turn")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("reaching a new floor climbs to it and says so", async ({ page }, testInfo) => {
  // Last seen on floor 1; Kiri is now beaten, so the climb to floor 2 plays.
  const { tower } = await openTower(page, 3, 0);
  await expect(tower.getByRole("status")).toHaveText("Floor 2 reached. Tobei is waiting.");
  await expect(tower.getByRole("button", { name: /^Floor 2, Tobei, The Scroll Keeper: 0 of 3 bouts won/ })).toHaveAttribute("aria-pressed", "true");
  await expect(tower.getByRole("button", { name: "Fight Tobei: Bout 1" })).toBeEnabled();
  await tower.screenshot({ path: testInfo.outputPath("hall-tower-arrival.png") });
  // The climb is remembered: coming back to Play does not run it again.
  await page.getByRole("button", { name: "Collection", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("region", { name: "The Hall Tower", exact: true }).getByRole("status")).toHaveCount(0);
});

test("a cleared tower shows every duelist on their own floor, with room between them", async ({ page }, testInfo) => {
  const { tower } = await openTower(page, 18, 5);
  await expect(tower.getByText("You stand at the top of the Hall Tower.", { exact: false })).toBeVisible();
  await expect(tower.getByRole("button", { name: /^Fight / })).toHaveCount(0);
  const names = ["Kiri", "Tobei", "Suzume", "Gensai", "Ayame", "Kurogane"];
  for (const [floor, name] of names.entries()) {
    await expect(tower.getByRole("button", { name: new RegExp(`^Floor ${floor + 1}, ${name}, .*: beaten`) })).toBeAttached();
  }
  await expect.poll(() => tower.locator(".hall-tower img").evaluateAll((imgs) =>
    Promise.all((imgs as HTMLImageElement[]).map((img) => img.decode().then(() => img.naturalWidth > 0, () => false)))
      .then((loaded) => loaded.every(Boolean)))).toBe(true);
  // Each figure's head stays well below the feet of the duelist one storey up.
  const boxes = await tower.locator(".hall-tower__floor img").evaluateAll((imgs) =>
    imgs.map((img) => { const r = img.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; }));
  for (let floor = 0; floor + 1 < boxes.length; floor++) {
    expect(boxes[floor].top - boxes[floor + 1].bottom).toBeGreaterThan(boxes[floor].height * 0.5);
  }
  await tower.screenshot({ path: testInfo.outputPath("hall-tower-cleared.png") });
  // Every duelist teaches a lesson read from the Card Clash tutorial pages.
  const lessons = ["Your turn", "Summoning and Tributes", "Elements", "Set Monsters and FLIP", "Snares", "Calls and Warded Monsters"];
  for (const [floor, name] of names.entries()) {
    await tower.getByRole("button", { name: `Look at floor ${floor + 1}: ${name}` }).click();
    await expect(tower.getByText(`${name}'s lesson: ${lessons[floor]}`)).toBeVisible();
    const text = await tower.locator(".hall-ladder__lesson p").innerText();
    expect(text.length).toBeGreaterThan(60);
    expect(text).not.toContain("undefined");
  }
});
