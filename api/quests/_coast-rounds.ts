/*
 * The Rounds: each coast region's task list, in four tiers.
 *
 * A region's keeper sends the player round it, a little further each time:
 * walk it, supply its counter, clear its trails, then hold its hardest ground.
 * Each tier pays a regional badge the journal already has a painting for
 * (`badge-<region>-tier-<n>`, shinobij.client/src/lib/coast-journal-art.ts).
 *
 * They are quest lines of kind 'tale': worth no marks, so nothing in the main
 * line ever waits on them, and run by the same engine, so every step is proven
 * on the server the way a quest's is. That is also why the client needed no new
 * screen: the journal shows them beside the quests.
 *
 * The twenty lines follow one pattern, so they are built from a table of five
 * regions instead of being written out. Place and item names are read from the
 * coast's own tables, so a renamed sector or site cannot leave stale text here.
 *
 * Rewards, settled 2026-11-20 with the rest of the coast's numbers:
 *   - ryo on the Quest Book curve at weights 3, 5, 7 and 10, the low end of the
 *     quests' 8 to 30, because a tier is an afternoon and a quest is days;
 *   - 8 stat points on the fourth tier only: 40 across the coast, against the
 *     645 the twenty quests pay;
 *   - no marks, Fate Shards, charms, stones, titles or gear.
 *
 * Server-only and free of side effects, like the catalogue that includes it.
 */
import { coastSectorName, coastSite } from '../../shared/coast-world.js';
import { questItem } from '../../shared/quest-items.js';
import { questSite, type QuestSiteActivity } from '../../shared/quest-sites.js';
import type { QuestLine, QuestLineFight, QuestLineStage } from './_types.js';

interface RoundsRegion {
    /** The badge's region word. */
    key: 'saltstair' | 'brackwater' | 'briarwood' | 'whitecrown' | 'hushcrown';
    number: 1 | 2 | 3 | 4 | 5;
    name: string;
    level: number;
    /** The keeper who sends the player round, and the counter they keep. */
    giver: string;
    counter: string;
    /** The Crossing War quest that ends this region: the fourth tier waits for it. */
    main: string;
    /** Who walks this region's trails. */
    patrol: string;
    walk: readonly [number, number, number];
    supply: readonly [{ site: string; count: number }, { site: string; count: number }];
    trails: readonly [number, number, number];
    /** The fourth tier: the ground to scout, then the hardest ground, then the far edge. */
    stand: { scout: number; hold: number; edge: number };
}

const REGIONS: readonly RoundsRegion[] = [
    { key: 'saltstair', number: 1, name: 'Saltstair', level: 75, giver: 'record-keeper', counter: 'saltstair-counter-105', main: 'crossing-war-1', patrol: 'unmoored-patrol',
        walk: [102, 104, 109], supply: [{ site: 'saltstair-harvest-102', count: 6 }, { site: 'saltstair-mine-103', count: 4 }], trails: [103, 106, 110], stand: { scout: 101, hold: 107, edge: 108 } },
    { key: 'brackwater', number: 2, name: 'Brackwater', level: 80, giver: 'relay-keeper', counter: 'brackwater-counter-113', main: 'crossing-war-2', patrol: 'unmoored-courier',
        walk: [111, 115, 118], supply: [{ site: 'brackwater-harvest-112', count: 6 }, { site: 'brackwater-outcrop-114', count: 4 }], trails: [112, 117, 119], stand: { scout: 116, hold: 114, edge: 120 } },
    { key: 'briarwood', number: 3, name: 'Briarwood', level: 85, giver: 'sentinel-warden', counter: 'brackwater-tree-120', main: 'crossing-war-3', patrol: 'unmoored-patrol',
        walk: [121, 123, 127], supply: [{ site: 'briarwood-harvest-125', count: 6 }, { site: 'briarwood-outcrop-128', count: 4 }], trails: [122, 125, 129], stand: { scout: 124, hold: 126, edge: 130 } },
    { key: 'whitecrown', number: 4, name: 'Whitecrown', level: 90, giver: 'assay-keeper', counter: 'whitecrown-counter-136', main: 'crossing-war-4', patrol: 'unmoored-courier',
        walk: [131, 134, 137], supply: [{ site: 'whitecrown-outcrop-133', count: 6 }, { site: 'whitecrown-fish-135', count: 4 }], trails: [132, 135, 139], stand: { scout: 133, hold: 138, edge: 140 } },
    { key: 'hushcrown', number: 5, name: 'Hushcrown', level: 95, giver: 'record-keeper', counter: 'saltstair-counter-105', main: 'crossing-war-5', patrol: 'crown-guard',
        walk: [141, 144, 146], supply: [{ site: 'hushcrown-harvest-142', count: 6 }, { site: 'hushcrown-mine-143', count: 4 }], trails: [142, 145, 147], stand: { scout: 143, hold: 148, edge: 149 } },
];

/**
 * What each region's keeper says when a tier is offered and when it is done,
 * in tier order. The steps of the Rounds are a pattern; these are not. Each
 * keeper asks for the Rounds for a reason of their own: Orito wants to know the
 * places he writes about exist, Hagino wants to stop learning things from other
 * people's letters, Kusabi wants the forest walked slowly for once, Haizumi
 * wants her map corrected. The same text rules apply as in _coast-script.ts.
 */
const KEEPER_LINES: Readonly<Record<RoundsRegion['key'], readonly (readonly [offer: string, done: string])[]>> = {
    saltstair: [
        ['I record what is on this landing, and half of it I’ve never seen. Walk the rounds for me. I’d like to know that the places I write about are still there.',
            'All three are where the record says. I’m relieved, and a little surprised.'],
        ['This counter is short of cord and fittings. I can’t leave it to fetch them, and nobody fetches for a clerk.',
            'Stocked. I’ve entered it under your name, which is the only pay this office has ever offered anyone.'],
        ['Patrols have shut three trails that were never theirs to shut. A closed trail is a line I have to strike from the record, and I dislike striking lines.',
            'All three are open and back in the book. Thank you. I’d left a space for them.'],
        ['The garrison still treats this landing as its own. You’ve been through that gate on my paper. Go back through it without any.',
            'The rounds of the landing are complete. I’ve never been able to write that before. Nobody had walked them all.'],
    ],
    brackwater: [
        ['My couriers know these fields and tell me nothing. Walk the relay’s rounds and tell me what you see. I’ll know if you leave anything out.',
            'That matches what I’ve read, except for the parts nobody wrote down. Those were the parts I wanted.'],
        ['The relay runs on ink, and I’m nearly out. Seed and silt, if you would. I won’t ask twice, because by then I’ll have written to someone else.',
            'The bowls are full. My clerks can stop writing small.'],
        ['Three of my routes are closed and nobody has told me why. I usually find out why by reading other people’s letters. This time I’d rather the routes were simply opened.',
            'Dispatches came through on all three this morning. I read them. They were dull, which is how I like them.'],
        ['The shelf is still watched by people who answer to nobody I can write to. Go and settle it. I’d come with you, but I’m needed here to hear how it went.',
            'The fields are walked and the relay is clear from end to end. I’ve sent word up the line, and I signed it with your name and mine.'],
    ],
    briarwood: [
        ['You’ve crossed this forest in a hurry three times. Walk it once slowly. I won’t tell you what to look for.',
            'You were gone long enough to have seen something. Good. Don’t tell me what it was. Keep it.'],
        ['The shrine and this tree are bound with thorn and weighted with old iron, and both are wearing thin. Bring me cane and links. They only hold as long as somebody keeps mending them.',
            'That will hold another winter. Most things only need mending. People forget that and build new ones.'],
        ['There are men on three of the forest trails who weren’t born here and don’t mean well by it. I’m too old to move them. The tree and I’d both be grateful.',
            'The trails are quiet. I heard the birds come back before I heard you.'],
        ['The Leash Ward has a new master and the old habits. I’d thought it would stand empty after the tamer. Go and see that it does.',
            'Then the forest is walked from the ford to the steps. I’ve kept this tree forty years, and I’ve never been able to say that.'],
    ],
    whitecrown: [
        ['I have a map of these passes that is thirty years old, and I don’t trust it. Walk the rounds and tell me which parts are wrong. I expect it to be most of them.',
            'Four corrections. I’d expected nine. Either the map is better than I thought or you walk faster than you look.'],
        ['The assay needs emberglass for heat and smelt oil to keep the cups from cracking. I’m down to a week of each.',
            'A full season of both. I’ve weighed them. You were over by a little, which I’ve noted in your favor.'],
        ['Three trails are blocked and my carts are sitting in the snow. I’ve worked out what that costs me each day. I won’t tell you the figure. It would only upset us both.',
            'The carts are moving. I’ve stopped counting the days.'],
        ['Somebody has gone back into the Rime Gate. I measured the frost on the wheel this morning, and it’s thicker than it should be.',
            'The wheel is clear. I’ll take a reading every morning from now on. The passes are walked, and that is a sentence I can put in a register.'],
    ],
    hushcrown: [
        ['I’ve never seen the heights. Everything I have of them came by relay, and I wrote it down in good faith. Walk them and tell me whether I’ve been writing fiction.',
            'It’s as written, then. I’m oddly disappointed. I half hoped I’d got something wrong.'],
        ['The remakers send down for windroot and grit. The request comes to my counter because nobody else will take it.',
            'Entered and sent up. They’ve sent back a casting with no note. I think it’s a thank you.'],
        ['Guards with no garrison mark have shut three trails on the heights. I have no line for them in my book, and I won’t rule one.',
            'The trails are open, and I never had to rule that line. Thank you.'],
        ['The Double Watch has lamps in it again. I wrote that it was open, and I’d like that to stay true.',
            'Then the whole coast has been walked, from the slip to the heights, and I hold it in one book. I didn’t think I’d live to bind it.'],
    ],
};

/**
 * What the keeper told the player about each leg of a tier: the three steps
 * between taking the rounds and bringing them back, in tier order. The step's
 * own text stays the plain instruction; this is the keeper's voice above it.
 * Every line stands on something the map really has at that place (the site's
 * own description in shared/coast-world.json), so a keeper never describes
 * ground the player will not find. Same text rules as _coast-script.ts.
 */
const LEG_LINES: Readonly<Record<RoundsRegion['key'], readonly (readonly [string, string, string])[]>> = {
    saltstair: [
        ['Wrack Strand first. The record says saltgrass and stranded fibre lie along the wrack line. I copied that from a clerk who copied it from someone else.',
            'Needle Shoal is entered as a rock pool with small fish at low tide. If the tide is in when you arrive, wait. I’d rather have it right than have it soon.',
            'The Hound Trace has prints that split around a juniper. I’ve written that sentence four times and never understood it. Stand where they split and tell me which way they go.'],
        ['Cord comes from the saltgrass on Wrack Strand. Cut it long. A clerk can always shorten a cord, and nobody has ever lengthened one.',
            'The fittings ore is at Splitstone Seam, where the silver breaks through the limestone. Take what the pickaxe loosens and leave the seam standing.',
            'Put the cord on the left of the counter and the fittings on the right. I’ll count both while you watch, so that neither of us has to trust the other.'],
        ['The first is the trail through Splitstone Seam. The patrol there has started charging miners to pass. I have no entry for a toll, and I don’t intend to make one.',
            'Woundroot Bank is the second. The garrison used to take its draught from those roots. Somebody up there still thinks the bank belongs to them.',
            'The last is the High Sill. A torn ward hangs in the cleft rock, and the patrol stands under it as if it were theirs. It was torn before they came.'],
        ['Start at Saltstair Slip. Urabe can see the garrison stair from the bench and keeps a count of who goes up and who comes down. Ask what the count is this week.',
            'Go in through the garrison’s outer gate. Your mark is still on it. I entered that mark myself, and I’d like the people inside to see who made it.',
            'Then walk out to the Clan Landing Plot. Four cornerstones, the record says, and nothing raised on them yet. See that nobody from the garrison has gone that way.'],
    ],
    brackwater: [
        ['The Brine Steps. My couriers call them three cuts in the limestone and say the lowest never dries. Count the cuts. Couriers round everything to three.',
            'Pitchwrack Strand next. Somebody burns the drift there, or used to. Tell me whether there’s fresh pitch on the rocks or only old ash.',
            'Finish at Reedwatch Rise. The watch post has a signal cord running down to its desk. See whether anyone is sitting at the other end of it.'],
        ['Inkseed grows at Sedgeglass Run. You’ll know the bed by the black stain on the wet stone. Split one husk before you fill the bag, and make sure it’s ink and not rot.',
            'The silt is at Glasswake Shelf, at the rim of the pool. Take it from where the reflections break. Still water gives a grey ink that nobody can read by lamplight.',
            'Seed in the near bowl, silt in the far one. Don’t mix them yourself. My clerks have opinions about the mixing, and I’ve learned to let them keep those.'],
        ['Sedgeglass Run is shut first. It’s the short way to the ink beds, which is exactly why someone would want it shut.',
            'Then the Sounding Ledge. There’s a lead line over the dark water, and shells that mark the last safe sounding. The men blocking it won’t have read the shells.',
            'The Folded Cut is the one I mind most. My couriers leave packets behind a loose stone there. If the trail is shut, somebody else is reading my post.'],
        ['Look at the shelf from Low Water Quay first. The quay sits under the cliff, and the watch can’t see it from above. That works in both directions.',
            'They’re at the Mirror Pool on Glasswake Shelf, on the adept’s old ground. They hold the place and have none of her skill, so don’t be afraid of the pool.',
            'After that, go on to the Hollow Sentinel on the rim. Kusabi keeps the old cedar there. If the shelf is truly settled, that tree will have heard before I do.'],
    ],
    briarwood: [
        ['Begin at Antlerwash Ford. Stand in the shallows until your feet are cold. Something crosses there every evening, and it won’t cross while you’re moving.',
            'The Split Keel is where a storm tore a cedar off the cliff. Look at how the heartwood bent. Boatwrights look at it and see a rib. Look longer than they do.',
            'Stillfang Mere last. The small fish keep to the side away from the den. Sit on the other side and see who comes down to drink.'],
        ['The cane grows at Briar Spindle, around a fallen yew. Cut the long strands. A good one springs back into a knot when you let it go.',
            'The links are old iron, left in the rock by people who tied beasts here before the tamer was born. Take the ones that still ring when you strike them.',
            'Lay the cane by the roots and the links on the step. I’ll bind them tonight. It’s slow work, and I’ve never minded slow work.'],
        ['They’re among the Witness Cedars first. A shrine stands there with a red cord on its door. Men who shut a trail right beside a shrine don’t care whose ground it is.',
            'Then Briar Spindle. They have camped by the fallen yew and cut the briars for firewood. The briars will grow back. I’d still like them to stop.',
            'The Foldwood Path is the last. Runners used to hide in a hollow there, with moss on every side. Make it a place a runner could use again.'],
        ['Go by the Sunken Record. A stair still stands inside the cracked hall, and from the top of it you can see the ward’s gate. Count the lamps before you count the men.',
            'The Leash Ward has a narrow gate and a feeding court behind it. The tamer’s knot is still on the hoist. Whoever holds the ward now didn’t tie it and can’t untie it.',
            'Then climb to the Hushward Steps. The shadow of my tree reaches the first step in the evening. If it’s quiet there, the forest is quiet.'],
    ],
    whitecrown: [
        ['The Horned Rim. My map shows the trail running straight along the ledge. I’m told it doubles back below the rim. One of us is wrong, and I’d like to know by how much.',
            'The Wind Register has a pass house with a counter on its lee side. My map puts it on the windward side, which would be a foolish place for a counter.',
            'The Listening Saddle. There’s a hollow in the rock that hums when the wind is right. Mark where it stands. The map has it a hundred paces east, in open air.'],
        ['Emberglass is at Whitevein Cut, in the amber vein through the white stone. Test a sliver in your own shadow. If it doesn’t hold a light there, leave it in the rock.',
            'The smelt are in the Tilted Tarn, under a ledge shaped like a bell. I need them for the oil. I’m aware that it’s a strange thing to ask a shinobi to fish for.',
            'Glass on the scale first, then the fish. I weigh everything that comes over this counter, and I’ve never yet apologized for it.'],
        ['The Garrison Ascent is blocked at the cleft. Old pegs mark the climb from Saltstair there. My carts can’t use pegs, but the men blocking it can, so watch above you.',
            'The Tilted Tarn next. They have set themselves on the shelf above the water. It’s a poor place to stand in a fight, and I say so as someone who has measured it.',
            'The Split Needle is the last. A line of frost sits on its shaded face all year. If the frost has spread across the trail, they’ve had help from the gate.'],
        ['Read the gate from Whitevein Cut before you go near it. The vein there shines in shade. If it’s gone dull, the cold has come further down than it should.',
            'The Rime Gatehouse. A chain knocks in the lower hall, and above it the wheel holds the pass shut. Clear whoever is turning that wheel. You don’t have to be gentle about it.',
            'Go on to Sillward Traverse and find the cairn at the top of the descent. If the seal under its cap is still whole, nobody has come up behind us.'],
    ],
    hushcrown: [
        ['Bellroot Verge. I’m told a bell lies between two pale roots, and that the stone under it holds the mark of a second bell that was never there. I wrote that down and felt foolish.',
            'The Remakers’ Steps have a field workshop with two rooms. The record says the first pattern is kept below and its partner hangs in the loft. See that both are still there.',
            'Windfast Shelf is entered as four stones and a cedar peg, on sheltered ground. It’s the plainest line in my book. I’d like one plain thing up there to be true.'],
        ['Windroot grows in the Red Underbough. Look for a red streak under silver bark. The remakers stamp that root on their remedy patterns, so they’ll know if you bring the wrong one.',
            'The grit is on Splitvein Ridge, in a split slab. It leaves a dark streak on the fingers. Don’t wipe it on anything of mine.',
            'Hand it all across. I’ll write the request, the delivery and the hour, and send the three of them up the hill together. That’s how you prove a thing happened.'],
        ['They have shut the Red Underbough, where the windroot grows. The remakers can’t reach their own bed. I have their complaint in front of me, in very small handwriting.',
            'The Pool of the Second Sky is next. The water there shows a tree on the far ridge. Guards who hold a place like that are hiding something or admiring themselves.',
            'Keelroot Saddle last. It’s where the climb from the Split Keel comes out, by a stone curled inside a root. Open it, and the forest and the heights can speak again.'],
        ['Look across from Splitvein Ridge. You can see both rooms of the post from there, the watch room below and the ward loft above. Tell me which one has the lamp.',
            'The Double Watch. Each room keeps half of the post seal. Whoever is in there now has both halves and no right to use them. Clear them out, and I’ll write down who did it.',
            'Walk the Unheard March to the end. Three tracks meet before the last garrison. If only your prints are fresh on them, I can close the book.'],
    ],
};

/**
 * The achievement a tier earns. The id is the badge's own file name in
 * shinobij.client/public/badges, which is how every achievement finds its art.
 */
export const coastRoundBadgeId = (regionKey: string, tier: number) => `coast-${regionKey}-tier-${tier}-v1`;

const NUMERAL = ['I', 'II', 'III', 'IV'] as const;
const WORK: Readonly<Record<QuestSiteActivity, { verb: string; tool: string }>> = {
    harvesting: { verb: 'Harvest', tool: 'a kama' },
    mining: { verb: 'Mine', tool: 'a pickaxe' },
    fishing: { verb: 'Fish', tool: 'a fishing kunai' },
};

/** A place name inside a sentence: "The Brine Steps" reads as "the Brine Steps". */
const inSentence = (name: string) => (name.startsWith('The ') ? `the ${name.slice(4)}` : name);
const sector = (id: number) => inSentence(coastSectorName(id) ?? `sector ${id}`);
/** A counter takes the article: "the Record House", "the Hollow Sentinel". */
const place = (siteId: string) => {
    const name = coastSite(siteId)?.name;
    return !name ? 'the counter' : name.startsWith('The ') ? inSentence(name) : `the ${name}`;
};
/** The few materials counted one by one, so more than one of them takes a plural. */
const PLURAL: Readonly<Record<string, string>> = { 'quest-tether-link': 'Tether Links' };
const material = (itemId: string, count: number) => (count > 1 && PLURAL[itemId]) || (questItem(itemId)?.name ?? itemId);
const roundsId = (region: RoundsRegion, tier: number) => `${region.key}-rounds-${tier}`;
const trailFightId = (region: RoundsRegion, at: number) => `${region.key}-trail-${at}`;
const standFightId = (region: RoundsRegion) => `${region.key}-stand`;

/** One supply errand: gather the material, naming the tool and skill its site needs. */
function gatherStage(key: string, supply: { site: string; count: number }): QuestLineStage {
    const site = questSite(supply.site)!;
    const work = WORK[site.activity];
    const item = material(site.itemId, supply.count);
    const needs = `You need ${work.tool}${site.level > 1 ? ` and ${site.activity} skill ${site.level}` : ''}.`;
    return { key, kind: 'gather', itemId: site.itemId, count: supply.count, siteIds: [supply.site], text: `${work.verb} ${supply.count} ${item} in ${sector(coastSite(supply.site)!.sector)}. ${needs}` };
}

function deliverStage(key: string, region: RoundsRegion, supply: { site: string; count: number }): QuestLineStage {
    const site = questSite(supply.site)!;
    const item = material(site.itemId, supply.count);
    return { key, kind: 'deliver', buildingId: region.counter, itemId: site.itemId, count: supply.count, text: `Hand ${supply.count} ${item} in at ${place(region.counter)}.` };
}

function roundsOf(region: RoundsRegion): QuestLine[] {
    const counter = place(region.counter);
    const take = (text: string): QuestLineStage => ({ key: 'take', kind: 'enter', buildingId: region.counter, text });
    const back = (text: string): QuestLineStage => ({ key: 'back', kind: 'enter', buildingId: region.counter, text });
    const line = (tier: 1 | 2 | 3 | 4, weight: number, stages: QuestLineStage[], extra: { statPoints?: number } = {}): QuestLine => ({
        id: roundsId(region, tier), series: 'coast-rounds', kind: 'tale', world: 'coast', tier: 1,
        title: `${region.name} Rounds ${NUMERAL[tier - 1]}`, marks: 0, giver: region.giver,
        gate: {
            level: region.level, region: region.number,
            quests: tier === 1 ? [] : tier === 4 ? [roundsId(region, 3), region.main] : [roundsId(region, tier - 1)],
        },
        // The three legs after taking the rounds each carry what the keeper said about them.
        stages: stages.map((stage, at) => {
            const told = LEG_LINES[region.key][tier - 1][at - 1];
            return told ? { ...stage, say: [{ speaker: region.giver, text: told }] } : stage;
        }),
        // The badge is the tier's achievement too. Its id is the painted badge's file name.
        rewards: { weight, ...extra, artKeys: [`badge-${region.key}-tier-${tier}`], badges: [coastRoundBadgeId(region.key, tier)] },
        scenes: {
            offer: [{ speaker: region.giver, text: KEEPER_LINES[region.key][tier - 1][0] }],
            done: [{ speaker: region.giver, text: KEEPER_LINES[region.key][tier - 1][1] }],
        },
    });
    return [
        line(1, 3, [
            take(`Take the ${region.name} rounds from the keeper at ${counter}.`),
            ...region.walk.map((id, at): QuestLineStage => ({ key: `walk-${at + 1}`, kind: 'reach', place: { sector: id }, text: `Walk the rounds to ${sector(id)}.` })),
            back(`Bring word of the rounds back to ${counter}.`),
        ]),
        line(2, 5, [
            take(`Ask the keeper at ${counter} what the counter is short of.`),
            gatherStage('gather-1', region.supply[0]),
            gatherStage('gather-2', region.supply[1]),
            deliverStage('supply-1', region, region.supply[0]),
            deliverStage('supply-2', region, region.supply[1]),
        ]),
        line(3, 7, [
            take(`Hear from the keeper at ${counter} which trails the Unmoored have closed.`),
            ...region.trails.map((id, at): QuestLineStage => ({ key: `trail-${at + 1}`, kind: 'boss', fightId: trailFightId(region, at + 1), text: `Clear the trail through ${sector(id)}.` })),
            back(`Tell the keeper at ${counter} the trails are open.`),
        ]),
        line(4, 10, [
            take(`Ask the keeper at ${counter} where the Unmoored still stand.`),
            { key: 'scout', kind: 'reach', place: { sector: region.stand.scout }, text: `Scout the approach from ${sector(region.stand.scout)}.` },
            { key: 'hold', kind: 'boss', fightId: standFightId(region), text: `Break the guard that holds ${sector(region.stand.hold)}.` },
            { key: 'edge', kind: 'reach', place: { sector: region.stand.edge }, text: `Walk the far edge at ${sector(region.stand.edge)} and see it is quiet.` },
            back(`Bring the ${region.name} rounds to a close at ${counter}.`),
        ], { statPoints: 8 }),
    ];
}

/**
 * The fights the Rounds call for. None carries a Hold: a tier needs no tool.
 * The trail fights are the region's ordinary patrols; the stand is one step up,
 * a point under the weakest named boss of that region.
 */
function fightsOf(region: RoundsRegion): QuestLineFight[] {
    return [
        ...region.trails.map((id, at): QuestLineFight => ({ id: trailFightId(region, at + 1), castId: region.patrol, sector: id, levelOffset: 1, statBonus: 3, loadoutId: 'bruiser' })),
        { id: standFightId(region), castId: region.patrol, sector: region.stand.hold, levelOffset: 2, statBonus: 5, loadoutId: 'boss' },
    ];
}

export const COAST_ROUND_REGIONS: readonly { key: string; number: number; name: string }[] = REGIONS.map(({ key, number, name }) => ({ key, number, name }));

export const COAST_ROUND_LINES: Readonly<Record<string, QuestLine>> = Object.fromEntries(REGIONS.flatMap(roundsOf).map(entry => [entry.id, entry]));

export const COAST_ROUND_FIGHTS: Readonly<Record<string, QuestLineFight>> = Object.fromEntries(REGIONS.flatMap(fightsOf).map(entry => [entry.id, entry]));
