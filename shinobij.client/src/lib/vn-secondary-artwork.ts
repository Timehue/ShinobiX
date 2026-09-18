// Exact current-script locations for road stories and other shared VN users.
// No dialogue, choice, condition or event payload is changed by this table.
import type { VnActorPose } from '../types/vn';
const side = '/scenes/story/cinematic/side-stories/';
const echo = '/scenes/story/cinematic/echoes/';
const storywide = '/scenes/story/cinematic/storywide/';
export const SECONDARY_ARTWORK_CORRECTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    'rift-giver-engine-echo': { 'What the Engine Drank': `${side}rift-disused-engine-yard-v1.webp` },
    'rift-giver-hollow-name': {
        'The Hall and the Hollow': `${side}rift-hall-carved-names-v1.webp`,
        'The Form Returns': `${side}rift-hall-carved-names-v1.webp`,
    },
    'rift-giver-gate-heir': { 'The Backflow Takes Shape': `${side}harrow-waystation-evidence-v1.webp` },
    'rift-giver-beast-warren': { 'A Voice From Another Warren': `${side}rift-nara-healing-kennels-v2.webp` },
    'story-road-border-smoke': { 'Ask Her Twice': `${storywide}ashen-field-charcoal-yard-v1.webp` },
    'story-road-three-footprints': {
        'The Print That Starts Nowhere': `${side}road-eleven-frozen-footprints-v1.webp`,
        "Everywhere He Isn't": `${side}road-coldbrook-ditch-v1.webp`,
        'Your Road': '/scenes/story/story-road-fifth-anchor.webp',
    },
    'story-road-alliance-drill': {
        'Forty-One': `${side}road-alliance-drill-flats-v1.webp`,
        'Stormveil Arithmetic': `${side}road-alliance-drill-flats-v1.webp`,
        'A Third Hand': `${side}road-alliance-recarved-seal-v1.webp`,
    },
    'story-road-withheld-cache': Object.fromEntries(['The Stone', 'Three Dry Days', 'Your Own No'].map(title => [title, `${side}road-withheld-lidded-stone-v1.webp`])),
    'story-road-legacy-without-a-name': {
        'What the Miller Keeps': `${side}road-west-ford-mill-loft-v1.webp`,
        "The Sergeant's Arithmetic": `${side}road-hamlet-shuttered-porch-v1.webp`,
        'The Open Register': '/scenes/story/cinematic/ashen-register-hall-wide.webp',
    },
    'story-road-shrine-of-two-flags': Object.fromEntries(['The Shrine Between Banners', 'The West Line', 'The East Line', 'Nine Pairs of Sandals'].map(title => [title, `${side}road-shrine-two-approaches-v1.webp`])),
    'story-road-last-road': { 'Standard Language': `${side}harrow-waystation-contract-v1.webp` },
    'story-road-emergency-powers': {
        'The Last Line': '/scenes/story/story-road-seat-of-scars.webp',
        'Objection Entered': '/scenes/story/story-road-seat-of-scars.webp',
        'Week One': `${side}road-provision-guard-post-v1.webp`,
        'Edged Instruments': `${side}road-hamlet-shuttered-porch-v1.webp`,
        'The Renewal': `${side}road-empty-notice-square-v1.webp`,
    },
    'story-road-seat-of-scars': {
        'Habit': `${side}road-scorched-arena-stall-v1.webp`,
        'What to Write': `${side}road-empty-notice-square-v1.webp`,
    },
    'story-road-four-seals-one-gate': {
        "Someone Else's Client": `${side}road-moon-founding-stone-v1.webp`,
        'One Lattice': `${side}road-four-keys-firelit-detail-v1.webp`,
        'What Keys Are For': `${side}road-four-keys-firelit-detail-v1.webp`,
    },
    'story-road-black-bridge': {
        'First Bolt': `${side}road-black-bridge-first-bolt-v1.webp`,
    },
    'story-road-fifth-anchor': {
        'What the Rumor Bought': `${side}road-central-dig-winch-v1.webp`,
        'The Court Below': `${side}road-court-below-gallery-v1.webp`,
        'Sold as Seen': `${side}road-central-dig-winch-v1.webp`,
    },
    'echoes-age-1-intro': { 'Why They Linger': `${echo}lower-landing-table-v1.webp`, 'Sit Down': `${echo}lower-landing-table-v1.webp` },
    'echoes-1-tovin-pre': { 'You Showed Up': `${echo}lower-landing-table-v1.webp` },
    'echoes-1-tovin-defeat': { 'The Watch Continues': `${echo}lower-landing-table-v1.webp` },
    'echoes-1-tovin-victory': {
        'There': `${echo}lower-landing-table-v1.webp`,
        'The Record': `${echo}lower-landing-rope-table-v1.webp`,
        'Finished': `${echo}lower-landing-rope-table-v1.webp`,
    },
    'echoes-1-tovin-rematch': { 'Replay the Memory': `${echo}lower-landing-table-v1.webp` },
    'echoes-age-2-intro': {
        'The Middle Floors': `${echo}middle-records-gallery-v1.webp`,
        'What You Carried Up': `${echo}middle-records-gallery-v1.webp`,
        'The Ledgers That Learned to Lie': '/scenes/story/echoes-ansel.webp',
        'Why They Linger': '/scenes/story/echoes-korin.webp',
    },
    'echoes-age-3-intro': {
        'Whose Machine It Was': '/scenes/story/echoes-lyra.webp',
        'Why They Linger': '/scenes/story/echoes-eren.webp',
    },
    'echoes-age-4-intro': {
        'Why He Lingers': '/scenes/story/echoes-halden.webp',
        'The Witness He Could Not Choose': '/scenes/story/echoes-halden.webp',
    },
    'echoes-8-eren-victory': { 'Adjourned': `${echo}tribunal-sash-table-v1.webp` },
};
export const SECONDARY_ARTWORK_DEFAULTS: Readonly<Record<string, string>> = {
    'rift-giver-mirror-shard': `${side}rift-nemo-shuttered-booth-v1.webp`,
    'rift-first-clear-mirror-shard': `${side}rift-nemo-shuttered-booth-v1.webp`,
    'rift-first-clear-hollow-stalker': `${side}rift-stalker-sealed-slope-v1.webp`,
    'rift-first-clear-beast-warren': `${side}rift-warren-mouth-after-v1.webp`,
    'rift-first-clear-legacy-echo': `${side}rift-giver-legacy-echo.webp`,
    'rift-first-clear-engine-echo': `${side}rift-giver-engine-echo.webp`,
    'rift-first-clear-hollow-name': `${side}rift-hall-carved-names-v1.webp`,
    'rift-first-clear-gate-heir': `${side}harrow-waystation-evidence-v1.webp`,
    'echoes-9-lyra-victory': `${echo}engine-conduit-shutdown-v1.webp`,
    'story-road-unsworn-ledger': `${side}road-sealed-convoy-v1.webp`,
    'story-road-black-bridge': `${side}road-black-bridge-exchange-v1.webp`,
    'story-road-second-teacher': `${side}road-waystation-practice-yard-v1.webp`,
    'story-road-rival-who-keeps-losing': `${side}road-waystation-frost-ring-v1.webp`,
};

// Only the shared VN reader receives these cutouts. Opponent-card and battle
// portraits keep their original files. Explicit actor images bypass this map.
const ECHOES_CUTOUTS: Readonly<Record<string, { name: string; image: string }>> = {
    'echoes-1-tovin': { name: 'Tovin', image: '/portraits/cinematic/echoes/tovin-cutout-v1.webp' },
    'echoes-2-vetta': { name: 'Vetta', image: '/portraits/cinematic/echoes/vetta-cutout-v1.webp' },
    'echoes-3-aya': { name: 'Aya', image: '/portraits/cinematic/echoes/aya-cutout-v1.webp' },
    'echoes-4-ansel': { name: 'Ansel', image: '/portraits/cinematic/echoes/ansel-cutout-v1.webp' },
    'echoes-6-korin': { name: 'Korin', image: '/portraits/cinematic/echoes/korin-cutout-v1.webp' },
    'echoes-5-sela': { name: 'Sela', image: '/portraits/cinematic/echoes/sela-linen-cutout-v1.webp' },
    'echoes-7-nima': { name: 'Nima', image: '/portraits/cinematic/echoes/nima-cutout-v1.webp' },
    'echoes-8-eren': { name: 'Eren', image: '/portraits/cinematic/echoes/eren-cutout-v1.webp' },
    'echoes-9-lyra': { name: 'Lyra', image: '/portraits/cinematic/echoes/lyra-cutout-v1.webp' },
    'echoes-10-halden': { name: 'Halden', image: '/portraits/cinematic/echoes/halden-cutout-v1.webp' },
};
export function secondaryVnActorPose(eventId: string, pageTitle: string, actorName: string): VnActorPose | undefined {
    if (actorName === 'Eren' && eventId === 'echoes-8-eren-victory' && ['The Ruling', 'Adjourned'].includes(pageTitle)) return 'resolute';
    if (actorName === 'Tovin' && eventId === 'echoes-1-tovin-victory' && ['The Record', 'Finished'].includes(pageTitle)) return 'resolute';
    if (actorName === 'Sela' && /^echoes-5-sela-(?:pre|defeat|victory|rematch)$/.test(eventId)) {
        return eventId === 'echoes-5-sela-pre' && pageTitle !== 'What I Need' ? 'neutral' : 'resolute';
    }
    return undefined;
}
export function secondaryVnActorImage(eventId: string, actorName: string, source: string, pose: VnActorPose = 'neutral'): string {
    if (eventId === 'rift-first-clear-beast-warren' && actorName === 'Houndmaster Bel' && source === '/portraits/cinematic/side-stories/houndmaster-bel-clean-alpha-v1.webp') return '/portraits/cinematic/side-stories/houndmaster-bel-nara-rescue-v1.webp';
    const id = eventId.replace(/-(?:pre|defeat|victory|rematch)$/, '');
    const actor = ECHOES_CUTOUTS[id];
    // Narration has no actor. The encounter avatar is card-screen metadata,
    // not a portrait for the narrator. Only suppress the exact bundled default;
    // deliberate page images and unfamiliar creator avatars remain authoritative.
    if (actorName === 'Narrator' && actor && source === `/portraits/${actor.name.toLowerCase()}.webp`) return '';
    if (eventId === 'echoes-10-halden-rematch' && actorName === 'Halden' && source === '/portraits/halden.webp') return '';
    if (!actor || actor.name !== actorName || source !== `/portraits/${actorName.toLowerCase()}.webp`) return source;
    if (actorName === 'Sela' && pose === 'resolute') return '/portraits/cinematic/echoes/sela-empty-hand-v1.webp';
    if (actorName === 'Tovin' && pose === 'resolute') return '/portraits/cinematic/echoes/tovin-empty-hand-v1.webp';
    if (actorName === 'Eren' && pose === 'resolute') return '/portraits/cinematic/echoes/eren-sash-removed-v1.webp';
    return actor.image;
}

export function secondaryVnActorAbsent(eventId: string, actorName: string, resolvedImage: string): boolean {
    return eventId === 'echoes-10-halden-rematch' && actorName === 'Halden' && !resolvedImage;
}
