import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORY_ROAD_EVENT_DEFS } from './_story-road-events.js';
import { STORY_INTERLUDE_DEFS } from './_story-interludes.js';

type ClientChoice = { text: string; conclusion: string; trait: string; lane: string; nextPage: number; battle?: { bossName: string; bossIcon: string } };
type ClientPage = { title: string; scene: string; speaker: string; dialogue: string[]; choices?: ClientChoice[] };
type ClientRoadEvent = { id: string; slug: string; levelReq: number; minProgress: number; title: string; npcName: string; npcArchetype: string; pages: ClientPage[] };

const LEVELS = [22, 26, 31, 34, 38, 44, 48, 52, 56, 62, 66, 74, 82, 94, 100];

async function loadClientRoadEvents(): Promise<ClientRoadEvent[]> {
    // Computed specifier on purpose: tsx resolves it at runtime, but tsc does NOT
    // pull the client module into the cpanel compile.
    const specifier = '../shinobij.client/src/data/story-road-events.js';
    const mod = (await import(specifier)) as { storyRoadEvents: ClientRoadEvent[] };
    return mod.storyRoadEvents;
}

test('the fifteen road events exist at the planned levels, sorted, with sane gates', async () => {
    const events = await loadClientRoadEvents();
    assert.equal(events.length, 15);
    assert.deepEqual(events.map((e) => e.levelReq), LEVELS);
    for (const event of events) {
        assert.match(event.id, /^story-road-[a-z-]+$/, event.id);
        assert.equal(event.minProgress, event.levelReq >= 100 ? 9 : 0, `${event.id}: Seat of Scars alone is post-finale`);
        assert.ok(event.npcName.trim(), event.id);
    }
});

test('client road events and the server catalog agree exactly', async () => {
    const events = await loadClientRoadEvents();
    const clientIds = new Set<string>();
    for (const event of events) {
        clientIds.add(event.id);
        const def = STORY_ROAD_EVENT_DEFS[event.id];
        assert.ok(def, `server def missing for ${event.id}`);
        assert.equal(def.levelReq, event.levelReq, event.id);
        assert.equal(def.minProgress, event.minProgress, event.id);
        const choices = event.pages[event.pages.length - 1].choices ?? [];
        assert.deepEqual(choices.map((c) => c.trait).sort(), Object.keys(def.traits).sort(), `trait drift on ${event.id}`);
        for (const choice of choices) {
            assert.equal(def.traits[choice.trait], choice.lane, `lane drift on ${event.id}/${choice.trait}`);
        }
    }
    assert.deepEqual(Object.keys(STORY_ROAD_EVENT_DEFS).sort(), [...clientIds].sort(), 'server catalog has extra/missing ids');
});

test('road-event choices are well-formed and traits are globally unique (vs interludes too)', async () => {
    const events = await loadClientRoadEvents();
    const seen = new Set<string>(
        Object.values(STORY_INTERLUDE_DEFS).flatMap((def) => Object.keys(def.traits)),
    );
    for (const event of events) {
        const lastIndex = event.pages.length - 1;
        for (const [i, page] of event.pages.entries()) {
            assert.ok(page.dialogue.length >= 1, `${event.id} page ${i} has no dialogue`);
            if (i < lastIndex) assert.ok(!page.choices?.length, `${event.id}: choices live on the final page only`);
        }
        const choices = event.pages[lastIndex].choices ?? [];
        assert.equal(choices.length, 3, event.id);
        assert.deepEqual(choices.map((c) => c.lane).sort(), ['bad', 'good', 'neutral'], event.id);
        for (const choice of choices) {
            assert.ok(choice.text.trim() && choice.conclusion.trim(), `${event.id}: empty text/conclusion`);
            assert.equal(choice.nextPage, lastIndex, `${event.id}: choices self-point to conclude`);
            assert.ok(choice.trait.startsWith(`rd${event.levelReq}-`), `${event.id}: trait ${choice.trait} off-scheme`);
            assert.ok(!seen.has(choice.trait), `duplicate trait across story content: ${choice.trait}`);
            seen.add(choice.trait);
            if (choice.battle) {
                assert.ok(choice.battle.bossName.trim(), `${event.id}: battle without a boss name`);
                assert.ok(choice.battle.bossIcon.trim(), `${event.id}: battle without an icon`);
            }
        }
    }
});
