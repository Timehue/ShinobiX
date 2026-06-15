// Sector foreground prop-band generator (OpenAI gpt-image-1, transparent PNG).
//
//   prompt ──▶ gpt-image-1 (transparent) ──▶ sharp (WebP w/ alpha) ──▶ public/sector-foreground/<biome>.webp
//
// <SectorForeground> composites one of these transparent bands over each sector
// so the near-camera foliage parallaxes against the painted backdrop as you walk
// — the "patrolling THROUGH the biome" depth cue. One band per AMBIENCE biome
// (see ambienceBiomeForSector in screens/WorldMap.tsx): snow / volcano / shadow /
// forest / central.
//
//   node scripts/gen-sector-foreground.mjs                 # all biomes
//   node scripts/gen-sector-foreground.mjs --only forest   # a subset
//   node scripts/gen-sector-foreground.mjs --quality medium # gen cost knob (low|medium|high)
//   node scripts/gen-sector-foreground.mjs --dry-run        # print prompts, spend nothing
//
// OPENAI_API_KEY is read from env or shinobij.client/.env (same as gen-asset.mjs).
// Writes public/sector-foreground/<biome>.webp and rewrites
// src/data/sector-foreground-manifest.ts. Then rebuild the client + commit the
// webps, the manifest (+ dist for cPanel).
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

// One painterly foreground border per ambience-biome. These are THIN bottom
// strips — foliage/prop tips poking up from just off-screen below — NOT full
// scenes, so the band frames the very bottom edge without burying the avatar or
// the lower tiles. The SUFFIX hard-constrains the foliage to the bottom ~18% and
// forces transparency everywhere above it.
const SUFFIX = ' The plants and props are clustered ONLY along the very bottom edge, reaching up into just the bottom 18 percent of the image like foliage poking into frame from off-screen below.' +
    ' The entire upper 82 percent of the image is completely empty and fully transparent.' +
    ' Painterly anime fantasy RPG style, dark semi-translucent silhouette shapes with subtle rim light, soft depth-of-field blur.' +
    ' Transparent background. No characters, no people, no creatures, no full trees, no sky, no horizon, no solid ground plane, no text, no logo, no watermark, no UI.' +
    ' Clean anti-aliased edges suitable for compositing as a thin near-camera foreground border strip in a game.';

const PROMPTS = {
    snow:    'A thin horizontal border of frosted grass blades, small snow-laden fern tips and slender icicle reeds poking up along the very bottom edge, cool blue-white tones with soft sparkle.',
    volcano: 'A thin horizontal border of charred grass, jagged little obsidian shards and small ember-lit thorn tips poking up along the very bottom edge, dark silhouettes with hot orange rim glow and drifting embers.',
    shadow:  'A thin horizontal border of tall dark grass blades and low cherry-branch tips with a few drifting pink sakura petals poking up along the very bottom edge, moody purple-indigo twilight tones.',
    forest:  'A thin horizontal border of tall grass blades, fern fronds and broad leaf tips poking up along the very bottom edge, dewy vibrant green tones with dappled light.',
    central: 'A thin horizontal border of manicured grass tufts, slender reeds and the carved top edge of a pale-stone railing poking up along the very bottom edge, warm golden lantern glow.',
};

const OUT_DIR = path.join(CLIENT, 'public', 'sector-foreground');
const MANIFEST = path.join(CLIENT, 'src', 'data', 'sector-foreground-manifest.ts');
const GEN_SIZE = '1536x1024';
const MAX_PX = parseInt(arg('max-px', '1024'), 10);
const QUALITY = arg('quality', 'high'); // gpt-image-1 gen quality: low | medium | high
const WEBP_Q = parseInt(arg('webp-q', '78'), 10);
const only = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const dryRun = flag('dry-run');

async function genOne(biome, apiKey, sharp) {
    const prompt = PROMPTS[biome] + SUFFIX;
    if (dryRun) { console.log(`\n[${biome}] prompt:\n${prompt}\n`); return false; }
    console.log(`foreground: ${biome}  (gpt-image-1 ${GEN_SIZE} quality=${QUALITY}, transparent)`);
    const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-image-1', prompt, size: GEN_SIZE, quality: QUALITY, n: 1,
            background: 'transparent', output_format: 'png',
        }),
    });
    const data = await res.json();
    if (!res.ok) { console.error(`  OpenAI ${res.status}: ${data?.error?.message ?? 'image generation failed'}`); return false; }
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) { console.error('  no image data returned'); return false; }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, `${biome}.webp`);
    const webp = await sharp(Buffer.from(b64, 'base64'))
        .resize({ width: MAX_PX, withoutEnlargement: true })
        .webp({ quality: WEBP_Q, effort: 6, alphaQuality: 90 })
        .toBuffer();
    fs.writeFileSync(outFile, webp);
    console.log(`  → public/sector-foreground/${biome}.webp (${(webp.length / 1024).toFixed(0)} KB)`);
    return true;
}

async function main() {
    const biomes = Object.keys(PROMPTS).filter((b) => only.length === 0 || only.includes(b));
    if (dryRun) { for (const b of biomes) await genOne(b, '', null); return; }

    const apiKey = envKey('OPENAI_API_KEY');
    if (!apiKey) { console.error('no OPENAI_API_KEY (set it in env or shinobij.client/.env)'); process.exit(1); }
    const sharp = (await import('sharp')).default;

    for (const biome of biomes) {
        try { await genOne(biome, apiKey, sharp); }
        catch (e) { console.error(`  ${biome} failed:`, e?.message || e); }
    }

    // Rewrite the manifest from whatever bands now exist on disk (resumable/safe).
    const present = Object.keys(PROMPTS).filter((b) => fs.existsSync(path.join(OUT_DIR, `${b}.webp`)));
    const body =
        '// AUTO-GENERATED by scripts/gen-sector-foreground.mjs — do not edit by hand.\n' +
        '//\n' +
        '// The ambience-biomes (see ambienceBiomeForSector in screens/WorldMap.tsx) that\n' +
        '// have a baked foreground prop band at public/sector-foreground/<biome>.webp.\n' +
        '// <SectorForeground> only renders for biomes listed here, so a missing asset is\n' +
        '// a no-op rather than a broken <img>.\n' +
        'export const SECTOR_FOREGROUND_BIOMES: ReadonlySet<string> = new Set<string>([\n' +
        present.map((b) => `    ${JSON.stringify(b)},`).join('\n') +
        (present.length ? '\n' : '') +
        ']);\n';
    fs.writeFileSync(MANIFEST, body);
    console.log(`manifest: ${present.length} biome(s) → ${path.relative(CLIENT, MANIFEST)}`);
    console.log('next: npm run build, then commit public/sector-foreground + the manifest (+ dist for cPanel).');
}
main().catch((e) => { console.error(e); process.exit(1); });
