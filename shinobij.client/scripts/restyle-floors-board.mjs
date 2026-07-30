/*
 * Fleet restyle: regenerate the 60 ORIGINAL sector floors (artKeys 1-60) in the
 * sculpted top-down BOARD style established by scripts/redo-expansion-floors.mjs
 * (owner's reference: dimensional sculpted forms, crisp painted texture, no sky,
 * ground edge to edge) — so all 66 boards share one style.
 *
 * Content comes from the July prompt sheet (scripts/sector-art-data.mjs
 * floorPromptFor: region floorBase + per-sector points of interest) — those
 * identities are canon (traces, quests and names reference them) and already
 * survived the July content QA, including the shrine floors' "kept empty"
 * clearings. Only the STYLE wrapper changes.
 *
 * Prompt laws carried over (see redo-expansion-floors.mjs):
 *  - dark-ground regions get the aerial-photo framing line, or flux floats a
 *    literal diorama slab on a void;
 *  - vista vocabulary in a body is handled at reroll time, not globally.
 *
 * Usage:
 *   node scripts/restyle-floors-board.mjs --only 27,42,58     # explicit set
 *   node scripts/restyle-floors-board.mjs --all               # everything not yet done
 *   node scripts/restyle-floors-board.mjs --only 35 --force   # reroll one
 * Progress is tracked in scripts/.restyle-board-done.json (gitignored) so
 * --all is resumable; --force regenerates regardless.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTOR_ART, floorPromptFor } from './sector-art-data.mjs';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_DIR = path.join(CLIENT, 'public', 'sector-map');
const DONE_FILE = path.join(CLIENT, 'scripts', '.restyle-board-done.json');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);
const dryRun = flag('dry-run');
const force = flag('force');
const GUIDANCE = parseFloat(arg('guidance', '4.5'));
const CONCURRENCY = Math.max(1, parseInt(arg('concurrency', '3'), 10) || 3);
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

// ── The BOARD style (single source with redo-expansion-floors.mjs — keep in sync) ──
const BOARD_PRE = 'A complete top-down game board map of one small location for a fantasy ninja RPG, rendered as stylized 3D isometric game environment art in the style of a AAA stylized RPG diorama: dimensional sculpted forms with real height AND crisp hand-painted texture detail on every surface — visible wood grain and planking, bark, rock striations, grass blades, ground grain — clean silhouettes, soft ambient-occlusion contact shadows, one gentle directional daylight casting long soft shadows, rich saturated natural colour. Viewed from a high bird’s-eye angle with a slight oblique tilt, so trees, rocks and structures read as beautiful detailed little models standing on the terrain. A clear main path runs from one edge of the board to the opposite edge, with side paths branching to every corner. The terrain fills the entire frame edge to edge — every corner of the image is ground seen from above. ';

const BOARD_POST = ' COMPOSITION: the whole board is densely filled and reads as ONE connected, welcoming place — winding paths link every area so the eye flows naturally across the map, terrain features break up the space, and the small points of interest sit naturally along the routes. NO large empty areas and NO empty middle — every part of the board has something interesting — BUT keep the paths and clearings as clear, open, walkable lanes. Features blend and connect into one another: NO isolated single objects floating in empty space, NO evenly-spaced grid of props. ONE consistent sculpted stylized-3D game-environment style across the entire image — clean, dimensional, softly lit, saturated natural colour. It must feel like a real little place, not a background. Absolutely NO characters, NO people, NO humans, NO text, NO words, NO UI, NO HUD, NO minimap, NO grid lines, NO hex tiles, NO tile outlines, NO markers, NO icons, NO arrows, NO labels, NO frame, NO border, NO vignette, NO watermark. NOT a flat illustration, NOT a painted map, NOT outlined cartoon linework, NOT pixel art, NOT photoreal, NOT murky or gritty. The artwork fills the entire frame edge to edge.';

// Law #10: dark-ground regions must carry the aerial-photo framing, or the
// "board/diorama" vocabulary + a black ground floats a slab on a void.
const DARK_REGIONS = new Set(['volcano', 'darktemple']);
const AERIAL_LINE = ' The dark terrain fills the entire image from edge to edge — every corner of the image is warm-lit ground seen from above, exactly like an aerial photograph, and the glowing light sources keep the whole scene warm and readable, never black.';
// Neutral full-bleed reinforcement for every board — the fleet run still
// slabbed ~10% of rolls despite the edge-to-edge line in BOARD_PRE; the
// "exactly like an aerial photograph" phrasing is what reliably kills it.
const FULL_BLEED_LINE = ' The terrain continues past all four edges of the frame, exactly like an aerial photograph of a larger landscape — no part of the image is empty background.';

// Per-sector reroll guidance learned from the fleet QA sweep.
const OVERRIDES = {
    // s57's banners grew faux-kanji (text-carrier law): make them explicitly plain.
    57: ' All banner cloth is plain solid indigo and gold with no writing or symbols; the notice board is bare empty wood.',
    // s47 under-delivered twice (near-blank snow): spell the gate scene out densely.
    47: ' The centrepiece is a grand torii gate of blue ice and dark timber standing over the main path, flanked by a small timber guard hut with a snow-laden roof, a double row of stone lantern posts lining the approach, banked snowdrifts, ice-crystal clusters and groups of snow-laden pines — the board is densely detailed with no large empty snowfield.',
    // s7 kept slabbing even with the aerial line: give the ground colour + life.
    7: ' Green moss, hardy shrubs and grass tufts grow between the dark rocks so the ground stays colourful and readable everywhere.',
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

const done = (() => { try { return new Set(JSON.parse(fs.readFileSync(DONE_FILE, 'utf8'))); } catch { return new Set(); } })();
const markDone = (n) => { done.add(n); fs.writeFileSync(DONE_FILE, JSON.stringify([...done].sort((a, b) => a - b))); };

// The 60 original artKeys (61-66 already wear the board style via
// redo-expansion-floors.mjs and are the fleet's style anchors).
const ALL = Object.keys(SECTOR_ART).map(Number).filter((n) => n <= 60);
const targets = (only.length ? only : ALL).filter((n) => force || !done.has(n));

console.log(`${targets.length} floor(s) to restyle${dryRun ? ' (dry run)' : ''}`);

async function generate(n) {
    const entry = SECTOR_ART[n];
    const dark = DARK_REGIONS.has(entry.region);
    const prompt = BOARD_PRE + floorPromptFor(n) + ' The whole place is silent, still and empty.'
        + (OVERRIDES[n] ?? '') + (dark ? AERIAL_LINE + FULL_BLEED_LINE : FULL_BLEED_LINE) + BOARD_POST;
    if (dryRun) { console.log(`\n[floor s${n} — ${entry.name}]\n${prompt}`); return; }
    const json = await falJson('fal-ai/flux/dev', {
        prompt, image_size: 'square_hd', num_images: 1, num_inference_steps: 32,
        guidance_scale: GUIDANCE, enable_safety_checker: false,
    });
    const buf = await edgeCrop(sharp, await imageBytes(json));
    const webp = await sharp(buf).resize(1024, 1024, { fit: 'cover' }).webp({ quality: 84 }).toBuffer();
    fs.writeFileSync(path.join(FLOORS_DIR, `s${n}.webp`), webp);
    markDone(n);
    console.log(`floor s${n} ${entry.name} — ${(webp.length / 1024).toFixed(0)}KB`);
}

const queue = [...targets];
const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
        const n = queue.shift();
        try { await generate(n); } catch (err) { console.error(`floor s${n} FAILED: ${err.message}`); }
    }
});
await Promise.all(workers);
console.log('done');
