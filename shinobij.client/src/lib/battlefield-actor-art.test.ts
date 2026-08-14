import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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
    assert.equal(paths.length, 38, "the complete standard, hunt, apex, rift, and tower sprite set drifted");
    for (const path of paths) {
        assert.ok(existsSync(path));
        assert.ok(statSync(path).size <= 128 * 1024, `${path} exceeds the battlefield asset budget`);
        const metadata = await sharp(path).metadata();
        assert.equal(metadata.width, 384, `${path} width drifted`);
        assert.equal(metadata.height, 384, `${path} height drifted`);
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

test("authoritative creature and boss catalogs have exhaustive sprite policies", () => {
    assert.equal(objectKeys("HUNT_BATTLE_SPRITES").length, 10);
    assert.equal(objectKeys("APEX_BATTLE_SPRITES").length, 4);
    assert.equal(objectKeys("RIFT_BOSS_SPRITES").length, 7);
    assert.equal(objectKeys("TOWER_BATTLE_SPRITES").length, 24);
    assert.equal(objectKeys("QUEST_BOSS_SPRITES").length, 10);
    assert.equal(objectKeys("STORY_RECKONING_SPRITES").length, 5);

    const catalog = readFileSync(join(repoRoot, "api", "_ai-profile-catalog.ts"), "utf8");
    const ids = [...catalog.matchAll(/^\s+"([^"]+)": \{"id":/gm)].map((match) => match[1]);
    assert.equal(ids.length, 71, "authoritative AI catalog changed; extend the visual policy intentionally");
    assert.equal(ids.filter((id) => id.startsWith("hunt-ai-")).length, 10);
    assert.equal(ids.filter((id) => id.startsWith("apex-ai-")).length, 4);
    assert.equal(ids.filter((id) => id.startsWith("rift-boss-")).length, 7);
    for (const id of ids.filter((candidate) => /^(hunt-ai-|apex-ai-|rift-boss-)/.test(candidate))) {
        assert.match(resolverSource, new RegExp(`"${id}"`), `${id} has no explicit sprite entry`);
    }
});

test("runtime IDs, published overrides, and future AI keep a presentation-only sprite fallback", () => {
    assert.match(resolverSource, /ai:\$\{suppliedId\}:body/);
    assert.match(resolverSource, /ai:\$\{id\}:body/);
    assert.match(resolverSource, /world-hunt-pack-/);
    assert.match(resolverSource, /world-questbook-/);
    assert.match(resolverSource, /world-story-/);
    assert.match(resolverSource, /world-wanderer-/);
    assert.match(resolverSource, /world-patrol-/);
    assert.match(resolverSource, /world-bounty-/);
    assert.match(resolverSource, /world-ambush-/);
    assert.match(resolverSource, /dungeon-warden-/);
    assert.match(resolverSource, /\|\| rivalFallbackSprite/);
    assert.doesNotMatch(resolverSource, /from\s+["'][^"']*(combat-math|server-arena|settlement|reward)/i,
        "the art resolver must not import combat-state modules");
});
