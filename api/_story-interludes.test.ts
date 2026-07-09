import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORY_INTERLUDE_DEFS } from './_story-interludes.js';
// The client data module is import-safe here on purpose: it has zero imports
// (see its header comment). Dynamic import because this file type-checks as
// CommonJS under tsconfig.cpanel.json while the client package is ESM; tsx
// executes it fine either way. If the import breaks, fix the data module,
// not this test.
type ClientChoice = { text: string; conclusion: string; trait: string; lane: string; nextPage: number };
type ClientPage = { title: string; scene: string; speaker: string; dialogue: string[]; choices?: ClientChoice[] };
type ClientInterlude = { id: string; village: string; levelReq: number; minProgress: number; title: string; pages: ClientPage[] };

async function loadClientInterludes(): Promise<Record<string, ClientInterlude[]>> {
    // Computed specifier on purpose: tsx resolves it at runtime, but tsc does NOT
    // pull the client module into the cpanel compile (a literal import makes tsc
    // emit a stray dist/shinobij.client/ subtree).
    const specifier = '../shinobij.client/src/data/story-interludes.js';
    const mod = (await import(specifier)) as { storyInterludesByVillage: Record<string, ClientInterlude[]> };
    return mod.storyInterludesByVillage;
}

const VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];
const LEVELS = [20, 30, 42, 58, 70, 80, 92];
const MIN_PROGRESS: Record<number, number> = { 20: 2, 30: 3, 42: 4, 58: 5, 70: 6, 80: 7, 92: 8 };
const RELATIONSHIP_TRAITS: Record<string, string[]> = {
    'Stormveil Village': ['mira-trust', 'mira-respect', 'mira-fear'],
    'Ashen Leaf Village': ['toma-hope', 'toma-caution', 'toma-doubt'],
    'Frostfang Village': ['yura-trust', 'yura-respect', 'yura-fear'],
    'Moonshadow Village': ['nyx-partner', 'nyx-respect', 'nyx-suspicion'],
};

test('every village has the seven interludes at the planned levels and gates', async () => {
    const storyInterludesByVillage = await loadClientInterludes();
    assert.deepEqual(Object.keys(storyInterludesByVillage).sort(), [...VILLAGES].sort());
    for (const village of VILLAGES) {
        const entries = storyInterludesByVillage[village];
        assert.equal(entries.length, 7, village);
        assert.deepEqual(entries.map((e) => e.levelReq), LEVELS, village);
        for (const entry of entries) {
            assert.equal(entry.minProgress, MIN_PROGRESS[entry.levelReq], entry.id);
            assert.equal(entry.village, village, entry.id);
            assert.match(entry.id, /^story-interlude-[a-z-]+-\d+$/, entry.id);
        }
    }
});

test('client interludes and the server catalog agree exactly', async () => {
    const storyInterludesByVillage = await loadClientInterludes();
    const clientIds = new Set<string>();
    for (const village of VILLAGES) {
        for (const entry of storyInterludesByVillage[village]) {
            clientIds.add(entry.id);
            const def = STORY_INTERLUDE_DEFS[entry.id];
            assert.ok(def, `server def missing for ${entry.id}`);
            assert.equal(def.village, entry.village, entry.id);
            assert.equal(def.levelReq, entry.levelReq, entry.id);
            assert.equal(def.minProgress, entry.minProgress, entry.id);
            const choices = entry.pages[entry.pages.length - 1].choices ?? [];
            assert.deepEqual(
                choices.map((c) => c.trait).sort(),
                Object.keys(def.traits).sort(),
                `trait drift on ${entry.id}`,
            );
            for (const choice of choices) {
                assert.equal(def.traits[choice.trait], choice.lane, `lane drift on ${entry.id}/${choice.trait}`);
            }
        }
    }
    assert.deepEqual(Object.keys(STORY_INTERLUDE_DEFS).sort(), [...clientIds].sort(), 'server catalog has extra/missing ids');
});

test('interlude choices are well-formed: one per lane, unique traits, self-pointing ends', async () => {
    const storyInterludesByVillage = await loadClientInterludes();
    const seen = new Set<string>();
    for (const village of VILLAGES) {
        for (const entry of storyInterludesByVillage[village]) {
            const lastIndex = entry.pages.length - 1;
            for (const [i, page] of entry.pages.entries()) {
                assert.ok(page.dialogue.length >= 1, `${entry.id} page ${i} has no dialogue`);
                if (i < lastIndex) assert.ok(!page.choices?.length, `${entry.id}: choices must live on the final page only`);
            }
            const choices = entry.pages[lastIndex].choices ?? [];
            assert.equal(choices.length, 3, entry.id);
            assert.deepEqual(choices.map((c) => c.lane).sort(), ['bad', 'good', 'neutral'], entry.id);
            for (const choice of choices) {
                assert.ok(choice.text.trim(), `${entry.id}: empty choice text`);
                assert.ok(choice.conclusion.trim(), `${entry.id}: every interlude choice needs an aftermath conclusion`);
                assert.equal(choice.nextPage, lastIndex, `${entry.id}: interlude choices self-point to conclude the scene`);
                assert.ok(!seen.has(choice.trait), `duplicate trait across interludes: ${choice.trait}`);
                seen.add(choice.trait);
            }
        }
    }
});

test('traits follow the naming scheme; level-30 scenes seed the relationship trio', async () => {
    const storyInterludesByVillage = await loadClientInterludes();
    const PREFIX: Record<string, string> = {
        'Stormveil Village': 'sv',
        'Ashen Leaf Village': 'al',
        'Frostfang Village': 'ff',
        'Moonshadow Village': 'ms',
    };
    for (const village of VILLAGES) {
        for (const entry of storyInterludesByVillage[village]) {
            const traits = (entry.pages[entry.pages.length - 1].choices ?? []).map((c) => c.trait);
            if (entry.levelReq === 30) {
                assert.deepEqual(traits.sort(), [...RELATIONSHIP_TRAITS[village]].sort(), entry.id);
            } else {
                for (const trait of traits) {
                    assert.ok(trait.startsWith(`${PREFIX[village]}${entry.levelReq}-`), `${entry.id}: trait ${trait} off-scheme`);
                }
            }
        }
    }
});
