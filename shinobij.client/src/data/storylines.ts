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
            { ...storyPage("The Register Hall", "Register hall, morning light through cedar smoke", "Toma Reed", [
                "First time signing? Stand here, next to me. If you stand in the middle of the hall, the clerks think you have something to hide.",
                "I'm Toma. Toma Reed, grove squad. I've done this four times, so you're in good hands.",
                "The signing has four questions. Your name, your family, your craft. Everyone answers those without thinking.",
                "Then comes the fourth question: what do you intend to become. Everyone hesitates on that one, so don't feel bad when you do.",
                "My brother told me once to answer it smaller than the truth. I never asked him why. I wish I had."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp" },
            { ...storyPage("The Fourth Question", "The Register wall, quill waiting", "Narrator", [
                "The Register is a wall of living cedar wood, forty strides long. Every person in the village has their own line carved into it, holding their name and their answers.",
                "The clerk dips the quill and hands it to you.",
                "The hall is very quiet, the way a forest is quiet when something large is walking through it.",
                "What do you intend to become?"
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "\"I want to protect people.\"", nextPage: 2, trait: "al4-become-protector" },
                { text: "\"I want to become the strongest shinobi alive.\"", nextPage: 3, trait: "al4-become-strongest" },
                { text: "\"I want to build something that outlasts me.\"", nextPage: 4, trait: "al4-become-builder" },
                { text: "\"I want to uncover what people hide.\"", nextPage: 5, trait: "al4-become-seeker" },
                { text: "\"I don't know yet.\"", nextPage: 6, trait: "al4-become-unknown" }
            ] },
            { ...storyPage("A Protector", "The Register wall", "Registry Duty Clerk", [
                "A protector. That is a good answer here. Protectors get roofs built for them in this village.",
                "The wall is taking it. See how deep the ink sits? It believes you.",
                "Signed and witnessed. Welcome to Ashen Leaf. I hope you get to keep that answer."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("The Strongest", "The Register wall", "Registry Duty Clerk", [
                "The strongest shinobi alive. You said that in a records hall full of clerks, which took its own kind of nerve.",
                "The wall is taking it. Big answers sink deep. I have watched this wall for nineteen years and I still don't know if deep is good.",
                "Signed and witnessed. Welcome to Ashen Leaf. Try not to break anything on your way up."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("A Builder", "The Register wall", "Registry Duty Clerk", [
                "Something that outlasts you. A builder's answer.",
                "We had a boy give almost that same answer some years ago. I still think about his line sometimes.",
                "Signed and witnessed. Welcome to Ashen Leaf. Build slowly and keep your drawings somewhere safe."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("A Seeker", "The Register wall", "Registry Duty Clerk", [
                "You want to uncover what people hide. You said that out loud, to a clerk, in the building where the village keeps its records.",
                "I am going to write it exactly as you said it, because that is my job, and because part of me wants to see what happens.",
                "Signed and witnessed. Welcome to Ashen Leaf. Be careful which doors you open first."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("Not Yet", "The Register wall", "Registry Duty Clerk", [
                "You don't know yet. That is the most honest answer anyone has given me all season.",
                "Odd, though. When I hold the quill over your line, it drags. Like the wall is waiting for a word that should already be there.",
                "I'll write 'undecided.' Signed and witnessed. Welcome to Ashen Leaf. Come back when you know, and I'll add it myself."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("The Black Flower", "The Register wall, ink drying", "Toma Reed", [
                "Good, you're done. Now we get honey bread. There's a cart by the south arch that sells the good kind, and after a signing you deserve...",
                "Wait.",
                "Look at your line. Something is growing out of your line."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp" },
            { ...storyPage("Elder Mori", "The Register wall, a crowd gathering", "Elder Mori", [
                "Move aside, please. Thank you.",
                "That is a black flower. They grow out of the Register wall, very rarely, when the wall believes someone could become something extraordinary.",
                "In forty years of keeping this wall, I have seen it happen twice. Both times, the whole village celebrated. So they will celebrate you too.",
                "I am not going to spoil your day. But I keep the records here, and I have learned to be careful around things the village celebrates.",
                "Come. You owe the roots a trial before sundown. It is tradition, and today of all days, tradition will be watching."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Follow Mori to the grove.", nextPage: 9 }
            ] },
            { ...storyPage("The Grove Trial", "The old grove, roots breaking the flagstones", "Elder Mori", [
                "The rule of the grove is simple. The ash of every record keeper before me was mixed into this soil, and the Guardian grew out of it. When you fight it, you are fighting the village's dead.",
                "They will test what you are, not what you said at the wall. The dead always know the difference.",
                "Toma, stop hiding behind the new one. You have passed this trial. Act like it.",
                "Begin when you are ready. The roots are patient. I am seventy, and less so."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp" },
        ], [
            { text: "Bow low to the roots first, and mean it.", conclusion: "Mori raises his eyebrows. The Guardian rises out of the soil slowly, almost politely, like an old keeper getting up to greet a guest.", trait: "honorable" },
            { text: "Watch the Guardian's pattern before you move.", conclusion: "It circles the way roots grow, in slow spirals that repeat. By the second pass you know its rhythm. Behind you, Mori murmurs that in forty years, nobody thought to just watch it first.", trait: "suspicious" },
            { text: "Strike first. Show the grove what's growing.", conclusion: "Toma makes a sound like a kettle boiling over. The Guardian catches your first blow and the whole yard shakes, and somewhere under the soil, something old starts paying attention.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 15, "The Forbidden Seed", "Rootbound Guard Initiate", "🌿", [
            { ...storyPage("The Blessing", "Ash-house row at dawn, neighbors gathering", "Narrator", [
                "Overnight, black flowers opened along a fence in ash-house row. Eleven of them, glossy as beetle shells, in a straight and tidy line.",
                "The neighbors are bringing honey bread and congratulations. Flowers on a fence mean the same thing as a flower on the Register wall: someone in that house could become something extraordinary.",
                "Toma is standing at the edge of the crowd, and he is not eating his honey bread."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("Eleven Flowers", "The fence line, crowd thinning", "Toma Reed", [
                "That's Imera's fence. Her daughter Sena builds things. Water wheels out of barrel scrap. A little loom that walks across the table on wooden legs. She's nine years old.",
                "When I was small, we had flowers on our fence too. Everyone brought bread. My mother still talks about how much bread there was.",
                "That was the spring before my brother went quiet. I've never put those two things together out loud before.",
                "Forget I said it. Look, the Kage is here. She comes in person when there's a blessing. People love that about her."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("The Kage at the Fence", "Imera's gate, winter bundles stacked", "Kage Hoshina Enju", [
                "Imera. Your fence has made the whole village jealous. I brought your winter share early, and a little extra, because guests will be eating your pantry bare for a week.",
                "And you must be Sena. I heard there is a loom in this house that walks. Will you show me? I promise I have held stranger things.",
                "Look at that. It walks with a limp, like my old quartermaster. Sena, that is wonderful work. Truly.",
                "Rest well tonight, both of you. The survey will come tomorrow to record the blessing, and then the whole village will know what I already know: this house is precious."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("What the Village Says", "The gate, Hoshina's guards moving on", "Imera", [
                "You're new, so you don't know yet. That woman kept this village alive. No child has frozen in Ashen Leaf since she took the shears. Not one, in thirty years. My mother says it every winter.",
                "She remembered my name. She remembered SENA'S name.",
                "So why can't I stop looking at these flowers and counting them?",
                "Eleven. Nobody gets eleven. I asked old Jorun what his family got, back when his fence bloomed, and he couldn't remember there ever being flowers at all."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Go find Mori.", nextPage: 4 }
            ] },
            { ...storyPage("Mori Counts", "The register annex, bloom charts on the table", "Elder Mori", [
                "You two. Good. I have a watch for you tonight, on ash-house row. The survey records the blessing at first light, and until then, somebody sensible should be standing near that fence.",
                "Eleven blooms. A blessed house gets one, perhaps two. I have kept the bloom charts for forty years, and I have never charted eleven.",
                "The assignment is simple. Nobody touches the flowers. Not thieves, not drunks, not the family. Nobody.",
                "And if anything about tonight strikes you as wrong, you bring it to me. Not to the survey. To me. I will explain why one day, if you turn out to be the kind of person worth explaining things to."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Take the night watch.", nextPage: 5 }
            ] },
            { ...storyPage("The Night Watch", "The fence line, moonless", "Narrator", [
                "Past midnight, the row is quiet. Cricket song, cold ash smell, eleven flowers holding a faint shine like they are being read by some faraway light.",
                "The door of the blessed house opens, softly. Imera slips out into her own garden.",
                "She is carrying garden shears."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Step out and stop her, gently.", nextPage: 6 },
                { text: "Stay hidden and watch what she does.", nextPage: 7 }
            ] },
            { ...storyPage("Imera's Shears", "The fence line", "Imera", [
                "Please. You're new here. You can still stay out of this.",
                "Everyone calls the flowers luck. My mother called them luck too, when they bloomed for her sister. Her sister sang, back then. Beautiful voice, three languages.",
                "Then one spring the singing stopped mattering to her. She still sang, but smaller, and only when asked, and then not at all. Nobody else in my family thinks that story is strange.",
                "Eleven flowers, and my Sena dreams in machines. I'm not letting them record eleven. One cut, maybe two. The survey counts a smaller blessing, and my girl gets to stay a nine-year-old with too many ideas.",
                "You can stop me, or you can watch the crickets for one minute. I'm asking you, mother to stranger. One minute."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Dawn is coming. Decide.", nextPage: 8 }
            ] },
            { ...storyPage("The Longest Cut", "Behind the rain barrel", "Narrator", [
                "She kneels at the fence and does not cut. Not at first. She counts the flowers twice, the way you count sleeping children.",
                "Then she chooses the largest bloom, the one nearest Sena's window, and holds the shears against its stem for a long time without closing them.",
                "Beside you, Toma whispers: 'That's how my mother stands at my brother's workbench. Like she's looking for something she can't name.'"
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Dawn is coming.", nextPage: 8 }
            ] },
            { ...storyPage("First Light", "The row at dawn, survey banners approaching", "Toma Reed", [
                "The survey is early. There's a Rootbound Initiate walking out front. They always send one where there are flowers. Official word is that it guards the blessing.",
                "Imera is still at the fence. The shears are in her apron. The big flower is still on its stem.",
                "If the survey records her standing there with shears, this stops being about flowers.",
                "Whatever you're going to do, the next thirty steps are when you do it."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("The Survey Arrives", "The gate, the Initiate's staff already glowing", "Narrator", [
                "The Initiate plants its staff at the gate and begins the recording chant. Under the fence, roots stir like fingers under a blanket.",
                "Imera looks at you once, quickly, the way people look at weather before a journey.",
                "Eleven flowers shine in a tidy line, and the largest one leans toward a child's window."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
        ], [
            { text: "Palm the cut stem before the chant reaches it.", conclusion: "One quick snip, hidden in your sleeve, smooth as a card trick. The survey records ten blooms and Imera's shoulders come down an inch. The Initiate pauses over its count, then turns its head toward you.", trait: "suspicious" },
            { text: "Stand between Imera's gate and the survey.", conclusion: "The chant falters. Initiates are not trained for a person who simply will not move. Behind you, Imera whispers thank you, and then she whispers run.", trait: "honorable" },
            { text: "Tear the big flower out, roots and all, in the open.", conclusion: "The bloom comes up with a sound like a struck bell, and every root in the row wakes at once. Toma shouts your name. At least nobody can pretend it was an accident.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 25, "The Cut Branches", "Archive Spirit of the Root", "🌿", [
            { ...storyPage("After Hours", "The archive, one lamp between the stacks", "Toma Reed", [
                "This is the archive. Everything on the Register wall gets copied here, onto cedar slats, along with letters, records, drawings. A person's whole paper life, all in one rack.",
                "I have a key because I mend the shelves. I took the shelf job because I wanted the key. You can judge me later.",
                "I need you to read some things tonight and tell me I'm not imagining what I think I see in them. That's all I'm asking for. A second pair of eyes.",
                "Start with this one. Jorun, the carpenter. Read his slat and tell me what he was building."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
            { ...storyPage("Jorun's Plans", "The carpenter's slat, held to the lamp", "Narrator", [
                "The record is complete. An apprenticeship, a marriage, a workshop by the mill. Then drawings: a bridge across the flood channel, drawn with a sure and hungry hand. Three lines of it.",
                "The bridge drawings stop mid-line. The very next entry is a cabinet. Then chairs. Then twenty years of chairs.",
                "The ink of the first chair is exactly as old as the ink of the unfinished bridge."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Pull Aren Reed's slat yourself.", nextPage: 4 },
                { text: "Ask Toma what happened to the bridge.", nextPage: 2 },
                { text: "Ask Mori. He owes you for the border.", nextPage: 3, requireTrait: "rd22-sealed-for-mori" }
            ] },
            { ...storyPage("The Bridge", "Between the racks", "Toma Reed", [
                "Jorun is still alive. He drinks at the mill house most nights. If you ask him about the flood channel, he laughs and says bridges were never his thing.",
                "You just read the slat. He drew that bridge like his hands were on fire. And now it was 'never his thing.'",
                "Nobody burned his record. Nobody had to. Whatever he was becoming got cut out of him, and what was left got twenty years of chairs.",
                "There's a word carved inside some of these racks, small, where only a shelf mender would ever see it. The word is 'pruned.' I used to think it was about the orchards. I don't think that anymore."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Ask about Aren.", nextPage: 4 }
            ] },
            { ...storyPage("A Quiet Debt", "Mori's desk, lamp turned low", "Elder Mori", [
                "You kept the border business quiet for me once. I have not forgotten it. Ask your question.",
                "Jorun. Yes. I remember the bridge. I surveyed his household myself, the same spring he stopped drawing it.",
                "You want to know what happened between a man and his bridge. The orchard keepers have a word for cutting a branch so the rest of the tree stays comfortable. They say pruned. I have started to believe the word was never only about trees.",
                "Now I will say something an Elder should not say. Read the Reed boy's slat tonight. Aren Reed. And when your friend asks what I told you, tell him I said nothing at all."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Pull Aren's slat.", nextPage: 4 }
            ] },
            { ...storyPage("Aren Reed", "The Reed family rack", "Toma Reed", [
                "Here. Aren Reed. My brother. Read it. Nothing is missing from it. That's what I need you to understand first.",
                "Born in ash-house row. Apprenticed at the joiner's bench. Quiet. Dutiful. The record even describes his smile right.",
                "My mother remembers him exactly like this slat says. Quiet, dutiful, happiest at his bench. That is the worst part.",
                "Because I grew up with him, and he was the loudest argument in any room he ever stood in. There is a whole person missing between these lines. I have proof of him at home, and one day soon I'll trust you enough to show you."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
            { ...storyPage("The Archive Wakes", "The stacks, lamp guttering", "Narrator", [
                "The racks creak. Not the creak of wood settling. The creak of something heavy turning over in its sleep.",
                "Down the aisle, the slats you pulled tonight begin sliding back into their places. Gently. Tidily. By themselves.",
                "The Archive Spirit is the keeper of this room. It guards every record here, including the cut ones, and you have spent the night picking at its stitches."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
            { ...storyPage("The Keeper of Copies", "The archive aisle, roots sliding from the walls", "Toma Reed", [
                "Okay. That's the archive's keeper. It's old, it's strong, and we are very much not supposed to be in here at night.",
                "It won't follow us past the door. Probably. I mend its shelves and it tolerates me, but you pulled records, and it takes that personally.",
                "One rule, whatever happens: the slats stay in this room. If we carry one out, the survey knows by noon and this whole night becomes evidence against us.",
                "It's reaching for you. Decide."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
        ], [
            { text: "Copy Aren's page by lamplight while it comes.", conclusion: "Your hand stays steady and your letters come out ugly and complete. The Spirit takes the slat back from under your quill with terrible patience, and the copy in your sleeve is yours to keep.", trait: "suspicious" },
            { text: "Hold the keeper off Toma. He copies faster.", conclusion: "It hits like a falling shelf. Toma scribbles and swears and keeps scribbling. When you finally go down on one knee, he is finished, and he drags you out the door with the copy in his teeth.", trait: "reckless" },
            { text: "Set the slat down and face the Spirit with open hands.", conclusion: "It stops one root-length away. Whatever it reads people against, it reads you twice, and finds the same impossible thing the Register wall found. It lets you both walk to the door. It keeps the slat.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 35, "The Rootfire Chamber", "First Flame Sentinel", "🌿", [
            { ...storyPage("The Kiln Stair", "Beneath the ancestral kiln, heat rising", "Elder Mori", [
                "Stay on the stairs. The floor down here is older than the village, and I do not trust it.",
                "You have earned a look at this place. That is my judgment, and if anyone asks, I will answer for it.",
                "Below the kiln burns the Rootfire. The founders lit it four hundred years ago, and it has never gone out. Every warm winter this village has ever had came from this room.",
                "Gloves on. Ask your questions after you've seen both sides of it. You'll understand the order once we're down."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
            { ...storyPage("The Founders' Alcove", "A carved alcove, offerings behind wax", "Narrator", [
                "The alcove is small and heartbreakingly neat. Wooden tokens rest in carved niches, each one shaped by hand: a little ship, a house, a wedding ring, a book.",
                "Each token is signed. Big, careful signatures, the kind people write when the writing is the last thing they will do about it.",
                "The same phrase appears on every one, in forty different hands: 'My green years, given gladly.'"
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Read a founder's token aloud.", nextPage: 2 },
                { text: "Ask Mori what the tokens actually are.", nextPage: 3 },
                { text: "Whisper to Toma: is this the room from Aren's letter?", nextPage: 4, requireTrait: "toma-hope" }
            ] },
            { ...storyPage("Given Gladly", "The alcove", "Elder Mori", [
                "'I, Osu of the mill line, give the roads I will not walk and the sons I will not meet. Gladly. Keep the children warm.'",
                "You read it well. Most people's voices fail on the word gladly.",
                "Osu was real. That token bought the east wall, more or less. He lived to ninety, never married, and by every record we have, he never once regretted his gift. That is what this room used to be.",
                "Used to be. Now walk twenty steps to your left, and see what it is."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Walk to the racks.", nextPage: 5 }
            ] },
            { ...storyPage("The Gift", "The alcove", "Elder Mori", [
                "Each token is a future. A real one. The founders gave up the lives they were going to live, and the Rootfire burned those futures into warmth, harvests, medicine, walls that do not crack.",
                "Understand this part, because everything else depends on it: they VOLUNTEERED. Every token in this alcove was given freely, by an adult who knew the price, to buy the village a generation of safety.",
                "The ash in our mortar is not a poem. It is those people, holding the walls up. I was proud of this room for thirty years.",
                "Twenty steps to your left. Then see if you can stay proud."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Walk to the racks.", nextPage: 5 }
            ] },
            { ...storyPage("Aren's Map", "The alcove, out of Mori's hearing", "Toma Reed", [
                "Yes. This is the room. His letter says 'the fire under the kiln is fed twice.' I always thought that was a figure of speech.",
                "Fed twice. This alcove is the first feeding, the willing one. Look at Mori's face and tell me there isn't a second.",
                "Aren drew a little map on the back of the letter. Stairs, then the alcove, then racks, and under the racks one word. I couldn't read it for years because his hand was shaking when he wrote it.",
                "I can read it now. The word is 'stamped.'"
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Walk to the racks.", nextPage: 5 }
            ] },
            { ...storyPage("The Second Feeding", "Iron racks, fresh graft-slats in rows", "Narrator", [
                "Twenty steps left, the hand carving stops and the iron begins. Racks from floor to ceiling, loaded with pale wooden slats.",
                "No signatures on these. Each slat carries a stamp instead: a household mark, a season, and one small tidy character that means 'approved.'",
                "The nearest slat still smells of fresh sap. Somebody's future was cut this week, without their name on it, and the fire is drawing warmth from it while you stand here."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
            { ...storyPage("The First Flame Sentinel", "The threshold, an armored shape kindling", "Elder Mori", [
                "Stand still. Do not draw a weapon. That is the Sentinel, and it is the only honest thing left in this room.",
                "The founders built it to guard their gift from thieves. It has held that post for four hundred years, and it still checks every visitor against one question: did you give, or did you take?",
                "The survey crews pass it with permits. It is old, and paperwork smells enough like consent to confuse it. I have watched them walk past it with stolen futures on a cart, and I have said nothing, and that silence is the worst thing I own.",
                "It will not be confused about us. I brought no permit tonight. On purpose."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Face the Sentinel.", nextPage: 7 }
            ] },
            { ...storyPage("Did You Give, Or Did You Take", "The threshold, the Rootfire at your back", "Narrator", [
                "The Sentinel's visor opens on old fire. It looks at Mori for a long moment, and lowers its head like it is grieving with him.",
                "Then it looks at you, and stops. Whatever it measures people against, you come back unreadable, and unreadable is not on its list of permitted things.",
                "Its blade arm wakes with a sound like a kiln door opening. It is not wrong to guard this place. That is the terrible part."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
        ], [
            { text: "Douse the nearest rack line and see what happens.", conclusion: "Steam screams up the flue and half the chamber's warmth dies at once. Far above, faint through the stone, you hear the village notice the cold. The Sentinel moves toward you, and for one strange moment it seems to approve.", trait: "reckless" },
            { text: "Count the stamps. Every household. Every season.", conclusion: "You reach forty one households before the Sentinel closes the distance. Forty one, in this season alone. Mori watches you count, and every rack seems to age him another year.", trait: "suspicious" },
            { text: "Demand Mori say who signs the approvals.", conclusion: "'One hand,' he says, not looking away from the fire. 'The same hand for thirty years.' The Sentinel hears the answer too, and its grief sharpens into something with edges.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 50, "The Branch That Rises", "Jonin Trial: Rootbound Master", "🌿", [
            { ...storyPage("The Measuring", "The graft hall, ribbons and calipers", "Registry Duty Clerk", [
                "Arm out, please. Now the other one. Chin level, eyes on the wall mark.",
                "Height, reach, span of hand. The tailors want your measurements for the Jonin grays, and the Register wants them for the record. Between you and me, the Register asks for more measurements than any tailor I've ever met.",
                "You're the black flower signing. The whole hall has been talking about it. Don't let it swell your head. Flowers wilt. Paper keeps.",
                "There, done. Measured like a cutting, as the old joke goes. Nobody remembers it's a joke about grafting. The rite is at the bell. Don't be late. The Kage is attending in person."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
            { ...storyPage("Before the Bell", "The hall steps, Toma pacing", "Toma Reed", [
                "My friend, the Jonin. I'd be prouder if my stomach weren't turning.",
                "Do you know what the old records call this rite? The grafting. They stopped using that name out loud around the same time they stopped asking people's permission for things.",
                "There's a line in the oath. Everybody mumbles through it like a hymn they hate. Listen for it: 'I will grow where the tree permits.'",
                "Say whatever keeps you safe in there. Just know what you're saying while you say it. Aren took this oath too, once."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Answer the bell.", nextPage: 2 }
            ] },
            { ...storyPage("The Grafting", "The rite circle, Hoshina presiding", "Kage Hoshina Enju", [
                "Come forward. So you're the one who made my Register bloom.",
                "I want you to understand that we are glad of you. Every Kage hopes for strong shinobi, and you are the strongest this hall has seen in a generation.",
                "The oath is old and short. You swear service to the village, silence where the village requires it, and then the third line, the one the young mumble and the old actually mean.",
                "Say it with me, or say whatever you have brought instead. I learn more from the substitutions than from the oath, honestly."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Swear it plainly, every word.", nextPage: 3 },
                { text: "Ask what happens to branches that grow past permission.", nextPage: 4 },
                { text: "Change the third line: swear to the village, not the tree.", nextPage: 5 }
            ] },
            { ...storyPage("Word for Word", "The rite circle", "Kage Hoshina Enju", [
                "'I will grow where the tree permits.' Clean, unhesitating. Most people flinch on the word permits. You didn't.",
                "Either you meant it, or you've decided that meaning it is a useful costume. I can work with either, and I mean that as a compliment.",
                "Rise, Jonin of Ashen Leaf.",
                "And understand something, because I say it to every strong branch: the village is always watching where you grow. That is not a threat. It is just what living in an orchard means."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Rise as Jonin.", nextPage: 6 }
            ] },
            { ...storyPage("The Question", "The rite circle, the hall holding its breath", "Kage Hoshina Enju", [
                "Nobody has asked me that question during the rite itself in forty years. The last person who did has a very short line on my Register wall now. I'm telling you that plainly because you deserve plain answers.",
                "You asked what happens to branches that grow past permission. In a real orchard, the keeper decides: fruit, or firewood. In this village, the keeper is me.",
                "I decide with more grief than you would believe, and I have been right often enough that I can still sleep. Most nights.",
                "Take the oath, grow splendidly, and give me no reason to make that decision about you. I like you. That is not a small thing for me to say."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Take the oath and rise.", nextPage: 6 }
            ] },
            { ...storyPage("The Substitution", "The rite circle", "Kage Hoshina Enju", [
                "'I will grow where the village needs me.' The village. Not the tree.",
                "Half the people in this hall think those are the same word. You and I both know they are not, or you wouldn't have swapped them.",
                "I will accept it. Clerk, record the oath exactly as spoken.",
                "Rise, Jonin. And keep growing where I can see you. I extend that courtesy to very few people, and I withdraw it from fewer still."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Rise as Jonin.", nextPage: 6 }
            ] },
            { ...storyPage("The Trial of the Rootbound Master", "The rite circle, floor roots parting", "Narrator", [
                "The floor opens on old root-worked steps. Rank in Ashen Leaf is not handed over. It is tested in the dark, against the Rootbound Master, the grafted champion of the last generation.",
                "Hoshina watches from the rim with her hands folded, unhurried, like a keeper watching weather roll in.",
                "Somewhere in the crowd, Toma is mouthing the words 'you said WHAT' and holding both thumbs up anyway."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
        ], [
            { text: "Fight carefully. Give the watchers nothing to write down.", conclusion: "You win the way clerks write: neat, spare, nothing extra for the record. Hoshina tilts her head. 'Restraint,' she tells the hall, 'grafts well.' You spend the rest of the day wishing she had said anything else.", trait: "suspicious" },
            { text: "Fight as yourself, whatever it shows them.", conclusion: "It is loud and messy and entirely yours, and halfway through, the old Master laughs out loud like a man remembering what being alive felt like. When you rise, the hall is cheering, and the black flower on the Register glows through the floor above.", trait: "honorable" },
            { text: "End it fast. Break the Master's stance in three moves.", conclusion: "The hall gasps at the speed and misses what you saw up close: the Master's relief. Grafted champions do not get to retire. Now the village needs a new one, and every eye in the hall lands on you.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 65, "The Mission of Quiet Ash", "Rootbound Retrieval Squad", "🌿", [
            { ...storyPage("Escort Orders", "The register annex, crates on a wagon", "Registry Duty Clerk", [
                "Jonin. Good, you're punctual. Escort assignment: six crates of seasoned offerings, from this annex to the kiln, before the frost arrives. Signed by the Kage's own office.",
                "The crates are sealed and blessed. That means nobody opens them. The last escort who opened one has spent a season pulling weeds on the terraces, and he was LUCKY.",
                "You come recommended, if that matters to you. Mori cleared you for sealed work personally.",
                "Take the Reed boy with you. He's due for a route, and frankly, I'd rather he was next to somebody level-headed this week."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Sign for the crates and move out.", nextPage: 3 },
                { text: "Ask why offerings need a Jonin escort.", nextPage: 1 },
                { text: "You've read Mori's charts. Ask which households packed these.", nextPage: 2, requireTrait: "al58-took-the-knowledge" }
            ] },
            { ...storyPage("A Fair Question", "The annex", "Registry Duty Clerk", [
                "Because last month, a crate went missing between here and the kiln. The month before that, two.",
                "The official wording is that somebody is stealing blessings. I keep my job by using official wordings.",
                "You want my private wording? Somebody in this village is a thief with excellent taste in what to steal, and half the annex packs the crates slowly on purpose, and you did not hear either of those things from me.",
                "Sign. The frost doesn't care which wording is true."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Sign and move out.", nextPage: 3 }
            ] },
            { ...storyPage("The Charts", "The annex, voice low", "Registry Duty Clerk", [
                "So you HAVE read Mori's charts. I wondered why he cleared you so fast.",
                "Fine. Lean in. Crate two came from the mill line. Crate three is the weaver who petitioned for a school last spring. Crates five and six came out of the detention rows, and I wasn't here when they were packed, because I made sure I was needed elsewhere.",
                "I file things. I don't choose them. Some mornings that sentence is the only thing holding my roof up.",
                "Sign, Jonin. And if you walk slowly past the mill, I won't be the one who noticed."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Sign and move out.", nextPage: 3 }
            ] },
            { ...storyPage("The Kiln Road", "The forest road, wagon wheels loud", "Toma Reed", [
                "Sealed and blessed. Blessed and sealed. You know exactly what my brother would have done by the second mile marker.",
                "Listen. The third crate rattles when we hit a rut. Offerings are supposed to be ash and slats. Ash doesn't rattle. Slats don't roll around.",
                "I'm about to say a sentence, and before I say it, I need to know if you're standing here as my commanding Jonin or as my friend.",
                "There's a pry bar under the seat."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Pull the wagon off the road. Open the crate.", nextPage: 5 },
                { text: "Keep rolling. The seals stay on.", nextPage: 4 }
            ] },
            { ...storyPage("Sealed", "The wagon, still rolling", "Toma Reed", [
                "Right. Sealed. You're right. Forget I said anything.",
                "It rattled again. That was a wheel. A little wooden wheel, rolling loose. I built toys with my brother for ten years. I know the sound of a toy wheel on floorboards.",
                "Stop the wagon. Order me punished for it afterward if you have to, I'll take every weed rotation from here to spring.",
                "But if you make me deliver a child's toy to that fire in a sealed box, I won't come back from it. Please."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Pull off the road.", nextPage: 5 }
            ] },
            { ...storyPage("The Third Crate", "Off the road, crate open", "Narrator", [
                "Not ash. Not slats.",
                "A model water-screw with one cracked vane, built small enough to hold. A bundle of letters tied with weaver's thread. Seed jars labeled in a child's careful hand. And a little wooden loom, half folded, that stirs in the straw and goes still, like it knows to hide.",
                "A whole crate of what people were going to become, packed in straw, stamped 'approved,' and addressed to a fire.",
                "Toma picks up the loom and holds it the way you hold a bird."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Wrap the water-screw and hide it on your person.", nextPage: 6, trait: "al65-saved-the-screw" },
                { text: "Give the loom to Toma. He'll know whose it is.", nextPage: 6, trait: "al65-gave-toma-the-loom" },
                { text: "Repack everything exactly as you found it.", nextPage: 6, trait: "al65-resealed-the-crate" }
            ] },
            { ...storyPage("The Retrieval Squad", "The road behind, lanterns through the trees", "Toma Reed", [
                "Lanterns, kiln side. That's a Rootbound Retrieval Squad. They sweep the route whenever a shipment stalls too long.",
                "So here we are. Six crates of stolen futures, one wagon, one fire that wants them, one squad coming to collect, and the two of us.",
                "One more thing, before you choose. The manifest under the seat is the only paper anywhere that connects these stamps to the Kage's office. Whatever we do, remember which things burn and which things prove.",
                "Choose fast. They walk quick."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
            { ...storyPage("Lantern Light", "The kiln road, squad closing", "Narrator", [
                "The lanterns spread out through the trees the way trained squads spread: unhurried, certain, closing from three sides.",
                "In crate five, paper shifts softly, like letters turning over in their sleep.",
                "The frost is coming. The fire is warm. And everyone on this road tonight is somebody's future, one way or the other."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
        ], [
            { text: "Scatter the crates into the dark. Burn the wagon and manifest.", conclusion: "Futures vanish into the treeline in twelve directions, unrecoverable and free. The wagon burns bright behind you, and with it the only paper that proved whose stamp sent them. Toma laughs and grieves in the same breath, and you understand both.", trait: "merciful" },
            { text: "Hide two crates. Let the squad recover the rest, and keep the manifest.", conclusion: "The squad finds a stalled wagon, a flustered escort, and four crates of six. You keep two crates of futures and the manifest that proves everything. The other four ride on toward the fire, rattling softly, and you make yourself listen until you can't hear them.", trait: "suspicious" },
            { text: "Send Toma into the dark with the crates. Face the squad alone.", conclusion: "He runs because you told him to, and he doesn't look back, because you told him that too. The lanterns ring you in. The squad captain checks your seal against a list, slowly, and asks you, twice, where your partner went.", trait: "loyal" },
        ]),
        milestone("Ashen Leaf Village", 75, "The Ancestors Speak", "Ancestor-Bound Flame Beast", "🌿", [
            { ...storyPage("Ash on the Wind", "The kiln yard at dusk, ash falling upward", "Elder Mori", [
                "It started at noon. The Rootfire began breathing wrong. An hour later, every founder's token in the alcove turned itself face-down.",
                "The survey wants to send an exorcist. The Kage wants it kept quiet. I want the one person in this village that the roots keep treating like family. That's you.",
                "Something is climbing up through the fire, and it is wearing the founders' voices.",
                "Toma is already down there. He refused to wait. He said the dead knew his brother."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Go down to the fire.", nextPage: 1 }
            ] },
            { ...storyPage("The First Flame", "The Rootfire chamber, flames standing upright", "First Flame Avatar", [
                "Stand where we can warm you, little branch. We are trying to be gentle. Gentleness was never fire's gift.",
                "We are the founders. The given years, the willing ones. We built the walls you were born behind, and we were glad to burn for them. We are glad still.",
                "But for years now, something has been feeding us the other kind. Futures with the stems torn. Futures that scream.",
                "We do not digest what is stolen, child. We hoard it, the way a wound hoards heat. Four hundred seasons of stolen mornings are packed inside this fire, and we cannot hold the door shut on them much longer."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Ask what the fire wants from you.", nextPage: 2 },
                { text: "Show them the tool outlines you copied from the Reed wall.", nextPage: 3, requireTrait: "al42-filed-a-report" }
            ] },
            { ...storyPage("The Ask", "The chamber, tokens rising in the heat", "First Flame Avatar", [
                "Not revenge. We are dead. The dead make poor executioners and worse judges.",
                "We want a witness. One living voice that can stand in front of the village and say: the founders gave, and the keepers took, and those are not the same fire.",
                "It has to be you. The Register cannot read you, so the village cannot quietly cut this truth out of you the way it cuts everything else. Do you understand what a rare pair of shoulders that makes you?",
                "But first, there is a duty we cannot do ourselves. Our grief grew a body, years ago. We chained it down here to keep it off the village, and the keeper has been using it as a bellows for her fire ever since. Free it, or end it. But do not leave it hers."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Follow the chain.", nextPage: 4 }
            ] },
            { ...storyPage("The Ghost Lines", "The chamber, your copied page held up", "First Flame Avatar", [
                "Hold it higher, child. Yes. A wall of tools that nobody remembers owning, copied in a living hand.",
                "You wrote down the dead's own testimony without knowing you were doing it. The boy those tools belonged to is in here with us. The stolen part of him. He still remembers arguing.",
                "He asks us to tell his brother something. Tell Toma: the bench was never the whole of me. Tell him about the ink.",
                "We would weep, but everything we are is fire. Go to the chain now. What waits there is our grief with its manners burned away, and it deserves better than what she has used it for."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Follow the chain.", nextPage: 4 }
            ] },
            { ...storyPage("The Bellows", "The chamber's far vault, a chain thick as a tree", "Toma Reed", [
                "There you are. I found the chain. Technically the chain found me. Don't step where the floor looks melted.",
                "The Avatar told me what this is. It's the ancestors' grief, all of it, given a body and chained so it wouldn't flatten the village. And the Kage runs it like a bellows. Squeeze the grief, stoke the fire. Efficient.",
                "It looked at me, friend. Through all of that flame, it looked at me exactly the way my mother looks at Aren's workbench.",
                "The Avatar says free it or end it. It's pulling the chain tight. I think it heard them say that."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp" },
            { ...storyPage("Grief, Off the Chain", "The vault, the Flame Beast rising", "Narrator", [
                "It rises the size of the fear it was chained for, and it burns in the shape of everyone the fire could not save.",
                "The Avatar's voice comes down the flue, steady as a hand on your shoulder: 'Witness it clearly, whatever you choose. Seeing it clearly is the whole work.'",
                "The Beast lowers its head toward you. Grief always recognizes its witnesses."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp" },
        ], [
            { text: "Say the founders' words to it: 'given gladly.' Mean them.", conclusion: "The words land on it like rain on a roof it used to live under. For three heartbeats the Beast is just forty ordinary dead people remembering gladness, and then it fights you the way grieving people fight: to be held, not to win.", trait: "honorable" },
            { text: "Shatter the chain. Whatever follows, follows.", conclusion: "The chain parts with a sound like a hymn ending. Freed grief takes the shortest road toward what hurt it, and the shortest road runs through you. Far above, in her tower, the keeper feels her bellows die.", trait: "reckless" },
            { text: "Ask the Avatar what it hasn't told you. Then fight.", conclusion: "'That we share the guilt,' it answers at once. 'The first stolen future was fed to us with our consent. We were cold that year, and we said yes.' The truth settles onto your shoulders, and the Beast comes on.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 85, "The Kage Burns the Future", "Rootbound Elder Champion", "🌿", [
            { ...storyPage("The Detainment Lists", "The village square, notices in fresh ink", "Toma Reed", [
                "They posted it at dawn. 'Seasonal custodianship of promising branches.' Custodianship. Somebody sat down and chose that word.",
                "Fourteen names. The weaver who petitioned for a school. Jorun's apprentice. Two names from the mill whose only crime is planning a wedding their families forbid.",
                "And Sena. Imera's Sena. They came for her at breakfast. The guard on the detention row used to trade her scrap iron for her little machines.",
                "Mori finally said the quiet part yesterday: futures burn hotter the bigger they were going to be. They're not detaining troublemakers. They're stocking the kiln before winter."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Go to Imera first.", nextPage: 2, trait: "al85-swore-to-imera" },
                { text: "Go straight to the Kage's orchard office.", nextPage: 3 },
                { text: "Ask Toma why he's stopped calling you 'friend.'", nextPage: 1, requireTrait: "toma-doubt" }
            ] },
            { ...storyPage("Jonin", "The square's edge", "Toma Reed", [
                "You noticed. I wondered if you would.",
                "You told me to burn Aren's letter. You said it would prune me too. You were probably right, and I did not burn it, and I stopped being able to say the word friend at the same time. Those two facts are related.",
                "I'll follow you today, Jonin. You're good at this, and fourteen people need somebody good at this.",
                "But when it's over, you and I are going to sit at my mother's table, and you're going to tell me whether you actually believe proof is worth less than safety. Depending on your answer, the word comes back."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Go to Imera's house.", nextPage: 2 }
            ] },
            { ...storyPage("Imera's Kitchen", "The house behind the eleven-flower fence", "Imera", [
                "Don't say you're sorry. Everyone who says sorry stirs their tea afterward, and I am done watching people stir tea.",
                "You hid a flower for us once. I haven't forgotten. So I'll tell you what I can't tell the survey office.",
                "They let me visit her yesterday. She's HAPPY. Warm, well fed, doing puzzles for clerks who write down how she solves them. They are measuring my daughter for that fire, and she thinks the village finally noticed her.",
                "Her first loom is still under her bed. If they take who she was going to be, and leave me some quiet girl who likes sitting still, I want you to bury that loom with me. Promise me that. Then go do whatever a person with a black flower can do."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Go to the orchard office.", nextPage: 3 }
            ] },
            { ...storyPage("The Orchard Office", "The Kage's office, rain on new grafts", "Kage Hoshina Enju", [
                "You've seen the lists. You've come to tell me they're monstrous. Sit down first. You'll argue better without your fists clenched.",
                "Before you start, I want to give you two numbers. The winter of the split oak killed forty one people. The granary winter killed twenty six, and most of those were children. I was a girl for the first one and Kage for the second.",
                "Since the second one, I have kept this village warm for thirty years, and no child here has frozen. Not one. Those fourteen names on the wall are the price of the next thirty.",
                "Now argue with me. I mean it. Nobody has argued with me properly in years, and I find I miss it."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "\"Fourteen people are not firewood.\"", nextPage: 4 },
                { text: "Show her your own scarred line. Make it personal.", nextPage: 5, requireTrait: "al70-claimed-the-name" },
                { text: "Ask her exactly what the fire does with the unwilling.", nextPage: 6 }
            ] },
            { ...storyPage("Not Firewood", "The orchard office", "Kage Hoshina Enju", [
                "No. They're not firewood. They are four hundred people's warm winters, wearing fourteen faces. That is the actual arithmetic, and I notice you haven't offered me different numbers.",
                "You think I don't know their names? Sena, nine years old, builds machines that walk. The survey brings me her little wonders twice a year, and I keep every one of them. There is a whole room.",
                "You are not the first person to stand in front of this desk and call me a monster. You might be the first one who could actually stop me. So do it properly.",
                "The burning is at frost-fall. You have until then to bring me a better winter. I am not being cruel. It is the genuine condition: show me how this village survives the cold without the fire, and the fourteen walk free."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Leave her office.", nextPage: 7 }
            ] },
            { ...storyPage("The Scarred Line", "The orchard office", "Kage Hoshina Enju", [
                "Your page. Yes. I have read it more times than any record on my wall.",
                "Somebody pruned you before you ever reached this village. No stamp, no season mark, no record of grief. Do you understand why that horrifies me, of all people? I keep records of every cut. I mourn what I take. Whoever cut you kept NOTHING.",
                "When you stood at my wall and demanded your own future back, that was the day I started losing sleep over you. Nobody demands it back. The pruned don't know to ask. That is the entire mercy of the system.",
                "So believe me when I say this, one wounded thing to another: I am not the worst gardener you will ever face. Frost-fall. Bring me a better winter, or watch me buy the usual one."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Leave her office.", nextPage: 7 }
            ] },
            { ...storyPage("The Unwilling", "The orchard office", "Kage Hoshina Enju", [
                "You want the mechanics. All right. You've earned the honest version.",
                "The founders' fire ran on futures given freely, and it ran thin. Gladness is a poor fuel. Two safe winters a generation, and after that, the cold got a vote again.",
                "An unwilling future burns four times hotter. Five, if the person is young. There. Now you know the price of every warm floor you have ever stood on in this village, including the one under your feet right now.",
                "I didn't build that equation. I inherited it, the way you inherit a roof. And nobody tears off the roof in winter because they've learned to hate the shingles. Frost-fall, Jonin. Bring me a better winter."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Leave her office.", nextPage: 7 }
            ] },
            { ...storyPage("The Detention Rows", "Outside the rows, the Elder Champion at the gate", "Narrator", [
                "The Rootbound Elder Champion stands at the detention gate. It has guarded the elders' orders for so long that bark has grown over its armor.",
                "Through the fence, a small girl waves at you cheerfully and holds up a finished puzzle for you to admire.",
                "Frost is three days out. The kiln flue is already warming. And under Toma's coat, held like a heartbeat, is a small wooden loom that knows how to play dead."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp" },
        ], [
            { text: "Break the rows open tonight. All fourteen, into the dark.", conclusion: "Fourteen futures scatter into the treeline before the alarm bell finds its voice. The transfer depot burns behind you, and with it the only manifest that carried her seal. By morning she is calling it a kidnapping, and half the cold village believes her.", trait: "merciful" },
            { text: "Challenge the Champion at the gate, in daylight, before everyone.", conclusion: "The square fills fast. Whatever happens next will have three hundred witnesses, which is the entire point, and no second plan, which is also, somehow, the point. Deep in its bark, the old Champion creaks into something like a smile.", trait: "reckless" },
            { text: "Let the transfer start, and shadow the crates to her private room.", conclusion: "Two detainees ride the first wagon while you follow in the dark, and every step of not acting costs you something you will pay for later, in dreams. But by midnight you know where the wonder room is. Sena's machines are in it. So is your page.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 100, "The Tree Must Choose", "Kage Hoshina Enju, First Flame Vessel", "🌿", [
            { ...storyPage("Frost-Fall", "The Register hall, every line glowing faint", "Narrator", [
                "Frost-fall, and the Register wall is lit from inside, forty strides of lives glowing like banked coals. The hall is empty. She sent everyone home warm.",
                "Your black flower has grown all season. Tonight its petals are fully open, and for the first time, the whole bloom is leaning in one clear direction: toward the kiln stair.",
                "The stair door stands unlocked. On the top step sits a plate of honey bread, still warm, and a note in a keeper's steady hand: 'You were always going to come tonight. Eat something first.'"
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("At the Stair", "The kiln stair door", "Toma Reed", [
                "I know. You have to go down alone. I practiced a whole speech about it and it had more dignity in the mirror.",
                "Take Aren's letter with you. He wrote 'remember me arguing,' and tonight is the biggest argument this village has ever had.",
                "Whatever happens down there, my mother's kitchen has tea in it afterward. I need you to plan on that. Having an afterward is half of winning.",
                "Go. I'll hold the door. It's what shelf menders are for."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Go down alone.", nextPage: 2 }
            ] },
            { ...storyPage("The Keeper at the Fire", "The Rootfire chamber, racks emptied, shears on an anvil", "Kage Hoshina Enju", [
                "You're punctual. I appreciate that tonight of all nights.",
                "There they are. The shears. Four hundred years of keepers have held them, and I have held them longest of all. I took them out this morning to clean them, and then I noticed I had been holding them for six hours.",
                "I cut my first future at thirty one. A boy whose bridge would have redirected the flood and drowned the low fields. I have been right, over and over, for thirty years.",
                "And tonight I am going to show you what being right that long does to a person."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("The Vessel", "The fire climbing her arms like ivy", "Kage Hoshina Enju", [
                "It started in the spring. The fire coming when I call it. Then coming when I don't.",
                "Every future I ever fed it is inside me now. The bridge boy hums in my wrists when it rains. The weaver's school runs lessons in my sleep. I am becoming the room where the village keeps its stolen wonders.",
                "And the honest thing, the thing I need one person to hear me say out loud: part of me thinks I've earned it. That is how the fire wins, in the end. It agrees with you.",
                "So. You, the one line my wall could never read. Ask your questions. Then we settle it, you and I and the fire."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("Answer for Mori's charts. You've known the pattern for years.", "The reckoning", "Kage Hoshina Enju", [
                "So Mori finally taught someone to read the blooms. Good. Then you've stood where I stand. You've looked at a flower on a fence and known exactly what it was going to cost that family.",
                "Tell me you never once looked at a bloom and thought: better if it wilts early, before the survey sees it. Say it, and I'll call you a liar to your face.",
                "That thought is my entire life. One flower, one house, one winter, every day, for thirty years. You carried the knowledge for one season and look what it did to you."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. The tree chooses now.", nextPage: 8 }
            ] },
            { ...storyPage("Answer for my page. You kept my cut in your wonder room.", "The reckoning", "Kage Hoshina Enju", [
                "Yes. Your stub is in my room of taken things. The oldest cut I have ever handled, and the only one that isn't mine, and I couldn't burn it and I couldn't repair it, so I kept it. That is what keepers do. We keep.",
                "You stood at my wall and demanded yourself back. Nobody does that. The pruned never know to ask. You knew, and you asked, and I have not slept properly since.",
                "When you hold the shears, and I believe now that you will, go find whoever cut you. And when they explain themselves with arithmetic, the way I have tonight, remember me a little kindly."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. The tree chooses now.", nextPage: 8 }
            ] },
            { ...storyPage("Answer for Aren Reed. His future gets finished.", "The reckoning", "Kage Hoshina Enju", [
                "Aren Reed. The water-screw. The complaint written in a shaking hand. You promised his brother it gets finished. I know, because I countersigned Aren's cut myself. Mine was the approving stamp.",
                "Here is the part I have never told a living person. I tested his screw. Alone, at night, in this room. It worked. It would have watered the east terraces and fed ninety more mouths.",
                "And his complaint would have emptied my kiln within five years, so I chose the kiln. That is the cut I mourn at every frost-fall. Tell his brother that, afterward. Tell him his Kage tested the screw, and it worked, and she burned him anyway. He deserves to hate me accurately."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. The tree chooses now.", nextPage: 8 }
            ] },
            { ...storyPage("Show her the better winter.", "The reckoning", "Kage Hoshina Enju", [
                "What is that. Show me. Slowly.",
                "Aren Reed's water-screw. Rebuilt. You put it in the terrace channels, didn't you. That's why the survey found the east fields wet in a dry week. I read that report three times and refused to understand it.",
                "Say the numbers out loud. Ninety mouths from the terraces alone, without one future burned. And Jorun helped you build the housing, because his hands still remember what the survey cut out of his head. His HANDS remembered.",
                "Thirty years, I asked every angry person who stood in front of me to bring me a better winter. You are the first one who walked in carrying it. So now we find out what I actually am, because I am out of arithmetic."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. The tree chooses now.", nextPage: 8 }
            ] },
            { ...storyPage("The Shears on the Anvil", "The Rootfire at full roar, Hoshina alight", "Kage Hoshina Enju", [
                "Enough talk, then. Look at me. Thirty years of being the answer to winter, and this is what's left, and I would do every year of it again. That is exactly why it has to be taken from me.",
                "The shears, the fire, and a wall of futures upstairs. Somebody decides tonight what this village runs on. The fire has already cast its vote.",
                "Show me, black flower. Show me what grows where nothing was permitted to."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", leftName: "Player", rightName: "Kage Hoshina Enju", rightImage: "/portraits/kage-hoshina-enju-hollow.webp", choices: [
                { text: "Answer for Mori's charts. You've known the pattern for years.", nextPage: 4, requireTrait: "al58-took-the-knowledge" },
                { text: "Answer for my page. You kept my cut in your wonder room.", nextPage: 5, requireTrait: "al70-claimed-the-name" },
                { text: "Answer for Aren Reed. His future gets finished.", nextPage: 6, requireTrait: "toma-hope" },
                { text: "Show her the better winter.", nextPage: 7, requireTrait: "al65-saved-the-screw" }
            ] },
        ], [
            { text: "Break the shears on the anvil. Give every future back.", conclusion: "The shears part with a sound like a held breath ending. Upstairs, forty strides of cedar cry out at once as every stolen self comes home mid-life. The walls groan, because the ash in them was load-bearing. The winter will be honest now, and hard, and hers. Hoshina attacks you weeping with relief.", trait: "honorable" },
            { text: "Bind the Rootfire to willing gifts alone. Sheathe the shears forever.", conclusion: "The fire shrinks to the founders' flame, old and thin and clean. From tonight, Ashen Leaf must ask for its warmth honestly, and every hard winter will be a vote on your mercy. Hoshina bows to the arrangement, and then the fire wearing her does not, and it comes at you all the same.", trait: "merciful" },
            { text: "Take the shears. The village needs a keeper who was never fooled.", conclusion: "The grips are warm, and they fit your hand exactly, and you understand all at once why: the Register has been growing you toward this room since the day it bloomed. Hoshina smiles like winter finally breaking. 'Then prove it,' says the fire, with her mouth.", trait: "ambitious" },
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
