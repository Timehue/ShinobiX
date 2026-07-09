// Generate a readable PDF of the entire story (chapters, interludes, road
// events) for review and fine-tuning. Imports the LIVE story data so the PDF
// can never drift from what players see, then hands off to the reportlab
// renderer (scripts/_story-pdf-build.py; needs `pip install reportlab`).
//
// Run from repo root:
//   node --import tsx scripts/gen-story-pdf.mjs [out.pdf]
//   node --import tsx scripts/gen-story-pdf.mjs --village "Ashen Leaf" [out.pdf]
// Default out: ShinobiX-Story.pdf in the repo root (or ShinobiX-Story-<slug>.pdf
// when a single village is selected). --village filters to one village and drops
// the cross-village road events (they are shared, not village-scoped).
//
// Each scene in the PDF carries an EDIT locator (file → village → level) so a
// line you want to change maps straight back to the source.
import { writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storylines } from "../shinobij.client/src/data/storylines.ts";
import { storyInterludesByVillage } from "../shinobij.client/src/data/story-interludes.ts";
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

// %name is substituted with the live character name at render time
// (lib/vn.ts applyVnTextVars); show a readable stand-in in the review PDF.
const forReview = (s) => (s == null ? s : String(s).split("%name").join("[player name]"));

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
        pages: renderPages(step.pages ?? []),
    })),
    interludes: (storyInterludesByVillage[village] ?? []).map((entry) => ({
        kind: "interlude", level: entry.levelReq, title: entry.title,
        editLocator: `story-interludes.ts → "${village}" → L${entry.levelReq}`,
        pages: renderPages(entry.pages ?? []),
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
    pages: renderPages(e.pages ?? []),
}));

const defaultOut = villageFilter
    ? path.join(ROOT, `ShinobiX-Story-${slug(villages[0].village)}.pdf`)
    : path.join(ROOT, "ShinobiX-Story.pdf");
const outPdf = path.resolve(positional[0] ?? defaultOut);

const tmp = mkdtempSync(path.join(tmpdir(), "story-pdf-"));
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
