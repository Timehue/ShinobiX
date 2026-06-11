// Headless game-asset generator.
//
//   prompt ──▶ OpenAI gpt-image-1 ──▶ sharp (resize + WebP) ──▶ asset-gen-out/
//                                                          └──▶ (optional) POST /api/images
//
// This is the CLI twin of the in-app generator. It deliberately mirrors that
// flow so output looks identical to art made through the admin UI:
//   • the prompt style-wrapper matches vite.config.ts `api-generate-image`
//   • the WebP downscale matches lib/shared-images.ts `compressDataUrl`
//   • publishing matches lib/shared-images.ts `publishSharedImage` (POST /api/images)
//
// Run from shinobij.client/ (that's where `sharp` and the OpenAI key live):
//
//   node scripts/gen-asset.mjs --category pet --id 0007-emberfox \
//       --prompt "a nine-tailed ember fox spirit, crouched, glowing tails"
//
//   # full id form (category derived from the prefix):
//   node scripts/gen-asset.mjs --id jutsu:fireball --prompt "a roaring fireball jutsu emblem"
//
//   # smaller icon, wide background, custom quality:
//   node scripts/gen-asset.mjs --id item:kunai --prompt "a steel kunai" --max-px 256
//   node scripts/gen-asset.mjs --id event:festival:bg --prompt "a night festival" --gen-size 1536x1024
//   node scripts/gen-asset.mjs --id pet:0007 --prompt "..." --quality 70
//
//   # also publish to a running server (needs ADMIN_PASSWORD in env):
//   node scripts/gen-asset.mjs --id jutsu:fireball --prompt "..." --publish --server http://localhost:5173
//
//   # prompt verbatim (skip the shinobi style wrapper), or preview without spending credits:
//   node scripts/gen-asset.mjs --id misc:logo --prompt "..." --no-style
//   node scripts/gen-asset.mjs --id pet:0007 --prompt "..." --dry-run
//
// The OPENAI_API_KEY is read from the environment or shinobij.client/.env —
// the same key the dev-server generator already uses. Nothing new to wire up.

// `sharp` is imported lazily (inside the encode step) so --dry-run, arg
// validation, and the missing-key path all work without the native module —
// handy in a fresh git worktree where node_modules isn't installed yet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..'); // shinobij.client/

// Mirror of api/images.ts KNOWN_PREFIXES — which "<category>:" prefixes the
// shared art bucket understands. Anything else routes to "misc" server-side,
// so reject up front rather than silently mis-filing the asset.
const KNOWN_CATEGORIES = new Set([
    'avatar', 'pet', 'jutsu', 'item', 'card', 'event',
    'vn', 'ai', 'shrine', 'landmark', 'bloodline', 'leader', 'misc',
]);

// Per-category default for the final downscaled longest edge. Portraits get
// 512 (matches compressDataUrl's maxPx); flat icons render fine at 320 and
// shave bytes; scene backgrounds keep more detail. Override with --max-px.
const DEFAULT_MAX_PX = {
    avatar: 512, pet: 512, ai: 512, leader: 512, bloodline: 512, card: 512,
    jutsu: 320, item: 320, shrine: 384, landmark: 384,
    event: 1024, vn: 1024, misc: 512,
};

function parseArgs(argv) {
    const flags = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            // Boolean flags take no value.
            if (key === 'publish' || key === 'dry-run' || key === 'no-style') {
                flags[key] = true;
            } else {
                flags[key] = argv[++i];
            }
        } else {
            flags._.push(a);
        }
    }
    return flags;
}

// OPENAI_API_KEY from env, falling back to shinobij.client/.env — same
// resolution order as the dev-server plugin in vite.config.ts.
function resolveOpenAiKey() {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
    const dotenvPath = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(dotenvPath)) {
        for (const line of fs.readFileSync(dotenvPath, 'utf8').split('\n')) {
            const m = line.match(/^OPENAI_API_KEY\s*=\s*(.+)$/);
            if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

function resolveAdminPassword() {
    // ADMIN_PASSWORD env, or the ADMIN_PASSWORD line in shinobij.client/.env.
    if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD.trim();
    const dotenvPath = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(dotenvPath)) {
        for (const line of fs.readFileSync(dotenvPath, 'utf8').split('\n')) {
            const m = line.match(/^ADMIN_PASSWORD\s*=\s*(.+)$/);
            if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

// The same style wrapper the in-app generator applies, so CLI art matches the
// look of art authored through the admin panel. Skipped with --no-style.
function styleWrap(prompt, label) {
    return `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label}\n\nStyle rules:\n- original shinobi RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;
}

async function main() {
    const flags = parseArgs(process.argv.slice(2));

    // ── Resolve id + category ────────────────────────────────────────────
    let fullId = (flags.id || '').trim();
    let category = (flags.category || '').trim().toLowerCase();
    if (fullId.includes(':')) {
        category = fullId.slice(0, fullId.indexOf(':')).toLowerCase();
    } else if (category && fullId) {
        fullId = `${category}:${fullId}`;
    }

    if (!fullId || !fullId.includes(':')) {
        console.error('error: need an asset id. Use --id "<category>:<key>" or --category <cat> --id <key>.');
        process.exit(1);
    }
    if (!KNOWN_CATEGORIES.has(category)) {
        console.error(`error: unknown category "${category}". Known: ${[...KNOWN_CATEGORIES].join(', ')}.`);
        process.exit(1);
    }
    if (fullId.length > 256) {
        console.error('error: asset id exceeds the 256-char server cap.');
        process.exit(1);
    }

    const prompt = (flags.prompt || '').trim();
    if (!prompt) {
        console.error('error: --prompt is required.');
        process.exit(1);
    }

    const genSize = flags['gen-size'] || '1024x1024';
    if (!/^(1024x1024|1024x1536|1536x1024)$/.test(genSize)) {
        console.error('error: --gen-size must be 1024x1024, 1024x1536, or 1536x1024 (gpt-image-1 sizes).');
        process.exit(1);
    }
    const maxPx = Number(flags['max-px']) || DEFAULT_MAX_PX[category] || 512;
    const quality = Number(flags.quality) || 72;

    // ── Output path ──────────────────────────────────────────────────────
    const key = fullId.slice(fullId.indexOf(':') + 1);
    const safeKey = key.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const outDir = flags.out
        ? path.resolve(flags.out)
        : path.join(CLIENT_ROOT, 'asset-gen-out', category);
    const outFile = path.join(outDir, `${safeKey}.webp`);

    const finalPrompt = flags['no-style'] ? prompt : styleWrap(prompt, fullId);

    console.log(`asset:   ${fullId}`);
    console.log(`gen:     gpt-image-1 ${genSize} quality=low`);
    console.log(`encode:  WebP  max ${maxPx}px  q${quality}`);
    console.log(`out:     ${path.relative(CLIENT_ROOT, outFile)}`);
    if (flags['dry-run']) {
        console.log('\n--dry-run: stopping before any OpenAI call. Final prompt:\n');
        console.log(finalPrompt);
        return;
    }

    // ── Generate ─────────────────────────────────────────────────────────
    const apiKey = resolveOpenAiKey();
    if (!apiKey) {
        console.error('\nerror: OPENAI_API_KEY not found in env or shinobij.client/.env.');
        console.error('Add it from platform.openai.com (same login as ChatGPT, separate pay-as-you-go billing).');
        process.exit(1);
    }

    console.log('\ngenerating…');
    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: finalPrompt, size: genSize, quality: 'low', n: 1 }),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) {
        console.error(`error: OpenAI ${openaiRes.status}: ${data?.error?.message ?? 'image generation failed'}`);
        process.exitCode = 1;
        return;
    }
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
        console.error('error: OpenAI returned no image data.');
        process.exitCode = 1;
        return;
    }

    // ── Compress to WebP (the bandwidth-critical step) ───────────────────
    const sharp = (await import('sharp')).default;
    fs.mkdirSync(outDir, { recursive: true });
    const webp = await sharp(Buffer.from(b64, 'base64'))
        .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 6 })
        .toBuffer();
    fs.writeFileSync(outFile, webp);
    // Reproducibility sidecar: the exact prompt that produced this asset.
    fs.writeFileSync(outFile.replace(/\.webp$/, '.txt'), `${fullId}\n\n${prompt}\n`);
    console.log(`done:    ${(webp.length / 1024).toFixed(0)} KB  →  ${path.relative(CLIENT_ROOT, outFile)}`);

    // ── Optional publish ─────────────────────────────────────────────────
    if (flags.publish) {
        const server = (flags.server || 'http://localhost:5173').replace(/\/$/, '');
        const adminPw = resolveAdminPassword();
        if (!adminPw) {
            console.error('error: --publish needs ADMIN_PASSWORD (admin-owned categories are gated). Asset saved to disk only.');
            process.exit(1);
        }
        const dataUrl = `data:image/webp;base64,${webp.toString('base64')}`;
        const res = await fetch(`${server}/api/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
            body: JSON.stringify({ id: fullId, image: dataUrl }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            console.error(`error: publish failed (${res.status}): ${text.slice(0, 200)}`);
            process.exitCode = 1;
            return;
        }
        console.log(`publish: ok  →  ${server}/api/img?id=${encodeURIComponent(fullId)}`);
    } else {
        console.log(`\nreview the file, then publish via the admin panel or re-run with --publish.`);
        console.log(`served (once published) at:  /api/img?id=${fullId}`);
    }
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
});
