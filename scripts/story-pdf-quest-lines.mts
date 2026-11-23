/*
 * The long one-time quests (api/quests/_catalog.ts), laid out for the story
 * review PDF (gen-story-pdf.mjs).
 *
 * One scene per quest, one page per stage, in the order a player meets them.
 * Each page carries the stage's own player text, and a caption saying what the
 * server asks for at that step: where, what must be held, what is made, who is
 * fought and what breaks their Hold. Everything is read from the live
 * catalogue, so the review copy cannot drift from the game.
 */
import { COAST_LANDING_TIERS } from "../api/coast/_landing-rules.ts";
import { QUEST_LINE_CATALOGUE, questLineRyo } from "../api/quests/_catalog.ts";
import { questFightHolds, type QuestLine, type QuestLineStage, type QuestSay } from "../api/quests/_types.ts";
import { ITEM_CATALOG } from "../api/pvp/_item-catalog.ts";
import { coastCastMember } from "../shared/coast-cast.ts";
import { coastSectorName, coastSite } from "../shared/coast-world.ts";
import { questSite, type QuestSiteActivity } from "../shared/quest-sites.ts";
import { sectorBuilding } from "../shared/sector-buildings.ts";
import { sectorName } from "../shared/sector-geo.ts";

type Line = { speaker: string; text: string };
type Choice = {
    text: string; trait: null; lane: null; conclusion: string | null; requireTrait: null; forbidTrait: null;
    isLane: false; isBattle: false; targetIndex: null; targetTitle: null; selfPoints: false;
};
export type QuestLinePdfPage = { index: number; title: string; scene: string; speaker: string; lines: Line[]; choices: Choice[] };
export type QuestLinePdfScene = { kind: "side"; title: string; note: string; editLocator: string; backdrop: null; pages: QuestLinePdfPage[] };

const { lines: LINES, recipes: RECIPES, fights: FIGHTS } = QUEST_LINE_CATALOGUE;

const itemName = (itemId: string) => ITEM_CATALOG[itemId]?.name ?? itemId;
const castName = (castId: string) => coastCastMember(castId)?.name ?? castId;
const sectorTitle = (sector: number) => coastSectorName(sector) ?? sectorName(sector) ?? "Sector";
const sectorLabel = (sector: number) => `${sectorTitle(sector)} (${sector})`;
const counted = (count: number, itemId: string) => `${count} ${itemName(itemId)}`;
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** A place and its sector. A place named after its sector, or after `sameAs`, is not said twice. */
function placeLabel(name: string, sector: number, sameAs?: string): string {
    return name === sectorTitle(sector) || name === sameAs ? sectorLabel(sector) : `${name}, ${sectorLabel(sector)}`;
}

function buildingLabel(buildingId: string): string {
    const place = sectorBuilding(buildingId) ?? coastSite(buildingId);
    return place ? placeLabel(place.name, place.sector) : buildingId;
}

const SITE_TOOL: Readonly<Record<QuestSiteActivity, string>> = { harvesting: "a kama", mining: "a pickaxe", fishing: "a fishing kunai" };

/** The tool and skill a gathering site really asks for, read from the site table. */
function siteNeeds(siteIds: readonly string[]): string {
    const needs = new Set<string>();
    for (const id of siteIds) {
        const site = questSite(id);
        if (site) needs.add(`${SITE_TOOL[site.activity]}${site.level > 1 ? ` and ${site.activity} skill ${site.level}` : ""}`);
    }
    return needs.size ? ` Needs ${[...needs].join(" or ")}.` : "";
}

function fightLabel(fightId: string): string {
    const fight = FIGHTS[fightId];
    if (!fight) return fightId;
    const holds = questFightHolds(fight).map(hold => `${hold.name}, broken by ${itemName(hold.breakerItemId)}`);
    const guard = holds.length ? ` Holds, in order: ${holds.join("; ")}.` : "";
    // The forms the boss takes as its health falls: what is said, then what changes.
    const forms = (fight.forms?.phases ?? []).map(phase =>
        ` At ${phase.atHpPct}% health: ${phase.formName}. ${phase.cutscene.speaker === "Narrator" ? "" : `${phase.cutscene.speaker}: `}${phase.cutscene.lines.join(" ")} [${phase.summary} ${phase.mechanic?.tell ?? ""}]`).join("");
    return `Fight ${castName(fight.castId)} in ${sectorLabel(fight.sector)}.${guard}${forms}`;
}

/** A boss a choice makes harder: who chose what, and by how much. Empty when no choice changes the fight. */
function fightVariants(stage: QuestLineStage, line?: QuestLine): string {
    if (stage.kind !== "boss" || !stage.fightByChoice || !line) return "";
    const base = FIGHTS[stage.fightId];
    const choice = line.stages.find(candidate => candidate.key === stage.fightByChoice!.stage);
    if (!base || choice?.kind !== "choice") return "";
    return Object.entries(stage.fightByChoice.fights).map(([optionKey, fightId]) => {
        const variant = FIGHTS[fightId], label = choice.choice.options.find(option => option.key === optionKey)?.label ?? optionKey;
        return variant ? ` If "${label}" was chosen, the foe is ${variant.levelOffset - base.levelOffset} level and ${variant.statBonus - base.statBonus} stat points stronger.` : "";
    }).join("");
}

/** What the server asks for at a stage, in one line. `line` lets a boss say how an earlier choice changes it. */
export function questStageCaption(stage: QuestLineStage, line?: QuestLine): string {
    switch (stage.kind) {
        case "speak": return `Speak with ${castName(stage.castId)} in ${sectorLabel(stage.place.sector)}.`;
        case "reach": return `Stand in ${sectorLabel(stage.place.sector)}.`;
        case "enter": {
            const tier = stage.landing ? COAST_LANDING_TIERS[stage.landing.tier]?.name ?? `tier ${stage.landing.tier}` : "";
            return `Go in at ${buildingLabel(stage.buildingId)}.${tier ? ` The clan's Landing must be a ${tier} or better, and active.` : ""}`;
        }
        case "gather": {
            const sites = stage.siteIds.map(id => coastSite(id)).filter(site => !!site).map(site => placeLabel(site.name, site.sector, itemName(stage.itemId)));
            return `Gather ${counted(stage.count, stage.itemId)}${sites.length ? ` at ${sites.join(" or ")}` : ""}.${siteNeeds(stage.siteIds)}`;
        }
        case "make": {
            const recipe = RECIPES[stage.recipeId];
            const takes = recipe ? recipe.inputs.map(input => counted(input.count, input.itemId)).join(" and ") : stage.recipeId;
            const gives = recipe ? counted(recipe.output.count, recipe.output.itemId) : "the tool";
            return `Make ${gives} at ${buildingLabel(stage.buildingId)}. Takes ${takes}.`;
        }
        case "deliver": return `Hand over ${counted(stage.count, stage.itemId)} at ${buildingLabel(stage.buildingId)}.`;
        case "drop": return `${fightLabel(stage.fightId)} The win drops ${counted(stage.count, stage.itemId)}.`;
        case "boss": return fightLabel(stage.fightId) + fightVariants(stage, line);
        case "choice": {
            // What each option changes, beyond the words the player reads.
            const effects = stage.choice.options.map(option => {
                const parts = [
                    ...(option.bonusRyoPct ? [`${option.bonusRyoPct}% more ryo`] : []),
                    ...(option.items ?? []).map(itemName),
                ];
                return parts.length ? ` "${option.label}" gives ${parts.join(" and ")}.` : "";
            }).join("");
            // A question is not sealed: a wrong answer is refused and can be tried again.
            if (stage.choice.answer !== undefined) return "A question, answered from the clue above. Only the right answer passes the step.";
            return `A choice. It is sealed when made.${effects}`;
        }
    }
}

function gateNote(line: QuestLine): string {
    const gate = line.gate, rewards = line.rewards;
    const needs = [`level ${gate.level} or higher`];
    if (gate.quests?.length) needs.push(`after ${gate.quests.map(id => LINES[id]?.title ?? id).join(" and ")}`);
    if (gate.marks) needs.push(`${gate.marks} marks`);
    if (gate.clan) needs.push("a clan");
    const pays = [`${line.marks} ${line.marks === 1 ? "mark" : "marks"}`];
    if (rewards.statPoints) pays.push(`${rewards.statPoints} stat points`);
    if (rewards.fateShards) pays.push(plural(rewards.fateShards, "Fate Shard"));
    if (rewards.boneCharms) pays.push(plural(rewards.boneCharms, "Bone Charm"));
    if (rewards.auraStones) pays.push(plural(rewards.auraStones, "Aura Stone"));
    if (rewards.gearChanceBp) pays.push(`a ${rewards.gearChanceBp / 100}% chance of a gear piece`);
    for (const key of rewards.artKeys ?? []) if (key.startsWith("badge-")) pays.push(rewards.badges?.length ? "the tier's badge and its achievement" : "the tier's badge");
    if (rewards.title) pays.push(`title ${rewards.title}`);
    if (rewards.opensRegion) pays.push(`opens region ${rewards.opensRegion}`);
    if (rewards.unlocks?.length) pays.push(`unlocks ${rewards.unlocks.join(", ")}`);
    // Ryo grows with the player's level; the figure is what the lowest level allowed is paid.
    const ryo = `${questLineRyo(gate.level, rewards.weight).toLocaleString("en-US")} ryo at level ${gate.level}`;
    return `Offered by ${castName(line.giver)}. Needs ${needs.join(", ")}. Pays ${ryo}, ${pays.join(", ")}.`;
}

/** When a conditional line is heard, in words a reviewer can check against the quest. */
function whenNote(when: QuestSay["when"]): string {
    if (!when) return "";
    const parts = [
        ...(when.standing ? [`record has ${when.standing}`] : []),
        ...(when.without ? [`record lacks ${when.without}`] : []),
        ...(when.chose ? [`chose ${when.chose[1]} at ${when.chose[0]}`] : []),
        ...(when.finished ? [`finished ${LINES[when.finished]?.title ?? when.finished}`] : []),
        ...(when.unfinished ? [`has not finished ${LINES[when.unfinished]?.title ?? when.unfinished}`] : []),
    ];
    return ` [only if: ${parts.join(", ")}]`;
}

/** Spoken lines as the PDF prints them: the speaker's name, with the condition beside it when there is one. */
function spoken(says: readonly QuestSay[] | undefined): Line[] {
    return (says ?? []).map(say => ({
        speaker: say.speaker === "narrator" ? "Narrator" : `${say.speaker === "you" ? "You" : castName(say.speaker)}${whenNote(say.when)}`,
        text: say.speaker === "narrator" && say.when ? `${say.text}${whenNote(say.when)}` : say.text,
    }));
}

const NO_CHOICES: Choice[] = [];
const scenePage = (index: number, title: string, scene: string, lines: Line[]): QuestLinePdfPage => ({ index, title, scene, speaker: "Narrator", lines, choices: NO_CHOICES });

function stagePage(line: QuestLine, stage: QuestLineStage, index: number): QuestLinePdfPage {
    const choices: Choice[] = stage.kind !== "choice" ? [] : stage.choice.options.map(option => ({
        text: option.label, conclusion: option.blurb, trait: null, lane: null, requireTrait: null, forbidTrait: null,
        isLane: false, isBattle: false, targetIndex: null, targetTitle: null, selfPoints: false,
    }));
    // What is said on arriving at the step, then the plain instruction the journal shows under it.
    const lines: Line[] = [...spoken(stage.say), { speaker: "Narrator", text: `Journal: ${stage.text}` }];
    if (stage.kind === "choice") {
        lines.push({ speaker: "Narrator", text: stage.choice.prompt });
        // The PDF prints a plain choice as one line; say what each option tells the player.
        for (const option of stage.choice.options) lines.push({ speaker: "Narrator", text: `${option.label}: ${option.blurb}` });
        if (stage.choice.answer !== undefined) {
            const right = stage.choice.options.find(option => option.key === stage.choice.answer)?.label ?? stage.choice.answer;
            lines.push({ speaker: "Narrator", text: `A question. Right answer: ${right}. A wrong answer hears: ${stage.choice.wrong ?? ""}${stage.choice.backTo ? ` It sends the player back to the step "${stage.choice.backTo}".` : ""}` });
        }
    }
    return { index, title: `${stage.kind} (${stage.key})`, scene: questStageCaption(stage, line), speaker: "Narrator", lines, choices };
}

/**
 * Every quest in the catalogue, in catalogue order. Each opens with its offer
 * and closes with its closing scene, with its steps between: read top to
 * bottom, a scene is the quest's whole script.
 */
export function questLinePdfScenes(): QuestLinePdfScene[] {
    return Object.values(LINES).map(line => {
        const offer = line.scenes?.offer.length ? [scenePage(0, "offer", `Heard before the quest is taken, from ${castName(line.giver)}.`, spoken(line.scenes.offer))] : [];
        const steps = line.stages.map((stage, index) => stagePage(line, stage, offer.length + index));
        const done = line.scenes?.done.length ? [scenePage(offer.length + steps.length, "closing", "Heard when every step is passed, before the reward is claimed.", spoken(line.scenes.done))] : [];
        return {
            kind: "side" as const,
            title: `${line.title} (${line.id})`,
            note: gateNote(line),
            editLocator: `api/quests/_coast-script.ts and _catalog.ts → ${line.id}`,
            backdrop: null,
            pages: [...offer, ...steps, ...done],
        };
    });
}
