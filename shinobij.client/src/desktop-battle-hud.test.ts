import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("./styles/veiled-steel.css", import.meta.url), "utf8");

test("active battles hide application navigation chrome", () => {
  assert.ok(
    app.includes('{screen !== "start" && character && !hideBattleChrome && ('),
    "RightMenu and MobileNav must not overlay a battle-focus screen",
  );
});

test("desktop PvE battle focus reserves the portaled player HUD", () => {
  assert.match(
    theme,
    /html\[data-vp="lg"\][^\n]+#battle-hud-portal > \.battle-hud-sidebar[^\n]+\.center-game\.battle-focus/,
  );
  assert.match(
    theme,
    /html\[data-vp="xl"\][^\n]+#battle-hud-portal > \.battle-hud-sidebar[^\n]+\.center-game\.battle-focus/,
  );
  assert.ok(
    theme.includes("width: calc(100% - var(--side-rail-w) - var(--main-gutter)) !important;"),
    "the focused arena must start after the fixed player HUD instead of underneath it",
  );
});
