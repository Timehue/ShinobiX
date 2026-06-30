// Batch-generate the 5 Village-War mercenary tier portraits (Phase 5).
//
// Wraps gen-asset.mjs (OpenAI gpt-image-1) OR gen-asset-fal.mjs (fal FLUX) — pick
// with --provider. Each tier publishes to `ai:merc-<tier>`, which the merc
// fighters reference for their portrait (sharedImages['ai:merc-<tier>']).
//
// Run from shinobij.client/ :
//
//   node scripts/gen-merc-portraits.mjs                       # OpenAI, local files only
//   node scripts/gen-merc-portraits.mjs --provider fal        # fal FLUX instead
//   node scripts/gen-merc-portraits.mjs --dry-run             # preview the prompts (no spend)
//   node scripts/gen-merc-portraits.mjs --publish --server https://shinobijourney.com
//   node scripts/gen-merc-portraits.mjs --provider fal --model fal-ai/flux-pro/v1.1 --publish --server <url>
//
// Needs OPENAI_API_KEY (openai) or FAL_KEY (fal), plus ADMIN_PASSWORD for --publish,
// in shinobij.client/.env — exactly like the underlying gen scripts.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The 5 WR-merc tiers (ids mirror api/_war-economy.ts WR_MERC_TIERS). Prompts are
// peak-tier character portraits, ascending in menace 75 → 100.
const MERCS = [
    { id: 'merc-ronin', prompt: 'A masterless rōnin swordsman mercenary, weathered lamellar armor over dark travel clothes, a single notched katana held low, topknot and stubble, sharp world-weary eyes, calm deadly fighting stance' },
    { id: 'merc-reaver', prompt: 'A brutal border-reaver mercenary, torn fur-and-leather armor with iron studs, a heavy chained naginata, a scarred snarling face with red war-paint, braced mid-charge, fierce and wild' },
    { id: 'merc-shadow', prompt: 'A silent shadow-blade mercenary assassin, fitted matte-black wrappings and a half-hood, twin reverse-grip tantō, cold glinting eyes, body half-dissolving into drifting shadow, poised to strike' },
    { id: 'merc-oni', prompt: 'A towering oni mercenary, lacquered black-and-crimson plate armor, a massive iron kanabō war-club over one shoulder, glowing eyes behind a horned demon mask, radiating a menacing battle aura' },
    { id: 'merc-warlord', prompt: 'A legendary mercenary warlord, ornate gold-and-crimson general’s armor with a tattered war-banner at the back, a battle-scarred veteran face, commanding stance and absolute authority, embers drifting around' },
];

function parseArgs(argv) {
    const flags = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            if (key === 'publish' || key === 'dry-run') flags[key] = true;
            else flags[key] = argv[++i];
        } else flags._.push(a);
    }
    return flags;
}

const flags = parseArgs(process.argv.slice(2));
const provider = (flags.provider || 'openai').toLowerCase();
if (provider !== 'openai' && provider !== 'fal') {
    console.error('error: --provider must be "openai" or "fal".');
    process.exit(1);
}
const script = provider === 'fal' ? 'gen-asset-fal.mjs' : 'gen-asset.mjs';

// Forward the flags each underlying script understands.
const passthrough = [];
if (flags.publish) passthrough.push('--publish');
if (flags.server) passthrough.push('--server', flags.server);
if (flags['dry-run']) passthrough.push('--dry-run');
if (flags['gen-quality'] && provider === 'openai') passthrough.push('--gen-quality', flags['gen-quality']);
if (flags.model && provider === 'fal') passthrough.push('--model', flags.model);
if (flags['image-size'] && provider === 'fal') passthrough.push('--image-size', flags['image-size']);

console.log(`Generating ${MERCS.length} merc portraits via ${provider} (${script})…`);
let failed = 0;
for (const m of MERCS) {
    console.log(`\n=== ai:${m.id} ===`);
    const r = spawnSync('node', [path.join(HERE, script), '--id', `ai:${m.id}`, '--prompt', m.prompt, ...passthrough], { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`failed: ${m.id}`); failed++; }
}
if (failed) {
    console.error(`\n${failed}/${MERCS.length} portrait(s) failed.`);
    process.exitCode = 1;
} else {
    console.log(`\nAll ${MERCS.length} merc portraits done${flags['dry-run'] ? ' (dry-run)' : ''}.`);
}
