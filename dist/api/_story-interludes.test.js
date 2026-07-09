"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _story_interludes_js_1 = require("./_story-interludes.js");
async function loadClientInterludes() {
    // Computed specifier on purpose: tsx resolves it at runtime, but tsc does NOT
    // pull the client module into the cpanel compile (a literal import makes tsc
    // emit a stray dist/shinobij.client/ subtree).
    const specifier = '../shinobij.client/src/data/story-interludes.js';
    const mod = (await import(specifier));
    return mod.storyInterludesByVillage;
}
const VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];
const LEVELS = [20, 30, 42, 58, 70, 80, 92];
const MIN_PROGRESS = { 20: 2, 30: 3, 42: 4, 58: 5, 70: 6, 80: 7, 92: 8 };
const RELATIONSHIP_TRAITS = {
    'Stormveil Village': ['mira-trust', 'mira-respect', 'mira-fear'],
    'Ashen Leaf Village': ['toma-hope', 'toma-caution', 'toma-doubt'],
    'Frostfang Village': ['yura-trust', 'yura-respect', 'yura-fear'],
    'Moonshadow Village': ['nyx-partner', 'nyx-respect', 'nyx-suspicion'],
};
(0, node_test_1.test)('every village has the seven interludes at the planned levels and gates', async () => {
    const storyInterludesByVillage = await loadClientInterludes();
    strict_1.default.deepEqual(Object.keys(storyInterludesByVillage).sort(), [...VILLAGES].sort());
    for (const village of VILLAGES) {
        const entries = storyInterludesByVillage[village];
        strict_1.default.equal(entries.length, 7, village);
        strict_1.default.deepEqual(entries.map((e) => e.levelReq), LEVELS, village);
        for (const entry of entries) {
            strict_1.default.equal(entry.minProgress, MIN_PROGRESS[entry.levelReq], entry.id);
            strict_1.default.equal(entry.village, village, entry.id);
            strict_1.default.match(entry.id, /^story-interlude-[a-z-]+-\d+$/, entry.id);
        }
    }
});
(0, node_test_1.test)('client interludes and the server catalog agree exactly', async () => {
    const storyInterludesByVillage = await loadClientInterludes();
    const clientIds = new Set();
    for (const village of VILLAGES) {
        for (const entry of storyInterludesByVillage[village]) {
            clientIds.add(entry.id);
            const def = _story_interludes_js_1.STORY_INTERLUDE_DEFS[entry.id];
            strict_1.default.ok(def, `server def missing for ${entry.id}`);
            strict_1.default.equal(def.village, entry.village, entry.id);
            strict_1.default.equal(def.levelReq, entry.levelReq, entry.id);
            strict_1.default.equal(def.minProgress, entry.minProgress, entry.id);
            const choices = entry.pages[entry.pages.length - 1].choices ?? [];
            strict_1.default.deepEqual(choices.map((c) => c.trait).sort(), Object.keys(def.traits).sort(), `trait drift on ${entry.id}`);
            for (const choice of choices) {
                strict_1.default.equal(def.traits[choice.trait], choice.lane, `lane drift on ${entry.id}/${choice.trait}`);
            }
        }
    }
    strict_1.default.deepEqual(Object.keys(_story_interludes_js_1.STORY_INTERLUDE_DEFS).sort(), [...clientIds].sort(), 'server catalog has extra/missing ids');
});
(0, node_test_1.test)('interlude choices are well-formed: one per lane, unique traits, self-pointing ends', async () => {
    const storyInterludesByVillage = await loadClientInterludes();
    const seen = new Set();
    for (const village of VILLAGES) {
        for (const entry of storyInterludesByVillage[village]) {
            const lastIndex = entry.pages.length - 1;
            const laneTraits = new Set((entry.pages[lastIndex].choices ?? []).map((c) => c.trait).filter(Boolean));
            for (const [i, page] of entry.pages.entries()) {
                strict_1.default.ok(page.dialogue.length >= 1, `${entry.id} page ${i} has no dialogue`);
                // Mid-scene choices may carry unique-scheme memory traits, but
                // never the recorded LANE traits (the decision the server
                // tallies lives on the final page only).
                if (i < lastIndex) {
                    for (const choice of page.choices ?? []) {
                        if (!choice.trait)
                            continue;
                        strict_1.default.ok(!laneTraits.has(choice.trait), `${entry.id} page ${i}: mid-scene choice grants lane trait ${choice.trait}`);
                        strict_1.default.ok(/^(sv|al|ff|ms|rd)\d+-/.test(choice.trait), `${entry.id} page ${i}: mid trait ${choice.trait} off-scheme`);
                    }
                }
            }
            const choices = entry.pages[lastIndex].choices ?? [];
            strict_1.default.equal(choices.length, 3, entry.id);
            strict_1.default.deepEqual(choices.map((c) => c.lane).sort(), ['bad', 'good', 'neutral'], entry.id);
            for (const choice of choices) {
                strict_1.default.ok(choice.text.trim(), `${entry.id}: empty choice text`);
                strict_1.default.ok(choice.conclusion.trim(), `${entry.id}: every interlude choice needs an aftermath conclusion`);
                strict_1.default.equal(choice.nextPage, lastIndex, `${entry.id}: interlude choices self-point to conclude the scene`);
                strict_1.default.ok(!seen.has(choice.trait), `duplicate trait across interludes: ${choice.trait}`);
                seen.add(choice.trait);
            }
        }
    }
});
(0, node_test_1.test)('traits follow the naming scheme; level-30 scenes seed the relationship trio', async () => {
    const storyInterludesByVillage = await loadClientInterludes();
    const PREFIX = {
        'Stormveil Village': 'sv',
        'Ashen Leaf Village': 'al',
        'Frostfang Village': 'ff',
        'Moonshadow Village': 'ms',
    };
    for (const village of VILLAGES) {
        for (const entry of storyInterludesByVillage[village]) {
            const traits = (entry.pages[entry.pages.length - 1].choices ?? []).map((c) => c.trait);
            if (entry.levelReq === 30) {
                strict_1.default.deepEqual(traits.sort(), [...RELATIONSHIP_TRAITS[village]].sort(), entry.id);
            }
            else {
                for (const trait of traits) {
                    strict_1.default.ok(trait.startsWith(`${PREFIX[village]}${entry.levelReq}-`), `${entry.id}: trait ${trait} off-scheme`);
                }
            }
        }
    }
});
