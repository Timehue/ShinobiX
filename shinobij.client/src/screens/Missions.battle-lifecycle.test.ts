import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const missions = readFileSync(new URL("./Missions.tsx", import.meta.url), "utf8");
const arena = readFileSync(new URL("./MissionArenaFight.tsx", import.meta.url), "utf8");
const hunterBoard = readFileSync(new URL("./HunterBoard.tsx", import.meta.url), "utf8");
const logbook = readFileSync(new URL("./Logbook.tsx", import.meta.url), "utf8");

test("server-owned mission battles pause regeneration and every autosave timer", () => {
    assert.match(app, /arenaBattleActive, missionBattleActive,/,
        "mission state must feed the shared unresolved-battle predicate used by regeneration");
    assert.match(app, /if \(isPresenceBattleActive\(screen\)\) return prev;/,
        "the global regeneration tick must use the shared battle predicate");
    assert.equal(
        [...app.matchAll(/if \(!charDirtyRef\.current \|\| isPresenceBattleActive\(\)\) return;/g)].length,
        2,
        "both debounced and interval autosaves must pause during the mission fight",
    );
    assert.match(app, /if \(isPresenceBattleActive\(\) \|\| \(!flushSaveRef\.current/,
        "the immediate-flush autosave must pause too");
    assert.match(app, /onMissionBattleStart=\{\(\) => setMissionBattleActive\(true\)\} onMissionBattleEnd=\{\(\) => setMissionBattleActive\(false\)\}/);
});

test("mission battle state clears on failed start, authoritative terminal resolution, exit, and unmount", () => {
    assert.match(missions, /if \(!fightMounted\) onMissionBattleEnd\?\.\(\);/);
    assert.match(missions, /onBattleResolved=\{onMissionBattleEnd\}/);
    assert.match(missions, /onExit=\{\(\) => \{ onMissionBattleEnd\?\.\(\); setAuthoritativeFight\(null\); \}\}/);
    assert.match(missions, /useEffect\(\(\) => \{ onMissionBattleEndRef\.current = onMissionBattleEnd; \}, \[onMissionBattleEnd\]\);/);
    assert.match(missions, /useEffect\(\(\) => \(\) => \{ onMissionBattleEndRef\.current\?\.\(\); \}, \[\]\);/);
    assert.match(arena, /setSettleState\("settled"\);[\s\S]{0,240}onBattleResolved\?\.\(\);/,
        "a won mission clears only after its durable queue response returns");
    assert.match(arena, /session\.winner !== "squad"[\s\S]{0,180}onBattleResolved\?\.\(\);/,
        "a loss/flee clears only after physical-outcome reporting returns");
});

test("all successful Mission Hall claims use atomic versioned character adoption", () => {
    assert.equal([...missions.matchAll(/postClaimMission\(/g)].length, 3);
    assert.equal([...missions.matchAll(/applySuccessfulMissionClaim\(result\)/g)].length, 3);
    assert.match(missions, /commitAuthoritativeMissionClaim\(result, onVersionedCharacter\)/);
    assert.equal([...hunterBoard.matchAll(/postClaimMission\(/g)].length, 2);
    assert.equal([...hunterBoard.matchAll(/applySuccessfulMissionClaim\(result\)/g)].length, 2);
    assert.equal([...logbook.matchAll(/postClaimMission\(/g)].length, 2);
    assert.equal([...logbook.matchAll(/applySuccessfulMissionClaim\(result\)/g)].length, 2);
    for (const source of [hunterBoard, logbook]) {
        assert.match(source, /commitAuthoritativeMissionClaim\(result, onVersionedCharacter\)/);
        assert.match(source, /if \(!onServerVersion\(result\._saveVersion\)\) return false;/);
    }
});

test("creator field mission battles fail closed until they have a run-bound contract", () => {
    const creatorStart = missions.slice(missions.indexOf("function startCreatorMissionBattle"), missions.indexOf("function acceptFetchMission"));
    assert.match(creatorStart, /awaiting a sealed Mission Hall contract/);
    assert.doesNotMatch(creatorStart, /requestAiFight|onMissionBattleStart/);
    assert.match(app, /const \[missionBattleActive, setMissionBattleActive\] = useState\(false\);/,
        "account teardown/remount must recreate the lock in its safe default state");
});
