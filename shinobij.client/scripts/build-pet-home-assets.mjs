import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "asset-gen-out/pet-home");
const petHome = resolve(root, "src/assets/pet-home");
const facilities = resolve(root, "src/assets/facilities");
const thumbs = resolve(facilities, "thumbs");

await Promise.all([mkdir(petHome, { recursive: true }), mkdir(facilities, { recursive: true })]);

async function copy(name, destination) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(source, name), destination);
}

async function encodeSquare(name, destination, size = 1024) {
    await mkdir(dirname(destination), { recursive: true });
    await sharp(resolve(source, name))
        .resize(size, size, { fit: "cover", position: "centre" })
        .webp({ quality: 90 })
        .toFile(destination);
}

async function splitSheet(name, count, outputs, size) {
    const input = resolve(source, name);
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) throw new Error(`Unreadable sprite sheet: ${name}`);
    const cellWidth = Math.floor(meta.width / count);
    for (let i = 0; i < outputs.length; i += 1) {
        const output = outputs[i];
        if (!output) continue;
        const left = i * cellWidth;
        const width = i === count - 1 ? meta.width - left : cellWidth;
        const target = resolve(root, output);
        await mkdir(dirname(target), { recursive: true });
        await sharp(input)
            .extract({ left, top: 0, width, height: meta.height })
            .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 88, alphaQuality: 100 })
            .toFile(target);
    }
}

await copy("pet-home-candidate-b.webp", resolve(petHome, "home-hero.webp"));
await copy("pet-home-candidate-b.webp", resolve(facilities, "home.webp"));
await copy("breeding-barn-candidate-b.webp", resolve(petHome, "breeding-barn.webp"));
await encodeSquare("hatch-sanctum-candidate-b.png", resolve(petHome, "hatch-sanctum.webp"));
await copy("egg-fire.webp", resolve(petHome, "egg-fire.webp"));
await copy("egg-wind.webp", resolve(petHome, "egg-wind.webp"));

await splitSheet("element-eggs-sheet.webp", 4, [
    null,
    "src/assets/pet-home/egg-water.webp",
    "src/assets/pet-home/egg-lightning.webp",
    "src/assets/pet-home/egg-earth.webp",
], 512);

await splitSheet("element-crests-sheet.webp", 5, [
    "src/assets/pet-home/crest-fire.webp",
    "src/assets/pet-home/crest-water.webp",
    "src/assets/pet-home/crest-wind.webp",
    "src/assets/pet-home/crest-lightning.webp",
    "src/assets/pet-home/crest-earth.webp",
], 320);

await splitSheet("hatch-overlays-sheet.webp", 2, [
    "src/assets/pet-home/hatch-rare-overlay.webp",
    "src/assets/pet-home/hatch-chromatic-overlay.webp",
], 768);

// The per-village Pet Home thumbnails are NOT built here any more. The generated
// home-thumbs-sheet.webp never matched its prompt: the four crests sit off the
// cell grid on a white ground, and the outer two (Frostfang, Moonshadow) are
// clipped by the sheet edge — so no split, aligned or not, yields a usable icon.
// src/assets/facilities/thumbs/<village>/home.webp now carries the painted
// pet-yard paw emblem, which already matches the village-map icon family.
// Re-enable this only against a sheet that actually contains four whole crests.

console.log("Built selected Pet Home production assets.");
