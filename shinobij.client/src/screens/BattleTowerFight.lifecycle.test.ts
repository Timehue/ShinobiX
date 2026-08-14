import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { towerPlayerSlug } from "../lib/towers-api";

const fightSource = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("./BattleTowers.tsx", import.meta.url), "utf8");
const lobbySource = readFileSync(new URL("./BattleTowersLobby.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");

describe("Tower combat ownership and lifecycle", () => {
    it("uses the canonical server-compatible slug for punctuation-bearing ownership and receipts", () => {
        assert.equal(towerPlayerSlug("  Hero Name!?  "), "heroname");
        assert.match(fightSource, /const meSlug = towerPlayerSlug\(me\)/);
        assert.match(fightSource, /const ownedByMe = \(slug: string \| null\) => !!slug && towerPlayerSlug\(slug\) === meSlug/);
        assert.match(fightSource, /const storySelf = [^\n]*ownedByMe\(a\.ownerSlug\)/);
        assert.match(fightSource, /ownedByMe\(activeActor\.ownerSlug\)/);
        assert.match(fightSource, /settlement\.response\?\.results\[meSlug\]/);
        assert.doesNotMatch(fightSource, /ownerSlug[^\n]*toLowerCase|me\.toLowerCase\(\)/);
        assert.doesNotMatch(lobbySource, /name\.toLowerCase\(\) === me\.toLowerCase\(\)/);
    });

    it("keeps the owned actor visible independently of the active actor", () => {
        assert.match(fightSource, /const myActor = session\.actors\.find\((?:actor|a) => (?:actor|a)\.side === "squad" && ownedByMe\((?:actor|a)\.ownerSlug\)\) \?\? null/);
        assert.doesNotMatch(fightSource, /const myActor = myTurn \? activeActor/);
        assert.match(fightSource, /const myChakra = myActor\?\.chakra \?\? 0/);
        assert.match(fightSource, /const myStamina = myActor\?\.stamina \?\? 0/);
    });

    it("clears every armed target when authority leaves the local actor", () => {
        const resetStart = fightSource.lastIndexOf("useEffect(() => {", fightSource.indexOf("if (myTurn) return;"));
        const resetEnd = fightSource.indexOf("// Reconnect:", resetStart);
        assert.ok(resetStart >= 0 && resetEnd > resetStart);
        const reset = fightSource.slice(resetStart, resetEnd);
        assert.match(reset, /if \(myTurn\) return/);
        assert.match(reset, /setMode\("idle"\)/);
        assert.match(reset, /setSelJutsu\(null\)/);
        assert.match(reset, /setSelWeaponId\(""\)/);
        assert.match(reset, /setHoverEnemyPos\(null\)/);
        assert.match(reset, /\[myTurn, activeId\]/);
    });

    it("settles once per in-flight request and accepts only a stable terminal receipt", () => {
        assert.match(fightSource, /if \(settlementPromiseRef\.current\) return settlementPromiseRef\.current/);
        assert.match(fightSource, /if \(response\.settled !== true\) return false/);
        assert.match(fightSource, /RETRYABLE_SETTLEMENT_REASONS\.has\(reason\)/);
        assert.match(fightSource, /if \(!isStableTowerSettlement\(response\)\) \{/);
        assert.match(fightSource, /phase: "error",[\s\S]*?message: settlementRetryMessage\(response, meSlug\)/);
        assert.match(fightSource, /if \(shouldSettle && settlement\.phase === "idle"\) void performSettlement\(\)/);
        assert.doesNotMatch(fightSource, /settledRef/);
        const settlementStart = fightSource.indexOf("const performSettlement = useCallback");
        const settlementEnd = fightSource.indexOf("// Reflection log", settlementStart);
        assert.doesNotMatch(fightSource.slice(settlementStart, settlementEnd), /\.catch\(\(\) => \{\}\)/);
    });

    it("keeps completion modal and exit semantics safe until settlement succeeds", () => {
        assert.match(fightSource, /const resultCanExit = !shouldSettle \|\| settlement\.phase === "settled"/);
        assert.match(fightSource, /aria-modal="true" aria-labelledby="tower-spire-result-title"/);
        assert.match(fightSource, /aria-modal="true" aria-labelledby="tower-story-result-title"/);
        assert.match(fightSource, /escapeAllowed: resultCanExit/);
        assert.match(fightSource, /aria-disabled=\{!resultCanExit\} disabled=\{!resultCanExit\}/);
        assert.match(fightSource, /Retry settlement/);
        assert.match(css, /\.tower-settlement-status--error/);
        assert.match(css, /\.screen-battleTowerFight \[role="dialog"\]:focus-visible/);
    });
});

describe("Tower completed-run recovery", () => {
    it("reopens active or done sessions and retains the recovery id on transient failure", () => {
        assert.match(hostSource, /fetchTowerState\(checkingRunId, character\.name, controller\.signal\)[\s\S]*?\.then\(toFight\)/);
        assert.doesNotMatch(hostSource, /session\.status === "active"\) toFight\(session\); else/);
        assert.match(hostSource, /setView\(\{ phase: "resumeError", runId: checkingRunId, message, terminal \}\)/);
        assert.match(hostSource, /view\.phase === "checking" \|\| view\.phase === "resumeError" \|\| view\.phase === "fight"/);
        assert.match(hostSource, /setTowerFightRunId\(view\.runId\)/);
    });

    it("requires deliberate recovery abandonment and exposes a retry path", () => {
        assert.match(hostSource, /Retry recovery/);
        assert.match(hostSource, /Recovery was paused\. Your run is still saved\./);
        assert.match(hostSource, /await gameConfirm\("Stop recovering this Tower run\?/);
        assert.match(hostSource, /if \(!confirmed\) return;[\s\S]*?clearRunKeys\(\)/);
    });

    it("keeps an independent MPvE breadcrumb when leaving only the active view", () => {
        assert.match(hostSource, /export const TOWER_RECOVERY_RUN_KEY = "shinobix:towerRecoveryRunId:v1"/);
        assert.match(hostSource, /localStorage\.getItem\(TOWER_RUN_KEY\) \?\? localStorage\.getItem\(TOWER_RECOVERY_RUN_KEY\)/);
        assert.match(hostSource, /onLeaveActive=\{\(\) => \{[\s\S]*?clearFightKey\(\);[\s\S]*?writeRecoveryKey\(view\.runId\);[\s\S]*?onExit\(\)/);
        assert.match(hostSource, /if \(view\.phase === "pvpFight"\) \{[\s\S]*?clearRecoveryKey\(\);[\s\S]*?setTowerPvpMatchId/);
        assert.match(fightSource, /\(onLeaveActive \?\? onExit\)\(\)/);
        assert.match(fightSource, /Reopen Battle Towers to recover it/);
    });
});
