/*
 * Fleet restyle v2 — floors in the WORLD-MAP KEYART style.
 *
 * Why this exists: the board-style pass (restyle-floors-board.mjs) matched the
 * sculpted-3D reference board, but the owner's actual target is the world-map
 * keyart (src/assets/Maps/world_map.webp) — a painterly illustration with fine
 * dense brushwork, a naturalistic weathered palette (sage/olive greens, dusty
 * tan earth, slate stone, deep teal water), atmospheric haze and diffuse
 * dramatic light. The sculpted pass reads bright, smooth and toy-like against
 * it. This script carries the keyart style block instead.
 *
 * Composition rules are unchanged from the board pass (they are what make a
 * floor playable): strict top-down, NO sky, terrain edge to edge, a main path
 * crossing the board, walkable lanes, no people/text/UI.
 *
 * Content still comes from the July prompt sheet (sector-art-data.mjs) so every
 * sector keeps its canon identity and points of interest.
 *
 * Usage:
 *   node scripts/restyle-floors-keyart.mjs --only 42,49,27,18      # pilot
 *   node scripts/restyle-floors-keyart.mjs --all                  # fleet
 *   node scripts/restyle-floors-keyart.mjs --only 18 --force
 * Progress in scripts/.restyle-keyart-done.json (gitignored); --all resumable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTOR_ART, floorPromptFor } from './sector-art-data.mjs';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_DIR = path.join(CLIENT, 'public', 'sector-map');
const DONE_FILE = path.join(CLIENT, 'scripts', '.restyle-keyart-done.json');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);
const dryRun = flag('dry-run');
const force = flag('force');
const GUIDANCE = parseFloat(arg('guidance', '3.8'));
const CONCURRENCY = Math.max(1, parseInt(arg('concurrency', '3'), 10) || 3);
const OUT_DIR = arg('out', FLOORS_DIR);
const only = (arg('only') || '').split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);

function envKey(name) {
    if (process.env[name]) return process.env[name];
    try {
        const env = fs.readFileSync(path.join(CLIENT, '.env'), 'utf8');
        const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
        return m ? m[1].trim() : '';
    } catch { return ''; }
}
const FAL_KEY = dryRun ? '' : envKey('FAL_KEY');
if (!dryRun && !FAL_KEY) { console.error('no FAL_KEY (set it in env or shinobij.client/.env)'); process.exit(1); }

// ── KEYART style block ──────────────────────────────────────────────────────
// Derived from world_map.webp. Painterly + dense + atmospheric + naturalistic.
// The "NOT" list is doing real work: it names the sculpted-3D failure mode the
// previous pass fell into.
const KEYART_PRE = 'A richly detailed painterly fantasy map illustration of one small location, drawn in the exact style of an epic AAA fantasy world map: fine intricate brushwork, dense hand-painted detail across every part of the terrain, a naturalistic weathered colour palette of sage and olive greens, dusty tan earth, slate grey stone and deep teal water, soft atmospheric haze giving quiet depth, diffuse dramatic daylight with long gentle shadows, and an oil-painted texture over the whole image. CAMERA: seen from DIRECTLY OVERHEAD with the camera pointing straight down at the ground — a true overhead plan view, like a satellite or drone photograph taken straight down. Only the TOPS of things are visible: tree canopies from above, roofs from above, the upper faces of rocks and walls. Vertical surfaces are almost entirely hidden — building fronts, walls and stairs are NOT seen face-on, and every structure is read by its ROOF. The ground plane stays flat and level across the whole picture, and the terrain fills the entire frame from edge to edge and continues past all four edges, exactly like an aerial photograph of a larger landscape — no part of the image is empty background. ';

const KEYART_POST = ' COMPOSITION: the whole map is densely filled and reads as ONE connected, believable place — winding paths link every area so the eye flows naturally across it, terrain features break up the space, and the points of interest sit naturally along the routes. NO large empty areas and NO empty middle — every part of the map carries painted detail, texture and small features — BUT keep the paths and clearings as clear, open, walkable lanes. Features blend and connect into one another: NO isolated objects floating in empty space, NO evenly-spaced grid of props. ONE consistent painterly illustrated style across the entire image, matching an epic fantasy world map: intricate, atmospheric, naturalistic colour, weathered and lived-in, with rich fine detail everywhere. CAMERA DISCIPLINE: absolutely NO sky, NO clouds, NO horizon line, NO distant background scenery, NO mountains rising against a sky, NO side view, NO elevation view, NO eye-level or three-quarter perspective, NO camera tilted up toward a horizon, NO building facades or staircases seen face-on, NO vanishing-point perspective — the view looks straight DOWN and shows ground only. Absolutely NO characters, NO people, NO humans, NO text, NO words, NO UI, NO HUD, NO minimap, NO grid lines, NO hex tiles, NO tile outlines, NO markers, NO icons, NO arrows, NO labels, NO frame, NO border, NO vignette, NO watermark. This is a PAINTING, not a render: NOT a 3D render, NOT smooth plastic or clay shading, NOT a toy diorama, NOT simple rounded low-detail shapes, NOT bright candy colour, NOT cel-shaded, NOT outlined cartoon linework, NOT flat vector art, NOT pixel art, NOT photoreal. The artwork fills the entire frame edge to edge.';

// Dark-ground regions additionally get the warmth guard (law #10/#12): without
// it a dark palette drifts to near-black and loses readable ground.
const DARK_REGIONS = new Set(['volcano', 'darktemple']);
const DARK_LINE = ' The glowing light sources in the scene cast warm light across the ground so the whole terrain stays lit and readable in rich painted detail, never flat black.';

// LAW #13 (learned on the keyart pilot): naming a big vertical landmark — a
// temple, tower, gate, peak — makes the model drop the camera to eye level to
// show it off, sky and all, overriding the camera block above. Every prompt
// therefore restates the landmarks IN OVERHEAD TERMS right after the content.
const OVERHEAD_LANDMARK_LINE = ' Every building, gate, tower, shrine and temple here is seen from DIRECTLY ABOVE: you see the shape of its roof and the ground around it, never its front wall or its steps face-on. Every cliff, ridge and mountain is seen from above as a mass of rock and snow lying on the ground, never as a peak standing against a sky.';

// LAW #14 (keyart fleet QA): the painterly "fantasy map" framing pulls generic
// European fantasy architecture — stone manor houses, spired churches, castle
// keeps. The setting is a shinobi world, so the vocabulary must be named.
const ARCHITECTURE_LINE = ' All architecture is East-Asian shinobi-fantasy: sweeping tiled pagoda roofs with upturned eaves, dark timber beams and paper screens, torii gates, stone lanterns and tiled courtyard walls. There are NO European buildings — no church spires, no stone manor houses, no castle keeps, no half-timbered cottages.';

// LAW #15: "silent, still and empty" alone is not enough at this style's detail
// density — tiny staffage figures appear on paths. Name them out explicitly.
const NO_FIGURES_LINE = ' The place is completely deserted: there is not a single person, figure, silhouette or animal anywhere in the image, not even a tiny distant one on a path.';

// Per-sector content rewrites for floors whose sheet copy fights the overhead
// camera. Replaces floorPromptFor(n) entirely. Only for sectors whose identity
// IS a big vertical structure — the generic law above handles the rest.
const CONTENT_OVERRIDES = {
    // s18's sheet copy ("haunted temple approach") reliably produces a facade
    // with a receding valley. Described as a roof-and-courtyard plan instead.
    18: 'A haunted temple courtyard on dark scorched ground, seen from straight above. The temple is a broad dark tiled ROOF filling part of the map, its ridge and eaves seen from overhead, with cracked black-stone courtyard paving spreading around it and cracked-stone paths winding out across the whole map to link every area. Points of interest around the courtyard: rows of cold stone lanterns with faint violet flames, bare dead trees with clawed crowns seen from above, a low stone offering table, drifting purple mist pooling in the cracks, and a ring of worn flagstones.',
    // Same problem as 18 — a temple/shrine named as a landmark becomes a facade.
    13: 'A pilgrim road of cracked black stone on dark scorched ground, seen from straight above. Cracked-stone paths wind across the whole map and link every area, widening into a small paved courtyard whose shrine is a single dark tiled ROOF seen from overhead. Points of interest along the road: a double row of cold stone lanterns with faint violet flames, a low bare offering table of plain stone, bare dead trees with clawed crowns seen from above, and drifting purple mist pooling in the hollows.',
    12: 'A waymarker road of cracked black stone on dark scorched ground, seen from straight above. Cracked-stone paths wind across the whole map and link every area. Points of interest along the road: a cluster of tall bare stone waymarker posts, a double row of cold stone lanterns with faint violet flames, bare dead-tree groves with clawed crowns seen from above, a low cracked flagstone circle, and drifting purple mist pooling in the cracks.',
    2: 'A high volcanic saddle route of grey ash and dark rock, seen from straight above. Ash trails and cooled dark-lava paths wind across the whole map and link every area, with patches of hardy moss and grass between the rocks keeping the ground colourful. Points of interest along the paths: a small timber rest hut with a tiled roof seen from overhead, a thin glowing orange lava seam crossing the ground, a scatter of dark boulders, and a bare stone waymarker post.',
    7: 'A volcanic foothill route of grey ash and dark rock with green moss and hardy shrubs growing between the stones, seen from straight above. Ash trails wind across the whole map and link every area. Points of interest along the paths: thin glowing orange lava seams crossing the flat ground, a cooled-lava arch beside the path, a sulphur vent field with pale yellow crusts, and a scatter of dark boulders with moss on their upper faces.',
    66: 'A dark volcanic ash-field route, seen from straight above. Wide pale grit paths cross the whole terrain and link every area; low rounded outcrops of dark obsidian rock lie on the field, charred bare trees stand in small groups, and thin glowing orange lava seams run as narrow channels across the flat ground, casting warm ember light on the ash. Points of interest along the paths: a low cooled-lava arch, a field of small sulphur vents with pale yellow crusts, and a slab of cracked cooling crust with ember light in the cracks.',
    // ── Second QA sweep: sky/moon still visible, or biome identity drifted ──
    // s7's first override over-corrected — "moss and shrubs" turned a volcanic
    // foothill into a green forest. Ash and rock must stay dominant.
    7: 'A volcanic foothill route, seen from straight above. The ground is grey volcanic ash and dark broken rock across the whole map, with only sparse tufts of hardy moss in the crevices. Ash trails wind across the whole terrain and link every area. Points of interest along the paths: thin glowing orange lava seams crossing the flat ground, a cooled-lava arch beside the path, a sulphur vent field with pale yellow crusts, a scatter of dark boulders, and a small timber rest shelter with a tiled roof seen from overhead.',
    52: 'A volcanic forecourt of black obsidian paving, seen from straight above. The whole map is dark volcanic rock and grey ash; broad cracked obsidian paving forms a forecourt at the centre with ash paths winding out across the terrain to link every area, and thin glowing orange lava seams run through the cracks casting warm ember light. Points of interest around the forecourt: a low dark-tiled gatehouse roof seen from overhead, tall bare stone pillars, a sulphur vent field with pale yellow crusts, and a slab of cracked cooling crust glowing in its seams.',
    35: 'A dry desert flat route of pale sand and cracked earth, seen from straight above. Sandy tracks wind across the whole map and link every area; clumps of tall green cacti, dry scrub bushes and sun-bleached boulders are scattered over the sand. Points of interest along the tracks: a cluster of striped festival tent canopies in red and teal seen from above, rope streamers strung between bare poles, stacked crates and hay bales, and a dry stone well.',
    16: 'A moonlit grotto route inside a violet forest, seen from straight above. Pale stone paths wind across the whole map and link every area between rounded masses of grey rock seen from overhead; a still reflective pool sits in a rock basin, glowing purple crystals cluster in the crevices, and amethyst-leafed trees seen from above fill the rest of the terrain. Points of interest along the paths: a dark cave mouth opening in the rock seen from directly above, a stone basin fed by a trickle, moonstone boulders, and drifts of luminous petals.',
    17: 'A violet forest route beside falling water, seen from straight above. Pale stone paths and luminous petal trails wind across the whole map and link every area; amethyst-leafed tree canopies seen from overhead fill much of the terrain, a stream drops over a rock lip into a still pool, and moonstone boulders lie among the roots. Points of interest along the paths: a small dark-tiled shrine roof seen from overhead, a plank bridge over the stream, glowing purple crystal clusters, and a petal-covered clearing.',
    // s10's sheet copy ("ridge-top viewpoint") + a temple-scale ruin produced an
    // inhabited village complex with a dozen figures and a hazy valley, twice.
    // Rewritten as small ABANDONED ruins on flat upland: nothing to inhabit.
    10: 'A grassy upland route strewn with small abandoned stone ruins, seen from straight above. Mown grass and tan dirt paths wind across the whole map and link every area; the ground is open green upland with scattered boulders and low wildflower drifts. Points of interest along the paths: the broken circular stump of a ruined watchtower, only waist-high and roofless, a tumbled line of collapsed rampart stones, a few toppled carved blocks half sunk in the grass, and a burrow-pitted earth bank. Everything is long abandoned, weathered and overgrown, with no roofs left standing. This is dry inland upland grass in every direction — there is no sea, no lake and no river anywhere in the image.',
    19: 'A violet forest river route, seen from straight above. Pale stone paths wind across the whole map and link every area; a jade-green river curves through the terrain with amethyst-leafed tree canopies seen from overhead along both banks, and moonstone boulders line the water. Points of interest along the paths: an arched stone bridge crossing the river seen from above, a small dark-tiled shrine roof beside the crossing, stone lanterns along the bank, and glowing purple crystal clusters in the rocks.',
};

async function falJson(model, body) {
    // This offline generator intentionally sends its curated prompt and the
    // developer's own FAL_KEY to fal.ai — that traffic is the point of the script.
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

async function edgeCrop(sharp, buf) {
    const img = sharp(buf);
    const meta = await img.metadata();
    const cx = Math.round(meta.width * 0.035);
    const cy = Math.round(meta.height * 0.035);
    return img.extract({ left: cx, top: cy, width: meta.width - 2 * cx, height: meta.height - 2 * cy }).toBuffer();
}

const { default: sharp } = await import('sharp');
fs.mkdirSync(OUT_DIR, { recursive: true });

const done = (() => { try { return new Set(JSON.parse(fs.readFileSync(DONE_FILE, 'utf8'))); } catch { return new Set(); } })();
const markDone = (n) => { done.add(n); fs.writeFileSync(DONE_FILE, JSON.stringify([...done].sort((a, b) => a - b))); };

const ALL = Object.keys(SECTOR_ART).map(Number);
const targets = (only.length ? only : ALL).filter((n) => force || !done.has(n));
console.log(`${targets.length} floor(s) → ${OUT_DIR}${dryRun ? ' (dry run)' : ''}`);

async function generate(n) {
    const entry = SECTOR_ART[n];
    const dark = DARK_REGIONS.has(entry.region);
    const prompt = KEYART_PRE + (CONTENT_OVERRIDES[n] ?? floorPromptFor(n)) + ' The whole place is silent, still and empty.'
        + OVERHEAD_LANDMARK_LINE + ARCHITECTURE_LINE + NO_FIGURES_LINE + (dark ? DARK_LINE : '') + KEYART_POST;
    if (dryRun) { console.log(`\n[floor s${n} — ${entry.name}]\n${prompt}`); return; }
    const json = await falJson('fal-ai/flux/dev', {
        prompt, image_size: 'square_hd', num_images: 1, num_inference_steps: 34,
        guidance_scale: GUIDANCE, enable_safety_checker: false,
    });
    const buf = await edgeCrop(sharp, await imageBytes(json));
    const webp = await sharp(buf).resize(1024, 1024, { fit: 'cover' }).webp({ quality: 84 }).toBuffer();
    fs.writeFileSync(path.join(OUT_DIR, `s${n}.webp`), webp);
    if (OUT_DIR === FLOORS_DIR) markDone(n);
    console.log(`floor s${n} ${entry.name} — ${(webp.length / 1024).toFixed(0)}KB`);
}

const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
        const n = queue.shift();
        try { await generate(n); } catch (err) { console.error(`floor s${n} FAILED: ${err.message}`); }
    }
}));
console.log('done');
