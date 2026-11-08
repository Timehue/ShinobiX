// Keys the flat magenta (#FF00FF) background out of the generated top-down
// shelter render and centres the shelter on a square transparent canvas, the
// shape the sector-building sprite pipeline expects (512 x 512 after packaging).
// Run from the repo root:
//   node shinobij.client/art-source/flower-pickers-shelter/cutout.mjs
import sharp from 'sharp';

const dir = 'shinobij.client/art-source/flower-pickers-shelter';
const { data, info } = await sharp(`${dir}/shelter-map-source.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const px = (x, y) => (y * w + x) * 4;
// How strongly a pixel reads as the magenta key: red and blue high, green low.
const keyness = (i) => Math.min(data[i], data[i + 2]) - data[i + 1];
const isKey = (i) => data[i] > 170 && data[i + 2] > 170 && data[i + 1] < 110 && Math.abs(data[i] - data[i + 2]) < 70;

// 1. Background = every key pixel connected to the border, plus any trapped
//    pocket of pure key colour (gaps between baskets and the roof).
const background = new Uint8Array(w * h);
const queue = [];
for (let x = 0; x < w; x++) { queue.push(x, (h - 1) * w + x); }
for (let y = 0; y < h; y++) { queue.push(y * w, y * w + w - 1); }
while (queue.length) {
    const p = queue.pop();
    if (background[p] || !isKey(p * 4)) continue;
    background[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) queue.push(p - 1); if (x < w - 1) queue.push(p + 1);
    if (y > 0) queue.push(p - w); if (y < h - 1) queue.push(p + w);
}
// Trapped pockets (between the rail and the roof, between baskets): a connected
// patch of key-like pixels whose mean is near-pure magenta. Lavender petals are
// key-like too, but their mean green stays well above the background's.
const seen = new Uint8Array(w * h);
for (let start = 0; start < w * h; start++) {
    if (background[start] || seen[start] || !isKey(start * 4)) continue;
    const patch = [start]; seen[start] = 1;
    let green = 0;
    for (let n = 0; n < patch.length; n++) {
        const p = patch[n], x = p % w, y = (p / w) | 0;
        green += data[p * 4 + 1];
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
            if (q >= 0 && !seen[q] && !background[q] && isKey(q * 4)) { seen[q] = 1; patch.push(q); }
        }
    }
    if (green / patch.length < 45) for (const p of patch) background[p] = 1;
}

// 2. Soft edge: pixels within two of the background get alpha from how much
//    key colour they carry, and lose the magenta spill.
const nearBackground = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && background[ny * w + nx]) return true;
    }
    return false;
};
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4;
    if (background[p]) { data[i + 3] = 0; continue; }
    if (!nearBackground(x, y)) continue;
    const k = keyness(i);
    data[i + 3] = k >= 110 ? 0 : k <= 30 ? 255 : Math.round(255 * (110 - k) / 80);
    const spill = Math.max(0, Math.min(data[i], data[i + 2]) - data[i + 1] - 10);
    data[i] -= spill; data[i + 2] -= spill;
}

// 2b. Blended key pixels on the silhouette (strong red and blue over green, but
//     below the key test's blue floor) are cleared, pass after pass, until a
//     whole seam (such as the gap between the rail and the roof) is gone.
for (let pass = 0, cleared = 1; pass < 12 && cleared; pass++) {
    const clear = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = px(x, y);
        if (data[i + 3] === 0) continue;
        if (![i - 4, i + 4, i - w * 4, i + w * 4].some(j => data[j + 3] === 0)) continue;
        if (data[i] - data[i + 1] > 35 && data[i + 2] - data[i + 1] > 25) clear.push(i);
    }
    for (const i of clear) data[i + 3] = 0;
    cleared = clear.length;
}

// 3. Crop to the opaque object and centre it on a square canvas with a 2% margin.
let minX = w, minY = h, maxX = -1, maxY = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[px(x, y) + 3] > 8) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
}
const cropW = maxX - minX + 1, cropH = maxY - minY + 1;
const side = Math.round(Math.max(cropW, cropH) * 1.04);
const object = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: cropW, height: cropH }).png().toBuffer();
await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: object, left: Math.round((side - cropW) / 2), top: Math.round((side - cropH) / 2) }])
    .png().toFile(`${dir}/shelter-map-cutout.png`);
console.log({ crop: [minX, minY, cropW, cropH], side });
