/*
 * story-epilogues — short post-finale reckoning scenes, shown once after the
 * kage-finale boss falls (owner brief 2026-07-09: "ending modifiers").
 *
 * Selection: first entry whose `lane` matches the finale lane choice the
 * player fought through AND whose trait gate (if any) is satisfied — so the
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
    /** Optional OR gate when carried/deferred presentation share an aftermath. */
    requireAnyTrait?: string[];
    title: string;
    pages: StoryEpiloguePage[];
};

export const storyEpiloguesByVillage: Record<string, StoryEpilogueDef[]> = {
    "Stormveil Village": [
        // ── Break the board (honorable) ───────────────────────────────────
        {
            lane: "honorable",
            requireAnyTrait: ["sv100-proof-presented-carried", "sv100-proof-presented-deferred"],
            title: "The Honest Sky, Anchored",
            pages: [
                {
                    title: "What Came Home",
                    scene: "Dawn over the arena, the board in pieces, slates raining reasons",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the whole village knows the board is gone. When it broke, every reason stored in its accounts returned to the person it came from. People remember why old fights began and what those reasons meant to them.",
                        "It is loud. Old feuds wake up mid-sentence. The Harlan brothers are shouting about a field again, and crying about it, and it is theirs to shout about, every word.",
                        "The sky over the coast is honest now, which means it is dangerous again, and nobody's grudge is holding it off anybody's roof.",
                        "The cistern under the arena has not drawn a drop since the board came down. Hollow Gate's collection ledger marks the Stormveil quarter unpaid and this village's intake at zero.",
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
                        "By morning the whole village knows the board is gone. When it broke, every reason stored in its accounts returned to the person it came from. People remember why old fights began and what those reasons meant to them.",
                        "It is loud, and it is going to stay loud. Anger with its memory back is weather of its own kind.",
                        "And above the loudness, the actual sky. Nobody's grudge holds it off anymore. The storm shield is a story now, and the season is turning.",
                        "Under the sand the floor's seams have gone dark, and the sweepers swear the old hum has finally stopped. Hollow Gate's Stormveil account now shows an unpaid quarter and an empty intake pipe.",
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
            requireAnyTrait: ["sv100-proof-presented-carried", "sv100-proof-presented-deferred"],
            title: "Two Shields",
            pages: [
                {
                    title: "The Metered Floor",
                    scene: "The arena, a public meter mounted over the drain, glass and brass",
                    speaker: "Narrator",
                    dialogue: [
                        "The floor still drinks, but now it drinks in public. A meter the size of a wagon wheel hangs over the arena where the odds used to be chalked, and anyone can read the draw, any hour, any day.",
                        "Posting a reason requires consent now, witnessed, written, revocable. The queues are short. It turns out very few people feed the floor when the floor has to ask.",
                        "The Guard checks the meter at every bell. So do the grandmothers, which is the part that actually keeps it honest.",
                        "The first collection after the fight found no valid consent and drew nothing. Hollow Gate still lists Stormveil's old debt as open; later lawful draws are possible, but the public meter shows how little people choose to feed it.",
                    ],
                },
                {
                    title: "Rock and Law",
                    scene: "The ridge at dusk, the web lit by lanterns",
                    speaker: "Mira Volt",
                    dialogue: [
                        "Two shields now. The metered floor for the worst weather, and my mother's lines for everything else. Every season the anchors take a bigger share and the meter reads a little lower.",
                        "Vanta refuses to chalk a closing date. The west crews missed two anchors before the last squall, and he will not bet their roofs on a date he cannot cover.",
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
                        "Three people revoke their consent in the first week. The arena clerk has to stop a bout while the whole rim waits, impatient and watchful, for the meter to settle.",
                        "The shield still needs feeding, the weather still comes, and each lawful draw is still a reason leaving someone on schedule.",
                        "The Hollow Gate still opens its pipe to Stormveil, but only for what the village signs over in daylight, witnessed, and fewer put their name to it every season the meter is read.",
                    ],
                },
                {
                    title: "The Clerk of Storms",
                    scene: "The tower office, the intake ledger open to your signature",
                    speaker: "Elder Vanta",
                    dialogue: [
                        "I moved my stool under the meter. Miserable view of the bouts. Excellent view of the numbers.",
                        "Your countersign sits beside every draw now. I chalk each one before I chalk the weather line, and if the figures disagree, the bout waits. The clerks hate me already. Reassuring.",
                        "Come eat before that chair teaches you to call being alone a duty. Soup's on me; public ledgers make poor company.",
                    ],
                },
            ],
        },
        // ── Take the seat (ambitious) ─────────────────────────────────────
        {
            lane: "ambitious",
            requireTrait: "sv100-proof-presented-deferred",
            title: "The Warm Tower, Named",
            pages: [
                {
                    title: "The New Weather",
                    scene: "The tower's storm floor, the seat's quiet hour settling on you",
                    speaker: "Narrator",
                    dialogue: [
                        "The quiet hour arrives on schedule. For one full hour, no grievance reaches the chair. The board reposts itself by morning bell.",
                        "In the routing office, the clerks have already changed the pressing mark to your teeth.",
                        "Down the coast, one ridge line hums over one district, holding its stretch of sky for free, signed with a dead rigger's name your board has already stopped saying.",
                        "You are now responsible for Stormveil's payments to Hollow Gate. The cistern continues draining reasons on the old schedule and has already accepted your authority. The system has not changed; only its keeper has.",
                    ],
                },
                {
                    title: "Her Mother Heard",
                    scene: "The tower gate, Mira not coming in",
                    speaker: "Mira Volt",
                    dialogue: [
                        "You kept the guards off me while I read my mother's slate. Raiko had to hear the words he buried. I won't pretend that meant nothing to me.",
                        "Then you took his chair. I waited outside because I wanted you to come back down and tell me I had understood you wrong.",
                        "The ridge anchors held. I checked every one myself. Stormveil has time to choose what comes next, and I won't spend that time helping you keep the board.",
                        "The boat leaves on the tide. I'm taking a route I have not put in any ledger. I suppose we'll find out exactly what you've become by whether anyone follows me.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            requireTrait: "sv100-proof-presented-carried",
            title: "The Warm Tower, Proven",
            pages: [
                {
                    title: "The New Weather",
                    scene: "The tower's storm floor, the seat's quiet hour settling on you",
                    speaker: "Narrator",
                    dialogue: [
                        "For one full hour, every grudge in Stormveil goes silent. It is exactly as good as he promised. The board reposts itself by morning bell, and the odds-runners are calling numbers on next week's weather.",
                        "In the routing office, the clerks have already changed the pressing mark to your teeth.",
                        "Down the coast, one ridge line hums over one district, holding its stretch of sky for free, and the board has begun, gently, to bet against it.",
                        "The cistern remains active after you take the Kage's seat. Hollow Gate keeps collecting Stormveil's payment, and you now decide which posted reasons will feed it. Control changed hands, but the system did not end.",
                    ],
                },
                {
                    title: "The Packed Bag",
                    scene: "The tower gate, Mira not coming in",
                    speaker: "Mira Volt",
                    dialogue: [
                        "I watched you put her slate beside the storm map and prove the ridge could hold. For one minute I thought we were both finally leaving that room free.",
                        "Then you claimed Raiko's chair. You knew what the board did to my family and chose to keep your hand on it anyway.",
                        "The new anchors are sound. Three hundred eleven roofs will make it through the next storm without your wagers.",
                        "My bag is packed again. I want you to know it wasn't, for a while. Hold your own sky, Kage.",
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
                        "The sky obeys, the quiet hour is everything he promised, and nothing in the tower needs re-rigging for your hand.",
                        "By first bell, the routing clerks have replaced Raiko's seal with yours without lifting their eyes. The meter of the elders' cut finds your account within the week.",
                        "Somewhere below, the board chalks a fresh bout between two friends, and the odds are very good. The floor has already begun drawing out their reasons.",
                        "The cistern never went still; it only changed seats. Up the hill the Hollow Gate marks Stormveil's quarter paid, on time, by a fresh hand, exactly as it has every season since the founders stopped giving and started being taken from.",
                    ],
                },
                {
                    title: "The Stool at the Rail",
                    scene: "The arena rail, Vanta's stool set directly beneath the reposted board",
                    speaker: "Elder Vanta",
                    dialogue: [
                        "I've chalked more than one succession onto that board. Every new hand promised kinder odds. I was fool enough to price the promise.",
                        "So I put my stool where the tower can see it. Each time the board posts two friends, I read their reasons before I chalk the purse. If you want me quiet, come down and move me yourself.",
                        "The board has you at even, child. I erased the line. Show me a result before I quote another.",
                    ],
                },
            ],
        },
    ],
    "Frostfang Village": [
        // ── Break every mark (honorable) ──────────────────────────────────
        {
            lane: "honorable",
            requireAnyTrait: ["ff100-proof-presented-carried", "ff100-proof-presented-deferred"],
            title: "The Chosen Roll, Lit",
            pages: [
                {
                    title: "What Came Home",
                    scene: "Dawn over the wall, bare wrists everywhere, breath-fog rising",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the whole village knows the vault is dark. It has returned forty years of stored refusals and doubts to the people it took them from. Many suddenly remember that they once wanted to leave, object, or choose differently.",
                        "It is quiet, and it is not calm. People keep touching their own wrists like a healed break. Two soldiers resigned at first bell. One asked to re-enlist an hour later, and Sova entered him with a note: BY CHOICE, and underlined it.",
                        "The hearths burn wood now. Wood runs short. The cold is honest again, which means it is dangerous again, and nobody's surrendered exit is holding it off anybody's child.",
                        "Far below the dark Vault, the lower draw goes quiet. No marked exit remains for it to collect.",
                    ],
                },
                {
                    title: "The Lanterns Take the Watch",
                    scene: "The north ridge, the relay burning down the line into the gray",
                    speaker: "Captain Yura",
                    dialogue: [
                        "Morning report. Each district has begun laying out a relay. Essen's gate crew is teaching the chant. Pale Pack members and people who once left the camp are teaching knots together, by choice and with plenty of argument.",
                        "Essen came home in nineteen minutes. The south line still tangles at the ravine, and the east crew lost the chant twice this morning. We drill those routes next.",
                        "It won't warm the barracks. It proves a search can hold without the vault. Come on. Sova's teaching the litany's new verse, and I want to hear whether the volunteers answer it.",
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
                        "By morning the vault is dark and every stored refusal has returned to its owner. Frostfang has also lost the unnatural heat those choices powered, so every home must rely on firewood and shared labor again.",
                        "The Roll still forms at every bell. Smaller. Slower. Every answer a choice now, and everyone can hear the difference, and the difference is terrible and it is better.",
                        "The first blizzard after will be the whole argument. Everybody knows it. Nobody says it. They stack wood.",
                        "Far below the dark Vault, the lower draw goes quiet. The silence is honest. It is also not warm.",
                    ],
                },
                {
                    title: "A Thin Wall, Freely Manned",
                    scene: "The wall walk, Yura assigning watches to volunteers only",
                    speaker: "Captain Yura",
                    dialogue: [
                        "A hungry winter is coming. That's a fact, not a complaint. Nobody has struck their own name from the Roll yet, and that is the only report that matters. Ask me again in the deep cold; I'll answer in cadence so you can't hear my teeth.",
                        "Every watch tonight is a volunteer. Some posts are still empty. That may cost lives in a storm. I have the order in my pocket that would fill them, and I am not giving it.",
                        "Come to the roll stone at third bell. We're calling the ridge post's names in the open now, all of them. It turns out that was always allowed.",
                    ],
                },
            ],
        },
        // ── Bind the vault (merciful) ─────────────────────────────────────
        {
            lane: "merciful",
            requireAnyTrait: ["ff100-proof-presented-carried", "ff100-proof-presented-deferred"],
            title: "Two Warmths",
            pages: [
                {
                    title: "The Metered Vault",
                    scene: "The vault hall, a public meter above the door, consent forms in a rack",
                    speaker: "Narrator",
                    dialogue: [
                        "The vault survives, caged. It may draw on a person's choice to leave only through posted consent, witnessed and revocable. Every mark in the village is re-signed or struck by its own wrist inside a month.",
                        "The meter above the door reads out the vault's hunger to anyone passing. The grandmothers check it the way they check weather. So do the children, who have invented a game about it, which the wardens have given up stopping.",
                        "And on the ridge, the lanterns burn every night: the searches that need no vault at all, eating into its purpose one found volunteer at a time.",
                        "Below the Vault, the lower draw opens once against the new law, finds nothing lawful left to drink, and shuts.",
                    ],
                },
                {
                    title: "The Keeper's Successor",
                    scene: "The records room, Sova's pen passed across the table",
                    speaker: "Elder Sova",
                    dialogue: [
                        "Two kinds of safety now. The lawful vault still provides heat on the killing nights; Coldewe's lamps take searches out of its hands. The lamps do not warm one room, and the meter still runs thin.",
                        "I will not date the last mark while the meter still thins on killing nights. Bring me each willing draw, each cord of wood, and each room that stayed warm. I will keep the count. Spite has kept me alive this long; hope can take a shift.",
                        "Take the pen. Start with the east relay missing its chant and the south barracks short two cords. If the warm-room count disagrees with the willing marks, circle it. That is the job.",
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
                        "The vault survives, caged. It may draw on a person's choice to leave only by posted, witnessed consent. Every new form carries a revocation line as large as the signature.",
                        "Eleven marks re-sign in the first week. The twelfth soldier reaches the table, reads the revocation clause twice, and takes the form home unsigned.",
                        "The wardens read the meter twice a bell. In the barracks, spare blankets appear on bunks before anyone admits why they are needed.",
                        "The lower draw is sealed by law now, but the village feels every theft it can no longer make, an ache with no name, all winter long.",
                    ],
                },
                {
                    title: "The Signature",
                    scene: "The vault door, your name first on the consent ledger's keeper line",
                    speaker: "Captain Yura",
                    dialogue: [
                        "The wall calls you the warden's warden. I don't. A post is a post, and yours has no relief bell.",
                        "Your name countersigns every draw. Mine is first on the cold-room roster. If a consent line thins or a barracks goes dark, bring me the room before you bring me the law.",
                        "Mess tent's covered tonight. That is not approval. It is food, and you still need it.",
                    ],
                },
            ],
        },
        // ── Take the valve (ambitious) ────────────────────────────────────
        {
            lane: "ambitious",
            requireTrait: "ff100-proof-presented-carried",
            title: "The Warm Door, Lit",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The vault floor, the script beginning at your wrist, warm as a bath",
                    speaker: "Narrator",
                    dialogue: [
                        "The valve unlocks under your palm when the keeper registry verifies you. The Count reforms by second bell, and the vault goes on turning people's choice to leave into warmth. The wardens change nothing but the name they report to.",
                        "On the ridge, one lantern relay burns where you drilled it, finding the lost for free, and the vault has already begun, gently, to schedule its wardens elsewhere.",
                        "The script at your wrist has begun the same slow spread recorded for every keeper before you.",
                    ],
                },
                {
                    title: "The Filed Refusal",
                    scene: "The vault stair, Yura not coming down",
                    speaker: "Captain Yura",
                    dialogue: [
                        "Ridge result: nineteen minutes, zero marks, Essen alive. Dren's plans entered under Dren's name. Kael heard every figure.",
                        "Final entry: you crossed the road out, turned at the threshold, and locked the warm door behind you. The keeper controls recognize your hand.",
                        "There is no order that makes the last entry acceptable. I checked.",
                        "Dren's letter goes into the ridge archive under his name. Don't send for me when the Count needs a captain. My wrist is bare, and my answer is no.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            requireTrait: "ff100-proof-presented-deferred",
            title: "The Warm Door",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The vault floor, the script beginning at your wrist, warm as a bath",
                    speaker: "Narrator",
                    dialogue: [
                        "The valve is warm before you touch it. The keeper registry has already verified you. The Count reforms by second bell, and the vault goes on turning people's choice to leave into warmth.",
                        "On the ridge, one lantern relay burns where a captain answered a dead man's roll, and the vault has already begun, gently, to reschedule its wardens around it.",
                        "The script at your wrist has begun the same slow spread recorded for every keeper before you.",
                        "Beneath the Vault, the lower draw remains closed until your first order.",
                    ],
                },
                {
                    title: "The North Post",
                    scene: "The vault stair, Yura not coming down",
                    speaker: "Captain Yura",
                    dialogue: [
                        "Dren's letter is in the ridge archive under his own name. I read it to Kael while you held the stair, and nobody gets to strike that out again.",
                        "Then you took the valve before the old script cooled. I waited for you to put it back. You didn't.",
                        "I know how to obey someone I disagree with. I don't know how to follow you after that, so I won't.",
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
                        "The Count reforms by second bell, and the warmth is everything he promised. The vault continues turning people's choice to leave into heat.",
                        "The wardens do not ask questions; the wardens have never asked questions. The meter finds your draw rhythm within a week and adjusts, accommodating, patient.",
                        "Somewhere above, the mark plate at the gate reads a new intake's wrist, holds it half a count long, and the frost leans in, and begins to wait again.",
                        "Beneath the Vault, the lower draw warms by one degree.",
                    ],
                },
                {
                    title: "The First Name After Yours",
                    scene: "The roll stone, Sova with the Count book open beneath the new keeper's entry",
                    speaker: "Elder Sova",
                    dialogue: [
                        "Your name is entered. I ruled one line beneath it and left the next space open. The book has mistaken neatness for truth long enough.",
                        "The first person who asks to leave will stand at this stone. I will hand you the Roll, and you will answer them where every marked wrist can hear.",
                        "There is one blank leaf at the back, child. I kept it through forty winters. What goes on it is your work now, not my prediction.",
                    ],
                },
            ],
        },
    ],
    "Moonshadow Village": [
        // ── Open the tank (honorable) ─────────────────────────────────────
        {
            lane: "honorable",
            requireAnyTrait: ["ms100-proof-presented-carried", "ms100-proof-presented-deferred"],
            title: "The Open Ledger, Witnessed",
            pages: [
                {
                    title: "What Went Home",
                    scene: "Dawn over the canal, the Mirror dark, four hundred years of trust flowing home",
                    speaker: "Narrator",
                    dialogue: [
                        "By morning the Mirror's tank is empty. It has returned four hundred years of stored confessions, names, memories, and trust to the people they came from.",
                        "The moment the tank opened, one clear line crossed the glass ahead of the flood, and the oldest voice in the Mirror spoke its release. OWNERSHIP RETURNED. CLAIMS RELEASED.",
                        "Some of it burns. A broker's marriage. Two old feuds, rearmed. The village chose to own its own fires, and some of them are real fires.",
                        "A return queue forms at the booth with the blocked drain. Witnesses sit with each person, offer tea, and give them time to process what came back.",
                        "The black plate now confirms every return with the same message: OWNER VERIFIED. RETURN WITNESSED. NO HOLDER REQUIRED. Giving a record back to its owner has become the booth's normal rule.",
                        "Far below the tower's foundations, the deeper pipe that fed the quartered circle for four hundred years pulls once at the empty tank, finds nothing left to hold, and goes still.",
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
                        "But every fire is the village's own, burning in the open. Slowly, street by street, people learn how to sit beside a neighbor reading a returned page without demanding the page or an explanation.",
                        "Far below, the deeper pipe pulls once at the empty tank, finds nothing left to hold, and goes cold. The quartered circle's four-hundred-year draw on Moonshadow is over.",
                    ],
                },
                {
                    title: "The Long Noon",
                    scene: "The square at noon, the shrine witness reading the fourth name",
                    speaker: "Nyx",
                    dialogue: [
                        "Ugly season ahead; I've got odds posted on which neighbors stop speaking first. People have asked me to verify what came back. Some ask me to hold it again. I refuse that service now.",
                        "At noon the shrine witness read one name from her copied pages. A family disputed the spelling for ten minutes, then brought out an old letter and corrected the record together.",
                        "That is the work now: verify, witness, return, and admit when the page is incomplete. Come to the booth; the tea's honest and the drain is lead.",
                    ],
                },
            ],
        },
        // ── Seal the lethal tenth (merciful) ──────────────────────────────
        {
            lane: "merciful",
            requireAnyTrait: ["ms100-proof-presented-carried", "ms100-proof-presented-deferred"],
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
                        "Every retained truth must be renewed by its owner, and when consent is withdrawn the glass clears ahead of any keeper's objection. CONSENT REQUIRED. CLAIM REVOCABLE. AUDIT WITNESSED. The oldest voice in the glass releases the claim before the seal can argue.",
                        "Far below the foundations, the deeper pipe opens once against the new covenant, finds nothing it is any longer allowed to take, and shuts.",
                    ],
                },
                {
                    title: "The Noon Question",
                    scene: "The open square, the audit table, the whole market entitled to ask",
                    speaker: "Nyx",
                    dialogue: [
                        "You built a public keeper instead of another hidden ruler. Every noon, anyone can ask what the Mirror holds and why, and you must answer.",
                        "If the answer is not acceptable, the new covenant allows the market to vote the seal open and inspect the records itself.",
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
                        "The last tenth sits sealed under your covenant: audited, consented, lawful. At the first noon audit, two owners demand release and one asks for another week. The glass obeys all three.",
                        "The audits pass, season after season, and the line grows shorter. 'Trust the keeper,' people say. By the fourth audit, the last lock closes in an almost empty square, with no one near enough to hear whether an owner changed their mind.",
                        "Below the foundations, the deeper pipe opens once against the new law, finds nothing lawful left to draw, and shuts.",
                    ],
                },
                {
                    title: "The Keeper's Ledger",
                    scene: "The audit table at noon, Iro first in line, on principle",
                    speaker: "Shade Master Iro",
                    dialogue: [
                        "I moved the audit table against the glass. Your chair is on the other side, where you can see what you are asking us to leave sealed.",
                        "I bring one drawer's inventory at noon: owner, consent, reason held. If those three lines disagree, the drawer opens before either of us finds a graceful excuse.",
                        "Tea remains at cost. Oversight is exhausting, and I refuse to perform it thirsty.",
                    ],
                },
            ],
        },
        // ── Take the Mirror (loyal) ───────────────────────────────────────
        {
            lane: "loyal",
            requireTrait: "ms100-proof-presented-deferred",
            title: "The Unpriced Keeper, Named",
            pages: [
                {
                    title: "The New Glass",
                    scene: "The Mirror chamber, the tank recognizing a keeper it cannot appraise",
                    speaker: "Narrator",
                    dialogue: [
                        "The tank's registry reads your hand, finds no price on it, and settles into custody it cannot bill.",
                        "The buyer's escrow hangs unexecutable. Below the canal, Hollow Gate's collection ledger adds an extension beside Moonshadow's account.",
                        "And in the glass's black depth, one ripple never quite stills: the copied act of trust created when a woman said her own name for free, the one entry the tank holds that it does not own.",
                        "When your hand first rests on the glass, the oldest voice in it speaks once, without heat. OWNER VERIFIED. HOLDER PRESENT. RELEASE INCOMPLETE. The First Reflection remembers Nerissa Vale. It records that the keeper's chair is occupied. It offers no opinion.",
                    ],
                },
                {
                    title: "Nerissa at the Door",
                    scene: "The chamber door, Nyx not coming in",
                    speaker: "Nyx",
                    dialogue: [
                        "Nerissa Vale sounded strange the first time I said it in that chamber. Then it sounded like mine. The receipt hangs over my stall where I can check whenever I forget.",
                        "You took the key before the echo stopped. I waited at the door for you to open the tank anyway.",
                        "You didn't. You hurt me. Don't ask me to call it protection while my name sits behind your lock.",
                        "Nerissa Vale trades on the east canal now, daylight hours, true names only. Come by if you're ever just a person again. First tea's free. The second one, keeper, costs more than you currently have.",
                    ],
                },
            ],
        },
        {
            lane: "loyal",
            requireTrait: "ms100-proof-presented-carried",
            title: "The Unpriced Keeper",
            pages: [
                {
                    title: "The New Glass",
                    scene: "The Mirror chamber, the tank recognizing a keeper it cannot appraise",
                    speaker: "Narrator",
                    dialogue: [
                        "The tank's registry reads your hand, finds no price on it, and settles into custody it cannot bill.",
                        "The buyer's escrow hangs over the glass, unexecutable, a collection notice served on a blank line. Below the canal, Hollow Gate's collection ledger adds an extension beside Moonshadow's account.",
                        "The market reforms by noon; markets always do. But the booths' drains run to a tank with a keeper now, and that keeper watched a returns queue teach a village to hand things back. Every new act of trust copied by the Mirror is now a choice you must make, not an automatic claim.",
                    ],
                },
                {
                    title: "The Keeper's Door",
                    scene: "The chamber door, Nyx not coming in",
                    speaker: "Nyx",
                    dialogue: [
                        "My file reached the glass under your seal. Sable had to read the bad winter into the room and answer for every return behind it.",
                        "Then you took the seat instead of the exit. You say holding the tank keeps someone worse from taking it. I heard you. I still watched my file disappear behind a keeper's door again.",
                        "Your name on the key doesn't make that hurt less. I haven't decided whether I can trust you with what comes next.",
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
                        "The glass recognizes you before the village does. The market reforms by noon, and the booths' drains resume their patient swallowing, reporting now to you.",
                        "The Veiled Hands renew their contracts within the week. A clerk carries the quarterly buyer's mark to the chamber and asks where the new holder wants it filed.",
                        "Somewhere below, the Mirror registry reads a new intake half a second late and begins building the file.",
                        "Deep in the glass, an older instruction tries once to speak. The new intake drowns it out.",
                    ],
                },
                {
                    title: "The Keeper's Open Account",
                    scene: "Nyx's stall, a new account open beneath the keeper's name",
                    speaker: "Nyx",
                    dialogue: [
                        "I closed your old account and opened this one under KEEPER. Two columns: records held, records returned. No credit for intentions.",
                        "I won't wait for a season to send the bill. When the numbers move, a runner comes to the tower. You can ignore her. The market will still know which column changed.",
                        "The frame over my stall is empty, friend. Send me one receipt that proves somebody trusted you and got their truth back.",
                    ],
                },
            ],
        },
    ],
    "Ashen Leaf Village": [
        // ── Break the shears (honorable) ──────────────────────────────────
        {
            lane: "honorable",
            requireAnyTrait: ["al100-proof-presented-carried", "al100-proof-presented-deferred"],
            title: "The Honest Winter, Watered",
            pages: [
                {
                    title: "What Came Back",
                    scene: "Dawn over ash-house row, frost on returned paper",
                    speaker: "Narrator",
                    dialogue: [
                        "By dawn the whole village knows what broke in the night. Forty strides of cedar stand dark, and the wall's lines are just names now, keeping nobody.",
                        "People stand in their doorways holding the futures that came back. Jorun has a bridge in his hands, forty years late. The weaver is reading her own school out loud to anyone who passes.",
                        "The walls groan when the wind leans on them. The ash in the mortar has stopped holding. It will be a hard winter, and an honest one.",
                        "Far below the old kiln, where no root should reach, the lower pipe has gone cold. In Hollow Gate's collection ledger, Ashen Leaf's four-hundred-year flow now reads zero. The entry travels uphill before anyone in ash-house row knows to fear it.",
                    ],
                },
                {
                    title: "The Channel Never Stopped",
                    scene: "The east terrace channel, water climbing through frost",
                    speaker: "Toma Reed",
                    dialogue: [
                        "The channel never stopped turning. All night, through everything, it just kept climbing. Ninety mouths, remember. It won't carry the whole village.",
                        "It proves this channel can be built and run. The next one still needs lumber, hands, and a route that will not flood the low fields. Jorun is drawing his bridge again. Sena is nine and furious with ideas. None of that replaces the missing heat.",
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
                        "By dawn the Register wall is dark and shows only names. The Rootfire has returned the plans, ambitions, and possible futures it stored to the people they were taken from.",
                        "There is crying in ash-house row, the good kind and the other kind. The walls groan when the wind leans on them. The granary is being counted twice.",
                        "Nobody has said thank you yet. Nobody has thrown a stone either. It is going to be close, all winter, every winter, for a while.",
                        "Far below the kiln, where no root should reach, a pipe has gone cold. Hollow Gate's collection ledger records the missing warmth. In ash-house row, nobody sees the entry; they are busy counting grain and splitting kindling.",
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
            requireAnyTrait: ["al100-proof-presented-carried", "al100-proof-presented-deferred"],
            title: "Two Fires",
            pages: [
                {
                    title: "The Willing Flame",
                    scene: "The Rootfire chamber, one small clean flame, the alcove dusted",
                    speaker: "Narrator",
                    dialogue: [
                        "The Rootfire is small now, and clean. It burns exactly as bright as the futures people bring it, and people have been bringing carved tokens all morning, signed and given gladly, one by one.",
                        "The founders' alcove has been dusted. The iron racks stand empty, and Mori has already measured them for ordinary shelves.",
                        "Upstairs, the village is learning the new arithmetic. The fire keeps what is given freely, and only that.",
                        "Below the floor, the lower seam finds nothing legal left to take and goes cold. Hollow Gate's collection ledger records the missing surplus beside the first willing tally.",
                    ],
                },
                {
                    title: "Bought Honestly Twice",
                    scene: "The kiln yard, steam and cold sunlight",
                    speaker: "Elder Mori",
                    dialogue: [
                        "The willing flame may carry a kiln on the worst nights. Aren's channel feeds ninety mouths and warms none of them. I am counting firewood separately now, and every crew wants the same hands before snow.",
                        "The alcove is filling again. Slowly, the way it should. Osu of the mill line would recognize this room at last.",
                        "Eleven willing tokens to catalogue, three kiln crews arguing over one cart, and a sapling waiting outside because I promised I would be present for one beginning. Bring the spade, child.",
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
                        "The Rootfire is small now, and clean. The kiln yard is already cold enough for breath to show.",
                        "The willing alcove holds eleven new tokens by nightfall. Eleven, from a village of hundreds. Freely given futures were always poor fuel. They are the only fuel left.",
                        "At dusk, the kiln clerk carries the eleven-token count from cold room to cold room. No one signs merely to improve it.",
                        "Far below the kiln, the lower draw has run dry and gone cold. Hollow Gate's collection ledger records the loss, but whoever reads that ledger is a colder season's problem.",
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
            requireTrait: "al100-proof-presented-carried",
            title: "The Warm Chair, Watered",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The Rootfire chamber, the shears at your belt",
                    speaker: "Narrator",
                    dialogue: [
                        "The shears balance perfectly in your hand. That is worse than if they had felt wrong. Upstairs, forty strides of cedar are already learning your grip.",
                        "Hoshina's chair is still warm. Her room of stolen futures is yours now, every shelf of it, and the little walking loom goes still when you enter.",
                        "The keeper is dead. Long live the keeper. The wall has already put out a fresh black flower, and it is not for you.",
                    ],
                },
                {
                    title: "The Chair",
                    scene: "The kiln stair door, Toma not coming in",
                    speaker: "Toma Reed",
                    dialogue: [
                        "I watched the water climb with my own eyes. Ninety mouths, not one future burned. You carried the proof into that room and made her answer what she buried.",
                        "Then you sat down in her chair. I kept expecting you to stand up again once the fight was over.",
                        "You knew what the shears did to Aren. Keeping them was still your choice, and I can't make it easier for you by staying.",
                        "Keep the reconstruction until my family asks for it. Don't send for me when the racks fill again. Your stamp will already be on them.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            requireTrait: "al100-proof-presented-deferred",
            title: "The Warm Chair",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The Rootfire chamber, the shears at your belt",
                    speaker: "Narrator",
                    dialogue: [
                        "The shears balance perfectly in your hand. That is worse than if they had felt wrong. Upstairs, forty strides of cedar are already learning your grip.",
                        "Hoshina's chair is still warm. Her room of stolen futures is yours now, every shelf of it, and the little walking loom goes still when you enter.",
                        "The keeper is dead. Long live the keeper. The wall has already put out a fresh black flower, and it is not for you.",
                    ],
                },
                {
                    title: "The Reed Kitchen",
                    scene: "The kiln stair door, Toma not coming in",
                    speaker: "Toma Reed",
                    dialogue: [
                        "My mother said Aren's name in that chamber and Hoshina had to remember him whole. You kept the door open long enough for that.",
                        "Now my mother keeps asking which part of the night to believe: the person who made room for her, or the new keeper sitting behind the same racks.",
                        "I don't have an answer. She hasn't spoken since we came down the hill.",
                        "The model stays with our family. It is not a token for your new office. Don't send for us when the racks fill again; we both know whose stamp will be on them.",
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
                        "Somewhere above, the wall puts out a fresh black flower on a stranger's line and marks another future for the shears.",
                    ],
                },
                {
                    title: "The Next Black Flower",
                    scene: "The Register hall, Mori beside a new line in the bloom chart",
                    speaker: "Elder Mori",
                    dialogue: [
                        "A black flower opened this morning. I wrote the family's name, what the child builds, and the hour the survey noticed. No blessing. No euphemism.",
                        "When the gray coats come, I will bring the family to your chamber before you touch the shears. You will hear what they mean to become while the answer can still inconvenience you.",
                        "The family is waiting outside my study now. I told them I would bring them your answer myself.",
                    ],
                },
            ],
        },
    ],
};
