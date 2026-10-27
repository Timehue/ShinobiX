import { expect, test, type Route } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const opponent = (name: string) => ({ key: "ai:easy", name, title: "Keeper of the Path", deckName: "Founding Deck", difficulty: "easy" });
function freshRun() {
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

test("Keeper's Path opens in the Play tab, offers boons at a Shrine and asks the server for its duel", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const save = uiAuditSave();
  save.character = { ...save.character, starterCardsClaimed: true, cardClashTutorialVersion: 999 };
  const runtime = await installUiAuditRuntime(page, save);

  let run = { ...freshRun(), position: "a0r0n0" } as ReturnType<typeof freshRun> & { position: string | null; current: string | null; boonOffer: string[] | null; boons: Record<string, number> };
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
  await page.getByRole("button", { name: "Walk the Keeper's Path" }).click();
  const path = page.getByRole("region", { name: "Keeper's Path" });
  await expect(path.getByText("Resolve 2 / 2")).toBeVisible();
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
