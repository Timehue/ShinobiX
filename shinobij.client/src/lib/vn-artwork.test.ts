import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { storylines } from "../data/storylines";
import { storyEpiloguesByVillage } from '../data/story-epilogues';
import { storyRoadEvents } from '../data/story-road-events';
import { hiddenDungeonVnEvent, craftDungeonEvents } from '../data/vn-events';
import { defaultAncientChestVn } from '../data/default-vn-events';
import { ECHOES_OPPONENTS, ECHOES_ERAS } from '../data/echoes-of-war';
import { ECHOES_SCENES, ECHOES_ERA_INTROS } from '../data/echoes-of-war-scenes';
import { roadEventToCreatorEvent } from './story-road-events';
import { SECONDARY_ARTWORK_DEFAULTS, secondaryVnActorAbsent } from './vn-secondary-artwork';
import { storyToCreatorEvent } from "./story-trigger";
import { resolveVnArtworkBackground, STORY_ARTWORK_CORRECTIONS, STORY_ARTWORK_DEFAULTS, vnArtworkFocalPoint } from "./vn-artwork";
import { resolveCinematicActorImage, resolveVnPresentation } from "./vn-presentation";
import { resolveStoryActorPose } from "./vn-storywide-direction";
import { resolveVnAuthoredActorImage, resolveVnActorBaseImage } from "./vn";
import type { CreatorEvent } from "../types/vn";

const opening = (village = "Ashen Leaf Village") => storyToCreatorEvent(storylines[village][0], village, 0);
const echoEvent = (id: string, image: string, pages: NonNullable<CreatorEvent['vnPages']>): CreatorEvent => ({
    ...opening(), id, image, vnPages: pages, biome: 'central',
});

test('Echoes uses reader-only cutouts across all encounter states and preserves actor overrides', () => {
    for (const opponent of ECHOES_OPPONENTS) {
        for (const kind of ['pre', 'defeat', 'victory', 'rematch']) {
            const id = `${opponent.id}-${kind}`;
            const expected = opponent.portrait.replace('/portraits/', '/portraits/cinematic/echoes/').replace('.webp', opponent.name === 'Sela' ? '-linen-cutout-v1.webp' : '-cutout-v1.webp');
            const image = resolveCinematicActorImage(id, opponent.name, opponent.portrait);
            if (id === 'echoes-10-halden-rematch') {
                assert.equal(image, '');
                assert.ok(secondaryVnActorAbsent(id, opponent.name, image));
            } else assert.ok(image.startsWith(expected), id);
            assert.equal(resolveCinematicActorImage(id, opponent.name, opponent.portrait, 'neutral', '/uploads/custom-actor.webp'), '/uploads/custom-actor.webp');
            assert.equal(resolveCinematicActorImage('creator-custom', opponent.name, opponent.portrait), opponent.portrait);
            assert.equal(resolveCinematicActorImage(id, opponent.name, '/uploads/fallback.webp'), '/uploads/fallback.webp');
        }
    }
});

test('Echoes prop states follow current pages and preserve authored poses', () => {
    for (const [id, before, after, expected] of [
        ['echoes-1-tovin', 'There', 'Finished', 'tovin-empty-hand'],
        ['echoes-5-sela', 'The Decision', 'What I Need', 'sela-empty-hand'],
        ['echoes-8-eren', 'Overturned', 'Adjourned', 'eren-sash-removed'],
    ]) {
        const opponent = ECHOES_OPPONENTS.find(o => o.id === id)!;
        const kind = id.endsWith('sela') ? 'pre' : 'victory';
        const source = ECHOES_SCENES[id];
        const event = echoEvent(`${id}-${kind}`, opponent.sceneImage, kind === 'victory' ? source.firstVictory : source.preShowdown);
        const find = (title: string) => event.vnPages!.findIndex(p => p.title === title);
        assert.equal(presentation(event, find(before)).rightActorPose, 'neutral');
        const afterIndex = find(after);
        const pose = presentation(event, afterIndex).rightActorPose;
        assert.equal(pose, 'resolute');
        assert.ok(resolveCinematicActorImage(event.id, opponent.name, opponent.portrait, pose).includes(expected));
        const page = event.vnPages![afterIndex];
        const authoredEvent = { ...event, vnPages: event.vnPages!.map((p, i) => i === afterIndex ? { ...p, cinematic: { rightActorPose: 'neutral' as const } } : p) };
        assert.equal(presentation(authoredEvent, afterIndex).rightActorPose, 'neutral');
        assert.equal(page.title, after);
    }
});

test('Echoes narration cannot inherit a square encounter avatar, while deliberate artwork survives', () => {
    for (const [id, avatar] of [['echoes-1-tovin-victory', '/portraits/tovin.webp'], ['echoes-10-halden-victory', '/portraits/halden.webp']]) {
        const fallback = resolveVnActorBaseImage(id, 'Narrator', undefined, avatar);
        assert.equal(resolveCinematicActorImage(id, 'Narrator', fallback), '');
        assert.equal(resolveCinematicActorImage(id, 'Narrator', fallback, 'neutral', '/uploads/authored.webp'), '/uploads/authored.webp');
        assert.equal(resolveCinematicActorImage(id, 'Narrator', '/uploads/custom-avatar.webp'), '/uploads/custom-avatar.webp');
    }
});

test('tower introductions enter the appropriate rooms while preserving explicit custom art', () => {
    for (const era of ECHOES_ERAS) {
        const event = echoEvent(`${era.id}-intro`, era.plateImage, ECHOES_ERA_INTROS[era.id]);
        for (const [title, expected] of Object.entries(STORY_ARTWORK_CORRECTIONS[event.id] ?? {})) {
            const index = event.vnPages!.findIndex(p => p.title === title);
            if (index < 0) continue; // Witness-only page is covered by the inventory's reactive variants.
            assert.equal(presentation(event, index).backgroundImage, expected);
            assert.equal(presentation({ ...event, image: '/uploads/custom-era.webp' }, index).backgroundImage, '/uploads/custom-era.webp');
        }
    }
    const source = ECHOES_SCENES['echoes-1-tovin'];
    const event = echoEvent('echoes-1-tovin-victory', '/scenes/story/echoes-tovin.webp', source.firstVictory);
    assert.match(presentation(event, 0).backgroundImage, /lower-landing-table/);
    assert.match(presentation(event, 1).backgroundImage, /lower-landing-rope-table/);
});
function presentation(event: CreatorEvent, pageIndex: number, lineIndex = 0) {
    const page = event.vnPages![pageIndex];
    return resolveVnPresentation({ event, page, pageIndex, lineIndex, speaker: page.speaker,
        speakingSide: "right", pageImage: page.image || event.image || "" });
}

test("explicit art at every authoring level survives pilot and automatic direction", () => {
    const event = opening();
    const page = event.vnPages![7];
    const input = { event, page, lineIndex: 2, pageImage: page.image!, pilotImage: "/pilot.webp", inferredImage: "/generic.webp" };
    const url = "https://assets.example.test/uploads/8d431.webp?revision=3";
    assert.equal(resolveVnArtworkBackground({ ...input, event: { ...event, image: url } }), url);
    assert.equal(resolveVnArtworkBackground({ ...input, page: { ...page, image: url } }), url);
    assert.equal(resolveVnArtworkBackground({ ...input, event: { ...event, cinematic: { backgroundImage: url } } }), url);
    assert.equal(resolveVnArtworkBackground({ ...input, event: { ...event, cinematic: { backgroundImage: "/event.webp" } }, page: { ...page, cinematic: { backgroundImage: url } } }), url);
    assert.equal(resolveVnArtworkBackground({ ...input, page: { ...page, cinematic: { backgroundImage: "/page.webp" }, lines: [{ speaker: "Narrator", text: "a" }, { speaker: "Narrator", text: "b" }, { speaker: "Narrator", text: "c", cinematic: { backgroundImage: url } }] } }), url);
});

test("compacted replay holds the cedar wall until the black-flower line and then reaches the grove", () => {
    const source = opening();
    const event = { ...source, vnPages: [0, 1, 2, 7, 8, 9].map((index) => ({ ...source.vnPages![index], choices: undefined })) };
    assert.match(presentation(event, 2).backgroundImage, /ashen-register-wall/);
    assert.match(presentation(event, 3, 1).backgroundImage, /ashen-register-wall/);
    assert.match(presentation(event, 3, 2).backgroundImage, /ashen-black-flower-reveal-v2/);
    assert.match(presentation(event, 4).backgroundImage, /ashen-black-flower-reveal-v2/);
    assert.match(presentation(event, 5).backgroundImage, /ashen-old-grove-trial/);
});

test("opening branches retain their own intake locations before their discoveries", () => {
    for (const [village, expected] of [["Stormveil Village", "stormveil-challenge-board"], ["Moonshadow Village", "moonshadow-registry-booth"], ["Frostfang Village", "frostfang-roll-stone"]]) {
        const event = opening(village);
        for (let page = 1; page <= 6; page++) assert.ok(presentation(event, page).backgroundImage.includes(expected), `${village}, page ${page}`);
    }
    assert.match(presentation(opening("Moonshadow Village"), 7).backgroundImage, /registry-water/);
    assert.match(presentation(opening("Frostfang Village"), 7).backgroundImage, /mark-plate/);
});

test("an injury belongs to its named subject, never somebody mentioned in dialogue", () => {
    const event = opening("Frostfang Village");
    const page = { ...event.vnPages![0], scene: "Captain Yura watches a wounded runner", dialogue: ["Captain Yura: I was injured years ago. The storm is over."] };
    assert.equal(resolveStoryActorPose(event, page, "Captain Yura"), "neutral");
    assert.equal(resolveStoryActorPose(event, { ...page, scene: "Captain Yura, wounded, leans on the gate" }, "Captain Yura"), "injured");
    assert.equal(resolveStoryActorPose(event, { ...page, scene: "Captain Yura, wounded, leans on the gate" }, "Elder Sova"), "neutral");
});

test("Yura's wrist wrap follows the removal scene; a memory of a whiteout never bloodies her", () => {
    const chapters = storylines["Frostfang Village"];
    const before = storyToCreatorEvent(chapters[5], "Frostfang Village", 5);
    const after = storyToCreatorEvent(chapters[6], "Frostfang Village", 6);
    assert.equal(presentation(before, 3).rightActorPose, "neutral");
    assert.equal(presentation(after, 0).rightActorPose, "neutral");
    assert.equal(presentation(after, 4).rightActorPose, "resolute");
    assert.match(resolveCinematicActorImage(after.id, "Captain Yura", "", presentation(after, 4).rightActorPose), /wrist-bound-v1/);
});

test("authored poses stay attached to the named actor after the player slot is normalized", () => {
    const event = opening();
    event.vnPages = [{ ...event.vnPages![2], leftName: "Toma Reed", rightName: "Player", cinematic: { leftActorPose: "injured", rightActorPose: "resolute" } }];
    const result = presentation(event, 0);
    assert.equal(result.rightActorPose, "injured");
    assert.equal(result.leftActorPose, "resolute");
});

test("opaque uploads and aliases are legitimate; a known different bundled identity is not", () => {
    const event = opening();
    const upload = "/uploads/38ea1a7c.webp?revision=4";
    assert.equal(resolveVnAuthoredActorImage(event.id, "Toma Reed", upload), upload);
    assert.equal(resolveVnAuthoredActorImage(event.id, "Toma Reed", "data:image/png;base64,example"), "data:image/png;base64,example");
    assert.equal(resolveVnAuthoredActorImage(event.id, "Raiko Veyr", "/portraits/cinematic/storywide/kage-raiko-veyr.webp"), "/portraits/cinematic/storywide/kage-raiko-veyr.webp");
    assert.equal(resolveVnAuthoredActorImage(event.id, "Toma Reed", "/portraits/cinematic/elder-mori.webp"), "");
    assert.equal(resolveCinematicActorImage(event.id, "Toma Reed", "/fallback.webp", "neutral", upload), upload);
});

test("rift aftermaths use the registered speaker portrait and all correction assets exist", () => {
    assert.match(resolveCinematicActorImage("rift-first-clear-hollow-stalker", "Scout Vessa", "/missing.webp"), /portraits\/cinematic\//);
    for (const pages of Object.values(STORY_ARTWORK_CORRECTIONS)) {
        for (const image of Object.values(pages)) assert.ok(existsSync(resolve("public", image.slice(1))), image);
    }
    for (const image of Object.values(STORY_ARTWORK_DEFAULTS)) assert.ok(existsSync(resolve('public', image.slice(1))), image);
    for (const image of Object.values(SECONDARY_ARTWORK_DEFAULTS)) assert.ok(existsSync(resolve('public', image.slice(1))), image);
});

test('proof failures appear at their written line, while explicit direction remains authoritative', () => {
    for (const [id, title, before, after] of [
        ['story-interlude-ashen-leaf-village-88', 'The First Turn', 'ashen-east-channel-night', 'ashen-split-vane'],
        ['story-interlude-stormveil-village-88', 'The First Raise', 'stormveil-anchor-web-storm', 'stormveil-failed-splice'],
    ]) {
        const event = { ...opening(), id, image: '' };
        const page = { title, scene: 'The first trial', speaker: 'Narrator', dialogue: ['Before.', 'The failure.'] };
        const input = { event, page, pageImage: '' };
        assert.ok(resolveVnArtworkBackground({ ...input, lineIndex: 0 }).includes(before));
        assert.ok(resolveVnArtworkBackground({ ...input, lineIndex: 1 }).includes(after));
        assert.equal(resolveVnArtworkBackground({ ...input, lineIndex: 1, page: { ...page, cinematic: { backgroundImage: '/uploads/creator-scene.webp' } } }), '/uploads/creator-scene.webp');
    }
});

test('phone crop corrections belong only to their reviewed assets', () => {
    assert.equal(vnArtworkFocalPoint('/scenes/story/cinematic/storywide/frostfang-field-blue-ice-gully-v1.webp'), '30% 50%');
    assert.equal(vnArtworkFocalPoint('/uploads/frostfang-field-blue-ice-gully-v1.webp'), undefined);
    assert.equal(vnArtworkFocalPoint('/scenes/story/cinematic/storywide/frostfang-records-room-v1.webp'), undefined);
});

test('field location defaults yield to a creator event image, while a creator page image wins', () => {
    const scene = '/scenes/story/cinematic/storywide/ashen-east-footbridge-broken-v1.webp';
    const event = { ...opening(), id: 'story-reckoning-field:story-reckoning-toma-cinders:al-collapsed-footbridge', village: 'Ashen Leaf Village', image: '/scenes/story/cinematic/storywide/ashen-threshold.webp' };
    const page = { title: 'Sound Before Pretty', scene: 'The collapsed footbridge', speaker: 'Toma Reed', dialogue: ['Pass the short offcut.'], image: scene };
    const input = { event, page, lineIndex: 0, pageImage: scene };
    assert.equal(resolveVnArtworkBackground(input), scene);
    assert.equal(resolveVnArtworkBackground({ ...input, event: { ...event, image: '/uploads/event.webp' } }), '/uploads/event.webp');
    assert.equal(resolveVnArtworkBackground({ ...input, event: { ...event, image: '/uploads/event.webp' }, page: { ...page, image: '/uploads/page.webp' } }), '/uploads/page.webp');
});

test('the maintenance crawl reveals the junction, then its ledger, before the marked drain', () => {
    const event = { ...opening(), id: 'story-interlude-moonshadow-village-42', image: '' };
    const page = { title: 'Following It Down', scene: 'The maintenance crawl', speaker: 'Narrator', dialogue: ['Follow.', 'Junction.', 'Ledger.'] };
    const input = { event, page, pageImage: '' };
    assert.match(resolveVnArtworkBackground({ ...input, lineIndex: 0 }), /maintenance-crawl/);
    assert.match(resolveVnArtworkBackground({ ...input, lineIndex: 1 }), /nine-pipe-junction/);
    assert.match(resolveVnArtworkBackground({ ...input, lineIndex: 2 }), /junction-ledger/);
    assert.match(resolveVnArtworkBackground({ ...input, page: { ...page, title: "The Drain's Direction" }, lineIndex: 0 }), /quartered-drain/);
});

test('every ending variant resolves its own reviewed setting instead of the chapter finale default', () => {
    for (const [village, endings] of Object.entries(storyEpiloguesByVillage)) {
        const slug = village.toLowerCase().replace(/\W+/g, '-');
        const climax = `/scenes/story/story-${slug}-100-8.webp`;
        for (const ending of endings) {
            const event = { ...opening(village), id: `story-epilogue-${slug}-${ending.lane}`, image: climax };
            for (const source of ending.pages) {
                const page = { ...source, image: climax };
                const image = resolveVnArtworkBackground({ event, page, lineIndex: 0, pageImage: climax });
                assert.notEqual(image, climax, `${village}/${ending.title}/${page.title}`);
                assert.equal(image, STORY_ARTWORK_CORRECTIONS[event.id]?.[page.title]);
                const override = '/uploads/creator-ending.webp';
                assert.equal(resolveVnArtworkBackground({ event: { ...event, image: override }, page, lineIndex: 0, pageImage: climax }), override);
            }
        }
    }
});

test('Harrow posts the die only at the riveting line, including resumed readings', () => {
    const event = { ...opening(), id: 'story-reckoning-harrow-unbought-return', image: '/scenes/story/story-reckoning-harrow-unbought-return.webp' };
    const page = { title: 'Nailed to the Board', scene: 'A waystation board', speaker: 'Kite Harrow', dialogue: ['Give me the die.', 'It goes on the board.', 'I am riveting the die.'] };
    const input = { event, page, pageImage: event.image };
    for (const lineIndex of [0, 1]) assert.match(resolveVnArtworkBackground({ ...input, lineIndex }), /waystation-contract/);
    assert.match(resolveVnArtworkBackground({ ...input, lineIndex: 2 }), /waystation-evidence/);
    assert.equal(resolveVnArtworkBackground({ ...input, lineIndex: 2, page: { ...page, image: '/uploads/custom-board.webp' } }), '/uploads/custom-board.webp');
    assert.equal(vnArtworkFocalPoint('/scenes/story/cinematic/side-stories/harrow-waystation-contract-v1.webp', event.id), '75% 50%');
});

test('road locations and stolen props follow named pages without overriding creators', () => {
    const road = (id: string) => roadEventToCreatorEvent(storyRoadEvents.find(r => r.id === id)!, 'forest');
    const event = road('story-road-second-teacher');
    assert.match(presentation(event, 0).backgroundImage, /waystation-practice-yard/);
    assert.equal(presentation(event, 0).rightActorPose, 'neutral');
    assert.equal(presentation(event, 2).rightActorPose, 'tense');
    assert.match(resolveCinematicActorImage(event.id, 'Instructor Havek', '', presentation(event, 2).rightActorPose), /empty-hand/);
    assert.equal(resolveStoryActorPose(event, event.vnPages![2], 'Petra'), 'neutral');
    assert.equal(presentation({ ...event, image: '/uploads/yard.webp' }, 2).backgroundImage, '/uploads/yard.webp');
    assert.equal(resolveCinematicActorImage(event.id, 'Instructor Havek', '', 'tense', '/uploads/havek.webp'), '/uploads/havek.webp');
    const cache = road('story-road-withheld-cache');
    assert.doesNotMatch(presentation(cache, 0).backgroundImage, /lidded-stone/);
    for (const index of [1, 2, 3]) assert.match(presentation(cache, index).backgroundImage, /lidded-stone/);
    assert.match(presentation(road('story-road-three-footprints'), 1).backgroundImage, /eleven-frozen-footprints/);
});

test('founding-stone discoveries and bridge ambush use their actual page and line', () => {
    const road = (id: string) => roadEventToCreatorEvent(storyRoadEvents.find(r => r.id === id)!, 'forest');
    const event = road('story-road-four-seals-one-gate');
    const index = event.vnPages!.findIndex(p => p.title === 'Four Stones, One Hand');
    assert.ok(index >= 0);
    for (const [line, expected] of [[0, 'storm-founding-stone'], [1, 'three-founding-stones'], [2, 'three-founding-stones'], [3, 'moon-founding-stone']] as const) {
        assert.ok(presentation(event, index, line).backgroundImage.includes(expected));
    }
    const bridge = road('story-road-black-bridge');
    for (const [pageIndex, page] of bridge.vnPages!.entries()) {
        const image = presentation(bridge, pageIndex).backgroundImage;
        assert.equal(image.includes('first-bolt'), page.title === 'First Bolt', page.title);
    }
});

test('rift first-clear inherited defaults change state while creator images and actor art survive', () => {
    for (const slug of ['hollow-stalker', 'legacy-echo', 'engine-echo', 'mirror-shard', 'hollow-name', 'gate-heir', 'beast-warren']) {
        const image = `/scenes/story/rift-giver-${slug}.webp`;
        const event = { ...opening(), id: `rift-first-clear-${slug}`, image };
        const page = { title: 'Aftermath', scene: 'After the clear', speaker: 'Narrator', dialogue: ['Done.'] };
        const input = { event, page, pageImage: image, lineIndex: 0 };
        assert.equal(resolveVnArtworkBackground(input), SECONDARY_ARTWORK_DEFAULTS[event.id]);
        const direction = resolveVnPresentation({ event: { ...event, vnPages: [page] }, page, pageIndex: 0, lineIndex: 0, pageImage: image, speaker: page.speaker, speakingSide: null });
        assert.equal(direction.cue, 'none', 'Portrait coverage must not add a title sound cue');
        assert.equal(direction.premium, false);
        assert.equal(resolveVnArtworkBackground({ ...input, event: { ...event, image: '/uploads/aftermath.webp' } }), '/uploads/aftermath.webp');
    }
    assert.match(resolveCinematicActorImage('rift-first-clear-beast-warren', 'Houndmaster Bel', ''), /bel-nara-rescue/);
    assert.match(resolveCinematicActorImage('rift-giver-beast-warren', 'Houndmaster Bel', ''), /bel-clean-alpha/);
    assert.equal(resolveCinematicActorImage('rift-first-clear-beast-warren', 'Houndmaster Bel', '', 'neutral', '/uploads/bel.webp'), '/uploads/bel.webp');
    const event = { ...opening(), id: 'rift-descend-beast-warren', image: '' };
    const page = { title: 'The Warren', scene: 'The tunnel', speaker: 'Narrator', dialogue: ['Entry.', 'Inside.', 'Nara.'] };
    assert.doesNotMatch(resolveVnArtworkBackground({ event, page, lineIndex: 1, pageImage: '/entry.webp' }), /nara-controlled/);
    assert.match(resolveVnArtworkBackground({ event, page, lineIndex: 2, pageImage: '/entry.webp' }), /nara-controlled/);
});

test('shared dungeon stages move indoors and the courier chest opens only on its second page', () => {
    for (const event of [hiddenDungeonVnEvent, ...craftDungeonEvents]) {
        assert.doesNotMatch(presentation(event, 0).backgroundImage, /chronicle-altar|companion-chamber/);
        assert.match(presentation(event, 1).backgroundImage, /chronicle-altar/);
        assert.match(presentation(event, 2).backgroundImage, /companion-chamber/);
        assert.equal(presentation({ ...event, image: '/uploads/dungeon.webp' }, 1).backgroundImage, '/uploads/dungeon.webp');
    }
    assert.doesNotMatch(presentation(defaultAncientChestVn, 0).backgroundImage, /chest-open/);
    assert.match(presentation(defaultAncientChestVn, 1).backgroundImage, /chest-open/);
});

test('Lyra victory shuts the conduit down while rematches retain the historical light', () => {
    const source = ECHOES_SCENES['echoes-9-lyra'];
    const victory = echoEvent('echoes-9-lyra-victory', '/scenes/story/echoes-lyra.webp', source.firstVictory);
    for (let page = 0; page < victory.vnPages!.length; page++) assert.match(presentation(victory, page).backgroundImage, /conduit-shutdown/);
    const historical = { ...victory, id: 'echoes-9-lyra-rematch' };
    assert.doesNotMatch(presentation(historical, 0).backgroundImage, /conduit-shutdown/);
    assert.equal(secondaryVnActorAbsent('echoes-10-halden-rematch', 'Halden', '/uploads/halden.webp'), false);
});
