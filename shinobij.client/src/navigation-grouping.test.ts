import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktop = readFileSync("shinobij.client/src/components/RightMenu.tsx", "utf8");
const mobile = readFileSync("shinobij.client/src/components/MobileNav.tsx", "utf8");
const menuGroups = readFileSync("shinobij.client/src/components/player-menu-groups.ts", "utf8");
const desktopCss = readFileSync("shinobij.client/src/styles/index/02-world-map.css", "utf8");
const mobileCss = readFileSync("shinobij.client/src/styles/index/23-mobile-shell.css", "utf8");
const themeCss = readFileSync("shinobij.client/src/styles/veiled-steel.css", "utf8");
const townHall = readFileSync("shinobij.client/src/screens/TownHall.tsx", "utf8");
const centralHub = readFileSync("shinobij.client/src/screens/CentralHub.tsx", "utf8");
const app = readFileSync("shinobij.client/src/App.tsx", "utf8");
const bloodlineFlow = readFileSync("shinobij.client/src/lib/use-bloodline-maker-flow.ts", "utf8");
const groups = ["world", "activities", "character", "social", "support", "system"];
const internalScreens = [
    "tavern", "worldMap", "userHub", "messages", "missions", "training", "professions", "logbook",
    "profile", "inventory", "jutsuTraining", "home", "guides",
];

test("desktop and mobile menus expose the same six semantic groups", () => {
    for (const group of groups) {
        if (["world", "activities", "character", "social"].includes(group)) assert.match(menuGroups, new RegExp(`id: "${group}"`));
        else {
            assert.match(desktop, new RegExp(`aria-labelledby="right-menu-${group}"`));
            assert.match(mobile, new RegExp(`aria-labelledby="mobile-menu-${group}"`));
        }
    }
    assert.match(desktop, /aria-labelledby=\{`right-menu-\$\{group\.id\}`\}/);
    assert.match(mobile, /aria-labelledby=\{`mobile-menu-\$\{group\.id\}`\}/);
});

test("grouping preserves every internal menu destination and current-page affordance", () => {
    for (const screen of internalScreens) {
        const source = screen === "guides" ? `${desktop}\n${mobile}` : menuGroups;
        assert.match(source, new RegExp(`"${screen}"`), `group data keeps ${screen}`);
    }
    assert.match(desktop, /guardedNavigate\(target\)/);
    assert.match(mobile, /go\(target\)/);
    assert.match(desktop, /aria-current=/);
    assert.match(mobile, /aria-current=/);
    assert.match(desktop, /MailUnreadBadge/);
    assert.match(mobile, /MailUnreadBadge/);
    assert.match(desktop, /setAudioMuted/);
    assert.match(desktop, /preloadScreen/);
    assert.match(mobile, /preloadScreen/);
});

test("controlled destinations stay out of the global menu and remain wired to their gameplay hubs", () => {
    assert.doesNotMatch(menuGroups, /"villageWarMap"/);
    assert.doesNotMatch(menuGroups, /"bloodlineMaker"/);

    assert.match(townHall, /setScreen\("villageWarMap"\)/);
    assert.match(townHall, /> Sector Map<\/button>/);

    assert.match(centralHub, /purchaseBloodlineForge\(character\.name, rank\)/);
    assert.match(centralHub, /onOpenBloodlineMaker\(rank, getCharacterElements\(result\.character\)\[0\] \?\? ""\)/);
    assert.match(app, /onOpenBloodlineMaker=\{\(rank, element\) => bloodlineMaker\.open\(/);
    assert.match(bloodlineFlow, /setScreen\("bloodlineMaker"\)/);
});

test("logout uses the concise player-facing label while preserving the save-first callback", () => {
    assert.match(desktop, /className="right-menu-logout" onClick=\{logoutPlayer\}/);
    assert.match(mobile, /<GiExitDoor size=\{20\} \/>Logout<\/button>/);
    assert.doesNotMatch(`${desktop}\n${mobile}`, /Logout \+ Save/);
});

test("desktop menu keeps the classic heading without the duplicate command card", () => {
    assert.match(desktop, /<h3>Main Menu<\/h3>/);
    assert.doesNotMatch(desktop, /right-menu-command-title|Field command|<h3>Shinobi Menu<\/h3>/);
    assert.doesNotMatch(themeCss, /\.right-menu-command-title/);
});

test("grouped menus stay compact, scrollable, and touch-safe", () => {
    assert.match(themeCss, /\.right-menu-buttons\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
    assert.match(desktopCss, /\.right-menu-section-grid\s*\{[\s\S]*grid-template-columns:\s*1fr 1fr/);
    assert.match(mobileCss, /\.mobile-menu-overlay\s*\{[\s\S]*overflow-y:\s*auto/);
    assert.match(mobileCss, /button\s*\{\s*min-height:\s*44px/);
    assert.match(mobileCss, /\.mobile-menu-groups/);
    assert.match(mobile, /menuDialogRef\.current\?\.querySelectorAll/);
    assert.match(mobile, /menuTrigger\?\.focus\(\)/);
});
