// Export a reproducible review copy. Pass the client public folder to publish the identical files.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const paintings = require('./paintings.json');
const destination = path.resolve(process.argv[2] || path.join(__dirname, '../../../output/coast/coast-states-v1'));
async function cutout(master, size) {
    const {data, info} = await sharp(master).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    let left = info.width, top = info.height, right = -1, bottom = -1;
    for (let i = 0; i < data.length; i += 4) {
        const red = data[i], green = data[i + 1], blue = data[i + 2];
        const spill = Math.min(red, blue) - green;
        const alpha = Math.min(1, Math.max(0, (125 - spill) / 110));
        if (alpha < 1) {
            data[i + 3] = Math.round(data[i + 3] * alpha);
            if (alpha > 0) {
                data[i] = Math.max(0, (red - 255 * (1 - alpha)) / alpha);
                data[i + 2] = Math.max(0, (blue - 255 * (1 - alpha)) / alpha);
            }
        }
        if (data[i + 3] < 10) continue;
        const x = (i / 4) % info.width, y = Math.floor(i / 4 / info.width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) throw Error('Empty painting: ' + master);
    const inset = Math.ceil(size * .025);
    return sharp(data, {raw: {width: info.width, height: info.height, channels: 4}})
        .extract({left, top, width: right - left + 1, height: bottom - top + 1})
        .resize(size - inset * 2, size - inset * 2, {fit: 'contain', background: '#00000000'})
        .extend({top: inset, bottom: inset, left: inset, right: inset, background: '#00000000'});
}
async function main() {
    for (const {id, kind, file} of paintings) {
        const master = path.join(__dirname, 'masters', id + '.png');
        const output = path.join(destination, file);
        await fs.mkdir(path.dirname(output), {recursive: true});
        const plate = kind === 'scene' ? sharp(master).resize(800, 450, {fit: 'cover'}) : await cutout(master, kind === 'pin' ? 256 : 512);
        const image = await plate.webp({quality: 82, alphaQuality: 95, effort: 6}).toBuffer();
        if (image.length > 128000) throw Error(id + ' exceeds the per-image budget');
        await fs.writeFile(output, image);
        console.log(id, image.length);
    }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
