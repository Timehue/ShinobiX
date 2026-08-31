import { expect, test, type Page, type Route } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

/*
 * The defender half of an open-world sector raid, in a real browser.
 *
 * This is the half nothing covered. The 2026-08-30 audit found no test anywhere
 * — unit or e2e — that exercised a sector attack reaching its target, which is
 * exactly why a real bug survived in it: the heartbeat was paused on a hidden
 * tab while the socket kept presence fresh, so a backgrounded defender stayed
 * visible and attackable but never drained `pendingChallenges`. The attacker got
 * a session that could neither pay out nor be forfeited.
 *
 * The contract pinned here is the one that failure broke:
 *   the heartbeat delivers a sectorAttack challenge carrying a battleId
 *     → the client routes ITSELF into that battle as p2 (no accept prompt —
 *       a raid is not consensual)
 *     → and sends the `join` handshake, which is what makes the fight
 *       rewardable at all (`pvpSessionMayReward` needs joined.p1 && joined.p2).
 *
 * Stubbed at the network edge like the rest of e2e/: the server side of this
 * flow is proven separately against the real handlers in
 * api/player/world-sector-raid.integration.test.ts.
 */

// The character installUiAuditRuntime boots. The challenge is routed by
// toName === the live character's name, so this must be that name, not ours.
const PLAYER = "AuditNinja";
const RAIDER = "RivalNinja";
const BATTLE_ID = "sectorraid000000000000001";

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function fighter(name: string, pos: number) {
    return {
        name,
        hp: 500, maxHp: 500,
        chakra: 500, maxChakra: 500,
        stamina: 500, maxStamina: 500,
        shield: 0,
        pos,
        character: { name, level: 30, village: "Stormveil Village" },
        statuses: [],
    };
}

function liveSession() {
    return {
        battleId: BATTLE_ID,
        stateRevision: 1,
        p1: fighter(RAIDER, 10),
        p2: fighter(PLAYER, 30),
        round: 1,
        activePlayer: "p1",
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        status: "active",
        winner: null,
        joined: { p1: true },
        createdAt: Date.now(),
    };
}

/** The challenge api/player/challenge.ts delivers for a sector raid. */
function sectorAttackChallenge() {
    return {
        id: "chal-sector-raid-1",
        fromName: RAIDER,
        toName: PLAYER,
        challenger: { name: RAIDER, level: 30, village: "Stormveil Village" },
        createdAt: Date.now(),
        mode: "standard",
        sectorAttack: true,
        battleId: BATTLE_ID,
    };
}

type Harness = { joinCalls: () => string[]; deliverAttack: () => void; beats: () => number };

/**
 * Layered ON TOP of installUiAuditRuntime, which already boots the app into an
 * authenticated, capability-answered state. Playwright gives the most recently
 * registered route precedence, so this one wins for the three paths the raid
 * needs and hands everything else back with route.fallback().
 */
async function installRaidDelivery(page: Page): Promise<Harness> {
    let attackIncoming = false;
    let challengeDelivered = false;
    const joinCalls: string[] = [];
    let beats = 0;

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;

        if (path === "/api/player/heartbeat") {
            beats += 1;
            // One-shot delivery, exactly as api/player/heartbeat.ts behaves: it
            // reads the challenge inbox and clears it in the same beat.
            const deliver = attackIncoming && !challengeDelivered;
            if (deliver) challengeDelivered = true;
            return json(route, {
                sectorMates: [],
                allPlayers: [],
                pendingChallenges: deliver ? [sectorAttackChallenge()] : [],
                pendingAttacker: null,
                serverNow: Date.now(),
                sector: 12,
                traveling: false,
            });
        }

        if (path === "/api/pvp/session") return json(route, liveSession());

        if (path === "/api/pvp/move") {
            const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
            if (body.action === "join") joinCalls.push(String(body.role));
            return json(route, { ...liveSession(), joined: { p1: true, p2: true } });
        }

        return route.fallback();
    });

    return {
        joinCalls: () => [...joinCalls],
        deliverAttack: () => { attackIncoming = true; },
        beats: () => beats,
    };
}

test("an incoming sector raid pulls the defender into the battle and joins it", async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(test.info().project.name !== "chromium-desktop",
        "one deterministic Chromium pass is enough — this pins client routing, not layout");

    const runtime = await installUiAuditRuntime(page);
    const harness = await installRaidDelivery(page);
    await expectUiAuditBoot(page, runtime, "worldMap");

    // Actually beating before anything is thrown at us. If THIS is what fails,
    // the challenge never had a carrier and every assertion below is noise.
    await expect.poll(harness.beats, { timeout: 60_000 }).toBeGreaterThan(0);

    harness.deliverAttack();

    // 1. The raid must route the defender itself. A sector attack is NOT
    //    consensual: there is no accept prompt to click, and a client that waits
    //    for one leaves the attacker in a battle that can never resolve.
    await expect.poll(
        () => page.locator(".app-shell").getAttribute("data-screen"),
        { timeout: 60_000 },
    ).toBe("pvpBattle");

    // 2. The join handshake is what makes the fight rewardable at all — without
    //    it the server refuses both the payout and the AFK forfeit.
    await expect.poll(harness.joinCalls, { timeout: 30_000 }).toContain("p2");
});
