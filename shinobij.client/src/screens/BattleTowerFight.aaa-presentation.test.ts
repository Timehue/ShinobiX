import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fight = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");
const tacticalCss = readFileSync(new URL("../styles/tower-tactical.css", import.meta.url), "utf8");

test("Tower round copy distinguishes score par, timed holds, and hard limits", () => {
    assert.match(fight, /function towerRoundPresentation\(session: TowerSession\)/);
    assert.match(fight, /debriefLabel: "Hold duration"[\s\S]{0,240}?hudLabel: goal > 0 \? `Hold \$\{held\}\/\$\{goal\}`/);
    assert.match(fight, /debriefLabel: "Rounds \/ par"[\s\S]{0,180}?`\$\{session\.round\} · Par \$\{goal\}`/);
    assert.match(fight, /Par \$\{goal\} affects clear score only; the Story fight continues beyond it/);
    assert.match(fight, /debriefLabel: "Round limit"[\s\S]{0,220}?`Round \$\{session\.round\}\/\$\{hardLimit\} · limit`/);
    assert.doesNotMatch(fight, /const roundBudget = session\.sealedCatalogFloor\?\.roundBudget \?\? session\.roundCap/);
    assert.match(fight, /objective === "survive" \? `Held \$\{roundsSurvived\}/);
});

test("Story and Spire phase gates announce one actionable mechanic summary", () => {
    assert.match(fight, /function buildTowerPhaseBanner\(session: TowerSession, boss: TowerActor \| undefined/);
    assert.match(fight, /Eliminate \$\{addsRemaining \|\| "the"\} reinforcement/);
    assert.match(fight, /Aegis raised[\s\S]{0,140}?break it before committing burst damage/);
    assert.match(fight, /mechanic === "enrage"[\s\S]{0,160}?protect the weakest ally/);
    assert.match(fight, /mechanic === "regen"[\s\S]{0,160}?outpace its end-of-round healing/);
    assert.match(fight, /mechanic === "bulwark"[\s\S]{0,220}?remove its damage reduction/);
    assert.match(fight, /if \(triggeredCount > triggeredCountRef\.current\) \{\s*setPhaseBanner\(buildTowerPhaseBanner/);
    assert.doesNotMatch(fight, /triggeredCount > triggeredCountRef\.current && isSpire/);
    assert.match(fight, /key=\{phaseBanner\.key\} className="spire-phase-banner tower-phase-banner" role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(fight, /setTimeout\(\(\) => setPhaseBanner\(null\), 4200\)/);
});

test("combat hierarchy remains legible and reachable on narrow touch screens", () => {
    assert.match(fight, /<h1 className="tower-fight-title">/);
    assert.match(fight, /resolveTowerStoryArt\(sealedStoryFloor\.artKey\)/);
    assert.match(fight, /data-has-encounter-art=\{encounterArt \? "true" : undefined\}/);
    assert.match(fight, /className="tower-turn-queue"[\s\S]{0,120}?tabIndex=\{0\}/);
    assert.match(fight, /className="tower-mechanic-strip" role="list" aria-label="Encounter mechanics and warnings"/);
    assert.match(tacticalCss, /\.tower-turn-queue\s*\{[\s\S]{0,120}?flex:\s*0 0 auto;[\s\S]{0,100}?min-height:\s*30px/);
    assert.match(tacticalCss, /@media \(max-width: 640px\)[\s\S]*?\.tower-mechanic-strip\s*\{[\s\S]{0,100}?flex-wrap:\s*nowrap[\s\S]{0,100}?overflow:\s*auto hidden/);
    assert.match(tacticalCss, /\.combat-instance\.screen-battleTowerFight \.tower-board-area\s*\{[\s\S]{0,100}?flex-basis:\s*clamp\(280px, 38dvh, 340px\)/);
    assert.match(tacticalCss, /\.screen-battleTowerFight \[role="dialog"\] button\s*\{\s*min-height:\s*44px/);
    assert.match(tacticalCss, /\.tower-fight-statusbar\[data-has-encounter-art="true"\]\s*\{[\s\S]{0,500}?var\(--tower-encounter-art\)/);
    assert.match(tacticalCss, /@media \(prefers-reduced-data: reduce\)[\s\S]{0,180}?background-image:\s*none !important/);
});

test("targeting guidance is truthful and hides inert board controls from assistive tech", () => {
    assert.match(fight, /No enemy is in melee range\. Move, Dash, or choose a ranged technique\./);
    assert.match(fight, /targetingBlocked \? `\$\{armedActionName \?\? "Action"\} has no legal target`/);
    assert.match(fight, /id="tower-action-guidance"/);
    assert.match(fight, /aria-describedby=\{\(fightSyncState === "reconnecting"/);
    assert.equal(fight.match(/aria-hidden=\{!tileActionable\}/g)?.length, 1);
    assert.equal(fight.match(/aria-hidden=\{busy \|\| \(!targetable && !selfTargetable\)\}/g)?.length, 1);
    assert.equal(fight.match(/inert=\{!tileActionable \? true : undefined\}/g)?.length, 1);
    assert.equal(fight.match(/inert=\{busy \|\| \(!targetable && !selfTargetable\) \? true : undefined\}/g)?.length, 1);
    assert.match(tacticalCss, /\.tower-action-state--blocked\s*\{/);
    assert.match(tacticalCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.tower-phase-banner/);
    assert.match(tacticalCss, /@media \(forced-colors: active\)/);
});

test("battlefield sprites remain presentation-only inside the authoritative actor button", () => {
    assert.match(fight, /import \{ BattlefieldActor \} from "\.\.\/components\/BattlefieldActor"/);
    assert.match(fight, /const battleSprite = a\.side === "enemy" && !isTeamPvp/);
    assert.match(fight, /battlefieldAiSprite\(String\(a\.character\?\.visual \?\? ""\), sharedImages\)/);
    assert.match(fight, /const spriteFacing = battleSprite[\s\S]{0,180}?battlefieldFacingTowardNearest\(a, session\.actors, w\)/);
    assert.match(fight, /facing=\{spriteFacing\}/);
    assert.match(
        fight,
        /<button key=\{a\.id\}[^>]*onClick=\{\(\) => onTileClick\(a\.pos\)\}[\s\S]{0,1600}?<BattlefieldActor[\s\S]{0,500}?sprite=\{battleSprite\}/,
        "the existing button must continue to own targeting while actor art stays inside it",
    );
    assert.match(fight, /<BattlefieldActor[\s\S]{0,1000}?outline: isActive/);
    assert.match(fight, /<BattlefieldActor[\s\S]{0,1800}?<\/BattlefieldActor>/);
});
