import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const publicRoot = path.resolve("public");
const environmentDir = path.join(publicRoot, "scenes", "story", "cinematic");
const actorDir = path.join(publicRoot, "portraits", "cinematic");
const scoreDir = path.join(publicRoot, "music", "vn");
const directionSourcePath = path.resolve("src", "lib", "vn-storywide-direction.ts");
const storySourcePaths = [
    path.resolve("src", "data", "storylines.ts"),
    path.resolve("src", "data", "story-interludes.ts"),
    path.resolve("src", "data", "story-road-events.ts"),
    path.resolve("src", "data", "hollow-rifts.ts"),
    path.resolve("src", "data", "vn-events.ts"),
    path.resolve("src", "data", "default-vn-events.ts"),
];

const directionSource = await readFile(directionSourcePath, "utf8");
const actorMapBlock = directionSource.match(/export const STORYWIDE_ACTORS[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
const storywideActorMap = new Map(
    [...actorMapBlock.matchAll(/^\s*(?:"([^"]+)"|([a-z][a-z0-9_-]*)):\s*"([^"]+)",/gm)]
        .map((match) => [match[1] ?? match[2], match[3]]),
);
const sideEnvironmentMapBlock = directionSource.match(/export const SIDE_STORY_ENVIRONMENTS[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
const sideEnvironments = [...sideEnvironmentMapBlock.matchAll(
    /^\s*"[^"]+":\s*"\/scenes\/story\/cinematic\/([^"]+)",/gm,
)].map((match) => match[1]);
const mappedActors = [...new Set([...storywideActorMap.values()].map((asset) =>
    asset.replace(/^\/portraits\/cinematic\//, ""),
))];

const environments = [
    "ashen-register-hall-wide.webp",
    "ashen-register-wall.webp",
    "ashen-black-flower-reveal.webp",
    "ashen-old-grove-trial.webp",
    "ashen-register-annex.webp",
    "ashen-annex-charts.webp",
    "ashen-annex-steps.webp",
    ...["stormveil", "ashen", "frostfang", "moonshadow"].flatMap((village) =>
        ["civic", "intimate", "threshold", "sanctum"].map((family) => `storywide/${village}-${family}.webp`),
    ),
    ...[
        "stormveil-aftermath",
        "stormveil-blackout",
        "ashen-ashfall",
        "ashen-aftermath",
        "frostfang-whiteout",
        "frostfang-aftermath",
        "moonshadow-blackout",
        "moonshadow-aftermath",
    ].map((environment) => `storywide/${environment}.webp`),
    ...[
        "stormveil-climax-blank-board",
        "ashen-climax-rootfire",
        "frostfang-climax-meter-zero",
        "moonshadow-climax-black-glass",
    ].map((environment) => `storywide/${environment}.webp`),
    "storywide/frostfang-pale-pack-cavern-mouth.webp",
    "storywide/frostfang-pale-pack-cavern-interior.webp",
    ...sideEnvironments,
];

const actors = [
    ...mappedActors,
    ...[
        "mira-volt-neutral",
        "kage-sable-nocturne-readable",
        "nyx-neutral",
        "shade-master-iro-tense",
        "kage-hoshina-enju-tense-canon",
        "captain-yura-injured",
        "mira-volt-grieving",
        "toma-reed-resolute",
        "captain-yura-defiant",
        "nyx-resolute",
        "elder-vanta-solemn",
        "elder-mori-solemn",
        "elder-sova-solemn-canon",
        "shade-master-iro-solemn",
    ].map((actor) => `storywide/${actor}.webp`),
];

const authoredActors = [
    "storywide/kage-raiko-veyr-hollow.webp",
    "storywide/kage-hoshina-enju-hollow-canon.webp",
    "storywide/kage-kael-whitefang-hollow.webp",
    "storywide/kage-sable-nocturne-hollow.webp",
];

const scores = [
    "stormveil-reasons-in-rain.ogg",
    "ashen-future-in-fire.ogg",
    "frostfang-warmth-we-keep.ogg",
    "moonshadow-name-under-glass.ogg",
    "hollow-gate-four-debts.ogg",
];

const failures = [];
let totalBytes = 0;

const namedSpeakers = new Set();
for (const sourcePath of storySourcePaths) {
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/\b(?:speaker|leftName|rightName):\s*"([^"]+)"/g)) {
        if (match[1] !== "Narrator" && match[1] !== "Player") namedSpeakers.add(match[1]);
    }
}
namedSpeakers.add("Scribe Ihara");
namedSpeakers.add("Wandering Sage");
for (const speaker of namedSpeakers) {
    const asset = storywideActorMap.get(speaker.trim().toLowerCase());
    if (!asset) failures.push(`${speaker}: named main-story speaker has no cinematic actor route`);
    else if (!asset.startsWith("/portraits/cinematic/")) failures.push(`${speaker}: actor route still uses legacy boxed art (${asset})`);
}

async function inspectAsset(root, relativePath, kind) {
    const file = path.join(root, relativePath);
    try {
        const [info, fileStat] = await Promise.all([sharp(file).metadata(), stat(file)]);
        totalBytes += fileStat.size;
        const budget = kind === "environment" ? 700_000 : 600_000;
        if (fileStat.size > budget) failures.push(`${relativePath}: ${fileStat.size} bytes exceeds ${budget}`);
        if (kind === "environment" && (info.width !== 1672 || info.height !== 941)) {
            failures.push(`${relativePath}: expected 1672x941, received ${info.width}x${info.height}`);
        }
        if (kind === "actor" && !info.hasAlpha) failures.push(`${relativePath}: actor art has no alpha channel`);
        if (kind === "actor" && (info.width ?? 0) < 900) failures.push(`${relativePath}: actor width is below 900px`);
        if (kind === "actor") {
            const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            let transparentPixels = 0;
            for (let index = 3; index < data.length; index += 4) {
                if (data[index] < 16) transparentPixels += 1;
            }
            const transparentRatio = transparentPixels / (data.length / 4);
            if (transparentRatio < 0.15) {
                failures.push(`${relativePath}: only ${(transparentRatio * 100).toFixed(1)}% transparent area; likely contains a baked matte`);
            }
        }
        console.log(`PASS ${kind.padEnd(11)} ${String(info.width).padStart(4)}x${String(info.height).padEnd(4)} ${String(fileStat.size).padStart(7)} B  ${relativePath}`);
    } catch (error) {
        failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function inspectScore(relativePath) {
    const file = path.join(scoreDir, relativePath);
    let handle;
    try {
        const fileStat = await stat(file);
        handle = await open(file, "r");
        const signature = Buffer.alloc(4);
        await handle.read(signature, 0, signature.length, 0);
        totalBytes += fileStat.size;
        if (signature.toString("ascii") !== "OggS") failures.push(`${relativePath}: missing OggS container signature`);
        if (fileStat.size < 500_000) failures.push(`${relativePath}: ${fileStat.size} bytes is unexpectedly small`);
        if (fileStat.size > 4_000_000) failures.push(`${relativePath}: ${fileStat.size} bytes exceeds the 4 MB delivery budget`);
        console.log(`PASS score                    ${String(fileStat.size).padStart(7)} B  ${relativePath}`);
    } catch (error) {
        failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        await handle?.close();
    }
}

for (const environment of environments) await inspectAsset(environmentDir, environment, "environment");
for (const actor of actors) await inspectAsset(actorDir, actor, "actor");
for (const actor of authoredActors) await inspectAsset(actorDir, actor, "actor");
for (const score of scores) await inspectScore(score);

if (failures.length) {
    console.error("\nCinematic VN certification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`\nCertified ${environments.length} environments, ${actors.length + authoredActors.length} actor cutouts, and ${scores.length} score loops (${(totalBytes / 1_048_576).toFixed(2)} MiB total).`);
