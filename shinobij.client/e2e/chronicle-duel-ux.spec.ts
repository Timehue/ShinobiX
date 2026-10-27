import { expect, test, type Page, type Route } from "@playwright/test";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
import {
  expectUiAuditBoot,
  installUiAuditRuntime,
  uiAuditSave,
} from "./helpers/ui-audit-runtime";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type DuelLayout = {
  viewport: { width: number; height: number };
  document: { width: number; height: number; scrollWidth: number; scrollHeight: number };
  table: Rect;
  playmat: Rect;
  console: Rect;
  hand: Rect;
  dock: Rect;
  firstAction: Rect;
  firstHandCard: Rect;
  firstZone: Rect;
  roomBanner: Rect;
  roomAction: Rect;
  diagnostics: Record<string, unknown>;
};

async function measureDuel(page: Page): Promise<DuelLayout> {
  return page.locator(".chronicle-table").evaluate((table) => {
    const required = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing duel surface: ${selector}`);
      return element;
    };
    const rect = (element: Element): Rect => {
      const value = element.getBoundingClientRect();
      return {
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        left: value.left,
        width: value.width,
        height: value.height,
      };
    };
    const shell = required(".chronicle-shell--duel-active");
    const center = required(".center-game");
    const tableStyle = getComputedStyle(table);
    const shellStyle = getComputedStyle(shell);
    const centerStyle = getComputedStyle(center);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      table: rect(table),
      playmat: rect(required(".chronicle-playmat")),
      console: rect(required(".chronicle-player-console")),
      hand: rect(required(".chronicle-hand")),
      dock: rect(required(".chronicle-command-dock")),
      firstAction: rect(required(".chronicle-command-dock button")),
      firstHandCard: rect(required(".chronicle-hand .chronicle-card")),
      firstZone: rect(required(".chronicle-playmat .chronicle-zone")),
      roomBanner: rect(required(".chronicle-room-banner")),
      roomAction: rect(required(".chronicle-room-banner__actions button")),
      diagnostics: {
        shellRect: rect(shell),
        centerRect: rect(center),
        tableHeight: tableStyle.height,
        tableMinHeight: tableStyle.minHeight,
        tableMaxHeight: tableStyle.maxHeight,
        tableGridRows: tableStyle.gridTemplateRows,
        shellHeight: shellStyle.height,
        shellPadding: shellStyle.padding,
        shellDisplay: shellStyle.display,
        centerHeight: centerStyle.height,
        centerPadding: centerStyle.padding,
        centerOverflow: centerStyle.overflow,
      },
    };
  });
}

function expectContained(rect: Rect, viewport: { width: number; height: number }, label: string) {
  expect(rect.left, `${label} starts outside the viewport`).toBeGreaterThanOrEqual(-1);
  expect(rect.top, `${label} starts above the viewport`).toBeGreaterThanOrEqual(-1);
  expect(rect.right, `${label} ends outside the viewport`).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.bottom, `${label} ends below the viewport`).toBeLessThanOrEqual(viewport.height + 1);
}

test("Card Hall AI showdown stays wired and comfortably sized across the device matrix", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const save = uiAuditSave();
  save.character = {
    ...save.character,
    starterCardsClaimed: true,
    cardClashTutorialVersion: 999,
  };
  const runtime = await installUiAuditRuntime(page, save);

  const matchId = "chronicle-layout-audit";
  let projection = {
    rulesVersion: 10,
    turnNumber: 1,
    firstPlayer: "p1",
    activePlayer: "p1",
    phase: "main1",
    normalSummonUsed: false,
    status: "active",
    winner: null,
    viewerSide: "p1",
    activeField: null,
    responseWindow: null,
    p1: {
      name: "AuditNinja",
      lifePoints: 8_000,
      deckCount: 34,
      handCount: 6,
      hand: ["tc-01", "tc-02", "tc-02", "tc-03", "tc-04", "tc-05"],
      monsterZones: [null, null, null, null, null],
      magicTrapZones: [null, null, null, null, null],
      graveyard: [],
    },
    p2: {
      name: "The Veiled Keeper",
      lifePoints: 8_000,
      deckCount: 35,
      handCount: 5,
      monsterZones: [null, null, null, null, null],
      magicTrapZones: [null, null, null, null, null],
      graveyard: [],
    },
    log: [
      "AuditNinja and The Veiled Keeper draw five cards.",
      "AuditNinja takes the first turn and enters Main Phase 1.",
    ],
    events: [],
    turnStartedAt: 1_800_000,
  };
  const startBodies: Array<Record<string, unknown>> = [];
  const moveBodies: Array<Record<string, unknown>> = [];
  const session = () => ({
    ...projection,
    matchId,
    aiDifficulty: "medium" as const,
    aiDeckName: "Veiled Keeper Founding Deck",
  });

  await page.route("**/api/card-clash/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/card-clash/sync-progression") {
      return json(route, {
        granted: [],
        character: save.character,
        _saveVersion: runtime.currentVersion(),
      });
    }
    if (path === "/api/card-clash/ai-start") {
      startBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { ok: true, matchId, session: session() });
    }
    if (path === "/api/card-clash/ai-move") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      moveBodies.push(body);
      if (body.action === "enter-end-phase") {
        projection = { ...projection, phase: "end" };
      }
      return json(route, { ok: true, matchId, session: session() });
    }
    return json(route, { ok: false, error: "Unexpected Chronicle audit route." }, 404);
  });

  await expectUiAuditBoot(page, runtime, "shinobiTiles");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Start Showdown vs AI" }).click();

  const shell = page.locator(".chronicle-shell--duel-active");
  await expect(shell).toBeVisible();
  await expect(page.locator(".chronicle-table")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "End turn" })).toBeEnabled();
  expect(startBodies).toHaveLength(1);
  expect(startBodies[0]?.playerName).toBe("AuditNinja");
  expect(startBodies[0]?.difficulty).toBe("medium");
  expect(startBodies[0]?.deck).toEqual(expect.any(Array));
  expect((startBodies[0]?.deck as unknown[]).length).toBe(40);

  const matrix = [
    { width: 1366, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 375, height: 667 },
    { width: 412, height: 915 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 915, height: 412 },
  ];
  for (const viewport of matrix) {
    await page.setViewportSize(viewport);
    // Measure the SETTLED layout: every bound below runs inside the retry, not
    // once after it. Firefox/WebKit can expose the new viewport, and pass the
    // viewport-safety check, a frame before the table and hand finish
    // reflowing. Measured once, that read a 712px table at 1366x768 and 52.93px
    // hand cards at 390x844 (settled: 57.23px). It hit about 1 run in 3 on
    // Firefox with reduced motion. Each bound must still hold for the final,
    // settled layout.
    await expect(async () => {
      await expectViewportSafe(page, {
        horizontalScrollers: [".chronicle-hand"],
        overlays: [".chronicle-card-detail-panel"],
      });
      const layout = await measureDuel(page);
      expect(layout.document.scrollWidth).toBeLessThanOrEqual(layout.document.width + 1);
      expect(layout.document.scrollHeight).toBeLessThanOrEqual(layout.document.height + 1);
      expect(layout.table.height, JSON.stringify(layout.diagnostics, null, 2))
        .toBeGreaterThanOrEqual(viewport.height - 10);
      const phone = viewport.width <= 900 || (viewport.height <= 500 && viewport.width <= 960);
      if (!phone) {
        expectContained(layout.table, viewport, "duel table");
        expectContained(layout.playmat, viewport, "playmat");
        expectContained(layout.console, viewport, "player console");
        expectContained(layout.firstAction, viewport, "first command");
      }
      expectContained(layout.roomAction, viewport, "return-to-hall action");
      expect(layout.roomAction.top, "return-to-hall action starts above its banner")
        .toBeGreaterThanOrEqual(layout.roomBanner.top - 1);
      expect(layout.roomAction.bottom, "return-to-hall action ends below its banner")
        .toBeLessThanOrEqual(layout.roomBanner.bottom + 1);

      const compact = phone;
      expect(
        layout.firstHandCard.width,
        `${viewport.width}x${viewport.height} hand-card width`,
      ).toBeGreaterThanOrEqual(compact ? 88 : 62);
      expect(
        layout.firstZone.width,
        `${viewport.width}x${viewport.height} field-zone width`,
      ).toBeGreaterThanOrEqual(compact ? 44 : 60);
      expect(layout.firstAction.height).toBeGreaterThanOrEqual(compact ? 44 : 30);
      expect(layout.roomAction.height).toBeGreaterThanOrEqual(compact ? 44 : 22);
      expect(layout.hand.height).toBeGreaterThan(layout.firstHandCard.height * 0.8);
      expect(layout.dock.left).toBeLessThanOrEqual(layout.firstAction.left + 1);
    }).toPass({ timeout: 10_000 });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const firstCard = page.locator(".chronicle-hand .chronicle-card").first();
  await firstCard.click();
  await expect(firstCard).toHaveAttribute("aria-pressed", "true");
  await firstCard.click();
  await expect(page.getByRole("dialog", { name: "Training Dummy card details" })).toBeVisible();
  await page.getByRole("button", { name: "Close card details" }).click();

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "End turn" }).click();
  await expect(page.locator(".chronicle-phase-rail [aria-current='step']")).toContainText("End");
  expect(moveBodies.at(-1)).toMatchObject({ matchId, action: "enter-end-phase" });
  expect(pageErrors).toEqual([]);
});

/* The layout matrix above only ever sees Main Phase 1. The three surfaces a
   duel actually turns on were never measured: the Snare response dock, attack
   targeting with its battle preview, and the result. */
for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test(`Snare response, battle preview and result stay usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    const save = uiAuditSave();
    save.character = { ...save.character, starterCardsClaimed: true, cardClashTutorialVersion: 999 };
    const runtime = await installUiAuditRuntime(page, save);

    const matchId = "chronicle-turning-points";
    const monster = (owner: "p1" | "p2", cardId: string, attack: number, defense: number, level: number, canAttack = false) => ({
      instanceId: `${owner}-${cardId}`, owner, zoneIndex: 0, position: "attack", faceUp: true,
      cardId, attack, defense, level,
      ...(owner === "p1" ? { canAttack, canFlipSummon: false, canChangePosition: false, canTribute: true } : {}),
    });
    const side = (name: string, monsters: unknown[], extra: Record<string, unknown> = {}) => ({
      name, lifePoints: 8_000, deckCount: 30, handCount: 2,
      monsterZones: [...monsters, null, null, null, null].slice(0, 5),
      magicTrapZones: [null, null, null, null, null], graveyard: [], ...extra,
    });
    const base = {
      rulesVersion: 10, firstPlayer: "p1", normalSummonUsed: true, status: "active", winner: null,
      viewerSide: "p1", activeField: null, events: [], turnStartedAt: Date.now(),
      log: ["The Veiled Keeper declares an attack."],
    };
    // Stage 1: the Keeper attacks and our set Snare may answer.
    let projection: Record<string, unknown> = {
      ...base, turnNumber: 4, activePlayer: "p2", phase: "battle",
      responseWindow: { id: "rw-1", trigger: "onAttackDeclared", responder: "p1", expiresAt: Date.now() + 120_000, eligibleZoneIndexes: [0] },
      p1: side("AuditNinja", [monster("p1", "tc-03", 2000, 2100, 5)], {
        hand: ["tc-01", "tc-02"],
        magicTrapZones: [{ instanceId: "p1-snare", owner: "p1", zoneIndex: 0, faceUp: false, cardId: "chronicle-smoke-bomb" }, null, null, null, null],
      }),
      p2: side("The Veiled Keeper", [monster("p2", "tc-09", 2600, 2500, 7)]),
    };
    const moves: string[] = [];
    await page.route("**/api/card-clash/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/card-clash/sync-progression") {
        return json(route, { granted: [], character: save.character, _saveVersion: runtime.currentVersion() });
      }
      const session = () => ({ ...projection, matchId, aiDifficulty: "medium", aiDeckName: "Veiled Keeper Founding Deck" });
      if (path === "/api/card-clash/ai-start") return json(route, { ok: true, matchId, session: session() });
      if (path === "/api/card-clash/ai-move") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        moves.push(String(body.action));
        if (body.action === "pass-response") {
          // Stage 2: our turn, Battle Phase, a weaker Monster across the field.
          projection = {
            ...base, turnNumber: 5, activePlayer: "p1", phase: "battle", responseWindow: null,
            log: ["AuditNinja enters the Battle Phase."],
            p1: side("AuditNinja", [monster("p1", "tc-03", 2000, 2100, 5, true)], { hand: ["tc-01", "tc-02"] }),
            p2: side("The Veiled Keeper", [monster("p2", "tc-01", 300, 800, 1)]),
          };
        } else if (body.action === "attack") {
          // Stage 3: the attack ends the duel. With no typed events the board
          // announces the result directly instead of waiting for a finishing
          // effect to play.
          projection = {
            ...(projection as object), status: "complete", winner: "p1", events: undefined,
            p2: { ...(projection.p2 as object), lifePoints: 0, monsterZones: [null, null, null, null, null] },
            log: ["Stone Turtle destroys Training Dummy.", "AuditNinja wins the Showdown."],
          };
        }
        return json(route, { ok: true, matchId, session: session() });
      }
      return json(route, { ok: false, error: "Unexpected Chronicle audit route." }, 404);
    });

    await expectUiAuditBoot(page, runtime, "shinobiTiles");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Start Showdown vs AI" }).click();

    const dock = page.getByRole("group", { name: "Snare response" });
    await expect(dock).toBeVisible({ timeout: 10_000 });
    await expect(dock.getByRole("button", { name: "Activate Smoke Bomb" })).toBeVisible();
    await expect(async () => {
      await expectViewportSafe(page, { horizontalScrollers: [".chronicle-hand"], overlays: [".chronicle-card-detail-panel"] });
      const box = await dock.boundingBox();
      expect(box).not.toBeNull();
      expectContained({ ...box!, top: box!.y, left: box!.x, right: box!.x + box!.width, bottom: box!.y + box!.height }, viewport, "Snare response dock");
    }).toPass({ timeout: 10_000 });
    await dock.getByRole("button", { name: "Pass · Continue" }).click();

    await page.getByRole("button", { name: /Choose attacker in your Monster Zone 1/ }).click();
    const target = page.getByRole("button", { name: /Attack opponent Monster Zone 1: Training Dummy/ });
    await expect(target).toBeVisible();
    const preview = page.locator("#chronicle-target-preview-0");
    await expect(preview).toContainText("BREAK");
    await expect(async () => {
      await expectViewportSafe(page, { horizontalScrollers: [".chronicle-hand"], overlays: [".chronicle-card-detail-panel"] });
      const box = await preview.boundingBox();
      expect(box).not.toBeNull();
      expectContained({ ...box!, top: box!.y, left: box!.x, right: box!.x + box!.width, bottom: box!.y + box!.height }, viewport, "battle preview");
    }).toPass({ timeout: 10_000 });
    await target.click();

    await expect(page.getByRole("heading", { name: "Victory" })).toBeVisible({ timeout: 15_000 });
    expect(moves).toEqual(["pass-response", "attack"]);
    expect(pageErrors).toEqual([]);
  });
}
