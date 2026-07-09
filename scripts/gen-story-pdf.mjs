// Generate a readable PDF of the entire story (chapters, interludes, road
// events) for review and fine-tuning. Imports the LIVE story data so the PDF
// can never drift from what players see, then hands off to the reportlab
// renderer (scripts/_story-pdf-build.py; needs `pip install reportlab`).
//
// Run from repo root:
//   node --import tsx scripts/gen-story-pdf.mjs [out.pdf]
// Default out: ShinobiX-Story.pdf in the repo root.
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
const outPdf = path.resolve(process.argv[2] ?? path.join(ROOT, "ShinobiX-Story.pdf"));

function renderPages(rawPages) {
    const titles = rawPages.map((p) => p.title);
    return rawPages.map((p, i) => ({
        index: i, title: p.title, scene: p.scene, speaker: p.speaker,
        lines: p.dialogue.map((line) => {
            const { speaker, text } = splitDialogueLine(line, p.speaker || "Narrator");
            return { speaker, text };
        }),
        choices: (p.choices ?? []).map((c) => {
            const target = typeof c.nextPage === "number" ? c.nextPage : null;
            return {
                text: c.text, trait: c.trait ?? null, lane: c.lane ?? null,
                conclusion: c.conclusion ?? null, requireTrait: c.requireTrait ?? null,
                isLane: !!c.trait && !c.requireTrait, isBattle: !!c.battle,
                targetIndex: target,
                targetTitle: target != null && target !== i && titles[target] ? titles[target] : null,
                selfPoints: target === i,
            };
        }),
    }));
}

const villages = Object.entries(storylines).map(([village, steps]) => ({
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

const roadEvents = storyRoadEvents.map((e) => ({
    kind: "road", level: e.levelReq, title: e.title, npcName: e.npcName,
    npcArchetype: e.npcArchetype, postFinale: e.minProgress >= 9,
    editLocator: `story-road-events.ts → "${e.slug}" (L${e.levelReq})`,
    pages: renderPages(e.pages ?? []),
}));

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
