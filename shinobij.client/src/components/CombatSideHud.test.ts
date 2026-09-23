import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { partitionCombatDisplayStatuses } from "../lib/combat-action-display.js";
import { CombatEffectsPanel, MobileEffectsStrip } from "./CombatSideHud.js";

const source = readFileSync(new URL("./CombatSideHud.tsx", import.meta.url), "utf8");
const missionSource = readFileSync(new URL("../screens/MissionArenaFight.tsx", import.meta.url), "utf8");
const towerSource = readFileSync(new URL("../screens/BattleTowerFight.tsx", import.meta.url), "utf8");
const statuses = [
    { name: "Increase Damage Given", rounds: 2, percent: 20, kind: "positive", activeRound: 2, inactiveRound: 3 },
    { name: "Increase Damage Given", rounds: 2, percent: 30, kind: "positive", activeRound: 3 },
] as const;

describe("CombatSideHud deferred status display", () => {
    it("keeps pending statuses out of active grouped totals", () => {
        const displayed = partitionCombatDisplayStatuses(statuses, 2);
        assert.deepEqual(displayed.active, [statuses[0]]);
        assert.deepEqual(displayed.pending, [statuses[1]]);
        assert.deepEqual(displayed.retired, []);
    });

    it("keeps a retired copy out of active totals when its replacement activates", () => {
        const displayed = partitionCombatDisplayStatuses(statuses, 3);
        assert.deepEqual(displayed.active, [statuses[1]]);
        assert.deepEqual(displayed.pending, []);
        assert.deepEqual(displayed.retired, [statuses[0]]);
    });

    it("wires live and next-round effects to separate HUD presentations", () => {
        assert.match(source, /partitionCombatDisplayStatuses\(statuses, currentRound\)/);
        assert.match(source, /<MobileEffectsStrip statuses=\{displayedStatuses\.active\} \/>/);
        assert.match(source, /<PendingEffectsStrip statuses=\{displayedStatuses\.pending\} \/>/);
        assert.match(source, /aria-label="Effects activating next round"/);
        assert.match(source, />Next round</);
        assert.match(source, /statuses=\{displayedStatuses\.active\.filter/);
    });

    it("labels raw general and discipline percentages as potency", () => {
        assert.match(source, /POTENCY_TAGS/);
        assert.match(source, /`\$\{rawPct\}% potency`/);
        assert.match(source, /raw potency, converted into a flat bonus through diminishing returns/);
    });

    it("shows the Smoke Bomb source by name in player debuffs", () => {
        const smoke = { name: "Decrease Damage Given", source: "item-smoke-bomb", percent: 100, rounds: 1, kind: "negative" as const };
        const desktop = renderToStaticMarkup(createElement(CombatEffectsPanel, { title: "Debuffs", tone: "negative", statuses: [smoke] }));
        assert.match(desktop, /Smoke Bomb/);
        assert.doesNotMatch(desktop, /Damage dealt ↓/);
        const mobile = renderToStaticMarkup(createElement(MobileEffectsStrip, { statuses: [smoke] }));
        assert.match(mobile, /title="Smoke Bomb/);
        assert.match(mobile, />Smoke</);
        const crowded = renderToStaticMarkup(createElement(MobileEffectsStrip, {
            statuses: [{ name: "Increase Damage Given", rounds: 2, kind: "positive" as const }, smoke], max: 1,
        }));
        assert.match(crowded, /title="Smoke Bomb/);
        assert.match(towerSource, /status\.source === "item-smoke-bomb" \? "SMOKE"/);
        assert.match(towerSource, /Number\(b\.source === "item-smoke-bomb"\)/);
    });

    it("preserves timing fields in the Mission HUD and round-filters Tower status chips", () => {
        assert.match(missionSource, /activeRound: s\.activeRound/);
        assert.match(missionSource, /source: s\.source/);
        assert.match(missionSource, /inactiveRound: s\.inactiveRound/);
        assert.equal((missionSource.match(/currentRound=\{session\.round\}/g) ?? []).length, 2);
        assert.match(towerSource, /activeCombatDisplayStatuses\(actor\.statuses, round\)/);
        assert.match(towerSource, /visibleStatuses\.slice\(0, 8\)/);
    });
});
