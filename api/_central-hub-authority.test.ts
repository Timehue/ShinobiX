import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const app = readFileSync("shinobij.client/src/App.tsx", "utf8");
const hub = readFileSync("shinobij.client/src/screens/CentralHub.tsx", "utf8");
const arena = readFileSync("shinobij.client/src/screens/Arena.tsx", "utf8");
const council = readFileSync("shinobij.client/src/screens/ShinobiCouncilHall.tsx", "utf8");
const capabilities = readFileSync("api/player/_public-capabilities.ts", "utf8");
const liveNotice = readFileSync("shinobij.client/src/lib/live-capabilities.ts", "utf8");
const endlessActions = readFileSync("shinobij.client/src/lib/use-endless-tower-actions.ts", "utf8");
const endlessFight = readFileSync("shinobij.client/src/screens/EndlessTowerFight.tsx", "utf8");

describe("Central Hub release authority", () => {
    it("settles Awakening and Bloodline Forge on the server", () => {
        assert.match(hub, /rollAwakeningServer\(character\.name,\s*kind\)/);
        assert.match(hub, /purchaseBloodlineForge\(character\.name,\s*rank\)/);
        assert.doesNotMatch(hub, /rollNewAwakeningElement|rollAwakeningElements/);
    });

    it("keeps every Crafter roll and material debit on the server", () => {
        assert.match(hub, /rollNamedForgeServer/);
        assert.match(hub, /commitNamedForgeServer/);
        assert.match(hub, /forgeServer/);
        assert.doesNotMatch(hub, /Math\.random|function\s+\w+Local\(/);
    });

    it("settles keyed dungeons and every Endless Tower mutation on the server", () => {
        assert.match(app, /mutateDungeonRunServer\(character\.name,\s*"start"\)/);
        assert.match(app, /mutateDungeonRunServer\(character\.name,\s*"settle",\s*token\)/);
        // Abandon is still server-owned, but no longer from a single call site:
        // the Warden-DEFEAT path (App's old failDungeon) went away with the
        // browser-side Arena reducer that hosted that fight — a loss now settles
        // in api/missions/report-ai-fight.ts via applyDungeonWardenSettlement.
        // What remains client-side is the manual exit (leaveDungeon) and the
        // boot sweep for a stale token, so match the call rather than one binding.
        assert.match(app, /mutateDungeonRunServer\([^,]+,\s*"abandon",\s*\w+\)/);
        assert.doesNotMatch(app, /activeDungeonRun[^\n]*=\s*null;?\s*\/\/\s*local/i,
            "a dungeon run must never be closed out purely client-side");
        for (const action of ["start", "settle", "cashout"]) {
            assert.match(endlessActions, new RegExp(`mutateEndlessRun\\([^\\n]+,\\s*"${action}"`));
        }
        assert.match(endlessActions, /startEndlessWave\(/);
        assert.match(endlessFight, /soloPveArenaTransport/);
        assert.match(endlessFight, /MissionArenaFight/);
        assert.doesNotMatch(`${app}\n${endlessActions}`, /payEndlessEntry\(|applyTowerCashOut\(|prepareOpponent|endlessSettlementPending/);
        assert.doesNotMatch(endlessActions, /aiFightToken|\bhp\s*:|\bchakra\s*:|\bstamina\s*:/);
        assert.doesNotMatch(arena, /onEndless|endlessBattleWave/);
    });

    it("uses current war receipts for Council contributors", () => {
        assert.match(council, /Object\.values\(war\.contributions \?\? \{\}\)/);
        assert.match(council, /fetch\("\/api\/clan\/war\/list"\)/);
        assert.doesNotMatch(council, /totalVillageRaids|clanContribTotal/);
    });

    it("keeps the Weekly Boss live by default and emits no static release warning", () => {
        assert.match(capabilities, /weeklyBossGuardEnabled\(env\) \? available/);
        assert.match(liveNotice, /capability\.state === "available"/);
        assert.doesNotMatch(liveNotice, /soft-launch|desktop-first|staffed beta/i);
    });
});
