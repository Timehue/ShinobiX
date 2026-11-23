// Run with the Sharp dependency from shinobij.client.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const masters = path.join(__dirname, 'paintings');
const destination = process.argv[2] && path.resolve(process.argv[2]);
if (!destination || fs.existsSync(destination)) {
  throw new Error('Supply a new output directory to hold the two candidate folders.');
}
const region = path.join(destination, 'hushcrown-heights');
const ownership = path.join(destination, 'ownership');
const transparent = '#00000000';
for (const directory of [ownership, ...['landmarks', 'scenes', 'interiors'].map(name => path.join(region, name))]) {
  fs.mkdirSync(directory, {recursive: true});
}

async function encode(input, file, ceiling) {
  let best;
  let low = 25;
  let high = 93;
  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    const candidate = await sharp(input).webp({quality, effort: 4, smartSubsample: true}).toBuffer();
    if (candidate.length <= ceiling) {
      best = candidate;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }
  if (!best) throw new Error('No encoding fits ' + file);
  fs.writeFileSync(file, best);
}

async function cropPanel(file, columns, index, inset = 0) {
  const source = sharp(file);
  const meta = await source.metadata();
  const width = Math.floor(meta.width / columns);
  const height = Math.floor(meta.height / 2);
  return source.extract({
    left: (index % columns) * width + inset,
    top: Math.floor(index / columns) * height + inset,
    width: width - 2 * inset,
    height: height - 2 * inset
  }).png().toBuffer();
}

async function keyAndFit(input, blackPoint, span, trimThreshold, width, height, padding) {
  const {data, info} = await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, Math.round((data[i] - blackPoint) * 255 / span)));
  }
  const keyed = await sharp(data, {raw: info}).png().toBuffer();
  const trimmed = await sharp(keyed).trim({background: transparent, threshold: trimThreshold}).png().toBuffer();
  return sharp(trimmed)
    .resize(width, height, {fit: 'contain', background: transparent})
    .extend({left: padding, right: padding, top: padding, bottom: padding, background: transparent})
    .png().toBuffer();
}

async function main() {
  for (let i = 0; i < 10; i++) {
    const id = 141 + i;
    await encode(path.join(masters, 'floors', id + '.png'), path.join(region, 's' + id + '-candidate.webp'), 250000);

    // Each three-by-two landmark sheet contains five cutouts and one unused cell.
    const sheet = Math.floor(i / 5);
    const cell = await cropPanel(path.join(masters, 'landmarks', 'sheet' + sheet + '.png'), 3, i % 5);
    // The second sheet has a stronger translucent matte around its silhouettes.
    const [blackPoint, span] = sheet === 0 ? [55, 184] : [218, 27];
    const sprite = await keyAndFit(cell, blackPoint, span, 15, 490, 490, 11);
    await encode(sprite, path.join(region, 'landmarks', 's' + id + '-site-v1.webp'), 128000);

    const panel = Math.floor(i / 4);
    const entry = await cropPanel(path.join(masters, 'scenes', 'panel' + panel + '.png'), panel === 2 ? 1 : 2, i % 4, 2);
    const scene = await sharp(entry).resize(800, 450, {fit: 'cover'}).png().toBuffer();
    await encode(scene, path.join(region, 'scenes', 's' + id + '-entry-v1.webp'), 128000);
  }
  for (const room of ['bench', 'loft', 'watch1', 'watch2', 'court', 'gallery', 'hall']) {
    const image = await sharp(path.join(masters, 'rooms', room + '.png')).resize(1024, 1024).png().toBuffer();
    await encode(image, path.join(region, 'interiors', room + '-v1.webp'), 250000);
  }
  for (const kind of ['unmoored', 'clan-neutral']) {
    const banner = await keyAndFit(path.join(masters, 'banners', kind + '.png'), 20, 224, 12, 315, 486, 13);
    await encode(banner, path.join(ownership, 'owned-sector-' + kind + '-v1.webp'), 128000);
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
