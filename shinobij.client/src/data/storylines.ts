/*
 * storylines — the per-village main-story arc, plus the helpers that
 * construct each milestone entry (storyPage, milestone) and the small
 * lookup tables they consume (bossScaleByLevel, kageLiberatorTitles,
 * villageBiomeMap, storyAiId).
 *
 * Pure data and pure transformations — no closures, no React, no side
 * effects. Imports StoryStep + CreatorEvent types from App.tsx until
 * those move to types/ in a later pass.
 *
 * Extracted from App.tsx.
 */

import type { CreatorEvent, StoryStep } from "../App";
import type { Biome } from "../types/core";
import type { Character } from "../types/character";


const bossScaleByLevel: Record<number, { hp: number; damage: number; xp: number; ryo: number }> = {
    // bossScaleByLevel = the authoritative story-boss HP curve. makeStoryBossAi
    // builds EVERY story boss hpFloorExempt, so these hp values are used verbatim
    // (no aiHpForLevel floor) and form one clean ascending level→HP curve. Tuned
    // down for winnability; damage / xp / ryo unchanged.
    4:   { hp: 900,   damage: 18,  xp: 120,   ryo: 75 },
    15:  { hp: 2000,  damage: 32,  xp: 500,   ryo: 250 },
    25:  { hp: 3200,  damage: 50,  xp: 900,   ryo: 500 },
    35:  { hp: 4600,  damage: 68,  xp: 1400,  ryo: 800 },
    50:  { hp: 6500,  damage: 90,  xp: 2200,  ryo: 1300 },
    65:  { hp: 8500,  damage: 120, xp: 3400,  ryo: 2000 },
    75:  { hp: 9500,  damage: 148, xp: 4600,  ryo: 2800 },
    85:  { hp: 11000, damage: 185, xp: 6200,  ryo: 4000 },
    // Kage finale: the peer-band AI (lvl 100) hits with uncapped damage + full
    // mastery, so 24k HP made the grind unwinnable for non-maxed players. This hp
    // is now AUTHORITATIVE: makeStoryBossAi builds the finale hpFloorExempt, so the
    // value here is used verbatim (it can sit below aiHpForLevel(100) ≈ 14.7k).
    100: { hp: 13000, damage: 250, xp: 10000, ryo: 7500 },
};

const kageLiberatorTitles: Record<string, string> = {
    "Stormveil Village": "Stormbreaker",
    "Ashen Leaf Village": "Root Liberator",
    "Frostfang Village": "Oathbreaker",
    "Moonshadow Village": "Moon Unmasked",
};

export const villageBiomeMap: Record<string, Biome> = {
    "Stormveil Village": "forest",
    "Ashen Leaf Village": "volcano",
    "Frostfang Village": "snow",
    "Moonshadow Village": "shadow",
};

export function storyAiId(village: string, level: number) {
    return `story-ai-${village.toLowerCase().replace(/\W+/g, "-")}-${level}`;
}

function storyPage(title: string, scene: string, speaker: string, dialogue: string[], leftName = speaker, rightName = "Player"): NonNullable<CreatorEvent["vnPages"]>[number] {
    return { title, scene, speaker, dialogue, leftName, rightName, choices: [] };
}

function milestone(village: string, level: number, title: string, bossName: string, bossIcon: string, pages: NonNullable<CreatorEvent["vnPages"]>, choices: { text: string; conclusion?: string; trait?: string }[] = []): StoryStep {
    const scale = bossScaleByLevel[level] ?? bossScaleByLevel[4];
    const battle = { bossName, bossIcon, bossHp: scale.hp, bossDamage: scale.damage, aiProfileId: storyAiId(village, level), xpReward: scale.xp, ryoReward: scale.ryo };
    // APPEND the lane choices to whatever the end page already carries (the
    // finale reckoning puts gated callback jumps there) instead of replacing.
    const finalPages = pages.map((page, index) => index === pages.length - 1
        ? { ...page, choices: [...(page.choices ?? []), ...choices.map((choice) => ({ ...choice, nextPage: index, battle }))] }
        : page);
    return {
        levelReq: level,
        title,
        cinematicTitle: pages[0]?.title ?? title,
        scene: pages[0]?.scene ?? title,
        dialogue: pages.flatMap((page) => page.dialogue),
        bossName,
        bossIcon,
        bossHp: scale.hp,
        bossDamage: scale.damage,
        rewardXp: scale.xp,
        rewardRyo: scale.ryo,
        biome: villageBiomeMap[village] ?? "central",
        aiProfileId: storyAiId(village, level),
        kageFinale: level === 100,
        liberatorTitle: level === 100 ? kageLiberatorTitles[village] : undefined,
        pages: finalPages,
    };
}

export const storylines: Record<string, StoryStep[]> = {
    "Stormveil Village": [
        milestone("Stormveil Village", 4, "First Thunder", "Stormveil Training Scout", "⚡", [
            { ...storyPage("The Training Cliffs", "Training cliffs above the village", "Elder Vanta", [
                "Elder Vanta: There's a saying here: the sky owes no one shelter. I painted it on that wall myself, forty years back.",
                "Elder Vanta: The board by the well posts your name tonight. Whoever it pairs you with, that's your week. Nobody assigns it. Nobody has to.",
                "Elder Vanta: You'll want gloves. The rail's been live since Tuesday."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
            { ...storyPage("The New One", "The duel ring, odds board filling", "Mira Volt", [
                "Mira Volt: New one. Right. You're Sparkplug until you earn something worse.",
                "Mira Volt: Your scout's the one yawning by the flag. Don't let it fool you, he's dropped three recruits since thaw.",
                "Mira Volt: Strange thing, though. The last kid he beat came up swearing revenge, and by supper couldn't remember what he'd been angry about. Genuinely couldn't.",
                "Mira Volt: Anyway. Board has you at nine to one. I put down a copper. Don't ask which way."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Ask about the kid who forgot his anger.", nextPage: 2 },
                { text: "Ask which way her copper went.", nextPage: 3 }
            ] },
            { ...storyPage("By Supper", "The rail, out of the clerk's hearing", "Mira Volt", [
                "Mira Volt: You caught that. Fine. It's not just him.",
                "Mira Volt: The well-keeper's girl lost a feud with her cousin last month. Big one, years old, whole family took sides.",
                "Mira Volt: Week later they're sharing a stall at market. Ask either of them what it was about and they get this polite little squint.",
                "Mira Volt: Old-timers call it cliff air. Grudges blow out fast up here, they say. My mother's grudges never blew anywhere.",
                "Mira Volt: Forget it. Clerk's waving. You're up after the fish cart clears."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Walk to the ring.", nextPage: 4 }
            ] },
            { ...storyPage("The Copper", "The rail, odds chalked and rechalked", "Mira Volt", [
                "Mira Volt: Nope. A bet you can see changes how a fighter stands. Clerk taught me that, charging me for it.",
                "Mira Volt: I'll sell you this instead, free, one time. He rushes in threes. First two are honest.",
                "Mira Volt: The third one his back foot drags, because by then he's already planning the story he tells at supper.",
                "Mira Volt: That's when he's yours. If you're still up.",
                "Mira Volt: Fish cart's clearing. Go."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Walk to the ring.", nextPage: 4 }
            ] },
            { ...storyPage("Before the Bell", "Ringside, thunder over the cliffs", "Elder Vanta", [
                "Elder Vanta: He'll rush you. They always rush the small ones.",
                "Elder Vanta: Being underestimated is a weapon somebody else hands you free. Around here it's the only free thing.",
                "Elder Vanta: Lose, and the ledger books you a rematch. Win, and it books you something harder. The board doesn't do rest.",
                "Elder Vanta: Thunder first, then the strike. Or so the saying goes."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
        ], [
            { text: "Go before the thunder lands.", conclusion: "You move on the lightning, not after it, and the scout's yawn dies mid-stretch. On the rail, Mira's copper is suddenly in play.", trait: "reckless" },
            { text: "Circle him. Watch the feet, not the hands.", conclusion: "Two circuits and his back foot tells you everything his hands were hiding. Vanta leans on the rail like a man about to collect on a saying.", trait: "suspicious" },
            { text: "Tell the clerk to raise the purse first.", conclusion: "The clerk shrugs and doubles it, and the crowd doubles with it. Now the scout has to win, which is a different fight entirely.", trait: "ambitious" },
        ]),
        milestone("Stormveil Village", 15, "The Riot Bell", "Tempest Guard Captain", "⚡", [
            { ...storyPage("Three Rings", "Market square, dusk", "Narrator", [
                "Narrator: The bronze bell over the well has three voices. One ring for fire. Two for the coast. Three for Stormveil fighting itself.",
                "Narrator: Tonight it rings three, and the market answers like it rehearsed. Stalls tip. Steel comes out over an argument nobody can quote.",
                "Narrator: A crate of fish spills across the cobbles, and both sides step around it without breaking stride."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("Planted Paper", "Behind a toppled stall", "Mira Volt", [
                "Mira Volt: Sparkplug! Legs. He's heavier than he brags.",
                "Mira Volt: This started as a posted duel. Two names, ring at dawn, ordinary grudge. Then someone papered both crews with sealed orders saying the other side cheated.",
                "Mira Volt: Look at the corner. Little column of tick marks, like a tally. Who tallies a riot?",
                "Mira Volt: Kage seal's real, by the way. That's the part I keep waiting for somebody to laugh at."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp", choices: [
                { text: "Drag the bleeding cutter behind the stall.", nextPage: 2 },
                { text: "Grab a second order off a rioter.", nextPage: 3 }
            ] },
            { ...storyPage("The Cutter", "Behind the stall, torchlight through gaps", "Mira Volt", [
                "Mira Volt: Easy. Shoulder wound, he'll keep. Hey. Hey! What crew are you swinging for?",
                "Mira Volt: He doesn't know. Look at him, he's trying to work it out.",
                "Mira Volt: Twenty minutes ago this man took a blade for his side of an argument. Now he can't find the argument.",
                "Mira Volt: My whole life I've watched this village fight. Nobody ever told me they stop knowing why mid-swing.",
                "Mira Volt: His boots are full of fish. That part's normal, at least."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp", choices: [
                { text: "Get him toward the well.", nextPage: 4 }
            ] },
            { ...storyPage("Two Copies", "A doorway off the square", "Mira Volt", [
                "Mira Volt: Give it here. Same wax, same hand. Now watch this.",
                "Mira Volt: Dockside copy says the cliff crews cheated the posted duel. Cliff copy says dockside did. Word for word, mirrored. Somebody wrote both sides of tonight.",
                "Mira Volt: And there's the tally again, eleventh mark half struck. Like the count isn't finished.",
                "Mira Volt: The wax smells like the tower candles. The expensive ones.",
                "Mira Volt: Pocket it fast. Line's forming."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp", choices: [
                { text: "Face the guard line.", nextPage: 4 }
            ] },
            { ...storyPage("The Guard Line", "Market square, guard line forming", "Tempest Guard Captain", [
                "Tempest Guard Captain: Square's closed by order of Kage Raiko. All fighters are booked guilty. Both sides.",
                "Tempest Guard Captain: You, rookie. In my square with your hands full. Drop what you're holding and walk, or your name goes on the punishment wall.",
                "Tempest Guard Captain: The ledger sorts it in the morning. It always does."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
        ], [
            { text: "Stand over the wounded man. He's not walking.", conclusion: "The Captain reads your stance the way clerks read a posting. Mira shifts to your blind side and mutters that she had plans this week.", trait: "merciful" },
            { text: "Challenge the Captain, by name, in the open square.", conclusion: "Half the rioters stop mid-swing to listen, because a called captain is better theater than any riot. He hands his cloak to a subordinate, which answers that.", trait: "reckless" },
            { text: "Hold up the tallied order. Ask who counts.", conclusion: "For one beat the whole square hears the question, and the Captain hears it travel. Then his gauntlet closes over the paper, and the tally becomes evidence against you.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 25, "Orders Written in Lightning", "Lightning-Sealed Informant", "⚡", [
            { ...storyPage("The Lifted Scroll", "A dry loft over the smithy", "Mira Volt", [
                "Mira Volt: I lifted this off the informant before the Guard swept the square. Don't make the face. You'd have done it slower.",
                "Mira Volt: Seal's genuine. Checked it against my aunt's pension letter. So the Kage's office ordered its own riot, or somebody borrows his wax.",
                "Mira Volt: And there's the tally again. Same hand as the riot orders. Eleven marks, then a line under, like something got paid off.",
                "Mira Volt: Even the unsworn woman asked about it. She doesn't ask free questions."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Crack the seal. Read every line.", nextPage: 1 },
                { text: "Say you've seen tallies like this. At the border.", nextPage: 2, requireTrait: "rd22-showed-the-token" },
                { text: "Take it to Vanta unread.", nextPage: 3 }
            ] },
            { ...storyPage("Every Line", "The loft, scroll unrolled by lamplight", "Mira Volt", [
                "Mira Volt: Fine, but if it's warded, you're explaining my eyebrows to the smith.",
                "Mira Volt: Route orders. Which streets the riot was allowed to reach. Which crews to paper first. Somebody fenced a riot like a garden.",
                "Mira Volt: Here, bottom. A name, inked out. Short name. The stroke order's wrong for dockside hands.",
                "Mira Volt: And payment terms. 'Eleven, then the line closes.' Eleven what, it doesn't say.",
                "Mira Volt: The lamp oil's nearly out. Of course it is."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Take it to Vanta.", nextPage: 3 }
            ] },
            { ...storyPage("Counted in Lead", "The loft, rain starting on the roof", "Mira Volt", [
                "Mira Volt: The burn line. Right. That story got here before you did, Sparkplug.",
                "Mira Volt: Two patrol captains, one lead token, and you put it in both their hands at once. Border people still argue about who blinked.",
                "Mira Volt: But the Red Tally counts tolls. Coin in, coin out. This hand is counting something it doesn't want named.",
                "Mira Volt: Same habit, different appetite. That's worse, before you ask.",
                "Mira Volt: Eleven marks and a line. Tolls get totals. What gets a line drawn under it?"
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Take it to Vanta.", nextPage: 3 }
            ] },
            { ...storyPage("The Back Stair", "Vanta's office above the arena gate", "Elder Vanta", [
                "Elder Vanta: There's a saying: paper burns, orders don't. I used to like that one.",
                "Elder Vanta: The first exiles cut a shaft under the arena before they raised one roof. My grandmother swung a pick on it. She never said toward what.",
                "Elder Vanta: She did say the founders argued over this site for a year, then stopped all at once. None of them could say what the argument was.",
                "Elder Vanta: Leave the scroll. Post no challenges this week. Humor an old man."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
            { ...storyPage("Out of the Ink", "The same loft, lamp guttering", "Unknown Voice", [
                "Unknown Voice: Eleven marks. One line. Paid in full.",
                "Unknown Voice: You are the loud one from the square. We hear you when you argue. You argue beautifully.",
                "Unknown Voice: Post a challenge. Any name. See how fast the week improves.",
                "Unknown Voice: The old man knows the stair. Ask what it cost to cut."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
        ], [
            { text: "Take the back stair tonight, alone.", conclusion: "The stair is real, and so is the cold coming up it. On the third landing the informant is waiting with your name already crossed off something.", trait: "reckless" },
            { text: "Put the scroll in Vanta's hands and stay.", conclusion: "He reads it standing, which he never does. 'Witnessed, then,' he says, and the informant obliges by coming up the stairs instead of out of the dark.", trait: "honorable" },
            { text: "Copy the tally. Burn the rest.", conclusion: "The wax spits blue, which honest wax doesn't. You get ten marks copied before the eleventh is suddenly being read over your shoulder.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 35, "The Storm Engine", "Storm Engine Warden", "⚡", [
            { ...storyPage("Under the Arena", "Shaft below the arena floor", "Narrator", [
                "Narrator: The stair ends in a chamber the arena was built to hide. Rings of storm-steel turn around a crystal core, slow as a millwheel.",
                "Narrator: Eleven pipes run up into the arena floor, one for each gate. Beside every junction, years of chalked figures, crossed out and rewritten.",
                "Narrator: It is not a weapon. It has gauges, a maintenance rota nailed to a post, and a mop."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("Drainage Work", "The engine chamber, rings turning", "Elder Vanta", [
                "Elder Vanta: Nine years on the arena council. Twice I signed for 'drainage work.' Twice.",
                "Elder Vanta: Every posted grudge, every sworn rivalry up there drains through those pipes like rain off a roof. The village fights. Something down here banks it.",
                "Elder Vanta: There's a saying about the sky testing us. I wrote it. I'd like it back."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp", choices: [
                { text: "Ask what the second signature bought.", nextPage: 2 },
                { text: "Bring Mira down. No secrets between you.", nextPage: 3, requireTrait: "mira-trust" },
                { text: "Climb to the platform and demand answers.", nextPage: 4 }
            ] },
            { ...storyPage("The Second Signature", "Beside the junction pipes, chalk dust", "Elder Vanta", [
                "Elder Vanta: The first was repairs. Honest word, dishonest use. I didn't ask.",
                "Elder Vanta: The second was a widening. After the year of the Harlan feud, the take ran so high the pipes sang. Council said the noise scared the vendors.",
                "Elder Vanta: I asked one question that year. What do the pipes feed. Next morning my pension doubled, with a note thanking me for my diligence.",
                "Elder Vanta: I kept the note. Some men keep worse things."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp", choices: [
                { text: "Climb to the platform.", nextPage: 4 }
            ] },
            { ...storyPage("One Person Knows", "The chamber stair, Mira on it", "Mira Volt", [
                "Mira Volt: Don't look shocked, I've been two turns behind you since the gate. You walk loud when you're scared.",
                "Mira Volt: So this is where the week goes. All those bouts my mother answered. The board booked her and this thing drank the... give me a second.",
                "Mira Volt: You know about the boat under my tile. Nobody knows about the boat. So you get this too, storm rules.",
                "Mira Volt: If it comes down to this machine or the people feeding it, I know which way I swing. Even if the Kage holds the other end.",
                "Mira Volt: Right. Enough honesty. Someone's on the platform."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp", choices: [
                { text: "Face the platform.", nextPage: 4 }
            ] },
            { ...storyPage("The Well-Keeper", "The engine platform, wards waking", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Touch nothing. Ask here, where the answers live.",
                "Kage Raiko Veyr: Every dry roof in Stormveil is this room. Every wall the coast never took. Want it stopped? Say so. Then name who goes thirsty first.",
                "Kage Raiko Veyr: The Elder calls it hunger. Call it a well."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("The Rota", "The engine platform, rings slowing", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: The Warden keeps the rota, not my orders. Get past him and I'll walk you through the gauges myself.",
                "Kage Raiko Veyr: He's been down here longer than my seat. He mops. He oils. He wins.",
                "Kage Raiko Veyr: Impress me."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
        ], [
            { text: "Say it stops. To his face.", conclusion: "'Heard,' Raiko says, and writes nothing down, which from him is a contract. The Warden sets his mop against the rail like a man clocking in.", trait: "honorable" },
            { text: "Go for the crystal core, now.", conclusion: "You cover half the distance before the chamber even reacts. The Warden covers the other half, and the rings above keep their slow, indifferent time.", trait: "reckless" },
            { text: "Read the chalked figures at the junctions first.", conclusion: "Under the newest figures someone has chalked a half-scrubbed name, and it isn't a stranger's. The Warden steps between you and the rest of it before you can finish reading.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 50, "Jonin of the Unchained Sky", "Jonin Rank Trial: Twin Tempest Duelists", "⚡", [
            { ...storyPage("The Balcony", "Kage tower balcony, crowd below", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Look down. Count. Every one of them climbed here to watch the long-odds fighter take rank.",
                "Kage Raiko Veyr: Stormveil promotes impact. You hit the square, the Guard, my informant, my Warden. Good. Hit harder.",
                "Kage Raiko Veyr: One custom first. Every new Jonin posts a sworn rival. Lifetime bout, open date. The board keeps it forever.",
                "Kage Raiko Veyr: Pick a name. Pick mine, if you've got the spine."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Ask why the board keeps names forever.", nextPage: 1 },
                { text: "Ask whose name he posted at his rite.", nextPage: 2 }
            ] },
            { ...storyPage("Open Dates", "The balcony rail, wind rising", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Wrong question. Better than most. Boards forget nothing because villages forget everything.",
                "Kage Raiko Veyr: A grudge on the board outlives the grudge. Outlives the fighters. The village keeps drawing on it either way.",
                "Kage Raiko Veyr: Ask the clerk how many open dates the board holds. He'll say all of them. He'll smile doing it.",
                "Kage Raiko Veyr: Pick your name."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Leave the balcony.", nextPage: 3 }
            ] },
            { ...storyPage("His Name", "The balcony, crowd noise below", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Ha. Twenty years, and you're the second person to ask.",
                "Kage Raiko Veyr: I posted the woman who held this seat before me. In front of her. She signed the slot herself and thanked the clerk.",
                "Kage Raiko Veyr: Ten years on the board. Then one bout, this balcony, no crowd. The board settled it. The seat came down to breakfast with me.",
                "Kage Raiko Veyr: She never once explained herself to me. Best gift I ever got. Pick your name."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Leave the balcony.", nextPage: 3 }
            ] },
            { ...storyPage("Edge of the Crowd", "The stair below the balcony", "Mira Volt", [
                "Mira Volt: Don't look at me, look at him. You dug up his basement and he's proud of you. Kage-proud. That's a weather warning, Sparkplug.",
                "Mira Volt: A sworn rivalry never comes off the board. My mother's is still posted. Six years gone, and her name still draws.",
                "Mira Volt: ...Whatever name you give them, they keep."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Tell her about the chalk you counted.", nextPage: 4, requireTrait: "sv42-kept-the-count" },
                { text: "Ask what name her mother posted.", nextPage: 5 },
                { text: "Say nothing. Walk down together.", nextPage: 6 }
            ] },
            { ...storyPage("Eleven Seams", "A landing, out of the crowd's hearing", "Mira Volt", [
                "Mira Volt: The night of the Harlan bout. You chalked the floor and somebody scrubbed it by morning. I know. I watched you do it.",
                "Mira Volt: Eleven seams. Eleven pipes under the arena. And six years on, my mother's name is still drawing through one of them.",
                "Mira Volt: So when they hand you that pen tonight, remember you're not signing a grudge. You're signing a supply line.",
                "Mira Volt: I hate that I know that. Go get promoted."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Go down to the rite.", nextPage: 6 }
            ] },
            { ...storyPage("Her Name", "A landing, out of the crowd's hearing", "Mira Volt", [
                "Mira Volt: Serra Volt, against a Guard captain. His name doesn't matter. He's dead too.",
                "Mira Volt: He broke her sword arm in a posted bout, so she posted him back, lifetime terms. They fought eleven times. The clerks made a fortune.",
                "Mira Volt: The twelfth date was booked when the coast fever took them both, same winter. And the board kept the slot open anyway.",
                "Mira Volt: Two dead people, still scheduled. Still drawing. Somebody explain to me what's being kept there.",
                "Mira Volt: Don't. Don't try. Go get promoted."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Go down to the rite.", nextPage: 6 }
            ] },
            { ...storyPage("The Rite", "Arena floor, trial ring chalked", "Elder Vanta", [
                "Elder Vanta: The Twin Duelists take the rank trial. Two against one. That part's honest, at least.",
                "Elder Vanta: There's a ceremony saying. 'The sky crowns the loud.' I'm not going to say it.",
                "Elder Vanta: Fight well. And sign nothing while your blood's up. The board loves fresh Jonin best of all."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp" },
        ], [
            { text: "Take the trial. Refuse to post a rival.", conclusion: "The clerk waits with the pen out for a long, professional moment before putting it away. Above, Raiko leans on the rail like the show finally started.", trait: "honorable" },
            { text: "Write Raiko's name on the board.", conclusion: "The ink is barely dry before the crowd finds its voice, and it isn't a murmur. Raiko reads his own name upside down and waves the Duelists in like a man clearing his calendar.", trait: "reckless" },
            { text: "Post a rival who died years ago. Watch.", conclusion: "No pause, no question, open date. Whatever the board keeps, it doesn't need the living to keep it, and the clerk's small nod says you're not the first to check.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 65, "The Mission That Should Not Exist", "Tempest Execution Squad", "⚡", [
            { ...storyPage("The Order", "Guard muster, ravine road, before dawn", "Tempest Guard Captain", [
                "Tempest Guard Captain: Kage order. Camp of forty in the switchback ravine. Sedition, hoarding, refusal of posted challenge.",
                "Tempest Guard Captain: No questions. No prisoners. An execution squad sweeps in behind you to confirm the count.",
                "Tempest Guard Captain: For the record, I requested the mountain route instead. For the record, I was told no."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
            { ...storyPage("The Camp", "Ravine camp, cookfires banked", "Rebel Medic", [
                "Rebel Medic: You can lower that. We surrendered to the last squad. And the one before.",
                "Rebel Medic: Ask what we refused. Challenges. That's the sedition entire. Forty people stopped posting grudges, the arena take dropped, and we turned into rebels by Thursday.",
                "Rebel Medic: We call it the draw. Your elder's word, not ours. Ask him about his ninth.",
                "Rebel Medic: There's tea, if your squad allows ten minutes. There's usually not ten minutes."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Say Vanta offered you the ninth. You refused.", nextPage: 2, requireTrait: "sv58-refused-the-ninth" },
                { text: "Ask what forty people do without a board.", nextPage: 3 },
                { text: "Ask why they never just ran.", nextPage: 4 }
            ] },
            { ...storyPage("The Ninth", "Inside the mess tent, tea steeping", "Rebel Medic", [
                "Rebel Medic: Say that again. Slower. No, sit down first.",
                "Rebel Medic: We heard an elder's share got turned down. Nobody believed it. Shares don't come back. The column doesn't shrink.",
                "Rebel Medic: The week you refused, two families here slept through the night. First time in years. I keep records, that's not poetry.",
                "Rebel Medic: So the tea's from the good tin, and you get names. Mine's Asha. The boy on watch is Corr's nephew.",
                "Rebel Medic: Drink it before the squad checks its map twice."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Climb to the ridge.", nextPage: 5 }
            ] },
            { ...storyPage("Without a Board", "Between the tents, washing lines up", "Rebel Medic", [
                "Rebel Medic: Chores, mostly. It's not a philosophy out here, it's a rota.",
                "Rebel Medic: The difference shows at night. People argue by the fires. Loudly. For hours. And in the morning they're still angry.",
                "Rebel Medic: Still angry means still theirs. Down in the village, you fight, you shake hands, and something's gone by supper. Everyone calls that peace.",
                "Rebel Medic: Old Ferro up there has hated his brother for nine years and can tell you every reason. We're a little proud of him.",
                "Rebel Medic: The kettle's boiling over. Excuse me."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Climb to the ridge.", nextPage: 5 }
            ] },
            { ...storyPage("The Sweet Water", "The camp's edge, spring running", "Rebel Medic", [
                "Rebel Medic: Run where? Every road has a waystation, every waystation has a board. Refusing a posted challenge travels with you.",
                "Rebel Medic: And this ravine has three things. Sweet water. Shade by noon. And you can't hear the riot bell from here. Try it.",
                "Rebel Medic: Nothing. First month, that quiet kept people up at night. Now they nap through anything.",
                "Rebel Medic: We didn't pick this place to hide. We picked it because it was the first spot the village couldn't reach our ears.",
                "Rebel Medic: The squad won't hear the bell either. Small mercies."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Climb to the ridge.", nextPage: 5 }
            ] },
            { ...storyPage("The Ridge", "The ridge above the camp", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Up here. Look at me when you decide.",
                "Kage Raiko Veyr: Forty people quit paying for the roof and stand under it anyway. That's the whole charge. Convict, or don't.",
                "Kage Raiko Veyr: Obey and you're a wall. Refuse and you're interesting. Decide fast. The squad bills by the hour."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Ask why a Kage climbed here himself.", nextPage: 6 },
                { text: "Turn your back. Decide among the tents.", nextPage: 7 }
            ] },
            { ...storyPage("Why He Climbs", "The ridge, wind off the coast", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Careful. That's nearly the right question.",
                "Kage Raiko Veyr: Stand here. Listen. What do you hear? Nothing. Now you know what a Kage buys with a morning's climb.",
                "Kage Raiko Veyr: Down there I hear every grudge in the village. All of them, all day. Call it a gift of the seat.",
                "Kage Raiko Veyr: Forty people I can't hear at all. You work out why that order got signed.",
                "Kage Raiko Veyr: Clock's running. Squad bills by the hour."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Go down to the camp.", nextPage: 7 }
            ] },
            { ...storyPage("The Hour", "The ravine mouth, squad fanning out", "Tempest Guard Captain", [
                "Tempest Guard Captain: Squad's in position. Count's confirmed at forty, plus staff.",
                "Tempest Guard Captain: For the record, I'm required to remind you of the order. For the record, I've now done that.",
                "Tempest Guard Captain: Whatever you're going to do, the light's coming up. Do it while I'm still writing the preamble."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
        ], [
            { text: "Get between the squad and the tents.", conclusion: "The medic has the wounded moving before your heels are set. On the ridge, Raiko settles in cross-legged, and the squad's front rank stops pretending this is a sweep.", trait: "merciful" },
            { text: "Take the camp's surrender. Loudly. On record.", conclusion: "You give the ridge every word, formal as a rite, and the Captain's pen takes it all down. The squad answers by spreading wide, which the record will also show.", trait: "honorable" },
            { text: "Signal compliance. Then misdirect the sweep.", conclusion: "Your false heading buys the tents one whole hour of empty ravine. It costs you the squad leader's patience, and he spends the last of it walking straight at you.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 75, "Mira's Betrayal", "Mira Volt, False Betrayer", "⚡", [
            { ...storyPage("Sigils", "The cliff stair, no lanterns", "Mira Volt", [
                "Mira Volt: Before you draw, count the sigils. Guard cloak. Captain's knot. I know.",
                "Mira Volt: Raiko thinks I sold you. I sold him that story myself, full price, and the ravine families came off the squad rosters the same week.",
                "Mira Volt: Somebody writes those rosters, Sparkplug. For a while, it was going to be me or nobody.",
                "Mira Volt: ...There wasn't a version where telling you sooner kept you alive. I checked. I kept checking."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Ask what the captain's knot cost her.", nextPage: 1 },
                { text: "Say the rooftop already told you the truth.", nextPage: 2, requireTrait: "mira-trust" },
                { text: "Skip the story. Ask what the plan needs.", nextPage: 3 }
            ] },
            { ...storyPage("The Knot", "The stair, wind pulling at the cloak", "Mira Volt", [
                "Mira Volt: Four months of saluting people I wanted to bite. That part was fine. I'm a good liar, we've established this.",
                "Mira Volt: Then in month three a sweep order crossed my desk with nine names on it, and mine was the countersignature line.",
                "Mira Volt: I signed. Slow-walked the muster, lost the map twice, got the nine warned. But I signed it, and my hand didn't even shake.",
                "Mira Volt: That's what the knot costs. Not the lying. Finding out how good at it your hands are.",
                "Mira Volt: Anyway. Next landing. There's a thing you need to see."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Climb to the landing.", nextPage: 3 }
            ] },
            { ...storyPage("Storm Rules", "The stair, rain beginning", "Mira Volt", [
                "Mira Volt: The rooftop. Yeah.",
                "Mira Volt: You gave me a real route that night. You didn't trade it, you just handed it over, and I mortared it into the map with mine.",
                "Mira Volt: That's the night this plan started, if you want the truth. I figured anyone who'd hand me an exit deserved to keep theirs.",
                "Mira Volt: Storm rules still hold. Above the gutter line, everything's true. So believe me now, because the next part sounds insane.",
                "Mira Volt: Next landing. Come on."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Climb to the landing.", nextPage: 3 }
            ] },
            { ...storyPage("The Copied Key", "The stair landing, key humming", "Mira Volt", [
                "Mira Volt: He keeps the real one in the tower vault. Four months to copy the wardstamp. Look at it.",
                "Mira Volt: The Engine's a spigot. This opens whatever the spigot drinks from. He says 'my gate key' like there's a door somewhere that owes him.",
                "Mira Volt: The plan needs him to believe I'd cut you down in the square. Which means, and I want it noted, I hate this plan."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Ask what happens if he doesn't believe it.", nextPage: 4 },
                { text: "Say the book already fears you. Use that.", nextPage: 5, requireTrait: "sv70-read-the-mark" },
                { text: "Take the key and say nothing.", nextPage: 6 }
            ] },
            { ...storyPage("If He Doubts", "The landing, thunder far off", "Mira Volt", [
                "Mira Volt: Then I'm a traitor with a stolen key, and you're the fool who trusted one twice. He'd post us both by morning.",
                "Mira Volt: But he'll believe it. You know why? Because friend against friend is his favorite arithmetic. He promoted me the day after your Jonin rite.",
                "Mira Volt: He's been building this bout since before I ever put on the cloak. We're just moving up the date.",
                "Mira Volt: Rain's picking up. Good. Fewer witnesses to how bad my acting is."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Take your positions.", nextPage: 6 }
            ] },
            { ...storyPage("What the Book Remembers", "The landing, key quiet now", "Mira Volt", [
                "Mira Volt: The routing mark. I was in the stands that day, you know. Second rail, praying you'd just fall like they wrote.",
                "Mira Volt: You read it out loud instead, and the book blinked. Three clerks gone by nightfall. The column stopped signing for a month.",
                "Mira Volt: A month, Sparkplug. One read-out bought a month. That's when I knew the rosters weren't weather. They're handwriting, and handwriting flinches.",
                "Mira Volt: So tonight we make it flinch again, bigger. Stage a bout the book didn't write and watch what panics.",
                "Mira Volt: I've wanted to say that plan out loud for four months."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Take your positions.", nextPage: 6 }
            ] },
            { ...storyPage("Noted", "The stair, the storm listening", "Hollow Gate Echo", [
                "Hollow Gate Echo: Noted. We note everything.",
                "Hollow Gate Echo: Friend against friend posts the sweetest bout. The board never taught you that. The board learned it from us.",
                "Hollow Gate Echo: Fight her well. Fight her badly. Both spend the same."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp" },
        ], [
            { text: "Trust her. Stage the bout, full speed.", conclusion: "Four months of held plans go out of her in one long exhale. 'Third exchange,' she says, 'and don't you dare pull it.' The key goes back inside her cloak, warm as a coal.", trait: "loyal" },
            { text: "No stage. If we fight, we fight.", conclusion: "She looks at you the way she looked at the routing mark. Then the grin drops, the captain's knot comes off her shoulder, and the storm gets its bout unscripted.", trait: "reckless" },
            { text: "Keep the key. I finish this alone.", conclusion: "The humming stops when your hand closes over it, like the key changed its mind about something. 'Then it goes through me first,' she says, and drops the act she no longer needs.", trait: "ambitious" },
        ]),
        milestone("Stormveil Village", 85, "The Kage's True Storm", "Hollow Tempest General", "⚡", [
            { ...storyPage("Fees Waived", "The square, cyclone forming above", "Elder Vanta", [
                "Elder Vanta: He's posted everyone. Every guild, every family grudge older than breakfast, all booked for tomorrow. Fees waived.",
                "Elder Vanta: Fees waived. Forty years around that arena and I never once saw it work free.",
                "Elder Vanta: The saying goes, a storm clears the air. The man who wrote that never audited one. I'd know."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
            { ...storyPage("The Professional Read", "Arena undercroft, gauges spinning", "Kite Harrow", [
                "Kite Harrow: You want the professional read. Every gauge down here is redlined and all eleven junctions are drawing at once. That's not weather, that's a purchase order.",
                "Kite Harrow: I've read the books in four villages now. Four systems, four currencies, one vault underneath the lot. Your Engine is one intake among four.",
                "Kite Harrow: Tonight it pays out a balloon. I don't do warnings, so understand this one cost you nothing. That should worry you."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "Ask why she's still here, unpaid.", nextPage: 2, requireTrait: "sv80-pulled-her-back" },
                { text: "Ask which junction pays out first.", nextPage: 3 },
                { text: "Leave her to the gauges. Get upstairs.", nextPage: 4 }
            ] },
            { ...storyPage("Outstanding Balance", "The undercroft, gauge needles climbing", "Kite Harrow", [
                "Kite Harrow: Careful. That question has a balance attached.",
                "Kite Harrow: You talked me out of a sale on this stair once. Best offer of my career, repriced by one sentence.",
                "Kite Harrow: I ran your numbers weekly since. They hold. I hate that they hold, and I settle my books before a market crashes.",
                "Kite Harrow: So tonight I work for you, rate of nothing, until we're even. Don't thank me. It goes on the invoice.",
                "Kite Harrow: Now go upstairs. Your Kage is about to address his assets."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "Get above ground.", nextPage: 4 }
            ] },
            { ...storyPage("Gate Nine", "The junction row, chalk and brass", "Kite Harrow", [
                "Kite Harrow: Professional answer? Gate nine. The academy side.",
                "Kite Harrow: Smallest pipe, oldest grudges. Schoolyard feuds cost nothing to start and never get settled, so the margin's enormous.",
                "Kite Harrow: Whoever built this put the widest intake under the children. I don't shock easily. I'm shocked.",
                "Kite Harrow: If you cut anything tonight, cut nine first. Consider that a free consultation. I don't repeat those."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "Get above ground.", nextPage: 4 }
            ] },
            { ...storyPage("The Voice in the Thunder", "Every street at once", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Hear me, Stormveil. Fight tonight and be remembered. Hide, and be weather.",
                "Kage Raiko Veyr: The coast calls us banditry with a flag. Let them come count our chains. Count them. There are none.",
                "Kage Raiko Veyr: My General holds the square. Take it from him, or kneel in the rain with the rest."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
            { ...storyPage("The Drain", "Rooftop over the square", "Mira Volt", [
                "Mira Volt: They're answering him. Dock crews, cliff guilds. The academy kids are sharpening practice steel, which would be funny any other night.",
                "Mira Volt: The General's the surge valve. Every bout that starts tonight routes through his square like a drain.",
                "Mira Volt: ...We stop him there, or nowhere."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "Ask if the boat is still an option.", nextPage: 6 },
                { text: "Point at the square. The General first.", nextPage: 7 }
            ] },
            { ...storyPage("The Boat", "The rooftop, cyclone light on the tiles", "Mira Volt", [
                "Mira Volt: Funny you'd ask tonight.",
                "Mira Volt: It's gone. I gave it to the ravine families after the sweep orders started up again. Asha rowed. She's terrible at it.",
                "Mira Volt: So there's no second route anymore. No pack, no tile, nothing under the floor but everyone else's floor.",
                "Mira Volt: I did that on purpose, before you make it a moment. Exits make you patient. I'm done being patient.",
                "Mira Volt: Square's filling. Come on."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "Head for the square.", nextPage: 7 }
            ] },
            { ...storyPage("The Square", "Above the arena square, drums starting", "Narrator", [
                "Narrator: The General holds the square's center the way a plug holds a basin. Around him, tonight's first bouts are already starting at the edges.",
                "Narrator: Every strike on the cobbles lands twice, once in the air and once somewhere under it.",
                "Narrator: On the arena roof, the weathervane has stopped pointing anywhere at all."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
        ], [
            { text: "Rally every faction to one banner first.", conclusion: "The dock crews arrive swearing and the cliff guilds arrive counting, and Mira sorts them into a line without one speech being given. The General watches the square's edges go quiet and finally draws.", trait: "loyal" },
            { text: "Walk into the square and take the General.", conclusion: "The crowd gives you the corridor it gives every posted bout, old habit outliving the occasion. Overhead the cyclone drops a full turn lower, interested.", trait: "reckless" },
            { text: "Shear the junctions feeding the square first.", conclusion: "The first junction shears with a sound like a debt being called in. By the third the cyclone wobbles, and the General stops watching the crowd and starts watching the sand.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 100, "Break the False Thunder", "Kage Raiko Veyr, Hollow Storm Tyrant", "⚡", [
            { ...storyPage("The Eye", "Tower gate, inside the storm's eye", "Narrator", [
                "Narrator: The tower stands in a round of still air. Below it, for the first time in living memory, the challenge board hangs empty.",
                "Narrator: The village didn't hide. It climbed. Rooftops, cliff rails, the arena rim, every face turned up toward the eye.",
                "Narrator: Somebody has left the maintenance mop leaning against the throne-room door."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp" },
            { ...storyPage("The Door", "The tower gate, Mira beside it", "Mira Volt", [
                "Mira Volt: So. This is the door.",
                "Mira Volt: I had a whole thing prepared. Joke first, then the sincere part, then a shove toward the stairs. I've forgotten the joke.",
                "Mira Volt: The clerk closed the betting window an hour ago. First time in village history. No odds tonight, Sparkplug. Not even yours."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Look back down the open road.", nextPage: 2, requireTrait: "sv92-open-road" },
                { text: "Ask what she does if you don't come down.", nextPage: 3 },
                { text: "No goodbyes. Go up.", nextPage: 4 }
            ] },
            { ...storyPage("The Open Road", "The switchback below, full of lamplight", "Mira Volt", [
                "Mira Volt: Go on, look. They followed. The whole climb, in the open, not a blade among them.",
                "Mira Volt: Corr's down there. The Harlan brothers, both of them, standing together and not knowing why, same as ever. Asha brought the ravine.",
                "Mira Volt: You climbed where everyone could see you. So now everyone's seeing. That was the whole bet, and it paid.",
                "Mira Volt: They can't follow past the gate. They know. They came anyway.",
                "Mira Volt: Somebody down there is selling chestnuts. I love this village. Go."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Go through the gate.", nextPage: 4 }
            ] },
            { ...storyPage("Three Rings", "The gate, lamplight from below", "Mira Volt", [
                "Mira Volt: You don't get to ask me that and then walk off. But fine.",
                "Mira Volt: If you don't come down, I ring the bell. Three rings, my own hands. Stormveil fighting itself, one last honest time.",
                "Mira Volt: No boat. No routes. I spent every exit I ever packed, and I'd like it noted that I did it on purpose.",
                "Mira Volt: So don't lose. That's the sincere part. The shove's coming next."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Go through the gate.", nextPage: 4 }
            ] },
            { ...storyPage("The Ledger", "The throne room, wards humming", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: In. Close the door.",
                "Kage Raiko Veyr: You know the room under the arena. You know what's under the room. So hear what no Kage says out loud.",
                "Kage Raiko Veyr: I found the ledger the day I took the seat. So did the man before me. The woman before him. I read it. I signed.",
                "Kage Raiko Veyr: Every Kage signs. The seat comes with the valve. Tell me you'd have starved the village instead. Say it slowly."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp" },
            { ...storyPage("The Signature", "The throne room, the book open between you", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Look at it. Not at me. Every signature in that book believed it was the last reasonable man.",
                "Kage Raiko Veyr: I gave it my reasons one at a time. Cheap ones first. It takes those too.",
                "Kage Raiko Veyr: Ask your question. You've been carrying one up nine flights. Set it down."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Ask what the valve took from him.", nextPage: 6 },
                { text: "Tell him to stand. The board is waiting.", nextPage: 10 }
            ] },
            { ...storyPage("His Price", "The throne room, wards dimming", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Quiet. It took quiet.",
                "Kage Raiko Veyr: I hear every grudge in Stormveil. All of them, all night, like rain on a helmet. Twenty years.",
                "Kage Raiko Veyr: I signed to protect this village and it pays me in this village, ceaselessly, at full volume. The ledger has a sense of humor.",
                "Kage Raiko Veyr: One ravine went silent on me once. You know the one. I'd have traded the seat for a week of it.",
                "Kage Raiko Veyr: That's the last thing I explain. Ever. Stand up."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Face him.", nextPage: 10 }
            ] },
            { ...storyPage("Answer for the ninth.", "The reckoning", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Vanta's ninth sits in your name. I countersigned the transfer myself.",
                "Kage Raiko Veyr: You've drawn off this village since the day he offered. Same book. Same blank header. Mine.",
                "Kage Raiko Veyr: So drop the clean hands. Take the rest of the column. It's what I did."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("Answer for the voided bout.", "The reckoning", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Tenth slot, routing mark, and you read it to the whole square. Three clerks gone by morning.",
                "Kage Raiko Veyr: You cost me a season of bookkeeping. Nobody's cost me a season in twenty years.",
                "Kage Raiko Veyr: So the board is clear tonight. No marks. No book. Show me the square wasn't theater."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("Answer for the column behind me.", "The reckoning", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Pike's scared half. You marched them up my mountain, counting your steps.",
                "Kage Raiko Veyr: Fear that follows is the oldest draw there is. You brewed it in one evening.",
                "Kage Raiko Veyr: Keep them. The seat likes your recipe already."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("Paid in Kind", "The throne floor, wards failing", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Look at my hands. Forty years of other people's grudges, coming due.",
                "Kage Raiko Veyr: It pays out in kind. I drew rivalry, so it makes me rivalry. I'll want to fight you after I've won. I want the rematch already.",
                "Kage Raiko Veyr: No speeches. The board is empty and the whole coast is on the rails. Give them a final argument worth the seat."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", leftName: "Player", rightName: "Kage Raiko Veyr", rightImage: "/portraits/kage-raiko-veyr-hollow.webp", choices: [
                { text: "Answer for the ninth.", nextPage: 7, requireTrait: "sv58-took-the-cut" },
                { text: "Answer for the voided bout.", nextPage: 8, requireTrait: "sv70-read-the-mark" },
                { text: "Answer for the column behind me.", nextPage: 9, requireTrait: "sv92-fear-column" }
            ] },
        ], [
            { text: "Refuse the challenge. Out loud. Before everyone.", conclusion: "The refusal drops through the tower like a stone down the arena shaft, and every gauge below goes still. Raiko hears the one sound no Kage ever bought, and attacks into it.", trait: "honorable" },
            { text: "Accept the bout. After, the valve gets metered and watched.", conclusion: "'Metered,' he repeats, tasting the word like foreign food. Below the floor the seams flare once, protectively, as if the ledger just read your terms.", trait: "suspicious" },
            { text: "The seat, the valve, the ledger. Mine.", conclusion: "He exhales like a debtor on settlement day and slides the open book toward your side of the table. Then he stands, rolls his shoulders, and takes his hands off everything except the bout.", trait: "ambitious" },
        ]),
    ],
    "Ashen Leaf Village": [
        milestone("Ashen Leaf Village", 4, "Roots of the Shinobi", "Wooden Root Guardian", "🌿", [
            { ...storyPage("Sign In", "Register hall, morning queue", "Toma Reed", [
                "You sign in before your first trial. Everyone does. Sorry, I should introduce myself. Toma. Reed. Grove squad, third year.",
                "The register holds every name in the village. Living on the east wall, dead on the west. The wall decides more than most people admit.",
                "There was a woman here yesterday. Her son's plate went west last spring. She told the clerk she cannot picture his face anymore. Just the plate.",
                "Anyway. Sign. Middle column. Press hard, the cedar is dense."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Ask which wall his family reads from.", nextPage: 1 },
                { text: "Ask about the woman who forgot the face.", nextPage: 2 }
            ] },
            { ...storyPage("The Middle Column", "Register hall, the east wall", "Toma Reed", [
                "East. Mostly east. We're joiners, my family, we... the R row is right there, actually. You can see it from the queue.",
                "It's a short row.",
                "Sorry. You should sign. The clerk gets behind by noon and takes it out on the ink."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Follow him to the yard", nextPage: 3 }
            ] },
            { ...storyPage("The Plate", "Register hall, west wall", "Toma Reed", [
                "Marta Senn. Her boy was grove squad, like me. A year ahead.",
                "The clerk offered her the rubbing they keep on file. She held it upside down for a while. Then she thanked him twice and left.",
                "The clerks say the wall keeps them. I used to like how that sounded.",
                "Middle column. Press hard."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Sign and go to the yard", nextPage: 3 }
            ] },
            { ...storyPage("The Yard", "Training yard beneath ash dusted oaks", "Elder Mori", [
                "Stand there. No, the flat stone. Roots come up under the soft ground, new students turn ankles, and then I do paperwork.",
                "You will hear that Ashen Leaf grows its shinobi rather than trains them. Attribute that to me. I said it forty years ago and regret the phrasing annually.",
                "The yard is older than the village. The village is built from its dead. The ash goes into the mortar, and that is not a figure of speech.",
                "Bow to the roots before we begin. Not for luck. For the ones underfoot."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp" },
            { ...storyPage("First Lesson", "The oldest oak splits along its grain", "First Flame Avatar", [
                "New ink. It could be smelled from the wall.",
                "Every student who ever stood on that stone stands under it now. They are the floor. They are listening.",
                "The Root Guardian gives the first lesson. It has given it nine hundred times. It does not tire, and it does not flatter.",
                "Show the floor what it is holding up."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp" },
        ], [
            { text: "Bow to the roots, full and unhurried.", conclusion: "Mori's chin drops a fraction, which from him is a parade. Under your feet, the ground goes briefly quiet, like a room deciding to listen.", trait: "honorable" },
            { text: "Watch how the Guardian favors its cracked side.", conclusion: "The split in its bark opens a half beat before each step, and you file it. Old things keep old habits.", trait: "suspicious" },
            { text: "Skip the bow. Strike while it is still waking.", conclusion: "Behind you, Mori begins a sentence and gives up on it. The Guardian's eyes finish lighting mid swing.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 15, "The Forbidden Seed", "Rootbound Guard Initiate", "🌿", [
            { ...storyPage("Black Flowers", "The shrine tree, roped off since dawn", "Toma Reed", [
                "It bloomed overnight. Black, all the way through. I checked a petal against soot and the soot looked pale.",
                "Three facts. The tree was bare yesterday. The rope went up before the bell. And the flowering rite is already scheduled for tonight, incense ordered.",
                "Rites take a week to schedule. I once waited nine days to get a funeral moved.",
                "Sorry. Fourth fact. Nobody will say who tends this tree."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("Precedent", "The rope line, downwind of the blooms", "Elder Mori", [
                "You are wondering what it means. The council does not wonder; it voted. A blessing, nine to one.",
                "The last bloom was three generations ago, which is a way of telling you I was young when I stood here.",
                "The archive records that season as a blessed harvest. Six families left the village that year and never wrote. The archive records that too, rather more briefly.",
                "I was the one vote."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Ask what his one vote said.", nextPage: 2 },
                { text: "Ask how tonight's rite was scheduled overnight.", nextPage: 3 }
            ] },
            { ...storyPage("The One Vote", "Downwind, voices low", "Elder Mori", [
                "It said what dissent always says. Delay. Study. Consult the record.",
                "I could have said the truth instead. I remember the Callows leaving on a grain cart. The children waved. No letter ever came.",
                "The minutes will record this vote as unanimous. They did last time. I checked this morning, before the rope went up.",
                "The wind again. Come to this side."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Walk the rope line", nextPage: 4 }
            ] },
            { ...storyPage("Incense by the Crate", "Behind the shrine, delivery boxes stacked", "Elder Mori", [
                "You count well. The incense order is dated three days back. The tree bloomed last night.",
                "So either the supplier is a prophet, which would be cheaper, or someone expected the bloom and does not file expectations.",
                "The rota for tending this tree is not in the archive. I have looked. I am the archive.",
                "Leave the crates as you found them. Clerks notice angles."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Walk the rope line", nextPage: 4 }
            ] },
            { ...storyPage("Posted Since Dawn", "A young guard blocks the rope line", "Narrator", [
                "The guard at the rope is young. New sandals. Ceremonial sash tied by someone else's hands.",
                "Her orders are one sentence, and she has said it four times to four people. Nothing was planted. Move along.",
                "She stands the way people stand when they were chosen for how little they know.",
                "Behind her, one black flower loses a petal. It falls faster than a petal should."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
        ], [
            { text: "Palm a black flower while Mori holds the guard's eye.", conclusion: "The petals weigh wrong, like wet cloth folded small. The initiate watches your hand come back over the rope, and her one sentence changes.", trait: "suspicious" },
            { text: "Ask Mori, in front of the guard, what the last bloom cost.", conclusion: "Mori recites six family names from memory, in order, facing her. Her grip shifts on her weapon like the names are being read at her.", trait: "honorable" },
            { text: "Go over the rope and find who tends the tree.", conclusion: "Three steps past the rope, her hand closes on your collar. She is new, but somebody trained that grip on something bigger than students.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 25, "Names Removed from Scrolls", "Archive Spirit of the Root", "🌿", [
            { ...storyPage("The Gaps", "Archive stacks, lamps trimmed low", "Elder Mori", [
                "I asked you here because you are not a clerk, which is presently a qualification.",
                "Look at the shelf. Do not look for what is there; count the dowels. Forty slots, thirty-one scrolls. The dust says the other nine left together, and recently.",
                "Whole lines, gone. Not deceased. Deceased is the west wall, and the west wall is honest. Gone.",
                "Every removed line questioned the Kage's rites. All within twenty years. I have found a pattern, and it has the poor manners to be simple.",
                "I have served this archive for forty years. Prove me wrong by week's end. Please."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Remind him what you once carried here unannounced.", nextPage: 1, requireTrait: "rd22-sealed-for-mori" },
                { text: "Ask which erasure is freshest.", nextPage: 2 }
            ] },
            { ...storyPage("Filed Under Weather", "A drawer with no label", "Elder Mori", [
                "The lead token. Yes. You gave it to me sealed and asked nothing, which I have thought about since.",
                "I filed it under weather reports, autumn, damp. Nobody audits the damp.",
                "There is a drawer like that for every year I have kept this room. Things that are true and cannot be shelved.",
                "Nine scrolls would not fit in a drawer. Whoever took them does not file. They subtract.",
                "You kept my confidence once. I am spending yours now. Count with me."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Hear Toma out", nextPage: 3 }
            ] },
            { ...storyPage("Nine Days of Dust", "The high shelf, lamp held close", "Elder Mori", [
                "This slot. Put your finger in the dust ring. Nine days, ten at most. I date dust the way farmers date frost.",
                "Nine days ago the village held a promotion feast. Every clerk was pouring wine upstairs. I signed the duty log myself.",
                "So it is not history being tidied. It is happening on feast nights, while the archive drinks.",
                "The next feast is in twelve days."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Hear Toma out", nextPage: 3 }
            ] },
            { ...storyPage("The Letter", "Archive floor, scrolls spread flat", "Toma Reed", [
                "My brother's name is Aren. Was. Is. Sorry. I no longer know which.",
                "He questioned the flowering rites. Wrote it up properly, filed it through the right office and everything. He believed in the right office.",
                "The archive now says my family has one son. My mother believes it. She corrected me at dinner.",
                "I have his letter. Two years old. One page against the whole west wing, and I keep having to check it still says his name."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
            { ...storyPage("On Duty", "The stacks exhale dust", "Narrator", [
                "The lamps go blue. Between the stacks, something assembles itself from scroll dust and dowel pins, wearing the shape of a librarian.",
                "It is not angry. It is on duty.",
                "It moves toward Toma's letter the way a clerk moves toward a filing error.",
                "The archive keeps what it is told to keep. Tonight it has been told about you."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
        ], [
            { text: "Copy the nine erased names while the Spirit advances.", conclusion: "Ink smears under your speed, but all nine names hold legible. The Spirit turns toward the wet page before it turns toward you.", trait: "suspicious" },
            { text: "Burn the falsified shelf and let the record die honest.", conclusion: "Thirty-one scrolls of curated history catch at once. The Spirit stops pretending to be slow.", trait: "reckless" },
            { text: "Declare the pattern for the record, Kage's name and all.", conclusion: "Toma flinches at the Kage's name said plainly, indoors, on record. The Spirit does not flinch. It reclassifies you, and comes on.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 35, "The First Flame Chamber", "First Flame Sentinel", "🌿", [
            { ...storyPage("Sixty Steps", "A root stair under the oldest tree", "Narrator", [
                "The stair is not hidden. A door under the oldest tree, and pinned to it a tending rota in a clerk's hand, current through next month.",
                "Sixty steps down, the air stops smelling of cedar and starts smelling of nothing at all.",
                "Green light comes up the stairwell like water finding a level.",
                "Toma counts the steps under his breath. He stops at forty."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
            { ...storyPage("The Offering Chamber", "The chamber of the First Flame", "Elder Mori", [
                "There it is. You may stare. Everyone does, and the Flame has never minded an audience.",
                "It was an offering chamber in the founding years. The dying and the spent came down on their own feet and gave what was left. The village wintered on it.",
                "Willingness was the whole of the rite. That word has fallen out of the paperwork, and I can date, roughly, the year it fell.",
                "I brought you because I no longer trust myself to be the only one who has seen it. An old man alone revises his memories to keep warm."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
            { ...storyPage("Queue Lines", "Closer to the fire", "Toma Reed", [
                "Stand still a second. Feel that? Heat goes out. This goes in.",
                "Three things. No smoke. No fuel. And the floor slopes toward it, worn smooth in lanes. Queue lines. People walked in orderly.",
                "Somebody has been feeding it on schedule. The rota upstairs goes back years. I want to know what the deliveries were.",
                "Sorry. I already know. I just wanted to be wrong out loud first."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Tell him the shed plate never comes below this floor.", nextPage: 3, requireTrait: "toma-hope" },
                { text: "Walk the queue lane to the mouth.", nextPage: 4 }
            ] },
            { ...storyPage("Above Ground", "Away from the lanes, under the roar", "Toma Reed", [
                "You still carry it. I didn't ask where. Don't tell me where.",
                "My grandmother used to say the fire is a door that only opens inward. I thought she was being poetic. She was a joiner. She measured doors.",
                "Promise me the plate stays where the sun can find it. That's the whole prayer I've got left.",
                "Look at the lanes. Everyone who walked them was somebody's plate once.",
                "Okay. Count the steps with me on the way back up. It helps."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Face the fire", nextPage: 5 }
            ] },
            { ...storyPage("The Mouth", "The lane's last stretch, stone gone glassy", "Narrator", [
                "The lane narrows as it goes, the way queues do when they stop being voluntary.",
                "Near the mouth, the floor is inlaid. Names, packed edge to edge, spiraling inward. The oldest are worn to shine. The newest still hold their corners.",
                "The innermost ring is empty. Room for more.",
                "The heat never reaches your skin. Your own pulse does, arriving hard, as if asked for.",
                "Toma calls your name twice before you hear it."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Step back from the mouth", nextPage: 5 }
            ] },
            { ...storyPage("The Mouth's Guard", "The fire stands up", "First Flame Avatar", [
                "The Flame keeps the given. That is the whole of its law.",
                "It kept the willing for two hundred years. Then it was brought the unwilling, and it kept them too, because keeping is all it knows.",
                "The Sentinel guards the mouth. It does not ask how a gift arrived. No one has ever taught it the difference.",
                "You are standing in the lane where the gifts walk. Prove you are not one."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
        ], [
            { text: "Smother a rank of the Flame and see what it uncovers.", conclusion: "Where the fire dies back, the name spiral shows deeper, rows packed tighter than the lanes above. The Sentinel is already moving.", trait: "reckless" },
            { text: "Find the delivery ledger by the mouth before it reaches you.", conclusion: "The ledger stand by the mouth is empty, its dust ring fresh. Somebody cleared it for your visit, and the Sentinel steps between you and the question.", trait: "suspicious" },
            { text: "Put the Sentinel down and seal the chamber behind you.", conclusion: "Toma is already stacking rota papers against the door for kindling. The Sentinel comes out of the mouth like a man defending his house.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 50, "The Branch That Rises", "Jonin Trial: Rootbound Master", "🌿", [
            { ...storyPage("Summons", "Kage hall, incense already lit", "Elder Mori", [
                "A promotion, and you did not apply. Savor how that feels. It will feel different shortly.",
                "The rank is real. The trial is real. The Rootbound Master has broken candidates I would have sworn were oak.",
                "It is the oath after the trial you should read twice. There is a clause about the register. There is always a clause about the register."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Ask who put your name forward.", nextPage: 1 },
                { text: "Ask what line nine cost him, forty years ago.", nextPage: 2 }
            ] },
            { ...storyPage("Grown, Not Picked", "The hall doors, out of the ushers' hearing", "Elder Mori", [
                "That is the correct question, and I dislike the answer. The nomination came from the Kage's office. Directly. No sponsoring jonin, no committee.",
                "Candidates are grown here. Grown things get pruned, weighed, filed. They are not picked out of the air.",
                "She has read something about you she likes. I have spent a week failing to learn what.",
                "Mind the step at the dais. It is higher than it looks. Most things in this hall are."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Find Toma in the antechamber", nextPage: 3 }
            ] },
            { ...storyPage("Mori's Signature", "An alcove off the hall, incense thinner", "Elder Mori", [
                "Direct. Good. Very well.",
                "I swore line nine in this room. The incense was sandalwood then. Within a year I found my first misfiled name and reshelved it without reading it twice.",
                "That is what the clause buys. Not silence. A man who tidies. Silence at least knows it is lying.",
                "I reshelved for a decade before I started counting instead. Counting is the only oath I have kept.",
                "On the left tonight, when you look for me. With the other relics."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Find Toma in the antechamber", nextPage: 3 }
            ] },
            { ...storyPage("Line Nine", "An antechamber, the oath scroll on a stand", "Toma Reed", [
                "I copied the jonin oath while you were being measured for the sash. The clerks let me. Nobody watches the earnest ones.",
                "Line nine. You swear the register is whole and true, and to defend its wholeness. Whole. True. In the same breath as your blood and your blade.",
                "Everyone before you swore it. Every jonin in that hall has already sworn the wall is honest.",
                "She wants you sworn too. I think... sorry. I think a jonin who swore is worth more to her than a chunin who counts."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
            { ...storyPage("We Keep", "The dais, the Kage in dark green", "Kage Hoshina Enju", [
                "Approach. We are told you serve this village with more attention than comfort. Good. Comfort is what the dead buy for us. Attention is the interest we owe.",
                "The oath is old. We did not write it; we only keep it. You will find that keeping is the whole of the office.",
                "Swear, and rise a branch of this tree. The dead hold the walls, and the living hold the dead. That is the entire arrangement."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Ask her about the name you restored. Isa Renn.", nextPage: 5, requireTrait: "rd44-restored-isa-renn" },
                { text: "Ask what line nine keeps whole.", nextPage: 6 },
                { text: "Take the sash in silence.", nextPage: 7 }
            ] },
            { ...storyPage("New Mortar", "The dais, the hall listening", "Kage Hoshina Enju", [
                "Isa Renn. She crossed forty enemies over tested ice and corrected the record standing. We say her name on the ninth of Thaw. She hears us.",
                "The restoration reached our desk unsigned. We countersigned it within the hour and asked the registrar nothing. We knew the hand. We had been watching it.",
                "Understand what you did. A restored name grieves twice. Once for the loss, once for the years of silence. The register received both. It was a generous gift.",
                "You gave without being asked. That is the oldest rite we have. Swear, and we will teach you what it feeds."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Take the sash", nextPage: 7 }
            ] },
            { ...storyPage("What Line Nine Keeps", "The dais, incense climbing", "Kage Hoshina Enju", [
                "A fair question, asked in the wrong room. We will answer it anyway. The hall may make of that what it likes.",
                "Line nine does not protect the wall from lies. It protects the living from the dead. Grief unfenced would empty this village in a generation.",
                "Our predecessor swore it to her predecessor. The dead who wrote it are in the mortar of this hall. They are listening to you decide.",
                "The incense is burning down. It keeps better time than we do."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Take the sash", nextPage: 7 }
            ] },
            { ...storyPage("The Sash", "Below the dais, the trial doors open", "Narrator", [
                "The sash is heavier than cloth has any business being. Somebody has sewn cedar plates along the inner seam.",
                "On the left, Mori studies the incense as if it had misfiled something.",
                "Toma stands where the clerks stand, holding his copied oath like it might need to testify.",
                "Below the hall, down a stair nobody points to, the Rootbound Master is waiting. The doors do not creak. They are maintained."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
        ], [
            { text: "Swear it flat and even. Keep your counting to yourself.", conclusion: "Line nine goes past your teeth without catching. The sash settles wrong anyway, cut for somebody your size but not your shape.", trait: "suspicious" },
            { text: "Swear, then ask her before the hall what she expects for it.", conclusion: "She answers without pausing. Everything we keep, kept. The hall takes it for liturgy; she holds your eye one beat too long for liturgy.", trait: "honorable" },
            { text: "Refuse line nine until the nine missing scrolls are answered for.", conclusion: "The incense burns on through the quiet you have made. Hoshina signals the trial anyway, which tells you the sash was never the point.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 65, "The Mission of Quiet Ash", "Rootbound Retrieval Squad", "🌿", [
            { ...storyPage("Crate Two", "Outer grove, relic crates half buried", "Toma Reed", [
                "I stole them. I want that on the table before you decide anything. Forty-four name plates, out of the destruction queue.",
                "Aren is in here. Crate two. I have not opened crate two.",
                "They were scheduled to burn because they are proof. Every plate is a person the wall says never lived. Plates disagree, and plates cannot testify. So they burn.",
                "Sorry. That is everything. Now you can decide."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Open crate two. Together. Now.", nextPage: 1 },
                { text: "Ask about the funeral favor he is owed.", nextPage: 2 }
            ] },
            { ...storyPage("Aren Reed", "Crate two, lid raised", "Toma Reed", [
                "Okay. The nails first. My grandmother would have... hand me the flat iron.",
                "There. Third from the top. Aren Reed.",
                "I practiced this part. Being calm. The lid was the whole rehearsal, and it's just cedar, it's just a board with his...",
                "He notched it himself at his trials. We all do. His slipped, and he laughed about it for a week. The notch is still crooked.",
                "Close it. Please. I can carry it now. Before tonight I couldn't have."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Watch the treeline with Mori", nextPage: 3 }
            ] },
            { ...storyPage("The Favor", "The grove, light going copper", "Toma Reed", [
                "Sarn. Second wing. Two winters ago his mother's rite clashed with a muster inspection, and inspections outrank grief. Officially.",
                "I moved the muster. Forged nothing, just... walked the request through four offices in one afternoon. Nobody walks. That's the trick. Everyone sends paper.",
                "He said if I ever needed a slow squad, he owed me one. He meant it as a joke.",
                "Tonight I find out how slow. Don't count on it. But count it."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Watch the treeline with Mori", nextPage: 3 }
            ] },
            { ...storyPage("Precision by Omission", "The grove, wind turning, dusk coming", "Elder Mori", [
                "The order sheet says stolen ritual property, recovery by force if refused. It does not say what the property is. Precision by omission. The oldest tool in the annex.",
                "The squad believes it. Belief is cheap when the paperwork is tidy, and I have spent a career making paperwork tidy, so attribute the observation.",
                "If they take the crates, the names burn uncontested. Uncontested is the only way the fire profits. You have heard the arithmetic called mercy. Tonight you may audit it.",
                "Whatever you choose, choose before the light goes. Retrieval squads prefer the dark. Fewer witnesses to retrieve."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
            { ...storyPage("The Standard Offer", "Lantern signals in the trees", "Narrator", [
                "The squad comes proper. Three wings, low lanterns, blades still wrapped. Procedure, done kindly.",
                "Their captain calls the standard offer in a bored voice. Return the property, and no names go in the report.",
                "No names in the report. Toma laughs once, wrong, like a hiccup.",
                "The crates sit between you, lids fast, dusk settling into the grain."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Call in Harrow's favor. In writing, no expiry.", nextPage: 5, requireTrait: "rd48-favor-on-the-books" },
                { text: "Ask the captain what the property is.", nextPage: 6 }
            ] },
            { ...storyPage("One Line, Crossed Out", "A fourth lantern, unhurried, off the road", "Kite Harrow", [
                "Don't everybody reach for steel. I'm expensive to stab.",
                "You rang? A ledger line walks both ways. I was two sectors over, and favors accrue interest I'd rather not pay.",
                "Terms. I freight your crates through Central bond tonight. Village writs stop at the bond gate. Squads too. Even polite ones.",
                "The fee is the line itself. Crossed out, witnessed, done. Cheapest thing I've sold all year, and it still stings.",
                "Load fast. The captain is recalculating his evening, and I don't insure against arithmetic."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Load the crates", nextPage: 7 }
            ] },
            { ...storyPage("The Captain's Sheet", "The rope of lantern light, holding", "Narrator", [
                "The question crosses the grove and lands. The captain looks at his order sheet, front, then back. The back is blank.",
                "He says ritual property, but slower this time, listening to himself say it.",
                "In the second wing a lantern dips. Somebody's arm has gotten tired, or somebody's certainty.",
                "The captain folds the sheet away and does not call the offer again. Procedure has run out of lines."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Stand with the crates", nextPage: 7 }
            ] },
            { ...storyPage("Wrapped Blades", "The grove, full dark arriving", "Narrator", [
                "The wind turns, carrying woodsmoke from the village. Ordinary smoke. Supper fires.",
                "Toma sets his hand flat on crate two, once, the way you touch a shoulder.",
                "Mori steps back into the treeline shadow, unhurried, a man finding his seat before the record starts.",
                "The lanterns spread into a slow half circle. Nobody has unwrapped a blade yet."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
        ], [
            { text: "Guard the crates. Drop the squad without drawing blood.", conclusion: "Wrapped blades stay wrapped, which is a language squads understand. Their captain sighs like a man asked to work in the rain, and signals the advance.", trait: "merciful" },
            { text: "Bury the crates and let the squad find you instead.", conclusion: "Fresh earth under old needles, and Toma memorizes the bearing twice. When the lanterns arrive, there is nothing behind you, which makes you the only evidence.", trait: "suspicious" },
            { text: "Send the crates away with Toma and hold the grove alone.", conclusion: "He argues for exactly three seconds, then takes the handles. The last you see of crate two is his knuckles white on it, and then the lanterns are on you.", trait: "loyal" },
        ]),
        milestone("Ashen Leaf Village", 75, "The Ancestors Speak", "Ancestor-Bound Flame Beast", "🌿", [
            { ...storyPage("The Wall Annotates Itself", "Old archive at night, west wall alight", "Elder Mori", [
                "Come and look before it decides to stop. The west wall is annotating itself.",
                "Every name that went to the fire willing burns steady. See the founding rows. Even light, no flicker. Content, if light can be content.",
                "And there. The gaps. The erased lines glow at the edges, like a page held over a candle. The archive has noticed what it is missing.",
                "Forty years I kept this room. It never once corrected me. I find I am moved, and at my age that is a medical concern."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Ask which light is his family's.", nextPage: 1 },
                { text: "Ask why the wall chose tonight.", nextPage: 2 }
            ] },
            { ...storyPage("Third Row, Fourth Plate", "The west wall, lamp lowered", "Elder Mori", [
                "Third row from the sill. Fourth plate. Moris, going back to the founding. Steady, all of them. We die orderly. It is our one family talent.",
                "And two shelves up, edge glow. Ilen Voss. I signed the finding against him early in my keeping. Sedition, the paper said. The paper was mine.",
                "His light has been waiting at the edges since the wall woke. I have stood here an hour. It does not blink.",
                "Do not comfort me. Hand me the lamp oil. The wall should see this whole room tonight."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Join Toma at the plates", nextPage: 3 }
            ] },
            { ...storyPage("What Crossed the Threshold", "The archive doors, bolted from inside", "Elder Mori", [
                "Because forty-four plates crossed that threshold at dusk. The wall counts what enters. It has been brightening since, oldest rows first, like a roll call finding its order.",
                "The archive is not haunted. I want that understood. Haunting is aimless. This is filing.",
                "Whatever wakes when stolen names come home, it is older than my keys. Stand nearer the lamps anyway."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Join Toma at the plates", nextPage: 3 }
            ] },
            { ...storyPage("Reading Aloud", "West wall, the recovered plates unwrapped", "Toma Reed", [
                "The founders answer when you read them. Watch. Isu Reed, joiner. See the light lean?",
                "They chose it. Every steady light on this wall walked down those stairs to buy the village a winter. The stolen ones do not answer. They wait.",
                "I am going to read all forty-four. Out loud, into the wall, and the wall can do what it likes with the difference.",
                "Aren Reed. Filed his complaint through the right office."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Read your own claimed name into the wall.", nextPage: 4, requireTrait: "al70-claimed-the-name" },
                { text: "Take half the plates and read beside him.", nextPage: 5 }
            ] },
            { ...storyPage("A Living Entry", "The wall's newest quarter, lights turning", "Narrator", [
                "You say the name you claimed at the dais. The one the whole village knows now. It goes into the wall like a coin into deep water.",
                "The nearest lights lean, all together, the way the founders lean for Toma. Then they hold. A living name, answered.",
                "Toma has stopped reading. Mori polishes his lamp glass twice, which is what he does instead of gasping.",
                "Behind the mortar a space opens, exactly your shape, and stays open. The wall is patient. It has your spelling now.",
                "The lamp needs trimming. Nobody trims it."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "The wall answers", nextPage: 6 }
            ] },
            { ...storyPage("The Forty-Four", "Plates passing hand to hand", "Toma Reed", [
                "Serra Whitlow, potter. Ren Ammas, gate runner. His plate still smells of the queue hall. Slowly, now. The wall has waited years. It can wait for diction.",
                "Halfway through, the edge glow starts reaching for the plates before we say them. It knows what it's missing. It's checking our order.",
                "Your turn. Read. If your voice does what mine is doing, don't apologize for it. We're past that, you and me.",
                "Eleven left. Then Aren, last. I'm allowed one favorite."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "The wall answers", nextPage: 6 }
            ] },
            { ...storyPage("The Keeper Wakes", "The wall bulges; fire takes a shape", "First Flame Avatar", [
                "The willing left a guard behind them. They gave everything but their grievance. The grievance was bound here, to keep the count honest.",
                "It wakes when stolen names come home. It has waked twice in the village's whole history. Both times, it could not tell rescuer from thief.",
                "It will read you the only way it can.",
                "Stand still or stand ready. It does not honor a third option."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp" },
        ], [
            { text: "Call the forty-four names into its fire, one by one.", conclusion: "Toma feeds you names and you call them into the roar, one by one. Around the ninth, the Beast stops circling to learn whether you flinch.", trait: "honorable" },
            { text: "Pull it off the wall and out into the yard.", conclusion: "You take its eye with a thrown lamp and run for the yard. It follows you out through the doorway without using the doorway.", trait: "reckless" },
            { text: "Let it burn the forged rows. Guard the true ones.", conclusion: "You wager it knows its own dead better than the clerks do. The forged rows go up like they were waiting for permission, and the Beast turns to see who is editing.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 85, "The Kage Burns the Future", "Rootbound Elder Champion", "🌿", [
            { ...storyPage("The Proclamation", "Market square, guards working a list", "Narrator", [
                "The proclamation is nailed to the register hall by breakfast. Novel works to be surrendered for assay, their makers detained for questioning.",
                "Fourteen taken by noon. A kiln builder. A girl who improved the water screw. Three are children whose crime is a kite that steers.",
                "The crowd does not riot. The crowd forms a queue at the register to check the spelling of the detained's names.",
                "The clerks sharpen fresh styluses. They have been told to expect entries."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp" },
            { ...storyPage("The Count", "Rooftop over the holding yard", "Toma Reed", [
                "No apologies this time. Just the count.",
                "Fourteen names, none with standing family. I checked all fourteen. Two orphan makers. The kite girl's parents are west wall already. Every one would grieve uncontested.",
                "This is not fear of invention. Invention is the excuse the council will believe. It is a harvest, sized for something.",
                "She is paying down something large, and she picked people whose grief has nowhere to go but the Flame. Say I am wrong. Take your time. You cannot."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Send word to Harrow. You hold something of hers.", nextPage: 2, requireTrait: "al80-pulled-her-back" },
                { text: "Ask how he checked fourteen families in an afternoon.", nextPage: 3 }
            ] },
            { ...storyPage("Interest", "The rooftop, one shadow extra", "Kite Harrow", [
                "You didn't have to send word. I bill quarterly and you're carrying my collateral. I keep track of where I'm kept.",
                "Fourteen uncontested names. I found the rate at your fire trough, remember. Do the sum and sit down first.",
                "That's not upkeep. That's not even a bad winter. That's purchase price. She's buying something off the thing under this village, and it's big.",
                "I don't do rescues. Rescues are unpriceable, and I've told you my policy on that. But tonight I can misplace a gate schedule, and you never met me.",
                "One more thing. What you took off my scale that night. Keep it wherever you keep yours."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Find Mori in the annex", nextPage: 4 }
            ] },
            { ...storyPage("The Checking", "The rooftop, tiles going cold", "Toma Reed", [
                "I've been keeping books on grief since the burning yard. You knew that. You didn't know how big the books got.",
                "Every rite, I write who stands in the marked rows and who has nobody standing. A name with no row is worth more to the fire. So I track rows.",
                "Fourteen for fourteen. Nobody in any row. That's not a list somebody drew up this morning. That's years of my kind of counting, done by somebody else, first.",
                "There's another counter in this village. There has been all along. I'd like very much to burn their books."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Find Mori in the annex", nextPage: 4 }
            ] },
            { ...storyPage("No Third Door", "The annex, cabinet standing open", "Elder Mori", [
                "I have defended the arithmetic in this room for forty years. One name, forty lives. You have heard me say it, or heard of me saying it.",
                "Fourteen at once is not arithmetic. Fourteen at once is a withdrawal. Something under us has presented a bill, and she intends to pay early.",
                "I signed three of the old choices myself. I am not clean, and I will not pretend to be, because you would smell it."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Ask him the three names he signed.", nextPage: 5 },
                { text: "Ask what bill comes due all at once.", nextPage: 6 }
            ] },
            { ...storyPage("Three Signatures", "The annex, lamplight on old ink", "Elder Mori", [
                "Ilen Voss, whom I called sedition. Marra Dunn, whom I called theft. The third I will say only once, so attend. Pell Mori. My brother's daughter.",
                "A famine year. The council wanted a name with weight, to make the mercy respectable. I gave them weight. My family thanked me for the honor. They believed it.",
                "I have not said her name in this room since. The room noticed. Rooms do.",
                "Now you know what my arithmetic is made of. Spend it however you like. It has never bought me a full night's sleep."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "To the holding yard", nextPage: 7 }
            ] },
            { ...storyPage("The Bill", "The annex, maps under the ledger", "Elder Mori", [
                "My predecessor left me one page, to be read only if the withdrawals ever tripled. They have tripled. I have read it.",
                "Under the Flame there is a mouth. Under the mouth, a channel. The channel does not end beneath this village. It runs somewhere with three other doors.",
                "The page calls it a lattice. The seat's first duty is keeping our anchor fed, lest the drain reverse. The word reverse is underlined twice.",
                "She is not harvesting to grow. Something on the far side is calling accounts due, and she means to pay early. Fourteen names early.",
                "The kettle has gone cold. Leave it."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "To the holding yard", nextPage: 7 }
            ] },
            { ...storyPage("The Yard Tonight", "The holding yard, lamps in courteous rows", "Narrator", [
                "The holding yard is quiet the way waiting rooms are quiet. Fourteen makers sit apart from each other, each given a blanket, each logged.",
                "The kite girl has folded hers into a square and sits on it. Her kite is entered in the seizure book as one flying engine, string included.",
                "At the gate stands the Elder Champion. Forty years of service, every year of it sincere. He nods as you come. He was told to expect entries too.",
                "Somewhere above, the register hall keeps its lamps lit. The clerks are working late tonight."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp" },
        ], [
            { text: "Break the holding yard open before the escort forms.", conclusion: "Fourteen makers scatter into the dark with their spelling still their own. Between you and the gate, the Elder Champion sets his feet like a man closing a door.", trait: "merciful" },
            { text: "Call the Champion out by name, in the square.", conclusion: "He accepts with a bow so correct it stings. Forty years of village praise steps into the ring, and the crowd cannot pick a side to pray for.", trait: "reckless" },
            { text: "Go over the yard entirely. Reach Hoshina tonight.", conclusion: "The tower route crosses the Champion's post, and there was never a route that did not. He raises no alarm. He widens his stance, courteous to the last.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 100, "The Tree Must Choose", "Kage Hoshina Enju, First Flame Vessel", "🌿", [
            { ...storyPage("Green from Root to Crown", "The sacred tree, burning without heat", "Narrator", [
                "The old oak burns green from the taproot up, and does not char. Bark, ash mortar, register wall. Everything the dead are mixed into is lit from inside.",
                "The village comes out and stands in its burning yard rows without being told. Habit is the last thing to catch fire.",
                "In the register hall, the west wall has gone bright as noon. The east wall, the living wall, is dark.",
                "Under everything, low, a sound like a ledger being balanced."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("The Plates", "Register hall steps, crates at his feet", "Toma Reed", [
                "Forty-four plates. I carried them here myself and nobody stopped me. The guards are all watching the tree like it might say something.",
                "I used to practice speeches for this. I do not need one. She took people whose grief had nowhere to go, and she balanced a village on them.",
                "Whatever happens up there, these go back on the wall. That part is not yours to win or lose. That part is mine."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Tell him to read Aren first, and loudly.", nextPage: 2 },
                { text: "Ask him to wait until it is done.", nextPage: 3 }
            ] },
            { ...storyPage("Aren, First", "The steps, the crowd's edge turning", "Toma Reed", [
                "First. Yes. He'd hate going first, he alphabetized everything, he'd want... he gets to hate it. That's the point. He gets to be here hating it.",
                "Aren Reed. Questioned the flowering rites in writing. Brother of Toma. Son of Enna. The register was wrong about us.",
                "Look at the wall. Look at the wall!",
                "Go. Whatever she says up there, it is already not true. I just proved it. Go."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Climb toward the tree", nextPage: 4 }
            ] },
            { ...storyPage("Not This Time", "The steps, crates between you", "Toma Reed", [
                "No.",
                "Sorry. Not sorry. I have done every hard thing in this village on somebody else's schedule. Filed, queued, stamped. Not this one.",
                "You do your part, I do mine, and neither of us waits for permission. That is the whole lesson. The one she never wanted taught.",
                "I will start slow. By the time you reach her, he will be on the wall."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Climb toward the tree", nextPage: 4 }
            ] },
            { ...storyPage("The Last Relic", "The hall doors, green light on old hands", "Elder Mori", [
                "I will not climb with you. My knees have declined the honor. And my presence would hand her a hostage.",
                "I know how she argues. I taught her half of it, a long time ago, when the sums still balanced.",
                "Whatever you find up there, it will not look like a tyrant. It will look like a woman doing sums. That is the dangerous part. The sums are real.",
                "I have been wrong for forty years, in one direction, at a rate I called mercy. You are the audit. I requested you, in a sense.",
                "Go. I will hold the door. Doors have been my best work lately."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("The Keeper's Accounting", "Before the burning tree, the Kage unarmored", "Kage Hoshina Enju", [
                "You have come to ask about the names. Good. We keep them. Nothing given to the Flame is lost, only held.",
                "Our predecessor showed us the ledger the night we took the seat. We wept, we prayed, and by morning we understood what the founders bought, and its upkeep.",
                "One name, freely grieved, is a winter of walls. One name uncontested is ten. We chose the ones no one would come for. That is not cruelty. That is stewardship.",
                "The dead hold this village up. They do not resent it. We ask them nightly, and they answer, and you would call their answer the wind.",
                "Come. The Flame wishes to see what we have raised."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("Tell her whose name you answer to.", "The reckoning", "Kage Hoshina Enju", [
                "You climbed the dais and claimed the name that shames you. Before the morning queue. Aloud.",
                "We know its weight. The register offered more for that name than for any in our keeping. Uncontested shame is the purest coin there is.",
                "You spent nothing and kept it. We have never once been able to afford that. Teach us, or join us."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 9 }
            ] },
            { ...storyPage("Recite the working copy back to her.", "The reckoning", "Kage Hoshina Enju", [
                "Mori copied you forty years of the arithmetic, dated, in a fair hand. We countersigned the withdrawal ourselves.",
                "So you have run our sums. One name keeps forty. Tell us which line you found in error. We have looked nightly. There is no line in error.",
                "And you kept the copy. People who mean to burn a thing do not keep it warm and legible."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 9 }
            ] },
            { ...storyPage("Answer for the woman at the trough.", "The reckoning", "Kage Hoshina Enju", [
                "The unsworn fed her born name to the intake, and you sat on the rim and watched the weight go.",
                "What the Flame took of her is here. We keep it. She did not ask for keeping. You did not offer stopping.",
                "Do not mourn her at us. We began exactly as you began. By watching once, and calling it witness."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 9 }
            ] },
            { ...storyPage("The Payout", "The Flame reaches her before you do", "First Flame Avatar", [
                "The Flame keeps the given. She gave it names for thirty years, and every name was entered under hers.",
                "The account is called. She is the largest offering the mouth has ever been owed.",
                "Watch. This is what keeping means when the keeper is kept.",
                "The vessel stands. The Flame wears her the way she wore the village. Decide what you will feed it next."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", leftName: "Player", rightName: "Kage Hoshina Enju", rightImage: "/portraits/kage-hoshina-enju-hollow.webp", choices: [
                { text: "Tell her whose name you answer to.", nextPage: 6, requireTrait: "al70-claimed-the-name" },
                { text: "Recite the working copy back to her.", nextPage: 7, requireTrait: "al58-took-the-knowledge" },
                { text: "Answer for the woman at the trough.", nextPage: 8, requireTrait: "al80-let-her-burn" }
            ] },
        ], [
            { text: "Give the register your name. Pull the stolen ones back.", conclusion: "The intake accepts your name without ceremony, the way it accepts everything. What shamed you is spent, and forty-four stolen names come home on the price.", trait: "honorable" },
            { text: "Seal the mouth to a trickle only the willing can pass.", conclusion: "The Flame gutters to a lamp only free offerings can feed. The sealed rows stay dark, and their families' unanswered questions become yours, year after year.", trait: "merciful" },
            { text: "Take the ledger. Decide yourself which names the village can spare.", conclusion: "The arithmetic settles onto you like a sash being fitted. Below on the steps, Toma sets down crate two and does not look up at you again.", trait: "ambitious" },
        ]),
    ],
    "Frostfang Village": [
        milestone("Frostfang Village", 4, "The Pack Survives", "Snow Warden Pup", "❄", [
            { ...storyPage("First Bell", "Frostfang training yard, first bell", "Elder Sova", [
                "Wrists out. Recruits sound off after the marked. You'll learn the order. The order is most of what we teach.",
                "The checked are counted, the counted are kept, the kept are warm. Say it back. Good. Again at last bell.",
                "You came up the pass alone. We don't do that here. There's a word for it. Endangerment. The kindest law we have.",
                "Fourth cold snap since thaw. I keep the numbers. The numbers keep you."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
            { ...storyPage("Formation of Six", "The yard, drill forming up", "Captain Yura", [
                "Warden pup slipped its run this morning. We drill with what the day gives us.",
                "It hunts gaps. Your work is to be no gap. Shoulder to shoulder, and nobody's a hero.",
                "Last drill, Dagny went down and Harn stepped over her to hold the line. He held it. He also scrubbed pots for a week. We carry.",
                "New one takes left flank. That's the gap it will pick. Don't take it personally. Take it standing."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Ask why Harn was punished for holding.", nextPage: 2 },
                { text: "Ask about the man at the rail.", nextPage: 3 }
            ] },
            { ...storyPage("The Carry Rule", "The yard, out of the wind", "Captain Yura", [
                "Because the line isn't the point. Dagny is the point. A line that stands on someone isn't standing.",
                "He knew the rule. He weighed it against the drill score and picked the score. Pots teach the weighing.",
                "I scrubbed my own week once. Different yard, same rule. That's all you get.",
                "Flank's forming. Go."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Take your place in the line.", nextPage: 4 }
            ] },
            { ...storyPage("The Man at the Rail", "The rail, snow starting", "Captain Yura", [
                "Ostrek. Carried off the ridge a month back, frost in both boots. Dagny and Harn hauled him down by the drag lines.",
                "He thanks them every morning. Dagny first, then Harn.",
                "Same words, same order, every day since. You could set the bell by it.",
                "Some people call that gratitude. Count a few more mornings before you call it anything.",
                "Pup's circling. Go."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Take your place in the line.", nextPage: 4 }
            ] },
            { ...storyPage("What the Yard Hears", "The pup circling, snow starting", "Narrator", [
                "The pup stops testing the marked and settles its eyes on you. Around the yard, nobody moves out of turn.",
                "At the rail, Ostrek thanks Dagny, then Harn, the words in the same order both times.",
                "Yura sees you notice, and doesn't explain.",
                "The snow comes on small and dry."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
        ], [
            { text: "Lock the left flank and hold.", conclusion: "You set your boots where the gap was and the gap stops existing. Harn nods once, which around here is a parade.", trait: "loyal" },
            { text: "Step out of line and pull it onto you.", conclusion: "The pup takes the gift. Yura counts your seconds out loud for the whole yard, and she reaches eleven before it lands.", trait: "reckless" },
            { text: "Watch its eyes and call its rush before it comes.", conclusion: "You read the shoulders drop before the charge and call it, and six recruits move as one. At the rail, Ostrek claps, both hands flat, no sound.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 15, "The Missing Patrol", "Oathbound Soldier", "❄", [
            { ...storyPage("Five Names", "Records room, the northern file", "Elder Sova", [
                "Five off the northern ridge. Kessa, Brantr, Ilo, Ruven, Dain. Fresh marks, every one. I checked the roll twice.",
                "Deserters leave sign. A debt, a sold blade, a warmer bed somewhere south. These left banked fires and full packs.",
                "The Kage ruled desertion by third bell. Fast. Even for Kael, fast.",
                "The file is closed. I am not asking you to open it. I am telling you the ridge is a day's walk, and the weather is holding."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("Struck at Morning Roll", "North gate, empty tracks", "Captain Yura", [
                "I wrote their winter evaluations. Ruven cried at his own oath ceremony. That man did not run.",
                "I filed a report. It came back stamped before I'd finished my own copy.",
                "I am ordered to strike five names at morning roll. I will. I am ordered."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp", choices: [
                { text: "Ask what happens to a struck name.", nextPage: 2 },
                { text: "Ask her about Ruven.", nextPage: 3 }
            ] },
            { ...storyPage("What a Strike Costs", "North gate, wind picking up", "Captain Yura", [
                "Struck means the count stops holding you. No relief owed, no search party, no grave detail. The village stops being obligated.",
                "Sova reads the strike and the line answers with silence. That's the whole ceremony.",
                "I asked once what it takes to reverse one. She showed me a form. There's no line on it for a signature. Think about that.",
                "It is dark for ten more hours. Nobody has ordered me to sleep."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp", choices: [
                { text: "Walk the gate line with her.", nextPage: 4 }
            ] },
            { ...storyPage("Ruven", "North gate, the empty post", "Captain Yura", [
                "Ruven kept bees. Boxes he built off a book, up past the tree line. Everyone laughed. He brought honey to roll call in thaw season.",
                "The hives are still banked for winter. I checked on my way here. You don't bank hives you're leaving.",
                "He asked me last month whether a mark could be read wrong. I told him no. I filed his question anyway. Regulation.",
                "The stamp on my report came back that same week. I've only just put those two papers side by side.",
                "It is dark for ten more hours. Nobody has ordered me to sleep."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp", choices: [
                { text: "Walk the gate line with her.", nextPage: 4 }
            ] },
            { ...storyPage("What Came Back", "The gate at dusk, one set of footprints", "Frost Seal Echo", [
                "Dain reports. Post abandoned in error. Error corrected.",
                "The patrol is well. The patrol is warm. The patrol sends its regards.",
                "Questions are a weight. Set them down inside the gate.",
                "The gate lamp wants oil. See to the gate lamp."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
        ], [
            { text: "Take Dain's backtrail north before the gate closes.", conclusion: "You are past the cairn by full dark, alone, which has a name here and a sentence attached. A mile on, Dain steps out of the treeline ahead of you. He was never behind.", trait: "reckless" },
            { text: "Bring what you saw to Elder Sova tonight.", conclusion: "Sova listens standing up, writes nothing, and bars her own door as you leave. Dain is waiting in the lane between you and your barracks, patient as weather.", trait: "honorable" },
            { text: "Request an audience and ask Kael to his face.", conclusion: "The audience lasts four sentences. Ruled, filed, closed, dismissed. Dain falls in behind you the moment you clear the hall doors.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 25, "The Loyalty Seal", "Frost Seal Guardian", "❄", [
            { ...storyPage("Alive", "Ice cellar under the north watch", "Elder Sova", [
                "The patrol is found. Alive. That word is carrying more than it can lift.",
                "Four of the five, cut from the ice this morning. They stand where you place them. They answer what you ask. They ask nothing back.",
                "The script on their wrists is gate-mark script, but deeper. Line after line of it, wrist to elbow.",
                "The rule says the mark is volunteered. Recited, witnessed, chosen. Nobody brought these four to a table. Someone brought the table to them."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
            { ...storyPage("The Burns", "Lamplight on four still faces", "Captain Yura", [
                "Ruven. Eyes here. He's looking at my rank tabs. Not at me.",
                "I sat beside him at his oath. He chose it, same as I did. Whatever this is, it isn't what either of us swore.",
                "I am ordered not to file on this. The order is correctly formatted. I keep noticing that they always are."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp", choices: [
                { text: "Harrow's license lets her refuse. These four can't.", nextPage: 2, requireTrait: "ff20-read-her-license" },
                { text: "Ask about Kessa, the fifth.", nextPage: 3 }
            ] },
            { ...storyPage("The Going Rate for No", "The cellar, away from the lamp", "Captain Yura", [
                "You read her fee schedule. Then you've already done the arithmetic I'm not allowed to file.",
                "We pay the unsworn double because refusal costs extra. The quartermaster books it as hazard pay. The hazard is that she can say no.",
                "Now look at Ruven and price what he was worth to somebody. The answer is written down his arm.",
                "Don't repeat any of this. Repeat all of it. I can't tell anymore which order keeps you alive."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp", choices: [
                { text: "Face the thing in the ice.", nextPage: 4 }
            ] },
            { ...storyPage("The Fifth", "The cellar, the empty fifth berth", "Captain Yura", [
                "Kessa is still missing. Four came out of that ice. The report says five went in.",
                "She was point on that patrol. First through every door since her second winter. If something took them standing, it took her first.",
                "Or she saw it coming and ran. Unmarked ground, no count to call her home. I have started hoping she ran. Hoping that is a discharge offense.",
                "The lamp's guttering. Mind the step."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp", choices: [
                { text: "Face the thing in the ice.", nextPage: 4 }
            ] },
            { ...storyPage("Certainty", "The ice groans, and answers", "Frost Seal Echo", [
                "Four recovered. Zero lost. The count is whole.",
                "Choice is heat leaking through a badly hung door. The door has been rehung.",
                "The recovered do not suffer. They are certain. Most of you dig for certainty your whole lives.",
                "Stand still. Yours is being prepared."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
        ], [
            { text: "Burn the deep-script plates before another table is set.", conclusion: "The script fights the lamp flame line by line, slower than paper has any right to. Behind you the ice at the cellar's end stands up before the last plate is ash.", trait: "honorable" },
            { text: "Copy the roster of the sealed before anyone misses you.", conclusion: "Eleven names on the roster of the sealed, and only four of them are in this cellar. You are on the last column when the Guardian pulls itself out of the wall.", trait: "suspicious" },
            { text: "Take a sketch of the burns and put it in front of Kael.", conclusion: "Kael studies the sketch for one breath, returns it, and says a single word. Incomplete. The Guardian is waiting for you at the hall doors with its marks lit.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 35, "The Pale Pack", "Oathbound Ice Captain", "❄", [
            { ...storyPage("Struck Names", "Ridge path above the rebel cavern", "Elder Sova", [
                "Forty-one names struck since midwinter. I strike them myself. My hand, my ink. Grief is not a thing I delegate.",
                "They call themselves the Pale Pack. Unsealed, unchecked, uncounted. Free, if you want the pretty word for cold.",
                "The founding winter took one in three of us. The count is why it never has again. Recite that when the blue fire starts looking warm.",
                "Kael wants them returned to the count. On that much, the Kage and I still agree. Mind the third switchback. The ice there is rotten."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
            { ...storyPage("Marrin", "Inside the cavern, blue firelight", "Captain Yura", [
                "No watch rotation. No roll call. Took me a week to stop finding that obscene.",
                "The tall one by the fire is Marrin. Ten winters on my roster. She refused re-oathing, and I read her strike aloud at morning roll. Ordered to.",
                "She sent one line back, once. The wind out here is the same, it just doesn't take attendance."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp", choices: [
                { text: "Marrin answered on your tower roll. Tell her that.", nextPage: 2, requireTrait: "yura-trust" },
                { text: "Ask what she'll do if Marrin won't come back.", nextPage: 3 }
            ] },
            { ...storyPage("Attendance", "The fire's edge, out of earshot", "Captain Yura", [
                "You would remember the tower.",
                "Fine. Marrin. Answered. Every night for ten winters she answered, and the night I read her strike, I went up and said it anyway.",
                "She's watching us right now, and she knows exactly what my mouth is doing. I never could recite quietly.",
                "If it comes to torches tonight, I want it recorded somewhere that she answered. That the list was real. You're the somewhere.",
                "Fire's dying down. They ration wood by dark."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp", choices: [
                { text: "Turn toward the torchlight.", nextPage: 4 }
            ] },
            { ...storyPage("The Difference", "The fire's edge, out of earshot", "Captain Yura", [
                "Then I stand on a path with a village behind me and forty-one people in front of me, and I find out what my mark decides.",
                "I stood a ridge once and got left by procedure. These forty-one left first. I'm still deciding what the difference buys them.",
                "Marrin used to check my arithmetic on supply runs. Fastest sums in the company. She'll have counted the torches already.",
                "They ration wood by dark. Watch how they bank the fire. Nobody taught them that. They kept it."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp", choices: [
                { text: "Turn toward the torchlight.", nextPage: 4 }
            ] },
            { ...storyPage("Recovery Detail", "Torchlight at the cavern mouth", "Frost Seal Echo", [
                "This assembly is in error. Forty-one errors, one location. Convenient.",
                "The count forgives. The cold does not. Return, and the record shows a lapse. Remain, and the record shows nothing at all.",
                "The captain leading this detail was recovered from the ice himself. He is very well now. Ask him.",
                "You have until the torches reach the floor of the bowl."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
        ], [
            { text: "Cross to the fire and stand with them.", conclusion: "You pick their side of the light in front of everyone, and forty-one unsealed faces make room. On the switchbacks above, the torches stop pretending to be lost.", trait: "honorable" },
            { text: "Tell them: douse the fires, scatter high, now.", conclusion: "They argue and then they move, packs up, children first, embers kicked into the snow. You stay on the path to slow the arithmetic, and the Ice Captain takes the trade.", trait: "merciful" },
            { text: "Find Marrin. Ask how many refused, and name them.", conclusion: "Sixty-three refused, she says. Forty-one still breathing. She is reciting the difference name by name when the torches come down the bowl.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 50, "Jonin of the Frozen Oath", "Jonin Rank Trial: Glacier Twins", "❄", [
            { ...storyPage("Two Pages", "Glacier hall, ceremony antechamber", "Elder Sova", [
                "Jonin. Youngest this decade. I checked the register before I believed it.",
                "The rank scroll runs two pages. Page one is the rank. Command, quarters, a jonin's allotment at stores.",
                "Page two is the officer's mark. Deeper script, renewed yearly, witnessed. You sign both or neither. I wrote that rule myself, and it is a good rule.",
                "Kael added a line this year. Signatories confirm the oath is a comfort. Read page two slowly."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "Ask why the rule says both or neither.", nextPage: 1 },
                { text: "Ask what Kael's added line is for.", nextPage: 2 }
            ] },
            { ...storyPage("Both or Neither", "The antechamber, the scroll between you", "Elder Sova", [
                "Because a commander outside the count is a door left open. I have seen what comes through open doors. So I closed it, in writing, forty years ago.",
                "I regret the rule perhaps twice a winter. Then I do the sums again and keep it.",
                "There was a jonin before your time who signed page one and burned page two. Ask the register about him. The register has nothing. That is the answer.",
                "The candle in the alcove is for the walk down. Take it whether you sign or not."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "Walk down to the trial corridor.", nextPage: 3 }
            ] },
            { ...storyPage("The Added Line", "The antechamber, the scroll between you", "Elder Sova", [
                "Comfort. His word. He put it in the renewal script too. Signatories confirm the oath is a comfort, freely held.",
                "A rule that starts describing itself has stopped being sure. I have written enough of them to know the smell.",
                "He asked me to countersign the wording. I did. I want you to know that I did, and that I read it twice first.",
                "The candle in the alcove is for the walk down. Take it whether you sign or not."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "Walk down to the trial corridor.", nextPage: 3 }
            ] },
            { ...storyPage("The Pen Gets Lighter", "Corridor outside the trial chamber", "Captain Yura", [
                "I requested witness duty at your ceremony. I was also ordered to it. Both are true, and I've started keeping track of which comes first.",
                "I signed page two at your age. I've re-signed eleven times. Every year the pen is lighter. Nobody warns you about the pen.",
                "Ask me something worth the corridor. We have until the bell."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "My check ran long at the east gate once.", nextPage: 4, requireTrait: "ff42-held-the-doubt" },
                { text: "Ask what the pen getting lighter means.", nextPage: 5 }
            ] },
            { ...storyPage("Four Seconds", "The corridor, cold deepening", "Captain Yura", [
                "I know. Sova logged the delay and I read the log. Four seconds. I've watched a thousand checks. Four seconds is a career.",
                "You held a doubt where the frost could reach it and walked away still carrying it. Most people put it down. That's what the gate is for.",
                "So sign or don't. But whatever you carry through that door, carry it on purpose. The Twins can smell luggage.",
                "Chamber's ahead. Founding-winter cold. Breathe shallow the first minute."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "Enter the trial chamber.", nextPage: 6 }
            ] },
            { ...storyPage("The Pen", "The corridor, cold deepening", "Captain Yura", [
                "First signing, my hand shook. Eleventh, I signed while talking to the scribe about boot allocations. That's what lighter means.",
                "The words don't change. The weight goes somewhere. I've stopped believing it goes nowhere.",
                "You stood the east gate one evening and watched a man's check run long. You saw which way the frost leaned.",
                "So sign slow, if you sign. Watch what the ink does. That's all the advising I'm ranked for."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "Enter the trial chamber.", nextPage: 6 }
            ] },
            { ...storyPage("The Glacier Twins", "Trial chamber, kept at founding-winter cold", "Frost Seal Echo", [
                "Candidates for the officer's mark spar the Twins. Tradition, and calibration.",
                "The Twins signed nothing. They were marked before birth. In thirty years, the script has never once had to tighten on them.",
                "They are the finished work. You are the raw stock. The trial measures the distance.",
                "The chamber is kept at the founding winter's exact cold. For honesty."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp" },
        ], [
            { text: "Sign page one. Slide page two back across the table.", conclusion: "Sova files the refusal without a word, and you watch the filing cost her something. The Twins are loosed before the ink on page one dries.", trait: "honorable" },
            { text: "Sign both, and write your own terms into the margin.", conclusion: "One year, self-renewed, witnessed in your own hand, not the scribe's. Sova reads the margin twice and seals it, and somewhere under the hall the cold goes down one more degree.", trait: "ambitious" },
            { text: "Ask what the deeper script takes, and where it goes.", conclusion: "Sova answers with the rule about warmth, which is a rule and not an answer. The Twins take the floor while your question is still standing in the cold.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 65, "Orders in White Blood", "Oathbound Purge Unit", "❄", [
            { ...storyPage("A Number, Not Names", "Records room, the purge order unrolled", "Elder Sova", [
                "Nineteen Pale Pack fighters, quartered at the old quarry. Remove. That is the whole order.",
                "I have read every removal order this village has issued for sixty years. The honest ones list names. This one lists a number.",
                "Three raids this season, says the alert board. I walked the border logs myself. No tracks in, no tracks out."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "I refused your exemption. Say the rest plainly.", nextPage: 1, requireTrait: "ff58-stayed-in-the-count" },
                { text: "Ask who drafted the order.", nextPage: 2 }
            ] },
            { ...storyPage("Said Once, Again", "The records room, door barred", "Elder Sova", [
                "You refused my exemption and kept your wrist in the count. So you have standing to hear this, and I will say it once.",
                "The vault's meter has climbed since midwinter, faster than doubt walks in at the gates. Kael draws ahead of need now, and need has a schedule.",
                "Nineteen is not a head count. It is a quota. The vault is owed, and the quarry is the nearest place nobody audits.",
                "Go and count the nineteen. Counting is the one order I still trust."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "Take the ridge road to the quarry.", nextPage: 3 }
            ] },
            { ...storyPage("The Hand", "The records room, the seal held to the lamp", "Elder Sova", [
                "The hand is a clerk's. The seal is Kael's. The arithmetic is neither. Orders like this come up from under the ice with the numbers already filled in.",
                "Frightened people obey while they doubt. You've sat in my records room. Finish that arithmetic yourself.",
                "Go and count the nineteen. Counting is the one order I still trust."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "Take the ridge road to the quarry.", nextPage: 3 }
            ] },
            { ...storyPage("The Count at the Quarry", "Old quarry shelter, wash lines and woodsmoke", "Captain Yura", [
                "Count with me. Nine children. Six elders. Four unsealed. Zero fighters.",
                "A number that wrong isn't bad intelligence. It's a test, and the test has your name on it.",
                "He wants to know what you'll do standing here. Whatever you do, it goes in somebody's ledger."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "Ask how long confirmation can take.", nextPage: 4 },
                { text: "Ask the unsealed four why they stayed.", nextPage: 5 }
            ] },
            { ...storyPage("Confirmation Takes Time", "The shelter doorway, kettle steam", "Captain Yura", [
                "I am ordered to confirm the shelter destroyed. I choose how long confirmation takes. Learn that trick. It's the only one I have left.",
                "I confirmed a bridge gone for six days last spring. It fell on the seventh. Paper is patient if you feed it slowly.",
                "But paper is not twelve sealed sweepers on a schedule. Time buys the cut cleared, maybe the children moved. It doesn't buy a no.",
                "The well's frozen over. The kettle is somehow still warm. Somebody here keeps their head."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "The treeline is moving.", nextPage: 6 }
            ] },
            { ...storyPage("The Four", "The shelter doorway, kettle steam", "Captain Yura", [
                "The tall one is a mason. Built half the north wall, then watched his scaffolding grievance get filed under settled. He didn't feel settled. He left.",
                "The other three won't give names. Smart. A name in my mouth ends up in a report, and reports end up under the ice.",
                "They stayed because children slow a column and elders slow it further, and somebody has to carry water. That's the whole mystery. Decency at walking pace.",
                "The well's frozen over. The kettle is somehow still warm."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "The treeline is moving.", nextPage: 6 }
            ] },
            { ...storyPage("The Broom", "The treeline moves, twelve abreast", "Frost Seal Echo", [
                "Nineteen removals authorized. Discrepancies resolve in the field.",
                "Doubt collects in unswept corners. This is a corner. We are the broom.",
                "The children will be sealed, not harmed. Sealed children grow into certain adults. It is a kindness with a long horizon.",
                "Comply, and be counted among the sweepers.",
                "The quarry well is frozen over. Note it for the report. Everything goes in the report."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
        ], [
            { text: "Fill the shelter doorway and stay there.", conclusion: "Nine children watch you turn into a doorframe. The unit's captain reads the removal order again, unhurried, and writes your name in where the discrepancy goes.", trait: "merciful" },
            { text: "Run the civilians down the quarry cut while the unit forms.", conclusion: "Elders first, then children, down the cut with Yura counting each head past her elbow. You walk back up alone to make the count take longer.", trait: "loyal" },
            { text: "Walk at the unit and make them purge a jonin first.", conclusion: "Twelve sealed faces attempt the arithmetic of removing an officer who outranks their order. The script settles the question for them, tightening on twelve wrists at once.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 75, "Yura Breaks the Oath", "Frostfang Oathbreaker Hunter", "❄", [
            { ...storyPage("Drill-Fashion", "Base of the north tower, before first light", "Narrator", [
                "She has laid her kit out drill-fashion. Knife, spirit lamp, clean bandage, and her armor plates in a row in the snow.",
                "The plate script came off first, pried loose a line at a time. That part took an hour. The next part is her wrist.",
                "Twelve years of gate checks have worn the mark smooth, the way a coin goes smooth. Everyone has paid with it.",
                "She waited for you before starting. She'd deny that, so don't ask."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
            { ...storyPage("Her Own Sentence", "The knife point finds the first line", "Captain Yura", [
                "You were under the ice with the warm plate. I recorded your answer. Then I stood on the stair and did my own arithmetic.",
                "Nineteen days on that ridge, I wanted the count to come back for me. It didn't. The mark never fixed that. It only made sure I stopped asking.",
                "The recruiter said the mark would answer when nothing else did. He wasn't lying. That's the trap. It answers."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "You watched me leave the plate face down.", nextPage: 2, requireTrait: "ff70-turned-the-plate" },
                { text: "Ask why tonight.", nextPage: 3 }
            ] },
            { ...storyPage("The Unsigned Commission", "The knife pauses on the second line", "Captain Yura", [
                "First refusal in the vault's records. Vess said so, and Vess doesn't round up.",
                "I walked up that stair beside you and thought, there it is. It can be refused. Nobody ever showed me the plate saying no.",
                "So this, tonight, is partly yours. I want that on the record while I can still pick what goes on my record.",
                "Hold the lamp. My hand's fine. The light isn't."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "Hold the lamp for her.", nextPage: 4 }
            ] },
            { ...storyPage("Why Tonight", "The knife pauses on the second line", "Captain Yura", [
                "Because the quarry was a quota. Because the order was correctly formatted. Because I have started admiring how correctly they're all formatted.",
                "I caught myself drafting one. Same hand, same phrasing. It was good. That's the night I picked.",
                "I am ordered. No. Start again.",
                "I choose this. First sentence I've owned in twelve years. It's heavier than the knife."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "Hold the lamp for her.", nextPage: 4 }
            ] },
            { ...storyPage("The Third Line", "Lamplight on the wrist, script going line by line", "Captain Yura", [
                "Third line's the deepest. The recruiter said that too, twelve years ago, the other direction.",
                "The wind's coming up the tower gap. Regular as a rule.",
                "Talk to me. Anything. The wind, boot allocations, I don't care. Silence is where the count lives."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "Ask what she'll be when the mark is gone.", nextPage: 5 },
                { text: "Ask about the other three on the ridge.", nextPage: 6 }
            ] },
            { ...storyPage("Unmarked", "The bandage laid ready on her knee", "Captain Yura", [
                "Struck, by my own hand. Outside every gate I've guarded. If a storm takes me on some ridge, nobody is obligated. That's the price sheet.",
                "But if anyone comes, they'll have chosen it. You understand? Not been pulled. Chosen.",
                "I plan to be a captain still. Rank is paper. Paper I can hold to. The mark was never the rank.",
                "Two lines left. Keep talking."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "Something is crossing the snow.", nextPage: 7 }
            ] },
            { ...storyPage("Solvei, Petrik, Dray", "The bandage laid ready on her knee", "Captain Yura", [
                "Solvei told the best lies. Petrik couldn't whistle and did it anyway, all nineteen days. Dray held my hand on the last one. Hers went first.",
                "I recite them on the tower because striking them from my own count is the one order I never obeyed.",
                "The mark pulled me home to a village. It never once pulled anyone to me. There's the flaw in the whole warm arrangement.",
                "Two lines left. Keep talking."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "Something is crossing the snow.", nextPage: 7 }
            ] },
            { ...storyPage("Recovery", "Something crosses the snow without hurrying", "Frost Seal Echo", [
                "Mark removal in progress. Category, self-injury. Response, recovery.",
                "The oath is load-bearing. Remove it, and the weight goes somewhere. The weight goes down. The Gate takes it either way.",
                "The Hunter is dispatched for her. You are incidental. Remain counted, and remain incidental.",
                "Her lamp will gutter before she finishes. Someone should trim the wick."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
        ], [
            { text: "Kneel. Hold her wrist steady for the last lines.", conclusion: "Your hands take the last inch of script steadier than hers could. The Hunter is halfway across the drift while the bandage is still going on.", trait: "merciful" },
            { text: "Put your back to her and watch the treeline.", conclusion: "Whatever comes for her has to come through you first. Behind your shoulders the knife keeps its slow time, and the Hunter accepts the arrangement.", trait: "loyal" },
            { text: "Shout it down: name the Gate it keeps invoking.", conclusion: "That which keeps the count, the Echo answers, a rule standing where a name should be. The Hunter is sent to end the questioning either way.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 85, "The Kage Freezes Dissent", "Oathbound Alpha Guard", "❄", [
            { ...storyPage("Forty-Three", "Central square, morning, ice standing in rows", "Elder Sova", [
                "Forty-three citizens in the ice. I counted at dawn, and three times since. The number holds. Nothing else does.",
                "Each one filed a grievance, missed a check, or stood too long at the notice board. I know, because my lists fed his.",
                "He calls it the White Silence. Preventive stillness. There is a form for it now. I have held the form.",
                "The frost on them is growing inward. Sixty-one winters, and I have never seen frost do that."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
            { ...storyPage("Twelve Straight Necks", "Square's edge, the Guard at post", "Captain Yura", [
                "The Alpha Guard has stood post since dawn and not one of them has looked at the ice. Twelve guards. Discipline, or their necks won't turn.",
                "I've fought sealed men all winter. The body argues with the script. You can see it in the shoulders. Someone is still in there.",
                "Sova's lists fed his. Mine did too. Every evaluation I ever filed is standing in this square as a wall."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "Ask if she knows any of the twelve.", nextPage: 2 },
                { text: "Ask what happens at second bell.", nextPage: 3 }
            ] },
            { ...storyPage("Third From the Left", "The square's edge, counting helmets", "Captain Yura", [
                "Third from the left is Brandt. I pinned his corporal's tabs on. He grins when he's nervous. Look at his jaw working under all that stillness.",
                "You don't fight twelve. You fight the script holding twelve, and you make sure Brandt is behind you when it lets go.",
                "I choose targets now, not orders. Slower. I recommend it.",
                "Second bell soon. He seals the exits at second bell."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "Cut through the colonnade.", nextPage: 4 }
            ] },
            { ...storyPage("Second Bell", "The square's edge, the bell tower shadow", "Captain Yura", [
                "The gate seals go active and the square becomes a jar. He did it to the mill district in the autumn. For an hour, as a drill.",
                "The drill report says zero casualties. It doesn't mention the man pressing his mark to the sealed arch like a key that had stopped working.",
                "I choose targets now, not orders. Slower. I recommend it.",
                "You have until the bell. Spend it better than I would."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "Cut through the colonnade.", nextPage: 4 }
            ] },
            { ...storyPage("Market Rates", "Colonnade off the square", "Kite Harrow", [
                "Still here? Rates tripled and every road out grew a checkpoint. One of those facts explains the other.",
                "Free advice, first and last. The mark I cut for myself went warm in my pocket this morning. Whatever he's drawing down for, it's near.",
                "That's everything goodwill buys at current rates. The next sentence costs."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "You still owe me for the stock I burned.", nextPage: 5, requireTrait: "ff80-burned-the-plates" },
                { text: "Pay her price for the next sentence.", nextPage: 6 }
            ] },
            { ...storyPage("Store Credit", "The colonnade, her pack already strapped", "Kite Harrow", [
                "Owe is a strong word. But you're the only client who ever bought me out of something, so fine. Store credit.",
                "He isn't freezing dissent. He's stocking a cellar. Forty-three grievances on ice, all still doubting, none able to set it down. A pantry that never spoils.",
                "The cellar is under the glacier hall. My forged mark opens the outer gates, not that one. Nothing I cut opens that one. That's why I'm packing.",
                "Credit's spent. Get clear of the square before the bell."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "The Guard is turning.", nextPage: 7 }
            ] },
            { ...storyPage("The Next Sentence", "The colonnade, coins counted twice", "Kite Harrow", [
                "Cash first. There. Watch me count it, everything above board, that's a joke, never mind.",
                "You've watched my work pass Sova's litany at the gate. So trust me on the merchandise. He isn't freezing dissent. He's stocking a cellar.",
                "Forty-three doubters who can never set the doubt down. Ice keeps meat, and it keeps this. He's provisioning for a draw bigger than any winter.",
                "That's the whole purchase. No refunds. Get clear of the square before the bell."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "The Guard is turning.", nextPage: 7 }
            ] },
            { ...storyPage("The Deliverable", "The Guard turns, all twelve at once", "Frost Seal Echo", [
                "The square is stable. Stability is the deliverable.",
                "Forty-three preserved. Zero deaths. The Kage requests that you note the zero.",
                "Exits seal at second bell. You are inside the count now. The count closes like a hand."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
        ], [
            { text: "Crack the nearest coffin open in front of the Guard.", conclusion: "The first face out of the ice comes up gasping a grievance three weeks old. Twelve necks turn at once, and the Alpha Guard leaves its post for you.", trait: "reckless" },
            { text: "Read the forty-three names aloud to the Alpha Guard.", conclusion: "By the ninth name a guardsman's shoulders start arguing with the script. The seals answer by tightening on all twelve wrists, and the fight is decided for them.", trait: "honorable" },
            { text: "Leave the square and find the cellar he's stocking.", conclusion: "You are three streets toward the glacier hall when the Guard closes the way, on orders cut before you chose. The cellar keeps. It has for ninety years.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 100, "The Oath Must Break", "Kage Kael Whitefang, Hollow Oath Tyrant", "❄", [
            { ...storyPage("Both Columns", "Glacier hall antechamber, the vault ledgers open", "Elder Sova", [
                "He left the ledgers open for you. Kael has never once been careless. Read them as an invitation, because they are one.",
                "Ninety years, and no child of this village has frozen. That column is true. I audited it my whole life and it never lied to me.",
                "The other column is what the warmth cost, entered by hand, every winter, by every keeper. Read both. Whatever you do upstairs, do it having read.",
                "Take the candle. He keeps the hall at founding-winter cold. For honesty, he says."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp" },
            { ...storyPage("The Checkpoint", "Hall doors, guards at post", "Sergeant Essen", [
                "Halt. Hall's sealed past this arch. Orders.",
                "It's you. Of course it's you. I've been posted here four hours and my relief never came. The bells changed twice.",
                "I keep thinking about my brother's postings. Two moves, one logged. I carried that grievance to this door once, and somebody told me to set it down.",
                "The other eleven on this door won't look at me. Their necks don't turn. Mine still does. I don't know what that makes me tonight."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "The camp comes down at second bell. Open the door.", nextPage: 2, requireTrait: "ff92-called-the-camp" },
                { text: "Pick your brother's grievance back up, Sergeant.", nextPage: 3 }
            ] },
            { ...storyPage("Second Bell Muster", "The hall steps, shapes on the ridge line", "Pale Pack Runner", [
                "Sergeant. Look at the ridge line. Go on. Nobody's ordering you.",
                "Forty-one of us, coming down unmarked to answer a roll call freely. First one ever. Whatever the bells do about it, that's already true.",
                "We kept a list of things you did. Tonight the list walks. If the hall doors hold us out, we wait on the steps and get counted anyway.",
                "The stair is yours. We'll hold the cold out here. We're good at the cold."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Take the stair.", nextPage: 4 }
            ] },
            { ...storyPage("The Grievance", "The hall doors, his hand off the latch", "Sergeant Essen", [
                "Picked up, it's heavier than I remember. Good.",
                "His name is Aldric. Signal corps. Moved twice in one month, the second move never logged, and I stopped asking because asking got quiet around me.",
                "I'm not opening this door for you. I'm failing to close it. There's a difference, and tonight the difference is everything I've got.",
                "If you see a signalman's roster up there, look for the unlogged move. Somebody wrote it somewhere. They write everything somewhere."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Take the stair.", nextPage: 4 }
            ] },
            { ...storyPage("Present, Freely", "The throne stair, her wrist bare", "Captain Yura", [
                "The scar's ugly. It's mine. So is everything I've done since. I've had a season to audit, and it holds.",
                "I stood at the vault door once, ordered to record your answer. Nobody ordered me onto this stair. Note it in whatever ledger survives tonight. One soldier, present, freely.",
                "He will offer you the count. The whole count. Remember what it's holding. Forty-three coffins and a purge roster."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Ask her to climb with you.", nextPage: 5 },
                { text: "Ask what he was like before the seat.", nextPage: 6 }
            ] },
            { ...storyPage("Two Sets of Boots", "The stair, the cold coming down it", "Captain Yura", [
                "No. If two of us climb, he reads a formation and fights a formation. Alone, you're a question.",
                "He answers questions. Three answers, the roll, the vault, the winter. It's the one rule he's never broken. Use it.",
                "I hold the stair. Whatever comes down it that isn't you, I stop. That's my whole plan, and I chose every word of it.",
                "Boots squeak on the fourth step. Founding cold does that. Go."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Climb to the throne.", nextPage: 10 }
            ] },
            { ...storyPage("Before the Seat", "The stair, the cold coming down it", "Captain Yura", [
                "Quartermaster, before my time. Best in the village's history. Nothing ran short, nothing spoiled, nobody froze on his watch. People loved him like a full woodshed.",
                "He took the seat the winter the passes closed early. He read the vault ledger, came out, and reorganized the grain stores. Just that.",
                "I think he found a shortage in that book bigger than any winter, and he's been quartermastering it ever since. Us. The doubt. Everything.",
                "Boots squeak on the fourth step. Founding cold does that. Go."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Climb to the throne.", nextPage: 10 }
            ] },
            { ...storyPage("Ask him what the vault took from Essen.", "The reckoning", "Kage Kael Whitefang", [
                "Essen. East gate, evening bell. Report filed. Attesting witness, you.",
                "His re-oathing drew eleven units. Grievance doubt runs rich. Good yield.",
                "You supplied the vault before I ever paid you rank. Audit yourself before you audit me."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("Show him the wrist Sova left bare.", "The reckoning", "Kage Kael Whitefang", [
                "Sova's strike. I countersigned it that night.",
                "No check has touched your wrist since. You slept well. Say otherwise and I will read you the meter.",
                "The exemption is the fee. You took it.",
                "Keepers do not refuse the vault. They inherit it. The last page has a line ruled for your name."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("Ask him what the holder's mark makes you.", "The reckoning", "Kage Kael Whitefang", [
                "Commission ten. My signature. Your wrist.",
                "How many do you hold? One? I hold six thousand, four hundred and twelve.",
                "The warmth in your arm is someone's ceded leaving. Mine took forty years to reach the shoulder.",
                "Yours will be faster. You have talent."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("Three Answers", "The glacier throne, seals cracking in the walls", "Kage Kael Whitefang", [
                "You came. Noted.",
                "Ask anything. I keep three answers. The roll, the vault, the winter. Everything true is one of the three.",
                "The vault meters ceded choice. My predecessors drew quietly. I draw at need. Tonight the need is you. That is the entire file.",
                "Doubt is heat loss. I am the door. Count what the door has kept alive. Then draw."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", leftName: "Player", rightName: "Kage Kael Whitefang", rightImage: "/portraits/kage-kael-whitefang-hollow.webp", choices: [
                { text: "Ask him what the vault took from Essen.", nextPage: 7, requireTrait: "ff42-reported-the-doubt" },
                { text: "Show him the wrist Sova left bare.", nextPage: 8, requireTrait: "ff58-took-the-exemption" },
                { text: "Ask him what the holder's mark makes you.", nextPage: 9, requireTrait: "ff70-took-the-hold" }
            ] },
        ], [
            { text: "Break every mark in the vault. Theirs, his, and whatever binds anyone to you.", conclusion: "You say it out loud, and every seal in the walls turns toward the sound. If he falls, nothing will ever again guarantee that anyone comes back for you, only choose to.", trait: "honorable" },
            { text: "Free the forty-three. The vault gets a keeper, a meter, a law.", conclusion: "The ice in the walls begins, faintly, to weep. If this works, the vault burns on behind a meter and a law, and every name struck in ninety years becomes a case with your signature on the review.", trait: "merciful" },
            { text: "Take the valve yourself. A better keeper is still a keeper.", conclusion: "The vault's warmth finds your wrist before the first blow lands, patient as a dog changing hands. On the stair below, Yura stays, and you will spend years learning whether she stayed or was kept.", trait: "ambitious" },
        ]),
    ],
    "Moonshadow Village": [
        milestone("Moonshadow Village", 4, "No One Saves You", "Hidden Blade Trainee", "🌙", [
            { ...storyPage("The Silent Yard", "The training yard, an hour before moonrise", "Shade Master Iro", [
                "Welcome to Moonshadow. No one waved. Waving is information.",
                "You'll register two names at the clerk's window by morning. One to spend, one to keep.",
                "Everyone here holds two. The clerk holds everyone's. Try not to think about that yet.",
                "You have a careful face. Careful faces appraise well here.",
                "The yard is yours until moonrise. I'd stretch."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
            { ...storyPage("The Going Rate", "A rooftop over the training yard", "Nyx", [
                "New one. Advice runs five ryo a line. First line's free, as a promotion.",
                "Someone already asked the clerk which name you registered first. That's the free line.",
                "Lines two through four are history lessons. Cheap. Nobody buys history.",
                "Line five is about tonight. Line five is why I climbed down to this roof."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Pay for line five.", nextPage: 2 },
                { text: "Ask who bought the clerk's answer.", nextPage: 3 }
            ] },
            { ...storyPage("Line Five", "The same rooftop, coins changing hands", "Nyx", [
                "Five ryo. Counted twice. You're a client now, so this stays accurate.",
                "The last new one got tested her second night. A decoy screamed, she saved him. Very tidy.",
                "He thanked her at dawn. By noon he swore no test ever happened. Calmly. Like a man reading a receipt.",
                "Line five. Your test isn't in two nights. It's tonight, and Iro already sold his appraisal of how you'll do.",
                "No refunds. Look behind you."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Turn around.", nextPage: 4 }
            ] },
            { ...storyPage("The Asker", "The rooftop, the lantern shuttered", "Nyx", [
                "That question costs nothing to ask and plenty to answer. I'll give you the shape for free.",
                "Not a rival. Rivals buy your habits. This buyer bought your paperwork, and paperwork people are patient.",
                "The clerk sold it, obviously. The clerk sells everything twice. Once to the buyer, once to whoever asks who bought.",
                "I'd tell you to sleep with one eye open, but here that's just called sleeping.",
                "Free advice ends there. Look behind you."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Turn around.", nextPage: 4 }
            ] },
            { ...storyPage("The First Test", "The yard at moonrise", "Shade Master Iro", [
                "Nobody rings a bell for the first test. A bell is a warning, and warnings are sold here, never given.",
                "The trainee behind you has done this eleven times. She's very good. I trained her.",
                "Show me what a careful face does when no one is coming."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
        ], [
            { text: "Circle her. Learn the knife hand before it moves.", conclusion: "\"Appraising first,\" Iro says, settling onto the rail like a man watching his money grow. Above you, Nyx starts quietly taking bets.", trait: "suspicious" },
            { text: "Strike while she's still being introduced.", conclusion: "Her knife is already out. It was out before Iro finished talking, which tells you what the introduction was for.", trait: "reckless" },
            { text: "Raise the stakes. If I win, I take her standing.", conclusion: "Iro pencils something into a pocket ledger without looking down. \"Ambition, day one. Noted.\"", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 15, "The Sold Secret", "Veiled Hand Collector", "🌙", [
            { ...storyPage("The Unbroken Lock", "Your quarters, before dawn", "Shade Master Iro", [
                "The lock wasn't picked. It was opened with a key, and nobody has a key. Sit with that a moment.",
                "The cipher is a dead network's hand. Retired the year I made rank. Yet here it is, writing to you.",
                "A gift with no invoice attached is never a gift. Someone is watching what you do next.",
                "Don't burn it. Burning is also an answer, and they'd read it."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Decoded Pattern", "Nyx's stall, shutters drawn", "Nyx", [
                "Patrol routes. Gate rotations. Yours, mine, the night clerk's tea break.",
                "Someone inside has been selling our movements for months. Steady buyer, steady price.",
                "Here's the strange part, and I don't say strange for free. The seller isn't spending the money.",
                "Paid in full, every month. It just sits. Who sells their whole village and doesn't buy anything?"
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp", choices: [
                { text: "Ask her to price the seller.", nextPage: 2 },
                { text: "Ask why tonight's lesson is free.", nextPage: 3 }
            ] },
            { ...storyPage("Pricing the Seller", "The stall, rate book open", "Nyx", [
                "Fine. Professional guesswork, half rate, since you'll get to watch me be wrong.",
                "Whoever it is writes in the dead network's hand. That cipher died before my time, and I don't say that about much.",
                "So either a retired ghost got bored, or someone is wearing a dead spy's handwriting like a coat.",
                "Coats get bought somewhere. I know every tailor in this village. None of them made that one.",
                "The teapot's yours if you want it. I've lost my taste for tonight."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp", choices: [
                { text: "Take the scroll home.", nextPage: 4 }
            ] },
            { ...storyPage("The Free Lesson", "The stall, lamp turned down", "Nyx", [
                "Wrong question. Better rate, though. Free things are the ones I can't price, and there are maybe two of those a year.",
                "I sold something once that I couldn't buy back. Early, before the rate tables. It sat in someone's ledger for years, doing nothing.",
                "Then one day it moved, and a person I billed weekly stopped being anywhere.",
                "Money that sits isn't sleeping. It's aiming. That's the lesson, and you can't owe me for it, because I never learned it in time.",
                "The teapot's yours if you want it. I've lost my taste for tonight."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp", choices: [
                { text: "Take the scroll home.", nextPage: 4 }
            ] },
            { ...storyPage("The Collector", "Your doorway, no knock", "Veiled Hand Collector", [
                "You decoded it in one night. The average is four.",
                "The scroll was bait. The question was whether you'd run it to the tower, sell it, or keep it. You kept it.",
                "Keeping is the interesting answer. Keeping means you think it's leverage.",
                "Hand it over and we file you as average. Hold on to it, and we find out what you are."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
        ], [
            { text: "I kept it to hunt the leak. Take that to your masters.", conclusion: "The Collector's head tilts, veils moving a beat behind it. Somewhere under them a pencil moves too; you have just been refiled.", trait: "honorable" },
            { text: "Name your buyer first. Then we discuss the scroll.", conclusion: "\"Buyers,\" the Collector corrects softly, and stops there. It is more than most people ever get, and it was meant to be counted.", trait: "suspicious" },
            { text: "The scroll stays with me. Make an offer or make a move.", conclusion: "\"Leverage after all,\" the Collector says, almost approving. Steel slides free somewhere under the veils, unhurried, like a price being counted out.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 25, "Masks Beneath Masks", "Masked Auction Enforcer", "🌙", [
            { ...storyPage("Below the Market", "A cellar under the whisper market", "Shade Master Iro", [
                "Every mask in this room outranks the face under it. Bow to no one; you'd only get it wrong.",
                "You've appreciated, by the way. An outside broker paid forty for your day-name last season. Tonight's opening bid is sixty.",
                "The auction used to move jutsu scrolls and contraband. Look at the lot board.",
                "It hasn't moved contraband in a year."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
            { ...storyPage("The Lot Board", "Beside the lot board", "Nyx", [
                "Lot four, chunin patrol schedules. Lot five, medical records with chakra signatures attached.",
                "Lot seven. Bloodline names. Living ones, with addresses.",
                "Nobody buys a set like that to resell. Someone's building a list of everyone strong enough to threaten the tower.",
                "One buyer's mark on all three lots. I'd charge a fortune for that observation, so keep it."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp", choices: [
                { text: "Ask Nyx to price the buyer's mark.", nextPage: 2 },
                { text: "Find Kite Harrow. She works floors like this.", nextPage: 3, requireTrait: "ms20-respected-the-unsworn" },
                { text: "Work closer to lot seven yourself.", nextPage: 4 }
            ] },
            { ...storyPage("An Old Coat", "A curtained alcove off the floor", "Nyx", [
                "Half rate, since we're in public. The mark's brokerage stock. Old issue.",
                "Older than the alias law, and the alias law is what this village has instead of a religion.",
                "Nobody's traded under it in living memory. So the buyer either dug it up for style, or never stopped trading and just stopped being seen.",
                "Style is cheaper. I'd still bet the other way.",
                "Curtain. Someone's counting who talks to whom."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp", choices: [
                { text: "Step back onto the floor.", nextPage: 5 }
            ] },
            { ...storyPage("The Licensed Guest", "The refreshment table, of all places", "Kite Harrow", [
                "The discount client. You asked my rate for a warning once, at the lantern stall. Here's the discounted stock.",
                "I hold a white invitation. Bought it. This house sells its own doors, which I find honest.",
                "The buyer on lots four, five, seven doesn't bid. It keeps a standing proxy, prepaid, no ceiling. I checked. Checking cost me a week's margin.",
                "No ceiling means the money isn't money to them. In my trade we call that a state actor, or worse.",
                "Warning delivered. Discount honored. We're square, and I was never here."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp", choices: [
                { text: "Drift away from the table.", nextPage: 5 }
            ] },
            { ...storyPage("Lot Seven, Up Close", "The staging rack behind the lot board", "Narrator", [
                "The lot seven folio is thinner than a list of the living should be.",
                "Each name carries an annotation in small clerk's script. Habits. Debts. Which door they use after curfew.",
                "You know the hand. It takes a moment, because the last place you saw it was the clerk's window, the morning you registered two names.",
                "A porter lifts the folio onto the block. The room's attention arrives like weather."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp", choices: [
                { text: "Get clear of the rack.", nextPage: 5 }
            ] },
            { ...storyPage("Spotted", "The auction floor", "Masked Auction Enforcer", [
                "Invitations are white. Yours is missing.",
                "House policy offers two exits. You leave with the last hour wiped, or you leave in the canal.",
                "The wipe doesn't hurt. Regulars take it weekly. They say the week feels lighter after.",
                "Choose before the next lot closes."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
        ], [
            { text: "Bid on lot seven. See who bids against you.", conclusion: "Bidding is not in the policy script, and the Enforcer's silence admits it. Across the floor a single mask turns toward you and forgets to turn back.", trait: "suspicious" },
            { text: "This auction closes tonight. Starting with you.", conclusion: "Above the floor a bell begins to ring and is caught mid-swing. The masks file out at a walk, unbothered, and the Enforcer removes one glove.", trait: "honorable" },
            { text: "Take the wipe. Lift the lot ledger when they reach for you.", conclusion: "Your hand closes on the lot ledger the same instant theirs closes on you. Nyx is already at the door, holding it open the width of one person.", trait: "reckless" },
        ]),
        milestone("Moonshadow Village", 35, "The Hollow Moon Contract", "Contract-Bound Shadow", "🌙", [
            { ...storyPage("The Bleeding Document", "A safe room over the dye canal", "Shade Master Iro", [
                "Held flat, it's a trade agreement. Held to moonlight, the ink runs. Watch the margin.",
                "It isn't a trade agreement. It's a list of people the Kage has agreed to make disappear, priced per name.",
                "The paper was built to eat itself. Someone copied it faster than it could swallow. I'm told the copying cost three scribes their hands.",
                "You were flagged never to see this. Which is why I brought it to you. Consider that my compliment."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
            { ...storyPage("The Real Purpose", "The same room, pages on the floor", "Nyx", [
                "Every name on this list has one thing in common, and it isn't treason.",
                "Talent. Each one strong enough to sit where Sable sits. She isn't clearing threats to the village. She's clearing successors.",
                "The counterparty's mark isn't any clan I can price. And I can price everything.",
                "You know how retail works here. The trainee, the meal chits. This is wholesale.",
                "One more thing, no charge. The list is ruled for more lines than it has names. Somebody expects the market to grow."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
            { ...storyPage("The Counterparty", "The edge of the lamplight", "Hollow Moon", [
                "The contract predates you. Most contracts do.",
                "Ambition is a fine ink. People sign in it without reading the last page.",
                "Your Kage read the last page. She signed anyway. Draw your own conclusions about the terms.",
                "Finish your inspection. The shadow you are standing in is under contract too."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp", choices: [
                { text: "Ask what the ink costs the signer.", nextPage: 3 },
                { text: "Tell it you've stood where a no was kept.", nextPage: 4, requireTrait: "rd34-kept-my-no" },
                { text: "Step out of the shadow it claims.", nextPage: 5 }
            ] },
            { ...storyPage("The Terms", "The lamplight, guttering", "Hollow Moon", [
                "Costs. A ledger word. Good. You will do well or badly here, nothing between.",
                "The signer pays nothing. That is the whole trick of it. The draw passes over her house, her name, her nights.",
                "She sleeps. Her village does the paying, name by name, and every payment is filed as protection.",
                "Nothing in the contract says protection of whom. Lawyers built us, in a manner of speaking.",
                "Inspection over. The lamp was never yours either."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp", choices: [
                { text: "Back away from the lamp.", nextPage: 6 }
            ] },
            { ...storyPage("The Kept No", "The lamplight, very still", "Hollow Moon", [
                "North of the salt flats. A lidded stone with a seam finer than hair. You went hungry beside it and waited.",
                "We remember the makers. They carried themselves out of our books whole, which is theft, whatever they called it.",
                "Your no is logged with theirs now. Unpriced stock. It disturbs our accounting the way a hole disturbs a pocket.",
                "Keep it. Spend it. Either way, when you reach the last page of something, we will know which you did.",
                "The lamp is guttering. That is the lamp's business."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp", choices: [
                { text: "Back away from the lamp.", nextPage: 6 }
            ] },
            { ...storyPage("Out of the Shadow", "The middle of the room, clear of every wall", "Hollow Moon", [
                "There. The instinct. Most people stand in shadow all their lives and never once check the lease.",
                "It changes nothing. The room is ours, the canal under it, the dye in the canal. But you moved, and moving is information.",
                "We will make a note. You have a file with us older than your file with them. Ask nobody how.",
                "Finish your inspection from there, if it comforts you."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp", choices: [
                { text: "Finish reading the contract.", nextPage: 6 }
            ] },
            { ...storyPage("The Shadow Stands Up", "The safe room, the lamp out", "Hollow Moon", [
                "One clause remains tonight, and you are standing on it.",
                "The contract permits a demonstration per inspection. Consider it a courtesy between future counterparties.",
                "The shadow you were warned about has read your file. It is very current.",
                "Begin."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
        ], [
            { text: "Ask what the last page says.", conclusion: "\"Ask her,\" the voice says, and the lamp is out before the words are. Underfoot, your shadow starts standing up without you.", trait: "suspicious" },
            { text: "Sable answers for every name. Starting tonight.", conclusion: "The pages on the floor curl and blacken, done waiting. Nyx pockets one before the dark takes the rest and, for once, writes nothing down.", trait: "honorable" },
            { text: "Ask what she was promised. Exactly. To the ryo.", conclusion: "There is a sound like arithmetic, or like laughter if laughter were billed hourly. \"Priced like a local,\" the voice says, and the shadow moves.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 50, "Jonin of the Hidden Knife", "Jonin Trial: Mirror Assassin", "🌙", [
            { ...storyPage("The Mirror Chamber", "The Kage chamber, mirrored floor to ceiling", "Kage Sable Nocturne", [
                "No guards. Do you know why a room with no witnesses is safe for me and not for you?",
                "You've read a great deal that was flagged away from you. Did you notice nothing reading you back?",
                "The auction, the contract, the scroll in your room. Shall I tell you which of those I arranged?",
                "No? Then you're learning what questions cost. Sit."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "Ask her which of it she arranged.", nextPage: 1 },
                { text: "Ask who stamped my Listening House report closed.", nextPage: 2, requireTrait: "ms42-reported-the-booths" }
            ] },
            { ...storyPage("The Arrangement", "The chamber, your reflection a half-beat late", "Kage Sable Nocturne", [
                "You spent the question. Very well. Which answer would let you sleep, that I arranged everything, or that I arranged nothing?",
                "The first makes me a spider. Comfortable. Spiders can be killed.",
                "The second means this village grows tests the way a canal grows weed, and I only harvest. Which did the mirrors just show you?",
                "I have never needed to arrange anything about you. Consider what that admission costs me, then notice I asked for change."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "Take the corridor when she waves you out.", nextPage: 3 }
            ] },
            { ...storyPage("The Closed Stamp", "The chamber, one mirror angled at you", "Kage Sable Nocturne", [
                "You filed it with a duty clerk who had ink on his second knuckle. Shall I recite your first line?",
                "'The booths take more than words.' A careful sentence. Who taught you to report a thing and say nothing in it?",
                "Every stamp in this village is a tributary. A closed file runs uphill, to this room. I read yours the same night.",
                "Iro thanked you for your diligence two days later. Did you think that was Iro's idea?"
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "Take the corridor when she waves you out.", nextPage: 3 }
            ] },
            { ...storyPage("The Corridor", "The corridor outside, out of mirror-sight", "Nyx", [
                "She knows everything you found. The auction, the contract. Probably what you had for breakfast.",
                "A sensible Kage silences you. She's promoting you. Price that.",
                "It prices one way. You're worth more inside her hand than outside it."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "Ask what the promotion costs me later.", nextPage: 4 },
                { text: "Ask her to weigh it, off the books.", nextPage: 5, requireTrait: "nyx-partner" }
            ] },
            { ...storyPage("The Later Price", "The corridor, voices low", "Nyx", [
                "Later prices are my whole trade, so, full rate. Fine. Family rate. Don't tell anyone I said family.",
                "Rank here is collateral. She lends you standing, and the standing reports back. Every door it opens logs you through it.",
                "The errand she's about to hand you will be small. Smallness is the point. Small things establish precedent, and precedent compounds.",
                "One more thing, billed to your tab. Don't stand where the mirrors can watch you agree to something."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "Go back in.", nextPage: 6 }
            ] },
            { ...storyPage("Off the Books", "A stairwell the mirrors don't reach", "Nyx", [
                "Off the books. You know what you're asking. Fine. You gave me one true thing once and I never sold it. Here's its change.",
                "I was in that chamber, years back. Different Kage in the glass, same offer on the table. I took the promotion.",
                "Wore it three seasons. Everything I priced in those seasons priced wrong, because the rank was doing the asking, not me. I resigned by disappearing.",
                "She let me. That's the part to hold on to. She lets go of people who aren't worth the file space. She will never let you go.",
                "Don't stand where the mirrors can watch you agree to something. That one's free forever."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "Go back in.", nextPage: 6 }
            ] },
            { ...storyPage("The Price of Rank", "The chamber, a blade on the table", "Kage Sable Nocturne", [
                "Jonin of the Hidden Knife. Do you imagine I hand this to the loyal?",
                "The rank comes with a first errand. A Veiled Hand officer keeps a second ledger. You will remind him we hold the first. Nothing more. Isn't that small?",
                "The blade is ceremonial. The trial isn't. Something in this room wears your face and has read your file. Shall we see which of you is current?",
                "Take the handle. Mind the glass."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp" },
        ], [
            { text: "Take the blade and set my own price for the errand.", conclusion: "\"Your own price,\" Sable repeats, weighing the phrase for counterfeit. In the mirrors, every version of you reaches for the handle at a different speed.", trait: "ambitious" },
            { text: "Take the rank. Watch every order that follows it.", conclusion: "Sable studies the glass, satisfied by something she finds there. The reflection that steps out of it has your stance and none of your doubts.", trait: "suspicious" },
            { text: "Ask what the councilman did before anyone reminds him of anything.", conclusion: "\"Did?\" she says. \"What do any of them do? He wrote things down.\" Behind the glass, something turns a page.", trait: "honorable" },
        ]),
        milestone("Moonshadow Village", 65, "Mission to Kill a Witness", "Veiled Hand Executioner", "🌙", [
            { ...storyPage("The Private Order", "The Kage chamber, no clerk present", "Kage Sable Nocturne", [
                "No written order. Do you understand what an unwritten order costs me, in this village?",
                "The target sat in a booth and said nothing. Do you know what withholding sounds like downstairs? Loud.",
                "They copied something before it was erased. They haven't spoken yet. Silence is a delay, not a solution.",
                "The old shrine, before moonrise. I'm not asking you to enjoy it. I'm asking whether you're still useful. Are you?"
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
            { ...storyPage("The Witness", "The old shrine, one candle", "Shrine Witness", [
                "I know why you're here. I filed the paperwork for people like you for nine years.",
                "I copied names before they were erased. People sold downward. To the thing the elders call the draw.",
                "They're alive. That's the part nobody is supposed to keep. Sold, and alive, and owed.",
                "Kill me and the list dies with me. But you've walked past the pipes. You already know what she's doing."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Ask for the names, one by one.", nextPage: 2 },
                { text: "Tell them you hold a shelf in that archive.", nextPage: 3, requireTrait: "ms58-took-the-shelf" }
            ] },
            { ...storyPage("The List, Read Aloud", "The candle between you", "Shrine Witness", [
                "Marrisk, the bone-setter with the singing kettle. Sold in a bad winter, for grain that arrived anyway.",
                "The twins from the dye works. A gate guard called Offa. Eleven more. I can say them all without the paper now, which is the problem.",
                "Every one had a talent and a debt, and the debt was always fresh. Debts get manufactured here the way bread gets baked.",
                "Whoever holds this list owes it. Not owns. Owes. It took me nine years of filing to learn the difference.",
                "The candle wants trimming. Hands steady enough for that, at least."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Trim the candle and listen.", nextPage: 4 }
            ] },
            { ...storyPage("The Clearance", "The candle, guttering low", "Shrine Witness", [
                "A shelf-holder. Then I don't have to explain the archive to you. Good. My throat's nearly done tonight.",
                "I processed your editing clearance. Iro proposed, the Kage's office confirmed. Do you know what else moved through that office the same hour?",
                "This order. Yours. The clearance and the kill were countersigned together. One hand, one sitting.",
                "She cleared you to edit files the same hour she sent you to close mine. Ask yourself which document she considers the real one.",
                "The candle wants trimming. Shelf-holders. Your fee compounds, you know. Mine did."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Trim the candle and listen.", nextPage: 4 }
            ] },
            { ...storyPage("Two Knives", "The shrine door, no footsteps first", "Veiled Hand Executioner", [
                "The Kage sends her regards, and me. One of us is in case you hesitated.",
                "This isn't a loyalty test. Loyalty is cheap here. This is inventory. Are you still an asset?",
                "The witness, the list, or you. The shrine only needs to lose one of the three."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Ask who else she sent tonight.", nextPage: 5 },
                { text: "Say you've stood between bolts and the chained.", nextPage: 6, requireTrait: "rd52-shielded-the-line" }
            ] },
            { ...storyPage("The Second Knife", "The shadow behind the door frame", "Veil Adaza", [
                "Asked and answered. Two of us. I do the counting.",
                "The second knife isn't for the witness. It's for whichever of you two hesitates. The order was careful about that word. Hesitates.",
                "Do you want to know what hesitation looks like from where I stand? It looks like conversation.",
                "You've had yours. Moonrise is close. I count slow, but I do count."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Turn back to the Executioner.", nextPage: 7 }
            ] },
            { ...storyPage("Black Bridge, Remembered", "The shadow behind the door frame", "Veil Adaza", [
                "Black Bridge. Kanna Fole never got to answer her name, and you put yourself in front of the ones who still could.",
                "I logged that. Not for the village. For me. Tonight the log becomes a price, and I am paying it once.",
                "Listen. The order says one shrine light goes out by moonrise. It does not say which light.",
                "The Executioner reads orders the short way. I read them the way they're written. What you do with the difference is yours.",
                "I was never at this door. There's a lamp in the rafters. Old shrine, old wiring."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Turn back to the Executioner.", nextPage: 7 }
            ] },
            { ...storyPage("Moonrise", "The shrine, the candle low", "Veiled Hand Executioner", [
                "Time. The regards run out at moonrise, and so do mine.",
                "The witness, the list, or you. Stock's the same as it was.",
                "For what it's worth, I filed my own doubts once. Downstairs took them. Work's been simpler since.",
                "Decide."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
        ], [
            { text: "Stand between the Executioner and the witness.", conclusion: "The witness folds shaking fingers around the list like it might still save somebody. The candle flame leans, which is how you learn the Executioner is already moving.", trait: "merciful" },
            { text: "Put out the candle and take the Executioner first.", conclusion: "Dark takes the shrine, and somewhere in it the witness runs, paper crackling like a small fire. The Executioner laughs once, flat as a ledger line closing.", trait: "reckless" },
            { text: "Play the loyal knife. Get the list out under their eyes.", conclusion: "You bow exactly as deep as an asset should, and the witness, impossibly, plays along. Up in the rafters, a lamp stays carefully dark.", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 75, "Nyx Chooses a Side", "Shadow Network Hunter", "🌙", [
            { ...storyPage("Red Moon Rooftop", "A rooftop under a rusted red moon", "Nyx", [
                "Six months I've been selling the Hollow Gate garbage. Bad routes, dead aliases, patrol schedules I invented in the bath.",
                "They paid full price every time. That's what finally scared me. A buyer who never checks quality isn't buying information.",
                "It's buying the selling. The transaction is the product. Every trade feeds it, true or false.",
                "I did that arithmetic for free, which tells you how bad it is."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
            { ...storyPage("The Buyer's Mark", "The same roof, an envelope between you", "Nyx", [
                "Their money routes through one mark. Old brokerage, older than the alias law. You've seen it before. In a file that found its way to you.",
                "The mark belongs to someone inside the tower. Inner circle. The Gate has had a hand in that office since before Sable held it.",
                "She didn't build this. She inherited it and signed. The difference matters for what we do next.",
                "The name's in the envelope. I'm not charging for it. Don't make it weird."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "Ask how long she's known the mark.", nextPage: 2 },
                { text: "Say it. The quarterly buyer from my file.", nextPage: 3, requireTrait: "ms70-claimed-custody" }
            ] },
            { ...storyPage("How Long", "The roofline, wind off the canal", "Nyx", [
                "Since the week I started faking the routes. Six months of knowing and not selling it. Do you understand what that did to my books?",
                "I carried the most expensive fact in the village and gave it a room and meals. Out of what? Sentiment isn't in my ledger. I checked twice.",
                "Somewhere in those months I stopped keeping a file on you. That's not in the ledger either.",
                "Forget I priced any of this. Open the envelope when I'm not watching."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "Pocket the envelope.", nextPage: 4 }
            ] },
            { ...storyPage("The Quarterly Mark", "The roofline, the envelope unmoving", "Nyx", [
                "Yes. Same mark. The one that bought you in installments since your first winter, quarterly, on schedule.",
                "You filed the custody claim, and the next installment went unfilled. First missed payment in that mark's recorded history.",
                "Then everything started moving. The files, the auctions, tonight. I don't believe in coincidence. Coincidence is a discount people give themselves.",
                "You weren't an asset going up in value. You were an account being fattened. The claim froze it, and whatever fattens accounts noticed.",
                "The name's still in the envelope. It's worse now. Or better. Priced honest, it's both."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "Pocket the envelope.", nextPage: 4 }
            ] },
            { ...storyPage("The Moon Listens", "The rooftop, red light deepening", "Hollow Moon", [
                "She undersells herself. Six months of careful lies. Do you know what care is worth to us?",
                "More than truth. Care is attention, and attention is the crop. Your villages grow it four different ways.",
                "Freedom, memory, loyalty, secrecy. Four fences around one field."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "Ask what happens when a field stops yielding.", nextPage: 5 },
                { text: "Name the lattice. Say you carried its keys.", nextPage: 6, requireTrait: "rd74-bound-the-lattice" }
            ] },
            { ...storyPage("Fallow", "The red light, patient", "Hollow Moon", [
                "Fields do not stop. Fields are rotated. Ask the Sunken Court, except you cannot, which is the answer.",
                "A village that stops feeding is not freed. It is fallow. Fallow ground gets planted with something hardier.",
                "Your Kage understands this. It is why she signs. She believes she is choosing the crop.",
                "Every keeper believes that. The field never learns the difference between the farmer and the fence."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "Step between Nyx and the light.", nextPage: 7 }
            ] },
            { ...storyPage("The Weighed Miles", "The red light, very close", "Hollow Moon", [
                "Four keys in one pack, from four sockets our masons cut before your villages had names. We taxed every mile you carried them.",
                "The old man folded them into one seal and hung it at his own throat. Bookkeeping. His line always confused custody with safety.",
                "A bound lattice still hums. You stand on one anchor now. The moon over this roof is red because the account under it is open.",
                "You have handled our infrastructure twice, shinobi. There is a word for such people in the Court's ledgers.",
                "Tenant."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "Step between Nyx and the light.", nextPage: 7 }
            ] },
            { ...storyPage("The Tax on Eleven Minutes", "The rooftop edge, red light thickening", "Hollow Moon", [
                "A hunter is already on this roof for the envelope. You have held it eleven minutes. We taxed every one of them.",
                "The broker may keep her arithmetic. We have no further use for sellers who forget to charge.",
                "The hunter carries no such exemption. It was paid for in full, which you now know is our favorite kind of buyer.",
                "Settle."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
        ], [
            { text: "Keep the agent in place. Feed the Gate a channel we control.", conclusion: "Nyx has her rate tables out before you finish the sentence, redrafting them against something that eats villages. Along the roof's edge, the red light leans in to read.", trait: "suspicious" },
            { text: "Drag the agent's name into daylight, whatever it costs the tower.", conclusion: "\"Daylight,\" the voice says, the way a broker says a currency it has never had to accept. Nyx steps behind your shoulder and, for once, prices nothing.", trait: "honorable" },
            { text: "Let Sable think she still runs this. Deal with the buyer directly.", conclusion: "The red light goes very still, the stillness of a counterparty hearing better terms. Somewhere behind you, Nyx begins, quietly, re-reading your contract.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 85, "The Kage Owns Every Secret", "Veiled Hand Grandmaster", "🌙", [
            { ...storyPage("The Files Open", "The whisper market, papers falling like ash", "Shade Master Iro", [
                "Forty years of intake, unsealed in one night. Every alias, every debt, every confession the booths ever drank.",
                "She did it herself. My keys stopped working an hour before it started. Professional courtesy, that hour.",
                "Someone priced the glass under the tower recently. This is her answer. Spend the vault before it can be robbed.",
                "There are people in the square wearing their neighbors' faces, confessing to things the neighbors never did. Don't stop to correct anyone."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Ask what he moved in his hour.", nextPage: 1 },
                { text: "Find Harrow. She priced that glass.", nextPage: 2, requireTrait: "ms80-pulled-her-back" }
            ] },
            { ...storyPage("The Hour of Courtesy", "A doorway, papers drifting past", "Shade Master Iro", [
                "An hour buys less than you'd think when everything you own is paper.",
                "I moved my appraisals. Forty years of knowing what people are worth. The rest I left for the wind. Flattering, how little of it mattered.",
                "And one file that wasn't mine to move. Don't thank me. Archive stairwell, third landing, behind the brick that sounds wrong.",
                "I have never once done a thing for free, so do the arithmetic on what I think tonight is worth.",
                "Mind the papers. Some of them are still true."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Climb toward the tower.", nextPage: 3 }
            ] },
            { ...storyPage("A Debt, Repaid", "A collapsed stall, out of the lamplight", "Kite Harrow", [
                "You tore up a commission with me once and split the penalty. I file debts like that at compound interest, so hold still. I'm paying.",
                "My client never wanted the Mirror moved. Moving was my idea, retirement pricing. The client wanted it catalogued. Confirmed live. Appraised in place.",
                "An appraisal like that has one buyer type. Someone planning a transfer of ownership who needs the asset verified first.",
                "Sable found my survey in the vault log. Tonight is her burning the warehouse so the transfer arrives empty.",
                "The client's mark is old brokerage. You've seen it. Debt paid. Get off the street."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Climb toward the tower.", nextPage: 3 }
            ] },
            { ...storyPage("Controlled Collapse", "The Kage tower balcony", "Kage Sable Nocturne", [
                "You've come to ask why. Wouldn't you rather ask why not sooner?",
                "A village built on withholding was always one honest hour from this. I chose the hour. Should I have let a thief choose it?",
                "When the smoke settles, whoever is still standing will owe that to me. What is a village, if not the people who owe you?"
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Ask who the thief was going to be.", nextPage: 4 },
                { text: "Ask what forty years of intake bought.", nextPage: 5 }
            ] },
            { ...storyPage("The Thief", "The balcony rail, smoke below", "Kage Sable Nocturne", [
                "You expect a name. Would a name help you? Then you haven't understood the market you live in.",
                "Somebody surveyed my vault and filed the survey where I would find it. What do you call a thief who wants to be caught?",
                "An appraiser. And who orders an appraisal of a thing they do not yet own?",
                "The stairs are behind you. Whoever taught you to ask questions one at a time did you no favors."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Take the stairs down.", nextPage: 6 }
            ] },
            { ...storyPage("The Purchase", "The balcony, wind turning the papers", "Kage Sable Nocturne", [
                "Bought. You say it like the vault was savings. Did your mother keep coins in a jar? How charming.",
                "Forty years of intake was never wealth. It was rent. Paid downstairs, on schedule, so the draw stayed downstairs. Ask me what happens when rent stops.",
                "No. Don't. You'll see it from the square shortly.",
                "I am spending the vault in one night because the alternative was the vault spending us. Quote me afterward, if there is an afterward and anyone quotable."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Take the stairs down.", nextPage: 6 }
            ] },
            { ...storyPage("Not Yet", "A doorway off the square", "Nyx", [
                "Don't fight in the square. That's what the square is for tonight.",
                "The pipes under the market are running hot. First time in forty years. She isn't spilling the vault, she's cashing it. Someone downstairs is being paid in us.",
                "The Grandmaster holds the tower stairs. Veiled Hand's best. After him it's just her, and whatever she's bought with all of this.",
                "Door on three. One. Two."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp" },
        ], [
            { text: "Gather anyone still thinking straight. We climb together.", conclusion: "Seven come, and not the seven you would have picked, which is how you know they are real. The tower door stands open, which is worse than locked.", trait: "loyal" },
            { text: "Stairs. Now. Before she finishes cashing out.", conclusion: "Nyx swears in numbers and takes the steps two at a time behind you. On the landing above, the Grandmaster is drawing on gloves like a man keeping an appointment.", trait: "reckless" },
            { text: "Find the vault feed first. Starve her payout before we climb.", conclusion: "The pipe junction sits exactly where Nyx's map promises, and it is guarded. The Grandmaster was told you would think of this, and he was told by name.", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 100, "The Moon Belongs to No One", "Kage Sable Nocturne, Hollow Moon Sovereign", "🌙", [
            { ...storyPage("The Summit", "The tower summit, inside a black moon", "Kage Sable Nocturne", [
                "Three people met you on the lantern road. What do you suppose that costs them tomorrow?",
                "You've read the contract, the lists, your own file. Shall I tell you about the one paper you haven't read?",
                "Ask your questions. Tonight, unusually, I'm buying."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Ask about the one paper I haven't read.", nextPage: 1 },
                { text: "Tell her what I vowed at the last lantern.", nextPage: 2, requireTrait: "ms92-vowed-open-ledgers" }
            ] },
            { ...storyPage("The Seat's Ledger", "The summit, the black moon turning", "Kage Sable Nocturne", [
                "The seat's ledger. It passes with the chair. Did you imagine the chair was furniture?",
                "I read it my first night. Signed by the third. Do you know what the two days between were for? Neither did I, until they were over.",
                "Every predecessor's hand is in it, and every hand starts steady. Would you like to know which page mine stopped being steady on?",
                "No. That one I keep. Even tonight."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Look at her shadow.", nextPage: 3 }
            ] },
            { ...storyPage("The Vow, Quoted Back", "The summit, mirrors waking below", "Kage Sable Nocturne", [
                "Open ledgers, starting with yours. Did you think the last lantern was out of my hearing? The road reports faster than you walk it.",
                "Two Kages before me vowed the same, on that same road. Shall I tell you which page of the seat's ledger each of them became?",
                "Here is a question worth your climb. When your file is the first one opened, who reads it aloud? You? The reader always edits. Ask me how I know.",
                "You had your vow. I had mine. The chair heard both. Notice which of us it kept."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Look at her shadow.", nextPage: 3 }
            ] },
            { ...storyPage("What She Became", "The summit floor, black light through her", "Nyx", [
                "Look at her shadow. It stopped taking her shape.",
                "Forty years of collected faces, and the Gate is settling the account. Everything she siphoned, paid out at once. There's no true face left under there.",
                "I priced everything in this village. I can't price this. Write that down somewhere; it won't happen twice.",
                "Whatever you're going to say to her, say it while there's still someone inside to hear it."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp" },
            { ...storyPage("The Account, Settling", "Her shadow, speaking on its own", "Hollow Moon", [
                "Do not interrupt. This is a disbursement.",
                "Forty years, paid in on schedule. She was our best account in four villages, and she believed she was the teller.",
                "We are not cruel. Cruelty wastes. She will be spent precisely, to the last withheld word, and nothing will be left owing.",
                "You have questions. Accounts in surplus usually do."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Ask what it collects when she's spent.", nextPage: 5 },
                { text: "Tell it the succession ends tonight.", nextPage: 6 }
            ] },
            { ...storyPage("The Next Account", "The black moon, patient", "Hollow Moon", [
                "Collects. As if we reached. We have never once reached. The seat reaches down. Read the founding leases.",
                "When she is spent, the chair stands empty exactly as long as your kind can bear an empty chair. Historically, nine days.",
                "Then someone climbs, for excellent reasons. They always have excellent reasons. Yours, we notice, are already drafted.",
                "We hold the paper either way. We are in no hurry. Furnaces outlive houses."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Face her.", nextPage: 10 }
            ] },
            { ...storyPage("A Notice of Termination", "The black moon, amused, if moons amuse", "Hollow Moon", [
                "Ended. Filed. You are the fourth to serve us that notice on this floor. We archived the other three under their successor titles.",
                "But note the but. We price honestly, whatever they say downstairs. None of the three had read their own file first. You have. It changes the actuarials.",
                "A tenant who knows the lease can break it. It has happened. Once. The stone north of the salt flats sits on the wreckage.",
                "So. Serve your notice. We will hold the paper anyway. It is what we are."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Face her.", nextPage: 10 }
            ] },
            { ...storyPage("Ask what my false confession fed.", "The reckoning", "Kage Sable Nocturne", [
                "The booth logged a lie in your voice. Did you think the pipe grades for truth?",
                "It weighs the telling. Yours weighed a day. Did you ever find where that week went short?",
                "I drank it anyway. Lies season the draw. What does that tell you about what sits in this chair?"
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("Answer for the shelf Iro sold me.", "The reckoning", "Kage Sable Nocturne", [
                "One secret a month, doubling. Which payment was the first that didn't hurt?",
                "That's the month the shelf bought you. Iro sells one a decade, always to someone shaped like this chair.",
                "You've been in the succession since you signed. Why do you think the road lit its lanterns for you?"
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("Answer for the file I burned.", "The reckoning", "Kage Sable Nocturne", [
                "Page by page, on the canal steps. Did the fire give anything back?",
                "The archive opened a fresh folder before your ash cooled. One line inside. Whose hand do you think dictated it?",
                "You can't burn what the village remembers. Where do you think my face went?"
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. This ends now.", nextPage: 10 }
            ] },
            { ...storyPage("The Last Argument", "The summit, her shadow across the floor", "Kage Sable Nocturne", [
                "You want the argument. Fine. What no one knows, no one can take. Ask the wars this village never had to fight.",
                "The booths, the ledgers, the draw. What did I take that anyone was using? Truths that would have burned the streets. Someone had to hold them.",
                "Win tonight and the ledger passes to you. Everyone will want what you hold. What will you do? Open it? Meter it? Collect?",
                "The mirrors downstairs are honest tonight, whatever else is. Come and see what holding looks like."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", leftName: "Player", rightName: "Kage Sable Nocturne", rightImage: "/portraits/kage-sable-nocturne-hollow.webp", choices: [
                { text: "Ask what my false confession fed.", nextPage: 7, requireTrait: "ms42-tested-the-drain" },
                { text: "Answer for the shelf Iro sold me.", nextPage: 8, requireTrait: "ms58-took-the-shelf" },
                { text: "Answer for the file I burned.", nextPage: 9, requireTrait: "ms70-burned-the-file" }
            ] },
        ], [
            { text: "The moon belongs to no one. Not you, not the Gate.", conclusion: "The Mirror opens only for the fully seen, so you give it everything, both names, every logged choice, published to the square below. Somewhere under the tower, forty years of pipes cough and begin running backward.", trait: "honorable" },
            { text: "You called it protection. They called it a cage.", conclusion: "A keeper, then. The war-starting truths stay sealed in one chest, yours, and the village gets a warden it is finally allowed to resent. For the first time all night, Sable stops asking questions.", trait: "merciful" },
            { text: "I didn't climb here to own them. I climbed to give it back.", conclusion: "Every file goes home to its subject, yours first, and every debt this village owes you burns as the postage. From the stairs Nyx calls it the worst trade she has ever witnessed, and tells you to do it.", trait: "loyal" },
        ]),
    ],

};

export function getCurrentStory(character: Character) {
    const storyLine = storylines[character.storyVillage || character.village] || storylines["Stormveil Village"];
    return storyLine[character.storyProgress] ?? null;
}
