import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");
const missionCss = readFileSync(new URL("../styles/mission-arena-fight.css", import.meta.url), "utf8");
const arenaLobby = readFileSync(new URL("../screens/Arena.tsx", import.meta.url), "utf8");
const arenaDistrictLobby = readFileSync(new URL("../features/arena/components/ArenaDistrictLobby.tsx", import.meta.url), "utf8");
const solo = readFileSync(new URL("../screens/MissionArenaFight.tsx", import.meta.url), "utf8");
const pvp = readFileSync(new URL("../screens/PvpBattleScreen.tsx", import.meta.url), "utf8");
const tacticalPve = readFileSync(new URL("../screens/BattleTowerFight.tsx", import.meta.url), "utf8");
const combatHud = readFileSync(new URL("../components/CombatHudLayout.tsx", import.meta.url), "utf8");
const detailPortal = readFileSync(new URL("../components/CombatDetailPortal.tsx", import.meta.url), "utf8");
const shellCss = css.slice(css.indexOf("SHINOBI COMBAT SHELL"));
const desktopCommandCenter = css.slice(css.indexOf("Desktop-only command center"));

test("combat modes share the authoritative shell and HUD primitives while mission PvE retains its desktop battlefield composition", () => {
    assert.match(pvp, /<ShinobiCombatShell/);
    assert.match(pvp, /<CombatHudLayout/);
    assert.match(pvp, /<CombatHudMain/);
    assert.match(pvp, /<CombatBoardStage/);
    assert.match(pvp, /<CombatCommandBar/);
    assert.match(solo, /<ShinobiCombatShell[\s\S]*?mode="solo"/);
    assert.match(solo, /<CombatHudLayout/);
    assert.match(solo, /<CombatHudMain/);
    assert.doesNotMatch(solo, /<CombatBoardStage/);
    assert.match(solo, /<CombatCommandBar/);
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
        tacticalPve,
        /className="basic-action-bar shinobi-command-bar"[\s\S]*?type: "summon"[\s\S]*?Summon Pet/,
        "tactical PvE must expose the server-owned pet summon when a companion is sealed",
    );
    assert.match(solo, /<span>Summon Pet<\/span>/, "authoritative PvE must label the summon explicitly");
});

test("wide desktop shares one command center and gives unused mode space to the battle log", () => {
    assert.match(desktopCommandCenter, /@media \(min-width: 1280px\) and \(min-height: 700px\)/);
    assert.match(desktopCommandCenter, /@container shinobi-combat \(min-width: 1180px\) and \(min-height: 660px\)/);
    assert.match(desktopCommandCenter, /grid-template-columns:[\s\S]*?clamp\(190px, 15cqw, 260px\)[\s\S]*?minmax\(0, 1\.7fr\)[\s\S]*?minmax\(240px, 0\.9fr\)/);
    assert.match(desktopCommandCenter, /"loadout loadout log mode mode" !important/);
    assert.match(desktopCommandCenter, /#combat \.combat-layout > \.combat-main-area,[\s\S]*?display: contents !important/);
    assert.match(desktopCommandCenter, /#combat \.combat-mode-panel,\s*#combat \.battle-chat-col[\s\S]*?grid-area: mode !important/);
    assert.match(desktopCommandCenter, /#combat\.mission-arena-fight \.shinobi-command-bar\s*\{[^}]*grid-template-columns: repeat\(8, minmax\(0, 1fr\)\) !important/);
    assert.match(desktopCommandCenter, /#combat \.combat-layout\.combat-log-wide \.combat-text-log\s*\{[^}]*grid-column: 3 \/ 6 !important/);
    assert.match(solo, /<CombatHudLayout className="combat-log-wide" hasActionNotice>/);
    assert.doesNotMatch(solo, /CombatModePanel|combat-companion-summon/);
    assert.match(pvp, /className=\{`battle-chat-panel battle-chat-col/);
    assert.match(pvp, /className=\{battleChatVisible \? undefined : "combat-log-wide combat-chat-collapsed"\}/);
    for (const source of [solo, pvp]) {
        assert.match(source, /role="region"\s*aria-label="Jutsu, weapons, and items"/);
    }
});

test("the Arena screen stays a lobby and never hosts a fight again", () => {
    // Solo PvE moved server-side; Arena's browser-side reducer was deleted. If a
    // combat shell, a board, or a turn/HP reducer reappears here, a client-
    // authoritative fight has been reintroduced behind the lobby.
    for (const marker of [
        /<ShinobiCombatShell/, /<CombatHudLayout/, /<CombatBoardStage/, /<CombatCommandBar/,
        /<CombatInstance/, /hex-battlefield/, /setBattleStarted/, /startPrefight/,
        /function calculateDamage|calculateDamage\(/, /setEnemyHp\(/, /setPlayerHp\(/,
    ]) {
        assert.doesNotMatch(arenaLobby, marker, `Arena must not regain combat internals: ${marker}`);
    }
    // What it DOES still own — note this screen is now a 499-line composition
    // root, not the 870-line lobby that inlined all of it, so several of these
    // assert on WHERE the work lives rather than that it is written inline.
    // The lobby markup moved to the feature component it renders.
    assert.match(arenaLobby, /<ArenaDistrictLobby/);
    assert.match(arenaDistrictLobby, /className="card arena-lobby"/);
    // The outgoing challenge is still authored here.
    assert.match(arenaLobby, /async function challengePlayer/);
    // Ranked queueing is owned by its hook; Arena consumes it and wires it out.
    assert.match(arenaLobby, /useRankedQueue\(\{/);
    assert.match(arenaLobby, /onJoinRankedQueue=\{joinRankedQueue\}/);
    // Challenge ACCEPTANCE is delegated to the App, which owns the save write.
    // Arena must not grow a second acceptance authority alongside it.
    assert.doesNotMatch(arenaLobby, /async function acceptChallenge\b/,
        "challenge acceptance belongs to App.acceptChallengeGlobal, not the lobby");
});

test("shared-shell dossiers remain symmetric and mission PvE restores its desktop columns", () => {
    assert.match(css, /@container shinobi-combat \(min-width: 1180px\) and \(min-height: 660px\)/);
    assert.match(css, /grid-template-columns: clamp\(210px, 14cqw, 260px\) minmax\(0, 1fr\) clamp\(210px, 14cqw, 260px\)/);
    assert.match(css, /grid-template-areas: "header" "ap" "terrain" "board" "tabs" "notice" "commands" "panel"/);
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
    // The breadcrumb write/erase moved into lib/use-pvp-session-controller.ts,
    // which holds the same guard against the initial null state erasing a live
    // battle id before restore has consumed it.
    const controller = readFileSync(new URL("./use-pvp-session-controller.ts", import.meta.url), "utf8");
    const guard = controller.indexOf("if (options.restoringSession && !scopedBattleId) return;");
    const removal = controller.indexOf("localStorage.removeItem(options.storageKey)", guard);
    assert.ok(guard >= 0, "restore guard must exist");
    assert.ok(removal > guard, "breadcrumb removal must remain behind the restore guard");
});
