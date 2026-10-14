import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
const root = 'test-results/presentation-review';
const prefix = process.argv[2] ?? 'phone';
const files = (await readdir(root)).filter(file => file.startsWith(`${prefix}-`) && file.endsWith('.png')).sort();
for (let offset = 0; offset < files.length; offset += 12) {
  const group = files.slice(offset, offset + 12);
  const width = prefix === 'phone' ? 240 : 400;
  const height = prefix === 'phone' ? 460 : 300;
  const overlays = [];
  for (let i = 0; i < group.length; i++) {
    const file = group[i];
    const left = (i % 4) * width;
    const top = Math.floor(i / 4) * height;
    const data = await sharp(`${root}/${file}`).resize({ width, height: height - 28, fit: 'contain', background: '#0a0c10' }).png().toBuffer();
    overlays.push({ input: data, left, top: top + 28 });
    overlays.push({ input: Buffer.from(`<svg width="${width}" height="28"><text x="8" y="20" font-family="Arial" font-size="14" fill="white">${file.replace(`${prefix}-`, '').replace('.png', '')}</text></svg>`), left, top });
  }
  await sharp({ create: { width: width * 4, height: height * Math.ceil(group.length / 4), channels: 3, background: '#0a0c10' } }).composite(overlays).png().toFile(`${root}/sheet-${prefix}-${offset / 12}.png`);
}
