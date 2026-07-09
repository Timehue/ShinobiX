/*
 * story-epilogues — short post-finale reckoning scenes, shown once after the
 * kage-finale boss falls (owner brief 2026-07-09: "ending modifiers").
 *
 * Selection: first entry whose `lane` matches the finale lane choice the
 * player fought through AND whose `requireTrait` (if any) is owned — so the
 * trait-gated variants MUST come before their ungated base entry for the same
 * lane, and every lane present must end with an ungated base entry (the
 * story-epilogues test enforces both).
 *
 * Zero imports on purpose (mirrors story-interludes.ts): tests dynamic-import
 * this module from the api suite without dragging the client tree along.
 * Display is read-only flavor: epilogues pay nothing, grant nothing, and are
 * never re-offered; skipping one loses nothing but the goodbye.
 */

export type StoryEpiloguePage = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
};

export type StoryEpilogueDef = {
    /** The finale lane trait this epilogue follows (e.g. "honorable"). */
    lane: string;
    /** Optional story-trait gate for a more specific variant (checked first). */
    requireTrait?: string;
    title: string;
    pages: StoryEpiloguePage[];
};

export const storyEpiloguesByVillage: Record<string, StoryEpilogueDef[]> = {
    "Stormveil Village": [
        // ── Break the board (honorable) ───────────────────────────────────
        {
            lane: "honorable",
            requireTrait: "sv88-better-storm-ready",
            title: "The Honest Sky, Anchored",
            pages: [
                {
                    title: "What Came Home",
                    scene: "Dawn over the arena, the board in pieces, slates raining reasons",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the whole village knows what broke on the tower. The board is down, and every posted account came due at once: reasons flooding home to people who had forgotten they owned them.",
                        "It is loud. Old feuds wake up mid-sentence. The Harlan brothers are shouting about a field again, and crying about it, and it is theirs to shout about, every word.",
                        "The sky over the coast is honest now, which means it is dangerous again, and nobody's grudge is holding it off anybody's roof.",
                    ],
                },
                {
                    title: "The Ridge Holds",
                    scene: "The high ridge, the anchor web humming over the Low Terraces",
                    speaker: "Mira Volt",
                    dialogue: [
                        "The line held through the whole thing. Every anchor. My mother's splice didn't even creak.",
                        "Crews from three districts came up at first light asking how to rig their own. I said yes to all of them and then counted how many drums of cable we own, in that order, like an idiot. We'll manage. Jorun's crew is already planing mast heads.",
                        "It won't cover the coast by winter. It doesn't have to. It has to prove the sky can be held with rock and rigging, and it's up there proving it right now. Come on. Vanta's buying soup, and he's never bought anything in his life; I want witnesses.",
                    ],
                },
            ],
        },
        {
            lane: "honorable",
            title: "The Honest Sky",
            pages: [
                {
                    title: "What Came Home",
                    scene: "Dawn over the arena, the board in pieces",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the whole village knows what broke on the tower. The board is down, and every posted account came due at once: reasons flooding home to people who had forgotten they owned them.",
                        "It is loud, and it is going to stay loud. Anger with its memory back is weather of its own kind.",
                        "And above the loudness, the actual sky. Nobody's grudge holds it off anymore. The storm shield is a story now, and the season is turning.",
                    ],
                },
                {
                    title: "Rigging Season",
                    scene: "Mira's rooftop, cable drums being counted",
                    speaker: "Mira Volt",
                    dialogue: [
                        "So. Free village, angry village, naked sky. Nobody's asked me for the boat yet, which is the honest measure. Ask me again after the first real cyclone comes ashore; I'll show you the waiting list.",
                        "I'm not packing the boat. Look at me not packing it. There's too much rigging to do, and for the first time in my life, all of it is mine to choose.",
                        "Come to the rim tonight. People are fighting about real things at full volume and then eating soup together, and honestly? It's the best theater this village has ever staged.",
                    ],
                },
            ],
        },
        // ── Meter the valve (suspicious) ──────────────────────────────────
        {
            lane: "suspicious",
            requireTrait: "sv88-better-storm-ready",
            title: "Two Shields",
            pages: [
                {
                    title: "The Metered Floor",
                    scene: "The arena, a public meter mounted over the drain, glass and brass",
                    speaker: "Narrator",
                    dialogue: [
                        "The floor still drinks, but now it drinks in public. A meter the size of a wagon wheel hangs over the arena where the odds used to be chalked, and anyone can read the draw, any hour, any day.",
                        "Posting requires consent now, witnessed, written, revocable. The queues are short. It turns out very few people feed the floor when the floor has to ask.",
                        "The Guard checks the meter at every bell. So do the grandmothers, which is the part that actually keeps it honest.",
                    ],
                },
                {
                    title: "Rock and Law",
                    scene: "The ridge at dusk, the web lit by lanterns",
                    speaker: "Mira Volt",
                    dialogue: [
                        "Two shields now. The metered floor for the worst weather, and my mother's lines for everything else. Every season the anchors take a bigger share and the meter reads a little lower.",
                        "Vanta says at the current rate the floor drinks itself to sleep inside ten years, lawfully, on the record, witnessed. He says it like a man reading a horse the right way for once.",
                        "You made the machine ask permission. I get to make it obsolete. Between the two of us, I think we're winning.",
                    ],
                },
            ],
        },
        {
            lane: "suspicious",
            title: "The Metered Storm",
            pages: [
                {
                    title: "The Metered Floor",
                    scene: "The arena, the great meter ticking over the drain",
                    speaker: "Narrator",
                    dialogue: [
                        "The floor still drinks, but now it drinks in public, through a meter anyone can read, under a law anyone can cite.",
                        "It is better. Everyone agrees it is better, in the flat voice people use for improvements that still cost them something.",
                        "Because the shield still needs feeding, and the weather still comes, and every posted consent is still a reason leaving a person on schedule. Just politely now.",
                    ],
                },
                {
                    title: "The Clerk of Storms",
                    scene: "The tower office, the intake ledger open to your signature",
                    speaker: "Elder Vanta",
                    dialogue: [
                        "You know what they call you at the rim now? The board's new clerk. Unkind, and fair, like good odds, and you knew the line when you posted it.",
                        "Every draw needs your countersign. Every storm the shield breaks, yours to authorize. You became the law so the machine couldn't be lawless, and the law, child, is a chair a person sits in alone.",
                        "I'll say this at your funeral if I outlast you, which I won't: it was the grown-up answer. Nobody cheers the grown-up answer. Soup's on me anyway.",
                    ],
                },
            ],
        },
        // ── Take the seat (ambitious) ─────────────────────────────────────
        {
            lane: "ambitious",
            requireTrait: "sv88-better-storm-carried",
            title: "The Warm Tower",
            pages: [
                {
                    title: "The New Weather",
                    scene: "The tower's storm floor, the seat's quiet hour settling on you",
                    speaker: "Narrator",
                    dialogue: [
                        "The seat fits. That is the terrible part. The board reposts itself by morning bell, the odds-runners are calling numbers on next week's weather, and the quiet hour arrives on schedule, and it is exactly as good as he said.",
                        "In the routing office, the clerks have already changed the pressing mark to your teeth.",
                        "Down the coast, one ridge line hums over one district, holding its stretch of sky for free, and the board has begun, gently, to bet against it.",
                    ],
                },
                {
                    title: "What Mira Saw",
                    scene: "The tower gate, Mira not coming in",
                    speaker: "Mira Volt",
                    dialogue: [
                        "You carried her up the hill. Her slate, her line, her why. You proved the sky can be held for free, in front of the whole coast. I watched you do it.",
                        "You proved the sky holds for free. Then you took the paid seat anyway.",
                        "I don't have rigging for that. I've been standing here since dawn trying to splice it into sense, and it won't take the knot.",
                        "The bag's packed again. I want you to know it wasn't, for a while. That's the report from the cable department. Hold your own sky, Kage.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            requireTrait: "sv88-better-storm-deferred",
            title: "The Warm Tower",
            pages: [
                {
                    title: "The New Weather",
                    scene: "The tower's storm floor, the seat's quiet hour settling on you",
                    speaker: "Narrator",
                    dialogue: [
                        "The seat fits. That is the terrible part. The board reposts itself by morning bell, and the quiet hour arrives on schedule, and it is exactly as good as he said.",
                        "In the routing office, the clerks have already changed the pressing mark to your teeth.",
                        "Down the coast, one ridge line hums over one district, holding its stretch of sky for free, signed with a dead rigger's name your board has already stopped saying.",
                    ],
                },
                {
                    title: "What Mira Saw",
                    scene: "The tower gate, Mira not coming in",
                    speaker: "Mira Volt",
                    dialogue: [
                        "You let me carry her in. You held the gate while I said my mother's reason to the man who buried it, and I will owe you that until I die. I want that on the record first.",
                        "Then you watched the seat come open and sat down in it anyway.",
                        "I said her why out loud in that tower, and the tower's new keeper filed it. That's what happened, isn't it. Strip the rigging off it and that's the load path.",
                        "The boat leaves on the tide. I'm taking the real route this time. You're the only person alive who knows it, so I suppose we'll find out exactly what you've become by whether anyone follows me.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            title: "Succession",
            pages: [
                {
                    title: "The New Weather",
                    scene: "The tower's storm floor, the seat warm, the sky obedient",
                    speaker: "Narrator",
                    dialogue: [
                        "The seat fits like it was rigged for you, and the sky obeys, and the quiet hour is everything he promised.",
                        "The board reposts itself by morning. The clerks do not ask questions; the clerks have never asked questions. The meter of the elders' cut finds your account within the week.",
                        "Somewhere below, the board chalks a fresh bout between two friends, and the odds are very good, and the floor is already listening.",
                    ],
                },
                {
                    title: "The Bookmaker's Last Line",
                    scene: "Vanta's shack, the ledgers boxed for no one",
                    speaker: "Elder Vanta",
                    dialogue: [
                        "I've chalked four Kages onto that board in my lifetime. Every one swore they'd run it kinder, and I gave every one better odds than they earned.",
                        "Raiko asked angry people for a quieter storm for thirty years. I'll ask you the same, once a season, at the rail, in front of the crowd, for as long as my forecast runs.",
                        "The board's posted you at even, child. Beat the line. I never once saw it happen, and I would dearly love to close my book on an upset.",
                    ],
                },
            ],
        },
    ],
    "Frostfang Village": [
        // ── Break every mark (honorable) ──────────────────────────────────
        {
            lane: "honorable",
            requireTrait: "ff88-better-count-ready",
            title: "The Chosen Roll, Lit",
            pages: [
                {
                    title: "What Came Home",
                    scene: "Dawn over the wall, bare wrists everywhere, breath-fog rising",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the whole village knows what cracked in the night. The vault is dark, and every banked exit went home to its wrist: forty years of surrendered doubts and walkings-away, returned mid-life.",
                        "It is quiet, and it is not calm. People keep touching their own wrists like a healed break. Two soldiers resigned at first bell. One asked to re-enlist an hour later, and Sova entered him with a note: BY CHOICE, and underlined it.",
                        "The hearths burn wood now. Wood runs short. The cold is honest again, which means it is dangerous again, and nobody's surrendered exit is holding it off anybody's child.",
                    ],
                },
                {
                    title: "The Lanterns Take the Watch",
                    scene: "The north ridge, the relay burning down the line into the gray",
                    speaker: "Captain Yura",
                    dialogue: [
                        "Morning report, and it's a good one. Every district strung its own relay by second bell. Essen's gate crew taught three streets the chant. The Pale Pack came down, all of them, and answered the morning Roll, and then half of them stayed to teach knots.",
                        "Nineteen minutes is the standard now. Anyone lost, anywhere the lamps reach, nineteen minutes. We drilled it four times today because people kept VOLUNTEERING to be lost. That's a sentence I never thought I'd file.",
                        "It won't warm the barracks. It doesn't have to. It has to prove the Roll can hold without the vault, and it's up there proving it every bell. Come on. Sova's teaching the litany's new verse, and I want to watch you hear it.",
                    ],
                },
            ],
        },
        {
            lane: "honorable",
            title: "The Honest Cold",
            pages: [
                {
                    title: "What Came Home",
                    scene: "Dawn over the wall, the vault dark, wood smoke where the deep warmth used to be",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the whole village knows what cracked in the night. The vault is dark. Every banked exit went home, and every hearth in Frostfang now answers to firewood and effort, the old way, the only honest way left.",
                        "The Roll still forms at every bell. Smaller. Slower. Every answer a choice now, and everyone can hear the difference, and the difference is terrible and it is better.",
                        "The first blizzard after will be the whole argument. Everybody knows it. Nobody says it. They stack wood.",
                    ],
                },
                {
                    title: "A Thin Wall, Freely Manned",
                    scene: "The wall walk, Yura assigning watches to volunteers only",
                    speaker: "Captain Yura",
                    dialogue: [
                        "A hungry winter is coming. That's a fact, not a complaint. Nobody has struck their own name from the Roll yet, and that is the only report that matters. Ask me again in the deep cold; I'll answer in cadence so you can't hear my teeth.",
                        "Every watch tonight is a volunteer. Every rescue from now on is somebody CHOOSING the cold for somebody else. We'll lose people we wouldn't have lost. We'll be people we couldn't have been. I've done that arithmetic all day and it keeps balancing, barely.",
                        "Come to the roll stone at third bell. We're calling the ridge post's names in the open now, all of them. It turns out that was always allowed.",
                    ],
                },
            ],
        },
        // ── Bind the vault (merciful) ─────────────────────────────────────
        {
            lane: "merciful",
            requireTrait: "ff88-better-count-ready",
            title: "Two Warmths",
            pages: [
                {
                    title: "The Metered Vault",
                    scene: "The vault hall, a public meter above the door, consent forms in a rack",
                    speaker: "Narrator",
                    dialogue: [
                        "The vault survives, caged. Draws by posted consent, witnessed, revocable; every mark in the village re-signed or struck by its own wrist inside a month.",
                        "The meter above the door reads out the vault's hunger to anyone passing. The grandmothers check it the way they check weather. So do the children, who have invented a game about it, which the wardens have given up stopping.",
                        "And on the ridge, the lanterns burn every night: the searches that need no vault at all, eating into its purpose one found volunteer at a time.",
                    ],
                },
                {
                    title: "The Keeper's Successor",
                    scene: "The records room, Sova's pen passed across the table",
                    speaker: "Elder Sova",
                    dialogue: [
                        "Two warmths now. The lawful vault for the killing nights, and Coldewe's lamps for everything else. Between them, this winter is bought honestly twice over, and the meter says the vault's share shrinks every week.",
                        "At the current rate, the last mark retires itself inside ten years, lawfully, witnessed, on the record. I intend to live to enter it. Spite has kept me alive this long; hope can take a shift.",
                        "You made mercy into a working system, child. That is rarer than making it a litany. Now take the pen. The book chose its next hand a long time ago.",
                    ],
                },
            ],
        },
        {
            lane: "merciful",
            title: "The Thin Warmth",
            pages: [
                {
                    title: "The Metered Vault",
                    scene: "The vault hall, the meter ticking, the consent rack half empty",
                    speaker: "Narrator",
                    dialogue: [
                        "The vault survives, caged. Draws by consent, posted, witnessed. It is better. Everyone agrees it is better, in the voice soldiers use for orders they intend to obey.",
                        "Because consent, it turns out, runs thin. Eleven marks re-signed the first week. Eleven, from a village of hundreds. Surrender was always a poor fuel when somebody had to ASK.",
                        "The wardens read the meter twice a bell. Nobody says the arithmetic out loud. Everybody does it.",
                    ],
                },
                {
                    title: "The Signature",
                    scene: "The vault door, your name first on the consent ledger's keeper line",
                    speaker: "Captain Yura",
                    dialogue: [
                        "You know what they call you at the wall now? The warden's warden. Accurate twice, and you knew it going in.",
                        "Every draw needs your countersign now. Every cold snap the vault can't cover, yours to answer for. You became the law so the Count couldn't be lawless, and the law, Jonin, is a post nobody relieves you from.",
                        "It was the soldier's answer. Nobody drills a cheer for the soldier's answer, so here's mine, once, off the record. Mess tent's covered. Standing order, no expiry.",
                    ],
                },
            ],
        },
        // ── Take the valve (ambitious) ────────────────────────────────────
        {
            lane: "ambitious",
            requireTrait: "ff88-better-count-carried",
            title: "The Warm Door, Lit",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The vault floor, the script beginning at your wrist, warm as a bath",
                    speaker: "Narrator",
                    dialogue: [
                        "The valve fits your hand. That is the terrible part. The Count reforms by second bell, the wardens change nothing but the name they report to, and the vault's warmth settles over the village like a coat it never stopped wearing.",
                        "On the ridge, one lantern relay burns where you drilled it, finding the lost for free, and the vault has already begun, gently, to schedule its wardens elsewhere.",
                        "The script at your wrist is patient. It has done this before. It can wait for the rest of you.",
                    ],
                },
                {
                    title: "What Yura Saw",
                    scene: "The vault stair, Yura not coming down",
                    speaker: "Captain Yura",
                    dialogue: [
                        "I watched the lanterns find a man in nineteen minutes. You proved it. You carried Dren's plans into that vault in your own hands. I stood the stair believing we'd finally built the thing he died un-thanked for.",
                        "You lit the way out of the Count. Then you posted yourself as the door.",
                        "I don't have a drill for that. I've been standing here since dawn trying to write the report, and there's no format. There's no FORMAT, Jonin.",
                        "Keep the letter. I can't carry it anymore; it reads different now. And don't send for me when the Count needs a captain, because it will, and we both already know whose script answers.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            requireTrait: "ff88-better-count-deferred",
            title: "The Warm Door",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The vault floor, the script beginning at your wrist, warm as a bath",
                    speaker: "Narrator",
                    dialogue: [
                        "The valve fits your hand. That is the terrible part. The Count reforms by second bell, and the vault's warmth settles over the village like a coat it never stopped wearing.",
                        "On the ridge, one lantern relay burns where a captain answered a dead man's roll, and the vault has already begun, gently, to reschedule its wardens around it.",
                        "The script at your wrist is patient. It has done this before.",
                    ],
                },
                {
                    title: "What Yura Saw",
                    scene: "The vault stair, Yura not coming down",
                    speaker: "Captain Yura",
                    dialogue: [
                        "You let me answer his roll. You held the stair while I said Dren's name to the man who struck it, and I will carry that with the gloves and the good things. On the record, first.",
                        "Then you watched the door open and sat down in the doorway anyway.",
                        "I answered a dead man's roll call in that vault, and the vault's new keeper filed it. That's what happened. Strip the ceremony and that's the entry.",
                        "I'm taking the north post. The far one. The Count doesn't reach it in winter, which as of this morning is a feature. If anyone comes for me out there, Jonin, they will have chosen it. You taught me to want that. I'm choosing to keep it.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            title: "Succession",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The vault floor, the valve warm, the Count already reforming",
                    speaker: "Narrator",
                    dialogue: [
                        "The valve fits like it was cast for your hand, and the Count reforms by second bell, and the warmth is everything he promised.",
                        "The wardens do not ask questions; the wardens have never asked questions. The meter finds your draw rhythm within a week and adjusts, accommodating, patient.",
                        "Somewhere above, the mark plate at the gate reads a new intake's wrist, holds it half a count long, and the frost leans in, and begins to wait again.",
                    ],
                },
                {
                    title: "Once a Season, At the Stone",
                    scene: "The roll stone, Sova with the count book open to a fresh page",
                    speaker: "Elder Sova",
                    dialogue: [
                        "I have entered every keeper since my girlhood in this book. Each swore the door would open differently under their hand. For a while, the book agreed with each of them.",
                        "Kael asked the desperate for a better Roll for forty years. I will ask you the same, once a season, at this stone, in front of the Roll, for as long as the book and I last.",
                        "There is one blank leaf saved at the back of the book, child. I have been saving it forty years for an entry that surprises me. Earn the leaf.",
                    ],
                },
            ],
        },
    ],
    "Moonshadow Village": [
        // ── Open the tank (honorable) ─────────────────────────────────────
        {
            lane: "honorable",
            requireTrait: "ms88-better-truth-ready",
            title: "The Open Ledger, Witnessed",
            pages: [
                {
                    title: "What Went Home",
                    scene: "Dawn over the canal, the Mirror dark, four hundred years of trust flowing home",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the whole village knows what opened in the night. The tank is empty. Four hundred years of surrendered trust went home before dawn: every confession, every traded name, every held piece of everyone, delivered to its owner like the world's overdue post.",
                        "Some of it burns. A broker's marriage. Two old feuds, rearmed. The village chose to own its own fires, and some of them are real fires.",
                        "And down the canal, at a booth with a lead-plugged drain, the returns queue is already forming, because the give-back house taught this village the trick of surviving its own truth: witnesses, tea, and nobody rushed.",
                    ],
                },
                {
                    title: "The New Rates",
                    scene: "The whisper market at noon, booths repricing in chalk",
                    speaker: "Nyx",
                    dialogue: [
                        "Market report, since you like when I do market reports. Holding: worthless. Nobody will pay to warehouse a soul in this village again; the product is DEAD, friend, I danced on it this morning.",
                        "Witnessing, meanwhile, is BOOMING. The shrine keeper started her readings, a name a day at noon, and the square FILLS. People are saying true things out loud at market rates of zero and the canal has not caught fire more than the usual amount.",
                        "My stall's new sign went up at dawn. VERIFICATION AND WITNESS. NO HOLDINGS. The first customer was the dye-hand. He didn't need anything verified. He just wanted to sit at a booth that doesn't drain, and honestly? Best sale I never made.",
                    ],
                },
            ],
        },
        {
            lane: "honorable",
            title: "The Open Ledger",
            pages: [
                {
                    title: "What Went Home",
                    scene: "Dawn over the canal, the Mirror dark, the market reading itself",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the whole village knows what opened in the night. The tank is empty, and four hundred years of held truth is loose in the streets, all at once, with no give-back house rehearsed and no queue trained to wait its turn.",
                        "It is a hard season. Three brokers flee. A wedding detonates. The watch works triple bells keeping read truths from becoming settled scores.",
                        "But every fire is the village's own, burning in the open, owned. And slowly, street by street, people learn what the dye-hand learned: most held things are smaller than their storage fees.",
                    ],
                },
                {
                    title: "The Long Noon",
                    scene: "The square at noon, the shrine witness reading the fourth name",
                    speaker: "Nyx",
                    dialogue: [
                        "Ugly season ahead; I've got odds posted on which neighbors stop speaking first. And still, nobody's asked me to broker a forgetting. Not one. Ask me again when the remembering really starts.",
                        "But I watched the fourth name get read at noon today. Sold thirty years ago, everyone assumed dead. A woman in the crowd stood up and said, that's my sister, and she's not dead, she wrote to me once from a place with no name. And the whole square went LOOKING.",
                        "That's the new economy, friend. Truth out loud, and the whole square goes looking. I can't price it. I've stopped trying. Come to the booth; the tea's honest and the drain is lead.",
                    ],
                },
            ],
        },
        // ── Seal the lethal tenth (merciful) ──────────────────────────────
        {
            lane: "merciful",
            requireTrait: "ms88-better-truth-ready",
            title: "The Audited Keeper",
            pages: [
                {
                    title: "Nine Parts Home",
                    scene: "The tower, nine-tenths of the tank flowing home, one sealed vault remaining",
                    speaker: "Narrator",
                    dialogue: [
                        "Nine parts in ten go home by dawn, with the give-back house's method scaled to a village: witnesses at every doorstep delivery, tea in public squares, the shrine witness's readings pacing the hardest returns.",
                        "The last tenth, the truths that kill on contact, sit sealed under a new covenant, held by a keeper the whole market may audit, at noon, in the open, on demand.",
                        "The first audit happened before the ink dried. The keeper passed. The second audit is already scheduled. The keeper scheduled it personally, which is the entire difference.",
                    ],
                },
                {
                    title: "The Noon Question",
                    scene: "The open square, the audit table, the whole market entitled to ask",
                    speaker: "Nyx",
                    dialogue: [
                        "So this is what you built instead of a spider: a keeper with office hours. Every noon, any soul on this canal can stand at that table and ask what you hold and why, and you have to ANSWER, and if the answer's bad, the covenant says the market can vote the seal open.",
                        "I audited you myself last week. You know what I found? Receipts. Actual receipts, for every sealed page, each one signed by the person it protects. Held BY consent, for once in this village's rotten beautiful history.",
                        "It's still holding, friend. Don't get comfortable; I never will, and that's my job now, and you gave it to me, which was either very wise or the best trap ever laid. Both-true. This village runs on both-true. See you at noon.",
                    ],
                },
            ],
        },
        {
            lane: "merciful",
            title: "The Sealed Tenth",
            pages: [
                {
                    title: "Nine Parts Home",
                    scene: "The tower, the returns run raw, the sealed vault humming behind new locks",
                    speaker: "Narrator",
                    dialogue: [
                        "Nine parts in ten go home, raw and unrehearsed, and the market survives it the hard way, fire by fire.",
                        "The last tenth sits sealed under your covenant: audited, consented, lawful. It is better than the tank. Everyone agrees it is better, in the tone of a market absorbing a new tax.",
                        "Because a keeper is still a keeper. The audits pass, season after season, and every season the line to audit grows shorter, and trust in the keeper grows quieter, and somewhere in that quiet, a new kind of holding is learning to be comfortable.",
                    ],
                },
                {
                    title: "The Keeper's Ledger",
                    scene: "The audit table at noon, Iro first in line, on principle",
                    speaker: "Shade Master Iro",
                    dialogue: [
                        "You know what they call you on the canal now? The clean spider. Unflattering, and correct, which is the only kind of price that holds its value.",
                        "I audit you every noon I can manage. Not because I doubt the seals, friend. Because I held a shelf for forty years, and I know EXACTLY how slowly the cage builds itself around a careful keeper, and somebody who knows the architecture should watch the walls go up.",
                        "It was the solvent answer, I'll grant. Nobody throws festivals for solvency. The tea stands. Indefinitely. At cost. Do not tell anyone I said at cost.",
                    ],
                },
            ],
        },
        // ── Take the Mirror (loyal) ───────────────────────────────────────
        {
            lane: "loyal",
            requireTrait: "ms88-better-truth-carried",
            title: "The Unpriced Keeper",
            pages: [
                {
                    title: "The New Glass",
                    scene: "The Mirror chamber, the tank recognizing a keeper it cannot appraise",
                    speaker: "Narrator",
                    dialogue: [
                        "The tank takes your hand and finds no price on it, and settles, for the first time in four centuries, into custody it cannot bill.",
                        "The buyer's escrow hangs over the glass, unexecutable, a collection notice served on a blank line. Somewhere below the canal, something files its first extension in four hundred years.",
                        "The market reforms by noon; markets always do. But the booths' drains run to a tank with a keeper now, and the keeper watched a returns queue teach a village to hand things back, and the tank feels the difference in every swallow it is no longer sure it should take.",
                    ],
                },
                {
                    title: "What Nyx Saw",
                    scene: "The chamber door, Nyx not coming in",
                    speaker: "Nyx",
                    dialogue: [
                        "You carried my file up the tower and put the whole argument on her glass. I watched you do it. The returns, the receipts, my bad winter, all of it, argued perfectly.",
                        "You held the whole argument, priced perfectly. And when the glass finally blinked, you bought the seat instead of the exit.",
                        "I've run the numbers all morning and they won't close. You're holding the tank so IT can't be held, I get the theory, I priced the theory, the theory is even GOOD.",
                        "But the ledger says my file's back in a tower, friend. Under a kinder keeper. The kindest yet. That's what the entry says, and I've never once written a false entry, so I'm leaving the page open. Make a liar of the trend line. Please. I'll pay.",
                    ],
                },
            ],
        },
        {
            lane: "loyal",
            requireTrait: "ms88-better-truth-deferred",
            title: "The Unpriced Keeper",
            pages: [
                {
                    title: "The New Glass",
                    scene: "The Mirror chamber, the tank recognizing a keeper it cannot appraise",
                    speaker: "Narrator",
                    dialogue: [
                        "The tank takes your hand and finds no price on it, and settles, for the first time in four centuries, into custody it cannot bill.",
                        "The buyer's escrow hangs unexecutable. Somewhere below the canal, something files its first extension in four hundred years.",
                        "And in the glass's black depth, one ripple never quite stills: the place where a woman said her own name for free, the one entry the tank holds that it does not own.",
                    ],
                },
                {
                    title: "What Nyx Saw",
                    scene: "The chamber door, Nyx not coming in",
                    speaker: "Nyx",
                    dialogue: [
                        "You held the market open while I bought my name back with my own breath. That transaction is framed over my stall, friend, the first unpriced entry in canal history. I will owe you the frame forever. On the record, first.",
                        "Then you watched the glass come open and sat down at it anyway.",
                        "I said my name in front of that tank so nobody would ever hold me again. And the tank's new keeper heard it, and filed the ripple, and kept the seat. Strip the poetry and that's the ledger line.",
                        "Nerissa Vale trades on the east canal now, daylight hours, true names only. Come by if you're ever just a person again. First tea's free. The second one, keeper, costs more than you currently have.",
                    ],
                },
            ],
        },
        {
            lane: "loyal",
            title: "Succession",
            pages: [
                {
                    title: "The New Glass",
                    scene: "The Mirror chamber, the tank warm to your hand, the market already adjusting",
                    speaker: "Narrator",
                    dialogue: [
                        "The tank takes your hand like a ledger taking a signature, and the market reforms by noon, and the booths' drains resume their patient swallowing, reporting now to you.",
                        "The Veiled Hands renew their contracts within the week. The clerks do not ask questions; the clerks have never asked questions. The quarterly buyer's mark arrives on schedule, addressed, this time, to the new holder.",
                        "Somewhere below, the Mirror registry reads a new intake half a second late, and begins, patiently, to build the file.",
                    ],
                },
                {
                    title: "Once a Season, At the Booth",
                    scene: "Nyx's stall, the good stool empty, the ledger open",
                    speaker: "Nyx",
                    dialogue: [
                        "I've verified three keepers in my working life. Each swore new terms. Each kept them, for a while; the glass has the patience of compound interest.",
                        "Sable asked the desperate for a safer truth for forty years. I'll bill you the same question once a season, at this stall, over tea you'll pay for, for as long as my books stay open.",
                        "Beat the interest, friend. I've never once seen it done, and I've got a frame ready over the stall, and I would genuinely love to hang your receipt in it.",
                    ],
                },
            ],
        },
    ],
    "Ashen Leaf Village": [
        // ── Break the shears (honorable) ──────────────────────────────────
        {
            lane: "honorable",
            requireTrait: "al88-better-winter-ready",
            title: "The Honest Winter, Watered",
            pages: [
                {
                    title: "What Came Back",
                    scene: "Dawn over ash-house row, frost on returned paper",
                    speaker: "Narrator",
                    dialogue: [
                        "By dawn the whole village knows what broke in the night. Forty strides of cedar stand dark for the first time in four hundred years, and the wall's lines are just names now, keeping nobody.",
                        "People stand in their doorways holding what came back. Jorun has a bridge in his hands, forty years late. The weaver is reading her own school out loud to anyone who passes.",
                        "The walls groan when the wind leans on them. The ash in the mortar has stopped holding. It will be a hard winter, and an honest one.",
                        "And far below the old kiln, where no root should reach, the lower pipe has gone cold. Somewhere beyond the village, something that fed on Ashen Leaf for four hundred years notices the missing warmth. That reckoning belongs to another season.",
                    ],
                },
                {
                    title: "The Channel Never Stopped",
                    scene: "The east terrace channel, water climbing through frost",
                    speaker: "Toma Reed",
                    dialogue: [
                        "The channel never stopped turning. All night, through everything, it just kept climbing. Ninety mouths, remember. It won't carry the whole village.",
                        "It doesn't have to. It has to prove the rest can be built, and it already did. Jorun is drawing his flood-channel bridge again. Sena is nine and furious with ideas. We have until the deep cold to be clever.",
                        "Mori is on the terrace edge with a spade. He said you would understand. Something about being present for one beginning.",
                    ],
                },
            ],
        },
        {
            lane: "honorable",
            title: "The Honest Winter",
            pages: [
                {
                    title: "What Came Back",
                    scene: "Dawn over ash-house row, doors open to the cold",
                    speaker: "Narrator",
                    dialogue: [
                        "By dawn the whole village knows what broke in the night. The Register wall stands dark, the lines just names now, and everything the fire was holding has come home to people who had learned to live without it.",
                        "There is crying in ash-house row, the good kind and the other kind. The walls groan when the wind leans on them. The granary is being counted twice.",
                        "Nobody has said thank you yet. Nobody has thrown a stone either. It is going to be close, all winter, every winter, for a while.",
                        "Far below the kiln, where no root should reach, a pipe has gone cold, and something beyond the village notices the missing warmth. Nobody in ash-house row knows to fear it yet. That is a story for another season.",
                    ],
                },
                {
                    title: "A Thin Spring, Freely Chosen",
                    scene: "The Reed kitchen, Aren's letter unfolded on the table",
                    speaker: "Toma Reed",
                    dialogue: [
                        "It's going to be a hungry spring. I want to say that plainly while I'm still brave. Nobody regrets it yet. Ask me again in the deep cold and I'll lie to you a little.",
                        "Aren's letter is on my mother's table now. She reads it every morning like it just arrived. That is worth a thin winter. I have to keep deciding that, and I keep deciding yes.",
                        "Come to the row tonight. We're planning fires people can actually sit around. It turns out that was always allowed.",
                    ],
                },
            ],
        },
        // ── Bind the Rootfire (merciful) ──────────────────────────────────
        {
            lane: "merciful",
            requireTrait: "al88-better-winter-ready",
            title: "Two Fires",
            pages: [
                {
                    title: "The Willing Flame",
                    scene: "The Rootfire chamber, one small clean flame, the alcove dusted",
                    speaker: "Narrator",
                    dialogue: [
                        "The Rootfire is small now, and clean. It burns exactly as bright as what people bring it, and people have been bringing things all morning: carved tokens, signed and given gladly, one by one.",
                        "The founders' alcove has been dusted. The iron racks stand empty, and Mori has already measured them for ordinary shelves.",
                        "Upstairs, the village is learning the new arithmetic. The fire keeps what is given freely, and only that.",
                        "And below the floor, the lower seam has found nothing legal left to take, and gone cold. Somewhere beyond the village, something notices the missing surplus. That reckoning is for another season.",
                    ],
                },
                {
                    title: "Bought Honestly Twice",
                    scene: "The kiln yard, steam and cold sunlight",
                    speaker: "Elder Mori",
                    dialogue: [
                        "Two fires now, if you count the channel. The willing flame for the worst nights, and Aren's machine for the ordinary ones. Between them, this winter is bought honestly twice over.",
                        "The alcove is filling again. Slowly, the way it should. Osu of the mill line would recognize this room at last.",
                        "You have made mercy into a working system, child. That is rarer than making it into a speech. Now come outside. There is planting to witness.",
                    ],
                },
            ],
        },
        {
            lane: "merciful",
            title: "The Thin Flame",
            pages: [
                {
                    title: "The Willing Flame",
                    scene: "The Rootfire chamber, one small clean flame",
                    speaker: "Narrator",
                    dialogue: [
                        "The Rootfire is small now, and clean, and honest, and everyone in the village understands exactly what that means for the cold season.",
                        "The willing alcove holds eleven new tokens by nightfall. Eleven, from a village of hundreds. Gladness was always a poor fuel. It is the only one left.",
                        "Nobody says the arithmetic out loud. Everyone is doing it.",
                        "Far below the kiln, the lower draw has run dry and gone cold. Somewhere beyond the village, something notices, and waits. But that is a colder season's problem.",
                    ],
                },
                {
                    title: "The Right to Be Asked",
                    scene: "The kiln stair, Toma turning a blank cedar token over",
                    speaker: "Toma Reed",
                    dialogue: [
                        "Eleven tokens. My mother's is one of them. I stood in that alcove for an hour with a blank piece of cedar, and I couldn't. I keep telling myself somebody has to stay unspent to do the work.",
                        "This is what you bought us, friend. The right to be asked. It is heavier than I thought, and I still want it.",
                        "Winter comes to a vote every year now. That is the deal. Help me make sure the vote keeps passing.",
                    ],
                },
            ],
        },
        // ── Take the shears (ambitious) — accusation depends on who carried
        //    the proof (owner FIX 12). Carried/deferred variants BEFORE base.
        {
            lane: "ambitious",
            requireTrait: "al88-better-winter-carried",
            title: "The Warm Chair",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The Rootfire chamber, the shears at your belt",
                    speaker: "Narrator",
                    dialogue: [
                        "The fire settles around you like a coat cut to your measure. Upstairs, forty strides of cedar are already learning your hand.",
                        "Hoshina's chair is still warm. Her room of taken wonders is yours now, every shelf of it, and the little walking loom goes still when you enter.",
                        "The keeper is dead. Long live the keeper. The wall has already put out a fresh black flower, and it is not for you.",
                    ],
                },
                {
                    title: "What Toma Saw",
                    scene: "The kiln stair door, Toma not coming in",
                    speaker: "Toma Reed",
                    dialogue: [
                        "I watched the water climb with my own eyes. Ninety mouths, not one future burned. You proved it. You carried the proof into that room in your own hands.",
                        "You showed her the door out and then sat down in her chair.",
                        "I don't know what to do with that. I've been standing here trying to build a sentence out of it and there isn't one.",
                        "Keep the model. I can't have it in the workshop. And don't send for me when the racks fill again, because they will, and you already know whose stamp goes on them.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            requireTrait: "al88-better-winter-deferred",
            title: "The Warm Chair",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The Rootfire chamber, the shears at your belt",
                    speaker: "Narrator",
                    dialogue: [
                        "The fire settles around you like a coat cut to your measure. Upstairs, forty strides of cedar are already learning your hand.",
                        "Hoshina's chair is still warm. Her room of taken wonders is yours now, every shelf of it, and the little walking loom goes still when you enter.",
                        "The keeper is dead. Long live the keeper. The wall has already put out a fresh black flower, and it is not for you.",
                    ],
                },
                {
                    title: "What Toma Saw",
                    scene: "The kiln stair door, Toma not coming in",
                    speaker: "Toma Reed",
                    dialogue: [
                        "You let us carry him in. You let my mother stand in front of the woman who cut him quiet and say his name out loud. I will hear that for the rest of my life.",
                        "Then you watched the door open and sat down in her chair anyway.",
                        "I don't know what to do with that. My mother doesn't either. She hasn't said a word since we came down the hill.",
                        "Keep the model. We don't want it back now. And don't send for us when the racks fill again, because they will, and we both know whose stamp goes on them.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            title: "Succession",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The Rootfire chamber, the shears at your belt",
                    speaker: "Narrator",
                    dialogue: [
                        "The fire settles around you like a coat cut to your measure. It does not celebrate. It has done this before.",
                        "In the morning the survey asks, very carefully, how you would like the schedules kept. The clerks have already changed the name on the approvals. The village is quiet, the way a field is quiet under snow.",
                        "Somewhere above, the wall puts out a fresh black flower on a stranger's line, and begins to wait again.",
                    ],
                },
                {
                    title: "Once a Year, To Your Face",
                    scene: "Mori's study, the bloom charts still open",
                    speaker: "Elder Mori",
                    dialogue: [
                        "Every keeper I have served stood where you are standing and believed they would be different. For a while, every one of them was. The fire is patient with new hands.",
                        "Hoshina asked angry people for a better winter for thirty years. I will ask you the same, once a year, to your face, for as long as I last.",
                        "The tree chose a new keeper. It always does. Prove an old man wrong, child. I would dearly like to file one surprise before I die.",
                    ],
                },
            ],
        },
    ],
};
