// Slices the interior cast atlas into dialogue portraits.
//
//   node scripts/process-first-pact-interior-cast.mjs [source.png] [outDir]
//
// Twin of process-first-pact-portraits.mjs, for the six people who stand inside
// the city's six enterable buildings. Cell order matches the atlas prompt in
// gen-first-pact-interior-cast.mjs; the file names match the interior NPC ids
// in lib/first-pact-interiors.ts, which is what FirstPact.tsx keys art on.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "src/assets/first-pact/interior-cast-atlas-source.png");
const outputDir = resolve(process.argv[3] ?? "src/assets/first-pact/portraits");
const portraits = [
    ["archive-warden-ashi", 0, 0],
    ["ledger-keeper-mun", 1, 0],
    ["annex-attendant-sero", 2, 0],
    ["oathkeeper-bel", 0, 1],
    ["lodge-steward-nia", 1, 1],
    ["tea-apprentice-juno", 2, 1],
];

await mkdir(outputDir, { recursive: true });
const metadata = await sharp(source).metadata();
if (metadata.width !== 1536 || metadata.height !== 1024) {
    throw new Error(`Expected a 1536x1024 six-cell atlas, received ${metadata.width}x${metadata.height}.`);
}

await Promise.all(portraits.map(async ([name, column, row]) => {
    const target = resolve(outputDir, `${name}.webp`);
    if (!target.startsWith(`${outputDir}\\`) && dirname(target) !== outputDir) throw new Error("Unsafe portrait target.");
    await sharp(source)
        .extract({ left: Number(column) * 512, top: Number(row) * 512, width: 512, height: 512 })
        .webp({ quality: 88, smartSubsample: true })
        .toFile(target);
}));

await sharp(source)
    .webp({ quality: 86, smartSubsample: true })
    .toFile(resolve(dirname(outputDir), "sunken-court-interior-cast-atlas.webp"));
