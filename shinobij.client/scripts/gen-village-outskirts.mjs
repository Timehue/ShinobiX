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

// Floor style comes from the SHARED keyart module so this board can never
// drift from the numbered-sector fleet again (it previously held a verbatim
// copy of the retired world-map-illustration style).
import { buildFloorPrompt } from './keyart-floor-style.mjs';

// slug → { region, name, floor } — `floor` is the per-village points-of-interest
// sentence appended to its region's floorBase (same shape as SECTOR_ART[n].floor).
const VILLAGES = {
    'stormveil-outskirts': {
        region: 'stormveil',
        name: 'Stormveil — Outer Territory',
        floor: 'Points of interest along the boardwalks: a weathered harbor gate — a tall rope-bound timber arch hung with rows of faded signal pennants — spanning the main pier where the boardwalk meets open water, a lantern-lit harbor-watch kiosk with an azure cobalt-blue tiled roof beside it, stacked fishing crates and lashed barrels, coiled mooring ropes and hung drying nets, a small moored sampan at a pier post, and open turquoise sea filling one whole edge of the map.',
    },
    // NO ashenleaf-outskirts entry on purpose. Four attempts (guidance 3.8-4.6,
    // torii named as the dominant feature, terrain pinned to 'dense emerald forest
    // canopy to every edge', ARCHITECTURE_LINE verified present in the prompt) all
    // returned a European abbey on a coastal headland. Ashen Leaf falls through to
    // its virtual sector instead (13, Headland Woods) — in-region since the
    // renumbering, and already art-QA'd. Re-add only with a different technique
    // (e.g. Kontext restyle of sector 13's board), not another text-to-image roll.
    'frostfang-outskirts': {
        region: 'frostfang',
        name: 'Frostfang — Outer Territory',
        floor: 'Points of interest along the snow trails: the village’s outer gate of blue ice and dark timber standing over the packed-snow road seen from above, a watch hut with a snow-heaped tiled roof beside it, a double row of stone lanterns half buried in drifts, a stacked woodpile under a plank lean-to, a frozen trough of glassy blue ice, and clusters of snow-laden pines.',
    },
    'moonshadow-outskirts': {
        region: 'moonshadow',
        name: 'Moonshadow — Outer Territory',
        floor: 'Points of interest along the pale stone paths: the village’s outer gate of dark timber with a sweeping tiled roof standing over the road seen from above, a shrouded watch hut beside it, a double row of stone lanterns with faint violet flames, glowing purple crystal clusters in the rocks, a still reflective pool in a stone basin, and drifts of luminous violet petals under amethyst canopies.',
    },
    // Death's Gate (sector 99). It is map-travel-only and was the LAST board still
    // falling through to the shared legacy biome art, which is why those ten files
    // could not be deleted until this existed.
    's99': {
        region: 'volcano',
        name: 'Death’s Gate',
        floor: 'Unbroken volcanic ground covers the whole map right to every edge — black obsidian rock, grey ash drifts and sheets of cooled dark lava, with glowing molten-orange lava channels running through it and cracked dark-lava paths winding between them. At the centre is a wide circular duelling ground of cracked black obsidian, ringed by tall bare dark stone pillars. Also on the ash: a low cooled-lava arch, a sulphur vent field with pale yellow crusts, blackened bones half sunk in the grit, and slabs of cracked cooling crust glowing warm in their seams. This is the heart of a volcanic waste in every direction.',
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
    // Region floorBase + the per-board points-of-interest sentence, wrapped in
    // the shared keyart style (which carries every prompt law).
    return buildFloorPrompt(v.region, `${REGIONS[v.region].floorBase} ${v.floor}`);
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
