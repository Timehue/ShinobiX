export type StoryReckoningTaskKind = "hunt" | "collect";
export type StoryReckoningMetric = "totalAiKills" | "totalTilesExplored";

export type StoryReckoningChoice = {
    text: string;
    conclusion?: string;
    trait?: string;
    requireTrait?: string;
    accept?: boolean;
};

export type StoryReckoningPage = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
    choices?: StoryReckoningChoice[];
};

export type StoryReckoningBoss = {
    bossId: string;
    name: string;
    icon: string;
    portrait: string;
    loadoutId: "balanced" | "bruiser" | "defender" | "boss";
    statBonus: number;
    levelOffset: number;
};

export type StoryReckoning = {
    id: string;
    slug: string;
    village: string;
    /** A cross-village figure who stands at ANY village's outskirts once the player
     *  has finished their own arc (gated on storyProgress/level, not storyVillage).
     *  `village` is then only a placeholder for ordering. */
    crossVillage?: boolean;
    npcName: string;
    levelReq: number;
    ownProgress: number;
    completionTrait: string;
    title: string;
    task: {
        kind: StoryReckoningTaskKind;
        metric: StoryReckoningMetric;
        target: number;
        dropItemId: string;
        targetName: string;
        boss?: StoryReckoningBoss;
    };
    reward: { weight: number; fateShards?: number; title: string };
    intro: StoryReckoningPage[];
    payoff: StoryReckoningPage[];
};

export const storyReckonings: StoryReckoning[] = [
    {
        id: "story-reckoning-vanta-ninth",
        slug: "vanta-ninth",
        village: "Stormveil Village",
        npcName: "Elder Vanta",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "svr-vanta-ninth-closed",
        title: "The Ninth Share",
        task: {
            kind: "hunt",
            metric: "totalAiKills",
            target: 1,
            dropItemId: "event-kesa-storm-seal",
            targetName: "Warden Sesk",
            boss: { bossId: "svr-warden-sesk", name: "Warden Sesk", icon: "WS", portrait: "/portraits/warden-sesk.webp", loadoutId: "boss", statBonus: 4, levelOffset: 2 },
        },
        reward: { weight: 6, fateShards: 1, title: "Storm-Witness" },
        intro: [
            {
                title: "The Old Man at the Boundary",
                scene: "The Stormveil outskirts, where the arena road gives way to open sky",
                speaker: "Elder Vanta",
                dialogue: [
                    "Vanta waits beside the last boundary stone with a book under one arm and no proverb ready.",
                    "Kesa Volt's account is closed, but the old machinery did not stop reaching for people who still remember her.",
                    "A collector named Sesk carries one of the seals that kept her reason profitable. I signed enough ledgers to know the stamp.",
                ],
            },
            {
                title: "Close the Share",
                scene: "The boundary road, rain gathering over the arena cables",
                speaker: "Elder Vanta",
                dialogue: [
                    "I cannot send village guard after him. Half the paper that protects him has my handwriting on it.",
                    "You are not on that paper. Find Sesk, take back Kesa's storm-seal, and bring it here where I have to look at it.",
                    "Then the ninth share dies in daylight instead of earning interest in a drawer.",
                ],
                choices: [
                    { text: "Take the writ. Hunt down Warden Sesk.", accept: true },
                    { text: "Not yet. This should not be rushed.", trait: "svr-vanta-weighed-it", conclusion: "Vanta nods once. A reckoning that waited six years can wait for you to mean it." },
                ],
            },
        ],
        payoff: [
            {
                title: "The Seal Comes Home",
                scene: "The boundary stone, the storm-seal cold in your hand",
                speaker: "Elder Vanta",
                dialogue: [
                    "Vanta takes the seal and turns it once. The old man's hands do not shake, but the book under his arm does.",
                    "Sesk had names ready for the next column. Those names are ash now.",
                    "Keep the seal. I have kept enough of Kesa Volt. Let someone honest carry the weight.",
                ],
                choices: [
                    { text: "Post the ledger where the village can read it.", trait: "svr-vanta-open-ledger", conclusion: "He opens the book on the boundary stone and writes until the rain starts hitting ink." },
                    { text: "Some debts close only when someone stops collecting.", trait: "svr-vanta-clean-close", conclusion: "For once, Vanta looks less like an elder than an old man who has put down a hot coal." },
                ],
            },
        ],
    },
    {
        id: "story-reckoning-mira-marker",
        slug: "mira-marker",
        village: "Stormveil Village",
        npcName: "Mira Volt",
        levelReq: 25,
        ownProgress: 3,
        completionTrait: "svr-mira-marker-set",
        title: "Kesa's Marker",
        task: {
            kind: "collect",
            metric: "totalTilesExplored",
            target: 12,
            dropItemId: "event-kesa-marker",
            targetName: "the scattered marker pieces",
        },
        reward: { weight: 4, title: "Ridge-Walker" },
        intro: [
            {
                title: "The Watcher on the Ridge Road",
                scene: "The Stormveil outskirts, where the ridge path starts climbing",
                speaker: "Mira Volt",
                dialogue: [
                    "Mira sits on the last boundary stone with her black book closed. That is how you know she is here as herself.",
                    "My mother's ridge marker was broken up for pressed flowers. Kesa Volt, reduced to resale value one more time.",
                    "The pieces are scattered along the outskirts road. I can walk it alone. I keep not walking it alone.",
                ],
                choices: [
                    { text: "Walk the outskirts and gather every piece.", accept: true },
                    { text: "Later. I want to do this carefully.", trait: "svr-mira-weighed-it", conclusion: "Mira opens the book just enough to mark your answer. Carefully is allowed, she says." },
                ],
            },
        ],
        payoff: [
            {
                title: "The Marker, Set Again",
                scene: "The ridge gate, the marker pieces fitted back together",
                speaker: "Mira Volt",
                dialogue: [
                    "Mira fits the pieces together on the stone, slow enough that the order becomes part of the work.",
                    "Kesa Volt. Cable rigger. Storm answer. My mother before any board learned how to spend her.",
                    "One piece was extra. She always pressed too many flowers. Keep it. Someone should carry her without charging admission.",
                ],
                choices: [
                    { text: "Her line holds because people still carry it.", trait: "svr-mira-line-carried", conclusion: "Mira writes your name under Kesa's in the book, not as a debt. As a witness." },
                    { text: "Set the marker where everyone leaving sees it.", trait: "svr-mira-public-marker", conclusion: "Mira plants it at the gate, where every road out has to pass the name first." },
                ],
            },
        ],
    },

    // ── Ashen Leaf: Toma Reed, "Cinders of the Register" (COLLECT) ────────────
    {
        id: "story-reckoning-toma-cinders",
        slug: "toma-cinders",
        village: "Ashen Leaf Village",
        npcName: "Toma Reed",
        levelReq: 30,
        ownProgress: 3,
        completionTrait: "alr-toma-cinders-read",
        title: "Cinders of the Register",
        task: { kind: "collect", metric: "totalTilesExplored", target: 12, dropItemId: "event-reed-tally", targetName: "the scattered cedar plates" },
        reward: { weight: 4, title: "Name-Keeper" },
        intro: [
            {
                title: "The Clerk at the Ash Line",
                scene: "The Ashen Leaf outskirts, ash drifting past the last boundary post",
                speaker: "Toma Reed",
                dialogue: [
                    "Toma is crouched at the edge of the road, sorting scorched cedar plates into two piles, and not doing it quickly.",
                    "The drain took a whole column of names last month. Scrubbed clean, filed under weather. My family was in that column. Reed.",
                    "They broke the cedar plates up and scattered them out here where the wind does the rest. I keep meaning to gather them. I keep finding reasons not to.",
                ],
            },
            {
                title: "A Name Is Not a Number",
                scene: "The ash road climbing off the outskirts",
                speaker: "Toma Reed",
                dialogue: [
                    "A name is not a number until somebody decides to spend it. That is the whole trick of this place. You forget you are people.",
                    "The plates are out there along the road, wherever the ash and the pickers dropped them. Walk the ground. You will feel them under your boots before you see them.",
                    "Bring them back and I will read every name aloud, once, where the register clerks can hear me do it.",
                ],
                choices: [
                    { text: "Walk the outskirts and gather every plate.", accept: true },
                    { text: "Later. I want to do this with a clear head.", trait: "alr-toma-weighed-it", conclusion: "A clear head, he says, is more than most of them bring to it. He will wait." },
                ],
            },
        ],
        payoff: [
            {
                title: "Read Aloud, Once",
                scene: "The outskirts register post, the cedar plates gathered in your hands",
                speaker: "Toma Reed",
                dialogue: [
                    "Toma lays the plates out in order, slow, and reads each name to the empty road as if it were full.",
                    "One plate is yours. Reed, it says, same as the rest, but this one my grandmother chamfered wrong and kept anyway. She was a joiner. Keep it.",
                    "They can strike a name. They cannot strike the person who carried it, not while somebody says it out loud.",
                ],
                choices: [
                    { text: "\"You told me you still hoped this village could be fixed. I remember.\"", requireTrait: "toma-hope", trait: "alr-toma-still-hopes", conclusion: "He almost smiles. Then help me fix it, he says, and reads the next name louder than the last." },
                    { text: "\"You had doubts about me once. Fair. I had them about myself.\"", requireTrait: "toma-doubt", trait: "alr-toma-doubt-mended", conclusion: "He does not say the doubt is gone. He says it is smaller than it was this morning, and hands you the plates to hold while he reads." },
                    { text: "\"Read them every year. Make it a thing people show up for.\"", trait: "alr-toma-annual-reading", conclusion: "He writes the date on the register post in charcoal, where the clerks scrub, so they will have to scrub it every year and remember why." },
                ],
            },
        ],
    },

    // ── Ashen Leaf: Elder Mori, "The Working Copy" (HUNT) ─────────────────────
    {
        id: "story-reckoning-mori-working-copy",
        slug: "mori-working-copy",
        village: "Ashen Leaf Village",
        npcName: "Elder Mori",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "alr-mori-copy-set",
        title: "The Working Copy",
        task: {
            kind: "hunt",
            metric: "totalAiKills",
            target: 1,
            dropItemId: "event-struck-nameplate",
            targetName: "Redactor Sella",
            boss: { bossId: "alr-redactor-sella", name: "Redactor Sella", icon: "RS", portrait: "/portraits/redactor-sella.webp", loadoutId: "boss", statBonus: 4, levelOffset: 2 },
        },
        reward: { weight: 6, fateShards: 1, title: "Ash-Witness" },
        intro: [
            {
                title: "The Archivist at the Gate",
                scene: "The Ashen Leaf outskirts, a battered ledger under Mori's arm",
                speaker: "Elder Mori",
                dialogue: [
                    "Mori is standing where the road gives out, holding a ledger he clearly does not want to be holding.",
                    "I keep a working copy. Every name the official register erases, I copy into a second book first. I have told myself for forty years that this makes me the honest one.",
                    "It does not. It makes me a man with a list of people he watched get erased, filed neatly, in order.",
                ],
            },
            {
                title: "Struck and Sold",
                scene: "The boundary post, ash on the wind",
                speaker: "Elder Mori",
                dialogue: [
                    "There is a redactor working this road now. Sella. She strikes names for the drain and feeds the struck cedar to the fire-crews for a cut, and she is very good at both.",
                    "One of those plates says Aren Reed. A boy Toma still sets a place for. Struck, filed, and marked for the burning.",
                    "I cannot touch her. I co-signed the erasure orders that made her work lawful, season after season, in my own hand. But you are someone the register never wrote down. There is no line of you for her to strike.",
                ],
            },
            {
                title: "Bring It to the Working Copy",
                scene: "The boundary post at dusk",
                speaker: "Elder Mori",
                dialogue: [
                    "Find Sella. Take back Aren's cedar plate before it goes to the fire. Bring it here, to me, and I will set it in the working copy where it should have stayed.",
                    "Then I will do the thing I have avoided for forty years. I will cut my own name into the book beside the ones I let get struck.",
                    "Go. Before I find a reason it can wait until spring.",
                ],
                choices: [
                    { text: "Take the plate. Hunt down Redactor Sella.", accept: true },
                    { text: "Not yet. I want to know the whole ledger first.", trait: "alr-mori-weighed-it", conclusion: "He nods. The ledger, he says, is not going anywhere, and neither, unfortunately, is he." },
                ],
            },
        ],
        payoff: [
            {
                title: "Set It in the Book",
                scene: "The boundary post, the struck name-plate in your hand",
                speaker: "Elder Mori",
                dialogue: [
                    "Mori takes the plate, reads it, and does not pretend his hands are steady.",
                    "Sella had a whole crate stacked for the burning. Cedar plates, every one a person somebody was ordered to forget. I have entered the crate into the working copy as testimony instead. It warms no fire now.",
                    "The plate is yours to carry. I have carried the guilt of it long enough that I have no right to also keep the proof.",
                ],
                choices: [
                    { text: "\"You refused the cut when it was offered. That mattered.\"", requireTrait: "al58-refused-the-cut", trait: "alr-mori-clean-hands", conclusion: "Refusing the cut, he says, is not the same as being clean. But it is the first honest thing I did in this office, and you were there for it." },
                    { text: "\"You took the knowledge and did nothing with it. Now do something.\"", requireTrait: "al58-took-the-knowledge", trait: "alr-mori-put-to-use", conclusion: "He does not flinch from it. Then this is me doing something with it, he says, and writes Aren's name into the working copy in a hand that finally stops shaking." },
                    { text: "\"Claim the name out loud. Make the working copy the real one.\"", trait: "alr-mori-copy-made-real", conclusion: "He carries the working copy to the register house himself, in daylight, and swears it in as the true book before the survey office can prepare an objection." },
                ],
            },
        ],
    },

    // ── Frostfang: Elder Sova, "The True Roll" (COLLECT) ──────────────────────
    {
        id: "story-reckoning-sova-true-roll",
        slug: "sova-true-roll",
        village: "Frostfang Village",
        npcName: "Elder Sova",
        levelReq: 42,
        ownProgress: 4,
        completionTrait: "ffr-sova-roll-bound",
        title: "The True Roll",
        task: { kind: "collect", metric: "totalTilesExplored", target: 12, dropItemId: "event-true-roll-page", targetName: "the scattered roll pages" },
        reward: { weight: 5, title: "Roll-Reader" },
        intro: [
            {
                title: "The Records-Keeper in the Snow",
                scene: "The Frostfang outskirts, snow whipping past the gate stones",
                speaker: "Elder Sova",
                dialogue: [
                    "Sova stands at the last gate stone with her coat open to the cold, as if she feels she has not earned the warmth.",
                    "There is the Count, which is the official book, and there is the roll, which is who was actually alive. For sixty-one winters I have kept both and shown only one.",
                    "The true roll came apart in the last storm. The pages of the struck names, the ones the Vault stopped counting. They are out there in the drifts.",
                ],
            },
            {
                title: "Who Is Owed, Who Is Missed",
                scene: "The ridge road above the outskirts",
                speaker: "Elder Sova",
                dialogue: [
                    "The Count keeps who is owed. The roll keeps who is missed. They stopped matching a long time ago, and I let them.",
                    "Walk the snow. The pages are heavy paper, waxed against the wet. You will find them caught in the ice fences and the drift shadows.",
                    "Bring them back and I will bind the roll again, and this time I will read it beside the Count, out loud, so the difference has to be looked at.",
                ],
                choices: [
                    { text: "Walk the outskirts and gather every page.", accept: true },
                    { text: "Later. The cold makes me want to do this right.", trait: "ffr-sova-weighed-it", conclusion: "The cold, she says, is the only honest thing at this gate. She will wait in it." },
                ],
            },
        ],
        payoff: [
            {
                title: "Bound Again",
                scene: "The gate stone, the roll pages gathered and iced stiff in your hands",
                speaker: "Elder Sova",
                dialogue: [
                    "Sova thaws each page against her own chest before she will read it, which takes a long time, which is the point.",
                    "One page is yours. It carries the names from the winter the Vault first ran the lower draw, when I first knew and first said nothing. Keep it.",
                    "A struck name is not a settled account. It is a person the cold was allowed to reach. Carry the difference. Somebody in this office finally should.",
                ],
                choices: [
                    { text: "\"You held your doubt instead of filing it away. That took something.\"", requireTrait: "ff42-held-the-doubt", trait: "ffr-sova-doubt-kept", conclusion: "A doubt you only hold keeps your hands clean and changes nothing, she says. Reading it aloud dirties them. You are the reason I would rather have the dirt." },
                    { text: "\"You reported the doubt by the book. Now unreport it, in the open.\"", requireTrait: "ff42-reported-the-doubt", trait: "ffr-sova-doubt-undone", conclusion: "She pulls the report you filed and reads it back to front at the gate, saying aloud everything the official version left out, until the by-the-book account is the one that sounds like the lie." },
                    { text: "\"Bind the roll beside the Count where the whole village walks past.\"", trait: "ffr-sova-roll-posted", conclusion: "She hangs both books open at the gate stone, roll beside Count, and stands beside them in the cold so people have to ask her why the numbers do not agree." },
                ],
            },
        ],
    },

    // ── Frostfang: Captain Yura, "The Exemption" (HUNT) ───────────────────────
    {
        id: "story-reckoning-yura-exemption",
        slug: "yura-exemption",
        village: "Frostfang Village",
        npcName: "Captain Yura",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "ffr-yura-token-returned",
        title: "The Exemption",
        task: {
            kind: "hunt",
            metric: "totalAiKills",
            target: 1,
            dropItemId: "event-struck-warmth-token",
            targetName: "Meter-Warden Kree",
            boss: { bossId: "ffr-meter-warden-kree", name: "Meter-Warden Kree", icon: "MK", portrait: "/portraits/meter-warden-kree.webp", loadoutId: "boss", statBonus: 4, levelOffset: 2 },
        },
        reward: { weight: 6, fateShards: 1, title: "Oath-Witness" },
        intro: [
            {
                title: "The Captain at the Ridge Gate",
                scene: "The Frostfang outskirts, Yura's breath white in the dark",
                speaker: "Captain Yura",
                dialogue: [
                    "Yura is waiting at the ridge gate with her mark hand ungloved in the cold, which is a thing she does now, on purpose.",
                    "I answered a roll call for forty years and never once asked what the meter did to the people who came up short. That is not the same as not knowing.",
                    "There is a Meter-Warden working the exemptions off the books. Kree. He sells warmth to whoever can pay and strikes whoever cannot from the roll, and cuts the mark from their wrist so the Vault stops warming them.",
                ],
            },
            {
                title: "Warmth Had No Meter",
                scene: "The ridge road, ice fences groaning",
                speaker: "Captain Yura",
                dialogue: [
                    "There is a man on his list right now, struck for arrears, his warmth-token confiscated. He will not last three nights without it and Kree knows the arithmetic exactly.",
                    "Warmth was never supposed to have a meter. We put one on it and called it fair because the numbers balanced. The numbers always balance. That is what numbers are for.",
                    "I broke my oath to the Count when I understood it. I will not pretend I can arrest Kree under a law I stopped believing. But you never swore to it.",
                ],
            },
            {
                title: "Bring the Token Back",
                scene: "The ridge gate, snow starting",
                speaker: "Captain Yura",
                dialogue: [
                    "Find Kree. Take back the struck token before the cold does its accounting. Bring it here and I will put it back in the hand it was cut from myself.",
                    "Then I will stand at the gate with my mark bare and answer for every name I called and never followed. It is a long list. Somebody should have to read it.",
                    "Go. The cold is already counting.",
                ],
                choices: [
                    { text: "Take the contract. Hunt down Meter-Warden Kree.", accept: true },
                    { text: "Not yet. This one I want to do clean.", trait: "ffr-yura-weighed-it", conclusion: "Clean, she says, is a lot to ask of a night this cold. But she will hold the gate until you are ready." },
                ],
            },
        ],
        payoff: [
            {
                title: "Back in the Hand",
                scene: "The ridge gate, the struck warmth-token cold in your palm",
                speaker: "Captain Yura",
                dialogue: [
                    "Yura takes the token, warms it in her bare marked hand until it stops being an object and starts being someone's again.",
                    "Kree kept a strongbox of struck tokens, every one a person told they could not afford to be warm. I have carried the box back to the gate and started answering the names off it myself, warmth first, arrears never.",
                    "The token is yours. I spent forty years making the meter balance and never once asked who it balanced on. Let this be the one figure I put back on the right side, in your hand and not the cold's.",
                ],
                choices: [
                    { text: "\"You stayed in the Count long enough to see it clearly. Then you left.\"", requireTrait: "ff58-stayed-in-the-count", trait: "ffr-yura-oath-remade", conclusion: "Staying long enough to see it clearly is the part I am least proud of, she says. It handed me the exact list to answer for. Today the answering starts, and you are the one who set the date." },
                    { text: "\"You took the exemption once. Now hand the next one away.\"", requireTrait: "ff58-took-the-exemption", trait: "ffr-yura-exemption-repaid", conclusion: "She does not deny buying her own warmth once. She gives the recovered token to the first struck name on Kree's list before she has finished breathing, and calls it a down payment." },
                    { text: "\"Answer the roll you owe, out loud, at this gate.\"", trait: "ffr-yura-answered-her-roll", conclusion: "She reads the names she called and never followed, all of them, into the storm, until her voice gives out and the villagers who came to watch start reading the rest for her." },
                ],
            },
        ],
    },

    // ── Moonshadow: Nyx, "The Unsworn Ledger" (COLLECT) ───────────────────────
    {
        id: "story-reckoning-nyx-ledger",
        slug: "nyx-ledger",
        village: "Moonshadow Village",
        npcName: "Nyx",
        levelReq: 30,
        ownProgress: 3,
        completionTrait: "msr-nyx-ledger-open",
        title: "The Unsworn Ledger",
        task: { kind: "collect", metric: "totalTilesExplored", target: 12, dropItemId: "event-unsworn-page", targetName: "the torn ledger pages" },
        reward: { weight: 4, title: "Buyer-Namer" },
        intro: [
            {
                title: "The Broker at the Canal Gate",
                scene: "The Moonshadow outskirts, lantern light on black water",
                speaker: "Nyx",
                dialogue: [
                    "Nyx is leaning on the last canal post, watching the water instead of you, which for her is a kind of trust.",
                    "Every ledger in this village names who owes. Mine names who buys. It is the only book in Moonshadow worth reading twice and the only one nobody wants found.",
                    "A booth got raided last night. My pages went into the canal and the wind. Buyers' names, floating around the outskirts, waiting for the wrong person to gather them.",
                ],
            },
            {
                title: "Who Bought, Not Who Owed",
                scene: "The canal path along the outskirts",
                speaker: "Nyx",
                dialogue: [
                    "Most people in this trade sell secrets. I keep one. The one where the buyers have names too, and prices, and a very bad month coming.",
                    "The pages are out along the water and the alleys, wax-sealed, so they float. Walk the outskirts. Bring them to me before someone who is on them does.",
                    "Do that and I will keep the book open where a shelf-keeper cannot reach it. A buyers' ledger only works if it can be read.",
                ],
                choices: [
                    { text: "Walk the outskirts and gather every page.", accept: true },
                    { text: "Later. I would rather not do this half awake.", trait: "msr-nyx-weighed-it", conclusion: "Half awake, she says, is how most people lose the important pages. She will keep watch on the water until you are ready." },
                ],
            },
        ],
        payoff: [
            {
                title: "The Book Stays Open",
                scene: "The canal gate, the recovered pages drying in your hands",
                speaker: "Nyx",
                dialogue: [
                    "Nyx fans the pages out under the lantern, checks that every buyer's name is still legible, and lets out a breath she was not admitting to holding.",
                    "One page is yours. It has your name on it too, near the bottom, in the column marked did not buy. That column is short. Keep the proof you are in it.",
                    "A secret is only property if someone can sell it. Read it out loud and it stops being worth anything to the shelf. So carry it loud.",
                ],
                choices: [
                    { text: "\"You called me your partner once. I am still standing at the water, aren't I.\"", requireTrait: "nyx-partner", trait: "msr-nyx-partner-kept", conclusion: "Partners, she says, is a word I use for maybe three people and one of them is dead. She writes your name at the top of the open book, in the readers' column, not the buyers'." },
                    { text: "\"You were suspicious of me. Good instincts. Keep them, just aim them right.\"", requireTrait: "nyx-suspicion", trait: "msr-nyx-suspicion-earned", conclusion: "She does not apologize for the suspicion. She says she has simply moved you to a different column, and shows you the move, which for Nyx is an embrace." },
                    { text: "\"Make the buyers' ledger a public shelf. Let the village read who bought them.\"", trait: "msr-nyx-public-shelf", conclusion: "She mounts the book at the canal gate, chained open, above a single line: this shelf sells nothing. By morning three buyers have left the village and one has confessed." },
                ],
            },
        ],
    },

    // ── Moonshadow: Shade Master Iro, "The Sealed Shelf" (HUNT) ───────────────
    {
        id: "story-reckoning-iro-sealed-shelf",
        slug: "iro-sealed-shelf",
        village: "Moonshadow Village",
        npcName: "Shade Master Iro",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "msr-iro-shelf-unsealed",
        title: "The Sealed Shelf",
        task: {
            kind: "hunt",
            metric: "totalAiKills",
            target: 1,
            dropItemId: "event-sealed-file",
            targetName: "the Auction-Enforcer",
            boss: { bossId: "msr-auction-enforcer", name: "The Auction-Enforcer", icon: "AE", portrait: "/portraits/masked-auction-enforcer.webp", loadoutId: "boss", statBonus: 4, levelOffset: 2 },
        },
        reward: { weight: 6, fateShards: 1, title: "Shelf-Breaker" },
        intro: [
            {
                title: "The Archive Master at the Gate",
                scene: "The Moonshadow outskirts, mist between the close rooftops",
                speaker: "Shade Master Iro",
                dialogue: [
                    "Iro stands at the founding stone with his hands folded into his sleeves, still as the archive he keeps, which is very still.",
                    "I am the master of an archive whose most valuable shelf holds people. Sealed files. Names sold into silence, kept in perfect order, retrievable for a price.",
                    "I have told myself I keep them safe. A thing is not safe on a shelf that has a price list.",
                ],
            },
            {
                title: "Filed Under Load-Bearing",
                scene: "The founding stone, lanterns swaying",
                speaker: "Shade Master Iro",
                dialogue: [
                    "There is an enforcer working the outskirts, moving sealed files off my shelf and onto an auction block. Masked. He does not haggle. He appraises.",
                    "One of the files on his block tonight is a child. Sold at nine years old, filed under load-bearing, held ever since because the file was worth more sealed than the child was worth free.",
                    "I sealed that shelf. I know exactly which drawer. I cannot open my own archive against my own seal without ending myself as its master. You are bound by no seal I ever set.",
                ],
            },
            {
                title: "Close It for Good",
                scene: "The founding stone at moonrise",
                speaker: "Shade Master Iro",
                dialogue: [
                    "Find the enforcer. Take the child's file back before it is sold on again. Bring it to me and I will read it, then unseal it, then let the person it names walk out of my archive on their own feet.",
                    "That ends me as master. Good. The archive was never supposed to have a master who could be paid.",
                    "Go. The block opens at the turn of the moon.",
                ],
                choices: [
                    { text: "Take the retrieval. Hunt down the Auction-Enforcer.", accept: true },
                    { text: "Not yet. I want to know what else is on that shelf.", trait: "msr-iro-weighed-it", conclusion: "Everything, he says. That is the horror of it. The shelf is complete. He will wait at the stone." },
                ],
            },
        ],
        payoff: [
            {
                title: "Unsealed",
                scene: "The founding stone, the sealed file heavy in your hands",
                speaker: "Shade Master Iro",
                dialogue: [
                    "Iro breaks his own seal with a thumbnail, reads the file once, and closes his eyes at a line partway down.",
                    "The enforcer had a cart bound for the block. Children, mostly, filed under load-bearing, worth more silent than free. The cart sits in my archive now with every seal on it cut, and not one of them will close again.",
                    "The file is yours, unsealed. An archive master learns to close every drawer he opens. This is the drawer I am going to leave open for good, and I would rather it stood open in your hands than sat shut in mine.",
                ],
                choices: [
                    { text: "\"You refused the shelf when it was offered to you. Hold to that.\"", requireTrait: "ms58-refused-the-shelf", trait: "msr-iro-shelf-refused", conclusion: "He does not pretend refusing the shelf made him clean. It made him a keeper who knew. You made him one who finally opened a drawer instead of guarding it." },
                    { text: "\"You took the shelf once. Now unshelf every name on it.\"", requireTrait: "ms58-took-the-shelf", trait: "msr-iro-shelf-emptied", conclusion: "He does not defend the taking. He begins unsealing the drawer beside this one, and the one beside that, reading names into the mist until the archive stops being a vault and starts being a door." },
                    { text: "\"Let the child name themselves now. However they want.\"", trait: "msr-iro-child-named", conclusion: "He hands the unsealed file to the person it stole a childhood from and asks them, for the first time anyone has, what they would like to be called. He writes down whatever they say." },
                ],
            },
        ],
    },

    // ── Cross-village: Kite Harrow, "The Unbought Contract" (HUNT) ────────────
    // crossVillage: stands at ANY village's outskirts once the player has finished
    // their own arc (storyProgress >= 9); her payoff reacts to how they treated her
    // on the road (rd48-*). `village` below is only a placeholder for ordering.
    {
        id: "story-reckoning-harrow-unbought",
        slug: "harrow-unbought",
        village: "Stormveil Village",
        crossVillage: true,
        npcName: "Kite Harrow",
        levelReq: 65,
        ownProgress: 9,
        completionTrait: "hr-harrow-contract-closed",
        title: "The Unbought Contract",
        task: {
            kind: "hunt",
            metric: "totalAiKills",
            target: 1,
            dropItemId: "event-forged-die",
            targetName: "Counterfeit Broker Vael",
            boss: { bossId: "hr-counterfeit-broker", name: "Counterfeit Broker Vael", icon: "CV", portrait: "/portraits/counterfeit-broker.webp", loadoutId: "boss", statBonus: 5, levelOffset: 3 },
        },
        reward: { weight: 7, fateShards: 2, title: "The Unbought" },
        intro: [
            {
                title: "The Unsworn on the Tailboard",
                scene: "The village outskirts, Harrow on a wagon's tailboard reading a contract she has already read",
                speaker: "Kite Harrow",
                dialogue: [
                    "Kite Harrow is sitting on a tailboard at the edge of your village as if she has been waiting a while and does not mind, which means she has been waiting a while and minds.",
                    "You liberated a village. Congratulations. You also made the escrow mark worth counterfeiting, which is the truest compliment this trade has.",
                    "Somebody is cutting fake quartered-circle dies and stamping them on skimmed tribute in all four villages. Draining the drain. It is almost admirable. It is entirely my problem.",
                ],
            },
            {
                title: "A Job on No Roll",
                scene: "The tailboard, out of the guards' hearing",
                speaker: "Kite Harrow",
                dialogue: [
                    "I am unsworn. No village owns my silence, which means no village will move against a forger who pays a cut to every seat that would have to sign the warrant. That is not cynicism. It is the arithmetic. I checked.",
                    "So this is a contract on no roll. Not Central's, not any Kage's, not even mine, officially. Vael, the forger, works the counting-house on the outskirts. Take the forging die off them.",
                    "Bring me the die and I nail the whole scheme to a waystation board where four villages have to read it at once. I keep the receipt. I always keep the receipt.",
                ],
                choices: [
                    { text: "Take the contract that isn't on anyone's roll.", accept: true },
                    { text: "Not yet. Tell me who you're really protecting first.", trait: "hr-harrow-weighed-it", conclusion: "Myself, she says, without a flicker. And the people the drain would eat if the drain got competition. She lets you decide which order to believe those in, and waits." },
                ],
            },
        ],
        payoff: [
            {
                title: "Nailed to the Board",
                scene: "A waystation board at the edge of the village, the forged die in your hand",
                speaker: "Kite Harrow",
                dialogue: [
                    "Harrow takes the die, turns it once, and does the thing she does instead of smiling, which is get very still.",
                    "Vael was skimming the skim. Four villages' worth of stolen tribute, restolen. I have the manifest, the buyers, the seats they paid. It goes on the board tonight, all of it, unpriced.",
                    "The die is yours. Keep it as proof that even the thieves have thieves, and that once, one of them got read out loud instead of paid off.",
                ],
                choices: [
                    { text: "\"We split a penalty once and you nailed the manifest up for anyone to read. This is that, bigger.\"", requireTrait: "rd48-split-the-penalty", trait: "hr-harrow-partner", conclusion: "She remembers the crate. Most people who split a penalty with her spend the rest of their lives pretending they did not. She writes your name in the readers' column of a book she does not usually show anyone." },
                    { text: "\"You owed me a favor on the books, no expiry. Call this it paid.\"", requireTrait: "rd48-favor-on-the-books", trait: "hr-harrow-favor-called", conclusion: "She opens the ledger to the line she wrote, favor owed, your name spelled right, and draws one clean stroke through it. Paid, she says, and looks almost sorry to close the account." },
                    { text: "\"Last time I turned you in for the fee. I'd rather have done this instead.\"", requireTrait: "rd48-collected-the-fee", trait: "hr-harrow-fee-mended", conclusion: "She does not pretend she forgot the two hundred. She wrote something short in her ledger that day, and shows you it now: worth watching. She adds a second line under it. Watched." },
                    { text: "\"Read the whole scheme out at every village at once. No favors, no seats spared.\"", trait: "hr-harrow-read-it-all", conclusion: "She sends the manifest to all four waystation boards on the same night, every seat named, every buyer priced, and keeps not one copy back to sell, which for Kite Harrow is the closest thing she has to a vow." },
                ],
            },
        ],
    },
];

export function storyReckoningById(id: string): StoryReckoning | null {
    return storyReckonings.find((quest) => quest.id === id) ?? null;
}
