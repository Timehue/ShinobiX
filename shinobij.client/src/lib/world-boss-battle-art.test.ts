// The roaming world bosses fight on the Tower board. Their boss actor used to
// carry one hard-coded `visual` for all three bosses, which no art table knew,
// so Chicxulub, Murogane and Donkaku all appeared as the neutral shinobi body,
// and every enemy in the rail (both Brute guards included) wore the boss's
// widescreen key art. These tests pin each boss to its own art end to end.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
    WORLD_BOSS_DEFINITIONS,
    worldBossBattleVisual,
    worldBossGuardVisual,
    worldBossDefinitionForGuardVisual,
    worldBossDefinitionForVisual,
} from "../../../shared/world-boss-event";
import { battlefieldAiSprite, defaultAiRivalSprite } from "./battlefield-actor-art";
import { inferSpriteKind, inferSpriteNativeFacing } from "./battlefield-sprite";
import { resolveTowerCombatantArt, TOWER_ENEMY_PORTRAITS } from "./tower-art-manifest";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..", "..");
const repoRoot = join(clientRoot, "..");
const publicFile = (src: string) => join(clientRoot, "public", ...src.split("/").filter(Boolean));

test("each world boss resolves its own battle sprite and rail portrait", () => {
    const sprites = new Set<string>();
    const portraits = new Set<string>();
    for (const boss of WORLD_BOSS_DEFINITIONS) {
        const visual = worldBossBattleVisual(boss.id);
        assert.equal(worldBossDefinitionForVisual(visual)?.id, boss.id);

        const sprite = battlefieldAiSprite(visual);
        assert.equal(sprite, boss.battleSprite, `${boss.name} board sprite`);
        assert.notEqual(sprite, defaultAiRivalSprite(), `${boss.name} must not fall back to the shinobi body`);
        sprites.add(sprite!);

        const art = resolveTowerCombatantArt(visual);
        assert.equal(art.kind, "portrait", `${boss.name} must not read as an unknown combatant`);
        assert.equal(art.src, boss.battlePortrait, `${boss.name} rail portrait`);
        portraits.add(art.src!);
    }
    assert.equal(sprites.size, WORLD_BOSS_DEFINITIONS.length, "every boss needs distinct board art");
    assert.equal(portraits.size, WORLD_BOSS_DEFINITIONS.length, "every boss needs a distinct portrait");
});

test("published admin art still overrides the bundled world boss art", () => {
    const visual = worldBossBattleVisual("hollow-maze-minotaur");
    assert.equal(battlefieldAiSprite(visual, { [`ai:${visual}:body`]: "/api/img?id=body" }), "/api/img?id=body");
    assert.equal(resolveTowerCombatantArt(visual, { [`ai:${visual}`]: "/api/img?id=face" }).src, "/api/img?id=face");
});

test("only exact world boss visuals match; ordinary Tower brutes keep their art", () => {
    assert.equal(worldBossDefinitionForVisual("world-boss-unknown"), null);
    assert.equal(worldBossDefinitionForVisual("hollow-maze-minotaur"), null);
    assert.equal(worldBossDefinitionForVisual(undefined), null);
    assert.equal(battlefieldAiSprite("world-boss-unknown"), defaultAiRivalSprite());
    assert.equal(resolveTowerCombatantArt("brute").src, TOWER_ENEMY_PORTRAITS.brute);
});

test("world boss board art is sized as a boss and faces the way it was drawn", () => {
    for (const boss of WORLD_BOSS_DEFINITIONS) {
        assert.equal(inferSpriteKind(boss.battleSprite), "boss", `${boss.name} sprite box`);
    }
    const facing = Object.fromEntries(WORLD_BOSS_DEFINITIONS.map(boss => [boss.id, inferSpriteNativeFacing(boss.battleSprite)]));
    assert.deepEqual(facing, { "hollow-beast": "left", "hollow-gate-bull": "right", "hollow-maze-minotaur": "right" });
    for (const boss of WORLD_BOSS_DEFINITIONS) {
        assert.equal(inferSpriteNativeFacing(boss.battleSprite), boss.mapSpriteFacing);
    }
});

test("each broodguard uses the matching boss body and portrait", () => {
    for (const boss of WORLD_BOSS_DEFINITIONS) {
        const visual = worldBossGuardVisual(boss.id);
        assert.equal(worldBossDefinitionForGuardVisual(visual)?.id, boss.id);
        assert.equal(worldBossDefinitionForVisual(visual), null);
        assert.equal(battlefieldAiSprite(visual), boss.battleSprite);
        assert.equal(resolveTowerCombatantArt(visual).src, boss.battlePortrait);
    }
    assert.equal(worldBossDefinitionForGuardVisual('world-boss-guard-unknown'), null);
});

test("world boss battle art ships as small transparent cutouts and opaque portraits", async () => {
    for (const boss of WORLD_BOSS_DEFINITIONS) {
        const spritePath = publicFile(boss.battleSprite);
        const portraitPath = publicFile(boss.battlePortrait);
        assert.ok(existsSync(spritePath), `${boss.battleSprite} is missing`);
        assert.ok(existsSync(portraitPath), `${boss.battlePortrait} is missing`);
        const sprite = await sharp(spritePath).metadata();
        assert.equal(sprite.hasAlpha, true, `${boss.battleSprite} must be a cutout`);
        assert.ok((sprite.width ?? 0) >= 200 && (sprite.height ?? 0) >= 200, `${boss.battleSprite} is too small for the board`);
        const portrait = await sharp(portraitPath).metadata();
        assert.equal(portrait.width, portrait.height, `${boss.battlePortrait} must be square`);
        assert.ok(readFileSync(spritePath).byteLength <= 64 * 1024, `${boss.battleSprite} exceeds its budget`);
        assert.ok(readFileSync(portraitPath).byteLength <= 24 * 1024, `${boss.battlePortrait} exceeds its budget`);
    }
});

test("the raid stamps a per-boss visual and the board stops painting key art on every enemy", () => {
    const encounter = readFileSync(join(repoRoot, "api", "world-boss-event", "_encounter.ts"), "utf8");
    assert.match(encounter, /visual: worldBossBattleVisual\(input\.event\.bossId\)/);
    assert.doesNotMatch(encounter, /visual: 'world-boss-hollow-beast'/);

    const fight = readFileSync(join(clientRoot, "src", "screens", "BattleTowerFight.tsx"), "utf8");
    const avatarFor = /function avatarFor\(a: TowerActor\)[\s\S]*?\n {4}\}/.exec(fight)?.[0] ?? "";
    const unknown = /function isUnknownCombatant\(a: TowerActor\)[\s\S]*?\n {4}\}/.exec(fight)?.[0] ?? "";
    assert.ok(avatarFor && unknown, "portrait resolvers moved; re-point this test");
    assert.doesNotMatch(avatarFor + unknown, /isWorldBoss/, "world boss enemies must resolve their own portraits");
});
