// Package the Hollow Gate cave-chamber art set (docs/art/hollow-gate-cavern-chambers.json)
// into public/underground. Run from shinobij.client/:
//   node scripts/package-cavern-chambers.mjs
// Each record's `source` is the full-size generated PNG; `output` and `size`
// fix the shipped WebP. Decals with an `alphaFrom` rule are cut down to the
// painted crack itself, so the room painting shows through the stone around
// it (the generator paints a stone patch with a soft fringe behind the crack).
import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const clamp = (v) => Math.max(0, Math.min(1, v));
/** Keep-weight per pixel for each decal rule (r, g, b in 0..1). */
const KEEP = {
    // A dark fissure with an ember glow deep inside.
    crack: (r, g, b) => {
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const ember = clamp((r - Math.max(g, b) - 0.12) * 4);
        return Math.max(clamp((0.13 - lum) / 0.07), ember);
    },
    // Fire: bright, saturated, warm.
    fire: (r, g, b) => {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max ? (max - min) / max : 0;
        return clamp((max * sat - 0.22) / 0.28);
    },
    // The erupting crack: its fire, and the dark lip of the crack it rises from.
    fireCrack: (r, g, b) => Math.max(KEEP.fire(r, g, b), 0.85 * KEEP.crack(r, g, b)),
    // Dark cracks through rock, plus the cold draught-light seeping out.
    fracture: (r, g, b) => {
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const cold = clamp((b - r - 0.06) * 5);
        return Math.max(clamp((0.17 - lum) / 0.07), cold);
    },
};

const manifest = JSON.parse(await readFile('../docs/art/hollow-gate-cavern-chambers.json', 'utf8'));
await mkdir('public/underground', { recursive: true });
for (const record of manifest.records) {
    const output = record.output.replace('shinobij.client/', '');
    const [width, height] = record.size;
    let source = sharp(record.source);
    if (record.band) {
        // Halls are painted as a wide band letterboxed in black: keep the rows
        // the room actually occupies, then size it to its 3:1 footprint.
        const { data, info } = await sharp(record.source).greyscale().raw().toBuffer({ resolveWithObject: true });
        const lit = (y) => { let sum = 0; for (let x = 0; x < info.width; x += 1) sum += data[y * info.width + x]; return sum / info.width > 10; };
        let top = 0, bottom = info.height - 1;
        while (top < bottom && !lit(top)) top += 1;
        while (bottom > top && !lit(bottom)) bottom -= 1;
        source = sharp(record.source).extract({ left: 0, top, width: info.width, height: bottom - top + 1 });
    }
    let image = sharp(await source.toBuffer()).resize(width, height, { fit: 'fill' });
    if (record.defringe) {
        // Props: the generator leaves a pale half-transparent halo round each
        // object. Tighten the edge and darken what is left of the rim.
        const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3] / 255;
            if (a < 0.9) for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(data[i + c] * (0.35 + 0.65 * a));
            data[i + 3] = Math.round(255 * clamp((a - 0.3) / 0.55));
        }
        // The halo is painted into opaque pixels too, so erode the silhouette
        // a few pixels (a min filter on alpha), then feather the new edge.
        const radius = Math.max(2, Math.round(info.width / 64));
        const alpha = new Uint8Array(info.width * info.height);
        for (let p = 0; p < alpha.length; p += 1) alpha[p] = data[p * 4 + 3];
        for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
            let low = 255;
            for (let dy = -radius; dy <= radius && low > 0; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
                const nx = x + dx, ny = y + dy;
                const v = nx < 0 || ny < 0 || nx >= info.width || ny >= info.height ? 0 : alpha[ny * info.width + nx];
                if (v < low) low = v;
            }
            data[(y * info.width + x) * 4 + 3] = low;
        }
        image = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).blur(0.7);
    } else if (record.alphaFrom) {
        const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const keep = KEEP[record.alphaFrom];
        for (let i = 0; i < data.length; i += 4) {
            const weight = keep(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
            data[i + 3] = Math.round(data[i + 3] * weight);
            // Fractures read as deeper shadow in the rock, so a sharp eye finds them.
            if (record.alphaFrom === 'fracture') for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(data[i + c] * 0.4);
        }
        image = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).blur(0.6);
    }
    await image.webp({ quality: record.transparent ? 86 : 82, alphaQuality: 90 }).toFile(output);
    console.log(output);
}
