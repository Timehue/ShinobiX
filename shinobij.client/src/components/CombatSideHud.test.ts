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
const pvpSource = readFileSync(new URL("../screens/PvpBattleScreen.tsx", import.meta.url), "utf8");
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

    it("distinguishes effect strength from a literal damage or stat percentage", () => {
        const html = renderToStaticMarkup(createElement(CombatEffectsPanel, {
            title: "Buffs", statuses: [
                { name: "Increase Damage Given", percent: 30, rounds: 2 },
                { name: "Increase Generals", percent: 30, rounds: 2 },
                { name: "Increase Damage Given", source: "item-attack-pill", percent: 15, rounds: 2 },
            ],
        }));
        assert.match(html, /30% strength/);
        assert.match(html, /not the final damage change/);
        assert.match(html, /not a percentage increase to your current stats/);
        assert.match(html, /Attack Pill/);
        assert.match(html, /15% more direct-hit damage/);
        assert.doesNotMatch(html, /45% strength/, "fixed pill bonuses must not be pooled with jutsu strength");
    });

    it("shows a Drain tick in full, Lag/Overclock as AP, and a Barrier without its hex index", () => {
        const drain = { name: "Drain", rounds: 2, amount: 300, kind: "negative" as const };
        const panel = renderToStaticMarkup(createElement(CombatEffectsPanel, { title: "Debuffs", tone: "negative", statuses: [drain] }));
        assert.match(panel, /300 · 2r/, "a Drain lands its full amount, so the chip shows it");
        const lag = renderToStaticMarkup(createElement(CombatEffectsPanel, {
            title: "Debuffs", tone: "negative",
            statuses: [{ name: "Lag", rounds: 1, percent: 20, kind: "negative" as const }],
        }));
        assert.match(lag, /\+10 AP · 1r/);
        assert.doesNotMatch(lag, /20%/, "Lag is a flat AP swing; its stored percent is never read");
        const barrier = renderToStaticMarkup(createElement(CombatEffectsPanel, {
            title: "Buffs", statuses: [{ name: "Barrier", rounds: 2, amount: 37, kind: "positive" as const }],
        }));
        assert.match(barrier, /wall · 2r/);
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
        const missionHuds = missionSource.match(/<CombatSideHud\b[\s\S]*?\/>/g) ?? [];
        for (const [name, actor] of [["me", "myActor"], ["enemyName", "enemy"]] as const) {
            const hud = missionHuds.find(instance => instance.includes(`name={${name}}`));
            assert.ok(hud, `Mission HUD exists for ${name}`);
            assert.ok(hud.includes(`statuses={hudStatuses(${actor}?.statuses)}`), `${name} HUD receives its own statuses`);
            assert.match(hud, /currentRound=\{session\.round\}/, `${name} HUD filters statuses against the live round`);
        }
        assert.match(towerSource, /activeCombatDisplayStatuses\(actor\.statuses, round\)/);
        assert.match(towerSource, /visibleStatuses\.slice\(0, 8\)/);
    });

    it("passes the live round to retained battle logs independently of status HUDs", () => {
        for (const [mode, screen, selector] of [
            ["Mission", missionSource, "lines={session.log ?? []}"],
            ["PvP", pvpSource, "lines={battleLogLines}"],
            ["Tower mobile", towerSource, 'className="tower-mobile-battle-log"'],
            ["Tower desktop", towerSource, 'className="tower-rail-battle-log"'],
        ] as const) {
            const logs = screen.match(/<PlainCombatBattleLog\b[\s\S]*?\/>/g) ?? [];
            const log = logs.find(instance => instance.includes(selector));
            assert.ok(log, `${mode} retains its own battle-log surface`);
            assert.match(log, /currentRound=\{session\.round\}/, `${mode} log receives the fight round separately from retained groups`);
        }
    });
});
