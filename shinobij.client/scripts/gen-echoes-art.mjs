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
    // Per-opponent landing scenes (VN + battle backdrops), matching each
    // floor's authored scene captions in data/echoes-of-war-scenes.ts. The
    // original four shared band scenes (echoes-floor-low/mid/high/court) were
    // retired when every floor gained its own set.
    ['echoes-tovin', 'A dust-grey stone bell tower landing, a bronze bell in a wall alcove, a long rope hanging with its top cleanly cut, one warm golden shaft of light through a slit window, worn stone floor, quiet preserved ruin, no people.'],
    ['echoes-vetta', 'An ancient stone storeroom landing stacked with grain sacks gone grey with dust, a small brass balance scale resting on a barrel, warm lamplight, flour dust hanging in the air, no people.'],
    ['echoes-aya', 'A courier waystation landing in an ancient stone tower, a worn leather message satchel hanging on an iron hook, straps frayed to thread, a long stair vanishing upward, cool grey morning light, no people.'],
    ['echoes-ansel', 'A records room landing walled with wooden pigeonhole shelves full of rolled documents, one thick ledger open on a reading stand, a single candle, precise orderly quiet, warm candlelight, no people.'],
    ['echoes-sela', 'An old infirmary landing in an ancient stone tower, rows of empty cots behind faded linen clinic curtains gone stiff with age, folded bandages on a side table, pale cold daylight, no people.'],
    ['echoes-korin', 'A sealed district gate inside an ancient stone tower, a massive iron-barred gate with heavy official wax seals, a guard post with a neat empty chair, cold blue-grey stone light, imposing, no people.'],
    ['echoes-nima', 'A burned archive landing, scorched wooden shelving with even drifts of grey ash on every surface, a few preserved scrolls untouched by fire, thin grey light through smoke haze, melancholy stillness, no people.'],
    ['echoes-eren', 'An ancient tribunal hall, ranked wooden benches, an empty witness table at the center, a high judicial bench, tall narrow windows with cool pale light, dust motes in the air, solemn, no people.'],
    ['echoes-lyra', 'An engine chamber landing in an ancient tower, thick dead metal conduits crossing the walls and floor, one conduit still glowing faint eerie teal, a workbench with abandoned tools, dramatic side light, no people.'],
    ['echoes-halden', 'A high council chamber at the top of an ancient tower, one long dark table with many empty chairs, a single burning oil lamp at the head seat, tall dark windows overlooking a dead unlit stone city, solemn and final, no people.'],
    ['echoes-tower-hero', 'Looking up the hollow interior of a vast ancient stone tower from its base, ten ringed floors spiraling upward into pale golden mist and faint teal light at the top, hanging preserved paper records drifting like leaves, awe and melancholy, cinematic scale, no people.'],
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
