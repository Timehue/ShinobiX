import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");
const missionCss = readFileSync(new URL("../styles/mission-arena-fight.css", import.meta.url), "utf8");
const legacySolo = readFileSync(new URL("../screens/Arena.tsx", import.meta.url), "utf8");
const solo = readFileSync(new URL("../screens/MissionArenaFight.tsx", import.meta.url), "utf8");
const pvp = readFileSync(new URL("../screens/PvpBattleScreen.tsx", import.meta.url), "utf8");
const tacticalPve = readFileSync(new URL("../screens/BattleTowerFight.tsx", import.meta.url), "utf8");
const combatHud = readFileSync(new URL("../components/CombatHudLayout.tsx", import.meta.url), "utf8");
const detailPortal = readFileSync(new URL("../components/CombatDetailPortal.tsx", import.meta.url), "utf8");
const shellCss = css.slice(css.indexOf("SHINOBI COMBAT SHELL"));

test("combat modes share HUD primitives while mission PvE retains its desktop battlefield composition", () => {
    for (const source of [legacySolo, pvp]) {
        assert.match(source, /<ShinobiCombatShell/);
        assert.match(source, /<CombatHudLayout/);
        assert.match(source, /<CombatHudMain/);
        assert.match(source, /<CombatBoardStage/);
        assert.match(source, /<CombatCommandBar/);
    }
    assert.match(solo, /<CombatInstance/);
    assert.doesNotMatch(solo, /<ShinobiCombatShell/);
    assert.match(solo, /<CombatHudLayout/);
    assert.match(solo, /<CombatHudMain/);
    assert.doesNotMatch(solo, /<CombatBoardStage/);
    assert.match(solo, /<CombatCommandBar/);
    assert.match(legacySolo, /<CombatBattleLogPanel/);
    assert.match(solo, /<PlainCombatBattleLog/);
    assert.match(pvp, /<PlainCombatBattleLog/);
    for (const source of [solo, pvp]) {
        assert.match(source, /<CombatJutsuMeta/);
    }
    assert.match(combatHud, /classNames\("combat-board-stage", className\)/);
    assert.match(css, /container: shinobi-combat \/ size/);
    assert.match(css, /--combat-board-aspect: 1\.6214/);
    assert.match(css, /width: min\(100cqw, calc\(100cqh \* var\(--combat-board-aspect\)\)\)/);
    assert.match(css, /height: min\(100cqh, calc\(100cqw \/ var\(--combat-board-aspect\)\)\)/);
});

test("mode-only chat and pet controls stay owned by their battle screens", () => {
    assert.doesNotMatch(combatHud, /battle-chat|GiPawPrint|type: "summon"/);
    assert.match(
        pvp,
        /<\/CombatHudMain>[\s\S]*?className=\{`battle-chat-panel/,
        "PvP chat must remain a PvP-owned side panel tied into the shared layout",
    );
    assert.match(
        solo,
        /<CombatCommandBar>[\s\S]*?type: "summon"[\s\S]*?<\/CombatCommandBar>/,
        "authoritative PvE pet summon must remain inside the shared command slot",
    );
    assert.match(
        legacySolo,
        /<CombatCommandBar>[\s\S]*?canSummonPet[\s\S]*?<\/CombatCommandBar>/,
        "legacy PvE pet summon must remain inside the shared command slot",
    );
    assert.match(
        tacticalPve,
        /className="basic-action-bar shinobi-command-bar"[\s\S]*?type: "summon"[\s\S]*?Summon Pet/,
        "tactical PvE must expose the server-owned pet summon when a companion is sealed",
    );
    assert.match(solo, /<span>Summon Pet<\/span>/, "authoritative PvE must label the summon explicitly");
    assert.match(legacySolo, /<span>Summon Pet<\/span>/, "legacy PvE must label the summon explicitly");
});

test("shared-shell dossiers remain symmetric and mission PvE restores its desktop columns", () => {
    assert.match(css, /@container shinobi-combat \(min-width: 1360px\) and \(min-height: 820px\)/);
    assert.match(css, /grid-template-columns: clamp\(210px, 14cqw, 260px\) minmax\(0, 1fr\) clamp\(210px, 14cqw, 260px\)/);
    assert.match(shellCss, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) !important/);
    assert.doesNotMatch(shellCss, /minmax\(235px[^}]*minmax\(620px/);
    assert.match(
        missionCss,
        /grid-template-columns:\s*minmax\(140px, 210px\) minmax\(0, 1fr\) minmax\(140px, 210px\)/,
    );
});

test("shell pins optional notices and accessible controls without hard battlefield heights", () => {
    assert.match(css, /\.combat-action-notice[\s\S]*?grid-area: notice !important/);
    const shortestPhoneTier = shellCss.match(
        /@container shinobi-combat \(max-width: 520px\) and \(max-height: 700px\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";
    assert.match(shortestPhoneTier, /\.combat-action-notice[\s\S]*?position: static !important/);
    assert.match(shortestPhoneTier, /\.combat-action-notice[\s\S]*?height: 18px !important/);
    assert.doesNotMatch(shortestPhoneTier, /\.combat-action-notice[\s\S]*?position: absolute !important/);
    assert.match(shellCss, /grid-template-areas:\s*"ap"\s*"terrain"\s*"board"\s*"tabs"\s*"notice"\s*"commands"\s*"panel"/);
    assert.equal((solo.match(/className="combat-action-notice"/g) ?? []).length, 1);
    assert.match(css, /\.shinobi-command-bar > button[\s\S]*?min-height: 44px !important/);
    assert.doesNotMatch(shellCss, /\.hex-battlefield[^{]*\{[^}]*min-height:\s*(?:[3-9]\d{2}|\d{4,})px/);
});

test("combat details use a modal backdrop with bounded keyboard focus", () => {
    assert.match(detailPortal, /className="combat-detail-backdrop"/);
    assert.match(detailPortal, /aria-modal="true"/);
    assert.match(detailPortal, /event\.key !== "Tab"/);
    assert.match(detailPortal, /active === dialog \|\| !dialog\.contains\(active\)/);
    assert.match(detailPortal, /onCloseRef\.current\(\)/);
    assert.match(css, /body > \.combat-detail-backdrop[\s\S]*?position: fixed/);
    assert.match(css, /body > \.combat-detail-backdrop[\s\S]*?z-index: var\(--z-combat-hud\)/);
    assert.match(pvp, /\[\.\.\.pvpEquippedWeapons, \.\.\.pvpEquippedThrown\][\s\S]*?\.find\(x => x\.id === inspectedWeaponId\)/);
});

test("PvP refresh guard preserves the live battle breadcrumb until restore installs its id", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const guard = app.indexOf("if (restoringSession && !pvpBattleId) return;");
    const removal = app.indexOf("localStorage.removeItem(PVP_SESSION_KEY)", guard);
    assert.ok(guard >= 0, "restore guard must exist");
    assert.ok(removal > guard, "breadcrumb removal must remain behind the restore guard");
});
