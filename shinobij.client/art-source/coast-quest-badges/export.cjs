// Run from the worktree with its installed dependencies.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const badges = require('./prompts.json');

async function main() {
    const dest = path.resolve(process.argv[2] ?? path.join(__dirname, '../../public/badges'));
    await fs.mkdir(dest, {recursive: true});
    let total = 0;
    for (const badge of badges) {
        const master = path.join(__dirname, 'masters', badge.id + '.png');
        const image = sharp(master).resize(256, 256, {fit: 'cover'}).removeAlpha().toColourspace('srgb');
        let bytes;
        for (const quality of [90, 87, 84, 81, 78]) {
            bytes = await image.clone().webp({quality, effort: 6, smartSubsample: true}).toBuffer();
            if (bytes.length <= 36_250) break;
        }
        if (bytes.length > 36_250) throw new Error(badge.id + ' exceeds 36,250 bytes');
        await fs.writeFile(path.join(dest, badge.id + '.webp'), bytes);
        console.log(badge.id, bytes.length);
        total += bytes.length;
    }
    if (total >= 290_000) throw new Error('The eight badges exceed the approved total');
    console.log('Total', total);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
