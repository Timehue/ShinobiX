import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
import {
  expectUiAuditBoot,
  installUiAuditRuntime,
  type UiAuditSave,
  uiAuditSave,
} from "./helpers/ui-audit-runtime";

const ACTIVE_PROJECTS = new Set(["chromium-desktop", "chromium-mobile"]);

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function ageOneSave(options: { ayaPostSeen: boolean; witnessChoice?: string }): UiAuditSave {
  const save = uiAuditSave();
  save.character = {
    ...save.character,
    starterCardsClaimed: true,
    cardClashTutorialVersion: 999,
    chroniclePoints: 240,
    echoesOfWar: {
      "echoes-1-tovin": { wins: 1, firstClearAt: 101 },
      "echoes-2-vetta": { wins: 1, firstClearAt: 102 },
      "echoes-3-aya": {
        wins: 1,
        firstClearAt: 103,
        firstClearBattleBeat: "recovered-ground",
      },
    },
    echoesStorySeen: {
      "era:echoes-age-1": { pre: true },
      "echoes-1-tovin": { pre: true, post: true },
      "echoes-2-vetta": { pre: true, post: true },
      "echoes-3-aya": {
        pre: true,
        ...(options.ayaPostSeen ? { post: true } : {}),
      },
    },
    ...(options.witnessChoice
      ? { echoesWitnessChoices: { "echoes-age-1": options.witnessChoice } }
      : {}),
  };
  return save;
}

type EchoesAuthorityOptions = {
  failFirstWitnessAfterSeal?: boolean;
};

async function installEchoesAuthority(
  page: Page,
  initialSave: UiAuditSave,
  options: EchoesAuthorityOptions = {},
) {
  const runtime = await installUiAuditRuntime(page, initialSave);
  let save = structuredClone(initialSave);
  let version = 40;
  let witnessAttempts = 0;
  let showdownStarts = 0;
  const witnessBodies: Array<Record<string, unknown>> = [];

  // These narrow routes sit in front of the shared UI-audit fallback so this
  // spec can model the two server-owned Echoes mutations across a real reload.
  await page.route("**/api/save/**", async (route) => {
    const path = new URL(route.request().url()).pathname.toLowerCase();
    if (path !== "/api/save/auditninja") return route.fallback();
    if (route.request().method() === "GET") {
      return json(route, { ...save, _saveVersion: version });
    }

    const incoming = route.request().postDataJSON() as UiAuditSave & { _baseSaveVersion?: unknown };
    const baseVersion = Number(incoming._baseSaveVersion);
    if (!Number.isSafeInteger(baseVersion) || baseVersion !== version) {
      return json(route, { error: "Save conflict", currentVersion: version }, 409);
    }

    const persisted = { ...incoming };
    delete persisted._baseSaveVersion;
    delete persisted._saveVersion;
    delete persisted._saveAt;
    const authoritativeChoices = (save.character?.echoesWitnessChoices ?? {}) as Record<string, unknown>;
    save = {
      ...persisted,
      character: {
        ...(persisted.character ?? {}),
        ...(Object.keys(authoritativeChoices).length > 0
          ? { echoesWitnessChoices: authoritativeChoices }
          : {}),
      },
    };
    version += 1;
    return json(route, { ok: true, _saveVersion: version });
  });

  await page.route("**/api/card-clash/echoes-witness", async (route) => {
    witnessAttempts += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    witnessBodies.push(body);
    const character = (save.character ?? {}) as Record<string, unknown>;
    const currentChoices = (character.echoesWitnessChoices ?? {}) as Record<string, string>;
    const requestedChoice = String(body.choiceId ?? "");
    const sealedChoice = currentChoices["echoes-age-1"] ?? requestedChoice;
    const alreadySealed = Boolean(currentChoices["echoes-age-1"]);

    if (!alreadySealed) {
      save = {
        ...save,
        character: {
          ...character,
          echoesWitnessChoices: {
            ...currentChoices,
            "echoes-age-1": sealedChoice,
          },
        },
      };
      version += 1;
    }

    if (options.failFirstWitnessAfterSeal && witnessAttempts === 1) {
      return json(route, { error: "The connection closed after the entry was sealed." }, 503);
    }

    const choices = ((save.character ?? {}) as Record<string, unknown>)
      .echoesWitnessChoices as Record<string, string>;
    return json(route, {
      ok: true,
      eraId: "echoes-age-1",
      choiceId: choices["echoes-age-1"],
      choices,
      alreadySealed,
      character: save.character,
      _saveVersion: version,
    });
  });

  await page.route("**/api/card-clash/ai-start", async (route) => {
    showdownStarts += 1;
    return json(route, { error: "This test does not start a Showdown." }, 409);
  });

  return {
    runtime,
    witnessAttempts: () => witnessAttempts,
    witnessBodies: () => witnessBodies,
    showdownStarts: () => showdownStarts,
    serverSave: () => save,
  };
}

async function openAgeOne(page: Page) {
  await page.getByRole("button", { name: /^Age I\b/ }).click();
  await expect(page.getByRole("heading", { name: "The Unheard" })).toBeVisible();
}

async function expectHeadingInView(page: Page, heading: Locator) {
  await expect(heading).toBeVisible();
  const [box, viewport, visibleInsets] = await Promise.all([
    heading.boundingBox(),
    Promise.resolve(page.viewportSize()),
    page.evaluate(() => {
      const hud = document.querySelector<HTMLElement>(".mobile-top-hud");
      const content = document.querySelector<HTMLElement>("main.center-game");
      return {
        contentTop: content?.getBoundingClientRect().top ?? 0,
        hudBottom: hud && getComputedStyle(hud).display !== "none" ? hud.getBoundingClientRect().bottom : 0,
      };
    }),
  ]);
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(Math.max(0, visibleInsets.contentTop, visibleInsets.hudBottom));
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

async function visualNovelState(page: Page): Promise<string> {
  const cinematic = page.locator(".cvn-root");
  if (await cinematic.count()) {
    return cinematic.evaluate((root) => JSON.stringify({
      progress: root.querySelector(".cvn-progress")?.getAttribute("aria-label") ?? "",
      spoken: root.querySelector(".cvn-sr-only")?.textContent ?? "",
      displayed: root.querySelector(".cvn-dialogue-text")?.textContent ?? "",
      conclusion: root.querySelector(".vn-conclusion-text")?.textContent ?? "",
      typing: Boolean(root.querySelector(".cvn-tap-hint")),
      controls: Array.from(root.querySelectorAll("button")).map((button) => button.textContent?.trim() ?? ""),
    }));
  }
  const classic = page.locator(".visual-novel.admin-vn-play");
  if (await classic.count()) {
    return classic.evaluate((root) => JSON.stringify({
      progress: root.querySelector(".vn-progress")?.textContent ?? "",
      spoken: root.querySelector(".vn-dialogue > p")?.textContent ?? "",
      conclusion: root.querySelector(".vn-conclusion-text")?.textContent ?? "",
      controls: Array.from(root.querySelectorAll("button")).map((button) => button.textContent?.trim() ?? ""),
    }));
  }
  return "closed";
}

async function finishVisualNovel(page: Page) {
  // The reactive victory has nine lines across four pages. A slow reader needs
  // one reveal and one advance per line, then one reveal and one Continue for
  // the completion panel: 20 authored actions. Four slots cover entering this
  // helper before the two setup clicks have both committed. No slot can hide a
  // no-op because every action below must change reader state.
  for (let step = 0; step < 24; step += 1) {
    await expect.poll(async () => {
      if (await visualNovelState(page) === "closed") return true;
      return await page.locator(".cvn-tap-hint").isVisible().catch(() => false)
        || await page.getByRole("button", { name: "Next", exact: true }).isVisible().catch(() => false)
        || await page.getByRole("button", { name: "Continue", exact: true }).isVisible().catch(() => false);
    }).toBe(true);
    if (await visualNovelState(page) === "closed") return;
    const tapHint = page.locator(".cvn-tap-hint");
    if (await tapHint.isVisible().catch(() => false)) {
      await page.locator(".cvn-dialogue-shell").click();
      await expect(tapHint).toBeHidden();
      // The cinematic reader deliberately ignores a second advance for 240ms
      // after revealing a line, so wait for that guard before reading controls.
      await page.waitForTimeout(250);
      continue;
    }
    const next = page.getByRole("button", { name: "Next", exact: true });
    if (await next.isVisible().catch(() => false)) {
      const before = await visualNovelState(page);
      await next.click();
      await expect.poll(() => visualNovelState(page)).not.toBe(before);
      continue;
    }
    const continueButton = page.getByRole("button", { name: "Continue", exact: true });
    if (await continueButton.isVisible().catch(() => false)) {
      const before = await visualNovelState(page);
      await continueButton.click();
      await expect.poll(() => visualNovelState(page)).not.toBe(before);
      continue;
    }
    throw new Error("Echoes conclusion had no forward visual-novel control.");
  }
  if (await visualNovelState(page) === "closed") return;
  throw new Error("Echoes conclusion did not finish within its authored page budget.");
}

test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(!ACTIVE_PROJECTS.has(testInfo.project.name), "bounded to Chromium desktop and mobile");
});

test("a failed witness response retries to the first server-sealed answer and survives review and reload", async ({ page }, testInfo) => {
  const authority = await installEchoesAuthority(
    page,
    ageOneSave({ ayaPostSeen: true }),
    { failFirstWitnessAfterSeal: true },
  );
  await expectUiAuditBoot(page, authority.runtime, "echoesOfWar");
  await openAgeOne(page);

  await page.getByRole("button", { name: "Record This Age", exact: true }).click();
  await expectHeadingInView(page, page.getByRole("heading", { name: "The First Record" }));
  await expectViewportSafe(page);

  await page.getByRole("button", { name: /Record the warnings/ }).click();
  await expect(page.getByRole("alert")).toHaveText("The connection closed after the entry was sealed.");
  await expect(page.getByRole("button", { name: /Keep their names first/ })).toBeEnabled();

  // The player may reasonably try another answer after an uncertain response.
  // The server must return the first sealed answer instead of replacing it.
  await page.getByRole("button", { name: /Keep their names first/ }).click();
  await expectHeadingInView(page, page.getByRole("heading", { name: "Record sealed" }));
  await expect(page.getByText("Sealed entry · Record the warnings", { exact: true })).toBeVisible();
  await expect(page.getByText(/The record begins with the cut rope/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Keep their names first/ })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("witness-sealed.png"),
    fullPage: true,
  });
  expect(authority.witnessAttempts()).toBe(2);
  expect(authority.witnessBodies().map((body) => body.choiceId)).toEqual([
    "warnings-first",
    "names-first",
  ]);

  await page.locator(".echoes-witness-shell .back-btn").click();
  await page.getByRole("button", { name: "Review Witness Record", exact: true }).click();
  await expect(page.getByText("Sealed entry · Record the warnings", { exact: true })).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "echoesOfWar");
  await openAgeOne(page);
  await page.getByRole("button", { name: "Review Witness Record", exact: true }).click();
  await expect(page.getByText("Sealed entry · Record the warnings", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Leave the cause open/ })).toHaveCount(0);
});

test("Replay Memory recovers a missing first-clear conclusion with its sealed battle callback", async ({ page }) => {
  const authority = await installEchoesAuthority(
    page,
    ageOneSave({ ayaPostSeen: false }),
  );
  await expectUiAuditBoot(page, authority.runtime, "echoesOfWar");
  await openAgeOne(page);

  const aya = page.locator(".echoes-node").filter({ hasText: "Aya, The Courier" });
  await aya.getByRole("button", { name: "Rematch / Story", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aya, The Courier" })).toBeVisible();
  await page.getByRole("button", { name: "Replay Memory", exact: true }).click();

  await expect(page.getByText("Good. That is the table he never had to face.", { exact: true })).toBeVisible();
  expect(authority.showdownStarts()).toBe(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/You took the hit and your line came back/)).toBeVisible();
  expect(authority.showdownStarts()).toBe(0);

  await finishVisualNovel(page);
  await expect(page.getByRole("heading", { name: "The First Record" })).toBeVisible();
  await expect.poll(() => {
    const character = authority.serverSave().character as Record<string, unknown> | undefined;
    const seen = character?.echoesStorySeen as Record<string, { post?: boolean }> | undefined;
    return seen?.["echoes-3-aya"]?.post;
  }).toBe(true);

  await page.locator(".echoes-witness-shell .back-btn").click();
  await expect(page.getByRole("button", { name: "Replay Conclusion", exact: true })).toBeVisible();
  expect(authority.showdownStarts()).toBe(0);
});
