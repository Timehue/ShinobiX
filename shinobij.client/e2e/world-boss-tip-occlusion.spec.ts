import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";
import { returnToWorldAtlas } from "./helpers/sector-navigation";

/*
 * ScreenHint's "? Tip" pill is a body portal at z 8500. Every BattleTowerFight
 * is a tactical CombatInstance, also portaled to <body>. The roaming world
 * boss opens straight over the World Map, which owns a tip, and on a phone the
 * pill then landed on the raid's own header. Where exactly depends on which
 * rule placed it:
 *
 *  - World Map placement (html.wm-zoom with the atlas mounted): the pill stays
 *    aligned with the atlas top bar underneath, which at 390x844 put it over
 *    the turn-order row just below Leave.
 *  - Combat placement (body:has(> .combat-instance) > .screen-hint-banner),
 *    which decides whenever the World Map placement does not apply: no atlas
 *    under the fight, or the per-device worldMapZoom.v1 opt-out. Its top-right
 *    corner is free in the PvP/Solo dossier layout, but the tactical status
 *    bar ends there in Leave, so the pill sat squarely on the exit.
 *
 * Both map-zoom settings run, so both placements are covered whichever view
 * the raid opens from.
 *
 * This measures PAINT, not taps. The pill's wrapper is pointer-events:none, so
 * a hit test looks straight through it and passes while the pill covers the
 * button (see academy-coach-occlusion.spec.ts). What is asserted is that no
 * visible tip box overlaps the exit control or the turn order.
 *
 * Both 390x844 projects run it: the overlap is a phone layout bug, and the
 * stand-down rule leans on :has(), whose support differs between engines.
 */
const PHONE_PROJECTS = new Set(["chromium-mobile", "webkit-mobile"]);
const MAP_ZOOM_SETTINGS = [
    { name: "map zoom on", mapZoomOptOut: false },
    { name: "map zoom opted out", mapZoomOptOut: true },
] as const;

const BOSS_SECTOR = 40;
const RUN_ID = "e2e-world-boss-run";
const TIP = "body > .screen-hint-worldMap";

function stats(value: number) {
    return {
        strength: value, speed: value, intelligence: value, willpower: value,
        ninjutsuOffense: value, ninjutsuDefense: value,
        taijutsuOffense: value, taijutsuDefense: value,
        bukijutsuOffense: value, bukijutsuDefense: value,
        genjutsuOffense: value, genjutsuDefense: value,
    };
}

function actor(id: string, side: "squad" | "enemy", name: string, pos: number, hp: number, ownerSlug: string | null) {
    return {
        id, side, name, ownerSlug, ai: side !== "squad",
        hp, maxHp: hp,
        chakra: 900, maxChakra: 900, stamina: 900, maxStamina: 900,
        shield: 0, statuses: [], cooldowns: {}, pos,
        character: { name, level: side === "squad" ? 85 : 80, specialty: "Ninjutsu", stats: stats(side === "squad" ? 90 : 120), jutsu: [] },
    };
}

/** The shape api/world-boss-event/_encounter.ts seals: the world-boss floor's
 * 20x14 major arena, one squad member, the boss and its two guards, and the
 * squad member's turn open. */
function worldBossSession() {
    const width = 20;
    const tile = (column: number, row: number) => row * width + column;
    return {
        towerId: "world-boss-event",
        runId: RUN_ID,
        floor: 9_800,
        seed: 1,
        partySize: 1,
        map: { width, height: 14, biome: "forest", blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [
            actor("sq-0", "squad", "AuditNinja", tile(3, 7), 9_000, "auditninja"),
            actor("boss", "enemy", "Chicxulub", tile(16, 7), 15_000, null),
            actor("add-0", "enemy", "Grunt Brute", tile(14, 5), 2_000, null),
            actor("add-1", "enemy", "Grunt Brute", tile(14, 9), 2_000, null),
        ],
        turnQueue: ["sq-0", "boss", "add-0", "add-1"],
        activeIndex: 0,
        round: 1,
        activeAp: 100,
        actionsThisTurn: 0,
        objectiveState: { kind: "defeat-boss", completed: false, failed: false },
        phaseState: { bossId: "boss", pendingPhases: [75, 50, 25], triggeredPhases: [] },
        status: "active",
        winner: null,
        log: ["The World Boss raid begins."],
        roundCap: 20,
        turnStartedAt: Date.now(),
        actionVersion: 1,
        worldBossEvent: { eventId: "e2e-world-boss", matchId: "e2e-world-boss-match", matchHpAtStart: 15_000 },
        encounterFloor: { id: 9_800, name: "Chicxulub: Raid", objective: "defeat-boss", roundBudget: 18 },
    };
}

function worldBossState(session: ReturnType<typeof worldBossSession>) {
    const now = Date.now();
    return {
        event: {
            eventId: "e2e-world-boss",
            bossId: "hollow-beast",
            bossName: "Chicxulub",
            status: "roaming",
            startedAt: now - 60_000,
            roamEndsAt: now + 3_600_000,
            endsAt: now + 7_200_000,
            endedAt: null,
            spawnSector: BOSS_SECTOR,
            targetVillage: null,
            targetSector: null,
            destinationReached: false,
            hp: 900_000,
            hpMax: 1_000_000,
            currentSector: BOSS_SECTOR,
            nextSector: null,
            nextHopInMs: 600_000,
            movementPaused: true,
            threatenedVillage: null,
            minedCrystalNodeIds: [],
            crystalNodesMined: 0,
            crystalNodeCount: 0,
            hollowShardsDeposited: 0,
            topCachesPending: false,
            retreatPenaltyUntil: 0,
            active: true,
            participantCount: 1,
        },
        queue: {
            waitingCount: 0,
            queued: false,
            match: { matchId: "e2e-world-boss-match", status: "active", runId: RUN_ID, session },
        },
        serverNow: now,
    };
}

function json(route: Route, body: unknown) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

/** Stand in the boss's sector, with the World Map tip not yet dismissed. */
async function bootAtBossSector(page: Page, mapZoomOptOut: boolean) {
    if (mapZoomOptOut) await page.addInitScript(() => localStorage.setItem("worldMapZoom.v1", "0"));
    const save = { ...uiAuditSave(), currentSector: BOSS_SECTOR };
    // A roaming bandit can open its own Fight/Flee modal over the atlas. Pin
    // this sector's wanderer buckets on cooldown, as world-map-mobile does.
    const now = Date.now();
    const bucket = Math.floor(now / (6 * 60 * 60 * 1000));
    const wandererCooldowns: Record<string, number> = {};
    for (const offset of [-1, 0, 1]) {
        for (const index of [0, 1, 2]) wandererCooldowns[`w-${BOSS_SECTOR}-${bucket + offset}-${index}`] = now + 30 * 24 * 60 * 60 * 1000;
    }
    save.character = { ...save.character, wandererCooldowns };

    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem("legacyRumors.seen.v1:auditninja", JSON.stringify([10, 20, 30, 40, 45]));
    });
    // Registered after the shared runtime, so these win for their paths.
    const session = worldBossSession();
    await page.route("**/api/world-boss-event**", (route) => json(route, worldBossState(session)));
    await page.route("**/api/towers/**", (route) => json(route, { session }));

    await page.goto("/#/worldMap", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "worldMap", { timeout: 45_000 });
    // Standing in a field sector reopens that sector, or lands on the atlas.
    await expect.poll(async () => await page.locator(".generated-world-map").count() > 0
        || await page.locator(".sector-hud").isVisible(), { timeout: 45_000 }).toBe(true);
}

/** Open the raid the way this build offers it. Today that is the atlas marker
 * of the sector you stand in. Once the boss stands inside its sector, the
 * marker only enters the sector and the boss itself opens the queue. Either
 * way the queue sees the active match and drops straight into the fight. */
async function enterRaid(page: Page) {
    const combat = page.locator("body > .combat-instance");
    const standee = page.getByRole("button", { name: /^Chicxulub, world boss\. .*Open the team queue$/ });
    if (await page.locator(".generated-world-map").count() === 0) {
        // Booted into the sector view. The standee mounts once the boss poll
        // answers; without one, the way in is the atlas.
        if (await standee.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
            await standee.click();
            return;
        }
        await returnToWorldAtlas(page);
    }
    await page.getByRole("button", { name: /, world boss event$/ }).click();
    await expect(combat.or(standee).first()).toBeVisible();
    if (!await combat.isVisible()) await standee.click();
}

/** Is a visible tip box painted over this control's box? */
async function tipOverlap(control: Locator): Promise<{ obstructed: boolean; detail: string }> {
    return control.evaluate((element, selector) => {
        const tip = document.querySelector<HTMLElement>(selector);
        if (!tip) return { obstructed: false, detail: "no tip mounted" };
        const painted = (node: HTMLElement) => {
            const style = getComputedStyle(node);
            return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
        };
        const trigger = tip.querySelector<HTMLElement>(".screen-hint-battle-trigger");
        const visible = painted(tip) && (!trigger || painted(trigger));
        const box = element.getBoundingClientRect();
        const pill = (trigger ?? tip).getBoundingClientRect();
        const overlaps = pill.width > 0 && pill.height > 0
            && box.left < pill.right && pill.left < box.right
            && box.top < pill.bottom && pill.top < box.bottom;
        return {
            obstructed: visible && overlaps,
            detail: `control ${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`
                + ` vs tip ${Math.round(pill.left)},${Math.round(pill.top)} ${Math.round(pill.width)}x${Math.round(pill.height)}`
                + ` (painted=${visible})`,
        };
    }, TIP);
}

for (const setting of MAP_ZOOM_SETTINGS) {
test(`the World Map tip stands down for the world boss raid (${setting.name})`, async ({ page }, testInfo) => {
    test.skip(!PHONE_PROJECTS.has(testInfo.project.name), "the overlap is a 390x844 phone layout bug");
    test.setTimeout(120_000);
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await bootAtBossSector(page, setting.mapZoomOptOut);
    // Pin the setting, or one case silently becomes the other.
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("wm-zoom")))
        .toBe(!setting.mapZoomOptOut);

    // The fixture only means something if the tip is actually up.
    const tip = page.locator(TIP);
    await expect(tip).toBeVisible();
    await expect(tip.getByRole("button", { name: "Review World Map tip" })).toBeVisible();

    await enterRaid(page);

    const combat = page.locator("body > .combat-instance.shinobi-combat-shell--tactical");
    await expect(combat).toBeVisible();
    const leave = combat.getByRole("button", { name: "Leave battle view" });
    await expect(leave).toBeVisible();
    await expect(leave).toBeInViewport();
    const turnOrder = combat.getByRole("list", { name: "Remaining turn order" });
    await expect(turnOrder).toBeVisible();

    for (const [control, label] of [[leave, "the raid's Leave button"], [turnOrder, "the raid's turn order"]] as const) {
        const { obstructed, detail } = await tipOverlap(control);
        expect(obstructed, `the World Map tip is painted over ${label} — ${detail}`).toBe(false);
    }
    // The tip belongs to the map underneath, so it is out of the way for the
    // whole fight rather than parked somewhere else on the board.
    await expect(tip).toBeHidden();
    await testInfo.attach("world-boss-raid-phone", { body: await page.screenshot(), contentType: "image/png" });

    // Leaving the raid view keeps the run; the queue dialog comes back.
    await leave.click();
    const confirm = page.getByRole("alertdialog", { name: "Confirm" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(combat).toHaveCount(0);
    const queue = page.getByRole("dialog", { name: "Chicxulub" });
    await expect(queue).toBeVisible();
    await expect(tip).toBeHidden();
    await queue.getByRole("button", { name: "Close team queue" }).click();
    await expect(queue).toHaveCount(0);

    // ...and the tip returns with the map, or the player loses it for good.
    await expect(tip).toBeVisible();
    expect(runtimeErrors).toEqual([]);
});
}
