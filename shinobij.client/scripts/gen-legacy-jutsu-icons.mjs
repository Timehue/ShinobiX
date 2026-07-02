/*
 * Batch icon generator for the 100 Legacy signature jutsu
 * (public/legacy/jutsu/<slug>.webp, 320px — docs/legacy-assets.md §3).
 *
 * Wraps gen-asset.mjs once per missing slug, matching the exact pipeline and
 * prompt house-style the first 20 were made with (see any existing .txt
 * sidecar). Resumable: slugs whose .webp already exists are skipped, so a
 * crashed/aborted run just continues where it left off.
 *
 *   cd shinobij.client
 *   node --import tsx scripts/gen-legacy-jutsu-icons.mjs            # generate all missing
 *   node --import tsx scripts/gen-legacy-jutsu-icons.mjs --dry-run  # list what would run
 *   node --import tsx scripts/gen-legacy-jutsu-icons.mjs --only skyfall-lance,aces-edge
 *
 * Needs OPENAI_API_KEY in the environment or shinobij.client/.env (same as
 * gen-asset.mjs). ~80 images at gen-quality low ≈ a dollar or two total.
 * After the run: update SHIPPED_ICON_SLUGS in src/data/legacy-jutsu.ts (or
 * flip it to unconditional) so the new art reaches the combat UIs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_JUTSU_DEFS } from "../src/data/legacy-jutsu.ts";

const CLIENT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(CLIENT_ROOT, "public", "legacy", "jutsu");
const STYLE_TAIL = "square jutsu skill icon for a shinobi RPG, dynamic energy composition filling the frame, dark background, vivid chakra glow, crisp readable silhouette";

// Per-slug scene lines. The 20 already-generated slugs are intentionally
// absent (their art + sidecars exist); everything else must have an entry —
// the preflight below fails loudly on a gap so a new jutsu can't ship iconless.
const SCENES = {
    // ── Mythic ────────────────────────────────────────────────────────────────
    "first-light-detonation": "a dawn-colored nova erupting outward with a rising sun core and rings of golden fire",
    "sealbreak-verdict": "a colossal glowing seal script shattering mid-air, torn paper wards and violet energy escaping the break",
    "hundredfold-tempest": "a hundred storm cells converging into one lightning-wreathed vortex above a single point",
    "sovereigns-decree": "a regal gauntleted fist descending like a gavel, crowned in crimson-and-gold chakra",
    "empire-of-silence": "a vast dark throne dissolving into drifting motes of hushed pale light, sound waves flattening to nothing",
    "final-bulwark": "an immense cracked tower shield planted in scorched earth, glowing wards knitting across its face",
    "founders-injunction": "a towering ancestral shadow with an outstretched palm, enemy weapon silhouettes crumbling before it",
    "awakening-roar": "a primordial beast skull roaring a shockwave that splits clouds, ember particles scattering",
    "worlds-edge-descent": "a lone figure diving from a broken horizon like a falling star, comet trail tearing the sky",
    "deathless-flurry": "a storm of burning fists striking from within a phoenix-shaped ember aura",
    // ── Legendary ─────────────────────────────────────────────────────────────
    "cataclysm-engine": "five elemental orbs — fire, water, lightning, earth, wind — colliding in a single catastrophic detonation",
    "thousand-seal-barrage": "cascading trails of glowing hand-seal symbols resolving into one piercing energy lance",
    "whisper-from-the-void": "a dark rift shaped like parted lips exhaling a thin violet whisper-thread into a fading mind silhouette",
    "demons-opening": "a horned demon mask splitting open to reveal a fist mid-strike through the gap in a guard",
    "saints-edge": "a single immaculate sword draw leaving a luminous white arc, petals of light falling along the cut",
    "thousandth-cut": "a whirlwind of countless thin blade arcs converging on one glowing final slash",
    "reapers-toll": "a great war scythe sweeping a crescent of souls above a battlefield of banners",
    "crimson-tithe": "a blade strike drawing a ribbon of crimson life-force flowing back into the striker's arm",
    "final-trial": "a stone torii gate wreathed in trial flames with a single victorious fist breaking through its center",
    "apex-instinct": "a primal predator eye opening inside a burst of claw marks that radiate across the frame",
    "keepers-mending": "gentle golden threads of light stitching closed a glowing wound above cupped healer hands",
    "uncharted-strike": "a dashing figure emerging from a torn map fragment, impact ring exploding at the landing point",
    "hundred-shrine-blessing": "a hundred tiny lit shrine lanterns spiraling upward into a pillar of blessing light",
    "alphas-command": "a howling alpha wolf silhouette crowned in chakra with pack eyes glowing behind it",
    "dead-mans-hand": "five spectral playing cards fanned in a skeletal glove, the center card burning",
    "bannerlords-rally": "a war banner slammed into a ridge, radiating a rally shockwave over massed spearpoints",
    // ── Rare ──────────────────────────────────────────────────────────────────
    "overflow-torrent": "a dam of raw blue chakra bursting, a torrent flooding outward in a crushing wave",
    "skyfall-lance": "a spear of storm-light dropping from a thunderhead onto a distant mark",
    "fang-behind-silence": "a moonlit fang-blade emerging from folds of absolute darkness behind an unaware silhouette",
    "woven-nightmare": "a loom of violet dream-threads weaving into a screaming phantom face",
    "mirage-waltz": "a dancer's spinning after-images in shimmering heat-haze, one solid strike landing among them",
    "knuckle-down": "battle-worn knuckles wrapped in torn bandages colliding with a shockwave of grit and sparks",
    "mountains-descent": "a mountain-shaped force descending behind a single falling hammer-fist",
    "breakwater-rush": "a fighter charging inside a curling tidal wave that breaks into a ring of foam and force",
    "unsheathed-instant": "a katana caught at the exact instant of leaving its scabbard, the cut already glowing in the air",
    "skinning-arc": "a hunter's curved blade sweeping a wide silver arc through tall grass, feathers and fur scattering",
    "proving-blow": "one perfect straight punch frozen at impact, concentric proof-rings stamped in the air like a seal",
    "ascendant-surge": "a fighter rocketing up a ladder of light rungs, energy trailing off each step",
    "fell-the-giant": "a small silhouette striking the ankle of a colossal armored giant as cracks race up its body",
    "defiant-rampart": "a battered kite shield growing taller into a rampart of glowing stone under siege arrows",
    "depthcall-burst": "an abyssal pressure wave erupting from a dark gate-crack in the ground, deep-sea light spilling out",
    "summit-strike": "a blow thrown from a mountain summit with a hundred climbed floors glowing faintly below",
    "relentless-pursuit": "a hound-shaped chakra stream mid-lunge, jaws closing on a fleeing shadow's heel",
    "flush-the-quarry": "a burst of beaters' torches and startled birds driving a beast silhouette into open moonlight",
    "titanfall-burst": "an explosive burst at the chest of a colossal boss silhouette, its health-bar-like armor plates shattering",
    "delvers-lantern-strike": "a swinging lantern trailing fire in a dark vault while its bearer strikes forward",
    "hearthfire-ward": "a warm hearth flame inside a ring of protective stones, sparks forming a dome ward",
    "banked-ember-form": "a meditating figure with banked coals glowing along their arms in disciplined patterns",
    "seawall-stance": "a wide braced stance holding back a towering storm wave behind a groaning seawall",
    "squallrunner-raid": "a raider sprinting inside a squall of rain and lightning, strike landing in a burst of spray",
    "bristling-pelt": "a frost-wolf pelt cloak bristling into icicle spines as a blade glances off",
    "long-watch": "a lone sentinel on a snowy watchtower at night, shield planted, breath frosting under a cold star",
    "hooded-light": "a lantern half-hooded by a dark cloth, its remaining beam bending around a guarded figure",
    "last-delivery": "a courier bursting through a paper door at midnight, satchel glowing, impact ring on landing",
    "cairn-brand": "a glowing trail-marker rune being seared onto a stone cairn, wisps guiding toward it",
    "chase-the-whisper": "a sprinting figure chasing a ribbon of whispered words that turns to reveal a snarling truth",
    "shared-fire": "two hands lighting one campfire together, the flame splitting into many small warm lights",
    "palm-ward": "an open palm projecting a translucent circular ward that catches a blade mid-swing",
    "triage-under-fire": "a medic's glowing hands closing a wound while arrows streak past overhead",
    "cleansing-radiance": "a wave of white-gold radiance washing dark venom out of the air like ink from water",
    "howl-of-the-pack": "a leader's upturned howl with spectral packmates rising in the sound waves",
    "feral-communion": "a shinobi kneeling forehead-to-forehead with a great beast, wild energy flowing between them",
    "crowd-and-claw": "an arena strike thrown in a colosseum of roaring silhouettes, claw-shaped chakra trailing the fist",
    "aces-edge": "a razor-edged ace card thrown like a shuriken, slicing a trail of gold light",
    "stacked-deck": "a shadowy dealer's hand fanning marked cards, threads of manipulation running to a mark",
    "wardens-perimeter": "a glowing boundary line snapping taut around a guarded sector, intruder blades dulling at its edge",
    "take-the-standard": "a charging figure ripping an enemy banner down mid-dash, planting a new one in the wreckage",
    "breach-shot": "a long-range piercing shot punching a clean breach through a fortress wall, dust blooming",
    "drums-of-advance": "great war drums mid-beat, each shockwave pushing a marching line forward",
    // ── Basic ─────────────────────────────────────────────────────────────────
    "first-spark": "a student's cupped hands holding their first crackling spark of jutsu, eyes lit with wonder",
    "still-water-gaze": "a perfectly still pond reflecting a gazing eye, one ripple spreading hypnotically",
    "ten-thousand-strikes": "a worn wooden training post mid-shatter under a ten-thousandth bare-knuckle strike",
    "first-forging": "an apprentice's first blade glowing on an anvil, hammer sparks forming a cutting arc",
    "harvest-rhythm": "a scythe swinging in steady farm rhythm, wheat and chakra motes arcing in its wake",
    "warm-muzzle": "a beast's muzzle pressed to a shinobi's shoulder, soft warm light spreading from the touch",
    "house-rules": "a tavern table with dice and cards mid-game, one player's calm hand tipping the odds with subtle glow",
    "kept-flame": "a small stubborn lantern flame cupped against wind and dark, steady and unkillable",
    "trailblaze-dash": "boots tearing a new glowing trail through wild brush, dust and light kicked up at the cut",
    "fair-days-wage": "calloused working hands closing around honest coin that glows into a protective aura",
    "neighbors-vigil": "a simple round shield and garden fence silhouette under a night lantern, unwavering watch",
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? new Set((args[args.indexOf(onlyArg) + 1] ?? onlyArg.split("=")[1] ?? "").split(",").filter(Boolean)) : null;

// Preflight: every shipped jutsu must have art on disk OR a scene here.
const rows = LEGACY_JUTSU_DEFS.map((d) => {
    const slug = d.jutsu.id.replace(/^legacy-/, "");
    return { slug, name: d.jutsu.name, exists: fs.existsSync(path.join(OUT_DIR, `${slug}.webp`)) };
});
const gaps = rows.filter((r) => !r.exists && !SCENES[r.slug]);
if (gaps.length) {
    console.error(`error: ${gaps.length} slug(s) have neither art nor a scene prompt: ${gaps.map((g) => g.slug).join(", ")}`);
    process.exit(1);
}

const todo = rows.filter((r) => !r.exists && (!only || only.has(r.slug)));
console.log(`legacy jutsu icons: ${rows.length} total, ${rows.filter((r) => r.exists).length} on disk, ${todo.length} to generate${dryRun ? " (dry run)" : ""}`);

let done = 0;
for (const { slug, name } of todo) {
    const prompt = `${SCENES[slug]}, ${STYLE_TAIL}`;
    console.log(`\n[${++done}/${todo.length}] ${slug} — ${name}`);
    if (dryRun) { console.log(`  prompt: ${prompt}`); continue; }
    execFileSync(process.execPath, [
        path.join(CLIENT_ROOT, "scripts", "gen-asset.mjs"),
        "--id", `jutsu:legacy:${slug}`,
        "--prompt", prompt,
        "--out", OUT_DIR,
        "--max-px", "320",
    ], { stdio: "inherit" });
    // gen-asset writes legacy_<slug>.webp/.txt (colon → underscore); normalize
    // to the bare <slug> names the 20 existing icons (and the client) use.
    for (const ext of [".webp", ".txt"]) {
        const from = path.join(OUT_DIR, `legacy_${slug}${ext}`);
        const to = path.join(OUT_DIR, `${slug}${ext}`);
        if (fs.existsSync(from)) fs.renameSync(from, to);
    }
}
if (!dryRun && todo.length) {
    console.log("\nAll generated. Now add the new slugs to SHIPPED_ICON_SLUGS in src/data/legacy-jutsu.ts (or make it unconditional) and rebuild.");
}
