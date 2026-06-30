// Headless game-asset generator — fal.ai (FLUX) twin of gen-asset.mjs.
//
//   prompt ──▶ fal.ai FLUX ──▶ sharp (resize + WebP) ──▶ asset-gen-out/
//                                                    └──▶ (optional) POST /api/images
//
// Same flow, output shape, style wrapper, downscale, and publish path as
// gen-asset.mjs — only the image backend differs (fal's REST API instead of
// OpenAI gpt-image-1), so art from either tool drops into the SAME shared:img:<id>
// bucket and renders identically in game. Uses fal's plain REST endpoint via
// fetch — no @fal-ai SDK dependency to install.
//
// Run from shinobij.client/ (that's where `sharp` + the .env key live):
//
//   node scripts/gen-asset-fal.mjs --id ai:merc-ronin \
//       --prompt "a masterless wandering swordsman mercenary, weathered armor"
//
//   # higher-quality model, portrait crop, publish to a running server:
//   node scripts/gen-asset-fal.mjs --id ai:merc-oni --prompt "..." \
//       --model fal-ai/flux-pro/v1.1 --image-size portrait_4_3 --publish --server http://localhost:5173
//
//   # preview the resolved prompt without spending credits:
//   node scripts/gen-asset-fal.mjs --id ai:merc-ronin --prompt "..." --dry-run
//
// FAL_KEY is read from the environment or shinobij.client/.env (get one at
// fal.ai/dashboard/keys). ADMIN_PASSWORD (for --publish) resolves the same way.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..'); // shinobij.client/

// Mirror of gen-asset.mjs / api/images.ts KNOWN_PREFIXES.
const KNOWN_CATEGORIES = new Set([
    'avatar', 'pet', 'jutsu', 'item', 'card', 'event',
    'vn', 'ai', 'shrine', 'landmark', 'bloodline', 'leader', 'misc',
]);

const DEFAULT_MAX_PX = {
    avatar: 512, pet: 512, ai: 512, leader: 512, bloodline: 512, card: 512,
    jutsu: 320, item: 320, shrine: 384, landmark: 384,
    event: 1024, vn: 1024, misc: 512,
};

// fal's named aspect presets + our gpt-style WxH strings, both accepted by --image-size.
const FAL_NAMED_SIZES = new Set([
    'square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9',
]);

function parseArgs(argv) {
    const flags = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
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

// FAL_KEY from env, falling back to shinobij.client/.env (same shape as the
// OPENAI_API_KEY resolution in gen-asset.mjs).
function resolveEnvKey(name) {
    if (process.env[name]) return process.env[name].trim();
    const dotenvPath = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(dotenvPath)) {
        const re = new RegExp(`^${name}\\s*=\\s*(.+)$`);
        for (const line of fs.readFileSync(dotenvPath, 'utf8').split('\n')) {
            const m = line.match(re);
            if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

function styleWrap(prompt, label) {
    return `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label}\n\nStyle rules:\n- original shinobi RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;
}

// Map --image-size to fal's `image_size` param: a named preset string, or a
// {width,height} object parsed from a "WxH" string (gpt-style, for convenience).
function resolveImageSize(arg) {
    const v = (arg || 'square_hd').trim();
    if (FAL_NAMED_SIZES.has(v)) return v;
    const m = v.match(/^(\d{3,4})x(\d{3,4})$/);
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
    return null; // invalid
}

async function main() {
    const flags = parseArgs(process.argv.slice(2));

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

    const model = (flags.model || 'fal-ai/flux/dev').trim();
    const imageSize = resolveImageSize(flags['image-size']);
    if (!imageSize) {
        console.error(`error: --image-size must be a fal preset (${[...FAL_NAMED_SIZES].join(', ')}) or WxH (e.g. 1024x1024).`);
        process.exit(1);
    }
    const maxPx = Number(flags['max-px']) || DEFAULT_MAX_PX[category] || 512;
    const quality = Number(flags.quality) || 72;

    const key = fullId.slice(fullId.indexOf(':') + 1);
    const safeKey = key.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const outDir = flags.out ? path.resolve(flags.out) : path.join(CLIENT_ROOT, 'asset-gen-out', category);
    const outFile = path.join(outDir, `${safeKey}.webp`);

    const finalPrompt = flags['no-style'] ? prompt : styleWrap(prompt, fullId);

    console.log(`asset:   ${fullId}`);
    console.log(`gen:     fal ${model}  ${typeof imageSize === 'string' ? imageSize : `${imageSize.width}x${imageSize.height}`}`);
    console.log(`encode:  WebP  max ${maxPx}px  q${quality}`);
    console.log(`out:     ${path.relative(CLIENT_ROOT, outFile)}`);
    if (flags['dry-run']) {
        console.log('\n--dry-run: stopping before any fal call. Final prompt:\n');
        console.log(finalPrompt);
        return;
    }

    const falKey = resolveEnvKey('FAL_KEY');
    if (!falKey) {
        console.error('\nerror: FAL_KEY not found in env or shinobij.client/.env.');
        console.error('Create one at fal.ai/dashboard/keys (pay-as-you-go).');
        process.exit(1);
    }

    console.log('\ngenerating…');
    // fal's synchronous REST endpoint: POST https://fal.run/<model> returns the
    // result inline (image URLs) for fast models like FLUX.
    const falRes = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt, image_size: imageSize, num_images: 1 }),
    });
    const data = await falRes.json().catch(() => ({}));
    if (!falRes.ok) {
        console.error(`error: fal ${falRes.status}: ${data?.detail ?? data?.error ?? 'image generation failed'}`);
        process.exitCode = 1;
        return;
    }
    const url = data?.images?.[0]?.url;
    if (!url) {
        console.error('error: fal returned no image url.');
        process.exitCode = 1;
        return;
    }
    // fal returns a URL (or a data: URL) — fetch the bytes for the encode step.
    const imgRes = await fetch(url);
    if (!imgRes.ok) {
        console.error(`error: could not fetch fal image (${imgRes.status}).`);
        process.exitCode = 1;
        return;
    }
    const srcBuf = Buffer.from(await imgRes.arrayBuffer());

    const sharp = (await import('sharp')).default;
    fs.mkdirSync(outDir, { recursive: true });
    const webp = await sharp(srcBuf)
        .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 6 })
        .toBuffer();
    fs.writeFileSync(outFile, webp);
    fs.writeFileSync(outFile.replace(/\.webp$/, '.txt'), `${fullId}\n\n${prompt}\n`);
    console.log(`done:    ${(webp.length / 1024).toFixed(0)} KB  →  ${path.relative(CLIENT_ROOT, outFile)}`);

    if (flags.publish) {
        const server = (flags.server || 'http://localhost:5173').replace(/\/$/, '');
        const adminPw = resolveEnvKey('ADMIN_PASSWORD');
        if (!adminPw) {
            console.error('error: --publish needs ADMIN_PASSWORD. Asset saved to disk only.');
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
