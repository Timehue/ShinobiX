// Batch-generate the Village-War Kage/elders UI art (terrain tiles, war-structure
// emblems, win-condition icons, and the war-map crest). Wraps gen-asset.mjs
// (OpenAI gpt-image-1) — same flags + key handling. Files land in asset-gen-out/;
// move the webps into src/assets/village-war/ and import them in VillageWarMap
// (bundled, like the merc portraits).
//
// Run from shinobij.client/ :
//   node scripts/gen-war-ui.mjs              # OpenAI, local files only
//   node scripts/gen-war-ui.mjs --dry-run    # preview the prompts (no spend)
//   node scripts/gen-war-ui.mjs --only terrain   # one group
//
// Needs OPENAI_API_KEY in env or shinobij.client/.env.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Painterly, top-down stylized game art — flat-ish icons/tiles that read at small
// sizes in the war UI. ids mirror the data keys (terrain/structure/win-condition).
const ASSETS = {
    terrain: [
        { id: 'war:terrain:forest',  prompt: 'a top-down stylized fantasy FOREST battlefield terrain tile, dense green canopy, dirt paths, soft painterly game-art, square tile' },
        { id: 'war:terrain:snow',    prompt: 'a top-down stylized fantasy SNOWFIELD battlefield terrain tile, white drifts, frozen rock, pale blue shadows, painterly game-art, square tile' },
        { id: 'war:terrain:volcano', prompt: 'a top-down stylized fantasy VOLCANIC battlefield terrain tile, black basalt, glowing lava cracks, drifting ash, painterly game-art, square tile' },
        { id: 'war:terrain:shadow',  prompt: 'a top-down stylized fantasy SHADOW-REALM battlefield terrain tile, dark purple mist, obsidian shards, faint glow, painterly game-art, square tile' },
        { id: 'war:terrain:central', prompt: 'a top-down stylized fantasy CENTRAL PLAINS battlefield terrain tile, trampled grass, packed earth roads, painterly game-art, square tile' },
    ],
    structure: [
        { id: 'war:structure:ramparts',      prompt: 'a fantasy STONE RAMPARTS fortified wall emblem icon, crenellated battlements, game UI badge, clean centered' },
        { id: 'war:structure:watchtower',    prompt: 'a fantasy WATCHTOWER emblem icon, tall stone tower with a beacon, game UI badge, clean centered' },
        { id: 'war:structure:barracks',      prompt: 'a fantasy BARRACKS training-hall emblem icon, crossed training weapons over a longhouse, game UI badge, clean centered' },
        { id: 'war:structure:warAcademy',    prompt: 'a fantasy WAR ACADEMY emblem icon, a crossed katana and an open scroll, game UI badge, clean centered' },
        { id: 'war:structure:supplyDepot',   prompt: 'a fantasy SUPPLY DEPOT storehouse emblem icon, stacked crates and barrels, game UI badge, clean centered' },
        { id: 'war:structure:treasuryVault', prompt: 'a fantasy TREASURY VAULT emblem icon, a heavy locked chest spilling gold coins, game UI badge, clean centered' },
    ],
    wincon: [
        { id: 'war:wincon:combat', prompt: 'a shinobi MELEE-COMBAT emblem icon, crossed kunai with a slash, bold game UI badge, clean centered' },
        { id: 'war:wincon:card',   prompt: 'a tactical CARD-BATTLE emblem icon, a fanned hand of three glowing cards, game UI badge, clean centered' },
        { id: 'war:wincon:pet',    prompt: 'a BEAST-COMPANION duel emblem icon, a fierce stylized elemental creature head, game UI badge, clean centered' },
    ],
    crest: [
        { id: 'war:crest', prompt: 'a shinobi VILLAGE WAR-MAP crest emblem, crossed war banners over a folded battle map, ornate gold trim, game UI, clean centered' },
    ],
};

const flags = {};
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--only') flags.only = process.argv[++i];
}

const groups = flags.only ? [flags.only] : Object.keys(ASSETS);
const list = groups.flatMap((g) => ASSETS[g] ?? []);
console.log(`Generating ${list.length} war-UI image(s) via OpenAI (gen-asset.mjs)…`);

let failed = 0;
for (const a of list) {
    // gen-asset only allows known categories, so namespace under misc: e.g.
    // war:terrain:forest → misc:war-terrain-forest.
    const assetId = 'misc:' + a.id.replace(/:/g, '-');
    console.log(`\n=== ${assetId} ===`);
    const args = [path.join(HERE, 'gen-asset.mjs'), '--id', assetId, '--prompt', a.prompt, '--max-px', '384'];
    if (flags.dryRun) args.push('--dry-run');
    const r = spawnSync('node', args, { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`failed: ${a.id}`); failed++; }
}
if (failed) { console.error(`\n${failed}/${list.length} image(s) failed.`); process.exitCode = 1; }
else console.log(`\nAll ${list.length} war-UI image(s) done${flags.dryRun ? ' (dry-run)' : ''}. Move asset-gen-out/*.webp into src/assets/village-war/.`);
