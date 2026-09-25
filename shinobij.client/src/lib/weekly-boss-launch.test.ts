import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { WEEKLY_BOSS_LAUNCH_TTL_MS, clearWeeklyBossLaunch, peekWeeklyBossLaunch, stageWeeklyBossFight } from "./weekly-boss-launch";

/*
 * The roaming Weekly Boss can only be fought from the World Map's "Stand &
 * Fight" prompt. After the Solo PvE migration that prompt merely navigated to
 * the tracker, whose only button points back at the map, so the boss could not
 * be fought at all. The map now stages a launch that the Weekly Boss screen acts
 * on, and the fight ends back on the map.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("weekly-boss launch handoff", () => {
    it("hands a fresh launch to the next reader, repeatably, until it is cleared", () => {
        const now = 1_800_000_000_000;
        stageWeeklyBossFight("worldMap", now);
        const first = peekWeeklyBossLaunch(now + 10);
        assert.deepEqual(first, { returnScreen: "worldMap", stagedAt: now });
        // StrictMode runs a state initializer twice; both calls must see it.
        assert.equal(peekWeeklyBossLaunch(now + 20), first);
        clearWeeklyBossLaunch(first!);
        assert.equal(peekWeeklyBossLaunch(now + 30), null);
    });

    it("ignores a stale launch", () => {
        const now = 1_800_000_000_000;
        stageWeeklyBossFight("worldMap", now);
        assert.equal(peekWeeklyBossLaunch(now + WEEKLY_BOSS_LAUNCH_TTL_MS + 1), null);
    });

    it("never clears a newer launch when an older one is acted on", () => {
        const now = 1_800_000_000_000;
        stageWeeklyBossFight("worldMap", now);
        const older = peekWeeklyBossLaunch(now)!;
        stageWeeklyBossFight("worldMap", now + 5);
        clearWeeklyBossLaunch(older);
        assert.equal(peekWeeklyBossLaunch(now + 6)?.stagedAt, now + 5);
        clearWeeklyBossLaunch(peekWeeklyBossLaunch(now + 6)!);
    });

    it("is wired: the map stages before it navigates, and the arena starts the fight and returns", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        const stand = worldMap.slice(worldMap.indexOf("function standBossFight()"), worldMap.indexOf("function fleeBoss()"));
        assert.ok(stand.indexOf('stageWeeklyBossFight("worldMap")') >= 0, "Stand & Fight stages the launch");
        assert.ok(stand.indexOf('stageWeeklyBossFight("worldMap")') < stand.indexOf("onLaunchWeeklyBoss?.("), "and stages it BEFORE navigating");

        const arena = source("../screens/WeeklyBossArena.tsx");
        assert.match(arena, /useState\(\(\) => peekWeeklyBossLaunch\(\)\)/, "the arena reads the launch once, on mount");
        assert.match(arena, /clearWeeklyBossLaunch\(launch\);[\s\S]{0,240}if \(bossState\?\.aiId\) void launchAuthoritativeFight\(\);/, "and starts the fight");
        assert.match(arena, /if \(launch\) setScreen\(launch\.returnScreen\);/, "and returns to where the fight began");
        assert.match(arena, /setScreenFightActive\("weeklyBoss", fight !== null\)/, "a live fight locks the menus");
        assert.doesNotMatch(arena, /setScreen\("centralHub"\)/, "no Back button teleports a hunter to the Central hub");
    });
});
