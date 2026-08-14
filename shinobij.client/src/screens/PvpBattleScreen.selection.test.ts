import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./PvpBattleScreen.tsx", import.meta.url), "utf8");
const typeSource = readFileSync(new URL("../types/pvp-ui.ts", import.meta.url), "utf8");

describe("PvP armed-jutsu response ownership", () => {
    it("retains the submitted jutsu through targeting and structured soft rejection", () => {
        const tileHandler = source.slice(source.indexOf("function handleTileClick"), source.indexOf("function selectJutsu"));
        assert.doesNotMatch(tileHandler, /clearPendingPvpJutsu\(\)/);

        const rejectedBranch = source.slice(source.indexOf("if (data.rejected)"), source.indexOf("setSession(data)"));
        assert.doesNotMatch(rejectedBranch, /clearPendingPvpJutsu|clearSubmittedPvpJutsu/);
    });

    it("clears only the exact submitted jutsu after an applied response", () => {
        assert.match(source, /setPendingJutsuId\(current => current === jutsuId \? "" : current\)/);
        assert.match(source, /setPendingJutsuDirect\(current => current\?\.id === jutsuId \? null : current\)/);
        assert.match(source, /if \(pvpAction === "jutsu" && pvpJutsuId\) clearSubmittedPvpJutsu\(pvpJutsuId\)/);
        assert.match(source, /submitInFlightRef\.current = true/);
        assert.match(source, /finally \{ clearTimeout\(moveTimeout\); submitInFlightRef\.current = false;/);
    });

    it("keeps canonical Barrier tiles out of move and ground-jutsu affordances", () => {
        assert.match(typeSource, /source\?: string/);
        assert.match(typeSource, /activeRound\?: number/);
        assert.match(source, /activeBarrierTilesForDisplay\(\[\.\.\.session\.p1\.statuses, \.\.\.session\.p2\.statuses\], session\.round, gridWidth \* gridHeight\)/);
        assert.match(source, /pvpHexNeighbors\(boardMyPos\)\.filter\(t => t !== boardOppPos && !pvpBarrierTiles\.has\(t\)\)/);
        assert.match(source, /t !== boardOppPos && !pvpBarrierTiles\.has\(t\) && pvpDist\(boardMyPos, t\) <= jutsuRange/);
        assert.match(source, /isBarrier \? " combat-barrier-tile"/);
        assert.match(source, /Barrier wall, impassable/);
    });
});

describe("PvP paid-action affordance parity", () => {
    it("round-filters ordinary PvP costs and preserves the canonical jutsu policy", () => {
        const setup = source.slice(source.indexOf("const pvpActionAvailability"), source.indexOf("async function submitAction"));
        assert.match(setup, /round: session\.round/);
        assert.match(setup, /apModifierMode: "first-active"/);
        assert.match(setup, /pvpJutsuActionAvailability[\s\S]*?apModifierMode: "stack"/);
    });

    it("routes every paid basic and item control through adjusted affordability", () => {
        const setup = source.slice(source.indexOf("const basicAttackAvailability"), source.indexOf("async function submitAction"));
        assert.match(setup, /basicAttackAvailability = pvpActionAvailability\(40, \{ staminaCost: 10 \}\)/);
        assert.match(setup, /moveAvailability = pvpActionAvailability\(30\)/);
        assert.match(setup, /healAvailability = pvpActionAvailability\(60, \{ chakraCost: 10, cooldownRemaining:/);
        assert.match(setup, /clearAvailability = pvpActionAvailability\(60, \{ cooldownRemaining:/);
        assert.match(setup, /cleanseAvailability = pvpActionAvailability\(60, \{ cooldownRemaining:/);
        assert.match(setup, /fleeAvailability = pvpActionAvailability\(100\)/);

        const commandBar = source.slice(source.indexOf("<CombatCommandBar style="), source.indexOf("</CombatCommandBar>"));
        for (const name of ["basicAttack", "move", "heal", "clear", "cleanse", "flee"]) {
            assert.match(commandBar, new RegExp(`\\{${name}Availability\\.apCost\\} AP`), `${name} must show its adjusted AP`);
            assert.match(commandBar, new RegExp(`!${name}Availability\\.affordable`), `${name} must use shared affordability`);
        }

        const actionGrid = source.slice(source.indexOf("{sessionEquippedJutsu.map"), source.indexOf("{inspectedWeaponId &&"));
        assert.equal((actionGrid.match(/pvpActionAvailability\(item\.apCost \?\?/g) ?? []).length, 3,
            "weapon, thrown, and consumable cards must all use ordinary PvP affordability");
        assert.equal((actionGrid.match(/!availability\.affordable/g) ?? []).length, 4,
            "jutsu, weapon, thrown, and consumable cards must all use shared affordability");
        assert.match(actionGrid, /\{apCost\} AP/, "item labels must show adjusted AP");
    });

    it("includes canonical jutsu resource, cooldown, and elemental-seal inputs", () => {
        const jutsuCards = source.slice(source.indexOf("{sessionEquippedJutsu.map"), source.indexOf("{/* ── Weapon cards"));
        assert.match(jutsuCards, /pvpJutsuActionAvailability\(j\.ap \?\? 40, \{[\s\S]*?chakraCost: j\.chakraCost \?\? 0/);
        assert.match(jutsuCards, /staminaCost: j\.staminaCost \?\? 0/);
        assert.match(jutsuCards, /cooldownRemaining,/);
        assert.match(jutsuCards, /element: j\.element/);
        assert.match(jutsuCards, /availability\.sealed \? "Elementally sealed"/);
        assert.match(jutsuCards, /disabled=\{!isMyTurn \|\| submitting \|\| !availability\.affordable\}/);
        assert.match(jutsuCards, /sealedResourceCosts=\{\{[\s\S]*?chakraCost: j\.chakraCost \?\? 0,[\s\S]*?staminaCost: j\.staminaCost \?\? 0/);
        assert.match(source, /Chakra Cost:<\/strong> \{Math\.max\(0, Number\(inspectedJutsu\.chakraCost\) \|\| 0\)\}/);
        assert.match(source, /Stamina Cost:<\/strong> \{Math\.max\(0, Number\(inspectedJutsu\.staminaCost\) \|\| 0\)\}/);
        assert.doesNotMatch(source, /jutsuResourceDisplay\(inspectedJutsu/);
    });

    it("auto-passes only from the current authoritative eligibility snapshot", () => {
        assert.match(source, /hasAffordablePvpPaidAction\(\{/);
        assert.match(source, /statuses: pvpSnapshotFighter\.statuses/);
        assert.match(source, /cooldowns: pvpSnapshotCooldowns/);
        assert.match(source, /itemCharges: pvpSnapshotCharges/);
        assert.match(source, /if \(!pvpHasAffordablePaidAction\)/);
        assert.doesNotMatch(source, /pvpMinActionCost/);
        assert.doesNotMatch(source, /const newAp = role === "p1" \? data\.ap\.p1 : data\.ap\.p2/);

        const submitAction = source.slice(source.indexOf("async function submitAction"));
        const appliedStart = submitAction.indexOf("setSession(data)");
        const appliedResponse = submitAction.slice(appliedStart, submitAction.indexOf("} else {", appliedStart));
        assert.doesNotMatch(appliedResponse, /setTimeout\(\(\) => submitAction\("wait"\)/,
            "a response must not auto-wait using pre-response Lag, cooldown, or resource closures");
    });
});
