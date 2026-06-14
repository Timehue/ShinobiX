// Pet 3D-MODEL generator (fal.ai Hunyuan3D image-to-3D).
//
//   pet full-body sprite ──▶ fal-ai/hunyuan3d/v2 ──▶ a textured .glb mesh
//
// Produces the rotatable 3D model used by the evolution cutscene's "full 360°
// turntable" beat (and any future r3f hero shots). The cutscene works WITHOUT a
// model (CSS card-spin fallback); a generated .glb upgrades that beat to a true
// volumetric turntable. Drop the output in public/pet-models/<id>.glb and load
// it with drei's useGLTF.
//
//   node scripts/gen-pet-3d.mjs --id starter-fire-l
//   node scripts/gen-pet-3d.mjs --id starter-fire-l --src asset-gen-out/petbody/starter-fire-l.webp
//   node scripts/gen-pet-3d.mjs --id starter-fire-l --white   # cheaper, untextured
//
// Cost (fal, approx): ~$0.16 white mesh, ~$0.48 textured. FAL_KEY is read from
// env or shinobij.client/.env (same place OPENAI_API_KEY / the pose scripts live).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
function flag(name) { return process.argv.includes('--' + name); }

function resolveFalKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    const p = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(p)) {
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
            const m = line.match(/^FAL_KEY\s*=\s*(.+)$/);
            if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

async function main() {
    const id = arg('id');
    if (!id) { console.error('need --id <petId> (e.g. starter-fire-l)'); process.exit(1); }
    const src = arg('src', path.join(CLIENT_ROOT, 'asset-gen-out', 'petbody', `${id}.webp`));
    if (!fs.existsSync(src)) { console.error(`source sprite not found: ${src}\n(generate the full-body sprite first, e.g. gen-asset.mjs --id petbody:${id})`); process.exit(1); }
    const textured = !flag('white');
    const outDir = path.join(CLIENT_ROOT, 'public', 'pet-models');
    fs.mkdirSync(outDir, { recursive: true });

    const key = resolveFalKey();
    if (!key) { console.error('FAL_KEY not found in env or .env'); process.exit(1); }

    const bytes = fs.readFileSync(src);
    const ext = path.extname(src).slice(1) || 'webp';
    const dataUri = `data:image/${ext};base64,${bytes.toString('base64')}`;
    console.log(`pet:    ${id}  (${(bytes.length / 1024).toFixed(0)} KB ref)`);
    console.log(`model:  fal-ai/hunyuan3d/v2  → ${textured ? 'textured' : 'white'} .glb`);
    console.log('generating… (image-to-3D takes ~30-60s)');

    const res = await fetch('https://fal.run/fal-ai/hunyuan3d/v2', {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            input_image_url: dataUri,
            textured_mesh: textured,
        }),
    });
    if (!res.ok) {
        console.error(`fal error ${res.status}:`, (await res.text()).slice(0, 600));
        process.exit(1);
    }
    const json = await res.json();
    // fal returns the mesh as a File; field name has been model_mesh across v2.
    const url = json?.model_mesh?.url || json?.model_glb?.url || json?.mesh?.url;
    if (!url) { console.error('no model in response:', JSON.stringify(json).slice(0, 600)); process.exit(1); }

    let outBytes;
    if (url.startsWith('data:')) {
        outBytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    } else {
        const dl = await fetch(url);
        outBytes = Buffer.from(await dl.arrayBuffer());
    }
    const outFile = path.join(outDir, `${id}.glb`);
    fs.writeFileSync(outFile, outBytes);
    console.log(`done:   ${(outBytes.length / 1024).toFixed(0)} KB  → ${path.relative(CLIENT_ROOT, outFile)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
