// Complete hand-painted top-down 2D ADVENTURE MAPS — one cohesive illustration per
// sector (RPG-Maker / Stardew / Pokémon-route style). The WHOLE map is the place:
// winding paths link everything, terrain features + groves break up the space, a few
// small points-of-interest sit along the routes, no empty centre, open walkable lanes
// for the orb. NOT a 3D diorama, NOT props-on-a-texture, NOT a scenic backdrop.
// The orb + gameplay markers render on top (existing 2D sector code).
//
//   node scripts/gen-sector-map.mjs --only forest         # one biome (proof)
//   node scripts/gen-sector-map.mjs                       # all biomes
//   node scripts/gen-sector-map.mjs --variants 2          # N variants each (-1,-2…)
//   node scripts/gen-sector-map.mjs --dry-run             # print prompts only
//
// Writes public/sector-map/<biome>[-N].webp + src/data/sector-map-manifest.ts.
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

// Per-biome PLACE description (features + paths + small points of interest), from the
// rework spec's biome examples. Everything connected; no asset islands.
const BIOME = {
    forest: 'A lush green forest wilderness route. Winding dirt trails and gnarled exposed-root paths thread across the whole map and link every area; scattered tree groves and clusters, root systems, mushroom patches, fallen mossy logs, and small grassy clearings; a clear creek winds through with a little log crossing. A few small points of interest tucked naturally along the paths: a ruined campsite with a cold fire-ring, an old wooden hunting stand, one large gnarled ancient tree, a broken wooden footbridge, and an overgrown mossy stone shrine.',
    snow: 'A frozen wilderness route under pale daylight. Packed-snow trails and the snowy edge of a frozen pond wind across the whole map and link every area; pine groves, snowdrifts, patches of glassy pale-blue ice, and clusters of blue ice-crystal formations. A few small points of interest along the trails: an abandoned wooden sled, a collapsed snow-covered cabin, a small frozen stone shrine, and a dark ice-cave entrance in a frosted rocky outcrop.',
    shadow: 'A haunted travel route at dusk on dark ground. Cracked dark-stone paths and pink petal trails wind across the whole map and link every area; bare dead-tree groves, low pockets of drifting purple fog, and still reflective spirit pools, dusted with scattered pink cherry petals. A few small points of interest along the paths: a weathered red torii gate, a broken stone shrine, a row of cold stone lanterns, and clusters of carved spirit-stones.',
    volcano: 'A dangerous volcanic route. Cooled dark-lava paths and grey ash trails wind across the whole map between glowing molten-orange lava streams and jagged obsidian ridges, with cracks of orange light, linking every safe area. A few small points of interest along the safe paths: a ruined stone forge, a collapsed rope bridge over a lava gap, the remains of a mining camp with an old ore cart, and a black obsidian arch.',
    central: 'A maintained village crossroads area. Fitted grey stone roads and garden walkways connect every part of the map; tended gardens, colourful flower beds, grassy courtyards, low hedges, small koi ponds and a little arched stone bridge. A few small points of interest along the roads: a carved stone fountain, a covered market stall, a stone statue, a small wooden pavilion, and a training-ground post and dummy.',
};

// Two render styles. 'cozy' = the RPG-Maker/Stardew tile-map reference look. 'painterly'
// = the game's established rich painterly semi-realistic anime-fantasy look (world map,
// sector vistas, card-clash locations) — for stylistic cohesion with the rest of the app.
const STYLE = {
    cozy: {
        pre: 'A complete top-down hand-painted 2D adventure map for a cozy fantasy RPG, anime-inspired, in the lush style of a 16-bit JRPG overworld / Stardew Valley / a Pokemon route — viewed from a high top-down angle with a slight oblique tilt so trees, structures and terrain have a little visible height (a 2.5D map look). ',
        look: 'ONE consistent hand-painted painterly anime art style across the entire image, soft natural lighting, rich cohesive detail, lush, lived-in and inhabited.',
        neg: '',
    },
    painterly: {
        pre: 'A complete top-down high-angle adventure map of one small location for a fantasy ninja RPG, painted in a RICH PAINTERLY SEMI-REALISTIC ANIME-FANTASY illustration style — lush detail, soft atmospheric cinematic lighting, depth and haze, vibrant saturated colour, like a high-fidelity digital matte painting — viewed from a high birds-eye angle with a slight oblique tilt so trees, structures and terrain have visible height. ',
        look: 'ONE consistent rich painterly semi-realistic anime-fantasy digital-painting style across the entire image (the same lush cinematic look as a fantasy world-map illustration), soft atmospheric lighting and depth, vibrant saturated colour, lavish cohesive detail, lived-in and inhabited.',
        neg: ' This is a detailed painterly digital painting — NOT pixel art, NOT 16-bit, NOT a flat cartoon, NOT a tile-set, NOT cel-shaded, NOT a board game.',
    },
    // Match the game's WORLD MAP — a top-down sector is "zooming into a region of the
    // world map", so this is the cohesive target: vivid, luminous, saturated, crisp,
    // polished high-fantasy map illustration (biome hue carries mood, style stays bright).
    worldmap: {
        pre: 'A complete top-down high-angle adventure map of one small location for a fantasy ninja RPG, drawn in the EXACT art style of a vivid high-fantasy game WORLD MAP — bright luminous highly-saturated colour, crisp clean polished detailed rendering, lush and glowing, a colourful jewel-like fantasy-map illustration, as if zooming into one region of a beautiful world map — viewed from a high bird’s-eye angle with a slight oblique tilt so trees, structures and terrain have visible height. ',
        look: 'ONE consistent vivid high-fantasy WORLD-MAP illustration style across the entire image — bright, luminous, highly-saturated jewel-like colour, crisp clean polished detail, lush and glowing, colourful and inviting (the biome’s own hue, but always vibrant and luminous, never murky).',
        neg: ' Match a vivid colourful high-fantasy world-map illustration — bright, saturated and luminous; NOT dark, NOT muted, NOT desaturated, NOT moody, NOT gritty, NOT photoreal, NOT pixel art, NOT a flat cartoon, NOT a tile-set, NOT cel-shaded.',
    },
    // Match the game's most cinematic screens (moody atmospheric village render):
    // dramatic volumetric lighting, depth haze, semi-realistic detail, warm glow.
    cinematic: {
        pre: 'A complete top-down high-angle adventure map of one small location for a fantasy ninja RPG, rendered as a CINEMATIC ATMOSPHERIC SEMI-REALISTIC painterly digital painting — dramatic volumetric lighting, rich moody atmosphere with soft depth haze, naturalistic finely-detailed textures, warm glowing light pools against cooler ambient shadow, lush film-concept-art quality (the same cinematic feel as a moody atmospheric fantasy village render) — viewed from a high birds-eye angle with a slight oblique tilt so trees, structures and terrain have visible height. ',
        look: 'ONE consistent CINEMATIC atmospheric semi-realistic painterly style across the entire image (the same lush film-quality look as a moody fantasy village illustration), dramatic depth and volumetric light, soft atmospheric haze, naturalistic rich detail, warm glowing light accents, deeply lived-in and inhabited.',
        neg: ' This is a cinematic semi-realistic digital painting with rich realistic lighting and atmosphere — NOT flat, NOT pixel art, NOT 16-bit, NOT a cartoon, NOT a tile-set, NOT cel-shaded, NOT a board game.',
    },
};
const styleName = arg('style', 'cozy');
const sty = STYLE[styleName] || STYLE.cozy;
const BASE_PRE = sty.pre;
const BASE_POST = ' COMPOSITION: the whole map is densely filled and reads as ONE connected inhabited place — winding paths link every area so the eye flows naturally across the map, terrain features and groves break up the space, and the small points of interest sit naturally along the routes. NO large empty areas and NO empty middle — every part of the map has something interesting — BUT keep the paths and clearings as clear, open, walkable lanes for a character to travel through. Features blend and connect into one another: NO isolated single objects floating in empty space, NO evenly-spaced grid of props. ' + sty.look + ' It must feel like a real little place, not a background. Absolutely NO characters, NO people, NO humans, NO text, NO words, NO UI, NO HUD, NO minimap, NO grid lines, NO hex tiles, NO tile outlines, NO markers, NO icons, NO arrows, NO labels, NO frame, NO border, NO vignette, NO watermark.' + sty.neg + ' The artwork fills the entire frame edge to edge.';

const BIOMES = ['forest', 'snow', 'shadow', 'volcano', 'central'];
const onlyB = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const dryRun = flag('dry-run');
const QUALITY = arg('quality', 'high');
const SIZE = arg('size', '1536x1024');
const VARIANTS = Math.max(1, parseInt(arg('variants', '1'), 10) || 1);
const MAP_DIR = path.join(CLIENT, 'public', 'sector-map');
const MANIFEST = path.join(CLIENT, 'src', 'data', 'sector-map-manifest.ts');

const TAG = arg('tag', '');
const prompt = (b) => BASE_PRE + BIOME[b] + BASE_POST;
const fileId = (b, v) => `${v === 0 ? b : `${b}-${v}`}${TAG ? '-' + TAG : ''}`;

async function gen(p, apiKey, sharp) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: p, size: SIZE, quality: QUALITY, n: 1, output_format: 'png' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message ?? '?'}`);
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('no image data');
    return sharp(Buffer.from(b64, 'base64')).resize({ width: 1408, withoutEnlargement: true }).webp({ quality: 84, effort: 6 }).toBuffer();
}

async function main() {
    if (dryRun) { for (const b of BIOMES) console.log(`\n[${b}]\n${prompt(b)}`); return; }
    const apiKey = envKey('OPENAI_API_KEY');
    if (!apiKey) { console.error('no OPENAI_API_KEY'); process.exit(1); }
    const sharp = (await import('sharp')).default;
    fs.mkdirSync(MAP_DIR, { recursive: true });
    for (const b of BIOMES) {
        if (onlyB.length && !onlyB.includes(b)) continue;
        for (let v = 0; v < VARIANTS; v++) {
            try {
                process.stdout.write(`${fileId(b, v)} … `);
                const buf = await gen(prompt(b), apiKey, sharp);
                fs.writeFileSync(path.join(MAP_DIR, `${fileId(b, v)}.webp`), buf);
                console.log(`${(buf.length / 1024).toFixed(0)} KB`);
            } catch (e) { console.log(`FAIL: ${e.message}`); }
        }
    }
    // Tagged A/B runs don't touch the manifest (throwaway comparison files).
    if (TAG) { console.log('\n(tagged run — manifest not written)'); return; }
    // Manifest: biome → variant count present on disk (resumable).
    const counts = {};
    for (const b of BIOMES) {
        let n = 0;
        for (let v = 0; v < 16; v++) if (fs.existsSync(path.join(MAP_DIR, `${fileId(b, v)}.webp`))) n = Math.max(n, v + 1); else if (v === 0) break;
        if (n) counts[b] = n;
    }
    const body =
        '// AUTO-GENERATED by scripts/gen-sector-map.mjs — do not edit by hand.\n' +
        '// Hand-painted top-down adventure maps at public/sector-map/<biome>[-N].webp.\n' +
        '// Value = number of variants present (file <biome>.webp is variant 0).\n' +
        'export const SECTOR_MAP: Record<string, number> = ' + JSON.stringify(counts) + ';\n';
    fs.writeFileSync(MANIFEST, body);
    console.log(`\nmanifest: ${Object.entries(counts).map(([b, n]) => `${b}×${n}`).join(', ') || 'none'} → ${path.relative(CLIENT, MANIFEST)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
