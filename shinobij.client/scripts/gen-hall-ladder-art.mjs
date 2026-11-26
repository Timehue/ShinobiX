// Authors the Hall Ladder art: one portrait per Card Hall ladder duelist. Like
// the Keeper's Path portraits (scripts/gen-keeper-path-art.mjs), each is an EDIT
// against the house Chronicle Keeper (public/chronicle/keeper.webp), used only
// as the style reference, so the ladder sits beside the rest of the Chronicle art.
//
//   node scripts/gen-hall-ladder-art.mjs [--only <id>] [--model gpt-image-2] [--env-file <path>] [--dry-run]
//
// Writes raw PNGs to scripts/.hall-ladder-art/ (gitignored scratch), then
// shrinks them to the shipped 512x512 WebPs in public/chronicle/fx/hall-ladder/<id>.webp.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes("--" + n);

function envKey(name, file) {
    if (process.env[name]) return process.env[name].trim();
    for (const p of [file, path.join(CLIENT, ".env")].filter(Boolean)) {
        if (!fs.existsSync(p)) continue;
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
            const m = line.match(new RegExp("^" + name + "\\s*=\\s*(.+)$"));
            if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return "";
}

const PORTRAIT_STYLE = [
    "The attached portrait is the house Chronicle Keeper of a shinobi card-duel game. Use it ONLY as the reference for",
    "art style, palette, lighting and rendering. Do not copy its mask, face, hood or pose.",
    "",
    "Paint ONE new character portrait in exactly that style: AAA hand-painted dark fantasy realism, one shinobi card",
    "duelist shown head and shoulders, centred, facing the viewer, against a near-black background, lit by one",
    "dominant light source, with a few painted playing cards or paper talismans bearing faint ink seals drifting near",
    "the figure. Square framing, the face in the upper middle third, the whole head inside the frame.",
    "",
    "No text, no letters, no numbers, no logo, no watermark, no frame, no border.",
].join("\n");

/** The ladder in climbing order. Each duelist is a rung of three bouts. */
const DUELISTS = {
    apprentice: [
        "The character: KIRI, THE HALL APPRENTICE, the first duelist of the Card Hall ladder and the friendliest face in it.",
        "A young shinobi attendant in a simple indigo hall uniform with a pale grey sash, no mask, short dark hair tied back,",
        "bright hopeful brown eyes and a small encouraging smile. She holds a neat fan of five cards toward the viewer as",
        "if about to teach a lesson. Soft warm candlelight from below-left. Gentle, approachable, a little nervous.",
    ],
    scrollkeeper: [
        "The character: OLD MASTER TOBEI, THE SCROLL KEEPER, the second duelist. An elderly shinobi archivist with a long",
        "white beard, deep laugh lines and round wire spectacles, in faded moss-green robes with ink-stained cuffs. A thick",
        "sealed scroll bound with red cord rests across one arm, and a single card is tucked behind his ear. Warm amber",
        "lamplight from one side. Kindly, wise, and quietly amused.",
    ],
    swifthand: [
        "The character: SUZUME, THE SWIFT HAND, the third duelist. A lean young shinobi woman with a sparrow-feather",
        "ornament in her dark bob, a light brown scarf pulled down from her chin, a fitted rust-orange vest over dark",
        "wraps. One raised hand snaps a card between two fingers mid-flick, a faint motion blur on the card; small brown",
        "feathers drift among the talismans. Cool dawn light from the right. Quick, confident, grinning.",
    ],
    stonewall: [
        "The character: GENSAI, THE STONE WALL, the fourth duelist. A broad, heavy-set shinobi guardian with a shaved head,",
        "a thick black beard and a calm stern gaze, in layered grey stone-coloured lamellar armour over a dark gi. Square",
        "stone tablets carved with angular, blocky geometric seals (straight lines and right angles only, never spirals,",
        "swirls or leaf shapes) hover around him like a shield wall instead of paper talismans. Low steady torchlight",
        "from below. Immovable and patient.",
    ],
    hiddenmist: [
        "The character: AYAME OF THE HIDDEN MIST, the fifth duelist. A poised shinobi woman whose lower face is veiled in",
        "sheer violet silk, sharp violet-grey eyes above it, long black hair partly hidden under a dark hood. Pale violet",
        "mist curls around her shoulders, and two of the drifting cards are half-dissolved into the mist. Cold violet",
        "moonlight from above. Mysterious, patient, a trickster.",
    ],
    champion: [
        "The character: KUROGANE, CHAMPION OF THE CARD HALL, the final duelist. A tall shinobi master in black iron-plated",
        "robes trimmed in deep crimson, a black iron half-mask covering the lower face, a scar through one eyebrow, and",
        "fierce ember-orange eyes. A crimson champion's sash crosses the chest. Three cards burn with small crimson flames",
        "as they drift beside him. Strong crimson rim light from behind. Commanding and absolutely sure of himself.",
    ],
};

/** The climb itself: one tall painting the ladder view scrolls up. Each tier's
 *  platform is left empty, because the duelist's portrait stands there. */
const TOWER = {
    ref: "public/chronicle/keeper-path-hero.webp", size: "1024x1536", out: "public/chronicle/fx/hall-ladder/tower.webp", width: 1024, height: 1536, quality: 72,
    prompt: [
        "The attached image is a scene from the same shinobi card-duel game. Use it ONLY as the reference for art style,",
        "palette, lighting and rendering. Do not redraw its path or its composition.",
        "",
        "Paint ONE new tall vertical illustration in exactly that style, AAA hand-painted dark fantasy: THE HALL TOWER, a",
        "six-storey wooden and stone pagoda rising out of night mist, seen from the outside, nearly straight on and",
        "level with the middle of the tower, filling the full height of the image. Every storey is a TALL, OPEN-SIDED",
        "duelling hall facing the viewer: a wide flat floor with a round duelling mat in its centre, slender pillars",
        "only at the far left and far right, NO railing or balustrade across the front, and a large open space above",
        "the floor that is clearly taller than its width is deep, so that a standing person would fill only the lower",
        "half of it. Between one storey and the next there is only a THIN, shallow curved tiled roof band, much",
        "shorter than the open storey below it. The six storeys are stacked evenly and are all the same height, the",
        "lowest floor near the bottom of the image and the highest storey near the top, with a small spire above it.",
        "Two paper lanterns hang at the outer pillars of each storey. A narrow stone stair winds up the outside right",
        "edge of the tower from storey to storey. Lantern light grows warmer the higher the storey; the top storey",
        "glows crimson and gold under a moonlit sky. Paper talismans and a few playing cards drift on the wind.",
        "Distant rooftops of a village sit far below in the mist.",
        "",
        "The platforms must be EMPTY: no people, no figures, no statues on any of them. No text, no letters, no",
        "numbers, no logo, no watermark, no frame, no border.",
    ].join("\n"),
};

/** The duelist standing on their tower floor: the same character as their
 *  portrait, full body, painted on flat magenta that is keyed out to alpha. */
const FIGURE_STYLE = [
    "The attached portrait shows one character from a shinobi card-duel game. Paint THE SAME CHARACTER (same face,",
    "hair, clothing, colours and props) as ONE full-body standing figure, head to feet, in the same hand-painted dark",
    "fantasy style. The figure stands upright in a calm duelling stance, facing the viewer in a slight three-quarter",
    "view, holding a few playing cards, lit warmly from the front as if by lanterns. The whole figure fits inside the",
    "image with a small margin, feet near the bottom edge.",
    "",
    "The background must be ONE flat, solid, pure magenta colour (#FF00FF) everywhere: no floor, no shadow, no",
    "gradient, no scenery, no drifting cards or talismans, no glow on the background. No magenta anywhere on the",
    "character. No text, no letters, no logo, no watermark, no frame.",
].join("\n");

/** Key flat magenta to alpha, with a soft edge and the magenta spill removed. */
async function keyMagenta(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const magenta = Math.min(r, b) - g;
        if (magenta > 120) data[i + 3] = 0;
        else if (magenta > 50) {
            data[i + 3] = Math.round(255 * (120 - magenta) / 70);
            const despill = Math.max(g, Math.min(r, b) - 50);
            data[i] = Math.min(r, despill + 40); data[i + 2] = Math.min(b, despill + 40);
        }
    }
    return sharp(data, { raw: info }).png().toBuffer();
}

const MODEL = arg("model", "gpt-image-2");
const only = arg("only", "");
const jobs = [
    ...Object.entries(DUELISTS).map(([id, lines]) => [id, {
        ref: "public/chronicle/keeper.webp", size: "1024x1024", width: 512, height: 512,
        out: `public/chronicle/fx/hall-ladder/${id}.webp`,
        prompt: [PORTRAIT_STYLE, "", ...lines].join("\n"),
    }]),
    ...Object.keys(DUELISTS).map((id) => [`${id}-figure`, {
        ref: `public/chronicle/fx/hall-ladder/${id}.webp`, size: "1024x1536", figureHeight: 300,
        out: `public/chronicle/fx/hall-ladder/${id}-figure.webp`,
        prompt: FIGURE_STYLE,
    }]),
    ["tower", TOWER],
].filter(([id]) => !only || id === only || (only === "figures" && id.endsWith("-figure")));
const scratch = path.join(HERE, ".hall-ladder-art");
const key = envKey("OPENAI_API_KEY", arg("env-file", ""));

if (flag("dry-run")) {
    for (const [id, job] of jobs) console.log(`\n=== ${id} -> ${job.out}\n${job.prompt}`);
    process.exit(0);
}
// --reprocess re-cuts the raw paintings already in scratch: no API call.
if (!key && !flag("reprocess")) { console.error("error: OPENAI_API_KEY not found (env or shinobij.client/.env)"); process.exit(1); }
fs.mkdirSync(scratch, { recursive: true });
fs.mkdirSync(path.join(CLIENT, "public/chronicle/fx/hall-ladder"), { recursive: true });

await Promise.all(jobs.map(async ([id, job]) => {
    const raw = path.join(scratch, `${id}.png`);
    if (!flag("reprocess")) await paint(id, job, raw);
    else if (!fs.existsSync(raw)) throw new Error(`${id}: no raw painting to reprocess at ${raw}`);
    // --preview writes beside the raw PNG instead of over the shipped file.
    const out = flag("preview") ? path.join(scratch, `${id}-preview.webp`) : path.join(CLIENT, job.out);
    if (job.figureHeight) {
        const keyed = await sharp(await keyMagenta(raw)).trim({ threshold: 1 }).png().toBuffer();
        // Lit for the tower: the portraits' dark robes read as silhouettes at
        // this size against the dim halls, so lift exposure, colour and contrast.
        await sharp(keyed).resize({ height: job.figureHeight })
            .modulate({ brightness: 1.9, saturation: 1.45 }).linear(1.25, -14)
            .webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(out);
    } else {
        await sharp(raw).resize(job.width, job.height, { fit: "cover", position: "centre" }).webp({ quality: job.quality ?? 80, effort: 6 }).toFile(out);
    }
    console.log(`${id}: wrote ${path.relative(CLIENT, out)} (${fs.statSync(out).size} bytes)`);
}));

async function paint(id, job, raw) {
    const reference = await sharp(path.join(CLIENT, job.ref)).png().toBuffer();
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", job.prompt);
    form.append("image[]", new Blob([reference], { type: "image/png" }), "reference.png");
    form.append("size", job.size);
    form.append("quality", "high");
    form.append("output_format", "png");
    form.append("n", "1");
    const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) throw new Error(`${id}: openai ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const b64 = (await res.json())?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`${id}: no image returned`);
    fs.writeFileSync(raw, Buffer.from(b64, "base64"));
}
