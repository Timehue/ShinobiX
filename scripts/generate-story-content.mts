import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ECHOES_ERAS, ECHOES_OPPONENTS } from "../shinobij.client/src/data/echoes-of-war.ts";
import { ECHOES_ERA_INTROS, ECHOES_SCENES, ECHOES_WITNESS_CONTENT } from "../shinobij.client/src/data/echoes-of-war-scenes.ts";
import { ECHOES_WITNESS_ERAS } from "../shared/echoes-witness.ts";
import { storyEpiloguesByVillage } from "../shinobij.client/src/data/story-epilogues.ts";
import { storyFieldScenes } from "../shinobij.client/src/data/story-field-scenes.ts";
import { storyInterludesByVillage } from "../shinobij.client/src/data/story-interludes.ts";
import { storyReckonings } from "../shinobij.client/src/data/story-reckonings.ts";
import { storyRoadEvents } from "../shinobij.client/src/data/story-road-events.ts";
import { storylines } from "../shinobij.client/src/data/storylines.ts";
import {
    ECHOES_CONTENT_KEY,
    ECHOES_CONTENT_SCHEMA_VERSION,
    type EchoesContentPayload,
    STORY_CONTENT_SCHEMA_VERSION,
    STORY_CONTENT_VILLAGES,
    storyContentSlug,
    type StoryContentPayload,
} from "../shinobij.client/src/lib/story-content-contract.ts";
import { validateEchoesContentPayload, validateStoryContentPayload } from "../shinobij.client/src/lib/story-content-loader-core.ts";
import {
    STORY_FIELD_CONTENT_SCHEMA_VERSION,
    type StoryFieldContentPayload,
} from "../shinobij.client/src/lib/story-field-content-contract.ts";
import { validateStoryFieldContent } from "../shinobij.client/src/lib/story-field-content-loader-core.ts";
import {
    STORY_ROAD_CONTENT_SCHEMA_VERSION,
    type StoryRoadContentPayload,
} from "../shinobij.client/src/lib/story-road-content-contract.ts";
import { validateStoryRoadContent } from "../shinobij.client/src/lib/story-road-content-loader-core.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(repoRoot, "shinobij.client", "src", "generated", "story-content");
const checkOnly = process.argv.includes("--check");
const HASH_LENGTH = 12;
const MAX_VILLAGE_RAW_BYTES = 160_000;
const MAX_VILLAGE_GZIP_BYTES = 45_000;
const MAX_ECHOES_RAW_BYTES = 64_000;
const MAX_ECHOES_GZIP_BYTES = 24_000;
const MAX_FIELD_RAW_BYTES = 100_000;
const MAX_FIELD_GZIP_BYTES = 30_000;
const MAX_ROAD_RAW_BYTES = 64_000;
const MAX_ROAD_GZIP_BYTES = 24_000;

function invariant(ok: unknown, message: string): asserts ok {
    if (!ok) throw new Error(`[story-content] ${message}`);
}

function stableJson(value: unknown): string {
    return JSON.stringify(value) + "\n";
}

async function expectedFiles() {
    const assets: Array<{ village: string; slug: string; file: string; source: string; raw: number; gzip: number }> = [];
    const epilogueAssets: typeof assets = [];
    for (const village of STORY_CONTENT_VILLAGES) {
        const chapters = storylines[village];
        const interludes = storyInterludesByVillage[village];
        invariant(chapters?.length === 9, `${village} must have exactly nine chapters`);
        invariant(interludes?.length === 8, `${village} must have exactly eight interludes`);
        const payload: StoryContentPayload = {
            schemaVersion: STORY_CONTENT_SCHEMA_VERSION,
            village,
            chapters,
            interludes,
        };
        const json = stableJson(payload);
        validateStoryContentPayload(JSON.parse(json), village);
        const raw = Buffer.byteLength(json);
        const gzip = gzipSync(json, { level: 9 }).length;
        invariant(raw <= MAX_VILLAGE_RAW_BYTES, `${village} payload is ${raw} B; max ${MAX_VILLAGE_RAW_BYTES} B`);
        invariant(gzip <= MAX_VILLAGE_GZIP_BYTES, `${village} payload is ${gzip} B gzip; max ${MAX_VILLAGE_GZIP_BYTES} B`);
        const slug = storyContentSlug(village);
        const hash = createHash("sha256").update(json).digest("hex").slice(0, HASH_LENGTH);
        const file = `${slug}-${hash}.json`;
        assets.push({ village, slug, file, source: json, raw, gzip });
        const epilogueJson = stableJson(storyEpiloguesByVillage[village] ?? []);
        const epilogueHash = createHash("sha256").update(epilogueJson).digest("hex").slice(0, HASH_LENGTH);
        epilogueAssets.push({ village, slug, file: `epilogues-${slug}-${epilogueHash}.json`, source: epilogueJson,
            raw: Buffer.byteLength(epilogueJson), gzip: gzipSync(epilogueJson, { level: 9 }).length });
    }
    const echoesIds = ECHOES_OPPONENTS.map(({ id }) => id);
    invariant(echoesIds.length === 10, "Echoes of War must have exactly ten opponents");
    const sceneIds = Object.keys(ECHOES_SCENES);
    invariant(
        sceneIds.length === echoesIds.length && echoesIds.every((id, index) => sceneIds[index] === id),
        "echoes-of-war-scenes.ts must cover exactly ECHOES_OPPONENTS, in floor order",
    );
    const eraIds = ECHOES_ERAS.map(({ id }) => id);
    const introIds = Object.keys(ECHOES_ERA_INTROS);
    invariant(
        introIds.length === eraIds.length && eraIds.every((id, index) => introIds[index] === id),
        "echoes-of-war-scenes.ts ECHOES_ERA_INTROS must cover exactly ECHOES_ERAS, in order",
    );
    const witnessIds = Object.keys(ECHOES_WITNESS_CONTENT);
    invariant(
        witnessIds.length === eraIds.length && eraIds.every((id, index) => witnessIds[index] === id),
        "echoes-of-war-scenes.ts ECHOES_WITNESS_CONTENT must cover exactly ECHOES_ERAS, in order",
    );
    invariant(
        ECHOES_WITNESS_ERAS.length === eraIds.length
            && ECHOES_WITNESS_ERAS.every((era, index) => era.id === eraIds[index]),
        "shared Echoes witness eras must stay in lockstep with ECHOES_ERAS",
    );
    // The browsable ladder renders exclusively through ECHOES_ERAS (era plates ->
    // era.floors), so a floor belonging to no era is unreachable in the UI, and
    // because the server unlocks floors strictly in sequence, an orphaned floor
    // stalls the whole campaign. Every opponent floor must land in exactly one era.
    const eraFloors = ECHOES_ERAS.flatMap((era) => era.floors).sort((a, b) => a - b);
    invariant(
        eraFloors.length === echoesIds.length && eraFloors.every((floor, index) => floor === index + 1),
        "ECHOES_ERAS floors must cover every opponent floor exactly once, in sequence",
    );
    const echoesPayload: EchoesContentPayload = {
        schemaVersion: ECHOES_CONTENT_SCHEMA_VERSION,
        scope: ECHOES_CONTENT_KEY,
        scenes: ECHOES_SCENES,
        eras: ECHOES_ERA_INTROS,
        witness: ECHOES_WITNESS_CONTENT,
    };
    const echoesJson = stableJson(echoesPayload);
    validateEchoesContentPayload(JSON.parse(echoesJson));
    const echoesRaw = Buffer.byteLength(echoesJson);
    const echoesGzip = gzipSync(echoesJson, { level: 9 }).length;
    invariant(echoesRaw <= MAX_ECHOES_RAW_BYTES, `${ECHOES_CONTENT_KEY} payload is ${echoesRaw} B; max ${MAX_ECHOES_RAW_BYTES} B`);
    invariant(echoesGzip <= MAX_ECHOES_GZIP_BYTES, `${ECHOES_CONTENT_KEY} payload is ${echoesGzip} B gzip; max ${MAX_ECHOES_GZIP_BYTES} B`);
    const echoesHash = createHash("sha256").update(echoesJson).digest("hex").slice(0, HASH_LENGTH);
    const echoes = { file: `${ECHOES_CONTENT_KEY}-${echoesHash}.json`, source: echoesJson, raw: echoesRaw, gzip: echoesGzip };

    const fieldPayload: StoryFieldContentPayload = {
        schemaVersion: STORY_FIELD_CONTENT_SCHEMA_VERSION,
        scenes: storyFieldScenes,
        reckonings: storyReckonings,
    };
    const fieldJson = stableJson(fieldPayload);
    validateStoryFieldContent(JSON.parse(fieldJson));
    const fieldRaw = Buffer.byteLength(fieldJson);
    const fieldGzip = gzipSync(fieldJson, { level: 9 }).length;
    invariant(fieldRaw <= MAX_FIELD_RAW_BYTES, `field journey payload is ${fieldRaw} B; max ${MAX_FIELD_RAW_BYTES} B`);
    invariant(fieldGzip <= MAX_FIELD_GZIP_BYTES, `field journey payload is ${fieldGzip} B gzip; max ${MAX_FIELD_GZIP_BYTES} B`);
    const fieldHash = createHash("sha256").update(fieldJson).digest("hex").slice(0, HASH_LENGTH);
    const fieldAsset = { file: `field-scenes-${fieldHash}.json`, source: fieldJson, raw: fieldRaw, gzip: fieldGzip };
    const roadPayload: StoryRoadContentPayload = {
        schemaVersion: STORY_ROAD_CONTENT_SCHEMA_VERSION,
        events: storyRoadEvents,
    };
    const roadJson = stableJson(roadPayload);
    validateStoryRoadContent(JSON.parse(roadJson));
    const roadRaw = Buffer.byteLength(roadJson);
    const roadGzip = gzipSync(roadJson, { level: 9 }).length;
    invariant(roadRaw <= MAX_ROAD_RAW_BYTES, `road event payload is ${roadRaw} B; max ${MAX_ROAD_RAW_BYTES} B`);
    invariant(roadGzip <= MAX_ROAD_GZIP_BYTES, `road event payload is ${roadGzip} B gzip; max ${MAX_ROAD_GZIP_BYTES} B`);
    const roadHash = createHash("sha256").update(roadJson).digest("hex").slice(0, HASH_LENGTH);
    const road = { file: `road-events-${roadHash}.json`, source: roadJson, raw: roadRaw, gzip: roadGzip };
    const manifest = `/* Generated by scripts/generate-story-content.mts. Do not edit. */\nimport type { StoryContentVillage } from "../../lib/story-content-contract";\n${assets.map(({ slug, file }) => `import ${slug.replace(/-/g, "_")}Url from "./${file}?url";`).join("\n")}\n${epilogueAssets.map(({ slug, file }) => `import ${slug.replace(/-/g, "_")}EpiloguesUrl from "./${file}?url";`).join("\n")}\nimport echoes_of_warUrl from "./${echoes.file}?url";\nimport storyFieldContentUrl from "./${fieldAsset.file}?url";\nimport storyRoadContentUrl from "./${road.file}?url";\n\nexport const STORY_CONTENT_URLS: Record<StoryContentVillage, string> = {\n${assets.map(({ village, slug }) => `    ${JSON.stringify(village)}: ${slug.replace(/-/g, "_")}Url,`).join("\n")}\n};\n\nexport const STORY_EPILOGUE_URLS: Record<StoryContentVillage, string> = {\n${epilogueAssets.map(({ village, slug }) => `    ${JSON.stringify(village)}: ${slug.replace(/-/g, "_")}EpiloguesUrl,`).join("\n")}\n};\n\nexport const STORY_FIELD_CONTENT_URL = storyFieldContentUrl;\n\n/** The Echoes of War campaign script (fetched by lib/echoes-content-loader.ts). */\nexport const ECHOES_CONTENT_URL: string = echoes_of_warUrl;\n\n/** Road-event scripts fetched before World Map eligibility is evaluated. */\nexport const STORY_ROAD_CONTENT_URL: string = storyRoadContentUrl;\n`;
    return { assets, epilogueAssets, fieldAsset, echoes, road, manifest };
}

async function main() {
    const { assets, epilogueAssets, fieldAsset, echoes, road, manifest } = await expectedFiles();
    const expected = new Map([...assets, ...epilogueAssets].map(({ file, source }) => [file, source]));
    expected.set(fieldAsset.file, fieldAsset.source);
    expected.set(echoes.file, echoes.source);
    expected.set(road.file, road.source);
    expected.set("manifest.ts", manifest);
    await mkdir(outputDir, { recursive: true });
    const current = (await readdir(outputDir)).filter((file) => file.endsWith(".ts") || file.endsWith(".json"));
    if (checkOnly) {
        invariant(current.length === expected.size, `generated file count is ${current.length}; expected ${expected.size}`);
        for (const [file, source] of expected) {
            const actual = await readFile(path.join(outputDir, file), "utf8").catch(() => "");
            invariant(actual === source, `${file} is stale; run npm run generate:story-content`);
        }
    } else {
        for (const file of current) if (!expected.has(file)) await rm(path.join(outputDir, file));
        for (const [file, source] of expected) await writeFile(path.join(outputDir, file), source, "utf8");
    }
    const raw = assets.reduce((sum, item) => sum + item.raw, 0);
    const gzip = assets.reduce((sum, item) => sum + item.gzip, 0);
    const epilogueRaw = epilogueAssets.reduce((sum, item) => sum + item.raw, 0);
    const epilogueGzip = epilogueAssets.reduce((sum, item) => sum + item.gzip, 0);
    console.log(`[story-content] ${checkOnly ? "verified" : "generated"} ${assets.length} village assets (${raw} B raw / ${gzip} B gzip), ${epilogueAssets.length} epilogue assets (${epilogueRaw} B raw / ${epilogueGzip} B gzip), field journeys (${fieldAsset.raw} B raw / ${fieldAsset.gzip} B gzip), Echoes of War (${echoes.raw} B raw / ${echoes.gzip} B gzip), and road events (${road.raw} B raw / ${road.gzip} B gzip)`);
}

await main();
