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
        assert.match(tacticalCss, /\.tower-action-dock > \.shinobi-command-bar \{[\s\S]*?flex-wrap: nowrap !important;[\s\S]*?overflow: auto hidden/);
        assert.match(tacticalCss, /\.tower-action-dock > \.combat-jutsu-bar \{[\s\S]*?height: 94px !important;[\s\S]*?overflow: auto hidden !important/);
    });

    it("removes only the rail row in short landscape and keeps fixed action geometry", () => {
        assert.match(
            tacticalCss,
            /@media \(max-width: 979px\) \{[\s\S]*?\.tower-action-dock > \.shinobi-command-bar \{[\s\S]*?height: 48px;[\s\S]*?\.tower-action-dock > \.combat-jutsu-bar \{[\s\S]*?height: 94px !important/,
            "reduced-height layouts through 979px must style the production action dock's horizontal bands",
        );
        assert.match(css, /@media \(max-width: 979px\) and \(max-height: 500px\) \{/);
        assert.match(css, /\.tower-fight-grid > aside \{\s*display: none !important/);
        assert.match(css, /@media \(max-width: 979px\) and \(max-height: 500px\) \{[\s\S]*?\.tower-fight-header \{[\s\S]*?flex: 0 0 44px/);
        assert.match(css, /\.tower-fight-header > button \{[\s\S]*?height: 44px;[\s\S]*?min-height: 44px/);
        assert.match(tacticalCss, /@media \(max-width: 979px\) and \(max-height: 500px\) \{[\s\S]*?\.tower-action-state \{[\s\S]*?height: 44px;[\s\S]*?min-height: 44px;[\s\S]*?max-height: 44px;/,
            "short landscape guidance must preserve a 44px control row without pushing the loadout below the viewport");
    });

    it("contains the 960 by 600 browser-zoom tier without hiding its rails", () => {
        assert.match(css, /@media \(max-width: 979px\) \{/);
        assert.doesNotMatch(css, /@media \(max-width: 979px\) and \(max-height: 740px\) \{[\s\S]*?\.tower-fight-grid > aside \{\s*display: none/);
        assert.match(css, /@media \(max-width: 979px\) and \(max-height: 500px\) \{[\s\S]*?\.tower-fight-grid > aside \{\s*display: none/);
        assert.match(
            tacticalCss,
            /@media \(max-width: 979px\) and \(max-height: 740px\) \{[\s\S]*?\.tower-turn-queue \{[\s\S]*?display: none;[\s\S]*?\.tower-action-state \{[\s\S]*?height: 44px;/,
            "the duplicate queue must yield enough space for a fully hit-testable first technique",
        );
    });

    it("keeps a full tap target visible in short three-rail desktop layouts", () => {
        assert.match(
            tacticalCss,
            /@media \(min-width: 1024px\) and \(max-height: 900px\) \{[\s\S]*?\.tower-action-dock \{[\s\S]*?flex: 0 0 240px;[\s\S]*?\.tower-action-state \{[\s\S]*?height: 44px;[\s\S]*?\.tower-action-dock \.basic-action-bar button \{[\s\S]*?height: 44px !important;[\s\S]*?max-height: 44px !important;[\s\S]*?\.tower-action-dock \.jutsu-layout-card \{[\s\S]*?height: 94px !important;[\s\S]*?overflow: auto hidden !important/,
            "1024x768 must not leave the first technique clipped below the fixed combat viewport",
        );
    });

    it("keeps a first technique tappable on the smallest portrait without hiding real threats", () => {
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
        assert.doesNotMatch(
            tacticalCss,
            /@media \(max-width: 360px\) and \(max-height: 600px\) \{[\s\S]*?\.tower-threat-summary\.has-threats[^}]*display: none/,
            "an actual strike or hazard warning must remain visible",
        );
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
        assert.match(source, /tabIndex=\{!busy && \(targetable \|\| selfTargetable\) \? 0 : -1\}/);
        assert.match(source, /aria-hidden=\{busy \|\| \(!targetable && !selfTargetable\)\}/);
        assert.match(source, /inert=\{busy \|\| \(!targetable && !selfTargetable\) \? true : undefined\}/);
        assert.match(source, /onMouseEnter=\{a\.side === "enemy" \? \(\) => setHoverEnemyPos\(a\.pos\) : undefined\}/);
        assert.match(source, /<BattlefieldActor[\s\S]*?label=\{a\.name\}/);
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
        assert.match(source, /className=\{`screen-battleTowerFight\$\{variant === "team-pvp" \? " tower-team-pvp-fight" : ""\}`\}/,
            "the exact-2v2 root must retain its layout and browser-authority variant hook");
        assert.match(source, /triggeredCount > triggeredCountRef\.current/);
        assert.match(source, /setPhaseBanner\(buildTowerPhaseBanner\(/);
        assert.match(source, /className="spire-phase-banner tower-phase-banner"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/);
        assert.match(source, /<div role="log" aria-live=\{isTeamPvp \? "off" : "polite"\} aria-relevant="additions text"/);
        assert.match(source, /className="tower-sr-only" role="status" aria-live="polite" aria-atomic="true"/);
        assert.match(tacticalCss, /\.tower-sr-only \{[\s\S]*?position: absolute;[\s\S]*?clip: rect\(0, 0, 0, 0\)/);
        assert.match(source, /className="tower-fight-header tower-fight-statusbar"[\s\S]*?session\.status === "active"[\s\S]*?<button[\s\S]*?type="button"[\s\S]*?className="tower-fight-leave"[\s\S]*?Forfeit[\s\S]*?Leave view/);
        assert.match(tacticalCss, /\.tower-fight-statusbar > button \{ min-height: 44px; \}/);
        assert.match(
            combatCoreCss,
            /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.spire-phase-banner \{ animation: none !important; opacity: 1; transform: none; \}/,
            "reduced motion must keep the mounted phase cue visible instead of fast-forwarding it to transparent",
        );
    });
});
