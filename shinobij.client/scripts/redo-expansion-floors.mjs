/*
 * Redo the six 2026-07-29 expansion sector FLOORS (s61-s66) in the sculpted
 * top-down BOARD style (the owner's reference: the Glacier Bridge board —
 * stylized-3D miniature-diorama forms, no sky, ground edge to edge), replacing
 * the world-map-illustration style gen-sector-art.mjs gave them.
 *
 * One-off on purpose: the global FLOOR_PRE/POST in gen-sector-art.mjs still
 * describes the old style for the other 60 floors; this script carries the new
 * BOARD style for the six until the full-fleet restyle beat adopts it.
 *
 * The fal call, edge-crop and webp post steps mirror gen-sector-art.mjs
 * exactly so the output drops into public/sector-map/ unchanged.
 *
 * Usage:  node scripts/redo-expansion-floors.mjs [--only 65] [--dry-run] [--guidance 4]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_DIR = path.join(CLIENT, 'public', 'sector-map');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);
const dryRun = flag('dry-run');
const GUIDANCE = parseFloat(arg('guidance', '4'));
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

// ── The BOARD style (from the owner's reference board) ──────────────────────
// Sculpted stylized-3D diorama, top-down, ground filling the whole frame.
// Positive-only framing: naming "sky" even to forbid it can summon one.
const BOARD_PRE = 'A complete top-down game board map of one small location for a fantasy ninja RPG, rendered as stylized 3D isometric game environment art in the style of a AAA stylized RPG diorama: dimensional sculpted forms with real height AND crisp hand-painted texture detail on every surface — visible wood grain and planking, bark, rock striations, grass blades, ground grain — clean silhouettes, soft ambient-occlusion contact shadows, one gentle directional daylight casting long soft shadows, rich saturated natural colour. Viewed from a high bird’s-eye angle with a slight oblique tilt, so trees, rocks and structures read as beautiful detailed little models standing on the terrain. A clear main path runs from one edge of the board to the opposite edge, with side paths branching to every corner. The terrain fills the entire frame edge to edge — every corner of the image is ground seen from above. ';

const BOARD_POST = ' COMPOSITION: the whole board is densely filled and reads as ONE connected, welcoming place — winding paths link every area so the eye flows naturally across the map, terrain features break up the space, and the small points of interest sit naturally along the routes. NO large empty areas and NO empty middle — every part of the board has something interesting — BUT keep the paths and clearings as clear, open, walkable lanes. Features blend and connect into one another: NO isolated single objects floating in empty space, NO evenly-spaced grid of props. ONE consistent sculpted stylized-3D game-environment style across the entire image — clean, dimensional, softly lit, saturated natural colour. It must feel like a real little place, not a background. Absolutely NO characters, NO people, NO humans, NO text, NO words, NO UI, NO HUD, NO minimap, NO grid lines, NO hex tiles, NO tile outlines, NO markers, NO icons, NO arrows, NO labels, NO frame, NO border, NO vignette, NO watermark. NOT a flat illustration, NOT a painted map, NOT outlined cartoon linework, NOT pixel art, NOT photoreal, NOT murky or gritty. The artwork fills the entire frame edge to edge.';

// ── Per-sector content, written under the top-down laws: no horizon / distant /
// looming / vista vocabulary (that is exactly what bent the first attempt into
// establishing shots), positive-only stillness, known concepts only. ─────────
const FLOORS = {
    61: {
        name: 'Westfurrow Fields',
        body: 'A green upland farm route. Dirt paths wind across the whole map and link every area; long ploughed furrows band the fields, low hedgerows and wildflower verges soften the edges. Points of interest along the paths: a drystone field wall with a wooden stile, a cluster of golden hay stooks, a turnip cellar hatch set into a grass bank, and a lone scarecrow on a bare pole in a fallow patch. Early morning light, dew bright on the grass, the whole place silent, still and empty.',
    },
    62: {
        name: 'Greycliff Landing',
        body: 'A rocky shore route at the foot of a grey stone headland, the rock rendered as rounded sculpted masses seen from above. Shingle paths and cut stone steps wind across the whole map and link every area; clear turquoise shallows fill one whole edge of the board, with tide pools, wet boulders and tufts of salt grass along the waterline. Points of interest along the shore: a low stone slipway meeting the water, an upturned rowboat on the shingle, a stack of crab pots against the rock, and empty drying frames with nets. Cool overcast daylight, the whole place silent, still and empty.',
    },
    63: {
        name: 'Tallgrass Bend',
        body: 'A golden tallgrass river route at dusk. Dense head-high stands of ripe golden-amber grass with visible painted blades cover most of the board, cut through by trampled grass paths that wind across the whole map and link every area; a slow jade-green river curves through the middle with soft reed banks and dry hummocks. Points of interest along the paths: a plank footbridge crossing the river bend, a reed cutter’s neat stack of bound reeds, a ring of flattened golden grass, and tall wooden poles strung with small colourful rope streamers. Warm low amber dusk light across the grass tops, long soft shadows, the whole place silent, still and empty.',
    },
    64: {
        name: 'Lantern Vigil',
        body: 'A dark scorched lantern road through shadowed ground. Cracked flagstone paths wind across the whole map and link every area; a long double row of cold stone lanterns lines the main road, each with a faint ember glow in its mouth, violet mist pooling low in the hollows between them. Points of interest along the paths: a bare offering table of plain stone, a grove of dead trees with bare sculpted crowns, a low cracked flagstone circle, and a toppled lantern half sunk in ash. Dim violet dusk ground-light, the whole place silent, still and empty.',
    },
    65: {
        name: 'Eastwind Cirque',
        body: 'A high glacier bowl route of snow and blue ice. Wind-scoured snow paths with visible trodden texture wind across the whole map and link every area; a frozen tarn of glassy blue ice sits off-centre, curved shelves of blue-white ice render as sculpted rock-and-ice masses, snowdrifts banked against frost-rimed boulders, snow-laden pines with detailed painted fronds scattered in groups. Points of interest along the paths: a small timber mountain shelter with a snow-laden plank roof and wooden steps, a smooth snow ramp onto the ice, a cluster of frost-rimed boulders, and a plank walkway crossing a frozen melt channel. Bright cold daylight on white snow and teal ice, the whole place silent, still and empty.',
    },
    66: {
        name: 'Emberspine Ridge',
        body: 'A dark volcanic ash-field route, seen so close that the ash terrain fills the entire image from edge to edge — every corner of the image is warm-lit ash ground, exactly like an aerial photograph of the field. Wide pale grit paths cross the whole terrain and link every area; low rounded outcrops of dark obsidian rock sit on the field, charred trees with bare sculpted crowns stand in small groups, and thin glowing orange lava seams run as narrow channels across the ground, casting warm ember light onto the ash around them so the whole scene reads warm and lit, never black. Points of interest along the paths: a low cooled-lava arch beside the main path, a field of small sulphur vents with pale yellow crusts, and a slab of cracked cooling crust with ember light in the cracks. The whole place silent, still and empty.',
        // "board/diorama" + black ground made flux float a slab on a void once —
        // this body's aerial-photo framing overrides that; keep it if editing.
    },
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

// Flux occasionally hallucinates tiny corner watermarks; a 3.5% zoom-crop per
// edge removes them (baked-in law from the July art pass).
async function edgeCrop(sharp, buf) {
    const img = sharp(buf);
    const meta = await img.metadata();
    const cx = Math.round(meta.width * 0.035);
    const cy = Math.round(meta.height * 0.035);
    return img.extract({ left: cx, top: cy, width: meta.width - 2 * cx, height: meta.height - 2 * cy }).toBuffer();
}

const { default: sharp } = await import('sharp');
const targets = Object.keys(FLOORS).map(Number).filter((n) => !only.length || only.includes(n));

for (const n of targets) {
    const prompt = BOARD_PRE + FLOORS[n].body + BOARD_POST;
    if (dryRun) { console.log(`\n[floor s${n} — ${FLOORS[n].name}]\n${prompt}`); continue; }
    const json = await falJson('fal-ai/flux/dev', {
        prompt, image_size: 'square_hd', num_images: 1, num_inference_steps: 32,
        guidance_scale: GUIDANCE, enable_safety_checker: false,
    });
    const buf = await edgeCrop(sharp, await imageBytes(json));
    const webp = await sharp(buf).resize(1024, 1024, { fit: 'cover' }).webp({ quality: 84 }).toBuffer();
    fs.writeFileSync(path.join(FLOORS_DIR, `s${n}.webp`), webp);
    console.log(`floor s${n} ${FLOORS[n].name} — ${(webp.length / 1024).toFixed(0)}KB`);
}
console.log('done');
