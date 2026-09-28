import type { CreatorEvent } from '../types/vn';
import type { PendingGatherFind } from '../../../shared/gathering';
import { BIOME_GATHER_IDS, GATHER_NAMES } from '../../../shared/gathering-materials';

export const FIND_SCENES = {
    forest: { title: 'Under the cedar', scene: 'Water threads through the roots. Fresh sap catches the light.',
        discovery: 'A branch has split cleanly in the fall. Beneath its wet outer shell, the heartwood is still sound.',
        common: 'Herbs crowd the bank. Long reed fibers pull free beside a seam of dark mineral sand.',
        trace: 'A strip of Heartwood Bark lifts beneath your knife. Cut carefully and there is enough to keep.',
        noTrace: "The bark beneath is still green and clings to the wood. You leave it to seal the break.",
        atmosphere: 'motes', tone: 'warm' },
    shadow: { title: 'A silver edge', scene: 'The ravine goes quiet where the moon reaches the water.',
        discovery: 'A thin strand hangs between two roots. It disappears in shadow, then catches the light again.',
        common: 'You find bitter herbs under the roots, tough fibers along the bank, and iron-dark sand in the shallows.',
        trace: 'The strand holds when you draw it taut. Shadow Thread. Work it loose without breaking the whole skein.',
        noTrace: "The pale strands crumble between your fingers. The tougher roots and reeds will travel better.",
        atmosphere: 'mist', tone: 'hollow' },
    snow: { title: 'Beneath the thaw', scene: 'Meltwater taps steadily beneath a shelf of snow.',
        discovery: 'The stone has kept a pocket of earth clear of frost. Small green leaves press toward the light.',
        common: 'There are herbs here, weathered fibers, and heavy black grains left behind by the thaw.',
        trace: 'Inside a crack, a Rime Crystal has grown clear of the ice. One careful cut will free it.',
        noTrace: "The crystal lies too deep in the stone to free without shattering it. You turn back to the thawed bank.",
        atmosphere: 'snow', tone: 'cold' },
    volcano: { title: 'Where the ash cools', scene: 'Warm air rises from the stones. Beyond them, a thin stream runs clear.',
        discovery: 'A recent slide has uncovered fresh rock. The ash on top is cold enough to brush aside.',
        common: 'Hardy herbs and dry fibers cling to the bank. The stream has sorted iron sand into a dark ribbon.',
        trace: 'A red seam stays bright after the ash falls away. Ember Ore. You wrap the loose piece before lifting it.',
        noTrace: "The red seam runs deep into the rock. You gather from the cool bank and leave the stone undisturbed.",
        atmosphere: 'embers', tone: 'warm' },
    central: { title: 'After the rain', scene: 'Clouds pull apart above a shallow roadside wash.',
        discovery: 'Runoff has left a clean line across the gravel. Anything heavier than water has settled here.',
        common: 'Field herbs grow along the wash. Reed fibers catch on stone, beside little fans of iron sand.',
        trace: 'A pale shard rings against your blade. Stormglass. Its blue edge holds the last light of the storm.',
        noTrace: "The bright flecks crumble under your blade. The useful harvest lies along the waterline.",
        atmosphere: 'rain', tone: 'neutral' },
} as const;

export function gatherSceneImage(biome: PendingGatherFind['biome']): string {
    return `/scenes/the-find/${biome}-v1.webp`;
}
export function buildGatherVn(find: PendingGatherFind, repeat: boolean): CreatorEvent {
    const text = FIND_SCENES[find.biome];
    const image = gatherSceneImage(find.biome);
    const opening = [text.scene, text.discovery];
    const inspection = [text.common, find.rareTrace ? text.trace : text.noTrace];
    return {
        id: `sys-the-find-${find.biome}`, name: 'The Find', vnTitle: 'The Find', biome: find.biome,
        icon: '✦', eventKind: 'visualNovel', image, vnSpeaker: 'Narrator',
        levelReq: 1, xpReward: 0, ryoReward: 0, staminaReward: 0, dialogue: opening,
        cinematic: { mode: 'cinematic', backgroundImage: image, actorEntrance: 'none', ambience: 'road',
            atmosphere: text.atmosphere, tone: text.tone, focus: 'center', backgroundMotion: 'push' },
        vnPages: [
            ...(!repeat ? [{ title: 'The Find', scene: text.scene, speaker: 'Narrator', dialogue: opening, image,
                cinematic: { shot: 'wide' as const, titleCard: true, cue: 'title' as const, transition: 'crossfade' as const } }] : []),
            { title: text.title, scene: text.scene, speaker: 'Narrator', dialogue: inspection, image,
                cinematic: { shot: 'detail', backgroundPosition: '63% 42%', cue: find.rareTrace ? 'reveal' : 'none', transition: 'crossfade' },
                choices: [{ id: 'inspect-materials', text: 'Choose what to gather', nextPage: -1,
                    conclusion: find.rareTrace ? `${GATHER_NAMES[BIOME_GATHER_IDS[find.biome]]} can be collected with this harvest.` : 'Choose one material to carry home.' }] },
        ],
    };
}
