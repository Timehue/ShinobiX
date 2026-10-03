import sharp from 'sharp';
import { resolve } from 'node:path';

/** Review the baked run with a stationary ground mark and no runtime bob. */
export async function writeRallySpriteMotionPreview(rows, output, path, cell, anchorY) {
    const selected = rows.slice(0, 4), width = cell * 2, height = (cell + 28) * Math.ceil(selected.length / 2);
    const pages = [];
    for (let phase = 0; phase < 4; phase++) {
        const layers = [];
        for (const [index, row] of selected.entries()) {
            const left = index % 2 * cell, top = Math.floor(index / 2) * (cell + 28);
            const ground = 28 + cell * anchorY;
            const backdrop = `<svg width="${cell}" height="${cell + 28}"><rect width="100%" height="100%" fill="#ad875c"/><text x="8" y="20" fill="#fff5db" font-size="14" font-family="Arial">${row.id} · ${phase + 1}/4</text><ellipse cx="${cell / 2}" cy="${ground + 1}" rx="35" ry="6" fill="#3d291e" fill-opacity=".35"/><path d="M20 ${ground} H${cell - 20}" stroke="#fff1bf" stroke-opacity=".45"/></svg>`;
            layers.push({ input: Buffer.from(backdrop), left, top });
            layers.push({ input: await sharp(resolve(output, `${row.id}.webp`)).extract({ left: phase * cell, top: 0, width: cell, height: cell }).png().toBuffer(), left, top: top + 28 });
        }
        pages.push(await sharp({ create: { width, height, channels: 3, background: '#ad875c' } }).composite(layers).removeAlpha().raw().toBuffer());
    }
    await sharp(Buffer.concat(pages), { raw: { width, height: height * 4, channels: 3, pageHeight: height } })
        .gif({ loop: 0, delay: [150, 150, 150, 150] }).toFile(path);
}
