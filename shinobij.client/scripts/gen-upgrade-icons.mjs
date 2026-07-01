// Batch-generate emblem art for the Town-Hall VILLAGE UPGRADES (Training Grounds,
// Jutsu Training, Shop, Town Defense, Pet Yard, Bank, Mission Hall, Hospital) +
// the Hollow Gate unlock, so the Upgrades tab reads as a game instead of a row of
// emoji. Same style + pipeline as the war-structure emblems (gen-war-ui.mjs):
// wraps gen-asset.mjs (OpenAI gpt-image-1). Files land in asset-gen-out/misc/;
// move the webps into src/assets/village-upgrades/ and import them in TownHall.
//
// Run from shinobij.client/ (needs OPENAI_API_KEY in env or .env):
//   node scripts/gen-upgrade-icons.mjs
//   node scripts/gen-upgrade-icons.mjs --dry-run
//   node scripts/gen-upgrade-icons.mjs --only bank

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Painterly fantasy-shinobi building emblems on a clean dark ground, centered, that
// read at small sizes — matching the war-structure badge look. id = the upgrade key.
const STYLE = 'painterly fantasy shinobi game-UI emblem badge, centered, clean dark background, reads clearly at small icon size';
const ASSETS = [
    { id: 'training',     prompt: `a shinobi TRAINING GROUNDS building — a wooden sparring dojo with a striking post and a weapon rack out front, ${STYLE}` },
    { id: 'jutsuTraining', prompt: `a shinobi JUTSU LIBRARY study hall — a glowing open scroll and ink brush over a low study desk, arcane sigils, ${STYLE}` },
    { id: 'shop',         prompt: `a shinobi MARKET SHOP — a merchant stall with wares and a hanging noren curtain and a stack of coins, ${STYLE}` },
    { id: 'townDefense',  prompt: `a VILLAGE DEFENSE gatehouse — a fortified pagoda gate with a guard watchtower and banner, ${STYLE}` },
    { id: 'petYard',      prompt: `a PET YARD beast kennel — a fenced training yard with a paw sigil and a small fierce companion creature, ${STYLE}` },
    { id: 'bank',         prompt: `a shinobi BANK treasury house — a solid stone vault building with a gold coin sigil over the door, ${STYLE}` },
    { id: 'missionHall',  prompt: `a MISSION HALL — a wooden mission board with pinned request scrolls and a lit paper lantern, ${STYLE}` },
    { id: 'hospital',     prompt: `a shinobi HOSPITAL medic hall — a healing pavilion with a green medical-cross sigil and bundled herbs, ${STYLE}` },
    { id: 'hollowGate',   prompt: `a forbidden HOLLOW GATE — a chained stone torii gate glowing with cursed red seals in shadow, ominous, ${STYLE}` },
];

const flags = {};
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--only') flags.only = process.argv[++i];
}

const list = flags.only ? ASSETS.filter((a) => a.id === flags.only) : ASSETS;
console.log(`Generating ${list.length} upgrade emblem(s) via OpenAI (gen-asset.mjs)…`);

let failed = 0;
for (const a of list) {
    // gen-asset only allows known categories → namespace under misc: e.g.
    // training → misc:upgrade-training.
    const assetId = 'misc:upgrade-' + a.id;
    console.log(`\n=== ${assetId} ===`);
    const args = [path.join(HERE, 'gen-asset.mjs'), '--id', assetId, '--prompt', a.prompt, '--max-px', '384'];
    if (flags.dryRun) args.push('--dry-run');
    const r = spawnSync('node', args, { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`failed: ${a.id}`); failed++; }
}
if (failed) { console.error(`\n${failed}/${list.length} emblem(s) failed.`); process.exitCode = 1; }
else console.log(`\nAll ${list.length} emblem(s) done${flags.dryRun ? ' (dry-run)' : ''}. Move asset-gen-out/misc/*.webp into src/assets/village-upgrades/.`);
