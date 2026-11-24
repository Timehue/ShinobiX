// Bake the land between Coast paintings at its in-game scale. Coordinates are
// measured on 300 px proofs of the original square paintings, away from roads.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/coast-map/', import.meta.url));
const regions = [
    [[101, 125, 76], [101, 171, 108], [103, 155, 129], [103, 27, 148]],
    [[111, 52, 64], [111, 119, 151], [112, 143, 131], [112, 187, 166]],
    [[121, 104, 153], [121, 125, 180], [122, 89, 177], [122, 130, 183]],
    [[131, 58, 148], [131, 114, 170], [132, 138, 166], [132, 175, 187]],
    [[142, 79, 149], [142, 113, 155], [142, 150, 170], [142, 182, 155]],
];
const spacing = 96, fieldSize = spacing * 12, cropSize = 213;
let seed = 731;
const random = () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2 ** 32;

// In sector tiles: a straight horizontal run and the centre of a turn. Turn
// each elbow so that its arms always point north and west in the saved plate.
const trails = [
    [101, 5.3, 7.5, 5, 8.5, 2.5, 0],
    [111, 7.8, 5.5, 1.9, 10.5, 5.5, 90],
    [121, 4.2, 5.5, 2.4, 7.5, 5.5, 0],
    [131, 5.9, 5.5, 1.8, 8.5, 5.5, 90],
    [142, 2.5, 5.5, 6.8, 1.5, 5.5, 180],
];
// Isolated natural features, including their footing and painted shadows.
const outcrops = [[103, 1.75, .95], [112, 1.7, 1.45], [121, 4.05, 8.65], [131, .94, 7.5], [142, 4.1, .65]];
async function trailPiece(sector, x, y, w, h, angle, opacity) {
    const source = sharp(dir + 's' + sector + '.webp');
    const unit = (await source.metadata()).width / 12, width = Math.round(w * 80), height = Math.round(h * 80);
    const cut = await source.extract({ left: Math.round(x * unit), top: Math.round(y * unit),
        width: Math.round(w * unit), height: Math.round(h * unit) }).png().toBuffer();
    const alpha = Buffer.alloc(width * height);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
        alpha[j * width + i] = Math.round(255 * Math.max(0, Math.min(1, opacity((i + .5) / width - .5, (j + .5) / height - .5))));
    }
    const rgb = await sharp(cut).rotate(angle).resize(width, height).removeAlpha().png().toBuffer();
    return sharp(rgb).joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

for (const [index, region] of regions.entries()) {
    const crops = [];
    for (const [sector, x, y] of region) {
        const floor = sharp(dir + 's' + sector + '.webp');
        const { width } = await floor.metadata();
        const unit = width / 300;
        crops.push(await floor.extract({ left: Math.round(x * unit), top: Math.round(y * unit),
            width: Math.round(65 * unit), height: Math.round(65 * unit) })
            .resize(cropSize, cropSize).removeAlpha().toColourspace('srgb').raw().toBuffer());
    }
    const colors = new Float32Array(fieldSize * fieldSize * 3), weights = new Float32Array(fieldSize * fieldSize);
    // Wrap the samples at both edges, leaving neither a visible grid nor a seam.
    for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) {
        const crop = crops[Math.floor(random() * crops.length)];
        const flip = random() < .5, startX = col * spacing + Math.floor(random() * 38), startY = row * spacing + Math.floor(random() * 38);
        for (let y = 0; y < cropSize; y++) for (let x = 0; x < cropSize; x++) {
            const distance = Math.hypot(x + .5 - cropSize / 2, y + .5 - cropSize / 2);
            const alpha = Math.min(1, Math.max(0, (cropSize / 2 - distance) / 25));
            if (!alpha) continue;
            const dst = (startY + y) % fieldSize * fieldSize + (startX + x) % fieldSize;
            const src = (y * cropSize + (flip ? cropSize - 1 - x : x)) * 3;
            // Feather the perimeter only: keep the fine brushwork inside each patch.
            for (let c = 0; c < 3; c++) colors[dst * 3 + c] = colors[dst * 3 + c] * (1 - alpha) + crop[src + c] * alpha;
            weights[dst] = weights[dst] * (1 - alpha) + alpha;
        }
    }
    const pixels = Buffer.from(colors.map((value, i) => Math.round(value / weights[Math.floor(i / 3)])));
    await sharp(pixels, { raw: { width: fieldSize, height: fieldSize, channels: 3 } })
        .webp({ quality: 86, effort: 6 }).toFile(dir + 'trail-ground-' + (index + 1) + '.webp');
    const [sector, x, y, length, cx, cy, turn] = trails[index];
    const straight = await trailPiece(sector, x, y - .8, length, 1.6, 0, (_, v) => (.5 - Math.abs(v)) / .28);
    const { width, height } = await sharp(straight).metadata();
    await sharp({ create: { width: width * 2, height, channels: 4, background: '#0000' } })
        .composite([{ input: straight, left: 0, top: 0 }, { input: await sharp(straight).flop().png().toBuffer(), left: width, top: 0 }])
        .webp({ quality: 90 }).toFile(dir + 'trail-straight-' + (index + 1) + '.webp');
    const corner = await trailPiece(sector, cx - 1.5, cy - 1.5, 3, 3, turn, (u, v) => (.5 - Math.hypot(u, v)) / .14);
    await sharp(corner).webp({ quality: 90 }).toFile(dir + 'trail-corner-' + (index + 1) + '.webp');
    const [reliefSector, sx, sy] = outcrops[index];
    const relief = await trailPiece(reliefSector, sx, sy, 3, 3, 0, (u, v) => (.5 - Math.hypot(u, v)) / .25);
    await sharp(relief).webp({ quality: 89 }).toFile(dir + 'trail-relief-' + (index + 1) + '.webp');
}

// Build a horizontal span from the Slip's painted floorboards, sill, and end
// posts. The deck casts its shadow across the lower path at an overpass.
const slip = await sharp(dir + 'saltstair-landing/interiors/s101-floor-v1.webp').resize(512, 512).png().toBuffer();
async function timber(left, top, width, height, w, h, turn = 0) {
    const cut = await sharp(slip).extract({ left, top, width, height }).png().toBuffer();
    return sharp(cut).rotate(turn).resize(w, h, { fit: 'fill' }).png().toBuffer();
}
const deck = await timber(191, 115, 150, 300, 208, 88, 90);
const rail = await timber(23, 478, 367, 23, 212, 12);
const post = await timber(6, 476, 18, 23, 14, 16);
const parts = [{ input: deck, left: 15, top: 21 }];
for (const y of [16, 101]) {
    parts.push({ input: rail, left: 13, top: y });
    for (const x of [12, 110, 212]) parts.push({ input: post, left: x, top: y - 1 });
}
const plate = { create: { width: 242, height: 140, channels: 4, background: '#0000' } };
const boards = await sharp(plate).composite(parts).png().toBuffer();
const shadow = await sharp(boards).linear([0, 0, 0, .46], [22, 19, 12, 0]).blur(3).png().toBuffer();
await sharp(plate).composite([{ input: await sharp(shadow).extract({ left: 0, top: 0, width: 236, height: 132 }).png().toBuffer(), left: 5, top: 8 },
    { input: boards }]).webp({ quality: 92 }).toFile(dir + 'trail-bridge.webp');
