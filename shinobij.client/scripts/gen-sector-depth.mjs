// Sector depth-map generator (fal.ai Depth-Anything V2).
//
//   biome scene painting ──▶ fal-ai/image-preprocessors/depth-anything/v2 ──▶ grayscale depth
//
// The r3f sector backdrop (SectorScene3DScene) displaces the painted biome by a
// depth map so the scene reads as a real space you parallax through. Without a
// baked map it uses a procedural gradient; this bakes a proper PER-SCENE depth
// for each theme so foreground / mountains / valleys parallax at correct depths.
//
//   node scripts/gen-sector-depth.mjs                  # all 8 themes
//   node scripts/gen-sector-depth.mjs --only ice,dark  # a subset
//   node scripts/gen-sector-depth.mjs --invert         # if depth reads inside-out
//   node scripts/gen-sector-depth.mjs --width 512      # depth resolution (default 384)
//
// FAL_KEY is read from env or shinobij.client/.env (same place the other gen
// scripts read it). Writes public/sector-depth/<theme>.webp and rewrites
// src/data/sector-depth-manifest.ts. Then rebuild the client (so the webps land
// in dist/) and commit public/sector-depth + the manifest (+ dist for cPanel).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);

function envKey(name) {
    if (process.env[name]) return process.env[name].trim();
    const p = path.join(CLIENT, '.env');
    if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = l.match(new RegExp('^' + name + '\\s*=\\s*(.+)$'));
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    return '';
}

// theme → source painting. MUST match sectorImageTheme()/SECTOR_IMAGE_GROUPS in
// screens/WorldMap.tsx so the depth lines up with the image actually shown.
const SOURCES = {
    ice: 'src/assets/sectors/ice.webp',
    dark: 'src/assets/sectors/dark.webp',
    temple: 'src/assets/sectors/temple.webp',
    water: 'src/assets/sectors/water.webp',
    forrest: 'src/assets/sectors/forrest.webp',
    meadow2: 'src/assets/sectors/meadow2.webp',
    meadow: 'src/assets/sectors/meadow.webp',
    stormveil: 'src/assets/sectors/stormveil-village.webp',
};

const OUT_DIR = path.join(CLIENT, 'public', 'sector-depth');
const MANIFEST = path.join(CLIENT, 'src', 'data', 'sector-depth-manifest.ts');
const WIDTH = parseInt(arg('width', '384'), 10);
const invert = flag('invert');
const only = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);

async function depthBytes(key, srcAbs) {
    const falKey = envKey('FAL_KEY');
    if (!falKey) { console.error('no FAL_KEY (set it in env or shinobij.client/.env)'); process.exit(1); }
    const bytes = fs.readFileSync(srcAbs);
    const dataUri = `data:image/webp;base64,${bytes.toString('base64')}`;
    const res = await fetch('https://fal.run/fal-ai/image-preprocessors/depth-anything/v2', {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: dataUri }),
    });
    if (!res.ok) { console.error(`fal error ${res.status} for ${key}:`, (await res.text()).slice(0, 400)); process.exit(1); }
    const json = await res.json();
    const url = json?.image?.url || json?.images?.[0]?.url;
    if (!url) { console.error(`no depth image for ${key}:`, JSON.stringify(json).slice(0, 400)); process.exit(1); }
    if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    return Buffer.from(await (await fetch(url)).arrayBuffer());
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const sharp = (await import('sharp')).default;
    const themes = Object.keys(SOURCES).filter((k) => only.length === 0 || only.includes(k));
    for (const key of themes) {
        const srcAbs = path.resolve(CLIENT, SOURCES[key]);
        if (!fs.existsSync(srcAbs)) { console.warn(`skip ${key}: source missing (${SOURCES[key]})`); continue; }
        console.log(`depth: ${key}  ← ${SOURCES[key]}`);
        const raw = await depthBytes(key, srcAbs);
        // Grayscale, modest resolution (depth is low-frequency), light blur to keep
        // the displaced mesh smooth. Depth-Anything outputs near=bright, which is
        // our convention (bright = pushed toward the camera); --invert flips it.
        let pipe = sharp(raw).grayscale().resize(WIDTH, null, { withoutEnlargement: true }).blur(1.4);
        if (invert) pipe = pipe.negate();
        const outFile = path.join(OUT_DIR, `${key}.webp`);
        await pipe.webp({ quality: 82 }).toFile(outFile);
        console.log(`  → public/sector-depth/${key}.webp (${(fs.statSync(outFile).size / 1024).toFixed(1)}KB)`);
    }
    // Rewrite the manifest from whatever depth files now exist (resumable + safe).
    const present = Object.keys(SOURCES).filter((k) => fs.existsSync(path.join(OUT_DIR, `${k}.webp`)));
    const body =
        '// AUTO-GENERATED by scripts/gen-sector-depth.mjs — do not edit by hand.\n' +
        '//\n' +
        '// The scene-image themes (see SECTOR_IMAGE_GROUPS in screens/WorldMap.tsx) that\n' +
        '// have a baked AI depth map at public/sector-depth/<theme>.webp.\n' +
        'export const SECTOR_DEPTH_THEMES: ReadonlySet<string> = new Set<string>([\n' +
        present.map((k) => `    ${JSON.stringify(k)},`).join('\n') +
        (present.length ? '\n' : '') +
        ']);\n';
    fs.writeFileSync(MANIFEST, body);
    console.log(`manifest: ${present.length} theme(s) → ${path.relative(CLIENT, MANIFEST)}`);
    console.log('next: npm run build, then commit public/sector-depth + the manifest (+ dist for cPanel).');
}
main().catch((e) => { console.error(e); process.exit(1); });
