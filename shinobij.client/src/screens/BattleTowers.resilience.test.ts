import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync(new URL("./BattleTowers.tsx", import.meta.url), "utf8");
const fight = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("./BattleTowersLobby.tsx", import.meta.url), "utf8");
const readyRoom = readFileSync(new URL("../components/TowerReadyRoomPanel.tsx", import.meta.url), "utf8");
const partyState = readFileSync(new URL("../lib/tower-party-state.ts", import.meta.url), "utf8");
const tacticalCss = readFileSync(new URL("../styles/tower-tactical.css", import.meta.url), "utf8");
const guards = readFileSync(new URL("../lib/screen-guards.ts", import.meta.url), "utf8");
const navigationGuard = readFileSync(new URL("../lib/use-battle-navigation-guard.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/towers-api.ts", import.meta.url), "utf8");
const storyCatalog = readFileSync(new URL("../lib/tower-story-catalog.ts", import.meta.url), "utf8");
const spireCatalog = readFileSync(new URL("../lib/spire-catalog.ts", import.meta.url), "utf8");
const characterTypes = readFileSync(new URL("../types/character.ts", import.meta.url), "utf8");
const floorCatalog = readFileSync(new URL("../../../api/towers/_floor-catalog.ts", import.meta.url), "utf8");

test("completed Tower sessions retain their recovery breadcrumb and reopen results", () => {
    assert.match(wrapper, /\.then\(toFight\)/, "every fetched session, including done sessions, must reopen the fight/result screen");
    assert.match(wrapper, /TOWER_RECOVERY_RUN_KEY/);
    assert.match(wrapper, /phase: "resumeError"/, "transient resume failures need a recoverable state");
    assert.match(wrapper, /view\.phase === "checking" \|\| view\.phase === "resumeError"/, "resume errors must not clear the persisted run id");
    assert.match(wrapper, /Retry recovery/);
    assert.match(wrapper, /Stop recovery and return to lobby/);
    assert.match(wrapper, /onLeaveActive=\{\(\) => \{[\s\S]*?clearFightKey\(\)/, "leaving the view must release navigation without discarding recovery");
    assert.match(fight, /The server run will continue and may auto-pass your turns/);
});

test("Tower settlement is explicit, retryable, and blocks accidental receipt loss", () => {
    assert.match(fight, /phase: "error",\s*message:/);
    assert.match(fight, /Retry settlement/);
    assert.match(fight, /response\.settled !== true/);
    assert.match(fight, /aria-disabled=\{!resultCanExit\}/);
    assert.equal(fight.match(/\sdisabled=\{!resultCanExit\}/g)?.length, 2, "both result exits must be natively disabled before settlement is confirmed");
    assert.match(fight, /already-first-cleared/);
    assert.match(fight, /Weekly floor reward already banked/);
    assert.match(fight, /Your completed run is still saved/);
});

test("Tower fight breadcrumbs synchronously refresh App's ref-backed navigation guard", () => {
    assert.match(guards, /TOWER_FIGHT_STATE_EVENT/);
    assert.match(guards, /window\.dispatchEvent\(new Event\(TOWER_FIGHT_STATE_EVENT\)\)/);
    assert.match(wrapper, /setTowerFightRunId\(runId\);[\s\S]*?setView\(\{ phase: "fight"/, "fresh entry must lock before the view transition");
    assert.match(navigationGuard, /window\.addEventListener\(TOWER_FIGHT_STATE_EVENT, syncTowerFightGuard\)/);
    assert.match(navigationGuard, /window\.removeEventListener\(TOWER_FIGHT_STATE_EVENT, syncTowerFightGuard\)/);
    assert.match(app, /useBattleNavigationGuard\(\{/);
    assert.match(app, /bootLock\.kind === "battleTowers"[\s\S]*?setTowerFightRunId\(runId\)[\s\S]*?setScreen\(arena2v2 \? "battleArena" : "battleTowers"\)/, "server-owned Tower locks must resume without the generic hospital path");
    // EVERY 2v2 lease resumes in the Battle Arena, not just the public queue's:
    // clan-war and ranked leases carry their own modes, and matching one literal
    // string sent those players to the co-op Spire lobby instead.
    assert.match(app, /const arena2v2 = isMpvpLeaseMode\(bootLock\.meta\?\.mode\)/);
});

test("Tower cinematic and result overlays are keyboard-safe modal dialogs", () => {
    assert.equal(fight.match(/role="dialog"/g)?.length, 3);
    assert.equal(fight.match(/aria-modal="true"/g)?.length, 3);
    assert.match(fight, /primary\.matches\(":disabled"\)/);
    assert.match(fight, /const fallback = dialog\?\.querySelector/);
    assert.match(fight, /focusRevision:\s*settlement\.phase/);
    assert.match(fight, /escapeAllowed:\s*resultCanExit/);
    assert.match(fight, /event\.stopImmediatePropagation\(\)/);
    assert.match(fight, /src=\{sprite\} alt="" aria-hidden="true"/);
});

test("Tower tactical controls remain available and accessible off turn", () => {
    assert.match(fight, /session\.actors\.find\(a => a\.side === "squad" && ownedByMe\(a\.ownerSlug\)\)/);
    assert.match(fight, /aria-label=\{tileLabel\}/);
    assert.match(fight, /<button key=\{a\.id\} type="button" className="tower-board-actor"/);
    assert.match(fight, /aria-label="Remaining turn order"/);
    assert.match(fight, /aria-label="Immediate battlefield threats"/);
    assert.match(fight, /Boss barrier ·/);
    assert.match(fight, /Break seals/);
    assert.match(fight, /nextEnemyWave\?\.actors\.length/);
    assert.match(api, /pendingEnemyWaves\?: Array<\{ round: number; actors: TowerActor\[\] \}>/);
    assert.match(fight, /Fit \/ reset/);
    assert.match(tacticalCss, /touch-action:\s*none/);
    assert.match(tacticalCss, /@media \(max-width: 1023px\)/);
});

test("short desktop Tower fights reserve a usable board and scroll the action dock", () => {
    assert.match(fight, /className="tower-action-dock"/);
    const shortDesktopStart = tacticalCss.indexOf("@media (min-width: 1024px) and (max-height: 900px)");
    const mobileStart = tacticalCss.indexOf("@media (max-width: 1023px)", shortDesktopStart);
    assert.ok(shortDesktopStart >= 0 && mobileStart > shortDesktopStart, "the short-desktop contract must precede the mobile layout");
    const shortDesktop = tacticalCss.slice(shortDesktopStart, mobileStart);
    assert.match(shortDesktop, /\.tower-board-area[\s\S]*?min-height:\s*clamp\(250px, 37dvh, 333px\)\s*!important/);
    assert.match(shortDesktop, /\.tower-action-dock[\s\S]*?flex:\s*0 0 240px;[\s\S]*?min-height:\s*240px;[\s\S]*?max-height:\s*240px;/,
        "the short-desktop dock must reserve the full command and first-technique tap surface");
    assert.match(shortDesktop, /overflow:\s*hidden auto/, "short-desktop actions must remain reachable without collapsing the board");
    assert.match(shortDesktop, /\.basic-action-bar[\s\S]*?grid-auto-flow:\s*column/, "desktop commands must stay on one compact row");
    assert.match(shortDesktop, /\.combat-equipped-jutsu-grid[\s\S]*?grid-auto-flow:\s*column/);
    assert.match(shortDesktop, /\.jutsu-layout-card[\s\S]*?height:\s*94px !important;[\s\S]*?overflow:\s*auto hidden !important/,
        "the fixed one-row loadout must remain horizontally reachable inside its owning hit-test surface");
});

test("active co-op reconciliation is push-led, bounded, and revision-safe", () => {
    assert.match(fight, /onTowerKick\(kick =>/);
    assert.match(fight, /kick\.channel === "session" && kick\.runId === runId/);
    assert.match(fight, /visiblePoll\(poll, realtimeConnected \? 20_000 : 2_500, 0\.08\)/);
    assert.match(fight, /return onStatus\(setRealtimeConnected\)/);
    assert.match(fight, /let inFlight = false/);
    assert.match(fight, /if \(!alive\) return/);
    assert.match(fight, /if \(inFlight\) \{[\s\S]{0,100}?refreshPending = true/,
        "a socket kick received during an older HTTP read must queue another authoritative read");
    assert.match(fight, /if \(alive && refreshPending\) queueMicrotask\(poll\)/);
    assert.match(fight, /const controller = new AbortController\(\)/);
    assert.match(fight, /stateFn\(runId, me, controller\.signal\)/);
    assert.match(fight, /controller\.abort\(\); stopPush\(\); stopFallback\(\)/);
    assert.match(fight, /\(next\.actionVersion \?\? 0\) >= \(current\.actionVersion \?\? 0\)/);
    assert.doesNotMatch(fight, /session\.status !== "active" \|\| myTurn/, "own-turn polling must remain live for authoritative AFK auto-pass");
    assert.match(api, /if \(errorBody\.session\)[\s\S]*?applied: false/, "action conflicts must preserve an authoritative response session");
    assert.doesNotMatch(fight, /setInterval\([\s\S]{0,300}?2500/);
    assert.match(fight, /join route is[\s\S]{0,100}?read-only/);
});

test("selected Tower floors expose tactics and truthful first-clear rewards without bloating every row", () => {
    for (const field of ["chapter", "chapterTitle", "chapterSubtitle", "chapterSummary", "artKey", "briefing", "bossMechanic", "bossTargetMode", "bossStrike", "closingRing", "dynamicHazards", "fieldRule", "enemyCount", "reinforcementWaves", "firstClearReward"] as const) {
        assert.match(api, new RegExp(`${field}\\??:`), `${field} must remain in the public floor type`);
    }
    assert.match(lobby, /Selected floor briefing/);
    assert.match(lobby, /First clear recorded/);
    assert.match(lobby, /Boss focus/);
    assert.match(lobby, /Telegraph/);
    assert.match(lobby, /Closing ring/);
    assert.match(lobby, /Closing ring:<\/strong> After round \{selFloor\.closingRing\.fromRound\}/);
    assert.match(fight, /Arena contracts after round/);
    assert.doesNotMatch(lobby, /Closing ring:<\/strong> Starts round/);
    assert.doesNotMatch(fight, /Arena collapses from round/);
    assert.match(floorCatalog, /The safe area contracts after round 8\./);
    assert.match(floorCatalog, /then contracts after round 11\./);
    assert.match(lobby, /Field hazard/);
    assert.match(lobby, /selectedRewardParts\.join/);
    assert.match(lobby, /chapter\.floors\.map/, "chapter floor cards must remain separate from the selected-floor briefing");
    assert.equal((lobby.match(/className="tower-floor-briefing has-art"/g) ?? []).length, 1);
    assert.doesNotMatch(lobby, /disabled=\{locked\}/, "locked floors must remain selectable for preview");
    assert.match(lobby, /Locked; clear through Floor/);
});

test("story Tower milestone receipts report server progression without inventing a title", () => {
    assert.match(characterTypes, /battleTowerMilestones\?: string\[\]/);
    assert.match(fight, /newlyRecordedTowerMilestones/);
    assert.match(fight, /buildTowerMilestoneReceipt\(milestone\)/);
    const rewardType = api.match(/firstClearReward:\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? "";
    assert.doesNotMatch(rewardType, /itemId/);
});
test("Tower AI teammates use one authenticated novice-recruit Ready Room path", () => {
    assert.doesNotMatch(lobby, /Practice with AI Assists|borrowed shinobi|Borrow an AI assist/);
    assert.match(lobby, /Enter Floor \$\{selFloor\.id\} solo/);
    assert.match(api, /Start a host-only Story run/);
    assert.match(api, /postJson\('\/api\/towers\/start', \{ hostName, floor, hostLoadout \}\)/);
    assert.match(readyRoom, /Live squad · optional novice recruits/);
    assert.match(readyRoom, /reward-ineligible AI recruits/);
    assert.match(readyRoom, /action: "add-ai"/);
    assert.match(readyRoom, /action: "remove-ai"/);
    assert.match(readyRoom, /novice AI · no rewards/);
    assert.match(api, /progressionEligible: false/);
    assert.match(readyRoom, /onTowerKick\(kick =>/);
    assert.match(readyRoom, /visiblePoll\(refresh, realtimeConnected \? 20_000 : 2_500, 0\.08\)/);
    assert.match(readyRoom, /return onStatus\(setRealtimeConnected\)/);
    assert.match(readyRoom, /if \(alive\) refreshPending = true/,
        "party kicks blocked by an in-flight read or mutation must be reconciled afterward");
    assert.match(readyRoom, /if \(alive && refreshPending && !requestInFlightRef\.current\) queueMicrotask\(refresh\)/);
    assert.match(readyRoom, /controller\.abort\(\);[\s\S]{0,80}?stopPush\(\);[\s\S]{0,80}?stopFallback\(\)/);
    assert.match(readyRoom, /roomRefreshRef\.current\(\)/, "completed mutations must immediately reconcile any coalesced party kick");
    assert.match(readyRoom, /2–4 slots · live or novice AI/);
    assert.match(readyRoom, /memberCount\}\/4 slots · 2 minimum/);
    assert.match(readyRoom, /requestInFlightRef\.current/, "same-tick mutations and launch must share a synchronous latch");
    assert.match(readyRoom, /canStartTowerRoomPoll\(alive, inFlight, Boolean\(requestInFlightRef\.current\)\)/, "polls must pause while a membership mutation owns response ordering");
    assert.match(readyRoom, /reconcileTowerRoomEnvelope/, "out-of-order room responses must be version-monotonic");
    assert.match(partyState, /status === "closed"[\s\S]*?party: null/, "closed and expired rooms must reconcile back to open state");
    assert.match(readyRoom, /syncState === "reconnecting"/);
    assert.match(readyRoom, /<TowerRoomExpiry/);
    assert.match(readyRoom, /expectedVersion: party\.version/);
    assert.match(readyRoom, /Launch squad/);
    assert.match(readyRoom, /Incoming invitations/);
    assert.match(readyRoom, /Copy code/);
    assert.match(readyRoom, /Mark ready/);
    assert.match(readyRoom, /action: "kick"/);
    assert.match(readyRoom, /action: "revoke-invite"/);
    assert.match(readyRoom, /hostDisplayName \?\? invitation\.hostSlug/);
    assert.match(readyRoom, /memberRequirements/);
    assert.match(readyRoom, /clear through Story Floor/);
    assert.match(api, /requiredLevel\?: number/);
    assert.match(api, /retryLostTowerResponseOnce/);
    assert.match(readyRoom, /onPartyChange\(room\.party\)/);
    assert.match(readyRoom, /storyFloor == null \|\| !storyFloorActionable/);
    assert.match(lobby, /storyFloor=\{selected\}/);
    assert.match(lobby, /soloStartBlocked/);
    assert.match(lobby, /starting a solo Tower run/);
    assert.match(readyRoom, /\[\^ABCDEFGHJKLMNPQRSTUVWXYZ23456789\]/, "join codes must reject ambiguous I, O, 1, and 0 before submission");
});

test("Tower requests, lease recovery, and Spire entry fail bounded and truthful", () => {
    assert.match(api, /TOWER_REQUEST_TIMEOUT_MS = 12_000/);
    assert.match(api, /externalSignal\?\.addEventListener\('abort'/);
    assert.match(api, /externalSignal\?\.removeEventListener\('abort'/);
    assert.match(api, /run-publication-pending/);
    assert.match(wrapper, /server is still republishing this battlefield/);
    assert.match(wrapper, /run-unavailable/);
    assert.doesNotMatch(wrapper, /run-unavailable[\s\S]{0,120}?&&\s*error\.leaseReleased/, "every authoritative run-unavailable response must end stale recovery, even when no lease needed releasing");
    assert.doesNotMatch(lobby, /startSpireRun|enterPracticeSpire/);
    assert.match(lobby, /Prepare Spire Ready Room/);
    assert.match(readyRoom, /id="tower-ready-room-open-spire"/);
});

test("timed hold and Spire boss profiles remain visible from sealed authority", () => {
    assert.match(api, /roundsSurvived\?: number/);
    assert.match(api, /sealedCatalogFloor\?:/);
    assert.match(fight, /objective === "protect-npc"[\s\S]*?hold \$\{roundsSurvived\}/);
    assert.match(fight, /objective === "kill-escort"[\s\S]*?foe/);
    assert.match(fight, /session\.sealedCatalogFloor\?\.boss/);
    for (const target of ["squishiest", "support", "lowest-hp"] as const) assert.match(spireCatalog, new RegExp(`targetMode: "${target}"`));
    for (const strike of ["slam", "volley", "nova"] as const) assert.match(spireCatalog, new RegExp(`kind: "${strike}"`));
    assert.match(lobby, /towerTargetModeLabel\(sel\.boss\.targetMode\)/);
    assert.match(lobby, /towerStrikeLabel\(sel\.boss\.strike\)/);
    assert.match(lobby, /objective === "protect-npc"\) return `Hold \$\{roundBudget\} rounds`/);
    assert.match(lobby, /return `Par \/ score pace · \$\{roundBudget\} rounds`/);
});

test("Tower identity, board semantics, and countdown updates remain bounded", () => {
    assert.match(api, /export function towerPlayerSlug/);
    assert.match(fight, /const meSlug = towerPlayerSlug\(me\)/);
    assert.match(fight, /function TowerTurnCountdown/);
    assert.doesNotMatch(fight, /const \[nowTick/);
    assert.match(fight, /tabIndex=\{tileActionable \? 0 : -1\}/);
    assert.match(fight, /tabIndex=\{!busy && \(targetable \|\| selfTargetable\) \? 0 : -1\}/);
    assert.match(fight, /src=\{OBJECT_SPRITE\[o\.kind\]\} alt="" aria-hidden="true"/);
    assert.match(fight, /<TowerBattleDebrief session=\{session\}/);
    assert.match(tacticalCss, /\[role="dialog"\][\s\S]*?max-height:\s*calc\(100dvh - 24px\)/);
});

test("story floor access and replay fee copy stay aligned with server progression", () => {
    // Derived from shared/tower-pvp.ts so the browser gate cannot drift from
    // the server's; the value itself is still 30.
    assert.match(lobby, /TOWER_MIN_LEVEL = BATTLE_TOWERS_MIN_LEVEL/);
    assert.doesNotMatch(lobby, /STORY_MAX_FLOOR/);
    assert.match(lobby, /recommendedTowerStoryFloor\(ordered, bestFloor\)/);
    assert.match(storyCatalog, /floorId === best \+ 1/);
    assert.match(storyCatalog, /clearedFloors\.has\(floorId\) \|\| floorId === best \+ 1/);
    assert.match(lobby, /Cleared replay · no entry fee · this one-time package is not paid again/);
    assert.match(lobby, /selectedFloorCleared \? 0 : entryFee/);
});
