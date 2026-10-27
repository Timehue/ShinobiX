import { expect, test, type Route } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";
import { CHRONICLE_FIXED_FALLBACK_DECK, createMatch, projectMatchForViewer } from "../../shared/chronicle-duel";
import type { KeeperPathRecord, KeeperRun } from "../../shared/keeper-path-contract";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const opponent = (name: string) => ({ key: "ai:easy", name, title: "Keeper of the Path", deckName: "Founding Deck", difficulty: "easy" as const });
function freshRun(): KeeperRun {
  return {
    runId: "run-e2e", seed: 7, position: null, current: null, resolve: 2, boons: {}, boonOffer: null, status: "active",
    deck: [], wins: 1, battleProofs: [], startedAt: 1,
    nodes: [
      { id: "a0r0n0", act: 0, row: 0, index: 0, kind: "fight", opponent: opponent("Tovin"), links: ["a0r1n0", "a0r1n1"] },
      { id: "a0r1n0", act: 0, row: 1, index: 0, kind: "shrine", links: ["a0boss"] },
      { id: "a0r1n1", act: 0, row: 1, index: 1, kind: "elite", opponent: opponent("Ansel"), links: ["a0boss"] },
      { id: "a0boss", act: 0, row: 3, index: 0, kind: "boss", opponent: opponent("Sela"), links: [] },
    ],
  };
}

test("Keeper's Path opens in the Play tab, offers boons at a Shrine and asks the server for its duel", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const save = uiAuditSave();
  save.character = { ...save.character, starterCardsClaimed: true, cardClashTutorialVersion: 999 };
  const runtime = await installUiAuditRuntime(page, save);

  let run: KeeperRun = { ...freshRun(), position: "a0r0n0" };
  const keeperBodies: Array<Record<string, unknown>> = [];
  const startBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/card-clash/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    if (path === "/api/card-clash/sync-progression") return json(route, { granted: [], character: save.character, _saveVersion: runtime.currentVersion() });
    if (path === "/api/card-clash/keeper-run") {
      keeperBodies.push(body);
      if (body.action === "choose-node" && body.nodeId === "a0r1n0") run = { ...run, position: "a0r1n0", boonOffer: ["reserve", "insight", "pressure"] };
      if (body.action === "choose-boon") run = { ...run, boonOffer: null, boons: { [String(body.boonId)]: 1 } };
      if (body.action === "choose-node" && body.nodeId === "a0boss") run = { ...run, current: "a0boss" };
      return json(route, { ok: true, keeperPath: { clears: 0, best: 1, run } });
    }
    if (path === "/api/card-clash/ai-start") {
      startBodies.push(body);
      return json(route, { ok: false, error: "The Keeper is not seated in this audit." }, 409);
    }
    return json(route, { ok: false, error: "Unexpected Keeper's Path audit route." }, 404);
  });

  await expectUiAuditBoot(page, runtime, "shinobiTiles");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const entrance = page.getByRole("region", { name: "Keeper's Path", exact: true });
  await expect(entrance.getByRole("heading", { name: "Keeper's Path" })).toBeVisible();
  await expect(entrance.getByText("60 Chronicle Points")).toBeVisible();
  const artwork = entrance.getByRole("img");
  await expect(artwork).toBeVisible();
  await expect.poll(() => artwork.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await artwork.evaluate((img: HTMLImageElement) => img.decode());
  const showdown = page.getByRole("button", { name: "Start Showdown vs AI" });
  const showdownPanel = showdown.locator("..");
  const entranceBounds = await entrance.boundingBox();
  const showdownBounds = await showdownPanel.boundingBox();
  expect(entranceBounds!.y).toBeGreaterThanOrEqual(showdownBounds!.y + showdownBounds!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // Browsing the entrance must not start or mutate a run.
  expect(keeperBodies).toEqual([]);
  await entrance.screenshot({ path: testInfo.outputPath("keeper-path-entrance.png") });
  await entrance.getByRole("button", { name: "Walk the Keeper's Path" }).click();
  const path = page.getByRole("region", { name: "Keeper's Path", exact: true });
  await expect(path.getByText("Resolve 2 / 2")).toBeVisible();
  await expect(path.getByRole("heading", { name: "Keeper's Path" })).toBeFocused();
  await expect(path.getByRole("button", { name: /Elite duel Ansel/ })).toBeEnabled();
  await expect(path.getByRole("button", { name: /Keeper Sela/ })).toBeDisabled();

  await path.getByRole("button", { name: /Shrine/ }).click();
  const offer = path.getByRole("group", { name: "Choose a boon" });
  await expect(offer.getByRole("button")).toHaveCount(3);
  await offer.getByRole("button", { name: /Deep Reserve/ }).click();
  await expect(path.getByText(/Deep Reserve/)).toBeVisible();

  await path.getByRole("button", { name: /Keeper Sela/ }).click();
  await expect.poll(() => startBodies.length).toBe(1);
  expect(startBodies[0].keeperRun).toBe(true);
  expect(startBodies[0]).not.toHaveProperty("echoes");
  // Only ids leave the browser: no node, opponent or boon details.
  for (const body of keeperBodies) expect(Object.keys(body).sort()).toEqual(expect.arrayContaining(["action", "playerName"]));
  expect(keeperBodies.find((body) => body.action === "choose-boon")?.boonId).toBe("reserve");
  expect(pageErrors).toEqual([]);
});

test("Keeper's Path refuses a stale character receipt before entering a duel and can refresh safely", async ({ page }) => {
  const save = uiAuditSave();
  save.character = { ...save.character, starterCardsClaimed: true, cardClashTutorialVersion: 999,
    tileCards: [...CHRONICLE_FIXED_FALLBACK_DECK], cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK] };
  const runtime = await installUiAuditRuntime(page, save);
  let record: KeeperPathRecord = { clears: 0, best: 0, run: null };
  let committedVersion = 0;
  let aiStarts = 0;
  await page.route("**/api/card-clash/**", async route => {
    const url = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (url.endsWith("/sync-progression")) return json(route, { granted: [], character: runtime.serverSave().character, _saveVersion: runtime.currentVersion() });
    if (url.endsWith("/keeper-run")) {
      if (body.action === "start") {
        record = { ...record, run: freshRun() };
        committedVersion = runtime.currentVersion() + 2;
        const character = { ...runtime.serverSave().character, keeperPath: record };
        runtime.commitServerCharacter(character, committedVersion);
        return json(route, { ok: true, keeperPath: record, character, _saveVersion: committedVersion });
      }
      if (body.action === "choose-node") {
        const staleRecord = { ...record, run: { ...record.run!, current: String(body.nodeId) } };
        return json(route, { ok: true, keeperPath: staleRecord,
          character: { ...runtime.serverSave().character, ryo: 0, keeperPath: staleRecord }, _saveVersion: committedVersion - 1 });
      }
      return json(route, { ok: true, keeperPath: record });
    }
    if (url.endsWith("/ai-start")) aiStarts += 1;
    return json(route, { error: "A stale receipt must never open a duel." }, 409);
  });
  await expectUiAuditBoot(page, runtime, "shinobiTiles");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Walk the Keeper's Path" }).click();
  const path = page.getByRole("region", { name: "Keeper's Path", exact: true });
  await path.getByRole("button", { name: "Begin a new run" }).click();
  await expect(path.getByText("Resolve 2 / 2")).toBeVisible();
  await path.getByRole("button", { name: /Duel Tovin/ }).click();
  await expect(path.getByRole("alert")).toContainText("Your character changed");
  expect(aiStarts).toBe(0);
  await path.getByRole("button", { name: "Refresh path" }).click();
  await expect(path.getByRole("alert")).toHaveCount(0);
  await expect(path.getByRole("button", { name: /Duel Tovin/ })).toBeEnabled();
  expect(runtime.serverSave().character?.ryo).toBe(save.character.ryo);
});

test("Keeper's Path retries a failed load, seals the deck, returns from a settled duel and resumes from the Hall", async ({ page }) => {
  const save = uiAuditSave();
  save.character = { ...save.character, starterCardsClaimed: true, cardClashTutorialVersion: 999,
    tileCards: [...CHRONICLE_FIXED_FALLBACK_DECK], cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK] };
  const runtime = await installUiAuditRuntime(page, save);
  let record: KeeperPathRecord = { clears: 0, best: 0, run: null };
  const actions: string[] = [];
  const starts: Array<Record<string, unknown>> = [];
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const mutation = (route: Route, extra: Record<string, unknown> = {}) => {
    const version = runtime.currentVersion() + 1;
    const character = { ...runtime.serverSave().character, keeperPath: record };
    runtime.commitServerCharacter(character, version);
    return json(route, { ok: true, keeperPath: record, character, _saveVersion: version, ...extra });
  };
  await page.route("**/api/card-clash/**", async route => {
    const url = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (url.endsWith("/sync-progression")) return json(route, { granted: [], character: runtime.serverSave().character, _saveVersion: runtime.currentVersion() });
    if (url.endsWith("/keeper-run")) {
      actions.push(String(body.action));
      if (actions.length === 1) return json(route, { error: "The path is temporarily unavailable." }, 503);
      if (body.action === "start") {
        expect(body.deck).toEqual(CHRONICLE_FIXED_FALLBACK_DECK);
        record = { ...record, run: { ...freshRun(), wins: 0, deck: [...CHRONICLE_FIXED_FALLBACK_DECK] } };
        return mutation(route);
      }
      if (body.action === "choose-node") {
        record = { ...record, run: { ...record.run!, current: String(body.nodeId) } };
        return mutation(route);
      }
      return json(route, { ok: true, keeperPath: record });
    }
    if (url.endsWith("/ai-start")) {
      starts.push(body);
      record = { ...record, run: { ...record.run!, current: null, position: "a0r0n0", wins: 1 } };
      const match = createMatch("AuditNinja", CHRONICLE_FIXED_FALLBACK_DECK, "Tovin", CHRONICLE_FIXED_FALLBACK_DECK, () => 0);
      match.status = "complete";
      match.winner = "p1";
      return mutation(route, { matchId: "keeper-roundtrip", session: { ...projectMatchForViewer(match, "p1"),
        matchId: "keeper-roundtrip", aiDifficulty: "easy", aiDeckName: "Founding Deck" },
        reward: { result: "player", ryo: 0, dailyBonus: false, keeperPath: { result: "win", finished: false, chroniclePoints: 0 } } });
    }
    return json(route, { error: "Unexpected round-trip route." }, 404);
  });
  await expectUiAuditBoot(page, runtime, "shinobiTiles");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const enter = page.getByRole("button", { name: "Walk the Keeper's Path" });
  await enter.click();
  const path = page.getByRole("region", { name: "Keeper's Path", exact: true });
  await expect(path.getByRole("alert")).toContainText("temporarily unavailable");
  await path.getByRole("button", { name: "Refresh path" }).click();
  await expect(path.getByRole("alert")).toHaveCount(0);
  await path.getByRole("button", { name: "Begin a new run" }).click();
  await expect(path.getByText("Resolve 2 / 2")).toBeVisible();
  await path.getByRole("button", { name: /Duel Tovin/ }).click();
  await expect(page.getByRole("heading", { name: "Victory", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to the path" }).click();
  await expect(path.getByText(/duels won 1/)).toBeVisible();
  await expect(path.getByRole("heading", { name: "Keeper's Path" })).toBeFocused();
  // Character commits rerender CardHall; they must not trigger background state requests.
  expect(actions).toEqual(["state", "state", "start", "choose-node", "state"]);
  expect(starts).toHaveLength(1);
  expect(starts[0].keeperRun).toBe(true);
  await path.getByRole("button", { name: "Back to the Hall" }).click();
  await expect(enter).toBeFocused();
  await enter.press("Enter");
  await expect(path.getByText(/duels won 1/)).toBeVisible();
  await expect(path.getByRole("button", { name: "Begin a new run" })).toHaveCount(0);
  expect(actions.filter(action => action === "start")).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});
