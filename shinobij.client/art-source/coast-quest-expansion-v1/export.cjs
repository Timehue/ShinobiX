const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const rows = require('./recipe.json');
const out = process.argv[2] && path.resolve(process.argv[2]);
if (!out || fs.existsSync(out)) throw new Error('Supply a new output directory for the candidate WebPs.');

async function encode(input, ceiling) {
  let best;
  let low = 1;
  let high = 92;
  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    const candidate = await sharp(input).webp({ quality, effort: 5, alphaQuality: 95, smartSubsample: true }).toBuffer();
    if (candidate.length <= ceiling) {
      best = candidate;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }
  if (!best) throw new Error('No WebP fits ' + ceiling + ' bytes');
  return best;
}

async function cutout(source, width, height) {
  const {data, info} = await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, Math.round((data[i] - 28) * 255 / 215)));
  }
  const transparent = '#00000000';
  const keyed = await sharp(data, {raw: info}).png().toBuffer();
  const trimmed = await sharp(keyed).trim({background: transparent, threshold: 13}).png().toBuffer();
  const pad = Math.round(width * 0.035);
  return sharp(trimmed).resize(width - 2 * pad, height - 2 * pad, {fit: 'contain', background: transparent})
    .extend({top: pad, bottom: pad, left: pad, right: pad, background: transparent}).png().toBuffer();
}

async function pixels(row) {
  const source = path.join(__dirname, 'paintings', row.key + '.png');
  if (row.alpha) return cutout(source, row.width, row.height);
  let picture = sharp(source);
  if (row.cell !== undefined) {
    const meta = await picture.metadata();
    const w = Math.floor(meta.width / 2);
    const h = Math.floor(meta.height / 2);
    picture = picture.extract({left: (row.cell % 2) * w + 3, top: Math.floor(row.cell / 2) * h + 3, width: w - 6, height: h - 6});
  }
  return picture.resize(row.width, row.height, {fit: 'cover'}).removeAlpha().png().toBuffer();
}

async function exportAll() {
  for (const row of rows) {
    const dest = path.join(out, row.filename);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.writeFileSync(dest, await encode(await pixels(row), row.maxBytes));
  }
  console.log(rows.length + ' candidates exported');
}
exportAll().catch(error => {console.error(error); process.exitCode = 1;});
