import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { battlefieldAiSprite, defaultAiRivalSprite } from "./battlefield-actor-art";
import { NARRATIVE_ENEMY_IDENTITIES } from "../../../shared/narrative-enemy-identity";
import { PERSONAL_HUNT_PORTRAITS } from "../../../shared/story-combat-identity";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..", "..");
const repoRoot = join(clientRoot, "..");
const assetDir = join(clientRoot, "src", "assets", "combat-actors");
const resolverPath = join(clientRoot, "src", "lib", "battlefield-actor-art.ts");
const resolverSource = readFileSync(resolverPath, "utf8");

function webpFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? webpFiles(path) : entry.name.endsWith(".webp") ? [path] : [];
    });
}

function objectKeys(objectName: string): string[] {
    const body = new RegExp(`const ${objectName}:[^=]+ = \\{([\\s\\S]*?)\\n\\};`).exec(resolverSource)?.[1];
    assert.ok(body, `${objectName} mapping is missing`);
    return [...body.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*:/gm)]
        .map((match) => match[1] ?? match[2]);
}

test("all bundled battlefield sprites are optimized transparent WebP cutouts", async () => {
    const paths = webpFiles(assetDir);
    assert.equal(paths.length, 49, "the imported combat sprite set drifted");
    for (const [folder, count] of [["starters", 2], ["cinderhold", 30], ["named", 26]] as const) {
        const authored = webpFiles(join(clientRoot, "public", "combat-actors", folder));
        assert.equal(authored.length, count, folder);
        paths.push(...authored);
    }
    for (const path of paths) {
        assert.ok(existsSync(path));
        assert.ok(statSync(path).size <= 128 * 1024, `${path} exceeds the battlefield asset budget`);
        const metadata = await sharp(path).metadata();
        assert.equal(metadata.format, "webp", path);
        assert.ok([160, 192, 384].includes(Math.max(metadata.width, metadata.height)), `${path} has unexpected sprite dimensions`);
        assert.equal(metadata.hasAlpha, true, `${path} must retain transparency`);

        const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let transparent = 0;
        let visible = 0;
        for (let index = 3; index < data.length; index += info.channels) {
            if (data[index] === 0) transparent += 1;
            if (data[index] >= 16) visible += 1;
        }
        const pixels = info.width * info.height;
        assert.ok(transparent / pixels >= 0.2, `${path} is not an isolated cutout`);
        assert.ok(visible / pixels >= 0.02, `${path} has too little visible actor art`);
    }
});

test("the established rival miner keeps his own body before the generic defensive role", () => {
    assert.match(resolverSource, /import rivalMinerSprite from ['"]\.\.\/assets\/combat-actors\/pve\/rival-miner-idle\.webp['"]/);
    const ordinary = /const ORDINARY_PVE_SPRITES:[^=]+ = \{([\s\S]*?)\n\};/.exec(resolverSource)?.[1];
    assert.ok(ordinary, "ordinary PvE sprite policy is missing");
    assert.match(ordinary, /\brivalMiner:\s*rivalMinerSprite\b/,
        "the bearded miner must not borrow the armored generic defender's identity");
    assert.match(ordinary, /\bdefender:\s*pveDefenderSprite\b/,
        "the ordinary defensive specialist retains his own approved body");
    assert.match(resolverSource, /ORDINARY_PVE_SPRITES\[id\][\s\S]*?ORDINARY_PVE_SPRITES\[identity\?\.archetype/,
        "the sealed miner identity must take priority over his defensive combat role");
    assert.deepEqual(
        readFileSync(join(clientRoot, "public", "portraits", "pve", "rivalMiner.webp")),
        readFileSync(join(clientRoot, "src", "assets", "wanderers", "rival-miner.webp")),
        "the miner's established portrait remains unchanged",
    );
});

test("authoritative creature and boss catalogs have exhaustive sprite policies", () => {
    assert.equal(objectKeys("HUNT_BATTLE_SPRITES").length, 10);
    assert.equal(objectKeys("APEX_BATTLE_SPRITES").length, 4);
    assert.equal(objectKeys("RIFT_BOSS_SPRITES").length, 7);
    assert.equal(objectKeys("TOWER_BATTLE_SPRITES").length, 24);
    const questBosses = Object.entries(NARRATIVE_ENEMY_IDENTITIES)
        .filter(([, identity]) => identity.portrait.startsWith("/portraits/quest-bosses/"));
    assert.equal(questBosses.length, 9);
    for (const [id] of questBosses) {
        assert.equal(battlefieldAiSprite(`world-questbook-test-${id}`), `/combat-actors/named/quest-bosses/${id}-idle.webp`);
    }
    assert.equal(battlefieldAiSprite("world-questbook-test-raiju-storm-hound"), "/hollow-gate/hollow-hound-idle.webp");
    assert.equal(Object.keys(PERSONAL_HUNT_PORTRAITS).length, 5);
    for (const [id, portrait] of Object.entries(PERSONAL_HUNT_PORTRAITS)) {
        const name = portrait.split("/").pop()!.replace(".webp", "");
        assert.equal(battlefieldAiSprite(`world-story-${id}`), `/combat-actors/named/${name}-idle.webp`);
    }

    const catalog = readFileSync(join(repoRoot, "api", "_ai-profile-catalog.ts"), "utf8");
    const ids = [...catalog.matchAll(/^\s+"([^"]+)": \{"id":/gm)].map((match) => match[1]);
    assert.equal(ids.length, 80, "authoritative AI catalog changed; extend the visual policy intentionally");
    assert.equal(ids.filter((id) => id.startsWith("road-ai-")).length, 9);
    assert.equal(ids.filter((id) => id.startsWith("hunt-ai-")).length, 10);
    assert.equal(ids.filter((id) => id.startsWith("apex-ai-")).length, 4);
    assert.equal(ids.filter((id) => id.startsWith("rift-boss-")).length, 7);
    for (const id of ids.filter((candidate) => /^(hunt-ai-|apex-ai-|rift-boss-|road-ai-)/.test(candidate))) {
        assert.ok(battlefieldAiSprite(id) && battlefieldAiSprite(id) !== defaultAiRivalSprite(), `${id} must resolve to a dedicated sprite`);
    }
});

test("runtime IDs, published overrides, and future AI keep a presentation-only sprite fallback", () => {
    assert.match(resolverSource, /ai:\$\{suppliedId\}:body/);
    assert.match(resolverSource, /ai:\$\{id\}:body/);
    assert.match(resolverSource, /world-hunt-pack-/);
    assert.match(resolverSource, /world-questbook-/);
    assert.match(battlefieldAiSprite("world-story-story-reckoning-vanta-ninth")!, /warden-sesk-idle\.webp$/);
    assert.match(resolverSource, /world-wanderer-/);
    assert.match(resolverSource, /world-patrol-/);
    assert.match(resolverSource, /world-bounty-/);
    assert.match(resolverSource, /world-ambush-/);
    assert.match(resolverSource, /dungeon-warden-/);
    assert.match(resolverSource, /\|\| rivalFallbackSprite/);
    assert.doesNotMatch(resolverSource, /from\s+["'][^"']*(combat-math|server-arena|settlement|reward)/i,
        "the art resolver must not import combat-state modules");
});
