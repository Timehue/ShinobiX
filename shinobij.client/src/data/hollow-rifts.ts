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
                    "I'm Senna Graveward. I tend the graves when there's no family left to do it. Thank you for watching where you stepped.",
                    "There's another marker I need help with. Before I send you there, you should know whose grave it is.",
                ],
            },
            {
                title: "What a Legacy Truly Is",
                scene: "Senna sits back on her heels and rests her staff across her knees.",
                speaker: "Senna Graveward",
                dialogue: [
                    "It belongs to one of the Withheld. They were ordinary people who lived under the Sunken Court and refused to let its machine take away their choices.",
                    "Witnesses preserved accounts of what they did. Over time, they recognized a hundred recurring patterns of resistance. Those are the Legacies: deeds another person can choose to repeat. You don't inherit them from an ancestor.",
                    "When you've built a record of your own, a Sage may recognize one of those patterns in it. He can tell you what he sees, but accepting his reading is up to you.",
                ],
            },
            {
                title: "The Cracked Shrine",
                scene: "Senna rises and points with a weathered hand toward a dark ridge on the horizon, where a faint violet shimmer bleeds up from a broken shrine among the far hills.",
                speaker: "Senna Graveward",
                dialogue: [
                    "The marker I mean stands in %sector. A rift split the shrine floor yesterday and rubbed half its oldest glyph smooth.",
                    "The inscription records that person refusing to surrender a choice to the Court. Their name has worn away, but I can still read the account of their refusal.",
                    "No soul waits in that stone. The Gate is copying the recorded refusal and building a fighter from it. Stop the copy, then take a charcoal rubbing of the original mark for me.",
                ],
                choices: [
                    { text: "I will recover the mark and stop the copy.", accept: true },
                    { text: "Not today. Keep the charcoal for me.", conclusion: "Senna wraps the charcoal and paper together. 'I'll keep these dry. Come back when you're ready.'" },
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
                    "Below the marker, a figure traced in the same glowing strokes repeats a fighting stance. This must be the copy Senna warned you about.",
                ],
            },
            {
                title: "The Unremembered",
                scene: "A figure waits beside the marker. Its face shifts in the grey light, and an ember glows inside its chest.",
                speaker: "The Unremembered",
                dialogue: [
                    "The stone says someone refused. It does not say what they were called.",
                    "The Gate gave me their stance, their grip, and the moment they said no. It gave me nothing that came before or after.",
                    "If you defeat me, take a copy of the inscription to someone who can read it. Let them hear what that person did. It's all the stone has left of them.",
                ],
                choices: [
                    { text: "I'll stop you, then take the rubbing back to Senna.", descend: true },
                    { text: "Not yet. I need a steadier hand.", conclusion: "You climb to the shrine floor and wrap the charcoal again. Below, the copied stance starts its form from the beginning." },
                    { text: "Leave the marker undisturbed.", abandon: true, conclusion: "You climb out of the shrine with the paper still blank. You have no rubbing to bring back to Senna." },
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
                    "Give me one breath before you ask. I ran the last ridge.",
                    "A violet seam is hanging above the east slope. No torii, no shrine, just a split in open air with the Hollow Gate's pressure behind it.",
                    "A long thing climbed out while I marked the map. Too many joints. It went back before I counted the legs.",
                ],
            },
            {
                title: "What Leaks Back",
                scene: "Vessa points to the seam she marked on her field map.",
                speaker: "Scout Vessa",
                dialogue: [
                    "Here is the short version I can prove: the seam widens when the creature pulls, and the grass beside it lies toward the break instead of the wind.",
                    "The quartered mark under its forelegs resembles old Court survey marks. I cannot tell you what it does.",
                    "I saw it take shape at the opening, then crawl back inside. That's where you'll have to look for it.",
                ],
            },
            {
                title: "The Seam Hums",
                scene: "The boundary stone, the scout's map spread flat",
                speaker: "Scout Vessa",
                dialogue: [
                    "The seam is in %sector. The dead grass around it widened by six strides while I watched.",
                    "My order says mark anomalies and return. It says nothing about crawling into one, and I am choosing to respect the wording.",
                    "If you can hold your footing in there, find the creature and close the seam before it spreads farther.",
                ],
                choices: [
                    { text: "Mark the seam. I will close it.", accept: true },
                    { text: "Not yet. Give me the route and your leg count.", conclusion: "Vessa draws the ridge approach and writes LEGS: ENOUGH beside the seam. 'If you need a better number, come back with it.'" },
                ],
            },
        ],
        descent: [
            {
                title: "The Seam",
                scene: "A rift mouth torn into the hillside, humming bruise-violet",
                speaker: "Narrator",
                dialogue: [
                    "You feel the tear before you see it. Your teeth ache. The grass lies flat toward the opening, exactly as Vessa marked it.",
                    "Past the edge stand the same broken torii seen inside the Hollow Gate, crowded into a passage barely wide enough for one person.",
                    "Whatever went back inside is still down there. You can hear it moving.",
                ],
                choices: [
                    { text: "Descend into the rift.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You back off the loose stone. The movement below stops until your footsteps fade, then starts again." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You leave the hillside. The seam is still open, and Vessa will need someone else to investigate it." },
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
                    "You're looking for the hounds? They're gone. All of them. Give me a moment.",
                    "Three nights ago, every companion I raised turned toward the north ridge at the same moment. Nara broke the gate. The rest followed her.",
                    "There is a Gate rift up there. I could smell its cold chakra on their bedding after they left.",
                ],
            },
            {
                title: "What the Bond Is",
                scene: "In the silent kennel-yard, Bel loops an empty lead over its peg.",
                speaker: "Houndmaster Bel",
                dialogue: [
                    "Nara has pushed my door open for breakfast every morning for nine years. This is the first time she hasn't come home.",
                    "She trusts me. When we go into a fight, she chooses to stay beside me. That's how a companion bond should work.",
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
                    "Something in there is controlling her. Please stop it. If you can't bring Nara home, don't let it keep using her to lure the others.",
                ],
                choices: [
                    { text: "I will find Nara and silence the warren.", accept: true },
                    { text: "Not yet. I need to prepare.", conclusion: "Bel nods reluctantly. 'Rest before you go. If you're bringing a companion, check on them too. I don't want another one trapped in there.'" },
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
                    "Nara lies breathing at the center of the warren. Her old collar is still buckled, while a larger outline pulls itself around her like a second shadow.",
                    "The shadow tightens when she tries to rise and loosens when she goes still. Strike the controlling shape when it separates; Nara is alive inside its hold.",
                ],
                choices: [
                    { text: "Descend into the warren.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You back away from the den. The next call uses Nara's voice. The answer comes from every tunnel at once." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You turn from the den. Nara calls again before you reach the road." },
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
                    "I'm Sann. I used to handle the records for Stormveil's arena office. Look at this book. It's adding names while we speak.",
                    "I copied the manifests that sent fighters' stolen reasons down to the Hollow Gate. Every one carried a circle cut into four quarters.",
                    "A rift opened over that drain. Reasons are coming back up together, and the mass has learned to stand.",
                ],
            },
            {
                title: "What the Engine Drank",
                scene: "At the waystation table, Sann opens a plan of the intake beneath Stormveil's arena.",
                speaker: "Recorder Sann",
                dialogue: [
                    "Stormveil built its arena over this intake. At the height of a bout, the Engine pulled out the reason a fighter cared enough to bleed.",
                    "The crowd kept the score. The fighter kept the bruises. The lower drain carried the cause away under a quartered-circle seal.",
                    "I entered each result as settled and fair. The ink is mine. The wording came from the office. Both are still on the page.",
                ],
            },
            {
                title: "The Circle on the Stone",
                scene: "The waystation table, a manifest weighted flat by a storm-glass paperweight",
                speaker: "Recorder Sann",
                dialogue: [
                    "The break is in %sector, directly above the drain-line. A fresh quartered circle is burned into the stone beside it.",
                    "I call the thing inside the Engine-Echo. It is built from closure bouts, estate fights, and every cause the arena declared settled after extracting it.",
                    "I've copied the names of the fighters whose reasons it took. Stop it before it reaches the arena and takes any more. Bring the manifest back so we can preserve the evidence.",
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
                    { text: "Step back. Come back when I am ready.", conclusion: "You step off the scorched circle. The storm-hum settles back to the pitch of an arena bell heard from several streets away." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You leave the drain open. The voices follow you as far as the road." },
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
                    { text: "Not yet. Tell me whose name it was.", conclusion: "Oru keeps the slate face-down. Not to an unverified stranger, he says. The name stays protected; the condemnation does not. He turns the lower edge just far enough for you to read the deed and the Hall's revocation." },
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
                    "Banners from the era of the condemned entry hang in strips. Beneath them, a figure repeats one combat form without tiring or correcting a single foot placement.",
                    "The Hollowed Name sees you and returns to its opening stance. Technique survived. Judgment did not.",
                ],
                choices: [
                    { text: "Descend to the Hollowed Name.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You return to the shrine step. Below, the figure completes the form, resets its feet, and begins at the same angle." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You turn away. The copied fighter is still repeating its form when you lose sight of it." },
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
                    "I sold some of those people's confessions. If it takes one of their faces, I don't know whether I can bring myself to hit it. That's why I'm asking you.",
                    "Their names are scratched into the rim. Break the shard and bring that rim back. I need to know who was copied.",
                ],
                choices: [
                    { text: "Go break the Mirror-Shard Warden.", accept: true },
                    { text: "Not yet. Does it only wear your face?", conclusion: "'No. It came back as a client who trusted me,' Nemo says. 'I sold the confession, and the buyer sold the name. I couldn't look at it.' He shuts the booth." },
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
                    { text: "Step back. Come back when I am ready.", conclusion: "You step back from the glass. Your reflection stays behind for half a beat, then snaps into place with its hand raised where yours is not." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You leave the chamber. In the last pane of glass, the warden is still wearing your face." },
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
                    "%riftRecord",
                    "This last break is not a leak. All four village drains backed up together. The overflow built one body large enough to carry everything at once.",
                ],
            },
            {
                title: "What the Rifts Were Really About",
                scene: "The tailboard. Harrow taps a folded ledger against her knee until the paper's edge begins to buckle.",
                speaker: "Kite Harrow",
                dialogue: [
                    "The reports point to the same system. Stormveil takes away people's reasons for fighting. Ashen Leaf takes away the futures they were working toward.",
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
                    "The body is in %sector. The readings show material from all four drains inside it. I've called it the Gate Heir in the report.",
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
                    "A figure stands where the four pipes meet. Blue light runs through its legs, red through its hands. White script covers its chest, and faces shift across its mirrored head.",
                    "A quartered plate turns behind its ribs. Break the Heir and recover that plate before the four pipes pull it apart again.",
                ],
                choices: [
                    { text: "Descend to the Hollow Gate Heir.", descend: true },
                    { text: "Step back. Come back when I am ready.", conclusion: "You step off the four-fold lip. Behind you, each colored seam dims in turn, but the quartered plate keeps turning in the chamber." },
                    { text: "Leave this rift behind. It is not mine to close.", abandon: true, conclusion: "You climb out without the plate. All four pipes are still feeding the body below." },
                ],
            },
        ],
    },
];

/** Lookup by id ("rift-<slug>"). */
export function hollowRiftById(id: string): HollowRift | null {
    return hollowRifts.find((r) => r.id === id) ?? null;
}
