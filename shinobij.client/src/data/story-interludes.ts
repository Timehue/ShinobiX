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
                "Watch this bout. Not the fists, the posting. That woman fighting Corr is unsworn. Central license, no village, fights for a fee. Pink hair, no crest, doesn't care who's watching. Kite Harrow.",
                "Here's the strange part. I saw the posting fee. Eight hundred, paid by our own arena council, to hire an outsider to beat our own man on our own board.",
                "Why would the council pay to watch Stormveil lose? Unless somebody wanted Corr's grudge settled hard and fast, and didn't care what it looked like.",
                "There. Third exchange. It's done. Now watch Corr's face. Watch him try to remember what he was so angry about."),
            { ...pg("The Coast Gate", "The coast gate at dusk, Harrow counting her fee unhurried", "Kite Harrow",
                "You're standing in my light. No, stay. You watched the bout like an auditor; everyone else watched it like a meal. That's worth two minutes.",
                "Yes, the council paid me to beat their own man. No, that's not strange. I've taken stranger contracts in nicer villages. What's strange is the ledger they paid me FROM. I got a look at it while they counted. Half the entries have no payer line at all. Money that comes from a floor, so to speak.",
                "I've worked coasts where smugglers keep cleaner books than your arena council. That's not an insult. It's an appraisal, and appraisals are the only honest thing I do.",
                "Your man Corr fought me over a boundary stone, by the way. He told me so before the bell, angry as a kicked kettle. Ask him about it tomorrow. See what's left. Then decide whether this village's favorite sport is fighting, or forgetting."),
                choices: [
                    { text: "Offer her a spar. No fee, no posting, no board.", nextPage: 2 },
                    { text: "Ask her exactly what the council's ledger paid for.", nextPage: 2 },
                    { text: "Tell her hired blades don't drink free in Stormveil.", nextPage: 2 }
                ] },
            pg("An Appraiser's Receipt", "The coast gate, lanterns coming on along the water", "Kite Harrow",
                "You know what I like about this village? Nothing is hidden. The board is public, the odds are public, the forgetting happens in the open air with everyone cheering. It's the most honest dishonest place I work.",
                "Free advice, and I never give free advice, so enjoy the anomaly. When a council hires outside blades against its own people, it's because the machine needs feeding faster than the locals are quarreling. Think about what that means about your peaceful little port.",
                "And one more thing. I priced you, out of habit, watching you watch the bout. First person on this coast I couldn't finish the figure on. The line where your reason goes just... doesn't add.",
                "I docked my own fee for the confusion. I'll be back through. I'm always back through."),
        ], [
            ch("Walk her out the coast gate, in front of the whole rail.", "good", "sv20-offered-the-spar", "She matches your pace and says nothing until the last lantern. 'That cost you standing with the council,' she says. 'It bought you more with me. I keep honest books.' The spar happens at dawn, no board, no bell, and it is the best fight either of you has had in a year."),
            ch("Memorize the council ledger's shape while she counts her fee.", "neutral", "sv20-asked-the-price", "Entries with no payer. A recurring fee marked only with a tally. One column that pays OUT to the tower and never draws back. You hold the shape of it in your head, and Harrow watches you do it with the professional approval of one appraiser for another."),
            ch("Turn your back on her and buy Corr his soup instead.", "bad", "sv20-turned-your-back", "Corr eats his soup and cannot tell you what the boundary stone dispute was about, or where his family's boundary even runs. He laughs it off. The unsworn woman leaves a calling card wedged in the rail where you'll find it: 'For when you notice what's missing.'"),
        ]),
        interlude("Stormveil Village", 30, "Storm Rules", [
            pg("The Rooftop", "Mira's rooftop at night, cables like a harp overhead, a packed bag by the hatch", "Mira Volt",
                "Up here we talk under storm rules. Said here, stays here, dies here. Everyone in this village has some version of the rule; mine has a view.",
                "That bag by the hatch is packed. It's been packed for four years. Change of clothes, dry rations, tools, coin in three currencies. There's a decoy route east that I mention when I'm drunk, and a real one I've never said out loud.",
                "I rig the cables that hold this village's banners up, and the whole time I'm rigging, I'm planning how to leave it. Both things are true. I've stopped apologizing for it.",
                "You're allowed one question about the bag. Most people ask where the real route goes. Choose better."),
            pg("The Week Won", "The rooftop, Mira turning her mother's gloves over in her hands", "Mira Volt",
                "You didn't ask about the route. Fine. You get the real story instead; that's the trade up here.",
                "My mother posted one grudge in her life, after my father drowned. Real grief, the kind with a body in it. The board scheduled her four days later. Then again. Then again. Best draw of the season, the odds-runners said. They said it where I could hear.",
                "Every bout she came home quieter. I thought she was healing. I was fifteen and I thought quiet meant healing, and nobody in this whole loud village told me different.",
                "The last season she fought nine times. The clerks have a phrase for when an account outperforms: the week won. The week won, and my mother sat down on this roof where you're sitting, and her heart stopped, and her name is still on that board tonight."),
            pg("One True Thing", "The rooftop, the harbor lights below, the bag by the hatch", "Mira Volt",
                "So now you know why I rig cables for a village I keep a bag packed against. Somebody has to hold the banners up, and somebody has to remember why they'd cut them down. I'm both. It's crowded in here.",
                "I don't show people the bag. I show people the decoy route, sometimes, to feel generous. You got the bag AND the gloves story, which means some part of me that ties knots without asking has already decided about you.",
                "Storm rules, so say it plain, whatever it is.",
                "What am I to you, and what do you want with my roof?"),
        ], [
            ch("Tell her where you'd run, if you ran. The real route, not a decoy.", "good", "mira-trust", "You give her your own exit, the one you've never said out loud either, and the trade lands like a knot pulling tight. She nods once, files it under storm rules, and moves the packed bag two feet further from the hatch. Neither of you mentions the two feet. Both of you counted them."),
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
                "The floor's seams are glowing. Faint, blue-white, in long lines running from the chalk ring toward the center drain, pulsing slow, like something swallowing.",
                "It fades as you watch, sated. By the time the sweepers come out, the sand is only sand.",
                "At the far rail, one other person is watching the same seams: Vanta, absolutely still, an old man looking at something he has spent forty years arranging not to see."),
            pg("The Bookmaker's Confession", "The rail, Vanta not looking away from the dark floor", "Elder Vanta",
                "Forty years at this rail. I can tell you the purse of every bout I ever chalked. The Harlan purse tonight was three hundred, split seventy-thirty. Ask me what the feud was about.",
                "Go on. Ask me. A field, a will, a wife? Those are the CROWD'S guesses. I chalked this bout myself and I am telling you I never knew, because knowing was never my job. My job was the number.",
                "Ten thousand bouts, friend. Ten thousand reasons went down that drain while I kept score of the money floating on top.",
                "I'm old, my forecast is short, and my books balance perfectly and mean nothing. If you saw what I saw under the sand tonight, do something younger than what I did. Which was nothing, wearing a good coat."),
        ], [
            ch("Tell him exactly what you saw. Seams, drain, direction of flow.", "good", "sv42-said-it-aloud", "You give it to him like a rigger's report, plain and orderly, and the old man takes out a purse ledger and writes it down in the margin, the first non-number he has entered in forty years. 'There,' he says, shaky. 'Witnessed. That's how it starts, apparently.'"),
            ch("Say nothing yet. Chalk the seam lines where they glowed.", "neutral", "sv42-kept-the-count", "You walk the cooling sand and chalk every line while Vanta watches, and the pattern is unmistakable once drawn: eleven channels, one drain, dead center. A diagram of a mouth. You copy it small onto your own slate, and now the count exists somewhere the floor can't drink it."),
            ch("Post a grudge of your own and watch the floor while you fight it.", "bad", "sv42-fed-the-floor", "You post something small and real, fight it at next bell, and watch the seams light beneath your own feet, hungry and intimate. You keep your reason on purpose, gripping it like a rail, and step off the sand with it intact and a coldness in you: now you know exactly what it feels like when the floor pulls, and exactly how few people could hold on."),
        ]),
        interlude("Stormveil Village", 58, "Vanta's Cut", [
            { ...pg("The Headerless Column", "Vanta's shack, one ledger open to a page he has never shown anyone", "Elder Vanta",
                "Sit. Tea's bad, take it anyway; confession runs smoother with something to hold.",
                "You've seen the arena ledgers. Purses, odds, fees, all public, all clean. This column is none of those things. No header. Nine shares, paid quarterly, drawn against what the floor takes. The elders' cut, the clerks call it, when they call it anything.",
                "Eight shares have names. Mine is the third, and I have collected it for thirty years, and it bought this shack and my niece's boat and a great deal of very quiet guilt.",
                "The ninth share has never had a name. It sits, and accrues, and waits, made out to the tower. I used to wonder for whom. I have stopped wondering and started dreading, which at my age is the same as knowing."),
                choices: [
                    { text: "Read the whole column, every entry, both books.", nextPage: 1 },
                    { text: "Close the ledger. \"Just say it plainly, Vanta.\"", nextPage: 2 }
                ] },
            { ...pg("The Arithmetic of Shares", "The shack, ledgers open side by side under the lamp", "Narrator",
                "It takes an hour, and Vanta feeds the lamp twice, and by the end you can read the village's real history in two columns nobody was ever meant to lay side by side.",
                "Every fat quarter for the elders' cut sits three weeks after a riot, a purge, a fee waiver, a scheduled harvest. The shares don't track the arena's business. They track the floor's APPETITE.",
                "The elders were never paid to run the village. They were paid to keep it hungry.",
                "Vanta watches you finish, and pours the bad tea, and says: 'Thirty years I collected that and called it an honorarium. Now you know the rate for not asking questions. It's good money, so long as you never lay two books side by side again.'"),
                choices: [
                    { text: "The ninth share.", nextPage: 3 }
                ] },
            { ...pg("Plainly, Then", "The shack, Vanta's hands flat on the closed ledger", "Elder Vanta",
                "Plainly. Fifty years around this arena and one person asks for plainly. All right.",
                "The elders take money from the thing under the floor. I am the elders, don't let the coat fool you. We are paid by appetite: the more the floor drinks, the fatter the cut, so we learned, without one meeting ever being held about it, to keep the village quarrelsome. Match the hot bouts. Wave the fees when intake runs thin. Call it tradition, civic spirit, the Stormveil way.",
                "Nobody ever wrote the arrangement down, which is how you know it's the real one.",
                "I'm offering you my share. Not the money. The KNOWING. Somebody younger than me has to hold the books when this breaks, or it all just grows back with fresher faces."),
                choices: [
                    { text: "The ninth share.", nextPage: 3 }
                ] },
            pg("The Ninth Share", "The shack, the unnamed line at the column's foot", "Elder Vanta",
                "Before you answer, the condition, and it isn't negotiable. The Volt account stays out of whatever you do. That girl's mother fed this column for six years, and I chalked those bouts, and if Mira ever needs a debt to collect, mine is first in the queue. But she hears it from me. Not from paper.",
                "Now. The ninth share. It's been accruing since before my time, made out to the tower's seat itself. Whoever takes that seat inherits it. Think about what that means about every Kage this village has ever loved.",
                "And think fast, because the floor's been hungrier this year than in any ledger I hold, and appetite like that always, always comes to collect.",
                "What'll it be, auditor?"),
        ], [
            ch("\"Keep your share, Vanta. I'd rather break the column than inherit it.\"", "good", "sv58-refused-the-ninth", "The old man looks at you a long moment, then laughs, rusty as a gate. 'The last person who turned down free money in this village became the Kage,' he says. 'Try to do it differently.' He marks your refusal in the margin, dated and witnessed. The first entry of a new column."),
            ch("Copy the column. Every share, every date. Names stay yours for now.", "neutral", "sv58-copied-the-column", "You copy thirty years of the elders' cut into your own cipher while Vanta drinks his bad tea and doesn't watch, which is a bookmaker's way of helping. The column now exists outside the shack. 'Insurance,' he says at the door, 'is what we call fear with good handwriting.'"),
            ch("Take the third share. From the inside, the books open wider.", "bad", "sv58-took-the-cut", "You sign where Vanta's name was, and the quarterly draw finds your account within a week, no questions, no welcome, no meeting. The machine simply recognizes another understanding party. The money is very good. The arithmetic of it sits behind your eyes at night, doing itself over and over."),
        ]),
        interlude("Stormveil Village", 70, "The Scheduled Loss", [
            pg("The Main Card", "The bout clerk's stand, your name in tomorrow's chalk", "Ledger Clerk",
                "There you are. Main card tomorrow, you against Joren Pike. Good draw, good purse, no surprises.",
                "That's the strange part, friend. I mean it exactly. No surprises. The routing office sent your bout down PRE-CHALKED. Result, purse split, even the exchange count. You lose in the third. Clean, no injuries, very tasteful.",
                "I've chalked fixed bouts before, I won't insult you. Winter fights, odds theater. But those come with a wink and a fee. This came with a ROUTING MARK, tower-pressed, the kind that goes on documents nobody is supposed to notice are documents.",
                "I shouldn't have shown you. Pike would tell you himself anyway; he's the last honest fist on this coast. Ask him."),
            { ...pg("Pike's Shrug", "The training yard, Joren Pike wrapping his hands like it's a craft", "Joren Pike",
                "So you've seen the slate. Good, saves the awkward part. Yes, it's fixed. You go down in the third. I'm told you make it look honest, which from what I hear won't strain you; you fight honest as a hammer anyway.",
                "How do I live with it? Friend, I've been the routing office's favorite closer for nine years. Somebody has to lose the scheduled ones, and it pays better than winning and costs fewer teeth. I stopped asking what the fights are FOR around the time I stopped counting my own knockdowns.",
                "But I'll tell you a thing, since you came and asked to my face like a person. Every fixed bout I ever fought, the mark on the slate matched the mark on my orders. Tower teeth, pressed in the corner.",
                "Yours is the first slate I've seen where they pressed the mark twice. Like the first one didn't take. Like YOU didn't take. Whatever that means, it rattled a routing clerk enough to stamp a slate twice, and nothing rattles those people. They file weather."),
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
                "The routing mark sits pressed over your reason line like a tooth. And around it, in fine clerk's pencil, a routing note: DIVERT. SHIELD-CLASS. HIGH DRAW.",
                "Shield reasons burn hot and long; you learned tonight that the office grades them like fuel. Somebody read the best thing you carry and marked it for the pipe.",
                "And under that, an older note, in different ink, from your very first week: ACCOUNT WILL NOT ROUTE. QUERY. Your reason has been refusing their plumbing since the day you posted it."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Ladder, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate: the strongest name on the board.",
                "The routing mark is pressed over your reason like a tooth, and the pencil note beside it reads: LADDER-CLASS. SCHEDULE AGAINST ITSELF. Ladder reasons, apparently, are best drained by matching the climber against their own record, forever, one rung at a time.",
                "They planned to make your ambition the rope you burned on.",
                "And under it, older ink: ACCOUNT WILL NOT ROUTE. QUERY. Your climb has been refusing their schedule since the day you chalked it."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Debt, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate: someone owes me. I intend to collect.",
                "The routing mark sits over it like a tooth, and the pencil beside it reads: DEBT-CLASS. DO NOT SETTLE. A debt reason is a well; settle it and the well closes. The office's whole craft is keeping wells open.",
                "Every season you didn't collect, somebody else did.",
                "And beneath, in older ink: ACCOUNT WILL NOT ROUTE. QUERY. Whatever you're owed, the plumbing has never once managed to skim it."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Search, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate: looking for someone. Fighting turns heads.",
                "The routing mark is pressed over the reason like a tooth. The pencil note reads: SEARCH-CLASS. SUSTAIN. A search that never ends is a reason that never runs dry; the office schedules searchers against strangers in distant sectors, forever, helpfully.",
                "They were never going to let you find anyone. Finding closes accounts.",
                "And under it, older ink: ACCOUNT WILL NOT ROUTE. QUERY. Your search keeps slipping their net, which means it is still, stubbornly, yours."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Blank, Routed", "The clerk's rack, your intake slate under the lamp", "Narrator",
                "You pull your own intake slate: the blank reason, posted your first night, when the brush dragged.",
                "The routing mark is pressed over the blank like a tooth. And beside it, not one pencil note but a stack of them, different hands, different seasons: QUERY. RE-QUERY. CLASS UNKNOWN. ESCALATED. The office has been trying to grade your blank since the night you wrote it.",
                "You weren't being evasive that night. The word really wasn't there. Now you know the office noticed the hole too, and has been reaching into it, over and over, and coming out empty.",
                "The blank isn't missing, you understand, all at once. It's TAKEN. Something was collected before you ever reached this coast, and the board has been trying to bill an empty room ever since."),
                choices: [
                    { text: "There's more under the mark.", nextPage: 7 }
                ] },
            { ...pg("The Bout You Can't State", "The clerk's stand after hours, your full file unrolled", "Narrator",
                "The clerk pulls your full record, because you ask, and because the clerk has been wanting a reason to look since the board posted you twice.",
                "There, seasons before you came to Stormveil, in a routing hand nobody at this stand recognizes: a bout, already fought. Logged, closed, PAID. You, against a name that is only a smudge of pressure on the slate. Result: win. Draw: total.",
                "You remember winning a fight, once, before the missing report, before the coast. You remember your hands after. You have never, not once, been able to say what the fight was ABOUT.",
                "The account was drained whole and closed clean, and the reason line on the oldest page of your life is not blank because you had nothing to say. It is blank because somebody was PAID."),
                choices: [
                    { text: "Morning. The fixed bout.", nextPage: 8 }
                ] },
            pg("The Third Exchange", "The arena, main card, Pike across the chalk, the script in everyone's pocket but yours", "Joren Pike",
                "Bell in a minute. Whatever you found in your file, friend, wear it later; the sand doesn't care.",
                "The script says you go down in the third. The routing office is watching from the good seats. The floor is listening under both our feet.",
                "For what it's worth, from nine years inside the machine: nothing the office writes has ever once survived contact with a person who knows their own reason. That's why they take the reasons first.",
                "So. Third exchange is coming. Fall, stand, or make it strange. I'll keep it honest from my side either way, because that's the only thing left in this yard that's mine."),
        ], [
            ch("Fight to the script's third exchange, then simply not fall.", "good", "sv70-read-the-mark", "The third exchange arrives, choreographed to the breath, and you just stand there in it, present, unpaid, unrouted, and Pike's punch stops an inch short like the last honest man in the machine refusing to sign. The crowd senses a script tearing without knowing there was one. Above the rim, in the routing box, somebody stands up fast enough to knock over a chair."),
            ch("Fall on schedule. Let them believe their plumbing works on you.", "neutral", "sv70-fell-on-schedule", "You go down in the third, tasteful as commissioned, and the routing office relaxes for the first time since your slate wouldn't take ink. Let them file you routable. Pike helps you up with an expression carefully empty of the question he isn't asking, and the purse's fixed split buys you a season of being underestimated by the only people watching closely."),
            ch("Break Pike in the first, off script, and stare at the routing box.", "bad", "sv70-made-him-kneel", "You end it in the first exchange, hard, in absolute silence, and then you look up into the routing box and let them watch you not caring about their schedule. Pike takes the knee slow, grinning through blood: 'Cost me a fee, that. Worth it.' The office's chalk line for you, whatever it was, snaps. Something older than the office writes a new one."),
        ]),
        interlude("Stormveil Village", 80, "Harrow's Shortcut", [
            pg("The Exiles' Stair", "A salt-eaten stair under the coast cliffs, Harrow with a shuttered lantern", "Kite Harrow",
                "Mind the fourth step; it's a rumor, not a step. There we go. Welcome to the part of Stormveil the heralds don't sing about. Smugglers cut this stair before the tower had windows, and the exiles kept it, and now it's mine, professionally speaking.",
                "I told you I'd be back through, and I'm back through with something I shouldn't show anyone, which after the season we've both had is apparently our whole friendship.",
                "Down there, past the old chain, is where your engine's surplus goes. Not the shield. The CISTERN. Four spouts, one tank, and a counter that makes offers.",
                "I've kept my mouth level about every strange thing on this coast for six years. Tonight I need a witness with no stake in lying to me, and no village that can revoke you if the answer's bad. Congratulations. You're the only one I know."),
            { ...pg("The Counter That Makes Offers", "The cistern ledge: a vast dark reserve, and a stone counter worn smooth by centuries of bargains", "Kite Harrow",
                "There. The hum in your teeth is four villages' worth of taken tribute, banked. The smugglers who cut this stair had a name for the thing at the bottom of it, scratched in the wall by the old chain: the Hollow Gate. That stone slab is its counter. You put a thing on it and the dark makes you an offer. Everyone down here before us has traded SOMETHING; the stone's worn like a moneylender's step.",
                "I put my license on it last month. Just to see. You know what it offered me? A name over a door. Standing. A village that can't revoke me, custom-built, price on request. It knew exactly what I don't have, and it priced the want, not the thing. That's better appraisal than I do, and I'm the best I've ever met.",
                "I walked away. I want it noted that I walked away, and I want it noted that I have thought about that offer every single day since, at the rate of once an hour.",
                "So here's my question, witness. The thing every village on this coast feeds. If it can price MY want down here in the dark, what do you suppose it's been offering the four people who sit in the four seats?"),
                choices: [
                    { text: "\"Whatever they each couldn't buy. Quiet, certainty, silence, warmth.\"", nextPage: 2 },
                    { text: "Put nothing on the counter. Ask what it offers YOU, unprompted.", nextPage: 2 }
                ] },
            pg("The Standing Offer", "The cistern ledge, the dark very interested now", "Kite Harrow",
                "Look at it. It's doing the thing. The whole reserve just leaned at you, like odds shifting when the favorite walks in.",
                "And there's your offer, surfacing in the stone like a watermark. I won't read it out loud; a lady doesn't. But I'll tell you what I can see from here: it's BLANK. It's offering you a blank, priced at everything. It doesn't know what you want. It's the counter's first bad appraisal in four hundred years, and it's having a small, silent, geological panic about you.",
                "I'd laugh if my skin weren't crawling. The thing that owns four villages can't find your price. Do you understand what that makes you on this coast? A currency it can't convert. The first one I've ever met.",
                "We're leaving before it recalculates. And, witness? When this all comes down, and it's coming down, I've seen the payment schedule, remember that of everyone on this coast, the unsworn woman told you the truth for free. Twice, now. I'm keeping count, even if you aren't.",
                "Now walk me up top to something with a door that locks and a bottle that doesn't. I have said the name of the thing at the bottom of this coast out loud tonight, which is the second-stupidest thing I have ever done, and I would like to be drunk before I recall the first."),
        ], [
            ch("Pull her off the ledge. \"Your name doesn't go on that stone. Ever.\"", "good", "sv80-pulled-her-back", "You take her arm, and for one held breath the appraiser lets herself be appraised: worth pulling back, no fee attached. 'Noted,' she says lightly, meaning the other thing. On the stair up she doesn't check the offer over her shoulder, which for Kite Harrow is a religious act. The counter's watermark fades, unbought."),
            ch("Set the terms out loud: she watches the cistern, you watch her.", "neutral", "sv80-set-the-terms", "A contract, spoken plain on the ledge with the dark listening: she keeps eyes on the intake schedules through her network, you keep eyes on her want, and either can call the other out with one word: counter. She shakes on it, and jots the terms in her book with an appraiser's relief. Things with prices are safe. It's the priceless ones that eat people."),
            ch("Take notes on the counter's mechanics while it studies her want.", "bad", "sv80-took-notes", "While the stone dangles standing in front of the one person who wants it most, you chart how it works: response times, pricing behavior, what sharpens its attention. Harrow catches you at it, and something in her face closes like a shop shutter at dusk. 'Get what you needed?' she asks, level. You did. The cost of it will come due later."),
        ]),
        interlude("Stormveil Village", 88, "The Quiet Storm", [
            pg("The Ridge at Midnight", "The high ridge over the Low Terraces, cable drums and anchor stakes in the wind", "Mira Volt",
                "Boots on rock, not on cable. The wind eats careless people up here, and I've filled my quota of grief for one lifetime.",
                "There it is. The cyclone's first arm crosses the coast before dawn bell, and the tower's answer is a fee waiver and a full intake. Ours is my mother's ridge line: seven anchors, one spine cable, a web over the Low Terraces. Ground the sky's temper before it ever reaches a roof.",
                "The tower said her design was grief. Vanta's books say the engine's shield hasn't grown in forty years. Tonight one district finds out who was right.",
                "Paper holds no weather, friend. Tonight this line either sings or it snaps. If it snaps, they were right about her. If it sings, I have to forgive this whole village, and I don't know which one scares me more.",
                "Hands steady. Mine, I mean. Yours look fine."),
            pg("Rigging in the Dark", "The spine cable going up, lanterns swinging, the Captain's guards hauling on ropes", "Narrator",
                "The Tempest Guard Captain arrives at second bell with eleven guards, out of uniform, on his own time. Nobody discusses it. He takes a rope.",
                "Mira works the anchor points in a language of grunts and hand signals, and the crew learns it in minutes because her hands make sense the way good rigging makes sense.",
                "At the fourth anchor she stops dead. The bolt pattern her mother drew calls for a spacing nobody uses, and she stands there in the wind, eleven years of doubt in one look.",
                "Then she sets the bolts to her mother's spacing, exactly, and says to nobody: 'You'd better be right about this too.'"),
            { ...pg("The First Raise", "The spine cable rising against the storm's first arm, everything singing", "Narrator",
                "The line goes up into weather that does not want it there. For three full breaths it stands, humming, drinking the sky's first anger and pouring it down the anchors into honest rock.",
                "Then the splice at the third anchor tears with a crack like the sky clearing its throat, and two hundred feet of cable comes down whipping.",
                "The Captain drags a guard clear by his collar. Mira doesn't move at all. She stands over the failed splice, wind screaming, staring at the torn lay of it.",
                "'My splice,' she says. 'I spliced it my way. Not hers. Mine slips under torsion and hers doesn't and I KNEW that, I've known it since I was nine.'"),
                choices: [
                    { text: "\"I priced your boat route once like a thief. The thief retires tonight.\"", nextPage: 3, requireTrait: "mira-fear", trait: "sv88-repaired-trust" },
                    { text: "Paint KESA VOLT on the mast head before the second raise.", nextPage: 4, trait: "sv88-named-the-rigger" },
                    { text: "Get on the third anchor and hold tension while she resplices.", nextPage: 4 }
                ] },
            { ...pg("Knots Under Torsion", "The third anchor, the two of you alone with the failed splice", "Mira Volt",
                "Heard. Don't repeat it; the wind's got enough to carry tonight.",
                "You asked what my exit was worth like you were pricing it for a buyer, and I have kept the bag by the hatch ever since, and the stupid thing is you were the reason I'd started moving it away.",
                "So here's how riggers forgive. You hold tension. I splice. If the line sings by morning, we're square, and the bag moves two feet, and neither of us mentions the two feet.",
                "Her splice goes over, under, back against the lay. Everyone ties it the fast way. She tied it the way that HOLDS. Hands where mine are, friend. We're doing it her way."),
                choices: [
                    { text: "Hold tension. Match her hands.", nextPage: 4 }
                ] },
            { ...pg("The Line Holds", "The spine rising again, Kesa's splice at its heart, the storm arm arriving", "Narrator",
                "The second raise goes up in the teeth of it, and this time the splice is Kesa's, tied by her daughter's hands from eleven years of watching and one night of believing.",
                "The storm arm hits the web like a fist hitting a net, and the net gives, and sways, and HOLDS, and the anchors drink the sky's whole argument down into the ridge.",
                "Below, across the Low Terraces, three hundred roofs stand in weather that should be peeling them like fruit. A dog barks at the quiet. Somewhere a shutter bangs, once, and is latched by somebody sleepy and alive.",
                "'It holds,' Mira says. Then again, quieter, like she's checking a knot: 'It holds.' Then she sits down on the wet rock, all at once, and laughs until it turns into the other thing, and nobody on the ridge pretends not to see."),
                choices: [
                    { text: "Dawn shows the district.", nextPage: 5, trait: "sv88-line-held" }
                ] },
            { ...pg("The Count at Dawn", "First light over the Low Terraces, the Captain counting roofs with a spyglass", "Mira Volt",
                "Numbers before anybody gets poetic. Captain, count with me and keep me honest.",
                "Three hundred and eleven roofs under the web. Damage: one loose shutter and a smashed melon frame, and the melon frame was rotten anyway; I checked last week. The engine's draw on this district tonight: zero. ZERO. Not one bout, not one fee, not one reason spent.",
                "It doesn't shield the whole coast. That was never the claim, so nobody had better claim it for us. One ridge line, one district. But it means the sky can be held off THIS way, her way, with rock and rigging and nothing fed to the floor, and that means it always could have been.",
                "So. It works, we can count that it works, and the tower's account comes due at frost of some kind sooner or later. What we do next decides whose answer this becomes."),
                choices: [
                    { text: "Set Kesa's grievance beside her drawings. The reason and the rigging together.", nextPage: 6, requireTrait: "sv65-saved-the-reason", trait: "sv88-one-district" },
                    { text: "Ask Mira to lay her mother's page against the mast. She's carried it since the ravine.", nextPage: 6, requireTrait: "sv65-gave-mira-the-page", trait: "sv88-one-district" },
                    { text: "Let the count stand on its own.", nextPage: 9, trait: "sv88-one-district" }
                ] },
            { ...pg("The Reason and the Rigging", "The mast foot, the rescued slate laid against the cable drum", "Mira Volt",
                "It made it. Through the ravine and the squad and every sensible chance to be lost, her reason in her own hand made it to this ridge, and now it's lying next to her line while her line holds the sky. Look at that. Just... look at it a second with me.",
                "This is the part the tower can't survive, you know. Not the rigging. Anyone can claim a clever line. The SLATE proves whose answer this was: a grieving woman they milked for six years and filed under madness, and she was right the whole time, and here's her handwriting to prove it.",
                "Whoever carries this pair up the tower isn't carrying cable specs. They're carrying the argument. The whole one.",
                "So decide who carries her, and knot it. This isn't a load you can set down halfway up a hill."),
                choices: [
                    { text: "\"You showed me the bag and the boat. Let me carry your mother's answer.\"", nextPage: 9, requireTrait: "mira-trust", trait: "sv88-reason-proof-ready" },
                    { text: "\"You rig, I argue. Sound division of load.\"", nextPage: 9, requireTrait: "mira-respect", trait: "sv88-reason-proof-ready" },
                    { text: "\"We spliced square on that ridge. Let me haul her the last pitch.\"", nextPage: 9, requireTrait: "sv88-repaired-trust", trait: "sv88-reason-proof-ready" },
                    { text: "\"Stand back. This is Kesa's. Her daughter carries her; I'll hold the sky off you.\"", nextPage: 7, requireTrait: "mira-trust", trait: "sv88-reason-proof-deferred" },
                    { text: "\"Stand back. This is Kesa's. Her daughter carries her; I'll hold the sky off you.\"", nextPage: 7, requireTrait: "mira-respect", trait: "sv88-reason-proof-deferred" },
                    { text: "\"Stand back. This is Kesa's. Her daughter carries her; I'll hold the sky off you.\"", nextPage: 7, requireTrait: "sv88-repaired-trust", trait: "sv88-reason-proof-deferred" },
                    { text: "Keep the slate in your own kit. Let that be your part.", nextPage: 8 }
                ] },
            { ...pg("You Hold the Sky", "The mast foot, Mira wrapping the slate in oilcloth with rigger's care", "Mira Volt",
                "Good. Then I carry her, and you hold the sky. Don't make a face; holding the sky is the bigger job, I've done it all night and my arms are done.",
                "I've kept my mother under oilcloth on a roof for four years. Packed to run with her twice. Tonight I get to carry her UP the hill instead, to the desk of the man who signed her away, and say the why out loud with my own mouth.",
                "I had a speech. I built it years ago, on the roof, revised quarterly like a good exit plan. Now it's tomorrow and all I've got left is: she was right, and I'm her daughter, and you're going to hear both.",
                "That'll do. Her splice held with less."),
                choices: [
                    { text: "Let it be hers to say.", nextPage: 9 }
                ] },
            { ...pg("Rigged, Not Argued", "The mast foot, the slate going into your kit, Mira watching", "Mira Volt",
                "You're keeping her. After tonight. In a kit bag.",
                "I'm not angry. Write that down, because it won't happen twice this year. You hauled her off a cart in a ravine when it would've been easier not to, and I owe you for that forever, and I mean the forever.",
                "But hear the rigging report before you climb. A slate in a bag is ballast, friend. It steadies YOU. It shelters nobody.",
                "Keep her dry, then, and keep her close. He'll see the difference from the rail. Riggers always see what a line isn't carrying."),
                choices: [
                    { text: "Keep the slate. Walk down.", nextPage: 9, trait: "sv88-unfinished-answer" }
                ] },
            pg("Whose Answer It Becomes", "Full morning on the ridge, the web humming gently over the district", "Narrator",
                "The storm's first arm is spent, and the ridge line stands, and word is already moving down the coast the way only good news and bad odds travel: fast, and growing.",
                "The Captain writes his morning report leaning on a cable drum, reads it over, and for once sends it exactly as written. Mira walks the anchors one more time, touching each splice like a rosary.",
                "The cyclone's heart is still out there. The tower's account is still due. And over three hundred and eleven roofs, a dead woman's rigging holds the sky like a held breath.",
                "One decision is left up here, and it is yours."),
        ], [
            ch("Wake the Low Terraces. Let them stand under their own held sky.", "good", "sv88-woke-the-district", "By full light half the district is on the ridge road, staring up at the humming web and the storm dying against it, and children are naming the anchors like ships. Three hundred families now know the sky can be held without feeding anyone's floor. The proof is public, and loud, and therefore already climbing the hill without you."),
            ch("Keep it quiet. Log every load and reading for Vanta's book.", "neutral", "sv88-logged-the-storm", "You and the Captain measure everything twice while the district sleeps on: wind loads, anchor draw, roof counts, hour by hour. Vanta receives the figures like a man being handed absolution and signs every page. The proof is bound, witnessed, and waiting, and the tower doesn't know it exists."),
            ch("Let one odds-runner find the web and say nothing at all.", "bad", "sv88-baited-the-board", "You let the sharpest runner on the coast discover it by 'accident' and watch the market do your arguing: by noon the storm-damage line on the Low Terraces has collapsed, and money that always knows first is screaming that something on that ridge WORKS. The tower reads odds the way priests read entrails. Let it choke on these."),
        ]),
        interlude("Stormveil Village", 92, "Witnesses", [
            pg("The Coast Road", "The coast road at dawn, the tower ahead, figures waiting at the switchbacks", "Narrator",
                "Word has run the whole coast: at the next bell worth naming, the one they now call the riot-stopper walks up the tower road to post the last challenge.",
                "The first switchback has people on it. So does the second. They are not a crowd yet, just villagers standing a careful space apart, the way people stand when they've decided something but haven't said it out loud.",
                "The odds-runners are out too, and for the first time in living memory, none of them are calling numbers.",
                "The board at the tower base has been blank for three days. It hums when you pass it, like a throat clearing."),
            { ...pg("Openly", "The third switchback, Mira standing in full view, no hood, no exit checked", "Mira Volt",
                "Before you say it: yes, I'm standing in the open, on the tower road, next to the person the tower hates most. I counted my exits this morning out of habit and then I didn't check a single one walking here. You understand what that means from me.",
                "The whole rim came out. Not for a bout. They can't say what they came for, most of them, and that's the point, there's no slate for it. The board has no idea what to do with people who show up without a grudge.",
                "My mother spent six years on that board and one night on a ridge, and the ridge is the part they'll remember. That's your doing.",
                "So whatever happens up there, the rigging holds. All of it. That's the last report from the cable department."),
                choices: [
                    { text: "\"Her slate and her drawings go up the hill today. Carried by her blood.\"", nextPage: 2, requireTrait: "sv88-reason-proof-deferred" },
                    { text: "Take her to the overlook. Show her the web from above, holding.", nextPage: 3, requireTrait: "sv65-saved-the-reason" },
                    { text: "\"Walk with me as far as the gate.\"", nextPage: 4 }
                ] },
            { ...pg("Her Blood Carries Her", "The switchback, Mira with the oilcloth bundle bound across her back like rigging", "Mira Volt",
                "You were right to make me carry her. I fought you on it on the ridge; I'm done fighting you on it. Carrying her up this road feels like the first thing I've done in six years that isn't an exit plan.",
                "Her slate, her drawings, and a splice off the line that held. That's the whole estate of Kesa Volt, and it beats the sky, and I get to say so out loud to the man who signed her away.",
                "You walk me to the gate. Past that, this part is mine and my mother's, and you hold the door for us.",
                "Storm rules on this whole road today, friend. Everything said here gets kept."),
                choices: [
                    { text: "Walk her to the gate.", nextPage: 4 }
                ] },
            { ...pg("The Web From Above", "The cliff overlook, the district and its anchor web small and whole below", "Mira Volt",
                "Look at it. From up here it's just lines and rock, and under it, all those roofs, and none of them owes the floor a single fed grudge for last night.",
                "Jorun's crew from the Terraces re-tensioned the east span this morning without being asked. People DO that now, apparently. It's a shield you can climb on and check with your own hands; try doing that with a reserve under an arena.",
                "The tower will call it one lucky district, one lucky storm. Let them. Luck doesn't repeat, and this will, every storm, forever, and the whole coast watched it work.",
                "All right. Enough looking at the good thing. Uphill is the man who buried it."),
                choices: [
                    { text: "Walk on, uphill.", nextPage: 4 }
                ] },
            { ...pg("The Bookmaker's Books", "The last switchback, Vanta waiting with a strongbox of ledgers on a cart", "Elder Vanta",
                "Forty years of purse ledgers, the elders' column, and last night's storm log. All signed. My name, on every page, dated, witnessed by the Captain, who has discovered he enjoys witnessing things and is becoming insufferable about it.",
                "You know what a signature buys, child. An old man muttering at a rail is weather. The arena's own bookmaker signing forty years of the floor's appetite is EVIDENCE.",
                "If you mean to argue with the seat, arguments need documents. If you mean to break the board, breakings need a count the crowd believes. Either way, this cart goes up the hill with you.",
                "One request, when it's done. Take an old man to a bout that means nothing. Two soup vendors feuding over a recipe. I want to watch one fight where nobody's keeping books at all, before my forecast closes. Deal?"),
                choices: [
                    { text: "\"Open the storm log, Vanta. Read me the district's night out loud.\"", nextPage: 5, requireTrait: "sv88-logged-the-storm" },
                    { text: "Show him KESA VOLT painted on the mast head.", nextPage: 6, requireTrait: "sv88-named-the-rigger" },
                    { text: "Take the cart's rope and walk on.", nextPage: 7 }
                ] },
            { ...pg("The Storm Log", "The switchback, the log open across the strongbox", "Elder Vanta",
                "Wind loads at seven anchors, hourly. Draw at every engine junction while the storm passed: zero, zero, zero, eleven times zero. Roofs standing at dawn: three hundred eleven of three hundred eleven.",
                "I have kept books my whole life on what this village spends to stay standing. This is the first page where the cost column is EMPTY, and I signed that page the way some men sign confessions. Gladly, and late.",
                "He wanted a quieter storm, our Raiko. He's had one ledgered, signed, and witnessed. Let him try to break my figures; I taught half his clerks.",
                "Take the log. It rides on top, where the wind can see it."),
                choices: [
                    { text: "Walk on together.", nextPage: 7 }
                ] },
            { ...pg("The Name on the Mast", "The switchback, the spyglass passed hand to hand", "Elder Vanta",
                "Give me the glass. Where. THERE. Kesa Volt, painted on the mast head in cable-tar, big enough to read from the tower's own windows.",
                "Ha! HA. Oh, that's better than evidence, child. Evidence argues. A NAME on a mast testifies, all day, every day, to everyone who looks up.",
                "Six years I chalked that woman's bouts and filed my shame under tradition. Now her name holds up the sky over three hundred roofs, and every soul in the Low Terraces says it when they point.",
                "Before we reach the gate, I'll tell you the truth: I came up this hill for you. I'm walking the rest of it for her."),
                choices: [
                    { text: "Walk on together.", nextPage: 7 }
                ] },
            pg("The Fourth Figure", "The tower gate's shadow, an odds-runner waiting alone, chalk behind her ear, no slate", "Narrator",
                "The runner at the gate is the sharpest on the coast; you have watched her call lines through riots without blinking. She stands alone, hands visible, no slate anywhere on her.",
                "'The window's shut,' she says, to the middle distance. 'First time ever. You know what we runners do when the window's shut? Nothing. There's no book on tonight. There's no book POSSIBLE on tonight.'",
                "'Some of us have taken money on every fear this village ever had. If someone were to break the floor's bank for good, some of us would... find honest work. Slowly. With enormous complaining.'",
                "She looks at you once, directly, the way runners look at a line they can't price, and then she is gone down the switchbacks, calling no numbers at all."),
            pg("The Village on the Hill", "The tower gate, the crowd on every switchback below, wind steady", "Mira Volt",
                "Look down the road. No, really look. Every switchback, full. The camp came down from the ravine, the Terraces came up with rigging pins in their belts, Pike's whole yard walked out mid-training. The Captain's guards are up here off duty, in their good coats, standing next to people they booked last spring.",
                "Nobody posted this. Nobody could. There's no slate for it, no odds on it, no purse under it. It's just the whole village, choosing, in the open, with their feet.",
                "The board has never once had to file a thing like this, and if you listen you can hear it humming to itself down there like a clerk who's lost his place.",
                "So decide how you want to walk in, because everyone on this hill walks in behind you the same way."),
        ], [
            ch("Walk up slow and open, letting anyone fall in beside you.", "good", "sv92-open-road", "By the gate you are four hundred strong and unarmed, grandmothers and guards and odds-runners with empty hands, and the tower watch stands aside because no drill was ever written for a village arriving as weather. Mira walks the front rank. Nobody walks behind anybody."),
            ch("Go in through the clerk's door, with Vanta's cart and the Captain's word.", "neutral", "sv92-signed-muster", "Ledgers, storm logs, a signed muster of witnesses, and one lawful escort with thirty years of gate duty on his face: you enter the tower as a filed case, not a storm. Everyone who stayed on the switchbacks stays safe, and you face the seat on its own paperwork, with the floor's whole appetite documented in a bookmaker's hand."),
            ch("Send word up first: the riot-stopper is coming, and the board remembers everything.", "bad", "sv92-fear-column", "The message runs the tower stairs faster than you climb them, and you can chart its progress by the lights going out floor by floor. The routing office burns papers; you can smell it on the wind. Above, a man who hears every grudge at once hears the village's fear turn toward him, and pours himself the last quiet hour he owns."),
        ]),
    ],
    "Ashen Leaf Village": [
        interlude("Ashen Leaf Village", 20, "The Unsworn", [
            pg("The Appraiser", "The register annex, a stranger at the wall", "Toma Reed",
                "Don't stare. That's the unsworn woman. Central license, no village, works for whoever pays the fee. Apparently, our village paid the fee.",
                "Pink hair, charms on her belt, sitting at the annex since the gates opened. They gave her a chair AND tea. Mori has worked here fifty years and gets neither.",
                "People say she appraises things for a living. Warehouses. War losses. Whole estates.",
                "So here's the question that's been ruining my morning: what exactly did our village hire her to put a price on?"),
            { ...pg("Kite Harrow", "The annex wall, charts spread", "Kite Harrow",
                "You're standing in my light. No, stay. You're more interesting than the light.",
                "So you're the black flower line everyone lowers their voice about. I appraised an estate with one of those once, up north. The flower alone raised the price of the whole property. Strange feeling, isn't it? Being the thing that makes the room worth more.",
                "Since you're clearly going to ask: your village hired me to value a season of graft-slats for an outside buyer. Yields, freshness, how well the stock travels.",
                "That was the word in the contract. Stock. I've read a lot of contracts, and I want you to know that word stopped me for a second. Not long. But it stopped me.",
                "And the buyer hid behind an escrow mark I have seen in three villages now. A circle cut into four equal pieces, too clean for orchard work, like someone divided a mouth into ledgers. A buyer with that mark does not purchase goods. It purchases systems.",
                "So here is the thing you will chew on tonight, whether you want to or not. Your village thinks it is selling a crop. The buyer thinks it is buying a pipe."),
                choices: [
                    { text: "Look her in the eye. \"People aren't stock.\"", nextPage: 2 },
                    { text: "Ask her what a future actually sells for.", nextPage: 2 },
                    { text: "Turn and walk away from her, slowly.", nextPage: 2 }
                ] },
            pg("The Refund", "The annex steps", "Kite Harrow",
                "You know what's funny? Everyone else in this village answers me like a form. Name, use, yield. You answered like a person. That's rarer here than you'd think.",
                "Free advice, black flower, and I never give free advice. When a village hires an outside appraiser, it's because somebody inside stopped trusting their own numbers. Think about what that means here.",
                "And one more thing. Today, for the first time in my career, I couldn't finish a valuation. One line of cedar wouldn't give me a number no matter how I ran it. Yours.",
                "I refunded that part of the fee. I'll be back through eventually. I'm always back through."),
        ], [
            ch("Walk her to the gate, in front of everyone.", "good", "al20-met-her-eye", "She matches your pace exactly and says nothing until the arch. 'That cost you something with the clerks,' she says. 'It bought you more with me. I keep honest books.'"),
            ch("Memorize her charts before the clerks fold them away.", "neutral", "al20-took-her-measure", "Yields by household. Freshness by season. One column headed OUTSIDE PARTY, and beneath it two words you do not know yet, printed so neatly they look official: FIFTH ANCHOR. You hold all of it in your head, and Harrow watches you do it with the approval of one collector for another."),
            ch("Tell the clerks to escort her out. This village isn't for sale.", "bad", "al20-turned-your-back", "She packs without hurry, pays for her own tea, and leaves a calling card on the desk anyway. Toma reads it aloud later: 'For when you find out what already sold.'"),
        ]),
        interlude("Ashen Leaf Village", 30, "Aren's Handwriting", [
            pg("The Joiner's Bench", "Toma's family workshop, sawdust in the lamplight", "Toma Reed",
                "Come in. Mind the wood shavings.",
                "This is Aren's bench. That's what everyone calls it, all warm, like the bench is the thing worth remembering about him. My mother dusts it every morning.",
                "You've heard me talk around my brother for weeks now. At the archive, I almost showed you everything, and then the keeper woke up, and honestly? I was relieved. Once you show someone, you can't take it back.",
                "I'm done being relieved. Fourteen households got survey letters this week. Three of those are kids I know, and I knew Aren too, and nobody stood up for him. So sit down. Please."),
            pg("The Letter", "A floor board up, oilcloth unwrapped", "Toma Reed",
                "Here. Read the second line, and watch the ink. My brother had the steadiest hands in the village, except right there, on that one line.",
                "He was building a water-screw to irrigate the terrace fields. He filed a formal complaint against the pruning rites. And he wrote this to me: 'If they cut me, Toma, remember me arguing.'",
                "One month later, he was quiet. Happy at the bench. My mother thanks the roots every year for giving her such a peaceful son.",
                "And this is the machined joint from his water-screw. Put it in running water and it climbs. It works, friend. The future they cut out of my brother WORKS. I've tested it a hundred times just to watch it."),
            pg("What He Was Becoming", "The bench, the letter between you", "Toma Reed",
                "So that's Aren. Not the bench. This letter, and this joint, and the argument he told me to remember.",
                "I've never shown another living person. The letter names the rites, and paper that names the rites gets its owner surveyed. You know that by now.",
                "Which means I just handed you enough to get us both pruned. I did the math before you walked in. I'm doing it again right now.",
                "Say something. Whatever it is, say it plainly. I've had a lifetime of quiet."),
        ], [
            ch("\"Aren's future gets finished. I'll help you build it.\"", "good", "toma-hope", "He looks at the joint, then at you, and something that has been braced in his shoulders since the day you met him finally lets go. 'Then we'll need better tools,' he says, voice thick, already reaching for paper."),
            ch("\"I'll keep the letter safe. That's all I can promise yet.\"", "neutral", "toma-caution", "He nods slowly, wraps the oilcloth himself, and sets it in your hands like a sleeping animal. 'That's more than anyone else has ever done,' he says. 'It isn't enough. But it's more.'"),
            ch("\"Burn it, Toma. Before it gets you pruned too.\"", "bad", "toma-doubt", "He goes very still, and then laughs once, badly. 'You sound like the survey. You sound sensible.' He hides the letter back under the floor anyway. Something between the two of you goes under the boards with it."),
        ]),
        interlude("Ashen Leaf Village", 42, "Pruning Season", [
            { ...pg("Tea at the Reeds'", "Ash-house row, Toma's family door", "Toma Reed",
                "My mother has been asking to meet you for weeks. Word about my Jonin friend reached her sewing circle before it reached me, which tells you everything about this village.",
                "It'll be an hour. She'll pour tea, show you my baby drawings, and send us off with bread. Completely painless, I promise.",
                "One thing first, and then I'll stop being strange about it. In the workshop, behind Aren's bench, there are outlines on the wall where his tools used to hang. She painted over the wall years ago and never noticed she was painting around their shapes.",
                "You should see them. And you shouldn't point at them. I need both of those things, if that makes sense."),
                choices: [
                    { text: "Go in for tea.", nextPage: 1 }
                ] },
            pg("Sera Reed", "The Reed kitchen, tea and a proud wall", "Sera Reed",
                "So YOU'RE the one keeping my Toma out at all hours. Sit down, sit down. Toma, love, fetch the good cup.",
                "Has he told you about his brother? Aren, my eldest. A quiet boy. Dutiful. Happiest at his workbench, ever since he could walk. Some mothers get the arguing kind of son. Not me. Not with Aren.",
                "He never gave me one gray hair, that boy.",
                "You've stopped eating, dear. Have more bread. And Toma, fetch the album, the one with the bench pictures."),
            { ...pg("The Painted Wall", "The workshop, ghost outlines behind the bench", "Narrator",
                "While she hunts for the album, you drift to the workshop doorway.",
                "The wall behind the bench is painted a careful cream color. And under the paint, faint but unmistakable, are the shadows of a working life: two saws, a row of chisels, a large auger. And higher up, a drafting square, hung where a boy would need to stretch to reach it.",
                "A quiet, dutiful boy who was happiest doing simple bench work would never have owned a drafting square.",
                "In the kitchen, Sera laughs at something in the album. The kettle sings. It is a warm, kind, well-loved house, and this wall is the only thing in it telling the truth."),
                choices: [
                    { text: "Ask Sera, gently, what Aren used to argue about.", nextPage: 3 },
                    { text: "Say nothing. Memorize every outline.", nextPage: 4 }
                ] },
            { ...pg("The Edit Holds", "The kitchen, album open", "Sera Reed",
                "Argue? My Aren? Oh, you're thinking of another family, dear. The Kellers, three doors down. THEIR boys argue.",
                "Although. There was one supper. Aren stood up and said something about... water, I think. Water, or the fields, or...",
                "Isn't that funny. It's like reaching into a pocket and finding a hole. I was sure I kept something there.",
                "Well. He apologized the next morning. He always apologized so nicely, my Aren. Didn't he, Toma? More tea, dear?"),
                choices: [
                    { text: "Let it drop.", nextPage: 4 }
                ] },
            pg("Leaving Warm", "The row at dusk, Toma silent beside you", "Toma Reed",
                "Now you've seen it. The kindest kitchen in the village, and a hole in my mother shaped exactly like my brother.",
                "Here's what I choke on, every visit. She's happy. The edit is MERCIFUL. It took her son and it left her comfortable, and some days I can't tell if fighting it would be for her sake or just for mine.",
                "Whatever you're carrying out of this house tonight, decide where it lives. Written down, it's proof, and proof gets people surveyed. Unwritten, it fades. There's no safe shelf. There never is here.",
                "Thank you for eating her bread. You'd be surprised how much that part matters."),
        ], [
            ch("Copy the wall's outlines tonight, exact and to scale.", "good", "al42-filed-a-report", "Every shadow, measured and dated, in ink that names nobody and proves everything. Toma watches your steady hand and says, quietly, 'The dead should hire you.' Aren now has a second document."),
            ch("Keep it all in your head. Paper gets people surveyed.", "neutral", "al42-kept-the-count", "Two saws, the chisels, the auger, the drafting square. You walk the row reciting the list until it sets like mortar. Now the truth of that wall lives in two people, and neither can be confiscated."),
            ch("Chip one painted outline off the wall as hard proof.", "bad", "al42-burned-a-blank", "A palm-sized piece of cream paint and shadow, wrapped in a napkin: proof that travels, deniable for her, spendable for you. On the way out, Sera hugs you and thanks you for listening. The napkin weighs more after that."),
        ]),
        interlude("Ashen Leaf Village", 58, "Mori's Cut", [
            { ...pg("The Bloom Charts", "Mori's study, forty years of charts", "Elder Mori",
                "Close the door and sit. You've been on my mind since the kiln.",
                "These are my bloom charts. Every black flower that has opened in this village for forty years, plotted the week it appeared. And this second book is the survey's pruning schedule for those same years.",
                "I am going to leave both books open, side by side, and go refill the tea. An old man forgets what he leaves open on his desk.",
                "Look, or don't. I want you to understand that both are real choices, and only one of them can be taken back."),
                choices: [
                    { text: "Read both books, side by side.", nextPage: 1 },
                    { text: "Close the books. \"Just tell me plainly, Elder.\"", nextPage: 2 }
                ] },
            { ...pg("The Pattern", "The study, charts under lamplight", "Narrator",
                "It takes ten minutes to see, and you already know you will never unsee it.",
                "A black flower blooms on a household's fence. Three to five seasons later, that same household appears on the pruning schedule. The bigger the bloom, the shorter the wait. Forty years of pages, and the pattern never misses.",
                "The flowers are not blessings. They are the fire noticing a future worth eating. The village brings honey bread to houses the kiln has already chosen.",
                "Mori returns with the tea. He doesn't look at the books. 'Now you can read the flowers,' he says quietly. 'I'm sorry. It was the only inheritance I had left to give anyone.'"),
                choices: [
                    { text: "Pour the tea.", nextPage: 3 }
                ] },
            { ...pg("Plainly, Then", "The study", "Elder Mori",
                "Plainly. Fifty years of clerking, and one person finally asks for plainly.",
                "The black flowers are not blessings. They are the fire smelling a future big enough to be worth eating. My charts prove it: a bloom appears, and within three to five seasons, that household is surveyed and someone in it is pruned. Forty years. It never misses.",
                "I worked this out as a young man, and do you know what my rebellion was? I kept counting. That's all. I counted accurately and grieved accurately and filed it all where nobody would look. I am not proud of that. It was what I could carry.",
                "I'm offering you the reading. It is the heaviest thing I own. Refuse it and stay innocent of the fences you pass. Take it, and you will never walk past a blooming fence the same way again."),
                choices: [
                    { text: "Decide.", nextPage: 3 }
                ] },
            pg("The Heaviest Thing He Owns", "The study, tea going cold", "Elder Mori",
                "Before you choose, one condition, and it is not negotiable. The Reed household does not appear in the schedule book. I removed that page myself, years ago. It is the only record I have ever stolen in my life.",
                "Do not put it back by being careless with what I've shown you.",
                "Well. The flowers are opening early this year, and I am seventy, and somebody younger than me has to know whether a blooming fence deserves congratulations or a warning.",
                "What will it be?"),
        ], [
            ch("\"Keep the reading, Elder. I'd rather fight it than forecast it.\"", "good", "al58-refused-the-cut", "He studies you for a long moment, then closes both books with something that looks like envy. 'Good,' he says. 'Stay the kind of person the pattern surprises. We buried the last one, but stay it anyway.'"),
            ch("Learn the rule of the pattern, but refuse the names.", "neutral", "al58-took-note", "Bloom size, seasons until survey, the ratio between them. Seven lines in your own cipher, no household names attached. Mori nods like a man watching someone take one coal from a fire, and marks your page with a dry leaf."),
            ch("Learn everything. Names, seasons, all forty years of it.", "bad", "al58-took-the-knowledge", "By midnight, you can look at any fence in Ashen Leaf and read its sentence. Mori teaches it all with terrible relief, like a man setting down a weight. 'Now there are two of us,' he says. 'I'm sorry twice over.'"),
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
                "As you stare at it, the black flower turns on your line, slowly, until it points straight at the scar. It has been trying to show you since the day you signed."),
                choices: [
                    { text: "You wrote 'protect people.' Look at what's left of that answer.", nextPage: 2, requireTrait: "al4-become-protector" },
                    { text: "You wrote 'strongest alive.' Look at what's left of that answer.", nextPage: 3, requireTrait: "al4-become-strongest" },
                    { text: "You wrote 'build something lasting.' Look at what's left of it.", nextPage: 4, requireTrait: "al4-become-builder" },
                    { text: "You wrote 'uncover what's hidden.' Look at what's left of it.", nextPage: 5, requireTrait: "al4-become-seeker" },
                    { text: "You couldn't answer the fourth question. Now you know why.", nextPage: 6, requireTrait: "al4-become-unknown" },
                    { text: "Stare at the scar. Whatever you once answered, this came first.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the wall you wanted to protect people. The ink of that answer sits directly on top of the old scar, like a bandage over a wound that never closed.",
                "The wall took your answer and set it exactly there. It knew. The thing you swore to become is the same thing somebody already cut into.",
                "You have spent this whole arc protecting other people's futures. Standing at fences. Opening crates.",
                "Maybe that was never a coincidence. Maybe you have been protecting in others the thing you couldn't protect in yourself."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the wall you would become the strongest shinobi alive. The ink of that answer sits directly on top of the old scar.",
                "Strongest alive. Written over a place where someone already took something from you, before you were strong enough to stop them.",
                "Every trial since you arrived, you have fought like the outcome was personal. The grove, the archive keeper, the Sentinel.",
                "Maybe it always was personal. Maybe strength was never the goal. Maybe it was the armor you built over a cut you couldn't remember taking."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the wall you wanted to build something that outlasts you. The ink of that answer sits directly on top of the old scar.",
                "A builder's answer, written over a cut. Somewhere before this village, there was something you were building, or were going to build, and someone took it out of you at the root.",
                "It would explain why Aren's water-screw made your hands ache to hold it. Why unfinished things in this village keep finding their way to you.",
                "The wall knew what you were before you did. That is what the flower has been pointing at all along."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the wall you wanted to uncover what people hide. The ink of that answer sits directly on top of the old scar.",
                "A seeker's answer, written over the one secret you can never dig up on your own: what was taken from you, and by whom.",
                "It would explain the pull. The archives at night. The charts. The crates you couldn't leave sealed.",
                "You have been excavating this village's buried truths for months. The wall knew from the first day which truth you were really digging for."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("The Wounded Answer", "Your line, under the lamp", "Narrator",
                "At your signing, you told the clerk you didn't know what you intended to become. The quill dragged. The wall waited for a word that should have been there.",
                "Now you know why nothing came. The answer was already gone. Somebody cut it out of you before you ever reached this village, and left you standing at a wall with an empty place where a becoming should be.",
                "You weren't being humble that day, or evasive. You were telling the exact truth.",
                "You are the only person in Ashen Leaf who was pruned first and asked the question after. No wonder the wall bloomed. It recognized its own worst wound, walking in on two feet."),
                choices: [
                    { text: "Call for Mori.", nextPage: 7 }
                ] },
            { ...pg("What Mori Sees", "The annex, Mori summoned, door barred", "Elder Mori",
                "Move the lamp closer. Hm.",
                "I have read ten thousand pruning cuts, and every single one carries a stamp, a season, and the keeper's mark. Yours has none of those. No record. Not even the mercy of a grieving entry. Whoever cut you did not think you were worth documenting.",
                "This is why the wall blooms for you, child. It is not honoring you. It is diagnosing you. You are a healed cut that walks and asks questions, and the roots have never seen one before.",
                "The mission you never talk about. The one with no report. I think it's time you told someone what you actually remember. And I suspect we both already know how little that is."),
                choices: [
                    { text: "Face the question.", nextPage: 8 }
                ] },
            pg("Pending", "The annex, your slat on the table between three people", "Registry Duty Clerk",
                "So. Nineteen years of filing, and today I have a Jonin with a pruning scar older than their record, no stamp, and a flower that points at wounds.",
                "I have to write something in the survey book. The survey reads what I write, and what I write follows you.",
                "Mori is polishing his glasses so that this can be your decision instead of his. For him, that's bravery. I mean that.",
                "Tell me what to write, Jonin."),
        ], [
            ch("\"Write the truth: cut by hands unknown. And that I want it back.\"", "good", "al70-claimed-the-name", "The clerk writes it in full and stamps it with a hand that isn't quite steady. Somewhere below hearing, the cedar wall answers, and one more petal opens on your line. Now the survey knows that you know."),
            ch("\"Write 'pending.' The wall has kept my secret this long.\"", "neutral", "al70-erased-the-name", "'Pending,' the clerk writes, with visible relief. Mori puts his glasses back on and says nothing, eloquently. The scar keeps its silence, and so do the three of you. In Ashen Leaf, silence is a currency everyone accepts."),
            ch("\"Write that the scar is for sale. Let's see who comes to buy.\"", "bad", "al70-traded-the-name", "The clerk stares at you, then writes it, because it is technically an answer. Within the week, two survey officers and one pink-haired appraiser have all asked to view your line. Bait floats. You watch the water."),
        ]),
        interlude("Ashen Leaf Village", 80, "Harrow's Shortcut", [
            pg("The Buyer's Terms", "The orchard gate at dusk, Harrow waiting", "Kite Harrow",
                "Black flower. Walk with me. I hate this village's benches. Every one of them is a memorial to somebody.",
                "I finished a contract today. Valued a season of graft-slats for an outside buyer. Everything I appraise, I price to move, that's the job. And then the buyer asked me one follow-up question, in writing.",
                "They asked: 'do the fresher ones travel?'",
                "I have priced weapons. I priced a small war, once, both sides. I sat with that one written question for a full hour, and then I did something I have never done in my career. I padded the number to kill the deal. The buyer doubled it without blinking."),
            { ...pg("The Bud", "The orchard wall, her charts under her arm", "Kite Harrow",
                "It gets worse, and then it gets personal, so stay with me.",
                "The buyer wants a premium lot next season. Their words: a future still in bud. Still attached. Still living. They asked me to flag candidates while I'm here, since I can apparently smell potential.",
                "I flagged nobody. So far. I want to be honest about the 'so far,' because every truly rotten person I've ever done business with got there through a chain of reasonable so-fars.",
                "And here's the personal part. People like me, no village, no line, no fence? To a buyer like that, I'm not the appraiser. Eventually, I'm inventory. So I'm asking the one person in four villages who never tried to buy me: what do I do with what I know?"),
                choices: [
                    { text: "\"Kill this market. You're the only one who can.\"", nextPage: 2 },
                    { text: "\"Start with everything you know about the buyer.\"", nextPage: 2 }
                ] },
            { ...pg("The Pipe Under the Hearth", "The orchard wall, a copied schematic held up against the dusk", "Kite Harrow",
                "One more thing, and then you get to hate me for knowing it. I went looking for where your buyer's goods actually go. Professional pride, mostly. Also the annex floor hums when you stand in the wrong spot, and floors that hum are usually billing somebody.",
                "Look at this. I copied it off their schematic. These aren't orchard lines, black flower. They're pipe lines. Your Rootfire is a hearth on the top and a pipe underneath, and that pipe runs to the same place Stormveil's Engine feeds, and Frostfang's Vault pays into, and Moonshadow's Mirror settles its accounts. Every village names its sin something local and prays nobody compares notes. Different hymns. Same plumbing.",
                "You want the one name under all of it? I only say it once, and then I would like a drink. Hollow Gate."),
                choices: [
                    { text: "Say it again.", nextPage: 3 }
                ] },
            { ...pg("Different Hymns, Same Plumbing", "The orchard gate, lanterns coming on, the schematic folded away", "Kite Harrow",
                "Here's the part your keepers would burn me for. Ashen Leaf spends its people's futures. That is your village's coin, the one that bought Aren. The others spend their own, the way Stormveil spends reasons and Moonshadow spends secrets and Frostfang spends exits. The Gate does not care what any of you call the currency. It only cares that the Kages keep collecting.",
                "Your Rootfire keeps enough ash to warm the village. Enough to make your Kage's argument true on the coldest nights. The rest goes down. Aren Reed went down. Sena will. The quiet children in those detention rows will. Not to your roots, black flower. To the Gate.",
                "And before you ask whether Hoshina knew: nobody signs a lower-draw approval for thirty years by accident. She kept the scraps for your children and sent the surplus below, and she has understood exactly what she was doing since before you were born.",
                "So. Now we both know it. That's the expensive part of knowing anything. You can't give it back."),
                choices: [
                    { text: "Hear the rest of what she holds.", nextPage: 4, trait: "al80-named-hollow-gate" }
                ] },
            pg("What Harrow Holds", "The orchard gate, lanterns coming on", "Kite Harrow",
                "You know, the last person who gave me advice without invoicing me afterward was my mother. She was also wrong, so let's hope it isn't hereditary.",
                "Here's what I'm holding. The buyer's shipping route. Their agent's alias. And the sample manifest, with this annex's own stamps on it. Read that last part again: your village's stamps. Ashen Leaf sold a sample lot to an outside buyer, and then hired me to tell them what the rest was worth.",
                "Your keepers aren't containing this thing inside the village walls. They've already started exporting it. I just did the arithmetic they were too pious to write down themselves.",
                "Whatever we do next, know the price going in. If I cross this buyer, I burn my license in four villages. If I help them, I burn something that doesn't have paperwork. Your call, black flower. Someone's getting billed either way."),
        ], [
            ch("Burn the manifest together, and give Mori the buyer's name.", "good", "al80-pulled-her-back", "She strikes the match herself and holds it a moment too long before dropping it. 'There goes my retirement,' she says lightly, meaning something else entirely. By morning, Mori has the buyer's alias, and Harrow has the first ally she never had to hire."),
            ch("Split the work: she stalls the buyer while you copy everything.", "neutral", "al80-split-the-draw", "Route, alias, manifest, stamps: copied into your cipher before midnight. Harrow feeds the buyer polite delays billed as due diligence. 'We're now partners in a crime against a crime,' she says. 'I've signed worse contracts.'"),
            ch("Tell her to take the deal and keep her seat at that table.", "bad", "al80-let-her-burn", "She looks at you for a long moment, recalculating something she'd thought was settled. 'A knife inside the market. Efficient.' She flags no one living and sells the buyer a warehouse of expired stock, and when she says goodbye, there's a receipt in it."),
        ]),
        interlude("Ashen Leaf Village", 88, "The Wet Field", [
            pg("The East Channel", "The east terrace channel at night, lamplight on low water", "Toma Reed",
                "You came. Good. Keep your voice down and your boots on the stones; the mud here eats people's ankles.",
                "Look at the channel. This whole stretch should be running wet in the planting season, and it's dry enough to sleep in. The terraces above us have been thirsty for thirty years, and everyone calls it normal.",
                "The Kage told you to bring her a better winter. I have Aren's model in my coat and a frame full of guesswork in the water, and I need you to understand something before we start.",
                "A model feeds nobody. Either the full machine works tonight, or all we ever had was a toy that made us feel right. And I am so angry that it might work that my hands are shaking. Don't ask me to explain that."),
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
                "Say that again. No. Don't. Once was honest; twice would be a performance.",
                "You told me to burn the only thing left of him, and you called it wisdom, and the worst part is that you might have been right. That's what I couldn't forgive. Not the fear. The arithmetic.",
                "Fine. Then don't ask me to trust you tonight. Help me make the thing work. Trust can catch up if it wants.",
                "Get in the water. You hold, I set, Jorun cuts the new vane. And hand me the small mallet, friend. The wooden one."),
                choices: [
                    { text: "Get in the water.", nextPage: 4 }
                ] },
            { ...pg("The Water Climbs", "The screw turning, water rising up the flights", "Narrator",
                "The second turn is nothing like the first. The screw bites, steadies, and begins to lift, and the sound it makes is low and even, like a man humming over a workbench.",
                "Water reaches the first terrace flight, then the second. It does not rush. It climbs slow and stubborn, in no hurry to amaze anyone, and it does not stop.",
                "'It climbs,' Toma says. Then again, quieter, to himself: 'It climbs.' He scrubs his face with a muddy wrist and leaves it dirtier. 'He was right. Roots take me, he was right.'",
                "A lamp comes down the terrace path. Sera, with tea and dry cloth, because her son has been sneaking out at night and mothers notice. She looks at the machine a long moment, then at the marks scratched on the housing. 'That's Aren's three,' she says. 'He never closed his threes.'"),
                choices: [
                    { text: "The water keeps climbing.", nextPage: 5, trait: "al88-water-proven" }
                ] },
            { ...pg("The Number", "Wet chalk figures on a channel stone", "Toma Reed",
                "Numbers, before anyone starts crying. Flow, lift, field reach. Jorun, count with me. Keep me honest.",
                "The east terraces, watered like this through the cold, feed ninety mouths. Ninety, off this one channel, without burning a single future.",
                "It doesn't beat winter on its own. That's not why everybody went quiet. Everybody went quiet because it means the fire was never the only way, and the whole wall upstairs paid for that lie.",
                "So it works, and we can prove it works, and the burning's at frost-fall. What we do next decides whose proof it becomes."),
                choices: [
                    { text: "Set Aren's model beside the working machine.", nextPage: 6, requireTrait: "al65-saved-the-screw", trait: "al88-ninety-mouths" },
                    { text: "Let the numbers stand on their own.", nextPage: 9, trait: "al88-ninety-mouths" }
                ] },
            { ...pg("The Model and the Machine", "The little model turning beside its full-grown self", "Toma Reed",
                "You kept it. Through the crates, the squad on the road, all of it. You kept the little one with the cracked vane, and now it sits next to the real one, turning in the same water.",
                "This is what provenance means, friend. Anyone can build a machine and claim it. The model proves whose future this was. It was Aren's, it was stolen, stamped, and boxed for the fire, and it works.",
                "Someone has to carry that to the Kage. Carrying it means standing in front of her and saying, out loud, whose future this was. So decide who does the carrying.",
                "Say it plainly. After tonight there's no putting it down."),
                choices: [
                    { text: "\"We built your brother's answer. Now I'll carry it to her.\"", nextPage: 9, requireTrait: "toma-hope", trait: "al88-reed-proof-ready" },
                    { text: "\"You trusted me with the letter. Trust me with the proof.\"", nextPage: 9, requireTrait: "toma-caution", trait: "al88-reed-proof-ready" },
                    { text: "\"Trust caught up. Let me carry it the rest of the way.\"", nextPage: 9, requireTrait: "al88-repaired-trust", trait: "al88-reed-proof-ready" },
                    { text: "\"Stand back. This is Aren's. Let the Reeds carry him; I'll carry the door.\"", nextPage: 7, requireTrait: "toma-hope", trait: "al88-reed-proof-deferred" },
                    { text: "\"Stand back. This is Aren's. Let the Reeds carry him; I'll carry the door.\"", nextPage: 7, requireTrait: "toma-caution", trait: "al88-reed-proof-deferred" },
                    { text: "\"Stand back. This is Aren's. Let the Reeds carry him; I'll carry the door.\"", nextPage: 7, requireTrait: "al88-repaired-trust", trait: "al88-reed-proof-deferred" },
                    { text: "Keep the model to yourself. Let that be your part.", nextPage: 8 }
                ] },
            { ...pg("You Carry the Door", "The channel bank, Toma holding the model", "Toma Reed",
                "Good. Then I'll carry him. You carry the door.",
                "That's not the small job. Somebody has to make sure there's a village still standing when we reach the tower, and a way out the back if there isn't. That's you.",
                "I kept him under the floorboards for years. A letter and a broken toy under the floor. Tonight I get to set him on the anvil in front of the woman who cut him. You made that possible.",
                "I had a better thing to say. Had it the whole way up the road. Now I'm here and all I've got is thank you. Let it be ours to say."),
                choices: [
                    { text: "Let it be theirs to say.", nextPage: 9 }
                ] },
            { ...pg("Grateful Is Not Ready", "The channel bank, the model still in your own hands", "Toma Reed",
                "You kept the model. Through all of it. I am grateful, and I mean grateful, not polite.",
                "But grateful is not the same as ready to hand you my brother. You know that. I can see you know it.",
                "Keep it. It climbed tonight, and that's real, and it's yours. Just don't walk into that tower and call a saved toy the finished thing. She'll know. So will you."),
                choices: [
                    { text: "Keep the model. Walk on.", nextPage: 9, trait: "al88-unfinished-answer" }
                ] },
            pg("Whose Proof It Becomes", "First gray light, the water still climbing", "Narrator",
                "The cold is real now, the tea has gone cold, and the water is still climbing, indifferent to how much it means.",
                "Jorun sits on the bank flexing his warm hands, unsettled and grinning about it. Sera folds the drying cloth, then unfolds it, then folds it again, because her hands need the job.",
                "Frost-fall is coming. The detention rows are full. In the channel, a dead man's machine turns and turns.",
                "Toma scrubs the mud off his jaw with his wrist and looks at you. 'Well,' he says. 'How do you want to do this.'"),
        ], [
            ch("Wake the terrace houses. Let them see it climb before dawn.", "good", "al88-proved-the-winter", "By first light there are forty people on the terrace edge watching water walk uphill, and children racing it up the flights. The proof is public now, and therefore dangerous, and word begins moving toward the tower faster than any of you can walk."),
            ch("Keep it quiet. Record every number: flow, lift, reach, mouths fed.", "neutral", "al88-held-the-proof", "You measure everything twice by lamplight and carry the figures to Mori before the village wakes. He reads them in silence, then opens his testimony book to a fresh page and writes until his hand cramps. The proof is safe, signed, and waiting for its moment."),
            ch("Let the survey hear just enough to come looking.", "bad", "al88-baited-the-survey", "You leave the machine running where a gray coat's morning route will find it. By evening a dry technical note is on the Kage's desk: east fields wet in a dry week, cause unrecorded. Toma watches you set the bait and says nothing, admiring and afraid in the same breath."),
        ]),
        interlude("Ashen Leaf Village", 92, "Witnesses", [
            pg("The Last Road", "The kiln road at dawn, three figures waiting", "Narrator",
                "Word has moved through Ashen Leaf like sap in spring: at frost-fall, the black flower walks to the tower, to put a question to the Kage that only the fire can answer.",
                "Three people are waiting for you on the kiln road. By the look of them, they have been waiting since before first light.",
                "Behind them, along the whole row, windows are lit and shutters stand open. The village is watching this road today."),
            { ...pg("The Mother", "The road, Sera Reed stepping forward", "Sera Reed",
                "Don't look so alarmed, dear. Toma told me where you'd be walking. He tells me things now. We're practicing that, the two of us.",
                "Three nights this week I've dreamt in his handwriting. The real one, with the loops he never closed. I wake up angry at people I can't put a name to.",
                "I washed ink out of that boy's sleeves for years. That was my job, apparently. Washing his shirts and forgetting him. No. That came out wrong. I am angry, and I am very new at it, and I keep saying it badly.",
                "Here is what a mother can offer. I will stand in front of anyone and say a thing was taken from my house and I want it to stop. Would that help, dear? Being believed out loud?"),
                choices: [
                    { text: "\"The Reeds carry Aren's proof today. You'll carry his mother's word.\"", nextPage: 2, requireTrait: "al88-reed-proof-deferred" },
                    { text: "Take her to the east channel. Show her Aren's answer running.", nextPage: 4, requireTrait: "al65-saved-the-screw" },
                    { text: "\"It helps more than you know. Walk with us.\"", nextPage: 7 }
                ] },
            { ...pg("This Part Is Ours", "The road, Sera and Toma with the model and the letter", "Toma Reed",
                "You were right to stand back. I didn't think so at the time. I think so now.",
                "This is Aren's model. This is his letter. This is my mother's word. You carried us this far, and I will never be able to say what that's worth. But this part is ours.",
                "You walk us to the tower. We'll carry him through the door.",
                "And if the guards close it, you're the one who gets it open again. That was always going to be your job."),
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
                "Come and look before we walk. Sera, you too. Watch the water.",
                "It has not stopped since the trial night. Jorun comes up before every dawn to check on it, and he stays longer than he needs to. He says his hands feel warm here. He's stopped asking why.",
                "Aren's water-screw, full size, feeding the east terraces without one future burned. You held the frame in the dark while we reset the vane. I remember exactly who was standing in the channel.",
                "Whatever happens at the tower today, this is already true. Nobody can make this field dry again by winning an argument."),
                choices: [
                    { text: "\"And the terrace houses saw it climb. The whole row saw.\"", nextPage: 5, requireTrait: "al88-proved-the-winter" },
                    { text: "\"She already knows, Toma. I made sure her own survey saw the field.\"", nextPage: 6, requireTrait: "al88-baited-the-survey" },
                    { text: "Let the water speak. Walk on.", nextPage: 7 }
                ] },
            { ...pg("What They Saw", "The channel, doors opening along the terrace row", "Toma Reed",
                "That's the whole plan now, isn't it. Show them what they saw with their own eyes. The east channel. The water climbing.",
                "They can call us liars at the tower. They can call Mori's book a forgery and your flower a trick. They cannot make forty families un-see water.",
                "My brother's machine made witnesses out of an entire row while it was busy making bread. He would have liked that better than any argument."),
                choices: [
                    { text: "Walk on.", nextPage: 7 }
                ] },
            { ...pg("The Dry Report", "The channel, a gray figure gone from the tree line", "Toma Reed",
                "A gray coat walked past this field three times this week, counting on her fingers like we couldn't see her from the water. You wanted the survey to notice. It noticed.",
                "By now there's a report on the Kage's desk that says the east fields are wet in the driest week of the year, and she is sitting up there trying not to understand it.",
                "I can't decide whether to admire that or be a little afraid of you. I've settled on both."),
                choices: [
                    { text: "Walk on.", nextPage: 7 }
                ] },
            { ...pg("The Keeper of Records", "The road, Mori with a bound book and a second stack tied in survey string", "Elder Mori",
                "Forty years of bloom charts. Copied out fair, in my own hand, my name at the bottom of every page.",
                "And a second stack, which is not a book at all. Copied manifests, tied with survey string. For forty years I counted flowers and called it record keeping. This season I finally counted where the cut futures WENT.",
                "Some burned here. Enough to warm us. Enough to make the lie comfortable on a cold night. The rest went below, to a place that was never ours. I mean to say the number of them out loud at the tower, and let the village decide what a keeper who counted the theft for forty years and stayed quiet is worth.",
                "You know what a signature does, child? An old man counting flowers in private is a rumor. The village record keeper signing forty years of it is a record. Grief without a signature gets shelved under weather. I should know. I shelved plenty.",
                "Arguments need documents. Breakings need witnesses who kept count. These two do both, so they walk with you. And one thing, when it's done. Plant something for me. I have filed endings my whole life. I would like to stand near a beginning for once."),
                choices: [
                    { text: "\"Open the book, Elder. Read me the east channel pages.\"", nextPage: 8, requireTrait: "al88-held-the-proof", trait: "al92-gate-witnessed" },
                    { text: "Show Mori the names carved into the housing.", nextPage: 9, requireTrait: "al88-named-the-builders", trait: "al92-gate-witnessed" },
                    { text: "Take the book, and walk on.", nextPage: 10, trait: "al92-gate-witnessed" }
                ] },
            { ...pg("A Count That Argues", "Mori turning the east channel pages, wetting his thumb, losing his place once", "Elder Mori",
                "Here. The channel pages. Flow, lift, field reach, mouths fed. Measured at the worst stretch, in the driest week, the way I taught you. No clerk alive can call it generous.",
                "The count is in my book and my name is under it. She wanted a count. This one argues back.",
                "Forty years I filed things that were true and helped nobody. This is the first page I ever carried that fights. Let me hold it a little longer. Then it is yours."),
                choices: [
                    { text: "Walk on together.", nextPage: 10 }
                ] },
            { ...pg("The Signatures", "His thumb on the carved housing plate", "Elder Mori",
                "You carved the builders' names into the housing. A. Reed. T. Reed. And under them, room for more.",
                "Evidence argues, child. A signature testifies. A machine with names on it stops being a rumor and becomes somebody's word, given in public, on purpose.",
                "Before we reach the gate, I will cut my own name beside theirs. It is long past time the record keeper went on the record."),
                choices: [
                    { text: "Walk on together.", nextPage: 10 }
                ] },
            pg("The Third Figure", "The road's bend, a survey officer waiting alone", "Narrator",
                "The third figure wears survey gray, stands alone, off schedule, hands kept visible. Everything about the posture says: I am breaking a rule, carefully.",
                "'Fourteen names sit in the detention rows,' the officer says quietly, to the middle distance. 'The transfer to the kiln is signed for frost-fall. I am the officer who countersigns transfers.'",
                "'Some of us joined the survey to keep records, not to feed fires. If someone were to walk on the tower today, with the village behind them, some of us would countersign... slowly.'",
                "The officer looks at you once, directly, afraid and doing it anyway. Then gray robes, and gone between the trees."),
            pg("The Village Behind You", "The tower road, doors opening along the row", "Toma Reed",
                "Look behind you. No, really look.",
                "Sera told her sewing circle. The circle told the row. Jorun is at his gate holding a drawing of a bridge he can't explain keeping, and he's coming anyway. Imera's locked her house and she's already ahead of us.",
                "You didn't order any of this. That's the part the Kage will never be able to file. Nobody posted a notice. Nobody stamped an approval. They're just choosing.",
                "So decide how you want to arrive, because everyone behind you arrives the same way."),
        ], [
            ch("Walk in the open, slowly, letting anyone fall in beside you.", "good", "al92-carried-their-trust", "By the tower gate you are sixty strong and unarmed, and the guards step out of the way, because no drill was ever written for a village arriving gently. Sera walks in front. Nobody walks behind anybody."),
            ch("Go in through the survey door, with Mori's book and the officer's word.", "neutral", "al92-took-the-count", "Charts, countersignatures, and one nervous lawful escort: you enter as a case, not a crowd. Everyone who stayed home stays safe, and you face her alone, on her own paperwork, with proof in both hands."),
            ch("Send word ahead: the flower is coming, and it remembers every cut.", "bad", "al92-wore-their-fear", "The message travels faster than you walk. Shutters close along the tower road, the guard doubles, and somewhere above, a keeper smiles at finally being feared in a language she respects. The village still follows. From a distance now."),
        ]),
    ],
    "Frostfang Village": [
        interlude("Frostfang Village", 20, "The Unsworn", [
            pg("Hazard Pay", "Second roll call, a bare-wristed woman leaning on the roll stone", "Kite Harrow",
                "You're staring at my wrist. Everyone does. Bare as a baby's, isn't it. I'm contract. Central license. The Count pays me DOUBLE, and do you know what the line item calls it? Hazard pay.",
                "The hazard is that I can leave. That's the whole hazard. I can walk off mid-job, so I cost twice what a marked soldier costs, since he can't. You're new enough that your face still shows things; watch your face hearing that.",
                "This village will pay for anything except the risk of somebody choosing to stay.",
                "I've worked all four anchors, little intake. Every one prices something strange. Here they price the door."),
            { ...pg("The Outside View", "The wall walk, lantern lines humming overhead", "Kite Harrow",
                "Free tour, since you carry my kit like a professional. That litany they sang you at intake. Checked, counted, kept, warm. Pretty, isn't it.",
                "Now watch the gate do the litany's real work. It doesn't look at faces. It reads wrists. A man could stand right in front of it, freezing, and it would still only ask whether his mark is valid.",
                "That's your whole village in one gate. The Roll is people calling for people. The Count is wrists. And somewhere, quietly, they decided the wrist was the person.",
                "I've worked all four anchors, little intake, and each keeps a strange secret. This one keeps its warmth under the floor, and it isn't firewood down there. But that's a lesson for a colder night."),
                choices: [
                    { text: "Share your fire and rations with her at the change of watch.", nextPage: 2 },
                    { text: "Ask to read her license. All of it, terms included.", nextPage: 2 },
                    { text: "Call the next name on the roll and turn your back.", nextPage: 2 }
                ] },
            pg("The Anomaly", "The watch fire, snow ticking into the flames", "Kite Harrow",
                "Habit of trade: I price everyone I work beside. Insurance rates, you understand. Yours won't resolve.",
                "I priced your loyalty: no seller. Priced your exit: no listing. It's as if the market that runs this whole coast can't find you on the shelf, and I have never once seen that, and I appraise for a LIVING.",
                "So here's my card. When this place shows you what it keeps under the warm floor, and it will, find me. I do honest books for interesting people. First consult free.",
                "Fire's yours, intake. I sleep colder than the Count and better than the counted. There's a lesson in that somewhere, and it's not on the license."),
        ], [
            ch("Walk her to the gate at watch-end, past every staring wrist.", "good", "ff20-shared-the-fire", "She matches your pace and says nothing until the gate plate. 'That cost you standing with the wall,' she says. 'It bought you more with me. I keep honest books.' The plate reads her bare wrist and files nothing, and she grins at it like an old joke."),
            ch("Read the license terms twice and memorize the exit clause.", "neutral", "ff20-read-her-license", "Clause nine: the contractor may terminate at will; the Count may not compel return. One sentence, notarized in Central, and it makes her the freest person inside these walls. You memorize its grammar, word for word. Documents that terms-bound things must obey: that knowledge will hold a door open later."),
            ch("Turn your back and answer the roll louder than anyone.", "bad", "ff20-called-the-next-name", "You give the Count your voice at full parade volume and let the unsworn woman watch you choose the wall. She leaves a card wedged in the roll stone anyway. 'For when the litany runs out of verses,' it says. The frost takes the ink slowly, like it's savoring."),
        ]),
        interlude("Frostfang Village", 30, "The Ridge Roll", [
            pg("Nineteen Days", "The north tower at night watch, Yura with the roll book nobody assigned", "Captain Yura",
                "You're early for watch. Good. Sit. You get to see the one thing I do that isn't in any drill book.",
                "Ridge post four. Nineteen days, one storm, three dead, one survivor. The Count struck the whole post afterward: bad numbers make bad reading, so procedure simply ATE it. There is no ridge post four in any book in Sova's room.",
                "So once a month I call its Roll myself. Solvei. Brahm. Ketta. Dren. Present or accounted for, every one, by ME, because a name that nobody calls is dead twice.",
                "Sit through it once. Then you'll know what I am under the rank bar, and you can decide what to do with knowing it."),
            pg("The Struck Roll", "The tower rail, four names said into falling snow", "Captain Yura",
                "Solvei. Present in the gloves on my hands; she knitted them on day four and mocked my stitches. Brahm. Present in every kit check I run too hard. Ketta. Present. She sang, and I don't, and that's how she's present.",
                "Dren Coldewe. Present... somewhere. He walked out on day six, and the Count calls him deserter, and on day nineteen SOMEBODY dragged me off that ridge, and command logged it self-recovery, and I let them, because I was young and grateful and the litany has no verse for a miracle with no mark on it.",
                "And then my own name. I answer it last, every month. Because a post roll isn't finished until every name answers, and for nineteen days on that ridge, mine didn't. Nobody's did. That is what OUTSIDE the Count means, and I hold the memory of it the way you hold a burn.",
                "That's the ritual. Now you know where every order I give you comes from."),
            pg("What You Do With Knowing", "The tower, the roll book closing, snow easing", "Captain Yura",
                "So. My own captain thinks I'm the Count's truest believer. Sova thinks I'm her best argument. Kael pinned my rank on personally, twice.",
                "And the truth is I'm a woman who calls an illegal roll for the dead once a month and answers her own name at the end so the silence doesn't win.",
                "You've seen it now. The book goes back under the floorboard, and you're the only living soul who knows the board from the floor.",
                "Say something, intake. Whatever it is, say it plainly. I've had a lifetime of cadence."),
        ], [
            ch("\"Next month, call it with me. Two voices carry further.\"", "good", "yura-trust", "Something in her shoulders that has been braced for twelve years stands down an inch. 'Second watch, third moon,' she says, drill-flat, because the cadence is holding back the other thing. 'Don't be late.' You never are. The Roll has two voices now, and Solvei's gloves get mentioned twice as often."),
            ch("\"The dead got a better captain than the Count did. Both true.\"", "neutral", "yura-respect", "She turns that over the way she checks a knot: twice, by feel. 'Both true,' she agrees finally. 'I can live inside both true.' The book goes under the floorboard, and she starts assigning you the north watch more often, which in her language is a medal."),
            ch("Ask why she never reported who really pulled her off the ridge.", "bad", "yura-fear", "The book closes with a sound like a gate. 'Because the answer breaks the Count, and I wasn't ready to live in the wreckage.' She looks at you a long, level moment, filing something. 'And now a person who asks questions like that knows my floorboard. Sleep well, intake.' The next watch roster has you posted south, away from the tower, for a month."),
        ]),
        interlude("Frostfang Village", 42, "The Half Count", [
            pg("Evening Check", "The east gate at evening check, Private Essen in the line, loud", "Narrator",
                "Private Essen arrives at the gate check carrying a grievance the size of a sledge. His brother's posting went unlogged; the wall shows him absent without leave; the wall is WRONG, and Essen is saying so, at parade volume, to everyone in the line.",
                "He is right, too. You've seen the duty sheets. The brothers Essen are the wall's most reliable pair of lungs, and the elder one is currently freezing on an unlogged rotation because a clerk skipped a line.",
                "Ahead, at the plate, Elder Sova takes each wrist with the same two-beat litany. Check. Count. Next.",
                "Essen reaches the plate still talking. He puts down his wrist mid-sentence."),
            pg("A Half Count Long", "The gate plate, Sova's thumb resting on Essen's wrist", "Narrator",
                "Sova holds his wrist a half count past the litany. You'd miss it if you weren't watching for rhythm; nothing about her face changes at all.",
                "The frost on the plate's rim creeps TOWARD Essen's wrist, a finger-width, like something leaning in to drink.",
                "And Private Essen stops talking. Mid-word. He blinks twice, thanks the Elder politely, and walks through the gate with the unburdened stride of a man who has just set down a sledge.",
                "In the line behind him, nobody noticed anything. The check moves on. Check. Count. Next."),
            pg("The Direction of Frost", "The gate's shadow, Yura fallen in beside you, voice low", "Captain Yura",
                "You saw the half count. Don't answer; your face already did.",
                "Now think about tomorrow. Essen wakes up knowing his brother's posting was unlogged. The FACT stays. What's gone is the heat of it. He'll file a form now. The form will sit. And the wall will call that soldier a happier man.",
                "I've watched the frost grow toward wrists at that plate for years and told myself it was weather.",
                "One question, and then we never spoke tonight. Which way does frost grow, soldier? Toward cold, or toward FOOD?"),
        ], [
            ch("Find Essen at mess. Tell him what the plate took, while it's still warm.", "good", "ff42-held-the-doubt", "You sit across from him and give him back the shape of his own anger, and it's like watching a man find his keys: patting pockets, then relief, then FURY, the real kind, his own. He files nothing. He walks his brother's rotation himself, off-book, that same night, and brings him back frostbit and laughing. The doubt stays HIS now, and he holds it like you held it for him: carefully, on purpose."),
            ch("Log the half count. Time, wrist, frost direction. Just the facts.", "neutral", "ff42-kept-the-count", "You start a book of your own: plate, time, wrist, duration, and the direction the frost leaned. Within a month you have thirty entries and a pattern: the plate holds longest on the loudest. Grievance is a diet, and the gate eats best at evening check. Your book lives where Yura's lives, under a floorboard the Count never learned to read."),
            ch("Report Essen's outburst to the duty officer, by the book.", "bad", "ff42-reported-the-doubt", "You file it proper: disruption at evening check, resolved without incident. The duty officer thanks you. The next morning, Essen's file carries a flag you didn't put there, and his next three rotations run through the gate at evening check, every one. The system heard your report as a menu. You know that now. You can't un-know it."),
        ]),
        interlude("Frostfang Village", 58, "Sova's Cut", [
            { ...pg("The Records Room", "Sova's records room, ledgers to the ceiling, the vault's meter humming in the floor", "Elder Sova",
                "Close the door. Tea's on the stove. It's bad tea; confession pairs badly with good tea, I find.",
                "You've earned the plain version, so here are the four words behind the four words. The Roll is the bell. The Count is the law the bell hardened into. The Mark is the hook the law sets in your wrist. The Vault is the mouth the hook feeds.",
                "We teach children only the first of those, the Roll, because a bell calling your name sounds like being loved. We keep the other three in locked books, because a book never asks why it's warm.",
                "Here is how the mouth is fed. The vault keeps this village from freezing, and it runs on the Count. Every marked wrist that obeys while it doubts pays a small toll: the doubt sinks into the ice, the warmth rises through the floor. Ninety winters this trade has run, and in the forty since Kael took the vault, not one frozen child. That is the trade, and I have kept its ledger my whole life.",
                "Every wrist but two. Look. Bare, both of them. The keeper has to stand outside the Count, because someone must read the meter without the meter reading them. That is the exemption. It comes with the books, and I am offering you both, because the meter is climbing and my successor ought to be someone the plate cannot already taste."),
                choices: [
                    { text: "Read the meter's whole history, every winter, both books.", nextPage: 1 },
                    { text: "\"Just say the cost plainly, Elder.\"", nextPage: 2 }
                ] },
            { ...pg("Ninety Winters", "The records room, two ledgers open side by side", "Narrator",
                "It takes two pots of bad tea. Ninety winters in two columns: warmth drawn up, doubt paid down.",
                "The curve is patient and terrible. Each decade, the vault needs a little more doubt for the same warmth. The Count answers with more checks, deeper marks, longer holds at the plate. The machine isn't failing. It's HUNGRY, the way compound interest is hungry.",
                "And near the bottom of the newest page, in Sova's steady hand, a projection: the winter the toll outgrows the village. It has a date. It is not far.",
                "'Now you've read what I read every night,' she says. 'The vault has warmed this village for ninety winters. And it has perhaps six more before it must eat the whole flock to warm the barn.'"),
                choices: [
                    { text: "The offer stands.", nextPage: 3 }
                ] },
            { ...pg("Plainly, Then", "The records room, Sova's bare wrists flat on the ledger", "Elder Sova",
                "Plainly. Forty years of litany and one person asks for plainly.",
                "The warmth is bought. The currency is surrender: every marked soul pays in the exits they'll never take, the doubts they set down at my plate. I collect it. I meter it. I have watched it keep babies breathing through storms that ate whole herds, and I have watched it lick its lips at a grieving private, the same night, the same plate.",
                "I believed. Understand that. I believed the way you believe in a rope while you're climbing it, because the believing holds you up.",
                "I am still on the rope. But I have seen the anchor now, and the anchor is a MOUTH, and I keep climbing because the children are roped to me. That is my whole confession, child, and you are the first to hear it said aloud."),
                choices: [
                    { text: "The offer stands.", nextPage: 3 }
                ] },
            pg("The Keeper's Exemption", "The records room, the meter humming, the pen waiting", "Elder Sova",
                "So. The offer, formally. My books, my meter, my exemption. Bare wrists and the truth, in exchange for carrying what the truth weighs.",
                "One condition, unbendable. Captain Yura's ridge post stays out of every reckoning you ever make. That strike is the one page I falsified gladly, to keep a nineteen-day miracle from being read into a policy problem. The girl earned her ghosts whole; they are not becoming a lesson. Not while I hold a pen.",
                "The meter is climbing, child. Someone will hold these books when the hungry winter comes.",
                "What'll it be?"),
        ], [
            ch("\"Keep your exemption. I'll stay IN the Count and fix it from inside.\"", "good", "ff58-stayed-in-the-count", "Sova looks at you a long time, then nods, slowly, like a woman watching someone choose the heavier pack on purpose. 'Then I'll keep the meter honest until you're ready,' she says. She enters your refusal in the book, dated, witnessed. 'The first name in forty years to turn down warm hands. The book and I find that promising.'"),
            ch("Learn the meter's readings, but leave the exemption unclaimed.", "neutral", "ff58-asked-the-meter", "She teaches you to read the vault's hunger: draw rates, toll curves, the projection with its quiet date. The knowledge settles in you like ballast. 'Now two of us can read the winter coming,' she says, marking your page with a dried sprig of ridge-pine. 'I'm sorry twice over. Once for the weight. Once because you'll never again feel warm in this village without counting what it costs.'"),
            ch("Take the exemption. Bare wrists, the books, and the outside view.", "bad", "ff58-took-the-exemption", "The mark comes off your intake line with one stroke of her keeper's pen, and the plate at the gate stops tasting you that same night. Warm, counted by no one, reading everyone: the keeper's view is clear as ice water and twice as cold. Sova watches you take to it with an expression she keeps off the record. The book gains a second bare-wristed hand. The Count gains a blind spot shaped exactly like you."),
        ]),
        interlude("Frostfang Village", 70, "The Mark That Stays Warm", [
            pg("The Warm Room", "The vault antechamber, unnaturally warm, a presentation case on black felt", "Seal-Keeper Vess",
                "Come in, come in. Feel that? Warmest room in the village. Perk of the trade. I'm Vess. Seal-Keeper, third generation, and tonight I have the pleasant duty.",
                "By commission of the Kage himself: a holder-grade mark. The tenth ever cut in this village. Not the recruit's line, not the officer's script. The HOLDER'S mark.",
                "The other marks bind you to the Count. This one binds the Count to YOU. People pledged to your name, wrist-deep. Wherever you fall, they come. They can't not. Guaranteed rescue, for life, written into other people's arms.",
                "The Kage's words, exact: 'That one keeps walking out of my Count. Offer the anchor.' Captain Yura stands witness, as ordered. Shall we begin?"),
            { ...pg("The Plate Remembers", "The antechamber's mark plate, fogging before your wrist even touches", "Seal-Keeper Vess",
                "Wrist on the plate for the fitting, and... there. There it goes AGAIN. Fogging. Same as your intake, it's in the file, I read everything.",
                "Look at the frost script. It's not fitting you. It's ANSWERING you. That's a name coming up. That's... hm. That name was struck before I held this office.",
                "I'll say this once, quietly, as a professional courtesy, and then I'll say the ceremonial words as ordered. Plates don't misread, friend. Plates COLLECT. Somewhere, sometime, an exit was surrendered in your name, before you ever walked our gate. The vault holds a piece of you it never met. It's been holding it so long the interest alone could warm a district.",
                "Now. Ahem. 'The Count honors its strongest.' Wrist, whenever you're ready. Or never. The second option is also a fitting, of a kind."),
                choices: [
                    { text: "You stood in the Count to guard others. Ask what the vault holds of YOURS.", nextPage: 2, requireTrait: "ff4-count-protector" },
                    { text: "You came to be the strongest back. Look at what they anchor strength TO.", nextPage: 3, requireTrait: "ff4-count-strongest" },
                    { text: "You came repaying a rescue. Ask who paid for yours.", nextPage: 4, requireTrait: "ff4-count-repayer" },
                    { text: "You came seeking who walked away. The plate just said a struck name.", nextPage: 5, requireTrait: "ff4-count-seeker" },
                    { text: "Your why never came. Look at the line where it should be.", nextPage: 6, requireTrait: "ff4-count-unknown" },
                    { text: "Take your wrist off the plate and ask Vess for the ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Guard's Reason, Audited", "The antechamber, your intake line copied out in Vess's file", "Narrator",
                "Vess pulls your intake copy, because you ask, and because keepers love an excuse to open files.",
                "There is your why, in Sova's hand: so the cold takes nobody on my watch. And pressed over it, older than your intake, a collection stamp. The vault marked your line PARTIALLY HELD before you ever spoke it.",
                "You came to guard people. Somewhere before this village, somebody surrendered the exit that watch-standers need most: the choice to stop. Yours was banked before you knew you had it.",
                "You have been standing a watch you never agreed to for as long as you can remember. Tonight the plate finally said so out loud."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Strong Back, Audited", "The antechamber, your intake line copied out in Vess's file", "Narrator",
                "Vess pulls your intake copy, muttering about irregular stamps.",
                "There is your why: the strongest back in the pack. And pressed over it, older than your intake, a collection stamp. PARTIALLY HELD.",
                "The strongest backs, the vault knows, are the ones that cannot put the load down. Somewhere before this village, somebody surrendered your setting-down. The strength stayed; the exit from it went to the bank.",
                "You have been carrying without the option of not-carrying for as long as you can remember, and calling it a virtue, because what else do you call a door you can't find."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Debt to Pay, Audited", "The antechamber, your intake line copied out in Vess's file", "Narrator",
                "Vess pulls your intake copy, and his professional patter dies halfway through.",
                "There is your why: someone came for me once; I'm repaying it. And pressed over it, a collection stamp older than your intake. PAID, it says. Not partially. PAID.",
                "Someone did come for you once. And the vault's ledger says the rescue was PURCHASED: an exit surrendered in your name, by hands unknown, price entered, account closed. Your debt-why was never a debt. It was a RECEIPT.",
                "You have spent your life repaying a kindness that somebody else already paid for, in a currency you were never told about, and the plate has been trying to hand you the invoice since the day you arrived."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Door That Closed, Audited", "The antechamber, the fogged plate still holding its struck name", "Narrator",
                "You came looking for someone who walked away. The plate just answered your wrist with a struck name.",
                "Vess reads it twice and goes quiet in a way that keepers do not go quiet. The name on the plate was struck for desertion, long ago, in a book far from here.",
                "The person you're looking for didn't just walk away, the vault believes. They walked away and then SURRENDERED that walking, banked it, in your name, so that some door somewhere would stay open for you.",
                "You've been tracking someone who spent their exit on your account. The plate isn't confused. The plate is trying to complete a delivery it has held for years."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("A Blank Line, Audited", "The antechamber, Sova's dragged pen-line copied in the file", "Narrator",
                "Vess pulls your intake copy. There is Sova's entry: the pen-drag, the blank, the word that never came.",
                "And under it, in the vault's own frost-script, which Vess swears he did not enter and no keeper CAN enter, a single ledger line: WHY: HELD IN FULL. COLLECTION PENDING.",
                "Your why isn't missing. It was never missing. It is HELD, whole, in the vault's deep ice, surrendered before you ever reached this coast, by hands the ledger doesn't name.",
                "You couldn't answer Sova's question because the answer is in a bank, accruing, and the plate has been fogging every time it meets you because it can smell an account about to be reclaimed."),
                choices: [
                    { text: "The ledger line.", nextPage: 7 }
                ] },
            { ...pg("The Exit You Chose", "The antechamber, Vess's deepest ledger open to a page that shouldn't exist", "Seal-Keeper Vess",
                "The ledger line. Yes. I looked it up after your intake; I couldn't help it, plates don't fog for me twice a career.",
                "Here. An exit, surrendered, in your name, dated seasons before you reached our gate. And the shape of it, friend... exits have shapes, we keepers learn them... the shape of it is a WALKING AWAY. You left something, once. Completely. The kind of leaving that changes what a person is.",
                "And the world does not behave as if you did. No record anywhere behaves as if you did. Because the leaving itself was collected, banked, spent keeping something warm somewhere, and what walked on afterward is you, minus one door.",
                "The Count didn't take it; the stamp isn't ours. It's a circle, cut in quarters. Twice in forty years I've seen that mark, both times on collections from outside any village's book. But somewhere, some ledger holds your exit, paid in full. If I were you, and thank the ice I am not, I would very much want to know what I walked away FROM, and who sold the walking."),
                choices: [
                    { text: "The holder's mark still waits.", nextPage: 8 }
                ] },
            pg("The Anchor Offered", "The antechamber, the holder-grade mark gleaming on its felt, Yura at the door", "Captain Yura",
                "For the record, I'm ordered to witness, not to advise. So this isn't advice; it's just a soldier thinking out loud near you.",
                "That mark binds people to come for you whether they'd have chosen it or not. I have been on both ends of an unchosen rescue, and I can tell you which end breaks a person.",
                "The Kage calls it an honor. Vess calls it an anchor. I call it my worst night, cast in frost and offered back to me as a prize.",
                "Whatever you decide, the Count is watching. It fogged your plate twice; it WANTS a handle on you. Decide what it gets."),
        ], [
            ch("Turn the plate face-down on its felt. \"Nobody gets bound to me.\"", "good", "ff70-turned-the-plate", "You set the holder's mark face-down, gently, the way you decline a drink from someone who needs to hear no. Vess exhales like a man whose scale finally balanced. Yura says nothing at all, but at the door she gives you the salute she reserves, as far as you know, for one monthly roll call, up a tower, in the snow."),
            ch("Copy the mark's terms and pledges before you refuse it.", "neutral", "ff70-copied-the-terms", "You have Vess read out every clause while you write: who binds, how deep, what the pledged surrender and when. The grammar of ownership, in the Count's own words. Then you slide the case back. 'Declined, in full knowledge.' Vess files your copy-request with a keeper's discreet approval: the only people who read terms are the ones planning to break them properly."),
            ch("Take the holder's mark. Ten exist. Power reads power.", "bad", "ff70-took-the-hold", "The mark takes to your wrist like it's coming home, and by morning three names you barely know are pledged to yours, wrist-deep, and you can FEEL them, faintly, like tools hanging warm on a belt. The ninth and tenth holders now walk the same village. The other eight are the Kage's oldest friends. You've been dealt into a game whose table you haven't seen yet. The vault deals you in gladly. It has wanted a handle on you since your first fog."),
        ]),
        interlude("Frostfang Village", 80, "Harrow's Shortcut", [
            pg("The Forger's Bench", "An abandoned icehouse, a workbench of mark plates, Harrow in fingerless gloves", "Kite Harrow",
                "Close the door; the draft is honest but unhelpful. Welcome to the workshop. Appraiser by license, forger by education. Tonight, both.",
                "Watch. Blank plate. Frost stylus. The litany's rhythm, four beats and a hold, and... there. A mark. It'll pass any gate in this village. I've walked it through three, on three different wrists, at standard courier rates.",
                "Do you understand what that MEANS, or shall I ruin it for you? The Count doesn't verify people. It verifies RHYTHM. The whole sacred apparatus of belonging is a lock, and I picked it with a song.",
                "Which raises the professional question that's kept me up nights. If the mark is only packaging... what, precisely, is drinking through it?"),
            { ...pg("What Drinks Through It", "The icehouse bench, a forged mark held to the lamp", "Kite Harrow",
                "Here's the appraisal, free, because you're the only client I trust with it. The mark is a straw. The vault is the mouth. And the DRINK, the thing it actually sells, is the moment a person would have said no and didn't.",
                "My forgeries pass the gate but carry no drink; there's no surrender in them, I only hum the tune. Which means the Count has been logging wrists that pay it NOTHING, and it cannot tell the difference. It's a bank that can't audit its own coin.",
                "I've sold secrets to four villages and priced two wars, and I have never once held a lever like this bench. A map of every choke point in the Count's plumbing, and the skill to counterfeit its currency.",
                "So, my incorruptible anomaly: what would YOU do with a machine's own skeleton key? I've been holding three answers all week, and I don't much like any of mine."),
                choices: [
                    { text: "\"Burn the plates. Some keys shouldn't survive their locksmith.\"", nextPage: 2 },
                    { text: "\"Sell me the schedule instead. Choke points, rounds, timings.\"", nextPage: 2 }
                ] },
            { ...pg("What the Vault Pays Into", "The icehouse bench, a copied ledger diagram unrolled, Yura in from the cold at your shoulder", "Kite Harrow",
                "One more thing off the books, and then I want a drink. You asked what drinks through the mark. I went looking, and I found your lower draw. Your Vault keeps two draws, not one: local warmth on the top, thin as a courtesy, and a lower draw underneath it, and the lower one is the whole business.",
                "Look. Not rescue lines. A pipe map. It runs past your Vault and keeps going down, to the same place Stormveil's Engine pays into, and Ashen Leaf's Rootfire feeds, and Moonshadow's Mirror settles against. Every village names its sin something local. Different hymns. Same plumbing.",
                "You want the one name under all four? I say it once, over the hum of that ice, and then I collect my drink. Hollow Gate.",
                "The Vault keeps enough up here for warmth. Enough to make Kael's argument true on the worst nights. The rest goes down."),
                choices: [
                    { text: "Yura sets her hand flat on the map.", nextPage: 3 }
                ] },
            { ...pg("What Went Down", "The icehouse, Yura's bare wrist flat on the lower line of the pipe map", "Captain Yura",
                "Say that again. The rest goes down. Down THAT.",
                "Then it wasn't only warmth. Dren went down that pipe. And Kessa. Every name I ever called up a tower at strangers' midnight and answered myself, because the Count had struck them and the wall wouldn't. They didn't just freeze out there in the white. The Vault drank them.",
                "He came for me with no mark on him. The Count called that impossible, filed him deserter, and then it burned him for heat. He was a rescue, and they rendered him down into fuel.",
                "Snow take him."),
                choices: [
                    { text: "Harrow rolls the map shut.", nextPage: 4 }
                ] },
            { ...pg("Not Snow", "The icehouse, Harrow rolling the diagram shut, careful as a bandage", "Kite Harrow",
                "Not snow, Captain. Gate.",
                "I have appraised sieges and two small wars and one estate that turned out to be a prison, and I know a loss-leader when I price one. The warmth up here is the bait. The lower draw is the ledger. That is the whole ugly business.",
                "Whatever the rest of that sentence is, anomaly, it is Kael's to say, not mine. I only found the pipe."),
                choices: [
                    { text: "Hear the rest of what she holds.", nextPage: 5, trait: "ff80-named-hollow-gate" }
                ] },
            pg("The Locksmith's Choice", "The icehouse, the stove's one honest flame", "Kite Harrow",
                "You know what the funny part is? Every village prices me the same way: useful, unsworn, ultimately outside. And every village is right, except about the last part. You can't stand outside a thing that holds the heat. The cold enforces membership better than any litany.",
                "Whatever I do with this bench, know the price going in. If I burn it, I burn the best leverage an unsworn woman ever held against a machine that eats the sworn. If I use it, I become a counterfeiter of BELONGING, and I've seen what that trade does to the coin.",
                "My mother used to say: never sell the thing that proves what you are. She was a forger too. Died licensed, though. Died licensed.",
                "Your call gets a vote, anomaly. Not the deciding one. But a vote. I keep honest books, and the books say I owe you one clear-eyed listen."),
        ], [
            ch("Feed the plates to the stove with her, one by one, and witness it.", "good", "ff80-burned-the-plates", "She stacks them herself and feeds the first one in, and the frost-script sublimates with a sound like a sigh let go. 'There goes retirement plan four,' she says lightly, meaning something else. The last plate she holds a long moment. Then in. You witness, which was the actual service requested. Some choices only hold if somebody honest watched them happen."),
            ch("Buy the vault's delivery schedule and leave the bench question hers.", "neutral", "ff80-sold-the-schedule", "Straight trade, invoiced: the Count's plumbing on paper: intake rounds, plate rotations, the vault's draw windows, every choke point timed. She keeps the bench; you keep the map; the fee is real and the receipt is real, and Harrow visibly relaxes inside the honesty of a normal transaction. 'Business,' she says, stamping it. 'The one language on this coast with no hidden verses.'"),
            ch("Tell her to keep the bench live. An unsworn key-holder is useful.", "bad", "ff80-kept-her-list", "She looks at you for a long moment, recalculating something she'd priced as settled. 'A counterfeiter on retainer. Efficient.' The bench stays. The skill stays sharp. And in her book, next to your unpriceable name, she enters her first hedge against you: a list of which gates YOUR rhythm opens, kept current, just in case. You taught her that. She learns fast."),
        ]),
        interlude("Frostfang Village", 88, "The Long Lanterns", [
            pg("Ridge Post Four", "The north ridge at dusk, lantern crates in the snow, a storm wall building", "Captain Yura",
                "Ridge post four. I know. Of all the ground on this mountain, it had to be here; it's the only ridge with the sight lines. Dren would find that funny. I'm working on finding it funny.",
                "Whiteout drill tonight, a real one; that wall of weather is two bells out. We string his lanterns down the search lines, chant-spaced, and then a volunteer walks into the white unmarked, and we find them. By eye and choice and lamplight, and nothing else.",
                "Kael's wardens will log every minute of it; it's reporting season and this ridge is warded. Good. Let the Count watch itself be outdone.",
                "Dren drew these lamps to be USED, and we filed him under deserter and his lamps under processed. If the relay holds tonight, he was right, and we buried him wrong, and I want both those sentences so badly my hands won't hold drill posture. Check my knots. That's an order. Check them."),
            pg("The Volunteer", "The lantern line's first stake, Sergeant Essen shrugging off his coat's rank pins", "Narrator",
                "Sergeant Essen volunteers before Yura finishes asking. He takes off his rank pins and sets them on the crate, deliberate as prayer, and rolls his sleeve to show the gate: no fresh mark. Unlogged, unbound, findable by nothing but the lanterns and the people holding them.",
                "'My brother froze half a night on an unlogged rotation because the wall only looks for what it's holding,' he says. 'Someone walks into the white on purpose tonight, it should be a man who knows exactly what being unheld costs.'",
                "He checks the wind, notes his drift line like the professional he is, and walks into the building storm without looking back.",
                "The white takes him in four steps."),
            { ...pg("The First Line Fails", "The search line, lanterns guttering, oil thickening in the cold", "Narrator",
                "The first lantern line goes up fast and dies faster. The oil thickens in the deep cold; wicks drown; the third and fifth lamps gutter out inside ten minutes, and the line has holes in it, and a man is in the white counting on the line having no holes.",
                "Yura works down the stakes, relighting, cursing in drill cadence, which is the worst sound you have ever heard her make.",
                "It's Sova who steadies it. She arrives unasked, bare wrists in the cold, reads Dren's schematic once, and starts CHANTING: the intake litany, repurposed, four beats and a hold, pacing the wick-trimmers down the line. The checked are counted. Trim. The counted are kept. Light. The kept are WARM. Move.",
                "The litany that ran the gate now runs the rescue, and the lamps begin to hold."),
                choices: [
                    { text: "\"I asked once who really pulled you off this ridge. Wrong question, wrong reasons. Retiring it.\"", nextPage: 3, requireTrait: "yura-fear", trait: "ff88-repaired-trust" },
                    { text: "Stitch DREN COLDEWE onto the beacon banner before the second line goes up.", nextPage: 4, trait: "ff88-named-the-walker" },
                    { text: "Take the dead lamps' stakes and hold the line's gap yourself.", nextPage: 4 }
                ] },
            { ...pg("Fear, Retired", "The third stake, the two of you relighting the same lamp", "Captain Yura",
                "Logged. Don't resubmit it.",
                "You asked the one question with teeth in it, and then you watched them post me south, and you never once used what you knew. I noticed. I notice everything; it's the job.",
                "So here's how soldiers do this. You hold the wick, I hold the Roll. If Essen walks out of that white alive, you and I are square, and the roster forgets the south posting ever happened.",
                "Four beats and a hold. Solvei taught me rhythm, Dren taught me doors, and now, apparently, you're teaching me that a question isn't always a collection. Lamp's lit. NEXT."),
                choices: [
                    { text: "Down the line. Four beats and a hold.", nextPage: 4 }
                ] },
            { ...pg("Nineteen Minutes", "The full relay burning down the ridge, the search moving lamp to lamp", "Narrator",
                "The second line holds. Lantern to lantern, chant to chant, the searchers move through weather that eats plate-reads and mark-pulses alike, and the lamps just BURN, stubborn, spaced exactly at the edge of each other's glow, the way a dead man drew them.",
                "They find Essen at the fourth spur, upright, walking his drift line, half a ridge off from where the Count's models said a lost man drifts. The models assume panic. He wasn't panicking. He was TRUSTED, and he knew it, and trusted men walk straighter.",
                "Nineteen minutes, whiteout to handshake. Yura calls it aloud twice, her voice cracking on the second call, and nobody in the line pretends not to hear it: 'Found! By CHOICE, found!'",
                "On the warded rocks above, the Count's instruments log every lamp, every minute, every unmarked wrist. Let them. That was always the plan; the Count is about to file its own replacement."),
                choices: [
                    { text: "The storm passes. The Count arrives.", nextPage: 5, trait: "ff88-relay-held" }
                ] },
            { ...pg("The Drill Log", "The ridge at storm's end, the drill log open on a lantern crate", "Captain Yura",
                "Numbers first, before anyone gets sentimental. That's a direct quote from a friend of mine; she rigs cables down the coast.",
                "One volunteer, unmarked, in whiteout conditions, found in NINETEEN minutes. The vault drew nothing. The plates read nothing. The whole cost was lamp oil, wick cord, and one evening of the litany doing honest work for a change.",
                "It doesn't replace the wall. It doesn't warm the barracks. It does exactly one thing: it proves the Count's one sacred claim, that only the vault brings people home, is a LIE. And it proves it in the Count's own reporting season, on the Count's own warded ridge, in nineteen minutes.",
                "So. It works, and the wardens logged that it works. What we do next decides whose proof it becomes."),
                choices: [
                    { text: "Set Dren's letter beside the drill log. The walker and the walk, together.", nextPage: 6, requireTrait: "ff65-saved-the-letter", trait: "ff88-nineteen-minutes" },
                    { text: "Ask Yura to lay Dren's letter by the log. She's carried it since the quarry.", nextPage: 6, requireTrait: "ff65-gave-yura-the-letter", trait: "ff88-nineteen-minutes" },
                    { text: "Let the log stand on its own numbers.", nextPage: 9, trait: "ff88-nineteen-minutes" }
                ] },
            { ...pg("The Walker and the Walk", "The lantern crate, the unsent letter flat beside the log", "Captain Yura",
                "It made it here. Through the quarry and the sweep and every sensible mile since, his letter made it to this ridge, and now it lies beside the log of his lanterns working. Give me one second with that. One. There.",
                "This is the part the vault can't survive, you understand. Not the method; Kael could adopt lanterns tomorrow and call them the Count's own mercy. The LETTER proves whose method it was. A struck name, a 'deserter,' the man the Count threw away, built the very thing the Count swore was impossible.",
                "Whoever carries this pair down to the vault isn't carrying a drill log. They're carrying the whole argument: the Count was wrong about Dren, so the Count can be wrong, so the Count is not the weather. It is only a book, and books get corrected.",
                "So give me the assignment, Jonin, and make it stick. This posting does not rotate."),
                choices: [
                    { text: "\"You called his Roll for twelve years. Let me answer for him at the vault.\"", nextPage: 9, requireTrait: "yura-trust", trait: "ff88-exit-proof-ready" },
                    { text: "\"Two true things: your captain earned this, and I can carry it. Let me.\"", nextPage: 9, requireTrait: "yura-respect", trait: "ff88-exit-proof-ready" },
                    { text: "\"We squared it at the wicks. Post me as his carrier.\"", nextPage: 9, requireTrait: "ff88-repaired-trust", trait: "ff88-exit-proof-ready" },
                    { text: "\"Stand back. This is Dren's and yours. You answer his Roll; I'll hold the stair.\"", nextPage: 7, requireTrait: "yura-trust", trait: "ff88-exit-proof-deferred" },
                    { text: "\"Stand back. This is Dren's and yours. You answer his Roll; I'll hold the stair.\"", nextPage: 7, requireTrait: "yura-respect", trait: "ff88-exit-proof-deferred" },
                    { text: "\"Stand back. This is Dren's and yours. You answer his Roll; I'll hold the stair.\"", nextPage: 7, requireTrait: "ff88-repaired-trust", trait: "ff88-exit-proof-deferred" },
                    { text: "Keep the letter in your own kit. Let that be your part.", nextPage: 8 }
                ] },
            { ...pg("You Hold the Stair", "The lantern crate, Yura folding the letter into her breast pocket, drill fashion", "Captain Yura",
                "Good. Then I answer his Roll, and you hold the stair. Don't argue the split; holding the stair against what's coming is the heavier post and we both know it.",
                "Twelve years I've called his name up a tower at strangers' midnight and answered the silence myself. Tomorrow I get to answer it TO the man who struck him, with his own letter in my hand.",
                "I drafted a speech on the walk up. Drill-perfect, three points, a close. It's gone. All I've got left is: he came back for me, and nobody made him, and that's the whole doctrine of everything.",
                "That'll do. It held on a ridge for nineteen days. It'll hold one more stair."),
                choices: [
                    { text: "Let it be hers to answer.", nextPage: 9 }
                ] },
            { ...pg("Kept, Not Carried", "The lantern crate, the letter going back into your kit, Yura watching", "Captain Yura",
                "You're keeping him. In a kit bag. After tonight.",
                "I'm not angry. Note the date; it won't repeat this season. You pulled his kit off a windbreak in a quarry when no one was looking for it, and I will owe you that until the last roll call. The FULL weight of it, no shortcut.",
                "But hear the drill report before you go down. A letter in a kit is a casualty list, Jonin. It counts the dead. It brings nobody home.",
                "Carry him warm, then. Just know that Kael reads casualty lists every morning of his life, and he has never once mistaken one for a rescue."),
                choices: [
                    { text: "Keep the letter. Walk down.", nextPage: 9, trait: "ff88-unfinished-answer" }
                ] },
            pg("Whose Proof It Becomes", "Dawn on ridge post four, the lanterns still burning past need", "Narrator",
                "The storm dies at dawn, and nobody moves to douse the relay. The lanterns burn down the ridge in the gray light, spaced like a sentence somebody finally finished saying.",
                "Essen stands his post at the line's end, rank pins back on, a man who walked into the white unheld and came back believing something with his whole spine. Sova sits on a crate with her bare wrists in her sleeves, humming the litany at its new job.",
                "Yura walks the line one last time, touching each stake, a captain inspecting the first defenses she has ever fully believed in.",
                "The wardens' report is already moving down the mountain. One decision is left on this ridge, and it is yours."),
        ], [
            ch("Wake the wall rows. Let the village see the relay burning from the gates.", "good", "ff88-woke-the-rows", "By full light half the wall watch has found a reason to walk the north road, and they stand in ranks at the ridge foot, staring up at a line of lamps that found a man with no mark on him. Rescue without the vault, visible from the village gates. The Count can seal a doubt. It cannot seal a thing four hundred people watched burn."),
            ch("File the drill log properly: witnessed, countersigned by Sova, entered.", "neutral", "ff88-logged-the-drill", "You and Yura write it up drill-flat: times, spacings, zero draws, found by choice. Sova countersigns with the keeper's pen, which has never once signed a thing the meter couldn't verify. The log enters the records room before the wardens' version reaches the vault. When the Count reads about tonight, it will read it in its own format, unbreakable, already filed."),
            ch("Let the wardens' report run ahead, unchallenged, straight to Kael.", "bad", "ff88-baited-the-wardens", "You add nothing, correct nothing, let the Count's own instruments carry the news up the mountain in the Count's own voice. A report Kael cannot dismiss, because dismissing it means dismissing the wards, and the wards are HIS. You used the machine's eyes to show the machine its ending. Yura watches you let it happen, admiring and uneasy in the same breath."),
        ]),
        interlude("Frostfang Village", 92, "Witnesses", [
            pg("The Cairn Road", "The vault road at dawn, cairns marking the miles, figures waiting", "Narrator",
                "Word has moved through Frostfang the way heat moves through a wall: slowly, then all at once. At tonight's bell, the one the plate can't read walks down to the vault, to put a question to the Kage that only the meter can answer.",
                "Figures wait along the cairn road. Not a formation. Just people, standing at intervals their whole lives have been drilled into, holding lanterns they made themselves this week, copied off a dead man's pattern.",
                "The lamps are everywhere now. That's the thing about a design that works: it doesn't need permission twice.",
                "At the first cairn, a runner from the glacier waits with a message."),
            { ...pg("The Camp's Message", "The first cairn, the Pale Pack Runner with frost in her hood", "Pale Pack Runner",
                "Message from Marrin, memorized, so mind the wording; she made me say it back to her twice.",
                "'If the vault breaks tonight, the Pack comes down at next bell and answers one roll call, freely, in the forecourt. Struck names, standing in the Count's own yard, present by choice. Not because we forgive it. Because somebody has to show this village what a Roll sounds like when every answer is a decision.'",
                "That's the message. My own postscript: I carried a lantern pattern back to the glacier last month, and there are forty of them burning up there now. We didn't wait for your drill to believe it, wall-walker. We only waited for someone down here to prove it OUT LOUD.",
                "Walk well. The cold's honest tonight. Everything else is up to you people with doors."),
                choices: [
                    { text: "\"Dren's letter goes to the vault tonight. Carried by the one he came back for.\"", nextPage: 2, requireTrait: "ff88-exit-proof-deferred" },
                    { text: "Show her the drill log's numbers first.", nextPage: 3, requireTrait: "ff88-logged-the-drill" },
                    { text: "\"Walk the road with us as far as the wall.\"", nextPage: 4 }
                ] },
            { ...pg("The Letter Walks Point", "The cairn road, Yura with the letter squared in her breast pocket", "Captain Yura",
                "You were right to make it mine. I fought you on the ridge; consider the fight withdrawn, with commendation.",
                "His letter, his lantern plans, and one line of his handwriting that outweighs every ledger in Sova's room. That is the whole kit of Dren Coldewe, deserter, and it beats the vault, and I get to say so at the door the Count built out of him and me both.",
                "You walk me to the stair. Past that, this part is mine and his: I answer his Roll where the striking happened. You hold the door for the ones coming after.",
                "Post assignments clear? Good. Best duty roster I've ever written. Move out."),
                choices: [
                    { text: "Walk her to the wall.", nextPage: 4 }
                ] },
            { ...pg("The Log, Read Aloud", "The first cairn, the drill log open between mittened hands", "Pale Pack Runner",
                "Read it to me. I memorize things; it's the whole job. Go slow on the numbers.",
                "Nineteen minutes. Zero draws. Zero reads. Countersigned by the keeper of the litany herself. Say that last part again... yes. YES. Do you know what Sova's signature means up the glacier? She entered half of us in her book once. Her pen striking FOR us, instead of through us... Marrin will want that word for word.",
                "The Count taught this whole mountain that belonging is a mark or it's nothing. One page of honest numbers, and tonight the mountain gets to read the third option.",
                "I'll have it memorized by the second cairn. By the bell, the glacier will have it too. Paper burns, wall-walker. A memorized number is forever."),
                choices: [
                    { text: "Walk on to the wall.", nextPage: 4 }
                ] },
            { ...pg("The Slow Count", "The wall checkpoint, Sergeant Essen counting the road's walkers with theatrical care", "Narrator",
                "The checkpoint at the wall should stop everything tonight: irregular movement, unlogged lanterns, a crowd with no rotation orders.",
                "Sergeant Essen stands the post. He counts the walkers one at a time, aloud, with enormous procedural dignity, and the tally keeps, somehow, arriving at numbers that require no report. 'Eleven,' he announces, of forty. 'Well within norms.'",
                "As you pass, eyes front, voice level: 'The latch on the great hall door is still faulty, by the way. Terrible workmanship. A crowd could walk right through. I've filed my concerns. Processing takes SO long this season.'",
                "And then, quietly, no theater at all: 'My brother walks the ridge rotation tonight with a lantern of his own. First shift he's ever volunteered for. Whatever happens down there, Jonin... that already happened. Nobody can unlight it.'"),
                choices: [
                    { text: "\"Stitch your brother's name next to Dren's on the banner when this is done.\"", nextPage: 5, requireTrait: "ff88-named-the-walker" },
                    { text: "Return his count, straight-faced: \"Eleven. Well within norms.\"", nextPage: 6 }
                ] },
            { ...pg("The Banner of Walkers", "The checkpoint, the beacon banner unrolled a hand's width", "Narrator",
                "You show him the banner's corner: DREN COLDEWE, stitched in wick-cord, and beneath it, room left deliberately bare.",
                "Essen looks at the empty space for a long moment, counting the names that could live there. His brother's. His own. Every walker the Count ever filed as a number.",
                "'Stitching's poor,' he says at last, thickly. 'Whoever did that corner pulled the cord too tight. I'll redo it. I'll... we'll need a bigger banner, is what we'll need.'",
                "He waves you through his checkpoint without counting you at all, which from Sergeant Essen is a flag raised over a whole life."),
                choices: [
                    { text: "The last cairn.", nextPage: 6 }
                ] },
            pg("The Keeper on the Road", "The last cairn before the vault stair, Sova waiting with the Count book bound for travel", "Elder Sova",
                "Forty years I've waited at plates for other people's wrists. Tonight I waited at a cairn for a person. The improvement is considerable.",
                "The book comes with you. All of it: ninety winters, the toll curve, the projection with its ugly date, and the drill log with my countersign. If you mean to argue with Kael, arguments need documents. If you mean to break the vault, breakings need a keeper who testifies that the books demanded it. Either way, I walk down that stair tonight.",
                "One request, when it's done. The litany was mine before it was the gate's. If any of it survives what's coming, let it be the version that lights lamps. I should like to die having written one thing that only ever fed people.",
                "Now. The stair is lit, the door is 'faulty,' and the meter is at its last markings. Let's go see what my book has been adding up to all these years."),
            pg("The Rows Answer", "The vault forecourt, the White Silence in its rows, lanterns gathering behind", "Captain Yura",
                "Look behind you. No. Really look.",
                "The wall watch came off the wall. Essen's whole gate crew, off duty, lanterns up. The Pack is on the ridge line waiting for a bell, and the village is standing in its own forecourt in the cold, nobody ordered, nobody counted, everyone HERE.",
                "And look at the rows. The frozen ones. The village stopped walking around them tonight. People are standing WITH them, matching the rows, lantern to a shoulder, name to a name. Calling roll for the ones who can't answer. The White Silence has four hundred voices now.",
                "So decide how you want to go down that stair, because everyone in this forecourt goes down it with you, one way or another."),
        ], [
            ch("Walk down slow and open, every lantern welcome behind you.", "good", "ff92-called-the-camp", "You take the stair at drill pace with the forecourt's light pouring down behind you, four hundred lanterns and the glacier's forty answering from the ridge. The vault has never heard the Roll arrive as a CHOICE before. The meter's hum stutters, recalculating what it's owed by people who owe nothing and came anyway."),
            ch("Go down with Sova's book and Yura's kit: keeper, captain, case.", "neutral", "ff92-took-her-terms", "Three of you on the stair: the keeper with ninety winters of ledgers, the captain with a dead man's letter, and you with the drill log. Everything the vault is about to face, it will face in its own languages: accounting, testimony, procedure. The forecourt holds the surface. The case walks down. Kael will get exactly the trial he'd have designed himself, which is the cruelest mercy on the mountain."),
            ch("Send the Echo ahead with a message: the Count is coming to be counted.", "bad", "ff92-sent-the-warning", "You catch a corrected sentry at the stair head and give it, in its own flat grammar, one report to carry down: THE COUNT IS COMING TO BE COUNTED. It walks the message into the deep like a bell tolling itself. Below, the meter's hum climbs to something like alarm, and Kael, who has stood unhurried at his post for forty years, is heard, for the first time, to bar a door."),
        ]),
    ],
    "Moonshadow Village": [
        interlude("Moonshadow Village", 20, "The Unsworn", [
            pg("Bought and Sold", "The whisper market after curfew, Harrow at a booth counter with receipts fanned like a card hand", "Kite Harrow",
                "There you are. Sit. I bought you a drink, which around here means I bought the fact that you drank it, so mind the symbolism.",
                "I did some shopping today, strictly professional. Your real name: forty ryo, from a registry clerk with gambling debts. Your movement patterns: thirty, from a stall-keeper. And the fact that you once trusted somebody here with something that mattered, sixty, from a third party I won't name on principle, which around here counts as wild romance.",
                "One hundred thirty ryo, friend. That's you, retail. I've bought war plans for less.",
                "My client is building a book on everyone in this intake class. I take the fee, I file the pages. But you bought me tea in Stormveil once and asked nothing, so consider this disclosure my exchange rate. Everyone here is inventory. The only variable is who's holding your page."),
            { ...pg("The Going Rates", "The booth, Harrow tapping the receipts in order", "Kite Harrow",
                "Since you're not screaming, here's the part worth screaming about.",
                "A name is forty. Trust exercised, sixty. But do you know what a WITNESSED name costs, one said out loud in front of people, on purpose? There's no listing. It doesn't trade. The moment a thing is publicly, freely KNOWN, the market can't hold it, so the market pretends it doesn't exist.",
                "This whole village floats on the difference between a secret sold and a truth said, and everyone here has picked which economy they live in without ever noticing there was a choice.",
                "That's the appraisal, no charge. What you do with it prices YOU, so do it thoughtfully."),
                choices: [
                    { text: "\"Then witness this: I trust you. Said out loud. Unlisted.\"", nextPage: 2 },
                    { text: "Ask exactly what her client's book pays per page.", nextPage: 2 },
                    { text: "\"An appraiser who tips her subjects is a bad appraiser.\"", nextPage: 2 }
                ] },
            pg("The Blank Listing", "The booth, the market's lanterns doubling in the canal", "Kite Harrow",
                "You know what's professionally upsetting about you? I tried to complete your page for the client. Standard workup. And your file won't BALANCE.",
                "Your name I bought. Your habits, fine. But the thing every page needs, the column that makes a person tradeable, what you'd sell everything else to keep or keep everything else to buy... it's not that you're hiding it. It reads like somebody already BOUGHT it, before any of us got a look, and the market can't list what's previously sold.",
                "I filed you as incomplete. The client pays half for incomplete. Worth it. Some pages I'd rather not be the one to finish.",
                "I'm here through the season. If you ever find out what was taken off the market before you reached it, bring it to me first. I'll appraise it honest, and I won't buy it. That combination is rarer on this canal than free."),
        ], [
            ch("Walk her through the market openly, her receipts in your hand.", "good", "ms20-respected-the-unsworn", "You carry her paperwork through the whisper market in the open, unhooded, and the booths watch an unsworn broker treated like a person by the intake the Mirror reads late. 'That cost you your mystery discount,' she says at the gate. 'It bought you more with me. I keep honest books.'"),
            ch("Buy your own name back from her at her cost. Business is business.", "neutral", "ms20-measured-the-unsworn", "Forty ryo, receipt issued, your name off her client's page and into your own pocket. She stamps the transfer with visible satisfaction: clean trades are her love language. 'Most people rage at the market,' she says. 'You just USED it. The client's book has a hole now, and the hole is shaped like you, and you own the shape. Tidy.'"),
            ch("Tell her hired ledgers don't get warnings, and walk.", "bad", "ms20-dismissed-the-unsworn", "You leave her holding her receipts and her half-fee, and she watches you go with the expression of an appraiser adding a line to a page. The line, you'll learn much later, reads: 'Subject undervalues allies. Exploitable.' She leaves a card at your quarters anyway. 'For when you learn what things cost here.' The card smells faintly of canal water and patience."),
        ]),
        interlude("Moonshadow Village", 30, "One True Thing", [
            pg("The Verified Truth", "Nyx's stall over the dye canal, one lamp, one slip of paper face-down", "Nyx",
                "Sit. You're my last customer tonight, and I saved you the good stool, which is the one that doesn't wobble. In this village that's practically a dowry.",
                "Tonight's product: one verified truth, prepaid by me, sold to you at cost. Here it is. The friendly trainee from your yard, the one who spars kindly and asks after your day? Files reports on you. For meal chits. Twice a week, regular as rent.",
                "Verification slips are under the paper. Handwriting analysis included, and here's the detail you're paying cost for: the handwriting goes SLOPPY where they wrote about you being kind. Guilt does that to a pen. They hate the job. They do the job. Both true; this village runs on both-true.",
                "And the slips show who brokered the arrangement upstream. A mark I keep seeing lately. A circle, quartered. Buying the strangest little product: proof of who people are NICE to."),
            pg("The Cost Price", "The stall, Nyx flipping her not-coin, catching it without looking", "Nyx",
                "Why at cost? Because I don't like the client, and disliking clients is a luxury I budget for annually. This year's allowance is you.",
                "Rule of my stall, and I'll say it once because twice is free and nothing here is free: I sell true things. Only true things. A dealer who sells one lie is a lie retroactively; every slip I've ever verified goes bad at once. My whole ledger is one long dare.",
                "So when I tell you a thing with no receipt attached, and someday I might, you'll know exactly what it's worth. Everything. It'll be worth everything.",
                "That's not tonight. Tonight is commerce. But I like to file the paperwork for a thing before I need it. Habit of the trade."),
            pg("What the Stall Holds", "The stall, the lamp low, the canal talking to itself below", "Nyx",
                "You're going to ask why I'm in this trade, because everyone eventually asks, and I'm going to answer with the price list, because the price list is the honest autobiography.",
                "Verified truths: my rates are the fairest on the canal, ask anyone. Rumors: I don't carry them. Comfortable lies: try the next stall, they stock nothing else. And buying back things you sold in a bad winter: ask me the rate sometime when I'm drunk enough to say there isn't one. Some purchases don't reverse, friend. You just build a stall on top of the crater and keep the books straight.",
                "There. Most honest thing anyone's sold you in this village, and it cost you a stool-sit.",
                "So. You know what I sell. Question on the table is what you're buying, long-term, from ME. Choose the words with care; I verify everything."),
        ], [
            ch("\"Partners. Your verification, my reach. Profits and risks split even.\"", "good", "nyx-partner", "She doesn't answer fast, which is the tell that it matters. Then she writes a contract on a verification slip, three lines, fair to the letter, and signs it with her working name. 'Partners,' she says. 'The stall's first. Don't make me price a dissolution; I'd have to invent the mathematics.' The not-coin goes in a drawer. Retired."),
            ch("\"A customer. The reliable kind. Standing order on true things.\"", "neutral", "nyx-respect", "'A regular,' she says, nodding slowly. 'I can build on a regular.' She opens a page for you in the good ledger, the one she keeps in cipher, and quotes you the honest rate: friend prices, minus the friendship, which around here is the safest kind of arrangement. Every truth you buy after this is triple-checked. You'll never know how many other customers get the single-check tier, and that's the point."),
            ch("\"I'll take the trainee's reports themselves. Copies. Weekly.\"", "bad", "nyx-suspicion", "One beat of silence, one raised eyebrow, and then the professional mask, seamless: 'Counter-surveillance. Of course. It's a stock product.' She quotes a rate; you pay it; the copies arrive weekly, punctual as guilt. And somewhere behind the seamlessness, a dealer who tests everyone files her first verified truth about you: given the choice between trusting a person and reading their file, you chose the file. She never mentions it. Her prices mention it."),
        ]),
        interlude("Moonshadow Village", 42, "The Cold Pipe", [
            pg("The Listening House", "The Listening House roof at courier hour, booths glowing below like coals", "Narrator",
                "The courier drop is routine: wait on the Listening House roof, take the sealed packet at the bell, ask nothing. Moonshadow assigns its new Jonin the boring nights first, to see what they do with boredom.",
                "What you do is feel the roof HUM.",
                "Under the tiles, a copper pipe runs warm-cold-warm, like something swallowing in intervals. It runs from the confession booths below, down through the house's bones, toward the canal. Toward the tower. You put your palm on it, and at the next swallow, the cold PULLS.",
                "Below, a confessor steps out of a booth with the eased shoulders of a woman who has set something down. She stops on the steps. Blinks too long at a neighbor's face, like the name needs looking up. Waters the step-plant twice. Then goes home, lighter, minus the weight, and minus, in some small way you now cannot unsee, the OWNER of the weight."),
            pg("Following It Down", "The house's maintenance crawl, the pipe descending in the dark", "Narrator",
                "You skip the courier bell. Some packets can wait; some pipes cannot.",
                "The pipe drops through the Listening House like a root: past the booths, where each confessional's floor drain feeds it; past a junction chamber where nine pipes from nine houses converge; down, always down, running colder as it goes, toward the underdark of the canal and the tower's foundations.",
                "At the junction, a maintenance ledger hangs on a nail, unhidden, banal as a mop: flow rates by booth, by hour, by TYPE. Grief runs richest. Confession of debt runs thin. First-trust runs rarest, marked at a premium.",
                "Somebody meters this. Somebody has ALWAYS metered this. The booths aren't sanctuaries with a flaw. They're intake with a bench."),
            pg("The Drain's Direction", "The junction chamber, nine pipes breathing cold", "Narrator",
                "Every pipe runs toward the tower. Of course it does. But at the junction's low corner, one older pipe splits DEEPER, past the tower's foundations, down into stone the village never mapped, marked with one worn glyph: a circle, quartered.",
                "The tower drinks the booths. Something below drinks the tower. The plumbing of this entire village is one long throat, and everyone upstairs is arguing about who holds the cup.",
                "The courier bell rings above, twice, annoyed.",
                "You have perhaps a minute to decide what tonight's boredom becomes."),
        ], [
            ch("Report the pipe to the watch, in writing, signed with your rank.", "good", "ms42-reported-the-booths", "You file it formally: the booths drain, the drain is metered, the meter feeds the tower and below. Signed, ranked, dated. The watch clerk reads it with the gray face of a man handed a live coal, and files it upward, because upward is the only drawer he has. It will be intercepted, of course. Read by her. Eleven times, as it turns out. Some reports are doors, and you knocked."),
            ch("Copy the flow ledger and say nothing. Meters can be read both ways.", "neutral", "ms42-kept-it-quiet", "You copy nine houses' intake rates into your own cipher and rehang the ledger to the dust-line. Now you can read the village's harvest like a broker reads a season: which districts grieve, where trust runs rich, when the tower drinks deepest. Knowledge without a signature: the safest currency on the canal, and the loneliest. The pipe swallows behind you as you leave, indifferent, well-fed."),
            ch("Drop a verified lie into a booth and time what the pipe does with it.", "bad", "ms42-tested-the-drain", "You enter a booth and confess, fluently, a magnificent grief that never happened. The pipe drinks it and runs WARM: the drain can't tell invented weight from real, or doesn't care to. You've just learned the system's deepest flaw, the one Harrow found with forged marks and a stylus: the machine meters surrender, not truth. It can be fed. Things that can be fed can be led, and things that can be led belong, eventually, to whoever holds the better menu."),
        ]),
        interlude("Moonshadow Village", 58, "Iro's Cut", [
            { ...pg("Below the Auction Floor", "The archive below the auction cellar, shelf after shelf of held files, Iro with a lamp", "Shade Master Iro",
                "Mind the third step; it lies. Welcome to the archive. Every intake file, every drained confession, every purchased page from forty years of honest trade. The booths feed it; the cellar prices it; the tower borrows against it. I merely... curate.",
                "You've been down the pipe, I'm told. Metaphorically. Possibly literally; you have the knees of somebody who takes crawlspaces personally. So let's skip the denials; they bore us both.",
                "Yes, the village drinks its people. Yes, I profit. My share of the intake is the third largest after the tower, and I have never once pretended otherwise to anyone who paid to ask.",
                "Which brings us to tonight's offer, friend, and I do suggest sitting down. The wobble in that stool is complimentary."),
                choices: [
                    { text: "\"You watched me test the drain. That's why I'm getting the tour.\"", nextPage: 1, requireTrait: "ms42-tested-the-drain" },
                    { text: "Hear the offer standing.", nextPage: 2 }
                ] },
            { ...pg("The Fed Lie", "The archive, Iro's smile arriving before his answer", "Shade Master Iro",
                "The invented grief. Booth six, courier hour, a vintage performance by all accounts; the meter logged it premium-grade.",
                "Oh, don't look alarmed. Only two people alive read that meter, and the other one is upstairs pretending the pipe is a rumor. You FED the system a fiction and it paid full price. Do you know how long I've waited for somebody else to run that experiment? Forty years. I ran it myself at your age. Fed the booths a fake bereavement and watched the tower bank it.",
                "That was the night I stopped believing the machine was divine and started TRADING it like the commodity it is. Belief is for the booths, friend. Merchants read meters.",
                "Which is exactly why you're getting tonight's offer, and nobody else in your intake class ever will."),
                choices: [
                    { text: "The offer.", nextPage: 2 }
                ] },
            { ...pg("A Shelf of One's Own", "The archive's private row, one empty shelf with a fresh brass nameplate", "Shade Master Iro",
                "Here it is. Your shelf. Custody of your own file, full and final: nothing on you enters this archive without landing HERE, under your key. Plus reading rights, friend. Editing rights, on anyone's page, at need.",
                "The fee is elegant. One secret a month, deposited fresh. Yours, or better, somebody else's; the archive isn't sentimental about provenance. Compounding, naturally. The rate doubles every year you hold the key, because the longer you hold it, the more you'll pay to keep it, because that, friend, is what keys DO.",
                "Every elder took this deal. Every Kage but one. The one who refused died poor and, I'm obliged to report, smiling, which I've never fully forgiven him for.",
                "So. The shelf, the key, the fee. Or the long cold canal of being READ your whole life by people who own shelves. Moonshadow's whole menu, friend, and I am, whatever else they say of me, an honest waiter."),
                choices: [
                    { text: "Decide at the shelf.", nextPage: 3 }
                ] },
            pg("The Waiter's Honesty", "The archive, the nameplate blank and shining, Iro's lamp steady", "Shade Master Iro",
                "Before you answer, one disclosure, gratis, because you've been polite and the hour is late and even a profiteer keeps a private religion.",
                "I have held my shelf for forty years. The fee stands at three hundred and eleven secrets, compounding. I own more of my neighbors than the tower does. And I cannot leave, friend. Not the archive, not the trade, not the village. A man who holds this many pages IS a page; the market would liquidate me at the border like a returned deposit.",
                "The shelf is real. The key is real. The cage is also real, and it is the same object. I'd have wanted the whole appraisal, at your age. Nobody sold it to me.",
                "The lamp's yours to hold either way. What'll it be?"),
        ], [
            ch("\"Keep the shelf. I'd rather be read than become a reader.\"", "good", "ms58-refused-the-shelf", "Iro looks at you for a long moment, then laughs, once, genuinely, a sound like a coin finding a beggar. 'The second refusal in forty years,' he says, and writes your name not on the brass plate but in a small book from his breast pocket. 'The first one died smiling, as noted. Do keep me informed of your health, friend. I keep one hopeful file, and you are now both entries in it.'"),
            ch("Note the shelf's terms in full and leave the plate blank. For now.", "neutral", "ms58-took-note", "You have him recite every clause while you copy: the fee, the compounding, the editing rights, the liquidation-at-border problem he disclosed like a wine pairing. 'Due diligence,' he says, approving despite himself. 'The plate stays blank a season. My gift.' You leave owning the deal's whole grammar and none of its debt, which on this canal is the closest thing to winning an exchange with Iro that anyone has recorded."),
            ch("Take the key. The archive reads everyone; better to be the reader.", "bad", "ms58-took-the-shelf", "The brass takes your name beautifully. The key is cold for exactly one day, and then it is the warmest thing you own. First month's fee: you deposit a stranger's secret, telling yourself it was a small one, and the archive receives it the way deep water receives rain, and the rate is already doubling somewhere in Iro's book. He shakes your hand with real warmth. Colleagues, now. That's what it cost. That's what it always costs."),
        ]),
        interlude("Moonshadow Village", 70, "Your File", [
            pg("Through a Locked Door", "Your quarters, the bolt untouched, a file square on the desk that was empty at dusk", "Narrator",
                "The room was sealed; you've long since learned to seal it properly. The seals are intact. The file is on the desk anyway, squared to the edges, patient.",
                "Your working name is on the spine, in registry hand. Below it, in different ink: INTAKE RECORD, COMPLETE COPY, WITH ANNOTATIONS.",
                "Delivered the way the cipher scroll was delivered, seasons ago. Which is to say: as proof of reach, wrapped around a message.",
                "You are, whatever else tonight brings, finally about to learn what Moonshadow has been writing about you since the Mirror looked you up."),
            { ...pg("The Priced Choices", "The desk, the file open, every page ruled in two columns: EVENT and VALUE", "Narrator",
                "It is all here. Everything. The silent yard, priced. The cellar auction, priced higher. What you did at the shrine, at the rooftop, at the bridge; every choice you thought was witnessed only by the people in it, entered and VALUED, in a steady clerk's hand.",
                "And beside each price, a buyer's mark. The same buyer. Every entry, every season: a circle, quartered, purchasing quarterly, since your first winter here.",
                "Someone has been buying the record of your choices the way collectors buy an artist early, before the price runs.",
                "The last ruled page is headed NEXT, and it is blank, and the blankness has been RESERVED: a deposit mark sits in the corner, prepaid, against whatever you do now."),
                choices: [
                    { text: "You trade nothing that guards others. Read what they made of that.", nextPage: 2, requireTrait: "ms4-trade-protector" },
                    { text: "You trade for the strongest hand. Read what they made of that.", nextPage: 3, requireTrait: "ms4-trade-strongest" },
                    { text: "You trade to buy something back. Read what they made of that.", nextPage: 4, requireTrait: "ms4-trade-redeemer" },
                    { text: "You don't sell; you listen. Read what they made of that.", nextPage: 5, requireTrait: "ms4-trade-listener" },
                    { text: "You never knew what you had left. Read the intake annotation.", nextPage: 6, requireTrait: "ms4-trade-unknown" },
                    { text: "Skip to the oldest page. Start where the buying started.", nextPage: 7 }
                ] },
            { ...pg("The Guardian, Priced", "The file, your intake answer annotated in the margin", "Narrator",
                "Your intake answer sits at the file's head: nothing that keeps someone else safe. That's not for sale.",
                "The annotation beside it, in the buyer's clerk-hand, is one line: GUARDIAN CLASS. VALUE ACCRUES TO DEPENDENTS. ACQUIRE DEPENDENTS.",
                "They read your protection as a price lever. Every person you guard makes you dearer to hold, because a guardian pays ANY rate when the dependents are the collateral.",
                "The list under the annotation has names on it. People you've protected here. The buyer has been acquiring your dependents' pages, quarterly, patiently, building the lever they think you are."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Buyer, Priced", "The file, your intake answer annotated in the margin", "Narrator",
                "Your intake answer sits at the file's head: whatever buys the strongest hand in the room.",
                "The annotation beside it reads: BUYER CLASS. WILL LEVERAGE. EXTEND CREDIT FREELY.",
                "They read your ambition as an open account: let the strong hand borrow, let the debts accrue, own the hand later. Half the opportunities that have found you in this village, the file shows, were EXTENDED, on purpose, like rope.",
                "The credit line has a limit entered. You are, the margin notes, three seasons from it at current draw."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Redeemer, Priced", "The file, your intake answer annotated in the margin", "Narrator",
                "Your intake answer sits at the file's head: anything, to buy back something I lost.",
                "The annotation beside it is the coldest line a clerk ever ruled: REDEEMER CLASS. LOCATE THE LOSS. HOLD IT. NAME THE PRICE AT NEED.",
                "They've been LOOKING for what you lost, friend. On their own coin, quarterly, for years. Not to return it. To hold it against you: the one purchase you'd liquidate yourself to make.",
                "The search log runs down the margin, entry after entry. The last one is recent. The last one says: PROMISING."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Ear, Priced", "The file, your intake answer annotated in the margin", "Narrator",
                "Your intake answer sits at the file's head: I don't sell. I listen.",
                "The annotation beside it reads: EAR CLASS. RARE. DO NOT ACQUIRE. CULTIVATE.",
                "They never tried to buy you, the file shows. They tried to FEED you: half the secrets that have found their way to your corner of the canal were routed there, deliberately, like streams bent toward a favored field. An ear that hears what the buyer wants heard is worth more than any page it could sell.",
                "You have been listening beautifully, the margin concludes, to a curated village. The uncurated one starts on the oldest page."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Open Answer, Priced", "The file, Iro's dragged pen-line reproduced in facsimile", "Narrator",
                "Your intake answer sits at the file's head, in Iro's copied hand: I don't know what I have left to trade. His pen-drag is reproduced in the margin, annotated with a collector's care.",
                "The buyer's clerk has ruled one line beneath it: SUBJECT CORRECT. PRINCIPAL ASSET PREVIOUSLY ACQUIRED. SEE FOUNDING ENTRY.",
                "Previously acquired. Your missing thing has a LISTING. It sits in somebody's inventory the way Nyx's name sits in a folder: bought, held, storage current.",
                "The founding entry, the annotation says, is on the oldest page, and the oldest page is dated before you ever reached this coast."),
                choices: [
                    { text: "The oldest page.", nextPage: 7 }
                ] },
            { ...pg("The Founding Entry", "The file's last leaf, older than every other page, in no registry's hand", "Narrator",
                "The oldest page is not Moonshadow paper. It is older, water-stained, and the hand on it belongs to no clerk this village ever employed.",
                "It is a bill of sale. One line of goods: a trust, given whole, before the giver understood the price. Seller: a name you almost remember, gone soft with time, like a face underwater. Buyer: the circle, quartered. Consideration: one line, and the line is the part that stops your breath. PASSAGE OUT.",
                "Somebody sold the deepest thing you ever gave, once, somewhere, to buy you a way out of a place the record does not name. The trust was collected. The passage was paid. What walked on afterward is you, minus the given thing, plus the storage fees.",
                "And at the leaf's foot, freshly inked, quarterly-current, the buyer's mark holds the account OPEN. They're not done collecting. The file on your desk is the proof of reach. The blank page marked NEXT is the message: we are still buying, and you are still selling, and you have never once seen the counter."),
                choices: [
                    { text: "One field near the top you never let yourself read.", nextPage: 8 }
                ] },
            { ...pg("The Name Not Chosen", "The file's front leaf, one field the intake clerk left open on your first night", "Narrator",
                "There is a line near the top of the file you have never once let yourself read. The day name is filled, in Iro's hand, from your first hour on the canal. Below it sits the other line.",
                "The reserved line is headed in the registry's block capitals, NIGHT NAME, and the value keyed against it is one word. RESERVED. Not blank. Reserved.",
                "Beside it, in the same quartered-circle mark that stands over every priced choice in these pages, a clerk has noted: PENDING SELF-VALUATION.",
                "The Mirror did not only look you up on your first night. It has been waiting, quarter after quarter, for the one name you had not chosen yet: the price you would set on yourself, in your own hand, for it to hold."),
                choices: [
                    { text: "Write no night name at all. No one gets that handle, the buyer least of all.", nextPage: 9, trait: "ms70-night-name-refused" },
                    { text: "Write a night name that guards someone else, not you.", nextPage: 9, trait: "ms70-night-name-guardian" },
                    { text: "Write a night name that belongs to no one but you.", nextPage: 9, trait: "ms70-night-name-claimed" },
                    { text: "Tear the night-name leaf out of the file and keep it in your own coat.", nextPage: 9, trait: "ms70-night-name-stolen-back" }
                ] },
            pg("What to Do With a Mirror", "Your quarters at deep night, the file closed, your reflection in the dark window arriving on time for once", "Narrator",
                "The file sits closed on the desk. Everything Moonshadow ever wrote about you, everything the circle ever bought of you, and one blank ruled page waiting for tonight's entry.",
                "Whoever delivered it wanted exactly this: you, alone with your own price tag, deciding what a person does when they finally read their own listing.",
                "In the window's dark glass, your reflection looks back without any delay at all. Whatever the Mirror has to look up, the window doesn't.",
                "The lamp is low. The page marked NEXT is waiting. It's your entry to write."),
        ], [
            ch("Burn the file, unread past what you've read. They keep no page on you.", "good", "ms70-burned-the-file", "You feed it to the brazier leaf by leaf, prices and annotations and the founding entry's copy, all of it, and the reserved blank page goes in last, still blank. Somewhere a buyer's quarterly deposit lands on ash. You keep the one thing no archive can hold: a self with no readable ledger. The village will call it waste for years. The village prices everything. That was never the same as knowing what things are worth."),
            ch("Claim custody: the file lives, but it lives with YOU, under your seals.", "neutral", "ms70-claimed-custody", "You keep it. Sealed, warded, yours: the complete record of your price, held by its subject, which in Moonshadow's whole history has happened almost never. Every season you read it again and watch the buyer's picture of you drift further from the person doing the reading. Know what they think they own: it's the oldest armor on the canal, and the heaviest, and you wear it well enough that even the Mirror starts hesitating a little longer."),
            ch("Start files of your own. On the clerk. On the couriers. On the circle.", "bad", "ms70-started-files", "By morning you own three pages: the registry clerk who copies for the buyer, the courier route the quarterly payments ride, and the first confirmed local hand that inks the quartered circle. By season's end, a drawer. You learn what every collector learns: files breed. Somewhere between the third page and the thirtieth, watching becomes holding, and holding becomes the thing you were reading about in your own file with your jaw set. It works, though. Nobody denies it works."),
        ]),
        interlude("Moonshadow Village", 80, "Harrow's Shortcut", [
            { ...pg("The Largest Commission", "A dry dock under the tower's waterline, Harrow beside a crate built for one impossible object", "Kite Harrow",
                "You're here. Good. If I said this out loud twice I'd lose the nerve, and nerve is a fixed asset in my line.",
                "That crate is measured for the Mirror. The actual Mirror, friend, the tank under the tower. My commission: appraise it for transport, certify the packaging, sign the manifest. The largest fee ever offered to an unsworn license. It would buy me a NAME, friend. A door with my name over it, in any village I liked, and no one able to revoke it.",
                "I've been down there twice on scouting passes. You know what the glass showed me? Every version of myself that ever got filed. The girl with the forger mother. The apprentice with the debts. The unsworn woman four villages price by the hour. All of me, held, in a tank I'm being paid to gift-wrap.",
                "So. Professional question, colleague, and I need a professional answer: what does an appraiser owe a warehouse full of everyone, when the fee on the table finally buys HER off the market?"),
                choices: [
                    { text: "\"Owe? You're inventory to them, Harrow. Same as me. Walk away whole.\"", nextPage: 1 },
                    { text: "\"Certify it honestly: the cargo is people. Sign THAT manifest.\"", nextPage: 1 }
                ] },
            pg("The Manifest", "The dry dock, the blank manifest on the crate, her pen unmoving over it", "Kite Harrow",
                "Here's what my license training says: appraise the object, not the ethics. Here's what forty commissions across four villages have actually taught me: every 'object' on this coast turned out to be somebody, eventually, and I certified half of them before I learned to check.",
                "The client's a quartered circle. I've traced that mark through four villages now, and the buyers under it keep one name they are careful never to write down: the Hollow Gate. The cargo is four hundred years of surrendered trust. The fee is my own name, over my own door, at last. And the manifest wants one signature to make the whole thing MERCHANDISE.",
                "You want the shape of the thing, colleague? Stormveil spends reasons. Ashen Leaf spends futures. Frostfang spends exits. Moonshadow spends surrendered trust: names, secrets, confessions, files, and the exact moment a person believed the holder would keep them safe. The Gate does not care what any village calls its currency. It cares only that the four seats keep collecting.",
                "You know the joke of it? The Mirror already holds a version of me that would sign. I MET her, on the scouting pass. She looked happy. She looked exactly like me with a door.",
                "Whatever I do at this crate, colleague, one of us gets left in the glass. Help me pick which."),
        ], [
            ch("Tear the commission with her. The Mirror stays unpriced.", "good", "ms80-pulled-her-back", "She rips the manifest herself, slowly, watching her name-over-a-door burn down with it, and then she breathes like a woman surfacing. 'There goes the retirement,' she says lightly, meaning the other thing entirely. The crate stays empty on the dock for weeks, a coffin nobody claims, until the canal takes it. The circle notes its appraiser's default. Somewhere, terms are redrawn around a woman who can no longer be bought at any listed rate."),
            ch("Partner on it: she stalls certification while you trace the client's chain.", "neutral", "ms80-partnered", "A contract, spoken plain over the crate: she files delay after professional delay, impeccably billable, while every 'verification query' she sends up the client's chain maps another link for you. Four brokers, two dead, a dock in no village's water: by season's end you hold the buyer's whole shipping route, and Harrow holds the record for the slowest certification in appraisal history, still technically in good standing. 'We're now defrauding the apocalypse via paperwork,' she says. 'I've had worse partners.'"),
            ch("Tell her to take the fee. Better her name on a door than in a tank.", "bad", "ms80-let-her-burn", "She looks at you a long time, recalculating something she'd hoped was settled math. 'Practical,' she says at last, flat as a slate. She reaches for the pen three times while you watch, and you leave before it lands; some sales should have no witnesses. The door with her name over it opens down the coast that season, real as rain, and the crate's loading never quite gets scheduled, and when word of her finds you again there is a receipt folded into it, made out to you, payment deferred."),
        ]),
        interlude("Moonshadow Village", 88, "The Returning", [
            pg("The Empty Booth", "A disused confession booth in the whisper market, scrubbed clean, its drain plugged with lead", "Nyx",
                "Welcome to the stupidest venture in canal history. I rented the old booth for a season, I plugged its drain with a smith's own hands and a lot of lead, and tonight we open for business.",
                "The product: RETURNS. People's own files, handed BACK, face to face, witnessed, by consent, free. Not like the burn. The burn threw everyone's skin at their doorsteps in one panicked night, anonymous, in the dark, and half the canal calls it proof that truth coming home means fire. An abandonment isn't a return, friend. Nobody has ever done the WITNESSED kind. Not once.",
                "Then a witness on the east canal showed me three hundred names that exist twice and nobody's died of the duplication, and a certain discrepancy taught me the word free, and I did the worst thing a dealer can do: I started CHECKING the oldest law. It was always just... good for business.",
                "So tonight we test it, in the open, in my market. If it works, this village learns trust doesn't need a warehouse. If it doesn't, well. You've seen what's left of my reputation; the blast radius is manageable."),
            { ...pg("The First Return", "The booth at moonrise, one subject summoned, one file on the table, the market pretending not to watch", "Narrator",
                "The first subject is a dye-hand from the east canal: his gambling confessions, drained years ago, copied and sold twice since. The burn sent the tower's original home, but the trade copies stayed loose in the world, and it's those Nyx recovered at honest rates for tonight.",
                "He comes. He sees his own file on the table, his name on the spine, three witnesses standing calm around it, and Nyx's hand-lettered sign: THIS BELONGS TO YOU. TAKE IT. NO CHARGE.",
                "And he bolts. Knocks the stool over, puts his back against the canal rail, breathing like a cornered animal, staring at his own name as if it were a drawn knife.",
                "'You don't RETURN a file,' he manages. 'Returned means SPENT, means somebody's about to... what do you people WANT from me?' The whole market, listening from every shadow, holds its breath with him. The oldest law flexes its grip."),
                choices: [
                    { text: "\"I bought your reports on me for a season. Shopping instead of asking. I'm returning the habit.\"", nextPage: 2, requireTrait: "nyx-suspicion", trait: "ms88-repaired-trust" },
                    { text: "Post the holders' names above the booth: who held his file, and since when.", nextPage: 3, trait: "ms88-named-the-holders" },
                    { text: "Sit down at the table yourself, hands flat, and wait with him.", nextPage: 3 }
                ] },
            { ...pg("Fear, Refunded", "The booth's shadow, Nyx very still, the market noise far away", "Nyx",
                "Refund accepted. Don't itemize it further; the margin's embarrassing for both of us.",
                "You bought copies of what a scared trainee wrote about you instead of asking me what I knew, and I filed it, friend. Of course I filed it. Given trust or given files, you chose files, and I've built my whole stall on people making exactly that choice, so I couldn't even be angry PROPERLY, and that made it worse.",
                "So here's how dealers settle it. You sit at that table and do the unpriced thing you do, and if that man walks out holding his own worst winter and smiling, your account and mine reopen at zero. Best terms I've offered anyone.",
                "Go on. The unpriced thing. It's the only product tonight that isn't refundable."),
                choices: [
                    { text: "Sit at the table. Wait with him.", nextPage: 3 }
                ] },
            { ...pg("The Law Breaks Quietly", "The booth table, the dye-hand's hands finally on his own file", "Narrator",
                "It takes the better part of a bell. No one rushes him. The witnesses witness; the lead-plugged drain drinks nothing; Nyx re-prices the room in a murmur: 'Free costs more than gold, apparently. Fetch the man some tea.'",
                "And then, with the whole market watching sideways, the dye-hand opens his own file, reads three pages of his worst winter, and starts, unstoppably, to laugh. Then the other thing. Then both at once.",
                "'It's SMALLER than I remembered,' he keeps saying, gripping the folder like a rail. 'Years I paid to keep this held, and it's... it's just a bad winter. It's just a man having a bad winter.'",
                "He signs the return receipt with a steady hand. Witnessed. Consented. Home. The oldest law on the canal dies without a sound, the way false things die when someone finally checks."),
                choices: [
                    { text: "The queue forms on its own.", nextPage: 4, trait: "ms88-return-proven" }
                ] },
            { ...pg("Eleven by Dawn", "The booth at first light, a queue down the canal walk, receipts drying on a line", "Nyx",
                "Numbers, before the market invents its own version. Eleven files returned by dawn. Eleven, witnessed, receipted, consented. Fires started: ZERO. Marriages ended: zero. Duels declared: zero, and I had odds posted on two.",
                "One woman fainted, was caught, had tea, finished her reading, and TIPPED us. We don't take tips. She insisted. It's in a jar; we're calling it evidence.",
                "It doesn't empty the archive. It doesn't crack the tank. It does exactly one thing, friend: it proves the market's foundation lie is a LIE in front of the market. Trust doesn't need a holder. It needs a WITNESS. That's the whole discovery, eleven times over, notarized.",
                "So. It works, and the receipts prove it works, and the transfer of the big tank is coming whether we're ready or not. What we do next decides whose proof this becomes."),
                choices: [
                    { text: "Set the bill of sale on the booth table. The oldest sale on the canal, next in the queue.", nextPage: 5, requireTrait: "ms65-saved-the-file", trait: "ms88-eleven-files" },
                    { text: "Ask Nyx to bring out the page you sent her. Hers to table, hers to time.", nextPage: 5, requireTrait: "ms65-gave-nyx-the-file", trait: "ms88-eleven-files" },
                    { text: "Let the eleven receipts stand on their own.", nextPage: 8, trait: "ms88-eleven-files" }
                ] },
            { ...pg("The Twelfth File", "The booth table, one file older than the rest, Nyx not touching it", "Nyx",
                "It made it here. Through the shrine and the Hunter and every profitable chance to be traded, the shrine's page of my bill of sale made it to my own booth's table, and now it's sitting in the returns queue like any other bad winter.",
                "Here's what it is, so we're both pricing the same object. Not my tower file; that came home in the burn. This is the SALE itself: sold at nine, one winter's food, my own hand on the bill; they make you sign it yourself, that's the craft of it. Every file returned tonight was somebody's worst season. That one's the market's whole SYSTEM in one folder: what this village does to hungry children and calls a fair trade.",
                "Whoever carries that to the tower isn't carrying my bad winter. They're carrying the argument, the entire one: if THIS sale can come home, every sale can. If I can be unbought, nobody's holdings are safe, and safety-through-holding was always the only product the tower sold.",
                "So quote me a carrier, friend, and make it final. This listing doesn't relist."),
                choices: [
                    { text: "\"Partners split the risk. I'll carry it up the tower. You hold the market.\"", nextPage: 8, requireTrait: "nyx-partner", trait: "ms88-nyx-proof-carried" },
                    { text: "\"Standing order, one last true thing: let me carry it to her.\"", nextPage: 8, requireTrait: "nyx-respect", trait: "ms88-nyx-proof-carried" },
                    { text: "\"Our account reopened at zero tonight. First entry: I carry this.\"", nextPage: 8, requireTrait: "ms88-repaired-trust", trait: "ms88-nyx-proof-carried" },
                    { text: "\"Stand back. It's your name. You say it; I'll hold the market open.\"", nextPage: 6, requireTrait: "nyx-partner", trait: "ms88-nyx-proof-deferred" },
                    { text: "\"Stand back. It's your name. You say it; I'll hold the market open.\"", nextPage: 6, requireTrait: "nyx-respect", trait: "ms88-nyx-proof-deferred" },
                    { text: "\"Stand back. It's your name. You say it; I'll hold the market open.\"", nextPage: 6, requireTrait: "ms88-repaired-trust", trait: "ms88-nyx-proof-deferred" },
                    { text: "Keep the file in your coat. Let that be your part.", nextPage: 7 }
                ] },
            { ...pg("You Hold the Market", "The booth, Nyx wrapping her own file in plain paper, like any parcel", "Nyx",
                "Good. I was hoping you'd say that, which is disgusting, because hope has terrible margins. Then I say my own name, and you hold the market. Don't argue the assignment; holding this market open tomorrow is the harder job and we both know my rates for hard jobs.",
                "My whole life I've bought and sold around one sealed folder like furniture I couldn't look at. Tomorrow I carry it up the tower myself and do the one transaction the glass has never priced.",
                "I had a whole speech drafted. Cost analysis, historical grievance, a really devastating bit about compound interest. It's gone. All I've got left is: my mother gave me a name, and I want it back, and I'm going to go say so out loud to the woman who holds the warehouse.",
                "That'll clear. It's the only balance I've ever had that will."),
                choices: [
                    { text: "Let it be hers to say.", nextPage: 8 }
                ] },
            { ...pg("Held, Not Returned", "The booth, the file going back into your coat, Nyx watching it go", "Nyx",
                "You're keeping it. My file. After tonight. After ELEVEN RETURNS at my own booth, mine goes back in a coat.",
                "I'm not angry. Check the ledger; anger's not entered. You pulled that folder out of the machine when it would've been profitable fifty ways to leave it, and I will owe you that at any exchange rate, forever. True thing, no receipt.",
                "But price it honestly with me, one dealer to whatever you are: a bill of sale in a coat is still a bill of sale. The verb never changed hands.",
                "Hold it gently, then. She reads coats from across a room; reading coats is her entire office. And so, friend, as of tonight, is reading yours."),
                choices: [
                    { text: "Keep the file. Walk on.", nextPage: 8, trait: "ms88-unfinished-answer" }
                ] },
            pg("Whose Proof It Becomes", "Dawn over the canal, the returns line still forming, receipts drying like laundry", "Narrator",
                "By full morning the queue is longer than the market. Brokers stand in it. A watch officer stands in it, out of uniform, holding his numbered chit like a prayer token. Somebody has chalked over the old booth sign; it reads, in a child's letters, THE GIVE-BACK HOUSE.",
                "Nyx works the table like she was born at it, which she was, one bad winter at a time. The lead-plugged drain drinks nothing all day.",
                "The tower has eyes on the queue by second bell; everyone can feel them. The transfer of the tank is coming, and the market that was to be sold with it has begun, file by file, handing itself BACK.",
                "One decision is left at this booth, and it is yours."),
        ], [
            ch("Run the returns in the open square at noon. Let the whole village watch.", "good", "ms88-open-returns", "You move the table into the noon square, no shadows, no curtains, and the returns run in full daylight with the queue singing out its numbers. By dusk the whole village has watched trust go home unburned, forty times over, and the booths stand empty for the first evening in forty years. The proof is public, and therefore already climbing the tower stairs without you."),
            ch("Keep every receipt sealed and countersigned. Build the case file.", "neutral", "ms88-sealed-receipts", "Every return gets the full treatment: subject-verified, witness-sealed, countersigned by names the tower cannot laugh out of the room, including, on the eleventh receipt, in careful brass-plate letters, IRO. The case file goes under three locks in three districts. The market may whisper what it likes; the paper is unbreakable, and paper, in this village, is the only witness that never renegotiates."),
            ch("Let the booths' own clerks watch the queue and report the new prices up.", "bad", "ms88-baited-the-market", "You make no announcement at all. You just let the intake clerks see the queue, count the receipts, and do what clerks do: report the numbers. By nightfall every booth on the canal has quietly repriced holding at RISK and returning at survivable, and the market's own repricing walks up the tower stairs wearing a clerk's handwriting. Nyx watches you weaponize a price list and mutters something between admiration and an exorcism."),
        ]),
        interlude("Moonshadow Village", 92, "Witnesses", [
            pg("Nine Lanterns", "The tower road at dusk, all nine lanterns lit, three figures waiting one lantern apart", "Narrator",
                "Nobody lights all nine lanterns on the tower road. Festival nights get five; the old Kage's funeral got seven. Tonight, someone has lit nine, and nobody in the market will say who, which in Moonshadow means everyone knows.",
                "Word has crossed every canal: at moonrise tomorrow, the one the Mirror reads late climbs the tower, to put a question to the Kage that only the glass can answer.",
                "Three figures wait on the road, spaced one lantern apart, in the manner of people who have priced exactly how much of each other's company they can afford.",
                "The first is counting a ledger closed. The second holds three drafted futures. The third holds a lantern of her own, unlit, and waits the way keepers wait."),
            { ...pg("The Settled Ledger", "The first lantern, Nyx with her book open to its last page", "Nyx",
                "There you are. I'm doing the year-end books early, on account of the world possibly ending. Professional habit; you'd be amazed what apocalypses do to outstanding balances.",
                "So here's the miracle, and I've checked it four times. Your account and mine. Every favor, every fee, every free thing either of us pretended had no price. It BALANCES, friend. To the copper. Nobody owes anybody anything.",
                "I've kept books since I was nine, and I have never once closed a personal ledger at zero. Zero is impossible. Zero means every trade was fair and every gift was seen. People don't DO that.",
                "So naturally I'm keeping the page. Framed. As evidence that it happened once, whatever the glass decides tomorrow. Now go talk to the vulture at lantern four; he's been rehearsing."),
                choices: [
                    { text: "\"Tomorrow your name comes home. Carried by you, said by you.\"", nextPage: 2, requireTrait: "ms88-nyx-proof-deferred" },
                    { text: "Show her the sealed case file, receipt by receipt.", nextPage: 3, requireTrait: "ms88-sealed-receipts" },
                    { text: "Walk to the fourth lantern.", nextPage: 4 }
                ] },
            { ...pg("The Parcel", "The first lantern, the plain-wrapped file under Nyx's arm like a market parcel", "Nyx",
                "Look at it. Forty years of being the thing I traded around, and it's a PARCEL now. Brown paper. String. I wrapped it myself; my hands only shook at the knot.",
                "I'm carrying it up tomorrow, behind you, one stair back. Village law gives the notice-server the floor first; I checked, twice, in two different law-booths, and paid full rate both times just to hear it confirmed out loud.",
                "And when you've said your piece to her, I say mine. Four words. I've costed longer speeches all week and it always comes back to four words.",
                "My mother chose it. That's the part the glass never held, you know. It holds the sale. It never held the CHOOSING. Tomorrow it hears both, priced at nothing, witnessed by everything. Go rest, friend. Big market day."),
                choices: [
                    { text: "The fourth lantern.", nextPage: 4 }
                ] },
            { ...pg("The Eleventh Signature", "The first lantern, the case file open to its last receipt", "Nyx",
                "Give it here. If I'm auditing the end of the world, I'm doing it properly.",
                "Return one: verified. Two through seven: verified, witnessed, sealed. Eight... the fainting woman, verified, and the tip jar is ITEMIZED, you beautiful lunatics. Nine, ten, verified. And eleven.",
                "Eleven is countersigned IRO. I've seen forty years of that man's signatures, friend, and I can price the tremor in every one of them. This one doesn't tremble. The single most acquisitive hand on this canal signed a RETURN, steady, in brass-plate letters, like he wanted the glass itself to read it without squinting.",
                "You know what you've built? A paper trail the tower can't burn without admitting fire beats paper. In THIS village. Where paper is god. Take it up the stairs, friend, and hold it like the relic it is."),
                choices: [
                    { text: "The fourth lantern.", nextPage: 4 }
                ] },
            { ...pg("Three Tomorrows", "The fourth lantern, Iro with three sealed drafts fanned in one hand", "Shade Master Iro",
                "Friend. Punctual as a payment. Observe: I have drafted three versions of tomorrow, because a merchant without contingencies is merely a gambler with better clothes.",
                "Draft one: the glass changes hands to its buyer, and I have prepared, at humiliating cost, papers proving I was always a minor and unwilling participant. Lies, obviously, but NOTARIZED lies. Draft two: the glass breaks, the market drowns in its own returned truth, and I have prepared claims on salvage; someone must warehouse the debris, and better a devil the canal knows.",
                "Draft three.",
                "Draft three I wrote at four in the morning and have not resealed, because my hands, friend, my forty-year steady merchant's hands, would not do it. Draft three assumes YOU win. It is not a contingency. It is a CONFESSION, with a manifest stapled to it, and if you live past moonrise tomorrow, I intend, against every instinct I have ever billed for, to read it out loud."),
                choices: [
                    { text: "The seventh lantern.", nextPage: 5 }
                ] },
            pg("The Unlit Lantern", "The seventh lantern, the shrine witness holding her own small lamp, wick trimmed, unlit", "Shrine Witness",
                "Knife. No... not knife anymore, I think. Climber, now. Sit a moment. This takes an old woman a while to say.",
                "Three hundred and eleven names, copied twice, kept safe. I heard what your booth did with eleven files, and I am here to tell you what I will do with my pages, whichever way the tower falls tomorrow.",
                "I will read them ALOUD. In the square, at noon, one name a day, three hundred and eleven days. The sold, said out loud, every day for nearly a year, so this village hears the roll of what it traded away. A name a day. I have the voice for a year of it. I asked my chest and my grief, and neither of them said no.",
                "This lamp is for the first reading. I'll light it from whichever fire tomorrow leaves burning. Climb well, climber. The names and I will be in the square either way."),
            pg("The Procession Forms", "The tower road at full dark, nine lanterns burning, the market coming out of its shadows", "Nyx",
                "Look down the road. No. Really look.",
                "The dye-hand's whole street came out; he's telling his bad winter to ANYONE now, it's insufferable, I love it. The returns queue re-formed itself as a walking line. The watch officer's in uniform this time. Even the booth clerks came, with their meters left home, off-ledger, on their own feet.",
                "Nobody hired this crowd. Do you understand what that means HERE? There's no payer. I checked, professionally, out of disbelief: nobody is being compensated for tonight. Four hundred people, walking uphill, gratis. The Mirror has no column for it. I barely do.",
                "So decide how you climb tomorrow, friend, because every soul on this road climbs it with you, and for the first time in this village's ledger, the whole procession is UNPRICED."),
        ], [
            ch("Climb in the open, at the procession's head, slow enough for anyone.", "good", "ms92-vowed-open-ledgers", "You take the stairs at the front of four hundred unpaid witnesses, and the tower watch, whose whole doctrine is pricing entry, stands aside before a crowd that no bribe assembled and no fee can turn. Nyx walks one stair back with her parcel. The shrine witness's unlit lamp rides at the middle of the line, waiting for its fire."),
            ch("Climb with the case: receipts, manifest, and Iro's unsealed third draft.", "neutral", "ms92-vowed-a-keeper", "You go up as a proceeding, not a procession: the sealed returns, the buyer's traced chain, and a profiteer's four-in-the-morning confession, carried by the one person on the canal every faction will let pass. The crowd holds the road below. The paper climbs. In Moonshadow, that has always been the more dangerous pilgrim."),
            ch("Send word up first: the discrepancy is coming, and it has read its own file.", "bad", "ms92-vowed-to-collect", "The message travels the tower's own whisper-pipes, faster than feet: the one you could never price knows what was bought, and climbs at moonrise to collect. By the time you take the first stair, three Veiled Hands have resigned their contracts, citing clauses, and somewhere above, a woman whose shadow no longer fits has begun, very quietly, to put her accounts in order. Fear, the market's oldest product, runs ahead of you at last, and you didn't pay a copper for the courier."),
        ]),
    ],
};
