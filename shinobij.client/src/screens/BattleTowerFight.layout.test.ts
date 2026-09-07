import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");
const tacticalCss = readFileSync(new URL("../styles/tower-tactical.css", import.meta.url), "utf8");
const combatCoreCss = readFileSync(new URL("../styles/index/06-combat-core.css", import.meta.url), "utf8");

describe("Tower narrow combat composition", () => {
    it("reserves a usable portrait board and contains both action bands", () => {
        assert.match(css, /@media \(max-width: 979px\) \{/,
            "portrait tablets through 979px must keep the same explicit board/rail containment as phones");
        assert.match(css, /grid-template-rows: minmax\(0, 1fr\) 82px !important/);
        assert.match(css, /\.tower-board-area \{[\s\S]*?min-height: 90px !important/);
        assert.match(source, /className="tower-action-dock"/);
        assert.match(source, /<BattleTabBar tab=\{battleTabs\.tab\}/,
            "compact Tower combat must expose the same Actions/Battle Log switch as the PvP HUD");
        assert.match(tacticalCss, /\.tower-action-dock > \.shinobi-command-bar \{[\s\S]*?flex-wrap: nowrap !important;[\s\S]*?overflow: auto hidden/);
        assert.match(tacticalCss, /\.tower-action-dock > \.combat-jutsu-bar \{[\s\S]*?height: 96px !important;/);
        assert.match(
            tacticalCss,
            /@media \(max-width: 979px\) \{[\s\S]*?\.tower-action-dock \.combat-equipped-jutsu-grid \{[\s\S]*?grid-template-columns: none !important;[\s\S]*?grid-auto-flow: column !important;[\s\S]*?grid-auto-columns: clamp\(100px, 18vw, 132px\) !important;[\s\S]*?overflow-x: auto !important;[\s\S]*?overflow-y: hidden !important;/,
            "compact Tower loadouts must keep all jutsu and items in one horizontally reachable row",
        );
        assert.match(
            css,
            /html body > \.arena-fullscreen\.shinobi-combat-shell \.combat-equipped-jutsu-grid \{[\s\S]*?grid-template-columns: repeat\(auto-fill, minmax\(clamp\(100px, 12cqw, 132px\), 1fr\)\) !important;/,
            "compact Tower loadouts must inherit the same responsive card floor as PvP and PvE",
        );
    });

    it("keeps secondary telemetry out of the central battlefield and fits every desktop command", () => {
        assert.match(
            tacticalCss,
            /#combat\.tower-tactical-combat \.tower-turn-queue,[\s\S]*?#combat\.tower-tactical-combat \.tower-threat-summary,[\s\S]*?#combat\.tower-tactical-combat \.tower-mechanic-strip \{[\s\S]*?display: none !important;/,
        );
        assert.match(tacticalCss, /\.tower-board-help \{\s*display: none;/);
        assert.match(
            tacticalCss,
            /#combat\.tower-tactical-combat \.tower-action-dock > \.shinobi-command-bar \{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(64px, 1fr\)\) !important;[\s\S]*?overflow: hidden !important;/,
            "desktop basic actions must fit the available main column without a clipped horizontal rail",
        );
    });

    it("keeps the narrow enemy-rail battle log header inside its bounds", () => {
        assert.match(
            tacticalCss,
            /\.tower-rail-battle-log:not\(\.is-expanded\) \.combat-log-turn,[\s\S]*?\.tower-rail-battle-log:not\(\.is-expanded\) \.combat-log-expand-label \{\s*display: none;/,
        );
        assert.match(
            tacticalCss,
            /\.tower-rail-battle-log:not\(\.is-expanded\) \.combat-log-expand \{[\s\S]*?width: 36px;[\s\S]*?min-width: 36px;/,
        );
        assert.match(
            tacticalCss,
            /\.tower-rail-battle-log:not\(\.is-expanded\) \.combat-log-title \{[\s\S]*?flex-direction: column;[\s\S]*?overflow: hidden;/,
        );
    });

    it("spends the compact action dock on commands and the shared loadout scale", () => {
        assert.match(
            tacticalCss,
            /@media \(max-width: 979px\) \{[\s\S]*?\.tower-action-dock > \.shinobi-command-bar \{[\s\S]*?height: 48px;[\s\S]*?\.tower-action-dock > \.combat-jutsu-bar \{[\s\S]*?height: 96px !important/,
            "reduced-height layouts through 979px must style the production action dock's horizontal bands",
        );
        assert.match(css, /@media \(max-width: 979px\) and \(max-height: 500px\) \{/);
        assert.match(css, /\.tower-fight-grid > aside \{\s*display: none !important/);
        assert.match(css, /@media \(max-width: 979px\) and \(max-height: 500px\) \{[\s\S]*?\.tower-fight-header \{[\s\S]*?flex: 0 0 44px/);
        assert.match(css, /\.tower-fight-header > button \{[\s\S]*?height: 44px;[\s\S]*?min-height: 44px/);
        assert.doesNotMatch(source, /className="tower-action-topline"/,
            "compact action geometry must not reserve the removed visible guidance row");
    });

    it("gives the battlefield the compact 960 by 600 browser-zoom tier", () => {
        assert.match(css, /@media \(max-width: 979px\) \{/);
        assert.match(css, /@media \(max-width: 979px\) and \(max-height: 500px\) \{[\s\S]*?\.tower-fight-grid > aside \{\s*display: none/);
        assert.match(
            source,
            /id="tower-action-guidance" className="tower-sr-only"/,
            "guidance announcements must remain available without consuming a visual row",
        );
        assert.match(
            tacticalCss,
            /@media \(max-width: 979px\) and \(max-height: 640px\) \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) !important;[\s\S]*?\.tower-fight-grid > aside \{[\s\S]*?display: none !important/,
            "short compact layouts must spend the roster row on the tactical canvas",
        );
    });

    it("keeps a full tap target visible in short three-rail desktop layouts", () => {
        assert.match(
            tacticalCss,
            /\.tower-action-dock \{[\s\S]*?flex: 0 0 164px;[\s\S]*?min-height: 164px;[\s\S]*?max-height: 164px;/,
            "the fixed desktop deck must reserve the complete command and loadout bands",
        );
        assert.match(
            tacticalCss,
            /@media \(min-width: 980px\) \{[\s\S]*?\.tower-action-dock > \.combat-jutsu-bar \{[\s\S]*?display: block !important;[\s\S]*?height: 112px !important;[\s\S]*?\.tower-action-dock > \.combat-jutsu-bar::before \{[\s\S]*?content: none !important;[\s\S]*?\.tower-action-dock \.combat-equipped-jutsu-grid \{[\s\S]*?grid-auto-flow: column !important;[\s\S]*?grid-auto-columns: clamp\(124px, 10cqw, 132px\) !important;[\s\S]*?height: 100% !important;[\s\S]*?overflow-x: auto !important;[\s\S]*?\.tower-action-dock \.combat-jutsu-card-wrap \{[\s\S]*?height: min\(92px, 100%\) !important;[\s\S]*?max-height: 92px !important;[\s\S]*?\.tower-action-dock \.combat-jutsu-thumb \{[\s\S]*?position: absolute !important;[\s\S]*?height: 100% !important;[\s\S]*?\.tower-action-dock \.combat-jutsu-name \{[\s\S]*?position: absolute !important;[\s\S]*?inset: auto 0 17px !important;/,
            "desktop Tower cards must use the current PvP/PvE compact tray geometry and scroll for a full loadout",
        );
        assert.match(
            tacticalCss,
            /@media \(min-width: 1024px\) and \(max-height: 900px\) \{[\s\S]*?\.tower-action-dock \.basic-action-bar button \{[\s\S]*?height: 44px !important;[\s\S]*?max-height: 44px !important;/,
            "1024x768 must not leave the first technique clipped below the fixed combat viewport",
        );
    });

    it("keeps a first technique tappable on the smallest portrait", () => {
        assert.match(
            tacticalCss,
            /@media \(max-width: 360px\) and \(max-height: 600px\) \{[\s\S]*?\.tower-fight-grid > aside \{[\s\S]*?display: none !important;[\s\S]*?\.tower-turn-queue \{[\s\S]*?display: none;[\s\S]*?\.tower-threat-summary:not\(\.has-threats\) \{[\s\S]*?display: none;/,
        );
        assert.match(
            tacticalCss,
            /@media \(max-width: 360px\) and \(max-height: 600px\) \{[\s\S]*?\.tower-board-area \{[\s\S]*?flex-basis: clamp\(224px, 40dvh, 240px\);[\s\S]*?min-height: clamp\(224px, 40dvh, 240px\) !important;/,
            "the shortest portrait must reserve a complete first-technique tap target",
        );
        assert.match(source, /className="tower-fight-turn-pill"[\s\S]*?className="tower-fight-turn-label" aria-live="polite"/,
            "the compact header must retain the authoritative current-turn announcement when the duplicate queue is hidden");
    });

    it("names every tile and gives targetable actors one same-hex semantic button", () => {
        assert.match(source, /const tileLabel = buildTowerTileLabel\(\{/);
        assert.match(source, /aria-label=\{tileLabel\}/);
        assert.match(source, /data-combat-tile=\{pos\}/);
        assert.match(source, /tabIndex=\{tileActionable \? 0 : -1\}/);
        assert.match(source, /aria-hidden=\{!tileActionable\}/);
        assert.match(source, /inert=\{!tileActionable \? true : undefined\}/);
        assert.match(source, /const targetable = enemiesInRange\.has\(a\.id\)[\s\S]*?!isSelfCastJutsu\(selJutsu\)[\s\S]*?!isMoveJutsu\(selJutsu\)[\s\S]*?selJutsu\.target !== "EMPTY_GROUND"/,
            "movement and empty-ground jutsu must not expose occupied actors as selectable targets");
        assert.match(source, /<button key=\{a\.id\} type="button" className="tower-board-actor" onClick=\{\(\) => onTileClick\(a\.pos\)\}/);
        assert.match(source, /const inspectable = a\.side === "enemy";/);
        assert.match(source, /const actorActionable = targetable \|\| selfTargetable \|\| inspectable;/);
        assert.match(source, /tabIndex=\{!busy && actorActionable \? 0 : -1\}/);
        assert.match(source, /aria-hidden=\{busy \|\| !actorActionable\}/);
        assert.match(source, /inert=\{busy \|\| !actorActionable \? true : undefined\}/);
        assert.match(source, /onMouseEnter=\{a\.side === "enemy" \? \(\) => setHoverEnemyPos\(a\.pos\) : undefined\}/);
        assert.match(source, /<BattlefieldActor[\s\S]*?label=\{a\.name\}/);
    });

    it("keeps the five solo-Tower additions subordinate to the tactical field", () => {
        assert.match(source, /className="tower-action-forecast"/);
        assert.match(source, /className="tower-last-action"/);
        assert.match(source, /className=\{`tower-impact-floater/);
        assert.match(source, /className="tower-score-dossier"/);
        assert.match(source, /towerEnemyIntent\(a, session\)/);
        assert.match(tacticalCss, /\.tower-action-forecast \{[\s\S]*?position: absolute;[\s\S]*?pointer-events: none;/,
            "target previews must overlay the map temporarily instead of shrinking it");
        assert.match(tacticalCss, /\.tower-last-action \{[\s\S]*?position: absolute;/,
            "replay must remain a compact map control");
        assert.doesNotMatch(source, /party intent marker/i,
            "this pass explicitly excludes party intent markers");
    });

    it("submits highlighted movement-jutsu destinations through the jutsu action path", () => {
        const moveBranch = source.indexOf('if (mode === "jutsu" && selJutsu?.id && isMoveJutsu(selJutsu) && jutsuRangeTiles.has(tile))');
        const groundBranch = source.indexOf('if (mode === "jutsu" && selJutsu?.id && selJutsu.target === "EMPTY_GROUND"');
        assert.ok(moveBranch >= 0, "movement jutsu must have a tile submit branch");
        assert.ok(groundBranch > moveBranch, "movement jutsu must resolve before generic ground targeting");
        assert.match(source.slice(moveBranch, groundBranch), /send\(\{ type: "jutsu", jutsuId: selJutsu\.id, tile \}\)/);
        assert.match(source, /isJutsuMoveTarget[\s\S]*?"jutsu move destination"/);
        assert.match(source, /TOWER_SPIRE_PORTRAITS\[spireMeta\.boss\.key\]/);
        assert.match(source, /resolveTowerCombatantArt\(visual, sharedImages\)\.src/);
    });

    it("uses the stable versioned retry transport for default Tower MPvE actions", () => {
        assert.match(source, /submitTowerActionWithLostResponseRetry/);
        assert.match(source, /submitTowerActionWithLostResponseRetry\(runId, me, action, session\.actionVersion\)/);
        assert.match(source, /actionFn\s*\?\s*await actionFn\(runId, me, action\)/);
    });

    it("announces authoritative phase and log updates without changing layout", () => {
        assert.match(source, /<ShinobiCombatShell[\s\S]*?mode="tactical"[\s\S]*?className=\{`screen-battleTowerFight pvp-battle-layout tower-tactical-combat\$\{variant === "team-pvp" \? " tower-team-pvp-fight" : ""\}`\}/,
            "Tower must use the shared battle-skin boundary while retaining its browser-authority variant hook");
        assert.match(source, /triggeredCount > triggeredCountRef\.current/);
        assert.match(source, /setPhaseBanner\(buildTowerPhaseBanner\(/);
        assert.match(source, /className="spire-phase-banner tower-phase-banner"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/);
        assert.equal((source.match(/<PlainCombatBattleLog/g) ?? []).length, 2,
            "desktop and compact Tower layouts must share the structured battle log");
        assert.match(source, /ariaLive=\{isTeamPvp \? "off" : "polite"\}/);
        assert.match(source, /<CombatJutsuMeta[\s\S]*?sealedResourceCosts=\{\{ chakraCost: ck, staminaCost: st \}\}/,
            "Tower techniques must retain the PvP card metadata contract");
        assert.match(source, /className="jutsu-layout-card combat-jutsu-bar" role="region" aria-label="Jutsu, weapons, and items"/);
        assert.match(source, /className="combat-jutsu-help"[\s\S]*?aria-haspopup="dialog"[\s\S]*?<CombatDetailPortal/,
            "Tower techniques must retain the PvP/PvE details affordance and shared detail surface");
        assert.match(source, /const itemArt = \(it: ItemLike\) => \(typeof it\.image === "string" && it\.image\) \|\| sharedImages\?\.\[`item:\$\{it\.id\}`\]/,
            "sealed Tower items must use the same direct-art then shared-cache resolution as the live trays");
        assert.match(source, /combat-item-button rarity-\$\{wp\.rarity \?\? "common"\}/);
        assert.match(source, /combat-item-button rarity-\$\{cs\.rarity \?\? "common"\}/);
        assert.match(source, /className="tower-sr-only" role="status" aria-live="polite" aria-atomic="true"/);
        assert.match(tacticalCss, /\.tower-sr-only \{[\s\S]*?position: absolute;[\s\S]*?clip: rect\(0, 0, 0, 0\)/);
        assert.match(source, /className="tower-fight-header tower-fight-statusbar"[\s\S]*?session\.status === "active"[\s\S]*?<button[\s\S]*?type="button"[\s\S]*?className="tower-fight-leave"[\s\S]*?Forfeit[\s\S]*?Leave view/);
        assert.ok(source.indexOf('className="tower-resource-rail tower-header-resource-rail"') < source.indexOf('className="tower-action-dock"'),
            "combat resources belong in the header, above the command deck");
        assert.doesNotMatch(source, /className="tower-action-topline"/);
        assert.match(tacticalCss, /\.tower-fight-statusbar > button \{ min-height: 44px; \}/);
        assert.match(
            combatCoreCss,
            /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.spire-phase-banner \{ animation: none !important; opacity: 1; transform: none; \}/,
            "reduced motion must keep the mounted phase cue visible instead of fast-forwarding it to transparent",
        );
    });
});
