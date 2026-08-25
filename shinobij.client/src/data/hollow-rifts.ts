/*
 * hollow-rifts: wandering-AI quests that route a player into a SCALED-DOWN event
 * Hollow Gate. A roaming NPC brings a concrete field report from a sector; the
 * player travels there, finds a rift/cave/shrine, and
 * descends into a short (1-3 floor) event gate with a themed final boss scaled to
 * their level. Beating the boss completes the quest.
 *
 * ZERO imports on purpose (mirrors data/story-road-events.ts): the api parity
 * test imports this file directly under node/tsx, and the server reward catalog
 * (api/sector/_rift-quest.ts) must stay in sync with the ids/gates/rewards here.
 *
 * This file is CONTENT + shape only; the reward/gate seal + payout are server-
 * authoritative (api/sector/rift-quest.ts). Nothing about the Hollow Gate engine
 * changes: the rift builds a HollowGateEventConfig and enters via the existing
 * event-gate path (App.enterHollowGateShrine).
 *
 * Prose rules follow the story: whole sentences, plain first read, NO em/en
 * dashes; dialogue strings carry no "Speaker:" prefix (speaker is its own field).
 */

export type RiftGiverArchetype = "tracker" | "pilgrim" | "courier" | "soldier" | "sage" | "broker" | "official";

export type RiftChoice = {
    text: string;
    conclusion?: string;
    /** Marks the intro option that ACCEPTS the rift (WorldMap seals + points to the sector). */
    accept?: boolean;
    /** Marks the descent option that DESCENDS into the scaled gate. */
    descend?: boolean;
    /** Marks the option that ABANDONS the rift (clears it so the giver can re-offer). */
    abandon?: boolean;
};

export type RiftPage = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
    choices?: RiftChoice[];
};

export type HollowRift = {
    id: string;              // "rift-<slug>"
    slug: string;
    giverName: string;
    giverArchetype: RiftGiverArchetype;
    /** Delivery FLOOR: the roaming giver offers this rift once the player reaches
     *  levelReq. There is NO upper cap — a player who out-levels a rift can still be
     *  offered it, so a missed rift stays doable. nextRift rotates among every rift
     *  the player has reached, one per UTC day. */
    levelReq: number;
    /** Scaled run shape (short = the scale-down). Boss on the last floor. */
    floors: number;          // 1..3
    boardWidth?: number;
    boardHeight?: number;
    theme: string;           // flavor only (e.g. "shadow-echo")
    /** Landmark sprite slug (public /landmarks/<landmark>.webp) for the map structure. */
    landmark: string;
    bossAiId: string;        // a builtin/creator AI id (in lib/combat-ai builtinAis)
    bossName: string;
    /** ryo = weight*(20 + level*3); fate shards + bone charms flat. */
    reward: { weight: number; fateShards?: number; boneCharms?: number };
    intro: RiftPage[];       // the giver's report (names the target sector)
    descent: RiftPage[];     // at the rift, before descending
};

/** Every rift quest. Ordered by levelReq (delivery walks it lowest-first). */
export const hollowRifts: HollowRift[] = [
    {
        // LEVEL-15 INTRODUCTORY rift. A deliberately gentle first taste whose whole
        // job is to TEACH what a Legacy is (a pattern of deeds, not a bloodline;
        // earned and recognized, never given; the erased ones of the Sunken Court,
        // now slowly remembered) and plant the far-off seed for the L50 offer.
        id: "rift-legacy-echo",
        slug: "legacy-echo",
        giverName: "Senna Graveward",
        giverArchetype: "pilgrim",
        levelReq: 12,
        floors: 1,
        theme: "legacy-echo",
        landmark: "forgotten-shrine",
        bossAiId: "rift-boss-legacy-echo",
        bossName: "The Unremembered",
        reward: { weight: 5, fateShards: 1, boneCharms: 8 },
        intro: [
            {
                title: "The Grave Keeper on the Low Road",
                scene: "Dusk on a low country road lined with small leaning gravestones. A hooded shrine keeper kneels among them, brushing moss from a nameless marker, a walking staff resting across her knees.",
                speaker: "Senna Graveward",
                dialogue: [
                    "Hold this brush while I set the stone straight. You stopped to help, so I am putting you to work.",
                    "Senna Graveward. I keep the markers whose families are gone. Most travelers step over them. You stepped around.",
                    "That tells me one useful thing about you. I need one useful thing before I trust someone with the grave I am about to show them.",
                ],
            },
            {
                title: "What a Legacy Truly Is",
                scene: "Senna sits back on her heels among the leaning stones, resting her staff across her knees as if the question deserves her full attention.",
                speaker: "Senna Graveward",
                dialogue: [
                    "You have heard people say Legacy as if it means an ancestor hiding in the blood. It does not.",
                    "Each Withheld was an ordinary person of the Sunken Court's age who refused to surrender a defining choice. Witnesses kept seeing the same hundred patterns in those refusals. Those patterns are the Legacies.",
                    "Near the Fiftieth Rank, a Sage may compare your witnessed deeds with those patterns. He can name what he sees. He cannot put it inside you, and you may send him away.",
                ],
            },
            {
                title: "The Cracked Shrine",
                scene: "Senna rises and points with a weathered hand toward a dark ridge on the horizon, where a faint violet shimmer bleeds up from a broken shrine among the far hills.",
                speaker: "Senna Graveward",
                dialogue: [
                    "The marker I mean stands in %sector. A rift split the shrine floor yesterday and rubbed half its oldest glyph smooth.",
                    "That glyph records one of the Withheld refusing cession. The person's name is gone, but the deed is still legible if you know the old cuts.",
                    "No soul waits in that stone. The Gate is copying the recorded refusal and building a fighter from it. Stop the copy, then take a charcoal rubbing of the original mark for me.",
                ],
                choices: [
                    { text: "I will recover the mark and stop the copy.", accept: true },
                    { text: "Not today. Keep the charcoal for me.", conclusion: "Senna wraps the charcoal and paper together. I will keep them dry, she says. You keep yourself alive. Come back when both parts of that plan still sound sensible." },
                ],
            },
        ],
        descent: [
            {
                title: "Down the Short Gate",
                scene: "A narrow stair of worn stone spirals down into a dim, humming hollow beneath the cracked shrine floor, a single leaning grave marker glowing faintly at the bottom.",
                speaker: "Narrator",
                dialogue: [
                    "The shrine floor has split around the marker without knocking it over. The cut looks deliberate.",
                    "Three glyph strokes remain under the moss: an open hand, a closed gate, and a witness mark.",
                    "A second set of strokes moves in the dark below, practicing the same refusal without understanding what was refused.",
                ],
            },
            {
                title: "The Unremembered",
                scene: "At the bottom of the short gate a figure waits in the grey light, its features blurred and shifting as though it can never quite decide whose face to wear. Where its heart should be, a single warm ember of someone else's refusal still burns.",
                speaker: "The Unremembered",
                dialogue: [
                    "The stone says someone refused. It does not say what they were called.",
                    "The Gate gave me their stance, their grip, and the moment they said no. It gave me nothing that came before or after.",
                    "Fight me. If the copy breaks, read the original mark aloud where a witness can hear you. That is more of a name than I have now.",
                ],
                choices: [
                    { text: "I will break the copy and preserve the deed under witness.", descend: true },
                    { text: "Not yet. I need a steadier hand.", conclusion: "You climb to the shrine floor and wrap the charcoal again. Below, the copied stance starts its form from the beginning." },
                    { text: "Leave the marker undisturbed.", abandon: true, conclusion: "You turn from the stair. On the low road, Senna unwraps a blank sheet, studies it, and puts it away without asking what happened." },
                ],
            },
        ],
    },
    {
        id: "rift-hollow-stalker",
        slug: "hollow-stalker",
        giverName: "Scout Vessa",
        giverArchetype: "tracker",
        levelReq: 30,
        floors: 2,
        theme: "shadow-echo",
        landmark: "hollow-rift",
        bossAiId: "rift-boss-hollow-stalker",
        bossName: "Hollow Stalker",
        reward: { weight: 8, fateShards: 1, boneCharms: 15 },
        intro: [
            {
                title: "A Scout Off Her Route",
                scene: "The road, a scout catching her breath against a boundary stone",
                speaker: "Scout Vessa",
                dialogue: [
                    "Give me one breath before you ask. I ran the last ridge instead of dying on it, and I would like to enjoy the difference.",
                    "A violet seam is hanging above the east slope. No torii, no shrine, just a split in open air with the Hollow Gate's pressure behind it.",
                    "A long thing climbed out while I marked the map. Too many joints. It went back before I counted the legs, which was polite of it.",
                ],
            },
            {
                title: "What Leaks Back",
                scene: "Vessa keeps her eyes on the seam while she speaks, plain and level, the way she would name a rockslide or a bad ford.",
                speaker: "Scout Vessa",
                dialogue: [
                    "Here is the short version. The Sunken Court built the Gate as civic machinery. The city died. The machinery kept running under Central and the four villages.",
                    "Its village anchors take reasons, futures, exits, and surrendered trust. The local systems keep a share. Hidden pipes carry the rest down.",
                    "That seam is a split pipe. What the Gate took has pooled on the surface and built itself legs. I saw where those legs went.",
                ],
            },
            {
                title: "The Seam Hums",
                scene: "The boundary stone, the scout's map spread flat",
                speaker: "Scout Vessa",
                dialogue: [
                    "The seam is in %sector. The dead grass around it widened by six strides while I watched.",
                    "My order says mark anomalies and return. It says nothing about crawling into one, and I am choosing to respect the wording.",
                    "You have survived Gate pressure before. Go inside, find the creature, and close the seam before I need a second sheet of map.",
                ],
                choices: [
                    { text: "Mark the seam. I will close it.", accept: true },
                    { text: "Not yet. Give me the route and your leg count.", conclusion: "Vessa draws the ridge approach and writes LEGS: ENOUGH beside the seam. That is the most honest field note she has left." },
                ],
            },
        ],
        descent: [
            {
                title: "The Seam",
                scene: "A rift mouth torn into the hillside, humming bruise-violet",
                speaker: "Narrator",
                dialogue: [
                    "The air here is wrong before you see the tear. Your teeth ache. The grass leans away from it.",
                    "The seam hangs open like a wound that will not close, and past its edge is the same broken-torii dark as the Hollow Gate itself, only smaller, hungrier, newer.",
                    "Whatever went back inside is still down there. You can hear it moving.",
                ],
                choices: [
                    { text: "Descend into the rift.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You back off the lip of the seam. It does not follow. It waits, the way patient things wait, and you feel it decide to." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You turn from the seam and walk it off your list. Somewhere a scout crosses a line through a bruise-colored circle, and the hunt is off." },
                ],
            },
        ],
    },

    // ── Pet/companion tie: a rift leaks beast-hunger and turns a tamer's pack feral ──
    {
        id: "rift-beast-warren",
        slug: "beast-warren",
        giverName: "Houndmaster Bel",
        giverArchetype: "tracker",
        levelReq: 40,
        floors: 2,
        theme: "beast-den",
        landmark: "rift-beast-den",
        bossAiId: "rift-boss-warren-alpha",
        bossName: "Warren Alpha",
        reward: { weight: 9, fateShards: 1, boneCharms: 20 },
        intro: [
            {
                title: "The Handler at the Kennels",
                scene: "A kennel-yard off the road, chains rattling in empty runs",
                speaker: "Houndmaster Bel",
                dialogue: [
                    "Do not ask why the runs are empty. I will tell you once my hand stops shaking enough to point.",
                    "Three nights ago, every companion I raised turned toward the north ridge at the same moment. Nara broke the gate. The rest followed her.",
                    "There is a Gate rift up there. I could smell its cold chakra on their bedding after they left.",
                ],
            },
            {
                title: "What the Bond Is",
                scene: "The kennel-yard at dusk, straw and iron and the low sound of animals settling. Bel loops an empty lead back over its peg and turns to face you, her voice dropping to the low even tone she saves for frightened animals.",
                speaker: "Houndmaster Bel",
                dialogue: [
                    "The mission forms call them pets. I do not. Nara has opened my door every morning for nine years because she wanted breakfast, not because I owned the hinge.",
                    "That is the bond. A companion stays, fights, and sometimes steps into a blow because it chose the person beside it.",
                    "The rift is replacing that choice with hunger. If it can do that to Nara, it can do it to any companion that gets close.",
                ],
            },
            {
                title: "The Alpha Turned",
                scene: "The kennel gate, a single broken collar in Bel's hands",
                speaker: "Houndmaster Bel",
                dialogue: [
                    "The den is in %sector. Tracks from six wild packs already join my pack's trail at the entrance.",
                    "Nara is still in there. I heard her call once, then the rift answered in her voice and every animal on the ridge moved closer.",
                    "You know what a companion looks like when something else is driving. Stop what is riding her. If you cannot bring Nara home, do not let the rift keep using her voice.",
                ],
                choices: [
                    { text: "I will find Nara and silence the warren.", accept: true },
                    { text: "Not yet. I need to ready my own companion.", conclusion: "Bel checks your companion's collar, paws, and breathing before she nods. Ready means fed, rested, and willing, she says. Come back when all three are true." },
                ],
            },
        ],
        descent: [
            {
                title: "The Warren",
                scene: "A beast-den torn open under the ridge, bones and broken collars underfoot",
                speaker: "Narrator",
                dialogue: [
                    "Hot animal breath rolls out of the rift. Old collars hang from the roots, sorted from largest to smallest.",
                    "One throat calls from below. A dozen animals answer on the same note.",
                    "Nara waits at the center of the warren. Her old collar is still buckled, but more than one shape moves under her hide.",
                ],
                choices: [
                    { text: "Descend into the warren.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You back away from the den. The next call uses Nara's voice. The answer comes from every tunnel at once." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You turn from the den. Somewhere Bel unhooks a lead from a peg and hangs it back up, and does not say the thing she wanted to say." },
                ],
            },
        ],
    },

    // ── Story tie: a rift over the Stormveil Engine's drain-line bleeds stolen reasons ──
    {
        id: "rift-engine-echo",
        slug: "engine-echo",
        giverName: "Recorder Sann",
        giverArchetype: "official",
        levelReq: 52,
        floors: 3,
        theme: "machine",
        landmark: "rift-machine",
        bossAiId: "rift-boss-engine-echo",
        bossName: "Engine-Echo",
        reward: { weight: 11, fateShards: 2, boneCharms: 25 },
        intro: [
            {
                title: "The Recorder With the Wrong Ledger",
                scene: "A storm-country waystation, a clerk hunched over a book that keeps writing itself",
                speaker: "Recorder Sann",
                dialogue: [
                    "My hands do not shake when I copy casualty rolls. They are shaking now. Sann, routing recorder, formerly of Stormveil's arena office.",
                    "I copied the manifests that sent fighters' stolen reasons down to the Hollow Gate. Every one carried a circle cut into four quarters.",
                    "A rift opened over that drain. Reasons are coming back up together, and the mass has learned to stand.",
                ],
            },
            {
                title: "What the Engine Drank",
                scene: "The disused Engine yard behind Stormveil's arena. Sann sets a lantern on the cracked intake floor, and the old drain-seams under the chalk ring catch the light like the veins of something asleep.",
                speaker: "Recorder Sann",
                dialogue: [
                    "Stormveil built its arena over this intake. At the height of a bout, the Engine pulled out the reason a fighter cared enough to bleed.",
                    "The crowd kept the score. The fighter kept the bruises. The lower drain carried the cause away under a quartered-circle seal.",
                    "I entered each result as settled and fair. I can show you the columns. I cannot make that wording honest.",
                ],
            },
            {
                title: "The Circle on the Stone",
                scene: "The waystation table, a manifest weighted flat by a storm-glass paperweight",
                speaker: "Recorder Sann",
                dialogue: [
                    "The break is in %sector, directly above the drain-line. A fresh quartered circle is burned into the stone beside it.",
                    "I call the thing inside the Engine-Echo. It is built from closure bouts, estate fights, and every cause the arena declared settled after extracting it.",
                    "I copied the names that made it. You know how to survive Gate pressure. Close the break before the Echo reaches the arena and finds more names.",
                ],
                choices: [
                    { text: "Go silence the Engine-Echo.", accept: true },
                    { text: "Not yet. Show me the manifests first.", conclusion: "Sann turns the book toward you. Beside each fighter is a reason in one hand and the word SETTLED in another. He waits while you read every line on the open page." },
                ],
            },
        ],
        descent: [
            {
                title: "The Drain-Line",
                scene: "A rift torn over an old drain channel, the quartered circle scorched beside it, storm-light bleeding up",
                speaker: "Narrator",
                dialogue: [
                    "The drain vibrates at the same pitch as Stormveil's arena bell. The quartered circle beside it is hot through your boot.",
                    "Voices rise through the split pipe, each stating a different cause. They knot into shoulders, hands, and a head that turns toward the newest name in the chamber.",
                    "The Engine-Echo stands on the village's stolen reasons. Every voice inside it remembers why it came to fight.",
                ],
                choices: [
                    { text: "Descend to the Engine-Echo.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You step off the scorched circle. The storm-hum does not change. It has been patient for a village's worth of years. It can wait for you." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You walk it off your list. Somewhere Sann closes a book that will not stay closed, and starts copying the next column." },
                ],
            },
        ],
    },

    // ── Legacy tie: the Wandering Sage's teaching, an ended era's hollow echo ──
    {
        id: "rift-hollow-name",
        slug: "hollow-name",
        giverName: "Keeper Oru",
        giverArchetype: "sage",
        levelReq: 62,
        floors: 2,
        theme: "legacy",
        landmark: "rift-legacy",
        bossAiId: "rift-boss-hollow-legacy",
        bossName: "The Hollowed Name",
        reward: { weight: 12, fateShards: 2, boneCharms: 30 },
        intro: [
            {
                title: "The Keeper of the Hall-Road",
                scene: "A quiet shrine-road, an old keeper reading names off a worn wooden slate",
                speaker: "Keeper Oru",
                dialogue: [
                    "I am Oru. Hold the lamp higher. My eyes are old, and this name deserves to be read without guessing.",
                    "The shinobi on this slate earned a place in the Hall, then used that standing to do harm. Their era ended with the entry revoked and the reason written beside it.",
                    "A rift copied the old technique from that record. It did not bring the person back. It built a perfect stance with nobody inside to decide when to stop.",
                ],
            },
            {
                title: "The Hall and the Hollow",
                scene: "Inside the small shrine, Oru stands before a wall of carved names lit by low lanternflame, one hand resting on the cold stone.",
                speaker: "Keeper Oru",
                dialogue: [
                    "The Hall records witnessed deeds, the era in which they happened, and the names people accepted for the patterns they repeated.",
                    "Accepting a Legacy is permanent. The Hall may later condemn what you do with it, but it cannot pretend the earlier deeds never happened.",
                    "That is why we mark a fallen name instead of chiseling it out. Erasure would give the next liar room to tell the story clean.",
                ],
            },
            {
                title: "An Era That Will Not End",
                scene: "The shrine step, the name-slate turned face-down",
                speaker: "Keeper Oru",
                dialogue: [
                    "The copied form is in %sector. It attacks anyone who approaches and resets to the opening stance after every fight.",
                    "It has every technique the old shinobi earned and none of the judgment that once chose when to use them. That makes it dangerous, not sacred.",
                    "Break the copy. Bring me the shard carrying its Hall mark, and I will file it beside the warning instead of the legend.",
                ],
                choices: [
                    { text: "Go lay the Hollowed Name to rest.", accept: true },
                    { text: "Not yet. Tell me whose name it was.", conclusion: "Oru turns the slate over and reads the name once. Then he reads the revocation beneath it, just as clearly. You asked for the whole entry, he says. Keep both parts." },
                ],
            },
        ],
        descent: [
            {
                title: "The Hollowed Legacy",
                scene: "A rift like an old shrine turned inside out, era-banners rotted to threads",
                speaker: "Narrator",
                dialogue: [
                    "No sound comes from the seam. Even your sandals land quietly after you cross it.",
                    "Banners from the revoked era hang in strips. Beneath them, a figure repeats one combat form without tiring or correcting a single foot placement.",
                    "The Hollowed Name sees you and returns to its opening stance. Technique survived. Judgment did not.",
                ],
                choices: [
                    { text: "Descend to the Hollowed Name.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You leave the reverent dark. The figure does not stop its form. It has practiced through longer absences than yours." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You turn away. Somewhere Oru lights the shrine lamp anyway, for a name that will not accept it is out of era." },
                ],
            },
        ],
    },

    // ── Story tie: a rift bleeds the Moonshadow Mirror's stolen secrets ──
    {
        id: "rift-mirror-shard",
        slug: "mirror-shard",
        giverName: "Broker Nemo",
        giverArchetype: "broker",
        levelReq: 70,
        floors: 3,
        theme: "mirror",
        landmark: "rift-machine",
        bossAiId: "rift-boss-mirror-shard",
        bossName: "Mirror-Shard Warden",
        reward: { weight: 13, fateShards: 3, boneCharms: 35 },
        intro: [
            {
                title: "The Broker Who Sells Nothing Tonight",
                scene: "A moonlit canal booth, its shelf of sealed files knocked to the floor",
                speaker: "Broker Nemo",
                dialogue: [
                    "Booth is closed. If you came to buy a secret, tonight's secret is that I am terrified. You may have that one free.",
                    "Moonshadow's Mirror copied the trust people surrendered in names, files, and confessions. A quartered-circle pipe carried those copies to the Hollow Gate.",
                    "A rift broke one piece loose. It walked past this booth wearing my face and greeted me with a name I sold twenty years ago.",
                ],
            },
            {
                title: "What the Mirror Drank",
                scene: "The canal booth. Nemo keeps one hand flat on a shuttered whisper-booth's cold glass as if holding a door shut, his eyes on the faint quartered mark scored into its frame.",
                speaker: "Broker Nemo",
                dialogue: [
                    "The Mirror was a still-water basin under the market. Each private reading made a copy of the person who trusted the booth.",
                    "The valuable part was not the secret itself. It was the moment someone believed the holder would keep them safe.",
                    "The basin kept one copy here and sent another down the quartered-circle pipe. The loose shard is wearing those copies as faces.",
                ],
            },
            {
                title: "A Face That Is Not Yours",
                scene: "The canal booth, a broken hand-mirror reflecting the wrong room",
                speaker: "Broker Nemo",
                dialogue: [
                    "The shard is holding in %sector. It changes faces whenever a witness recognizes the last one.",
                    "I sold some of those people. I cannot promise I would strike when it borrows the right mouth. That is the honest limit of my service.",
                    "You have faced Gate copies without mistaking them for the people they record. Break the shard and bring back every name etched on its rim.",
                ],
                choices: [
                    { text: "Go break the Mirror-Shard Warden.", accept: true },
                    { text: "Not yet. Whose face was it wearing?", conclusion: "A client who trusted me, Nemo says. I sold the confession, the buyer sold the name, and now the copy knows my night-name. He shuts the booth before you can ask for a price." },
                ],
            },
        ],
        descent: [
            {
                title: "The Shard",
                scene: "A rift of black glass and moonlight, reflections that move a half-beat late",
                speaker: "Narrator",
                dialogue: [
                    "Every glass surface beyond the seam shows a different booth. None is the room where you stand.",
                    "The warden turns. Faces move across its mirrored head, each paired with a true name scratched along the rim. It tries yours and places the eyes too far apart.",
                    "The Mirror-Shard raises one hand. Every reflected hand in the chamber moves a half-beat earlier.",
                ],
                choices: [
                    { text: "Descend to the shard.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You step back from the glass. Your reflection stays a half-beat, watching you go, before it agrees to leave too." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You walk it off your list. Somewhere Nemo picks his sealed files up off the floor, and does not check whether they are still his." },
                ],
            },
        ],
    },

    // ── Capstone (story): the Hollow Gate's overflow made flesh; Kite Harrow tracks it ──
    {
        id: "rift-gate-heir",
        slug: "gate-heir",
        giverName: "Kite Harrow",
        giverArchetype: "broker",
        levelReq: 80,
        floors: 3,
        theme: "gate",
        landmark: "rift-gate",
        bossAiId: "rift-boss-gate-heir",
        bossName: "Hollow Gate Heir",
        reward: { weight: 15, fateShards: 3, boneCharms: 45 },
        intro: [
            {
                title: "The Unsworn on the Ridge",
                scene: "A high ridge, Kite Harrow on a wagon's tailboard reading a contract she has already read",
                speaker: "Kite Harrow",
                dialogue: [
                    "You look tired. Good. I distrust people who reach the end of a long road looking refreshed.",
                    "I kept a list of the rifts you closed: the stalker, Nara's warren, the Engine-Echo, the stolen faces. You have made the Hollow Gate expensive to ignore.",
                    "This last break is not a leak. All four village drains backed up together. The overflow built one body large enough to carry everything at once.",
                ],
            },
            {
                title: "What the Rifts Were Really About",
                scene: "The tailboard. Harrow taps a folded ledger against her knee and lets out a dry breath, done with riddles, ready to say the plain thing out loud.",
                speaker: "Kite Harrow",
                dialogue: [
                    "Short version. Stormveil drains the reason behind a fight. Ashen Leaf burns the future someone was becoming.",
                    "Frostfang takes the moment a person would leave. Moonshadow copies the trust handed to a keeper.",
                    "Each village keeps enough of the yield to defend its system. The surplus travels down a hidden pipe marked with one quarter of a circle.",
                    "Those four pipes feed the Hollow Gate, the Sunken Court machine under all of them. Their backed-up surplus is what you are about to fight.",
                ],
            },
            {
                title: "An Heir to the Gate",
                scene: "The tailboard, four village seals laid out in a row on the wood",
                speaker: "Kite Harrow",
                dialogue: [
                    "The body is in %sector. Reasons, futures, exits, and trust all register inside it. That is why I call it the Gate Heir.",
                    "No village owns this contract. Every seat benefits from the same buried theft, so none will be first to name it. The order is mine, and you are free to refuse it.",
                    "If you go, bring back the quartered plate at the center of the body. I will nail it to a waystation board where all four villages must read the same evidence.",
                ],
                choices: [
                    { text: "Take the contract. Face the Hollow Gate Heir.", accept: true },
                    { text: "Not yet. Tell me who you are really protecting.", conclusion: "Myself, Harrow says. Then the people whose names would fill the next intake sheet. Believe those motives in whichever order makes you comfortable; I use both." },
                ],
            },
        ],
        descent: [
            {
                title: "The Heir",
                scene: "The deepest rift yet, four-fold, storm and root and ice and moonlight braided into one dark throat",
                speaker: "Narrator",
                dialogue: [
                    "Four seams meet under the ridge: storm-blue, rootfire red, vault-white, and mirror-black. Each one feeds the chamber ahead.",
                    "The body at their junction has a fighter's reason in its stance, unfinished futures shaping its hands, stolen exits in every step, and a face assembled from surrendered trust.",
                    "A quartered plate turns behind its ribs. Break the Heir and recover that plate before the four pipes pull it apart again.",
                ],
                choices: [
                    { text: "Descend to the Hollow Gate Heir.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You step off the four-fold lip. The dark does not lunge. It has four villages' worth of patience, and it counts you as already owed." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You turn from the throat of it. Somewhere Harrow draws a single clean line through an entry in her ledger, and writes a smaller word beside it: later." },
                ],
            },
        ],
    },
];

/** Lookup by id ("rift-<slug>"). */
export function hollowRiftById(id: string): HollowRift | null {
    return hollowRifts.find((r) => r.id === id) ?? null;
}
