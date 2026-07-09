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
    const finalPages = pages.map((page, index) => index === pages.length - 1
        ? { ...page, choices: choices.map((choice) => ({ ...choice, nextPage: index, battle })) }
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
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
            { ...storyPage("Before the Bell", "Ringside, thunder over the cliffs", "Elder Vanta", [
                "Elder Vanta: He'll rush you. They always rush the small ones.",
                "Elder Vanta: Being underestimated is a weapon somebody else hands you free. Around here it's the only free thing.",
                "Elder Vanta: Lose, and the ledger books you a rematch. Win, and it books you something harder. The board doesn't do rest.",
                "Elder Vanta: Thunder first, then the strike. Or so the saying goes."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
        ], [
            { text: "Go before the thunder lands.", conclusion: "Mira whoops from the rail. The scout stops yawning and sets his feet.", trait: "reckless" },
            { text: "Circle him. Watch the feet, not the hands.", conclusion: "By the fourth step his rhythm shows, same three beats every time. On the rail, Vanta stops pretending not to watch.", trait: "suspicious" },
            { text: "Tell the clerk to raise the purse first.", conclusion: "The clerk pencils new odds without looking up. Somewhere behind you, coin changes hands.", trait: "ambitious" },
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
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("The Guard Line", "Market square, guard line forming", "Tempest Guard Captain", [
                "Tempest Guard Captain: Square's closed by order of Kage Raiko. All fighters are booked guilty. Both sides.",
                "Tempest Guard Captain: You, rookie. Hauling the bleeder. Set him down and walk, or your name goes on the punishment wall with theirs.",
                "Tempest Guard Captain: The ledger sorts it in the morning. It always does."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
        ], [
            { text: "Stand over the wounded man. He's not walking.", conclusion: "Mira plants herself at your shoulder without being asked. The Captain rolls his neck and signals the line forward.", trait: "merciful" },
            { text: "Challenge the Captain, by name, in the open square.", conclusion: "The line goes still. A captain called out in the square can't decline; refusing costs more than losing, and everyone here knows the price.", trait: "reckless" },
            { text: "Hold up the tallied order. Ask who counts.", conclusion: "His eyes go to the tick marks and stay one beat too long. 'Confiscated,' he says, and reaches.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 25, "Orders Written in Lightning", "Lightning-Sealed Informant", "⚡", [
            { ...storyPage("The Lifted Scroll", "A dry loft over the smithy", "Mira Volt", [
                "Mira Volt: I lifted this off the informant before the Guard swept the square. Don't make the face. You'd have done it slower.",
                "Mira Volt: Seal's genuine. Checked it against my aunt's pension letter. So the Kage's office ordered its own riot, or somebody borrows his wax.",
                "Mira Volt: And there's the tally again. Same hand as the riot orders. Eleven marks, then a line under, like something got paid off.",
                "Mira Volt: Even the unsworn woman asked about it. She doesn't ask free questions."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
            { ...storyPage("The Back Stair", "Vanta's office above the arena gate", "Elder Vanta", [
                "Elder Vanta: There's a saying: paper burns, orders don't. I used to like that one.",
                "Elder Vanta: The first exiles cut a shaft under the arena before they raised one roof. My grandmother swung a pick on it. She never said toward what.",
                "Elder Vanta: She did say the founders argued over this site for a year, then stopped all at once. Not one of them could remember what the argument was.",
                "Elder Vanta: Leave the scroll. Post no challenges this week. Humor an old man."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
            { ...storyPage("Out of the Ink", "The same loft, lamp guttering", "Unknown Voice", [
                "Unknown Voice: Eleven marks. One line. Paid in full.",
                "Unknown Voice: You are the loud one from the square. We hear you when you argue. You argue beautifully.",
                "Unknown Voice: Post a challenge. Any name. See how fast the week improves.",
                "Unknown Voice: The old man knows the stair. Ask what it cost to cut."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
        ], [
            { text: "Take the back stair tonight, alone.", conclusion: "The stair is where Vanta said, behind the arena gate. The informant waits on the third landing, smiling like a receipt.", trait: "reckless" },
            { text: "Put the scroll in Vanta's hands and stay.", conclusion: "He reads it twice and locks the door once. 'Then we do this in the open,' he says, as the informant steps out of the stairwell.", trait: "honorable" },
            { text: "Copy the tally. Burn the rest.", conclusion: "The marks copy clean; the wax spits blue as it burns. By the last stroke the informant is on the roof beam, counting along.", trait: "suspicious" },
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
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("The Well-Keeper", "The engine platform, wards waking", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Touch nothing. Ask here, where the answers live.",
                "Kage Raiko Veyr: Every dry roof in Stormveil is this room. Every wall the coast never took. Want it stopped? Say so. Then name who goes thirsty first.",
                "Kage Raiko Veyr: The Elder calls it hunger. Call it a well.",
                "Kage Raiko Veyr: The Warden keeps the rota, not my orders. Get past him and I'll walk you through the gauges myself."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
        ], [
            { text: "Say it stops. To his face.", conclusion: "Raiko smiles like a bout just got posted. 'Argue with the Warden first,' he says, and the rota-keeper steps down off the platform.", trait: "honorable" },
            { text: "Go for the crystal core, now.", conclusion: "Three steps from the core, the Warden lands between, both hands live. Above you, the rings don't even slow.", trait: "reckless" },
            { text: "Read the chalked figures at the junctions first.", conclusion: "The newest chalk isn't a figure. It's a name, half scrubbed, and the Warden moves the moment you find it.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 50, "Jonin of the Unchained Sky", "Jonin Rank Trial: Twin Tempest Duelists", "⚡", [
            { ...storyPage("The Balcony", "Kage tower balcony, crowd below", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Look down. Count. Every one of them climbed here to watch the long-odds fighter take rank.",
                "Kage Raiko Veyr: Stormveil promotes impact. You hit the square, the Guard, my informant, my Warden. Good. Hit harder.",
                "Kage Raiko Veyr: One custom first. Every new Jonin posts a sworn rival. Lifetime bout, open date. The board keeps it forever.",
                "Kage Raiko Veyr: Pick a name. Pick mine, if you've got the spine."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp" },
            { ...storyPage("Edge of the Crowd", "The stair below the balcony", "Mira Volt", [
                "Mira Volt: Don't look at me, look at him. You dug up his basement and he's proud of you. Kage-proud. That's a weather warning, Sparkplug.",
                "Mira Volt: A sworn rivalry never comes off the board. My mother's is still posted. Six years gone, and her name still draws.",
                "Mira Volt: ...Whatever name you give them, they keep."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp" },
            { ...storyPage("The Rite", "Arena floor, trial ring chalked", "Elder Vanta", [
                "Elder Vanta: The Twin Duelists take the rank trial. Two against one. That part's honest, at least.",
                "Elder Vanta: There's a ceremony saying. 'The sky crowns the loud.' I'm not going to say it.",
                "Elder Vanta: Fight well. And sign nothing while your blood's up. The board loves fresh Jonin best of all."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp" },
        ], [
            { text: "Take the trial. Refuse to post a rival.", conclusion: "The square goes quiet in a way the riot bell never managed. Raiko signals the Duelists before the murmur can build.", trait: "honorable" },
            { text: "Write Raiko's name on the board.", conclusion: "The clerk's pen actually stops. Raiko laughs once, from the chest, and waves the Duelists forward like a gift.", trait: "reckless" },
            { text: "Post a rival who died years ago. Watch.", conclusion: "The clerk books it, open date, no hesitation. So the board keeps names it can never settle. The Duelists are already stretching.", trait: "suspicious" },
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
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
            { ...storyPage("The Ridge", "The ridge above the camp", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Up here. Look at me when you decide.",
                "Kage Raiko Veyr: Forty people quit paying for the roof and stand under it anyway. That's the whole charge. Convict, or don't.",
                "Kage Raiko Veyr: Obey and you're a wall. Refuse and you're interesting. Decide fast. The squad bills by the hour."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
        ], [
            { text: "Get between the squad and the tents.", conclusion: "The medic starts moving the wounded before you finish turning around. On the ridge, Raiko sits down to watch.", trait: "merciful" },
            { text: "Take the camp's surrender. Loudly. On record.", conclusion: "You say it loud enough for the ridge to hear. The squad's answer is to fan out, which is also on record.", trait: "honorable" },
            { text: "Signal compliance. Then misdirect the sweep.", conclusion: "The squad takes your heading and combs the empty fork. One bad hour bought; the squad leader is already rechecking the map.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 75, "Mira's Betrayal", "Mira Volt, False Betrayer", "⚡", [
            { ...storyPage("Sigils", "The cliff stair, no lanterns", "Mira Volt", [
                "Mira Volt: Before you draw, count the sigils. Guard cloak. Captain's knot. I know.",
                "Mira Volt: Raiko thinks I sold you. I sold him that story myself, full price, and the ravine families came off the squad rosters the same week.",
                "Mira Volt: Somebody writes those rosters, Sparkplug. For a while, it was going to be me or nobody.",
                "Mira Volt: ...There wasn't a version where telling you sooner kept you alive. I checked. I kept checking."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp" },
            { ...storyPage("The Copied Key", "The stair landing, key humming", "Mira Volt", [
                "Mira Volt: He keeps the real one in the tower vault. Four months to copy the wardstamp. Look at it.",
                "Mira Volt: The Engine's a spigot. This opens whatever the spigot drinks from. He says 'my gate key' like there's a door somewhere that owes him.",
                "Mira Volt: The plan needs him to believe I'd cut you down in the square. Which means, and I want it noted that I hate this plan—"
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp" },
            { ...storyPage("Noted", "The stair, the storm listening", "Hollow Gate Echo", [
                "Hollow Gate Echo: Noted. We note everything.",
                "Hollow Gate Echo: Friend against friend posts the sweetest bout. The board never taught you that. The board learned it from us.",
                "Hollow Gate Echo: Fight her well. Fight her badly. Both spend the same."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp" },
        ], [
            { text: "Trust her. Stage the bout, full speed.", conclusion: "She breathes out like she's held it four months. 'Third exchange,' she says. 'Make it ugly.'", trait: "loyal" },
            { text: "No stage. If we fight, we fight.", conclusion: "'Of course that's your version,' she mutters, and the joke never reaches her hands. The captain's knot comes off her shoulder first.", trait: "reckless" },
            { text: "Keep the key. I finish this alone.", conclusion: "Her grin comes up like a shutter. 'Then take it off me, Sparkplug.' The nickname has never sounded less like one.", trait: "ambitious" },
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
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
            { ...storyPage("The Voice in the Thunder", "Every street at once", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Hear me, Stormveil. Fight tonight and be remembered. Hide, and be weather.",
                "Kage Raiko Veyr: The coast calls us banditry with a flag. Let them come count our chains. Count them. There are none.",
                "Kage Raiko Veyr: My General holds the square. Take it from him, or kneel in the rain with the rest."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
            { ...storyPage("The Drain", "Rooftop over the square", "Mira Volt", [
                "Mira Volt: They're answering him. Dock crews, cliff guilds. The academy kids are sharpening practice steel, which would be funny any other night.",
                "Mira Volt: The General's the surge valve. Every bout that starts tonight routes through his square like a drain.",
                "Mira Volt: ...We stop him there, or nowhere."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
        ], [
            { text: "Rally every faction to one banner first.", conclusion: "The dock crews come for Mira, the cliff guilds for the long odds you used to be. Nobody comes for a speech, so you don't give one.", trait: "loyal" },
            { text: "Walk into the square and take the General.", conclusion: "The crowd parts the way it does for a posted bout. Overhead, the cyclone tightens like something leaning in.", trait: "reckless" },
            { text: "Shear the junctions feeding the square first.", conclusion: "Three chalk-marked junctions shear clean and the gauges dip for the first time all night. Above, the General starts asking who's under his floor.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 100, "Break the False Thunder", "Kage Raiko Veyr, Hollow Storm Tyrant", "⚡", [
            { ...storyPage("The Eye", "Tower gate, inside the storm's eye", "Narrator", [
                "Narrator: The tower stands in a round of still air. Below it, for the first time in living memory, the challenge board hangs empty.",
                "Narrator: The village didn't hide. It climbed. Rooftops, cliff rails, the arena rim, every face turned up toward the eye.",
                "Narrator: Somebody has left the maintenance mop leaning against the throne-room door."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp" },
            { ...storyPage("The Ledger", "The throne room, wards humming", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: In. Close the door.",
                "Kage Raiko Veyr: You know the room under the arena. You know what's under the room. So hear what no Kage says out loud.",
                "Kage Raiko Veyr: I found the ledger the day I took this seat. Same as the man before me. Same as the woman before him. I read it, and I signed.",
                "Kage Raiko Veyr: Every Kage signs. The seat comes with the valve. Tell me you'd have starved the village instead. Say it slowly."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Answer for the ninth.", requireTrait: "sv58-took-the-cut", nextPage: 2 },
                { text: "Answer for the voided bout.", requireTrait: "sv70-read-the-mark", nextPage: 3 },
                { text: "Answer for the column behind me.", requireTrait: "sv92-fear-column", nextPage: 4 },
                { text: "Skip the ledger. Post the bout.", nextPage: 5 }
            ] },
            { ...storyPage("Answer for the ninth.", "The reckoning", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Vanta's ninth sits in your name. I countersigned the transfer myself.",
                "Kage Raiko Veyr: You've drawn off this village since the day he offered. Same book. Same blank header. Mine.",
                "Kage Raiko Veyr: So drop the clean hands. Take the rest of the column. It's what I did."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 5 }] },
            { ...storyPage("Answer for the voided bout.", "The reckoning", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Tenth slot, routing mark, and you read it to the whole square. Three clerks gone by morning.",
                "Kage Raiko Veyr: You cost me a season of bookkeeping. Nobody's cost me a season in twenty years.",
                "Kage Raiko Veyr: So the board is clear tonight. No marks. No book. Show me the square wasn't theater."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 5 }] },
            { ...storyPage("Answer for the column behind me.", "The reckoning", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Pike's scared half. You marched them up my mountain, counting your steps.",
                "Kage Raiko Veyr: Fear that follows is the oldest draw there is. You brewed it in one evening.",
                "Kage Raiko Veyr: Keep them. The seat likes your recipe already."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 5 }] },
            { ...storyPage("Paid in Kind", "The throne floor, wards failing", "Kage Raiko Veyr", [
                "Kage Raiko Veyr: Look at my hands. Forty years of other people's grudges, coming due.",
                "Kage Raiko Veyr: It pays out in kind. I drew rivalry, so it makes me rivalry. I'll want to fight you after I've won. I want the rematch already.",
                "Kage Raiko Veyr: No speeches. The board is empty and the whole coast is on the rails. Give them a final argument worth the seat."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", rightImage: "/portraits/kage-raiko-veyr-hollow.webp", rightName: "Kage Raiko Veyr" },
        ], [
            { text: "Refuse the challenge. Out loud. Before everyone.", conclusion: "The refusal falls on the square like a fourth bell, and the salute you earned at the cliffs never comes. Below the arena the seams go dark, and Raiko attacks anyway.", trait: "honorable" },
            { text: "Accept the bout. After, the valve gets metered and watched.", conclusion: "Raiko grins at 'metered' like a jutsu he's never seen. Down in the ravine, the refusers hear your terms and keep packing; they know what keeping a valve does to keepers.", trait: "suspicious" },
            { text: "The seat, the valve, the ledger. Mine.", conclusion: "For one breath Raiko looks relieved, a man handing off a debt. By the door, Mira sets the copied key on the stone and goes; somewhere below, a boat route finally gets used.", trait: "ambitious" },
        ]),
    ],
    "Ashen Leaf Village": [
        milestone("Ashen Leaf Village", 4, "Roots of the Shinobi", "Wooden Root Guardian", "🌿", [
            { ...storyPage("Sign In", "Register hall, morning queue", "Toma Reed", [
                "You sign in before your first trial. Everyone does. Sorry, I should introduce — Toma. Reed. Grove squad, third year.",
                "The register holds every name in the village. Living on the east wall, dead on the west. The wall decides more than most people admit.",
                "There was a woman here yesterday. Her son's plate went west last spring. She told the clerk she cannot picture his face anymore. Just the plate.",
                "Anyway. Sign. Middle column. Press hard, the cedar is dense."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp" },
            { ...storyPage("The Yard", "Training yard beneath ash-dusted oaks", "Elder Mori", [
                "Stand there. No, the flat stone. Roots come up under the soft ground, new students turn ankles, and then I do paperwork.",
                "You will hear that Ashen Leaf grows its shinobi rather than trains them. Attribute that to me. I said it forty years ago and regret the phrasing annually.",
                "The yard is older than the village. The village is built from its dead — the ash goes into the mortar, and that is not a figure of speech.",
                "Bow to the roots before we begin. Not for luck. For the ones underfoot."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp" },
            { ...storyPage("First Lesson", "The oldest oak splits along its grain", "First Flame Avatar", [
                "New ink. It could be smelled from the wall.",
                "Every student who ever stood on that stone stands under it now. They are the floor. They are listening.",
                "The Root Guardian gives the first lesson. It has given it nine hundred times. It does not tire, and it does not flatter.",
                "Show the floor what it is holding up."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp" },
        ], [
            { text: "Bow to the roots, full and unhurried.", conclusion: "Mori's chin drops a fraction, which from him is applause. Underfoot, the ground feels briefly less like ground.", trait: "honorable" },
            { text: "Watch how the Guardian favors its cracked side.", conclusion: "The split in its bark opens a half-beat before each step. You file that. Old things keep old habits.", trait: "suspicious" },
            { text: "Skip the bow. Strike while it is still waking.", conclusion: "Behind you, Mori begins a sentence and abandons it. The Guardian's eyes finish lighting mid-swing.", trait: "reckless" },
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
                "I was the one vote. Note the wind has changed. Come stand on this side."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("Posted Since Dawn", "A young guard blocks the rope line", "Narrator", [
                "The guard at the rope is young. New sandals. Ceremonial sash tied by someone else's hands.",
                "Her orders are one sentence, and she has said it four times to four people. Nothing was planted. Move along.",
                "She stands the way people stand when they were chosen for how little they know.",
                "Behind her, one black flower loses a petal. It falls faster than a petal should."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
        ], [
            { text: "Palm a black flower while Mori holds the guard's eye.", conclusion: "The petals weigh wrong, like wet cloth. The initiate sees your hand come back out of the rope line, and her one sentence changes.", trait: "suspicious" },
            { text: "Ask Mori, in front of the guard, what the last bloom cost.", conclusion: "He recites six family names from memory, in order, facing the initiate. She grips her weapon like the names are an accusation.", trait: "honorable" },
            { text: "Go over the rope and find who tends the tree.", conclusion: "You are three steps past the rope when her hand closes on your collar. She is young, but somebody trained that grip.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 25, "Names Removed from Scrolls", "Archive Spirit of the Root", "🌿", [
            { ...storyPage("The Gaps", "Archive stacks, lamps trimmed low", "Elder Mori", [
                "I asked you here because you are not a clerk, which is presently a qualification.",
                "Look at the shelf. Do not look for what is there; count the dowels. Forty slots, thirty-one scrolls. The dust says the other nine left together, and recently.",
                "Whole lines, gone. Not deceased — deceased is the west wall, and the west wall is honest. Gone.",
                "I have found a pattern, and it has the poor manners to be simple. Every removed line questioned the Kage's rites. All within twenty years.",
                "I have served this archive for forty. Prove me wrong by week's end. Please."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
            { ...storyPage("The Letter", "Archive floor, scrolls spread flat", "Toma Reed", [
                "My brother's name is Aren. Was. Is — sorry. I no longer know which.",
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
            { text: "Copy the nine erased names while the Spirit advances.", conclusion: "Ink smears under your speed but all nine names hold. The Spirit's head turns toward the wet page first.", trait: "suspicious" },
            { text: "Burn the falsified shelf and let the record die honest.", conclusion: "Thirty-one scrolls of curated history catch fast. The Spirit stops pretending to be slow.", trait: "reckless" },
            { text: "Declare the pattern for the record, Kage's name and all.", conclusion: "Toma flinches at the name said plainly. The Spirit does not; it simply reclassifies you, and comes on.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 35, "The First Flame Chamber", "First Flame Sentinel", "🌿", [
            { ...storyPage("Sixty Steps", "A root-stair descending under the oldest tree", "Narrator", [
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
                "Three things. One: no smoke. Two: no fuel. Three: the floor slopes toward it, and the stones are worn smooth in lanes. Queue lines. People walked in orderly.",
                "Somebody has been feeding it on schedule. The rota upstairs goes back years. I want to know what the deliveries were.",
                "Sorry. I already know. I just wanted to be wrong out loud first."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
            { ...storyPage("The Mouth's Guard", "The fire stands up", "First Flame Avatar", [
                "The Flame keeps the given. That is the whole of its law.",
                "It kept the willing for two hundred years. Then it was brought the unwilling, and it kept them too, because keeping is all it knows.",
                "The Sentinel guards the mouth. It does not ask how a gift arrived. No one has ever taught it the difference.",
                "You are standing in the lane where the gifts walk. Prove you are not one."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
        ], [
            { text: "Smother a rank of the Flame and see what it uncovers.", conclusion: "Where the fire dies back, the floor is inlaid with names, packed edge to edge, spiraling inward. The Sentinel is already moving.", trait: "reckless" },
            { text: "Find the delivery ledger by the mouth before it reaches you.", conclusion: "There is a ledger stand by the mouth, empty, its dust ring fresh. Someone cleared it for your visit, and the Sentinel steps between you and the question.", trait: "suspicious" },
            { text: "Put the Sentinel down and seal the chamber behind you.", conclusion: "Toma is already stacking rota papers against the door for kindling. The Sentinel comes out of the mouth like a man defending his house.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 50, "The Branch That Rises", "Jonin Trial: Rootbound Master", "🌿", [
            { ...storyPage("Summons", "Kage hall, incense already lit", "Elder Mori", [
                "A promotion, and you did not apply. Savor how that feels. It will feel different shortly.",
                "The rank is real. The trial is real. The Rootbound Master has broken candidates I would have sworn were oak.",
                "It is the oath after the trial you should read twice. There is a clause about the register. There is always a clause about the register.",
                "I will be on the left, with the other relics. Try not to look at me when you decide. It flatters neither of us."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
            { ...storyPage("Line Nine", "An antechamber, the oath scroll on a stand", "Toma Reed", [
                "I copied the jonin oath while you were being measured for the sash. The clerks let me. Nobody watches the earnest ones.",
                "Line nine. You swear the register is whole and true, and to defend its wholeness. Whole. True. In the same breath as your blood and your blade.",
                "Everyone before you swore it. Every jonin in that hall has already sworn the wall is honest.",
                "She wants you sworn too. I think — sorry. I think a jonin who swore is worth more to her than a chunin who counts."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
            { ...storyPage("We Keep", "The dais, the Kage in dark green", "Kage Hoshina Enju", [
                "Approach. We are told you serve this village with more attention than comfort. Good. Comfort is what the dead buy for us. Attention is the interest we owe.",
                "The oath is old. We did not write it; we only keep it. You will find that keeping is the whole of the office.",
                "Swear, and rise a branch of this tree. The dead hold the walls, and the living hold the dead. That is the entire arrangement.",
                "Take the sash. The trial waits below. The Master does not."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
        ], [
            { text: "Swear it flat and even. Keep your counting to yourself.", conclusion: "Line nine goes past your teeth without catching. On the left, Mori studies the incense as if it had misfiled something.", trait: "suspicious" },
            { text: "Swear, then ask her before the hall what she expects for it.", conclusion: "She answers without pausing: everything we keep, kept. The hall takes it for liturgy. She holds your eye a beat too long for liturgy.", trait: "honorable" },
            { text: "Refuse line nine until the nine missing scrolls are answered for.", conclusion: "The incense burns on through the quiet you have made. Hoshina signals the trial anyway, which tells you the sash was never the point.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 65, "The Mission of Quiet Ash", "Rootbound Retrieval Squad", "🌿", [
            { ...storyPage("Crate Two", "Outer grove, relic crates half-buried", "Toma Reed", [
                "I stole them. I want that on the table before you decide anything. Forty-four name plates, out of the destruction queue.",
                "Aren is in here. Crate two. I have not opened crate two.",
                "They were scheduled to burn because they are proof. Every plate is a person the wall says never lived. Plates disagree, and plates cannot testify. So they burn.",
                "The retrieval squad drew the assignment at noon. Ordinary squad. I know two of them. One owes me a funeral favor.",
                "Sorry. That is everything. Now you can decide."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
            { ...storyPage("Precision by Omission", "The grove, wind turning, dusk coming", "Elder Mori", [
                "The order sheet says stolen ritual property, recovery by force if refused. It does not say what the property is. Precision by omission — the oldest tool in the annex.",
                "The squad believes it. Belief is cheap when the paperwork is tidy, and I have spent a career making paperwork tidy, so attribute the observation.",
                "If they take the crates, the names burn uncontested. Uncontested is the only way the fire profits. You have heard the arithmetic called mercy. Tonight you may audit it.",
                "Whatever you choose, choose before the light goes. Retrieval squads prefer the dark. Fewer witnesses to retrieve."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
            { ...storyPage("The Standard Offer", "Lantern signals in the trees", "Narrator", [
                "The squad comes proper: three wings, low lanterns, blades still wrapped. Procedure, done kindly.",
                "Their captain calls the standard offer in a bored voice. Return the property, and no names go in the report.",
                "No names in the report. Toma laughs once, wrong, like a hiccup.",
                "The crates sit between you. Crate two has a handprint in the dust where somebody almost opened it."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
        ], [
            { text: "Guard the crates. Drop the squad without drawing blood.", conclusion: "Wrapped blades stay wrapped; that mercy is a language squads understand. Their captain sighs like a man asked to work in the rain, and signals the advance.", trait: "merciful" },
            { text: "Bury the crates and let the squad find you instead.", conclusion: "Fresh earth under old needles, and Toma memorizes the bearing twice. When the lanterns arrive there is nothing behind you, which makes you the only evidence.", trait: "suspicious" },
            { text: "Send the crates away with Toma and hold the grove alone.", conclusion: "He argues for exactly three seconds, then takes the handles. The last you see of crate two is his knuckles white on it, and then the lanterns are on you.", trait: "loyal" },
        ]),
        milestone("Ashen Leaf Village", 75, "The Ancestors Speak", "Ancestor-Bound Flame Beast", "🌿", [
            { ...storyPage("The Wall Annotates Itself", "Old archive at night, west wall alight", "Elder Mori", [
                "Come and look before it decides to stop. The west wall is annotating itself.",
                "Every name that went to the fire willing burns steady. See the founding rows — even light, no flicker. Content, if light can be content.",
                "And there. The gaps. The erased lines glow at the edges, like a page held over a candle. The archive has noticed what it is missing.",
                "Forty years I kept this room. It never once corrected me. I find I am moved, and at my age that is a medical concern."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp" },
            { ...storyPage("Reading Aloud", "West wall, the recovered plates unwrapped", "Toma Reed", [
                "The founders answer when you read them. Watch. Isu Reed, joiner. See the light lean?",
                "They chose it. Every steady light on this wall walked down those stairs to buy the village a winter. The stolen ones do not answer. They wait.",
                "I am going to read all forty-four. Out loud, into the wall, and the wall can do what it likes with the difference.",
                "Aren Reed. Filed his complaint through the right office."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp" },
            { ...storyPage("The Keeper Wakes", "The wall bulges; fire takes a shape", "First Flame Avatar", [
                "The willing left a guard behind them. They gave everything but their grievance. The grievance was bound here, to keep the count honest.",
                "It wakes when stolen names come home. It has waked twice in the village's whole history. Both times, it could not tell rescuer from thief.",
                "It will read you the only way it can.",
                "Stand still or stand ready. It does not honor a third option."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp" },
        ], [
            { text: "Call the forty-four names into its fire, one by one.", conclusion: "Toma feeds you names and you call them into the roar. Around the ninth, the Beast stops circling; it needs to know if you flinch.", trait: "honorable" },
            { text: "Pull it off the wall and out into the yard.", conclusion: "You take its eye with a thrown lamp and run. It follows you out through the doorway without using the doorway.", trait: "reckless" },
            { text: "Let it burn the forged rows. Guard the true ones.", conclusion: "You wager it knows its own dead better than the clerks do. The forged rows go up like they were waiting to, and the Beast turns to see who is editing.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 85, "The Kage Burns the Future", "Rootbound Elder Champion", "🌿", [
            { ...storyPage("The Proclamation", "Market square, guards working a list", "Narrator", [
                "The proclamation is nailed to the register hall by breakfast: novel works to be surrendered for assay, their makers detained for questioning.",
                "Fourteen taken by noon. A kiln-builder. A girl who improved the water screw. Three are children whose crime is a kite that steers.",
                "The crowd does not riot. The crowd forms a queue at the register to check the spelling of the detained's names.",
                "The clerks sharpen fresh styluses. They have been told to expect entries."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp" },
            { ...storyPage("The Count", "Rooftop over the holding yard", "Toma Reed", [
                "No apologies this time. Just the count.",
                "Fourteen names, none with standing family — I checked all fourteen. Two orphan makers. The kite girl's parents are west wall already. Every one would grieve uncontested.",
                "This is not fear of invention. Invention is the excuse the council will believe. It is a harvest, sized for something.",
                "She is paying down something large, and she picked people whose grief has nowhere to go but the Flame. Say I am wrong. Take your time. You cannot."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp" },
            { ...storyPage("No Third Door", "The annex, cabinet standing open", "Elder Mori", [
                "I have defended the arithmetic in this room for forty years. One name, forty lives. You have heard me say it, or heard of me saying it.",
                "Fourteen at once is not arithmetic. Fourteen at once is a withdrawal. Something under us has presented a bill, and she intends to pay early.",
                "I signed three of the old choices myself. I am not clean, and I will not pretend to be, because you would smell it.",
                "The Elder Champion holds the yard. Forty years of service, every year of it sincere. He is my generation's best argument, and tonight there is no third door."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp" },
        ], [
            { text: "Break the holding yard open before the escort forms.", conclusion: "Fourteen makers scatter into the dark with their spelling still their own. Between you and the gate, the Elder Champion sets his feet like a man closing a door.", trait: "merciful" },
            { text: "Call the Champion out by name, in the square.", conclusion: "He accepts with a bow so correct it stings. Forty years of village praise steps into the ring, and the crowd cannot pick a side to pray for.", trait: "reckless" },
            { text: "Go over the yard entirely. Reach Hoshina tonight.", conclusion: "The tower route crosses the Champion's post; there was never a route that did not. He raises no alarm. He simply widens his stance, courteous to the last.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 100, "The Tree Must Choose", "Kage Hoshina Enju, First Flame Vessel", "🌿", [
            { ...storyPage("Green from Root to Crown", "The sacred tree, burning without heat", "Narrator", [
                "The old oak burns green from the taproot up, and does not char. Bark, ash-mortar, register wall — everything the dead are mixed into is lit from inside.",
                "The village comes out and stands in its burning-yard rows without being told. Habit is the last thing to catch fire.",
                "In the register hall, the west wall has gone bright as noon. The east wall, the living wall, is dark.",
                "Under everything, low, a sound like a ledger being balanced."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("The Plates", "Register hall steps, crates at his feet", "Toma Reed", [
                "Forty-four plates. I carried them here myself and nobody stopped me. The guards are all watching the tree like it might say something.",
                "I used to practice speeches for this. I do not need one. She took people whose grief had nowhere to go, and she balanced a village on them.",
                "Whatever happens up there, these go back on the wall. That part is not yours to win or lose. That part is mine.",
                "Go. I will start with Aren."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("The Keeper's Accounting", "Before the burning tree, the Kage unarmored", "Kage Hoshina Enju", [
                "You have come to ask about the names. Good. We keep them. Nothing given to the Flame is lost, only held.",
                "Our predecessor showed us the ledger the night we took the seat. We wept, we prayed, and by morning we understood what the founders bought, and its upkeep.",
                "One name, freely grieved, is a winter of walls. One name uncontested is ten. We chose the ones no one would come for. That is not cruelty. That is stewardship.",
                "The dead hold this village up. They do not resent it. We ask them nightly, and they answer, and you would call their answer the wind.",
                "Come. The Flame wishes to see what we have raised."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Tell her whose name you answer to.", requireTrait: "al70-claimed-the-name", nextPage: 3 },
                { text: "Recite the working copy back to her.", requireTrait: "al58-took-the-knowledge", nextPage: 4 },
                { text: "Answer for the woman at the trough.", requireTrait: "al80-let-her-burn", nextPage: 5 },
                { text: "Enough keeping. Answer for the names.", nextPage: 6 }
            ] },
            { ...storyPage("Tell her whose name you answer to.", "The reckoning", "Kage Hoshina Enju", [
                "You climbed the dais and claimed the name that shames you. Before the morning queue. Aloud.",
                "We know its weight. The register offered more for that name than for any in our keeping — uncontested shame is the purest coin there is.",
                "You spent nothing and kept it. We have never once been able to afford that. Teach us, or join us."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 6 }] },
            { ...storyPage("Recite the working copy back to her.", "The reckoning", "Kage Hoshina Enju", [
                "Mori copied you forty years of the arithmetic, dated, in a fair hand. We countersigned the withdrawal ourselves.",
                "So you have run our sums. One name keeps forty. Tell us which line you found in error. We have looked nightly. There is no line in error.",
                "And you kept the copy. People who mean to burn a thing do not keep it warm and legible."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 6 }] },
            { ...storyPage("Answer for the woman at the trough.", "The reckoning", "Kage Hoshina Enju", [
                "The unsworn fed her born name to the intake, and you sat on the rim and watched the weight go.",
                "What the Flame took of her is here. We keep it. She did not ask for keeping. You did not offer stopping.",
                "Do not mourn her at us. We began exactly as you began: by watching once, and calling it witness."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 6 }] },
            { ...storyPage("The Payout", "The Flame reaches her before you do", "First Flame Avatar", [
                "The Flame keeps the given. She gave it names for thirty years, and every name was entered under hers.",
                "The account is called. She is the largest offering the mouth has ever been owed.",
                "Watch. This is what keeping means when the keeper is kept.",
                "The vessel stands. The Flame wears her the way she wore the village. Decide what you will feed it next."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", rightImage: "/portraits/kage-hoshina-enju-hollow.webp", rightName: "Kage Hoshina Enju" },
        ], [
            { text: "Give the register your name. Pull the stolen ones back.", conclusion: "The intake accepts your name without ceremony, the way it accepts everything. What shamed you is spent now, and forty-four stolen names come home on the price.", trait: "honorable" },
            { text: "Seal the mouth to a trickle only the willing can pass.", conclusion: "The Flame gutters to a lamp that only free offerings can feed. The sealed rows stay dark, and their families' unanswered questions become yours, year after year.", trait: "merciful" },
            { text: "Take the ledger. Decide yourself which names the village can spare.", conclusion: "The arithmetic settles onto you like a sash being fitted. Below, Toma sets down crate two, and does not look up at you again.", trait: "ambitious" },
        ]),
    ],
    "Frostfang Village": [
        milestone("Frostfang Village", 4, "The Pack Survives", "Snow Warden Pup", "❄", [
            { ...storyPage("First Bell", "Frostfang training yard, first bell", "Elder Sova", [
                "Wrists out. Recruits sound off after the marked. You'll learn the order. The order is most of what we teach.",
                "The checked are counted, the counted are kept, the kept are warm. Say it back. Good. Again at last bell.",
                "You came up the pass alone. We don't do that here. There's a word for it — endangerment. The kindest law we have.",
                "Fourth cold snap since thaw. I keep the numbers. The numbers keep you."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
            { ...storyPage("Formation of Six", "The yard, drill forming up", "Captain Yura", [
                "Warden pup slipped its run this morning. We drill with what the day gives us.",
                "It hunts gaps. Your work is to be no gap. Shoulder to shoulder, and nobody's a hero.",
                "Last drill, Dagny went down and Harn stepped over her to hold the line. He held it. He also scrubbed pots for a week. We carry.",
                "New one takes left flank. That's the gap it will pick. Don't take it personally. Take it standing."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
            { ...storyPage("What the Yard Hears", "The pup circling, snow starting", "Narrator", [
                "The pup stops testing the marked and settles its eyes on you. Around the yard, nobody moves out of turn.",
                "At the rail stands Ostrek, carried off the ridge a month back. He thanks Dagny, then Harn, the words in the same order both times.",
                "Yura sees you notice, and doesn't explain.",
                "The snow comes on small and dry."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
        ], [
            { text: "Lock the left flank and hold.", conclusion: "Harn shifts half a step to make you room, which is how Frostfang says welcome. The pup commits to a gap that is no longer there.", trait: "loyal" },
            { text: "Step out of line and pull it onto you.", conclusion: "Yura doesn't call you back. She counts aloud instead, so the whole yard can hear exactly how long you last.", trait: "reckless" },
            { text: "Watch its eyes and call its rush before it comes.", conclusion: "You call the charge two steps early and the line firms on your word. From the rail, Ostrek says 'well done' in a voice that has said it before, the same way, to someone else.", trait: "suspicious" },
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
                "I am ordered to strike five names at morning roll. I will. I am ordered.",
                "It is dark for ten more hours. Nobody has ordered me to sleep."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("What Came Back", "The gate at dusk, one set of footprints", "Frost Seal Echo", [
                "Dain reports. Post abandoned in error. Error corrected.",
                "The patrol is well. The patrol is warm. The patrol sends its regards.",
                "Questions are a weight. Set them down inside the gate.",
                "The gate lamp wants oil. See to the gate lamp."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
        ], [
            { text: "Take Dain's backtrail north before the gate closes.", conclusion: "You're past the cairn by full dark, alone, which has a name here and a sentence to match. A mile out, Dain steps from the treeline ahead of you — he was never behind.", trait: "reckless" },
            { text: "Bring what you saw to Elder Sova tonight.", conclusion: "Sova listens standing, writes nothing, and bars her own door behind you. Dain is waiting in the lane between you and your barracks, at ease, patient as weather.", trait: "honorable" },
            { text: "Request an audience and ask Kael to his face.", conclusion: "The audience lasts four sentences: Ruled. Filed. Closed. Dismissed. Dain falls in behind you the moment you leave the hall.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 25, "The Loyalty Seal", "Frost Seal Guardian", "❄", [
            { ...storyPage("Alive", "Ice cellar under the north watch", "Elder Sova", [
                "The patrol is found. Alive. That word is carrying more than it can lift.",
                "Four of the five, cut from the ice this morning. They stand where you place them. They answer what you ask. They ask nothing back.",
                "The script on their wrists is gate-mark script, but deeper. Line after line of it, wrist to elbow.",
                "The rule says the mark is volunteered — recited, witnessed, chosen. Nobody brought these four to a table. Someone brought the table to them."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
            { ...storyPage("The Burns", "Lamplight on four still faces", "Captain Yura", [
                "Ruven. Eyes here. — He's looking at my rank tabs. Not at me.",
                "I sat beside him at his oath. He chose it, same as I did. Whatever this is, it isn't what either of us swore.",
                "I am ordered not to file on this. The order is correctly formatted. I keep noticing that they always are.",
                "Kessa is still missing. Four came out of that ice. The report says five went in."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
            { ...storyPage("Certainty", "The ice groans, and answers", "Frost Seal Echo", [
                "Four recovered. Zero lost. The count is whole.",
                "Choice is heat leaking through a badly hung door. The door has been rehung.",
                "The recovered do not suffer. They are certain. Most of you dig for certainty your whole lives.",
                "Stand still. Yours is being prepared."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
        ], [
            { text: "Burn the deep-script plates before another table is set.", conclusion: "The plates crack in the lamp flame, slow, the script fighting the heat line by line. The ice at the cellar's end stands up while the last of it burns.", trait: "honorable" },
            { text: "Copy the roster of the sealed before anyone misses you.", conclusion: "Eleven names, and only four of them are in this cellar. You are memorizing the last column when the Guardian pulls itself out of the wall.", trait: "suspicious" },
            { text: "Take a sketch of the burns and put it in front of Kael.", conclusion: "Kael studies your sketch for the length of one breath and returns it with a single word: incomplete. The Guardian is waiting for you at the hall doors, marks lit.", trait: "reckless" },
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
                "She sent one line back, once: the wind out here is the same, it just doesn't take attendance.",
                "I stood a ridge once and got left by procedure. These forty-one left first. I'm still deciding what the difference buys them."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
            { ...storyPage("Recovery Detail", "Torchlight at the cavern mouth", "Frost Seal Echo", [
                "This assembly is in error. Forty-one errors, one location. Convenient.",
                "The count forgives. The cold does not. Return, and the record shows a lapse. Remain, and the record shows nothing at all.",
                "The captain leading this detail was recovered from the ice himself. He is very well now. Ask him.",
                "You have until the torches reach the floor of the bowl."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
        ], [
            { text: "Cross to the fire and stand with them.", conclusion: "Forty-one unsealed faces watch you pick their side of the light. On the switchbacks above, the Ice Captain's torches stop bothering to hide.", trait: "honorable" },
            { text: "Tell them: douse the fires, scatter high, now.", conclusion: "They argue, then move — packs up, embers kicked apart, children first. You stay on the path to make the arithmetic slower, and the Ice Captain accepts the trade.", trait: "merciful" },
            { text: "Find Marrin. Ask how many refused, and name them.", conclusion: "Sixty-three refused, she says. Forty-one still breathing. She is reciting the difference, name by name, when the torches arrive.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 50, "Jonin of the Frozen Oath", "Jonin Rank Trial: Glacier Twins", "❄", [
            { ...storyPage("Two Pages", "Glacier hall, ceremony antechamber", "Elder Sova", [
                "Jonin. Youngest this decade. I checked the register before I believed it.",
                "The rank scroll runs two pages. Page one is the rank: command, quarters, a jonin's allotment at stores.",
                "Page two is the officer's mark. Deeper script, renewed yearly, witnessed. You sign both or neither. I wrote that rule myself, and it is a good rule.",
                "Kael added a line this year. Signatories confirm the oath is a comfort. Read page two slowly."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp" },
            { ...storyPage("The Pen Gets Lighter", "Corridor outside the trial chamber", "Captain Yura", [
                "I requested witness duty at your ceremony. I was also ordered to it. Both are true, and I've started keeping track of which comes first.",
                "I signed page two at your age. I've re-signed eleven times. Every year the pen is lighter. Nobody warns you about the pen.",
                "You stood the east gate one evening and watched a man's check run long. You saw which way the frost leaned.",
                "So sign slow, if you sign. Watch what the ink does. That's all the advising I'm ranked for."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp" },
            { ...storyPage("The Glacier Twins", "Trial chamber, kept at founding-winter cold", "Frost Seal Echo", [
                "Candidates for the officer's mark spar the Twins. Tradition, and calibration.",
                "The Twins signed nothing. They were marked before birth. In thirty years, the script has never once had to tighten on them.",
                "They are the finished work. You are the raw stock. The trial measures the distance.",
                "The chamber is kept at the founding winter's exact cold. For honesty."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp" },
        ], [
            { text: "Sign page one. Slide page two back across the table.", conclusion: "Sova files your refusal without a word, and the filing costs her something you can watch. The Twins are loosed before the ink on page one is dry.", trait: "honorable" },
            { text: "Sign both, and write your own terms into the margin.", conclusion: "One year, self-renewed, witnessed — your hand, not the scribe's. Sova reads your margin twice, seals it, and somewhere below the hall the cold deepens by one degree.", trait: "ambitious" },
            { text: "Ask what the deeper script takes, and where it goes.", conclusion: "Sova answers with the rule about warmth, which is a rule and not an answer. The Twins take the floor while the question is still standing.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 65, "Orders in White Blood", "Oathbound Purge Unit", "❄", [
            { ...storyPage("A Number, Not Names", "Records room, the purge order unrolled", "Elder Sova", [
                "Nineteen Pale Pack fighters, quartered at the old quarry. Remove. That is the whole order.",
                "I have read every removal order this village has issued for sixty years. The honest ones list names. This one lists a number.",
                "Three raids this season, says the alert board. I walked the border logs myself. No tracks in, no tracks out.",
                "Frightened people obey while they doubt. You've sat in my records room — finish that arithmetic yourself.",
                "Go and count the nineteen. Counting is the one order I still trust."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
            { ...storyPage("The Count at the Quarry", "Old quarry shelter, wash lines and woodsmoke", "Captain Yura", [
                "Count with me. Nine children. Six elders. Four unsealed. Zero fighters.",
                "A number that wrong isn't bad intelligence. It's a test, and the test has your name on it.",
                "He wants to know what you'll do standing here. Whatever you do, it goes in somebody's ledger.",
                "I am ordered to confirm the shelter destroyed. I choose how long confirmation takes. Learn that trick. It's the only one I have left."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
            { ...storyPage("The Broom", "The treeline moves, twelve abreast", "Frost Seal Echo", [
                "Nineteen removals authorized. Discrepancies resolve in the field.",
                "Doubt collects in unswept corners. This is a corner. We are the broom.",
                "The children will be sealed, not harmed. Sealed children grow into certain adults. It is a kindness with a long horizon.",
                "Comply, and be counted among the sweepers.",
                "The quarry well is frozen over. Note it for the report. Everything goes in the report."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
        ], [
            { text: "Fill the shelter doorway and stay there.", conclusion: "Nine children watch you become a doorframe. The unit's captain recites the removal order once more, unhurried, adding your name where the discrepancy goes.", trait: "merciful" },
            { text: "Run the civilians down the quarry cut while the unit forms.", conclusion: "Elders first, then the children, down the cut with Yura counting each one past her elbow. You turn back alone to buy the count its time.", trait: "loyal" },
            { text: "Walk at the unit and make them purge a jonin first.", conclusion: "Twelve sealed faces attempt the arithmetic of removing an officer who outranks their order. The script decides for them, tightening on all twelve wrists at once.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 75, "Yura Breaks the Oath", "Frostfang Oathbreaker Hunter", "❄", [
            { ...storyPage("Drill-Fashion", "Base of the north tower, before first light", "Narrator", [
                "She has laid her kit out drill-fashion: knife, spirit lamp, clean bandage, and her armor plates in a row in the snow.",
                "The plate script came off first, pried loose a line at a time. That part took an hour. The next part is her wrist.",
                "Twelve years of gate checks have worn the mark smooth, the way a coin goes smooth. Everyone has paid with it.",
                "She waited for you before starting. She'd deny that, so don't ask."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
            { ...storyPage("Her Own Sentence", "The knife point finds the first line", "Captain Yura", [
                "You were under the ice with the warm plate. I recorded your answer. Then I stood on the stair and did my own arithmetic.",
                "Nineteen days on that ridge, I wanted the count to come back for me. It didn't. The mark never fixed that. It only made sure I stopped asking.",
                "I am ordered — no. Start again.",
                "I choose this. First sentence I've owned in twelve years. It's heavier than the knife."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
            { ...storyPage("Recovery", "Something crosses the snow without hurrying", "Frost Seal Echo", [
                "Mark removal in progress. Category: self-injury. Response: recovery.",
                "The oath is load-bearing. Remove it, and the weight goes somewhere. The weight goes down. The Gate takes it either way.",
                "The Hunter is dispatched for her. You are incidental. Remain counted, and remain incidental.",
                "Her lamp will gutter before she finishes. Someone should trim the wick."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
        ], [
            { text: "Kneel. Hold her wrist steady for the last lines.", conclusion: "Your hands are steadier than hers for the final inch of script. The Hunter crosses the drift while the bandage is still tightening.", trait: "merciful" },
            { text: "Put your back to her and watch the treeline.", conclusion: "Whatever wants her reaches her through you. Behind your shoulders the knife keeps its slow time, and the Hunter obliges the arrangement.", trait: "loyal" },
            { text: "Shout it down: name the Gate it keeps invoking.", conclusion: "'That which keeps the count,' the Echo answers — a rule where a name should be. The Hunter is sent to end the questioning either way.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 85, "The Kage Freezes Dissent", "Oathbound Alpha Guard", "❄", [
            { ...storyPage("Forty-Three", "Central square, morning, ice standing in rows", "Elder Sova", [
                "Forty-three citizens in the ice. I counted at dawn, and three times since. The number holds. Nothing else does.",
                "Each one filed a grievance, missed a check, or stood too long at the notice board. I know, because my lists fed his.",
                "He calls it the White Silence. Preventive stillness. There is a form for it now. I have held the form.",
                "The frost on them is growing inward. Sixty-one winters, and I have never seen frost do that."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
            { ...storyPage("Twelve Straight Necks", "Square's edge, the Guard at post", "Captain Yura", [
                "The Alpha Guard has stood post since dawn and not one of them has looked at the ice. Twelve guards. Discipline — or their necks won't turn.",
                "I've fought sealed men all winter. The body argues with the script. You can see it in the shoulders. Someone is still in there.",
                "I choose targets now, not orders. Slower. I recommend it.",
                "Second bell soon. He seals the exits at second bell."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
            { ...storyPage("Market Rates", "Colonnade off the square", "Kite Harrow", [
                "Still here? Rates tripled and every road out grew a checkpoint. One of those facts explains the other.",
                "Free advice, first and last: the mark I cut for myself went warm in my pocket this morning. Whatever he's drawing down for, it's near.",
                "You've watched my work pass Sova's litany at the gate. So trust me on the merchandise: he isn't freezing dissent. He's stocking a cellar.",
                "That's everything I give away in this village. The next sentence costs."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
            { ...storyPage("The Deliverable", "The Guard turns, all twelve at once", "Frost Seal Echo", [
                "The square is stable. Stability is the deliverable.",
                "Forty-three preserved. Zero deaths. The Kage requests that you note the zero.",
                "Exits seal at second bell. You are inside the count now. The count closes like a hand."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
        ], [
            { text: "Crack the nearest coffin open in front of the Guard.", conclusion: "The first face out of the ice comes up gasping a three-week-old grievance. Twelve necks finally turn, and the Alpha Guard comes off its post at you.", trait: "reckless" },
            { text: "Read the forty-three names aloud to the Alpha Guard.", conclusion: "At the ninth name, a guardsman's shoulders start arguing with the script. The seals answer by tightening on all twelve at once — and the fight is picked for them.", trait: "honorable" },
            { text: "Leave the square and find the cellar he's stocking.", conclusion: "You are three streets toward the glacier hall when the Guard closes the way, on orders cut before you ever chose. The cellar will keep. It has for ninety years.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 100, "The Oath Must Break", "Kage Kael Whitefang, Hollow Oath Tyrant", "❄", [
            { ...storyPage("Both Columns", "Glacier hall antechamber, the vault ledgers open", "Elder Sova", [
                "He left the ledgers open for you. Kael has never once been careless. Read them as an invitation, because they are one.",
                "Ninety years, and no child of this village has frozen. That column is true. I audited it my whole life and it never lied to me.",
                "The other column is what the warmth cost, entered by hand, every winter, by every keeper. Read both. Whatever you do upstairs, do it having read.",
                "Take the candle. He keeps the hall at founding-winter cold. For honesty, he says."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp" },
            { ...storyPage("Present, Freely", "The throne stair, her wrist bare", "Captain Yura", [
                "The scar's ugly. It's mine. So is everything I've done since — I've had a season to audit, and it holds.",
                "I stood at the vault door once, ordered to record your answer. Nobody ordered me onto this stair. Note it in whatever ledger survives tonight: one soldier, present, freely.",
                "He will offer you the count. The whole count. When he does, remember what it's holding: forty-three coffins and a purge roster.",
                "I choose the stair. Go on up."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp" },
            { ...storyPage("Three Answers", "The glacier throne, seals cracking in the walls", "Kage Kael Whitefang", [
                "You came. Noted.",
                "Ask anything. I keep three answers: the roll, the vault, the winter. Everything true is one of the three.",
                "The vault meters ceded choice. My predecessors drew quietly. I draw at need. Tonight the need is you. That is the entire file.",
                "Doubt is heat loss. I am the door. Count what the door has kept alive. Then draw."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Ask him what the vault took from Essen.", requireTrait: "ff42-reported-the-doubt", nextPage: 3 },
                { text: "Show him the wrist Sova left bare.", requireTrait: "ff58-took-the-exemption", nextPage: 4 },
                { text: "Ask him what the holder's mark makes you.", requireTrait: "ff70-took-the-hold", nextPage: 5 },
                { text: "Enough ledgers. Roll call ends tonight.", nextPage: 6 }
            ] },
            { ...storyPage("Ask him what the vault took from Essen.", "The reckoning", "Kage Kael Whitefang", [
                "Essen. East gate, evening bell. Report filed. Attesting witness: you.",
                "His re-oathing drew eleven units. Grievance doubt runs rich. Good yield.",
                "You supplied the vault before I ever paid you rank. Audit yourself before you audit me."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 6 }] },
            { ...storyPage("Show him the wrist Sova left bare.", "The reckoning", "Kage Kael Whitefang", [
                "Sova's strike. I countersigned it that night.",
                "No check has touched your wrist since. You slept well. Say otherwise and I will read you the meter.",
                "The exemption is the fee. You took it.",
                "Keepers do not refuse the vault. They inherit it. The last page has a line ruled for your name."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 6 }] },
            { ...storyPage("Ask him what the holder's mark makes you.", "The reckoning", "Kage Kael Whitefang", [
                "Commission ten. My signature. Your wrist.",
                "How many do you hold? One? I hold six thousand, four hundred and twelve.",
                "The warmth in your arm is someone's ceded leaving. Mine took forty years to reach the shoulder.",
                "Yours will be faster. You have talent."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 6 }] },
            { ...storyPage("Payment Clears", "The marks leave the walls and gather", "Kage Kael Whitefang", [
                "One entry remains. The vault holds forty years of my choices too. Payment was always scheduled.",
                "It clears tonight.",
                "Understand: I stopped being able to refuse this years ago. That is not a complaint. It is inventory.",
                "Roll call, shinobi. Sound off."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", rightImage: "/portraits/kage-kael-whitefang-hollow.webp", rightName: "Kage Kael Whitefang" },
        ], [
            { text: "Break every mark in the vault — theirs, his, and whatever binds anyone to you.", conclusion: "You say it aloud, and every seal in the walls turns to listen. If he falls, nothing will ever again guarantee that anyone comes back for you — whoever does will have chosen it, unmarked, every time.", trait: "honorable" },
            { text: "Free the forty-three. The vault gets a keeper, a meter, a law.", conclusion: "The ice in the walls begins, faintly, to weep. If this works, the vault burns on behind a meter and a law — and every name struck in ninety years becomes a case, and every case is yours.", trait: "merciful" },
            { text: "Take the valve yourself. A better keeper is still a keeper.", conclusion: "The vault's warmth finds your wrist before the first blow lands, patient, like a dog changing hands. On the stair below, Yura does not leave — and you already know you will spend years learning whether she stayed or was kept.", trait: "ambitious" },
        ]),
    ],
    "Moonshadow Village": [
        milestone("Moonshadow Village", 4, "No One Saves You", "Hidden Blade Trainee", "🌙", [
            { ...storyPage("The Silent Yard", "The training yard, an hour before moonrise", "Shade Master Iro", [
                "Shade Master Iro: Welcome to Moonshadow. No one waved. Waving is information.",
                "Shade Master Iro: You'll register two names at the clerk's window by morning. One to spend, one to keep.",
                "Shade Master Iro: Everyone here holds two. The clerk holds everyone's. Try not to think about that yet.",
                "Shade Master Iro: You have a careful face. Careful faces appraise well here.",
                "Shade Master Iro: The yard is yours until moonrise. I'd stretch."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
            { ...storyPage("The Going Rate", "A rooftop over the training yard", "Nyx", [
                "Nyx: New one. Advice runs five ryo a line. First line's free, as a promotion.",
                "Nyx: Someone already asked the clerk which name you registered first. That's the free line.",
                "Nyx: The last new one got tested her second night. A decoy screamed, she saved him. Very tidy.",
                "Nyx: He thanked her at dawn. By noon he swore no test ever happened. Swore it calmly, like a man reading a receipt.",
                "Nyx: Line five would cost you. Anyway. Look behind you."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
            { ...storyPage("The First Test", "The yard at moonrise", "Shade Master Iro", [
                "Shade Master Iro: Nobody rings a bell for the first test. A bell is a warning, and warnings are sold here, never given.",
                "Shade Master Iro: The trainee behind you has done this eleven times. She's very good. I trained her.",
                "Shade Master Iro: Show me what a careful face does when no one is coming."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
        ], [
            { text: "Circle her. Learn the knife hand before it moves.", conclusion: "\"Appraising first,\" Iro says, and settles onto the rail like a man watching his money. The trainee stops smiling.", trait: "suspicious" },
            { text: "Strike while she's still being introduced.", conclusion: "From the roof, Nyx mutters something about market disruption. The trainee's knife is already out — it was out before Iro finished talking.", trait: "reckless" },
            { text: "Raise the stakes: if I win, I take her standing.", conclusion: "Iro pencils something into a pocket ledger without looking down. \"Ambition, day one,\" he says. \"Noted.\"", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 15, "The Sold Secret", "Veiled Hand Collector", "🌙", [
            { ...storyPage("The Unbroken Lock", "Your quarters, before dawn", "Shade Master Iro", [
                "Shade Master Iro: The lock wasn't picked. It was opened with a key, and nobody has a key. Sit with that a moment.",
                "Shade Master Iro: The cipher is a dead network's hand. Retired the year I made rank. Yet here it is, writing to you.",
                "Shade Master Iro: A gift with no invoice attached is never a gift. Someone is watching what you do next.",
                "Shade Master Iro: Don't burn it. Burning is also an answer, and they'd read it."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Decoded Pattern", "Nyx's stall, shutters drawn", "Nyx", [
                "Nyx: Patrol routes. Gate rotations. Yours, mine, the night clerk's tea break.",
                "Nyx: Someone inside has been selling our movements for months. Steady buyer, steady price.",
                "Nyx: Here's the strange part, and I don't say strange for free. The seller isn't spending the money.",
                "Nyx: Paid in full, every month. It just sits. Who sells their whole village and doesn't buy anything?",
                "Nyx: The teapot's yours if you want it. I've lost my taste for tonight."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Collector", "Your doorway, no knock", "Veiled Hand Collector", [
                "Veiled Hand Collector: You decoded it in one night. The average is four.",
                "Veiled Hand Collector: The scroll was bait. The question was whether you'd run it to the tower, sell it, or keep it. You kept it.",
                "Veiled Hand Collector: Keeping is the interesting answer. Keeping means you think it's leverage.",
                "Veiled Hand Collector: Hand it over and we file you as average. Hold on to it, and we find out what you are."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
        ], [
            { text: "I kept it to hunt the leak. Take that to your masters.", conclusion: "The Collector's head tilts, veils moving a beat behind it. \"A hunter. We had you filed under curiosity.\"", trait: "honorable" },
            { text: "Name your buyer first. Then we discuss the scroll.", conclusion: "\"Buyers,\" the Collector corrects softly, and stops there. The correction is more than most people ever get.", trait: "suspicious" },
            { text: "The scroll stays with me. Make an offer or make a move.", conclusion: "\"Leverage after all,\" the Collector says, almost approving. Steel slides free somewhere under the veils.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 25, "Masks Beneath Masks", "Masked Auction Enforcer", "🌙", [
            { ...storyPage("Below the Market", "A cellar under the whisper market", "Shade Master Iro", [
                "Shade Master Iro: Every mask in this room outranks the face under it. Bow to no one; you'd only get it wrong.",
                "Shade Master Iro: You've appreciated, by the way. An outside broker paid forty for your day-name last season. Tonight's opening bid is sixty.",
                "Shade Master Iro: The auction used to move jutsu scrolls and contraband. Look at the lot board.",
                "Shade Master Iro: It hasn't moved contraband in a year."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
            { ...storyPage("The Lot Board", "Beside the lot board", "Nyx", [
                "Nyx: Lot four, chunin patrol schedules. Lot five, medical records with chakra signatures attached.",
                "Nyx: Lot seven. Bloodline names. Living ones, with addresses.",
                "Nyx: Nobody buys a set like that to resell. Someone's building a list of everyone strong enough to threaten the tower.",
                "Nyx: One buyer's mark on all three lots. I'd charge a fortune for that observation, so keep it."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
            { ...storyPage("Spotted", "The auction floor", "Masked Auction Enforcer", [
                "Masked Auction Enforcer: Invitations are white. Yours is missing.",
                "Masked Auction Enforcer: House policy offers two exits. You leave with the last hour wiped, or you leave in the canal.",
                "Masked Auction Enforcer: The wipe doesn't hurt. Regulars take it weekly. They say the week feels lighter after.",
                "Masked Auction Enforcer: Choose before the next lot closes."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
        ], [
            { text: "Bid on lot seven. See who bids against you.", conclusion: "The Enforcer hesitates — bidding isn't in the policy script. Across the floor, one mask turns your way and holds.", trait: "suspicious" },
            { text: "This auction closes tonight. Starting with you.", conclusion: "Somewhere above, a bell starts ringing and is stopped mid-swing. The masks file out without hurrying; the Enforcer stays.", trait: "honorable" },
            { text: "Take the wipe. Lift the lot ledger when they reach for you.", conclusion: "Your hand closes on the lot ledger just as theirs closes on you. Nyx, gone from your side, is already at the door.", trait: "reckless" },
        ]),
        milestone("Moonshadow Village", 35, "The Hollow Moon Contract", "Contract-Bound Shadow", "🌙", [
            { ...storyPage("The Bleeding Document", "A safe room over the dye canal", "Shade Master Iro", [
                "Shade Master Iro: Held flat, it's a trade agreement. Held to moonlight, the ink runs. Watch the margin.",
                "Shade Master Iro: It isn't a trade agreement. It's a list of people the Kage has agreed to make disappear, priced per name.",
                "Shade Master Iro: The paper was built to eat itself. Someone copied it faster than it could swallow. I'm told the copying cost three scribes their hands.",
                "Shade Master Iro: You were flagged never to see this. Which is why I brought it to you. Consider that my compliment."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
            { ...storyPage("The Real Purpose", "The same room, pages on the floor", "Nyx", [
                "Nyx: Every name on this list has one thing in common, and it isn't treason.",
                "Nyx: Talent. Each one strong enough to sit where Sable sits. She isn't clearing threats to the village. She's clearing successors.",
                "Nyx: The counterparty's mark isn't any clan I can price. And I can price everything.",
                "Nyx: You know how retail works here — the trainee, the meal chits. This is wholesale."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
            { ...storyPage("The Counterparty", "The edge of the lamplight", "Hollow Moon", [
                "Hollow Moon: The contract predates you. Most contracts do.",
                "Hollow Moon: Ambition is a fine ink. People sign in it without reading the last page.",
                "Hollow Moon: Your Kage read the last page. She signed anyway. Draw your own conclusions about the terms.",
                "Hollow Moon: Finish your inspection. The shadow you are standing in is under contract too."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
        ], [
            { text: "Ask what the last page says.", conclusion: "\"Ask her,\" the voice says, and the lamp goes out. The shadow underfoot begins to stand up.", trait: "suspicious" },
            { text: "Sable answers for every name. Starting tonight.", conclusion: "The pages on the floor curl and blacken, done waiting. Nyx pockets one before the dark takes the rest.", trait: "honorable" },
            { text: "Ask what she was promised. Exactly. To the ryo.", conclusion: "The voice makes a sound that might be arithmetic, or might be laughter. \"Priced like a local,\" it says.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 50, "Jonin of the Hidden Knife", "Jonin Trial: Mirror Assassin", "🌙", [
            { ...storyPage("The Mirror Chamber", "The Kage chamber, mirrored floor to ceiling", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: No guards. Do you know why a room with no witnesses is safe for me and not for you?",
                "Kage Sable Nocturne: You've read a great deal that was flagged away from you. Did you notice nothing reading you back?",
                "Kage Sable Nocturne: The auction, the contract, the scroll in your room. Shall I tell you which of those I arranged?",
                "Kage Sable Nocturne: No? Then you're learning what questions cost. Sit."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp" },
            { ...storyPage("The Corridor", "The corridor outside, out of mirror-sight", "Nyx", [
                "Nyx: She knows everything you found. The auction, the contract. Probably what you had for breakfast.",
                "Nyx: A sensible Kage silences you. She's promoting you. Price that.",
                "Nyx: It prices one way. You're worth more inside her hand than outside it.",
                "Nyx: One more thing, free, which should worry you more than anything she says. Don't stand where the mirrors can watch you agree to something."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp" },
            { ...storyPage("The Price of Rank", "The chamber, a blade on the table", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: Jonin of the Hidden Knife. Do you imagine I hand this to the loyal?",
                "Kage Sable Nocturne: The rank comes with a first errand. A councilman keeps a second ledger. You will remind him we hold the first. Nothing more. Isn't that small?",
                "Kage Sable Nocturne: The blade is ceremonial. The trial isn't. Something in this room wears your face and has read your file. Shall we see which of you is current?",
                "Kage Sable Nocturne: Take the handle. Mind the glass."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp" },
        ], [
            { text: "Take the blade and set my own price for the errand.", conclusion: "\"Your own price,\" Sable repeats, as if tasting the phrase. In the mirrors, your reflection reaches the handle first.", trait: "ambitious" },
            { text: "Take the rank. Watch every order that follows it.", conclusion: "Sable turns to the glass, satisfied by something she finds there. The reflection that steps out of it is not satisfied at all.", trait: "suspicious" },
            { text: "Ask what the councilman did before anyone reminds him of anything.", conclusion: "\"Did?\" she says. \"What do any of them do? He wrote things down.\" The mirrors ripple like canal water.", trait: "honorable" },
        ]),
        milestone("Moonshadow Village", 65, "Mission to Kill a Witness", "Veiled Hand Executioner", "🌙", [
            { ...storyPage("The Private Order", "The Kage chamber, no clerk present", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: No written order. Do you understand what an unwritten order costs me, in this village?",
                "Kage Sable Nocturne: The target sat in a booth and said nothing. Do you know what withholding sounds like downstairs? Loud.",
                "Kage Sable Nocturne: They copied something before it was erased. They haven't spoken yet. Silence is a delay, not a solution.",
                "Kage Sable Nocturne: The old shrine, before moonrise. I'm not asking you to enjoy it. I'm asking whether you're still useful. Are you?"
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
            { ...storyPage("The Witness", "The old shrine, one candle", "Shrine Witness", [
                "Shrine Witness: I know why you're here. I filed the paperwork for people like you for nine years.",
                "Shrine Witness: I copied names before they were erased. People sold downward. To the thing the elders call the draw.",
                "Shrine Witness: They're alive. That's the part nobody is supposed to keep. Sold, and alive, and owed.",
                "Shrine Witness: Kill me and the list dies with me. But you've walked past the pipes. You already know what she's doing."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
            { ...storyPage("The Executioner", "The shrine door", "Veiled Hand Executioner", [
                "Veiled Hand Executioner: The Kage sends her regards, and me. One of us is in case you hesitated.",
                "Veiled Hand Executioner: This isn't a loyalty test. Loyalty is cheap here. This is inventory: are you still an asset?",
                "Veiled Hand Executioner: The witness, the list, or you. The shrine only needs to lose one of the three.",
                "Veiled Hand Executioner: Moonrise. Decide."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
        ], [
            { text: "Stand between the Executioner and the witness.", conclusion: "The witness closes shaking fingers around the list. Behind you, the candle flame leans — the Executioner is already moving.", trait: "merciful" },
            { text: "Put out the candle and take the Executioner first.", conclusion: "Dark drops over the shrine; somewhere in it the witness runs, paper crackling. The Executioner laughs once, flat as a ledger line.", trait: "reckless" },
            { text: "Play the loyal knife. Get the list out under their eyes.", conclusion: "The witness meets your eyes and, impossibly, understands the performance. The Executioner watches you both one beat too long.", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 75, "Nyx Chooses a Side", "Shadow Network Hunter", "🌙", [
            { ...storyPage("Red Moon Rooftop", "A rooftop under a rusted red moon", "Nyx", [
                "Nyx: Six months I've been selling the Hollow Gate garbage. Bad routes, dead aliases, patrol schedules I invented in the bath.",
                "Nyx: They paid full price every time. That's what finally scared me. A buyer who never checks quality isn't buying information.",
                "Nyx: It's buying the selling. The transaction is the product. Every trade feeds it, true or false.",
                "Nyx: I did that arithmetic for free, which tells you how bad it is."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
            { ...storyPage("The Buyer's Mark", "The same roof, an envelope between you", "Nyx", [
                "Nyx: Their money routes through one mark. Old brokerage, older than the alias law. You've seen it before — in a file that found its way to you.",
                "Nyx: The mark belongs to someone inside the tower. Inner circle. The Gate has had a hand in that office since before Sable held it.",
                "Nyx: She didn't build this. She inherited it and signed. The difference matters for what we do next.",
                "Nyx: The name's in the envelope. I'm not charging for it. Don't make it weird."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
            { ...storyPage("The Moon Listens", "The rooftop, red light deepening", "Hollow Moon", [
                "Hollow Moon: She undersells herself. Six months of careful lies. Do you know what care is worth to us?",
                "Hollow Moon: More than truth. Care is attention, and attention is the crop. Your villages grow it four different ways.",
                "Hollow Moon: Freedom, memory, loyalty, secrecy. Four fences around one field.",
                "Hollow Moon: A hunter is already on this roof for the envelope. You've held it eleven minutes. We taxed every one of them."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
        ], [
            { text: "Keep the agent in place. Feed the Gate a channel we control.", conclusion: "Nyx starts reworking her rate tables on the spot, aiming them at something that eats villages. The red light thickens along the roof's edge.", trait: "suspicious" },
            { text: "Drag the agent's name into daylight, whatever it costs the tower.", conclusion: "\"Daylight,\" the voice repeats, like a coin from a country it doesn't trade with. Nyx pockets the envelope and steps behind your shoulder.", trait: "honorable" },
            { text: "Let Sable think she still runs this. Deal with the buyer directly.", conclusion: "The red light goes very still, interested. Nyx looks at you the way she reads a contract with new handwriting in it.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 85, "The Kage Owns Every Secret", "Veiled Hand Grandmaster", "🌙", [
            { ...storyPage("The Files Open", "The whisper market, papers falling like ash", "Shade Master Iro", [
                "Shade Master Iro: Forty years of intake, unsealed in one night. Every alias, every debt, every confession the booths ever drank.",
                "Shade Master Iro: She did it herself. My keys stopped working an hour before it started. Professional courtesy, that hour.",
                "Shade Master Iro: Someone priced the glass under the tower recently. This is her answer: spend the vault before it can be robbed.",
                "Shade Master Iro: There are people in the square wearing their neighbors' faces, confessing to things the neighbors never did. Don't stop to correct anyone."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp" },
            { ...storyPage("Controlled Collapse", "The Kage tower balcony", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: You've come to ask why. Wouldn't you rather ask why not sooner?",
                "Kage Sable Nocturne: A village built on withholding was always one honest hour from this. I chose the hour. Should I have let a thief choose it?",
                "Kage Sable Nocturne: When the smoke settles, whoever is still standing will owe that to me. What is a village, if not the people who owe you?",
                "Kage Sable Nocturne: Go on. The stairs are behind you. They always were."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp" },
            { ...storyPage("Not Yet", "A doorway off the square", "Nyx", [
                "Nyx: Don't fight in the square. That's what the square is for tonight.",
                "Nyx: The pipes under the market are running hot. First time in forty years. She isn't spilling the vault, she's cashing it. Someone downstairs is being paid in us.",
                "Nyx: The Grandmaster holds the tower stairs. Veiled Hand's best. After him it's just her, and whatever she's bought with all of this.",
                "Nyx: Door on three. One. Two."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp" },
        ], [
            { text: "Gather anyone still thinking straight. We climb together.", conclusion: "Seven come. Not the seven you'd have picked, which is how you know they're real. The tower door stands open, which is worse than locked.", trait: "loyal" },
            { text: "Stairs. Now. Before she finishes cashing out.", conclusion: "Nyx swears in numbers and follows you. Above, the Grandmaster steps onto the landing, unhurried, drawing on gloves.", trait: "reckless" },
            { text: "Find the vault feed first. Starve her payout before we climb.", conclusion: "The pipe junction is exactly where Nyx's map says, and it is guarded. The Grandmaster was told you would think of this.", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 100, "The Moon Belongs to No One", "Kage Sable Nocturne, Hollow Moon Sovereign", "🌙", [
            { ...storyPage("The Summit", "The tower summit, inside a black moon", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: Three people met you on the lantern road. What do you suppose that costs them tomorrow?",
                "Kage Sable Nocturne: You've read the contract, the lists, your own file. Shall I tell you about the one paper you haven't read?",
                "Kage Sable Nocturne: The seat's ledger. It passes with the chair. I read it my first night and signed by the third. So did everyone before me.",
                "Kage Sable Nocturne: Ask your questions. Tonight, unusually, I'm buying."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp" },
            { ...storyPage("What She Became", "The summit floor, black light through her", "Nyx", [
                "Nyx: Look at her shadow. It stopped taking her shape.",
                "Nyx: Forty years of collected faces, and the Gate is settling the account. Everything she siphoned, paid out at once. There's no true face left under there.",
                "Nyx: I priced everything in this village. I can't price this. Write that down somewhere; it won't happen twice.",
                "Nyx: Whatever you're going to say to her, say it while there's still someone inside to hear it."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Ask what my false confession fed.", requireTrait: "ms42-tested-the-drain", nextPage: 2 },
                { text: "Answer for the shelf Iro sold me.", requireTrait: "ms58-took-the-shelf", nextPage: 3 },
                { text: "Answer for the file I burned.", requireTrait: "ms70-burned-the-file", nextPage: 4 },
                { text: "Enough questions. Answer with your blade.", nextPage: 5 }
            ] },
            { ...storyPage("Ask what my false confession fed.", "The reckoning", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: The booth logged a lie in your voice. Did you think the pipe grades for truth?",
                "Kage Sable Nocturne: It weighs the telling. Yours weighed a day. Did you ever find where that week went short?",
                "Kage Sable Nocturne: I drank it anyway. Lies season the draw. What does that tell you about what sits in this chair?"
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 5 }] },
            { ...storyPage("Answer for the shelf Iro sold me.", "The reckoning", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: One secret a month, doubling. Which payment was the first that didn't hurt?",
                "Kage Sable Nocturne: That's the month the shelf bought you. Iro sells one a decade, always to someone shaped like this chair.",
                "Kage Sable Nocturne: You've been in the succession since you signed. Why do you think the road lit its lanterns for you?"
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 5 }] },
            { ...storyPage("Answer for the file I burned.", "The reckoning", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: Page by page, on the canal steps. Did the fire give anything back?",
                "Kage Sable Nocturne: The archive opened a fresh folder before your ash cooled. One line inside. Whose hand do you think dictated it?",
                "Kage Sable Nocturne: You can't burn what the village remembers. Where do you think my face went?"
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [{ text: "Enough. This ends now.", nextPage: 5 }] },
            { ...storyPage("The Last Argument", "The summit, her shadow across the floor", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: You want the argument. Fine. What no one knows, no one can take. Ask the wars this village never had to fight.",
                "Kage Sable Nocturne: The booths, the ledgers, the draw. What did I take that anyone was using? Truths that would have burned the streets. Someone had to hold them.",
                "Kage Sable Nocturne: Win tonight and the ledger passes to you. Everyone will want what you hold. What will you do — open it? Meter it? Collect?",
                "Kage Sable Nocturne: The mirrors downstairs are honest tonight, whatever else is. Come and see what holding looks like."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", rightImage: "/portraits/kage-sable-nocturne-hollow.webp", rightName: "Kage Sable Nocturne" },
        ], [
            { text: "The moon belongs to no one. Not you, not the Gate.", conclusion: "The Mirror opens only for the fully seen, so you give it everything — both names, every choice, the whole file, published. Somewhere below, forty years of pipes run backward.", trait: "honorable" },
            { text: "You called it protection. They called it a cage.", conclusion: "A keeper, then: the war-starting truths stay sealed, and you will carry them alone for as long as the village needs a warden it can resent. Sable almost approves of the price.", trait: "merciful" },
            { text: "I didn't climb here to own them. I climbed to give it back.", conclusion: "Every file goes home to its subject — yours first, and every debt this village owes you burns with it. From the stairs, Nyx: \"Worst trade I've ever witnessed. Do it.\"", trait: "loyal" },
        ]),
    ],

};

export function getCurrentStory(character: Character) {
    const storyLine = storylines[character.storyVillage || character.village] || storylines["Stormveil Village"];
    return storyLine[character.storyProgress] ?? null;
}
