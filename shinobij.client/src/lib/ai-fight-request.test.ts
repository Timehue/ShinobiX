import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { onAiFightRequest, requestAiFight, type AiFightRequest } from "./ai-fight-request";
import { creatorEventPracticeOpponent, creatorEventPracticeProfileIds } from "./creator-event-practice";
import { builtinAis } from "./combat-ai";

function makeRequest(overrides: Partial<AiFightRequest> = {}): AiFightRequest {
    return { opponentId: "ai-bandit", opponentLevel: 12, battleKind: "raidAi", ...overrides };
}

test("with no host mounted, a request fails closed instead of running local combat", () => {
    assert.equal(requestAiFight(makeRequest()), false);
});

test("with a host mounted, the request is delivered", () => {
    const seen: AiFightRequest[] = [];
    const unsubscribe = onAiFightRequest((request) => seen.push(request));
    try {
        assert.equal(requestAiFight(makeRequest({ opponentId: "ai-hunt-beast", sector: 41 })), true);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].opponentId, "ai-hunt-beast");
        assert.equal(seen[0].sector, 41);
    } finally {
        unsubscribe();
    }
});

test("unsubscribing restores the fail-closed no-host state", () => {
    const unsubscribe = onAiFightRequest(() => { throw new Error("must not be called after unsubscribe"); });
    unsubscribe();
    assert.equal(requestAiFight(makeRequest()), false);
});

const host = readFileSync(new URL("../components/AiFightHost.tsx", import.meta.url), "utf8");

test("AiFightHost renders the code-split normal Arena shell", () => {
    assert.match(host, /<MissionArenaFight/);
    assert.match(host, /import\(["']\.\.\/screens\/MissionArenaFight["']\)/);
    assert.doesNotMatch(host, /<BattleTowerFight|screens\/BattleTowerFight/);
});

test("AiFightHost requires standalone solo-PvE and has no local or Tower authority", () => {
    assert.match(host, /soloPveArenaTransport/);
    assert.match(host, /sessionId:\s*started\.sessionId,\s*session:\s*started\.session/);
    assert.doesNotMatch(host, /request\.playLocally|towers-api|TowerSession/);
});

test("routed launch sites contain no rewarding local fallback", () => {
    const sources = ["../screens/WorldMap.tsx", "../screens/Missions.tsx", "../screens/Logbook.tsx", "../screens/HunterBoard.tsx"];
    for (const relative of sources) {
        const source = readFileSync(new URL(relative, import.meta.url), "utf8");
        assert.doesNotMatch(source, /requestAiFight\(\{[\s\S]{0,700}playLocally:/, relative);
    }
});

test("a defeat and an abandoned fight both reach the server", () => {
    assert.match(host, /settleOnAnyDone/);
    assert.match(host, /shouldSettleOnClose\(/);
});

test("AiFightHost invalidates old-account starts, settlements, and local side effects", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    assert.match(host, /const aiFightPlayerKey = \(name: string\): string => playerSlug\(name\)/,
        "punctuated display names must use the same account key as the server");
    assert.match(app, /playerSlug\(characterRef\.current\?\.name \?\? ""\) !== playerSlug\(playerName\)/,
        "field-explore ACKs must be fenced to the canonical account key");
    assert.match(host, /originatingPlayerName:\s*string/);
    assert.match(host, /startRequestIdRef\.current !== requestId/,
        "a start response that lost its account scope must be ignored");
    assert.match(host, /activePlayerKeyRef\.current !== originatingPlayerKey/,
        "start and settle phases must compare the originating account");
    assert.match(host, /playerName:\s*originatingPlayerName/);
    assert.match(host, /token:\s*currentFight\.token/);
    assert.doesNotMatch(host, /playerName:\s*settlingPlayer/,
        "the arena callback argument must not retarget a sealed fight");
    assert.match(host, /const scopeIsCurrent = \(\) => mountedRef\.current[\s\S]{0,120}activePlayerKeyRef\.current === originatingPlayerKey/);
    assert.match(host, /if \(scopeIsCurrent\(\)\) \{[\s\S]{0,100}latestOnSettled\.current\(settled\)/,
        "an old account's response must not paint the newly mounted account");
    assert.match(host, /onMissionRaidComplete: \(sector, missionIds\) => \{[\s\S]{0,120}scopeIsCurrent\(\)/,
        "remaining client-owned raid mirrors need the same account gate as the character snapshot");
});

test("the Apex fight registers as a hunt", () => {
    const board = readFileSync(new URL("../screens/HunterBoard.tsx", import.meta.url), "utf8");
    const faceApex = board.slice(board.indexOf("function faceApex"), board.indexOf("function faceApex") + 1400);
    assert.match(faceApex, /battleKind: "raidAi"/);
});

test("tracked hunt target routes by stable mission identity and never supplies quality or stats", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const launch = worldMap.slice(worldMap.indexOf("function launchHuntBeastFight"), worldMap.indexOf("function launchHuntBeastFight") + 2200);
    assert.match(launch, /kind: "hunt-target", sourceId: mission\.id/);
    assert.match(launch, /launchWorldMapFight\(/);
    assert.doesNotMatch(launch, /applyHuntOpening|readHuntQuality|quality:/);
});

test("WorldMap reward-bearing AI routes have no local Arena bypass", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(worldMap, /setPendingAiProfileId|registerWandererAi|launchWandererArenaFight/);
    for (const kind of ["wanderer", "wanderer-ambush", "patrol", "bounty-hunter", "hunt-pack", "hunt-target", "questbook-boss", "story-reckoning"]) {
        assert.match(worldMap, new RegExp(`kind: ["']${kind}["']`), `${kind} must route through the sealed World contract`);
    }
    assert.match(worldMap, /battleKind: "world"/);
    assert.doesNotMatch(worldMap, /baselineKills|applyHuntOpening|readHuntQuality|rollHuntAmbush/);
});

test("World launch presentation is not retired before the sealed start ACK", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const slices = [
        worldMap.slice(worldMap.indexOf("function startWandererAttack"), worldMap.indexOf("function roadRumorFor")),
        worldMap.slice(worldMap.indexOf("function startPatrolFight"), worldMap.indexOf("function followTracker")),
        worldMap.slice(worldMap.indexOf("async function startBountyHunterFight"), worldMap.indexOf("function launchAmbushStage")),
        worldMap.slice(worldMap.indexOf("function fightEpicBoss"), worldMap.indexOf("function launchStoryReckoningFight")),
    ];
    for (const branch of slices) {
        assert.match(branch, /launchWorldMapFight\(/);
        assert.doesNotMatch(branch, /coolNaturalWanderer\(|coolWanderer\(/,
            "an offline/rejected start must leave the encounter entrypoint visible");
    }
});

test("outer-village guard raids bind the exact virtual sector", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    assert.match(worldMap, /launchAiGuardRaid\(pickGuardAi\(guard\.level, guard\.defenseBonusPercent \?\? 0\), guard\.level, virtualSector\)/);
    assert.doesNotMatch(worldMap, /setCurrentSector\(virtualSector\);[\s\S]{0,120}launchAiGuardRaid\([^\n]+currentSector\)/,
        "React's stale currentSector render cannot bind a different raid token/territory target");
});

test("creator VN battles use canonical non-paying practice until an event receipt exists", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const launch = worldMap.slice(worldMap.indexOf("function launchCreatorEventFight"), worldMap.indexOf("if (activePetEncounter"));
    const triggered = app.slice(app.indexOf("function startTriggeredEventArenaBattle"), app.indexOf("function completePendingArenaStoryBattle"));
    assert.match(launch, /requestAiFight\(/);
    assert.match(launch, /battleKind: "practice"/);
    assert.doesNotMatch(launch, /battleKind: "world"|setScreen\("arena"\)/);
    assert.doesNotMatch(worldMap, /onStartEventEncounter/);
    assert.match(triggered, /requestAiFight\(/);
    assert.match(triggered, /battleKind: "practice"/);
    assert.match(triggered, /result\.outcome === "win"/);
    assert.doesNotMatch(triggered, /temp-vn-ai|setPendingAiProfileId|setScreen\("arena"\)|setPendingArenaStoryBattle/);
});

test("legacy creator choices without an AI id use a real level-near published practice profile", () => {
    const catalogIds = new Set(builtinAis.map(({ id }) => id));
    for (const id of creatorEventPracticeProfileIds) assert.ok(catalogIds.has(id), `${id} must stay published`);
    assert.deepEqual(creatorEventPracticeOpponent("event-ai", "battle-ai", 40), { id: "battle-ai", authored: true });
    assert.deepEqual(creatorEventPracticeOpponent("event-ai", undefined, 40), { id: "event-ai", authored: true });
    assert.equal(creatorEventPracticeOpponent(undefined, undefined, 1).id, "builtin-ai-academy-sparring");
    assert.equal(creatorEventPracticeOpponent(undefined, undefined, 49).id, "builtin-ai-shadow-weaver");
});

test("Arena Combat Spar launches canonical non-paying Solo-PvE", () => {
    const arena = readFileSync(new URL("../screens/Arena.tsx", import.meta.url), "utf8");
    const launch = arena.slice(arena.indexOf("function beginAiBattle"), arena.indexOf("async function challengePlayer"));
    assert.match(launch, /requestAiFight\(/);
    assert.match(launch, /publishedPracticeOpponentForLevel\(aiLevel\)/);
    assert.match(launch, /battleKind: "practice"/);
    assert.match(launch, /returnScreen: "arena"/);
    assert.doesNotMatch(launch, /startPrefight|setBattleStarted|setEnemyHp|updateCharacter/,
        "Combat Spar must never arm the local Arena reducer");
});

test("retired pending AI ids cannot revive the local Arena reducer", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const arena = readFileSync(new URL("../screens/Arena.tsx", import.meta.url), "utf8");
    const persister = readFileSync(new URL("../components/ArenaBattlePersister.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(app, /setPendingAiProfileId\(snap\.pendingAiProfileId/,
        "server/local snapshots must discard pre-cutover opponent ids");
    assert.doesNotMatch(app, /setPendingAiProfileId\(ctx\.aiId\)|setPendingArenaStoryBattle\(restoredStoryBattle\)/,
        "dead rolling-upgrade branches must not retain a latent local-Arena reactivation write");
    const payload = app.slice(app.indexOf("function buildPlayerSavePayload"), app.indexOf("function saveAccountProgress"));
    assert.doesNotMatch(payload, /pendingAiProfileId/,
        "new saves must stop reproducing the retired browser authority");
    const marker = arena.indexOf("Retire pre-cutover browser snapshots");
    const staleGuard = arena.slice(marker, arena.indexOf("useEffect(() =>", marker + 20));
    assert.match(staleGuard, /setPendingAiProfileId\(""\)/);
    assert.doesNotMatch(staleGuard, /startPrefight|setEnemyHp|setBattleStarted/);
    assert.match(app, /bootLock\.kind === "arena"[\s\S]{0,700}localStorage\.removeItem\(`arena\.battle\.v3\.\$\{normalized\.name\}`\)/,
        "a server-visible legacy Arena lock must be retired without resuming local HP");
    assert.match(persister, /!props\.opponentName && !props\.pendingStoryKind[\s\S]{0,140}localStorage\.removeItem\(key\)/,
        "a lockless stale reducer snapshot must also be purged on lobby mount");
});

test("rolling upgrades retire every pre-cutover local Arena story breadcrumb", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const battleSave = readFileSync(new URL("./battle-save.ts", import.meta.url), "utf8");
    assert.match(battleSave, /lock\.kind === "arenaStory"\) return false/,
        "every Arena story breadcrumb, including unknown old variants, must be rejected by local resume");
    const bootStart = app.indexOf("if (bootLock && bootLock.screen)");
    const boot = app.slice(bootStart, app.indexOf("battleResumeStateExists(bootLock", bootStart));
    assert.match(boot, /\["triggeredEvent", "academySparring"\]/);
    assert.match(boot, /localStorage\.removeItem\(arenaStoryCtxKey\(normalized\.name\)\)/);
    const settlement = app.slice(app.indexOf("function completePendingArenaStoryBattle"), app.indexOf("async function continuePendingArenaStoryBattle"));
    assert.match(settlement, /Legacy local Arena story settlement is retired/);
    assert.doesNotMatch(settlement, /setCharacter|applyCurrencyRewards|addInventoryItems|\/api\/story\/settle/,
        "a stale browser snapshot cannot pay or progress locally after upgrade");
});

test("field-explore proof discovers cross-device active runs from server state", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const record = app.slice(app.indexOf("async function recordMissionExplore"), app.indexOf("const appliedRaidReportUiRef"));
    const coldLoad = record.indexOf("await loadMissionCatalog().catch(() => null)");
    const postLoadFence = record.indexOf('playerSlug(characterRef.current?.name ?? "") !== expectedOwnerKey', coldLoad);
    const candidateScan = record.indexOf("const candidates = builtinFetchMissions.filter", coldLoad);
    const zeroCandidateSuccess = record.indexOf("if (candidates.length === 0) return true", coldLoad);
    assert.match(record, /postFieldTrail\(\{ playerName: owner, missionId: mission\.id, action: "state" \}\)/);
    assert.match(record, /state\.state\?\.runId/);
    assert.match(record, /recordBuiltInMissionProgress\(owner, missionId, "field-explore", worldExploreRequestId, runId\)/);
    assert.ok(coldLoad >= 0 && postLoadFence > coldLoad && candidateScan > postLoadFence && zeroCandidateSuccess > candidateScan,
        "a rejected or account-stale cold catalog load must fail closed before even a zero-candidate sector can complete");
    assert.match(record.slice(coldLoad, candidateScan), /if \(!missionCatalog \|\|[\s\S]*\) return false;/,
        "a missing catalog chunk must keep the durable explore operation parked for retry");
    assert.doesNotMatch(record, /acceptedMissionIds\.includes/,
        "a second device's stale local accepted list must not discard an exact exploration receipt");
});

test("Dungeon seal one uses the active run's server-reconstructed Warden", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const api = readFileSync(new URL("./ai-fight-api.ts", import.meta.url), "utf8");
    const start = app.slice(app.indexOf("function startDungeonAiFight"), app.indexOf("function startAcademySparringMatch"));
    assert.match(start, /requestAiFight\(/);
    assert.match(start, /battleKind: "dungeon"/);
    assert.match(start, /dungeonRunToken: runToken/);
    assert.match(start, /result\.character\?\.activeDungeonRun\?\.wardenDefeated/);
    assert.doesNotMatch(start, /Math\.random|temp-dungeon-ai|setPendingAiProfileId|setPendingArenaStoryBattle|setScreen\("arena"\)/);
    assert.match(api, /params\.battleKind !== "dungeon"[\s\S]{0,160}opponentId:/,
        "Dungeon start must omit client-supplied opponent identity from the request body");
    assert.match(host, /started\.battleKind === "dungeon" \? \{ returnScreen: "dungeon" \}/);
    assert.match(host, /started\.dungeonRunToken/);
});

test("later-stage quest bosses let the server derive its sealed stage", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const launch = worldMap.slice(worldMap.indexOf("function fightEpicBoss"), worldMap.indexOf("function launchStoryReckoningFight"));
    assert.match(launch, /kind: "questbook-boss", sourceId: active\.id, sector: selectedSector/);
    assert.doesNotMatch(launch, /kind: "questbook-boss"[^\n]*stage:/);
});

test("World settlement callbacks are sealed, account-fenced, latest-rendered, and private-mode safe", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    assert.match(worldMap, /useLayoutEffect\(\(\) => \{ worldFightResolverRef\.current = resolveWandererFight; \}\)/);
    assert.match(worldMap, /settlement\.character\?\.name \?\? stored\?\.playerName/);
    assert.match(worldMap, /WORLD_FIGHT_KIND_BY_MODE\[stored\.mode\] === context\.kind/);
    assert.match(worldMap, /wandererFightPresentationFromContext\(settledName, context\)/,
        "sealed context must drive callbacks when localStorage is unavailable");
    assert.match(worldMap, /window\.setTimeout\(\(\) => worldFightResolverRef\.current\(p, settlement\), 0\)/);
});

test("hunt acceptance, abandonment and turn-in remain server-authoritative", () => {
    const board = readFileSync(new URL("../screens/HunterBoard.tsx", import.meta.url), "utf8");
    assert.match(board, /action: "accept"/);
    assert.match(board, /action: "abandon"/);
    assert.match(board, /onVersionedCharacter\(result\.character, result\._saveVersion\)/);
    assert.match(board, /postClaimMission\(character\.name, "hunt", mission\.id\)/);
    assert.doesNotMatch(board, /setPendingAiProfileId|setRaidBattleKind/);
});

test("resumed World fights rebuild presentation from the server seal", () => {
    assert.match(host, /resumeWorldAiFight\(originatingPlayerName\)/);
    assert.match(host, /const sealedRequest = started\.worldContext[\s\S]{0,120}requestForResumedWorldFight\(started\)/);
    assert.match(host, /ensureWandererFightPending\(originatingPlayerName, started\.worldContext\)/);
    assert.match(host, /recordMode=\{currentFight\.worldContext \? "World Encounter"/);
});

test("fresh generic fights use the server-sealed identity just like refresh recovery", () => {
    assert.match(host, /requestForStartedGenericFight\(started, request\)/);
    assert.match(host, /const sameOpponent = sealed\.opponentId === requested\.opponentId/);
    assert.doesNotMatch(host, /started\.worldContext[\s\S]{0,120}: request;/,
        "initial generic presentation must not keep a client-suggested explore opponent");
});

test("a malformed start response cannot wedge the Retry gate", () => {
    const validation = host.indexOf('if (!sealedRequest) throw new Error("The combat server did not return a sealed encounter identity.")');
    const arm = host.indexOf("activeRef.current = true", validation);
    const paint = host.indexOf("setFight({", validation);
    assert.ok(validation >= 0 && arm > validation && paint > arm,
        "the host may become active only after sealed identity validation and immediately before painting the fight");
});

test("explore and raid starts carry their exact server proofs", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const logbook = readFileSync(new URL("../screens/Logbook.tsx", import.meta.url), "utf8");
    assert.match(worldMap, /battleKind: "explore",[\s\S]{0,180}worldExploreRequestId,/);
    const worldRaid = worldMap.slice(worldMap.indexOf("async function launchAiGuardRaid"), worldMap.indexOf("function startWandererAttack"));
    const logbookRaid = logbook.slice(logbook.indexOf("async function startRaid"), logbook.indexOf("function goToWarGround"));
    for (const branch of [worldRaid, logbookRaid]) {
        assert.match(branch, /mintAiRaidToken\(/);
        assert.match(branch, /raidToken: raidProof\.token/);
        assert.match(branch, /sector: raidProof\.sector/);
    }
});

test("raid mission UI mirrors the server's exact credited mission ids", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const settle = readFileSync(new URL("./ai-fight-settle.ts", import.meta.url), "utf8");
    const recordProgress = app.slice(app.indexOf("async function recordBuiltInMissionProgress"), app.indexOf("async function recordMissionExplore"));
    const mirror = app.slice(app.indexOf("async function mirrorExactRaidMissionCredits"), app.indexOf("async function applyRaidReportDrain"));
    assert.match(settle, /reported\.fetchMissionsCredited/);
    assert.match(settle, /onMissionRaidComplete\?\.\(sector, fetchMissionsCredited\)/);
    assert.match(app, /onMissionRaidComplete: \(sector, missionIds\) => recordMissionRaid\(sector, undefined, missionIds, character\?\.name \?\? ""\)/);
    assert.match(app, /const exactIds = new Set\(missionIds\)/);
    assert.ok(
        recordProgress.indexOf('playerSlug(characterRef.current?.name ?? "") !== expectedOwnerKey', recordProgress.indexOf("await loadMissionCatalog()"))
            > recordProgress.indexOf("await loadMissionCatalog()"),
        "field progress must re-fence the account after the lazy catalog resolves",
    );
    assert.match(mirror, /await loadMissionCatalog\(\)[\s\S]{0,180}playerSlug\(characterRef\.current\?\.name \?\? ""\) !== expectedOwnerKey/,
        "raid projection must re-fence the expected account after the lazy catalog resolves");
    const catalogLoads = [...app.matchAll(/await loadMissionCatalog\(\)/g)];
    assert.equal(catalogLoads.length, 3, "every App mission-catalog await must remain covered by this fence audit");
    for (const load of catalogLoads) {
        assert.match(app.slice(load.index, load.index + 360), /playerSlug\(characterRef\.current\?\.name \?\? ""\) !== expectedOwnerKey/,
            "every mission-catalog continuation must re-fence its originating account");
    }
    assert.match(app, /function recordMissionRaid\([\s\S]{0,220}expectedOwnerKey = playerSlug\(expectedPlayerName\)[\s\S]{0,140}characterRef\.current\?\.name/,
        "every raid caller must bind progress projection to its originating player");
    assert.doesNotMatch(app, /recordMissionRaid\(sector, undefined, true\)/);
});

test("refresh recovery handles generic fights, durable chains, and pending rewards", () => {
    assert.match(host, /resumeGenericAiFight\(originatingPlayerName\)/);
    assert.match(host, /requestForResumedGenericFight\(generic\)/);
    assert.match(host, /"pendingWorldChain" in started/);
    assert.match(host, /worldEncounter: pending\.request/);
    assert.match(host, /"pendingWorldOutcome" in started/);
    assert.match(host, /recoverPendingWorldOutcome\(originatingPlayerName, started\.pendingWorldOutcome\)/);
    assert.match(host, /latestOnSettled\.current\(\{/,
        "recovered snapshots must use the latest account-fenced commit callback");
});

test("a committed World start with a lost ACK enters immediate durable recovery", () => {
    const api = readFileSync(new URL("./ai-fight-api.ts", import.meta.url), "utf8");
    assert.match(api, /catch \(error\) \{[\s\S]{0,180}params\.worldEncounter[\s\S]{0,180}resumeWorldAiFight\(params\.playerName\)/);
    const handoff = host.indexOf('"pendingWorldChain" in started || "pendingWorldOutcome" in started');
    assert.ok(handoff >= 0 && host.indexOf("setRecoveryAttempt", handoff) > handoff,
        "pending chain/outcome responses must enter the recovery loop");
    const startCatch = host.indexOf(".catch((error) =>", handoff);
    assert.ok(startCatch > handoff && host.indexOf("if (request.worldEncounter) setRecoveryAttempt", startCatch) > startCatch,
        "a transient World start failure must retry the active pointer without requiring reload");
});

test("closing an unsettled fight waits for authoritative forfeit settlement", () => {
    const start = host.indexOf("async function closeFight");
    const close = host.slice(start, host.indexOf("return (", start));
    assert.match(close, /await settle\(active\.sessionId, active\.originatingPlayerName\)/);
    assert.match(close, /catch \{[\s\S]*return;/,
        "a lost close ACK must retain the overlay and token for retry");
    assert.ok(close.indexOf("await settle") < close.indexOf("setFight("));
});
