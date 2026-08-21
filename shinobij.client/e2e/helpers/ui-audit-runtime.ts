import { expect, type Page, type Route } from "@playwright/test";
import { PUBLIC_CAPABILITY_IDS } from "../../../shared/public-capabilities";

export type UiAuditSave = {
    character?: Record<string, unknown>;
    [key: string]: unknown;
};

type SaveCommit = {
    baseVersion: number;
    version: number;
    postedState: string;
};

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export function uiAuditSave(): UiAuditSave {
    const stats = {
        strength: 80,
        speed: 76,
        intelligence: 92,
        willpower: 88,
        bukijutsuOffense: 70,
        bukijutsuDefense: 72,
        taijutsuOffense: 75,
        taijutsuDefense: 78,
        genjutsuOffense: 90,
        genjutsuDefense: 86,
        ninjutsuOffense: 94,
        ninjutsuDefense: 89,
    };

    return {
        character: {
            name: "AuditNinja",
            village: "Stormveil Village",
            storyVillage: "Stormveil Village",
            specialty: "Ninjutsu",
            bloodline: "Ashen Eyes",
            level: 85,
            rankTitle: "Special Jonin",
            ryo: 9_999_999,
            fateShards: 9_999,
            boneCharms: 9_999,
            auraStones: 9_999,
            mythicSeals: 9_999,
            unspentStats: 4,
            stats,
            hp: 9_000,
            maxHp: 9_000,
            chakra: 9_000,
            maxChakra: 9_000,
            stamina: 9_000,
            maxStamina: 9_000,
            onboardingStep: "done",
            academyChecklistClaimed: true,
            inventory: ["rustfang-kunai", "shinobi-vest", "dungeon-key"],
            itemStacks: [],
            equipment: {},
            pets: [],
            storyProgress: 9,
            storyTraits: [],
            examsPassed: ["genin", "chunin"],
            profession: "healer",
            professionRank: 5,
            equippedJutsuIds: ["strike"],
            jutsuMastery: [{ jutsuId: "strike", level: 10, xp: 0 }],
            pendingCombatMissionClaims: [],
            totalPvpKills: 25,
            totalStatsTrained: 600,
            totalMissionsCompleted: 80,
            totalAiKills: 80,
            totalTilesExplored: 120,
            messages: [],
        },
        currentBiome: "central",
        currentSector: 40,
        activeTraining: null,
        activeJutsuTraining: null,
        acceptedMissionIds: [],
        missionProgress: {},
        triggeredEvents: [
            "builtin-awakening-lv2",
            "builtin-aura-sphere-lv9",
            "story-interlude-stormveil-village-20",
            "story-interlude-stormveil-village-30",
            "story-interlude-stormveil-village-42",
            "story-interlude-stormveil-village-58",
            "story-interlude-stormveil-village-70",
            "story-interlude-stormveil-village-80",
        ],
        pendingTravel: null,
        creatorJutsus: [],
        creatorItems: [],
        creatorCards: [],
        creatorMissions: [],
        creatorEvents: [],
        creatorRaids: [],
    };
}

export async function installUiAuditRuntime(page: Page, initialSave: UiAuditSave = uiAuditSave()) {
    let save = structuredClone(initialSave);
    let saveVersion = 1;
    let acknowledgedVersion = 0;
    let lastCommit: SaveCommit | null = null;

    await page.addInitScript(() => {
        localStorage.setItem("ninjav-admin-build-v1", JSON.stringify({ currentAccountName: "AuditNinja" }));
        localStorage.setItem("ninjav-player-accounts-v1", JSON.stringify({ auditninja: { token: "ui-audit-token" } }));
        localStorage.setItem("shinobix:activePlayerPersist", "AuditNinja");
        localStorage.setItem("shinobix:activeTokenPersist", "ui-audit-token");
        localStorage.setItem("shinobix:storage-notice-ack", "1");
        localStorage.setItem("patchNotes.lastSeenVersion.v1", "2026.07.28-stat-leveling");
        localStorage.setItem("dailyBriefing.seen.v1", new Date().toISOString().slice(0, 10));
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const normalizedPath = path.toLowerCase();

        if (path === "/api/perf-beacon") return route.fulfill({ status: 204 });
        if (path === "/api/player-auth") return json(route, { ok: true, token: "ui-audit-token" });
        if (normalizedPath === "/api/save/auditninja") {
            if (request.method() === "GET") return json(route, { ...save, _saveVersion: saveVersion });

            const incoming = request.postDataJSON() as UiAuditSave;
            const baseVersion = Number(incoming._baseSaveVersion);
            if (!Number.isSafeInteger(baseVersion) || baseVersion !== saveVersion) {
                return json(route, { error: "Save conflict", currentVersion: saveVersion }, 409);
            }

            const persisted = { ...incoming };
            delete persisted._baseSaveVersion;
            delete persisted._saveVersion;
            delete persisted._saveAt;
            const postedState = JSON.stringify(persisted);
            save = JSON.parse(postedState) as UiAuditSave;
            saveVersion += 1;
            lastCommit = { baseVersion, version: saveVersion, postedState };
            await json(route, { ok: true, _saveVersion: saveVersion });
            acknowledgedVersion = saveVersion;
            return;
        }

        if (path === "/api/battle-lock") return json(route, { lock: null });
        if (path === "/api/player/capabilities") {
            return json(route, {
                ok: true,
                capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
                    id,
                    { state: "available", reason: "available" },
                ])),
            });
        }
        if (path === "/api/player/activity-spine") return json(route, { ok: true, spine: null });
        if (path === "/api/player/roster") {
            const rivalCharacter = {
                ...(save.character ?? {}),
                name: "RivalNinja",
                village: "Ashen Leaf Village",
                storyVillage: "Ashen Leaf Village",
                rankTitle: "Jonin",
                level: 72,
                customTitle: "Lantern Warden",
            };
            return json(route, {
                players: [{
                    name: "RivalNinja",
                    level: 72,
                    village: "Ashen Leaf Village",
                    specialty: "Genjutsu",
                    online: true,
                    lastSeenAt: Date.now(),
                    currentSector: 22,
                    character: rivalCharacter,
                    eligiblePets: [],
                }],
            });
        }
        if (path === "/api/player/daily-login") {
            return json(route, {
                ok: true,
                alreadyClaimed: true,
                granted: { ryo: 0, fateShards: 0 },
                balances: { ryo: 9_999_999, fateShards: 9_999 },
                streak: 4,
                daysUntilShardBonus: 3,
            });
        }
        if (path === "/api/player/travel") return json(route, { arrivalAt: Date.now(), travelMs: 0, arrivalTile: 78 });
        if (path === "/api/world-state") return json(route, { territories: [], wars: [], standings: [] });
        if (path === "/api/game-state") return json(route, { villageStates: {}, arenaActiveFights: [] });
        if (path === "/api/weekly-boss") return json(route, { boss: null, fightEnabled: true });
        if (path === "/api/ranked-season") return json(route, { current: null, lastSeason: null });
        if (path === "/api/towers/floors") return json(route, { floors: [] });
        if (path === "/api/pvp/combat-history") return json(route, { entries: [] });
        if (path === "/api/pet-ladder") {
            return json(route, {
                mode: url.searchParams.get("mode") === "tactical" ? "tactical" : "coliseum",
                total: 0,
                ladder: [],
                you: {
                    rank: null,
                    hasDefense: false,
                    defense: null,
                    challengesLeft: 10,
                    band: 0,
                },
                notifications: [],
            });
        }
        if (path === "/api/legacy/stats") {
            return json(route, {
                level: 85,
                minLevelReached: true,
                legacy: null,
                trial: null,
                offer: null,
                strongest: [],
                eligibleCounts: { basic: 0, rare: 0, legendary: 0, mythic: 0 },
            });
        }
        if (path === "/api/legacy/definitions") return json(route, { minLevel: 50, legacies: [] });
        if (path === "/api/legacy/sage") return json(route, { spawn: false, reason: "not-due" });
        if (path.startsWith("/api/legacy/")) return json(route, { ok: true });

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
            wars: [],
            territories: [],
            standings: [],
            villageStates: {},
            arenaActiveFights: [],
        });
    });

    return {
        currentVersion: () => saveVersion,
        acknowledgedVersion: () => acknowledgedVersion,
        lastCommit: () => lastCommit,
        persistedStateMatchesLastPost: () => Boolean(lastCommit && JSON.stringify(save) === lastCommit.postedState),
    };
}

export type UiAuditRuntime = Awaited<ReturnType<typeof installUiAuditRuntime>>;

export async function expectUiAuditBoot(page: Page, runtime: UiAuditRuntime, screen: string) {
    await page.goto(`/#/${screen}`, { waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", screen);
    const commit = runtime.lastCommit();
    if (commit) {
        expect(runtime.persistedStateMatchesLastPost()).toBe(true);
        expect(commit.baseVersion).toBe(commit.version - 1);
        expect(runtime.currentVersion()).toBe(commit.version);
        expect(runtime.acknowledgedVersion()).toBe(commit.version);
    }
    await expect(page.getByRole("complementary", { name: "Device and server saves diverged" })).toHaveCount(0);
}
