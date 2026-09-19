import test from 'node:test';
import assert from 'node:assert/strict';
import { auditScenes, sampleScenes, dashPunctuation, sourceProse, isDashException, DASH_EXCEPTIONS } from './narrative-audit.mts';
import { buildCorpus, supplementalSources, type Page, type Scene } from './narrative-corpus.mts';
import { auditCreatorExport, builtinNarrativeEvents } from './narrative-creator-content.mts';
import { buildCreatorExport } from './export-creator-content.mts';
import { defaultPetEncounterVn } from '../shinobij.client/src/data/default-vn-events.ts';
import { LEGACY_DEFS } from '../api/_legacy-defs.ts';
import { CHRONICLE_LEGACY_SOURCES } from '../shared/legacy-card-sources.ts';
const page = (choices: Page['choices']): Page => ({ title: 'A door', scene: 'A locked room', speaker: 'Keeper', dialogue: ['Run!'], choices });
const scene = (pages: Page[]): Scene => ({ id: 'test', family: 'test', source: 'fixture', context: '', graph: true, pages });
const errors = (s: Scene) => auditScenes([s]).filter(f => f.severity === 'error').map(f => f.code);
test('Chronicle Legacy descriptions match the authoritative deed records', () => {
    for (const source of CHRONICLE_LEGACY_SOURCES) {
        assert.equal(source.flavor, LEGACY_DEFS.find(def => def.id === source.id)?.flavor, source.id);
    }
});
test('audit rejects dangling targets, closed loops, hidden choices and orphan pages', () => {
    assert.ok(errors(scene([page([{ text: 'Leave', nextPage: 2 }])])).includes('branch-reference'));
    assert.ok(errors(scene([page([{ text: 'Next', nextPage: 1 }]), page([{ text: 'Back', nextPage: 0 }])])).includes('closed-branch'));
    assert.ok(errors(scene([page([{ text: 'Leave', nextPage: 0, requireTrait: 'key' }])])).includes('gated-dead-end'));
    assert.ok(errors(scene([page([{ text: 'Leave', nextPage: 0 }]), page(undefined)])).includes('unreachable-page'));
});
test('audit follows earned traits and allows a conversation hub with an exit', () => {
    assert.deepEqual(errors(scene([page([{ text: 'Take key', nextPage: 1, trait: 'key' }]), page([{ text: 'Leave', nextPage: 1, requireTrait: 'key' }])])), []);
    assert.deepEqual(errors(scene([page([{ text: 'Ask', nextPage: 1, requireTrait: 'memory' }, { text: 'Leave', nextPage: 0 }]), page([{ text: 'Back', nextPage: 0 }])])), []);
    // Each incoming key state has one visible choice; no false dead-end warning.
    assert.deepEqual(errors(scene([page([{ text: 'Open', nextPage: 0, requireTrait: 'key' }, { text: 'Knock', nextPage: 0, forbidTrait: 'key' }])])), []);
});
test('short dialogue stays advisory; unresolved variables and duplicate identities fail', () => {
    const s = scene([page(undefined)]);
    assert.deepEqual(errors(s), []);
    assert.ok(auditScenes([s]).some(f => f.code === 'short-line' && f.severity === 'warning'));
    s.pages[0].dialogue = ['Hello {nam}.'];
    assert.ok(errors(s).includes('unknown-variable'));
    assert.ok(auditScenes([s, s]).some(f => f.code === 'duplicate-scene'));
});
test('whole corpus passes structural checks; sampling is repeatable and spans families and villages', () => {
    const corpus = buildCorpus();
    assert.deepEqual(auditScenes(corpus).filter(f => f.severity === 'error'), []);
    const sample = sampleScenes(corpus, 26, 20260919);
    assert.deepEqual(sample.map(s => s.id), sampleScenes(corpus, 26, 20260919).map(s => s.id));
    assert.equal(new Set(sample.map(s => s.family)).size, new Set(corpus.map(s => s.family)).size);
    assert.equal(new Set(sample.filter(s => s.family === 'campaign').map(s => s.village)).size, 4);
});
test('dash rule: pauses fail, word hyphens, math and code do not', () => {
    for (const pause of ['I thought I knew him—but I didn\'t.', 'Not fear – recognition.', 'Wait - listen.', 'He stopped -- then ran.', 'Stay here -and hide.', 'It was—', '"Wait-"', 'Lower the gate- now.', 'Rift \u2212 closed'])
        assert.ok(dashPunctuation(pause), pause);
    for (const legit of ['first-clear rewards', 'a level-gated door', 'a twenty-year-old record', 'first- and second-rank seals', 'Pet gear: +25% Attack, \u221212% Defense', 'Take -5 damage', 'fp-palette-${npc.palette}', 'drop-shadow(0 0 5px var(--purple-400))', '${a} - ${b}'.replace(' - ', '-')])
        assert.equal(dashPunctuation(legit), undefined, legit);
    assert.ok(dashPunctuation('${hunter} \u2014 ${bounty} ryo'), 'template code does not hide a pause between values');
    assert.ok(auditScenes([scene([page(undefined)])].map(s => ({ ...s, pages: [{ ...s.pages[0], dialogue: ['Keeper: Run\u2014now.'] }] }))).some(f => f.code === 'dash-punctuation' && f.severity === 'error'));
});
test('narrative source files outside the scene corpus carry no dash pauses', () => {
    const found = supplementalSources.flatMap(file => sourceProse(file).filter(({ text }) => dashPunctuation(text) && !isDashException(file, text)).map(({ line, text }) => `${file}:${line}: ${text}`));
    assert.deepEqual(found, []);
    for (const exception of DASH_EXCEPTIONS) assert.ok(exception.reason.trim(), `${exception.file} exception needs a reason`);
});
test('Creator export audit classifies stale built-in copies, custom scenes and id problems', () => {
    const builtins = builtinNarrativeEvents();
    const chapterId = 'story-frostfang-village-4-0';
    assert.ok(builtins.has(chapterId) && builtins.has('sys-pet-encounter') && builtins.has('pet-encounter'));
    const stale = { ...builtins.get(chapterId)!, vnPages: [{ title: 'The Pack Survives', scene: 'Snow', speaker: 'Elder Sova', dialogue: ['Elder Sova: It is my honor to meet someone chosen by the Frost Echo.'] }] };
    const custom = (overrides: Record<string, unknown> = {}) => ({ id: 'event-lanterns', name: 'Lantern Night', biome: 'forest', icon: 'L', eventKind: 'visualNovel', levelReq: 3, xpReward: 0, ryoReward: 0, staminaReward: 0, dialogue: [], vnPages: [{ title: 'Lanterns', scene: 'Dusk at the gate', speaker: 'Toma Reed', dialogue: ['Toma Reed: Hold the ladder steady. I\'ll hang the last one.'] }], ...overrides });
    const exported = {
        slots: {
            admin1: { creatorEvents: [custom({ vnPages: [{ title: 'Lanterns', scene: 'Dusk', speaker: 'Toma Reed', dialogue: ['Toma Reed: An older draft.'] }] })] },
            admin2: {
                creatorEvents: [stale, custom(), { id: 'bad id!', name: 'x' }, { id: 'story-not-a-real-chapter', name: 'Mislabelled', eventKind: 'visualNovel', dialogue: ['Narrator: Hi.'] },
                    { id: 'event-test', name: 'Ryo', eventKind: 'reward', ryoReward: 500000, levelReq: 1, xpReward: 0, staminaReward: 0, vnTitle: 'A Stranger', vnScene: 'Rain', vnSpeaker: 'Unknown Shinobi', dialogue: ['Admin Event: Test your strength, shinobi.'] },
                    { ...custom({ id: 'event-dup' }) }, { ...custom({ id: 'event-dup' }) }],
                petEncounterVn: { ...defaultPetEncounterVn },
            },
        },
        published: { creatorEvents: { field: 'creatorEvents', version: 2, value: [custom({ id: 'event-published', dialogue: [], vnPages: [{ title: 'Road', scene: 'A road', speaker: 'Narrator', dialogue: ['Narrator: A cart waits\u2014empty.'] }] })] } },
    };
    const { inventory, findings, summary } = auditCreatorExport(exported, 'fixture.json', builtins);
    const codes = (id: string) => findings.filter(f => f.scene.includes(id) || f.detail.includes(id)).map(f => f.code);
    assert.equal(inventory.find(row => row.id === chapterId)?.kind, 'stale-builtin-copy');
    assert.match(inventory.find(row => row.id === chapterId)?.note ?? '', /retired lore: Frost Echo/);
    assert.equal(inventory.find(row => row.id === 'sys-pet-encounter')?.kind, 'current-builtin-copy');
    assert.ok(codes('event-lanterns').includes('creator-shadowed-copy'), 'admin2 replacing a different admin1 copy is reported');
    assert.ok(codes('bad id!').includes('creator-invalid-id'));
    assert.ok(codes('story-not-a-real-chapter').includes('creator-reserved-id'));
    assert.ok(codes('event-test').includes('creator-placeholder'));
    assert.ok(codes('event-dup').includes('creator-duplicate-id'));
    assert.equal(inventory.find(row => row.id === 'event-test')?.visibility, 'admin-only');
    assert.equal(inventory.find(row => row.id === 'event-lanterns')?.visibility, 'player-visible');
    assert.equal(summary.sources.find(s => s.name === 'published')?.events, 1, 'content-store records are unwrapped');
    // Custom scenes join the scene audit, so the dash rule and structural checks apply to them too.
    const { scenes } = auditCreatorExport(exported, 'fixture.json', builtins);
    assert.ok(auditScenes(scenes).some(f => f.code === 'dash-punctuation' && f.scene.startsWith('creator/event-published')));
});
test('Creator export script keeps only narrative fields and never invents published content', () => {
    const exported = buildCreatorExport({ admin1: { creatorEvents: [{ id: 'event-a' }], ryo: 99, password: 'x' }, admin2: null }, 'fixture', new Date(0));
    assert.deepEqual(Object.keys(exported.slots.admin1).sort(), ['ancientChestVn', 'creatorEvents', 'creatorMissions', 'creatorRaids', 'hollowGateEventConfig', 'petEncounterVn']);
    assert.equal(JSON.stringify(exported).includes('password'), false);
    assert.deepEqual(exported.published, {});
    assert.equal(auditCreatorExport(exported, 'fixture').summary.custom, 1);
});
