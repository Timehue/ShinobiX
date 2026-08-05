import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("./styles/veiled-steel.css", import.meta.url), "utf8");
const adaptiveShell = readFileSync(new URL("./styles/layout/adaptive-shell.css", import.meta.url), "utf8");

test("active battles hide application navigation chrome", () => {
  assert.ok(
    app.includes('{screen !== "start" && character && !hideBattleChrome && !introCinematicActive && ('),
    "RightMenu and MobileNav must not overlay battle-focus or intro-cinematic screens",
  );
});

test("isolated battles no longer depend on theme-owned desktop gutter math", () => {
  assert.match(
    adaptiveShell,
    /#battle-hud-portal\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s,
    "the compatibility portal remains a fixed overlay boundary",
  );
  assert.doesNotMatch(
    theme,
    /#battle-hud-portal > \.battle-hud-sidebar[^}]*\.center-game\.battle-focus/,
    "the visual theme must not calculate shell gutters for battle HUDs",
  );
  assert.doesNotMatch(
    theme,
    /\.center-game\.battle-focus\s*{[^}]*width:\s*calc\(/s,
    "battle-focus width belongs to the isolated combat renderer, not the normal shell",
  );
});
