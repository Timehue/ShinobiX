// Pre-sized delivery copies of every GameArtIcon glyph.
//
// GameArtIcon renders about 400 places in the menus, and nearly all of them are
// 14-34 CSS px. Its sources are full illustrations: 256 px emblems, 1024 px
// profession art, a 512 px combat VFX sheet. A hub row of 18 px icons therefore
// downloaded about 1.3 MB of artwork, and the public landing page spent ~140 KB
// on three 18 px glyphs. This writes one small copy per kind into
// public/ui/icon-96/<kind>.webp. GameArtIcon serves it whenever the icon is
// drawn at 48 CSS px or less, which still covers 2x screens at 48 px and 3x
// screens at 32 px.
//
// Run from shinobij.client/ after adding or changing a GameArtIcon kind:
//   node scripts/gen-game-art-icon-variants.mjs
// scripts/gen-game-art-icon-variants.test.mjs fails when a kind has no copy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_ROOT = path.resolve(HERE, '..');
export const ICON_COMPONENT = path.join(CLIENT_ROOT, 'src', 'components', 'GameArtIcon.tsx');
export const VARIANT_DIR = path.join(CLIENT_ROOT, 'public', 'ui', 'icon-96');
export const VARIANT_PX = 96;

/**
 * Reads the kind -> source table straight out of GameArtIcon.tsx, so the
 * component stays the one place a glyph is chosen. Returns absolute paths.
 */
export function readGameArtIconSources(source = fs.readFileSync(ICON_COMPONENT, 'utf8')) {
    const imports = new Map();
    for (const match of source.matchAll(/^import\s+(\w+)\s+from\s+"(\.\.\/assets\/[^"]+)";$/gm)) {
        imports.set(match[1], path.resolve(path.dirname(ICON_COMPONENT), match[2]));
    }
    const table = /const ART: Record<GameArtIconKind, string> = \{([\s\S]*?)\n\};/.exec(source);
    if (!table) throw new Error('GameArtIcon.tsx: ART table not found');
    const sources = new Map();
    for (const raw of table[1].split(/,\s*/)) {
        const entry = raw.replace(/\/\/.*$/gm, '').trim();
        if (!entry) continue;
        const pair = /^(\w+)\s*:\s*(?:"([^"]+)"|(\w+))$/.exec(entry);
        const key = pair ? pair[1] : entry;
        const publicPath = pair?.[2];
        const importName = pair ? pair[3] : entry;
        if (!/^\w+$/.test(key)) throw new Error(`GameArtIcon.tsx: cannot read ART entry "${entry}"`);
        if (publicPath) {
            sources.set(key, path.join(CLIENT_ROOT, 'public', ...publicPath.replace(/^\//, '').split('/')));
        } else if (imports.has(importName)) {
            sources.set(key, imports.get(importName));
        } else {
            throw new Error(`GameArtIcon.tsx: ART.${key} names unknown import ${importName}`);
        }
    }
    return sources;
}

export function variantPathFor(kind) {
    return path.join(VARIANT_DIR, `${kind}.webp`);
}

async function main() {
    const { default: sharp } = await import('sharp');
    const sources = readGameArtIconSources();
    fs.mkdirSync(VARIANT_DIR, { recursive: true });
    let before = 0;
    let after = 0;
    for (const [kind, sourcePath] of sources) {
        const output = await sharp(sourcePath)
            .resize(VARIANT_PX, VARIANT_PX, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
            .webp({ quality: 84, alphaQuality: 90, effort: 6, smartSubsample: true })
            .toBuffer();
        fs.writeFileSync(variantPathFor(kind), output);
        before += fs.statSync(sourcePath).size;
        after += output.length;
        console.log(`${kind.padEnd(18)} ${String(fs.statSync(sourcePath).size).padStart(7)} -> ${String(output.length).padStart(6)} B`);
    }
    const stale = fs.readdirSync(VARIANT_DIR).filter((file) => !sources.has(file.replace(/\.webp$/, '')));
    for (const file of stale) fs.rmSync(path.join(VARIANT_DIR, file));
    console.log(`\n${sources.size} icons: ${before} -> ${after} B${stale.length ? `; removed ${stale.length} stale` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
