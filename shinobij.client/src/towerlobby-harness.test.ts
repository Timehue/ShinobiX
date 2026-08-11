import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harness = readFileSync(new URL("./towerlobby.tsx", import.meta.url), "utf8");

test("Tower lobby harness mirrors expanded floor and ready-room contracts", () => {
    for (const field of [
        "firstClearReward", "fieldRule", "enemyCount", "reinforcementWaves",
        "bossMechanic", "bossTargetMode", "bossStrike", "closingRing", "dynamicHazards", "phaseReinforcementCount",
    ]) assert.match(harness, new RegExp(field));
    assert.match(harness, /import \{ FLOOR_CATALOG, type TowerFloor \} from "\.\.\/\.\.\/api\/towers\/_floor-catalog"/);
    assert.match(harness, /const MOCK = FLOOR_CATALOG\.map\(publicFloorMeta\)/);
    assert.match(harness, /chapterTitle: floor\.chapterTitle \?\? "The Celestial Ascent"/);
    assert.match(harness, /situation: floor\.briefing\.situation/);
    assert.match(harness, /percent: Math\.max\(0, Number\(floor\.closingRing\.pct \?\? 0\)\)/);
    assert.doesNotMatch(harness, /const CHAPTER_TWO_HARNESS_META|const F =/);
    assert.match(harness, /battleTowerBestFloor: 10/);
    assert.match(harness, /\/api\/towers\/party/);
    assert.match(harness, /hostDisplayName: "Kazuto Uzumaki"/);
    assert.match(harness, /action === "kick"/);
    assert.match(harness, /action === "revoke-invite"/);
    assert.match(harness, /import \{ GameConfirmHost \} from "\.\/components\/GameAlert"/);
    assert.match(harness, /<GameConfirmHost \/>/);
    assert.match(harness, /import\.meta\.hot\.dispose\(\(\) => root\.unmount\(\)\)/);
    assert.match(harness, /showReadyCheck/);
    assert.match(harness, /Mira of the Long Winter Name/);
    assert.match(harness, /body\.action === "ready"/);
    assert.match(harness, /mockPvpPresence = \{ state: "queued"/);
    assert.match(harness, /errorCode: "party-required", requiredPartySize: 4/);
    assert.match(harness, /Fight launch is disabled in the lobby-only harness/);
    assert.match(harness, /floorHarnessState === "error"/);
    assert.match(harness, /floorHarnessState === "empty"/);
    assert.match(harness, /floorHarnessState === "loading"/);
});
