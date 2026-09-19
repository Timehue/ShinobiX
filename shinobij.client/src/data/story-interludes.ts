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
            pg("Eight Hundred to Lose", "The arena rim, a hired fighter dismantling a local favorite", "Mira Volt",
                "Watch the posting, not the fight. The woman facing Corr is Kite Harrow. She has a Central license and works for whoever hires her.",
                "Our arena council paid her eight hundred to fight him.",
                "I don't know why the council hired an outsider against one of our own people.",
                "There. It's over. Look at Corr. He can't remember why he posted the bout."),
            { ...pg("The Coast Gate", "The coast gate at dusk, Harrow counting her fee unhurried", "Kite Harrow",
                "You're blocking the light. No, stay. You were paying attention.",
                "The council hired me. The odd part is the account they used. Half the entries have no payer listed.",
                "I've seen smugglers with cleaner records.",
                "Corr told me the fight was about a boundary stone. Ask him tomorrow and see whether he remembers."),
                choices: [
                    { text: "Ask why the council pays outsiders to create more fights.", nextPage: 2 },
                    { text: "Ask her exactly what the council's ledger paid for.", nextPage: 2 },
                    { text: "Ask whether taking the council's money makes her part of the problem.", nextPage: 2 }
                ] },
            pg("An Appraiser's Receipt", "The coast gate, lanterns coming on along the water", "Kite Harrow",
                "I took the fee, so yes, I'm part of it. I'm trying to find out how far it goes.",
                "If the council is hiring outsiders to create more fights, the arena needs something the local bouts aren't providing.",
                "There's an account in your name in the council ledger, opened before you reached Stormveil. Its reason field is empty. I can't tell whether someone left it blank or removed what was there.",
                "I'll be back. We can talk then."),
        ], [
            ch("Walk her out the coast gate, in front of the whole rail.", "good", "sv20-offered-the-spar", "She walks beside you to the last lantern. 'The council won't like that you saw me out,' she says. 'I appreciate it.' Before leaving, she offers to spar at dawn. You agree to meet without a wager or an audience."),
            ch("Memorize the council ledger's shape while she counts her fee.", "neutral", "sv20-asked-the-price", "Entries with no payer. A recurring fee marked only with a tally. One column that pays out to the tower and never draws back. You hold the shape of it in your head, and Harrow watches you do it with the professional approval of one appraiser for another."),
            ch("Turn your back on her and buy Corr his soup instead.", "bad", "sv20-turned-your-back", "Corr eats his soup and cannot tell you what the boundary stone dispute was about, or where his family's boundary even runs. He laughs it off. The unsworn woman leaves a calling card wedged in the rail where you'll find it: 'For when you notice what's missing.'"),
        ]),
        interlude("Stormveil Village", 30, "Storm Rules", [
            { ...pg("The Rooftop", "Mira's rooftop at night, cables like a harp overhead, a packed bag by the hatch", "Mira Volt",
                "What I tell you up here stays here.",
                "The bag by the hatch has been packed for four years. Clothes, food, tools, enough money to get out.",
                "I spend my days keeping this village together and my nights planning how to leave it.",
                "Ask one question. The route stays mine."),
                choices: [
                    { text: "Why has the bag been packed for four years?", nextPage: 1 },
                    { text: "Whose gloves are tucked under the straps?", nextPage: 1 }
                ] },
            pg("The Week Won", "The rooftop, Mira turning her mother's gloves over in her hands", "Mira Volt",
                "You left the route alone. Thank you.",
                "My mother posted a grievance after my father drowned. The board scheduled her four days later, then kept scheduling her.",
                "She came home quieter every time. I was fifteen. I thought that meant she was healing.",
                "She fought nine times in her last season. Then she sat down on this roof and died. Her name is still on the board."),
            pg("The Loose Signal", "The same rooftop, a signal cable tapping against the gutter", "Mira Volt",
                "Hold this at the red wrap. Not tighter. I need enough play to turn the splice.",
                "Wind keeps knocking the loose end against the gutter. Half an inch lower. There.",
                "That splice is holding. You can let go now.",
                "Thanks. That tapping was driving me mad."),
            pg("One True Thing", "The rooftop, the harbor lights below, the bag by the hatch", "Mira Volt",
                "I haven't shown anyone else the bag.",
                "Don't ask me to explain why you're here. You'll get a bad answer, and I'll regret it.",
                "Just tell me something true in return.",
                "If you left tonight, where would you go?"),
        ], [
            ch("Tell her where you'd run, if you ran. The real route, not a decoy.", "good", "mira-trust", "You give her your own exit, the one you've never said out loud either. She nods once, files it under storm rules, and moves the packed bag two feet farther from the hatch. Then she asks which road floods first in spring."),
            ch("Tell her two routes is just sound rigging. Nothing to explain.", "neutral", "mira-respect", "'Redundancy,' you say, and she almost smiles. You've spoken her native language: load paths, failure points, backups for the backups. She doesn't move the bag. But she shows you the real anchor points on the ridge, which she has never shown anyone, strictly, she says, for professional reasons."),
            ch("Ask what the boat route would be worth to the right buyer.", "bad", "mira-fear", "The rooftop goes quiet in a new way. 'There it is,' she says, not surprised, only tired, and the bag comes back to arm's reach of the hatch. She still works with you after. She is professionally flawless about it. But the gloves go back in the box, and storm rules never quite cover you the same way again."),
        ]),
        interlude("Stormveil Village", 42, "What the Floor Drinks", [
            pg("The Harlan Bout", "The arena at night bell, two brothers settling six years of feud", "Narrator",
                "The Harlan brothers have hated each other for six years, over a field, a will, and a wife, in some order the whole village claims to know. Tonight the board finally schedules it, and the rim is packed.",
                "It is a good fight. It is even an honest one, both brothers crying and swinging, the crowd caught between betting and weeping.",
                "The younger Harlan yields, bleeding, and the older one drops the winning fist and pulls his brother up, and the crowd roars for the ending the way crowds do.",
                "And then the older Harlan stands there, holding his brother's arm, with a growing puzzlement on his face that you have seen before. On a button-seller, in a riot."),
            pg("Under the Sand", "The emptying arena, the fight floor from the rail", "Narrator",
                "The crowd files out arguing happily about the purse. You stay at the rail, because from this exact angle, you can see what the crowd's feet were hiding.",
                "Blue-white light pulses through seams in the floor, running from the chalk ring toward the central drain.",
                "The light fades before the sweepers arrive. They rake sand over the seams.",
                "At the far rail, one other person is watching the same seams: Vanta, absolutely still, an old man looking at something he has spent forty years arranging not to see."),
            pg("The Bookmaker's Confession", "The rail, Vanta not looking away from the dark floor", "Elder Vanta",
                "I've worked this rail for forty years. I can tell you tonight's purse and how it was split.",
                "I can't tell you what the brothers were fighting about. I never asked.",
                "I watched thousands of people lose their reasons while I kept track of the money.",
                "I saw the light under the sand tonight. I should have looked years ago."),
        ], [
            ch("Tell him exactly what you saw. Seams, drain, direction of flow.", "good", "sv42-said-it-aloud", "You describe where the light appeared and where it flowed. Vanta writes each detail in the margin of his ledger, then asks you to sign beside his name. 'Both of us saw it,' he says. 'I'll put that on record.'"),
            ch("Say nothing yet. Chalk the seam lines where they glowed.", "neutral", "sv42-kept-the-count", "You mark the seams before the sweepers cover them. Eleven channels lead to one central drain. You copy the pattern onto your slate while Vanta checks it against the floor."),
            ch("Post a grudge of your own and watch the floor while you fight it.", "bad", "sv42-fed-the-floor", "You post a small but genuine grievance and fight at the next bell. During the bout, you feel the floor trying to weaken your connection to that reason. You concentrate and keep it. The test confirms what the Engine takes, but it also shows how easily an unprepared fighter could lose the reason without noticing."),
        ]),
        interlude("Stormveil Village", 58, "Vanta's Cut", [
            { ...pg("The Headerless Column", "Vanta's shack, one ledger open to a page he has never shown anyone", "Elder Vanta",
                "Sit down. The tea is bad, but it's hot.",
                "This column isn't in the public arena ledger. It has nine shares, paid every quarter from what the floor takes.",
                "My name is beside the third share. I've collected it for thirty years. It paid for this shack and my niece's boat.",
                "The ninth share has no name. It belongs to whoever holds the tower seat."),
                choices: [
                    { text: "Read the whole column, every entry, both books.", nextPage: 1 },
                    { text: "Close the ledger. \"Just say it plainly, Vanta.\"", nextPage: 2 }
                ] },
            { ...pg("The Arithmetic of Shares", "The shack, ledgers open side by side under the lamp", "Narrator",
                "It takes an hour, and Vanta feeds the lamp twice, and by the end you can read the village's real history in two columns nobody was ever meant to lay side by side.",
                "The elders' largest payments come three weeks after riots, purges, and waived posting fees. Each payment rises with the Engine's intake, even when the arena itself earns less money.",
                "The figures reward the elders for arranging more fights and bringing more people into the ring.",
                "Vanta watches you finish, and pours the bad tea, and says: 'Thirty years I collected that and told myself it was a fee for good service. Now you know the rate for not asking questions. It's good money, so long as you never lay two books side by side again.'"),
                choices: [
                    { text: "The ninth share.", nextPage: 3 }
                ] },
            { ...pg("Plainly, Then", "The shack, Vanta's hands flat on the closed ledger", "Elder Vanta",
                "All right. The elders are paid from whatever the floor takes. I am one of them.",
                "When the intake ran low, we arranged angrier bouts or waived the fees. Nobody had to tell us. The payments taught us what to do.",
                "The arrangement was never written down.",
                "I'll give you the records. You could expose the arrangement or use it to claim a share yourself. I need someone else to know, even if I can't control what you do with it."),
                choices: [
                    { text: "The ninth share.", nextPage: 3 }
                ] },
            pg("The Ninth Share", "The shack, the unnamed line at the column's foot", "Elder Vanta",
                "Before you answer, leave the Volt account to me. I scheduled Kesa's bouts. Mira hears that from me, not from a ledger.",
                "The ninth share belongs to the tower seat. Every Kage inherits it.",
                "The floor has taken more this year than any year in my records.",
                "What do you want to do?"),
        ], [
            ch("\"Keep your share, Vanta. I'd rather break the column than inherit it.\"", "good", "sv58-refused-the-ninth", "The old man looks at you a long moment, then laughs, rusty as a gate. 'The last person who turned down free money in this village became the Kage,' he says. 'Try to do it differently.' He marks your refusal in the margin, dated and witnessed. The first entry of a new column."),
            ch("Copy the column. Every share, every date. Names stay yours for now.", "neutral", "sv58-copied-the-column", "You copy thirty years of the elders' cut into your own cipher while Vanta drinks his bad tea and doesn't watch, which is a bookmaker's way of helping. The column now exists outside the shack. 'Insurance,' he says at the door, 'is what we call fear with good handwriting.'"),
            ch("Take the third share. From the inside, the books open wider.", "bad", "sv58-took-the-cut", "You sign where Vanta's name was, and the quarterly draw finds your account within a week, no questions, no welcome, no meeting. The machine simply recognizes another understanding party. The money is very good. The count of it sits behind your eyes at night, running itself over and over."),
        ]),
        interlude("Stormveil Village", 70, "The Scheduled Loss", [
            pg("The Main Card", "The bout clerk's stand, your name in tomorrow's chalk", "Ledger Clerk",
                "There you are. Main card tomorrow, you against Joren Pike. Good draw, good purse, no surprises.",
                "Actually, there is a surprise. The routing office sent the result with the schedule. You're supposed to lose in the third exchange, without getting hurt. They've already divided the purse.",
                "I've posted fixed bouts before. Usually both fighters agree and get paid. This order came straight from the tower, and nobody asked you.",
                "I shouldn't have shown you. Pike would tell you himself anyway. He's the last honest fist on this coast. Ask him."),
            { ...pg("Pike's Shrug", "The training yard, Joren Pike wrapping his hands like it's a craft", "Joren Pike",
                "You've seen the slate? Good. I wasn't looking forward to explaining it. They told me you're supposed to go down in the third exchange. I take it nobody cleared that with you.",
                "I've taken these bouts for nine years. Sometimes I win, sometimes I take the fall. The pay is steady and I lose fewer teeth. I got used to not asking why the office wanted a particular result.",
                "Look at the corner of your slate. That tower stamp is on every fixed bout I've fought. It matches the orders they send me.",
                "The routing office fixes fights to make the Engine drain as much as possible. They call that routing a reason.",
                "Your slate is the first one I've seen stamped twice. The first order failed, so they issued it again. That means the Engine tried to drain your reason and could not."),
                choices: [
                    { text: "You posted a shield reason once. Look at what the mark did to it.", nextPage: 2, requireTrait: "sv4-post-protector" },
                    { text: "You posted a ladder reason once. Look at where they routed it.", nextPage: 3, requireTrait: "sv4-post-strongest" },
                    { text: "You posted a debt to collect. Look at who's been collecting.", nextPage: 4, requireTrait: "sv4-post-debt" },
                    { text: "You posted a search. Look at what the board did with it.", nextPage: 5, requireTrait: "sv4-post-searcher" },
                    { text: "You posted a blank. Now look at what the blank is doing.", nextPage: 6, requireTrait: "sv4-post-unknown" },
                    { text: "Pull your own slate from the clerk's rack and read the corner.", nextPage: 7 }
                ] },
            { ...pg("The Shield, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate, the one with your reason: so nobody else has to.",
                "Beside it, a routing note reads: SHIELD CLASS. HIGH DRAW. The office planned fights where protecting someone would keep your reason active and feed the Engine.",
                "An older note from your first week reads: ACCOUNT WILL NOT ROUTE. The Engine tried to drain that reason and failed."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Ladder, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate: the strongest name on the board.",
                "The note beside it reads: LADDER CLASS. SCHEDULE AGAINST OWN RECORD. The office planned to keep your ambition active by making every new fight a contest with your last victory.",
                "An older note reads: ACCOUNT WILL NOT ROUTE. The Engine tried to drain that ambition and failed."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Debt, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate: someone owes me. I intend to collect.",
                "The note beside it reads: DEBT CLASS. DO NOT SETTLE. The office planned to keep the debt unresolved so your anger would continue feeding the Engine.",
                "An older note reads: ACCOUNT WILL NOT ROUTE. The Engine tried to drain that anger and failed."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Search, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate: looking for someone. Fighting turns heads.",
                "The note beside it reads: SEARCH CLASS. SUSTAIN. The office planned to send you from fight to fight without helping you find the person, keeping your reason active.",
                "An older note reads: ACCOUNT WILL NOT ROUTE. The Engine tried to drain that reason and failed."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Blank, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate: the blank reason, posted your first night, when the brush dragged.",
                "Beside it is a stack of notes from different clerks: CLASS UNKNOWN. REVIEWED AGAIN. ESCALATED. The office has tried to classify the blank since your first night.",
                "The oldest note points to an account created before you reached Stormveil. One past reason was already drained in full. That is why this Engine could not find it or take it again."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Bout You Can't State", "The clerk's stand after hours, your full file unrolled", "Narrator",
                "The clerk pulls your full record, because you ask, and because the clerk has been wanting a reason to look since the board posted you twice.",
                "There, seasons before you came to Stormveil, in a routing hand nobody at this stand recognizes: a bout, already fought. Logged, closed, PAID. You, against a name that is only a smudge of pressure on the slate. Result: win. Draw: total.",
                "You remember winning a fight, once, before the missing report, before the coast. You remember your hands after. You have never, not once, been able to say what the fight was about.",
                "The account was drained whole and closed clean. Nobody took every reason you have. They took the reason for that one fight, so completely that nobody, including you, can say why it happened."),
                choices: [
                    { text: "Morning. The fixed bout.", nextPage: 8 }
                ] },
            pg("The Third Exchange", "The arena, main card, Pike across the chalk, the script in everyone's pocket but yours", "Joren Pike",
                "The bell's about to ring. You look shaken. Can you focus on the bout for a minute?",
                "The script says you go down in the third. The routing office is watching from the good seats. The floor is listening under both our feet.",
                "They've set the result to get something out of you. That doesn't mean you have to give it to them.",
                "We can follow their plan, or you can fight me properly. Give me a sign in the third exchange. I'll be watching you, not the routing box."),
        ], [
            ch("Follow the plan until the third exchange, then stay on your feet.", "good", "sv70-read-the-mark", "In the third exchange, you stay on your feet. Pike stops his punch an inch short. Above the rim, in the routing box, somebody stands up fast enough to knock over a chair."),
            ch("Fall on schedule. Let them believe their plumbing works on you.", "neutral", "sv70-fell-on-schedule", "You fall in the third exchange as arranged, and the routing office relaxes. They believe the Engine can drain you now. Pike helps you up without asking questions. The purse is split as agreed, and the office underestimates you for the next season."),
            ch("Break Pike in the first, off script, and stare at the routing box.", "bad", "sv70-made-him-kneel", "You knock Pike down in the first exchange and look straight at the routing box. He rises to one knee, grinning through a split lip. 'Cost me a fee, that. Worth it.' Above the ring, a clerk crosses out the scheduled result and reaches for another slate."),
        ]),
        interlude("Stormveil Village", 80, "Harrow's Shortcut", [
            pg("The Exiles' Stair", "A salt-eaten stair under the coast cliffs, Harrow with a shuttered lantern", "Kite Harrow",
                "Mind the fourth step. It shifts. Smugglers cut this stair before the tower had windows, and the exiles kept it off every map. I use it for work.",
                "I said I'd come back. I didn't expect to come back with something this dangerous. The tower already has both our names, and you can recognize the records in it.",
                "Past the chain is where the Engine's surplus goes. Not to the shield. To that cistern. Four spouts, one tank, and the stone counter beside it.",
                "I've stayed quiet about a lot on this coast. I can't stay quiet about this. I need a witness whose account the tower cannot dismiss as a contractor protecting her fee."),
            { ...pg("The Counter That Makes Offers", "The cistern ledge: a vast dark reserve, and a stone counter worn smooth by centuries of bargains", "Kite Harrow",
                "That hum is power collected from all four villages. The smugglers called this place Hollow Gate. The stone is an old assessment terminal. Put down something tied to your history and it calculates an offer designed to keep you feeding the system.",
                "The smugglers' diagram labels four spouts: Stormveil supplies the reasons people fight. Ashen Leaf supplies futures people were becoming. Frostfang supplies the choice to leave. Moonshadow supplies trust people placed in someone.",
                "I verified the Stormveil label against the payment schedule. The other three are still the diagram's claims.",
                "I put my license there last month. The system matched it to my records and offered me a permanent name over a door, in a village that couldn't throw me out. I hate how accurate the appraisal was.",
                "I walked away. I've thought about going back every day since.",
                "It isn't alive. It was built to recognize leverage. So what terms has it been giving the four Kages?"),
                choices: [
                    { text: "\"Whatever they each couldn't buy. Quiet, certainty, silence, warmth.\"", nextPage: 2 },
                    { text: "Put nothing on the counter. Ask what it offers you, unprompted.", nextPage: 2 }
                ] },
            pg("The Standing Offer", "The cistern ledge, the counter lit over the dark water", "Kite Harrow",
                "Look. The counter is searching the cistern for a record connected to you.",
                "The offer is blank. Part of your history is missing, so the system cannot calculate what would persuade you. Its default demand is everything.",
                "I'd laugh, but I'm scared. It holds records from four villages and still cannot assign you a price.",
                "We're leaving before it logs another attempt. And remember this: I showed you the payment schedule and told you the truth for free. That's twice.",
                "Now get me upstairs. I want a locked door and a drink before I remember the first-stupidest thing I've done."),
        ], [
            ch("Pull her off the ledge. \"Your name doesn't go on that stone. Ever.\"", "good", "sv80-pulled-her-back", "You take her arm. For one held breath she goes rigid. Then her weight comes back under her. 'Noted,' she says, too quickly. On the stair up she never looks back. Behind you, the counter closes the session without a bargain."),
            ch("Set the terms out loud: she watches the cistern, you watch her.", "neutral", "sv80-set-the-terms", "You make a plain agreement beside the running system: Harrow watches the intake schedules, you watch for signs that its offer is pulling her back, and either of you can end the arrangement by saying 'counter.' She writes down the terms and shakes your hand."),
            ch("Take notes on the counter's mechanics while it studies her want.", "bad", "sv80-took-notes", "While the terminal cycles through offers drawn from Harrow's records, you chart its response times and pricing behavior. Harrow catches you studying the machine instead of helping her step away. 'Get what you needed?' she asks. You look down to finish the timing. When you look back, she is writing too, on a fresh page headed with your name."),
        ]),
        interlude("Stormveil Village", 88, "The Quiet Storm", [
            { ...pg("The Ridge at Midnight", "The high ridge over the Low Terraces, cable drums and anchor stakes in the wind", "Mira Volt",
                "Keep your boots on the rock, clear of the cable. If it pulls tight under you, you'll go over the edge.",
                "Stopping the General delayed Hollow Gate's collection. It did not cancel the debt. The tower reopened intake for the cyclone's next arm.",
                "The cyclone's first arm reaches the coast before dawn. The tower is scheduling more bouts to power its shield. We're going to try my mother's design: seven anchors, a spine cable, and a web over the Low Terraces to take the storm's force into the ridge.",
                "The tower said her design was grief. Vanta's books say the engine's shield hasn't grown in forty years. Tonight one district finds out who was right.",
                "We've checked the drawings. Now we have to build it and see whether it holds. If it fails, the council will say she was wrong all along. I know we have to try. I'm still frightened.",
                "Hands steady. Mine, I mean. Yours look fine."),
                choices: [
                    { text: "You brought another dry coil.", nextPage: 9, requireTrait: "sf-sv-high-line" },
                    { text: "The picker-road rail held through the rain.", nextPage: 10, requireTrait: "sf-sv-picker-road" },
                    { text: "Show me the first anchor.", nextPage: 1 }
                ] },
            pg("Rigging in the Dark", "The spine cable going up, lanterns swinging, the Captain's guards hauling on ropes", "Narrator",
                "The Tempest Guard Captain arrives at second bell with eleven guards, out of uniform, on his own time. Nobody discusses it. He takes a rope.",
                "Mira works the anchor points in a language of grunts and hand signals, and the crew learns it in minutes because her hands make sense the way good rigging makes sense.",
                "At the fourth anchor, Mira stops. The drawing calls for an unfamiliar bolt spacing. She checks the measurements twice before setting the bolts.",
                "Then she sets the bolts to her mother's spacing, exactly, and says to nobody: 'You'd better be right about this too.'"),
            { ...pg("The First Raise", "The spine cable rising against the storm's first arm, everything singing", "Narrator",
                "The crew raises the line into the wind. For a few seconds it holds, humming under the strain. Blue light runs down the anchors into the rock.",
                "The splice at the third anchor tears with a sharp crack. Two hundred feet of cable whips down across the ridge.",
                "The Captain drags a guard clear by his collar. Mira doesn't move at all. She stands over the failed splice, wind screaming, staring at the torn lay of it.",
                "'My splice,' she says. 'I spliced it my way. Not hers. Mine slips when the cable twists and hers doesn't, and I knew that. I've known it since I was nine.'"),
                choices: [
                    { text: "\"I won't sell your way out, Mira. I'm sorry I asked its price.\"", nextPage: 3, requireTrait: "mira-fear", trait: "sv88-repaired-trust" },
                    { text: "Paint KESA VOLT on the mast head before the second raise.", nextPage: 4, trait: "sv88-named-the-rigger" },
                    { text: "Get on the third anchor and hold tension while she resplices.", nextPage: 4 }
                ] },
            { ...pg("Knots Under Torsion", "The third anchor, the two of you alone with the failed splice", "Mira Volt",
                "Heard. You don't need to say it twice.",
                "My bag went back beside the hatch that night. It's staying there for now. Pull this end tight.",
                "Keep that tension while I splice it. I need both hands.",
                "Over, under, and back against the twist. Everyone ties it the fast way. She tied it the way that holds. Hands where mine are. We're doing it her way."),
                choices: [
                    { text: "Hold tension. Match her hands.", nextPage: 4 }
                ] },
            { ...pg("The Line Holds", "The spine rising again, Kesa's splice at its heart, the storm arm arriving", "Narrator",
                "The crew raises the line again. This time Mira has joined it with the splice her mother taught her.",
                "The storm hits. The web bends under the force, then holds. Light flares along the anchors and fades into the rock.",
                "Below, across the Low Terraces, three hundred roofs stand in weather that should be peeling them like fruit. A dog barks at the quiet. Somewhere a shutter bangs, once, and is latched by somebody sleepy and alive.",
                "'It holds,' Mira says. She checks the third splice, says it again, and sits down hard on the wet rock. She starts laughing, then crying. The Captain sits beside her while the others keep watch on the line."),
                choices: [
                    { text: "Dawn shows the district.", nextPage: 5, trait: "sv88-line-held" }
                ] },
            { ...pg("The Count at Dawn", "First light over the Low Terraces, the Captain counting roofs with a spyglass", "Mira Volt",
                "Captain, check the roofs through the glass. I'll check the anchors before we let the crew down.",
                "Three hundred and eleven roofs still standing. Send someone for the loose shutter. Leave the melon frame; it was rotten last week. The engine drew nothing from this district tonight. Not one bout, not one fee, not one reason spent.",
                "It does not shield the whole coast. It protects one ridge and one district.",
                "But it proves my mother's anchors can stop a major storm without taking anyone's reason. The council could have tested this years ago.",
                "It works. We have the readings to prove it. Now we need to get that evidence to the tower before the next payment."),
                choices: [
                    { text: "Set Kesa's grievance beside her drawings. The reason and the rigging together.", nextPage: 6, requireTrait: "sv65-saved-the-reason", trait: "sv88-one-district" },
                    { text: "Ask Mira to lay her mother's page against the mast. She's carried it since the ravine.", nextPage: 6, requireTrait: "sv65-gave-mira-the-page", trait: "sv88-one-district" },
                    { text: "Let the count stand on its own.", nextPage: 11, trait: "sv88-one-district" }
                ] },
            { ...pg("The Reason and the Rigging", "The mast foot, the rescued slate laid against the cable drum", "Mira Volt",
                "Her grievance is still readable. After everything that happened in the ravine, we got it here. Put it beside the drawings. I want a moment to look at them together.",
                "The tower could claim the design as its own. But these are her drawings, and the grievance explains why she made them. They kept putting her in the ring when they could have listened to her.",
                "We need to show Raiko both: what she was trying to build and what the village did to her instead.",
                "Will you present them, or will you help me get there so I can do it myself?"),
                choices: [
                    { text: "\"You showed me the bag and the boat. Let me carry your mother's answer.\"", nextPage: 11, requireTrait: "mira-trust", trait: "sv88-reason-proof-ready" },
                    { text: "\"You rig, I argue. That's a fair split.\"", nextPage: 11, requireTrait: "mira-respect", trait: "sv88-reason-proof-ready" },
                    { text: "\"I know it's only a start. Let me carry her the last stretch.\"", nextPage: 11, requireTrait: "sv88-repaired-trust", trait: "sv88-reason-proof-ready" },
                    { text: "\"You should present your mother's grievance and plans to Raiko. I'll keep the way clear.\"", nextPage: 7, requireTrait: "mira-trust", trait: "sv88-reason-proof-deferred" },
                    { text: "\"You should present your mother's grievance and plans to Raiko. I'll keep the way clear.\"", nextPage: 7, requireTrait: "mira-respect", trait: "sv88-reason-proof-deferred" },
                    { text: "\"You should present your mother's grievance and plans to Raiko. I'll keep the way clear.\"", nextPage: 7, requireTrait: "sv88-repaired-trust", trait: "sv88-reason-proof-deferred" },
                    { text: "Keep the slate in your own kit. Let that be your part.", nextPage: 8 }
                ] },
            { ...pg("You Hold the Sky", "The mast foot, Mira wrapping the slate in oilcloth with rigger's care", "Mira Volt",
                "Good. I'll take the slate and the plans. You keep the way clear. If a guard tries to stop us, I'd rather you handled that part.",
                "I've kept that escape bag packed for four years. Twice I nearly left. Now I'm taking my mother's work up to Raiko's desk, and he is going to hear what I have to say.",
                "I don't need the pages I wrote for him. I'll put her slate on his desk, say she was right, and make him look at me when I tell him whose daughter I am.",
                "If he interrupts, you know your job."),
                choices: [
                    { text: "Let it be hers to say.", nextPage: 11 }
                ] },
            { ...pg("Rigged, Not Argued", "The mast foot, the slate going into your kit, Mira watching", "Mira Volt",
                "You're keeping her. After tonight. In a kit bag.",
                "You helped recover the slate in the ravine. That matters. It doesn't make it yours. I want it back after the tower.",
                "At least show him the rigging report when you get there. Don't let him dismiss what happened here tonight.",
                "Keep the slate dry. And remember it's my mother's testimony, whatever you decide to say to him."),
                choices: [
                    { text: "Keep the slate. Walk down.", nextPage: 11, trait: "sv88-unfinished-answer" }
                ] },
            { ...pg("The Dry Coil", "The first anchor, Mira feeding a new coil through the brake", "Mira Volt",
                "Our crossing used the west mast's coil. This one came out of my own stock before anybody could assign it elsewhere.",
                "You trusted the high line while I held the brake. Tonight the whole district is asking for the same thing with roofs underneath it.",
                "Check my knot anyway. Trust does not make wet cable less slippery."),
                choices: [
                    { text: "Check it, then take the first anchor.", nextPage: 1 }
                ] },
            { ...pg("The Low-Road Rail", "The first anchor, picker-road flowers tied below its drum", "Mira Volt",
                "The rail held. One of the pickers brought these for the crew and made me accept them without an invoice.",
                "I still hate asking a room full of people about my mother. I hate it less than I did before they answered.",
                "Take the left drum. If I stop at her name tonight, give me a breath and keep hauling."),
                choices: [
                    { text: "Take the drum. Let her set the pace.", nextPage: 1 }
                ] },
            pg("Chalk on the Cable Drum", "Full morning on the ridge, the web humming gently over the district", "Narrator",
                "The storm's first arm is spent, and the ridge line stands, and word is already moving down the coast the way only good news and bad odds travel: fast, and growing.",
                "The Captain writes his report on a cable drum, reads it over, and sends it. Mira walks the anchors once more, testing each splice with her hands.",
                "The cyclone's heart is still out there. The tower's account is still due. And over three hundred and eleven roofs, a dead woman's rigging holds the sky like a held breath.",
                "Mira finishes her anchor round and sets a piece of rigging chalk on the cable drum between you. Below, the district is beginning to wake."),
        ], [
            ch("Wake the Low Terraces. Let them stand under their own held sky.", "good", "sv88-woke-the-district", "By full light half the district is on the ridge road, staring up at the humming web while children name the anchors like ships. Questions travel from crew to crew faster than Mira can answer them. By noon three hundred families can point to the line that held and the cold arena beneath it."),
            ch("Keep it quiet. Log every load and reading for Vanta's book.", "neutral", "sv88-logged-the-storm", "You and the Captain measure everything twice while the district sleeps on: wind loads, anchor draw, roof counts, hour by hour. Vanta reads the figures without making a single joke, signs every page, and locks the storm log under the purse books before the tower hears what happened."),
            ch("Let one odds-runner find the web and say nothing at all.", "bad", "sv88-baited-the-board", "You let the sharpest runner on the coast discover it by 'accident' and watch the market do your arguing: by noon the storm-damage line on the Low Terraces has collapsed, and money that always knows first is screaming that something on that ridge works. The tower reads odds the way a tracker reads footprints. Let it choke on these."),
        ]),
        interlude("Stormveil Village", 92, "Witnesses", [
            pg("The Coast Road", "The coast road at dawn, the tower ahead, figures waiting at the switchbacks", "Narrator",
                "Word has run the whole coast: at the next bell worth naming, the one they now call the riot-stopper walks up the tower road to post the last challenge.",
                "The first switchback has people on it. So does the second. They are not a crowd yet, just villagers standing a careful space apart, the way people stand when they've decided something but haven't said it out loud.",
                "The odds-runners are out too, and for the first time in living memory, none of them are calling numbers.",
                "The board at the tower base has been blank for three days. It hums when you pass it, like a throat clearing."),
            { ...pg("Openly", "The third switchback, Mira standing in full view, no hood, no exit checked", "Mira Volt",
                "Before you say it: yes, I'm standing in the open, on the tower road, next to the person the tower hates most. I counted my exits this morning. Then I walked past every one.",
                "People have come from all around the arena. There's no bout posted. They want to see what we'll do after that night on the ridge.",
                "My mother's name stayed on that board after she died. Now people are talking about what she built. You helped make that happen.",
                "The rigging holds. I'm staying for what comes after it. That's as close to a promise as you're getting before we climb."),
                choices: [
                    { text: "\"Her slate and her drawings go up the hill today. Her daughter carries them.\"", nextPage: 2, requireTrait: "sv88-reason-proof-deferred" },
                    { text: "Take her to the overlook. Show her the web from above, holding.", nextPage: 3, requireTrait: "sv88-line-held" },
                    { text: "\"Walk with me as far as the gate.\"", nextPage: 4 }
                ] },
            { ...pg("Her Blood Carries Her", "The switchback, Mira with the oilcloth bundle bound across her back like rigging", "Mira Volt",
                "You were right to make me carry this. I was afraid I'd lose the last of her somewhere on this road, and I'm done being afraid of that.",
                "Her slate, her drawings, one splice from the line. That's what I have. And I get to put it in front of the man who signed her away.",
                "Walk me to the gate. After that, I need to do this myself.",
                "If I stop on the road, don't let me turn around."),
                choices: [
                    { text: "Walk her to the gate.", nextPage: 4 }
                ] },
            { ...pg("The Web From Above", "The cliff overlook, the district and its anchor web small and whole below", "Mira Volt",
                "You can see the whole web from here. All those roofs made it through the storm, and the Engine took nothing from them.",
                "Jorun's crew from the Terraces re-tensioned the east span this morning without being asked. People do that now, apparently. It's a shield you can climb on and check with your own hands. Try doing that with a reserve under an arena.",
                "The tower will call it one lucky district, one lucky storm. Let them. We have a line anyone can inspect and readings from the storm it held. The next storm is another test, not a promise.",
                "All right. Enough looking at the good thing. Uphill is the man who buried it."),
                choices: [
                    { text: "Walk on, uphill.", nextPage: 4 }
                ] },
            { ...pg("The Bookmaker's Books", "The last switchback, Vanta waiting with a strongbox of ledgers on a cart", "Elder Vanta",
                "Forty years of purse ledgers, the elders' column, and last night's storm log. All signed. My name, on every page, dated, witnessed by the Captain, who has discovered he enjoys witnessing things and is becoming insufferable about it.",
                "They could dismiss a rumor from an old bookmaker. These are the arena's own records, and I've signed them. They show what we took and who received it.",
                "If you mean to argue with the seat, arguments need documents. If you mean to break the board, you need a count the crowd believes. Either way, this cart goes up the hill with you.",
                "One request when this is done. Take me to a friendly spar. No stakes, no purse. I want to watch two people shake hands afterward and go home with nothing taken from them."),
                choices: [
                    { text: "\"Open the storm log, Vanta. Read me the district's night out loud.\"", nextPage: 5, requireTrait: "sv88-logged-the-storm" },
                    { text: "Show him KESA VOLT painted on the mast head.", nextPage: 6, requireTrait: "sv88-named-the-rigger" },
                    { text: "Take the cart's rope and walk on.", nextPage: 7 }
                ] },
            { ...pg("The Storm Log", "The switchback, the log open across the strongbox", "Elder Vanta",
                "Wind loads at seven anchors, hourly. Draw at every engine junction while the storm passed: zero, zero, zero, eleven times zero. Roofs standing at dawn: three hundred eleven of three hundred eleven.",
                "I've kept the village's accounts all my life. This is the first storm report I've signed with no Engine draw. It cost cable, labor, and oil. We can pay those without taking people's reasons.",
                "He wanted a quieter storm, our Raiko. He's had one ledgered, signed, and witnessed. Let him try to break my figures. I taught half his clerks.",
                "Take the log. Keep it on top of the box; we'll want it first."),
                choices: [
                    { text: "Walk on together.", nextPage: 7 }
                ] },
            { ...pg("The Name on the Mast", "The switchback, the spyglass passed hand to hand", "Elder Vanta",
                "Give me the glass. Where? There. Kesa Volt, painted on the mast head in cable-tar, big enough to read from the tower's own windows.",
                "Ha! He can read that from his window. No one will be able to pretend they don't know who designed the line.",
                "Six years I chalked that woman's bouts and filed my shame under tradition. Now her name holds up the sky over three hundred roofs, and every soul in the Low Terraces says it when they point.",
                "Before we reach the gate, I'll tell you the truth: I came up this hill for you. I'm walking the rest of it for her."),
                choices: [
                    { text: "Walk on together.", nextPage: 7 }
                ] },
            { ...pg("The Fourth Figure", "The tower gate's shadow, an odds-runner waiting alone, chalk behind her ear, no slate", "Narrator",
                "The runner at the gate is the sharpest on the coast. You have watched her call lines through riots without blinking. She stands alone, hands visible, no slate anywhere on her.",
                "'The window's shut,' she says, to the middle distance. 'First time ever. You know what we runners do when the window's shut? Nothing. There's no book on tonight. There's no book possible on tonight.'",
                "'Some of us have taken money on every fear this village ever had. If someone were to break the floor's bank for good, some of us would... find honest work. Slowly. With enormous complaining.'",
                "She looks at you once, directly, the way runners look at a line they can't price, and then she is gone down the switchbacks, calling no numbers at all."),
                choices: [
                    { text: "The gate. The last climb.", nextPage: 8, trait: "sv92-witness-present" }
                ] },
            pg("The Village on the Hill", "The tower gate, the crowd on every switchback below, wind steady", "Mira Volt",
                "Every switchback is full. The ravine camp came down. The Low Terraces came up. Pike brought his whole training yard.",
                "The Captain's guards are standing beside people they arrested last spring.",
                "Nobody posted this. They just came.",
                "Decide how you're going in. Everyone here will follow your lead."),
        ], [
            ch("Walk up slow and open, letting anyone fall in beside you.", "good", "sv92-open-road", "Four hundred people reach the gate with you, their hands empty. The Captain reads the names of the wounded from his signed report. Three tower guards refuse the order to clear the road, and the rest stand aside. Mira walks at the front as the crowd enters."),
            ch("Go in through the clerk's door, with Vanta's cart and the Captain's word.", "neutral", "sv92-signed-muster", "Ledgers, storm logs, a signed muster of witnesses, and one lawful escort with thirty years of gate duty on his face: you enter the tower as a filed case, not a storm. Everyone who stayed on the switchbacks stays safe, and you face the seat on its own orders, with the floor's whole appetite documented in a bookmaker's hand."),
            ch("Warn Raiko that you're coming with records of every arranged bout.", "bad", "sv92-fear-column", "The message runs the tower stairs faster than you climb them, and you can chart its progress by the lights going out floor by floor. The routing office burns papers. You can smell it on the wind. Above, a man who hears every grudge at once hears the village's fear turn toward him, and pours himself the last quiet hour he owns."),
        ]),
    ],
    "Ashen Leaf Village": [
        interlude("Ashen Leaf Village", 20, "The Unsworn", [
            pg("The Appraiser", "The register annex, a stranger at the wall", "Toma Reed",
                "Don't stare. That's Kite Harrow. She has a Central license and works for whoever pays her.",
                "She's been in the annex since the gates opened. They even gave her a chair and tea.",
                "She appraises warehouses, estates, war losses. Things like that.",
                "I want to know what the village hired her to value."),
            { ...pg("Kite Harrow", "The annex wall, charts spread", "Kite Harrow",
                "You're blocking the light. No, stay.",
                "You're the person whose Register line grew a black flower.",
                "The village hired me to value a season of graft-slats for an outside buyer. The contract calls them stock.",
                "The buyer uses a quartered-circle mark. I've seen it in three villages.",
                "They aren't buying one shipment. They're assessing the whole system."),
                choices: [
                    { text: "Look her in the eye. \"People aren't stock.\"", nextPage: 2 },
                    { text: "Ask her what a future actually sells for.", nextPage: 2 },
                    { text: "Tell her you want no part of the appraisal.", nextPage: 2 }
                ] },
            pg("The Refund", "The annex steps", "Kite Harrow",
                "I understand why you don't trust this. I don't like what I've found either.",
                "A village hires an outside appraiser when someone inside no longer trusts the local figures.",
                "I also couldn't value your Register line. The numbers wouldn't settle.",
                "I refunded that part of the fee. I'll be back through eventually."),
        ], [
            ch("Walk her to the gate, in front of everyone.", "good", "al20-met-her-eye", "She walks beside you in silence until the arch. 'The clerks will remember you walking me out,' she says. 'So will I.'"),
            ch("Memorize her charts before the clerks fold them away.", "neutral", "al20-took-her-measure", "The charts list yields by household and season. Under OUTSIDE PARTY, you find the name FIFTH ANCHOR. Harrow notices where you are looking and holds the chart open until you finish."),
            ch("Tell the clerks to escort her out. This village isn't for sale.", "bad", "al20-turned-your-back", "She packs without hurry, pays for her own tea, and leaves a calling card on the desk anyway. Toma reads it aloud later: 'For when you find out what already sold.'"),
        ]),
        interlude("Ashen Leaf Village", 30, "Aren's Handwriting", [
            pg("The Joiner's Bench", "Toma's family workshop, sawdust in the lamplight", "Toma Reed",
                "Come in. Mind the wood shavings.",
                "That's Aren's bench. My mother dusts it every morning.",
                "I almost showed you this after the archive, but I got scared.",
                "Fourteen households received survey letters this week. Three belong to children I know.",
                "Sit down. Please."),
            pg("The Letter", "A floor board up, oilcloth unwrapped", "Toma Reed",
                "Read the second line. His hand shook when he wrote it.",
                "He was building a water-screw to irrigate the terrace fields. He filed a formal complaint against the pruning rites. And he wrote this to me: 'If they cut me, Toma, remember me arguing.'",
                "A month later, he was quiet. My mother remembers him as peaceful.",
                "This joint is from the water-screw. Put it in running water and it climbs. I tested it. The design works."),
            pg("What He Was Becoming", "The bench, the letter between you", "Toma Reed",
                "That's the part of Aren everyone forgot. The letter, the machine, the argument.",
                "I've never shown this to anyone. The letter names the pruning rites, so it could get both of us surveyed.",
                "I knew that before you came in.",
                "Say something."),
        ], [
            ch("\"Let's finish Aren's water-screw. I'll help you build it.\"", "good", "toma-hope", "His grip loosens on the joint. He sets it on the bench, wipes his face with his wrist, and reaches for paper. 'Then we'll need better tools,' he says."),
            ch("\"I'll keep the letter safe. That's all I can promise yet.\"", "neutral", "toma-caution", "He nods slowly, wraps the oilcloth himself, and sets it in your hands. 'That's more than anyone else has ever done,' he says. 'It isn't enough. But it's more.'"),
            ch("\"Burn it, Toma. Before it gets you pruned too.\"", "bad", "toma-doubt", "He goes very still, and then laughs once, badly. 'You sound like the survey. You sound sensible.' He hides the letter back under the floor anyway."),
        ]),
        interlude("Ashen Leaf Village", 42, "Pruning Season", [
            { ...pg("Tea at the Reeds'", "Ash-house row, Toma's family door", "Toma Reed",
                "My mother has been asking to meet you for weeks. Word about my shinobi friend reached her sewing circle before it reached me, which tells you everything about this village.",
                "It'll be an hour. She'll pour tea, show you my baby drawings, and send us off with bread. Completely painless, I promise.",
                "One thing first, and then I'll stop being strange about it. In the workshop, behind Aren's bench, his tools used to hang on the wall. She painted over that wall years ago, and the shapes still show through. I don't think she sees them.",
                "You should see them. And you shouldn't point at them. I need both of those things, if that makes sense."),
                choices: [
                    { text: "Go in for tea.", nextPage: 1 }
                ] },
            pg("Sera Reed", "The Reed kitchen, tea and a proud wall", "Sera Reed",
                "So you're the one keeping my Toma out at all hours. Sit down, sit down. Toma, love, fetch the good cup.",
                "Has he told you about his brother? Aren, my eldest. A quiet boy. Dutiful. Happiest at his workbench, ever since he could walk. Some mothers get the arguing kind of son. Not me. Not with Aren.",
                "He never gave me one gray hair, that boy.",
                "You've stopped eating, dear. Have more bread. And Toma, fetch the album, the one with the bench pictures."),
            { ...pg("The Painted Wall", "The workshop, ghost outlines behind the bench", "Narrator",
                "While she hunts for the album, you drift to the workshop doorway.",
                "The wall behind the bench is painted a careful cream color. And under the paint, faint but unmistakable, are the shadows of a working life: two saws, a row of chisels, a large auger. And higher up, a drafting square, hung where a boy would need to stretch to reach it.",
                "The paint below the square is scuffed in two narrow arcs, where reaching hands brushed the wall again and again. Toma sees the marks and stops in the doorway.",
                "In the kitchen, Sera laughs at something in the album. The kettle sings. Neither of you points at the square."),
                choices: [
                    { text: "Ask Sera, gently, what Aren used to argue about.", nextPage: 3 },
                    { text: "Say nothing. Memorize every outline.", nextPage: 4 }
                ] },
            { ...pg("The Edit Holds", "The kitchen, album open", "Sera Reed",
                "Argue? My Aren? Oh, you're thinking of another family, dear. The Kellers, three doors down. Those boys argue.",
                "Although. There was one supper. Aren stood up and said something about... water, I think. Water, or the fields, or...",
                "Isn't that funny. It's like reaching into a pocket and finding a hole. I was sure I kept something there.",
                "Well. He apologized the next morning. He always apologized so nicely, my Aren. Didn't he, Toma? More tea, dear?"),
                choices: [
                    { text: "Let it drop.", nextPage: 4 }
                ] },
            pg("The Dish Towel", "The Reed kitchen after tea, cups waiting by the basin", "Toma Reed",
                "Blue cup first. The glaze chips if it hits the iron one.",
                "You're washing faster than I can dry. Give me a moment.",
                "Sorry. It's easier to talk about cups.",
                "Pass me the iron cup anyway."),
            pg("Leaving Warm", "The row at dusk, Toma silent beside you", "Toma Reed",
                "Now you've met my mother. She's kind, she's happy, and she remembers the wrong son.",
                "Sometimes I don't know whether telling her would help her or only help me.",
                "If we write down what we saw, it becomes evidence, and evidence can put her under survey. If we don't, it may disappear the way the rest of him did.",
                "Thank you for eating the bread. She would have noticed if you didn't."),
        ], [
            ch("Copy the wall's outlines tonight, exact and to scale.", "good", "al42-filed-a-report", "You measure and copy the tool outlines, adding the date but leaving off the family's name. Toma checks your drawing against the wall. 'Thank you,' he says. 'I was afraid I'd start forgetting them too.'"),
            ch("Keep it all in your head. Paper gets people surveyed.", "neutral", "al42-kept-the-count", "Two saws, the chisels, the auger, the drafting square. You repeat the list together as you walk home. There is no paper for the survey to find, though both of you know how unreliable memory has become."),
            ch("Chip one painted outline off the wall as hard proof.", "bad", "al42-burned-a-blank", "You return to the workshop and wrap a flake of paint in a napkin. Toma looks at the bare patch you have left. On the way out, Sera hugs you and thanks you for listening. You keep the napkin out of sight."),
        ]),
        interlude("Ashen Leaf Village", 58, "Mori's Cut", [
            { ...pg("The Bloom Charts", "Mori's study, forty years of charts", "Elder Mori",
                "Close the door and sit down.",
                "This book records every black flower from the last forty years. The second book is the survey schedule.",
                "I'm going to leave them open while I refill the tea.",
                "You can read them or close them. I won't ask which."),
                choices: [
                    { text: "Read both books, side by side.", nextPage: 1 },
                    { text: "Close the books. \"Just tell me plainly, Elder.\"", nextPage: 2 }
                ] },
            { ...pg("The Pattern", "The study, charts under lamplight", "Narrator",
                "It takes ten minutes to see, and you already know you will never unsee it.",
                "A black flower blooms on a household's fence. Three to five seasons later, that same household appears on the pruning schedule. The bigger the bloom, the shorter the wait. Forty years of pages, and the pattern never misses.",
                "The flowers mark the households the survey will target. The bread and congratulations arrive months before the orders to cut.",
                "Mori returns with the tea. 'That's how I knew who would be next,' he says. He puts your cup beside the schedule. 'You deserved to know sooner.'"),
                choices: [
                    { text: "Pour the tea.", nextPage: 3 }
                ] },
            { ...pg("Plainly, Then", "The study", "Elder Mori",
                "The flowers are not blessings. When a fence blooms, someone in that house is usually surveyed within three to five seasons.",
                "The pattern has held for forty years.",
                "I worked it out when I was young. I kept recording it and never warned the families.",
                "I'm asking whether you want to learn how to read the pattern."),
                choices: [
                    { text: "Decide.", nextPage: 3 }
                ] },
            pg("The Heaviest Thing He Owns", "The study, tea going cold", "Elder Mori",
                "Before you choose, the Reed household is not in the schedule book. I removed that page years ago.",
                "Don't expose them by being careless with these records.",
                "I'm seventy. Someone else needs to know what the flowers mean.",
                "Do you want to learn?"),
        ], [
            ch("\"Keep the reading, Elder. I'd rather fight it than forecast it.\"", "good", "al58-refused-the-cut", "He closes both books. 'Then help me stop the next survey,' he says. 'I've spent enough years predicting it and doing nothing.'"),
            ch("Learn the rule of the pattern, but refuse the names.", "neutral", "al58-took-note", "Bloom size, seasons until survey, the ratio between them. Seven lines in your own cipher, no household names attached. Mori nods like a man watching someone take one coal from a fire, and marks your page with a dry leaf."),
            ch("Learn everything. Names, seasons, all forty years of it.", "bad", "al58-took-the-knowledge", "By midnight, you can use the bloom charts to estimate when a household will be surveyed. Mori helps you copy the names and dates. 'Now you know what I knew,' he says. 'And how long I stayed quiet.'"),
        ]),
        interlude("Ashen Leaf Village", 70, "The Register Opens", [
            pg("Your Survey", "The register annex, your name on the day's list", "Registry Duty Clerk",
                "There you are. Routine becoming-survey. Everyone of rank gets one, and yours is overdue, mostly because the wall keeps misfiling you.",
                "Normally this is where I ask what you've been becoming since your signing, you lie a polite amount, and we both go to lunch.",
                "Except I pulled your slat this morning, to prepare.",
                "I have been a duty clerk for nineteen years. I need you to look at your own line and tell me I'm not seeing what I'm seeing."),
            { ...pg("The Old Scar", "Your slat, under the good lamp", "Narrator",
                "There is your signing. There is the black flower, pressed into the grain like a seal.",
                "And there, running through the section where your intended becoming should be, the cedar is scarred. Not blank. Cut. The same tidy, healed-over cut you have learned to recognize on other people's records.",
                "The scar is old. Older than your signing. Older than your arrival in this village. Someone pruned your future before Ashen Leaf ever met you, and the wall has been trying to file the wound ever since.",
                "It doesn't mean you have no future. One future you once intended was cut out so completely that no record can name it.",
                "As you stare at it, the black flower turns on your line, slowly, until it points straight at the scar. It has been trying to show you since the day you signed."),
                choices: [
                    { text: "You wrote 'protect people.' Look at what's left of that answer.", nextPage: 2, requireTrait: "al4-become-protector" },
                    { text: "You wrote 'strongest alive.' Look at what's left of that answer.", nextPage: 3, requireTrait: "al4-become-strongest" },
                    { text: "You wrote 'build something lasting.' Look at what's left of it.", nextPage: 4, requireTrait: "al4-become-builder" },
                    { text: "You wrote 'uncover what's hidden.' Look at what's left of it.", nextPage: 5, requireTrait: "al4-become-seeker" },
                    { text: "You couldn't answer the fourth question. Could the scar be connected?", nextPage: 6, requireTrait: "al4-become-unknown" },
                    { text: "Stare at the scar. Whatever you once answered, this came first.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you said you wanted to protect people. That answer was written directly over the older cut.",
                "The wall can't say whether the two are connected, only that someone cut one of your futures out before you chose this one.",
                "Since arriving, you have faced the survey at the fence, in the archive, and on the kiln road. Whatever was taken before, you made those decisions yourself."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the wall you would become the strongest shinobi alive. The ink of that answer sits directly on top of the old scar.",
                "Someone cut one of your futures out before you ever reached Ashen Leaf. Whether that is why you chose strength, the wall can't say.",
                "The grove, the archive, and the Rootfire tested the person you are now. Whatever was taken, those wins were yours."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the wall you wanted to build something that outlasts you. The ink of that answer sits directly on top of the old scar.",
                "One earlier plan for your life was cut out. Whether it was a plan to build anything, the wall can't say.",
                "Aren's water-screw can lift cold-season water if the surviving joint and channel marks are sound. Finishing it would restore work the survey erased and give the terraces another source besides the Rootfire."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the wall you wanted to uncover what people hide. The ink of that answer sits directly on top of the old scar.",
                "Someone took one of your futures before you arrived, and hid the taking. Whether that is why you look for hidden things now, the wall can't say.",
                "The archive, the bloom charts, and the sealed crates gave you real reasons to look. The scar doesn't have to explain any of that."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the clerk you didn't know what you intended to become. The quill dragged. The wall waited for a word that should have been there.",
                "The cut offers one reason the answer felt missing. An earlier plan for your life had already been taken out of the record.",
                "The scar shows one earlier choice was removed before Ashen Leaf asked its question. It says nothing about what you choose next."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("What Mori Sees", "The annex, Mori summoned, door barred", "Elder Mori",
                "Move the lamp closer. Hm.",
                "Every pruning cut I've examined carried a stamp, a season, and the keeper's mark. Yours has none of them. We can't tell who did this, or why there is no record.",
                "The black flower is a warning, not an honor. The Register recognizes the same kind of damage our pruning leaves, but it cannot find who approved yours.",
                "This may connect to the mission with no report. Tell us what you remember, even if the answer is very little."),
                choices: [
                    { text: "Face the question.", nextPage: 8 }
                ] },
            pg("Pending", "The annex, your slat on the table between three people", "Registry Duty Clerk",
                "So. Nineteen years of filing, and today I have a Jonin with a pruning scar older than their record, no stamp, and a flower that points at wounds.",
                "I have to write something in the survey book. The survey reads what I write, and what I write follows you.",
                "Mori can advise you, but I'll write what you ask me to. It's your record.",
                "Tell me what to write, Jonin."),
        ], [
            ch("\"Write the truth: cut by hands unknown. And that I want it back.\"", "good", "al70-claimed-the-name", "The clerk writes it in full and stamps it with a hand that isn't quite steady. Somewhere below hearing, the cedar wall answers, and one more petal opens on your line. Now the survey knows that you know."),
            ch("\"Write 'pending.' The wall has kept my secret this long.\"", "neutral", "al70-erased-the-name", "'Pending,' the clerk writes, with visible relief. Mori puts his glasses back on and says nothing. The scar remains unclassified, and the Register has no branch to prune yet."),
            ch("\"Write that the scar is for sale. Let's see who comes to buy.\"", "bad", "al70-traded-the-name", "The clerk stares, then writes your answer. Within the week, two survey officers and Harrow ask to view your line. You note each request, hoping one will lead to whoever made the cut."),
        ]),
        interlude("Ashen Leaf Village", 80, "Harrow's Shortcut", [
            pg("The Buyer's Terms", "The orchard gate at dusk, Harrow waiting", "Kite Harrow",
                "Walk with me. I finished the graft-slat appraisal today.",
                "The buyer sent one follow-up question in writing.",
                "They asked: 'do the fresher ones travel?'",
                "I raised the price high enough to kill the deal. They doubled it without asking why."),
            { ...pg("The Bud", "The orchard wall, her charts under her arm", "Kite Harrow",
                "They want a premium lot next season. Someone young, alive, and not yet cut. They asked me to identify candidates.",
                "I haven't named anyone.",
                "I almost wrote 'not yet' in that sentence. That's what scares me.",
                "What do I do with the information I have?"),
                choices: [
                    { text: "\"Kill this market. You're the only one who can.\"", nextPage: 2 },
                    { text: "\"Start with everything you know about the buyer.\"", nextPage: 2 }
                ] },
            { ...pg("The Pipe Under the Hearth", "The orchard wall, a copied schematic held up against the dusk", "Kite Harrow",
                "I traced where the shipments go. Look at this copy of the schematic.",
                "The Rootfire has a lower line that runs to the same system as Stormveil's Engine, Frostfang's Vault, and Moonshadow's Mirror.",
                "The name on that system is Hollow Gate."),
                choices: [
                    { text: "Say it again.", nextPage: 3 }
                ] },
            { ...pg("Four Lines, One Drain", "The orchard gate, lanterns coming on, the schematic folded away", "Kite Harrow",
                "The copied schematic labels the four lines: Stormveil supplies the reasons people fight. Ashen Leaf supplies futures people were becoming. Frostfang supplies the choice to leave. Moonshadow supplies trust people placed in someone.",
                "The Ashen Leaf shipment logs verify this line. The other labels still need their villages' records.",
                "The Rootfire keeps enough to warm the village. The rest goes down to Hollow Gate.",
                "Hoshina has signed the lower-draw approval for thirty years. She knows where the surplus goes.",
                "Now we know too."),
                choices: [
                    { text: "Hear the rest of what she holds.", nextPage: 4, trait: "al80-named-hollow-gate" }
                ] },
            pg("What Harrow Holds", "The orchard gate, lanterns coming on", "Kite Harrow",
                "I have the shipping route, the agent's alias, and the sample manifest. The manifest carries Ashen Leaf's official stamps.",
                "The village already sold a sample and hired me to value the rest.",
                "If I turn against the buyer, I lose my license in four villages.",
                "I think I'm going to do it anyway. Tell me where to start."),
        ], [
            ch("Burn the manifest together, and give Mori the buyer's name.", "good", "al80-pulled-her-back", "She strikes the match herself and holds it a moment too long before dropping it. 'There goes my retirement.' She watches the buyer's name curl black before she turns away. By morning, Mori has the alias. Harrow stays at his table long enough to answer every question, without an invoice."),
            ch("Split the work: she stalls the buyer while you copy everything.", "neutral", "al80-split-the-draw", "Route, alias, manifest, stamps: copied into your cipher before midnight. Harrow feeds the buyer polite delays billed as due diligence. 'We're now partners in a crime against a crime,' she says. 'I've signed worse contracts.'"),
            ch("Tell her to take the deal and keep her seat at that table.", "bad", "al80-let-her-burn", "She considers it. 'I can stay in contact without giving them a person.' She offers the buyer a warehouse of expired stock and gives you a copy of the receipt, including the delivery address."),
        ]),
        interlude("Ashen Leaf Village", 88, "The Wet Field", [
            { ...pg("The East Channel", "The east terrace channel at night, lamplight on low water", "Toma Reed",
                "You came. Good. Keep your voice down and your boots on the stones. The mud here eats people's ankles.",
                "This channel should be full during planting season. The terraces have been short of water for thirty years.",
                "I've brought a test joint built from Aren's surviving piece and his workshop measurements. Jorun helped fit it. The full frame is already in the channel.",
                "If it doesn't work, we try again. If it does, we can show Hoshina what Aren was trying to build.",
                "My hands are shaking. Let's get started."),
                choices: [
                    { text: "The footbridge held under our weight.", nextPage: 9, requireTrait: "sf-al-repaired-first" },
                    { text: "You brought the extra lamp.", nextPage: 10, requireTrait: "sf-al-followed-cart" },
                    { text: "Show me where to brace the frame.", nextPage: 1 }
                ] },
            pg("Hands Remember", "Jorun planing a housing board by lamplight", "Narrator",
                "Jorun works with his eyes half closed, planing the housing boards by touch.",
                "'Move the left mount,' he says. 'No. Not that far. Half a thumb.' His hands find the angle before his face has caught up to why.",
                "'I have never built a thing like this in my life,' he tells nobody, and sets the joint anyway, correct to the grain.",
                "Toma watches the whole thing and goes quiet. 'Twenty years of chairs,' he says at last, 'and his hands still know the bridge.'"),
            { ...pg("The First Turn", "The screw lowered into the channel, rope taut", "Narrator",
                "The three of you lower the screw into the channel on ropes. Cold water climbs your sleeves. Somewhere above, a night bird complains about the lamplight.",
                "Toma releases the brake. The screw turns once, beautifully. Then it stutters, grinds sideways, throws a sheet of water across all three of you, and stops with a crack. One vane has split along the grain.",
                "Toma drops the wet rope and swears, too soft to carry, the way you swear in a house where someone is sleeping.",
                "Jorun hauls the screw half out and holds the lamp to it. Fixable tonight, he says. Not quick. Not without hands in the cold water. Toma is staring at the split vane like it is a verdict."),
                choices: [
                    { text: "\"I told you to burn Aren's letter because I was afraid. I called it sense. It wasn't.\"", nextPage: 3, requireTrait: "toma-doubt", trait: "al88-repaired-trust" },
                    { text: "Carve the builders' names into the housing first. A. Reed. T. Reed.", nextPage: 4, trait: "al88-named-the-builders" },
                    { text: "Get into the channel and hold the frame while they reset the vane.", nextPage: 4 }
                ] },
            { ...pg("Trust Catches Up", "The channel bank, the lamp between you", "Toma Reed",
                "Don't say it again. Once was enough.",
                "You told me to burn Aren's letter because you were afraid it would get me hurt. I know that now.",
                "I still don't know if I forgive you. Help me make the machine work and we'll start there.",
                "Get in the water. You hold the frame. Hand me the wooden mallet."),
                choices: [
                    { text: "Get in the water.", nextPage: 4 }
                ] },
            { ...pg("The Water Climbs", "The screw turning, water rising up the flights", "Narrator",
                "The second turn is nothing like the first. The screw bites, steadies, and begins to lift, and the sound it makes is low and even, like a man humming over a workbench.",
                "Water reaches the first terrace flight, then the second, in a steady stream.",
                "'It climbs,' Toma says. Then again, quieter, to himself: 'It climbs.' He scrubs his face with a muddy wrist and leaves it dirtier. 'He was right. Roots take me, he was right.'",
                "A lamp comes down the terrace path. Sera, with tea and dry cloth, because her son has been sneaking out at night and mothers notice. She looks at the machine a long moment, then at the marks scratched on the housing. 'That's Aren's three,' she says. 'He never closed his threes.'"),
                choices: [
                    { text: "The water keeps climbing.", nextPage: 5, trait: "al88-water-proven" }
                ] },
            { ...pg("The Number", "Wet chalk figures on a channel stone", "Toma Reed",
                "Jorun, check the flow and lift against Aren's figures. How far up the fields will it reach?",
                "Ninety mouths. That's what the east terraces can feed if we keep this running through the cold. Aren worked it out, and here it is, without burning a single future.",
                "It won't get us through winter on its own. But we can grow more food without taking anyone's future. We should have been building these years ago.",
                "So it works, and we can prove it works, and the burning's at frost-fall. What we do next decides whose proof it becomes."),
                choices: [
                    { text: "Set Aren's model beside the working machine.", nextPage: 6, requireTrait: "al65-saved-the-screw", trait: "al88-ninety-mouths" },
                    { text: "Let the numbers stand on their own.", nextPage: 11, trait: "al88-ninety-mouths" }
                ] },
            { ...pg("The Model and the Machine", "The little model turning beside its full-grown self", "Toma Reed",
                "You kept it. After the crates, the squad, all of it. And now the little screw is turning beside the full-size one.",
                "Look at the cracked vane. That's Aren's repair. The machine works, but this is what proves it was his.",
                "Someone has to put both in front of Hoshina and say his name. I can do it. You can. But one of us has to.",
                "So choose. I don't want to carry this halfway and stop."),
                choices: [
                    { text: "\"We built your brother's answer. Now I'll carry it to her.\"", nextPage: 11, requireTrait: "toma-hope", trait: "al88-reed-proof-ready" },
                    { text: "\"You trusted me with the letter. Trust me with the proof.\"", nextPage: 11, requireTrait: "toma-caution", trait: "al88-reed-proof-ready" },
                    { text: "\"Let me carry Aren's model to Hoshina and show her the proof.\"", nextPage: 11, requireTrait: "al88-repaired-trust", trait: "al88-reed-proof-ready" },
                    { text: "\"This belongs with his family. Let the Reeds carry Aren. I'll keep the stair clear.\"", nextPage: 7, requireTrait: "toma-hope", trait: "al88-reed-proof-deferred" },
                    { text: "\"This belongs with his family. Let the Reeds carry Aren. I'll keep the stair clear.\"", nextPage: 7, requireTrait: "toma-caution", trait: "al88-reed-proof-deferred" },
                    { text: "\"This belongs with his family. Let the Reeds carry Aren. I'll keep the stair clear.\"", nextPage: 7, requireTrait: "al88-repaired-trust", trait: "al88-reed-proof-deferred" },
                    { text: "Keep the model to yourself. Let that be your part.", nextPage: 8 }
                ] },
            { ...pg("You Carry the Door", "The channel bank, Toma holding the model", "Toma Reed",
                "I'll carry the model and the letter. Keep the stair clear so my mother can come with me. And afterward you're eating at our house. I'm not arguing about that part.",
                "That's not the small job. Somebody has to make sure there's a village still standing when we reach the tower, and a way out the back if there isn't. That's you.",
                "I hid his letter under the floorboards for years. Now I can show Hoshina that his machine works.",
                "Thank you for helping us get this far."),
                choices: [
                    { text: "Let it be theirs to say.", nextPage: 11 }
                ] },
            { ...pg("Grateful Is Not Ready", "The channel bank, the model still in your own hands", "Toma Reed",
                "You saved Aren's model from the squad. I'm grateful for that. But we need to agree on what happens to it now.",
                "But it's still built from what's left of my brother's work. Keeping it in your coat doesn't make it yours, and it doesn't speak for him or for my mother.",
                "Keep it safe tonight. After the tower, we work out where it belongs. Just don't walk it upstairs and put it in front of her like it's your proof to give."),
                choices: [
                    { text: "Keep the model. Walk on.", nextPage: 11, trait: "al88-unfinished-answer" }
                ] },
            { ...pg("The Wider Wedge", "The channel bank, Toma sorting wet wedges beside the frame", "Toma Reed",
                "That ugly offcut held the bridge. I've brought wider wedges for the frame.",
                "I thought that board needed to fit tight. You were right to leave it room to move.",
                "Hold this wedge against the housing while I turn the screw. We'll see whether it shifts."),
                choices: [
                    { text: "Hold the wedge. Wait for the fit.", nextPage: 1 }
                ] },
            { ...pg("The Extra Lamp", "The channel bank, two lamps beside Toma's clamp bag", "Toma Reed",
                "I still think we chose the plates and the bridge in the wrong order. I brought a second lamp anyway.",
                "The plates are safe. Next time we have two jobs, I'd like to see what I'm repairing.",
                "Put one lamp where Jorun can see the grain. Keep the other low for our hands."),
                choices: [
                    { text: "Set the lamps. Take the wet side.", nextPage: 1 }
                ] },
            pg("The Water Keeps Climbing", "First gray light, the water still climbing", "Narrator",
                "By first light the tea has gone cold. Water is still climbing through the screw.",
                "Jorun sits on the bank flexing his warm hands, unsettled and grinning about it. Sera folds the drying cloth, then unfolds it, then folds it again, because her hands need the job.",
                "Frost-fall is coming. Fourteen names are still on the transfer register, whatever has happened to the people behind them since. In the channel, a dead man's machine turns and turns.",
                "Toma scrubs the mud off his jaw with his wrist and looks at you. 'Well,' he says. 'How do you want to do this?'"),
        ], [
            ch("Wake the terrace houses. Let them see it climb before dawn.", "good", "al88-proved-the-winter", "By first light forty people crowd the terrace edge while children race the water up the flights. Toma answers questions until his voice gives out. At the back, a gray-coated surveyor watches the screw complete another turn, closes an empty report cover, and starts uphill."),
            ch("Keep it quiet. Record every number: flow, lift, reach, mouths fed.", "neutral", "al88-held-the-proof", "You measure everything twice by lamplight and carry the figures to Mori before the village wakes. He reads them in silence, then opens his testimony book to a fresh page and writes until his hand cramps. The proof is safe, signed, and waiting for its moment."),
            ch("Let the survey hear just enough to come looking.", "bad", "al88-baited-the-survey", "You leave the machine running where the surveyor will find it. Toma watches from the bank as she measures the flow and writes her report. 'Now she knows exactly where it is,' he says. 'We'd better hope Hoshina listens.'"),
        ]),
        interlude("Ashen Leaf Village", 92, "Witnesses", [
            pg("The Last Road", "The kiln road at dawn, three figures waiting", "Narrator",
                "Word has spread that you will confront Hoshina at frost-fall. People gather along the tower road to see whether you can stop the next cuts.",
                "Three people are waiting for you on the kiln road. By the look of them, they have been waiting since before first light.",
                "Behind them, along the whole row, windows are lit and shutters stand open. The village is watching this road today."),
            { ...pg("The Mother", "The road, Sera Reed stepping forward", "Sera Reed",
                "Don't look so alarmed, dear. Toma told me where you'd be walking. He tells me things now. We're practicing that, the two of us.",
                "Toma showed me Aren's letter this week. I knew the hand before I could name the boy: the loops he never closed, the ink pressed hard when he argued.",
                "I washed ink out of that boy's sleeves for years. That was my job, apparently. Washing his shirts and forgetting him. No. That came out wrong. I am angry, and I am very new at it, and I keep saying it badly.",
                "I want to tell the village what happened to Aren. I've seen his work now. I can stand beside you and say it was real."),
                choices: [
                    { text: "\"The Reeds carry Aren's proof today. You'll carry his mother's word.\"", nextPage: 2, requireTrait: "al88-reed-proof-deferred" },
                    { text: "Take her to the east channel. Show her Aren's answer running.", nextPage: 4, requireTrait: "al88-water-proven" },
                    { text: "\"It helps more than you know. Walk with us.\"", nextPage: 7 }
                ] },
            { ...pg("This Part Is Ours", "The road, Sera and Toma with the model and the letter", "Toma Reed",
                "You were right to let us carry this.",
                "We have Aren's model, his letter, and my mother's testimony.",
                "Walk us to the tower. We'll speak when we get inside.",
                "If the guards close the door, open it again."),
                choices: [
                    { text: "Let Sera speak first.", nextPage: 3 }
                ] },
            { ...pg("The Threes", "The road, Sera holding the letter flat", "Sera Reed",
                "My son wrote in stubborn threes. He argued in ink. He pressed too hard on the page when he was angry, and he was angry a great deal, and I loved every loud inch of him.",
                "I remember enough now to say that aloud. To her face, if she lets me.",
                "I spent years thanking the roots for a quiet, peaceful son. I will spend the rest of my life un-saying it. Walk me to the door, dear. I'll do the rest."),
                choices: [
                    { text: "Walk them to the tower.", nextPage: 7 }
                ] },
            { ...pg("The Better Winter", "The east terrace channel, dawn water running", "Toma Reed",
                "Look at the water before we go.",
                "It hasn't stopped since the trial. Jorun checks it every morning.",
                "Aren's full-size screw is feeding the east terraces without the Rootfire.",
                "Whatever happens at the tower, the machine works."),
                choices: [
                    { text: "\"And the terrace houses saw it climb. The whole row saw.\"", nextPage: 5, requireTrait: "al88-proved-the-winter" },
                    { text: "\"She already knows, Toma. I made sure her own survey saw the field.\"", nextPage: 6, requireTrait: "al88-baited-the-survey" },
                    { text: "Let the water speak. Walk on.", nextPage: 7 }
                ] },
            { ...pg("What They Saw", "The channel, doors opening along the terrace row", "Toma Reed",
                "That's the whole plan now, isn't it. Show them what they saw with their own eyes. The east channel. The water climbing.",
                "They can dispute Mori's book. But forty people watched the water climb, and more see it every day. Hoshina will have to answer them too.",
                "The terrace families can see what his work will do for them. Aren would have been out here talking to every one of them."),
                choices: [
                    { text: "Walk on.", nextPage: 7 }
                ] },
            { ...pg("The Dry Report", "The channel, a gray figure gone from the tree line", "Toma Reed",
                "A gray coat walked past this field three times this week, counting on her fingers like we couldn't see her from the water. You wanted the survey to notice. It noticed.",
                "The survey has measured the flow. Hoshina should have their report by now. I want to hear how she explains it.",
                "I hate that your trick worked. Next time you use our field as bait, tell me before the gray coats arrive. I still would have helped. I want that in the record too."),
                choices: [
                    { text: "Walk on.", nextPage: 7 }
                ] },
            { ...pg("The Keeper of Records", "The road, Mori with a bound book and a second stack tied in survey string", "Elder Mori",
                "Forty years of bloom charts, every page in my hand, my name at the bottom.",
                "And these are the survey office's shipping logs. I counted the flowers. I never counted what the cuts took from people, or where it was sent.",
                "Enough of it burned here to keep us warm. The rest went below. I'm going to read the number in the tower and let the village decide what to do with me.",
                "My signature matters because I was the keeper who stayed quiet. I can't undo that by finally telling the truth.",
                "But I can bring the records. Take both stacks. And when this is done, help me plant something. I am tired of only recording what ended."),
                choices: [
                    { text: "\"Open the book, Elder. Read me the east channel pages.\"", nextPage: 8, requireTrait: "al88-held-the-proof", trait: "al92-gate-witnessed" },
                    { text: "Show Mori the names carved into the housing.", nextPage: 9, requireTrait: "al88-named-the-builders", trait: "al92-gate-witnessed" },
                    { text: "Take the book, and walk on.", nextPage: 10, trait: "al92-gate-witnessed" }
                ] },
            { ...pg("A Count That Argues", "Mori turning the east channel pages, wetting his thumb, losing his place once", "Elder Mori",
                "Here. The channel pages. Flow, lift, field reach, mouths fed. Measured at the worst stretch, in the driest week, the way I taught you. No clerk alive can call it generous.",
                "I've signed the measurements. Hoshina asked for an alternative, and these figures show what the channel can provide.",
                "I've spent forty years keeping records of the cuts. I want to read these figures to her myself, if you'll let me."),
                choices: [
                    { text: "Walk on together.", nextPage: 10 }
                ] },
            { ...pg("The Signatures", "His thumb on the carved housing plate", "Elder Mori",
                "You carved the builders' names into the housing. A. Reed. T. Reed. And under them, room for more.",
                "Those names matter. Anyone who sees the machine will know who designed it and who finished the work.",
                "Before we reach the gate, I will cut my own name beside theirs. It is long past time the record keeper went on the record."),
                choices: [
                    { text: "Walk on together.", nextPage: 10 }
                ] },
            pg("The Third Figure", "The road's bend, a survey officer waiting alone", "Narrator",
                "The third figure wears survey gray, stands alone, off schedule, hands kept visible. Everything about the posture says: I am breaking a rule, carefully.",
                "'Fourteen names remain on the transfer register,' the officer says quietly, to the middle distance. 'Some may be free, some may still be held, but the order still treats them as kiln stock. I am the officer who countersigns transfers.'",
                "'Some of us joined the survey to keep records, not to feed fires. If someone were to walk on the tower today, with the village behind them, some of us would countersign... slowly.'",
                "The officer looks at you once, directly, afraid and doing it anyway. Then gray robes, and gone between the trees."),
            pg("The Village Behind You", "The tower road, doors opening along the row", "Toma Reed",
                "The doors are opening all the way down the row.",
                "My mother told her sewing circle. Jorun is coming with his bridge drawings. Imera is already ahead of us. Someone packed bread.",
                "You didn't ask them to come. They chose to.",
                "Decide how you want to approach the tower."),
        ], [
            ch("Walk in the open, slowly, letting anyone fall in beside you.", "good", "al92-carried-their-trust", "Sixty people reach the tower gate with you, their hands empty. The survey officer refuses to countersign an order to clear the road. Imera names the guard who signed Sena's transfer. The sergeant lowers his weapon and opens the gate. Sera leads the families through."),
            ch("Go in through the survey door, with Mori's book and the officer's word.", "neutral", "al92-took-the-count", "The officer escorts you and Mori's records through the survey entrance. The families wait outside while you ask for an audience with Hoshina. You have the shipment logs ready for her to examine."),
            ch("Warn Hoshina that you are coming to make her answer for the people she pruned.", "bad", "al92-wore-their-fear", "Your warning reaches the tower ahead of you. By the time you arrive, extra guards stand at the gate. The families keep following, though they leave a wider gap between themselves and your party."),
        ]),
    ],
    "Frostfang Village": [
        interlude("Frostfang Village", 20, "The Unsworn", [
            pg("Hazard Pay", "Second roll call, a bare-wristed woman leaning on the roll stone", "Kite Harrow",
                "You're looking at my wrist. Bare, yes. Contractor, Central license. Kael pays me double and calls it hazard pay. I framed the invoice.",
                "The hazard is that I can leave. That's all. I can walk out mid-job. A marked soldier can't.",
                "Frostfang will pay twice the rate for someone who still has an exit. Very flattering. For me.",
                "I've worked all four villages. This is the only one that turned leaving into a specialist skill."),
            { ...pg("The Outside View", "The wall walk, lantern lines humming overhead", "Kite Harrow",
                "Since you're carrying my kit, I'll show you something. Remember the words they taught you at intake: checked, counted, kept, warm.",
                "Watch the gate. It doesn't look at faces. It reads wrists. Someone could be freezing right in front of it and the gate would only care whether the mark is valid.",
                "The Roll started as people checking on each other. The Count checks a plate instead. Somewhere along the way, the mark became more important than the person.",
                "Feel the heat under these boards. There's no stove beneath this stretch of wall. I'd like to know what's warming it."),
                choices: [
                    { text: "Share your fire and rations with her at the change of watch.", nextPage: 2 },
                    { text: "Ask to read her license. All of it, terms included.", nextPage: 2 },
                    { text: "Call the next name on the roll and turn your back.", nextPage: 2 }
                ] },
            pg("The Anomaly", "The watch fire, snow ticking into the flames", "Kite Harrow",
                "I usually know what someone wants and what it would take to make them leave. I can't get a read on you.",
                "I bought the records I could find on you. There are gaps in them, and none explains why you came here. Normally I know more about someone by now.",
                "Here's my card. When you learn what's under the warm floor, come find me. I keep good records and I don't work for the Count.",
                "You take the fire. I've got a better coat."),
        ], [
            ch("Walk her to the gate at the end of the watch.", "good", "ff20-shared-the-fire", "She keeps half a step ahead until you reach the gate. 'People will notice you walking out with me,' she says. 'I appreciate it.' She shows her license, passes the plate without a reading, and waves once from the road."),
            ch("Read the license terms twice and memorize the exit clause.", "neutral", "ff20-read-her-license", "Clause nine: the contractor may terminate at will, and the Count may not compel return. One sentence, notarized in Central, and it makes her the freest person inside these walls. You memorize its grammar, word for word. Things bound by terms must obey their wording. That will hold a door open later."),
            ch("Turn your back and answer the roll louder than anyone.", "bad", "ff20-called-the-next-name", "You return to formation and answer your name loudly. Harrow leaves a card wedged in the roll stone anyway. Beneath her address, she has written: 'If you ever want to talk.'"),
        ]),
        interlude("Frostfang Village", 30, "The Ridge Roll", [
            pg("Nineteen Days", "The north tower at night watch, Yura with the roll book nobody assigned", "Captain Yura",
                "You're early. Sit down. I do this once a month.",
                "Ridge post four. Nineteen days in a storm. Three people died and I came back. The Count removed the post from the records afterward.",
                "So I keep my own record. Solvei. Brahm. Ketta. Dren. I call their names because nobody else does.",
                "Stay for it once. Then you'll know something about me that isn't in my file."),
            pg("The Struck Roll", "The tower rail, four names said into falling snow", "Captain Yura",
                "Solvei made these gloves on the fourth day. Brahm checked our kits so often that I still do it his way. Ketta sang when the wind got bad. I don't sing, so saying her name will have to do.",
                "Dren Coldewe left on day six. The Count calls him a deserter. On day nineteen, someone dragged me off that ridge. Command wrote down that I rescued myself. I was young, so I let them.",
                "I think it was Dren. I can't prove it. I answer my own name last because for nineteen days, none of us answered.",
                "That's why I run my unit the way I do."),
            pg("The Left Glove", "The tower rail, snow collecting along the stone", "Captain Yura",
                "Before you answer, let me fix your left glove.",
                "The cuff is tucked under your guard. Snow gets in there, your fingers go slow, and then someone else covers your side.",
                "Solvei used to catch mine before every patrol. Hold still.",
                "There. Now answer."),
            pg("What You Do With Knowing", "The tower, the roll book closing, snow easing", "Captain Yura",
                "My commanding officer thinks I believe in the Count more than anyone here. Sova thinks I'm proof that it works. Kael promoted me himself.",
                "None of them know I keep an illegal roll for four people the Count erased.",
                "The book goes under that floorboard. You're the only other person who knows where it is.",
                "Now say something. I trusted you with this. I need to know what you think."),
        ], [
            ch("\"Next month, call it with me. Two voices carry further.\"", "good", "yura-trust", "Yura opens the book again and writes your name in the narrow margin beside the next date. 'Second watch, third moon,' she says, checking the entry twice. 'Don't be late.' At the next Roll she leaves a pause after each name, and you learn exactly where your voice belongs."),
            ch("\"You're a better captain to those four than you are to the Count. I mean that as praise.\"", "neutral", "yura-respect", "She turns that over the way she checks a knot: twice, by feel. 'I'll take it,' she says finally. The book goes under the floorboard, and she starts assigning you the north watch more often, which in her language is a medal."),
            ch("Press her to name Dren as the rescuer she just said she cannot prove.", "bad", "yura-fear", "The book closes with a sound like a gate. 'I told you what I know and where it stops, and you pushed anyway. So now I'm wondering whether I should have shown you the book at all.' She looks at you a long, level moment. The next watch roster has you posted south, away from the tower, for a month."),
        ]),
        interlude("Frostfang Village", 42, "The Half Count", [
            pg("Evening Check", "The east gate at evening check, Private Essen in the line, loud", "Narrator",
                "Private Essen joins the gate queue, shouting that his brother has been listed as absent without leave. His brother was sent to a ridge post, but nobody entered the assignment in the roster.",
                "He shows you the duty sheet. His brother's orders are there, signed and dated. Essen wants someone sent up to relieve him before the weather gets worse.",
                "Ahead, at the plate, Elder Sova takes each wrist with the same two-beat litany. Check. Count. Next.",
                "Essen reaches the plate still talking. He puts down his wrist mid-sentence."),
            pg("A Half Count Long", "The gate plate, Sova's thumb resting on Essen's wrist", "Narrator",
                "Sova holds his wrist a half count past the litany. You'd miss it if you weren't watching for rhythm. Nothing about her face changes at all.",
                "The frost on the plate's rim creeps toward Essen's wrist, a finger-width, like something leaning in to drink.",
                "Essen stops in the middle of a word. He blinks, thanks Sova, and folds the duty sheet into his coat. He walks through the gate without mentioning his brother again.",
                "In the line behind him, nobody noticed anything. The check moves on. Check. Count. Next."),
            pg("The Direction of Frost", "The gate's shadow, Yura fallen in beside you, voice low", "Captain Yura",
                "You saw the plate hold his wrist longer.",
                "Tomorrow Essen will remember that his brother's posting was missed, but he won't feel the same urgency. He'll file a form and wait. The wall will call that an improvement.",
                "I've watched that frost move toward angry people for years and told myself it was weather.",
                "What did it take from him?"),
        ], [
            ch("Find Essen at mess. Tell him how he changed after the wrist check.", "good", "ff42-held-the-doubt", "You remind Essen of the duty sheet and describe what happened at the plate. He takes the sheet out again. As he reads, his anger returns. That night he goes up the ridge without orders and brings his brother home. At breakfast, he moves his chair beside yours."),
            ch("Record what happened at the plate. Watch for it at later checks.", "neutral", "ff42-kept-the-count", "You note the time, the length of the check, and the direction of the frost. Over the following weeks, you record thirty checks. The plate holds longest when someone arrives angry or unwilling to obey. You hide the book beneath a loose floorboard."),
            ch("Report Essen's outburst to the duty officer, by the book.", "bad", "ff42-reported-the-doubt", "You report a disruption at evening check, resolved without incident. The duty officer thanks you. The next morning, Essen is flagged for extra checks. His next three rotations all bring him back through the same plate."),
        ]),
        interlude("Frostfang Village", 58, "Sova's Cut", [
            { ...pg("The Records Room", "Sova's records room, ledgers to the ceiling, the vault's meter humming in the floor", "Elder Sova",
                "Close the door. Tea's on the stove.",
                "Here's the plain version. The Roll is people. The Count is the law. The Mark lets the law track your wrist. The Vault uses what the mark collects.",
                "We only teach children about the Roll. The rest stays in these books.",
                "The vault keeps the village warm. Every time someone obeys while wanting to refuse, the mark takes a little of that refusal. The vault turns it into heat. This has gone on for ninety winters, and I've kept the records for forty of them.",
                "The keeper is exempt so someone can read the meter without feeding it. My wrists are bare. Yours could be too. I'm offering you the books and the exemption because the meter is getting worse, and I need a successor."),
                choices: [
                    { text: "Read the meter's whole history, every winter, both books.", nextPage: 1 },
                    { text: "\"Just say the cost plainly, Elder.\"", nextPage: 2 }
                ] },
            { ...pg("Ninety Winters", "The records room, two ledgers open side by side", "Narrator",
                "You work through two pots of tea as Sova explains the figures. One column records heat supplied to the village. The other measures what the marks took from people to produce it.",
                "Each decade, the vault takes more for the same amount of heat. The Count compensates with more checks, deeper marks, and longer holds at the plate.",
                "And near the bottom of the newest page, in Sova's steady hand, a projection: the winter the toll outgrows the village. It has a date. It is not far.",
                "'At this rate, we have perhaps six winters left,' Sova says. 'After that, the vault will need more than everyone in Frostfang can give. Even total obedience won't keep us warm.'"),
                choices: [
                    { text: "The offer stands.", nextPage: 3 }
                ] },
            { ...pg("Plainly, Then", "The records room, Sova's bare wrists flat on the ledger", "Elder Sova",
                "Plainly, then.",
                "The warmth is bought with surrender. Marked people pay with the choices they don't make and the doubts they set aside. I collect it and measure it.",
                "I believed the trade was worth it. I've seen that heat keep children alive in storms that killed whole herds.",
                "Now the readings show it needs more every year. I still don't know how to stop it without freezing those same children. That's what I haven't been able to say out loud."),
                choices: [
                    { text: "The offer stands.", nextPage: 3 }
                ] },
            pg("The Keeper's Exemption", "The records room, the meter humming, the pen waiting", "Elder Sova",
                "That's the offer. My books, the meter, and the exemption. Bare wrists, but all of this becomes your responsibility.",
                "One condition. Don't publish the names from Yura's ridge post without her permission. I falsified that page to keep the Count from using her survival to justify abandoning another post. She should decide who hears the full account.",
                "The meter is climbing. Someone will have to take these books soon.",
                "What'll it be?"),
        ], [
            ch("\"Keep your exemption. I'll stay in the Count and fix it from inside.\"", "good", "ff58-stayed-in-the-count", "Sova opens the book to the exemption line and leaves her pen above it until the ink dries in the nib. Then she turns the page. 'I'll keep the meter honest until you're ready,' she says. She enters your refusal instead, dated and witnessed. 'One of very few names in my book to turn down warm hands. I find that promising.'"),
            ch("Learn the meter's readings, but leave the exemption unclaimed.", "neutral", "ff58-asked-the-meter", "Sova teaches you to read the vault's draw rates, collection costs, and projected failure date. You decline the exemption, so your status does not change. Now both of you know when the system will run short and how much choice it takes from people to keep Frostfang warm."),
            ch("Take the exemption. Bare wrists, the books, and the outside view.", "bad", "ff58-took-the-exemption", "Sova removes the mark from your intake line. That night the plate at the gate stops reading you. You can still read every page in the keeper's book, but the Count can no longer read your wrist. Sova turns the book toward you and keeps one hand on its cover."),
        ]),
        interlude("Frostfang Village", 70, "The Mark That Stays Warm", [
            pg("The Warm Room", "The vault antechamber, unnaturally warm, a presentation case on black felt", "Seal-Keeper Vess",
                "Come in, come in. Feel that? Warmest room in the village. Perk of the trade. I'm Vess. Seal-Keeper, third generation, and tonight I have the pleasant duty.",
                "By commission of the Kage himself: a holder-grade mark, one of the few kept in this room. Not the recruit's line, not the officer's script. The holder's mark.",
                "The other marks bind you to the Count. This one binds the Count to you. People pledged to your name, wrist-deep. Wherever you fall, they come. They can't not. Guaranteed rescue, for life, written into other people's arms.",
                "The Kage's words, exact: 'That one keeps walking out of my Count. Offer the anchor.' Captain Yura stands witness, as ordered. Shall we begin?"),
            { ...pg("The Plate Remembers", "The antechamber's mark plate, fogging before your wrist even touches", "Seal-Keeper Vess",
                "Rest your wrist on the plate so I can fit the mark. Oh. It's fogging again, just as the intake report described.",
                "There's a name in the frost. That name was struck from the Count before I became keeper.",
                "Wait. I need to explain something before we continue the ceremony. I looked into your first reading.",
                "The fog means this plate found a surrendered choice filed under your name, dated before you reached Frostfang.",
                "You are not the dead person whose name came up at intake. Their old account is tangled up with a missing choice from your own history.",
                "You don't have to accept the new mark. We can look at the records first, if you'd like."),
                choices: [
                    { text: "You stood in the Count to guard others. Ask what the vault holds of yours.", nextPage: 2, requireTrait: "ff4-count-protector" },
                    { text: "You came to be the strongest back. Look at what they anchor strength to.", nextPage: 3, requireTrait: "ff4-count-strongest" },
                    { text: "You came repaying a rescue. Ask who paid for yours.", nextPage: 4, requireTrait: "ff4-count-repayer" },
                    { text: "You came seeking who walked away. The plate just said a struck name.", nextPage: 5, requireTrait: "ff4-count-seeker" },
                    { text: "You left your reason blank at intake. Ask what the plate found.", nextPage: 6, requireTrait: "ff4-count-unknown" },
                    { text: "Take your wrist off the plate and ask Vess for the ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Guard's Reason, Audited", "The antechamber, your intake line copied out in Vess's file", "Narrator",
                "Vess pulls your intake copy, because you ask, and because keepers love an excuse to open files.",
                "There is your answer in Sova's hand: so the cold takes nobody on my watch. An older collection stamp sits underneath it. The stamp was already there when you arrived.",
                "Vess can't tell what happened from this page alone. He can tell that one past decision, to leave or to stop protecting someone, was cut out of the record and filed under your name.",
                "That missing decision is why the plate tied your wrist to an older account. It has no say in what you do now."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Strong Back, Audited", "The antechamber, your intake line copied out in Vess's file", "Narrator",
                "Vess pulls your intake copy, muttering about irregular stamps.",
                "There is your answer: the strongest back in the pack. An older collection stamp sits underneath it. PARTIALLY HELD.",
                "The page records one earlier decision to put down a burden or walk away. Someone removed that decision from the surviving record and filed it under your name.",
                "Why you value strength now, the ledger can't say. It only shows that the plate found an old, unpaid account connected to you."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Debt to Pay, Audited", "The antechamber, your intake line copied out in Vess's file", "Narrator",
                "Vess pulls your intake copy, and his professional patter dies halfway through.",
                "There is your answer: someone came for me once. I'm repaying it. An older collection stamp sits underneath it. PAID IN FULL.",
                "The old ledger says someone bought that rescue by surrendering a decision to leave, then filed the cost under your name. It does not identify the buyer or the person who was rescued.",
                "The entry predates your arrival in Frostfang. It gives the Count no claim over you, and it cannot tell you who to thank for the rescue you remember."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Door That Closed, Audited", "The antechamber, the fogged plate still holding its struck name", "Narrator",
                "You came looking for someone who walked away. The plate just answered your wrist with a struck name.",
                "Vess reads it twice. The name belongs to someone struck for desertion long ago, in a record made far from Frostfang.",
                "The same record says one act of leaving was surrendered under your name. Vess can't say whether the struck person is the one you're looking for, only that the two entries share an account.",
                "The plate was reading that account when it showed the old name. Finding the original record outside Frostfang is the only way to learn who left and why."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Blank Line, Audited", "The antechamber, Sova's dragged pen-line copied in the file", "Narrator",
                "Vess pulls your intake copy. Sova left a dash where your reason would have gone.",
                "Under it, in frost-script no keeper entered, is one line: PRIOR DECISION HELD IN FULL. COLLECTION PENDING.",
                "The vault is not holding every reason you could have. It is holding the record of one decision to leave, made before you reached this coast.",
                "Why you had no answer at intake, the page can't say. It only shows that the plate found a missing piece of your history and tried to attach it to the Count."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("The Exit You Chose", "The antechamber, Vess's deepest ledger open to a page that shouldn't exist", "Seal-Keeper Vess",
                "The ledger line. Yes. I looked it up after your intake, because I couldn't help it. Plates don't fog for me twice in a career.",
                "Here. One act of leaving was surrendered in your name before you reached Frostfang. The ledger doesn't say you can't leave now.",
                "It says you once walked away from a person, place, or duty, and someone removed that departure from every record. You kept moving, but history no longer recorded the choice.",
                "The dead person's struck account appears beside that charge. That is why the intake plate joined your wrist to their name. It was reading the account, not calling you the same person.",
                "The stamp is a circle cut in quarters. It belongs to Hollow Gate, not Frostfang. The ledger does not name who sold your departure or what you left. That answer is outside this village."),
                choices: [
                    { text: "The holder's mark still waits.", nextPage: 8 }
                ] },
            pg("The Anchor Offered", "The antechamber, the holder-grade mark gleaming on its felt, Yura at the door", "Captain Yura",
                "For the record, I'm ordered to witness, not to advise. So this isn't advice. It's just a soldier thinking out loud near you.",
                "That mark will force people to come for you. I know why that's tempting. I spent nineteen days on a ridge wondering whether anyone would come for me.",
                "But Dren came back because he chose to. I wouldn't repay that by taking someone else's choice away.",
                "Kael knows the plate still can't place you properly. Now he's offering you a way to command the people it can. Think about what accepting would mean."),
        ], [
            ch("Turn the plate face-down on its felt. \"Nobody gets bound to me.\"", "good", "ff70-turned-the-plate", "You set the holder's mark face-down, gently, the way you decline a drink from someone who needs to hear no. Vess exhales like a man whose scale finally balanced. Yura says nothing at all, but at the door she gives you the salute she reserves, as far as you know, for one monthly roll call, up a tower, in the snow."),
            ch("Copy the mark's terms and pledges before you refuse it.", "neutral", "ff70-copied-the-terms", "You have Vess read out every clause while you write: who binds, how deep, what the pledged give up, and when. The grammar of ownership, in the Count's own words. Then you slide the case back. 'Declined, in full knowledge.' Vess files your copy-request with a keeper's discreet approval: the only people who read terms are the ones planning to break them properly."),
            ch("Accept the holder's mark and the guaranteed rescue.", "bad", "ff70-took-the-hold", "The mark settles warm against your wrist. By morning three people you barely know are bound to answer when you call, whether they choose to or not. The registry places you among a small circle of holders, most tied to Kael's oldest allies. Yura checks the mark once, then stops looking at you."),
        ]),
        interlude("Frostfang Village", 80, "Harrow's Shortcut", [
            pg("The Forger's Bench", "An abandoned icehouse, a workbench of mark plates, Harrow in fingerless gloves", "Kite Harrow",
                "Close the door. I found an old workbench and taught myself how to copy the marks.",
                "Watch. Blank plate, frost stylus, four beats and a hold. There. That mark will pass any gate in this village. I've tested it on three different wrists.",
                "The Count isn't verifying people. It's checking a rhythm. All of this depends on a lock that I picked in an evening.",
                "So if the mark isn't the important part, what is the vault actually taking through it?"),
            { ...pg("What Drinks Through It", "The icehouse bench, a forged mark held to the lamp", "Kite Harrow",
                "This is what I think. The mark carries the moment someone wants to say no and doesn't.",
                "My copies pass the gate, but there's no real surrender behind them. The Count still accepts them. It can't tell the difference.",
                "That gives me a way into every weak point in the system. It also gives me a way to fake belonging for anyone I choose.",
                "What would you do with that? I've had a week to think about it, and I don't like any of my answers."),
                choices: [
                    { text: "\"Burn the forged plates.\"", nextPage: 2 },
                    { text: "\"Sell me the schedule instead. Choke points, rounds, timings.\"", nextPage: 2 }
                ] },
            { ...pg("What the Vault Pays Into", "The icehouse bench, a copied ledger diagram unrolled, Yura in from the cold at your shoulder", "Kite Harrow",
                "There's one more thing. I traced the vault's draw and found two lines. One stays here and provides heat. The other keeps going down.",
                "It joins the same system fed by Stormveil's Engine, Ashen Leaf's Rootfire, and Moonshadow's Mirror. Four local systems, one destination.",
                "The diagram labels the four intakes: Stormveil supplies the reasons people fight. Ashen Leaf supplies futures people were becoming. Frostfang supplies the choice to leave. Moonshadow supplies trust people placed in someone.",
                "Sova's meter verifies what Frostfang sends. The other labels come from the map.",
                "The name on that destination is Hollow Gate.",
                "The vault keeps enough power here for the warmth. The rest goes below."),
                choices: [
                    { text: "Yura sets her hand flat on the map.", nextPage: 3 }
                ] },
            { ...pg("What Went Down", "The icehouse, Yura's bare wrist flat on the lower line of the pipe map", "Captain Yura",
                "Say that again. The rest goes down that line?",
                "So some of what the Count took from us wasn't even being used to heat the village.",
                "Dren fed it for years before he left. The seal tried to take Kessa's refusal too, but she escaped before it could finish.",
                "He came back for me without a mark. They called him a deserter and erased the proof that he chose to come back.",
                "Damn Kael. He knew what Dren had done."),
                choices: [
                    { text: "Harrow rolls the map shut.", nextPage: 4 }
                ] },
            { ...pg("Not Snow", "The icehouse, Harrow rolling the diagram shut, careful as a bandage", "Kite Harrow",
                "And that lower pipe runs straight to Hollow Gate.",
                "The warmth here is real, but it's only part of what the system takes. Most of it goes somewhere else.",
                "Kael can explain the rest. I only found the line."),
                choices: [
                    { text: "Hear the rest of what she holds.", nextPage: 5, trait: "ff80-named-hollow-gate" }
                ] },
            pg("The Locksmith's Choice", "The icehouse, the stove's one honest flame", "Kite Harrow",
                "Every village treats me as useful but outside. The problem is, nobody is really outside a system that controls the heat.",
                "If I burn this bench, I lose the best leverage I've ever had against the Count. If I keep using it, I start deciding who gets to belong and what that should look like.",
                "My mother was a forger. She told me never to sell the thing that proves who you are. She died with a license anyway.",
                "The decision is mine, but I want your opinion before I make it."),
        ], [
            ch("Feed the plates to the stove with her, one by one, and witness it.", "good", "ff80-burned-the-plates", "She stacks them herself and feeds the first one in, and the frost-script burns away with a sound like a sigh let go. 'There goes retirement plan four.' The last plate stays between her fingers until the metal warms. Then she feeds it in and waits beside you until every false mark is gone."),
            ch("Buy the vault's delivery schedule and leave the bench question hers.", "neutral", "ff80-sold-the-schedule", "Straight trade, invoiced. The Count's plumbing on paper: intake rounds, plate rotations, the vault's draw windows, every choke point timed. She keeps the bench and you keep the map. The fee is real and the receipt is real, and Harrow visibly relaxes inside the honesty of a normal transaction. 'Business,' she says, stamping it. 'The one language on this coast with no hidden verses.'"),
            ch("Tell her to keep the bench live. An unsworn key-holder is useful.", "bad", "ff80-kept-her-list", "She looks at you for a long moment, recalculating something she'd priced as settled. 'A counterfeiter on retainer. Efficient.' The bench stays. The skill stays sharp. And in her book, next to your unpriceable name, she enters her first hedge against you: a list of which gates your rhythm opens, kept current, just in case. You taught her that. She learns fast."),
        ]),
        interlude("Frostfang Village", 88, "The Long Lanterns", [
            { ...pg("Ridge Post Four", "The north ridge at dusk, lantern crates in the snow, a storm wall building", "Captain Yura",
                "Ridge post four. I know. It's the only place with the right sight lines. Dren would probably think that was funny. I'm not there yet.",
                "A real whiteout is coming in two bells. We'll string his lanterns along the search lines. A volunteer will walk out without a mark, and we'll find them with the lamps and our own eyes.",
                "Kael's wardens will record the whole drill. Good. I want the Count to see it work.",
                "Dren designed these lamps, and we called him a deserter. If the relay holds, he was right and we were wrong. My hands are shaking, so check my knots."),
                choices: [
                    { text: "Half-wick spacing again?", nextPage: 9, requireTrait: "sf-ff-split-lanterns" },
                    { text: "The lower-road map is in the top crate.", nextPage: 10, requireTrait: "sf-ff-kept-stove" },
                    { text: "Show me the first stake.", nextPage: 1 }
                ] },
            pg("The Volunteer", "The lantern line's first stake, Sergeant Essen shrugging off his coat's rank pins", "Narrator",
                "Sergeant Essen volunteers before Yura finishes asking. He sets his rank pins on the crate and rolls up his sleeve. His wrist is bare. The searchers will have to find him using the lanterns.",
                "'My brother spent half a night freezing at his post because nobody logged his orders,' he says. 'If these lamps can keep that from happening again, I'll help test them.'",
                "He checks the wind, notes his drift line like the professional he is, and walks into the building storm without looking back.",
                "The white takes him in four steps."),
            { ...pg("The First Line Fails", "The search line, lanterns guttering, oil thickening in the cold", "Narrator",
                "The first lantern line goes up fast and dies faster. The oil thickens in the deep cold. Wicks drown. The third and fifth lamps gutter out inside ten minutes, and the line has holes in it, and a man is in the white counting on the line having no holes.",
                "Yura works down the stakes, relighting, cursing in drill cadence, which is the worst sound you have ever heard her make.",
                "It's Sova who steadies it. She arrives unasked, bare wrists in the cold, reads Dren's schematic once, and starts chanting: the intake litany, repurposed, four beats and a hold, pacing the wick-trimmers down the line. The checked are counted. Trim. The counted are kept. Light. The kept are warm. Move.",
                "The litany that ran the gate now runs the rescue, and the lamps begin to hold."),
                choices: [
                    { text: "\"I won't press you about the ridge again. I'm sorry.\"", nextPage: 3, requireTrait: "yura-fear", trait: "ff88-repaired-trust" },
                    { text: "Stitch DREN COLDEWE onto the beacon banner before the second line goes up.", nextPage: 4, trait: "ff88-named-the-walker" },
                    { text: "Take the dead lamps' stakes and hold the line's gap yourself.", nextPage: 4 }
                ] },
            { ...pg("Fear, Retired", "The third stake, the two of you relighting the same lamp", "Captain Yura",
                "All right. Don't ask it again.",
                "You kept quiet about the floorboard through a month posted south. I noticed. Lift the wick.",
                "Your south posting is over. I'll decide the rest after we find Essen.",
                "Hold the wick. I'll keep the rhythm. Lamp's lit. Next one."),
                choices: [
                    { text: "Down the line. Four beats and a hold.", nextPage: 4 }
                ] },
            { ...pg("Nineteen Minutes", "The full relay burning down the ridge, the search moving lamp to lamp", "Narrator",
                "The second line holds. The searchers move from lamp to lamp, keeping each light just in sight of the next, as Dren's plans direct. They keep calling Essen's name through the wind.",
                "They find Essen at the fourth spur, upright, following the drift line he marked before the walk, half a ridge off from where the Count's models placed him. The models assume an unbriefed casualty. Essen followed a plan the searchers knew.",
                "Nineteen minutes, whiteout to handshake. Yura calls it aloud twice, her voice cracking on the second call, and nobody in the line pretends not to hear it: 'Found! By choice, found!'",
                "Above the search line, the wardens record the lamp positions and the time of the rescue. They have seen Essen return without a mark to guide the searchers."),
                choices: [
                    { text: "The storm passes. The Count arrives.", nextPage: 5, trait: "ff88-relay-held" }
                ] },
            { ...pg("The Drill Log", "The ridge at storm's end, the drill log open on a lantern crate", "Captain Yura",
                "Numbers first. One unmarked volunteer in whiteout conditions, found in nineteen minutes. No draw from the vault and no plate reading. We used lamp oil, wick cord, and people.",
                "This doesn't replace the wall or heat the barracks. It proves one thing: the vault is not the only way to bring someone home.",
                "The wardens recorded the drill on Kael's own instruments.",
                "It worked. Now we decide what to do with the proof."),
                choices: [
                    { text: "Set Dren's letter beside the drill log. The walker and the walk, together.", nextPage: 6, requireTrait: "ff65-saved-the-letter", trait: "ff88-nineteen-minutes" },
                    { text: "Ask Yura to lay Dren's letter by the log. She's carried it since the quarry.", nextPage: 6, requireTrait: "ff65-gave-yura-the-letter", trait: "ff88-nineteen-minutes" },
                    { text: "Let the log stand on its own numbers.", nextPage: 11, trait: "ff88-nineteen-minutes" }
                ] },
            { ...pg("The Walker and the Walk", "The lantern crate, the unsent letter flat beside the log", "Captain Yura",
                "His letter made it back to this ridge, and now it's beside the log showing that his lanterns worked. Give me a second.",
                "Kael could take the design and claim the Count created it. The letter proves Dren did. The man they erased built the rescue they said was impossible.",
                "Together, these prove the Count was wrong about him. If it was wrong about Dren, it can be wrong about other things.",
                "Who carries them to the vault?"),
                choices: [
                    { text: "\"You called his Roll for twelve years. Let me answer for him at the vault.\"", nextPage: 11, requireTrait: "yura-trust", trait: "ff88-exit-proof-ready" },
                    { text: "\"Your captain earned this, and I can still be the one to carry it. Let me.\"", nextPage: 11, requireTrait: "yura-respect", trait: "ff88-exit-proof-ready" },
                    { text: "\"We're not square yet. I know. Let me carry him the rest of the way anyway.\"", nextPage: 11, requireTrait: "ff88-repaired-trust", trait: "ff88-exit-proof-ready" },
                    { text: "\"Stand back. This is Dren's and yours. You answer his Roll. I'll hold the stair.\"", nextPage: 7, requireTrait: "yura-trust", trait: "ff88-exit-proof-deferred" },
                    { text: "\"Stand back. This is Dren's and yours. You answer his Roll. I'll hold the stair.\"", nextPage: 7, requireTrait: "yura-respect", trait: "ff88-exit-proof-deferred" },
                    { text: "\"Stand back. This is Dren's and yours. You answer his Roll. I'll hold the stair.\"", nextPage: 7, requireTrait: "ff88-repaired-trust", trait: "ff88-exit-proof-deferred" },
                    { text: "Keep the letter in your own kit. Let that be your part.", nextPage: 8 }
                ] },
            { ...pg("You Hold the Stair", "The lantern crate, Yura folding the letter into her breast pocket, drill fashion", "Captain Yura",
                "Good. I'll speak for Dren, and you hold the stair. That's the assignment.",
                "I've called his name for twelve years. Tomorrow I get to say it to the man who erased him, with Dren's own letter in my hand.",
                "I crossed out the formal opening. Kael already knows my rank.",
                "Dren came back after the Count struck his name. He chose to. I'll say it once, and then Kael answers me."),
                choices: [
                    { text: "Let it be hers to answer.", nextPage: 11 }
                ] },
            { ...pg("Kept, Not Carried", "The lantern crate, the letter going back into your kit, Yura watching", "Captain Yura",
                "Keep it, then. I won't pretend that settles anything.",
                "Dren wrote what he chose. Kael changed it into desertion. That page is the only answer in Dren's own hand.",
                "I'll keep calling his name at the Roll. The letter in your kit is still Dren's, whatever you do with it.",
                "After the vault, we have this argument again."),
                choices: [
                    { text: "Keep the letter. Walk down.", nextPage: 11, trait: "ff88-unfinished-answer" }
                ] },
            { ...pg("Half Wicks", "Ridge post four, Yura checking three lamps against one oil mark", "Captain Yura",
                "Same spacing as the blue-ice search, full wicks this time. The cooks knew where the wind dropped sacks. The watch knew which shelf would break first.",
                "Splitting the jar made both crews complain, then search together. The pages came back through both sets of hands.",
                "Check lamp three. It ran low before, and I want your hand on it before Essen walks out."),
                choices: [
                    { text: "Check the wick, then take the third stake.", nextPage: 1 }
                ] },
            { ...pg("The Flour Map", "Ridge post four, the lower-road drift map pinned inside a crate lid", "Captain Yura",
                "That lower-road map found the lee exactly. Keep it pinned where both crews can see it.",
                "Waiting for daylight brought more searchers than I had places to put them. I still hate giving weather time to move.",
                "Tonight we don't wait. Mark Essen's drift line here, where the kitchen crew found the lee."),
                choices: [
                    { text: "Mark the lee. Then set the first stake.", nextPage: 1 }
                ] },
            pg("What Enters the Roll", "Dawn on ridge post four, the lanterns still burning past need", "Narrator",
                "The storm dies at dawn. Nobody puts out the lanterns yet; their light still marks the route down the ridge.",
                "Essen fastens his rank pins and takes the post at the end of the line. Sova sits on a crate, warming her hands inside her sleeves and humming the rhythm the searchers used.",
                "Yura walks the line, retensions a loose stake, then turns around at the final lantern and starts the inspection again.",
                "The wardens' report is already moving down the mountain. Yura reaches the final stake, turns back toward the still-burning line, and leaves her own report blank."),
        ], [
            ch("Wake the wall rows. Let the village see the relay burning from the gates.", "good", "ff88-woke-the-rows", "By daylight the wall watch has gathered on the ridge. Essen calls the return route himself. Hundreds answer the chant and see the bare wrist he raises at the final stake. When a sentry asks who ordered the relay, Yura looks down the line and says, 'Everyone who came.'"),
            ch("File the drill log properly: witnessed, countersigned by Sova, entered.", "neutral", "ff88-logged-the-drill", "You and Yura write it up drill-flat: times, spacings, zero draws, found by choice. Sova scratches out anomaly, writes voluntary relay, and countersigns. The entry reaches the records room before the wardens' account, in a format Kael's own clerks must preserve."),
            ch("Let the wardens' report run ahead, unchallenged, straight to Kael.", "bad", "ff88-baited-the-wardens", "You add nothing to the wardens' account. Their seals, their times, and their report of Essen standing unmarked reach Kael before Yura files a word. She watches the packet leave and says that using the Count's chain still means trusting where it ends."),
        ]),
        interlude("Frostfang Village", 92, "Witnesses", [
            pg("The Cairn Road", "The vault road at dawn, cairns marking the miles, figures waiting", "Narrator",
                "Word of your planned visit to the vault has spread through Frostfang. By the time you set out to confront Kael, people are already waiting along the road.",
                "Figures wait along the cairn road. Not a formation. Just people at familiar intervals, some holding lanterns copied from Dren's recovered pattern, others carrying unfinished frames and wick cord.",
                "They came prepared to test a rescue line again if the vault closes its doors.",
                "At the first cairn, a runner from the glacier waits with a message."),
            { ...pg("The Camp's Message", "The first cairn, the Pale Pack Runner with frost in her hood", "Pale Pack Runner",
                "Message from Marrin. She made me memorize it exactly.",
                "'If the vault breaks tonight, the Pack comes down at the next bell. We'll answer one roll call in the forecourt by choice. Not because we forgive the Count. Because this village needs to hear what a real answer sounds like.'",
                "I brought the lantern pattern back to the glacier. Marrin's crews have been testing it on our own routes. Some people here saw another test. Others only have our word and Dren's drawings.",
                "Good luck down there."),
                choices: [
                    { text: "\"Dren's letter goes to the vault tonight. Carried by the one he came back for.\"", nextPage: 2, requireTrait: "ff88-exit-proof-deferred" },
                    { text: "Show her the drill log's numbers first.", nextPage: 3, requireTrait: "ff88-logged-the-drill" },
                    { text: "\"Walk the road with us as far as the wall.\"", nextPage: 4 }
                ] },
            { ...pg("The Letter Walks Point", "The cairn road, Yura with the letter squared in her breast pocket", "Captain Yura",
                "You were right to leave the letter with me.",
                "His letter and his lantern plans are enough. The Count called Dren a deserter. Tonight I get to show Kael what Dren actually did.",
                "Walk me to the stair. After that, I speak for him and you hold the door for everyone behind us.",
                "Clear? Good. Let's go."),
                choices: [
                    { text: "Walk her to the wall.", nextPage: 4 }
                ] },
            { ...pg("The Log, Read Aloud", "The first cairn, the drill log open between mittened hands", "Pale Pack Runner",
                "Read it to me slowly. I need to memorize the numbers.",
                "Nineteen minutes. No vault draw. No plate reading. Sova countersigned it. Say that part again. Her signature matters to people on the glacier.",
                "The Count says a mark is the only proof that someone belongs here. This log proves people can choose each other without one.",
                "I'll know it by the next cairn. The whole camp will know by the bell."),
                choices: [
                    { text: "Walk on to the wall.", nextPage: 4 }
                ] },
            { ...pg("The Slow Count", "The wall checkpoint, Sergeant Essen counting the road's walkers with theatrical care", "Narrator",
                "The checkpoint at the wall should stop everything tonight: irregular movement, unlogged lanterns, a crowd with no rotation orders.",
                "Sergeant Essen stands the post. He counts the walkers one at a time, aloud, with enormous procedural dignity, and the tally keeps, somehow, arriving at numbers that require no report. 'Eleven,' he announces, of forty. 'Well within norms.'",
                "As you pass, Essen keeps his eyes forward. 'The latch on the great hall door is still faulty, by the way. A crowd could walk right through. I've filed a report. No one has come to fix it.'",
                "Then he lowers his voice. 'My brother volunteered for the ridge tonight. Took a lantern instead of waiting for a plate reading. Whatever happens down there, I wanted you to know that.'"),
                choices: [
                    { text: "\"Stitch your brother's name next to Dren's on the banner when this is done.\"", nextPage: 5, requireTrait: "ff88-named-the-walker" },
                    { text: "Return his count, straight-faced: \"Eleven. Well within norms.\"", nextPage: 6 }
                ] },
            { ...pg("The Banner of Walkers", "The checkpoint, the beacon banner unrolled a hand's width", "Narrator",
                "You show him the banner's corner: DREN COLDEWE, stitched in wick-cord, and beneath it, room left deliberately bare.",
                "Essen looks at the empty space for a long moment, counting the names that could live there. His brother's. His own. Every walker the Count ever filed as a number.",
                "'Stitching's poor,' he says at last, thickly. 'Whoever did that corner pulled the cord too tight. I'll redo it. I'll... we'll need a bigger banner, is what we'll need.'",
                "He waves you through without asking for a wrist check."),
                choices: [
                    { text: "The last cairn.", nextPage: 6 }
                ] },
            pg("The Keeper on the Road", "The last cairn before the vault stair, Sova waiting with the Count book bound for travel", "Elder Sova",
                "I've spent forty years waiting at plates. Tonight I'm waiting for you.",
                "The whole book comes with us: ninety winters, the projection, and the drill log. If you're going to argue with Kael, you need the records. If you mean to break the vault, you need its keeper to testify about why.",
                "I have one request. The litany was mine before the gate used it. If any version survives, keep the one that helped light the lamps.",
                "The stair is open and the meter is almost past its last mark. Let's go."),
            pg("The Rows Answer", "The vault forecourt, the White Silence in its rows, lanterns gathering behind", "Captain Yura",
                "Listen to them answering the roll. Halde's on the lower road. Vessik's out on the snowfield. Tarn answered from the wall.",
                "I called ten names on the way here. By the last one, the whole slope was answering. No order and no mark. They heard their names and chose to answer.",
                "They're answering for the people who were frozen here too, including those we haven't freed yet. Essen brought his crew and the wall watch. The Pack is waiting on the ridge.",
                "Everyone here is going down that stair with you in one way or another. Decide how you want to lead them."),
        ], [
            ch("Walk down slow and open, every lantern welcome behind you.", "good", "ff92-called-the-camp", "You take the stair at drill pace with the forecourt's light behind you. Sova refuses the keeper's order to seal the meter, Essen leaves the faulty latch open, and the first wall squad answers Yura's roll without presenting their wrists. With that resistance behind you, the vault must face people who came by choice."),
            ch("Go down with Sova's book and Yura's kit: keeper, captain, case.", "neutral", "ff92-took-her-terms", "Sova carries the Count book. Yura carries her signed account of the ridge and quarry. You carry the records available from the road. The forecourt holds while the three of you take the stair. Kael will have the keeper, the captain, and the procedure in front of him at once. Yura checks the door and gives the order to move."),
            ch("Send a sealed sentry to warn Kael that you are coming with the records.", "bad", "ff92-sent-the-warning", "The sentry carries your message into the vault. You hear the lower door lock behind him. Kael now knows you are coming, and has time to prepare."),
        ]),
    ],
    "Moonshadow Village": [
        interlude("Moonshadow Village", 20, "The Unsworn", [
            pg("Bought and Sold", "The whisper market after curfew, Harrow at a booth counter with receipts fanned like a card hand", "Kite Harrow",
                "There you are. Sit down. I bought you a drink.",
                "I also bought some information. Your real name cost forty ryo. Your usual routes cost thirty. The fact that you trusted someone here with something important cost sixty.",
                "That's one hundred thirty ryo for a useful picture of you. I've paid less for war plans.",
                "A client hired me to build files on your whole intake class. They pay extra to learn who you trust. You should know someone is buying that information."),
            { ...pg("The Going Rates", "The booth, Harrow tapping the receipts in order", "Kite Harrow",
                "Here's the strange part.",
                "A stolen name has a price. A name someone says openly, by choice, doesn't. Once everyone knows it freely, nobody can sell access to it.",
                "This village depends on people treating secrets as property. It doesn't know what to do with a truth nobody owns.",
                "That's all I wanted you to understand."),
                choices: [
                    { text: "\"You've told me what you're doing. I'll trust you with that much.\"", nextPage: 2 },
                    { text: "Tell her you want to know why her client is interested in you.", nextPage: 2 },
                    { text: "\"An appraiser who tips her subjects is a bad appraiser.\"", nextPage: 2 }
                ] },
            pg("The Blank Listing", "The booth, the market's lanterns doubling in the canal", "Kite Harrow",
                "I tried to finish your file, but something doesn't add up.",
                "I found your name and your habits. What I couldn't find is the thing you'd give up everything to keep. It doesn't look hidden. It looks like someone took it before you got here.",
                "I filed the page as incomplete. The client only pays half for that, and I'm fine with it.",
                "If you ever learn what was taken, bring it to me. I'll tell you what it is, and I won't try to buy it."),
        ], [
            ch("Walk her through the market openly, her receipts in your hand.", "good", "ms20-respected-the-unsworn", "You walk Harrow through the market with the receipts in your hand. Dealers notice the pair of you. At the gate, she glances back. 'They'll assume we're working together now. I don't mind if you don't.'"),
            ch("Buy your own name back from her at her cost. Business is business.", "neutral", "ms20-measured-the-unsworn", "Harrow takes forty ryo and gives you the receipt. She strikes your name from the page she owes her client. 'I can remove my entry,' she says. 'That doesn't stop them buying it elsewhere. Keep this receipt in case they try to use my copy.'"),
            ch("Tell her you won't trust someone paid to investigate you. Leave.", "bad", "ms20-dismissed-the-unsworn", "You leave before she can answer. Later, you find her card at your quarters with a short note: 'If you change your mind, I still have the receipts.'"),
        ]),
        interlude("Moonshadow Village", 30, "One True Thing", [
            pg("The Verified Truth", "Nyx's stall over the dye canal, one lamp, one slip of paper face-down", "Nyx",
                "Sit. You get the stool that doesn't wobble.",
                "I have something you should know. The trainee who spars with you and asks about your day? They file a report on you twice a week. Paid in meals.",
                "The proof is the slip on the counter, face-down. Their handwriting gets worse every time they mention you being kind to them. I think they feel bad about it, and they still take the pay.",
                "Whoever is buying signs with a quartered circle. I've seen the same mark on other purchases, mostly records of who trusts whom."),
            pg("The Cost Price", "The stall, Nyx flipping a blank brass token, catching it without looking", "Nyx",
                "I'm charging cost because I don't like the client.",
                "I only sell things I've verified. If I sell one lie, nothing else from this stall can be trusted.",
                "So if I ever tell you something and don't charge for it, that doesn't make it less true. Everything that leaves this stall has been checked.",
                "Tonight is business. I'm just making that clear now."),
            pg("The Left Shutter", "The stall after closing bell, one shutter swollen in its frame", "Nyx",
                "Hold the bottom edge while I set the pin. If you lift, it sticks. If you let go, it takes my thumb.",
                "The kettle goes under that leak. No, the other leak. You learn quickly for someone I just warned about a paid informant.",
                "And you're helping me close up anyway.",
                "I haven't decided what that means. Keep holding."),
            pg("What the Stall Holds", "The stall, the lamp low, the canal talking to itself below", "Nyx",
                "People ask why I do this. The short answer is that I check what I sell, and most dealers don't bother.",
                "I don't sell rumors. I don't sell comforting lies. I can't buy back the thing I sold during a bad winter, so I built this stall and learned to keep better records.",
                "That's more than I usually tell a customer.",
                "Now tell me what kind of arrangement you want with me."),
        ], [
            ch("\"Partners. Your verification, my reach. Profits and risks split even.\"", "good", "nyx-partner", "She flips the brass token once and lets it lie where it lands. Then she writes a contract on a verification slip, three lines, even on both sides, and signs it with her working name. 'Partners,' she says. 'The stall's first.' She puts the token in a drawer and shuts it."),
            ch("\"A customer. The reliable kind. Standing order on true things.\"", "neutral", "nyx-respect", "Nyx registers you as a regular customer and quotes a fair rate. From now on, she verifies every piece of information she sells you three times. The arrangement is dependable and strictly professional. Neither of you owes the other anything beyond the agreed price."),
            ch("\"I'll take the trainee's reports themselves. Copies. Weekly.\"", "bad", "nyx-suspicion", "Nyx's face goes still, then smooth. 'Counter-surveillance. Standard product.' She names a price. The reports arrive every week. She never asks why you chose to read the trainee instead of speaking to them. After that, her own answers to you get shorter."),
        ]),
        interlude("Moonshadow Village", 42, "The Cold Pipe", [
            pg("The Listening House", "The Listening House roof at courier hour, booths glowing below like coals", "Narrator",
                "The courier drop is routine: wait on the Listening House roof, take the sealed packet at the bell, ask nothing. Moonshadow assigns its ranked couriers the boring nights first, to see what they do with boredom.",
                "What you do is feel the roof hum.",
                "Under the tiles, a copper pipe runs warm-cold-warm, like something swallowing in intervals. It runs from the confession booths below, down through the house's bones, toward the canal. Toward the tower. You put your palm on it, and at the next swallow, the cold pulls.",
                "The pulse matches the booth below: each confession makes the pipe pull toward the tower.",
                "A woman steps out looking lighter. Her neighbor greets her by name. She stares until he points to the window box they share.",
                "She waters one plant, listens to him speak, then waters it again. Muddy water spills over the sill. Neither of them mentions it.",
                "The pipe turns cold at each hesitation. It cannot tell you what the booth took, only that the loss followed the confession."),
            pg("Following It Down", "The house's maintenance crawl, the pipe descending in the dark", "Narrator",
                "You leave the courier post to follow the pipe through a maintenance hatch.",
                "The pipe drops through the Listening House like a root, past the booths, where each confessional's floor drain feeds it, past a junction chamber where nine pipes from nine houses converge, and down, always down, running colder as it goes, toward the underdark of the canal and the tower's foundations.",
                "At the junction, a maintenance ledger hangs on a nail, unhidden, banal as a mop: flow rates by booth, by hour, by type. Grief runs richest. Confession of debt runs thin. First-trust runs rarest, marked at a premium.",
                "Somebody meters this. Somebody has always metered this. The booths are not listening rooms with a flaw. They are collection points with somewhere comfortable to sit."),
            pg("The Drain's Direction", "The junction chamber, nine pipes breathing cold", "Narrator",
                "The nine pipes meet in a line toward the tower. Below that junction, an older pipe branches downward. You cannot see where it ends. A worn quartered circle is stamped beside its valve.",
                "Every booth feeds the tower, and this older pipe carries part of the flow below it. The argument upstairs is about who controls the records, while the system keeps sending them somewhere else.",
                "The courier bell rings above, twice, annoyed.",
                "The next courier bell will bring someone looking for you. You have time to copy the ledger or leave it."),
        ], [
            ch("Report the pipe to the watch, in writing, signed with your rank.", "good", "ms42-reported-the-booths", "You report the woman's confusion after her confession, the matching pulse in the pipe, and the two outlets beneath the junction. The watch clerk stamps your copy and sends the report to the tower. Your name is on it."),
            ch("Copy the flow ledger before returning to the courier post.", "neutral", "ms42-kept-it-quiet", "You copy nine houses' intake rates into your own cipher and return the ledger to its nail. Now you can track which districts grieve, where trust is being copied, and when the tower collects the most. You leave without alerting the watch, and the pipe continues running behind you."),
            ch("Invent a confession. Check whether the pipe accepts it.", "bad", "ms42-tested-the-drain", "You give the booth a convincing grief that never happened. The pipe takes it and runs warm. You check the meter twice: the system recorded your act of surrender even though the story was false. It measures the choice to entrust something, not whether the confession is true."),
        ]),
        interlude("Moonshadow Village", 58, "Iro's Cut", [
            { ...pg("Below the Auction Floor", "The archive below the auction cellar, shelf after shelf of held files, Iro with a lamp", "Shade Master Iro",
                "Watch the third step. This is the archive. It holds intake files, confessions, and purchased records from the last forty years.",
                "You've been near the collection pipes under the Listening House. I'll show you where those records end up.",
                "The village takes things from people, and I profit from it. My share is the third largest after the tower.",
                "That's why I'm showing you this. I have an offer."),
                choices: [
                    { text: "\"You watched me test the drain. That's why I'm getting the tour.\"", nextPage: 1, requireTrait: "ms42-tested-the-drain" },
                    { text: "Hear the offer standing.", nextPage: 2 }
                ] },
            { ...pg("The Fed Lie", "The archive, Iro's smile arriving before his answer", "Shade Master Iro",
                "I know about the false confession in booth six. The meter accepted it as real.",
                "Very few people know how to read that meter. I ran the same test when I was your age and got the same result.",
                "That was when I stopped treating the system as sacred. I kept the false reading in a private ledger and told myself that was caution.",
                "You're one of the few people I have seen test the meter instead of accepting its label. That's why you're getting the offer."),
                choices: [
                    { text: "The offer.", nextPage: 2 }
                ] },
            { ...pg("A Shelf of One's Own", "The archive's private row, one empty shelf with a fresh brass nameplate", "Shade Master Iro",
                "The shelf would be yours. Your file goes under your key, and you get access to other people's records. Yes, that second part is where the trouble starts.",
                "The fee starts at one new secret a month, yours or someone else's. Then the archive raises the quota whenever the account looks settled.",
                "Several powerful clients took the deal, including Kages. Intelligent people are very good at explaining why they deserve a key.",
                "You can protect your file by helping collect everyone else's, or leave it in hands you don't trust. I told you it was an offer. I didn't call it a good one."),
                choices: [
                    { text: "Decide at the shelf.", nextPage: 3 }
                ] },
            pg("The Waiter's Honesty", "The archive, the nameplate blank and shining, Iro's lamp steady", "Shade Master Iro",
                "Before you answer, you should know how it worked out for me.",
                "After forty years I owe more secrets than I can repay without feeding it my neighbors. If I leave, the files under my key become leverage against me.",
                "The shelf protected me. Then it trapped me. Nobody explained the second part.",
                "There. Full disclosure, delivered decades late. What do you want to do?"),
        ], [
            ch("\"Keep the shelf. I won't trade other people's secrets for my safety.\"", "good", "ms58-refused-the-shelf", "Iro sets the key back on its hook. 'Very few people refuse,' he says. 'Most come back when they find out what's in their file. I hope you don't have to.'"),
            ch("Note the shelf's terms in full and leave the plate blank. For now.", "neutral", "ms58-took-note", "You copy every clause, including the fee, interest, editing rights, and what happens if you leave Moonshadow. You do not sign, so you gain no access and take on no debt. Iro leaves the nameplate blank and says the offer remains until the shelf is reassigned."),
            ch("Take the key. The archive reads everyone. Better to be the reader.", "bad", "ms58-took-the-shelf", "The key warms in your pocket after the first day. At month's end you pay the fee with a stranger's secret, small enough to excuse. Iro accepts it without comment and raises next year's rate in the same motion. When he shakes your hand, he means it. You are colleagues now."),
        ]),
        interlude("Moonshadow Village", 70, "Your File", [
            pg("Through a Locked Door", "Your quarters, the bolt untouched, a file square on the desk that was empty at dusk", "Narrator",
                "The room was sealed. You've long since learned to seal it properly. The seals are intact. The file is on the desk anyway, squared to the edges, patient.",
                "Your working name is on the spine, in registry hand. Below it, in different ink: INTAKE RECORD, COMPLETE COPY, WITH ANNOTATIONS.",
                "Delivered the way the cipher scroll was delivered, seasons ago. Which is to say: as proof of reach, wrapped around a message.",
                "You are, whatever else tonight brings, finally about to learn what Moonshadow has been writing about you since the Mirror looked you up."),
            { ...pg("The Priced Choices", "The desk, the file open, every page ruled in two columns: EVENT and VALUE", "Narrator",
                "The file records the Moonshadow choices its clerks could verify and assigns a value to each. Events they could not observe are left as explicit gaps rather than filled in as fact.",
                "The same buyer paid for the updates. Their mark is a circle divided into four parts, repeated on reports filed since your intake.",
                "They are using your past choices to predict what will pressure you, tempt you, or make you cooperate.",
                "The last page is labeled NEXT. It is blank, but the buyer has already paid to receive a report on whatever you choose now."),
                choices: [
                    { text: "You trade nothing that guards others. Read what they made of that.", nextPage: 2, requireTrait: "ms4-trade-protector" },
                    { text: "You trade for the strongest hand. Read what they made of that.", nextPage: 3, requireTrait: "ms4-trade-strongest" },
                    { text: "You trade to buy something back. Read what they made of that.", nextPage: 4, requireTrait: "ms4-trade-redeemer" },
                    { text: "You don't sell. You listen. Read what they made of that.", nextPage: 5, requireTrait: "ms4-trade-listener" },
                    { text: "You never knew what you had left. Read the intake annotation.", nextPage: 6, requireTrait: "ms4-trade-unknown" },
                    { text: "Skip to the oldest page. Start where the buying started.", nextPage: 7 }
                ] },
            { ...pg("The Guardian, Priced", "The file, your intake answer annotated in the margin", "Narrator",
                "Your intake answer sits at the file's head: nothing that keeps someone else safe. That's not for sale.",
                "The annotation beside it, in the buyer's clerk-hand, is one line: GUARDIAN CLASS. VALUE ACCRUES TO DEPENDENTS. ACQUIRE DEPENDENTS.",
                "ACQUIRE DEPENDENTS is underlined twice.",
                "Below the note is a list of people you have helped. The buyer has been collecting information on each of them so they can choose the strongest pressure point."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Buyer, Priced", "The file, your intake answer annotated in the margin", "Narrator",
                "Your intake answer sits at the file's head: whatever buys the strongest hand in the room.",
                "The annotation beside it reads: BUYER CLASS. WILL LEVERAGE. EXTEND CREDIT FREELY.",
                "They decided ambition was the easiest way to control you. The file shows that they arranged many of the opportunities you found in the village, expecting you to accept help and build a debt to them.",
                "The next note says to extend credit until the buyer has a demand worth calling in."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Redeemer, Priced", "The file, your intake answer annotated in the margin", "Narrator",
                "Your intake answer sits at the file's head: anything, to buy back something I lost.",
                "The annotation beside it is the coldest line a clerk ever ruled: REDEEMER CLASS. LOCATE THE LOSS. HOLD IT. NAME THE PRICE AT NEED.",
                "They have kept a search open for what you lost. They do not intend to return it freely. They want to keep it until they need something from you, then set a price they know you will struggle to refuse.",
                "The search log ends with a recent lead marked PROMISING."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Ear, Priced", "The file, your intake answer annotated in the margin", "Narrator",
                "Your intake answer sits at the file's head: I don't sell. I listen.",
                "The annotation beside it reads: EAR CLASS. RARE. DO NOT ACQUIRE. CULTIVATE.",
                "They did not try to buy you. Instead, they planted selected secrets where they knew you would hear them. By controlling which facts reached you, they hoped to shape what you believed about the village.",
                "The file is proof that you were given a carefully edited version of Moonshadow. The oldest page shows what they left out."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Open Answer, Priced", "The file, Iro's dragged pen-line reproduced in facsimile", "Narrator",
                "Your intake answer sits at the file's head, in Iro's copied hand: I don't know what I have left to trade. His pen-drag is reproduced in the margin, annotated with a collector's care.",
                "The buyer's clerk has ruled one line beneath it: SUBJECT CORRECT. PRINCIPAL ASSET PREVIOUSLY ACQUIRED. SEE FOUNDING ENTRY.",
                "The note confirms that something was taken from your history before you arrived in Moonshadow. The buyer treats the missing record as property they already own.",
                "The oldest page explains what was taken and who paid for it."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Founding Entry", "The file's last leaf, older than every other page, in no registry's hand", "Narrator",
                "The oldest page is not Moonshadow paper. It is older, water-stained, and the hand on it belongs to no clerk this village ever employed.",
                "It is a bill of sale. The item sold was the record of a trust you once placed in someone. The seller's name is almost familiar. The buyer used the same quartered-circle mark. The payment was your safe passage out of an unnamed place.",
                "Someone traded away that shared history to get you out. The file does not say whether they had another choice.",
                "What was taken is the record of that trust, and of the person you gave it to. The registry now treats that gap in you as something it owns.",
                "A recent mark at the bottom says the account is still open. The buyer intends to keep recording your choices. The blank NEXT page is a threat, and it is also proof that they do not know what you will choose."),
                choices: [
                    { text: "One field near the top you never let yourself read.", nextPage: 8 }
                ] },
            { ...pg("The Name Not Chosen", "The file's front leaf, one field the intake clerk left open on your first night", "Narrator",
                "There is a line near the top of the file you have never once let yourself read. The day name is filled, in Iro's hand, from your first hour on the canal. Below it sits the other line.",
                "The second line is labeled NIGHT NAME. It does not say blank. It says RESERVED.",
                "Beside it, a clerk working for the buyer wrote: PENDING SELF-VALUATION.",
                "They want you to choose a night name because it would tell them how you define yourself. They could then use that identity to classify you and decide how to pressure you. The choice has not happened yet, so the line remains empty."),
                choices: [
                    { text: "Write no night name at all. No one gets that handle, the buyer least of all.", nextPage: 9, trait: "ms70-night-name-refused" },
                    { text: "Write a night name that guards someone else, not you.", nextPage: 9, trait: "ms70-night-name-guardian" },
                    { text: "Write a night name that belongs to no one but you.", nextPage: 9, trait: "ms70-night-name-claimed" },
                    { text: "Tear the night-name leaf out of the file and keep it in your own coat.", nextPage: 9, trait: "ms70-night-name-stolen-back" }
                ] },
            pg("What to Do With a Mirror", "Your quarters at deep night, the file closed, your reflection in the dark window arriving on time for once", "Narrator",
                "The closed file contains Moonshadow's reports on you, the buyer's plans, and one blank page waiting for tonight's decision.",
                "Whoever delivered it wanted you to know you were being studied. They may also expect anger or fear to make you predictable.",
                "Your reflection in the window moves with you. Unlike the Mirror, it is not searching a record or trying to predict what comes next.",
                "The page marked NEXT is still empty. The next entry is yours to decide."),
        ], [
            ch("Burn the delivered copy. Refuse to keep their file on you.", "good", "ms70-burned-the-file", "You burn the copy one page at a time, ending with the blank page marked NEXT. The archive and buyer may have other copies. You won't keep theirs in your room."),
            ch("Claim custody: the delivered copy lives, but under your seals.", "neutral", "ms70-claimed-custody", "You keep the delivered copy under your own seal. When you consult it, you compare the buyer's claims with the person holding the page. The file is useful, and it is heavy, and you stop letting it out of reach."),
            ch("Start files of your own. On the clerk. On the couriers. On the circle.", "bad", "ms70-started-files", "You begin three files: the registry clerk, the courier route, and a local hand that inks the quartered circle. The files are useful. They also make it easier to open the next one. Somewhere along the way, you stop checking whether you need to."),
        ]),
        interlude("Moonshadow Village", 80, "Harrow's Shortcut", [
            { ...pg("The Largest Commission", "A dry dock under the tower's waterline, Harrow beside a crate built for one impossible object", "Kite Harrow",
                "You're here. Good. I need to say this before I talk myself out of it.",
                "That crate was built for the Mirror under the tower. I've been hired to appraise it, approve the packing, and sign the shipping papers. The fee is enough to buy a permanent license and a place of my own.",
                "I inspected the glass twice. It showed me every version of myself that anyone ever recorded. The child of a forger, the apprentice in debt, the contractor every village hires by the hour. All of it is in the tank I'm supposed to help ship.",
                "What do I owe the people in there when this job would finally give me the life I wanted?"),
                choices: [
                    { text: "\"Owe? You're inventory to them, Harrow. Same as me. Walk away whole.\"", nextPage: 1 },
                    { text: "\"Certify it honestly: the cargo is people. Sign that manifest.\"", nextPage: 1 }
                ] },
            pg("The Manifest", "The dry dock, the blank manifest on the crate, her pen unmoving over it", "Kite Harrow",
                "My training says to appraise the object and ignore the ethics. Experience taught me that most of the objects in these villages turn out to be people.",
                "The client signs with a quartered circle. I followed that mark through all four villages, and it always comes back to a name people avoid writing down. Hollow Gate. That Mirror holds four hundred years of confessions and records of who trusted whom. If I sign, all of it becomes legal cargo.",
                "Listen to how they wrote the manifest. I'll read it exactly. 'Stormveil supplies the reasons people fight. Ashen Leaf supplies futures people were becoming. Frostfang supplies the choice to leave. Moonshadow supplies trust people placed in someone.'",
                "They only hired me to vouch for the last line, the Mirror. The other three are what the buyer calls the things it takes from the other villages.",
                "In the glass, I saw myself taking the fee and getting everything I wanted. I don't know whether it was a prediction or a sales pitch. It worked on me either way.",
                "Help me decide what to do before I sign anything."),
        ], [
            ch("Tear the commission with her. The Mirror stays unpriced.", "good", "ms80-pulled-her-back", "She tears the manifest herself. When it's done, she looks at the empty crate and says, 'There goes the retirement.' The crate is still on the dock when the next collection notice arrives. Harrow asks what work you have next."),
            ch("Partner on it: she stalls certification while you trace the client's chain.", "neutral", "ms80-partnered", "Harrow delays certification while you follow each new document to its sender. Before the deadline, you have four brokers' names and a dock outside village jurisdiction. 'They can complain about the delay,' she says. 'I'm doing exactly the checks they hired me for.'"),
            ch("Tell her to take the fee. Better her name on a door than in a tank.", "bad", "ms80-let-her-burn", "Harrow studies you long enough to make the answer uncomfortable. 'Practical,' she says. Her hand reaches for the pen twice before you leave. Later, a receipt reaches you with one line in her hand: payment deferred. The crate remains under collection order."),
        ]),
        interlude("Moonshadow Village", 88, "The Returning", [
            { ...pg("The Empty Booth", "A disused confession booth in the whisper market, scrubbed clean, its drain plugged with lead", "Nyx",
                "I rented this old booth for the season and had the drain plugged with lead. Tonight we're trying something nobody here does.",
                "The fight at the tower delayed the Mirror's transfer. It did not cancel the sale. Hollow Gate issued a new collection date.",
                "We're returning people's files to them in person, with witnesses and consent, for free. The last mass return happened in panic and darkness. People still use the fires from that night as proof that giving records back is dangerous.",
                "But the shrine has kept duplicate names for years without hurting anyone. That made me wonder whether the rule against returns was ever about safety.",
                "So we'll test it here, in the open. If it works, people won't need the archive to hold their own lives. If it fails, it fails at my booth.",
                "The smith couldn't remove that small plate of black glass over the drain. It's been dark since I rented the place. Probably nothing, but this village calls a lot of important things decorative."),
                choices: [
                    { text: "The back stool stays empty.", nextPage: 8, requireTrait: "sf-ms-source-shielded" },
                    { text: "You still have paste under one thumbnail.", nextPage: 9, requireTrait: "sf-ms-open-witnesses" },
                    { text: "Who gets the first file?", nextPage: 1 }
                ] },
            { ...pg("The First Return", "The booth at moonrise, one subject summoned, one file on the table, the market pretending not to watch", "Narrator",
                "The first person called is a dye-hand from the east canal. His gambling confessions were drained out of him years ago, and copies were sold twice since. The night the archive went home returned the tower's original, but the sold copies were still out there. Nyx bought those back at a fair price for tonight.",
                "He comes. He sees his own file on the table, his name on the spine, three witnesses standing calm around it, and Nyx's hand-lettered sign: THIS BELONGS TO YOU. TAKE IT. NO CHARGE.",
                "And he bolts. Knocks the stool over, puts his back against the canal rail, breathing like a cornered animal, staring at his own name as if it were a drawn knife.",
                "'You don't return a file,' he manages. 'Returned means spent, means somebody's about to... what do you people want from me?' The whole market, listening from every shadow, holds its breath with him. Everyone here was raised on the same rule."),
                choices: [
                    { text: "\"I should have asked you instead of buying the trainee's reports. I'm sorry.\"", nextPage: 2, requireTrait: "nyx-suspicion", trait: "ms88-repaired-trust" },
                    { text: "Post the holders' names above the booth: who held his file, and since when.", nextPage: 3, trait: "ms88-named-the-holders" },
                    { text: "Sit down at the table yourself, hands flat, and wait with him.", nextPage: 3 }
                ] },
            { ...pg("Fear, Refunded", "The booth's shadow, Nyx watching the dye-hand at the canal rail", "Nyx",
                "All right. You don't need to explain it again.",
                "I wondered when you'd ask me. Right now, he thinks we're going to hurt him.",
                "Sit where he can see you. You can start by helping me get him through this.",
                "Go on. He needs someone to wait with him."),
                choices: [
                    { text: "Sit at the table. Wait with him.", nextPage: 3 }
                ] },
            { ...pg("The Law Breaks Quietly", "The booth table, the dye-hand's hands finally on his own file", "Narrator",
                "It takes the better part of a bell. No one rushes him. The witnesses wait, the lead-plugged drain takes nothing, and Nyx murmurs, 'Free costs more than gold, apparently. Fetch the man some tea.'",
                "And then, with the whole market watching sideways, the dye-hand opens his own file, reads three pages of his worst winter, and starts, unstoppably, to laugh. Then he cries. Then both at once.",
                "'It's smaller than I remembered,' he keeps saying, gripping the folder like a rail. 'Years I paid to keep this held, and it's... it's just a bad winter. It's just a man having a bad winter.'",
                "He signs the return receipt with a steady hand. Witnessed, consented, home. The rule everyone was raised on turned out to be false, and nobody had ever checked.",
                "Above the plugged drain, the old black-glass plate clears for the first time. Its light is clear instead of the Hollow Moon's red.",
                "A voice says: OWNER VERIFIED. RETURN WITNESSED. NO TRANSFER. NO CLAIM RETAINED. Then the glass goes dark again.",
                "Nyx looks at the plate for a long few seconds. 'That was not the Hollow Moon,' she says at last, touching its edge and not prying at it. 'The Hollow Moon never says no claim. I think the Mirror just remembered an older rule.'"),
                choices: [
                    { text: "The queue forms on its own.", nextPage: 4, trait: "ms88-return-proven" }
                ] },
            { ...pg("Eleven by Dawn", "The booth at first light, a queue down the canal walk, receipts drying on a line", "Nyx",
                "Pass me those eleven receipts. That's every file we returned by dawn, each with its owner's consent and a witness. No fires, no ended marriages, and no duels.",
                "One woman fainted. We caught her, gave her tea, and she finished reading. Then she left us a tip. I put it in a jar.",
                "There are still sold copies out there, and claims in the Mirror. But these eleven people took their records back safely. We can show the others how to do it.",
                "Keep the receipts dry. There are more people waiting, and the tower will want to see what we've done."),
                choices: [
                    { text: "Set the bill of sale on the booth table. The oldest sale on the canal, next in the queue.", nextPage: 5, requireTrait: "ms65-saved-the-file", trait: "ms88-eleven-files" },
                    { text: "Ask Nyx if she is ready to show the page you sent her.", nextPage: 5, requireTrait: "ms65-gave-nyx-the-file", trait: "ms88-eleven-files" },
                    { text: "Let the eleven receipts stand on their own.", nextPage: 10, trait: "ms88-eleven-files" }
                ] },
            { ...pg("The Twelfth File", "The booth table, one file older than the rest, Nyx not touching it", "Nyx",
                "My bill of sale made it back here. It survived the shrine, the Hunter, and several chances for someone to sell it again.",
                "I was nine. The price was enough food for one winter, and they made me sign the paper myself. This isn't just a record of my worst year. It's proof of what this village does to hungry children and calls a fair trade.",
                "If this sale can be undone, other sales can be undone too. That's why the tower will care who brings it up.",
                "Do you carry it, or do I?"),
                choices: [
                    { text: "\"Partners split the risk. I'll carry it up the tower. You hold the market.\"", nextPage: 10, requireTrait: "nyx-partner", trait: "ms88-nyx-proof-carried" },
                    { text: "\"Standing order, one last true thing: let me carry it to her.\"", nextPage: 10, requireTrait: "nyx-respect", trait: "ms88-nyx-proof-carried" },
                    { text: "\"It's a start, you said. Let me carry this one.\"", nextPage: 10, requireTrait: "ms88-repaired-trust", trait: "ms88-nyx-proof-carried" },
                    { text: "\"It's your name. You should claim it yourself. I'll keep the way clear.\"", nextPage: 6, requireTrait: "nyx-partner", trait: "ms88-nyx-proof-deferred" },
                    { text: "\"It's your name. You should claim it yourself. I'll keep the way clear.\"", nextPage: 6, requireTrait: "nyx-respect", trait: "ms88-nyx-proof-deferred" },
                    { text: "\"It's your name. You should claim it yourself. I'll keep the way clear.\"", nextPage: 6, requireTrait: "ms88-repaired-trust", trait: "ms88-nyx-proof-deferred" },
                    { text: "Keep the file in your coat. Let that be your part.", nextPage: 7 }
                ] },
            { ...pg("You Hold the Market", "The booth, Nyx wrapping her own file in plain paper, like any parcel", "Nyx",
                "Good. I was hoping you'd say that. I'll carry the file and say my own name. You keep the booth open tomorrow.",
                "I've spent my whole life working around one folder I couldn't look at. Tomorrow I take it to the tower myself.",
                "I drafted terms. Every version made it sound like I was buying something.",
                "My name is Nerissa Vale. My mother chose it. I want Sable to hear me say it, even if it takes me a minute to get the words out."),
                choices: [
                    { text: "Let it be hers to say.", nextPage: 10 }
                ] },
            { ...pg("Held, Not Returned", "The booth, the file going back into your coat, Nyx watching it go", "Nyx",
                "You kept it out of a sale. Good. Now it's going back in your coat, which is less good.",
                "I was nine when I signed that page. I know exactly who gets to decide whether it opens.",
                "Carry it tonight. Sable will know you have it as soon as you enter.",
                "When we come down, set it on my counter and keep your hands off until I tell you."),
                choices: [
                    { text: "Keep the file. Walk on.", nextPage: 10, trait: "ms88-unfinished-answer" }
                ] },
            { ...pg("The Empty Stool", "The disused booth, its rear shutter open one finger-width", "Nyx",
                "The clerk sent us their account through someone they trust. They don't want to appear in public. I won't ask again.",
                "Without their name, the tower can challenge the account more easily. We'll have to support it with other evidence. That's the price of keeping our promise to them.",
                "Leave the back stool empty. Take the front one. Its wobble has improved."),
                choices: [
                    { text: "Take the front stool. Ask about the first return.", nextPage: 1 }
                ] },
            { ...pg("The Scraped Notice", "The disused booth, Nyx cleaning old paste from the front shutter", "Nyx",
                "The booth clerk kept their word and left. I was angry when you posted the notice. I am not finished being angry.",
                "Other people brought my pages back and agreed to testify. We still don't have the clerk's account of the raid.",
                "Hold the scraper. I have paste under this nail because apparently public truth requires bad glue."),
                choices: [
                    { text: "Hold the scraper. Ask about the first return.", nextPage: 1 }
                ] },
            pg("What the Market Carries", "Dawn over the canal, the returns line still forming, receipts drying like laundry", "Narrator",
                "By full morning the queue is longer than the market. Brokers stand in it. A watch officer stands in it, out of uniform, holding his numbered ticket like a prayer token. Somebody has chalked over the old booth sign. It reads, in a child's letters, THE GIVE-BACK HOUSE.",
                "Nyx checks each file against its owner's account and asks the witnesses to sign. The drain stays plugged throughout the returns.",
                "The tower has eyes on the queue by second bell. Everyone can feel them. The transfer of the tank is coming, and the market that was to be sold with it has begun, file by file, handing itself back.",
                "Nyx snaps the cashbox shut and leaves the morning's receipts spread across the counter. For once, she does not reach to sort them for you."),
        ], [
            ch("Run the returns in the open square at noon. Let the whole village watch.", "good", "ms88-open-returns", "You move the table into the noon square, no shadows, no curtains. Forty returns go home in full daylight. By dusk the holding booths have no customers, and three brokers are at Nyx's counter asking what it costs to witness a return. She chalks FREE without consulting you."),
            ch("Keep every receipt sealed and countersigned. Build the case file.", "neutral", "ms88-sealed-receipts", "Every return gets the full treatment: owner verified, witness sealed, countersigned. Iro signs the eleventh in careful brass-plate letters. Copies go under three locks in three districts. The originals stay with the people named on them, and the tower receives notice that eleven claims no longer belong to it."),
            ch("Let the booths' own clerks watch the queue and report the new prices up.", "bad", "ms88-baited-the-market", "You make no announcement. The clerks see the line, count the receipts, and send up the figures. By nightfall every booth has marked holding as dangerous and returning as survivable. Nyx reads the new prices twice. 'I hate that this worked,' she says, and folds the list for the tower."),
        ]),
        interlude("Moonshadow Village", 92, "Witnesses", [
            pg("Nine Lanterns", "The tower road at dusk, all nine lanterns lit, three figures waiting one lantern apart", "Narrator",
                "Nobody lights all nine lanterns on the tower road. Festival nights get five. The old Kage's funeral got seven. Tonight, someone has lit nine, and nobody in the market will say who, which in Moonshadow means everyone knows.",
                "Word has spread that you will confront Sable tomorrow, before the Mirror's sale can be completed.",
                "Nyx, Iro, and the shrine witness wait at separate lanterns along the road. Each has brought something for you.",
                "Nyx closes her ledger as you approach. Iro holds three sealed papers. The shrine witness carries an unlit lamp."),
            { ...pg("The Settled Ledger", "The first lantern, Nyx with her book open to its last page", "Nyx",
                "There you are. I'm closing the books early in case tomorrow goes badly.",
                "I checked your account four times. It does not balance neatly, and that is honest. Fair trades are marked paid. Harms and promises we haven't settled stay open.",
                "I used to settle everything by naming a price. I can't do that with what happened between us. I won't pretend that returning these files settles it either.",
                "The signed receipts record what the black plate said during the returns: owner, witness, no transfer, no claim. Whatever the Mirror used to be, it knew how to give something back.",
                "I'm keeping the page. Now go talk to Iro. He's been rehearsing."),
                choices: [
                    { text: "\"Tomorrow your name comes home. Carried by you, said by you.\"", nextPage: 2, requireTrait: "ms88-nyx-proof-deferred" },
                    { text: "Show her the sealed case file, receipt by receipt.", nextPage: 3, requireTrait: "ms88-sealed-receipts" },
                    { text: "Walk to the fourth lantern.", nextPage: 4 }
                ] },
            { ...pg("The Parcel", "The first lantern, the plain-wrapped file under Nyx's arm like a market parcel", "Nyx",
                "Look at it. After forty years, it's just a parcel in brown paper. I wrapped it myself. My hands only shook at the knot.",
                "I'm carrying it up tomorrow, one stair behind you. Village law says the person serving notice speaks first. I checked with two different law booths.",
                "When you're done, I'll say what I need to say. It won't take long.",
                "My mother chose my name. The glass holds the sale, but it never held that choice. Tomorrow Sable hears both. Go get some rest."),
                choices: [
                    { text: "The fourth lantern.", nextPage: 4 }
                ] },
            { ...pg("The Eleventh Signature", "The first lantern, the case file open to its last receipt", "Nyx",
                "Give me the file. One more time. I know, but give it here.",
                "All eleven returns are verified and sealed. Even the woman who fainted came back to sign.",
                "Iro signed the last receipt. His hand usually shakes. It didn't. He wanted this one to hold.",
                "The tower can burn the file, but then it has to admit its records only count when they help the tower. Take it. And don't lose it."),
                choices: [
                    { text: "The fourth lantern.", nextPage: 4 }
                ] },
            { ...pg("Three Tomorrows", "The fourth lantern, Iro with three sealed drafts fanned in one hand", "Shade Master Iro",
                "You're on time. I wrote three plans for tomorrow.",
                "The first protects me if the Mirror is sold. The papers say I was an unwilling participant. That's a lie, but it's notarized. The second gives me salvage rights if the glass breaks.",
                "The third is different.",
                "I wrote it at four this morning. It assumes you win. It's a confession, with a list of everything I've held and sold. If you survive tomorrow, I'm going to read it in public."),
                choices: [
                    { text: "The seventh lantern.", nextPage: 5 }
                ] },
            pg("The Unlit Lantern", "The seventh lantern, the shrine witness holding her own small lamp, wick trimmed, unlit", "Shrine Witness",
                "I don't think 'knife' fits you anymore. Sit with me for a moment.",
                "I have three hundred and eleven names, copied twice and kept safe. Sable's return of the archive originals showed me how long we have mistaken holding for protection. Whatever happens at the tower, I've decided what to do with my pages.",
                "I'll read one name in the square every day for three hundred and eleven days. This village will hear every person it sold. I can manage one name a day.",
                "This lamp is for the first reading. I'll light it from whatever fire is still burning tomorrow."),
            pg("The Windows Light", "The canal at full dark, returned files appearing in windows, masks left on sills", "Nyx",
                "Look at the windows. Someone on the east canal put their returned file on the sill with a lamp behind it. Then another person did the same. Across the water, someone left a mask beside the name it used to hide.",
                "People are reading returned archive pages to anyone who stops. Several booth clerks have put their meters face down. A watch officer hung his hood where the whole street can see it.",
                "Nobody organized this. By tomorrow, Sable will be able to see all of it from the tower.",
                "People are doing it because they want to. Remember that when you climb."),
        ], [
            ch("Climb in the open at first dark, the lit windows at your back.", "good", "ms92-vowed-open-ledgers", "You approach the tower openly while returned files and names remain displayed in windows across the canal. Iro serves his signed confession on the watch desk, and three officers refuse an anonymous order to clear the road. The rest stand aside. Nyx follows with her evidence, and the shrine witness waits below to begin reading the names after the confrontation."),
            ch("Climb with the case: receipts, manifest, and Iro's unsealed third draft.", "neutral", "ms92-vowed-a-keeper", "You carry the return receipts, the buyer's manifest, and Iro's signed confession to the tower. The watch checks the seals and admits you. Across the canal, people keep their returned files lit in their windows."),
            ch("Warn Sable: you have read the buyer's file, and you are coming to stop the transfer.", "bad", "ms92-vowed-to-collect", "You send notice that you have read the buyer's file and will challenge the transfer. At the tower gate, several Veiled Hands refuse an anonymous order to stop you. Nyx checks that you still have the evidence. 'Here we go,' she says. 'Try to look less frightened than I feel.'"),
        ]),
    ],
};
