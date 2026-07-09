/*
 * story-interludes — the VN-only road scenes between the milestone chapters
 * (7 per village at levels 20/30/42/58/70/80/92; docs/fable-5-story-rebuild.md §5).
 *
 * ZERO imports on purpose: the server parity test (api/_story-interludes.test.ts)
 * imports this file directly under node/tsx, so it must stand alone. The
 * CreatorEvent conversion lives in lib/story-trigger.ts.
 *
 * Interludes never appear in the milestone StoryStep array — storyProgress is an
 * index into that array and api/village/kage.ts gates the seat on >= 9. They pay
 * story only (traits/relationships), never XP/ryo/items (owner decision 4).
 * The level-30 scenes seed the companion relationship traits (mira-/toma-/yura-/
 * nyx-*) instead of the usual per-beat "<vil><level>-slug" traits.
 */

export type StoryInterludeLane = "good" | "neutral" | "bad";
// conclusion/trait/lane are set on the final page's three LANE choices (the
// recorded decision). Mid-scene choices (conversation steering, reconverging)
// carry only text/nextPage(/requireTrait) and grant nothing.
export type StoryInterludeChoice = {
    text: string;
    conclusion?: string;
    trait?: string;
    lane?: StoryInterludeLane;
    nextPage: number;
    requireTrait?: string;
};
export type StoryInterludePage = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
    choices?: StoryInterludeChoice[];
};
export type StoryInterlude = {
    id: string;
    village: string;
    levelReq: number;
    /** Milestone chapters that must be beaten first (count of milestone levels below levelReq). */
    minProgress: number;
    title: string;
    pages: StoryInterludePage[];
};

const MILESTONE_LEVELS = [4, 15, 25, 35, 50, 65, 75, 85, 100];

function pg(title: string, scene: string, speaker: string, ...dialogue: string[]): StoryInterludePage {
    return { title, scene, speaker, dialogue };
}

function ch(text: string, lane: StoryInterludeLane, trait: string, conclusion: string): Omit<StoryInterludeChoice, "nextPage"> {
    return { text, lane, trait, conclusion };
}

function interlude(village: string, level: number, title: string, pages: StoryInterludePage[], choices: Omit<StoryInterludeChoice, "nextPage">[]): StoryInterlude {
    const last = pages.length - 1;
    return {
        id: `story-interlude-${village.toLowerCase().replace(/\W+/g, "-")}-${level}`,
        village,
        levelReq: level,
        minProgress: MILESTONE_LEVELS.filter((l) => l < level).length,
        title,
        // The three choices sit on the final page and point at it (self-pointing,
        // no battle) — the VN reader concludes the scene after the conclusion text.
        pages: pages.map((page, index) => index === last ? { ...page, choices: choices.map((choice) => ({ ...choice, nextPage: last })) } : page),
    };
}

export const storyInterludesByVillage: Record<string, StoryInterlude[]> = {
    "Stormveil Village": [
        interlude("Stormveil Village", 20, "The Unsworn", [
            pg("The Fourth Loss", "Arena rail, between bouts", "Mira Volt",
                "That was Corr's slot. He trained all winter for a main-card bout and she took it apart in forty seconds.",
                "Didn't even use the wall. Who wins in this arena without using the wall?",
                "Central license on her belt. Unsworn. No village, no board, no punishment wall. She fights for whoever posts the fee.",
                "Frostfang hired her in spring. Word is we hired her back, in the flood year. Nobody says for what.",
                "Eyes front, Sparkplug. Stare much longer and the clerks will smell a grudge and book you against her next."),
            { ...pg("The Purse", "Clerk's window under the stands", "Ledger Clerk",
                "Eight hundred, travel included. Sign the full license number. The book doesn't take initials.",
                "Posted six weeks back, by our own arena council, against our own man. I enter what's posted. Headers aren't my desk.",
                "You, tenth page. This window is for payouts. Post a challenge or stand clear of the queue.",
                "Next."),
                choices: [
                    { text: "Follow the unsworn woman.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Go find Corr first.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("No Toasts", "Winner's circle, emptying", "Kite Harrow",
                "Put the cup down. The purse settles it. A toast means I owe the crowd a next time, and I don't carry debts that small.",
                "Your friend fought well. Tell him the ledger paid eight hundred to beat him, and his own village set that price.",
                "You're the new one. Tenth roster page, long odds, no sponsor. I read the board on the way in.",
                "Long odds pay best. Learn that before you learn to be insulted by it."),
                choices: [
                    { text: "Walk her to the gate", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("The Loser's Bench", "Fighters' bench, under the stands", "Mira Volt",
                "He won't talk. He's recounting the whole winter, drill by drill, hunting for the one he skipped.",
                "Here's the part that itches. He says the third exchange went missing. Not lost. Missing. He remembers her glove, then the sand.",
                "The bench medic wrote it up as a knock to the head. The bench medic writes everything up as a knock to the head.",
                "Purse is already paid out. Eight hundred. His own village set that price on him, and somebody signed it.",
                "She's leaving by the coast gate. Go on. I'll sit with him."),
                choices: [
                    { text: "Head for the coast gate", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("The Coast Gate", "Arena coast gate, rain starting", "Kite Harrow",
                "Tenth page. You walk loud for someone with no sponsor.",
                "Ask it, whatever it is. Questions are free today. The margin on that bout was generous.",
                "Your village pays me to beat your friends, then bills the beating to itself. I've seen tidier books in a smugglers' den.",
                "Well. Rain's picking up, and I'm only paid through sundown."),
        ], [
            ch("Offer her a spar, no fee, no ledger.", "good", "sv20-offered-the-spar", "She writes your name in a small black book: first one free, after that they negotiate. Mira pretends she wasn't watching."),
            ch("Ask her exactly what the ledger paid.", "neutral", "sv20-asked-the-price", "Eight hundred, travel included, and she itemizes it without blinking. Behind her, the clerk writes down that you asked."),
            ch("Tell her hired blades don't get toasts here.", "bad", "sv20-turned-your-back", "She smiles like you've handed her a tip and walks off with the purse. Mira mentions Corr said the same thing this morning."),
        ]),
        interlude("Stormveil Village", 30, "Mira, Off the Ledger", [
            pg("Storm Rules", "Mira's rooftop, rain starting", "Mira Volt",
                "Up here we run storm rules. Whatever gets said above the gutter line stays above the gutter line.",
                "You want the tour? Water barrel, spare blades, dried fish I'm not sharing, and that loose tile.",
                "Under the tile there's a pack. Money, papers, a map with two routes worked out.",
                "Two. One goes east through the passes. One's a boat."),
            { ...pg("The Loose Tile", "The rooftop, rain heavier", "Narrator",
                "She checks the tile twice to make sure it seats flat.",
                "Below, the market noise sorts itself into deals and grudges. A gull lands on the water barrel and thinks better of it.",
                "For a while she doesn't say anything, which has never once happened."),
                choices: [
                    { text: "Ask why she built the pack.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask about the boat.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("The Week That Won", "The rooftop, later", "Mira Volt",
                "My mother kept a pack like that. Never used it. The ledger kept booking her, she kept answering, and one week the week won.",
                "Her rivalry's still on the board. Six years gone and her name still draws odds. Nobody unposts you here.",
                "Everyone says nobody commands us. Then the board goes up and we all report to it like weather.",
                "I built mine the day the clerk read her name out for a memorial bout. Full house. The take was good.",
                "So that's the east route. Boring. Passes, mules, a cousin in a border town."),
                choices: [
                    { text: "Let the rain fill the pause", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("The Boat", "The rooftop, later", "Mira Volt",
                "The east route's for showing people. Anyone who searches this roof finds the map and feels clever.",
                "The boat is real. Hull under tar cloth, three coves north, past the wreck light. A fisherman named Odd Serren watches it.",
                "He owes my mother, not me. Debts like that don't transfer. Except he never got that notice, so.",
                "Nobody knows about the boat. Knew. Past tense as of about ten seconds ago."),
                choices: [
                    { text: "Say nothing. Stay put.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("Fish?", "The rooftop, rain easing", "Mira Volt",
                "So now one other person is carrying it. Congratulations. It's heavier than it looks.",
                "Don't do the face. The face is why I never tell anyone anything.",
                "Anyway. Fish?"),
        ], [
            ch("Tell her where you'd run, if you ran.", "good", "mira-trust", "She doesn't joke. She adds your route to the map in her own handwriting and seats the tile back over both of them."),
            ch("Say two routes is just sound planning.", "neutral", "mira-respect", "'Right. Sound planning.' The grin comes back up like a shutter, and the pack goes under the tile with the subject."),
            ch("Ask what the boat route is worth to her.", "bad", "mira-fear", "She goes still, then laughs one beat late. A week later you notice the loose tile has been mortared down."),
        ]),
        interlude("Stormveil Village", 42, "The Draw", [
            pg("The Grudge-Match", "Arena floor, after the bout", "Narrator",
                "The Harlan brothers settle six years of feud in nine minutes, in front of half the village.",
                "The winner gets helped up. He looks at his brother the way a man reads someone else's mail.",
                "Under the sand, the floor seams light faint blue and go dark, row by row, running toward the center.",
                "The crowd is watching the brothers embrace. You are the only one looking down."),
            pg("Rake Toward Center", "Arena floor, sand crew working", "Ledger Clerk",
                "Rake toward center. Always toward center. New man, mind the seams, the tines catch.",
                "You. Stands are closed. Bout's settled and entered.",
                "The Harlan purse split even. First even split in six years of postings on that feud. The book likes a closed account.",
                "Mind the wet patch by gate four. The floor drinks slow in cold weather."),
            pg("Old Drains", "Arena stands, everyone gone", "Elder Vanta",
                "The floor drinks the rain. Old drains. That's what the maintenance ledger says, and ledgers never lie twice.",
                "There's a saying. A grudge buried in the ring stays buried. I taught it to recruits for thirty years.",
                "The Harlan boy stopped me this morning. Asked what he'd been so angry about. Six years, and he genuinely wanted to know.",
                "His mother knew the whole quarrel by heart. She recited it to me once, out in the yard. He gave the feud everything, and the feud kept it.",
                "Go home. There's weather coming off the coast, and it always finds the ones who stand around asking questions."),
            pg("What the Sand Keeps", "The stair out of the stands", "Elder Vanta",
                "You're still here. So it's a question, then. Out with it, or carry it home dry.",
                "Forty years I've sat that rail. Ask me what any hundred of those bouts were about. I could quote you the purses. Only the purses.",
                "There's a saying about that too. I find I don't want to say it.",
                "Hm. The lamps want oil. Third night running."),
        ], [
            ch("Tell Vanta exactly what you saw under the sand.", "good", "sv42-said-it-aloud", "He listens without a single saying, which is new. 'Then don't fight angry,' he tells you at the stair, and takes the long way home."),
            ch("Say nothing. Chalk the seams that glowed.", "neutral", "sv42-kept-the-count", "Eleven seams, all running to center; you mark each one before the torches die. By morning the chalk is scrubbed clean."),
            ch("Post a grudge-match of your own and watch the floor.", "bad", "sv42-fed-the-floor", "The clerk enters your challenge without looking up. You win, the seams light, and your opponent shakes your hand like a stranger."),
        ]),
        interlude("Stormveil Village", 58, "Vanta's Cut", [
            pg("The Blank Header", "Vanta's office above the arena gate", "Elder Vanta",
                "Sit down. There's a saying about the sky paying its debts. I wrote it. It's painted on the academy wall.",
                "The sky pays nothing. The sky collects.",
                "Arena ledger. Fees, bets, first pick of storm-steel. And this column, the one with no header. We call it the draw.",
                "Every sworn grudge, every posted bout goes down through that floor and comes back up as someone's weather. The elders are paid a share to keep the header blank."),
            { ...pg("Four Clerks' Fists", "The office, book open on the desk", "Narrator",
                "The book is older than his handwriting. The entries climb back through four different clerks' fists, and the blank column runs through all of them.",
                "He turns pages like a man dealing cards he already knows.",
                "Rain starts against the office window. He doesn't look up at it."),
                choices: [
                    { text: "Ask what the draw actually takes.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask who else holds a share.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("What It Takes", "The office, rain on the glass", "Elder Vanta",
                "Not blood. Blood would be cheaper. It takes the reason. You fight your bout, you win or lose, and the why of it drains out through the floor.",
                "The Harlan boy. My old recruits. Half this village walks around lighter than it should, and calls that peace.",
                "I asked your question once, at your rank. It cost the man who answered me his seat. Mind who you repeat it to."),
                choices: [
                    { text: "Let him finish", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("The Shares", "The office, rain on the glass", "Elder Vanta",
                "Nine shares. Elders hold most. One sits with the head clerk's office, which is why no audit has ever found the column.",
                "One share is older than the rest, made out to the tower. It has never once been collected. Raiko doesn't need coin. Think on what that means.",
                "The rest went where shares go. Roofs. Forges. Daughters. Silence."),
                choices: [
                    { text: "Let him finish", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("A Ninth", "The same office, lamp low", "Elder Vanta",
                "My share is a ninth. It bought this office, my daughter's forge, and four hours of sleep a night instead of none.",
                "I'm old. My forecast is short. Take the ninth.",
                "Not for the money. I need someone standing where I stand who sees what I see, and does better with it than I did.",
                "You came up on long odds. Nobody watched you like they watched the favorites, so you learned to watch instead. That's the whole job. Seeing.",
                "Well?"),
        ], [
            ch("Refuse the ninth. Tell him to close the column.", "good", "sv58-refused-the-ninth", "'There's a saying about cliffs,' he says, and for once doesn't finish it. He locks the book, and tells you twice the offer stays open."),
            ch("Copy the blank column into your own book.", "neutral", "sv58-copied-the-column", "He lets you take every figure and every date. 'Evidence,' he says, trying the word out like a bad tooth."),
            ch("Take the ninth.", "bad", "sv58-took-the-cut", "He signs it over fast, before either of you can flinch. That evening the arena clerk greets you by name for the first time."),
        ]),
        interlude("Stormveil Village", 70, "The Scheduled Loss", [
            pg("The Tenth Slot", "The challenge board, morning postings", "Mira Volt",
                "Sparkplug. Board's up. You made main card, tenth slot.",
                "Against Joren Pike. Cliff scout, big laugh. Your first day he rushed you into the mud and told the whole mess hall the lesson was free.",
                "Hold on. There's a routing mark by your name.",
                "I've seen that mark once before. On my mother's last posting. I never worked out what it meant, and then I did.",
                "That's a book mark. Somebody upstairs already wrote the result down. You're booked to lose."),
            pg("Terms of the Bout", "Clerk's window, arena undercroft", "Ledger Clerk",
                "Tenth bout. You go down in the third exchange. Clean, believable, no wall work.",
                "The book pays four to one against you. Certain parties are heavy on Pike, and the parties outrank the fighters.",
                "Don't ask whose hand wrote it. The column doesn't sign.",
                "You were chosen because nobody will question you losing. In bookkeeping, that's a compliment.",
                "Loser's purse is counted and bagged already. It's been sitting here since Tuesday."),
            pg("For the Record", "Arena tunnel, crowd overhead", "Tempest Guard Captain",
                "Walk. I'm your escort. Main card gets an escort. That's custom, not suspicion.",
                "Pike drew guard rotation with me three seasons. Good scout. Tells one story too often, and lately tells it wrong.",
                "He stopped me at the gate just now. Says nothing personal in the third exchange, fall soft. Asked me to pass it on, then laughed in the wrong place.",
                "For the record, I filed a query on routing marks two years ago. For the record, it came back with no header.",
                "Gate's ahead. Whatever you're about to do, I was never in this tunnel."),
            pg("Sand and Seams", "Arena floor entrance, stands roaring", "Narrator",
                "The sand is raked toward center in fresh spirals. The crew has already gone.",
                "Pike shadowboxes by the far gate, big laugh going, telling the mud story to nobody in particular.",
                "High in the stands a clerk sits with the book open, one finger holding a line that is already filled in.",
                "The bell hand takes hold of the rope."),
        ], [
            ch("Fall in the third exchange, soft, like it's written.", "neutral", "sv70-fell-on-schedule", "The crowd boos on schedule and forgets you by supper. The clerk pays out a loser's purse with a winner's nod."),
            ch("Read the routing mark aloud from the arena floor.", "good", "sv70-read-the-mark", "The stands go quiet, then loud in the wrong way. The bout is voided, the book suspends, and by night three clerks have resigned or gone missing."),
            ch("Win in the first exchange and make him kneel.", "bad", "sv70-made-him-kneel", "Pike kneels in the same mud he once left you in, and the crowd finally learns your name. Under the sand, the seams glow all the way to center."),
        ]),
        interlude("Stormveil Village", 80, "Harrow's Shortcut", [
            pg("The Spigot", "Smugglers' stair under the arena", "Kite Harrow",
                "You keep reliable hours. I priced your patrol route off the guard ledger. Don't be flattered.",
                "I found what's under the Engine. Your Engine is a spigot. Below it there's a reservoir, and the reservoir takes deposits.",
                "Every village banks there. Different currencies, one vault. I've read four sets of books and they all balance against the same nothing.",
                "It makes offers. Did you know that? To people no village can collect from. People shaped like me."),
            { ...pg("Below the Stair", "Lower down, where the walls hum", "Narrator",
                "The stair was cut by the first exiles and mended by nobody since. Harrow counts the steps under her breath in Frostfang numbers.",
                "Past the last landing the walls hum. Not the Engine's millwheel. Something under it, keeping a different time.",
                "She stops at a chalk line, her own mark from an earlier trip, and checks it against a folded page."),
                choices: [
                    { text: "Ask what it offered her.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask her price for walking away.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("The Offer", "The chalk line, hum rising", "Kite Harrow",
                "It offered me standing. Not coin, it knows better. A place inside a wall, any wall, with my name over the door.",
                "I've paid dues in four villages and none of them would bury me inside their walls. It knew that. First customer who ever read my books back at me.",
                "The thing down there takes what you give up. I've done my inventory. Very little left on the shelf, which makes me an excellent customer."),
                choices: [
                    { text: "Keep climbing down", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("Her Price", "The chalk line, hum rising", "Kite Harrow",
                "Walking away costs like everything else. You want it itemized? Four ledgers, sixty pages of margin, two years of nights.",
                "I have a buyer lined up for the Engine schematics. Best offer on the continent. The buyer is me.",
                "Nobody outbids a customer who has already spent everything getting to the counter."),
                choices: [
                    { text: "Keep climbing down", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("The Counter", "The last landing, the hum a held tone", "Kite Harrow",
                "I'll buy the ground, since the ground is all anyone ever offered to sell me.",
                "You're the only sworn shinobi I know who reads a board before saluting it.",
                "So. Talk me out of it, or buy in. The counter's open and I hate queues."),
        ], [
            ch("Tell her what the arena winners lose on that floor.", "good", "sv80-pulled-her-back", "She runs the numbers again, slower. 'Then the price is wrong,' she says, and pockets the schematics unsold; she leaves owing you, and she hates owing."),
            ch("Offer terms: she negotiates, you hold the schematics.", "neutral", "sv80-set-the-terms", "She drafts the contract on the spot, fair to the letter. Somewhere below the stair, the hum climbs half a tone."),
            ch("Stand aside. Watch her deal, and write it down.", "bad", "sv80-took-notes", "She goes down alone, whistling a Frostfang march. Your notebook fills with figures you'll be glad of, and one page you keep folded shut."),
        ]),
        interlude("Stormveil Village", 92, "Witnesses", [
            pg("The Switchback", "Coast road, before the tower climb", "Mira Volt",
                "Don't. Say. Anything. I ran the whole switchback, and if you make it a thing I'm going home.",
                "Board went up at dawn. You against him, tomorrow. The whole village read it over breakfast, and nobody laughed. I checked.",
                "I dug up the pack last night. Two routes, remember? Boat's still where I left it. Old Serren asked after you, which is new.",
                "I'm not taking either one. I'd rather stand where everyone can see me stand. Next to you. That's the speech. Don't clap."),
            pg("The Guard Post", "Guard post at the high bend", "Tempest Guard Captain",
                "Tenth-slot. Word climbs faster than you do.",
                "Pike and I split the drill yard now. When recruits slack, he tells them the cliff story, how he laughed at the wrong one. They straighten up fast.",
                "Half the guard would follow you if you whistled. The other half would follow because they're afraid not to. Pike drills that half. He knows which is which.",
                "For the record, I filed no report on this road today. First one I've skipped in nine years.",
                "Whatever you're climbing up there to do, do it fast. The weather's been wrong since your last bout."),
            pg("Counted", "A dead stretch of road, no birds", "Hollow Gate Echo",
                "The loud one from the square. Still arguing. We kept every argument. Come and hear them, after.",
                "Two climb the road. We count a third at the bend, licensed, holding a folded page.",
                "The tower sets prices for the coast. We set the tower's. We are owed, and tomorrow the account closes.",
                "Rain soon. We like the rain. Everything drains."),
            pg("Admission", "The last bend, tower in sight", "Kite Harrow",
                "Three of us on one road. You should be charging admission.",
                "Here it is, priced. The Captain back there sells order, which is fear with a ledger. Pike sells it raw. Spends fast, buys distance. Volt sells trust. Slow money, compound interest.",
                "I sell neither. I'm a licensed observer with standing in four villages and no position in your weather. Yet.",
                "Tomorrow, whoever holds that tower sets prices for the whole coast. I intend to hold their contract. Choose your witnesses, sworn one."),
        ], [
            ch("Climb with Mira, in the open, whoever watches.", "good", "sv92-open-road", "Mira takes the outside edge of the path without being asked. By the tower gate, the road behind you is full of villagers, unarmed, watching."),
            ch("Take Pike's guard column and Harrow's license, on record.", "neutral", "sv92-signed-muster", "Pike signs the muster and Harrow stamps it with a Central seal. Everything about tomorrow will be legal, witnessed, and revocable."),
            ch("Tell Pike to bring the half that's scared.", "bad", "sv92-fear-column", "He brings them, and doesn't meet your eye doing it. The column that forms behind you is silent, precise, and counts your steps."),
        ]),
    ],

    "Ashen Leaf Village": [
        interlude("Ashen Leaf Village", 20, "The Unsworn", [
            pg("The Appraiser", "The register annex, a stranger at the wall", "Toma Reed",
                "Don't stare. That's the unsworn woman. Central license, no village, works for whoever posts the fee. Ours posted a fee, apparently.",
                "Pink hair, ledger charms, been at the annex since the gates opened. They gave her a chair AND tea. Mori has worked here fifty years and gets neither.",
                "They say she appraises things. Whole warehouses, war losses, one time an entire bloodline's dowry.",
                "So the question that's ruining my morning is: what in the roots' name did we hire her to put a number on?"),
            { ...pg("Kite Harrow", "The annex wall, charts spread", "Kite Harrow",
                "You're blocking my light. No, stay, you're more interesting than the light.",
                "The famous black-flower line. I priced one of these once, in the north. The estate sold better because of it. Curious feeling, isn't it, being the thing that raises the price of the room.",
                "Your village hired me to value a season of graft-slats for an outside party. Yields, freshness, projected burn. Efficient stock, I'll give them that. Most archives only eat paper.",
                "That was a joke. The locals never laugh either. Say something so I can decide what you are."),
                choices: [
                    { text: "Look her in the eye. \"People aren't stock.\"", nextPage: 2 },
                    { text: "Ask her exactly what a future sells for.", nextPage: 2 },
                    { text: "Turn your back on her, slowly.", nextPage: 2 }
                ] },
            pg("The Number", "The annex steps", "Kite Harrow",
                "Mm. There it is. Everyone in this village answers me like a slat: name, use, yield. You answered like a person. That's rarer here than you'd think.",
                "Free advice, black flower, since your friend is vibrating: when a village hires an OUTSIDE appraiser, it is because somebody inside stopped trusting the count.",
                "And when I cannot finish a valuation, which has now happened once in my career, today, on one line of cedar, I refund the fee and remember the name.",
                "I'll be back through. I bill either way."),
        ], [
            ch("Walk her to the gate. Villages should see her leave respected.", "good", "al20-met-her-eye", "She raises an eyebrow, then walks with you, matching your pace exactly. At the arch she says, 'You'd be surprised what that just cost you here, and what it bought you with me.'"),
            ch("Memorize her charts before the clerks fold them.", "neutral", "al20-took-her-measure", "Yields by household, freshness by season, one column simply headed OUTSIDE PARTY. You hold it all. Harrow catches you looking and approves the way collectors approve of other collectors."),
            ch("Tell the clerks to escort her out. Ashen Leaf isn't for sale.", "bad", "al20-turned-your-back", "She packs without hurry, pays for her own tea, and leaves a card on the annex desk anyway. Toma reads it later: 'For when you find out what already sold.'"),
        ]),
        interlude("Ashen Leaf Village", 30, "Aren's Handwriting", [
            pg("The Joiner's Bench", "Toma's family workshop, sawdust in the lamplight", "Toma Reed",
                "Come in, mind the shavings. This is Aren's bench. Everyone says that warmly. 'Aren's bench.' My brother the bench.",
                "You've heard me talk around him for weeks. At the archive I nearly showed you, then the keeper woke, and honestly I was relieved.",
                "I'm not relieved anymore. Fourteen households got survey letters this week, and I know three of those kids the way I knew him.",
                "So. Sit on the good stool. I'm going to show you the only proof in Ashen Leaf that pruning is real, and once you've seen it, you can't unsee it, and I'm sorry in advance for that part."),
            pg("The Letter", "A floor board up, oilcloth unwrapped", "Toma Reed",
                "Here. Read the second line. Watch where the ink stumbles. Steady hand, my brother, always, except right there.",
                "He was building a water-screw for the terrace fields. He filed a complaint against the rites. He wrote, right here: 'If they cut me, Toma, remember me arguing.'",
                "One month later he was quiet. Happy at the bench. My mother thanks the roots every year for such a peaceful son, and I sit at her table and I cannot tell if I am the only sane one or the last sick one.",
                "And here's the junction he machined. Put it in water and it climbs. It WORKS, friend. The future they cut out of him works."),
            pg("What He Was Becoming", "The bench, the letter between you", "Toma Reed",
                "So that's it. That's Aren. Not the bench. This.",
                "I've never shown a living soul, because the letter names the rites, and paper that names the rites has a way of getting its owner surveyed.",
                "I just handed you enough to prune us both. I know exactly what I did.",
                "Say something, friend. Whatever it is, say it plainly. I've had enough of quiet."),
        ], [
            ch("\"Aren's future gets finished. I'll help you build it.\"", "good", "toma-hope", "He looks at the junction, then at you, and something that has been braced in his shoulders since the day you met him finally sits down. 'Then we'll need better tools,' he says, thick-voiced, already reaching for paper."),
            ch("\"I'll hold the letter. I promise nothing else yet.\"", "neutral", "toma-caution", "He nods slowly, wraps the oilcloth himself, and puts it in your hands like a sleeping thing. 'That's more than anyone else has done,' he says. 'It's not enough. But it's more.'"),
            ch("\"Burn it, Toma. Before it prunes you too.\"", "bad", "toma-doubt", "He goes very still, then laughs once, badly. 'You sound like the survey. You sound SENSIBLE.' He hides it back under the board anyway, and something between you does not come back out."),
        ]),
        interlude("Ashen Leaf Village", 42, "Pruning Season", [
            { ...pg("Tea at the Reeds'", "Ash-house row, Toma's family door", "Toma Reed",
                "My mother's been asking to meet you. Word of my Jonin friend reached her sewing circle before it reached me, obviously.",
                "One hour, tea, she'll show you a wall of my baby drawings, we'll leave. Painless.",
                "One thing. In the workshop, behind the bench, there are outlines on the wall where tools used to hang. Aren's tools. She painted around them years ago and never noticed the shapes.",
                "Don't point at them. I just... you should see them, and you shouldn't point. Both of those."),
                choices: [
                    { text: "Go in for tea.", nextPage: 1 }
                ] },
            pg("Sera Reed", "The Reed kitchen, tea and a proud wall", "Sera Reed",
                "So YOU'RE the one keeping my Toma out at all hours. Sit, sit. The good cup, Toma, we're not savages.",
                "Has he told you about his brother? Aren, my eldest. Quiet boy. Dutiful. Happiest at the joiner's bench, always was, since he could walk.",
                "Never gave me one gray hair, that one. Some mothers get the arguing kind. Not me. Peaceful as planed wood, my Aren.",
                "More honey bread? You've stopped eating, dear. And Toma, love, fetch the album, the one with the bench."),
            { ...pg("The Painted Wall", "The workshop, ghost outlines behind the bench", "Narrator",
                "While she hunts the album, you drift to the workshop doorway. There it is: a wall painted careful cream, and under the paint, unmistakable, the shadows of a working life.",
                "A saw's outline, and a second saw. A row of chisels. Something large and round-handled, like an auger. And higher, where a quiet dutiful boy would never reach, the ghost of a drafting square.",
                "In the kitchen, Sera laughs at something in the album. The kettle sings. It is a warm, kind, well-loved house, and the wall is screaming."),
                choices: [
                    { text: "Ask Sera, gently, what Aren argued about as a boy.", nextPage: 3 },
                    { text: "Say nothing. Memorize every outline.", nextPage: 4 }
                ] },
            { ...pg("The Edit Holds", "The kitchen, album open", "Sera Reed",
                "Argued? My Aren? Oh, you're thinking of another family, dear. The Kellers, three doors down, THEIR boys argue.",
                "Aren...",
                "There was one supper. Something about water, or fields, or... funny. It's like reaching into a pocket with a hole in it. You're sure you kept something there.",
                "Anyway, he apologized after. He always apologized so nicely. Didn't he, Toma? More tea?"),
                choices: [
                    { text: "Let it drop.", nextPage: 4 }
                ] },
            pg("Leaving Warm", "The row at dusk, Toma silent beside you", "Toma Reed",
                "So now you've seen it. The kindest kitchen in Ashen Leaf, and a hole in my mother shaped like a hole in a pocket.",
                "She's HAPPY, friend. That's what I choke on. The edit is merciful. Merciful and monstrous, sharing a teacup.",
                "Whatever you're carrying out of this house, decide where it lives. Things that name the rites get their owners surveyed. Things unwritten get forgotten. There's no clean shelf.",
                "Thanks for eating her bread. That mattered more than the rest of it."),
        ], [
            ch("Copy the wall's outlines tonight, exact, and date the page.", "good", "al42-filed-a-report", "Every shadow, to scale, in ink that names nothing and proves everything. Toma watches your steady hand and says quietly, 'The dead should hire you.' You have started Aren's second document."),
            ch("Keep it in your head. Paper gets people surveyed.", "neutral", "al42-kept-the-count", "Saw, saw, chisels, auger, drafting square. You walk the row reciting it like a litany until it sets. Two people now hold the truth of that wall, and neither can be confiscated."),
            ch("Chip one outline off the wall before you leave. Insurance.", "bad", "al42-burned-a-blank", "A palm of cream paint and shadow, wrapped in a napkin. Proof that travels, deniable for her, spendable for you. On the way out Sera hugs you and thanks you for listening, and the napkin weighs like a stone."),
        ]),
        interlude("Ashen Leaf Village", 58, "Mori's Cut", [
            { ...pg("The Bloom Charts", "Mori's study, forty years of charts", "Elder Mori",
                "Close the door. Sit. You have been in my thoughts since the kiln, which at my age is an expense.",
                "Forty years of bloom charts. Every black flower in the village, plotted the week it opened. And beside them, the survey's pruning schedule. I am going to leave these two books open, side by side, and refill the tea.",
                "An old man's eyes, you understand. He forgets what he leaves open.",
                "Look, or do not. Both are choices with teeth."),
                choices: [
                    { text: "Read both books, side by side.", nextPage: 1 },
                    { text: "Close the books. \"Ask me plainly, Elder.\"", nextPage: 2 }
                ] },
            { ...pg("The Pattern", "The study, charts under lamplight", "Narrator",
                "It takes ten minutes to see and a lifetime to unsee. Flowers bloom. Three to five seasons later, the same households are surveyed. The bigger the bloom, the shorter the wait.",
                "The charts do not predict luck. They predict harvest. Mori has been keeping a forty-year map of exactly who the fire eats next, filed as gardening.",
                "He returns with the tea and does not look at the books. 'Now you can read the flowers,' he says. 'I am sorry. It is the only language I had left to leave anyone.'"),
                choices: [
                    { text: "Pour the tea.", nextPage: 3 }
                ] },
            { ...pg("Plainly, Then", "The study", "Elder Mori",
                "Plainly. Ha. Fifty years of clerking and one person finally asks for plainly.",
                "The blooms are not blessings. They are the fire smelling a future worth eating. My charts prove it, three to five seasons, bloom to survey, forty years without a miss.",
                "I taught myself the reading so I could warn no one and grieve accurately. That was my whole rebellion, child. Accurate grief.",
                "I am offering you the reading. It is the heaviest thing I own. Refuse it and stay light, or take it and never again pass a fence in this village innocently."),
                choices: [
                    { text: "Decide.", nextPage: 3 }
                ] },
            pg("The Heaviest Thing He Owns", "The study, tea going cold", "Elder Mori",
                "Whatever you choose, one condition. Sera Reed's household is not in the schedule book. I removed the page myself, years ago. My one theft, after a lifetime of filing.",
                "Do not put it back by being careless.",
                "Well, child. The flowers are opening early this year, and I am seventy, and somebody after me must know whether they are worth bread and congratulations.",
                "What will it be?"),
        ], [
            ch("\"Keep your reading, Elder. I'd rather fight it than forecast it.\"", "good", "al58-refused-the-cut", "He studies you a long moment, then closes both books with something like envy. 'Yes,' he says. 'Stay the kind that gets surprised. We buried the last one, but stay it anyway.'"),
            ch("Copy the pattern's rule, not the names. Enough to check, not to keep.", "neutral", "al58-took-note", "Bloom size, seasons to survey, the ratio. Seven lines in your own cipher. Mori nods at your restraint like a man watching someone take one coal from a fire, and marks your page with a dry leaf."),
            ch("Learn the full reading. Names, seasons, everything he has.", "bad", "al58-took-the-knowledge", "By midnight you can look at any fence in Ashen Leaf and read its sentence. Mori teaches with terrible relief, emptying himself. 'Now there are two of us,' he says, 'and I am sorry twice.'"),
        ]),
        interlude("Ashen Leaf Village", 70, "The Register Opens", [
            pg("Your Survey", "The register annex, your name on the day's list", "Registry Duty Clerk",
                "There you are. Routine becoming-survey, everyone of rank gets one, yours is overdue because, frankly, the wall misfiles you.",
                "Sit. This is normally where I ask what you've been becoming since your signing, and you lie a comfortable amount, and we all go to lunch.",
                "Except.",
                "I pulled your line's slat this morning, Jonin, and I have been a duty clerk for nineteen years, and I need you to look at this and tell me I am not mad."),
            pg("The Old Cut", "Your slat, under the good lamp", "Narrator",
                "There is your signing. There is the black flower, pressed into the grain. And there, where 'intended becoming' should run, the cedar is scarred.",
                "Not blank. CUT. The tidy, healed-over cut of a pruning, the kind you have learned to recognize on other people's lines.",
                "The scar is old. Older than your signing. Older than your arrival. Someone cut your future before Ashen Leaf ever met you, and the wall has been trying to file the wound ever since.",
                "As you stare, the black flower turns, very slightly, toward the scar. Like it is pointing. Like it has been pointing all along."),
            { ...pg("What Mori Sees", "The annex, Mori summoned, door barred", "Elder Mori",
                "Move the lamp. Hm. Hmm.",
                "I have read ten thousand cuts. Every one carries the survey's stamp, the season, the keeper's hand. Yours has nothing. No stamp. No grief. Whoever pruned you did not even do you the violence of a record.",
                "This is why the cedar blooms for you, child. The wall is not honoring you. It is DIAGNOSING you. You are a healed wound walking around asking questions, and the roots find that unbearable.",
                "The mission you do not talk about. The one with no report. I think it is time you told somebody what you remember, and I think we both know how little that is."),
                choices: [
                    { text: "Face the question.", nextPage: 3 }
                ] },
            pg("Pending", "The annex, your slat on the table between three people", "Registry Duty Clerk",
                "So. Nineteen years of filing, and I have on my desk a Jonin with a pre-dated pruning, no stamp, and a flower that points.",
                "I have to write SOMETHING, you understand. The survey reads my book. What I write follows you.",
                "Mori is pretending to clean his glasses so this can be your decision. I'd like that noted as the bravest thing I've seen him do.",
                "Tell me what to write, Jonin."),
        ], [
            ch("\"Write the truth: cut by hands unknown, and I want it back.\"", "good", "al70-claimed-the-name", "The clerk writes it in full, signs it, and stamps it with a hand that shakes slightly. 'Claimed,' says the wall of cedar, somewhere below hearing, and the flower on your line opens one more petal. Now the survey knows you know."),
            ch("\"Write 'pending.' Let the wall keep my secret a while longer.\"", "neutral", "al70-erased-the-name", "'Pending,' the clerk writes, with visible relief. Mori puts his glasses on and says nothing eloquently. The scar keeps its silence, and so do the three of you, and silence in Ashen Leaf is a currency everyone accepts."),
            ch("\"Write that the scar is for sale. Let's see who comes asking.\"", "bad", "al70-traded-the-name", "The clerk stares, then writes it, because it is technically an answer. Within a week, two survey officers and one pink-haired appraiser have asked to see your line. Bait floats. You watch the water."),
        ]),
        interlude("Ashen Leaf Village", 80, "Harrow's Shortcut", [
            pg("The Buyer's Terms", "The orchard gate at dusk, Harrow waiting", "Kite Harrow",
                "Black flower. Walk with me, I hate this village's benches, they're all memorials.",
                "I finished a job today. Valued a commodity for an outside buyer. New market. Very new. The sample was a season of graft-slats and the buyer's question was, and I quote, 'do the fresher ones travel?'",
                "I have priced weapons, ruins, one small war. I sat with that question for an hour, and then I did something I have never done. I padded the number. Made it ugly. Priced it to kill the deal.",
                "The buyer doubled it without blinking. So now I know two things: the market for unlived futures is real, and I am, professionally speaking, the person who just opened it."),
            { ...pg("The Bud", "The orchard wall, her charts under her arm", "Kite Harrow",
                "There's worse. The buyer wants a premium lot. A future still in bud. Attached. LIVING. They asked me to flag candidates while I was in the village anyway.",
                "I flagged nothing. Yet. I want to be honest about the 'yet,' because everyone I have ever despised got there through a series of reasonable yets.",
                "You know what I am, friend. No village, no line, no fence for flowers to bloom on. People like me are ALL unlived future. That buyer's warehouse is where I end, eventually, if this market stands.",
                "So. Advise me. I'm asking the one person in four villages who has never once tried to buy me. What do I do with what I know?"),
                choices: [
                    { text: "\"Kill the market. You're the only one who can.\"", nextPage: 2 },
                    { text: "\"First tell me everything about the buyer.\"", nextPage: 2 }
                ] },
            pg("What Harrow Does", "The orchard gate, lanterns coming on", "Kite Harrow",
                "Mm. You know the last person who gave me advice without invoicing me was my mother, and she was wrong.",
                "Here's what I hold: the buyer's route, their agent's alias, and the sample manifest with the annex's own stamps on it. Ashen Leaf sold first and asked me to price it after. Your keepers are already in this market, friend. I just did the arithmetic they were too pious to write down.",
                "Whatever we do with that, understand the cost. Cross this buyer and I burn my license in four villages. Help them and I burn something with no paperwork at all.",
                "Your call, black flower. I'll bill someone eventually. I always do."),
        ], [
            ch("Burn the manifest together, tonight, and name the buyer to Mori.", "good", "al80-pulled-her-back", "She strikes the match herself and holds it a beat too long before dropping it. 'There goes my retirement,' she says lightly, meaning something else. By morning Mori has the buyer's alias and Harrow has, for the first time, an ally she didn't hire."),
            ch("Split it: she stalls the buyer, you copy everything first.", "neutral", "al80-split-the-draw", "Route, alias, manifest, stamps: copied into your cipher before midnight. Harrow feeds the buyer delays priced as diligence. 'We are now partners in a crime against a crime,' she says. 'I've had worse contracts.'"),
            ch("Tell her to take the deal and keep her seat at that table. For later.", "bad", "al80-let-her-burn", "She looks at you for a long moment, recalculating something she thought was finished. 'A knife inside the market. Yes. Efficient.' She flags no one living, sells the buyer a warehouse of expired stock, and something in how she says goodbye has a receipt in it."),
        ]),
        interlude("Ashen Leaf Village", 92, "Witnesses", [
            pg("The Last Road", "The kiln road at dawn, three figures waiting", "Narrator",
                "Word has gone through Ashen Leaf like sap in spring: the black flower walks to the tower at frost-fall, to put a question to the Kage that only fires can answer.",
                "Three people are waiting on the kiln road. They have been waiting, by the look of them, since before light.",
                "Behind them, half the row's windows are lit, and none of the shutters are closed. The village is watching this road today."),
            { ...pg("The Mother", "The road, Sera Reed stepping forward", "Sera Reed",
                "Don't look so alarmed, dear. Toma told me where you'd walk. He tells me things now. We're trying that.",
                "Three nights this week I dreamt in handwriting. Aren's handwriting, the real one, with the stubborn loops. I woke up angry at people I couldn't name, and it felt like being handed back a limb.",
                "I don't understand what was done to me. Toma says you do.",
                "So I'll stand wherever a mother's word counts, in front of whoever needs to hear it, and I will say: something was taken from this house, and I want the taking to end. Will that help you, dear? Being believed?"),
                choices: [
                    { text: "Answer her, and walk on.", nextPage: 2 }
                ] },
            { ...pg("The Keeper of Records", "The road, Mori with a bound book", "Elder Mori",
                "Forty years of bloom charts, copied fair, in a hand no survey can call forged because it is MINE.",
                "If you mean to argue with the fire, child, arguments need documents. If you mean to break it, breakings need witnesses who kept the count. Either way, this book goes where you go.",
                "I will stand at the tower and read the pattern aloud to anyone who will hear. It will cost me the wall I kept for forty years. I find, this morning, that the price reads cheap.",
                "One request. When it is done, whatever 'done' means: plant something for me. Anything. I have filed enough endings."),
                choices: [
                    { text: "Take the book, and walk on.", nextPage: 3 }
                ] },
            pg("The Third Figure", "The road's bend, a survey officer waiting alone", "Narrator",
                "The third figure wears survey gray. Alone, off schedule, hands visible: the posture of someone breaking a rule carefully.",
                "'Fourteen names are in the detention rows,' the officer says, quietly, to the middle distance. 'The transfer to the kiln is signed for frost-fall. I am the one who countersigns.'",
                "'Some of us joined the survey to keep records, not to feed fires. If someone were to walk at the tower today with the village behind them, some of us would... countersign slowly.'",
                "The officer looks at you once, directly. Afraid, and doing it anyway. Then gray robes, gone between the trees."),
            pg("The Village Behind You", "The tower road, doors opening along the row", "Toma Reed",
                "Look behind you, friend. No, actually look.",
                "Sera's telling her sewing circle. The circle's telling the row. Jorun's at his gate holding a drawing of a BRIDGE, and he doesn't remember why he kept it, and he's coming anyway.",
                "You didn't ask any of them. That's the part the Kage will never understand. Nobody posted this. Nobody stamped it. They're just... choosing.",
                "So choose how you walk in, because everything behind you walks in the same way."),
        ], [
            ch("Walk in the open, slow, letting everyone fall in beside you.", "good", "al92-carried-their-trust", "By the tower gate you are sixty strong and unarmed, and the guards step aside, because there is no drill for a village arriving gently. Sera walks in front. Nobody is behind anybody."),
            ch("Take Mori's book and the officer's word. Go in through the survey door.", "neutral", "al92-took-the-count", "Charts, countersignatures, a lawful escort of one nervous officer: you enter as a case, not a crowd. It protects everyone who stayed home, and it means facing her alone, on her paperwork, with your proof."),
            ch("Send word ahead: the flower is coming, and it remembers every cut.", "bad", "al92-wore-their-fear", "The message travels faster than you walk. Shutters close along the tower road, guards double, and somewhere ahead a Kage smiles at being finally, properly feared. The village follows at a distance now. Safer for them. Lonelier for you."),
        ]),
    ],
    "Frostfang Village": [
        interlude("Frostfang Village", 20, "The Unsworn", [
            pg("Second Roll Call", "South gate, second roll call", "Captain Yura",
                "Wrists out. Sound off when the frost takes.",
                "Harn. Dagny. Ostrek. Good. Essen, glove off, the mark reads skin, not wool. Next.",
                "You. Visitor. Wrist.",
                "As you were. She's on the manifest. Central license, section nine.",
                "Move the line along. Pot's on at the guardhouse, and it won't be by third count."),
            { ...pg("Section Nine", "Gate arch, out of the wind", "Kite Harrow",
                "You're staring at my wrist. Everyone does. Nobody says anything. That's the local custom I like best.",
                "Section nine. Unsworn contractor. Your quartermaster pays me double the marked rate and books it as hazard pay.",
                "The hazard isn't the border. I checked.",
                "It's that I can walk away mid-job and nothing in me stops. Your village prices that like a disease. Fair enough. It's catching."),
                choices: [
                    { text: "Ask what the hazard pay actually buys.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask why nobody says anything.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("Itemized", "The gate arch, wind picking up", "Kite Harrow",
                "Now that's a quartermaster's question. I'll answer it because nobody here ever asks.",
                "Double rate buys a clause. If the job turns, I finish it anyway. In writing. My signature.",
                "Your village can't imagine finishing anything without a mark to make you. So they pay for ink and hope it freezes like oath script.",
                "It doesn't. Ink is just ink. That's the part they're really paying not to think about.",
                "Ask me why I took a Frostfang contract in thaw season. Go on. It's a good rate. That's the whole answer."),
                choices: [
                    { text: "Let her walk you back.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("The Custom", "The gate arch, the line shuffling past", "Kite Harrow",
                "Watch the line instead of me. There. The tall one just counted the queue. Twice.",
                "Everyone counts here. Heads, wrists, steps to the gate. Sova drills it into them at first bell and calls it weather sense.",
                "Saying something out loud makes it a report. Reports go in files. So they stare, and count, and keep their mouths closed.",
                "Quietest village I've ever worked. I sleep beautifully."),
                choices: [
                    { text: "Let the wind push you both inside.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("The Menu", "The gate line moves on", "Kite Harrow",
                "They'll count you twice tonight, you know. Somebody saw you talking to me.",
                "It's fine. Talking to me costs a recount. Hiring me costs double. Everything's on the menu here, they just don't print it.",
                "Third count's coming. The corporal keeps licking his pencil.",
                "Cold's coming in. Decide something."),
        ], [
            ch("Invite her to the fire line for the night watch.", "good", "ff20-shared-the-fire", "Harrow sits at the fire's edge, exactly one arm's length outside the circle, and stays until the watch turns. Yura logs a guest at the fire, no name given."),
            ch("Ask what her license lets her refuse.", "neutral", "ff20-read-her-license", "She answers with the whole fee schedule, item by item, watching which line makes you flinch. Yura's evening report calls the exchange 'contact, professional.'"),
            ch("Turn your back and call the next name in line.", "bad", "ff20-called-the-next-name", "Harrow laughs once, short, like a fee being waived. At tomorrow's roll call she answers to her own name before Yura reads it, looking at you."),
        ]),
        interlude("Frostfang Village", 30, "Yura, Off Duty", [
            pg("The Tower", "North tower, after last roll call", "Captain Yura",
                "You're off duty. So am I. Sit or don't.",
                "Twelve years I've stood this tower. The wind comes up the same gap every night. Regular as a rule.",
                "I do a thing up here. You can hear it once.",
                "Solvei. Answered. Petrik. Answered. Marrin. Answered. Dray. Answered.",
                "Yura.",
                "No answer."),
            { ...pg("Nineteen Days", "Wind through the tower gap", "Captain Yura",
                "Third winter of the border war. Ridge post, four of us, relief due in six days.",
                "Storm took the pass. Relief command ruled the ridge unreachable and struck us from the count. Procedure. I've read the order since. It was correctly written.",
                "Nineteen days. I ate my gloves on the fifteenth. The other three didn't walk out.",
                "Spring came. I stood in front of the seal table and volunteered.",
                "Marked wrists stay in the count. Whatever the weather. Struck from nothing. I am ordered home, always, somewhere."),
                choices: [
                    { text: "Ask her about Solvei.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask who wrote the order.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("The Gloves", "The watch light steady for a moment", "Captain Yura",
                "Solvei.",
                "She ran that post like a kitchen. Kit inspection every morning, storm or no. We hated it. It bought us eleven days the arithmetic never allowed.",
                "The gloves I ate were hers. She handed them over on the twelfth like a kit issue. Signed for them. Made me sign.",
                "I still have the chit. It says returnable.",
                "That's enough of that. Wind's turning."),
                choices: [
                    { text: "Stand with her while it turns.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("Correctly Written", "The cold coming up the stair", "Captain Yura",
                "Relief command. A major I never met. Retired now, keeps bees somewhere south, I'm told.",
                "I requested the file when I made captain. Took two winters of asking. When it came, I read it standing at this rail.",
                "Every clause held. Weather ruling, precedent, signatures in the right order. If I'd sat that desk, I'd have written it the same.",
                "That's the part that doesn't settle. No villain in the file. Just the procedure, still in force, correctly written.",
                "It got reviewed once, after. Recommendation was a second signature line. They added it."),
                choices: [
                    { text: "Let the wind have the rest.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("The Hour", "The watch light gutters", "Captain Yura",
                "I don't tell this for sympathy. I tell it so you know what the mark is for. What mine is for.",
                "The wind's turning. Watch changes in an hour.",
                "Do what you want with the hour."),
        ], [
            ch("Stay. When she reaches her name, answer it.", "good", "yura-trust", "She stops mid-recital, wind filling the gap. Then she finishes the list to the end, steady, and the watch changes with you still there."),
            ch("Stand the rest of her watch beside her, silent.", "neutral", "yura-respect", "No words until the relief bell. At the ladder she says 'good watch,' rank to rank, and it sounds like a coin paid in full."),
            ch("Ask who signed the order that struck her.", "bad", "yura-fear", "'Relief command,' she says, and nothing else. She watches you file the name away, and stands the rest of the watch where she can see your hands."),
        ]),
        interlude("Frostfang Village", 42, "The Draw", [
            pg("Evening Check", "East gate, evening check", "Elder Sova",
                "Rule of the gate. Every wrist presents. Every mark answers. The checked are counted, the counted are kept, the kept are warm.",
                "Present. Answered. Pass.",
                "Present. Answered. Pass. Dagny, your strap wants wax. See the quartermaster before it cracks.",
                "Present. Answered. Pass.",
                "Essen. You're holding up the line."),
            { ...pg("The Strap", "Same gate, the line waiting", "Private Essen",
                "One moment, Elder. The strap's frozen to the buckle, it just needs...",
                "It's just, my brother's post got moved twice this month, and nobody logged the second move, and I was going to say something about it. To someone.",
                "Forget it. Here's the wrist.",
                "Cold tonight."),
                choices: [
                    { text: "Step out and work his strap loose.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Keep your place and watch the check.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("Two Pairs of Hands", "Beside Essen, the line watching", "Private Essen",
                "You don't have to. It's fine. It's the buckle.",
                "Thanks. Sorry. My hands went stupid, that's all.",
                "His new post is Coldwell Cut. That's a real place, they showed me the map twice. Twice is normal. People get shown maps twice.",
                "There. It's loose. Don't stand near me in line, alright? Nothing personal. You count better from further back."),
                choices: [
                    { text: "Fall back as the line moves.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("From the Line", "Three places back, breath in the air", "Narrator",
                "From three places back you can see what Essen can't. Sova doesn't look at his face once. She watches the gate post beside his shoulder.",
                "Behind you, two soldiers trade a low word. One says grievance men check long. The other hushes him with a boot scrape.",
                "Sova holds Essen's wrist a half count past the litany. Her lips keep moving after the word pass.",
                "The line takes one step forward. Somebody's kettle whistles inside the guardhouse."),
                choices: [
                    { text: "Pass the check and step inside.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("Good Ice", "Inside the gate arch", "Captain Yura",
                "You're staring.",
                "Essen. He filed two grievances this month about his brother's postings. Loud ones. Good ones.",
                "Watch him walk. He came to the gate carrying something. Count his steps now and tell me where he set it down.",
                "The check settles men. That's what we're told. Settled.",
                "Frost on the gate post grew toward his wrist while Sova held it. I have watched frost for twelve years. It grows away from warm things."),
        ], [
            ch("Present your own wrist and hold the doubt while it's read.", "good", "ff42-held-the-doubt", "The frost leans toward your wrist and waits, and you keep the thought where it is until Sova says pass. Your check runs four seconds long, and she logs the delay."),
            ch("Memorize the post, the hour, the checker. Say nothing.", "neutral", "ff42-kept-the-count", "East gate, evening bell, Elder Sova presiding. You file it somewhere no roll call reaches. Essen's grievances stop that week anyway."),
            ch("Report Essen's hesitation to the duty officer.", "bad", "ff42-reported-the-doubt", "The duty officer thanks you by name and schedules Essen for re-oathing at first bell. The paperwork lists you as attesting witness."),
        ]),
        interlude("Frostfang Village", 58, "Sova's Cut", [
            pg("Said Once", "The elder's records room, candle hours", "Elder Sova",
                "Close the door. What is said in this room is said once. That is its only rule, and I wrote it.",
                "You've been under the ice by now. Seen the vault doors. Wondered why a village of oaths posts no guard on its own heart.",
                "The marks warm us. You've heard that since your first drill. It's a rule, so people think it's a poem.",
                "It isn't a poem.",
                "Sit. The kettle's for both of us. I don't waste candle hours on people I mean to lie to."),
            { ...pg("The Draw", "She turns her wrists to the candle", "Elder Sova",
                "Every marked wrist that obeys while it doubts pays a toll. The doubt goes down. The vault meters it. We call it the draw.",
                "The draw kept this village alive through the founding winter. No child has frozen here in ninety years. Count what that's worth before you look at me like that.",
                "Look at my wrists.",
                "Bare. Sixty-one winters keeping this room, bare. Someone must stand outside the count to keep the count. The founders wrote that rule last, and quietest.",
                "I am offering you the exemption. It is the only thing an elder of Frostfang has that is worth anything. I have never offered it before."),
                choices: [
                    { text: "Ask why the founders wrote it quietest.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask why she is offering it now.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("Written Quietest", "She takes down the founding ledger", "Elder Sova",
                "Because the loud rules are for keeping people. The quiet ones are for keeping the rules.",
                "Founder Astrid wrote the first three pages of this ledger with a hand you can watch failing. Ink thin where the fire got low.",
                "Page three, one line. The keeper stands outside so the count owes nothing to the keeper. Then her hand stops, and the next entry is another hand.",
                "Every keeper since copies that line fresh when they take the room. Mine's the top one. The ink was better by my day.",
                "The kettle's boiling. Mind the handle, it bites."),
                choices: [
                    { text: "Pour, and hear the rest.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("Why Now", "The candle between you", "Elder Sova",
                "Fair. A rule should survive being asked.",
                "I have watched every wrist at that gate for sixty-one winters. Frost tells me who doubts. It has never once told me who can carry doubt without spending it.",
                "You stood the east gate the night Essen checked long. Whatever you did with it, you saw the frost lean. Most people teach themselves not to see.",
                "Kael grows hungry and calls it need. The next keeper will not get sixty-one quiet winters. That is why now.",
                "Also I am old, and the stair down to the vault ices earlier each year. Rules do not carry kettles."),
                choices: [
                    { text: "Take the candle and listen.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("The Keeper's Rule", "The candle burns low", "Elder Sova",
                "No answer tonight buys you a week. The rule allows it.",
                "But understand me. I do this because the vault needs keepers who love the village more than they love being warm inside it.",
                "I have kept this door sixty-one winters, and slept well. Recite that to yourself before you decide."),
        ], [
            ch("Stay in the count. Refuse the bare wrist.", "good", "ff58-stayed-in-the-count", "Sova nods once, the way she does at a rule correctly recited. Your name stays on the common roll, and she leaves the door unlocked behind you anyway."),
            ch("Ask to read the vault's meter before answering.", "neutral", "ff58-asked-the-meter", "She gives you one candle's worth of the ledger, decades of neat columns, and watches which page you stop on. The week of grace starts counting."),
            ch("Take the exemption.", "bad", "ff58-took-the-exemption", "She strikes your name from the common roll herself, unhurried, like a prayer she has waited years to say. From tonight, no gate check touches you."),
        ]),
        interlude("Frostfang Village", 70, "The Mark That Stays Warm", [
            pg("The Warm Room", "Vault antechamber, under the ice", "Narrator",
                "The antechamber is warmer than any room in Frostfang. Nobody stokes a fire down here. Nobody has to.",
                "On the table sits a commission with the Kage's seal, and beside it a mark plate you have never seen in any drill manual.",
                "Seal-Keeper Vess has laid out blotter, stylus, and wax in a row, each thing square to the table's edge.",
                "The plate is warm too."),
            { ...pg("Holder-Grade", "The keeper unwraps the plate", "Seal-Keeper Vess",
                "Commissioned by the Kage's own hand. Holder-grade. There are nine of these in the village. He thinks you have earned the tenth.",
                "The common mark binds the wearer to the village. This binds others to you. Whoever takes your mark answers your call. Any distance. Any weather.",
                "No struck names. No closed files. No standing on a ridge counting days. The people you hold come back. The mark does not allow otherwise.",
                "The Kage's note is short. I'll read it. 'Warmth that cannot be taken back. You of all people.'"),
                choices: [
                    { text: "Ask who holds the other nine.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask what happens when a holder dies.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("Nine Names", "Vess squares the commission on the table", "Seal-Keeper Vess",
                "Sealed information. Which tells you something by itself, so I'll tell you one more thing and we'll call it calibration.",
                "The granary mistress holds one. Her floor crew has not lost a worker in nineteen years. Not to the south roads, not to marriage, not to anything.",
                "She's kind. That's the part people miss. She learned their birthdays. She bakes.",
                "Nobody on that crew has ever asked for a transfer. I file transfer requests. I'd know.",
                "The wax is ready when you are."),
                choices: [
                    { text: "Turn toward the door.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("When a Holder Dies", "Vess stops wrapping, wax in hand", "Seal-Keeper Vess",
                "That's in the manual, actually. Section four. The hold releases.",
                "I attended a release once, early in my keeping. Forty-two held, all in one hall for the funeral rites.",
                "Some wept. Ordinary grief, you'd say. Except several asked me, quietly, separately, what they had been doing for the last nine years. Not where. What for.",
                "The manual calls that readjustment. I wrote a marginal note recommending a different word. The note was not adopted.",
                "Anyway. Section four. It's all filed."),
                choices: [
                    { text: "Face the witness at the door.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("The Witness", "Yura stands at the door, at attention", "Captain Yura",
                "I am ordered to witness and record your answer. That is the whole order.",
                "What I say next is mine.",
                "Nine holders in this village. I have served under three. Not one of them can tell anymore who stays because of them and who stays because of the mark.",
                "The plate is warm. Ridge nights are cold. I know which one you're weighing. Weigh it."),
        ], [
            ch("Leave the plate on the table, face down.", "good", "ff70-turned-the-plate", "Vess files the commission unsigned, the first refusal in the vault's records. On the stair up, Yura matches your pace instead of walking escort behind you."),
            ch("Copy the holder's terms into your own hand, sign nothing.", "neutral", "ff70-copied-the-terms", "Vess allows it, amused, and seals the plate away. Yura reads your copy on the stair, hands it back without a word, and watches you differently after."),
            ch("Press your wrist to the plate.", "bad", "ff70-took-the-hold", "The warmth runs to your shoulder and stays. Yura records your answer in a steady hand, requests transfer to gate duty the same night, and gets it."),
        ]),
        interlude("Frostfang Village", 80, "Harrow's Shortcut", [
            pg("The Checksum", "Abandoned icehouse, past the tree line", "Kite Harrow",
                "Watch the gate from here. Little ritual coming up. There. See the courier pass the check?",
                "That mark is mine. Cut it three weeks ago from a plate rubbing and a fee. Sova's own litany passed it. Present, answered, warm.",
                "Your whole village runs on a checksum, and the checksum takes forgeries.",
                "Sit anywhere. Not the crate by the door, that one's inventory."),
            { ...pg("Packaging", "She lays out the forge plates", "Kite Harrow",
                "Here's what your quartermaster doesn't put on any menu. The mark isn't the product. The mark is packaging.",
                "Whatever's under that vault drinks the difference between what people do and what they wanted. I've stood where it drinks. It doesn't check licenses.",
                "A forged holder's mark binds like a real one. I can cut those too. I have buyers in three villages already.",
                "One of the buyers is me. Unsworn my whole life. You think I don't know what the merchandise is worth?"),
                choices: [
                    { text: "Ask how she got a plate rubbing.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask what she saw where it drinks.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("The Rubbing", "She taps the oldest plate", "Kite Harrow",
                "Trade secret. Which I'll trade, because you asked plainly and that's rare currency up here.",
                "A holder died two winters back. Your village seals the marks but auctions the furniture, and somebody's desk blotter held a forty-year impression.",
                "I bought the desk. Eleven ryo. The auctioneer threw in the chair.",
                "Every fortress leaks through its housekeeping. Write that down, it's free."),
                choices: [
                    { text: "Hear her price.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("Under the Ice", "The lamp flame leans, and she watches it", "Kite Harrow",
                "Paid a keeper's apprentice for an hour in the metering gallery. Cost more than most contracts pay. Worth it. I like knowing what I'm standing on.",
                "There's a sound down there. Not the ice working. A ledger sound. Like a page turning over, one page, very slowly, all night.",
                "My wrist has no mark, and it still felt like being read.",
                "I left before the hour was up. First refund I ever gave.",
                "So no, I don't sell down there. I sell the packaging. Upstairs, where it's just business."),
                choices: [
                    { text: "Hear her price.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("Firm Until the Freeze", "Lake wind rattles the icehouse door", "Kite Harrow",
                "I'll cut you in at cost. Holder plates, your pick of names.",
                "You could own people who cannot leave. Isn't that the dream here? Every drill, every litany, every warm little fire. Somebody finally honest about it.",
                "Price is firm until the lake freezes. Then it goes up."),
        ], [
            ch("Buy her whole stock, then burn the plates in front of her.", "good", "ff80-burned-the-plates", "She names a price, doubles it when you don't blink, and watches the plates go into the stove. 'First client who ever bought me out of something,' she says, and writes nothing down."),
            ch("Take a finder's fee to keep the gate schedules coming.", "neutral", "ff80-sold-the-schedule", "She pays on the spot, exact, and never once calls it friendship. Twice a month after, a courier you have never met knows your name."),
            ch("Memorize her buyer list and let her keep cutting.", "bad", "ff80-kept-her-list", "She reads your face wrong for the first time since you've known her, and shakes on it. Under the ice, something adjusts its meter for a seller of warmth."),
        ]),
        interlude("Frostfang Village", 92, "Witnesses", [
            { ...pg("The Runner", "North road, before first bell", "Pale Pack Runner",
                "Don't reach for anything. It's me. Ridge camp sent me down when word came you were walking to the hall.",
                "Forty-one of us wintered unsealed because of things you did. Some of them you don't even remember doing. We kept a list.",
                "If it goes wrong in there, the camp moves at second bell. If it goes right, we come down and answer a roll call. Freely. First one ever.",
                "That's all. That's the message. The rest is yours."),
                choices: [
                    { text: "Ask what is on the list.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 1 },
                    { text: "Ask how the camp wintered.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 }
                ] },
            { ...pg("The List", "The runner pulls a folded hide from her coat", "Pale Pack Runner",
                "Marrin keeps it. She recites it at the fire when the wind's too loud for talk. I know my page.",
                "Small things, mostly. A patrol schedule that went missing the night eleven of us moved. A gate count that came up one short and never got corrected.",
                "Marrin's rule for the list is plain. No thanks written down. Thanks make debts, and we're done being owed.",
                "But she made me memorize the last line before I came down. Whoever walks to the hall walks counted, by us, the free way.",
                "That's off the list now. I said it. Cold's getting into my boots."),
                choices: [
                    { text: "Take the road toward the cairn.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("How the Camp Wintered", "She looks back up the ridge once", "Pale Pack Runner",
                "Badly. You want the honest answer, that's it.",
                "We lost two to the first storm. Ostrek's brother, and a girl who came up too late in the season with no fat on her.",
                "Nobody struck them. We carried them to the high cairn ourselves and said the names ourselves. It took all day. We let it.",
                "Marrin runs a kit inspection every morning now, storm or no. She hated that rule once. Says so while she runs it.",
                "Anyway. We eat at first light. I should be back for it."),
                choices: [
                    { text: "Take the road toward the cairn.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            pg("The Cairn", "Checkpoint at the road cairn", "Sergeant Essen",
                "Halt. Road's closed past the cairn. Orders.",
                "It's you. I know you. East gate, three winters back. You watched my check run long.",
                "I got sergeant out of that winter. I don't remember the grievance I was carrying that night. I remember that I was carrying one. It had my brother in it.",
                "He writes from Coldwell Cut. Twice a year. The letters are fine. Everything in them is fine. My mother reads them out loud and then goes quiet.",
                "Whatever you're walking up there to do, people like me end up as the weather it happens to.",
                "Road's closed. But I count slow. Go around the cairn while I'm counting."),
            pg("The Window", "The glacier hall road, first light", "Elder Sova",
                "You walked past my window before first bell. I have kept that window sixty-one winters. Nothing walks past it that I don't weigh.",
                "Kael will lose. I have done the arithmetic. What I need to know is what the village wakes up under tomorrow.",
                "There is a version of the succession rule that nobody recites. The vault does not care who keeps it. Only that it is kept.",
                "Walk in there as the runner's answer, as the sergeant's weather, or as my keeper. The hall takes all three. It has before."),
        ], [
            ch("Send word to the camp: come down at second bell.", "good", "ff92-called-the-camp", "The runner is gone uphill before you finish the sentence. Sova writes nothing down, which from her is a kind of shout."),
            ch("Accept Sova's terms: the vault kept, metered, and watched.", "neutral", "ff92-took-her-terms", "She recites the keeper's rule once, complete, and you repeat it back. At the hall doors, her seal opens the side entrance reserved for elders."),
            ch("Send Essen ahead to announce what comes up the road.", "bad", "ff92-sent-the-warning", "He goes at a run, and you hear the hall's bells change their pattern. By the time you reach the doors, the guards stand very straight and look at nothing."),
        ]),
    ],

    "Moonshadow Village": [
        interlude("Moonshadow Village", 20, "The Unsworn", [
            pg("A Buyer in the Market", "Whisper market, after curfew", "Nyx",
                "Don't turn around. The buyer at the lantern stall has been asking about you all week.",
                "Asking is the wrong word. Purchasing. Three sellers, cash up front, no haggling. Nobody skips the haggling here.",
                "I'd have flagged it sooner, but warnings cost, and you hadn't paid your tab.",
                "The oil seller took her coin and shut his stall two days early. First honest thing he's done all season.",
                "Too late now. She's walking over."),
            { ...pg("The Receipt", "The lantern stall", "Kite Harrow",
                "Kite Harrow. Unsworn, licensed out of Central. Save the alias; I already own your real one.",
                "Forty ryo for the name you wear. Sixty for what got done with your trust before you came here. Secondhand goods, excellent provenance.",
                "Cheap, honestly. Your sellers had no idea what they were holding.",
                "In Ashen Leaf they'd have burned it for free. Here it invoices. I respect that about you people."),
                choices: [
                    { text: "Ask her who did the selling.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask her what the buying is for.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("Sellers' Market", "Under the stall awning", "Kite Harrow",
                "Names cost extra, and today you can't afford your own. I'll give you the shape for free.",
                "Two of them you've traded with across a counter. The third you'd never think to bill, which is how they got you.",
                "None of the three checked with the others. That isn't a conspiracy. It's a market functioning.",
                "Don't hunt them. Sellers grow back. The buyer is the interesting half of any receipt.",
                "You'll work out the third one on your own. People always do, about a month too late."),
                choices: [
                    { text: "Hear the rest", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("Provenance", "Under the stall awning", "Kite Harrow",
                "What's it for? Resale, mostly. A verified name moves through three brokers and doubles twice before anyone spends it.",
                "Your trust is the better lot. Trust that's already been exercised once has a track record. Buyers pay for track records.",
                "Somebody upstream wants a book on everyone in your intake year who can fight. I don't ask why. Asking narrows my market.",
                "I work all four villages. Same trade everywhere, different manners. Yours at least prints receipts."),
                choices: [
                    { text: "Hear the rest", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("The Courtesy", "The lantern stall, oil burning low", "Kite Harrow",
                "The courtesy is this. I'm telling you the price, so you know your own market value.",
                "No one else here will. They'll spend you and book it as tradecraft.",
                "I'll be back through. Decide what I am to you; I bill either way.",
                "Lantern oil's low. That's my exit."),
        ], [
            ch("Thank her, and ask her rates for a warning next time.", "good", "ms20-respected-the-unsworn", "Harrow notes it in a pocket book without breaking stride. 'Discount, next time.' From the stall roof, Nyx mutters that being liked by her costs more than being hated."),
            ch("Say nothing. Memorize her face, her accent, her exits.", "neutral", "ms20-measured-the-unsworn", "Harrow holds still in the lantern light a moment, letting you look. 'No charge for that.' By morning, one of your three sellers has left the village."),
            ch("Tell her unsworn coin buys nothing that matters here.", "bad", "ms20-dismissed-the-unsworn", "Harrow shrugs and closes the book. By week's end the whisper market lists you at a new rate: buys nothing, sells cheap."),
        ]),
        interlude("Moonshadow Village", 30, "Nyx, One True Thing", [
            pg("The Standard Rate", "Nyx's stall over the dye canal", "Nyx",
                "Sit. I'm going to teach you the only lesson this village gives out honest, and I'm charging for it.",
                "One truth about you. Verified, three sources, no seller knowing the others exist. That's the standard.",
                "Price is a truth of equal weight, or eighty ryo. Truths hold value better.",
                "The dye barges are loading under us. Anyone listening at the shutters hears purple getting sold.",
                "No? Door's there. Yes costs extra if you cry."),
            pg("The Verified Truth", "Same stall, shutters drawn", "Nyx",
                "The yard trainee. The friendly one, laughs at your jokes.",
                "Files a report on you every rest day. Word for word where she can manage it. Paid in meal chits.",
                "Chits. You're being retailed at cafeteria rates.",
                "For what it's worth, her handwriting goes sloppy in the parts where you were kind to her. Verified sloppy. I checked twice.",
                "That's the lesson. Everything you say has a buyer. Priced honest, it stings less.",
                "Verification slips are under the teapot, if you want to check my work."),
            pg("Under the Teapot", "The same stall, tea going cold", "Narrator",
                "The slips are where she said. Three hands, three inks, one story that agrees with itself.",
                "The third slip carries a countersign under the seller's mark. A quartered circle, stamped in older ink than the paper deserves.",
                "Nyx watches you stare at it and, for once, offers no price.",
                "'Brokerage mark,' she says. 'Old one. It turns up under things. Don't buy trouble you can't warehouse.'",
                "Below the floorboards, a barge pole knocks the canal wall twice and is gone."),
            pg("The Bill", "The canal steps", "Nyx",
                "Now my side of the ledger. One truth, equal weight.",
                "Don't dress it up. I verify everything, and re-verification gets billed to you.",
                "Or pay coin and we stay strangers who trade. Plenty of my clients prefer that.",
                "Choose. The teapot's going cold."),
        ], [
            ch("Tell her a truth you have never sold anyone.", "good", "nyx-partner", "Nyx listens all the way through and writes none of it down. 'That one stays off the books,' she says, and refills the teapot."),
            ch("Pay the eighty ryo. Keep the ledger clean.", "neutral", "nyx-respect", "She counts the coins twice, stamps a receipt, and hands you the copy. 'Clean accounts. We'll do fine, you and me.'"),
            ch("Feed her something almost true. See if she checks.", "bad", "nyx-suspicion", "Two days later a verification slip reaches your quarters. One word: 'Almost.' Beneath it, a revised rate card; your prices went up."),
        ]),
        interlude("Moonshadow Village", 42, "The Draw", [
            pg("The Listening House", "Listening House roofline, past curfew", "Narrator",
                "The Listening House runs all night. Moonshadow calls the booths relief. Say the thing once, to no one, and sleep.",
                "A queue of masked citizens under the curfew lamps. No priest inside. Nothing to absolve you. The booths only take.",
                "Two men in the queue argue in whispers about who arrived first. Each offers to sell the other his place.",
                "Nyx has you posted on the roof for a courier handoff, directly over the vent line.",
                "The tiles are warm. The pipes beneath them are not."),
            { ...pg("Where the Whispers Go", "The roofline vents", "Narrator",
                "Below, a woman kneels into the booth. You can't hear words. You can see her shoulders let go of something.",
                "The copper pipe under your hand goes cold. A weight passes down it.",
                "She steps out lighter. A neighbor greets her; she blinks at his face a moment too long, then answers.",
                "The courier is late. The roof is yours for another hour, and two questions are lying on it."),
                choices: [
                    { text: "Trace the pipe line across the roofs.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Follow the woman home instead.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("Down the Line", "Rooftops along the vent line", "Narrator",
                "The pipes run under the street, all one direction. Smaller lines join at every corner until the run is a main.",
                "At the old shrine street it dives below frost depth and leaves every map you've been sold.",
                "A maintenance plate at the junction lists forty years of inspections. Every signature is the same neat hand.",
                "You copy the shape of the hand into your sleeve notes.",
                "Behind you, the courier's signal whistles twice."),
                choices: [
                    { text: "Back to the drop", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("The Lighter Step", "A lane off the market", "Narrator",
                "She walks home the long way, past the dye canal, and never once checks her back. Nobody in this village walks like that.",
                "At her door her husband asks something. She laughs and agrees. He looks at her the way you look at a coin that rings wrong.",
                "Through the shutter slats you watch her water the window plant. A minute later she waters it again.",
                "You write down the house number and can't say what you'd file it under."),
                choices: [
                    { text: "Back to the drop", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("No Price Listed", "The courier drop, later", "Nyx",
                "You're quiet. Roof work does that, or the Listening House does. Which?",
                "Don't answer. That's a freebie. Some questions are priced so high nobody's ever paid me for the answer.",
                "The booths are older than the alias law. Iro says older than the village. He says it warmly, which is worse.",
                "Job's done. What you do about the other thing is your own account."),
        ], [
            ch("Log what you saw with the Veiled Hand, on record.", "good", "ms42-reported-the-booths", "The duty clerk stamps your report CLOSED without reading past the first line. Two nights on, Shade Master Iro thanks you, by name, for your diligence."),
            ch("Keep it off the books. Watch the queue instead.", "neutral", "ms42-kept-it-quiet", "You start a private count of who queues and how often. Nyx notices the counting habit and says nothing, which from her is a receipt."),
            ch("Whisper a false confession into a booth. Track it.", "bad", "ms42-tested-the-drain", "The lie goes down the pipe with the same weight the truth had. Nothing bills you for it, but that week runs short, and you can't say where the missing day went."),
        ]),
        interlude("Moonshadow Village", 58, "Iro's Cut", [
            pg("The Tour", "The archive, below the auction floor", "Shade Master Iro",
                "You've been walking past the Listening House with your eyes open. Forty years I've watched genin cross those pipes, deaf. So you've earned the tour.",
                "This is the archive. Every alias, every debt, every whisper that made it downstairs.",
                "Mind the clerk. She hasn't looked up since the year I hired her, and I pay her extra for that.",
                "We call the intake the draw. Old word. Older than my predecessor, who also never asked where it draws to.",
                "You want to ask. Asking is free. Answers are what's for sale."),
            { ...pg("The Shelf", "An unlabeled shelf, third row down", "Shade Master Iro",
                "Yours. Opened the day you crossed the border. Standard practice; don't be flattered yet.",
                "The offer is the shelf itself. Custody of your own file, and editing rights on anyone else's.",
                "The fee compounds. One secret a month, doubling weight yearly. Everyone believes they can outrun compound interest. I keep their files too.",
                "The Kage's office clears every editor personally. You'd clear. I put your name up myself. You're welcome.",
                "Before the terms, you get one question on the house. Spend it well. I'll know if you don't."),
                choices: [
                    { text: "Ask what my booth confession weighed.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2, requireTrait: "ms42-tested-the-drain" },
                    { text: "Ask who held a shelf before me.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("The Intake Ledger", "The intake desk, ledger open", "Shade Master Iro",
                "So you did whisper something down there. I wondered which of you it was. The booth doesn't grade for truth, if that's your worry.",
                "Here. One entry, your voice, logged and weighed. It priced at a day.",
                "Where the day went is above my shelf, and I mean that as geography.",
                "Most people ask if it hurt something. You asked what it weighed. That's why your name went up, in my hand.",
                "Don't do it twice. Seasoning is welcome. Habits get invoiced."),
                choices: [
                    { text: "See the terms", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("Prior Holders", "Between the third and fourth rows", "Shade Master Iro",
                "One a decade, roughly. The shelf doesn't suit most people. It suits a certain shape.",
                "The last buyer paid full term, every month, never late. Then she outgrew invoices altogether.",
                "You've seen her handwriting. It sets the curfew.",
                "Before her, a man who refused. He lived long and unimportantly, and his file starved to three pages. There are worse endings in this room.",
                "That's your question spent. Kindly notice I overpaid it."),
                choices: [
                    { text: "See the terms", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("Terms", "The archive door, key in hand", "Shade Master Iro",
                "You're the best appraisal I've made in a decade. That's the trouble with the good ones. They appreciate. Fees should too.",
                "Refuse, and nothing happens. Your file simply keeps growing without you.",
                "Take the shelf, and you'll never be spent uninformed again. Read the terms twice. The bright ones always sign faster, which I've never understood.",
                "Or take the key home and think. Thinking is free. The key isn't."),
        ], [
            ch("Leave the shelf, the key, and the fee with him.", "good", "ms58-refused-the-shelf", "Iro bows exactly as deep as courtesy requires. 'A rare appraisal, wrong twice,' he says, and pencils a note into your file while you are still in the room."),
            ch("Copy your file's index. Sign nothing.", "neutral", "ms58-took-note", "He watches you copy the index and charges nothing, which costs you sleep later. The archive logs your visit as 'browsing.'"),
            ch("Take the shelf. Pay the first secret now.", "bad", "ms58-took-the-shelf", "The first secret leaves you easier than you expected; Iro receipts it before you finish the sentence. Somewhere below the floor, a pipe goes cold."),
        ]),
        interlude("Moonshadow Village", 70, "Your File", [
            pg("Delivered Unmarked", "Your quarters, the lock unbroken", "Narrator",
                "The file is on your table when you wake. No seal, no note. Someone wanted it read.",
                "Page one is dated the day you crossed the border. The handwriting changes over the years. The tone never does.",
                "'Arrives pre-spent. Trust already exercised by a prior party. Recommend intake. Assets in this condition bond fast to whoever prices them fairly.'",
                "You read the first page standing up. You read it again sitting down."),
            { ...pg("The Margins", "The same table, hours later", "Narrator",
                "The margins hold invoices. The friendly trainee's meal chits. The whisper-market sale, forty and sixty. Your tab at Nyx's stall, settled by a hand you never met.",
                "Every choice you remember making is here, with a price beside it and a buyer's mark beside that.",
                "One mark repeats. A quartered circle, quarterly, since your first winter. The same countersign from the slip under Nyx's teapot.",
                "The final page is blank except a ruled header, already waiting. It says NEXT.",
                "Downstairs, the dye canal runs. Ordinary morning noise."),
                choices: [
                    { text: "Take the file to Nyx tonight.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Stay with it until dark.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("Shutters Down", "Nyx's stall, canal side", "Narrator",
                "The stall is shuttered. Nyx has never been shut on a market night, and the market knows it. Two regulars stand off, pretending to argue about dye lots.",
                "A note is folded into the shutter seam, in her hand. 'Doing sums. If it's urgent, it's expensive. If it's the file, canal steps at dusk.'",
                "She knew about the file before you did, then. Of course she did.",
                "You buy tea from the next stall over and let it go cold in your hands."),
                choices: [
                    { text: "Wait for dusk", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("The Error", "Your quarters, lamp lit", "Narrator",
                "On the fourth pass you find it. An entry from your second spring, priced and countersigned, describing a thing you never did.",
                "Nothing flattering. Nothing damning. Just wrong. A meeting you never took, in a teahouse you've never entered.",
                "Somebody sold a lie about you, and the buyer paid full price without checking. The mark beside the entry is the quartered circle.",
                "You flag the page with a straw from the broom and go looking for Nyx."),
                choices: [
                    { text: "Go find Nyx", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("A Position", "The canal steps, that evening", "Nyx",
                "You've got file-face. Everyone gets it once. Mine took two days to wear off.",
                "Before you ask, no, I didn't send it, and finding who did will cost more than you're holding.",
                "The quarterly buyer is the real question. That mark is old brokerage. Older than me.",
                "It's your paper now. Holding it is a position, and positions want managing.",
                "Whatever you do next, do it like you priced it first. Sympathy's extra and I'm out of stock tonight."),
        ], [
            ch("Burn the file on the canal steps tonight.", "good", "ms70-burned-the-file", "Ledger stock is made to survive accidents; you have to feed the fire page by page. By midnight the archive has opened a fresh folder under your name, one line inside: burns evidence."),
            ch("File a custody claim. Your paper, your name.", "neutral", "ms70-claimed-custody", "The claims clerk reads your name twice and charges the filing fee with unsteady hands; nobody has ever asked before. The quarterly buyer's next installment goes unfilled."),
            ch("Order blank ledgers. Start files on everyone you know.", "bad", "ms70-started-files", "Nyx sells you the ledgers at full price and doesn't meet your eyes over the receipt. Your first entry comes easier than it should."),
        ]),
        interlude("Moonshadow Village", 80, "Harrow's Shortcut", [
            pg("The Commission", "A safehouse you didn't know you rented", "Kite Harrow",
                "Don't be angry. I paid your landlord for the hour; technically you're earning money right now.",
                "I have a commission. Largest of my license. The client wants the Mirror. The actual glass, under the tower.",
                "The ledgers are retail. The Mirror is what the ledgers feed.",
                "Every village keeps one, in case you were still telling yourself otherwise. I've priced all four. Yours is the only one I could move."),
            { ...pg("Disclosure", "Same room, the lamp between you", "Kite Harrow",
                "Here's where I disclose. Licensed brokers disclose. It's the one rule I keep.",
                "I scouted the vault. The Mirror was already showing me. Not my reflection. Me, filed. Every version of me all four villages hire.",
                "Whoever holds it can issue Kite Harrows. My rates, none of my scruples. I have some. Two.",
                "A person with a home gets verified by neighbors. I can only be verified by me. You see the exposure."),
                choices: [
                    { text: "Ask who the client is.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 2 },
                    { text: "Ask what the glass held of you.", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 3 }
                ] },
            { ...pg("The Retainer", "The table, a contract unrolled", "Kite Harrow",
                "Client confidentiality is in the license. But the license doesn't cover countersigns, and you've earned a look.",
                "The retainer's stamped with an old quartered circle. Brokerage mark. It predates my license, my trainer's license, and probably the concept.",
                "Same mark's been buying somebody in this village quarterly for years. I checked. Checking is free when it scares you.",
                "Whoever it is doesn't spend what they buy. They warehouse it. Nobody warehouses people unless they're expecting a market.",
                "So no, I don't know the client's name. I know the client's appetite. Worse trade."),
                choices: [
                    { text: "Hear her terms", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            { ...pg("Your Lot", "The lamp, turned down", "Kite Harrow",
                "You were in it. Filed under intake, cross-referenced to a shelf in Iro's third row.",
                "The glass doesn't show what you did. It shows what you're worth, to whom, at what date. Yours has a bidding history.",
                "Somebody's been buying you in installments since your first winter here. Steady hand. Patient money.",
                "There was one lot I couldn't read. Sealed, future-dated, filed under the tower's own mark. I don't price things like that. It's how I've kept the license.",
                "Don't look like that. Bestseller is a compliment where I'm from. Wherever that is."),
                choices: [
                    { text: "Hear her terms", conclusion: "", trait: "", lane: "neutral" as const, nextPage: 4 }
                ] },
            pg("Consultation Rates", "The door, half open", "Kite Harrow",
                "The fee retires me. Somewhere with one name and no clients. That's been the price of everything since I started, if anyone had asked.",
                "But hand it over, and the buyer owns the master copy of everyone here. You included. Your file's a bestseller.",
                "So I'm buying your read, at consultation rates. Talk me out, buy in, or watch.",
                "Charging you during my own crisis. Very Moonshadow of me. See? Fluent."),
        ], [
            ch("Tear up the commission with her. Split the penalty.", "good", "ms80-pulled-her-back", "She reads the torn contract twice, like a bill that won't add up. 'Nobody buys me out of things,' she says, and files the penalty as a debt she owes you."),
            ch("Go in with her. Fifty-fifty, your terms on the Mirror.", "neutral", "ms80-partnered", "She drafts the partnership herself, fair to the ryo, and signs her real name; you watch her decide to. The vault job goes on both your books."),
            ch("Wish her luck. Watch from a distance you can bill.", "bad", "ms80-let-her-burn", "She nods once, all four idioms gone from her voice at the same time. Three nights later the tower bells ring, and no one will say what was carried out."),
        ]),
        interlude("Moonshadow Village", 92, "Witnesses", [
            pg("The Road Up", "The foot of the tower road, dusk", "Narrator",
                "Somebody lit the lantern road for you. All nine, oil fresh, wicks trimmed. In Moonshadow that is either an honor or an itemized bill.",
                "The whisper market is quoting odds on tomorrow. You heard three different prices on your own name before you reached the first stair.",
                "A child at the road's foot sells paper masks of the Kage. Business is bad. Everyone already owns one.",
                "Three figures wait on the road above, spaced one lantern apart."),
            pg("First Lantern", "The tower road, first lantern", "Nyx",
                "You're walking up there tomorrow. The whole market's quoting odds. I'm not. Conflict of interest.",
                "I came to settle accounts. Checked the books twice. Turns out you don't owe me anything.",
                "Nobody's ever cleared my ledger before. I don't know what to charge for this, so it's free. I think you'll do right up there.",
                "Don't quote me. It'd ruin my rates."),
            pg("Second Lantern", "The tower road, second lantern", "Shade Master Iro",
                "There you are. The village's finest investment, maturing on schedule.",
                "Whatever happens above, someone must hold the archive after. Sable's arrangements assumed Sable. Arrangements can be reassigned.",
                "I've drafted three versions of tomorrow. In every one, you benefit. In two of them, I do. Choose generously.",
                "Go up. I'll have the paperwork ready for whichever you comes back down."),
            pg("Between Lanterns", "The long stair between lanterns", "Narrator",
                "The stair runs forty steps between the second lantern and the last. No one waits on it. That alone is strange tonight.",
                "Halfway up, a receipt is nailed to the handrail post. Paid in full, no item listed, no name. The ink is fresh.",
                "Below, the market noise thins as the stalls shutter, one lamp at a time.",
                "The last lantern gutters as you reach it. Someone is standing just outside its light."),
            pg("Last Lantern", "The tower road, last lantern out", "Kite Harrow",
                "Last lantern. They staged this road like a procession. Your village bills even its goodbyes.",
                "I'm not here to trade. First time for everything.",
                "Whoever walks down that tower tomorrow holds the ledgers. I've read what holders become. I keep those files current.",
                "So price it straight for me. What are you climbing for?"),
        ], [
            ch("Tell her: the ledgers get opened, starting with mine.", "good", "ms92-vowed-open-ledgers", "Harrow closes her book without writing. 'Then you get my testimony, free of license.' Behind you the first lantern relights; Nyx's doing, probably."),
            ch("Tell her: the ledgers get a keeper with limits.", "neutral", "ms92-vowed-a-keeper", "'A metered valve,' she says. 'That's the only bid I've never heard.' She logs it and walks the road down with you, as far as the second lantern."),
            ch("Tell her: to collect. Everything here has a price now.", "bad", "ms92-vowed-to-collect", "She steps out of the lantern light before answering. 'Then I'm glad I kept your file current.' By morning her room over the whisper market is empty."),
        ]),
    ],

};
