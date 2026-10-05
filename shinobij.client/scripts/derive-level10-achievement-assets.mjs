import sharp from "sharp";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

const master = fileURLToPath(new URL("../art-source/achievement-badges/level-10-rising-ember-crest-master.png", import.meta.url));
const webBadge = fileURLToPath(new URL("../public/badges/level-10.webp", import.meta.url));
const playGamesIcon = fileURLToPath(new URL("../../docs/play-games/achievement-icons/achievement-level-10.png", import.meta.url));

await sharp(master).resize(256, 256).webp({ quality: 88 }).toFile(webBadge);

// Google Play Games expects a transparent 512 × 512 icon. The source is a
// full-bleed square render, so clip it to the round award medallion here.
const circularAlpha = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="250" fill="white"/></svg>',
);
await sharp(master)
    .resize(512, 512)
    .composite([{ input: circularAlpha, blend: "dest-in" }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(playGamesIcon);

console.log("Derived the 256 × 256 in-game badge and circular 512 × 512 Play Games icon from the level 10 master.");
