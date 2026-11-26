// Prepare the deploy smoke read's portrait (scripts/deploy-avatar-worker.ps1): write it as a PNG and print the
// frame hash the game server would send for it, computed by the server's own moderatedFrame(). The worker checks
// that hash against its own decode, so the smoke read also proves the two sides still agree.
//   node --import tsx scripts/avatar-worker-smoke-frame.ts <source image> <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { moderatedFrame } from '../api/avatar-model/_read-provider.js';

async function main() {
    const [source, out] = process.argv.slice(2);
    if (!source || !out) throw new Error('usage: avatar-worker-smoke-frame.ts <source image> <out.png>');
    const png = await sharp(readFileSync(source)).png().toBuffer();
    const prepared = await moderatedFrame(png);
    if (!prepared) throw new Error('The smoke portrait is not an image the game takes');
    writeFileSync(out, png);
    console.log(prepared.frameHash);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
