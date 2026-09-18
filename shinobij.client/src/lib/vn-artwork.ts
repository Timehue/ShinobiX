import type { CreatorEvent } from "../types/vn";
import { STORYWIDE_ENVIRONMENTS, STORYWIDE_ENVIRONMENT_VARIANTS } from "./vn-storywide-direction";
import { fieldArtwork } from './vn-field-artwork';
import { SECONDARY_ARTWORK_CORRECTIONS, SECONDARY_ARTWORK_DEFAULTS } from './vn-secondary-artwork';

type Page = NonNullable<CreatorEvent["vnPages"]>[number];
const cinematic = "/scenes/story/cinematic/";
// Share the path prefix at runtime so the artwork table stays within the shipped bundle budget.
function scene(file: string): string { return `${cinematic}${file}.webp`; }

// Asset-specific crop correction. Authored positions still take precedence.
export function vnArtworkFocalPoint(image: string, eventId?: string): string | undefined {
    if (image === '/scenes/story/echoes-aya.webp') return '18% 50%';
    if (image === '/scenes/story/echoes-lyra.webp') return '85% 50%';
    if (image === scene("echoes/engine-conduit-shutdown-v1")) return '85% 50%';
    if (image === scene("side-stories/road-sealed-convoy-v1")) return '30% 50%';
    if (image === scene("side-stories/road-black-bridge-exchange-v1")) return '80% 50%';
    if (image === scene("side-stories/road-black-bridge-first-bolt-v1")) return '85% 50%';
    if (image === scene("side-stories/road-four-keys-firelit-detail-v1")) return '55% 50%';
    if (image === scene("side-stories/rift-disused-engine-yard-v1")) return '50% 100%';
    if (image === scene("side-stories/rift-nemo-shuttered-booth-v1")) return '50% 100%';
    if (image === scene("side-stories/road-coldbrook-ditch-v1")) return '40% 50%';
    if (image === scene("side-stories/road-alliance-recarved-seal-v1")) return '60% 50%';
    if (image === scene("side-stories/road-hamlet-shuttered-porch-v1")) return '35% 50%';
    if (image === scene("side-stories/road-west-ford-mill-loft-v1")) return '35% 50%';
    if (image === scene("side-stories/road-shrine-two-approaches-v1")) return '35% 50%';
    if (image === scene("side-stories/road-eleven-frozen-footprints-v1")) return '35% 50%';
    if (image === scene("side-stories/harrow-waystation-contract-v1")) return eventId === 'story-reckoning-harrow-unbought-return' ? '75% 50%' : '20% 50%';
    if (image === scene("side-stories/harrow-waystation-evidence-v1")) return '90% 50%';
    if (image === scene("storywide/stormveil-arena-public-meter-v1")) return "40% 50%";
    if (image === scene("storywide/stormveil-new-keeper-floor-v1")) return "35% 50%";
    if (image === scene("storywide/ashen-kiln-yard-cold-day-v2")) return "30% 50%";
    if (image === scene("storywide/moonshadow-keeper-account-stall-v1")) return "40% 50%";
    if (image === scene("storywide/moonshadow-stall-returned-file-v1")) return "60% 50%";
    if (image === scene("storywide/moonshadow-returned-files-dawn-v1")) return "80% 50%";
    if (image === scene("storywide/frostfang-field-blue-ice-gully-v1")) return "30% 50%";
    if (image === scene("storywide/ashen-east-footbridge-broken-v1")) return "65% 50%";
    if (image === scene("storywide/stormveil-field-signal-cairn-v1")) return "40% 50%";
    return image === scene("storywide/frostfang-lantern-relay-setup-v1") ? "28% 50%" : undefined;
}

// Artwork only: these corrections must not change sound, camera or timing.
// Keys name the actual event and page, rather than matching spoken keywords.
export const STORY_ARTWORK_CORRECTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    ...SECONDARY_ARTWORK_CORRECTIONS,
    'sys-ancient-chest': { 'The Chest Opens': scene("system/ancient-courier-chest-open-v1") },
    ...Object.fromEntries(['builtin-hidden-dungeon', 'craft-dungeon-forest', 'craft-dungeon-snow', 'craft-dungeon-volcano', 'craft-dungeon-shadow', 'craft-dungeon-central'].map(id => [id, {
        'Second Seal: The Chronicle Table': scene("system/dungeon-chronicle-altar-v1"),
        'Third Seal: The Companion': scene("system/dungeon-companion-chamber-v1"),
    }])),
    'story-interlude-stormveil-village-20': {
        'The Coast Gate': scene("storywide/stormveil-threshold"),
        "An Appraiser's Receipt": scene("storywide/stormveil-threshold"),
    },
    'story-interlude-stormveil-village-70': {
        "Pike's Shrug": '/scenes/story/story-stormveil-village-50-4.webp',
        'The Third Exchange': '/scenes/story/story-stormveil-village-50-4.webp',
    },
    'story-reckoning-iro-sealed-shelf': {
        'Filed Under Load-Bearing': scene("storywide/moonshadow-founding-stone-closed-v1"),
        'Close It for Good': scene("storywide/moonshadow-founding-stone-closed-v1"),
    },
    'story-reckoning-iro-sealed-shelf-return': { 'Unsealed': scene("storywide/moonshadow-founding-stone-closed-v1") },
    'story-moonshadow-village-65-5': {
        'The Unwritten Order': scene("storywide/moonshadow-intimate"),
        'The Copied Names': scene("storywide/moonshadow-canal-shrine-records-v1"),
        'The Third Page': scene("storywide/moonshadow-canal-shrine-records-v1"),
        'The Second Knife': scene("storywide/moonshadow-canal-shrine-door-v1"),
        "The Executioner's Patience": scene("storywide/moonshadow-canal-shrine-door-v1"),
    },
    'story-ashen-leaf-village-85-7': {
        "Imera's Kitchen": scene("storywide/ashen-imera-kitchen-v1"),
        ...Object.fromEntries(['The Orchard Office', 'Not Firewood', 'The Scarred Line', 'The Unwilling'].map(title => [title, scene("storywide/ashen-orchard-office-v1")])),
    },
    'story-epilogue-ashen-leaf-village-honorable': {
        'The Channel Never Stopped': scene("storywide/ashen-east-channel-frost-v1"),
        'What Came Back': scene("storywide/ashen-ash-house-row-dawn-v1"),
        'A Thin Spring, Freely Chosen': scene("storywide/ashen-reed-kitchen-letter-v1"),
    },
    'story-epilogue-ashen-leaf-village-merciful': {
        'Bought Honestly Twice': scene("storywide/ashen-kiln-yard-cold-day-v2"),
        'The Willing Flame': scene("storywide/ashen-willing-flame-v1"),
        'The Right to Be Asked': scene("storywide/ashen-kiln-stair-door-v1"),
    },
    'story-epilogue-ashen-leaf-village-ambitious': {
        'The New Keeper': scene("storywide/ashen-rootfire-new-keeper-v1"),
        'The Chair': scene("storywide/ashen-kiln-stair-door-v1"),
        'The Reed Kitchen': scene("storywide/ashen-kiln-stair-door-v1"),
        'The Next Black Flower': scene("ashen-register-hall-wide"),
    },
    'story-epilogue-frostfang-village-honorable': {
        'What Came Home': scene("storywide/frostfang-volunteer-wall-dawn-v1"),
        'A Thin Wall, Freely Manned': scene("storywide/frostfang-volunteer-wall-dawn-v1"),
        'The Lanterns Take the Watch': scene("storywide/frostfang-lantern-relay-dawn-v1"),
    },
    'story-epilogue-frostfang-village-merciful': {
        'The Metered Vault': scene("storywide/frostfang-public-meter-v1"),
        'The Signature': scene("storywide/frostfang-public-meter-v1"),
        "The Keeper's Successor": scene("storywide/frostfang-records-room-v1"),
    },
    'story-epilogue-frostfang-village-ambitious': {
        'The New Keeper': scene("storywide/frostfang-climax-meter-zero"),
        'The Filed Refusal': scene("storywide/frostfang-interior-tower-stair-v1"),
        'The North Post': scene("storywide/frostfang-interior-tower-stair-v1"),
        'The First Name After Yours': scene("storywide/frostfang-roll-stone-v1"),
    },
    'story-epilogue-stormveil-village-honorable': {
        'What Came Home': scene("storywide/stormveil-broken-board-dawn-v2"),
        'The Ridge Holds': scene("storywide/stormveil-anchor-web-dawn-v1"),
        'Rigging Season': '/scenes/story/story-stormveil-village-25-2.webp',
    },
    'story-epilogue-stormveil-village-suspicious': {
        'Rock and Law': scene("storywide/stormveil-anchor-web-dusk-v1"),
        'The Metered Floor': scene("storywide/stormveil-arena-public-meter-v1"),
        'The Clerk of Storms': scene("storywide/stormveil-tower-office-v1"),
    },
    'story-epilogue-moonshadow-village-honorable': {
        'The New Rates': scene("storywide/moonshadow-public-witness-square-v1"),
        'The Long Noon': scene("storywide/moonshadow-public-witness-square-v1"),
        'What Went Home': scene("storywide/moonshadow-returned-files-dawn-v1"),
    },
    'story-epilogue-moonshadow-village-merciful': {
        'Nine Parts Home': scene("storywide/moonshadow-sealed-tenth-audit-v1"),
        "The Keeper's Ledger": scene("storywide/moonshadow-sealed-tenth-audit-v1"),
        'The Noon Question': scene("storywide/moonshadow-public-witness-square-v1"),
    },
    'story-epilogue-moonshadow-village-loyal': {
        'Nerissa at the Door': scene("storywide/moonshadow-keeper-chamber-door-v1"),
        "The Keeper's Door": scene("storywide/moonshadow-keeper-chamber-door-v1"),
        "The Keeper's Open Account": scene("storywide/moonshadow-keeper-account-stall-v1"),
        'The New Glass': scene("storywide/moonshadow-climax-black-glass"),
    },
    'story-epilogue-stormveil-village-ambitious': {
        'The New Weather': scene("storywide/stormveil-new-keeper-floor-v1"),
        'The Stool at the Rail': scene("storywide/stormveil-challenge-board-v1"),
        'Her Mother Heard': '/scenes/story/story-interlude-stormveil-village-92.webp',
        'The Packed Bag': '/scenes/story/story-interlude-stormveil-village-92.webp',
    },
    'story-interlude-moonshadow-village-42': {
        'Following It Down': scene("storywide/moonshadow-maintenance-crawl-v1"),
        "The Drain's Direction": scene("storywide/moonshadow-quartered-drain-v1"),
    },
    "story-interlude-moonshadow-village-88": Object.fromEntries(["Eleven by Dawn", "The Twelfth File", "You Hold the Market", "Held, Not Returned", "The Empty Stool", "The Scraped Notice", "What the Market Carries"].map((title) => [title, scene("storywide/moonshadow-returning-booth-dawn-v1")])),
    "story-moonshadow-village-50-4": {
        "The Mirror Assassin": scene("storywide/moonshadow-sanctum"),
    },
    "story-frostfang-village-65-5": {
        ...Object.fromEntries(["The Old Quarry", "The Confiscated Kits"].map((title) => [title, scene("storywide/frostfang-old-quarry-predawn-v1")])),
        ...Object.fromEntries(["Dawn Comes Anyway", "Ranking Witness"].map((title) => [title, scene("storywide/frostfang-old-quarry-camp-v1")])),
    },
    "story-stormveil-village-65-5": Object.fromEntries(["The Camp That Keeps Its Anger", "The Rescued Slates", "Eight Riders", "The Ranking Witness"].map((title) => [title, scene("storywide/stormveil-ravine-camp-v1")])),
    "story-interlude-ashen-leaf-village-88": {
        "Trust Catches Up": scene("storywide/ashen-split-vane-v1"),
        ...Object.fromEntries(["The Water Climbs", "The Number", "The Model and the Machine", "You Carry the Door", "Grateful Is Not Ready", "The Wider Wedge", "The Extra Lamp"].map((title) => [title, scene("storywide/ashen-east-channel-working-v1")])),
        "The Water Keeps Climbing": scene("storywide/ashen-east-channel-dawn-v1"),
    },
    "story-interlude-ashen-leaf-village-92": Object.fromEntries(["The Better Winter", "What They Saw", "The Dry Report", "The Signatures"].map((title) => [title, scene("storywide/ashen-east-channel-dawn-v1")])),
    "story-stormveil-village-100-8": {
        "The Village Climbs": "/scenes/story/story-interlude-stormveil-village-92.webp",
        "At the Gate": "/scenes/story/story-interlude-stormveil-village-92.webp",
        "The Blank Board": scene("storywide/stormveil-climax-blank-board"),
    },
    "story-interlude-stormveil-village-88": {
        "Knots Under Torsion": scene("storywide/stormveil-failed-splice-v1"),
        "The Line Holds": scene("storywide/stormveil-anchor-web-storm-v1"),
        ...Object.fromEntries(["The Count at Dawn", "The Reason and the Rigging", "You Hold the Sky", "Rigged, Not Argued", "The Dry Coil", "The Low-Road Rail", "Chalk on the Cable Drum"].map((title) => [title, scene("storywide/stormveil-anchor-web-dawn-v1")])),
    },
    "story-interlude-frostfang-village-88": {
        "The First Line Fails": scene("storywide/frostfang-lantern-relay-failed-v1"),
        "Fear, Retired": scene("storywide/frostfang-lantern-relay-failed-v1"),
        "Nineteen Minutes": scene("storywide/frostfang-lantern-relay-storm-v1"),
        ...Object.fromEntries(["The Drill Log", "The Walker and the Walk", "You Hold the Stair", "Kept, Not Carried", "Half Wicks", "The Flour Map", "What Enters the Roll"].map((title) => [title, scene("storywide/frostfang-lantern-relay-dawn-v1")])),
    },
    "story-interlude-stormveil-village-92": { "The Web From Above": scene("storywide/stormveil-anchor-web-dawn-v1") },
    "story-frostfang-village-4-0": {
        ...Object.fromEntries([
            "First Bell", "The Intake", "A Guard's Reason", "A Strong Back", "A Debt to Pay", "A Door That Closed", "A Blank Line",
        ].map((title) => [title, scene("storywide/frostfang-roll-stone-v1")])),
        "The Fogged Plate": scene("storywide/frostfang-mark-plate-v1"),
        "Someone Long Gone": scene("storywide/frostfang-mark-plate-v1"),
    },
    "story-moonshadow-village-4-0": {
        ...Object.fromEntries([
            "Two Names", "The First Trade", "A Guardian's Answer", "A Buyer's Answer", "A Debtor's Answer", "A Listener's Answer", "An Open Answer",
        ].map((title) => [title, scene("storywide/moonshadow-registry-booth-v1")])),
        "Half a Second Late": scene("storywide/moonshadow-registry-water-v1"),
        "Line Five": scene("storywide/moonshadow-threshold"),
        "The Silent Yard": scene("storywide/moonshadow-silent-yard-v1"),
    },
    "story-stormveil-village-4-0": Object.fromEntries([
        "The Challenge Board", "The Reason Line", "A Shield Reason", "A Ladder Reason",
        "A Debt Reason", "A Searching Reason", "A Blank Reason", "Posted Twice", "Elder Vanta",
    ].map((title) => [title, scene("storywide/stormveil-challenge-board-v1")])),
    "story-ashen-leaf-village-15-1": {
        "Mori Counts": scene("ashen-annex-charts"),
        ...Object.fromEntries(["The Night Watch", "Imera's Shears", "The Longest Cut"].map((title) => [title, scene("storywide/ashen-eleven-flower-fence-night-v1")])),
    },
    "story-ashen-leaf-village-25-2": Object.fromEntries([
        "After Hours", "Jorun's Plans", "The Bridge", "A Quiet Debt", "Aren Reed", "The Archive Wakes", "The Keeper of Copies",
    ].map((title) => [title, scene("ashen-register-annex")])),
    "story-ashen-leaf-village-65-5": {
        ...Object.fromEntries(["Escort Orders", "A Fair Question", "The Charts"].map((title) => [title, scene("ashen-register-annex")])),
        ...Object.fromEntries(["The Third Crate", "The Manifest Under the Ash", "The Retrieval Squad", "Lantern Light"].map((title) => [title, scene("storywide/ashen-third-crate-open-v1")])),
    },
    "story-moonshadow-village-85-7": {
        'The Night of Open Files': scene("storywide/moonshadow-returned-files-dawn-v1"),
        'The Veiled Hand Grandmaster': scene("storywide/moonshadow-interior-tower-stair-v1"),
        "The Empty Archive": scene("storywide/moonshadow-empty-tower-archive-v1"),
        "The Controlled Burn": scene("storywide/moonshadow-stall-returned-file-v1"),
        "The Buyer's Name": scene("storywide/moonshadow-intimate"),
    },
    "story-frostfang-village-50-4": Object.fromEntries([
        "Both or Neither", "The Oath Is a Comfort", "What Doubt Weighs", "The Pen Gets Lighter", "The Rank Trial",
    ].map((title) => [title, scene("storywide/frostfang-civic")])),
    "story-frostfang-village-85-7": {
        "What Harrow Sells": scene("storywide/frostfang-forger-icehouse-v1"),
        "The Rhythm's Flaw": scene("storywide/frostfang-forger-icehouse-v1"),
        "The Quartermaster of Doubt": scene("storywide/frostfang-civic"),
        "The Alpha Guard": scene("storywide/frostfang-vault-antechamber-v1"),
    },
    "story-frostfang-village-100-8": {
        "The Open Ledgers": scene("storywide/frostfang-records-room-v1"),
        "The Unclosed Door": scene("storywide/frostfang-vault-antechamber-v1"),
        "The Pack Comes Down": scene("storywide/frostfang-threshold"),
        "The Stair Held by Choice": scene("storywide/frostfang-interior-tower-stair-v1"),
    },
    "story-ashen-leaf-village-75-6": Object.fromEntries(["The First Flame", "The Ask", "The Ghost Lines", "The Bellows", "Grief, Off the Chain"].map((title) => [title, scene("storywide/ashen-sanctum")])),
    "story-stormveil-village-85-7": {
        "The Weather Ledger": scene("storywide/stormveil-tower-office-v1"),
        "The Rigger's Answer": '/scenes/story/story-stormveil-village-25-2.webp',
    },
    "story-frostfang-village-75-6": {
        'Self-Injury, Filed': scene("storywide/frostfang-interior-tower-stair-v1"),
        ...Object.fromEntries([
        "Drill Fashion", "Line by Line", "The Same Hand", "Her Own Name",
        ].map((title) => [title, scene("storywide/frostfang-intimate")])),
    },
    "story-moonshadow-village-35-3": Object.fromEntries([
        "The Bleeding Page", "The Kept No", "The Counterparty", "The Contract's Guard",
    ].map((title) => [title, scene("storywide/moonshadow-intimate")])),
    "story-stormveil-village-25-2": {
        "Vanta Reads the Wax": scene("storywide/stormveil-intimate"),
        "The Listener": scene("storywide/stormveil-intimate"),
    },
    "story-stormveil-village-75-6": {
        "The Estate Closure": scene("storywide/stormveil-challenge-board-v1"),
        "The Routing Mark": scene("storywide/stormveil-challenge-board-v1"),
        "Storm Rules": "/scenes/story/story-stormveil-village-25-2.webp",
        "Main Card": "/scenes/story/story-stormveil-village-50-4.webp",
    },
    "story-interlude-ashen-leaf-village-42": {
        "Sera Reed": scene("storywide/ashen-reed-kitchen-v1"),
        "The Painted Wall": scene("storywide/ashen-painted-tool-wall-v1"),
        "The Edit Holds": scene("storywide/ashen-reed-kitchen-v1"),
        "The Dish Towel": scene("storywide/ashen-reed-kitchen-v1"),
    },
    "story-interlude-frostfang-village-20": {
        "Hazard Pay": scene("storywide/frostfang-roll-stone-v1"),
        "The Outside View": "/scenes/story/story-interlude-frostfang-village-30.webp",
        "The Anomaly": scene("storywide/frostfang-threshold"),
    },
    "story-ashen-leaf-village-50-4": {
        "Before the Bell": scene("ashen-annex-steps"),
    },
    "story-ashen-leaf-village-100-8": {
        "Frost-Fall": scene("ashen-register-hall-wide"),
        "At the Stair": scene("storywide/ashen-kiln-stair-door-v1"),
    },
    "story-moonshadow-village-15-1": {
        "The Money That Sits": scene("storywide/moonshadow-registry-booth-v1"),
        "The Kage's Mercy": scene("storywide/moonshadow-threshold"),
    },
    "story-moonshadow-village-100-8": {
        "The Black Moon": "/scenes/story/story-moonshadow-village-100-8.webp",
        "At the Chamber Door": "/scenes/story/story-moonshadow-village-100-8.webp",
    },
    "story-stormveil-village-35-3": {
        "Down the Well That Isn't": "/scenes/story/story-stormveil-village-35-3.webp",
    },
};

// Only reviewed, single-location groups are held across the event. Page
// corrections above describe moves and detail inserts within those groups.
export const STORY_ARTWORK_DEFAULTS: Readonly<Record<string, string>> = {
    'story-interlude-moonshadow-village-80': scene("storywide/moonshadow-subtower-dry-dock-v1"),
    "story-ashen-leaf-village-65-5": scene("storywide/ashen-kiln-road-wagon-v1"),
    "story-interlude-moonshadow-village-88": scene("storywide/moonshadow-returning-booth-night-v1"),
    "story-moonshadow-village-50-4": scene("storywide/moonshadow-mirrored-chamber-v1"),
    "story-frostfang-village-100-8": scene("storywide/frostfang-climax-meter-zero"),
    "story-interlude-stormveil-village-88": "/scenes/story/story-interlude-stormveil-village-88.webp",
    "story-interlude-frostfang-village-88": scene("storywide/frostfang-lantern-relay-setup-v1"),
    "story-stormveil-village-100-8": scene("storywide/stormveil-storm-floor-v1"),
    "story-interlude-ashen-leaf-village-88": scene("storywide/ashen-east-channel-night-v1"),
    "story-ashen-leaf-village-15-1": scene("storywide/ashen-eleven-flower-fence-dawn-v1"),
    "story-interlude-moonshadow-village-58": scene("storywide/moonshadow-undercellar-archive-v1"),
    "story-interlude-frostfang-village-80": scene("storywide/frostfang-forger-icehouse-v1"),
    "story-stormveil-village-25-2": "/scenes/story/story-stormveil-village-25-2.webp",
    "story-stormveil-village-50-4": "/scenes/story/story-stormveil-village-50-4.webp",
    "story-stormveil-village-35-3": scene("storywide/stormveil-eleven-pipes-v1"),
    "story-interlude-stormveil-village-30": "/scenes/story/story-interlude-stormveil-village-30.webp",
    "story-interlude-stormveil-village-58": scene("storywide/stormveil-intimate"),
    "story-ashen-leaf-village-35-3": scene("storywide/ashen-sanctum"),
    "story-ashen-leaf-village-50-4": scene("storywide/ashen-civic"),
    "story-ashen-leaf-village-100-8": scene("storywide/ashen-climax-rootfire"),
    "story-interlude-ashen-leaf-village-30": scene("storywide/ashen-intimate"),
    "story-interlude-ashen-leaf-village-58": scene("ashen-annex-charts"),
    "story-interlude-ashen-leaf-village-70": scene("ashen-register-wall"),
    "story-interlude-frostfang-village-30": "/scenes/story/story-interlude-frostfang-village-30.webp",
    "story-interlude-frostfang-village-58": scene("storywide/frostfang-records-room-v1"),
    "story-interlude-frostfang-village-70": scene("storywide/frostfang-vault-antechamber-v1"),
    "story-moonshadow-village-15-1": "/scenes/story/story-moonshadow-village-15-1.webp",
    "story-moonshadow-village-25-2": scene("storywide/moonshadow-cellar-auction-v1"),
    "story-moonshadow-village-75-6": "/scenes/story/story-moonshadow-village-75-6.webp",
    "story-moonshadow-village-100-8": scene("storywide/moonshadow-climax-black-glass"),
    "story-interlude-moonshadow-village-30": scene("storywide/moonshadow-registry-booth-v1"),
    "story-interlude-moonshadow-village-70": "/scenes/story/story-moonshadow-village-15-1.webp",
};

const RECKONING_BACKDROPS: Readonly<Record<string, string>> = {
    "story-reckoning-vanta-ninth": scene("storywide/stormveil-threshold"),
    "story-reckoning-mori-working-copy": scene("storywide/ashen-threshold"),
    "story-reckoning-yura-exemption": scene("storywide/frostfang-threshold"),
    "story-reckoning-iro-sealed-shelf": scene("storywide/moonshadow-threshold"),
    "story-reckoning-harrow-unbought": scene("side-stories/harrow-waystation-contract-v1"),
};

function locationArtwork(event: CreatorEvent, page: Page, pageImage: string, inferred?: string): string | undefined {
    const inferredIsGeneric = Object.values(STORYWIDE_ENVIRONMENTS).some((family) => Object.values(family).includes(inferred ?? ""))
        || Object.values(STORYWIDE_ENVIRONMENT_VARIANTS).some((variants) => Object.values(variants).includes(inferred ?? ""));
    if (inferred && !inferredIsGeneric) return inferred;
    const group = STORY_ARTWORK_DEFAULTS[event.id];
    if (group) return group;
    // Only locations with a reviewed corresponding image are recognized.
    // Dialogue keywords and array offsets are not artwork direction.
    const location = page.scene.split(",", 1)[0].toLowerCase();
    if (event.id.includes("ashen")) {
        if (/\b(?:reed kitchen|kitchen)\b/.test(location)) return scene("storywide/ashen-reed-kitchen-v1");
        if (/\b(?:register hall|register wall)\b/.test(location)) return scene("ashen-register-hall-wide");
        if (/\b(?:register annex|archive)\b/.test(location)) return scene("ashen-register-annex");
        if (/\b(?:workshop|joiner's bench)\b/.test(location)) return scene("storywide/ashen-intimate");
    }
    if (event.id.includes("frostfang")) {
        if (/\brecords room\b/.test(location)) return scene("storywide/frostfang-records-room-v1");
        if (/\boath hall\b/.test(location)) return scene("storywide/frostfang-civic");
        if (/\broll stone\b/.test(location)) return scene("storywide/frostfang-roll-stone-v1");
        if (/\bvault antechamber\b/.test(location)) return scene("storywide/frostfang-vault-antechamber-v1");
    }
    return pageImage || inferred;
}

function bundledDefault(event: CreatorEvent, image: string, page: Page): boolean {
    if (!image) return true;
    // Exact shipped defaults only. Queries, uploads and unfamiliar filenames
    // can be legitimate authoring and must never be rejected by a slug test.
    if (image === `/scenes/story/${event.id}.webp` || image === `/scenes/${event.id}.png`) return true;
    if (event.id.startsWith('rift-first-clear-') && image === `/scenes/story/rift-giver-${event.id.slice('rift-first-clear-'.length)}.webp`) return true;
    const echoEra = /^echoes-age-([1-4])-intro$/.exec(event.id)?.[1];
    if (echoEra && image === `/scenes/story/echoes-age-${echoEra}.webp`) return true;
    if (/^echoes-1-tovin-(?:pre|defeat|victory|rematch)$/.test(event.id) && image === '/scenes/story/echoes-tovin.webp') return true;
    if (event.id === 'echoes-8-eren-victory' && image === '/scenes/story/echoes-eren.webp') return true;
    if (event.id === 'echoes-9-lyra-victory' && image === '/scenes/story/echoes-lyra.webp') return true;
    if (event.id.startsWith('story-reckoning-field:')) {
        const suffix = event.id.slice('story-reckoning-field:'.length);
        const questId = suffix.split(':', 1)[0];
        if (image === fieldArtwork(questId, suffix, page.title)) return true;
        const village = { 'Stormveil Village': 'stormveil', 'Ashen Leaf Village': 'ashen', 'Frostfang Village': 'frostfang', 'Moonshadow Village': 'moonshadow' }[event.village ?? ''] as keyof typeof STORYWIDE_ENVIRONMENTS | undefined;
        if (village && image === STORYWIDE_ENVIRONMENTS[village].threshold) return true;
        // Replay's extra receipt page keeps the previous location. It is still
        // built-in direction, not a creator image override.
        if (page.title === 'Your Recorded Choice' && event.vnPages?.some(p => image === fieldArtwork(questId, suffix, p.title))) return true;
    }
    if (event.id.startsWith("story-epilogue-")) {
        const village = event.village?.toLowerCase().replace(/\W+/g, "-");
        return image === `/scenes/story/story-${village}-100-8.webp`;
    }
    return false;
}

export function resolveVnArtworkBackground(input: {
    event: CreatorEvent; page: Page; lineIndex: number; pageImage: string;
    inferredImage?: string; pilotImage?: string;
}): string {
    const { event, page, lineIndex, pageImage, inferredImage, pilotImage } = input;
    // Line > page > event direction, then explicit page/event image fields.
    // Pilot line reveals must not overwrite any of those explicit directions.
    const explicit = page.lines?.[lineIndex]?.cinematic?.backgroundImage?.trim()
        || page.cinematic?.backgroundImage?.trim()
        || event.cinematic?.backgroundImage?.trim();
    if (explicit) return explicit;
    if (page.image?.trim() && !bundledDefault(event, page.image.trim(), page)) return page.image.trim();
    if (event.image?.trim() && !bundledDefault(event, event.image.trim(), page)) return event.image.trim();
    if (event.id === 'rift-descend-beast-warren' && page.title === 'The Warren' && lineIndex >= 2) return scene("side-stories/rift-nara-controlled-warren-v1");
    if (event.id === 'story-road-four-seals-one-gate' && page.title === 'Four Stones, One Hand') {
        const scene = lineIndex === 0 ? 'storm-founding-stone' : lineIndex < 3 ? 'three-founding-stones' : 'moon-founding-stone';
        return `${cinematic}side-stories/road-${scene}-v1.webp`;
    }
    if (event.id === 'story-reckoning-harrow-unbought-return' && page.title === 'Nailed to the Board' && lineIndex >= 2) return scene("side-stories/harrow-waystation-evidence-v1");
    // The breakdown is learned during this page; retain the pre-failure art
    // until the actual line, including when a replay resumes mid-page.
    if (event.id === "story-interlude-ashen-leaf-village-88" && page.title === "The First Turn" && lineIndex >= 1) return scene("storywide/ashen-split-vane-v1");
    if (event.id === "story-interlude-stormveil-village-88" && page.title === "The First Raise") return `${cinematic}storywide/${lineIndex >= 1 ? "stormveil-failed-splice" : "stormveil-anchor-web-storm"}-v1.webp`;
    if (event.id === 'story-interlude-moonshadow-village-42' && page.title === 'Following It Down' && lineIndex >= 1) return `${cinematic}storywide/${lineIndex >= 2 ? 'moonshadow-junction-ledger' : 'moonshadow-nine-pipe-junction'}-v1.webp`;
    const correction = STORY_ARTWORK_CORRECTIONS[event.id]?.[page.title] ?? SECONDARY_ARTWORK_DEFAULTS[event.id];
    if (correction) return correction;
    if (pilotImage) return pilotImage;
    const reckoning = RECKONING_BACKDROPS[event.id.replace(/-return$/, "")];
    if (reckoning) return reckoning;
    return locationArtwork(event, page, pageImage, inferredImage) || pageImage;
}
