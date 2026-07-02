// Batch art generator for the 20 "Increase Generals" starter jutsu.
//
// Reuses the vetted single-asset CLI (scripts/gen-asset.mjs → OpenAI gpt-image-1
// → sharp WebP → asset-gen-out/jutsu/<id>.webp). Each jutsu's art is resolved in
// game by the `jutsu:<id>` convention (sharedImages['jutsu:'+id], see
// PvpBattleScreen.tsx / BattleTowerFight.tsx), so nothing in data/jutsu.ts needs
// to change — generate, then publish under the same id.
//
// Run from shinobij.client/ (where sharp + the OPENAI_API_KEY live):
//
//   # preview every prompt, spend nothing:
//   node scripts/gen-generals-art.mjs --dry-run
//
//   # generate all 20 to asset-gen-out/jutsu/ (low quality ≈ a cent each):
//   node scripts/gen-generals-art.mjs
//
//   # generate AND publish to a running server (needs ADMIN_PASSWORD in env/.env):
//   node scripts/gen-generals-art.mjs --publish --server http://localhost:5173
//
// Any extra flags (--gen-quality medium, --transparent, --dry-run, --publish,
// --server, --max-px, …) are forwarded verbatim to gen-asset.mjs for every jutsu.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEN_ASSET = path.join(HERE, 'gen-asset.mjs');

// id (without the "jutsu:" prefix) → subject prompt. The gen-asset style wrapper
// adds the shinobi-RPG look, "no text/logos/UI", dramatic lighting — so these
// describe only the subject. Each matches the jutsu's flavor in data/jutsu.ts.
const JUTSU = [
    ['starter-nin-earth-4',      'a shinobi kneeling with fists pressed to the ground, brown-gold earthen chakra rising around them in a grounding power-up aura, cracked stone and floating rock shards'],
    ['starter-nin-wind-4',       'a shinobi standing with arms open as swirling pale-green wind chakra spirals up around them in a soaring power-up aura, leaves caught in the gust'],
    ['starter-nin-lightning-4',  'a shinobi crouched low with electric blue-white lightning coursing over their whole body in a crackling power-up aura, sparks arcing outward'],
    ['starter-nin-fire-4',       'a shinobi with a glowing ember at their chest, warm orange fire chakra kindling up around them in a power-up aura, floating embers'],
    ['starter-nin-water-4',      'a shinobi with palms pressed together as clear blue water chakra swirls upward around them in a renewing power-up aura, rising droplets'],
    ['starter-tai-earth-4',      'a muscular shinobi in a firm braced stance, stone-grey earthen aura hardening over their skin like armor, dust and rubble'],
    ['starter-tai-wind-4',       'a shinobi rising onto the balls of their feet, light-green wind aura lifting around them, poised and weightless'],
    ['starter-tai-lightning-4',  'a shinobi flexing as violet-white lightning surges through their muscles in an overdrive power-up aura, thunder sparks'],
    ['starter-tai-fire-4',       'a shinobi with clenched fists wreathed in blazing orange-red fire aura, burning spirit, streaming embers'],
    ['starter-tai-water-4',      'a shinobi in a graceful flowing pose, serene blue water chi swirling around them in balanced harmony, gentle ripples'],
    ['starter-gen-earth-4',      'a shinobi seated in deep meditation, muted brown-grey earthen chakra settling around them, still and fortified, floating stones'],
    ['starter-gen-wind-4',       'a shinobi with eyes closed in a whispering-calm trance, soft pale wind wisps circling their head, serene focus'],
    ['starter-gen-lightning-4',  'a shinobi with faintly glowing eyes, crackling blue lightning arcing around their head in a storm-mind focus aura, electric sparks'],
    ['starter-gen-fire-4',       'a shinobi with an inner flame reflected in their eyes, warm firelight aura around them, illusory drifting embers'],
    ['starter-gen-water-4',      'a shinobi calm as a still lake, faint mirror-smooth blue water aura around them, a single ripple, tranquil focus'],
    ['starter-buki-earth-4',     'an armed shinobi planting an adamant stance with weapon ready, earthen brown aura hardening around them, kicked-up dust'],
    ['starter-buki-wind-4',      'an armed shinobi with a blade trailing pale-green wind, poised in a swift attunement power-up aura, motion streaks'],
    ['starter-buki-lightning-4', 'an armed shinobi gripping a weapon crackling with blue lightning, charged focus aura, electric arcs'],
    ['starter-buki-fire-4',      'an armed shinobi holding a weapon glowing forge-hot orange, fiery tempering aura around them, sparks'],
    ['starter-buki-water-4',     'an armed shinobi with a water-wreathed blade, rippling blue aura swirling around them in a refining ritual, droplets'],
];

const passthrough = process.argv.slice(2); // --dry-run / --publish / --gen-quality / …
let ok = 0;
let failed = 0;

for (const [id, prompt] of JUTSU) {
    console.log(`\n──────── jutsu:${id} ────────`);
    const res = spawnSync(
        process.execPath,
        [GEN_ASSET, '--id', `jutsu:${id}`, '--prompt', prompt, ...passthrough],
        { stdio: 'inherit' },
    );
    if (res.status === 0) ok++;
    else { failed++; console.error(`!! jutsu:${id} failed (exit ${res.status})`); }
}

console.log(`\n════════ done: ${ok} ok, ${failed} failed of ${JUTSU.length} ════════`);
if (failed) process.exitCode = 1;
