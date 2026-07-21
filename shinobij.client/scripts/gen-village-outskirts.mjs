// Village "Outer Territory" floor-map generator — fal.ai (FLUX), one bespoke
// top-down adventure map per village territory page.
//
// The world map's per-village Outer Territory page (WorldMap.tsx,
// selectedVillageTerritory) needs a painted top-down board just like a numbered
// wild sector. It USED to borrow `sectorMapUrl(biome, outskirts + 4)` — but that
// virtual sector is chosen for explore/battle logic, and +4 can land in a wholly
// different biome's art (Stormveil's outskirts 31 + 4 = sector 35 = a CARNIVAL
// cactus-flat, i.e. a circus). This script paints a proper in-region board for
// each such village and saves it under a stable NAME (not s<N>.webp), which
// WorldMap.tsx references directly via villageOuterTerritoryMapUrl().
//
//   node scripts/gen-village-outskirts.mjs --all           # everything missing
//   node scripts/gen-village-outskirts.mjs --only stormveil-outskirts
//   node scripts/gen-village-outskirts.mjs --all --force    # regenerate even if present
//   node scripts/gen-village-outskirts.mjs --dry-run        # print prompts, spend nothing
//
// Resumable: existing files are skipped unless --force. FAL_KEY is read from env
// or shinobij.client/.env. After generating: npm run build + commit the new
// public/sector-map/<slug>.webp asset.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS } from './sector-art-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
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

// Top-down floor style — copied verbatim from gen-sector-art.mjs (FLOOR_PRE/POST)
// so a village territory board reads identically to a numbered-sector floor. Keep
// these two constants in sync with that script if its worldmap style ever changes.
const FLOOR_PRE = 'A complete top-down high-angle adventure map of one small location for a fantasy ninja RPG, drawn in the EXACT art style of a vivid high-fantasy game WORLD MAP — bright luminous highly-saturated colour, crisp clean polished detailed rendering, lush and glowing, a colourful jewel-like fantasy-map illustration, as if zooming into one region of a beautiful world map — viewed from a high bird’s-eye angle with a slight oblique tilt so trees, structures and terrain have visible height. ';
const FLOOR_POST = ' COMPOSITION: the whole map is densely filled and reads as ONE connected, welcoming place — winding paths link every area so the eye flows naturally across the map, terrain features and groves break up the space, and the small points of interest sit naturally along the routes. NO large empty areas and NO empty middle — every part of the map has something interesting — BUT keep the paths and clearings as clear, open, walkable lanes. Features blend and connect into one another: NO isolated single objects floating in empty space, NO evenly-spaced grid of props. ONE consistent vivid high-fantasy WORLD-MAP illustration style across the entire image — bright, luminous, highly-saturated jewel-like colour, crisp clean polished detail, lush and glowing, colourful and inviting (the biome’s own hue, but always vibrant and luminous, never murky). It must feel like a real little place, not a background. Absolutely NO characters, NO people, NO humans, NO text, NO words, NO UI, NO HUD, NO minimap, NO grid lines, NO hex tiles, NO tile outlines, NO markers, NO icons, NO arrows, NO labels, NO frame, NO border, NO vignette, NO watermark. Match a vivid colourful high-fantasy world-map illustration — bright, saturated and luminous; NOT dark, NOT muted, NOT desaturated, NOT moody, NOT gritty, NOT photoreal, NOT pixel art, NOT a flat cartoon, NOT a tile-set, NOT cel-shaded. The artwork fills the entire frame edge to edge.';

// slug → { region, name, floor } — `floor` is the per-village points-of-interest
// sentence appended to its region's floorBase (same shape as SECTOR_ART[n].floor).
const VILLAGES = {
    'stormveil-outskirts': {
        region: 'stormveil',
        name: 'Stormveil — Outer Territory',
        floor: 'Points of interest along the boardwalks: a weathered harbor gate — a tall rope-bound timber arch hung with rows of faded signal pennants — spanning the main pier where the boardwalk meets open water, a lantern-lit harbor-watch kiosk with an azure cobalt-blue tiled roof beside it, stacked fishing crates and lashed barrels, coiled mooring ropes and hung drying nets, a small moored sampan at a pier post, and open turquoise sea filling one whole edge of the map.',
    },
};

const OUT_DIR = path.join(CLIENT, 'public', 'sector-map');

const MODEL = arg('model', 'fal-ai/flux/dev');
const GUIDANCE = parseFloat(arg('guidance', '3.5'));
const force = flag('force');
const dryRun = flag('dry-run');
const only = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const slugs = Object.keys(VILLAGES).filter((s) => only.length === 0 || only.includes(s));
if (!flag('all') && only.length === 0) { console.error('nothing to do — pass --all or --only <slug>'); process.exit(1); }

const FAL_KEY = dryRun ? '' : envKey('FAL_KEY');
if (!dryRun && !FAL_KEY) { console.error('no FAL_KEY (set it in env or shinobij.client/.env)'); process.exit(1); }

async function falJson(model, body) {
    const res = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
}

async function imageBytes(json) {
    const url = json?.image?.url || json?.images?.[0]?.url;
    if (!url) throw new Error('no image in response: ' + JSON.stringify(json).slice(0, 200));
    if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    return Buffer.from(await (await fetch(url)).arrayBuffer());
}

async function flux(prompt, imageSize) {
    const json = await falJson(MODEL, { prompt, image_size: imageSize, num_images: 1, num_inference_steps: 32, guidance_scale: GUIDANCE, enable_safety_checker: false });
    return imageBytes(json);
}

// Flux occasionally hallucinates tiny corner watermarks; a 3.5% zoom-crop per edge
// removes them (mirrors gen-sector-art.mjs so this asset matches the shipped set).
const EDGE_CROP = 0.035;
async function edgeCrop(sharp, buf) {
    const meta = await sharp(buf).metadata();
    const left = Math.round(meta.width * EDGE_CROP);
    const top = Math.round(meta.height * EDGE_CROP);
    return sharp(buf).extract({ left, top, width: meta.width - left * 2, height: meta.height - top * 2 }).toBuffer();
}

function promptFor(slug) {
    const v = VILLAGES[slug];
    const base = REGIONS[v.region].floorBase;
    // Positive-only stillness — naming "person/people" even in negation makes flux
    // paint MORE of them (gen-sector-art.mjs QA note).
    return FLOOR_PRE + base + ' ' + v.floor + ' The whole place is silent, still and empty.' + FLOOR_POST;
}

async function main() {
    const sharp = dryRun ? null : (await import('sharp')).default;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    let made = 0, failed = 0;
    for (const slug of slugs) {
        const out = path.join(OUT_DIR, `${slug}.webp`);
        if (!force && fs.existsSync(out)) { console.log(`skip   ${slug} (exists)`); continue; }
        const prompt = promptFor(slug);
        if (dryRun) { console.log(`\n[${slug} — ${VILLAGES[slug].name}]\n${prompt}`); continue; }
        try {
            const buf = await edgeCrop(sharp, await flux(prompt, 'square_hd'));
            const webp = await sharp(buf).resize(1024, 1024, { fit: 'cover' }).webp({ quality: 84 }).toBuffer();
            fs.writeFileSync(out, webp);
            made++;
            console.log(`floor  ${slug} (${VILLAGES[slug].name}) — ${(webp.length / 1024).toFixed(0)}KB`);
        } catch (e) { failed++; console.error(`  FAIL ${slug}: ${e.message ?? e}`); }
    }
    if (dryRun) return;
    console.log(`\ndone: ${made} made, ${failed} failed. next: npm run build, then commit public/sector-map/<slug>.webp.`);
    if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
