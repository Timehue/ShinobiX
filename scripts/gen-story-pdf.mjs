// Generate a readable PDF of the entire story (chapters, interludes, road
// events) for review and fine-tuning. Imports the LIVE story data so the PDF
// can never drift from what players see, then hands off to the reportlab
// renderer (scripts/_story-pdf-build.py; needs `pip install reportlab`).
//
// Run from repo root:
//   node --import tsx scripts/gen-story-pdf.mjs [out.pdf]
//   node --import tsx scripts/gen-story-pdf.mjs --village "Ashen Leaf" [out.pdf]
//   node --import tsx scripts/gen-story-pdf.mjs --no-images [out.pdf]   (text only, faster)
// Default out: ShinobiX-Story.pdf in the repo root (or ShinobiX-Story-<slug>.pdf
// when a single village is selected). --village filters to one village and drops
// the cross-village road events (they are shared, not village-scoped).
//
// By default the PDF embeds each scene's generated backdrop and the portrait of
// every character who speaks in it (WebP assets from shinobij.client/public,
// transcoded to JPEG via sharp so reportlab needs no WebP support). --no-images
// skips that for a quick text-only proof.
//
// Each scene in the PDF carries an EDIT locator (file → village → level) so a
// line you want to change maps straight back to the source.
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storylines } from "../shinobij.client/src/data/storylines.ts";
import { storyInterludesByVillage } from "../shinobij.client/src/data/story-interludes.ts";
import { storyEpiloguesByVillage } from "../shinobij.client/src/data/story-epilogues.ts";
import { storyRoadEvents } from "../shinobij.client/src/data/story-road-events.ts";
import { splitDialogueLine } from "../shinobij.client/src/lib/vn.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// Parse args: optional --village/-v <name> flag, remaining positional = out path.
const argv = process.argv.slice(2);
let villageFilter = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--village" || a === "-v") villageFilter = argv[++i] ?? null;
    else if (a.startsWith("--village=")) villageFilter = a.slice("--village=".length);
    else positional.push(a);
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
const matchVillage = (name) => {
    if (!villageFilter) return true;
    const a = norm(name), b = norm(villageFilter);
    return a.includes(b) || b.includes(a);
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// %name / %pet are substituted with the live character / active-pet name at
// render time (lib/vn.ts applyVnTextVars; %pet falls back to "your companion");
// show readable stand-ins in the review PDF.
const forReview = (s) => (s == null ? s : String(s).split("%name").join("[player name]").split("%pet").join("[pet name]"));

// ── Image embedding ──────────────────────────────────────────────────────
// Transcode the public WebP art to JPEG in a temp dir so reportlab (no WebP
// support) can embed it; hand the Python renderer plain file paths.
const tmp = mkdtempSync(path.join(tmpdir(), "story-pdf-"));
const PUBLIC = path.join(ROOT, "shinobij.client", "public");
const noImages = argv.includes("--no-images");
const sharp = noImages ? null : (await import("sharp")).default;
const imgCache = new Map();
let imgSeq = 0;
async function embedImage(publicRel, maxWidth) {
    if (noImages || !publicRel) return null;
    if (imgCache.has(publicRel)) return imgCache.get(publicRel);
    const src = path.join(PUBLIC, publicRel.replace(/^\//, ""));
    let rec = null;
    if (existsSync(src)) {
        try {
            const out = path.join(tmp, `img-${imgSeq++}.jpg`);
            const info = await sharp(src).flatten({ background: "#ffffff" }).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(out);
            rec = { file: out, w: info.width, h: info.height };
        } catch { rec = null; }
    }
    imgCache.set(publicRel, rec);
    return rec;
}
// Matches lib/vn.ts defaultVnPortrait slugging (narrator/player have no portrait).
const portraitSlug = (name) => {
    const n = String(name).trim().toLowerCase();
    if (!n || n === "narrator" || n === "player") return "";
    return n.replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
};
// Resolve a scene's backdrop + the portrait of every speaker in it. Finale
// scenes also pull the Kage's hollow form (shown on the last page in play).
async function attachImages(scene) {
    scene.sceneImage = await embedImage(scene.backdrop, 1100);
    const seen = new Set();
    const cast = [];
    for (const p of scene.pages) {
        for (const nm of [p.speaker, ...p.lines.map((l) => l.speaker)]) {
            const s = portraitSlug(nm);
            if (!s || seen.has(s)) continue;
            seen.add(s);
            const rec = await embedImage(`/portraits/${s}.webp`, 320);
            if (rec) cast.push({ name: nm, ...rec });
            if (scene.isFinale) {
                const hollow = await embedImage(`/portraits/${s}-hollow.webp`, 320);
                if (hollow) cast.push({ name: `${nm} (hollow)`, ...hollow });
            }
        }
    }
    scene.cast = cast;
    delete scene.backdrop;
}

function renderPages(rawPages) {
    const titles = rawPages.map((p) => p.title);
    return rawPages.map((p, i) => ({
        index: i, title: p.title, scene: p.scene, speaker: p.speaker,
        lines: p.dialogue.map((line) => {
            const { speaker, text } = splitDialogueLine(line, p.speaker || "Narrator");
            return { speaker, text: forReview(text) };
        }),
        choices: (p.choices ?? []).map((c) => {
            const target = typeof c.nextPage === "number" ? c.nextPage : null;
            return {
                text: forReview(c.text), trait: c.trait ?? null, lane: c.lane ?? null,
                conclusion: forReview(c.conclusion ?? null), requireTrait: c.requireTrait ?? null,
                forbidTrait: c.forbidTrait ?? null,
                isLane: !!c.trait && !c.requireTrait, isBattle: !!c.battle,
                targetIndex: target,
                targetTitle: target != null && target !== i && titles[target] ? titles[target] : null,
                selfPoints: target === i,
            };
        }),
    }));
}

const villages = Object.entries(storylines)
    .filter(([village]) => matchVillage(village))
    .map(([village, steps]) => ({
    village,
    chapters: steps.map((step, index) => ({
        kind: "chapter", level: step.levelReq, title: step.title, boss: step.bossName,
        rewardXp: step.rewardXp, rewardRyo: step.rewardRyo, isFinale: !!step.kageFinale,
        liberatorTitle: step.liberatorTitle ?? null,
        editLocator: `storylines.ts → "${village}" → milestone L${step.levelReq}`,
        backdrop: `/scenes/story/story-${slug(village)}-${step.levelReq}-${index}.webp`,
        pages: renderPages(step.pages ?? []),
    })),
    interludes: (storyInterludesByVillage[village] ?? []).map((entry) => ({
        kind: "interlude", level: entry.levelReq, title: entry.title,
        editLocator: `story-interludes.ts → "${village}" → L${entry.levelReq}`,
        backdrop: `/scenes/story/${entry.id}.webp`,
        pages: renderPages(entry.pages ?? []),
    })),
    epilogues: (storyEpiloguesByVillage[village] ?? []).map((def) => ({
        kind: "epilogue", title: def.title, lane: def.lane,
        requireTrait: def.requireTrait ?? null,
        editLocator: `story-epilogues.ts → "${village}" → ${def.lane}${def.requireTrait ? ` + ${def.requireTrait}` : ""}`,
        // Epilogues reuse the finale backdrop (milestone index 8 = L100).
        backdrop: `/scenes/story/story-${slug(village)}-100-8.webp`,
        pages: renderPages(def.pages ?? []),
    })),
}));

if (villageFilter && villages.length === 0) {
    console.error(`No village matches "${villageFilter}". Known villages:\n  ${Object.keys(storylines).join("\n  ")}`);
    process.exit(1);
}

// Road events are cross-village; omit them when a single village is selected.
const roadEvents = villageFilter ? [] : storyRoadEvents.map((e) => ({
    kind: "road", level: e.levelReq, title: e.title, npcName: e.npcName,
    npcArchetype: e.npcArchetype, postFinale: e.minProgress >= 9,
    editLocator: `story-road-events.ts → "${e.slug}" (L${e.levelReq})`,
    backdrop: `/scenes/story/${e.id}.webp`,
    pages: renderPages(e.pages ?? []),
}));

// Transcode every scene's backdrop + speaker portraits (skipped under --no-images).
for (const v of villages) for (const sc of [...v.chapters, ...v.interludes, ...v.epilogues]) await attachImages(sc);
for (const e of roadEvents) await attachImages(e);

const defaultOut = villageFilter
    ? path.join(ROOT, `ShinobiX-Story-${slug(villages[0].village)}.pdf`)
    : path.join(ROOT, "ShinobiX-Story.pdf");
const outPdf = path.resolve(positional[0] ?? defaultOut);

const jsonPath = path.join(tmp, "story-export.json");
writeFileSync(jsonPath, JSON.stringify({ villages, roadEvents }, null, 2));

const py = spawnSync("python", [path.join(HERE, "_story-pdf-build.py"), jsonPath, outPdf], { stdio: "inherit" });
if (py.status !== 0) {
    console.error("PDF render failed. Ensure Python + reportlab are installed:  pip install reportlab");
    process.exit(py.status ?? 1);
}
const chCount = villages.reduce((n, v) => n + v.chapters.length, 0);
const ilCount = villages.reduce((n, v) => n + v.interludes.length, 0);
console.log(`\nDone: ${chCount} chapters, ${ilCount} interludes, ${roadEvents.length} road events → ${outPdf}`);
