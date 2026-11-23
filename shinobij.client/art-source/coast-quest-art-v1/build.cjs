// Produce the item icons and screen-blended effect plates from the approved PNG masters.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const defaultOutput = path.resolve(__dirname, '../../../output/coast/quest-art');
const output = path.resolve(process.argv[2] || defaultOutput);
const sourceManifest = path.join(__dirname, 'assets.json');
const outputManifest = path.join(output, 'assets.json');
// A custom output folder can supply its own manifest for a review export.
const manifest = output !== defaultOutput && fs.existsSync(outputManifest) ? outputManifest : sourceManifest;
const catalogue = JSON.parse(fs.readFileSync(manifest, 'utf8'));
const masters = path.join(__dirname, 'masters');

function bounds(data, width, height, threshold) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('Empty alpha channel');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function item(id, filename, quality = 90) {
  const src = path.join(masters, id + '.png');
  const meta = await sharp(src).metadata();
  if (!meta.hasAlpha) throw new Error(id + ' lacks source transparency');
  const { data, info } = await sharp(src).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    // Suppress faint matte residue and retain antialiasing on thin cords and glass.
    data[i] = Math.max(0, Math.min(255, Math.round((data[i] - 16) * 255 / 231)));
  }
  const box = bounds(data, info.width, info.height, 8);
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const trimmed = await sharp(data, { raw: info }).extract(box).png().toBuffer();
  await sharp(trimmed).resize(288, 288, { fit: 'contain', background: clear })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: clear })
    .webp({ quality, alphaQuality: 100, effort: 5 }).toFile(path.join(output, filename));
}

async function effect(filename) {
  const id = path.basename(filename, '-v1.webp');
  const { data, info } = await sharp(path.join(masters, id + '.png')).flatten({ background: '#000' })
    .toColourspace('srgb').resize(384, 384, { fit: 'contain', background: '#000' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let s = 0, d = 0; s < data.length; s += 3, d += 4) {
    const peak = Math.max(data[s], data[s + 1], data[s + 2]);
    if (peak <= 10) continue;
    // Make the black field transparent. Unpremultiply to retain the painted
    // luminance on black when the renderer applies the new alpha channel.
    const alpha = Math.min(255, Math.ceil(Math.sqrt((peak - 10) / 245) * 255));
    for (let k = 0; k < 3; k++) out[d + k] = Math.min(255, Math.round(data[s + k] * 255 / alpha));
    out[d + 3] = alpha;
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 100, effort: 5 }).toFile(path.join(output, filename));
}

async function main() {
  fs.mkdirSync(path.join(output, 'items'), { recursive: true });
  fs.mkdirSync(path.join(output, 'combat-vfx'), { recursive: true });
  const selected = new Set(process.argv.slice(3));
  for (const entry of catalogue.items) if (!selected.size || selected.has(entry.id)) await item(entry.id, entry.file, entry.quality);
  for (const pair of catalogue.holds) {
    for (const filename of [pair.hold, pair.break]) {
      const id = path.basename(filename, '-v1.webp');
      if (!selected.size || selected.has(id)) await effect(filename);
    }
  }
  if (output === defaultOutput) fs.copyFileSync(sourceManifest, outputManifest);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

