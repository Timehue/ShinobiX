import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktop = readFileSync("shinobij.client/src/components/RightMenu.tsx", "utf8");
const mobile = readFileSync("shinobij.client/src/components/MobileNav.tsx", "utf8");
const menuGroups = readFileSync("shinobij.client/src/components/player-menu-groups.ts", "utf8");
const desktopCss = readFileSync("shinobij.client/src/styles/index/02-world-map.css", "utf8");
const mobileCss = readFileSync("shinobij.client/src/styles/index/23-mobile-shell.css", "utf8");
const themeCss = readFileSync("shinobij.client/src/styles/veiled-steel.css", "utf8");
const groups = ["world", "growth", "character", "support", "system"];
const internalScreens = [
    "tavern", "worldMap", "userHub", "messages", "missions", "training", "professions", "logbook",
    "profile", "inventory", "jutsuTraining", "home", "bloodlineMaker", "guides",
];

test("desktop and mobile menus expose the same five semantic groups", () => {
    for (const group of groups) {
        if (["world", "growth", "character"].includes(group)) assert.match(menuGroups, new RegExp(`id: "${group}"`));
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

test("grouped menus stay compact, scrollable, and touch-safe", () => {
    assert.match(themeCss, /\.right-menu-buttons\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
    assert.match(desktopCss, /\.right-menu-section-grid\s*\{[\s\S]*grid-template-columns:\s*1fr 1fr/);
    assert.match(mobileCss, /\.mobile-menu-overlay\s*\{[\s\S]*overflow-y:\s*auto/);
    assert.match(mobileCss, /button\s*\{\s*min-height:\s*44px/);
    assert.match(mobileCss, /\.mobile-menu-groups/);
    assert.match(mobile, /menuDialogRef\.current\?\.querySelectorAll/);
    assert.match(mobile, /menuTrigger\?\.focus\(\)/);
});
