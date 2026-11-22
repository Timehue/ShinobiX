/*
 * The coast's side tales: ten short stories, two a region.
 *
 * A tale is a quest line of kind 'tale'. It is worth no marks, so the main line
 * never waits on one, and it carries no Hold, so it needs no tool. Each is a
 * small matter one of the coast's keepers cannot settle alone: a letter nobody
 * carried, a ledge nobody marks, a beast still wearing a collar. Most end in a
 * choice. A tale's choice changes no reward: neither answer is the right one.
 * What the player chose is kept on their record (`standing`), where a later
 * tale or quest can read it.
 *
 * Canon they keep to (see the plan, section 1): the coast is second-age ground
 * settled by people who walked out of the villages, and the Unmoored are their
 * descendants, who keep it closed. Nothing here is older than that.
 *
 * Every step is at a place the coast's art painted, named by its site id in
 * shared/coast-world.json, and every giver is a keeper the player has already
 * met by the time the tale is offered. No tale adds a character.
 *
 * Text follows the story's rules: whole short sentences, at most two to a
 * step, no dash pauses, and a choice label of twelve words or fewer with no
 * word that says which answer is good.
 *
 * Rewards: ryo on the Quest Book curve at weights 3 to 5, the same low band as
 * the Rounds. Nothing else.
 *
 * Server-only and free of side effects, like the catalogue that includes it.
 */
import type { QuestLine, QuestLineFight } from './_types.js';

const SLIP = 'saltstair-dock-101';
const RECORD_HOUSE = 'saltstair-counter-105';
const HOUND_TRACE = 'saltstair-tracks-109';
const RELAY_HOUSE = 'brackwater-counter-113';
const DEFECTOR_QUAY = 'brackwater-dock-116';
const WATCH_POST = 'brackwater-counter-118';
const COURIER_CACHE = 'brackwater-tracks-119';
const HOLLOW_SENTINEL = 'brackwater-tree-120';
const WITNESS_SHRINE = 'briarwood-counter-122';
const SUNDERED_TETHER = 'briarwood-outcrop-128';
const RUNNERS_HOLLOW = 'briarwood-tracks-129';
const SCENT_STONE = 'briarwood-tracks-130';
const PASS_RECORD_HOUSE = 'whitecrown-counter-134';
const ASSAY_HOUSE = 'whitecrown-counter-136';
const DISPATCH_CAIRN = 'whitecrown-tracks-140';
const WITNESS_BELL = 'hushcrown-shrine-141';
const REMAKERS_WORKSHOP = 'hushcrown-counter-144';
const KEELROOT_MARKER = 'hushcrown-tracks-147';

const tale = (line: Omit<QuestLine, 'series' | 'kind' | 'world' | 'tier' | 'marks'>): QuestLine =>
    ({ ...line, series: 'coast-tales', kind: 'tale', world: 'coast', tier: 1, marks: 0 });

const TALES: readonly QuestLine[] = [
    // ── Saltstair Landing ────────────────────────────────────────────────────
    // A letter written to a village, by someone who chose the coast and wrote
    // home anyway. No courier of the Unmoored would carry it across.
    tale({
        id: 'tale-unsent-letter', title: 'The Unsent Letter', giver: 'record-keeper',
        gate: { level: 75, region: 1, quests: ['first-footing'] },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Hear the Record House keeper on a woman’s letter that no courier would carry.' },
            { key: 'shoal', kind: 'reach', place: { sector: 104 }, text: 'Go to Needle Shoal, where she waited each low tide for a boat.' },
            { key: 'trace', kind: 'enter', buildingId: HOUND_TRACE, text: 'Follow her path to the Hound Trace. Your companion finds where it ends.' },
            { key: 'letter', kind: 'choice', text: 'Decide what becomes of the letter.', choice: { prompt: 'The seal is whole. The village it names still stands. What becomes of it?', options: [
                { key: 'carry', label: 'Carry it across to her village', blurb: 'It is read aloud there. Her name is spoken again.', standing: 'tale-letter-carried' },
                { key: 'keep', label: 'Leave it sealed in the record', blurb: 'It stays in the Record House, unread.', standing: 'tale-letter-kept' },
            ] } },
            { key: 'tell', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Tell the Record House keeper what you chose.' },
        ],
        rewards: { weight: 3 },
    }),
    // The garrison takes a share of every catch at the shoal. The boatwright
    // eats what is left.
    tale({
        id: 'tale-shoal-toll', title: 'The Shoal Toll', giver: 'slip-boatwright',
        gate: { level: 75, region: 1, quests: ['first-footing'] },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: SLIP, text: 'Hear the boatwright on who takes a share of every catch at the shoal.' },
            { key: 'catch', kind: 'gather', itemId: 'quest-needle-fish', count: 4, siteIds: ['saltstair-fish-104'], text: 'Fish 4 Needle Fish at Needle Shoal. You need a fishing kunai.' },
            { key: 'toll', kind: 'boss', fightId: 'tale-shoal-toll', text: 'Wait at the shoal for the toll takers, and send them back with nothing.' },
            { key: 'bring', kind: 'deliver', buildingId: SLIP, itemId: 'quest-needle-fish', count: 4, text: 'Bring all 4 Needle Fish to the boatwright’s slip.' },
        ],
        rewards: { weight: 4 },
    }),

    // ── Brackwater Fields ────────────────────────────────────────────────────
    // Someone used to sound the ledge and leave shells to mark safe water. The
    // marks stopped. The watch decides who may know where a boat can land.
    tale({
        id: 'tale-last-sounding', title: 'The Last Sounding', giver: 'relay-keeper',
        gate: { level: 80, region: 2 },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: RELAY_HOUSE, text: 'Hear the Relay House keeper on the sounder who stopped marking the ledge.' },
            { key: 'ledge', kind: 'reach', place: { sector: 117 }, text: 'Read the shells on the Sounding Ledge. The last mark is weeks old.' },
            { key: 'drift', kind: 'reach', place: { sector: 115 }, text: 'Search the drift at Pitchwrack Strand for the sounder’s lead line.' },
            { key: 'desk', kind: 'enter', buildingId: WATCH_POST, text: 'Read the duty desk at the Watch Post. It says who was taken off the ledge.' },
            { key: 'mark', kind: 'choice', text: 'Decide whether the ledge is marked again.', choice: { prompt: 'You hold the lead line. The shells are still on the ledge. Do you mark it?', options: [
                { key: 'mark', label: 'Sound the ledge and set the shells', blurb: 'Boats find safe water again. The watch learns someone knows it.', standing: 'tale-ledge-marked' },
                { key: 'leave', label: 'Leave the ledge unmarked', blurb: 'No boat lands here unseen. Not a friend’s either.', standing: 'tale-ledge-unmarked' },
            ] } },
            { key: 'tell', kind: 'enter', buildingId: RELAY_HOUSE, text: 'Bring the lead line back to the Relay House keeper.' },
        ],
        rewards: { weight: 3 },
    }),
    // A packet left at the cache and never collected. The couriers want it
    // back. So does whoever it was meant for.
    tale({
        id: 'tale-uncollected-packet', title: 'A Packet for No One', giver: 'quay-defector',
        gate: { level: 80, region: 2, quests: ['uncounted-1'] },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: DEFECTOR_QUAY, text: 'Hear the defector on a packet that was left and never collected.' },
            { key: 'cache', kind: 'enter', buildingId: COURIER_CACHE, text: 'Take the packet from behind the loose stone at the Courier’s Cache.' },
            { key: 'hold', kind: 'boss', fightId: 'tale-cache-couriers', text: 'Hold the cache against the couriers who come back for it.' },
            { key: 'steps', kind: 'reach', place: { sector: 111 }, text: 'Carry the packet down the Brine Steps before the tide covers them.' },
            { key: 'packet', kind: 'choice', text: 'Decide who reads the packet.', choice: { prompt: 'The cord is tied in the watch’s own double knot. Who reads it?', options: [
                { key: 'open', label: 'Open it at the quay', blurb: 'The defector learns a name. So do you.', standing: 'tale-packet-opened' },
                { key: 'burn', label: 'Burn it unread', blurb: 'Whoever wrote it stays safe. Whoever it was meant for never gets it.', standing: 'tale-packet-burned' },
            ] } },
            { key: 'tell', kind: 'enter', buildingId: DEFECTOR_QUAY, text: 'Return to the defector at the Low Water Quay.' },
        ],
        rewards: { weight: 5 },
    }),

    // ── Briarwood Deep ───────────────────────────────────────────────────────
    // The shrine's keeper once hid a runner in the register room. The register
    // has a gap where her passing should be written.
    tale({
        id: 'tale-runners-cord', title: 'The Runner’s Cord', giver: 'sentinel-warden',
        gate: { level: 85, region: 3 },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: HOLLOW_SENTINEL, text: 'Hear the warden on the runner the Witness Shrine once hid.' },
            { key: 'shrine', kind: 'enter', buildingId: WITNESS_SHRINE, text: 'Find the strip of red cord in the register room of the Witness Shrine.' },
            { key: 'hollow', kind: 'enter', buildingId: RUNNERS_HOLLOW, text: 'Match it to the dispatch cloth caught in Runner’s Hollow.' },
            { key: 'trackers', kind: 'boss', fightId: 'tale-hollow-trackers', text: 'Turn back the trackers who still watch the hollow for her.' },
            { key: 'register', kind: 'choice', text: 'Decide what the register says of her.', choice: { prompt: 'The register has a blank line where she passed. What do you write?', options: [
                { key: 'write', label: 'Write that she passed through', blurb: 'She is witnessed. The trackers have a line to read.', standing: 'tale-runner-witnessed' },
                { key: 'blank', label: 'Leave the line blank', blurb: 'The trackers have nothing to follow. Nobody can prove she was here.', standing: 'tale-runner-unwritten' },
            ] } },
            { key: 'tell', kind: 'enter', buildingId: WITNESS_SHRINE, text: 'Close the register at the Witness Shrine.' },
        ],
        rewards: { weight: 5 },
    }),
    // A beast slipped its tamer years ago and still wears the collar.
    tale({
        id: 'tale-old-collar', title: 'The Old Collar', giver: 'trace-keeper',
        gate: { level: 85, region: 3, quests: ['untamed-coast-1'] },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: HOUND_TRACE, text: 'Hear the keeper of the Hound Trace on a beast that still wears a tamer’s collar.' },
            { key: 'braid', kind: 'enter', buildingId: SUNDERED_TETHER, text: 'Read the old braid at the Sundered Tether with your companion.' },
            { key: 'carp', kind: 'gather', itemId: 'quest-scent-carp', count: 4, siteIds: ['briarwood-fish-127'], text: 'Fish 4 Scent Carp at the Scentwater Shelf to draw it out. You need a fishing kunai and fishing skill 4.' },
            { key: 'leave', kind: 'deliver', buildingId: SCENT_STONE, itemId: 'quest-scent-carp', count: 4, text: 'Leave 4 Scent Carp at the Scent Stone and wait with your companion.' },
            { key: 'collar', kind: 'choice', text: 'The beast comes to the stone. Decide what to do about its collar.', choice: { prompt: 'It lets your companion close. The collar has worn the fur away. What do you do?', options: [
                { key: 'cut', label: 'Cut the collar off', blurb: 'It runs free. It will not come when called.', standing: 'tale-collar-cut' },
                { key: 'leave', label: 'Leave the collar on', blurb: 'It remembers a hand that fed it. It stays near the steps.', standing: 'tale-collar-left' },
            ] } },
            { key: 'tell', kind: 'enter', buildingId: HOUND_TRACE, text: 'Tell the keeper of the Hound Trace how it went.' },
        ],
        rewards: { weight: 4 },
    }),

    // ── Whitecrown Passes ────────────────────────────────────────────────────
    // The assay house keeps one ember alight, as it has since the first winter
    // the exiles spent in the passes. It is burning low.
    tale({
        id: 'tale-kept-ember', title: 'The Kept Ember', giver: 'assay-keeper',
        gate: { level: 90, region: 4 },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: ASSAY_HOUSE, text: 'Hear the assayer on the ember kept alight since the first winter in the passes.' },
            { key: 'glass', kind: 'gather', itemId: 'quest-emberglass', count: 4, siteIds: ['whitecrown-outcrop-133'], text: 'Mine 4 Emberglass at the Emberglass Seam to feed it. You need a pickaxe and mining skill 4.' },
            { key: 'saddle', kind: 'boss', fightId: 'tale-saddle-watch', text: 'The watch on the Listening Saddle has seen the glow. Drive them off.' },
            { key: 'feed', kind: 'deliver', buildingId: ASSAY_HOUSE, itemId: 'quest-emberglass', count: 4, text: 'Hand 4 Emberglass to the assayer for the stone cup.' },
        ],
        rewards: { weight: 5 },
    }),
    // The last boat that sailed for the villages left people ashore. The docket
    // lists them.
    tale({
        id: 'tale-last-docket', title: 'The Last Docket', giver: 'quay-defector',
        gate: { level: 90, region: 4, quests: ['uncounted-2'] },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: DEFECTOR_QUAY, text: 'Hear the defector on the last boat that sailed for the villages.' },
            { key: 'loft', kind: 'enter', buildingId: PASS_RECORD_HOUSE, text: 'Find the last sailing docket in the loft of the Pass Record House.' },
            { key: 'cairn', kind: 'enter', buildingId: DISPATCH_CAIRN, text: 'Lift the cap of the Last Dispatch Cairn and match the seal beneath it.' },
            { key: 'docket', kind: 'choice', text: 'Decide what becomes of the docket.', choice: { prompt: 'The docket names everyone the boat left ashore. What becomes of it?', options: [
                { key: 'bring', label: 'Bring the docket to the defector', blurb: 'She reads the names aloud. One of them is hers.', standing: 'tale-docket-brought' },
                { key: 'return', label: 'Put it back under the cairn', blurb: 'The pass keeps its count. Nobody is told.', standing: 'tale-docket-returned' },
            ] } },
            { key: 'tell', kind: 'enter', buildingId: DEFECTOR_QUAY, text: 'Go back to the defector at the Low Water Quay.' },
        ],
        rewards: { weight: 4 },
    }),

    // ── Hushcrown Heights ────────────────────────────────────────────────────
    // The stone under the Witness Bell is cut for two bells. Only one hangs.
    tale({
        id: 'tale-second-bell', title: 'The Second Bell', giver: 'record-keeper',
        gate: { level: 95, region: 5 },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Ask the Record House keeper why the Witness Bell has room for two.' },
            { key: 'bell', kind: 'enter', buildingId: WITNESS_BELL, text: 'Read the second impression in the stone under the Witness Bell.' },
            { key: 'pool', kind: 'reach', place: { sector: 145 }, text: 'Look into the Pool of the Second Sky. It shows a tree on the far ridge.' },
            { key: 'guards', kind: 'boss', fightId: 'tale-keelroot-guards', text: 'Get past the guards on Keelroot Saddle.' },
            { key: 'marker', kind: 'enter', buildingId: KEELROOT_MARKER, text: 'Take what is curled inside the root at the Keelroot Marker.' },
            { key: 'clapper', kind: 'choice', text: 'Decide what to do with what you found.', choice: { prompt: 'The second bell was never cast. Its clapper was, and you hold it. What now?', options: [
                { key: 'hang', label: 'Hang it beside the Witness Bell', blurb: 'The bell is answered when it rings. The garrison hears it too.', standing: 'tale-bell-answered' },
                { key: 'bury', label: 'Put it back in the root', blurb: 'The heights stay quiet. Whoever hid it is not found out.', standing: 'tale-bell-silent' },
            ] } },
            { key: 'tell', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Tell the Record House keeper what the second impression was for.' },
        ],
        rewards: { weight: 5 },
    }),
    // The remakers taught the boatwright's teacher. Their first pattern still
    // hangs in the workshop, and nobody has cast from it in years.
    tale({
        id: 'tale-first-pattern', title: 'The First Pattern', giver: 'slip-boatwright',
        gate: { level: 95, region: 5, quests: ['boatwright-tools-3'] },
        stages: [
            { key: 'hear', kind: 'enter', buildingId: SLIP, text: 'Hear the boatwright on the remaker who taught his teacher.' },
            { key: 'patterns', kind: 'enter', buildingId: REMAKERS_WORKSHOP, text: 'Compare the two patterns in the Remakers’ workshop. One is older.' },
            { key: 'grit', kind: 'gather', itemId: 'quest-silver-grit', count: 4, siteIds: ['hushcrown-mine-143'], text: 'Mine 4 Silver Grit at the Silver Seam for one casting. You need a pickaxe and mining skill 7.' },
            { key: 'cast', kind: 'deliver', buildingId: REMAKERS_WORKSHOP, itemId: 'quest-silver-grit', count: 4, text: 'Leave 4 Silver Grit at the workshop, under the first pattern.' },
            { key: 'tell', kind: 'enter', buildingId: SLIP, text: 'Bring the boatwright a rubbing of the first pattern.' },
        ],
        rewards: { weight: 4 },
    }),
];

export const COAST_TALE_LINES: Readonly<Record<string, QuestLine>> = Object.fromEntries(TALES.map(entry => [entry.id, entry]));

/** The tales' fights: ordinary patrols and couriers, one level over the player, with no Hold. */
export const COAST_TALE_FIGHTS: Readonly<Record<string, QuestLineFight>> = Object.fromEntries(([
    { id: 'tale-shoal-toll', castId: 'unmoored-patrol', sector: 104, levelOffset: 1, statBonus: 3, loadoutId: 'bruiser' },
    { id: 'tale-cache-couriers', castId: 'unmoored-courier', sector: 119, levelOffset: 1, statBonus: 3, loadoutId: 'bruiser' },
    { id: 'tale-hollow-trackers', castId: 'unmoored-patrol', sector: 129, levelOffset: 1, statBonus: 3, loadoutId: 'bruiser' },
    { id: 'tale-saddle-watch', castId: 'unmoored-patrol', sector: 137, levelOffset: 1, statBonus: 4, loadoutId: 'bruiser' },
    { id: 'tale-keelroot-guards', castId: 'crown-guard', sector: 147, levelOffset: 1, statBonus: 4, loadoutId: 'bruiser' },
] satisfies QuestLineFight[]).map(entry => [entry.id, entry]));
