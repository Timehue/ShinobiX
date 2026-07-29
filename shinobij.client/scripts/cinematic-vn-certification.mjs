import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const publicRoot = path.resolve("public");
const environmentDir = path.join(publicRoot, "scenes", "story", "cinematic");
const actorDir = path.join(publicRoot, "portraits", "cinematic");

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
];

const actors = [
    "toma-reed.webp",
    "registry-duty-clerk.webp",
    "elder-mori.webp",
    "kite-harrow.webp",
    ...[
        "mira-volt",
        "kage-raiko-veyr",
        "elder-vanta",
        "kage-hoshina-enju",
        "captain-yura",
        "kage-kael-whitefang",
        "elder-sova",
        "nyx",
        "kage-sable-nocturne",
        "shade-master-iro",
    ].map((actor) => `storywide/${actor}.webp`),
];

const failures = [];
let totalBytes = 0;

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
        console.log(`PASS ${kind.padEnd(11)} ${String(info.width).padStart(4)}x${String(info.height).padEnd(4)} ${String(fileStat.size).padStart(7)} B  ${relativePath}`);
    } catch (error) {
        failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

for (const environment of environments) await inspectAsset(environmentDir, environment, "environment");
for (const actor of actors) await inspectAsset(actorDir, actor, "actor");

if (failures.length) {
    console.error("\nCinematic VN certification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`\nCertified ${environments.length} environments and ${actors.length} actor cutouts (${(totalBytes / 1_048_576).toFixed(2)} MiB total).`);
