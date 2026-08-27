import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { partitionCombatDisplayStatuses } from "../lib/combat-action-display.js";

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

    it("preserves timing fields in the Mission HUD and round-filters Tower status chips", () => {
        assert.match(missionSource, /activeRound: s\.activeRound/);
        assert.match(missionSource, /inactiveRound: s\.inactiveRound/);
        assert.equal((missionSource.match(/currentRound=\{session\.round\}/g) ?? []).length, 2);
        assert.match(towerSource, /activeCombatDisplayStatuses\(actor\.statuses, round\)/);
        assert.match(towerSource, /visibleStatuses\.slice\(0, 8\)/);
    });
});
