#!/usr/bin/env node
/*
 * Cut the Roaming Boss battle art out of each boss's world walk sheet.
 *
 * The world boss team fight runs on the Tower board, which draws enemy bodies
 * from a transparent idle sprite and the rail from a square portrait. The three
 * roaming bosses only shipped map art (a four-frame walk strip) and widescreen
 * key art, so the board fell back to the neutral shinobi body. This script
 * derives both board assets from the first walk frame, so the fighter on the
 * board is the same creature the player saw in the sector.
 *
 * The idle sprite keeps the frame's native size: the board draws bodies with
 * `object-fit: contain` anchored to the feet, so a trimmed frame renders exactly
 * like a padded square and upscaling would only add bytes.
 *
 *   node shinobij.client/scripts/gen-world-boss-combat-art.mjs
 *
 * Output: public/world-boss/<art>-{battle,portrait}-v1.webp, beside the walk
 * sheets they come from. `WORLD_BOSS_DEFINITIONS` (shared/world-boss-event.ts)
 * names each file; src/assets/combat-actors is reserved for the 384x384 bundled
 * set that battlefield-actor-art.test.ts counts.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(clientRoot, "public", "world-boss");
const outDir = sourceDir;
const PORTRAIT_SIZE = 192;
const WALK_FRAMES = 4;

// Portrait crop per boss, as fractions of the trimmed frame: `top` and `side`
// of a square, centred on `centerX`. The bull carries a shrine on its back, so
// its face sits low and right of centre.
const BOSSES = [
    { art: "hollow-beast", sheet: "hollow-beast-walk-v1.webp", portrait: { top: 0, side: 0.62, centerX: 0.42 } },
    { art: "hollow-gate-bull", sheet: "hollow-gate-bull-walk-v1.webp", portrait: { top: 0.4, side: 0.5, centerX: 0.66 } },
    { art: "donkaku", sheet: "donkaku-walk-v1.webp", portrait: { top: 0, side: 0.55, centerX: 0.5 } },
];

async function firstFrame(sheetPath) {
    const meta = await sharp(sheetPath).metadata();
    const frameWidth = Math.floor(meta.width / WALK_FRAMES);
    const frame = await sharp(sheetPath)
        .extract({ left: 0, top: 0, width: frameWidth, height: meta.height })
        .png()
        .toBuffer();
    // Drop the transparent margin so the body, not the cell, decides the scale.
    return sharp(frame).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
}

mkdirSync(outDir, { recursive: true });
for (const boss of BOSSES) {
    const { data: body, info } = await firstFrame(path.join(sourceDir, boss.sheet));

    // Board body: the trimmed frame, feet on the bottom edge.
    await sharp(body)
        .webp({ quality: 82, alphaQuality: 90, effort: 6 })
        .toFile(path.join(outDir, `${boss.art}-battle-v1.webp`));

    // Rail portrait: head and shoulders on the board's dark plate. The rail
    // shows opaque portraits for every other boss, so this one is opaque too.
    const cropSide = Math.max(1, Math.min(info.width, info.height, Math.round(info.height * boss.portrait.side)));
    const left = Math.max(0, Math.min(info.width - cropSide, Math.round(info.width * boss.portrait.centerX - cropSide / 2)));
    const top = Math.max(0, Math.min(info.height - cropSide, Math.round(info.height * boss.portrait.top)));
    const head = await sharp(body)
        .extract({ left, top, width: cropSide, height: cropSide })
        .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: "cover", position: "top" })
        .png()
        .toBuffer();
    const plate = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${PORTRAIT_SIZE}" height="${PORTRAIT_SIZE}">`
        + `<defs><radialGradient id="g" cx="50%" cy="42%" r="70%">`
        + `<stop offset="0" stop-color="#2a3346"/><stop offset="1" stop-color="#070b14"/>`
        + `</radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
    );
    await sharp(plate)
        .composite([{ input: head }])
        .flatten({ background: "#070b14" })
        .webp({ quality: 84, effort: 6 })
        .toFile(path.join(outDir, `${boss.art}-portrait-v1.webp`));
    console.log(`${boss.art}: frame ${info.width}x${info.height} -> battle + portrait`);
}
