import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");
const missionCss = readFileSync(new URL("../styles/mission-arena-fight.css", import.meta.url), "utf8");
const solo = readFileSync(new URL("../screens/MissionArenaFight.tsx", import.meta.url), "utf8");
const pvp = readFileSync(new URL("../screens/PvpBattleScreen.tsx", import.meta.url), "utf8");
const shellCss = css.slice(css.indexOf("SHINOBI COMBAT SHELL"));

test("PvP and authoritative Solo PvE adopt one shell and aspect-locked board stage", () => {
    for (const source of [solo, pvp]) {
        assert.match(source, /<ShinobiCombatShell/);
        assert.match(source, /className="combat-board-stage"/);
        assert.match(source, /<CombatJutsuMeta/);
    }
    assert.match(css, /container: shinobi-combat \/ size/);
    assert.match(css, /--combat-board-aspect: 1\.6214/);
    assert.match(css, /width: min\(100cqw, calc\(100cqh \* var\(--combat-board-aspect\)\)\)/);
    assert.match(css, /height: min\(100cqh, calc\(100cqw \/ var\(--combat-board-aspect\)\)\)/);
});

test("side dossiers require both usable width and height and remain symmetric", () => {
    assert.match(css, /@container shinobi-combat \(min-width: 1360px\) and \(min-height: 820px\)/);
    assert.match(css, /grid-template-columns: clamp\(210px, 14cqw, 260px\) minmax\(0, 1fr\) clamp\(210px, 14cqw, 260px\)/);
    assert.match(shellCss, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) !important/);
    assert.doesNotMatch(shellCss, /minmax\(235px[^}]*minmax\(620px/);
    assert.doesNotMatch(missionCss, /grid-template-columns/);
});

test("shell pins optional notices and accessible controls without hard battlefield heights", () => {
    assert.match(css, /\.combat-action-notice[\s\S]*?grid-area: notice !important/);
    assert.match(shellCss, /@container shinobi-combat \(max-width: 520px\) and \(max-height: 700px\)[\s\S]*?\.combat-action-notice[\s\S]*?position: absolute !important/);
    assert.match(shellCss, /grid-template-areas:\s*"ap"\s*"terrain"\s*"board"\s*"tabs"\s*"notice"\s*"commands"\s*"panel"/);
    assert.equal((solo.match(/className="combat-action-notice"/g) ?? []).length, 1);
    assert.match(css, /\.shinobi-command-bar > button[\s\S]*?min-height: 44px !important/);
    assert.doesNotMatch(shellCss, /\.hex-battlefield[^{]*\{[^}]*min-height:\s*(?:[3-9]\d{2}|\d{4,})px/);
});

test("PvP refresh guard preserves the live battle breadcrumb until restore installs its id", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const guard = app.indexOf("if (restoringSession && !pvpBattleId) return;");
    const removal = app.indexOf("localStorage.removeItem(PVP_SESSION_KEY)", guard);
    assert.ok(guard >= 0, "restore guard must exist");
    assert.ok(removal > guard, "breadcrumb removal must remain behind the restore guard");
});
