/** Developer-only inventory. Import authoring data and real builders, never generated copies. */
import { storylines } from '../shinobij.client/src/data/storylines.ts';
import { storyInterludesByVillage } from '../shinobij.client/src/data/story-interludes.ts';
import { storyRoadEvents } from '../shinobij.client/src/data/story-road-events.ts';
import { storyReckonings } from '../shinobij.client/src/data/story-reckonings.ts';
import { storyFieldScenes } from '../shinobij.client/src/data/story-field-scenes.ts';
import { storyEpiloguesByVillage } from '../shinobij.client/src/data/story-epilogues.ts';
import { hollowRifts } from '../shinobij.client/src/data/hollow-rifts.ts';
import { riftIntroEvent, riftDescentEvent, riftFirstClearEvent } from '../shinobij.client/src/lib/hollow-rifts.ts';
import { ECHOES_SCENES, ECHOES_ERA_INTROS, ECHOES_WITNESS_CONTENT } from '../shinobij.client/src/data/echoes-of-war-scenes.ts';
import * as systemEvents from '../shinobij.client/src/data/vn-events.ts';
import * as defaults from '../shinobij.client/src/data/default-vn-events.ts';
import { PET_TUTORIAL_LESSONS } from '../shinobij.client/src/lib/pet-tutorial.ts';
import { ACADEMY_VOWS, academyCeremony } from '../shinobij.client/src/lib/academy-narrative.ts';
import { PRE_GIFT_LINES, buildPostGiftLines, buildVowResponseLines, buildCompanionIntroLines, resolveCinematicLine } from '../shinobij.client/src/features/intro-cinematic/introCinematicScript.ts';
import { FIRST_PACT_MAIN_STEPS, FIRST_PACT_VOWS, createFirstPactProgress, FIRST_PACT_AFTERMATH_IDS } from '../shared/first-pact-contract.ts';
import { FIRST_PACT_NPCS } from '../shinobij.client/src/lib/first-pact-world.ts';
import { firstPactReactiveDialogue, firstPactEpilogue } from '../shinobij.client/src/screens/first-pact/narrative.ts';
import { EMISSARY_DEFS } from '../shinobij.client/src/lib/legacy-emissaries.ts';
import { RUMOR_CATEGORIES, rumorArc, TAVERN_GOSSIP } from '../shinobij.client/src/lib/legacy-rumors.ts';
import { scribeIntroEvent } from '../shinobij.client/src/lib/chronicle-scribe.ts';
import { WANDERER_ARCHETYPES } from '../shared/wanderer-roster.ts';
import { QUEST_BOOK } from '../shinobij.client/src/lib/questbook.ts';
import { CARAVAN_EVENTS } from '../shared/sunscar/caravan-events.ts';
import { CARAVAN_CONTRACTS } from '../shared/sunscar/caravan-contracts.ts';
import { RALLY_RIVALS } from '../shared/sunscar/rally-rivals.ts';
import { hollowGateFlavorPool, hollowGateIntroPages } from '../shinobij.client/src/data/hollow-gate-flavor.ts';
import { ERA_DEFS } from '../api/_era-defs.ts';
import { FLOOR_CATALOG } from '../api/towers/_floor-catalog.ts';
import { clanLore } from '../shinobij.client/src/data/clan-lore.ts';
import { SHRINE_DEFS } from '../shared/shrines.ts';
import { LEGACY_DEFS } from '../api/_legacy-defs.ts';
import { buildSageVnEvent } from '../shinobij.client/src/lib/legacy-sage-vn.ts';
import { CHRONICLE_CARD_CATALOG } from '../shared/chronicle-duel.ts';
import { rawPetPool } from '../shinobij.client/src/data/pet-pool.ts';
import { eventItems } from '../shinobij.client/src/data/event-items.ts';
import { starterItems } from '../shinobij.client/src/data/starter-items.ts';
export type Choice = {
    text: string;
    nextPage?: number;
    conclusion?: string;
    trait?: string;
    requireTrait?: string;
    forbidTrait?: string;
    battle?: unknown;
};
export type Page = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
    choices?: Choice[];
    lines?: {
        speaker: string;
        text: string;
    }[];
    requireTrait?: string;
    forbidTrait?: string;
};
export type Scene = {
    id: string;
    family: string;
    source: string;
    context: string;
    pages: Page[];
    graph: boolean;
    level?: number;
    village?: string;
    catalog?: boolean;
};
const data = (file: string) => `shinobij.client/src/data/${file}.ts`;
const lib = (file: string) => `shinobij.client/src/lib/${file}.ts`;
export const supplementalSources = [
    'shinobij.client/src/lib/legacy-sage-vn.ts', 'shinobij.client/src/lib/legacy-rumors.ts',
    'shinobij.client/src/lib/contract-hunter-wanderers.ts', 'shinobij.client/src/lib/wanderers.ts',
    'shinobij.client/src/lib/first-pact-interiors.ts', 'shinobij.client/src/lib/first-pact-aftermath.ts',
    'shared/first-pact-contract.ts', 'shinobij.client/src/screens/FirstPact.tsx',
    'shinobij.client/src/screens/first-pact/FirstPactCrossingPanel.tsx',
    'shinobij.client/src/components/AcademyStoryMoments.tsx', 'shinobij.client/src/components/OnboardingCoach.tsx',
    'shinobij.client/src/components/CardClashTutorial.tsx', 'shinobij.client/src/lib/first-contract.ts',
    'shinobij.client/src/data/missions.ts', 'api/missions/_mission-catalog.ts', 'api/sector/_wanderer-quest.ts',
    'shinobij.client/src/lib/pet-encounter-vn.ts', 'shinobij.client/src/lib/pet-tutorial-mentor.ts',
    'shinobij.client/src/lib/hollow-gate-presentation.ts', 'shinobij.client/src/lib/tower-story-catalog.ts',
    'api/towers/_spire-catalog.ts', 'shinobij.client/src/screens/WorldMap.tsx',
    'shinobij.client/src/data/echoes-of-war.ts', 'shinobij.client/src/lib/merc-roam-client.ts',
    'shinobij.client/src/lib/legacy.ts', 'shinobij.client/src/screens/Dungeon.tsx', 'shinobij.client/src/screens/EchoesOfWar.tsx',
    'shared/tile-cards.ts', 'shared/legacy-card-sources.ts', 'shared/pet-witness-card-sources.ts',
    // Legacy trial speech, emissary and Sage lines, and their server announcements.
    'api/_legacy-core.ts', 'api/legacy/trial.ts', 'shinobij.client/src/components/EmissaryTrialPanel.tsx',
    'shinobij.client/src/components/SageOfferModal.tsx', 'shinobij.client/src/screens/LegacyPanel.tsx',
    // World interaction dialogue and guild/rumor flavor delivered outside VN objects.
    'shinobij.client/src/components/WorldWandererDialog.tsx', 'shinobij.client/src/screens/HunterBoard.tsx',
    'shinobij.client/src/lib/chronicle-lock.ts', 'shinobij.client/src/lib/first-fight-coach.ts',
    // Hollow Gate run narration (tile, shard, wing, boss and recovery messages).
    'shinobij.client/src/lib/hollow-gate-app-flow.ts', 'shinobij.client/src/lib/hollow-gate-shards.ts',
    'shinobij.client/src/lib/hollow-gate-tile.ts', 'shinobij.client/src/lib/hollow-gate-wings.ts',
    'shinobij.client/src/lib/hollow-gate-server.ts', 'shinobij.client/src/lib/hollow-gate-run-build.ts',
    'shared/hollow-gate-combat-director.ts', 'shinobij.client/src/lib/spire-catalog.ts',
];
/** Inspected transport/reader/editor/preview files. These do not author live scenes. */
export const narrativeConsumers = [
    'shinobij.client/src/components/TriggeredVisualNovel.tsx',
    'shinobij.client/src/features/cinematic-vn/art-audit-catalog.ts',
    'shinobij.client/src/features/cinematic-vn/CinematicVnPreview.tsx',
    'shinobij.client/src/lib/ai-fight-art.ts', 'shinobij.client/src/lib/canonical-narrative.ts',
    'shinobij.client/src/lib/echoes-witness-scenes.ts', 'shinobij.client/src/lib/story-archive.ts',
    'shinobij.client/src/lib/story-epilogue.ts', 'shinobij.client/src/lib/story-field-work.ts',
    'shinobij.client/src/lib/story-reckonings.ts', 'shinobij.client/src/lib/story-road-events.ts',
    'shinobij.client/src/lib/story-trigger.ts', 'shinobij.client/src/lib/vn-retired-artwork.ts',
    'shinobij.client/src/lib/vn.ts', 'shinobij.client/src/screens/AdminPanel.tsx',
    'shinobij.client/src/types/vn.ts', 'api/pet/_authored-encounter.ts',
];
// Supplemental object copy keeps labels and condition keys beside prose. It is
// explicitly a catalog view, not a claim to have executed every conditional UI.
function strings(value: unknown, key = ''): string[] {
    if (typeof value === 'string')
        return !/(?:image|asset|portrait|path|url|color|icon)/i.test(key) && (/\s/.test(value) || /^(?:text|dialogue|greeting|quote|result)$/.test(key)) ? [`${key}: ${value}`] : [];
    if (Array.isArray(value))
        return value.flatMap(v => strings(v, key));
    if (value && typeof value === 'object')
        return Object.entries(value).flatMap(([k, v]) => strings(v, k));
    return [];
}
export function buildCorpus(): Scene[] {
    const out: Scene[] = [];
    const add = (family: string, source: string, id: string, pages: readonly unknown[], context = '', graph = false, extra = {}) => out.push({ id: `${family}/${id}`, family, source, context, pages: pages as Page[], graph, ...extra });
    const prose = (family: string, source: string, id: string, value: unknown, context = '') => {
        const dialogue = strings(value);
        if (dialogue.length)
            add(family, source, id, [{ title: id, scene: context || 'Catalog entry', speaker: 'Narrator', dialogue }], context, false, { catalog: true });
    };
    for (const [village, steps] of Object.entries(storylines))
        for (const s of steps)
            add('campaign', data('storylines'), `${village}/${s.levelReq}`, s.pages ?? [], `L${s.levelReq}; ${s.title}`, true, { village, level: s.levelReq });
    for (const [village, scenes] of Object.entries(storyInterludesByVillage))
        for (const s of scenes)
            add('interlude', data('story-interludes'), s.id, s.pages, `L${s.levelReq}; requires ${s.minProgress} chapters; ${s.title}`, true, { village, level: s.levelReq });
    for (const s of storyRoadEvents)
        add('road', data('story-road-events'), s.id, s.pages, `L${s.levelReq}; requires ${s.minProgress} chapters`, true, { level: s.levelReq });
    for (const s of storyReckonings)
        for (const phase of ['intro', 'payoff'] as const)
            add('reckoning', data('story-reckonings'), `${s.id}/${phase}`, s[phase], `${s.village}; L${s.levelReq}; ${phase}; task ${s.task.targetName}`, false, { village: s.village, level: s.levelReq });
    for (const [id, s] of Object.entries(storyFieldScenes)) {
        for (const [point, p] of Object.entries(s.points))
            add('field', data('story-field-scenes'), `${id}/${point}`, p.pages, `${p.greeting} Objective: ${p.objective}`);
        add('field', data('story-field-scenes'), `${id}/aftermath`, s.aftermath, 'Conditional pages retain their trait gates.');
        if (s.legacyAftermath)
            add('field', data('story-field-scenes'), `${id}/old-save`, s.legacyAftermath, 'Historical save without recorded field route.');
    }
    for (const [village, scenes] of Object.entries(storyEpiloguesByVillage))
        scenes.forEach((s, i) => add('epilogue', data('story-epilogues'), `${village}/${i}`, s.pages, `Ending: ${s.lane}; requires ${s.requireTrait ?? s.requireAnyTrait?.join(' OR ') ?? 'no additional trait'}`, false, { village, level: 100 }));
    for (const r of hollowRifts) {
        const versions = { intro: riftIntroEvent(r, 25, 'forest', {}), repeat: riftIntroEvent(r, 25, 'forest', { [r.id]: { at: 1 } }), descent: riftDescentEvent(r, 'forest'), clear: riftFirstClearEvent(r.id, 'forest') };
        for (const [phase, e] of Object.entries(versions))
            if (e)
                add('rift', lib('hollow-rifts'), `${r.id}/${phase}`, e.vnPages ?? [], `${phase}; target sector 25`, true);
    }
    for (const [id, s] of Object.entries(ECHOES_SCENES))
        for (const [phase, pages] of Object.entries(s))
            add('echoes', data('echoes-of-war-scenes'), `${id}/${phase}`, pages, phase);
    for (const [id, pages] of Object.entries(ECHOES_ERA_INTROS))
        add('echoes', data('echoes-of-war-scenes'), `era/${id}`, pages, 'Era introduction');
    for (const [id, w] of Object.entries(ECHOES_WITNESS_CONTENT))
        add('echoes', data('echoes-of-war-scenes'), `witness/${id}`, [w.prompt, ...Object.values(w.battleCallbacks), ...Object.values(w.nextEraAcknowledgements), { title: 'Record and later acknowledgements', scene: 'All alternatives; only the chosen record is played', speaker: 'Narrator', dialogue: [...w.choices.flatMap(c => [c.label, c.record]), ...Object.values(w.haldenAcknowledgements)] }], 'Includes all mutually exclusive witness choices and their later replies.');
    for (const e of [...Object.values(systemEvents).flat(), ...Object.values(defaults)])
        add('system', data(e.id.startsWith('sys-') ? 'default-vn-events' : 'vn-events'), e.id, e.vnPages ?? [], e.name, true);
    for (const l of PET_TUTORIAL_LESSONS)
        add('tutorial', lib('pet-tutorial'), l.id, l.pages.map(p => ({ title: p.title, scene: p.kicker, speaker: 'Tutorial', dialogue: [p.body, ...p.points, ...(p.callout ? [p.callout] : [])] })), `L${l.minLevel}, ${l.minPets} pets; {pet} is personalized by the runtime.`);
    for (const vow of ACADEMY_VOWS) {
        prose('academy', lib('academy-narrative'), vow.id, vow, 'Vow choice and callbacks');
        for (const village of Object.keys(storylines)) {
            const lines = [...PRE_GIFT_LINES, ...buildVowResponseLines(vow.id), ...buildPostGiftLines(village, vow.id), ...buildCompanionIntroLines(village, 'Kumo', vow.id)];
            add('intro', 'shinobij.client/src/features/intro-cinematic/introCinematicScript.ts', `${village}/${vow.id}`, lines.map((l, i) => ({ title: `Beat ${i + 1}`, scene: 'Shrine; gift; village; companion', speaker: l.speaker === 'narrator' ? 'Narrator' : l.label ?? 'Shiranui', dialogue: [resolveCinematicLine(l.text, 'Traveler', 'Kumo')] })), `Village ${village}; vow ${vow.id}`);
        }
    }
    for (const village of [...Object.keys(storylines), 'unknown'])
        prose('academy', lib('academy-narrative'), village, academyCeremony(village), 'Return ceremony');
    const companions = ['defender', 'sage', 'tracker', 'assassin'].map((role, i) => ({ id: `pet-${i}`, currentName: ['Kumo', 'Reed', 'Flint', 'Ash'][i], historicalName: ['Kumo', 'Reed', 'Flint', 'Ash'][i], role, available: true }));
    const seen = new Set<string>();
    for (const step of FIRST_PACT_MAIN_STEPS)
        for (const vow of FIRST_PACT_VOWS)
            for (const resolved of [false, true]) {
                const p = createFirstPactProgress(1);
                p.mainStep = step;
                p.mainQuest.pactVow = vow.id;
                if (resolved) {
                    p.courtStanding = 5000;
                    p.mainQuest.pactCompanionIds = companions.map(c => c.id) as [
                        string,
                        string,
                        string,
                        string
                    ];
                    p.finalTrial.wins = 1;
                    p.stableQuest.status = 'complete';
                    p.writs = ['writ-silencing', 'writ-audit', 'writ-pruning', 'writ-impound'];
                    p.findings = [...p.writs];
                    p.aftermathVisits = [...FIRST_PACT_AFTERMATH_IDS];
                }
                for (const npc of FIRST_PACT_NPCS) {
                    const d = firstPactReactiveDialogue(npc, p, resolved ? companions : []);
                    const signature = JSON.stringify([npc.id, d]);
                    if (seen.has(signature))
                        continue;
                    seen.add(signature);
                    add('first-pact', 'shinobij.client/src/screens/first-pact/narrative.ts', `${step}/${vow.id}/${resolved}/${npc.id}`, d.lines.map((text, i) => ({ title: npc.name, scene: npc.title, speaker: d.narrationStartsAt !== undefined && i >= d.narrationStartsAt ? 'Narrator' : npc.name, dialogue: [text], ...(i === d.lines.length - 1 && d.choices ? { choices: d.choices.map(c => ({ text: c.label })) } : {}) })), `${step}; vow ${vow.id}; ${resolved ? 'completed writs, known companions, revisited aftermath' : 'no side quest or companion record'}; action ${JSON.stringify(d.action ?? null)}`);
                }
                if (step === 'complete')
                    prose('first-pact', 'shinobij.client/src/screens/first-pact/narrative.ts', `epilogue/${vow.id}/${resolved}`, firstPactEpilogue(p, resolved ? companions : []));
            }
    for (const e of EMISSARY_DEFS)
        add('legacy', lib('legacy-emissaries'), e.slug, [{ title: e.name, scene: 'Road meeting; lore rotates on revisits; trial line only after acceptance', speaker: e.name, dialogue: [e.greeting, ...e.lore, e.trialLine] }], e.categories.join(', '));
    for (const d of LEGACY_DEFS)
        prose('legacy', 'api/_legacy-defs.ts', `path/${d.id}`, { name: d.name, flavor: d.flavor }, 'Earned deed description; no inherited identity.');
    const sage = buildSageVnEvent({ status: 'spawned', sector: 25, spawnedAt: 1, expiresAt: 2, offers: LEGACY_DEFS.slice(0, 3).map(d => ({ legacyId: d.id, name: d.name, category: d.category, flavor: d.flavor, title: d.title, villageAffinity: d.villageAffinity ?? null })) }, 'Traveler');
    add('legacy', lib('legacy-sage-vn'), sage.id, sage.vnPages ?? [], 'Offer preview; permanent acceptance is handled by the following modal.', true);
    for (const category of RUMOR_CATEGORIES)
        add('legacy', lib('legacy-rumors'), `rumor/${category}`, (rumorArc(category) ?? []).map((lines, i) => ({ title: `Milestone ${i + 1}`, scene: 'Rumor variants; one line is selected per milestone', speaker: 'Tavern rumor', dialogue: lines })), category);
    add('legacy', lib('legacy-rumors'), 'gossip', [{ title: 'Tavern gossip', scene: 'One rotating overheard exchange per day', speaker: 'Narrator', dialogue: [...TAVERN_GOSSIP] }]);
    const scribe = scribeIntroEvent('forest');
    add('chronicle', lib('chronicle-scribe'), scribe.id, scribe.vnPages ?? [], 'One-time codex introduction', true);
    for (const [id, e] of Object.entries(WANDERER_ARCHETYPES))
        prose('wanderer', 'shared/wanderer-roster.ts', id, e, 'Archetype greeting variants');
    for (const [id, q] of Object.entries(QUEST_BOOK))
        prose('quest', lib('questbook'), id, q, 'Complete quest stages and decision alternatives');
    for (const e of CARAVAN_EVENTS)
        add('caravan', 'shared/sunscar/caravan-events.ts', e.id, [{ title: e.title, scene: e.scene, speaker: 'Narrator', dialogue: [e.scene], choices: e.choices.map(c => ({ text: `${c.label} (${c.hint})`, conclusion: c.result })) }], `requires ${e.requiresFlag ?? 'none'}; excludes ${e.excludesFlag ?? 'none'}`);
    for (const c of CARAVAN_CONTRACTS)
        prose('caravan', 'shared/sunscar/caravan-contracts.ts', `contract/${c.id}`, c);
    for (const r of RALLY_RIVALS)
        prose('rally', 'shared/sunscar/rally-rivals.ts', r.id, r);
    for (const [kind, lines] of Object.entries(hollowGateFlavorPool))
        add('hollow-gate', data('hollow-gate-flavor'), kind, [{ title: kind, scene: 'One tile observation per encounter', speaker: 'Narrator', dialogue: lines }]);
    add('hollow-gate', data('hollow-gate-flavor'), 'intro', hollowGateIntroPages.map(p => ({ title: p.title, scene: p.imageKey, speaker: 'Narrator', dialogue: p.lines })));
    for (const era of ERA_DEFS)
        prose('world-lore', 'api/_era-defs.ts', era.id, era, 'World chronicle; unlock announcement uses {player} and {village}.');
    for (const [id, lore] of Object.entries(clanLore))
        prose('world-lore', data('clan-lore'), `clan/${id}`, lore);
    for (const shrine of SHRINE_DEFS)
        prose('world-lore', 'shared/shrines.ts', `shrine/${shrine.id}`, shrine);
    for (const floor of FLOOR_CATALOG)
        prose('tower', 'api/towers/_floor-catalog.ts', String(floor.id), floor, 'Floor briefing and chapter summary');
    prose('world-lore', 'shared/chronicle-duel.ts', 'chronicle-catalog', CHRONICLE_CARD_CATALOG.map(({ name, lore }) => ({ name, lore })), 'Complete rendered card lore, including generated descriptions and current Legacy copies. Rules text is validated by the card engine tests.');
    prose('world-lore', data('pet-pool'), 'pet-catalog', rawPetPool.map(({ name, description }) => ({ name, description })), 'Species observations and breeding-only descriptions.');
    prose('world-lore', data('event-items'), 'story-evidence-items', eventItems.map(({ name, description, flavorText }) => ({ name, description, flavorText })), 'Story evidence descriptions and inscriptions.');
    prose('world-lore', data('starter-items'), 'item-catalog', starterItems.map(({ name, description, flavorText }) => ({ name, description, flavorText })), 'Item descriptions and inscriptions; equipment mechanics are unchanged.');
    return out;
}
