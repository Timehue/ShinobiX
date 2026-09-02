// One-off generator for Echoes of War art: 10 opponent portraits +
// 4 floor-band VN backdrops, written straight into public/ (repo-committed
// fixed assets, same as the rift and story art). Idempotent: existing files
// are skipped, so a partial run can simply be re-run.
//
//   OPENAI_API_KEY=... node scripts/gen-echoes-art.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
    console.error('OPENAI_API_KEY is required (read it from the main checkout .env).');
    process.exit(1);
}

const STYLE = 'Polished 2D anime shinobi RPG game asset, painted illustration, dramatic lighting, family-friendly, no text, no logos, no watermark, no UI.';
const PORTRAIT = 'Waist-up portrait, single centered character, the face clearly lit and detailed, muted environmental background.';

const PORTRAITS = [
    ['tovin', 'An old bell keeper, a weathered man in his sixties with grey stubble and tired hopeful eyes, plain dust-brown keeper robes, holding up a length of old rope whose top is cleanly cut, warm dusty golden light, a stone bell tower landing behind him.'],
    ['vetta', 'A sharp-eyed grain merchant woman in her fifties, headscarf and flour-dusted trader apron, holding a small brass balance scale, shrewd guarded expression, sacks of grey dusty grain behind her, warm lamplight.'],
    ['aya', 'A young courier woman with short dark hair and quick restless eyes, road-worn leather running gear, a worn message satchel strap across her chest, lean and fast-looking, dusty stone landing behind, cool morning light.'],
    ['ansel', 'A neat middle-aged ledger clerk, thin man with small round spectacles and ink-stained fingers, precise posture, holding a thick ledger against his chest, pigeonhole record shelves behind him, candlelight.'],
    ['sela', 'A composed older healer woman with silver-streaked hair tied back, simple linen medic robes, holding a folded strip of clean linen, controlled tired compassion in her face, faded clinic curtains behind her, pale light.'],
    ['korin', 'A broad watch captain in his fifties standing at parade rest, square jaw, old city-guard uniform kept immaculate, iron district gate barred behind him, stern face carrying old guilt, cold stone light.'],
    ['nima', 'A composed archivist woman with ink-stained cuffs and perfectly calm unreadable face, dark librarian robes, scorched and ash-covered record shelves behind her, thin grey light, a single preserved scroll in her hand.'],
    ['eren', 'A silver-haired arbiter in his sixties wearing a formal judicial sash over dark robes, measured intelligent expression, an empty tribunal hall with benches behind him, cool light through tall windows.'],
    ['lyra', 'A gate engineer woman in her forties with burn-scarred hands and forearms, practical work harness with tools, defiant direct gaze, dead metal conduits behind her with one faint eerie glow, dramatic side light.'],
    ['halden', 'An old chancellor, grey and exhausted but sharply intelligent, heavy formal robes of state, seated at the head of a long empty council table, one lamp burning, tall dark windows behind him, the weight of decisions in his face.'],
];

const SCENES = [
    ['echoes-floor-low', 'Interior of a vast ancient stone tower landing, dust-grey worn stone, faded paper records and scrolls in wall niches, weak golden light falling through a high slit window, quiet preserved ruin, no people.'],
    ['echoes-floor-mid', 'Interior of an ancient tower hall, damaged archive shelves and scattered ledgers, flickering lantern light, a heavy sealed door with official seals, visible structural cracks in the stone, no people.'],
    ['echoes-floor-high', 'Upper floor of an ancient tower, pale distorted light, faint teal chakra-like energy leaking through cracks in the architecture, scorched and half-burned records drifting with ash, unsettling stillness, no people.'],
    ['echoes-floor-court', 'A high council chamber at the top of an ancient tower, one long table with many empty chairs, a single burning lamp, tall dark windows overlooking a dead unlit stone city at night, solemn, no people.'],
];

async function generate(prompt, size) {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, size, quality: 'medium', n: 1 }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const data = await response.json();
    return Buffer.from(data.data[0].b64_json, 'base64');
}

async function encode(buffer, outPath, width) {
    const { default: sharp } = await import('sharp');
    await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 84 }).toFile(outPath);
}

async function run(list, dir, size, width, wrap) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [id, brief] of list) {
        const outPath = path.join(dir, `${id}.webp`);
        if (fs.existsSync(outPath)) { console.log(`skip ${id} (exists)`); continue; }
        process.stdout.write(`gen ${id} ... `);
        try {
            const png = await generate(`${wrap} ${brief} ${STYLE}`, size);
            await encode(png, outPath, width);
            console.log(`ok (${Math.round(fs.statSync(outPath).size / 1024)} KB)`);
        } catch (error) {
            console.log(`FAILED: ${error.message}`);
        }
    }
}

await run(PORTRAITS, path.join(CLIENT, 'public', 'portraits'), '1024x1024', 512, PORTRAIT);
await run(SCENES, path.join(CLIENT, 'public', 'scenes', 'story'), '1536x1024', 1536, '');
console.log('done');
