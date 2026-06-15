// Sector scatter-prop generator (OpenAI gpt-image-1, transparent PNG).
//
//   prompt ──▶ gpt-image-1 (transparent) ──▶ sharp (WebP w/ alpha) ──▶ public/sector-props/<biome>/<id>.webp
//
// <SectorScatter> sprinkles these small biome ground-objects (rocks / bushes /
// crystals / mushrooms / lanterns) across the sector grid so the play-field reads
// as a dense, explorable landscape instead of an empty grid over a painting. They
// are LOW ground props on purpose (no tall trees) so they sit on the walkable
// plane and complement the painted vista rather than clashing with its perspective.
//
//   node scripts/gen-sector-props.mjs                       # all biomes
//   node scripts/gen-sector-props.mjs --only forest,snow    # a subset of biomes
//   node scripts/gen-sector-props.mjs --quality medium      # gen cost knob
//   node scripts/gen-sector-props.mjs --dry-run             # print prompts, spend nothing
//
// OPENAI_API_KEY from env or shinobij.client/.env. Writes the webps + rewrites
// src/data/sector-props-manifest.ts (present ids grouped by biome). Then rebuild
// the client + commit public/sector-props + the manifest (+ dist for cPanel).
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

const SUFFIX = ' A single isolated object, three-quarter slightly-top-down game-asset view, centered and standing upright.' +
    ' Painterly anime fantasy RPG style matching a cinematic biome, soft dramatic lighting, rich detail.' +
    ' Transparent background — ONLY the object itself, everything around it completely empty and fully transparent.' +
    ' No ground, no cast shadow, no scenery, no background, no characters, no text, no logo, no watermark, no UI.' +
    ' Clean crisp anti-aliased edges suitable for compositing as a small scatter prop in a game scene.';

// biome → { id: prompt }. LOW ground objects only.
const PROPS = {
    snow: {
        'snow-rock':   'a snow-capped grey granite boulder',
        'snow-shrub':  'a small bare winter shrub lightly dusted with snow',
        'ice-crystal': 'a cluster of glowing pale-blue ice crystals',
        'snow-mound':  'a small rounded snow mound with a few dry grass blades poking out',
    },
    volcano: {
        'lava-rock':     'a jagged dark volcanic boulder with faint glowing orange lava cracks',
        'obsidian-shard':'a small cluster of sharp glossy black obsidian shards',
        'ember-vent':    'a small smoking volcanic ground vent glowing hot orange with embers',
        'charred-shrub': 'a small charred blackened dead shrub',
    },
    shadow: {
        'spirit-lantern':'a weathered mossy stone lantern with a soft glowing purple flame',
        'petal-bush':    'a small flowering bush covered in pink cherry blossoms',
        'dark-grass':    'a tuft of tall dark blue-green grass with a couple of pink petals',
        'mossy-stone':   'a dark mossy standing stone with faint glowing carved runes',
    },
    forest: {
        'mushroom':   'a cluster of softly glowing teal forest mushrooms',
        'mossy-rock': 'a rounded grey rock covered in green moss',
        'fern-bush':  'a lush vivid green fern bush',
        'wildflowers':'a small patch of colorful wildflowers in green grass',
    },
    central: {
        'stone-lantern':  'an ornate pale carved stone garden lantern with a warm glowing light',
        'garden-bush':    'a neatly trimmed round ornamental garden bush',
        'ornamental-rock':'a smooth decorative pale garden rock',
        'grass-tuft':     'a tuft of bright manicured green grass',
    },
};

const OUT_ROOT = path.join(CLIENT, 'public', 'sector-props');
const MANIFEST = path.join(CLIENT, 'src', 'data', 'sector-props-manifest.ts');
const GEN_SIZE = '1024x1024';
const MAX_PX = parseInt(arg('max-px', '320'), 10);
const QUALITY = arg('quality', 'high'); // low | medium | high
const WEBP_Q = parseInt(arg('webp-q', '80'), 10);
const onlyBiomes = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const dryRun = flag('dry-run');

async function genOne(biome, id, prompt, apiKey, sharp) {
    const full = prompt + SUFFIX;
    if (dryRun) { console.log(`\n[${biome}/${id}]\n${full}\n`); return; }
    process.stdout.write(`prop: ${biome}/${id} … `);
    const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: full, size: GEN_SIZE, quality: QUALITY, n: 1, background: 'transparent', output_format: 'png' }),
    });
    const data = await res.json();
    if (!res.ok) { console.log(`FAIL ${res.status}: ${data?.error?.message ?? '?'}`); return; }
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) { console.log('FAIL no data'); return; }
    const dir = path.join(OUT_ROOT, biome);
    fs.mkdirSync(dir, { recursive: true });
    const webp = await sharp(Buffer.from(b64, 'base64'))
        .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
        .trim()
        .webp({ quality: WEBP_Q, effort: 6, alphaQuality: 90 })
        .toBuffer();
    fs.writeFileSync(path.join(dir, `${id}.webp`), webp);
    console.log(`${(webp.length / 1024).toFixed(0)} KB`);
}

async function main() {
    const biomes = Object.keys(PROPS).filter((b) => onlyBiomes.length === 0 || onlyBiomes.includes(b));
    if (dryRun) { for (const b of biomes) for (const [id, p] of Object.entries(PROPS[b])) await genOne(b, id, p); return; }

    const apiKey = envKey('OPENAI_API_KEY');
    if (!apiKey) { console.error('no OPENAI_API_KEY (set it in env or shinobij.client/.env)'); process.exit(1); }
    const sharp = (await import('sharp')).default;

    for (const biome of biomes) {
        for (const [id, prompt] of Object.entries(PROPS[biome])) {
            try { await genOne(biome, id, prompt, apiKey, sharp); }
            catch (e) { console.log(`FAIL ${biome}/${id}:`, e?.message || e); }
        }
    }

    // Rewrite the manifest from whatever props now exist on disk (resumable/safe).
    const entries = Object.keys(PROPS).map((biome) => {
        const dir = path.join(OUT_ROOT, biome);
        const ids = fs.existsSync(dir)
            ? Object.keys(PROPS[biome]).filter((id) => fs.existsSync(path.join(dir, `${id}.webp`)))
            : [];
        return [biome, ids];
    }).filter(([, ids]) => ids.length);

    const body =
        '// AUTO-GENERATED by scripts/gen-sector-props.mjs — do not edit by hand.\n' +
        '//\n' +
        '// The scatter-prop ids present at public/sector-props/<biome>/<id>.webp, grouped\n' +
        '// by ambience-biome. <SectorScatter> only places props listed here, so a missing\n' +
        '// asset is simply skipped. Visual metadata (glow / base size) lives in the\n' +
        '// component (PROP_META), keyed by id.\n' +
        'export const SECTOR_PROP_IDS: Record<string, readonly string[]> = {\n' +
        entries.map(([b, ids]) => `    ${JSON.stringify(b)}: [${ids.map((i) => JSON.stringify(i)).join(', ')}],`).join('\n') +
        (entries.length ? '\n' : '') +
        '};\n';
    fs.writeFileSync(MANIFEST, body);
    console.log(`\nmanifest: ${entries.reduce((n, [, ids]) => n + ids.length, 0)} prop(s) → ${path.relative(CLIENT, MANIFEST)}`);
    console.log('next: npm run build, then commit public/sector-props + the manifest (+ dist for cPanel).');
}
main().catch((e) => { console.error(e); process.exit(1); });
