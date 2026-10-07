import fs from 'node:fs/promises';
import sharp from 'sharp';
const tasks = JSON.parse(await fs.readFile('output/connected-world/tasks.json'));
for (let start = 0; start < tasks.length; start += 12) {
    const group = tasks.slice(start, start + 12), layers = [];
    for (let i = 0; i < group.length; i++) {
        const t = group[i], left = i % 3 * 320, top = Math.floor(i / 3) * 340;
        layers.push({ input: await sharp(t.guide).resize(320, 320).toBuffer(), left, top });
        layers.push({ input: Buffer.from(`<svg width="320" height="20"><text x="5" y="15" font-size="13" fill="white">${t.id}: ${t.name}</text></svg>`), left, top: top + 320 });
    }
    await sharp({ create: { width: 960, height: 1360, channels: 4, background: '#172126' } }).composite(layers).png().toFile(`output/connected-world/guides-${start / 12}.png`);
}
console.log('Created six guide review sheets.');
