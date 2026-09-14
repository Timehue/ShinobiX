export type StoryReckoningTaskKind = "hunt" | "collect";
export type StoryReckoningMetric = "totalAiKills" | "totalTilesExplored";

export type StoryReckoningChoice = {
    id?: string;
    text: string;
    conclusion?: string;
    trait?: string;
    requireTrait?: string;
    forbidTrait?: string;
    accept?: boolean;
};

export type StoryReckoningPage = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
    choices?: StoryReckoningChoice[];
    requireTrait?: string;
    forbidTrait?: string;
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
                    "No proverb today. I brought the book instead.",
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
                    "Set the seal face-up. There. My thumb still knows where to press, which is not a memory I deserve to lose.",
                    "This stamp authorized the next collection list. I know because I wrote the form it belongs to. I will name that form beside the seal.",
                    "The seal goes into the public evidence box with my book. Two clerks who do not answer to me will hold the keys. If either key comes back to my desk, move the box.",
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
                    "Black book closed. Today I am here as myself.",
                    "My mother's ridge marker was broken up for pressed flowers. Kesa Volt, reduced to resale value one more time.",
                    "Pickers carried the pieces beyond this gate. Meet me at the ridge gate with the weather still readable; we'll choose the high line or the picker road from there.",
                ],
                choices: [
                    { text: "Take the writ. Meet Mira at the ridge gate.", accept: true },
                    { text: "Later. I want to do this carefully.", trait: "svr-mira-weighed-it", conclusion: "Mira opens the book just enough to mark your answer. Carefully is allowed, she says." },
                ],
            },
        ],
        payoff: [
            {
                title: "The Coil That Crossed",
                scene: "The ridge gate, the recovered packet resting beside Mira's emptied cable bag",
                speaker: "Mira Volt",
                requireTrait: "sf-sv-high-line",
                dialogue: [
                    "The high line got us there before the rain. The west mast is still waiting for the coil I used. Both go in the report.",
                    "You crossed while I held the brake. I have checked that knot six times since, and it has not improved by being worried at.",
                    "Set the packet down. We do the stone slowly.",
                ],
            },
            {
                title: "The Question Asked in Public",
                scene: "The ridge gate, picker-road mud drying on the recovered packet",
                speaker: "Mira Volt",
                requireTrait: "sf-sv-picker-road",
                dialogue: [
                    "We lost the light fixing that rail. We also left a sound post behind us, and the pickers handed over the packet because somebody finally asked instead of pricing it.",
                    "I said Kesa Volt out loud to a shelter full of strangers. You stood there and let the silence be mine.",
                    "Set the packet down. I can do the rest with people watching.",
                ],
            },
            {
                title: "The Marker, Set Again",
                scene: "The ridge gate, the marker pieces fitted back together",
                speaker: "Mira Volt",
                dialogue: [
                    "The broad piece goes at the bottom. Slowly. She hated a crooked line and would make us start over for less than this.",
                    "Kesa Volt. Cable rigger. Storm answer. My mother before any board learned how to spend her.",
                    "This pressed flower was wrapped with the marker pieces. Of course. She always pressed one too many. Tuck it behind the marker where the first rain can reach something she chose for herself.",
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
                    "Two piles. Names I can still read, and names the fire made me guess. I am taking my time with both.",
                    "The drain took a whole column of names last month. Scrubbed clean, filed under weather. My family was in that column. Reed.",
                    "They broke the cedar plates up and scattered them out here where the wind does the rest. I keep meaning to gather them. I keep finding reasons not to.",
                ],
            },
            {
                title: "A Name Is Not a Number",
                scene: "The ash road climbing off the outskirts",
                speaker: "Toma Reed",
                dialogue: [
                    "The register clerks call these numbers when it suits them. They were names first. Keep that straight when you find the plates.",
                    "The ash carts carried the plates beyond this post. Meet me at the ash line after the morning loads clear; from there we choose whether to mend the footbridge or follow the fresh ruts.",
                    "Bring them back and I will read every name aloud, once, where the register clerks can hear me do it.",
                ],
                choices: [
                    { text: "Take the oilcloth. Meet Toma at the ash line.", accept: true },
                    { text: "Later. I want to do this with a clear head.", trait: "alr-toma-weighed-it", conclusion: "A clear head, he says, is more than most of them bring to it. He will wait." },
                ],
            },
        ],
        payoff: [
            {
                title: "The Crossing First",
                scene: "The outskirts register post, channel water drying on the recovered cedar",
                speaker: "Toma Reed",
                requireTrait: "sf-al-repaired-first",
                dialogue: [
                    "We fixed the footbridge and watched the cart trail wash away. I spent the whole repair thinking I had traded my family for strangers' feet.",
                    "Then the channel reeds caught every plate together. We repaired one bridge and found the names. I am letting that be enough for a morning.",
                    "Put Reed first. My hands are steady now.",
                ],
            },
            {
                title: "The Crossing After",
                scene: "The outskirts register post, four bridge clamps still hanging from Toma's belt",
                speaker: "Toma Reed",
                requireTrait: "sf-al-followed-cart",
                dialogue: [
                    "We caught the cedar before the rain and carried it back to the bridge we chose to leave broken. I was angry until the last clamp took. I may still be angry after breakfast.",
                    "Thank you for going back. Not for promising we would. For putting the plates above the flood line and doing the other job in the dark.",
                    "Put Reed first. Then hand me the next one.",
                ],
            },
            {
                title: "Read Aloud, Once",
                scene: "The outskirts register post, the cedar plates gathered in your hands",
                speaker: "Toma Reed",
                dialogue: [
                    "Put Reed first. My grandmother chamfered that plate wrong, saw the wobble, and set it anyway. She was a better joiner than the clerk who complained.",
                    "Hand me the next one when I finish. If my voice goes, you read until it comes back.",
                    "Tomorrow the register clerks will find every plate fixed to this post. They can read the names, or strike them again while the families are standing here. No more clean columns.",
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
                    "I brought the ledger I least wanted you to see. That is probably the one we need.",
                    "I keep a working copy. Every name the official register erases, I copy into a second book first. Forty years of that, and I still caught myself calling the second book honest.",
                    "It is only complete. I closed it every night and let the official book do its work in daylight.",
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
                    "Aren Reed. I can read the plate. I cannot make my hands steady while I do.",
                    "I am copying both faces of Aren's plate into the working copy now, including Sella's burn mark and the place you recovered it.",
                    "Then the original goes to Toma, if he wants it. His family decides where it rests. My signature stays beside the copy so nobody can call it an anonymous correction.",
                ],
                choices: [
                    { text: "\"I refused the cut you offered me. What will you do with that answer now?\"", requireTrait: "al58-refused-the-cut", trait: "alr-mori-clean-hands", conclusion: "Mori writes your refusal beside the offered cut and signs underneath. 'There. If I offer it again, put this page in my face.'" },
                    { text: "\"You took the knowledge and did nothing with it. Now do something.\"", requireTrait: "al58-took-the-knowledge", trait: "alr-mori-put-to-use", conclusion: "He opens the working copy to Aren's place. 'Then hold the lamp. My hands stop shaking once I start.' He lowers the pen to the page." },
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
                    "Leave the coat. I have spent enough nights at this gate to know when the cold is merely uncomfortable. Keep your hands free for the pages.",
                    "There is the Count, which is the official book, and there is the roll, which is who was actually alive. For forty winters I have kept both and shown only one.",
                    "The true roll came apart in the last storm. The pages of the struck names, the ones the Vault stopped counting. They are out there in the drifts.",
                ],
            },
            {
                title: "Who Is Owed, Who Is Missed",
                scene: "The ridge road above the outskirts",
                speaker: "Elder Sova",
                dialogue: [
                    "The Count keeps who is owed. The roll keeps who is missed. They stopped matching a long time ago, and I let them.",
                    "Meet me at the gate stones before the next snow. The wall watch needs lamp oil for the search and the lower road needs the same jar under its broth pot. We choose there, in front of both crews.",
                    "Bring them back and I will bind the roll again, and this time I will read it beside the Count, out loud, so the difference has to be looked at.",
                ],
                choices: [
                    { text: "Take the page case. Meet Sova at the gate stones.", accept: true },
                    { text: "Later. The cold makes me want to do this right.", trait: "ffr-sova-weighed-it", conclusion: "Sova folds her arms inside her coat. Come back with feeling in your fingers, she says. She will keep the gate." },
                ],
            },
        ],
        payoff: [
            {
                title: "Recovered at Half Wick",
                scene: "The gate stone, the true roll held between signatures from the wall and lower kitchen",
                speaker: "Elder Sova",
                requireTrait: "sf-ff-split-lanterns",
                dialogue: [
                    "Three lamps at half wick, one stove at half flame, and complaints from everyone involved. Write that before the names so nobody mistakes the recovery for easy agreement.",
                    "The watch found pages the cooks would have missed. The cooks found pages the watch walked past. Both signed, after arguing over who held the lamp badly.",
                    "Give me the first sheet. We bind what they recovered together.",
                ],
            },
            {
                title: "Recovered After Waiting",
                scene: "The gate stone, the true roll beside a flour-marked drift map",
                speaker: "Elder Sova",
                requireTrait: "sf-ff-kept-stove",
                dialogue: [
                    "The stove stayed lit. We waited for daylight. I expected the storm to make a fool of that choice.",
                    "Instead the cooks mapped the wind, the families brought boots, and the wall watch followed marks it would never have made alone. Keep the flour map with the recovery account.",
                    "Give me the first sheet. We have enough hands to turn it carefully.",
                ],
            },
            {
                title: "Bound Again",
                scene: "The gate stone, the roll pages gathered and iced stiff in your hands",
                speaker: "Elder Sova",
                dialogue: [
                    "Give me each page one at a time. I will thaw it against my coat before I read it; haste is how I helped the Count swallow names.",
                    "This page is from the winter the Vault first ran the lower draw. I knew then. I said nothing, and I have written that beside the date in my own hand.",
                    "All of it goes back into the binding, including my note. When people ask who hid the difference between these books, they will not have to guess.",
                ],
                choices: [
                    { text: "\"I held my doubt instead of filing it. I will read it aloud with you now.\"", requireTrait: "ff42-held-the-doubt", trait: "ffr-sova-doubt-kept", conclusion: "Sova looks at you over the first page. 'Then do not make me carry the first name alone.' She waits for you to begin." },
                    { text: "\"I reported my doubt by the book. Put my report beside what the book left out.\"", requireTrait: "ff42-reported-the-doubt", trait: "ffr-sova-doubt-undone", conclusion: "She lays the report you filed beside the true roll and reads both at the gate. Your report stays visible; so does every life its official wording failed to name." },
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
                    "I left my mark hand bare so I would not forget what this cold costs. It is a lesson I used to assign to other people.",
                    "I answered a roll call for twelve years and never once asked what the meter did to the people who came up short. That is not the same as not knowing.",
                    "There is a Meter-Warden working the exemptions off the books. Kree. He sells warmth to whoever can pay and strikes whoever cannot from the roll, and cuts the mark from their wrist so the Vault stops warming them.",
                ],
            },
            {
                title: "Warmth Had No Meter",
                scene: "The ridge road, ice fences groaning",
                speaker: "Captain Yura",
                dialogue: [
                    "There is a man on his list right now, struck for arrears, his warmth-token confiscated. He will not last three nights without it. Kree wrote the deadline himself and posted watchers at the road.",
                    "Warmth was never supposed to have a meter. I checked those totals for twelve years and never walked home with the people whose rooms went cold.",
                    "I broke my oath to the Count when I understood it. I will not pretend I can arrest Kree under a law I stopped believing. But you never swore to it.",
                ],
            },
            {
                title: "Bring the Token Back",
                scene: "The ridge gate, snow starting",
                speaker: "Captain Yura",
                dialogue: [
                    "Find Kree. Take back the struck token before the third night. Bring it here and I will put it back in the hand it was cut from myself.",
                    "Then I will stand at the gate with my mark bare and answer for every name I called and never followed. It is a long list. Somebody should have to read it.",
                    "Go. He has already lost one night.",
                ],
                choices: [
                    { text: "Take the contract. Hunt down Meter-Warden Kree.", accept: true },
                    { text: "Not yet. This one I want to do clean.", trait: "ffr-yura-weighed-it", conclusion: "Do it clean, Yura says. Just remember he has already lost one night. She turns back to the road and keeps her bare hand visible." },
                ],
            },
        ],
        payoff: [
            {
                title: "Back in the Hand",
                scene: "The ridge gate, the struck warmth-token cold in your palm",
                speaker: "Captain Yura",
                dialogue: [
                    "Give me the token. I will warm it before I put it back in the hand it was cut from.",
                    "Kree's cut and stamp are still on it. I will return it to the person named on his order tonight and sign that return with my bare mark.",
                    "At dawn I will demand the rest of Kree's inventory in public. What you get is my name on that demand and the right to call me back to this gate if I stop answering it.",
                ],
                choices: [
                    { text: "\"I stayed in the Count long enough to see it clearly. I left with a list we can answer.\"", requireTrait: "ff58-stayed-in-the-count", trait: "ffr-yura-oath-remade", conclusion: "Yura asks you to read the first name from the list you carried out. She answers it at the gate, warmth first, then marks the date beside it in her own hand." },
                    { text: "\"I took the exemption once. Put this token in the next cold hand before mine.\"", requireTrait: "ff58-took-the-exemption", trait: "ffr-yura-exemption-repaid", conclusion: "Yura gives the recovered token to the first struck name on Kree's list. She records your earlier exemption and this repayment beside each other, leaving neither out." },
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
                    "Watch the water. I will watch you. That is as close to trust as this job gets before breakfast.",
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
                    "The pages left the canal in several hands. Meet me at the canal gate before courier bell. One witness offers a private route; the other route asks the whole canal to answer in public.",
                    "Do that and I will keep the book open where a shelf-keeper cannot reach it. A buyers' ledger only works if it can be read.",
                ],
                choices: [
                    { text: "Take the empty binding. Meet Nyx at the canal gate.", accept: true },
                    { text: "Later. I would rather not do this half awake.", trait: "msr-nyx-weighed-it", conclusion: "Half awake, she says, is how most people lose the important pages. She will keep watch on the water until you are ready." },
                ],
            },
        ],
        payoff: [
            {
                title: "A Voice Under Seal",
                scene: "The canal gate, recovered ledger pages beside a source statement with no public name",
                speaker: "Nyx",
                requireTrait: "sf-ms-source-shielded",
                dialogue: [
                    "Every buyer's name is back in the binding. The raid account stays separate, under the private mark the clerk chose and I witnessed.",
                    "A public name would make the statement easier to sell. We agreed that was not the measure. The source can still answer tomorrow because nobody gets to spend them tonight.",
                    "Hold the ledger open. I will read the buyers; the clerk's words remain theirs.",
                ],
            },
            {
                title: "Many Hands on the Route",
                scene: "The canal gate, separate return receipts drying around the recovered ledger",
                speaker: "Nyx",
                requireTrait: "sf-ms-open-witnesses",
                dialogue: [
                    "The clerk withdrew before the notice went up. We knew that price and posted it where they could see us choose it.",
                    "What came back instead is a chain made by people who did not agree on much except where each page rested. Keep every receipt separate. Agreement is not required for evidence.",
                    "Hold the ledger open. I will read the buyers; the witnesses can correct my route as I go.",
                ],
            },
            {
                title: "The Book Stays Open",
                scene: "The canal gate, the recovered pages drying in your hands",
                speaker: "Nyx",
                dialogue: [
                    "Lantern closer. Every buyer's name is still legible. Good. I can resume breathing anonymously.",
                    "Your name is near the bottom, in the column marked did not buy. That column is short. I am leaving the entry in the book, where nobody can turn your innocence into a private favor.",
                    "Take that end of the chain. Once this ledger is bolted above the canal gate, a buyer will have to confess in public or pretend they cannot read. Either answer costs them.",
                ],
                choices: [
                    { text: "\"You called me your partner once. I am still standing at the water, aren't I.\"", requireTrait: "nyx-partner", trait: "msr-nyx-partner-kept", conclusion: "Partners, she says, is a word I use for maybe three people and one of them is dead. She writes your name at the top of the open book, in the readers' column, not the buyers'." },
                    { text: "\"You were suspicious of me. Good instincts. Keep them, just aim them right.\"", requireTrait: "nyx-suspicion", trait: "msr-nyx-suspicion-earned", conclusion: "She does not apologize. She moves your name from watched to reader, turns the book so you can verify the entry, and leaves it open between you." },
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
                    "I keep my hands in my sleeves when I am tempted to lock something away. Today they may have to come out.",
                    "I am the master of an archive whose most valuable shelf holds people. Sealed files. Names sold into silence, kept in perfect order, retrievable for a price.",
                    "Safe. I used that word whenever I shut the drawer. The shelf has a price list.",
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
                    "When I break that seal, my own rules remove me as archive master. I should have broken it years ago.",
                    "Go. The block opens at the turn of the moon.",
                ],
                choices: [
                    { text: "Take the retrieval. Hunt down the Auction-Enforcer.", accept: true },
                    { text: "Not yet. I want to know what else is on that shelf.", trait: "msr-iro-weighed-it", conclusion: "Iro gives you the drawer count. It takes longer than either of you expected. 'That is what else is on the shelf,' he says, and waits at the stone." },
                ],
            },
        ],
        payoff: [
            {
                title: "Unsealed",
                scene: "The founding stone, the sealed file heavy in your hands",
                speaker: "Shade Master Iro",
                dialogue: [
                    "My seal. My thumbnail. Listen while I break it. I will read the line I used to stop at.",
                    "This file bears the enforcer's auction mark beside my archive seal. I will record where you recovered it and who put it on the block.",
                    "This file was never mine to give you. The person named inside decides whether it is kept, burned, or read aloud. You brought it back, so stay and witness me ask them.",
                ],
                choices: [
                    { text: "\"I refused the shelf you offered me. Open it for everyone you kept on it.\"", requireTrait: "ms58-refused-the-shelf", trait: "msr-iro-shelf-refused", conclusion: "Iro records your refusal on the shelf inventory. 'Then stand here while I break the next seal.' He opens the next drawer himself." },
                    { text: "\"I took the shelf once. I will help unshelf every name on it.\"", requireTrait: "ms58-took-the-shelf", trait: "msr-iro-shelf-emptied", conclusion: "Iro records what you took and accepts your help returning it. Together you open the next drawer and read its name into the mist, then reach for the one beside it." },
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
                    "I have read this contract enough times to resent every word and the tailboard beneath me. Sit, if you want the arithmetic.",
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
                    { text: "Not yet. Tell me who you're really protecting first.", trait: "hr-harrow-weighed-it", conclusion: "Harrow taps the fee in her contract. 'Myself. And the next person this system marks for tribute. Both.'" },
                ],
            },
        ],
        payoff: [
            {
                title: "Nailed to the Board",
                scene: "A waystation board at the edge of the village, the forged die in your hand",
                speaker: "Kite Harrow",
                dialogue: [
                    "Give me the die. Quartered circle, shallow bite on the left. Vael copied the mark and missed the hand behind it.",
                    "Vael was skimming the skim. Four villages' worth of stolen tribute, restolen. I have the manifest, the buyers, the seats they paid. It goes on the board tonight, all of it, unpriced.",
                    "I am riveting the die beside the manifest. My receipt is the countersigned copy, which is less dramatic and considerably harder to pry off a wall. Hold the lamp.",
                ],
                choices: [
                    { text: "\"We split a penalty once and you nailed the manifest up for anyone to read. This is that, bigger.\"", requireTrait: "rd48-split-the-penalty", trait: "hr-harrow-partner", conclusion: "She remembers the crate. Most people who split a penalty with her spend the rest of their lives pretending they did not. She writes your name in the readers' column of a book she does not usually show anyone." },
                    { text: "\"You owed me a favor on the books, no expiry. Call this it paid.\"", requireTrait: "rd48-favor-on-the-books", trait: "hr-harrow-favor-called", conclusion: "She opens the ledger to the line she wrote, favor owed, your name spelled right, and draws one clean stroke through it. Paid, she says, and looks almost sorry to close the account." },
                    { text: "\"Last time I turned you in for the fee. I'd rather have done this instead.\"", requireTrait: "rd48-collected-the-fee", trait: "hr-harrow-fee-mended", conclusion: "She does not pretend she forgot the two hundred. She wrote something short in her ledger that day, and shows you it now: worth watching. She adds a second line under it. Watched." },
                    { text: "\"Read the whole scheme out at every village at once. No favors, no seats spared.\"", trait: "hr-harrow-read-it-all", conclusion: "She sends the manifest to all four waystation boards on the same night, every seat named and every buyer priced. When the courier asks which copy is hers, Harrow says, 'None. Keep moving.'" },
                ],
            },
        ],
    },
];

export function storyReckoningById(id: string): StoryReckoning | null {
    return storyReckonings.find((quest) => quest.id === id) ?? null;
}
