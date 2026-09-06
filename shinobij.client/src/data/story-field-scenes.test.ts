import { test } from "node:test";
import assert from "node:assert/strict";
import { STORY_FIELD_JOURNEYS } from "../../../shared/story-field-work";
import { storyFieldScenes } from "./story-field-scenes";

test("field-scene prose covers the exact durable quest graph", () => {
    assert.deepEqual(Object.keys(storyFieldScenes).sort(), Object.keys(STORY_FIELD_JOURNEYS).sort());

    for (const [questId, graph] of Object.entries(STORY_FIELD_JOURNEYS)) {
        const authored = storyFieldScenes[questId];
        assert.ok(authored, `${questId} has authored field scenes`);
        assert.deepEqual(Object.keys(authored.points).sort(), Object.keys(graph.points).sort(), `${questId} point IDs`);

        for (const [pointId, graphPoint] of Object.entries(graph.points)) {
            const point = authored.points[pointId];
            assert.ok(point.name.trim(), `${questId}/${pointId} has a place name`);
            assert.ok(point.greeting.trim(), `${questId}/${pointId} has a greeting`);
            assert.ok(point.objective.trim(), `${questId}/${pointId} has an objective`);
            assert.ok(point.pages.length > 0, `${questId}/${pointId} has dialogue pages`);
            assert.ok(point.pages.every((page) => page.dialogue.length > 0), `${questId}/${pointId} pages have dialogue`);

            const authoredChoiceIds = point.pages.flatMap((page) => page.choices ?? []).map((choice) => choice.id);
            assert.ok(authoredChoiceIds.every(Boolean), `${questId}/${pointId} choices use stable IDs`);
            assert.deepEqual(authoredChoiceIds.sort(), Object.keys(graphPoint.choices).sort(), `${questId}/${pointId} choice IDs`);
            assert.ok(point.pages.at(-1)?.choices?.length, `${questId}/${pointId} ends on its field choice`);
        }

        const routeTraits = Object.values(graph.points)
            .flatMap((point) => Object.values(point.choices))
            .map((choice) => choice.trait)
            .filter((trait): trait is string => Boolean(trait));
        assert.deepEqual(authored.aftermath.map((page) => page.requireTrait).sort(), routeTraits.sort(), `${questId} route aftermath gates`);
        assert.ok(authored.legacyAftermath?.length, `${questId} gives legacy completions a route-neutral revisit`);
        assert.ok(authored.legacyAftermath?.every((page) => !page.requireTrait && !page.forbidTrait));
    }
});

test("the four recovery quests keep distinct enacted costs", () => {
    const copy = (questId: string) => Object.values(storyFieldScenes[questId].points)
        .flatMap((point) => point.pages)
        .flatMap((page) => page.dialogue)
        .join(" ");

    assert.match(copy("story-reckoning-mira-marker"), /west mast waits until tomorrow/i);
    assert.match(copy("story-reckoning-mira-marker"), /storm rail/i);
    assert.match(copy("story-reckoning-toma-cinders"), /still owe the bridge|go back.*broken crossing/i);
    assert.match(copy("story-reckoning-sova-true-roll"), /who waits.*both crews/i);
    assert.match(copy("story-reckoning-nyx-ledger"), /if that notice goes up, they walk away/i);
    assert.match(copy("story-reckoning-nyx-ledger"), /someone who said no to being named/i);
});
