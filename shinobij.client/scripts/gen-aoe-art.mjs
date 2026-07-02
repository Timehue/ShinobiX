// Batch art generator for the 20 "AOE Burst" starter jutsu.
//
// Reuses the vetted single-asset CLI (scripts/gen-asset.mjs → OpenAI gpt-image-1
// → sharp WebP → asset-gen-out/jutsu/<id>.webp). Each jutsu's art resolves in game
// by the `jutsu:<id>` convention (sharedImages['jutsu:'+id]), so nothing in
// data/jutsu.ts needs the image — generate, then publish under the same id.
//
// Run from shinobij.client/ (where sharp + the OPENAI_API_KEY live):
//   node scripts/gen-aoe-art.mjs --dry-run                 # preview prompts, spend nothing
//   node scripts/gen-aoe-art.mjs                           # generate all 20 to disk
//   node scripts/gen-aoe-art.mjs --publish --server https://shinobijourney.com
//
// Extra flags (--gen-quality, --transparent, --dry-run, --publish, --server, …)
// are forwarded verbatim to gen-asset.mjs for every jutsu.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEN_ASSET = path.join(HERE, 'gen-asset.mjs');

// id (without "jutsu:" prefix) → subject prompt. The gen-asset style wrapper adds
// the shinobi-RPG look. Each describes an AREA burst matching the jutsu's flavor.
const JUTSU = [
    ['starter-nin-earth-aoe',      'a shinobi slamming the ground as a shattering ring of jagged rock and dust erupts outward in a wide seismic blast'],
    ['starter-nin-wind-aoe',       'a shinobi unleashing a compressed sphere of air that implodes and detonates in a wide concussive shockwave of swirling wind'],
    ['starter-nin-lightning-aoe',  'a shinobi releasing forked blue-white lightning that branches and erupts across a wide area in a crackling nova'],
    ['starter-nin-fire-aoe',       'a shinobi exhaling a massive fireball that detonates into a wide roaring ring of orange flame and embers'],
    ['starter-nin-water-aoe',      'a shinobi summoning a towering wave that crashes down and bursts outward in a wide violent flood of water'],
    ['starter-tai-earth-aoe',      'a shinobi stomping the ground and splitting the earth in a radiating shockwave of stone and cracks'],
    ['starter-tai-wind-aoe',       'a shinobi spinning into a wide whirlwind of pale-green wind that batters everything around them'],
    ['starter-tai-lightning-aoe',  'a shinobi clapping their hands to release a violet-white lightning shockwave bursting outward across the field'],
    ['starter-tai-fire-aoe',       'a shinobi delivering a spinning kick that trails a wide scorching arc of orange fire'],
    ['starter-tai-water-aoe',      'a shinobi thrusting a palm to hurl a crashing wave of water bursting outward in a wide arc'],
    ['starter-gen-earth-aoe',      'an eerie illusion of a crumbling, collapsing earthen world — cracked ground and floating debris swallowing the scene'],
    ['starter-gen-wind-aoe',       'an eerie illusion of a howling pale wind void tearing open, screaming spirals of air across a wide area'],
    ['starter-gen-lightning-aoe',  'a blinding sheet of white-blue illusory light detonating across a wide field, searing and disorienting'],
    ['starter-gen-fire-aoe',       'an eerie illusion of all-consuming phantom hellfire erupting in a wide inferno of orange flame'],
    ['starter-gen-water-aoe',      'an eerie illusion of a crushing dark-blue tide flooding and dragging everything under in a wide drowning wave'],
    ['starter-buki-earth-aoe',     'an armed shinobi as a packed charge bursts into a wide hail of flying stone shrapnel'],
    ['starter-buki-wind-aoe',      'an armed shinobi unleashing a wide storm of spinning wind-borne blades fanning out across the field'],
    ['starter-buki-lightning-aoe', 'an armed shinobi throwing a wide fan of electrified, crackling shuriken scattering across the field'],
    ['starter-buki-fire-aoe',      'an armed shinobi as a barrage of explosive paper tags detonates in a wide chain of fiery blasts'],
    ['starter-buki-water-aoe',     'an armed shinobi sweeping a wide torrent of mist-wreathed water blades across the field'],
];

const passthrough = process.argv.slice(2);
let ok = 0;
let failed = 0;
for (const [id, prompt] of JUTSU) {
    console.log(`\n──────── jutsu:${id} ────────`);
    const res = spawnSync(process.execPath, [GEN_ASSET, '--id', `jutsu:${id}`, '--prompt', prompt, ...passthrough], { stdio: 'inherit' });
    if (res.status === 0) ok++;
    else { failed++; console.error(`!! jutsu:${id} failed (exit ${res.status})`); }
}
console.log(`\n════════ done: ${ok} ok, ${failed} failed of ${JUTSU.length} ════════`);
if (failed) process.exitCode = 1;
