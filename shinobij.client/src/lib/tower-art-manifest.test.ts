import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const manifestUrl = new URL("./tower-art-manifest.ts", import.meta.url);
const manifest = readFileSync(manifestUrl, "utf8");
const fight = readFileSync(new URL("../screens/BattleTowerFight.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../screens/BattleTowersLobby.tsx", import.meta.url), "utf8");

test("Tower art stays versioned, centralized, and honest about unknown combatants", () => {
    const keyArt = new URL("../assets/towers/battle-towers-key-art-v1.webp", import.meta.url);
    assert.ok(statSync(keyArt).size > 100_000, "the versioned Tower key-art asset must be present");
    assert.match(manifest, /battle-towers-key-art-v1\.webp/);
    for (const key of ["bandit", "archer", "blocker", "brute", "acolyte", "warden", "ravager", "genin", "revenant", "sovereign"] as const) {
        assert.match(manifest, new RegExp(`${key}:\\s*${key}(?:Sprite)?`), `${key} must remain in the central portrait manifest`);
    }
    assert.match(manifest, /kind: "unknown", src: null, \.\.\.UNKNOWN_TOWER_COMBATANT/);
    assert.match(fight, /if \(a\.side === "enemy"\)[\s\S]*?resolveTowerCombatantArt/, "enemy art must resolve by visual id before sealed avatar fallbacks");
    assert.match(fight, /tower-unknown-combatant-badge/);
    assert.match(lobby, /TOWER_KEY_ART/);
});
