import { expect, test, type Page, type Route } from "@playwright/test";
import { PUBLIC_CAPABILITY_IDS } from "../../shared/public-capabilities";
import type { SoloPveActionInput, SoloPveSession } from "../src/lib/solo-pve-api";

type SavePayload = {
    character?: Record<string, unknown>;
    creatorEvents?: unknown[];
    [key: string]: unknown;
};

type PracticeStartPayload = {
    playerName?: string;
    opponentId?: string;
    opponentLevel?: number;
    battleKind?: string;
    resumeWorldFight?: boolean;
    resumeAiFight?: boolean;
};

type SoloActionPayload = SoloPveActionInput & {
    sessionId: string;
    playerName: string;
    expectedVersion: number;
    moveToken: string;
};

const PLAYER_NAME = "ArenaAudit";
const PLAYER_SLUG = "arenaaudit";
const SESSION_ID = "e2e-practice-session";
const PRACTICE_TOKEN = "e2e-practice-token";

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

function practiceSession(version = 1): SoloPveSession {
    const now = Date.now();
    return {
        runtime: "solo-pve",
        schemaVersion: 1,
        sessionId: SESSION_ID,
        ownerSlug: PLAYER_SLUG,
        encounter: {
            kind: "practice",
            id: "builtin-ai-mist-sentinel",
            level: 8,
        },
        player: {
            name: PLAYER_NAME,
            hp: 200,
            maxHp: 200,
            chakra: 100,
            maxChakra: 100,
            stamina: 100,
            maxStamina: 100,
            shield: 0,
            statuses: [],
            pos: 54,
            character: {
                level: 1,
                village: "Stormveil Village",
                visual: "",
                equipment: {},
                pvpItems: [],
                jutsu: [{
                    id: "e2e-water-needle",
                    name: "Water Needle",
                    type: "Ninjutsu",
                    element: "Water",
                    target: "SINGLE_ENEMY",
                    method: "DAMAGE",
                    ap: 35,
                    range: 3,
                    effectPower: 25,
                    cooldown: 0,
                    chakraCost: 5,
                    staminaCost: 0,
                    tags: [],
                }],
            },
        },
        enemy: {
            name: "Mist Sentinel",
            hp: 120,
            maxHp: 120,
            chakra: 80,
            maxChakra: 80,
            stamina: 80,
            maxStamina: 80,
            shield: 0,
            statuses: [],
            pos: 55,
            character: {
                level: 8,
                village: "Mist",
                visual: "builtin-ai-mist-sentinel",
                jutsu: [],
            },
        },
        round: 1,
        activeSide: "player",
        ap: { player: 100, enemy: 100 },
        actionsThisTurn: 0,
        cooldowns: { player: {}, enemy: {} },
        groundEffects: [],
        itemCharges: {},
        itemsUsed: {},
        environment: {
            biome: "central",
            weatherPositiveElement: "Water",
            weatherNegativeElement: "Fire",
            blockedTiles: [],
        },
        status: "active",
        winner: null,
        outcome: null,
        settlementState: "pending",
        log: ["--- Round 1 ---", `${PLAYER_NAME} faces Mist Sentinel.`],
        events: [],
        eventSeq: 0,
        version,
        createdAt: now,
        lastActionAt: now,
        expiresAt: now + 30 * 60_000,
        recentMoveTokens: [],
    };
}

function applyAuthoritativeAction(session: SoloPveSession, payload: SoloActionPayload): SoloPveSession {
    const actionLabel = payload.type === "basicAttack" ? "attacks" : payload.type;
    const enemy = payload.type === "basicAttack"
        ? { ...session.enemy, hp: Math.max(1, session.enemy.hp - 25) }
        : session.enemy;
    return {
        ...session,
        enemy,
        round: session.round + 1,
        actionsThisTurn: 0,
        activeSide: "player",
        ap: { player: 100, enemy: 100 },
        log: [...session.log, `${PLAYER_NAME} ${actionLabel}; the sealed server advances the round.`],
        version: session.version + 1,
        eventSeq: session.eventSeq + 1,
        lastActionAt: Date.now(),
        recentMoveTokens: [...session.recentMoveTokens, payload.moveToken],
    };
}

async function installArenaApi(page: Page, options: {
    holdAndFailFirstPracticeStart?: boolean;
    certifyRankedQueueLifecycle?: boolean;
} = {}) {
    let save: SavePayload | null = null;
    let saveVersion = 0;
    let activeSession: SoloPveSession | null = null;
    let practiceStartCount = 0;
    let genericResumeSuccessCount = 0;
    const practiceStartPayloads: PracticeStartPayload[] = [];
    const actionPayloads: SoloActionPayload[] = [];
    const rankedQueueActions: string[] = [];
    let rankedQueueJoined = false;
    let releaseFirstPracticeStart: (() => void) | null = null;
    let releaseRankedJoin: (() => void) | null = null;
    let releaseRankedPoll: (() => void) | null = null;
    const firstPracticeStartGate = new Promise<void>((resolve) => {
        releaseFirstPracticeStart = resolve;
    });
    const rankedJoinGate = new Promise<void>((resolve) => {
        releaseRankedJoin = resolve;
    });
    const rankedPollGate = new Promise<void>((resolve) => {
        releaseRankedPoll = resolve;
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;

        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        if (path === "/api/player/capabilities") {
            return json(route, {
                ok: true,
                capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
                    id,
                    { state: "available", reason: "available" },
                ])),
            });
        }
        if (path === "/api/player-auth") return json(route, { ok: true, token: "e2e-arena-session-token" });

        if (path.toLowerCase() === "/api/save/arenaaudit") {
            if (url.searchParams.get("ack") === "1") return json(route, { ok: true });
            if (request.method() === "GET") {
                return save ? json(route, { ...save, _saveVersion: saveVersion }) : json(route, { error: "Not found" }, 404);
            }
            if (request.method() === "POST") {
                const incoming = request.postDataJSON() as SavePayload;
                saveVersion += 1;
                save = {
                    ...incoming,
                    creatorEvents: [],
                    triggeredEvents: [],
                    character: {
                        ...(incoming.character ?? {}),
                        onboardingStep: "done",
                        level: 1,
                        ryo: 1_000_000,
                    },
                };
                return json(route, { ok: true, _saveVersion: saveVersion });
            }
        }

        if (path === "/api/missions/ai-fight-start" && request.method() === "POST") {
            const payload = request.postDataJSON() as PracticeStartPayload;
            if (payload.resumeWorldFight) return json(route, { error: "No active World encounter" }, 404);
            if (payload.resumeAiFight) {
                if (!activeSession) return json(route, { error: "No active AI encounter" }, 404);
                genericResumeSuccessCount += 1;
                return json(route, {
                    token: PRACTICE_TOKEN,
                    sessionId: SESSION_ID,
                    session: activeSession,
                    resumed: true,
                    opponentId: "builtin-ai-mist-sentinel",
                    opponentName: "Mist Sentinel",
                    battleKind: "practice",
                });
            }
            if (payload.battleKind === "practice") {
                practiceStartCount += 1;
                practiceStartPayloads.push(payload);
                if (options.holdAndFailFirstPracticeStart && practiceStartCount === 1) {
                    await firstPracticeStartGate;
                    return json(route, { error: "Practice authority temporarily unavailable." }, 503);
                }
                activeSession = practiceSession();
                return json(route, {
                    token: PRACTICE_TOKEN,
                    sessionId: SESSION_ID,
                    session: activeSession,
                    opponentId: "builtin-ai-mist-sentinel",
                    opponentName: "Mist Sentinel",
                    battleKind: "practice",
                });
            }
        }

        if (path === "/api/solo-pve/state" && request.method() === "GET") {
            return activeSession
                ? json(route, { ok: true, session: activeSession })
                : json(route, { error: "Session not found" }, 404);
        }
        if (path === "/api/solo-pve/action" && request.method() === "POST") {
            const payload = request.postDataJSON() as SoloActionPayload;
            actionPayloads.push(payload);
            if (!activeSession || payload.sessionId !== SESSION_ID || payload.playerName !== PLAYER_NAME) {
                return json(route, { error: "Session identity mismatch" }, 404);
            }
            if (payload.expectedVersion !== activeSession.version) {
                return json(route, { applied: false, reason: "stale-version", session: activeSession }, 409);
            }
            activeSession = applyAuthoritativeAction(activeSession, payload);
            return json(route, { applied: true, session: activeSession });
        }

        if (path === "/api/pvp/bounty") return json(route, { ok: true, bounties: [] });
        if (path === "/api/pvp/ranked-queue") {
            if (!options.certifyRankedQueueLifecycle) {
                return json(route, { enabled: false, inQueue: false, queueSize: 0 });
            }
            if (request.method() === "GET") {
                return json(route, { enabled: true, inQueue: rankedQueueJoined, queueSize: rankedQueueJoined ? 1 : 0 });
            }

            const payload = request.postDataJSON() as { action?: string };
            const action = String(payload.action ?? "");
            rankedQueueActions.push(action);
            if (action === "join") {
                await rankedJoinGate;
                rankedQueueJoined = true;
                return json(route, { enabled: true, inQueue: true, queueSize: 1, match: null });
            }
            if (action === "poll") {
                await rankedPollGate;
                return json(route, { enabled: true, inQueue: rankedQueueJoined, queueSize: rankedQueueJoined ? 1 : 0, match: null });
            }
            if (action === "leave") {
                rankedQueueJoined = false;
                return json(route, { enabled: true, inQueue: false, queueSize: 0, match: null });
            }
            return json(route, { error: "Unexpected ranked queue action" }, 400);
        }
        if (path === "/api/battle-lock") return json(route, { ok: true, lock: null });
        if (path === "/api/world-state") return json(route, { territories: [], wars: [], standings: [] });
        if (path === "/api/clan/war/list") return json(route, { wars: [] });
        if (path === "/api/game-state") return json(route, { villageStates: {}, arenaActiveFights: [] });
        if (path === "/api/weekly-boss") return json(route, { boss: null, fightEnabled: true });
        if (path === "/api/ranked-season") return json(route, { current: null, lastSeason: null });
        if (path === "/api/legacy/status") return json(route, { enabled: false });
        if (path === "/api/towers/floors") return json(route, { floors: [] });

        return json(route, {
            ok: true,
            players: [],
            images: {},
            categories: {},
            ladder: [],
            leaderboard: [],
            announcements: [],
            eras: [],
            entries: [],
        });
    });

    return {
        hasSave: () => save !== null,
        practiceStartCount: () => practiceStartCount,
        practiceStartPayloads: () => practiceStartPayloads,
        actionPayloads: () => actionPayloads,
        genericResumeSuccessCount: () => genericResumeSuccessCount,
        releaseFirstPracticeStart: () => releaseFirstPracticeStart?.(),
        rankedQueueActions: () => [...rankedQueueActions],
        releaseRankedJoin: () => releaseRankedJoin?.(),
        releaseRankedPoll: () => releaseRankedPoll?.(),
    };
}

async function createAccount(page: Page) {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByTestId("start-create").click();
    await page.getByRole("button", { name: "Choose Village" }).click();
    await page.locator(".cc-village-card").first().click();
    await page.getByRole("button", { name: "Choose Bloodline" }).click();
    await page.locator(".cc-bloodline-card").first().click();
    await page.getByRole("button", { name: "Choose Avatar" }).click();
    await page.locator(".cc-avatar-card").first().click();
    await page.getByRole("button", { name: "Preview Shinobi" }).click();
    await page.getByRole("button", { name: "Name and Password" }).click();
    await page.getByLabel("Name").fill(PLAYER_NAME);
    await page.locator("#cc-password").fill("Audit!Pass1234");
    await page.locator("#cc-confirm-password").fill("Audit!Pass1234");
    await page.getByRole("button", { name: "Enter the World" }).click();
}

async function restoreVillage(page: Page) {
    await page.goto("/#/village");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Enter Battle Arena" })).toBeVisible();
}

async function openArenaDistrict(page: Page) {
    await page.goto("/#/centralHub");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Arena District/ }).click();
    await expect(page.getByRole("heading", { name: "Arena District" })).toBeVisible();
}

async function openBattleArena(page: Page) {
    await page.getByRole("button", { name: "Enter Battle Arena" }).click();
    await expect(page.getByRole("heading", { name: "Battle Arena" })).toBeVisible();
}

function combatSurface(page: Page) {
    return page.locator(".mission-arena-fight");
}

async function chooseLevelAndStart(page: Page) {
    const spar = page.locator("section.summary-box").filter({
        has: page.getByRole("heading", { name: /Combat Spar — Fight AI/ }),
    });
    await spar.locator('input[type="number"]').fill("8");
    await spar.getByRole("button", { name: "Start AI Battle" }).click();
}

async function assertAuthoritativeCombatSurface(page: Page, compact: boolean) {
    const combat = combatSurface(page);
    await expect(combat).toBeVisible();
    await expect(combat.locator(".hex-battlefield")).toBeVisible();
    await expect(combat.locator(".hex-tile")).toHaveCount(120);
    await expect(combat.getByRole("button", { name: /^Attack/ })).toBeEnabled();
    await expect(combat.getByRole("button", { name: /^Wait/ })).toBeEnabled();
    await expect(combat.getByRole("button", { name: /Water Needle/ })).toBeEnabled();

    const log = combat.getByRole("log", { name: "Battle log" });
    if (compact) {
        const timelineTab = combat.getByRole("tab", { name: /^Timeline/ });
        await timelineTab.focus();
        await page.keyboard.press("Enter");
        await expect(timelineTab).toHaveAttribute("aria-selected", "true");
        await expect(log).toContainText(`${PLAYER_NAME} faces Mist Sentinel.`);

        const actionsTab = combat.getByRole("tab", { name: "Actions" });
        await actionsTab.focus();
        await page.keyboard.press("Enter");
        await expect(actionsTab).toHaveAttribute("aria-selected", "true");
    } else {
        // Wide combat deliberately renders actions and log together. Its compact
        // switch remains in the DOM for responsive continuity but is visually
        // hidden, so keyboard tab semantics are certified in the mobile case.
        await expect(combat.locator(".battle-tabbar")).toBeHidden();
        await expect(log).toContainText(`${PLAYER_NAME} faces Mist Sentinel.`);
    }
}

test("desktop Battle Arena seals practice combat, surfaces retry, acts, and resumes on refresh", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop Arena certification runs once");

    const api = await installArenaApi(page, { holdAndFailFirstPracticeStart: true });
    await createAccount(page);
    await expect.poll(api.hasSave).toBe(true);
    await restoreVillage(page);
    await openBattleArena(page);

    const bountyTab = page.getByRole("button", { name: "Bounty Board" });
    await bountyTab.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Bounty Board/ })).toBeVisible();
    await expect(page.getByText("No active bounties are posted.")).toBeVisible();
    await page.getByRole("button", { name: "Spar & Challenges" }).click();
    await expect(page.getByRole("heading", { name: /Combat Spar — Fight AI/ })).toBeVisible();

    await chooseLevelAndStart(page);
    try {
        await expect.poll(api.practiceStartCount).toBe(1);
        await expect(combatSurface(page)).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Battle Arena" })).toBeVisible();
    } finally {
        api.releaseFirstPracticeStart();
    }

    const failure = page.getByRole("alert");
    await expect(failure.getByRole("heading", { name: "Fight unavailable" })).toBeVisible();
    await expect(failure).toContainText("Practice authority temporarily unavailable.");
    await failure.getByRole("button", { name: "Retry" }).click();

    await assertAuthoritativeCombatSurface(page, false);
    await expect.poll(api.practiceStartCount).toBe(2);
    for (const payload of api.practiceStartPayloads()) {
        expect(payload).toMatchObject({
            playerName: PLAYER_NAME,
            opponentId: "builtin-ai-mist-sentinel",
            opponentLevel: 8,
            battleKind: "practice",
        });
    }

    const attack = combatSurface(page).getByRole("button", { name: /^Attack/ });
    await attack.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => api.actionPayloads().length).toBe(1);
    expect(api.actionPayloads()[0]).toMatchObject({
        sessionId: SESSION_ID,
        playerName: PLAYER_NAME,
        expectedVersion: 1,
        type: "basicAttack",
    });
    await expect(combatSurface(page).getByRole("log", { name: "Battle log" })).toContainText("the sealed server advances the round");

    const startsBeforeReload = api.practiceStartCount();
    await page.reload({ waitUntil: "networkidle" });
    await assertAuthoritativeCombatSurface(page, false);
    await expect.poll(api.genericResumeSuccessCount).toBeGreaterThanOrEqual(1);
    expect(api.practiceStartCount()).toBe(startsBeforeReload);
});

test("Arena District serializes ranked join, poll, and leave on desktop and mobile", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const isDesktop = testInfo.project.name === "chromium-desktop";
    const isMobile = testInfo.project.name === "chromium-mobile";
    test.skip(!isDesktop && !isMobile, "ranked lifecycle runs at the canonical desktop and mobile viewports");

    const api = await installArenaApi(page, { certifyRankedQueueLifecycle: true });
    await createAccount(page);
    await expect.poll(api.hasSave).toBe(true);
    await openArenaDistrict(page);

    const queueUp = page.getByRole("button", { name: "Queue Up for Ranked" });
    await expect(queueUp).toBeEnabled();
    await expect(page.getByText("Players in queue:")).toContainText("0");
    if (isDesktop) {
        await queueUp.focus();
        await page.keyboard.press("Enter");
    } else {
        await queueUp.click();
    }

    await expect.poll(() => api.rankedQueueActions()).toEqual(["join"]);
    await expect(page.getByText("Searching for opponent...")).toBeVisible();
    const leave = page.getByRole("button", { name: "Leave Queue" });
    await expect(leave).toBeEnabled();

    // Joining is optimistic in the UI, but polling must not begin until the
    // server confirms this exact owner/generation as queued.
    expect(api.rankedQueueActions()).toEqual(["join"]);
    api.releaseRankedJoin();
    await expect.poll(() => api.rankedQueueActions()).toEqual(["join", "poll"]);
    await expect(page.getByText("Players in queue:")).toContainText("1");

    if (isDesktop) {
        await leave.focus();
        await page.keyboard.press("Enter");
    } else {
        await leave.click();
    }
    await expect(queueUp).toBeEnabled();
    await expect(page.getByText("Searching for opponent...")).toHaveCount(0);

    // Leave retires the UI immediately, while its server cleanup remains
    // serialized behind the already-issued poll.
    await page.waitForTimeout(150);
    expect(api.rankedQueueActions()).toEqual(["join", "poll"]);
    api.releaseRankedPoll();
    await expect.poll(() => api.rankedQueueActions()).toEqual(["join", "poll", "leave"]);
});

test("mobile Battle Arena exposes the same sealed board, commands, and timeline", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "chromium-mobile", "one canonical mobile viewport is sufficient");

    const api = await installArenaApi(page);
    await createAccount(page);
    await expect.poll(api.hasSave).toBe(true);
    await restoreVillage(page);
    await openBattleArena(page);
    await chooseLevelAndStart(page);

    await assertAuthoritativeCombatSurface(page, true);
    await expect.poll(api.practiceStartCount).toBe(1);
    expect(api.practiceStartPayloads()[0]).toMatchObject({
        playerName: PLAYER_NAME,
        opponentId: "builtin-ai-mist-sentinel",
        opponentLevel: 8,
        battleKind: "practice",
    });
});
