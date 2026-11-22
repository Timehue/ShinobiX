/*
 * The cast of the quest lines: who the player meets and fights.
 *
 * On the sector map (owner ruling, 2026-11-18), each character
 * wears a world model the game already has, under a new name and in a new
 * role. `model` is the model's file name in
 * shinobij.client/src/data/sector-models/. Their scene and fight cutouts are listed below.
 *
 * The game has about thirty generic models and the coast has more named people
 * than that. So a face can be worn twice, by the plan's own rule: never by two
 * named characters who are met in the same sector, and never by two keepers
 * (shared/coast-cast.test.ts).
 *
 * Only generic models are recast: wanderer archetypes, patrols and bandits.
 * Story characters, the Cinderhold NPCs and the First Pact cast are never
 * reused, because players know those faces by name. The one exception is the
 * Wandering Sage, who appears as himself.
 *
 * Names settled 2026-11-20 (the owner asked for them to be decided for the
 * game and its players). Each is a plain word for the character's work or
 * place, in the same register as the coast's own place names.
 */

export type CoastCastRole = 'giver' | 'keeper' | 'foe' | 'boss';

export interface CoastCastMember {
    id: string;
    name: string;
    /** What the player is told they are, in a few words. */
    title: string;
    role: CoastCastRole;
    /** An existing world model, by file name without the extension. */
    model: string;
    /** True for the one existing character who appears as himself. */
    existing?: boolean;
}

const member = (id: string, name: string, title: string, role: CoastCastRole, model: string, existing = false): CoastCastMember =>
    ({ id, name, title, role, model, ...(existing ? { existing: true } : {}) });

export const COAST_CAST: Readonly<Record<string, CoastCastMember>> = Object.fromEntries([
    member('wandering-sage', 'The Wandering Sage', 'He notices what others walk past', 'giver', 'wandering-sage', true),
    // Home map: The Shuttered Boat.
    // Not "Tomari": the home map already has Toma Reed and Tomoe, and a third name that starts the same reads as one of them.
    member('home-boatwright', 'Funade', 'Boatwright of the Western Piers', 'keeper', 'angler'),
    member('runner-lookout', "Runner's Lookout", 'Paid to watch the piers', 'foe', 'world-bandit'),
    member('chart-runner', 'Shiokaze', 'The runner who took the charts', 'boss', 'nightblade'),
    // Saltstair Landing.
    member('slip-boatwright', 'Urabe', 'Boatwright of the Saltstair slip', 'giver', 'underground-wayfarer'),
    member('record-keeper', 'Orito', 'Keeper of the Record House', 'keeper', 'courier'),
    member('unmoored-patrol', 'Unmoored Patrol', 'A garrison patrol on the landing trails', 'foe', 'ambush-bandit-2'),
    member('gate-captain', 'Iwao', 'Captain of the garrison gate', 'boss', 'bounty-hunter'),
    member('garrison-commander', 'Nigami', 'Commander of the Saltstair garrison', 'boss', 'bandit-warlord'),
    // Brackwater Fields.
    member('relay-keeper', 'Hagino', 'Keeper of the Reed Relay', 'keeper', 'merchant'),
    member('glasswake-adept', 'Minawa', 'The Unmoored adept who holds Glasswake Shelf', 'boss', 'gambler'),
    // Briarwood Deep.
    member('sentinel-warden', 'Kusabi', 'Warden of the Hollow Sentinel', 'keeper', 'medic'),
    member('leash-tamer', 'Tazuna', 'Beast tamer of the Leash Garrison', 'boss', 'tracker'),
    // Whitecrown Passes.
    member('assay-keeper', 'Haizumi', 'Assayer of the Ember Assay House', 'keeper', 'rival-miner'),
    member('rime-warden', 'Kogarashi', 'Warden of the Rime Gate', 'boss', 'patrol'),
    // Hushcrown Heights: the last ward, and the one the Unmoored answer to.
    member('twin-warden', 'Futae', 'Warden of the Double Watch', 'boss', 'nightblade'),
    member('crown-guard', 'Hushcrown Guard', 'Walks the Unheard March', 'foe', 'underground-patrol'),
    member('unmoored-leader', 'Nanashi', 'The one the Unmoored answer to, written on no roll', 'boss', 'scarred-nemesis'),
    // Raise the Clan Gate: the three the Unmoored send against a clan's founding ground.
    member('plot-reeve', 'Kuiuchi', 'Unmoored reeve of the founding ground', 'boss', 'bounty-hunter'),
    member('hall-burner', 'Tsuketa', 'Sent to burn what the clans raise', 'boss', 'tracker'),
    member('raid-captain', 'Semeguchi', 'Captain of the raid on the Landings', 'boss', 'bandit-warlord'),
    // The Boatwright's Tools: the three who keep a village hull from being built.
    member('slip-wrecker', 'Sabiro', 'Wrecker of Needle Shoal', 'boss', 'ambush-bandit-3'),
    member('pitch-warden', 'Yaniko', 'She burns the drift at Pitchwrack Strand', 'boss', 'underground-bandit'),
    member('keel-reaver', 'Hazeru', 'He cuts every keel timber before it is grown', 'boss', 'world-bandit'),
    // The Uncounted: a defector, and the three who keep the Unmoored's rolls.
    member('quay-defector', 'Ukishi', 'She is on no roll the Unmoored keep', 'keeper', 'underground-medic'),
    member('unmoored-courier', 'Unmoored Courier', 'Carries sealed word between the garrisons', 'foe', 'ambush-bandit-2'),
    member('quay-warden', 'Moyai','Warden of the Low Water Quay', 'boss', 'underground-patrol'),
    member('roll-keeper', 'Kazoe', 'Keeper of the roll in the Sunken Record', 'boss', 'underground-night-ninja'),
    member('pass-captain', 'Sekimori', 'Toll captain of the Sillward Traverse', 'boss', 'ambush-bandit-2'),
    // Untamed Coast: a keeper of the tracks, and three beasts no one has brought to heel.
    member('trace-keeper', 'Ashigara', 'Keeper of the Hound Trace', 'keeper', 'pilgrim'),
    member('brinejaw', 'Old Brinejaw', 'The hound that goes to ground in the sea smoke', 'boss', 'hollow-hound'),
    member('thornmother', 'Thornmother', 'She runs the Briarwood pack', 'boss', 'riftspawn'),
    member('whitemane', 'Whitemane', 'The rime-plated fox of the Listening Saddle', 'boss', 'ember-fox'),
].map(entry => [entry.id, entry]));

export function coastCastMember(id: unknown): CoastCastMember | undefined {
    return typeof id === 'string' && Object.hasOwn(COAST_CAST, id) ? COAST_CAST[id] : undefined;
}

/**
 * Cast ids with a painted cut-out for quest scenes or boss fights, each at
 * shinobij.client/public/portraits/cinematic/coast/<id>-v<revision>.webp
 * (output/coast/CODEX-PORTRAIT-PASS.md). A member not listed here is shown in
 * a scene with the wanderer face of their model, so portraits can land one at
 * a time. shared/coast-cast-portraits.test.ts checks the list against the folder.
 */
export const COAST_CAST_PORTRAITS: readonly string[] = [
    'quay-defector',
    'record-keeper',
    'slip-boatwright',
    'trace-keeper',
    'unmoored-leader',
    'sentinel-warden',
    'relay-keeper',
    'assay-keeper',
    'home-boatwright',
    'garrison-commander',
    'glasswake-adept',
    'leash-tamer',
    'rime-warden',
    'twin-warden',
    'chart-runner',
    'gate-captain',
    'roll-keeper',
    'pass-captain',
    'raid-captain',
    'slip-wrecker',
    'pitch-warden',
    'keel-reaver',
    'quay-warden',
    'plot-reeve',
    'hall-burner',
    'brinejaw',
    'thornmother',
    'whitemane',
    'unmoored-patrol',
    'unmoored-courier',
    'crown-guard',
    'runner-lookout',
];

/** The scene portrait for a cast member: their coast cut-out, the Sage's existing one, or none yet. */
export function coastCastPortrait(id: string): string | undefined {
    // The Sage is an existing character and already has a cut-out; he is not repainted for the coast.
    if (id === 'wandering-sage') return '/portraits/cinematic/side-stories/wandering-sage.webp';
    const revision = id === 'brinejaw' ? 2 : 1;
    return COAST_CAST_PORTRAITS.includes(id) ? `/portraits/cinematic/coast/${id}-v${revision}.webp` : undefined;
}

/**
 * Models that must never be given to a new character: named story cast and
 * named quest characters players already know. A recast of any of these would
 * read as that person turning up under a false name.
 */
export const RESERVED_CAST_MODELS: readonly string[] = [
    'elder-mori', 'elder-sova', 'elder-vanta', 'captain-yura', 'mira-volt', 'nyx', 'toma-reed', 'kite-harrow',
    'shade-master-iro', 'chronicle-scribe', 'pet-mentor-tomoe', 'tsukika', 'nemesis',
    'starter-one', 'starter-two',
];
