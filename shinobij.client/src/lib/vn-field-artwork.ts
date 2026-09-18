// Reviewed field locations, authored before any creator image overrides.
// Exact point IDs keep branch/replay imagery independent of filtered offsets.
const art = '/scenes/story/cinematic/storywide/';
const points: Readonly<Record<string, string>> = {
    'al-ash-line': '/scenes/story/cinematic/side-stories/story-road-three-footprints.webp',
    'al-charcoal-yard': `${art}ashen-field-charcoal-yard-v1.webp`,
    'al-east-channel-catch': `${art}ashen-field-silted-sluice-v1.webp`,
    'al-silted-sluice': `${art}ashen-field-silted-sluice-v1.webp`,
    'al-collapsed-footbridge': `${art}ashen-east-footbridge-broken-v1.webp`,
    'al-bridge-after-dark': `${art}ashen-east-footbridge-repair-night-v1.webp`,
    'ff-lower-road-kitchen': `${art}frostfang-lower-road-kitchen-v1.webp`,
    'ff-blue-ice-gully': `${art}frostfang-field-blue-ice-gully-v1.webp`,
    'ff-sunlit-drift': `${art}frostfang-field-sunlit-drift-v1.webp`,
    'ff-gate-stones': `${art}frostfang-roll-stone-v1.webp`,
    'ff-south-watch-post': '/scenes/story/story-interlude-frostfang-village-30.webp',
    'ms-shuttered-boathouse': `${art}moonshadow-shuttered-boathouse-v1.webp`,
    'ms-night-ferry-landing': '/scenes/story/story-interlude-moonshadow-village-80.webp',
    'ms-canal-gate': `${art}moonshadow-threshold.webp`,
    'ms-dyers-footbridge': `${art}moonshadow-threshold.webp`,
    'ms-old-toll-booth': `${art}moonshadow-registry-booth-v1.webp`,
    'sv-ridge-gate': `${art}stormveil-threshold.webp`,
    'sv-flower-pickers-shelter': `${art}stormveil-field-picker-shelter-v1.webp`,
    'sv-broken-cable-span': `${art}stormveil-field-cable-span-v1.webp`,
    'sv-signal-cairn': `${art}stormveil-field-signal-cairn-v1.webp`,
    'sv-rain-split-cairn': `${art}stormveil-field-signal-cairn-v1.webp`,
};
const aftermath: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    'story-reckoning-toma-cinders': {
        'The Bridge Takes Weight': `${art}ashen-east-footbridge-morning-v1.webp`,
        'One More Lamp': `${art}ashen-east-footbridge-two-lamps-v1.webp`,
        'Names on the Post': `${art}ashen-outskirts-register-post-v1.webp`,
    },
    'story-reckoning-mira-marker': {
        'The High Line, Rechecked': `${art}stormveil-field-marker-return-v1.webp`,
        'Weather at the Marker': `${art}stormveil-field-marker-return-v1.webp`,
        'The Low Rail': `${art}stormveil-field-picker-shelter-v1.webp`,
    },
    'story-reckoning-sova-true-roll': {
        'The First-Light Table': `${art}frostfang-lower-road-kitchen-v1.webp`,
        'The Next Name': `${art}frostfang-roll-stone-v1.webp`,
        'Two Half Measures': `${art}frostfang-roll-stone-v1.webp`,
    },
    'story-reckoning-nyx-ledger': {
        'The Back Stool Stays Empty': `${art}moonshadow-registry-booth-v1.webp`,
        'Paste Under the Nails': `${art}moonshadow-threshold.webp`,
        'The Open Chain': `${art}moonshadow-threshold.webp`,
    },
};
export function fieldArtwork(questId: string, eventSuffix: string, title: string): string | undefined {
    const point = eventSuffix.slice(questId.length + 1);
    return point === 'aftermath' ? aftermath[questId]?.[title] : points[point];
}
