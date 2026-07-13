"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _story_road_events_js_1 = require("./_story-road-events.js");
const _story_interludes_js_1 = require("./_story-interludes.js");
const LEVELS = [22, 26, 31, 34, 38, 44, 48, 52, 56, 62, 66, 74, 82, 94, 100];
async function loadClientRoadEvents() {
    // Computed specifier on purpose: tsx resolves it at runtime, but tsc does NOT
    // pull the client module into the cpanel compile.
    const specifier = '../shinobij.client/src/data/story-road-events.js';
    const mod = (await import(specifier));
    return mod.storyRoadEvents;
}
(0, node_test_1.test)('the fifteen road events exist at the planned levels, sorted, with sane gates', async () => {
    const events = await loadClientRoadEvents();
    strict_1.default.equal(events.length, 15);
    strict_1.default.deepEqual(events.map((e) => e.levelReq), LEVELS);
    for (const event of events) {
        strict_1.default.match(event.id, /^story-road-[a-z-]+$/, event.id);
        strict_1.default.equal(event.minProgress, event.levelReq >= 100 ? 9 : 0, `${event.id}: Seat of Scars alone is post-finale`);
        strict_1.default.ok(event.npcName.trim(), event.id);
    }
});
(0, node_test_1.test)('client road events and the server catalog agree exactly', async () => {
    const events = await loadClientRoadEvents();
    const clientIds = new Set();
    for (const event of events) {
        clientIds.add(event.id);
        const def = _story_road_events_js_1.STORY_ROAD_EVENT_DEFS[event.id];
        strict_1.default.ok(def, `server def missing for ${event.id}`);
        strict_1.default.equal(def.levelReq, event.levelReq, event.id);
        strict_1.default.equal(def.minProgress, event.minProgress, event.id);
        const choices = event.pages[event.pages.length - 1].choices ?? [];
        strict_1.default.deepEqual(choices.map((c) => c.trait).sort(), Object.keys(def.traits).sort(), `trait drift on ${event.id}`);
        for (const choice of choices) {
            strict_1.default.equal(def.traits[choice.trait], choice.lane, `lane drift on ${event.id}/${choice.trait}`);
        }
    }
    strict_1.default.deepEqual(Object.keys(_story_road_events_js_1.STORY_ROAD_EVENT_DEFS).sort(), [...clientIds].sort(), 'server catalog has extra/missing ids');
});
(0, node_test_1.test)('road-event choices are well-formed and traits are globally unique (vs interludes too)', async () => {
    const events = await loadClientRoadEvents();
    const seen = new Set(Object.values(_story_interludes_js_1.STORY_INTERLUDE_DEFS).flatMap((def) => Object.keys(def.traits)));
    for (const event of events) {
        const lastIndex = event.pages.length - 1;
        for (const [i, page] of event.pages.entries()) {
            strict_1.default.ok(page.dialogue.length >= 1, `${event.id} page ${i} has no dialogue`);
            if (i < lastIndex)
                strict_1.default.ok(!page.choices?.length, `${event.id}: choices live on the final page only`);
        }
        const choices = event.pages[lastIndex].choices ?? [];
        strict_1.default.equal(choices.length, 3, event.id);
        strict_1.default.deepEqual(choices.map((c) => c.lane).sort(), ['bad', 'good', 'neutral'], event.id);
        for (const choice of choices) {
            strict_1.default.ok(choice.text.trim() && choice.conclusion.trim(), `${event.id}: empty text/conclusion`);
            strict_1.default.equal(choice.nextPage, lastIndex, `${event.id}: choices self-point to conclude`);
            strict_1.default.ok(choice.trait.startsWith(`rd${event.levelReq}-`), `${event.id}: trait ${choice.trait} off-scheme`);
            strict_1.default.ok(!seen.has(choice.trait), `duplicate trait across story content: ${choice.trait}`);
            seen.add(choice.trait);
            if (choice.battle) {
                strict_1.default.ok(choice.battle.bossName.trim(), `${event.id}: battle without a boss name`);
                strict_1.default.ok(choice.battle.bossIcon.trim(), `${event.id}: battle without an icon`);
            }
        }
    }
});
