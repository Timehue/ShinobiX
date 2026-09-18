// Development/QA only. Never import this eager story catalog from game routes.
import { storylines } from "../../data/storylines";
import { storyInterludesByVillage } from "../../data/story-interludes";
import { storyRoadEvents } from "../../data/story-road-events";
import { storyEpiloguesByVillage } from "../../data/story-epilogues";
import { hollowRifts } from "../../data/hollow-rifts";
import { awakeningLv2VnEvent, auraSphereLv9VnEvent, hiddenDungeonVnEvent, craftDungeonEvents } from "../../data/vn-events";
import { defaultAncientChestVn, defaultPetEncounterVn } from "../../data/default-vn-events";
import { storyToCreatorEvent, interludeToCreatorEvent } from "../../lib/story-trigger";
import { roadEventToCreatorEvent } from "../../lib/story-road-events";
import { selectStoryEpilogueEvent } from "../../lib/story-epilogue";
import { riftIntroEvent, riftDescentEvent, riftFirstClearEvent } from "../../lib/hollow-rifts";
import { scribeIntroEvent } from "../../lib/chronicle-scribe";
import { buildSageVnEvent } from "../../lib/legacy-sage-vn";
import type { Character } from "../../types/character";
import type { CreatorEvent } from "../../types/vn";
import { storyFieldScenes } from "../../data/story-field-scenes";
import { storyReckonings } from "../../data/story-reckonings";
import { seedStoryFieldContentForTests } from "../../lib/story-field-content-loader";
import { storyFieldPointEvent, storyFieldAftermathEvent } from "../../lib/story-field-work";
import { storyReckoningIntroEvent, storyReckoningPayoffEvent } from "../../lib/story-reckonings";
import { STORY_FIELD_JOURNEYS, storyFieldPointId, storyFieldTraits, type StoryFieldProgress } from "../../../../shared/story-field-work";
import { ECHOES_OPPONENTS, ECHOES_ERAS } from "../../data/echoes-of-war";
import { ECHOES_SCENES, ECHOES_ERA_INTROS, ECHOES_WITNESS_CONTENT } from "../../data/echoes-of-war-scenes";
import { echoesReactiveEraIntro, echoesReactiveVictory } from "../../lib/echoes-witness-scenes";
import { ECHOES_BATTLE_BEATS, ECHOES_WITNESS_ERAS } from "../../../../shared/echoes-witness";
import { buildCompletedStoryArchive } from "../../lib/story-archive";
import { makeStoryChoiceReceipt } from "../../lib/story-choice-history";
import type { StoryContentVillage } from "../../lib/story-content-contract";

export type ArtAuditEntry = { key: string; source: string; conditions: unknown; event: CreatorEvent };
export async function artAuditCatalog(): Promise<ArtAuditEntry[]> {
    const entries: ArtAuditEntry[] = [];
    const add = (source: string, event: CreatorEvent, conditions: unknown = {}, suffix = "") =>
        entries.push({ key: event.id + suffix, source, conditions, event });
    for (const [village, chapters] of Object.entries(storylines)) {
        chapters.forEach((chapter, index) => add("src/data/storylines.ts", storyToCreatorEvent(chapter, village, index), { level: chapter.levelReq, progress: index }));
        // Every intake answer through the actual durable-history replay builder.
        const source = storyToCreatorEvent(chapters[0], village, 0);
        for (const [branch, answer] of (source.vnPages![1].choices ?? []).entries()) {
            const receipts = [makeStoryChoiceReceipt(source, 1, branch, answer)];
            let pageIndex = answer.nextPage;
            const visited = new Set<number>();
            while (pageIndex >= 0 && pageIndex < source.vnPages!.length && !visited.has(pageIndex)) {
                visited.add(pageIndex);
                const page = source.vnPages![pageIndex];
                const choice = page.choices?.[0];
                if (!choice) { pageIndex++; continue; }
                receipts.push(makeStoryChoiceReceipt(source, pageIndex, 0, choice));
                if (choice.battle) break;
                pageIndex = choice.nextPage;
            }
            const archive = buildCompletedStoryArchive({ village, storyProgress: 1, storyChoices: receipts, storyTraits: receipts.flatMap((r) => r.trait ? [r.trait] : []) } as Character,
                { schemaVersion: 1, village: village as StoryContentVillage, chapters, interludes: [] });
            add("src/data/storylines.ts", archive[0].replayEvent, { replay: true, branch, receipts, historyComplete: archive[0].historyComplete }, `:archive-${branch}`);
        }
    }
    for (const interlude of Object.values(storyInterludesByVillage).flat()) {
        add("src/data/story-interludes.ts", interludeToCreatorEvent(interlude), { level: interlude.levelReq, progress: interlude.minProgress });
    }
    for (const road of storyRoadEvents) add("src/data/story-road-events.ts", roadEventToCreatorEvent(road, "forest"));
    for (const [village, defs] of Object.entries(storyEpiloguesByVillage)) {
        for (const [index, def] of defs.entries()) {
            const traits = [def.requireTrait, ...(def.requireAnyTrait ?? [])].filter(Boolean) as string[];
            const event = await selectStoryEpilogueEvent({ village, storyTraits: traits } as Character, def.lane, traits, [def]);
            if (event) add("src/data/story-epilogues.ts", event, { lane: def.lane, requireTrait: def.requireTrait, requireAnyTrait: def.requireAnyTrait }, `:${index}`);
        }
    }
    for (const rift of hollowRifts) {
        add("src/data/hollow-rifts.ts", riftIntroEvent(rift, 20, "shadow"));
        add("src/lib/hollow-rifts.ts", riftIntroEvent(rift, 20, "shadow", { [rift.id]: true }), { firstClear: rift.id }, ":repeat");
        add("src/data/hollow-rifts.ts", riftDescentEvent(rift, "shadow"));
        const aftermath = riftFirstClearEvent(rift.id, "shadow");
        if (aftermath) add("src/lib/hollow-rifts.ts", aftermath, { firstClear: rift.id });
    }
    for (const event of [awakeningLv2VnEvent, auraSphereLv9VnEvent, hiddenDungeonVnEvent, ...craftDungeonEvents]) add("src/data/vn-events.ts", event);
    for (const event of [defaultAncientChestVn, defaultPetEncounterVn]) add("src/data/default-vn-events.ts", event);
    add("src/lib/chronicle-scribe.ts", scribeIntroEvent("forest"));
    add("src/lib/legacy-sage-vn.ts", buildSageVnEvent({ offers: [] } as unknown as Parameters<typeof buildSageVnEvent>[0], "QA Shinobi"), { offers: "Server-selected names are dynamic; empty offer sample" });
    seedStoryFieldContentForTests({ schemaVersion: 1, scenes: storyFieldScenes, reckonings: storyReckonings });
    for (const quest of storyReckonings) {
        add("src/data/story-reckonings.ts", storyReckoningIntroEvent(quest, "central"));
        const gates = [...new Set(quest.payoff.flatMap((page) => [page.requireTrait, page.forbidTrait]).filter(Boolean))] as string[];
        // Include each distinct trait-filtered payoff, never an impossible merged page set.
        for (let bits = 0; bits < 2 ** gates.length; bits++) {
            const traits = gates.filter((_, index) => bits & (1 << index));
            add("src/data/story-reckonings.ts", storyReckoningPayoffEvent(quest, "central", { storyTraits: traits } as Character), { traits }, `:traits-${bits}`);
        }
    }
    for (const [questId, graph] of Object.entries(STORY_FIELD_JOURNEYS)) {
        const quest = storyReckonings.find((q) => q.id === questId)!;
        for (const [route, firstChoice] of Object.keys(graph.points[graph.startPointId].choices).entries()) {
            const progress: StoryFieldProgress = { version: 1, visits: [] };
            const character = () => ({ name: "QA Shinobi", village: quest.village, storyFieldRecords: { [questId]: progress }, storyTraits: storyFieldTraits({ [questId]: progress }) }) as Character;
            let pointId: string | null = graph.startPointId;
            while (pointId) {
                const event = storyFieldPointEvent(questId, pointId, character(), "central");
                if (event) add("src/data/story-field-scenes.ts", event, { route, visits: [...progress.visits] }, `:route-${route}`);
                const choiceId = progress.visits.length ? Object.keys(graph.points[pointId].choices)[0] : firstChoice;
                progress.visits.push({ pointId, choiceId });
                const replay = storyFieldPointEvent(questId, pointId, character(), "central", true);
                if (replay) add("src/data/story-field-scenes.ts", replay, { route, replay: true, visits: [...progress.visits] }, `:replay-${route}`);
                pointId = storyFieldPointId(questId, progress);
            }
            const complete = character();
            complete.storyTraits!.push(quest.completionTrait);
            const aftermath = storyFieldAftermathEvent(questId, complete, "central");
            if (aftermath) add("src/data/story-field-scenes.ts", aftermath, { route, complete: true }, `:route-${route}`);
        }
        const legacy = storyFieldAftermathEvent(questId, { village: quest.village, storyTraits: [quest.completionTrait] } as Character, "central");
        if (legacy) add("src/data/story-field-scenes.ts", legacy, { legacySave: true }, ":legacy");
    }
    // Mirrors the screen's reward-free wrapper. No Showdown or card data writes.
    const echoEvent = (id: string, name: string, image: string, pages: NonNullable<CreatorEvent["vnPages"]>, avatarImage?: string): CreatorEvent => ({ id, name, image, avatarImage, biome: "central", icon: "QA", eventKind: "visualNovel", levelReq: 0, xpReward: 0, ryoReward: 0, staminaReward: 0, dialogue: [], vnPages: pages });
    for (const opponent of ECHOES_OPPONENTS) {
        const scenes = ECHOES_SCENES[opponent.id];
        for (const [kind, pages] of Object.entries({ pre: scenes.preShowdown, defeat: scenes.defeat, victory: scenes.firstVictory, rematch: scenes.rematch })) {
            add("src/data/echoes-of-war-scenes.ts", echoEvent(`${opponent.id}-${kind}`, opponent.name, opponent.sceneImage, pages, opponent.portrait));
        }
        const witnessEra = ECHOES_WITNESS_ERAS.find((era) => era.closeEncounterId === opponent.id);
        if (witnessEra) for (const beat of ECHOES_BATTLE_BEATS) {
            const pages = echoesReactiveVictory(opponent.id, scenes.firstVictory, beat, {}, ECHOES_WITNESS_CONTENT);
            add("src/data/echoes-of-war-scenes.ts", echoEvent(`${opponent.id}-victory`, opponent.name, opponent.sceneImage, pages, opponent.portrait), { battleBeat: beat }, `:${beat}`);
        }
        if (opponent.id === "echoes-10-halden") for (const era of ECHOES_WITNESS_ERAS.slice(0, 3)) for (const choice of era.choices) {
            const pages = echoesReactiveVictory(opponent.id, scenes.firstVictory, "unrecorded", { [era.id]: choice }, ECHOES_WITNESS_CONTENT);
            add("src/data/echoes-of-war-scenes.ts", echoEvent(`${opponent.id}-victory`, opponent.name, opponent.sceneImage, pages, opponent.portrait), { priorWitness: { [era.id]: choice } }, `:${choice}`);
        }
    }
    for (const [eraIndex, era] of ECHOES_ERAS.entries()) {
        const pages = ECHOES_ERA_INTROS[era.id];
        if (pages) add("src/data/echoes-of-war-scenes.ts", echoEvent(`${era.id}-intro`, era.title, era.plateImage, pages));
        const previous = ECHOES_WITNESS_ERAS[eraIndex - 1];
        if (previous) for (const choice of previous.choices) {
            const reactive = echoesReactiveEraIntro(era.id, pages, { [previous.id]: choice }, ECHOES_WITNESS_CONTENT);
            if (reactive) add("src/data/echoes-of-war-scenes.ts", echoEvent(`${era.id}-intro`, era.title, era.plateImage, reactive), { priorWitness: { [previous.id]: choice } }, `:${choice}`);
        }
    }
    return entries;
}
