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
            { ...storyPage("The Challenge Board", "The arena rim at dusk, chalk odds on slate, banner cables humming", "Mira Volt", [
                "New blood. Good. Stand on the dry side of the line unless you like your boots conducting.",
                "I'm Mira. I fix cables and I don't bet, which makes me the two most unusual things in this village.",
                "That wall of slates is the challenge board. Anybody can post a grudge on it, anybody can answer one, and the whole village comes to watch. No chains here. You settle it yourself, in the open, and then you shake hands and get soup.",
                "Before you fight, the clerk takes your reason. Everyone hesitates there. Don't worry about it. It's just a line on a slate."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
            { ...storyPage("The Reason Line", "The board clerk's stand, a wet brush waiting", "Ledger Clerk", [
                "Name, first. Then the bout you're answering. That part is easy.",
                "Then the reason. The board wants to know why you fight, and I write exactly what you say, so say it the way you mean it.",
                "Take your time. The ones who rush it always come back and stare at the slate later, trying to remember what they meant.",
                "So. Why do you fight?"
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "\"So nobody else has to.\"", nextPage: 2, trait: "sv4-post-protector" },
                { text: "\"To be the strongest name on this board.\"", nextPage: 3, trait: "sv4-post-strongest" },
                { text: "\"Someone owes me. I intend to collect.\"", nextPage: 4, trait: "sv4-post-debt" },
                { text: "\"I'm looking for someone. Fighting turns heads.\"", nextPage: 5, trait: "sv4-post-searcher" },
                { text: "\"I don't have a reason I can say.\"", nextPage: 6, trait: "sv4-post-unknown" }
            ] },
            { ...storyPage("A Shield Reason", "The clerk's stand", "Ledger Clerk", [
                "So nobody else has to. That's a shield reason. The crowd loves a shield reason; the odds-runners hate it, because you people never know when to stay down.",
                "Posted and chalked, %name. Welcome to Stormveil.",
                "One tip, free. Keep that reason where you can see it. Reasons go missing around here more than you'd think."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("A Ladder Reason", "The clerk's stand", "Ledger Clerk", [
                "The strongest name on the board. A ladder reason. Half this village posted that once. Most of them are soup vendors now, and good ones.",
                "Posted and chalked, %name. Welcome to Stormveil.",
                "The board remembers every rung, friend. Climb loud."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("A Debt Reason", "The clerk's stand", "Ledger Clerk", [
                "Someone owes you. A debt reason. I'll be honest, those draw the best odds and the worst company.",
                "Posted and chalked, %name. Welcome to Stormveil.",
                "When you collect, come tell me what it was. Debt reasons are the ones I most often have to read back to people, later, off the slate."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("A Searching Reason", "The clerk's stand", "Ledger Clerk", [
                "Looking for someone. Fighting does turn heads; it's cheaper than posting a notice and louder too.",
                "Posted and chalked, %name. Welcome to Stormveil.",
                "I hope they see you. And I hope you still remember what you'll say when they do. Write it down somewhere that isn't slate."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("A Blank Reason", "The clerk's stand", "Ledger Clerk", [
                "No reason you can say. Hm. I've chalked a lot of strange lines on this board. Blanks are rare, and the rare ones I remember.",
                "I'll post it blank, %name. The board takes blanks. Welcome to Stormveil, and come back when the word turns up.",
                "Blanks make the odds-runners nervous, by the way. That's reason enough to like you already."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("Posted Twice", "The board, slates clacking in the wind", "Mira Volt", [
                "Done? Good. Soup's on the east rim and the good cart runs out by second bell, so let's move.",
                "Hold on.",
                "Your slate's up twice. Same name, same bout, two slates. The board doesn't do that.",
                "And now it's not up at all. Clerk! Your board ate the new blood."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
            { ...storyPage("Elder Vanta", "The board, an old man reading slates like weather", "Elder Vanta", [
                "Don't shout at the clerk, girl, the clerk is a saint with a brush. The board did that on its own.",
                "I'm Vanta. I've stood at this rail longer than both of you have been alive, and I have seen the board misfile a name exactly twice before tonight.",
                "It is probably nothing. The board is old. Old things hiccup.",
                "But the last two times, I remembered them. That is all I will say about it. Now go take your first bout before the light goes; the training scout doesn't wait, and the crowd came to see the new reason fight."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Walk to the arena floor.", nextPage: 9 }
            ] },
            { ...storyPage("The First Bout", "The arena floor, chalk dust, the crowd leaning in", "Mira Volt", [
                "Rules, fast. First yield or first fall. No edges on a first bout. The bell starts it and the bell ends it, and everything between the bells is yours.",
                "That scout has taken a hundred first-timers apart, so the odds-runners have you long. Don't take it personally. Take it as room to surprise people.",
                "One more thing, because nobody told me when I was new. The crowd will roar. The board will listen. Fight anyway.",
                "Bell's up. Go."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
        ], [
            { text: "Go before the thunder lands. First move, no ceremony.", conclusion: "You cross the chalk before the bell's echo dies, and the crowd loves you instantly and forever. The scout catches your first strike an inch from his jaw and grins. Somewhere above the rim, thunder answers the bell, one beat early.", trait: "reckless" },
            { text: "Circle him. Watch the feet, not the hands.", conclusion: "His hands lie twice before his feet tell you the truth: the weight sits back before every real strike. By the third exchange you know his rhythm better than he does. At the rail, Mira murmurs that nobody watches feet their first night.", trait: "suspicious" },
            { text: "Tell the clerk to raise the purse first.", conclusion: "The crowd howls with delight at the nerve of it, and the odds swing hard while the clerk chalks a fatter line. Win or lose, you just taught the whole rim your name. The board, notably, spells it right this time.", trait: "ambitious" },
        ]),
        milestone("Stormveil Village", 15, "The Riot Bell", "Tempest Guard Captain", "⚡", [
            { ...storyPage("The Market Breaks", "The market square mid-riot, stalls going over, the riot bell hammering", "Mira Volt", [
                "Stay on the wall side. Don't swing unless something swings at you.",
                "This is wrong. Look at it. Market riots start at a stall and spread. This one started everywhere at once, like somebody rang it in.",
                "That's Old Besh throwing crates. Besh sells buttons. Twenty years selling buttons and never a posted grudge, and now he's throwing crates with a face like he's owed blood.",
                "Ask him why. Go on, get his eyes. Ask him why he's swinging."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("The Empty Why", "A cornered stall, a button-seller with bleeding knuckles", "Narrator", [
                "You catch the button-seller's arm mid-throw and turn him. His eyes take a moment to find you, like a man surfacing from deep water.",
                "You ask him why. He opens his mouth to tell you.",
                "Nothing comes. He looks at his own bleeding knuckles, then at the crate in his hands, and his face goes from fury to a terrible, lost blankness, like a page with the line rubbed out.",
                "'I had it,' he says. 'A minute ago I had it.'"
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("The Kage in the Square", "The square, a big man walking into the riot unarmed", "Kage Raiko Veyr", [
                "ENOUGH. Bells down. Hands down. All of you, look at me.",
                "Besh. Old friend. Put down the crate; buttons don't fly well. Mara, your daughter is watching you from the well, go be embarrassed. The rest of you, if you can't remember why you're swinging, that's the weather talking, and the weather answers to me.",
                "There. Done. Nobody dead. Somebody get soup going; anger is hungry work.",
                "You. New blood. You went in barehanded and asked a rioting man his reason instead of breaking his arm. That's rarer than it should be. Come find me when you're older and angrier, I'll have work for you."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("After the Kage", "The square's edge, Raiko moving crowd to crowd, beloved", "Mira Volt", [
                "And that's Raiko Veyr. He'll stop a riot with his voice, remember your mother's name, and carry a drunk home on his shoulder, all before supper. Nobody has died of a grudge in this village since he raised the bells. People love him. Mostly I do too.",
                "So explain this to me, because I rig cables, and cables make sense.",
                "The riot order the Guard is collecting off the ground. It has today's date, the Kage's wax, and a route drawn around the market like a fence around a garden.",
                "Somebody scheduled this. And everyone who swung a fist walked away lighter, like a purse after market day."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp", choices: [
                { text: "The Guard closes the square.", nextPage: 4 }
            ] },
            { ...storyPage("Booked Guilty", "The square gates chained, the Tempest Guard forming a line", "Tempest Guard Captain", [
                "By order of the tower: the square is closed. Everyone inside is booked for riot. Names to the clerk, marks on the slate, fines by the door. No exceptions.",
                "Yes, including the wounded. The wounded can bleed in a line like everyone else.",
                "The button man goes in the wagon. He can't state his own business; that's public disorder twice over.",
                "You have a problem with the process, new blood, you know where the board is. Post it."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("The Captain's Line", "The wagon, Besh looking small between two guards", "Narrator", [
                "The wounded man by the well can't walk. The wagon has room for one more, and the Captain is deciding whether it's the wounded man or the button-seller who can't remember his own anger.",
                "Mira is already coiling a cable around her fist, which is how she argues.",
                "The riot bell has stopped. The square is very quiet, the way the arena gets between the bell and the first blow."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
        ], [
            { text: "Stand over the wounded man. He is not walking, and he is not booked.", conclusion: "You plant yourself between the stretcher and the line, and the square watches the Guard decide whether arresting the person who stopped three fights is worth the odds. The Captain blinks first. The wounded man keeps his name off the slate, and you go on somebody's list for it.", trait: "merciful" },
            { text: "Challenge the Captain, by name, in the open square.", conclusion: "The oldest law in Stormveil: a posted challenge outranks a booking. The crowd chalks it on the nearest wall before the clerk can even arrive. The Captain takes off his cloak, folds it, and says he was hoping somebody would do this, and the square becomes an arena, because here it always was one.", trait: "reckless" },
            { text: "Hold up the tallied order. Ask, loudly, who counts riots before they happen.", conclusion: "The square goes still. The Captain reads the route lines, the wax, the tally marks, and for one long moment he is not a wall, he is a man looking at his own orders and not liking their handwriting. 'Booking stands,' he says finally. But he folds the order into his own coat, not the clerk's box.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 25, "Orders Written in Lightning", "Lightning-Sealed Informant", "⚡", [
            { ...storyPage("The Lifted Scroll", "Mira's rooftop, rain coming, a stolen scroll between you", "Mira Volt", [
                "Yes, I lifted it off a Guard clerk. No, I don't feel bad. He'll assume he lost it in the riot; that's what the riot was for. Losing things.",
                "Look at it properly. Real tower wax. Route orders drawn a week early, fencing the market like a garden bed. And this column of tick marks down the side. Eleven marks, and a line under, like a bill added up.",
                "I rig cables. I don't do politics. But I know what a fence is FOR, and somebody built one around that market a week before anybody was angry inside it.",
                "There's a word my mother used for money that gets washed until nobody can say where it came from. Laundered. I keep looking at this scroll and hearing her say it."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
            { ...storyPage("The Name on the Board", "The rooftop, wind pulling at an old slate Mira keeps wrapped in oilcloth", "Mira Volt", [
                "Since we're up here. There's a thing I show people once, to see what they do with it.",
                "Kesa Volt. My mother. Cable rigger, best on the coast. Dead six years. And her grudge is still posted on the board, still drawing odds, still scheduled twice a season against a man who is also dead.",
                "Two dead people, fighting on a schedule. The clerks call it an estate bout. The odds-runners call it tradition. I call it my mother, working the arena from under a stone.",
                "I asked the tower to strike it once. One time. They said accounts close when they're settled, and hers is still drawing. Still DRAWING. Their word."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Show her the Red Tally token from the border. Same tick marks.", nextPage: 2, requireTrait: "rd22-showed-the-token" },
                { text: "\"Take the scroll to Vanta. He reads boards better than anyone.\"", nextPage: 3 }
            ] },
            { ...storyPage("The Same Hand", "The rooftop, the lead token flat on the scroll", "Mira Volt", [
                "Where did you get that. No. Tell me walking, we're going to Vanta.",
                "Same tick marks. Same line under the count. Your border fire and my market riot, added up by the same hand.",
                "Whatever is counting, it isn't counting villages. It's counting everywhere.",
                "Grab the scroll. And step where I step; half these roofs are rotten and I know which half."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Cross the roofs to Vanta.", nextPage: 3 }
            ] },
            { ...storyPage("Vanta Reads the Wax", "Vanta's rail-side shack, purse ledgers stacked to the ceiling", "Elder Vanta", [
                "Close the door. Rain's coming and so is trouble; no reason to let in both.",
                "Yes, it's real wax. Yes, it's a scheduled riot. A harvest, girl. Somebody planted anger, grew it, and cut it, and the people it grew in walked home without their reasons. Don't look at me like that. I've suspected for years. Suspecting is comfortable. You've brought me the uncomfortable kind of paper.",
                "Eleven marks. That's an intake count. Eleven reasons taken. I know it's reasons, because I have watched ten thousand bouts from that rail, and I can tell you every purse ever paid and not one, not ONE of the reasons the fighters gave me the morning after.",
                "There's a shaft under the arena. Old as the founding. They tell the young clerks it's a well. Kesa used to say the whole village is plumbed like a still. I laughed at her. I would like to un-laugh, and she isn't here to receive it."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Someone is on the roof.", nextPage: 4 }
            ] },
            { ...storyPage("The Listener", "The shack, rain starting, a shape on the skylight", "Narrator", [
                "The skylight creaks. Not wind. Weight.",
                "Vanta doesn't look up. He slides the scroll under a purse ledger with a bookmaker's smoothness and says, louder than he needs to, that the rain is early this year.",
                "Through the glass, backlit by the first lightning, you can see the listener's hands moving. Tick, tick, tick. Counting the room.",
                "'That one is sealed to the tower,' Vanta says quietly. 'Lightning-sealed. You can't out-talk it. Decide what it takes back with it.'"
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
            { ...storyPage("Sealed and Sent", "The rooftops in the rain, the informant between you and the tower", "Mira Volt", [
                "It has the scroll's scent, or whatever sealed things have instead of a mind. It will carry what it saw straight up the hill.",
                "We have one roof between it and the tower, and rain in our favor. Nobody watches feet in the rain; you taught me that.",
                "Whatever you do, do it before the next lightning. It counts by the flashes. I watched it do it.",
                "Go."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
        ], [
            { text: "Take the back stair tonight. Whatever's in the shaft, see it alone.", conclusion: "You drop off the roof mid-fight and take the maintenance stair three at a time, alone, into the dark under the arena. Behind you the informant screams a sound like torn wire. Ahead, far down, something enormous turns over in its sleep, and the walls hum with stored weather.", trait: "reckless" },
            { text: "Put the scroll in Vanta's hands and stand between him and the seal.", conclusion: "Vanta folds the scroll into his ledgers, where one more page among ten thousand becomes invisible, and you plant yourself on the wet slate between the old man and the thing with counting hands. 'You're insane,' Mira says, taking your flank. 'Good. Stay that way.'", trait: "honorable" },
            { text: "Copy the tally. Burn the rest, and let it watch you do it.", conclusion: "You chalk the eleven marks onto your own slate while the original curls to ash in the rain barrel, and the sealed thing watches its errand become pointless in real time. Now the count exists in exactly one place, and the tower will have to come to YOU to read it.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 35, "The Storm Engine", "Storm Engine Warden", "⚡", [
            { ...storyPage("Down the Well That Isn't", "The maintenance shaft under the arena, rungs slick, a hum below", "Mira Volt", [
                "Rung's loose at the third landing, pass it word going down. Vanta, you good? Say something bookmaker-ish so I know you're breathing.",
                "The hum you're feeling in your teeth is the reservoir. I've rigged cable over every roof in this village and the same hum is in all of them, faint, and I always told myself it was wind.",
                "It isn't wind.",
                "Lamps low. And whatever we find at the bottom, nobody touches anything shiny. I know exactly which one of us I'm saying that to."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("Eleven Pipes", "The engine floor: eleven great pipes running from the arena floor overhead into a banked crystal reserve", "Narrator", [
                "The arena is directly overhead. You can hear tonight's crowd through the stone, a heartbeat of stamping feet.",
                "Eleven pipes come down from the fight floor like cables off a mast. Each one glows faintly with what it is carrying. The carrying does not stop.",
                "Along the wall hang maintenance rotas, a mop, a kettle. Somebody works here on a schedule. Somebody has ALWAYS worked here on a schedule; the rota nail-holes climb the wall like tide marks.",
                "In the middle of it all sits the reserve, banked like a hearth, and it is the size of a house, and it is nearly full."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("The First Storm", "An alcove off the engine floor, founders' slates behind wax", "Elder Vanta", [
                "Here. If we're going to be down here, you'll see both halves. That's the deal I'm making with myself, so don't argue.",
                "The founders' alcove. Every slate here is a war, given up whole. Read them. 'My feud with Harn's line, thirty years and both our fathers. Given to the sky, gladly, so my sons fight nothing but weather.' Signed. Witnessed.",
                "The first Stormveil named their worst wars, said aloud why they carried them, and chose to set them down. Signed. Witnessed. Settled. Each war given up that way raised the storm shield a little higher. That's what the engine was FOR: you gave your war away on PURPOSE, and it kept the lightning off everyone's roof. Beautiful. I mean that.",
                "Now look at the pipes. Nobody signs the pipes. The modern board kept the founders' signature and threw out the choosing. It holds a grudge open and lets the floor take the reason underneath it, and it does not care whether the fight is real or fixed. A true feud feeds it. A scheduled one just feeds it on time. We didn't inherit their shield. We inherited their still, and we ran it on the whole village."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp", choices: [
                { text: "Ask Mira what her mother knew about this place.", nextPage: 3, requireTrait: "mira-trust" },
                { text: "Read the chalked figures at the pipe junctions.", nextPage: 4 }
            ] },
            { ...storyPage("Kesa's Whisper", "The alcove, Mira's lamp low", "Mira Volt", [
                "You remember I told you where I'd run, if I ran. I've never told anyone the second half of that.",
                "My mother came down here. I'm sure of it now. The winter after my father drowned, she kept saying the village was plumbed like a still, and she started drawing cable maps that made no sense, anchors on the high ridge where there's nothing to power.",
                "Everyone said grief had her, because my father had just died, and she posted the grudge about it. Biggest mistake of her life, posting that. They scheduled her every season after. She got quieter every bout, and I watched it and called it healing.",
                "They drained my mother's grief down one of these pipes, one fight at a time.",
                "Then they kept her name on the board after her heart quit because the account was still open.",
                "Still drawing."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp", choices: [
                { text: "Something moves by the reserve.", nextPage: 4 }
            ] },
            { ...storyPage("The Warden of the Reserve", "The engine floor, a founders' construct unfolding from the pipework", "Narrator", [
                "It stands up out of the pipework the way a rigger stands up out of a hammock: unhurried, at home, enormous.",
                "The Storm Engine Warden. Founders' work, same hand as the alcove. It has stood this floor for four hundred years, and its post was never to keep people out.",
                "Its post was to check what comes IN. It holds a slate, and on the slate is one question, worn nearly smooth by centuries of asking: STATE YOUR REASON.",
                "It looks at each of you in turn. Vanta states forty years of guilt, plainly, and it lets him stand. Mira states her mother's name, and it bows its head an inch. Then it looks at you, and waits, and whatever it reads where your reason should be, it does not find, and its stance changes to the one on the older, sterner slates."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("State Your Reason", "The engine floor, the Warden between you and the reserve", "Elder Vanta", [
                "Don't take it personally. It's the only honest clerk in this village; it just works for a dead ledger.",
                "It can't read you. That means it can't file you, and it has four hundred years of instructions about what walks in here unfiled.",
                "Raiko knows we're down here by now. The pipes will have told him, or the crowd upstairs did. So whatever you're going to do, the tower is already counting it.",
                "Bell's up, as the young people say."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
        ], [
            { text: "Say it stops. To the Warden's face, on the record.", conclusion: "You state a reason after all: this stops. The Warden's slate crackles as four centuries of filings rearrange around a sentence it has no column for. For a moment its stance is almost gratitude. Then it attacks, because a construct with a broken ledger has only one instruction left, and upstairs the crowd stamps, feeding the pipes.", trait: "honorable" },
            { text: "Go for the reserve's bank, now, while it's mid-question.", conclusion: "Mira yells your name and misses your collar by a finger. You go over the pipework at the banked crystal with your hands bare, and the whole floor howls awake at once. Whatever happens next, the engine will remember tonight the way a body remembers a burn.", trait: "reckless" },
            { text: "Read the chalked figures at the junctions first. All of them.", conclusion: "Draw rates, junction by junction, in a maintenance hand: the intake has doubled every decade and the outflow to the storm shield has not risen in forty years. The surplus is going somewhere with no chalk line to it. You memorize the whole count while the Warden closes, and Vanta whispers that you read figures like a man he used to be afraid of.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 50, "Jonin of the Unchained Sky", "Jonin Rank Trial: Twin Tempest Duelists", "⚡", [
            { ...storyPage("The Rite of the Posted Rival", "The arena at noon, banners up, the board scrubbed clean for the rite", "Ledger Clerk", [
                "Stand on the chalk, face the board. This is the part of the rite everyone's family comes to see, so smile, or at least stop looking like weather.",
                "Jonin of Stormveil post a lifetime rival. One name, on the board, forever. The village watches your whole career against one other name; it's how we make ambition public and keep it honest. That's the speech, anyway.",
                "The board never forgets a posted name. Whatever else you hear today, that part is true.",
                "The Kage is here. He posts the rite bouts himself. Try not to say anything I'll have to chalk."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp" },
            { ...storyPage("Raiko's Dare", "The rite chalk, Raiko grinning like the whole village's uncle", "Kage Raiko Veyr", [
                "There's my riot-stopper. Level with me, before the formal part: how's the shoulder? The Twins hit like falling scaffolding, and I'd rather promote you unbroken.",
                "Now. The rival line. Most people post a training mate, someone safe. A rivalry you can have soup with after. Nothing wrong with that.",
                "But you've been under my arena, so let's be adults. You want to post a name that means something? Post mine. Raiko Veyr, right there on the slate. I'll even hold the brush.",
                "Careful, though. A posted grudge is a lifetime account here. Ask yourself who profits from holding yours open, and then ask why I'm smiling."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Show him the junction figures. Ask where the surplus goes.", nextPage: 2, requireTrait: "sv42-kept-the-count" },
                { text: "Answer the dare at the board.", nextPage: 3 }
            ] },
            { ...storyPage("The Missing Chalk Line", "The rite chalk, the crowd noise far away for a moment", "Kage Raiko Veyr", [
                "You copied the junction chalk. Of course you did. I told the Warden you were the counting kind; it owes me a drink.",
                "All right. Plainly, and then the rite goes on. The surplus goes up the hill and out of my hands. There's a debt above this village, older than my seat, and it was old when my grandmother's grandmother took the chair. Every Kage inherits its payment schedule with the seat.",
                "I keep the intake gentle as I can. Scheduled little lettings, nobody dead, everybody's roof standing. You've seen what I bought with it: no grudge in thirty years has put a body in the ground. Show me the Kage who did better odds with the weather we're under.",
                "And do you know what the seat charged ME? Listen to the crowd a moment. That roar. I hear every voice in it separately, every grudge in this village, all day, all night. The seat made me the drain. So post your rival, Jonin, and pick your fights the way I couldn't: one at a time."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Walk back to the board.", nextPage: 3 }
            ] },
            { ...storyPage("Supply Lines", "The board's shadow, Mira pretending to check a cable anchor", "Mira Volt", [
                "Don't post his name. Look at me. Don't.",
                "I know it feels like the honest move, dragging the real fight into the open. But I rig cables for a living, and I know a supply line when I see one anchored. That board doesn't schedule endings. It schedules you, forever.",
                "My mother posted her real grief once, in the open, being honest. They tapped her for six years. The board never forgets a name, and it never lets a good one rest.",
                "Whatever you write up there, make sure it's something you can afford to have milked. Or write nothing, and let them call you a coward with an empty slate. Coward is survivable. I plan my exits around survivable."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Take the brush.", nextPage: 4 }
            ] },
            { ...storyPage("The Twin Tempest", "The rite floor, two duelists uncoiling like paired lightning", "Narrator", [
                "Rank in Stormveil is not given. It is posted, and then it is tested, and the test is the Twin Tempest Duelists, who have fought as one organism since before you could walk.",
                "The crowd settles into the particular hush it saves for rite bouts, the one that sounds like the whole village holding one breath.",
                "At the rail, Raiko holds the brush he offered you, still smiling, watching what you do with your slate more closely than he will watch the fight.",
                "The bell is up."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp" },
        ], [
            { text: "Take the trial with an empty rival line. Refuse to post at all.", conclusion: "You leave the slate blank in front of the whole village, and the silence has teeth. An unposted Jonin: no account to milk, no line to schedule. The clerk's brush hovers a long time. Raiko's smile goes somewhere private, and the board, which never forgets, has nothing of yours to remember.", trait: "honorable" },
            { text: "Write Raiko's name on the board.", conclusion: "The crowd's roar knocks birds off the tower. RAIKO VEYR, chalked as a lifetime rivalry by the newest Jonin in a generation. The Kage laughs like thunder finding a bell tower, and somewhere under the arena, eleven pipes lean toward the biggest account the board has ever opened.", trait: "reckless" },
            { text: "Post a rival who died years ago. Watch what the board does.", conclusion: "You post a dead name and watch the board accept it without a flicker: schedules, odds, a first bout three weeks out. It never checks the register of the living, because it was never about the living. Mira goes pale at the rail. Now you both know exactly how her mother is still fighting.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 65, "The Mission That Should Not Exist", "Tempest Execution Squad", "⚡", [
            { ...storyPage("The Ravine Order", "The tower gatehouse, an order with fresh wax and no clerk's initials", "Tempest Guard Captain", [
                "You. Jonin. Orders from the tower, and I'll say up front I don't like the smell of them.",
                "A camp in the north ravine. Forty-some souls. Charge sheet says sedition. The particulars say, and I am quoting, 'refusal to post.' They don't put grudges on the board. That's the whole crime. They stay angry in private, like anyone's grandmother.",
                "An execution squad drew the duty an hour ago. You're ordered up as ranking witness. Witness, it says. The tower likes a clean margin.",
                "I skipped my report this morning for the first time in nine years, writing and unwriting a protest. In the end I sent nothing. You want to know what this village does to a man, there it is: I sent nothing. Go north, Jonin."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Ask what the order's pay line says. You know the shares now.", nextPage: 1, requireTrait: "sv58-refused-the-ninth" },
                { text: "Go north ahead of the squad.", nextPage: 2 }
            ] },
            { ...storyPage("The Ninth Share", "The gatehouse, the order flat between you", "Tempest Guard Captain", [
                "The pay line. You would look there. Fine, look with me.",
                "Nine shares on completion. Eight named to the squad. The ninth made out the way the arena ledger writes the elders' cut, and pressed beside it, small as a flyspeck, a circle cut in quarters. You know the column; I hear you were offered a seat at it and turned the old man down.",
                "Somebody set aside your share before you'd even said yes. That's not a pay slate, Jonin. That's a bet.",
                "Ride hard and you'll beat the squad by half a bell. What you do with the half bell is between you and whatever you post for a conscience."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Ride north.", nextPage: 2 }
            ] },
            { ...storyPage("The Camp That Keeps Its Anger", "The ravine camp: cook fires, mended tents, slates nailed to posts with reasons written LARGE", "Rebel Medic", [
                "That's close enough with the village crest on you. State your business or state your reason; we take either here.",
                "Yes, we refuse to post. Look around; that's the whole conspiracy. Cook fires and kept grudges. My sister was taken in a riot sweep four years back and came home sweet as milk and missing the why of her own divorce, so no, we don't feed the board.",
                "We keep our reasons where they were born. In us. Ugly and heavy and OURS. You know what that buys us? Headaches. Bad sleep. Arguments that last. Being people, in other words.",
                "And once a season, a cart comes up from the valley and we pull rescued slates off it. Confiscated reasons, headed for the shaft. We can't give them back to their owners; the owners mostly can't remember owning them. But somebody should keep them. Somebody should KEEP them."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
            { ...storyPage("The Rescued Slates", "A dry cave wall racked with hundreds of confiscated reason-slates", "Mira Volt", [
                "You ride hard, you know that? I nearly killed my horse matching you. The Captain talks too much, thank the sky.",
                "Look at this place. It's a library of everything the village made people put down. Wedding grudges. Land lines. A child's slate, look, somebody posted a REASON at nine years old and they took it. Who tallies a nine-year-old.",
                "Hold on. Hold ON.",
                "This is my mother's hand. Kesa Volt, her grievance, the real one, the one they milked her on, in her own writing. And under it, folded, cable maps. The ridge anchors. The design everyone said was her grief talking. It's here. It's HERE."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Wrap Kesa's grievance and maps. They leave this ravine with you.", nextPage: 4, trait: "sv65-saved-the-reason" },
                { text: "Put the pages in Mira's hands. Her mother, her carrying.", nextPage: 4, trait: "sv65-gave-mira-the-page" },
                { text: "Reseal the rack. The camp keeps its dead honestly; leave them whole.", nextPage: 4, trait: "sv65-resealed-the-cart" }
            ] },
            { ...storyPage("Eight Riders", "The ravine mouth, dust rising on the valley road", "Rebel Medic", [
                "Dust on the road. Eight riders in tower gray, and they ride like men who've already been paid.",
                "We have children here, and elders, and exactly four people who can hold a line, and I am one of them and I am holding a splint.",
                "You came ahead of them. That means you had a half bell and you spent it HERE. Whatever that makes you, it isn't a witness.",
                "So, Jonin. What are we, up here? Say it fast."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
            { ...storyPage("The Ranking Witness", "The ravine mouth, the squad dismounting with ceremony", "Narrator", [
                "The squad forms up with the unhurried confidence of people who have done this before and been thanked for it. Their leader carries the order like a shield.",
                "Behind you, the camp bangs pots and herds children toward the caves, and a nine-year-old's rescued slate swings on the rack in the wind.",
                "The order names you ranking witness. That means the squad, the camp, and every child behind you are waiting on your word.",
                "The medic was right. Say it fast."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
        ], [
            { text: "Get between the squad and the tents. The order dies here.", conclusion: "You put your back to the cook fires and your rank in the squad's road, and the arithmetic changes: eight shares are not worth a Jonin's posted testimony. They withdraw with ceremony, and the camp watches you the way people watch weather break. The tower will hear by morning, and the ninth share will find another line to sit on.", trait: "merciful" },
            { text: "Take the camp's surrender. Loudly. On your record, on your terms.", conclusion: "You arrest forty people in a voice that carries down the ravine, into YOUR custody, under YOUR seal, pending YOUR report, and the squad can only watch the whole prize walk away from them. It's a long game and everyone in the camp knows it, and the medic spits at your boots and then, quietly, thanks you.", trait: "honorable" },
            { text: "Signal compliance. Then walk the squad into the wrong ravine.", conclusion: "You confirm the order, note the camp's 'position,' and lead eight paid men up a fork that dead-ends in scree and evening. By the time they unknot the map, the camp is smoke and cold fires and gone. Lying to armed men in the dark: your hands don't shake until after, which frightens you more than the shaking would.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 75, "Kesa's Bout", "Mira Volt, False Betrayer", "⚡", [
            { ...storyPage("The Estate Closure", "The board at dawn, a new slate in the estate column, Mira staring at it", "Mira Volt", [
                "They posted it this morning. Look at it. LOOK at it.",
                "Closure bout, estate account: Kesa Volt. The board wants my mother's account settled at last, isn't that generous, and accounts settle by bout, and the estate fights through blood. Meaning me. Six years they milked her, and now the tower wants the account CLOSED before anyone reads it too closely.",
                "And look who they matched as the closing opponent. You. My name against yours, main card, three days. They put my dead mother between us like a purse.",
                "I have two exit routes and a boat, and for the first time in my life I'm not taking them. I'm going to close her account MY way. I need you to hear the plan, and I need you not to talk me out of it, and there's nobody else on this coast I'd say those two sentences to."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "\"You read the routing mark on my fixed bout. Read this one.\"", nextPage: 1, requireTrait: "sv70-read-the-mark" },
                { text: "Hear the plan on the roof.", nextPage: 2 }
            ] },
            { ...storyPage("The Routing Mark", "The board, Mira's finger under the slate's corner", "Mira Volt", [
                "Same corner. Same little routing mark, pressed into the slate like a wax tooth. You showed me yours, so yes, I went and learned to read them.",
                "This bout is pre-written. Result already filed: I lose in the fourth exchange, grief overwhelms the estate, account closes at maximum draw. They mean to milk her one last time THROUGH me, in front of the whole village, and call it mourning.",
                "They wrote my grief a script. My actual grief. There's a schedule for when I break.",
                "So we're going to give the board a bout it didn't write. Roof. Now. Please."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Up the cable run.", nextPage: 2 }
            ] },
            { ...storyPage("Storm Rules", "Mira's rooftop, the plan chalked on slate, her hands steady", "Mira Volt", [
                "Storm rules. What's said on this roof stays on this roof.",
                "The bout happens; we can't stop the posting. But a closure bout ends when the account holder's reason is SPOKEN AND SETTLED, that's founders' law, it's still on the oldest slate at the rail. Nobody invokes it because nobody remembers their reason by the time closure comes. Convenient, isn't it.",
                "My mother's reason survived that ravine because you rode fast one day. I've been up the mountain twice since. I've read it until I hear it in her voice, and I could write it out blind, both hands, in the rain.",
                "So we fight, full speed, no theater. The floor will pull; let it. Honest grief has always been its best draw, and it does not care that ours is real. But when the crowd is loudest, I stop, and I say her reason OUT LOUD, and I settle it with my own mouth under founders' closure law, and the account, THEIR word, closes with her reason still in my hands. They wrote me a script for when I break. I'm bringing them a reason they can't take. Are you in?"
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Three days pass. The bell.", nextPage: 3 }
            ] },
            { ...storyPage("Main Card", "The arena floor, the estate slate hung over the bell, the crowd enormous", "Narrator", [
                "They hang the estate slate above the bell where everyone can read it: KESA VOLT, CLOSURE. The odds say you beat Mira. They say her grief beats you both.",
                "Mira stands across the chalk from you, wearing her mother's rigging gloves, and under the crowd noise she mouths the plan's last line: fight me true, and when I raise my hand, hold the ring. Don't let them stop me when I speak.",
                "Under the sand, faint as a held breath, the seams begin to glow before the first exchange. The board does not care whether tonight's grief is honest; honest grief has always been its best draw. It has waited six years for this vintage.",
                "The bell is up, friend."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp" },
        ], [
            { text: "Fight her true, and guard the moment she stops to speak.", conclusion: "You give her a real bout, hard and honest, and the seams light anyway: the last ugly proof that the floor never cared whether the fight was real, only whether the reason under it was still there to take. At the fourth exchange Mira raises her hand. You put your back to hers while the routing clerks shout that the account hasn't closed, and Kesa Volt's reason rings across the arena in her daughter's voice, named under founders' closure law, word for word, settled. The seams pull once, then let go. The estate account closes empty. The board hisses like rain on a forge, because the reason stayed with the person who carried it.", trait: "loyal" },
            { text: "Tear the estate slate off the board mid-bout, in front of everyone.", conclusion: "You break from the exchange, run the rail, and rip KESA VOLT off the board with both hands while the crowd loses its mind. Founders' law says a torn posting voids the bout; tower law says you just assaulted the board itself. Both are true. Mira stands in the chalk, gloves up, laughing and crying at the ruin of every script in the building.", trait: "reckless" },
            { text: "Buy the account. Purse, odds, and the estate's debt, in your name.", conclusion: "You halt the bout on a rule older than the tower: any account may be bought at closure by an open hand. Yours is the only hand rich enough, after the seasons you've had. Kesa Volt's account, her draw, her schedule, all of it now answers to you. You did not free her reason; you bought the right to hold it. Mira stares at you across the chalk, trying to decide what she just watched you become. The board files the transfer without complaint. It likes you.", trait: "ambitious" },
        ]),
        milestone("Stormveil Village", 85, "The Kage's True Storm", "Hollow Tempest General", "⚡", [
            { ...storyPage("Fees Waived", "The square under a bruise-green sky, clerks posting free bouts as fast as chalk allows", "Tempest Guard Captain", [
                "Tower order, dawn bell: all posting fees waived. Every grudge in Stormveil rides the board free until further notice. There are QUEUES, Jonin. Grandmothers are posting their neighbors. The clerks have run out of good slate.",
                "And look at the sky doing that. I've stood gate duty thirty years and the sky has never done that.",
                "Every bout we post feeds the floor faster. He knows that better than anyone. He signed it anyway, which means the tower needs the intake, which means something upstairs is DUE.",
                "I sent my morning report. It says, in full: 'This is wrong.' Nine years late, but sent."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
            { ...storyPage("The Balloon Payment", "The rail, Harrow with a valise and no intention of staying", "Kite Harrow", [
                "There you are. I'd say let's walk, but I'm leaving tonight, so this is the whole meeting.",
                "Your engine is one intake of four. Fire, frost, moon, storm, four spouts, one cistern, and the cistern's account came due. I've seen the paper. Tonight the reserve pays out its balloon, and your Kage is filling the tank the only way the plumbing allows: everyone's quarrels, free of charge.",
                "I priced the payout, because pricing things is how I stay calm. You can't afford it. Nobody can. That's the point of a balloon payment; it exists to be defaulted on, and then the lender owns the borrower.",
                "You pulled me back from a bad sale once, so here's your receipt: the surge valve sits in the square, wearing armor, answering to the tower. Cut the square off the grid and the payment comes up short. That's not advice. Advice I charge for."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "\"Stay. Hold the coast gate open tonight. I'll owe you.\"", nextPage: 2, requireTrait: "sv80-pulled-her-back" },
                { text: "Head for the square.", nextPage: 3 }
            ] },
            { ...storyPage("The Anomaly, Again", "The rail, Harrow looking at her own valise like it betrayed her", "Kite Harrow", [
                "Stay. Through THAT sky. For an IOU. Do you know what my hourly is during a catastrophe? Neither do I; nobody's ever been able to afford one.",
                "You pulled me off a ledge once and didn't invoice me for it, and I've been carrying the imbalance ever since like a stone in my boot. Fine. FINE. The coast gate stays open, and anyone who runs gets out, and we're even.",
                "I want it noted that this is the second free thing I've done in six years and both of them were you.",
                "Go break something expensive. I'll keep the door."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "Head for the square.", nextPage: 3 }
            ] },
            { ...storyPage("The Rigger's Answer", "A rooftop over the square, cables everywhere, Mira already working", "Mira Volt", [
                "Don't talk, hold this. Turnbuckle. Other hand. Good.",
                "I'm not running. Look at me not running. My mother drew ridge anchors for exactly this sky and everyone called it grief, and if her daughter runs tonight then they were right, so I'm rigging.",
                "The General is standing on the surge valve like a lid on a kettle. You do what you do to lids. I'll do what my family does to weather.",
                "Hey. Whatever this costs. My mother's account is closed and her plans are alive, and both of those are you. I don't say things twice, so file that properly."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "The tower door stands open.", nextPage: 4 }
            ] },
            { ...storyPage("The Weather Ledger", "Raiko's office, storm maps and a lifetime of bout slates, the Kage watching his sky", "Kage Raiko Veyr", [
                "Come in. You were always coming here tonight; the only question was how angry. Sit. You'll argue better sitting; my knees argue better standing, so we're even.",
                "Before you say it, two numbers. The Split-Sky year killed sixty of us. Roofs, floods, a lightning fire that took the low market in an hour. My first year in the seat I broke that storm's back with the reserve, and no one has died of weather in this village since. Not one. Thirty years, Jonin. That's my line on the board, and it's honest.",
                "Tonight the debt above me calls its loan, and the whole reserve goes up the hill, and I refill it or the shield dies with the payment. So yes, I waived the fees. I'd waive worse than fees to keep this village under a roof.",
                "Argue with me. I mean it. Everyone else just bets. Bring me a quieter storm, and the board rests tonight. That's not rhetoric. It's the one hole in my odds: show me this village standing through weather without feeding the floor, and I will close every intake myself, with a hammer."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "The square. The General.", nextPage: 5 }
            ] },
            { ...storyPage("The Surge Valve", "The square, the Hollow Tempest General planted like a monument, sky turning", "Narrator", [
                "The Hollow Tempest General does not patrol. It stands where the pipes meet, hands folded on its warhammer, and the ground under it breathes light in slow pulls: the payment, gathering.",
                "Around the square's rim the whole village is posting, queuing, betting, feeding, under a sky that has begun, very gently, to rotate.",
                "The Captain arrives with thirty guards and no orders. Mira's cables sing overhead. Somewhere up the hill, an account four villages wide waits to be paid in everyone's reasons.",
                "The General's visor turns to you. The valve, its stance says, is spoken for. Speak otherwise."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
        ], [
            { text: "Rally every rim of the square to one banner before you swing.", conclusion: "You do the impossible thing: you get the odds-runners and the Guard and the queue and the camp's riders under one shout, and the square stops feeding the floor because the whole square is watching you instead. The pipes gurgle on nothing. The General unfolds its hammer with what might be relief; a monument likes an honest fight.", trait: "loyal" },
            { text: "Walk into the square alone and take the General now.", conclusion: "No speech. You walk the open chalk with the whole village watching and hit the monument where it stands. The crowd's roar drowns the storm bell, the odds-runners tear up their slates, and the payment stutters as its valve is forced to defend itself. Somewhere above, the sky forgets its rotation for one full breath.", trait: "reckless" },
            { text: "Shear the junction cables feeding the square first.", conclusion: "Mira's maps in your head, you take the junctions in order, fast, while the queues still think you're a maintenance run. By the time the General understands the valve under it has gone quiet, the square is off the grid and the payment is coming up short exactly as an appraiser predicted. Uphill, something enormous notices the arithmetic.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 100, "Break the False Thunder", "Kage Raiko Veyr, Hollow Storm Tyrant", "⚡", [
            { ...storyPage("The Village Climbs", "The tower road at dusk, the whole village walking up to watch", "Narrator", [
                "Word went out at noon bell, no one knows from whom: the last bout is tonight, at the top, and everyone is invited.",
                "So Stormveil climbs. Soup carts and grandmothers, odds-runners with nothing chalked, the Captain in his best coat, the camp come down from the ravine carrying their slates like lanterns.",
                "At the tower gate, for the first time in anyone's memory, the betting window is shuttered. A hand-lettered sign says: NO ODDS POSTED ON THIS ONE.",
                "The board at the base of the tower is blank, and it is humming, and on the top step sits a bowl of soup going cold, with a note under it in a big cheerful hand: 'You'll fight better fed. R.'"
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp" },
            { ...storyPage("At the Gate", "The tower gate, Mira with her mother's gloves tucked in her belt", "Mira Volt", [
                "I know. Past the gate it's you and him; that's the law of a challenge and I've stopped arguing with laws older than the seat. I'll hold the gate. It's what riggers are for; ask any door.",
                "Inventory, because you love when I do inventory. Two exit routes, rigged and ready, in case tonight goes wrong. And one boat I am not taking, in case it goes right.",
                "If the sky comes apart, the ridge line is anchored and I know every knot in it by heart. Her knots. Go do the loud part.",
                "Hey. Afterward there's soup at my place. Plan on it. Having an afterward is half of winning; a very tired man taught me that."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Climb to the storm floor.", nextPage: 2 }
            ] },
            { ...storyPage("The Drain Speaks", "The storm floor, open to the rotating sky, Raiko at the rail", "Kage Raiko Veyr", [
                "Punctual. I like that in weather and people.",
                "Before the bell, you get the truth, because you climbed for it. The ledger above us has a name; the exiles who cut the coast stair knew it before the tower had windows. The Hollow Gate. Four seats sit at it, one for each quarter of the circle. It is the same mark the tower presses into its pay slates, and each Kage is paid in kind for the intake he keeps open. Each of us really only knows his own price. They say frost buys certainty and moon buys silence; what fire is paid, I never learned.",
                "You want to know my price? Quiet. The seat made me the drain for every grudge in this village, every voice, all at once, always. And the ledger pays me one hour a day of QUIET. One hour. I have started wars in my head for that hour. I have scheduled riots for it. I am not proud, and I am not sorry, and both of those are true at once, which is the most honest sentence I own.",
                "And you should hear the ugliest part from me, not from her daughter. I spent Kesa Volt twice. For six years I let her grief be milked on that board to keep three hundred roofs standing, and every drop the shield did not burn I sent up the hill to feed the Gate. One woman's mourning, warming a village and paying a debt at once, for years. Do not blame the Gate for my handwriting. It set the line. I kept taking the bet. And every time this village won, somebody else covered the purse. This round, it was her.",
                "So. The storm is called, the account is due, and the seat takes challenges tonight only. Ask your questions, or ask your questions with your hands."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp" },
            { ...storyPage("The Man Becoming Weather", "The storm floor, lightning walking Raiko's shoulders like gulls", "Kage Raiko Veyr", [
                "You're staring at my shoulders. Nobody stares at a Kage's shoulders; they stare at the office. Go ahead and say what the lightning's doing.",
                "Thirty years of drawing rivalry, and the machine is turning me INTO it. I pick fights with doors now. With the sea. Last week I challenged my own reflection and the mirror is still cracked and I do not remember doing it. The drain runs both ways, in the end. It always ran both ways.",
                "The founders gave their wars away gladly and their engine kept the sky off us. Somewhere between them and me, the village stopped giving and the engine started TAKING, and the man in this seat became the part of the pipe that tastes everything first.",
                "Enough. The sky's turning and the account is due, and one of us decides tonight what this village runs on. The board is blank, %name. It's waiting for the last posting. Come write it."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Step onto the storm floor.", nextPage: 19 }
            ] },
            { ...storyPage("The Quiet Storm", "The storm floor, Kesa's cable maps unrolled on the rail", "Kage Raiko Veyr", [
                "What is that. Bring it here. Slowly, the wind's a thief.",
                "Kesa Volt's ridge line. I know this drawing; it crossed my desk twelve years ago with a note from the arena council calling it a widow's grief. I signed the note. I SIGNED it. And now you've built it, and the Low Terraces slept through the cyclone's first arm with the engine cold. My engine, cold, and three hundred roofs still standing.",
                "I asked for a quieter storm the way a man asks the sea for mercy. Rhetorically. Nobody brings one.",
                "Call the line, %name. Loud, into the wind, like an odds-runner at last bell. I want the whole sky to hear the number that beats mine."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "\"Three hundred roofs. One district. Engine cold. And the district SAW it hold.\"", nextPage: 5, requireTrait: "sv88-woke-the-district" },
                { text: "Open Vanta's storm log to the signed pages and read him every line.", nextPage: 6, requireTrait: "sv88-logged-the-storm" },
                { text: "\"Your own odds-runners moved the line. The board already believes it.\"", nextPage: 7, requireTrait: "sv88-baited-the-board" },
                { text: "Set the anchor splice on the rail and let the wind sing through it.", nextPage: 8 }
            ] },
            { ...storyPage("What the District Saw", "The storm floor, the Low Terraces' lamps visible far below", "Kage Raiko Veyr", [
                "The district watched it hold. Then the book's closed, isn't it. I can argue with a rigger. I can't argue with three hundred families who slept through a cyclone and woke up owing nobody their anger.",
                "Thirty years, I asked every furious person who climbed this tower to bring me a quieter storm. You went and RIGGED one.",
                "Three hundred families saw it hold. I cannot call that a lucky night, and I cannot argue with people who slept through the proof."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He looks to the turning sky.", nextPage: 15 }
            ] },
            { ...storyPage("The Signed Log", "The storm floor, Vanta's log flat under Raiko's wide hand", "Kage Raiko Veyr", [
                "Hand it over. I've torn up prettier odds sheets than this. Let's see if it tears.",
                "Wind loads at the ridge anchors. Draw at every junction: zero. Roof counts, hour by hour, in that old bookmaker's hand, SIGNED. Vanta hasn't signed anything but purse sheets in forty years; he told me ledgers outlive testimony and testimony gets old men killed. He signed every page of this one.",
                "The figures hold. Worst arm of the cyclone, and the figures hold without one grudge burned.",
                "The figures survive my reading. Vanta taught my clerks too well, and it seems he saved his best lessons for you."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He sets the log down.", nextPage: 15 }
            ] },
            { ...storyPage("The Board's Own Odds", "The storm floor, a torn odds slate spinning in the wind between you", "Kage Raiko Veyr", [
                "I saw the line move. Dawn bell, the runners re-chalked storm damage odds against the Low Terraces, and I stood at this rail and told myself it was a clerk's error. Three times I told myself that.",
                "You let the odds-runners find the anchor line and let greed do the arguing. My own board, betting against my own engine. That's a cruel way to prove a thing.",
                "It's also the only proof a bookmaker's village was ever going to believe, and you knew it, and I trained the whole village to know it, so the cruelty is mine coming home.",
                "My own board believes the ridge before it believes me. A bookmaker knows when a line has moved for good."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He lets the torn slate spin away.", nextPage: 15 }
            ] },
            { ...storyPage("The Splice", "The storm floor, the anchor splice knotted to the rail, holding", "Kage Raiko Veyr", [
                "One splice. Her splice; I'd know that knot off a drawing at a hundred paces. It held the ridge line through the first arm, didn't it. Of course it did.",
                "Twelve years ago I signed a note calling this grief. The widow was the best rigger on the coast and I signed the note without standing up from my desk.",
                "And now her knot is holding my sky off my village without my engine, and the man who signed the note gets to stand here in the wind it's beating.",
                "Her knot holds no grudge about it. It just holds."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He rests two fingers on the splice.", nextPage: 15 }
            ] },
            { ...storyPage("Her Daughter Says the Why", "The gate stair door banging open, Mira crossing the storm floor", "Mira Volt", [
                "You held the gate for me once tonight already, %name. Stand off the chalk now. This one's mine to post.",
                "Kesa Volt, Kage. My mother. Your board milked her grief for six years and kept her name drawing after her heart quit, and your council filed her ridge line under a widow's grief, and TONIGHT her line is the only thing between your village and your sky.",
                "Here is her reason, in her own hand, and I am going to do the one thing this village is built to prevent. I am going to say it out loud, ONCE, and keep it."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Let her say the why.", nextPage: 10 }
            ] },
            { ...storyPage("The Reason, Kept", "The storm floor, Mira reading from a slate that never reached the shaft", "Mira Volt", [
                "'I am angry because I warned the council the low moorings would fail, and they laughed, and my husband drowned at the low moorings. I am angry because my grief was posted as entertainment. I am angry because anger is all of him I have left, and this village keeps trying to collect it.'",
                "That's it. That's the whole account. Six years of your engine's best vintage, and it fits on a slate.",
                "It's settled now, Kage. Not drained. SETTLED. Said out loud by her blood, kept where it was born, and none of it, not one drop, goes down your pipes.",
                "My mother sends her regards. Every roof they're holding up tonight is signed with them."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "The Kage looks at the slate a long time.", nextPage: 11 }
            ] },
            { ...storyPage("The Bookmaker's Silence", "The storm floor, the wind oddly gentle for a breath", "Kage Raiko Veyr", [
                "You let her carry it. You rigged her mother's sky and then stood aside and let the daughter say the why. I have watched this village settle scores for thirty years, and I have never once seen anyone GIVE one back.",
                "I asked angry people for a quieter storm. I never guessed it would arrive as somebody's mother, spoken aloud by somebody who kept her."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He looks at the slate a moment longer.", nextPage: 15 }
            ] },
            { ...storyPage("A Sky Without a Why", "The storm floor, the district's lamps below, the maps not in your hands", "Kage Raiko Veyr", [
                "The Low Terraces held. I know. I've been standing at this rail watching a district that should be kindling sleep like a fed cat, and my engine never spent a drop on it.",
                "But whose answer is it, Jonin? Who drew it? Who was laughed out of my council for it, and who paid for that laughing? Give me the name, and I'll chalk it over my own.",
                "Because a quiet sky with nobody's name under it is just weather between rounds. I can't hand a village to a lucky night.",
                "That's the gap in your argument. Fill it, or fight me."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He turns back to the storm.", nextPage: 19 }
            ] },
            { ...storyPage("The Answer in Your Kit", "Kesa's maps unrolled in Raiko's scarred hands", "Kage Raiko Veyr", [
                "Kesa Volt's ridge line. Built, tested, and holding three hundred eleven roofs while you and I stand here under a clear patch of her sky. So it is not the engineering that's unfinished, Jonin.",
                "It's the ownership. You pulled her reason out of a ravine. You carried it through a squad. You laid it beside the line she designed, in the one place it could finish the argument.",
                "And then you put it back in your own kit. Safely. For later. On somebody else's behalf. That is exactly how every holder in this tower began, myself first of all.",
                "You saved her answer. You did not give it back. The sky respects a rigged line and I respect a saved one, but neither of us can pretend a reason held in your coat is a reason set free."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He rolls the maps with terrible care.", nextPage: 19 }
            ] },
            { ...storyPage("Vanta Opens the Books", "The storm floor, an old bookmaker setting ledgers on the rail one by one", "Elder Vanta", [
                "Out of the way, child. This bet's mine, and it's been on the books forty years.",
                "Every bout I ever chalked, Raiko. And here, the column with no header, nine shares wide, that I collected on for thirty of those years, and here, the season I started matching bouts the tower asked for and telling myself matchmaking was a bookmaker's art.",
                "I knew what the floor drank. I counted around it, the way you count around a debt you mean to die owing.",
                "So chalk it up properly, both of you. Vanta, third share, thirty years, paid in silence. If the village wants a villain with a face, mine was always closer than his. Tonight I'm settling at the window like everybody else."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He sets the last ledger down.", nextPage: 19 }
            ] },
            { ...storyPage("The Last Answer", "The storm floor, Raiko looking from the proof to the turning sky", "Kage Raiko Veyr", [
                "All right. I have no storm left to answer with.",
                "Let's find out what still stands when mine is gone."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. The storm decides now.", nextPage: 19 }
            ] },
            { ...storyPage("Answer for the ninth share. You've been drawing it for seasons.", "The reckoning", "Kage Raiko Veyr", [
                "So the elders' cut found a new name after all. Good. Then you've sat where I sit: paid, on schedule, out of a floor that drinks your neighbors.",
                "Tell me you never once matched a bout in your head, thinking, that one's angry enough to cover the month. Say it and I'll call you a liar into this wind.",
                "That thought is the seat, Jonin. That thought, every day, for thirty years, with a bell on it. You carried it two seasons and climbed a tower to make it stop. Imagine carrying it so long you waive the fees."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. The storm decides now.", nextPage: 19 }
            ] },
            { ...storyPage("Answer for the routing mark. My bout was written before I fought it.", "The reckoning", "Kage Raiko Veyr", [
                "The Pike bout. Yes. Third-exchange loss, purse bagged in advance. I initial the routing slates in winter when the intake runs thin; scripted bouts draw steadier than honest ones, if never as rich. A fixed fight is a promise, and the floor loves a promise.",
                "Here's what the routing office doesn't know. Your slate wouldn't take the script. The result filed itself blank, three times, and a clerk was disciplined for it, and I kept the blank slates in my desk like pressed flowers.",
                "The board writes everyone in this village, Jonin. It cannot seem to write YOU. When you decide what tonight was, remember that of the two of us, only one ever had a choice."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. The storm decides now.", nextPage: 19 }
            ] },
            { ...storyPage("Answer for Kesa Volt. Her line holds your sky right now.", "The reckoning", "Kage Raiko Veyr", [
                "Kesa Volt. The rigger. The note on her ridge line crossed my desk and I signed it 'a widow's grief, no action,' twelve years ago, between a lunch and a hanging. I remember, because I remember everything; that's my price.",
                "Here is the part I have told no living soul. I tested her line. One ridge, one winter, quietly. It held. And the odds changed the moment it did: a village that stops needing the Engine stops feeding the account upstairs, and that account does not take cancellations. So I buried the winning line and kept the whole village staked on the losing one.",
                "Her anchors are holding my sky as we stand here. Tell her daughter that, afterward. Tell her the Kage tested the line, and it held, and he buried it anyway. She deserves to hate me with the figures in hand."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. The storm decides now.", nextPage: 19 }
            ] },
            { ...storyPage("The Blank Board", "The storm floor, the last blank slate between you and the Tyrant rising", "Kage Raiko Veyr", [
                "Talk's done. Bell's up. Thirty years I've been the roof over this village, and I'd stand under every storm of it again, and that's the exact problem: a man who'd do it all again should never be allowed to.",
                "The board is blank, the debt is due, and the whole village climbed the hill to see what gets posted. Last slate in Stormveil, Jonin. It's yours.",
                "Show me what fights when the reasons are free."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", leftName: "Player", rightName: "Kage Raiko Veyr", rightImage: "/portraits/kage-raiko-veyr-hollow.webp", choices: [
                { text: "Show him the quiet storm.", nextPage: 4, requireTrait: "sv88-better-storm-carried" },
                { text: "Let Mira say her mother's reason.", nextPage: 9, requireTrait: "sv88-better-storm-deferred" },
                { text: "Let Vanta answer for the ninth share.", nextPage: 14, requireTrait: "sv92-witness-present" },
                { text: "Show him Kesa's answer from your kit.", nextPage: 13, requireTrait: "sv88-unfinished-answer", forbidTrait: "sv88-better-storm-ready" },
                { text: "Show him the district that held.", nextPage: 12, requireTrait: "sv88-line-held", forbidTrait: "sv88-reason-proof-any" },
                { text: "Answer for the ninth share. You've been drawing it for seasons.", nextPage: 16, requireTrait: "sv58-took-the-cut" },
                { text: "Answer for the routing mark. My bout was written before I fought it.", nextPage: 17, requireTrait: "sv70-read-the-mark" },
                { text: "Answer for Kesa Volt. Her line holds your sky right now.", nextPage: 18, requireTrait: "sv88-reason-proof-any" }
            ] },
        ], [
            { text: "Refuse the challenge. Out loud. Before everyone. Then break the board.", conclusion: "You say NO into the wind, to the seat, to the bout, to the whole hungry rite, and the crowd's roar dies to a sound like held breath. Then you put your fist through the blank board, and every posted account in Stormveil comes due at once, reasons flooding home to people who forgot they owned them. The sky goes honest and wild. Raiko attacks you laughing, free for the first time in thirty years. Far under the square the cistern pulls once at the flood of reasons rushing home to their owners, finds every account already claimed, and goes still for the first time in four hundred years. Up the hill, the Hollow Gate's quarter draws on Stormveil and comes up dry.", trait: "honorable" },
            { text: "Accept the bout. After it, the valve gets a meter, a law, and a watch.", conclusion: "You take the challenge on your terms, spoken into the record: after tonight, nothing feeds the floor without posted consent, witnesses, and a meter anyone can read. The crowd murmurs; consent is a colder religion than spectacle. Raiko nods slowly, like a man hearing his sentence and approving the judge, and the storm takes his shape. After tonight the cistern still opens on its old schedule, but it may drink nothing without a posted name and a witness, so it finds nothing lawful and shuts again. The Hollow Gate's quarter waits on a consent this village just learned how to refuse.", trait: "suspicious" },
            { text: "The seat, the valve, the ledger. Mine.", conclusion: "You post the only slate that was ever going to satisfy you: your own name, for the seat itself. The board accepts before the chalk dries; it has been grooming this account since the night it posted you twice. Raiko's grin comes back one last time, wide and terrible and relieved. 'Then win it,' says the storm, with his voice. The cistern does not go still for you. It holds its breath, four villages' worth of banked tribute, and waits, patient as arithmetic, for its new seat to post the first thing it will drink.", trait: "ambitious" },
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
                "Signed and witnessed. Welcome to Ashen Leaf, %name. I hope you get to keep that answer."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("The Strongest", "The Register wall", "Registry Duty Clerk", [
                "The strongest shinobi alive. You said that in a records hall full of clerks, which took its own kind of nerve.",
                "The wall is taking it. Big answers sink deep. I have watched this wall for nineteen years and I still don't know if deep is good.",
                "Signed and witnessed. Welcome to Ashen Leaf, %name. Try not to break anything on your way up."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("A Builder", "The Register wall", "Registry Duty Clerk", [
                "Something that outlasts you. A builder's answer.",
                "We had a boy give almost that same answer some years ago. I still think about his line sometimes.",
                "Signed and witnessed. Welcome to Ashen Leaf, %name. Build slowly and keep your drawings somewhere safe."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("A Seeker", "The Register wall", "Registry Duty Clerk", [
                "You want to uncover what people hide. You said that out loud, to a clerk, in the building where the village keeps its records.",
                "I am going to write it exactly as you said it, because that is my job, and because part of me wants to see what happens.",
                "Signed and witnessed. Welcome to Ashen Leaf, %name. Be careful which doors you open first."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("Not Yet", "The Register wall", "Registry Duty Clerk", [
                "You don't know yet. That is the most honest answer anyone has given me all season.",
                "Odd, though. When I hold the quill over your line, it drags. Like the wall is waiting for a word that should already be there.",
                "I'll write 'undecided.' Signed and witnessed. Welcome to Ashen Leaf, %name. Come back when you know, and I'll add it myself."
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
                "I can read it now. The word is 'stamped.' And there's a shape drawn under it that isn't a word. A circle, cut into four pieces. I always thought it was a wheel, maybe part of the water-screw.",
                "It isn't part of the water-screw, is it. He was looking at something bigger than a fire, and his hand gave out before he could name it."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Walk to the racks.", nextPage: 5 }
            ] },
            { ...storyPage("The Second Feeding", "Iron racks, fresh graft-slats in rows", "Narrator", [
                "Twenty steps left, the hand carving stops and the iron begins. Racks from floor to ceiling, loaded with pale wooden slats.",
                "No signatures on these. Each slat carries a stamp instead: a household mark, a season, and one small tidy character that means 'approved.'",
                "The nearest slat still smells of fresh sap. Somebody's future was cut this week, without their name on it, and the fire is drawing warmth from it while you stand here.",
                "And there is a wrongness you feel before you can name it. When the signed founders' tokens burn, their ash lifts UP: into the flue, into the mortar, into the warm old bones of the village.",
                "The stamped slats burn differently. Their smoke rises, yes, enough to keep the room alive, enough to keep the lie useful. But the ash does not rise. It falls, through a grate beneath the racks, down into a black seam under the kiln. Fire is not supposed to drain. Mori watches it fall, and for once the record keeper has no quick answer ready."
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
            { ...storyPage("The Manifest Under the Ash", "Off the road, a folded paper under the second crate's false bottom", "Toma Reed", [
                "This was folded under the false bottom of the second crate. A shipping hand wrote it, not a survey hand. That's the first wrong thing. Listen to the rest.",
                "Graft-slats, late season. Freshness, high. Household marks, sealed. Destination: Fifth Anchor escrow. Buyer mark, a circle cut in four. And then two lines that don't belong on a village offering at all. Local draw, approved. Lower draw, pending.",
                "Local draw. Lower draw. The ink's bled at the bottom where somebody shut it too fast, but one line's still clear, and I wish to the roots it weren't. 'Deliver surplus below Rootfire intake.'",
                "Surplus, friend. They have a word for what's left of us after they've spent us. And there's a second mouth somewhere under that fire that this whole village has never once been told about."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Pocket the manifest.", nextPage: 7, trait: "al65-found-gate-manifest" }
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
            { text: "Scatter the crates into the dark. Burn the wagon and manifest.", conclusion: "Futures vanish into the treeline in twelve directions, unrecoverable and free. The wagon burns bright behind you, and with it the only paper that proved whose stamp sent them. For one moment the ash falls the wrong way, down through the road dust instead of up into the air. Toma sees it. So do you. Neither of you has paper enough left to prove it.", trait: "merciful" },
            { text: "Hide two crates. Let the squad recover the rest, and keep the manifest.", conclusion: "The squad finds a stalled wagon, a flustered escort, and four crates of six. You keep two crates of futures and the manifest that proves everything. The other four ride on toward the fire, rattling softly, and you make yourself listen until you can't hear them. By dawn Toma has copied out that manifest's worst line three times, each copy worse than the one before, because his hand keeps shaking.", trait: "suspicious" },
            { text: "Send Toma into the dark with the crates. Face the squad alone.", conclusion: "He runs because you told him to, and he doesn't look back, because you told him that too. The lanterns ring you in. The squad captain checks your seal against a list, slowly, and asks you, twice, where your partner went. Behind him the wagon rolls on toward the kiln road, and something inside one crate turns like a small wooden wheel trying to climb water that is not there.", trait: "loyal" },
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
                "We do not digest what is stolen, child. We hoard it, the way a wound hoards heat. Four hundred seasons of stolen mornings are packed inside this fire, and we cannot hold the door shut on them much longer.",
                "And hear what we are NOT, so the village hears it from us. We gave our green years to the fire above us. Our ash became walls, medicine, harvests, winter mortar; we knew the price, and we signed it. We never gave to the dark beneath this floor. The stamped slats are not gifts. They are theft wearing orchard language, and theft runs downward. We were built to guard a gift, child. Not to feed a drain."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Ask what the fire wants from you.", nextPage: 2, trait: "al75-founders-reject-drain" },
                { text: "Show them the tool outlines you copied from the Reed wall.", nextPage: 3, requireTrait: "al42-filed-a-report", trait: "al75-founders-reject-drain" }
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
            { text: "Ask the Avatar what it hasn't told you. Then fight.", conclusion: "'That the gift was never enough on its own,' it answers at once. 'Two safe winters a generation, and then the cold got its vote back. The keepers used that thinness to excuse the first theft, and they told the living that the dead had agreed to it. We never agreed. We have been trying to say so through the fire ever since.' The truth settles onto your shoulders, and the Beast comes on.", trait: "suspicious" },
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
                "I am telling you this so you know exactly what you are arguing with. Frost-fall is three days away. Bring me a better winter by then, or I will keep this village warm the only way I have ever known."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Leave her office.", nextPage: 7 }
            ] },
            { ...storyPage("The Unwilling", "The orchard office", "Kage Hoshina Enju", [
                "You want the mechanics. All right. You've earned the honest version.",
                "The founders' fire ran on futures given freely, and it ran thin. Gladness is a poor fuel. Two safe winters a generation, and after that, the cold got a vote again.",
                "An unwilling future burns four times hotter. Five, if the person is young. There. Now you know the price of every warm floor you have ever stood on in this village, including the one under your feet right now.",
                "And since you have made me honest tonight, here is the floor beneath that floor. Not all of it burns here. The village keeps enough ash to stay warm. The surplus goes down, through a lower draw, to a buyer that four villages share and none of us name. They mark it with a quartered circle. Its name is Hollow Gate. I have signed its approvals for thirty years, and I told myself every single time that a tax is not a sin as long as you spend your share of it on children.",
                "And do not let me hide behind the word inherited. I did not build the lower draw, no. But I re-signed its approval every winter with my own hand, thirty times, and every single time I told myself the roof had chosen it for me. The roof did not. Frost-fall, Jonin. Bring me a better winter."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Leave her office.", nextPage: 7, trait: "al85-hoshina-named-gate" }
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
                "I know. You have to go down alone. I hate it, and I checked the hinges on that stair door twice anyway, because hating a thing has never once stopped it.",
                "Take Aren's letter with you. He wrote 'remember me arguing,' and tonight is the biggest argument this village has ever had.",
                "Whatever happens down there, my mother's kitchen has tea in it afterward. I need you to plan on that. Having an afterward is half of winning.",
                "Go on down. A door is only a shelf that swings. I can mind one of those."
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
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "The fire is not one fire.", nextPage: 4 }
            ] },
            { ...storyPage("The Lower Draw", "The Rootfire behind her: an upper flame, cedar-gold, and beneath the grate a darker pull", "Kage Hoshina Enju", [
                "You have heard the name by now; the appraiser sells it cheaper than I ever could. Now look at what it means. Look at the fire. There is the flame you can see, cedar-gold and warm, the village's flame. And under the grate, that darker pull. That is not flame. It is not a direction at all. It is a hunger.",
                "The Rootfire keeps only enough to warm Ashen Leaf. It always has. The rest goes down. There is a lower draw beneath this floor, and it has carried the surplus of every future I ever cut to a buyer four villages share and none of us name.",
                "I will name it, since you came all this way. The records mark it with a quartered circle. Its true name is Hollow Gate. For thirty years I told myself it was only a tax, that every village paid one, and that we were the kinder village because at least our children got back the warmth that came home.",
                "So hear exactly what I signed, and exactly what it cost. I did not spend Aren Reed once, for warmth. I spent him twice. Once to keep this village warm, and once to pay the Gate. The Gate did not choose the branches. I did. Now show me what you brought, and let us find out whether it answers both."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Face her across the anvil.", nextPage: 20, trait: "al100-lower-draw-confessed" }
            ] },
            { ...storyPage("The Better Winter", "The anvil, water dripping from your sleeve", "Kage Hoshina Enju", [
                "Show me what you're carrying. Slowly.",
                "Aren Reed's water-screw. Rebuilt, full size, and running in my east channel since the trial night. And Jorun planed the housing, didn't he. The survey cut the bridge out of that man's head thirty years ago, and his hands kept it anyway. His HANDS kept it.",
                "I asked for a better winter because no one ever brought me one. I thought that made the question safe. Thirty years I thought that.",
                "And understand what you have actually done, if this holds. A future that feeds the village here cannot be sent down the lower draw. You have not only answered the cold. You have answered the Gate. I built my whole life on the certainty that neither one could be answered, and you carried both up my east channel in a dead boy's machine.",
                "Say the numbers out loud, %name. All of them. I want to hear this from the person who built it."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "\"Ninety mouths from the terraces alone. And the terrace families watched the water climb.\"", nextPage: 6, requireTrait: "al88-proved-the-winter" },
                { text: "Open Mori's book to the measured pages and read her every line.", nextPage: 7, requireTrait: "al88-held-the-proof" },
                { text: "\"Your own survey filed the proof. You have already read it three times.\"", nextPage: 8, requireTrait: "al88-baited-the-survey" },
                { text: "Set Aren's model on her anvil and let the water speak for itself.", nextPage: 9 }
            ] },
            { ...storyPage("What the Village Saw", "The anvil, her hands very still", "Kage Hoshina Enju", [
                "The terrace families watched. Then it is already finished, isn't it. Arithmetic can be argued with. A village that has seen water climb cannot.",
                "Thirty years, I asked every angry person who stood in front of me to bring me a better winter. You are the first one who walked in carrying it.",
                "Then I cannot bury it again. Not this one. A village that has watched water climb does not unwatch it."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She looks at the shears.", nextPage: 16 }
            ] },
            { ...storyPage("The Measured Pages", "Mori's book open on the anvil", "Kage Hoshina Enju", [
                "Give me the book. Sit down while I try to break it.",
                "Your flow rate is optimistic. No. No, it isn't. The figures hold. Worst stretch, driest week, and still ninety. Mori taught you to make a number survive an enemy reading, and I am the enemy, and it survives.",
                "He signed every page. The one record that old man ever kept that argues back, and he put his name under it for me to see.",
                "The figures survive me. I have spent my whole life being the thing figures could not survive."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She closes the book.", nextPage: 16 }
            ] },
            { ...storyPage("Her Own Eyes", "A survey report unfolded between you", "Kage Hoshina Enju", [
                "I read that report three times and refused to understand it. East fields wet in a dry week. Cause unrecorded. My own survey, my own ink, laid on my own desk.",
                "You used my own eyes against me. That is cruel proof. Effective proof often is; I have leaned on that fact for thirty years, so I can hardly complain now.",
                "You are the first angry person who was cruel enough to answer the question the way I would have.",
                "I read this three times and chose not to understand it. I do not get to choose that anymore."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She folds the report closed.", nextPage: 16 }
            ] },
            { ...storyPage("The Water Answers", "The model turning in a channel of firelight", "Kage Hoshina Enju", [
                "One cracked vane. He never got to fix it. I know this little machine better than you do; I tested the full design myself once, alone, at night, in this room. It worked then too.",
                "And now it works upstairs, in my village, in the cold, without one future burned.",
                "Thirty years of angry visitors, and the answer finally walks in as a machine too small to argue with.",
                "The machine I burned is turning in my own channel. He never got to fix the vane, and it turns anyway."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She watches the water climb.", nextPage: 16 }
            ] },
            { ...storyPage("This Part Is Ours", "The kiln stair door opening behind you; Toma and Sera come down into the firelight", "Toma Reed", [
                "You kept the way open for us, %name. We'll carry him from here. Step back.",
                "That's Aren's model. Cracked vane and all. You cut him quiet, Kage, and you signed the cut yourself. Look at it. His machine still climbs.",
                "I practiced this upstairs. It sounded better there. Mother, you say it. You always had the better hands for the hard parts."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Let Sera speak.", nextPage: 11 }
            ] },
            { ...storyPage("Handwriting", "The chamber, Sera laying the letter flat on the anvil", "Sera Reed", [
                "My son wrote this. I know that now. I know the threes he never closed. I know how he pressed too hard on the page when he was angry, and he was angry so much of the time.",
                "I spent twenty years grateful he was quiet. I washed his shirts and thanked the roots for a peaceful boy. You did that to me. You made a mother grateful for the hole where her son used to argue.",
                "Ninety mouths. That is what his channel feeds. I came all this way to say the number to your face, in his own hand.",
                "And my son was not a bench."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "The Kage looks at the letter.", nextPage: 12 }
            ] },
            { ...storyPage("A Mother's Proof", "The Rootfire dimming, Hoshina very still", "Kage Hoshina Enju", [
                "You let them carry it. You stood back and let a mother and a shelf-mender put me in the ground with their own hands, and you only held the door.",
                "Thirty years I asked angry people for a better winter. I did not expect a mother to bring me handwriting. I never built a defense against handwriting."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She cannot look away from the letter.", nextPage: 16 }
            ] },
            { ...storyPage("Water Without a Name", "The channel numbers chalked on a slate", "Kage Hoshina Enju", [
                "Ninety mouths. Yes. The number is real. I can see the east field is wet from my own tower window; I have been staring at it all week.",
                "But whose future is this, child? Who paid for it? Who gets to stand in front of me and say: that was mine, and you took it?",
                "Numbers without names are only another kind of filing, and filing is the one thing I have never been afraid of.",
                "You have brought me water. You have not brought me the person I stole it from."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She sets the slate down.", nextPage: 20 }
            ] },
            { ...storyPage("The Unfinished Answer", "Aren's model in her scarred hands", "Kage Hoshina Enju", [
                "Aren Reed's model. Yes. I know the shape. I countersigned the cut that made it an orphan.",
                "It climbed in a basin once, in front of me. It climbed in my private tests too. That was never the question, child.",
                "And the full screw turns upstairs in my east channel; I have watched it from my own window. But whose winter is it, child? It runs with no name behind it, and a future fed back namelessly is a rumor. I cannot answer the Gate with a rumor, and I cannot hand a village to one either.",
                "You kept Aren's own page in your kit. The proof of who paid, in his own hand, and you never gave it back to the family it names. That is not nothing. It is only not enough to stop my hand."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She sets the model down gently.", nextPage: 20 }
            ] },
            { ...storyPage("Mori Reads the Pattern", "Mori opening the bloom charts on the anvil beside the shears; Hoshina says his name once, quietly", "Elder Mori", [
                "No, child. Step back. This page is mine.",
                "Forty years of flowers. Forty years of surveys. Forty years of telling myself a pattern isn't a sentence as long as nobody reads it out loud.",
                "My hand. My count. My cowardice, if we are being accurate, and I am a record keeper, so we will be accurate.",
                "The flowers were never a blessing. We carried bread to houses the fire had already marked, and I filed the paper that called it luck. I am done filing endings."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "He sets the charts beside the shears.", nextPage: 20 }
            ] },
            { ...storyPage("No Answer Left", "The Rootfire low, Hoshina looking at the shears on the anvil", "Kage Hoshina Enju", [
                "I built my life around one answer. You proved it was not the only one.",
                "Now we find out whether I can let it go."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. The tree chooses now.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for Mori's charts. You've known the pattern for years.", "The reckoning", "Kage Hoshina Enju", [
                "So Mori finally taught someone to read the blooms. Good. Then you've stood where I stand. You've looked at a flower on a fence and known exactly what it was going to cost that family.",
                "Tell me you never once looked at a bloom and thought: better if it wilts early, before the survey sees it. Say it, and I'll call you a liar to your face.",
                "That thought is my entire life. One flower, one house, one winter, every day, for thirty years. You carried the knowledge for one season and look what it did to you."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. The tree chooses now.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for my page. You kept my cut in your wonder room.", "The reckoning", "Kage Hoshina Enju", [
                "Yes. Your stub is in my room of taken things. The oldest cut I have ever handled, and the only one that isn't mine, and I couldn't burn it and I couldn't repair it, so I kept it. That is what keepers do. We keep.",
                "You stood at my wall and demanded yourself back. Nobody does that. The pruned never know to ask. You knew, and you asked, and I have not slept properly since.",
                "When you hold the shears, and I believe now that you will, go find whoever cut you. And when they explain themselves with arithmetic, the way I have tonight, remember me a little kindly."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. The tree chooses now.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for Aren Reed. His future gets finished.", "The reckoning", "Kage Hoshina Enju", [
                "Aren Reed. The water-screw. The complaint written in a shaking hand. You promised his brother it gets finished. I know, because I countersigned Aren's cut myself. Mine was the approving stamp.",
                "Here is the part I have never told a living person. I tested his screw. Alone, at night, in this room. It worked. It would have watered the east terraces and fed ninety more mouths.",
                "And his complaint would have emptied my kiln within five years, so I chose the kiln. That is the cut I mourn at every frost-fall. Tell his brother that, afterward. Tell him his Kage tested the screw, and it worked, and she burned him anyway. He deserves to hate me accurately."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Enough. The tree chooses now.", nextPage: 20 }
            ] },
            { ...storyPage("The Shears on the Anvil", "The Rootfire at full roar, Hoshina alight", "Kage Hoshina Enju", [
                "Enough talk, then. Look at me. Thirty years of being the answer to winter, and this is what's left, and I would do every year of it again. That is exactly why it has to be taken from me.",
                "The shears, the fire, and a wall of futures upstairs. Somebody decides tonight what this village runs on. The fire has already cast its vote.",
                "Show me, black flower. Show me what grows where nothing was permitted to."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", leftName: "Player", rightName: "Kage Hoshina Enju", rightImage: "/portraits/kage-hoshina-enju-hollow.webp", choices: [
                { text: "Show her the better winter.", nextPage: 5, requireTrait: "al88-better-winter-carried" },
                { text: "Let the Reeds show her the better winter.", nextPage: 10, requireTrait: "al88-better-winter-deferred" },
                { text: "Let Mori answer for his charts.", nextPage: 15, requireTrait: "al92-mori-present" },
                { text: "Show her Aren's model.", nextPage: 14, requireTrait: "al88-unfinished-answer", forbidTrait: "al88-better-winter-ready" },
                { text: "Show her the east channel numbers.", nextPage: 13, requireTrait: "al88-water-proven", forbidTrait: "al65-saved-the-screw" },
                { text: "Answer for Mori's charts. You've known the pattern for years.", nextPage: 17, requireTrait: "al58-took-the-knowledge" },
                { text: "Answer for my page. You kept my cut in your wonder room.", nextPage: 18, requireTrait: "al70-claimed-the-name" },
                { text: "Answer for Aren Reed. His future gets finished.", nextPage: 19, requireTrait: "al88-reed-proof-any" }
            ] },
        ], [
            { text: "Break the shears on the anvil. Give every future back.", conclusion: "The shears part with a sound like a held breath ending. Upstairs, forty strides of cedar cry out at once as every stolen self comes home mid-life. The walls groan, because the ash in them was load-bearing. Deep beneath the kiln, the lower pipe empties with a sound like a throat losing a word, and the seam under the fire goes cold. For the first time in living memory the Rootfire draws nothing downward. The winter will be honest now, and hard, and no one else's future will pay for it. Hoshina attacks you weeping with relief.", trait: "honorable" },
            { text: "Bind the Rootfire to willing gifts alone. Sheathe the shears forever.", conclusion: "The fire shrinks to the founders' flame, old and thin and clean. Every stamp on every unsigned slat splits down the middle; from tonight the Rootfire accepts only signatures, adult hands, a named price. Below, the lower seam opens once, hungry, finds nothing legal left to take, and closes. Ashen Leaf must ask for its warmth honestly now, and every hard winter will be a vote on your mercy. Hoshina bows to the arrangement, and then the fire wearing her does not, and it comes at you all the same.", trait: "merciful" },
            { text: "Take the shears. The village needs a keeper who was never fooled.", conclusion: "The grips are warm, and they fit your hand exactly, and you understand all at once why: the Register has been growing you toward this room since the day it bloomed. Below the fire, the dark seam does not close. It waits, warmer by a single degree, for your first approval. Hoshina smiles like winter finally breaking. 'Then prove it,' says the fire, with her mouth.", trait: "ambitious" },
        ]),
    ],
    "Frostfang Village": [
        milestone("Frostfang Village", 4, "The Pack Survives", "Snow Warden Pup", "❄", [
            { ...storyPage("First Bell", "The training yard at first bell, breath-fog in rows, lantern lines overhead", "Captain Yura", [
                "New intake. Stand on the worn spots; they're worn for a reason.",
                "I'm Captain Yura. You'll freeze in that coat. After drill, requisition a real one and tell them I sent you; the clerk owes me.",
                "The rules here are short, because the cold doesn't wait through long ones. Out here, a person alone dies. So Frostfang made one rule above the rest: nobody is ever alone. We keep that rule with the Roll. Every bell, you answer your name, you hear your neighbor answer theirs, and everyone goes back inside knowing no one is missing.",
                "The book calls the same thing by a colder name: the Count. It is the Roll written down as law, a marked wrist and a logged route and a rescue the wall owes you. Hold the difference somewhere you won't lose it. The Roll is people calling for people. The Count is what the wall writes down about it afterward.",
                "Elder Sova takes the intake words. Answer her plainly. She's heard everything twice."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
            { ...storyPage("The Intake", "The roll stone, Elder Sova with the Count book open", "Elder Sova", [
                "Stand easy. This is not a test. It is the intake: a few words, one question, and then soup.",
                "There are four words the wall lives by, and I only teach them once. Say them back so they stick: the checked are counted, the counted are kept, the kept are warm.",
                "Now the plain meaning, because new ears have earned one. Checked means your wrist answered the plate. Counted means your name is written in the rescue book. Kept means that if you vanish, the wall owes you a search. Warm is the promise the first three make good on.",
                "Good. Now the one question, the one this book keeps beside every name. Tell me yours, plainly. Why do you stand in the Count?"
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "\"So the cold takes nobody on my watch.\"", nextPage: 2, trait: "ff4-count-protector" },
                { text: "\"To be the strongest back in the pack.\"", nextPage: 3, trait: "ff4-count-strongest" },
                { text: "\"Someone came for me once. I'm repaying it.\"", nextPage: 4, trait: "ff4-count-repayer" },
                { text: "\"I'm looking for someone who walked away.\"", nextPage: 5, trait: "ff4-count-seeker" },
                { text: "\"I don't know yet.\"", nextPage: 6, trait: "ff4-count-unknown" }
            ] },
            { ...storyPage("A Guard's Reason", "The roll stone", "Elder Sova", [
                "So the cold takes nobody on your watch. That's a guard's reason, and a good one to stand beside your name.",
                "Entered and counted, %name. The wall sleeps easier with a watch-stander in the book.",
                "Hold that reason where your hands can find it in the dark. Up here, winters burn through people's reasons faster than through lamp oil."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("A Strong Back", "The roll stone", "Elder Sova", [
                "The strongest back in the pack. Well, the pack needs strong backs. Only remember that the strongest back is the first to break if it carries alone. Write that down somewhere inside you.",
                "Entered and counted, %name. The pack could use a strong back that remembers it's a pack.",
                "Strength here isn't measured in what you can lift. It's measured in who you carried home. You'll learn the Roll."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("A Debt to Pay", "The roll stone", "Elder Sova", [
                "Repaying a rescue. Half the finest soldiers I ever entered in this book stood right where you stand, owing somebody their heartbeat.",
                "Entered and counted, %name. The book is glad to hold a debt-payer.",
                "Mind how you pay it. Some debts are better honored than settled. The settled ones stop keeping you warm."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("A Door That Closed", "The roll stone", "Elder Sova", [
                "Looking for someone who walked away. People rarely give me that answer, and when they do, they say it quietly, the way you just did. Up here, nobody likes the reminder that walking away is even possible.",
                "Entered and counted, %name. Welcome in from the cold.",
                "I hope you find them. And when you do, ask them why softly. The reason is never the one the Count wrote down for them."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("A Blank Line", "The roll stone", "Elder Sova", [
                "You don't know yet. That's honest, and this book keeps honest answers better than it keeps boasts.",
                "Entered and counted, %name. That's you in the book, blank reason and all.",
                "Come back when the word arrives. I'll enter it myself, in a good hand. The reason line stays open till then."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("The Fogged Plate", "The gate's mark plate, frost crawling where a wrist should read", "Captain Yura", [
                "Wrist on the plate. It reads you, it logs you into the Count, and that's the whole ceremony.",
                "Huh. Wipe it and try again.",
                "Stop. Look. It isn't misreading you. It's reading somebody. That's a name coming up, and it's an OLD name. Nobody's had a plate-read like that in twenty years.",
                "Sova. SOVA. The plate just read the new intake as someone long gone. Bring the book."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
            { ...storyPage("Someone Long Gone", "The gate, Sova's thumb on the fogged plate", "Elder Sova", [
                "Well. There is a thing I have not seen in a long career.",
                "Likely just frost in the works. The plates are old, and old things remember wrong.",
                "But I'll tell you what I tell the book, which is only ever true things. The plate doesn't read your skin. It reads what your wrist answers to. And yours answered with a name that left this world before you reached it.",
                "It's nothing. Or it's yours. Either way, the yard is waiting: the Warden pup slipped its pen again, and drill is drill. The pack watches its newest tonight."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Form up in the yard.", nextPage: 9 }
            ] },
            { ...storyPage("The Loose Warden", "The yard, a Snow Warden Pup pacing the drill square, six recruits in line", "Captain Yura", [
                "Listen up. The pup has broken out of the pens twice this month. It's young, it's frightened, and it is still two hundred pounds of teeth.",
                "The drill is simple. The formation holds, the newest takes point, and the pack backs the point. That isn't hazing. It's how we learn what your spine does when it counts.",
                "Nobody fights alone in Frostfang. But somebody always fights FIRST.",
                "Point position, intake. The bell is yours."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
        ], [
            { text: "Hold formation. Trust the line at your back.", conclusion: "You take point and stay exactly where the pack can use you, and six strangers become a wall behind your shoulders. The pup breaks against the formation like weather. Yura says nothing, but she marks something in the drill book, and the something has your name on it.", trait: "loyal" },
            { text: "Break formation. Take the pup down before it reaches the line.", conclusion: "You leave the line while Yura is still shouting the hold order, and you meet the pup alone in the open square. It goes down. So does the drill. Half the yard is furious and the other half can't stop looking at you, and neither half forgets.", trait: "reckless" },
            { text: "Watch its paws. Herd it toward the open pen instead.", conclusion: "You read the animal instead of fighting it: it isn't attacking, it's cornered. Two feints and a held gate later, the pup pens itself, panting, unbled. Yura calls the drill void and buys you soup anyway. 'Wrong orders, right call,' she says. 'That combination gets complicated here. You'll see.'", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 15, "The Missing Patrol", "Oathbound Soldier", "❄", [
            { ...storyPage("Five Names Unanswered", "The roll stone at third bell, snow starting, five names hanging", "Captain Yura", [
                "Roll call came up short this morning. Ruven's patrol never answered. Five names, and not one voice. They were posted on the northern ridge, and the ridge is empty: the fires are banked, the packs still full, and the men gone.",
                "The Kage ruled it at third bell. Desertion. Five deserters, struck from the Count, the case closed before their soup went cold.",
                "But Ruven has a wife, a dog, and the neatest kit on the north wall. Men like that don't run. Men like that get LOST, and lost means somebody goes and gets them.",
                "Kael closed the book, so we don't go as the Count. We go as weather. You coming?"
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("The Kage in the Snow", "The north gate, Kael Whitefang walking IN out of the storm carrying a shepherd", "Kage Kael Whitefang", [
                "Gate. Open. Now.",
                "This shepherd strayed past his line in the east folds. He's frostbit, not dead. Get him soup and a warm wall. Move.",
                "You two are bound north. Don't be.",
                "Hear the law of me, since you'll serve under it. A man stays in the Count while three things hold: his mark answers, his route is logged, and he keeps inside his rescue line. The shepherd broke one and kept two, so the Count still held him, so I went for him.",
                "Ruven's patrol broke all three. No mark answered, no route held, the line was crossed. The Count struck them, and a struck name is not mine to chase.",
                "You see banked fires and full packs and call it a riddle. I see a law that has kept children breathing for ninety winters. No one freezes inside my Count. No one. What the Count strikes, the snow may keep."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("What Yura Knows", "The north road, snow thickening", "Captain Yura", [
                "Here's what frightens me, and it isn't that he leaves people. He rescues better than anyone alive; I've watched him carry grown men home on his back through weather that kills.",
                "It's that the Count can tell him a man stopped counting, and he'll believe the Count faster than he believes his own eyes. Same man, both things at once. I stopped trying to make them fit years ago.",
                "Ruven banked his fire. You bank a fire when you mean to come back to it. Deserters don't bank fires. Lost men do.",
                "So tonight we follow the fire, not the book. There. Tracks, coming toward us. One set of boots, and whoever's in them is walking wrong."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("Dain Comes Back", "The road, a soldier walking out of the white with his hood down", "Frost Seal Echo", [
                "The soldier Dain is returned to the Count.",
                "The soldier Dain reports: the patrol went beyond its line. The patrol is corrected. The Count is whole.",
                "You stand outside your posted rotation. State your numbers. The Count is whole. The Count is whole.",
                "Cold is only warmth that stopped asking questions. Return to the wall."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("The Corrected Man", "The road, Dain's hood down, frost in a script down his wrist", "Captain Yura", [
                "That's Dain's face, and that is not Dain. Dain stammers. Dain hums when he's frightened. Whatever this is, it speaks in the flat, certain voice of the reader plate at the gate: every word sure of itself, and nobody home behind them.",
                "Look at his wrist. That is not our mark. That is deep script, wrist to elbow, like someone wrote a whole oath into his arm.",
                "Four are still out there, and whatever corrected Dain is standing between us and them.",
                "It's wearing him, and it's coming this way, so hear me plainly before it reaches us. Whatever we do in the next minute, we do it to Dain himself: his real arm, his real face, with something else steering. So we do it clean, we do it kind, and we bring home what's left of him."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
        ], [
            { text: "Take the corrected man down fast, before it learns you're a threat.", conclusion: "You hit first and hard, and the thing wearing Dain fights with drill-perfect, joyless precision until it can't. He goes down breathing. Under the deep script his own mark is still there, faint, like handwriting under a stamp. Yura splints his arm with hands that don't shake until after.", trait: "reckless" },
            { text: "Stand between it and the village. Nothing corrected passes.", conclusion: "You plant yourself on the road and make the correction come through you, and it does, methodically, reciting the Count. You hold. When it finally stops moving, the road behind you is still clean snow, and Yura looks at you the way soldiers look at load-bearing walls.", trait: "honorable" },
            { text: "Match its cadence. Answer its numbers. Learn the script's grammar.", conclusion: "You give the Echo's questions back in its own flat rhythm, numbers for numbers, and for eleven exchanges the thing believes you might be a colleague. Eleven exchanges of grammar, memorized. When it finally lunges, you already know how corrected things decide, which will matter more than anyone on this road yet knows.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 25, "The Loyalty Seal", "Frost Seal Guardian", "❄", [
            { ...storyPage("Cut From the Ice", "A ravine north of the line, three figures standing in cut ice like specimens", "Captain Yura", [
                "There. Snow take me. There they are.",
                "They're standing up. In the ice. Like they walked into it and it agreed with them.",
                "That's Ruven. Front. Cut them out slow; frostbite by inches is survivable, panic isn't.",
                "Three. Count again. THREE. We met Dain on the road, so that's four of the five accounted for. But Kessa isn't here. She's the fifth name, the youngest of them, and she is not here."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
            { ...storyPage("The Deep Script", "The ravine, three soldiers thawing, wrists black with script to the elbow", "Narrator", [
                "They wake calm. That is the wrong part. Men cut from ice should shake, weep, swear. These three stand up, form a line, and wait for orders.",
                "Ruven looks at Yura with polite, total certainty. He asks nothing about his wife. He asks nothing about his dog. He asks for his rotation.",
                "The script runs wrist to elbow on all three. Force-sealed. An oath they never spoke, written in past the asking.",
                "The Count is whole, they say, all three, in unison, and the ravine's cold has nothing on the sound of it."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
            { ...storyPage("The Seal's Voice", "The ravine mouth, the Frost Seal Echo standing on the ice, guardian shapes forming under it", "Frost Seal Echo", [
                "Four are recovered. The Count is whole.",
                "The fifth resisted correction. The fifth is pending.",
                "You transport recovered assets. This is approved. You inquire after the pending. This is not approved.",
                "Warmth is owed to the counted. The counted are kept. You are keeping poorly. Stand down."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp", choices: [
                { text: "\"You read her license once. Read this thing its own terms.\"", nextPage: 3, requireTrait: "ff20-read-her-license" },
                { text: "Put the three behind you and face the Guardian.", nextPage: 4 }
            ] },
            { ...storyPage("Terms of Service", "The ravine mouth, the Echo's cadence stuttering", "Captain Yura", [
                "That's it. Harrow's trick. It runs on TERMS, so I'll give it terms. Listen, you walking gate!",
                "Kessa was CHECKED at intake. The checked are counted. The counted are KEPT. Your own litany, your own order. You cannot call her pending. She's already owed a search.",
                "Look at it. It's rereading itself. It's actually rereading itself.",
                "Whatever that bought us, use it, because the ice is standing up."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp", choices: [
                { text: "The ice stands up.", nextPage: 4 }
            ] },
            { ...storyPage("The Frost Seal Guardian", "The ravine, a guardian of old ice rising between you and the road home", "Captain Yura", [
                "That's a Guardian. Old work. It was here keeping something before this village had a wall, and the seal wears it now the way it wears Dain.",
                "Three behind us, one missing, and a wall of winter in front. A standard Frostfang tally.",
                "Whatever you do, the three come home. That's the mission. Kessa is MY next mission, and I will dig her out of this seal's throat if it comes to that.",
                "On your call, intake. It's your road now."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
        ], [
            { text: "Hold the road until all three are clear, then break contact clean.", conclusion: "You fight a wall of winter to a standstill exactly as long as the rescue needs, and not one breath longer, and then you fold back through the ravine like a drill answer. Three men come home. The Guardian watches you leave with something like professional respect, if ice can respect a schedule.", trait: "honorable" },
            { text: "Study the script while you fight. The seal writes; writing has rules.", conclusion: "Every strike you trade, you're reading: the Guardian moves in the litany's own meter, four beats and a hold. By the end you can feel the next line before it lands. Yura hauls you out bleeding and furious with you, and you come home carrying the seal's grammar like a stolen map.", trait: "suspicious" },
            { text: "Go through it. Kessa is out there and this thing is the door.", conclusion: "You don't fight the Guardian; you BREACH it, straight through the old ice with everything you own, because a girl is pending on the far side. It costs you skin and it doesn't find her, but the seal learns something new about the shape of you, and files it, and starts, in its cold way, to plan.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 35, "The Pale Pack", "Oathbound Ice Captain", "❄", [
            { ...storyPage("The Struck Names", "A rebel cavern in the glacier, forty-one people, no marks, warm fires", "Pale Pack Runner", [
                "Weapons stay at the mouth. That's not a threat, it's furniture; we've no racks for them inside.",
                "Welcome to the Pale Pack. Forty-one names the Count struck. Deserters, doubters, one woman who missed a check nursing her sick mother. Struck all the same.",
                "Look around, but don't romanticize it. We call the Roll here because we choose to, not because a mark makes us. Some nights people answer angry. Some nights a name doesn't come until the third call. The fires are warm and they smoke; the stew is thin. Two winters ago we lost a boy because the east watch slept through second bell.",
                "The youngest of us is Kessa, off the ridge patrol. She walked in half-frozen a week after the seal took her squad, unsealed, still marked 'pending' in the wall's book. She teaches the children knots now.",
                "So no, we are not proof that walking free is easy. We are proof of one thing only: the Count lied when it told you there was no other way. Ask the wall how their Count is doing."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
            { ...storyPage("Yura's Roster-Mate", "The cavern fires, a big woman standing up slow", "Captain Yura", [
                "Kessa's HERE? Kessa's alive, and teaching KNOTS, and nobody... no. Later. One miracle to a bell.",
                "Marrin.",
                "Marrin, I filed the report. I want that said before anything else. The ridge post, the strike order, your name, all in my handwriting. I've carried it twelve years, and I'm not asking you to make it lighter.",
                "The Count struck you. And you went and built a Roll anyway, a real one, out of nothing, in a glacier.",
                "I don't know what to do with that, so I'm going to stand here while you decide whether to hit me."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
            { ...storyPage("Returned to the Count", "The cavern mouth, torchlight, a sealed recovery detail forming up outside", "Narrator", [
                "The recovery detail arrives at dusk: twelve sealed soldiers and a captain whose wrist script is old and deep, a man who was himself recovered once, and speaks of it the way saved men speak of medicine.",
                "The order he carries is short, in Kael's own hand: ALL STRUCK NAMES RETURNED TO THE COUNT. RECOVERY AUTHORIZED. SEALING AUTHORIZED.",
                "Forty-one people wait in the cavern behind you. Twelve sealed soldiers stand on the ice in front. The mountain does not care either way.",
                "The captain gives you, formally, one bell to bring them out willing. He says the word willing without any sign it means something."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp", choices: [
                { text: "Ask Yura, quietly, what she's about to do.", nextPage: 3, requireTrait: "yura-trust" },
                { text: "Answer the captain at the mouth.", nextPage: 4 }
            ] },
            { ...storyPage("The Captain's Arithmetic", "The cavern mouth's shadow, Yura checking her gear by touch", "Captain Yura", [
                "What am I about to do. Twelve years I've wanted somebody to ask me that before I did it.",
                "My mark says I stand with the detail. My roster-mate is behind me with a Roll she built out of exile. My captain sealed the men I cut out of ice, and my Kage signed it.",
                "You told me where you'd run once. Fair trade. Here's mine: if this goes wrong, I'm not running. I'm standing in the mouth. It's the only door I've got left that means anything.",
                "Whatever you call, call it loud. I want to hear one order tonight I actually believe in."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp", choices: [
                { text: "Answer the captain.", nextPage: 4 }
            ] },
            { ...storyPage("One Bell", "The cavern mouth, the detail in formation, snow beginning", "Pale Pack Runner", [
                "They've done this before, you know. Not here. Smaller camps. Struck names, recovered, and you meet them a season later at the wall with script to the elbow, asking for their rotation.",
                "Forty-one of us. Some will fight. Some are children. Some would honestly rather be sealed than spend another winter unforgiven; don't judge them, warmth is warmth when you're tired enough.",
                "The bell the captain gave you is almost out.",
                "So, wall-walker. What ARE you, out here past the Count?"
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
        ], [
            { text: "Stand in the mouth beside Yura. The cavern doesn't empty tonight.", conclusion: "Two of you in the mouth, then Marrin makes three, then the runner makes four, and the sealed captain recalculates a doorway that has grown teeth. Recovery withdraws, formally, pending reinforcement. The Pale Pack's fires burn all night, and forty-one names answer the midnight Roll like a hymn.", trait: "honorable" },
            { text: "Negotiate: the children and the willing go down warm, the rest stay free.", conclusion: "You split the impossible order into human pieces: nine go down the mountain fed and blanketed, by their own word, and thirty-two remain, and you sign the difference in your own name as ranking witness. The captain files it, because it is, technically, a recovery. Kael will read what you signed by morning, and know exactly what it says about you.", trait: "merciful" },
            { text: "Let the bell run out. Then shadow the detail's captain home.", conclusion: "You give the captain his formal refusal at the mouth, let recovery withdraw empty-handed, and then you follow the sealed unit down the mountain, off their flank, all night. They don't go to the barracks. They go to a door in the glacier's foot that no map holds, and file in like heat returning to a stove. You mark it. The seal-house has an address now, and only you have it.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 50, "Jonin of the Frozen Oath", "Jonin Rank Trial: Glacier Twins", "❄", [
            { ...storyPage("Both or Neither", "The oath hall, a two-page scroll flat on the stone table", "Elder Sova", [
                "Read before you sign. Both pages. I'll wait; I've grown good at waiting.",
                "Page one is your rank: Jonin of Frostfang. You earned it, and the book agrees.",
                "Page two is the officer's mark: deep script, wrist to elbow. That's not the recruit's mark. That's the one that binds.",
                "One signature covers both pages. Both or neither. That rule is mine, and I have never been prouder or more ashamed of a rule."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp" },
            { ...storyPage("The Oath Is a Comfort", "The oath hall, Kael by the brazier, hands out to the heat", "Kage Kael Whitefang", [
                "You hesitate. Good. Fools don't.",
                "I'll say my piece once. The oath is a comfort. You'll wake at fourth bell, in weather that eats patrols, and the mark will tell you: you are counted, you are kept, someone comes. ALWAYS. Do you know what that's worth on a ridge at night? I do.",
                "Choice is a luxury warm people invented. I kept children alive with this mark. Count that before you judge me.",
                "Sign, or don't. But if you don't, understand me: I will never once send anyone for you. The Count can't owe what it doesn't hold."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "\"Essen's doubt walked out of him at the gate. I held it. Ask me what it weighed.\"", nextPage: 2, requireTrait: "ff42-held-the-doubt" },
                { text: "Take up the pen.", nextPage: 3 }
            ] },
            { ...storyPage("What Doubt Weighs", "The oath hall, the brazier crackling", "Kage Kael Whitefang", [
                "You held a man's doubt. And?",
                "I've held a frozen child. Weigh THAT. One dead child outweighs every doubt this village ever produced. That's my whole reckoning. I sleep on it. Mostly.",
                "But I'll grant the point you're circling. The gate took Essen's grievance without asking. Things that take without asking are on my list too. The list is long. The winter is longer. I close doors in the order they kill people.",
                "Sign or don't, Jonin. The weather doesn't wait on philosophy. Neither do I."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "Take up the pen.", nextPage: 3 }
            ] },
            { ...storyPage("The Pen Gets Lighter", "The hall's side door, Yura turning her own wrist in the brazier light", "Captain Yura", [
                "Before you decide. One soldier's honesty, no charge.",
                "I signed at nineteen. Re-signed every promotion. And every time, the pen got LIGHTER. First time, my hand shook. Last time, I signed while talking about boots. That's what the mark does. Not the binding. The EASING. It makes belonging so simple you stop checking what it costs.",
                "Nineteen days on a ridge taught me what the Count is worth. The mark taught me to stop asking the question. Those are different lessons and I got them in the wrong order.",
                "Whatever you do at that table, do it with your hand shaking. That's the whole advice."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "The Glacier Twins wait.", nextPage: 4 }
            ] },
            { ...storyPage("The Rank Trial", "The proving floor, two glacier-pale duelists bowing as one", "Elder Sova", [
                "The trial stands regardless. Rank is proven, not signed.",
                "The Glacier Twins. Sealed young, sealed deep, and the finest formation fighters the mark ever made. They move like one soul in two coats. That's the sales pitch, you understand. Look at what the mark builds. Look what you could be.",
                "The book and I will be watching what you are instead.",
                "Begin when the bell says. And child... whatever your page says afterward, come eat. Rank tastes better with soup."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp" },
        ], [
            { text: "Take rank with the recruit's mark only. Refuse the deep script, out loud.", conclusion: "You sign page one and set the pen down in front of the Kage, the Elder, and the book. An unbound Jonin: the first in living memory. Kael says nothing, which everyone in the hall knows is his loudest register. Sova enters it with a hand that is absolutely not steady, and looks twenty years younger doing it.", trait: "honorable" },
            { text: "Sign both pages. Rank now, and the binding's secrets from inside it.", conclusion: "The deep script takes like ice taking a lake: total, quiet, certain. And you learn on the first night what no refuser ever learns: the mark WHISPERS. Rotations, tallies, the warmth of the vault, faint and constant, a lullaby with a ledger in it. You wanted to know the machine. Now the machine assumes you're a part.", trait: "ambitious" },
            { text: "Ask Sova, at the table, why the litany never mentions leaving.", conclusion: "The hall goes drill-quiet. Checked, counted, kept, warm; four verbs, and not one of them is 'released.' Sova looks at the litany she has recited for forty years like a door she has never once tried the handle of. 'Sign or step back,' Kael says, flat. You step back, and the question stays in the hall like woodsmoke, and outlives the ceremony.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 65, "Orders in White Blood", "Oathbound Purge Unit", "❄", [
            { ...storyPage("The Removal Order", "The muster yard before dawn, an order pinned under a lamp", "Captain Yura", [
                "Read it. Read it twice; it improves nothing.",
                "Removal order. 'Nineteen Pale Pack fighters, entrenched, old quarry.' Sweep at dawn, sealed unit, my command, you as ranking witness. Kael's own hand.",
                "Now here's the scout report the order quotes. I pulled the original. The quarry holds nine children, six elders, four unsealed adults. Zero fighters. ZERO. Somebody upstream turned a refugee camp into 'nineteen fighters' with one stroke of a pen.",
                "Nineteen. Of all the numbers. Someone's telling me a joke, and I've stopped finding it funny."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "\"You stayed in the Count to fix it from inside. Is this the day that pays off?\"", nextPage: 1, requireTrait: "ff58-stayed-in-the-count" },
                { text: "Ride for the quarry ahead of the unit.", nextPage: 2 }
            ] },
            { ...storyPage("From Inside", "The muster yard, Yura buckling her kit slow", "Captain Yura", [
                "You remembered that. Sova's records room. I stayed in the Count on purpose, I said. Fix the machine from inside the machine.",
                "So here's inside: I can slow a sealed unit two hours with 'confirmation protocol.' Two hours, all legal, all my signature. That's what twelve years of staying bought. Two hours.",
                "Don't ever let anyone tell you the inside game is the strong move. It's the SLOW move. Sometimes slow is what's needed. Today it might be.",
                "Two hours, Jonin. Spend them like they're the last thing I own, because officially, they are."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "Ride. Now.", nextPage: 2 }
            ] },
            { ...storyPage("The Old Quarry", "The quarry floor, tents against the cut walls, children's snow-forts by the pool", "Pale Pack Runner", [
                "You. Wall-walker. You're ahead of something; people only ride like that ahead of something.",
                "Yes, we're what's left. The cavern scattered after the recovery push. The strong went deep with Marrin. The slow came here. My job is the slow. Lucky me. Lucky them.",
                "Say your something. How long, and how many?",
                "Dawn, you say. A sealed unit, and you named as ranking witness. Right. Then you've got a choice to make about what witnessing means, and I've got nine children to wake up gently."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
            { ...storyPage("The Confiscated Kits", "A dry cut in the quarry wall, crates of struck names' belongings stacked as a windbreak", "Captain Yura", [
                "These crates. These are recovery confiscations. Struck names' kits. They cart them to the vault house for 'processing.' Some processing: it's all just SITTING here, walling wind off a soup pot.",
                "Wait. This one's tagged with a ridge-post number. MY ridge post.",
                "Dren Coldewe. Oh, snow and stone. Dren COLDEWE. He walked off our post on day six. Deserted, the report says. My report. And on day nineteen somebody unmarked walked INTO a whiteout and dragged me off that ridge, and I never saw a face, and command logged it as 'self-recovery.'",
                "His kit. His unsent letter. And schematics: lanterns. Relay lanterns, spaced by chant-count, built to find people in a whiteout without a plate-read. He spent his exile building a way to COME BACK for people, and we processed it into a windbreak."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "Wrap the letter and the lantern plans. They leave with you.", nextPage: 4, trait: "ff65-saved-the-letter" },
                { text: "Put the letter in Yura's hands. It was always addressed to her.", nextPage: 4, trait: "ff65-gave-yura-the-letter" },
                { text: "Reseal the crate. The dead keep their kit; the living keep moving.", nextPage: 4, trait: "ff65-resealed-the-kit" }
            ] },
            { ...storyPage("Dawn Comes Anyway", "The quarry rim at first light, twelve sealed silhouettes against the snow", "Narrator", [
                "The unit crests the rim exactly on schedule, minus the two hours a captain's signature bought and spent.",
                "Below, the camp has packed what nine children and six elders can carry, which is less than hope and more than nothing.",
                "The order in your coat says nineteen fighters. The quarry floor says a soup pot and snow-forts.",
                "The sealed unit waits on its witness. The word is yours, and the paper is wrong, and the paper is signed by the man who carries shepherds home."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
            { ...storyPage("Ranking Witness", "The quarry rim, the purge unit forming its sweep line", "Captain Yura", [
                "Orders say sweep. Ground says children. I've been a good soldier through eleven versions of that sentence, and I'm running out of versions.",
                "Whatever you call, I confirm it. That's what my two hours were really for. One officer's word is a protest. Two is a RECORD.",
                "They're waiting, Jonin.",
                "Call it."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
        ], [
            { text: "Refuse the order as written. False count, no sweep, on your testimony.", conclusion: "You declare the order void for a false count, ranking witness, on the record, and Yura confirms before your echo dies. The sealed unit stands down; sealed men are nothing if not lawful. By dusk the camp is ghosts and cold fires, gone deeper, and by midnight your testimony is on Kael's desk, and the word NINETEEN is circled in his hand. Nobody knows yet what he circled it FOR.", trait: "merciful" },
            { text: "Escort the camp down the mountain yourself, under pack law.", conclusion: "You invoke the oldest line in the drill book: the pack walks its slow home. Nine children, six elders, four unsealed, one Jonin, one captain, one runner, walking INTO the village, in the open, daring the Count to refuse its own litany. The gate watch checks the litany, finds no line for this, and opens the gate. Sova enters fifteen names into the book with a steady hand and dares the room to speak.", trait: "loyal" },
            { text: "Burn the order in front of the sealed unit and see who salutes.", conclusion: "Paper burns fast at altitude. The sealed unit watches its purpose curl to ash with those calm corrected faces, and then, one by one, they salute the RANK, because you outrank the ash, and the script never planned for that. It buys one dawn exactly. It also teaches the vault, watching through twelve pairs of eyes, that its instruments can be commanded off its own leash. Something files that. Something plans.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 75, "Yura Breaks the Oath", "Frostfang Oathbreaker Hunter", "❄", [
            { ...storyPage("Drill Fashion", "The north tower before first light, Yura's kit laid out in perfect rows", "Captain Yura", [
                "You came. Good. I put it in writing so I couldn't take it back; that's a trick I learned from watching brave people.",
                "Kit check, by the book. The blade is clean, the kettle is hot, the bandage roll is new, the knife is sterile. And the witness is you.",
                "Twelve years I've worn the mark. This morning I take it out. Not because the Count is worthless. Because I finally know what it took, and it took the ASKING. It took whether rescue means anything when nobody chooses it. The mark answers so nobody has to.",
                "Talk to me while I work. That's your whole post this morning. If I go quiet, ask me something, and don't let me answer in drill cadence."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
            { ...storyPage("Line by Line", "The tower room, lamplight, the work begun", "Captain Yura", [
                "The first line is the intake mark. I was nineteen when I took it, hand shaking, so proud of myself. There it goes.",
                "Talk. Ask.",
                "Why now? Because of a windbreak made of a dead man's lanterns. Dren walked away from the Count, and then he walked BACK, for me, unmarked, with no plate telling him to, and I have spent twelve years letting a wrist-line answer the question his whole life asked me.",
                "Second line. Promotion mark. Lighter pen, heavier debt. There it goes. Keep talking, Jonin, you're doing fine. So am I. Say it back to me so one of us believes it."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "\"You turned the holder plate down flat. This is the same hand, finishing the job.\"", nextPage: 2, requireTrait: "ff70-turned-the-plate" },
                { text: "Keep her talking. Bell by bell.", nextPage: 3 }
            ] },
            { ...storyPage("The Same Hand", "The tower room, steam off the kettle", "Captain Yura", [
                "The holder plate. Yes. They offered me people, you know that? Bound-back-to-me people. Guaranteed rescue, MY name on other wrists. The tenth holder mark in the village. An honor.",
                "I looked at it and all I could think was: this is the ridge, again, from the other side. Someone chained to come for me whether they'd choose it or not. They tried to hand me my own worst night as a PRIZE.",
                "You watched me turn it down and you didn't say a word, and I needed exactly that, and you somehow knew it.",
                "Last line now. The deep one. The one that hums. Hold the lamp closer, and if my hand stalls, don't help. It has to be my hand. That's the entire point of everything."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "The lamp steadies. The line comes out.", nextPage: 3 }
            ] },
            { ...storyPage("Self-Injury, Filed", "The tower stair, a shape climbing with drill-perfect steps", "Frost Seal Echo", [
                "The officer Yura is flagged for damage to Count property.",
                "The finding is self-injury. The response is recovery. The Oathbreaker Hunter is dispatched. The Count is whole. The Count will be whole.",
                "The asset's service is honored. The asset's confusion is noted. The asset will be corrected and comforted.",
                "Warmth is owed. Warmth will be delivered. Stand away from the asset."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
            { ...storyPage("Her Own Name", "The tower room, Yura on her feet, wrist bound, eyes clear", "Captain Yura", [
                "Look at that. It calls the mark the property and me the confusion. Twelve years, and I finally hear it plainly: the Count was never FOR us. We were for the Count.",
                "Here's the litany, the honest version, and I'll say it myself, out loud, once: the checked are counted. The counted are kept. The kept are FUEL.",
                "It's on the stair. It moves the way Dain walked. Everything the seal wears moves like that, the way the plate reads: flat, certain, no one home.",
                "If anyone comes for me after this, they will have CHOSEN it. Starting with you, starting now. Best morning of my life, and it's not even breakfast. Stand with me."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
        ], [
            { text: "Stand between the Hunter and her bound wrist. She finishes her morning.", conclusion: "The Hunter wants the wrist; it has orders about the wrist. It gets you instead, for every stair, every landing, every drill-perfect lunge, while behind you a captain binds her own arm and drinks her tea sitting down. When it finally stops moving, Yura pins her old rank bar to its coat. 'Deliver THAT,' she tells the empty eyes, gently.", trait: "merciful" },
            { text: "Fight it side by side. Her first bout as a free name.", conclusion: "Shoulder to shoulder, no mark binding either of you to the other, which makes every covered flank a CHOICE, which makes it the best fighting either of you has ever done. The Hunter never adapts; nothing sealed ever fought two people who could each walk away and don't. She's laughing by the end. You've never heard her laugh.", trait: "loyal" },
            { text: "Let it reach the room, then bar the door behind it. Study it alone.", conclusion: "You give the Hunter its objective and take the exits, and what happens in the tower room stays between you, it, and the grammar you've been collecting since the border road. It fights exactly as the script fights. It fails exactly where the script fails: the moment Yura addresses it by its OLD name, the one struck from the Count, it hesitates a full second. You write the second down. Seconds like that win wars.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 85, "The Kage Freezes Dissent", "Oathbound Alpha Guard", "❄", [
            { ...storyPage("The White Silence", "The central square at dawn, forty-three citizens standing frozen in perfect rows", "Narrator", [
                "They stand in rows in the square, forty-three of them, frost-sealed upright with their eyes open. Neighbors. A baker still dusted in flour. A boy of maybe sixteen with his fists still balled.",
                "The village walks around them. Quietly. Eyes down. The way people walk around a thing they've decided not to see, because seeing it costs too much.",
                "The wall calls it the White Silence. Preservation, the notice says. Protective custody against the winter of dissent.",
                "Each of the forty-three, you learn by asking, filed a grievance, missed a check, or asked the wrong question at roll call. The rows are alphabetical."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
            { ...storyPage("What Harrow Sells", "The icehouse, Harrow with her collar up and her ledger out", "Kite Harrow", [
                "You want the real story, and I want to be paid in being listened to, so we're both in luck.",
                "This isn't punishment. He's stripping the doubt out of them. The vault drinks one thing: the moment a marked soul would have said no and didn't. Ordinary wrists pay it in sips, a doubt set down here, a route obeyed there. The deep-script soldiers have no refusal left, so the vault can't feed on them; he keeps those as tools, and freezes everyone else while their last choice is still worth something.",
                "So look what he does instead. A doubter frozen at the exact peak of his doubt, before it can fade or resolve, is a full cup that never spills. That is the White Silence. It isn't a punishment. It's a CELLAR: he's laying doubt down like wine against a hard payment coming due. I've appraised sieges with the same shopping list.",
                "Those forty-three rows are the Count's larder now. That's the appraisal, no charge. Some numbers I don't care to keep on my own books."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "\"You burned the forged plates. Now show me the real ones' weakness.\"", nextPage: 2, requireTrait: "ff80-burned-the-plates" },
                { text: "Go to the vault hall. Face him.", nextPage: 3 }
            ] },
            { ...storyPage("The Rhythm's Flaw", "The icehouse, a forged mark plate between you on the ice table", "Kite Harrow", [
                "I burned MY forgeries, yes. Sentiment. Don't spread it around; it's bad for my rates.",
                "But here's what forging them taught me, and this one's free, because you were there when I chose the fire. The litany is a lock-rhythm. Checked, counted, kept, warm, in ORDER, four beats and a hold. The plate verifies the rhythm, not the person behind the wrist.",
                "And the White Silence breaks the rhythm. Those forty-three are KEPT, plainly, look at them, but they can no longer answer a CHECK. The Count is holding wrists it can't hear anymore, and a lock that keeps time against dead beats will open for a counterfeit one just as gladly.",
                "Hum the right litany at the right plate, and the Count will believe a thing that isn't so. And a system that believes wrong things can be led by the nose. There's your lever. Mind your fingers; it's heavier than it looks."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "To the vault hall.", nextPage: 3 }
            ] },
            { ...storyPage("The Quartermaster of Doubt", "The vault hall, warm as a hearth, Kael at a table of tally boards", "Kage Kael Whitefang", [
                "Sit down. Nobody argues well shivering.",
                "Two numbers first. Ninety-one dead, the winter before I took the vault. Zero every winter since I took it. That's the whole speech.",
                "The rows in the square. Say it: monstrous. Now count with me. Forty-three preserved doubters, or four hundred frozen children when the vault runs dry. That is the sum on my table. I've run it every way a man can, and the rows win. Every time.",
                "So here is my door, and I only ever offer the one. Bring me a Roll that holds without the vault. A Roll where the lost still get FOUND, and no one's warmth pays for the finding. Bring me that, working and witnessed, and I will break the rows out with my own hands and stand trial in my own square. Until then, I keep the door. Someone has to be the door."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "The Alpha Guard bars the hall.", nextPage: 4 }
            ] },
            { ...storyPage("The Alpha Guard", "The vault hall doors, the oldest sealed soldier in the village unfolding to full height", "Narrator", [
                "The Alpha Guard was the first man Kael ever sealed, volunteer, back when it was still asked. Forty years of script run wrist to shoulder to heart.",
                "He was, the old soldiers say, the kindest man on the wall, once. The seal kept the strength and filed the kindness somewhere it stopped being load-bearing.",
                "He bars the hall door with a tenderness that is somehow the worst part, like a father locking a sickroom.",
                "The White Silence stands in its rows outside. The vault hums under the floor. The Kage watches you across his tally boards, waiting to see which sum you are."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
        ], [
            { text: "Break the rows out NOW. All forty-three, whatever it costs.", conclusion: "You go through the Alpha Guard and into the square with chisels and hot water and forty volunteers who materialize the moment somebody goes FIRST. Forty-three people come out of the frost weeping and furious and alive, and the vault's larder empties in an afternoon. The Count's next payment just came due with nothing laid down against it. Kael watches from the hall door and does not stop you, which is the most frightening thing he has ever done.", trait: "reckless" },
            { text: "Post yourself at the rows. Nobody freezes, nobody vanishes, on your watch.", conclusion: "You take up a post the drill book doesn't have: warden of the frozen, in the open square, in view of every window. You check the rows at every bell, aloud, by name. The village starts answering. First one voice, then rows of the living answering FOR the sealed, a roll call the Count never ordered. The White Silence stays sealed, but it is no longer silent, and Kael's cellar has four hundred witnesses now.", trait: "honorable" },
            { text: "Map the rows against the vault's intake schedule. Find the payment date.", conclusion: "Forty-three names, forty-three seal dates, and the vault's draw curve from Sova's meter: they converge. Everything the Count has cellared matures on the same night, three weeks out, when the deep payment falls due. He isn't hoarding doubt out of cruelty. He's short. The vault is SHORT, and the White Silence is the margin, and now you know the date the whole Count either breaks or feeds.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 100, "The Oath Must Break", "Kage Kael Whitefang, Hollow Oath Tyrant", "❄", [
            { ...storyPage("The Open Ledgers", "The vault stair, Sova's records room standing open, lamps lit, no keeper", "Narrator", [
                "The records room stands open. Not forced. OPENED. Every vault ledger is out on the reading tables, squared to the table edges, lamps trimmed and burning.",
                "Sova is nowhere in the room. Her chair is pushed in. The Count book is gone from its stand, and on the bare wood where it sat for forty years, dead center, lies her pen.",
                "It is the tidiest resignation in the history of the village, and the loudest.",
                "The stair to the vault door is lit all the way down."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp" },
            { ...storyPage("The Unclosed Door", "The vault antechamber, Sergeant Essen on post by a door ajar", "Narrator", [
                "Sergeant Essen stands his post at the great hall door with a soldier's perfect bearing.",
                "The door is open a hand's width. Cold air walks through it freely.",
                "'Door's faulty,' he says, to the middle distance, eyes front. 'Latch must have failed. I've filed a report. These things take time to process.'",
                "As you pass, quietly, without turning his head: 'My brother's grievance was the first thing that gate ever took from my family. Take back the rest. The latch will stay faulty as long as it needs to.'"
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Through the faulty door.", nextPage: 2 }
            ] },
            { ...storyPage("The Pack Comes Down", "The vault forecourt, forty-one unmarked figures standing in falling snow", "Pale Pack Runner", [
                "Look who the weather blew in. All of us. Marrin's up front, and Kessa carries the roll-slate; she earned it. The slow came too; the children are with Sova at the wall, and I'd walk a second winter just to watch the gate try to COUNT that.",
                "We talked it out around the fire, all forty-one. If tonight goes right, we come down and answer one roll call. Freely. Struck names, answering by CHOICE, in the Count's own forecourt. Not because we forgive it. Because that is what a real Roll sounds like, and somebody has to stand up and demonstrate one.",
                "If tonight goes wrong, well. We were ghosts before. We're good at it.",
                "Yura's holding the stair. Go. And wall-walker... whatever you are, it was worth the walk."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "To the stair.", nextPage: 3 }
            ] },
            { ...storyPage("The Stair Held by Choice", "The vault stair, Yura at the landing, bare wrist bandaged, standing easy", "Captain Yura", [
                "Post report: one stair, held by one captain, unmarked, un-ordered, and here entirely on purpose. It feels different. Better. Colder, but better.",
                "Below that door is the vault, and the vault is short, and a payment older than the wall comes due tonight. He'll be standing at the meter. He's been standing there for days.",
                "I have exactly one order left in me, and I'm spending it now: come back UP this stair. Whatever happens down there. That's an order, Jonin. First one I've ever given that the Count didn't co-sign.",
                "Walk on. This door stays open behind you for as long as I'm standing in it."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Down, alone.", nextPage: 4 }
            ] },
            { ...storyPage("The Man Fused to the Door", "The vault floor: a wall of ancient ice, a meter running backward, Kael before it", "Kage Kael Whitefang", [
                "Punctual. Good.",
                "There it is. The vault. Every surrendered exit this village ever banked, keeping every hearth above us warm. And the meter, running down. The payment is tonight. I told you someone has to be the door.",
                "Look at my arm. Go on, look. The script doesn't stop at the shoulder anymore. The door swings both ways, it turns out. Forty years holding it shut, and the vault has been quietly counting ME.",
                "One confession, and there's no time for a second. The Count was true when I took it. Ninety winters of names and routes and rescue, and I inherited it clean. Every name mattered. Somewhere in my forty years at the door, between ninety-one dead and zero, the promise curdled into a QUOTA. I knew it, and I kept the door, because zero is zero is zero. But before you show me anything, there is a deeper thing owed, and it is worse."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Look where he is looking.", nextPage: 5 }
            ] },
            { ...storyPage("The Gate Tax", "The vault's blue-white flame steady above, and beneath the grate a darker pull downward", "Kage Kael Whitefang", [
                "Look past the warm flame. Under the grate, that darker pull. That is not the cold, and it is not the fire. It is a door under the vault's mouth, and I have fed it my whole life.",
                "The Vault keeps two draws. The warmth you can feel, and a lower draw beneath it that bears a mark that was never ours: a circle cut in quarters. Its name is Hollow Gate. The Count is ninety winters old; I have held its door for forty; I signed that lower draw open for thirty, and every approval carries my hand. Do not make me younger than my guilt.",
                "Every village pays it. Stormveil pays in reasons. Ashen Leaf pays in futures. Moonshadow pays in secrets. Frostfang pays in exits, and I paid mine with people who trusted me to come for them. Dren Coldewe most of all. I did not spend him once. I spent him twice: once to keep this village warm, and once to pay the Gate.",
                "The Gate did not write the Count. It only taught the Count to drink. I decided the Count mattered more than the people standing outside it, and I kept refilling the cup with my own signature. Record that, Sova, wherever you've gone with your book. Now show me what you brought, or show me your hands. The meter won't wait."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Face him at the meter.", nextPage: 20, trait: "ff100-lower-draw-confessed" }
            ] },
            { ...storyPage("The Better Roll", "The vault floor, Dren's lantern plans unrolled against the ice", "Kage Kael Whitefang", [
                "What is that. Bring it to the light.",
                "Lanterns. Relay lanterns, chant-spaced. Coldewe's hand. I'd know it anywhere. I struck his name myself. And here it is: the thing I called impossible. A way to be FOUND that doesn't run through my vault.",
                "And do you see what else it kills? A soul the lanterns bring home never surrenders the exit my vault drinks, so the pipe below runs dry. You did not only prove the vault unnecessary. You proved the Gate can be STARVED. I asked for a better Roll for forty years, and when Coldewe finally built one, I struck his name and fed him to the very thing he would have ended.",
                "And you strung them. The ridge drill. Nineteen minutes. I didn't believe the report. I read it four times.",
                "Say the number, %name. Out loud. Let the vault hear it."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "\"Nineteen minutes to find a man in a whiteout. No mark. No vault. And the rows SAW it.\"", nextPage: 7, requireTrait: "ff88-woke-the-rows" },
                { text: "Open the drill log to Sova's countersigned pages and read him every line.", nextPage: 8, requireTrait: "ff88-logged-the-drill" },
                { text: "\"Your own wardens filed the report. You've read it four times. You just said so.\"", nextPage: 9, requireTrait: "ff88-baited-the-wardens" },
                { text: "Hang Dren's lantern from the meter's frame and let it burn there.", nextPage: 10 }
            ] },
            { ...storyPage("What the Rows Saw", "The vault floor, the meter's light unsteady", "Kage Kael Whitefang", [
                "The rows saw it. The whole wall watched a man walk into the white, and watched him found again, by choice, in nineteen minutes. And every watcher did the same sum in their heads: the vault is not the only door.",
                "I can seal a doubt. I cannot seal a thing four hundred people watched WORK.",
                "Forty years I asked for a Roll that holds without the vault. You went up a ridge and lit one.",
                "Four hundred people did the same sum in their heads that night. I cannot strike four hundred names for being right."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He looks at the meter a long time.", nextPage: 16 }
            ] },
            { ...storyPage("The Countersigned Log", "The vault floor, the drill log flat against the ice wall", "Kage Kael Whitefang", [
                "Give it here. Breaking a count is the office; let's see this one try to stand.",
                "Lantern spacings. Sweep times. One volunteer, found in nineteen minutes, zero plate-reads, zero draw. And it's countersigned. SOVA. The keeper of my own litany signed the Roll that replaces it.",
                "Her pen never signs what her meter can't verify. I taught her that. I TAUGHT her that.",
                "The figures hold. I have broken every count that ever crossed this desk, and this one does not break."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He closes the log with care.", nextPage: 16 }
            ] },
            { ...storyPage("His Own Wardens", "The vault floor, a warden's report unfolded between you", "Kage Kael Whitefang", [
                "My own wardens. Yes. You ran the drill on a warded ridge, in reporting season, where the Count's own eyes had to log it and file it UP.",
                "I read it four times. I sent for the duty officer and asked him plainly: is this real? He said, sir, we timed it twice. And I sat down in this cold room, and the door I have been my whole life swung loose on its hinge.",
                "You used my own Count to deliver its obituary. Cruel. Efficient. I'd have done the same, and that is the part that lands.",
                "My own wardens timed it twice. The door I have been my whole life is off its hinge, and my own people pulled the pins."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He folds the report in half.", nextPage: 16 }
            ] },
            { ...storyPage("The Lantern on the Meter", "The vault floor, one lantern burning against a wall of banked exits", "Kage Kael Whitefang", [
                "One lantern. Chant-spaced wick, storm glass, Coldewe's pattern. It burns slower than it has any right to. He built them to outlast the search.",
                "I struck him for walking OUT. Then he came back, unmarked, for one of mine, and I logged it 'self-recovery,' because the truth put a hole clean through the Count, so I filed a lie instead. And he spent his whole exile building doors for other people. He was a better man than the door he walked through. Say that at the wall afterward, plainly. They should hear it.",
                "And now his little light sits on my meter, doing more keeping than the whole vault behind it.",
                "He was a better man than the door he walked through. I struck his name. His lantern is still burning. Only one of those can be corrected."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He does not touch the lantern.", nextPage: 16 }
            ] },
            { ...storyPage("She Answers His Roll", "The vault stair door opening, Yura coming down with the letter", "Captain Yura", [
                "You held the stair for me, %name. My turn now. This part is mine and his.",
                "Kael. Roll call. Dren Coldewe, ridge post four, struck for desertion on day six. On day nineteen he walked into a whiteout for me, no mark and no order, and your Count logged it 'self-recovery,' and I signed the log, and we both know why: because the truth broke the litany's spine.",
                "His letter. Never delivered; your confiscation crews are thorough. It is one line. 'Tell Yura: being counted isn't the same as being come for.'",
                "Dren Coldewe. PRESENT. By choice, twelve years late, in his own handwriting. Answer his Roll, Kage. The Count is not whole. It never was."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Kael stands very still.", nextPage: 12 }
            ] },
            { ...storyPage("The Door, Answered", "The vault floor, the meter's hum faltering", "Kage Kael Whitefang", [
                "You let her carry it. You lit the lanterns, then you stood aside, and the woman he came back for answered his name at my door.",
                "Forty years I asked for a better Roll. It arrives as a dead man's roll call, answered by the living, freely.",
                "Being counted isn't the same as being come for. One line. Forty years of Count, and one line undoes it.",
                "The Count never kept a column for people who come back. She just read it the missing entry, aloud."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He stands very still.", nextPage: 16 }
            ] },
            { ...storyPage("A Roll Without a Name", "The vault floor, the drill figures chalked on slate, no letter behind them", "Kage Kael Whitefang", [
                "Nineteen minutes. It's real; my wardens timed it twice. I don't doubt the method, and not doubting a thing is new for me.",
                "But whose is it, Jonin? Who built the lanterns? Who walked out into the white, and who chose to go and find him? Give me names. A Roll without a name is just weather that happened to help.",
                "You brought me the walk. You did not bring me the walker. A method is weather; a name is a wall.",
                "Bring me the walker's name, or the door stands."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He turns back to the meter.", nextPage: 20 }
            ] },
            { ...storyPage("The Undelivered Letter", "Dren's letter in Kael's scarred hands, unopened", "Kage Kael Whitefang", [
                "Coldewe's kit. I know the tag; I signed the strike. So believe me when I say I know exactly what you're holding, and exactly what it weighs.",
                "His lanterns worked. I tested the pattern myself once, one ridge, one storm, in secret, and it found my man in nineteen minutes then too. And I filed it away. A Roll that doesn't need the vault doesn't need a doorman, and I am the doorman, and a man will file ANYTHING to stay load-bearing.",
                "But a letter in a coat is not a Roll, Jonin. I can honor it. I can grieve it. I cannot warm one child with it tonight.",
                "You kept the man safe in your coat, and you never gave his name back to the Roll. That is not nothing. It is not enough, either. The meter doesn't read letters."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He sets the letter down like a sleeping child.", nextPage: 20 }
            ] },
            { ...storyPage("The Litany, Backwards", "The vault floor, Sova on the stair with the Count book held open outward", "Elder Sova", [
                "Hold, child. This entry is mine, and it has been forty years coming due.",
                "Kael. My litany. I wrote it, I taught it, I checked ten thousand wrists beneath it. Hear it once in the honest direction.",
                "The warm are kept. The kept are counted. The counted are CHECKED. Said backwards it stops being a comfort and becomes a reckoning, and the reckoning is this: we warmed ourselves on the very thing we swore we were saving people from. The cold takes those who are alone. We swore to end that, and we did: the deep script binds every wrist to every other, so that no one here can ever be left behind. And no one here can ever leave. We cured being alone by sealing the only door out.",
                "My pen. My book. My litany. My share of the door. I am done keeping count of other people's exits. From tonight the book stays open, both directions."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "She sets the book on the meter.", nextPage: 20 }
            ] },
            { ...storyPage("What's Left", "The vault floor, Kael looking from the proof to the meter", "Kage Kael Whitefang", [
                "The Count has no answer. Neither do I.",
                "Now we see what's left."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. The Count ends here.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for the exemption. You stood outside the Count like Sova.", "The reckoning", "Kage Kael Whitefang", [
                "So she gave you the keeper's exemption. Bare wrists at the meter. Then you've stood where I stand: warm, counted by no one, watching the counted pay for it.",
                "Tell me you never once read the intake book and thought: better them than me. Say it, and I'll call you a liar with my last honest breath.",
                "That thought is the door, Jonin. That thought, every bell, for forty years. You held it one season. Imagine holding it until the script reaches your jaw."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. The Count ends here.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for my plate. It read someone long gone.", "The reckoning", "Kage Kael Whitefang", [
                "The fogged plate. Yes. I read Vess's report the night it happened. I read everything. A wrist that answers with a struck name. The vault has a term for that. A debt still walking.",
                "Someone surrendered an exit in your name, before you ever reached my gate. Bought your way out of something. Left my Count holding the weight. The plate wasn't misreading you. It was trying to finish a delivery.",
                "When the door falls tonight, take your wrist's answer and go find where that name was struck from. Every Count keeps a book, Jonin. Even the one that ate your exit. ESPECIALLY that one."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. The Count ends here.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for Dren Coldewe. His lanterns are lit on your ridge.", "The reckoning", "Kage Kael Whitefang", [
                "Coldewe. The walker. I struck his name with this hand, and I want you to hear the part I've never said at the wall: striking him was the only lie I ever entered in the book knowingly.",
                "He didn't desert. He REFUSED, out loud, at post, the night I sealed the ridge rotation. Said a kept man can't keep anyone. I struck him as a deserter because a REFUSER on the record breaks the litany's spine, and then he walked into a whiteout for one of mine, unmarked, and proved himself right forever.",
                "His lanterns hang on my ridge tonight. Tell Yura the truth of the strike, afterward. She signed a log she never believed; she deserves to know it was my hand that entered the lie first, and knew it was a lie, and kept the book anyway. She has hated her own signature for twelve years, and mine was the one that mattered."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. The Count ends here.", nextPage: 20 }
            ] },
            { ...storyPage("The Meter at Zero", "The vault floor, the payment due, Kael's script reaching his jaw", "Kage Kael Whitefang", [
                "Talk's done. Look at me. Forty years I have been the door, and I would hold it shut again, every time. That is exactly why you take it from me now. A door that can't imagine opening is just a wall.",
                "The vault, the meter, and forty-one struck names in my forecourt answering a Roll I never called. Tonight decides what keeps this village warm.",
                "The Count has one entry left, %name. Yours.",
                "Show me what holds when nothing is holding it."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", leftName: "Player", rightName: "Kage Kael Whitefang", rightImage: "/portraits/kage-kael-whitefang-hollow.webp", choices: [
                { text: "Show him the better Roll: Dren's lanterns found a man with no mark and no vault.", nextPage: 6, requireTrait: "ff88-better-roll-carried" },
                { text: "Let Yura answer Dren's Roll.", nextPage: 11, requireTrait: "ff88-better-roll-deferred" },
                { text: "Let Sova read the litany backwards.", nextPage: 15, requireTrait: "ff92-witness-present" },
                { text: "Show him Dren's letter.", nextPage: 14, requireTrait: "ff88-unfinished-answer", forbidTrait: "ff88-better-roll-ready" },
                { text: "Show him the nineteen minutes.", nextPage: 13, requireTrait: "ff88-relay-held", forbidTrait: "ff65-saved-the-letter" },
                { text: "Answer for the exemption. You stood outside the Count like Sova.", nextPage: 17, requireTrait: "ff58-took-the-exemption" },
                { text: "Answer for my plate. It read someone long gone.", nextPage: 18, requireTrait: "ff70-turned-the-plate" },
                { text: "Answer for Dren Coldewe. His lanterns are lit on your ridge.", nextPage: 19, requireTrait: "ff88-exit-proof-any" }
            ] },
        ], [
            { text: "Break every mark. No one is guaranteed again. They can only choose.", conclusion: "The vault cracks like a lake in spring, and every banked exit goes home to its wrist at once: forty years of surrendered doubts, refusals, and walkings-away, returned mid-life. The warmth dies to honest fires. Deep under the wall, the lower draw pulls hard for one breath, trying to drink what Frostfang has fed it for thirty winters, and finds every wrist gone quiet: not dead, just no longer answering to anything but a name. Something far below loses its taste for the village. In the forecourt, forty-one struck names finish the roll Yura began on the slope, freely, in the Count's own forecourt, and the falling snow suddenly matters again, and so does every hand in it. Kael attacks you weeping like a man finally allowed to.", trait: "honorable" },
            { text: "Bind the vault. Metered, lawful, every struck name a case with your signature.", conclusion: "The vault survives, caged: draws by consent, posted publicly, every mark revocable by its own wrist, every historic strike reopened as a case. The old mark does not vanish; it changes, warming only after the wrist wearing it says yes. The lower draw opens once against the new law, finds nothing left that it is allowed to take, and shuts. The Count remains in the book; the hunger is cut out of it. Someone must sign for all of it, and the pen is in your hand, and Sova's open book suddenly has an heir. Kael bows to the arrangement, and then the script that runs to his jaw does not, and it comes at you wearing him.", trait: "merciful" },
            { text: "Take the valve. A better keeper is still a keeper, and it's you.", conclusion: "Your hand fits the meter like it was cast for it, and you understand, all at once, why the plate fogged at your intake: the vault has been reading you as a keeper since the day you arrived. The script starts at your wrist, warm as a bath, patient as winter. Beneath the meter the lower draw does not close; it waits, patient as the ice, for your first order. Kael's shoulders come down for the first time in forty years. 'Then hold it,' says the vault, with his voice, already counting you.", trait: "ambitious" },
        ]),
    ],
    "Moonshadow Village": [
        milestone("Moonshadow Village", 4, "No One Saves You", "Hidden Blade Trainee", "🌙", [
            { ...storyPage("Two Names", "The registry booth at moonrise, violet lanterns on the canal", "Shade Master Iro", [
                "Welcome to Moonshadow. Sit. Mind the curtain; it's older than both of us and holds more secrets than either.",
                "Everyone here carries two names. The day name buys bread and answers the watch. The night name does the real work, and you will guard it like your spine, because here a name is not what you're called. It's what you're WORTH.",
                "Your day name I'll take now, for the ledger. Your night name you'll choose yourself, later, when you know what you're protecting.",
                "Day name, then. Speak it plainly. It's the last thing you'll ever give this village for free."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
            { ...storyPage("The First Trade", "The registry booth, Iro's pen waiting over the intake book", "Shade Master Iro", [
                "Entered. Now, the intake question. Every soul in this book answered it once, and the book remembers every answer.",
                "In a village where everything true is currency, the question is this. When the night comes calling, what do you trade FIRST?"
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "\"Nothing that keeps someone else safe. That's not for sale.\"", nextPage: 2, trait: "ms4-trade-protector" },
                { text: "\"Whatever buys me the strongest hand in the room.\"", nextPage: 3, trait: "ms4-trade-strongest" },
                { text: "\"Anything, to buy back something I lost.\"", nextPage: 4, trait: "ms4-trade-redeemer" },
                { text: "\"I don't sell. I listen.\"", nextPage: 5, trait: "ms4-trade-listener" },
                { text: "\"I don't know what I have left to trade.\"", nextPage: 6, trait: "ms4-trade-unknown" }
            ] },
            { ...storyPage("A Guardian's Answer", "The registry booth", "Shade Master Iro", [
                "Not for sale. A guardian's answer. The booths eat guardians for breakfast, friend, but they pay a premium doing it.",
                "Entered and held, %name. Welcome to Moonshadow.",
                "One professional courtesy: know exactly WHO you're protecting before somebody sells you a list. That's the oldest con on the canal."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("A Buyer's Answer", "The registry booth", "Shade Master Iro", [
                "The strongest hand. A buyer's answer. Half this village came in saying that; the profitable half, I'll grant.",
                "Entered and held, %name. Welcome to Moonshadow.",
                "Mind the exchange rate. Around here the strongest hand is usually the one holding someone else's receipt."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("A Debtor's Answer", "The registry booth", "Shade Master Iro", [
                "Anything, to buy something back. A debtor's answer, and I say that with respect; debt is the only honest religion this village has.",
                "Entered and held, %name. Welcome to Moonshadow.",
                "Whatever you lost, be careful in the booths. They can always find you a version of it. Finding you the REAL one costs extra, and the difference is the whole business model."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("A Listener's Answer", "The registry booth", "Shade Master Iro", [
                "You don't sell. You listen. Ah. We have a name for your kind here, and it's spoken carefully: an EAR. Everyone wants one. No one can afford one for long.",
                "Entered and held, %name. Welcome to Moonshadow.",
                "Listen wisely. In this village, what goes into an ear has a way of coming out as an invoice."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("An Open Answer", "The registry booth", "Shade Master Iro", [
                "You don't know what you have left. Hm. Strange phrasing, friend. Not what you HAVE. What you have LEFT. People say what they mean at intake; it's the last honest hour of their lives here.",
                "Entered and held, %name, whatever it is you're missing. Welcome to Moonshadow.",
                "If you ever find out what was already spent, come tell me. Professional curiosity. I'll pay, and I never say that twice."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("Half a Second Late", "The Mirror registry: a disc of still black water that shows every newcomer their true reflection", "Narrator", [
                "Every intake ends at the Mirror registry: a basin of water so still it reads as stone. It shows each newcomer their reflection, and the registry clerks read something in it that they never explain.",
                "You lean over. The water shows the lanterns. The curtain. The clerk behind you.",
                "Then, half a second late, like a clerk thumbing through files to find your page... you.",
                "The registry clerk looks at the delay, then at you, then writes something long in a book that intake clerks are not supposed to have."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
            { ...storyPage("Line Five", "The canal steps outside, a sharp-eyed woman flipping a coin that isn't a coin", "Nyx", [
                "Psst. New blood. Over here. No, don't look around like that, you'll embarrass us both.",
                "I sell information. Good rates, better accuracy. And you get the newcomer special, because I like faces the Mirror has to look up. Here it is: your intake packet, line five, says your first test is in two nights. Line five is a lie. It's TONIGHT. No bell, no warning, no rescue. That's the real curriculum here: no one saves you.",
                "Free sample. First one always is; that's how the whole village works, so learn the shape of it fast.",
                "The yard behind the silk house, one bell after moonrise. Bring everything you have, and don't die; corpses can't become repeat customers."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "The silent yard, one bell after moonrise.", nextPage: 9 }
            ] },
            { ...storyPage("The Silent Yard", "The silk-house yard at moonrise, a veteran trainee unfolding from the shadows", "Narrator", [
                "The yard is silent because it is BUILT silent: sand raked to swallow footsteps, walls hung with cloth that eats echoes. Whatever happens here happens unheard.",
                "The one waiting has done this eleven times. Eleven newcomers, eleven first tests, eleven lessons in the curriculum nobody posts.",
                "There is no bell. There is no instructor. There is a woman on the canal steps who sold you the truth for free, watching from the wall with interest that isn't entirely professional.",
                "No one is coming. That's the test. That was always the test."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
        ], [
            { text: "Read the veteran's feet before the first exchange. Silence works both ways.", conclusion: "The yard eats sound, which means it eats THEIR sound too, and you fight the way the village taught you in its first hour: listening harder than you swing. By the third exchange you know the veteran's rhythm from the sand's whisper alone. On the wall, Nyx stops flipping her coin, which for her is applause.", trait: "suspicious" },
            { text: "Take the first strike to give one back harder. Set the price of you early.", conclusion: "You let the opening cut land so your answer lands twice as loud, and the silent yard learns something about your exchange rate: pain for position, gladly. The veteran resets with new respect and a bleeding lip. By morning, three booths are quoting odds on your next test, and the odds are flattering.", trait: "reckless" },
            { text: "End it clean and stand over them until the watchers see who won.", conclusion: "You finish it efficiently and then hold the yard, unhurried, letting every curtained window get a good long look at the newcomer standing and the veteran down. In Moonshadow, witnesses are currency. You just made your first deposit, and somewhere in the tower, a ledger notes the new arrival's opening balance.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 15, "The Sold Secret", "Veiled Hand Collector", "🌙", [
            { ...storyPage("Inside a Locked Room", "Your quarters, door still bolted, a cipher scroll on the pillow", "Narrator", [
                "The door was bolted from inside. The window latch is unbroken. The dust on the sill is undisturbed, and you checked, because this village has already taught you to check.",
                "And on your pillow, folded in thirds, is a cipher scroll in a dead network's hand.",
                "The message, when it gives up, is short: village patrol movements, sold in bundles, to an outside buyer, by someone inside. Meet regarding same.",
                "Someone put this in a locked room to prove they could. Everything in Moonshadow is a message, and the envelope is usually the loudest part."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Money That Sits", "Nyx's stall over the dye canal, the scroll flat between you", "Nyx", [
                "Where did you GET this. No, don't tell me, I'll charge myself for knowing. Let me work.",
                "Old network cipher, pre-Sable. Whoever wrote this learned their trade a generation ago... there. Patrol routes, gate rotations, sold quarterly. Real product, real buyer. And here's the strange line, the one that itches: the payments.",
                "The money never MOVES, friend. I traced two of these payments for my own curiosity last season. It lands in accounts that nobody draws from. Ever. Piles and piles of it, just sitting, like bait nobody's supposed to spend.",
                "Sellers who don't spend aren't sellers. They're EMPLOYEES. Someone is paying people in money that doesn't matter, for secrets that do, and honestly? As a professional, I'm offended by the margin."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Kage's Mercy", "The canal walk at midnight, Sable Nocturne feeding a lantern flame, alone", "Kage Sable Nocturne", [
                "Walk with me a moment. Yes, you. The scroll can wait; its author isn't going anywhere I haven't mapped.",
                "You've been here a season. So you've heard what I am. The woman who holds everyone's secrets. The spider in the tower. Accurate enough, as far as it goes.",
                "Tonight I burned a truth. A merchant's daughter did something unforgivable, years ago, and a creditor bought the proof and meant to spend it at her wedding. I bought it back this afternoon at four times the rate. Watch: there it goes, up the lantern. Nobody will ever know, including her. ESPECIALLY her.",
                "That's the office, friend. What no one knows, no one can take. I have held the truths that would have burned this village a dozen times over. Remember tonight, whatever you come to think of me. I'd rather be judged by the whole ledger than the worst page."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Doorway", "Your quarters again, and this time the doorway is occupied", "Veiled Hand Collector", [
                "The scroll. You have it. It was placed; you found it; the placement is confirmed received.",
                "Understand your position. The scroll was bait. Not for you. For whoever came to DECODE it. We watch what a newcomer does with a secret the way lenders watch what a borrower does with the first loan.",
                "You took it to the little dealer on the canal. Interesting. Not the watch. Not the tower. Not a buyer. A FRIEND. We had no column for that.",
                "The Collector will now assess. Do hold still. Assessment is quicker when the asset cooperates."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("Assessment", "The quarters, the Collector's veils drifting like ink in water", "Narrator", [
                "It moves like a debt: quietly, patiently, absolutely certain it will be paid.",
                "Outside the window, Nyx's voice, low and fast: 'That's a Veiled Hand. Tower adjacent, off-ledger, very expensive. Somebody just spent REAL money on finding out what you are. Try to be worth the fee, it annoys them.'",
                "The Collector's veils spread across the doorway, sealing the room the way a seal closes a letter.",
                "Assessment begins."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
        ], [
            { text: "Stand your ground in the open. Let it assess an honest answer.", conclusion: "You fight it in the middle of the room, nothing hidden, nothing held back, and the Collector's assessment gets exactly one entry it cannot price: a person in Moonshadow with no second layer. Its veils flinch, genuinely confused. Somewhere in the tower, a column meant for you stays blank, and blank columns keep certain people awake.", trait: "honorable" },
            { text: "Use the room against it. Lamp, shadow, curtain, angle.", conclusion: "You kill the lamp and make it fight in the dark it came from, and the room becomes a trap with a rent-paying tenant. The Collector withdraws with its veils torn, and its report will read, correctly, that the newcomer turned an assessment into an audit. In this village, that sentence has a price on it by morning.", trait: "suspicious" },
            { text: "Break through it and take the fight into the open street.", conclusion: "You go THROUGH the veils and out the door, dragging the confrontation onto the canal walk where lanterns burn and windows watch. A Veiled Hand, assessed in public: the worst outcome its contract allows. It disengages mid-exchange and pays a forfeiture rather than be seen, and every broker on the water just watched you learn the village's deepest rule: visibility is leverage.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 25, "Masks Beneath Masks", "Masked Auction Enforcer", "🌙", [
            { ...storyPage("The Cellar Auction", "Under the whisper market: a lantern-lit cellar, lots on velvet, buyers in masks", "Nyx", [
                "Hood up. Walk like you're bored. The cellar auctions are invitation-only, and our invitation is that I bribed the stair guard's gambling debt, so we are precisely one bad question from swimming home.",
                "Watch the lots, not the buyers. I used to move contraband through here myself: relics, weapons, embarrassing letters. Honest dirt.",
                "That's not what's selling tonight.",
                "Lot nine: patrol schedules, west quarter, ninety days. Lot ten: medical records, silk-house district, complete. Lot eleven... lot eleven is a NAME, friend. A living bloodline name, with an address. They're not selling contraband anymore. They're selling US."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
            { ...storyPage("The Prepaid Buyer", "The cellar floor, an empty chair with a standing bid", "Nyx", [
                "See the empty chair with the lantern? That's the buyer. Every lot tonight, same bid: one increment over the highest, no ceiling, prepaid. The auctioneer doesn't even look anywhere else anymore.",
                "Nobody buys EVERYTHING. Buying everything means you're not shopping, you're HARVESTING. A proxy chair with bottomless prepaid credit means the real buyer is somewhere the money can't embarrass.",
                "I've worked this market since I was nine, and I know every mask in this cellar by gait alone. I don't know who sits behind that chair. Do you understand what that means? In MY market?",
                "Someone with more money than the village is buying the village, one file at a time, and the market I grew up in is wrapping us in velvet for them."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp", choices: [
                { text: "\"Harrow measured me once and refunded the fee. Ask what SHE'D charge to trace that chair.\"", nextPage: 2, requireTrait: "ms20-respected-the-unsworn" },
                { text: "Get closer to lot eleven before it sells.", nextPage: 3 }
            ] },
            { ...storyPage("The Appraiser's Trace", "The cellar's shadowed gallery, Harrow already there, because of course she is", "Kite Harrow", [
                "Don't look surprised; it ruins your hood's whole argument. Yes, I'm working. Somebody has to appraise the lots the auctioneer under-describes. Tonight everything is under-described. Deliberately. You only under-describe when the buyer already knows what they're getting.",
                "The chair? I traced it two contracts ago, as far as tracing goes. The credit routes through four brokers, two of whom are dead, which is very good bookkeeping. And the mark on the original escrow is a circle, quartered. I've seen it in three other villages, always near the money that sits.",
                "You treated me like a person the night we met, so here's the appraisal you didn't order: this market thinks it's selling TO someone. It's wrong. It's being INVENTORIED.",
                "And inventory, friend, is what you count before you take possession."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp", choices: [
                { text: "Lot eleven goes up.", nextPage: 3 }
            ] },
            { ...storyPage("No White Invitation", "The cellar floor, the auctioneer's hand pausing, every mask turning", "Narrator", [
                "Lot eleven rises on its velvet: a name, an address, a life with a reserve price.",
                "And the auctioneer stops, because the stair guard is signaling, because somewhere between the gallery and the floor, somebody finally asked the bad question, and it was probably the one you're wearing on your face.",
                "'The house notes,' the auctioneer says smoothly, 'a guest without a white invitation.'",
                "The masks turn. The Enforcer detaches from the wall where it has stood so still you priced it as furniture. Nyx exhales a word that no ledger would print, and names her exit, and doesn't take it, and stays at your shoulder."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
            { ...storyPage("The House Rules", "The cellar, the Masked Auction Enforcer rolling its shoulders", "Nyx", [
                "Okay. Rules of a cellar fight, fast version: the house wins ties, the exits are sold not found, and NOBODY spills blood on the lots; the cleaning fees are legendary.",
                "That thing enforces for the house, the house answers to the chair, and the chair answers to a circle drawn somewhere we can't see yet.",
                "Lot eleven is still on the table. A person's name, friend. It goes to that chair in ninety seconds unless somebody does something loud, stupid, and unpriced.",
                "I'm flexible on loud and stupid. Unpriced is the hard part. Show me."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
        ], [
            { text: "Fight the Enforcer as a screen. Nyx palms lot eleven in the chaos.", conclusion: "You give the cellar its show, loud and central, and while every mask watches the Enforcer earn its retainer, a canal broker with quick hands makes a bloodline name disappear off velvet. The house records the lot as 'withdrawn.' The chair's proxy bid lands on nothing, prepaid, unrefundable. Somewhere, an inventory develops its first discrepancy.", trait: "suspicious" },
            { text: "Stand on the auction table and say what's being sold, mask off.", conclusion: "You name the lots out loud, bare-faced, in the one room built to never hear it: schedules, medicine, a living name, YOUR neighbors, sold to a chair. The cellar doesn't riot; this is Moonshadow, riots are for the daylight villages. But masks start leaving, one by one, and an auction with no bidders is just theft with candles. The house will remember your face. That was rather the point.", trait: "honorable" },
            { text: "Put the Enforcer through the buyer's chair. Let the house bill the circle.", conclusion: "You end the fight ON the proxy chair, splintering the standing bid's little lantern under two hundred pounds of house muscle, and the message writes itself in the wreckage: come shop in person. The auctioneer is very calm in the way of a man composing an extremely difficult letter to an extremely dangerous client. Nyx laughs the whole swim home.", trait: "reckless" },
        ]),
        milestone("Moonshadow Village", 35, "The Hollow Moon Contract", "Contract-Bound Shadow", "🌙", [
            { ...storyPage("The Bleeding Page", "A safe room over the canal, a contract that darkens in moonlight", "Nyx", [
                "Lot eleven's paperwork. The name sold with a RIDER, and I lifted the rider, and I need you to look at it under the moon and then tell me I'm wrong about what it is. Please. I'll pay you to tell me I'm wrong; that's a first.",
                "Look. In lamplight, a standard purchase memo. Under moonlight... there. The real text, coming up like a bruise.",
                "Kage Sable Nocturne, contracting party. Services: the quiet disappearance of listed persons, priced per name. And the list, friend. Look at the list. Every name on it is TALENTED. Promising. The kind the village would follow.",
                "She's not clearing threats. She's clearing SUCCESSORS. And look at the ruling: the page has lines for more names than it holds. This document expects to grow."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp", choices: [
                { text: "\"I stood at a stone once that only opens for a kept no. This page smells the same.\"", nextPage: 1, requireTrait: "rd34-kept-my-no" },
                { text: "Ask what's on the other end of the contract.", nextPage: 2 }
            ] },
            { ...storyPage("The Kept No", "The safe room, the contract pinned under a lamp it doesn't like", "Nyx", [
                "A stone that opens for a witnessed refusal. Where do you even FIND these... no. Focus, Nyx. Say the rest.",
                "So you've met old-world work before. Things built by the people who kept themselves. Then you already know what this rider is, underneath the legal silk: it's the OPPOSITE. A document built to collect what people never agreed to give.",
                "That's why it bleeds in moonlight. It's not ink, friend. It's escrow. Every name on this list is half-collected already, held in trust against delivery.",
                "Your stone kept a no. This page keeps a hundred yeses that nobody ever said. Same craft. Opposite prayer."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp", choices: [
                { text: "The lamplight bends.", nextPage: 2 }
            ] },
            { ...storyPage("The Counterparty", "The safe room, the lamp's light bending toward the wall like a bow", "Hollow Moon", [
                "The rider is read. The reading is noted. The reader is... ah. The reader is the discrepancy itself. How efficient. Two errands, one lamp.",
                "Be at ease. The Hollow Moon does not collect tonight. Tonight is a courtesy call, itemized as goodwill.",
                "Your Kage sells us her rivals and calls it protection. Her predecessor sold us his doubts and called it clarity. The seat sells; the seat is FOR selling; ask it, when you meet. We merely honor the standing order.",
                "You, though. You keep appearing in inventories with no purchase history. The chair noted it. The cellar noted it. Now the lamp notes it. Something acquired you before us, discrepancy, and the Hollow Moon does not bid on encumbered goods. Resolve your prior lien. Then we may talk terms."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
            { ...storyPage("The Contract's Guard", "The safe room, a shadow detaching from the contract itself", "Nyx", [
                "First, the thing it said about you. A prior lien means something else already owns a piece of you. The Mirror found the claim and doesn't know who to bill. File that away and shake about it later.",
                "The page is guarded. Of course the page is guarded; escrow that walks. I hate this document so much I could frame it.",
                "That thing is contract-bound: it exists to keep the rider intact and the list growing. Break the binding and the escrow spills; every half-collected name on that list gets its lien released. Eleven people wake up tomorrow un-sold and never know it.",
                "Or we keep the page whole and I spend a season tracing its clauses back to whoever drafted it. Knowledge or mercy, friend; the village never sells both at once.",
                "It's unfolding. Lamp's dying. Whatever you choose, choose it in the next breath."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
        ], [
            { text: "Study the binding as you break it. Learn the drafter's hand.", conclusion: "You take the guard apart the way Nyx reads a cipher: slowly, greedily, noting every clause it bleeds. When the binding snaps, eleven liens release, and you hold the drafter's grammar in your head: the quartered circle writes its contracts in surrendered trust, and now you can recognize the handwriting. Nyx calls it the most profitable fight she's ever billed nothing for.", trait: "suspicious" },
            { text: "Break the escrow outright. Eleven names go free tonight.", conclusion: "You put the guard down and the binding with it, and the rider's moonlit text pales line by line as eleven half-collected people are quietly returned to themselves. They'll never know. That's the strange ache of it: the best thing you've done in this village, and its whole nature is that nobody can ever thank you. Nyx writes the date in her book anyway. 'Somebody should hold the receipt,' she says.", trait: "honorable" },
            { text: "Keep the rider intact. A contract with HER name on it is leverage.", conclusion: "You fight the guard to a draw and reseal the page, escrow and all, into a moon-proof case. Eleven liens stay live, and you own the only document on the canal that binds the Kage's own name to the trade. Nyx looks at the case, then at you, pricing something she doesn't say aloud. 'Leverage on a spider,' she finally offers, 'is web. Remember which of you spins faster.'", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 50, "Jonin of the Hidden Knife", "Jonin Trial: Mirror Assassin", "🌙", [
            { ...storyPage("The Mirrored Chamber", "The tower's mirrored chamber, a hundred reflections, one Kage", "Kage Sable Nocturne", [
                "Come in. Ignore the mirrors; they're for guests who need reminding how many angles I have. You've never needed the reminder.",
                "Let me save us the dance. The cellar. The rider. The lamp that bent. I've read every report about you, including the two I wasn't supposed to receive. You have seen more of my ledger than any living person outside this tower.",
                "The traditional response is a quiet canal and a heavier current. Instead: kneel. I'm promoting you.",
                "Jonin of Moonshadow. The rank is real, the errand that comes with it is small, and if you're half what my files say, you're already asking yourself which part of this is the trap. Good. Keep asking. That instinct is the promotion."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "\"You reported the booths once. She knows. Watch her watch you.\"", nextPage: 1, requireTrait: "ms42-reported-the-booths" },
                { text: "Take the errand and read it later.", nextPage: 2 }
            ] },
            { ...storyPage("The Report She Kept", "The mirrored chamber, Sable drawing one page from her sleeve", "Kage Sable Nocturne", [
                "Since we're being efficient: yes, I have your booth report. The one you filed about the confession drains. Filed to the watch, intercepted by the tower, read by me, eleven times.",
                "Do you know what usually happens to that report? Nothing. It's filed by somebody every few years. Some frightened confessor, some sharp-eared clerk. I keep them all in one drawer. My drawer of almosts.",
                "Yours is the first that mapped the DRAIN and not just the fear. You followed the pipe. Nobody follows the pipe.",
                "So understand the promotion correctly, Jonin. I am not buying your silence. I'm buying your PROXIMITY. People who follow pipes should be where I can watch them follow mine. We're going to be very honest with each other, you and I, in the way of two people holding knives under a table."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "The corridor, after.", nextPage: 2 }
            ] },
            { ...storyPage("Collateral That Reports", "The tower corridor, Nyx leaning where the guards pretend not to see her", "Nyx", [
                "So. Jonin. Look at you. I'd bow, but the guards would charge me for it.",
                "Listen fast, because this corridor bills by the minute. Rank in this village isn't pay, it's POSITION. Position is collateral. And collateral, friend, REPORTS. From tonight, everything you do prices differently, and everything you say near me lands in a file with your new title on the spine.",
                "I took this same walk once. Different tower, same math. They made me a courier with a badge, and I learned in a month that the badge was a receipt someone else was holding.",
                "So here's my one free warning, old rates, for old times: read the small errand TWICE. In Moonshadow, nobody gives you the big knife first. They give you the small cut and watch which way you wipe the blade."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "The trial waits below.", nextPage: 3 }
            ] },
            { ...storyPage("The Mirror Assassin", "The trial floor beneath the chamber, your own reflection stepping out of the glass", "Kage Sable Nocturne", [
                "The rank trial. Every Jonin of Moonshadow fights it, and I will tell you what it is, because lying to you specifically seems inefficient.",
                "The Mirror drinks a reading of everyone this village registers. At trial, it pours one back. You will fight what the registry holds of YOU: every priced choice, every filed angle, the whole asset.",
                "Most candidates meet themselves and negotiate. The asset knows their tricks, so they bargain with it, and the trial prices them accordingly. It's the most honest interview ever designed.",
                "Yours came out half a second late, of course. Even the Mirror has to look you up. Begin when you're ready, Jonin. I confess I've sold tickets to better seats than mine for less interesting bouts."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp" },
        ], [
            { text: "Fight it to a standstill, then claim ITS reading as your property.", conclusion: "You beat the reflection to one knee and then, before the whole trial floor, invoke the market's own first law: possession of a defeated asset. The Mirror's reading of you, every priced page of it, transfers to YOUR custody, and the registry suddenly holds nothing on the newest Jonin but a receipt. Sable applauds, twice, slowly. In her drawer of almosts, something graduates.", trait: "ambitious" },
            { text: "Study its moves. It's built from the registry's file on you; learn the file's gaps.", conclusion: "You fight defensively and take inventory: everything the reflection knows, the registry knows, and everything it FUMBLES is a page your file is missing. By the last exchange you have a map of your own blind spot in their books, and it is exactly the shape of the things you've done unwitnessed. The asset dissolves, confused. You leave the trial knowing precisely what Moonshadow cannot see.", trait: "suspicious" },
            { text: "Refuse to fight yourself. Stand still and let it choose.", conclusion: "You ground your blade and face the asset open-handed, and for eleven long breaths the trial floor holds two identical people deciding what they are. Then the reflection grounds its blade TOO, and the Mirror, which has priced ten thousand candidates, records its first tie. Sable stands. 'The registry has no column for that,' she says, and the sentence sounds, in her mouth, like both a promotion and a threat.", trait: "honorable" },
        ]),
        milestone("Moonshadow Village", 65, "Mission to Kill a Witness", "Veiled Hand Executioner", "🌙", [
            { ...storyPage("The Unwritten Order", "The tower's night office, an errand delivered as a whisper, nothing on paper", "Narrator", [
                "The order arrives the way the worst ones do here: verbally, thirdhand, deniable. No seal, no page, no file. The small errand's true face, finally shown.",
                "A shrine witness on the eastern canal has been copying names. The witness dies tonight. The Jonin of the Hidden Knife handles it personally. The tower never asked.",
                "You've learned the village's grammar well enough to translate: someone with your title is expected to wipe the blade in the tower's direction.",
                "The shrine on the eastern canal keeps its lamps low. Witnesses usually do."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
            { ...storyPage("The Copied Names", "The canal shrine, an old keeper laying pages flat with shaking hands", "Shrine Witness", [
                "You're the knife, then. I wondered which one she'd send. Sit, knife. Read first. Kill after, if the reading leaves you able; it hasn't left ME able for much, and I only copied it.",
                "Names. Three hundred and eleven of them, going back forty years. People 'sold downward,' the booth clerks call it. Not killed, no. Killed would waste the asset. SOLD. Alive, somewhere below or beyond, and OWED, and every year the shrine takes confessions from families who think their people left them.",
                "I copy names because a name copied is a name that exists twice, and a thing that exists twice can't be quietly owned once. That's my whole crime, knife. Duplication.",
                "Read the third page. Read it before you decide anything. The third page is why she sent someone she's WATCHING instead of someone she trusts."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Read the third page.", nextPage: 2 }
            ] },
            { ...storyPage("The Third Page", "The shrine, one page under the low lamp", "Narrator", [
                "The third page is newer than the others. The names on it are children.",
                "Halfway down, in the witness's careful duplicate hand, one entry is ringed where the original was ringed: a girl, aged nine at sale, her true name traded by her own hand, 'consideration: one winter's food.' Sold to a buyer marked with a quartered circle. Storage fees current, paid quarterly, forty years running.",
                "The name is one you know. You know it because a woman on the canal steps gave you its DAY-name version for free, with a coin that isn't a coin, on your first night in this village.",
                "Nyx's true name has a holder, and a price, and a receipt, and she has been buying information about that file her whole life without ever once being able to afford the file itself."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Take Nyx's file page. Whatever else tonight becomes, this leaves with you.", nextPage: 3, trait: "ms65-saved-the-file" },
                { text: "Send the page to Nyx tonight, unsigned. Hers to hold first.", nextPage: 3, trait: "ms65-gave-nyx-the-file" },
                { text: "Copy nothing, take nothing. The witness's set stays whole and hidden.", nextPage: 3, trait: "ms65-resealed-the-crate" }
            ] },
            { ...storyPage("The Second Knife", "The shrine door, a second figure arriving with excellent manners", "Veil Adaza", [
                "Evening, colleague. Veil Adaza. We shared a bad bridge once; I still owe the Black Bridge ledger one clean disclosure, so here it is, free and complete.",
                "I hold the same errand you do. Same whisper, same witness, same night. That's not redundancy, colleague. That's a TEST with two answer sheets. She wants to know which of her knives cuts where it's pointed.",
                "And one more disclosure, since the bridge debt runs deep: my errand came with a second clause. If the first knife hesitates... well. You can price a sentence like that yourself.",
                "The Executioner behind me came in case we BOTH hesitate. So. Colleague. How do we answer the test?"
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "\"I've stood between bolts and the chained before. I'm doing it again.\"", nextPage: 4, requireTrait: "rd52-shielded-the-line" },
                { text: "Answer with your stance, at the shrine door.", nextPage: 4 }
            ] },
            { ...storyPage("The Executioner's Patience", "The shrine yard, the Veiled Hand Executioner unfolding from the dark", "Veil Adaza", [
                "For the record, colleague, I was rather hoping you'd pick the door.",
                "The witness keeps copying inside, which under the circumstances is either courage or the deepest deafness on the canal. Three hundred and eleven names that exist twice. Someone upstairs wants them existing once, and wants to know what YOU want, and built tonight to learn both at a single fee.",
                "The Executioner doesn't negotiate, before you try; its contract is prepaid. Ask me how I know. Don't, actually.",
                "Whatever the pages are worth to you, the price posts now, knife. Show the tower your answer."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
        ], [
            { text: "Stand between the Executioner and the shrine. The copying continues.", conclusion: "You plant yourself at the shrine door and make the tower's prepaid contract earn every clause, and behind you, through the whole fight, the sound never stops: an old keeper's brush, copying names, steady as canal water. Adaza watches from the wall, scrupulously neutral, and at the end files the only report she can: the first knife stands where it's pointed AT, not where it's pointed FROM.", trait: "merciful" },
            { text: "Unmask the errand: shout the tower's order to the whole canal.", conclusion: "You do the unpriceable thing: you say an unwritten order OUT LOUD, at volume, across water that carries sound like a grudge. Windows open. Booths empty. An off-ledger kill order, published mid-execution, and now three hundred witnesses know the shrine keeper's crime was a list of the sold. The Executioner completes exactly none of its contract in front of an audience. Deniability dies loudly, which is the only way it dies.", trait: "reckless" },
            { text: "Let Adaza engage first. Read the Executioner's contract as it fights.", conclusion: "You hold back three exchanges while a colleague with bridge debts buys you the view, and you read the Executioner the way you've learned to read this village: it moves in CLAUSES. Strike only on breach. Withdraw on payment. It isn't a fighter, it's a CONTRACT, and contracts have termination language: you find it in the fourth exchange and speak it, and the thing simply... stops. Adaza stares. 'I'm not billing tonight,' she says. 'Nobody would believe the invoice.'", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 75, "Nyx Chooses a Side", "Shadow Network Hunter", "🌙", [
            { ...storyPage("The Red Moon Ledger", "A rooftop over the whisper market, red moon, Nyx's ledger open to a page of shame", "Nyx", [
                "Sit. Drink. It's the good bottle, which should scare you; I don't open the good bottle for profit.",
                "Confession time, and you're the only confessor on this canal who doesn't drain into a pipe. Six months ago, the Hollow Gate's people approached me through four cutouts to buy information about YOU. And I sold it. Don't do the face. Listen to WHAT I sold.",
                "Garbage. Invented routines. Fake habits, wrong debts, a sleep schedule I made up out of spite. Pure fiction, top rates. And they PAID, friend. Every time. Full price, no haggling, quarterly.",
                "That's when I understood what the client actually was. Nobody pays full price for garbage unless the garbage isn't the product. They weren't buying facts about you. They were buying the TRANSACTION. Me, selling you. The act itself. That's the crop, and I've been the harvest, and I did it to myself at market rates."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
            { ...storyPage("The Free Envelope", "The rooftop, one envelope on the tiles between you, unpriced", "Nyx", [
                "So here's what happens now, and I want it on the record that the record can go drown itself.",
                "This envelope names the Gate's inner-circle agent in the tower. Name, hours, the room where the quartered circle's correspondence lands. It's worth more than my stall, my ledger, and both my names together.",
                "It's free. Take it. FREE, friend. I've run the math on what free costs me, and I'm paying it. That's the whole announcement.",
                "I stopped keeping a file on you. That is not in the ledger either. There's no receipt for tonight anywhere in this village, and you have no idea what that sentence COSTS a person like me, and I'd rather you never fully find out."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "\"You named the lattice once. Now name its agent out loud with me.\"", nextPage: 2, requireTrait: "rd74-bound-the-lattice" },
                { text: "Take the envelope.", nextPage: 3 }
            ] },
            { ...storyPage("Naming It", "The rooftop, the red moon deepening", "Nyx", [
                "The lattice. Yes, that was the coast's old cipher-word for it; the tower's people call the same web the Hollow Gate now. Same rot, newer letterhead. You carried its keys once, you told me, back when you trusted me with exactly nothing else, which, fair.",
                "Four anchors, one buyer's web under all of it, and every village's tower has a room where its letters land. You've known the shape from the outside. I know it from the receipts.",
                "So let's do it properly, out loud, both of us, no cipher: the thing under the villages has an agent in OUR tower, and the agent has a name, and the name is in that envelope, and after tonight neither of us can pretend we're just merchants anymore.",
                "There. Said. You know, everyone in this village thinks the dangerous act is opening a secret. It isn't. It's this: two people knowing the same thing ON PURPOSE, for free. That's the transaction the Mirror can't file."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "The moon's light bends.", nextPage: 3 }
            ] },
            { ...storyPage("The Lecture", "The rooftop, the red moonlight pooling into a standing shape", "Hollow Moon", [
                "Discrepancy. And the little dealer. How tidy; the audit walks to us.",
                "Dealer. Your last six months of product have been reviewed. The fiction was noted from the first invoice; fiction is FINE, dealer. We told you: the transaction is the crop. But tonight's entry. The envelope. The 'free.'",
                "There is no column for free. Free is not a price. Free is a REFUSAL wearing a price's clothing, and refusals witnessed in the open become... load-bearing. You have made yourself structurally significant, dealer, and structures get surveyed.",
                "The Hollow Moon extends one final offer at preferential terms: reprice tonight. Any figure. Name literally any figure, and the ledger heals, and the survey forgets the roof. Decline, and the discrepancy's contagion is confirmed, and containment becomes billable."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
            { ...storyPage("The Shadow Network Hunter", "The rooftop, shapes rising from every drain and gutter the market owns", "Nyx", [
                "Well. There's my answer to 'what does free cost.' It costs THAT, apparently. Flattering, in a way. They priced my defection above my life; that's the best margin I've ever appeared in.",
                "The Hunter takes repricing refusals. It doesn't kill, friend, understand that before it reaches us. It RECOVERS. It drags assets back to the ledger. There are people in this market walking around today who refused once, and they smile fine, and they haggle fine, and there is nobody home behind it.",
                "So. Here's my figure, called out loud for the whole canal to hear: NO.",
                "Worst negotiator on the roof. Somehow I've never felt richer. Back to back, friend. Let's show the ledger what a bad debt looks like when it fights."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
        ], [
            { text: "Watch the Hunter's recovery grammar. Learn what un-prices a person.", conclusion: "Even back to back with everything at stake, you read as you fight: the Hunter binds through the target's own receipts, climbing a lifetime of transactions like a ladder. And Nyx, tonight, has one rung missing: the free envelope, the unpriced act. Its grip slides off her THERE, every time. You file the discovery where you file the priceless things. A person's freedom is load-bearing exactly where they gave something away.", trait: "suspicious" },
            { text: "Hold the line at her shoulder until the moon sets. No reading, no angles.", conclusion: "For one whole night you are precisely what the ledger says cannot exist: unpriced help, standing its ground for nothing. The Hunter probes for the transaction underneath and finds only the thing itself. At dawn it withdraws, unpaid and unpaid-able, and Nyx sits down hard on the tiles and laughs until she cries, and then just cries, and neither of you invoices the other for witnessing it.", trait: "honorable" },
            { text: "Counter-offer the Hollow Moon, mid-fight: the agent's name for its retreat.", conclusion: "You negotiate DURING the recovery, shouting terms over the Hunter's shoulder at the moonlight itself: call it off, and the envelope's name stays private one more season. The Hollow Moon pauses. Considers. ACCEPTS, at terms, logged. Nyx stares at you as the shapes drain back into the gutters. 'You just opened an account with it,' she says quietly. 'Friend. Nobody closes those. I checked.'", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 85, "The Kage Owns Every Secret", "Veiled Hand Grandmaster", "🌙", [
            { ...storyPage("The Night of Open Files", "The whisper market at dawn, forty years of intake dumped on every doorstep", "Narrator", [
                "It happens in one night. Every alias, every debt, every confession the booths ever drained: unsealed, copied, and delivered. Doorsteps. Stall counters. Nailed to the shrine door. Forty years of the village's held truths, given back all at once, like a dam deciding rain was a mistake.",
                "The market convulses. Marriages detonate at breakfast. Three brokers flee before the fish carts even arrive. A moneylender reads his own file weeping on the canal steps, and nobody stops to watch, because everybody is reading their own.",
                "It should be chaos, and it is. It should be random, and it is NOT.",
                "Every unsealed file went to its subject. Not to enemies. Not to buyers. To the PERSON. Whatever this is, it has a principle in it, buried somewhere in the cruelty."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp" },
            { ...storyPage("The Controlled Burn", "Nyx's stall, shutters up, her own returned file unopened on the counter", "Nyx", [
                "Mine came too. Every file's home with its person, all in one night. You know what that takes? The tower's whole courier web, run at panic speed, in secret, by HER order. She burned her own warehouse, friend. The spider torched her own web.",
                "And I know why. Word crossed the canal at midnight: a transfer was coming. The Mirror itself, appraised for 'change of ownership.' Quartered circle seal. The buyer finally stopped shopping and called in the whole INVENTORY, tower and all.",
                "So Sable ran a cornered keeper's numbers: what no one holds, no one can take. If everything goes home, there's nothing left on the shelf to transfer. She gave the village back its own skin to keep it off a buyer's rack.",
                "It's the most monstrous kind thing or the kindest monstrous thing I've ever seen, and I deal in both. My file's right here. Returned. I haven't opened it. Forty years of wanting it, friend, and my hands won't."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "\"You pulled Harrow back from the Mirror job. Now ask her WHO the buyer is.\"", nextPage: 2, requireTrait: "ms80-pulled-her-back" },
                { text: "Climb to the tower before the transfer lands.", nextPage: 3 }
            ] },
            { ...storyPage("The Buyer's Name", "The stall's back room, Harrow arriving with her collar up and her license folded away", "Kite Harrow", [
                "You kept me off the worst contract of my career once, so this one's paid in kind, and then my books on this coast are closed, possibly forever, possibly by tonight.",
                "The Mirror commission's client: no name, no face, obviously. But I appraise for a living, and every buyer leaves a fingerprint in what they VALUE. This one never once asked about the secrets. Not one question about content. Only about capacity. Volume. Retention. How much surrendered trust the glass can HOLD.",
                "They're not buying the village's dirt, friend. They're buying the CONTAINER. The same way they bought a reserve under an arena and a vault under a wall and a fire under a kiln. Four vessels, one buyer, and a collection date that keeps moving closer every time a village's account runs hot.",
                "Sable knows. That's what tonight was. You don't burn your web for a rival, colleague. You burn it for a LANDLORD. Go up the tower. And whatever she offers you at the top, remember somebody priced her once too, and she's been paying interest ever since."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Up the tower.", nextPage: 3 }
            ] },
            { ...storyPage("The Empty Archive", "The tower archive, stripped to bare shelves, Sable alone in the wreck of her life's work", "Kage Sable Nocturne", [
                "Come in, Jonin. Mind the empty. There's a great deal of empty tonight; I made it myself.",
                "Forty years of collection, gone home in one courier night. My whole arsenal, disbanded. Would you like to know the marvelous joke? It was never MY arsenal. I audited the deep vault at midnight, before the burn. Every file I ever held had a duplicate lien on it. A prior claim, older than my seat, marked with a quartered circle. I wasn't only the spider, friend. I was the WAREHOUSE CLERK, keeping stock for a buyer I never met, and my predecessors' predecessors inherited the first lease. But do not mistake inheritance for innocence, Jonin. The Gate offered a buyer; I supplied the warehouse, and I kept it profitable, quarter after quarter, for forty years.",
                "The transfer lands tonight regardless. An empty warehouse breaches the lease; the buyer takes the fixture instead. The Mirror. And the Mirror, Jonin, holds a copy of every act of trust this village ever surrendered, including everything I burned, because the booths drained INTO it all along. My grand gesture emptied the shelves and left the tank.",
                "So. Bring me a safer truth, if one exists. Show me this village protected without one soul of it being OWNED, by me or mine or theirs, and I will crack the Mirror myself and stand trial in the market at noon. Until then, I hold the tank, because the alternative holder is worse. That's my whole defense. It used to sound better."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Take the founding lease with you. The blank line no hand ever signed is evidence too.", nextPage: 4, trait: "ms85-copied-the-blank-line" },
                { text: "Leave the paper. Bring her the living truth instead.", nextPage: 4 }
            ] },
            { ...storyPage("The Veiled Hand Grandmaster", "The tower stair, the eldest Veiled Hand unfolding from the shadows it taught", "Narrator", [
                "The Grandmaster of the Veiled Hand has served four Kages and outlasted three attempted successions. It taught the Collectors their patience and the Executioners their clauses, and it stands the stair tonight not for Sable, but for the ORDER of things.",
                "Below, the market reads itself by lamplight, forty years of truth loose in the streets. Above, a Mirror waits for its new owner, black and still and patient as escrow.",
                "The Grandmaster's veils settle. Its contract, the oldest in the village, has one clause: nothing reaches the tank unpriced.",
                "You have never once priced correctly here. That was always going to come due tonight."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp" },
        ], [
            { text: "Stand with the market: shepherd the night of open files at street level.", conclusion: "You spend the fight and the night in the streets: breaking up two duels, guarding the shrine's copied lists, sitting with a moneylender while he finishes his own file and, at the end, folds it closed and shakes your hand. The village survives its own truth by morning, bruised and strangely lighter. Word climbs the tower: the newcomer held the MARKET together, unpaid. The Grandmaster's veils note the figure that refused to climb, and the note reads, in its old grammar, like respect.", trait: "loyal" },
            { text: "Go through the Grandmaster now. The Mirror doesn't change hands tonight.", conclusion: "You take the stair by force, veils tearing like old contracts, and reach the tank chamber with the transfer's escrow already glowing on the glass. The Grandmaster yields the stair a step at a time, and by the top it has stopped fighting and started WATCHING, the way old instruments watch a new hand take the work. The transfer clause hangs mid-air, unexecuted, waiting on tonight's outcome. Nothing about it is settled. But it did not land on schedule, and schedules were the buyer's whole religion.", trait: "reckless" },
            { text: "Audit the lease itself. Every contract that binds has a breach clause.", conclusion: "While the market burns through its truths, you sit in the stripped archive with the one document Sable never burned: the original lease, older than the village's name, quartered circle on the seal. You read it the way the shrine witness copied: patiently, twice. And you find them: the payment schedule, the balloon clause, and there, in the oldest hand, the breach terms. What no one signed, no one owes. Somebody in this lease's chain of custody never actually SIGNED. The line is blank. It has been blank for four hundred years, and every collection since has been enforcement of a debt nobody sealed.", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 100, "The Moon Belongs to No One", "Kage Sable Nocturne, Hollow Moon Sovereign", "🌙", [
            { ...storyPage("The Black Moon", "The tower summit stair, the moon overhead gone black as the Mirror", "Narrator", [
                "The moon goes black at dusk, and nobody in the market needs it explained: the collection date arrived. The buyer's escrow sits full. Tonight the account of Moonshadow settles, one way or the other.",
                "The village does not climb behind you. It does something the tower has no procedure for: it stays home with every lamp lit. Returned files stand open in the windows, and the whole canal watches the books balance from inside its own houses. Only the ones with business at the top take the stairs: the shrine witness with her copied names, and a moneylender holding his own file like a lantern.",
                "At the summit landing, on the last step, someone has left a cup of canal tea, still warm, and a note in a broker's quick hand: 'Argue dry and you'll lose. No charge. That's twice now. N.'",
                "The Mirror chamber stands open. It has been waiting half a second longer for you than for anyone."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp" },
            { ...storyPage("At the Chamber Door", "The summit door, Nyx with her returned file tucked unopened in her coat", "Nyx", [
                "So this is the part where you go in alone. Village rules, tower rules, some contract older than both. I've read the fine print. I hate it. It's airtight.",
                "Inventory, since you like when I do inventory. One envelope, spent. One good bottle, drunk. One file, mine, returned and unopened, and it's staying that way until the person who taught me things could be free is standing where I can bill them for the lesson. That's you. That's tonight. No pressure.",
                "Whatever's wearing her up there, remember what Harrow said: somebody priced HER once too. Every keeper on this whole rotten coast, in every village the Gate feeds, was somebody's purchase first. It doesn't excuse one line of the ledger. But it's true, and true things are the only currency that survives tonight.",
                "The door is mine tonight. First one I've ever held for free, and if you tell anyone, the rates go back up."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enter the Mirror chamber.", nextPage: 2 }
            ] },
            { ...storyPage("The Woman and the Tank", "The Mirror chamber, the black glass vast and still, Sable's shadow no longer matching her", "Kage Sable Nocturne", [
                "You kept the appointment. Tonight of all nights, I find that I am glad.",
                "Look at it. Every act of surrendered trust this village performed for four hundred years, held in one tank. The moon over Moonshadow was always the Mirror, seen from underneath, and the thing they call the Hollow Moon was never a second moon; it is the Gate wearing our reflection. Tonight the tank transfers to that buyer, the one four vessels feed and no one in this room has ever seen. It has a name older than my seat, and I will say it once: the Hollow Gate.",
                "And look at ME, Jonin; everyone else is too polite. My shadow stopped taking my shape in the spring. The Gate is disbursing my account now, word by withheld word, and yes, I am being spent to settle it. But do not hand the Gate my share of the blame. The first lease was not mine. The renewals were.",
                "You are the fourth person to climb this tower and serve me notice. I broke the first three; you've read those files. But you are the first who has read their OWN. The Mirror showed you half a second late from your first night, because you arrive pre-encumbered, discrepancy. Somebody holds a piece of you the way I held pieces of everyone, and you walked in anyway, and I find that either the bravest or the most collateralized act I've ever appraised.",
                "So. Serve your notice. We will hold the paper anyway. It is what we are."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Face her before the glass.", nextPage: 25 }
            ] },
            { ...storyPage("The Better Truth", "The Mirror chamber, the Returning's receipts fanned on the black glass", "Kage Sable Nocturne", [
                "What is that. Show me. Slowly; the glass is listening, and it has never once heard this.",
                "Returned files. WITNESSED returns, by consent, in open market. The thing the booths swore was detonation. And the market didn't burn. I read the reports until the ink smeared; I made my clerks re-verify eleven times.",
                "I asked for a safer truth the way the desperate ask, Jonin. Rhetorically. Certain the ask was safe because the thing did not exist.",
                "Read me the figures, %name, the way my clerks never dared: like a bill, served on the holder."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "\"Eleven files returned before witnesses. Zero fires. The market SAW it hold.\"", nextPage: 4, requireTrait: "ms88-open-returns" },
                { text: "Lay the sealed receipts on the glass and read her every countersigned line.", nextPage: 5, requireTrait: "ms88-sealed-receipts" },
                { text: "\"Your own booths ran the numbers. The market repriced returning at survivable.\"", nextPage: 6, requireTrait: "ms88-baited-the-market" },
                { text: "Set the child's bill of sale on the glass and let its smallness argue.", nextPage: 7 }
            ] },
            { ...storyPage("What the Market Saw", "The chamber, the black glass showing the market's lanterns far below", "Kage Sable Nocturne", [
                "Witnessed. In the open market. Then it's already finished, isn't it. I can suppress a fact; I've made a career of it. I cannot suppress a thing the whisper market watched WORK. They'll be returning files on the east canal by the new moon whether either of us survives tonight.",
                "Forty years I held this village's skin and called it armor. You handed some of it back in daylight and nothing burned."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass moves.", nextPage: 8 }
            ] },
            { ...storyPage("The Countersigned Receipts", "The chamber, receipts flat on the glass, her finger moving line to line", "Kage Sable Nocturne", [
                "Hand them over and sit; auditing is the last love I have left, and I intend to take my time with this one.",
                "Return of file, subject-verified, witness-sealed. Eleven times. And the countersigns... the shrine witness. The moneylender. IRO. Iro signed a RETURN, that profiteering antique, he's never signed anything that didn't accrue... and it's dated, and it's witnessed, and it holds.",
                "The receipts hold, Jonin. I taught this village that every trust needs a holder. You've filed eleven pages of evidence that it only ever needed a WITNESS."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass moves.", nextPage: 8 }
            ] },
            { ...storyPage("The Market's Own Arithmetic", "The chamber, a booth's price-slate held up to the glass", "Kage Sable Nocturne", [
                "The booths repriced. I saw the slates at dusk and had two clerks flogged for forgery, and they were not forgeries. Returning, priced survivable. Holding, priced at RISK. My own market, marking my life's work down to salvage.",
                "You didn't argue with me at all, did you. You argued with the exchange rate and let the exchange rate climb my tower.",
                "It's the only argument a keeper of ledgers was ever going to lose. I built this village to believe the numbers over the sermon, and now the numbers have opinions."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass moves.", nextPage: 8 }
            ] },
            { ...storyPage("The Unopened File", "The chamber, one file on the black glass, still closed", "Kage Sable Nocturne", [
                "Whose... no. I know whose. The little dealer's. Sold at nine, one winter's food, storage paid quarterly by the circle. I've had that file memorized for a decade; I always understood it was the market's whole biography in one folder.",
                "And her tower file went home in my burn, days ago. She has not opened it. It has been in her hands for days, and she has not opened it, because she is free either way now, and the not-needing-to is the whole proof, isn't it. You cannot warehouse a person who can hold her own file unopened.",
                "Forty years of collection, Jonin, and the safest truth in this village is sitting on my Mirror in an envelope nobody needs to read."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass moves.", nextPage: 8 }
            ] },
            { ...storyPage("The Names in the Glass", "The Mirror chamber, the receipts against the tank, the reflection changing", "Narrator", [
                "The receipts lie against the black glass, and for the first time in forty years the Mirror reflects the names on the signatures instead of the keeper's face.",
                "A single clear line crosses the tank, and a voice follows it, level and old. OWNERS VERIFIED. RETURN CHAIN WITNESSED. CONSENT CONFIRMED. NO HOLDER REQUIRED.",
                "'The First Reflection,' Sable says, very quietly. 'The Mirror's oldest instruction. Witness the truth. Then let it go. We kept the witnessing and removed the letting go.'",
                "She straightens, and does not look away from the glass again."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass stills.", nextPage: 12 }
            ] },
            { ...storyPage("Her Own Name", "The chamber door opening, Nyx crossing the black glass floor", "Nyx", [
                "You held the door for me my whole life, %name, one way or another. My turn. This part is mine.",
                "Kage. You know my day name; everyone does, it's good product. And you hold the ledger that says my true name was sold at nine, one winter's food, storage current, quarterly, forty years.",
                "Here's tonight's transaction, priced at nothing, witnessed by everything: my name is NERISSA VALE. My mother chose it. I sold it to eat, and I am taking it back by SAYING it, in front of your tank, for free.",
                "Do write that down, somebody. First entry in the new ledger. It's going to be a thick book."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass goes very still.", nextPage: 10, trait: "ms100-nyx-named-herself" }
            ] },
            { ...storyPage("The Oldest Rule Answers", "The Mirror chamber, one clear line crossing the black tank from end to end", "Narrator", [
                "The glass stays still for one breath. Two. Then it ripples, and the ripple is wrong for this room: not the Hollow Moon's red, but a single clear line, crossing the black tank from one end to the other.",
                "A voice follows the line, level and old, from a place in the glass no drain reaches. NAME SPOKEN BY OWNER. WITNESSED. NOT SURRENDERED. NOT FOR SALE.",
                "A second ripple follows. NO HOLDER REQUIRED.",
                "For the first time tonight, Sable Nocturne takes a step back from her own Mirror."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Sable stares at the glass.", nextPage: 11 }
            ] },
            { ...storyPage("The Tank Hears a Name", "The chamber, the Mirror's stillness broken by one slow ripple", "Kage Sable Nocturne", [
                "You kept her proof out of the market. You returned it to its owner. And then you stood aside while she bought her own name back with her own breath.",
                "And I know that voice. It is written into the oldest Mirror plans, and for forty years I read it as a ceremonial phrase. The First Reflection. The glass's original instruction: hear a truth, verify its owner, let witnesses confirm it, and give it BACK. Release the claim. The Mirror was built to witness people, Jonin. The Hollow Gate taught it to keep a copy.",
                "And before I turn that into another excuse, understand me. The Gate taught the Mirror to hold. I kept the warehouse full.",
                "Look at the glass. Four hundred years of stillness, and one free sentence woke the oldest rule in it. Nothing surrendered. Nothing held. Spoken, witnessed, and hers."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "She steps back from the glass.", nextPage: 12 }
            ] },
            { ...storyPage("Unlisted", "The Mirror chamber, Sable's shadow finishing its departure", "Kage Sable Nocturne", [
                "I am out of collateral, and what remains of me is unlisted.",
                "Come and meet it."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("Returns Without Names", "The chamber, the return figures chalked plain, no receipts behind them", "Kage Sable Nocturne", [
                "Eleven returns, zero fires. The figures are real; my clerks verified them twice and I had them verified a third time out of spite.",
                "But whose returns, Jonin? Who handed back what, to whom, witnessed by which names willing to SIGN? An unsigned mercy is a rumor, and this market eats rumors for breakfast and stays hungry.",
                "I can't crack a four-hundred-year tank on a rumor. Bring me signatures, or bring me your hands."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "She turns back to the glass.", nextPage: 25 }
            ] },
            { ...storyPage("The File in Your Coat", "Nyx's file in Sable's hands, hers to weigh, unopened", "Kage Sable Nocturne", [
                "The dealer's bill of sale. The shrine's copy. Her tower file went home in my burn; this is the page that PRICED her, the child's own signature, and it is still in YOUR coat, Jonin. Not hers.",
                "You saved it from the crates and the couriers and the circle's quarterly fees, and then you kept it, the way I kept ten thousand of them: safely. For later. On someone's behalf.",
                "A held file is a held file, friend, whatever the holder's intentions. I have forty years of good intentions downstairs in an empty archive.",
                "You kept the proof of what this village does to children, and never handed it back to the child. It is not nothing, friend. But the glass prices outcomes, not intentions. So, heaven help me, do I."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "She sets the file down with terrible gentleness.", nextPage: 15 }
            ] },
            { ...storyPage("From the Door", "The chamber threshold, Nyx one step inside, not crossing the black glass", "Nyx", [
                "That was mean.",
                "Accurate, which is worse. Hand it back when we're down the stairs, would you? I don't like my file this high up."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass waits.", nextPage: 25 }
            ] },
            { ...storyPage("Iro Reads the Manifest", "The chamber stair, Iro arriving with the buyer's manifest and an expression nobody has ever purchased", "Shade Master Iro", [
                "Don't touch that, friend. It cost me everything I have ever charged anyone, and I will present it myself.",
                "Sable. Old friend. Old adversary. Old COLLEAGUE, which on this canal is both. I obtained the buyer's manifest tonight, through channels I will die not disclosing. The inventory for transfer. Every asset in the tank, itemized. I went looking for my holdings, naturally. Force of habit.",
                "I'm IN it. Line four hundred and six. 'Broker, senior, high-yield: Iro.' Not my holdings, Sable. ME. I'm not a client of this arrangement. I never was. I'm STOCK with a long settlement date.",
                "Forty years I sold this village's trust retail and called myself the one merchant too clever to be merchandise. The manifest disagrees. So here I stand, at the top of the tower, doing the one thing nobody ever priced me for: telling the truth at a loss. Whatever the discrepancy is selling tonight, Kage... I'm buying. That alone should terrify you into listening."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "He sets the manifest beside the glass.", nextPage: 25 }
            ] },
            { ...storyPage("The Blank Line", "The Mirror chamber, the founding lease unrolled on the black glass, older than the tank", "Kage Sable Nocturne", [
                "The founding lease. You read it the way the shrine witness copies names: twice. And you found it, didn't you. The line at the foot, where the first holder's signature should sit. Blank. Four hundred years of collection, and no hand ever signed the debt into being.",
                "I found it my own first year on this seat. Do you know what a blank line is, on a contract this old? Not a freedom, Jonin. A dare. I could have called the whole lease void that night and let the Gate come collect in person, from me. Instead I renewed it. In good ink, beside the blank, every quarter, for forty years.",
                "So, yes. Nobody signed the first page. But I signed all the rest, knowing they were air, because air was cheaper than the reckoning. That is not the lease's guilt you are holding up to my glass. It is mine, in my own hand."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the shelf. You've been paying its fee for seasons.", "The reckoning", "Kage Sable Nocturne", [
                "So Iro sold you a shelf after all. Custody of your own file, editing rights on everyone else's, compounding monthly. Then you've sat where I sit: reading people at leisure and calling the reading protection.",
                "Tell me you never once opened a stranger's page just because the fee entitled you. Say it, and I'll call you a liar in front of the glass.",
                "That entitlement is my whole biography, Jonin. One shelf, one drawer, one tower, one tank. You bought in for a secret a month. I bought in for a village. The interest rate is the same."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for my file. I burned it in front of you.", "The reckoning", "Kage Sable Nocturne", [
                "Yes. Your file. The one delivery my couriers ever made through an unbroken lock, and you put it in a brazier unread. My clerks called it waste. I called it the single most expensive purchase this village ever witnessed: you bought not-knowing, at the price of everything the knowing might have armed you with.",
                "I have wanted to ask for two seasons, keeper to whatever you are: was it worth it? Owning nothing on yourself? Walking around unleveraged, unhedged, PLAIN?",
                "Don't answer. Your face already has, and the glass saw it, and so did I. When you hold this tower, and I believe now you may, remember that the bravest ledger in Moonshadow was one page, burning. I never managed it. Not once, in forty years, with ten thousand chances."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for Nerissa Vale. Her name comes home tonight.", "The reckoning", "Kage Sable Nocturne", [
                "The dealer. Sold at nine, one winter's food. You want the part I have never told a living soul? I found her file in my first year on this seat. A child's name, sold for a winter, storage accruing. I could have returned it. It would have cost me nothing.",
                "I kept it. Not for leverage; I never once drew on it. I kept it because it was the PERFECT file: the whole village's arithmetic in one folder, and some keeper's instinct in me said, the day this file goes home, the tank cracks. I filed a nine-year-old under load-bearing and told myself it was stewardship.",
                "Tell her that, afterward. Tell her the Kage read her price every winter and kept the receipt where it kept the whole system standing. She deserves to hate me with the file in hand. And Jonin... she deserves to hear it TONIGHT, whichever of us is left to say it."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the night name you would not write.", "The reckoning", "Kage Sable Nocturne", [
                "You refused the field. That is a different thing from leaving it blank, Jonin, and the Mirror hates the difference.",
                "A blank line it can price later. A refusal, witnessed, it never learns how to file at all."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the night name that is yours alone.", "The reckoning", "Kage Sable Nocturne", [
                "A name chosen by its owner is the one invoice this village never learned to write. You wrote yours at intake and never once let me buy it back.",
                "I held ten thousand names and understood that far too late. You understood it your first night."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the leaf you tore out of your own file.", "The reckoning", "Kage Sable Nocturne", [
                "You stole the handle before my clerks could price the door it opened. Walked it out in your own coat, quarterly deposit landing on the gap where it should have sat.",
                "I respect the theft. Professionally, Jonin, and privately, which I do not say twice."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the night name you wrote to shield someone else.", "The reckoning", "Kage Sable Nocturne", [
                "You chose a name around another person. Moonshadow would call that collateral. You did not.",
                "The Mirror has no column for a name whose worth points away from its holder, and tonight I find that I am glad of it."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enough. The Mirror answers now.", nextPage: 25 }
            ] },
            { ...storyPage("The Glass and the Notice", "The Mirror chamber, the black moon at zenith, Sable's shadow finishing its departure", "Kage Sable Nocturne", [
                "Enough. I close my books on time; it is the one virtue nobody ever had to buy from me. Forty years of being what no one could take, and here stands the last thing left to take, still answering to my name. I would hold every file again, friend, which is precisely the finding against me.",
                "The tank, the lease, and a village lit window by window below us, reading its own returned skin. Somebody decides tonight what safety costs here, and the buyer's escrow is already glowing.",
                "The Mirror holds everyone, %name. Everyone but you.",
                "And do not mistake what rises out of me for a god, when it rises. It is a collection process with a face, and the face is mine, because I held the account long enough for the account to learn me.",
                "Show me what a person is worth when nobody holds the receipt."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", leftName: "Player", rightName: "Kage Sable Nocturne", rightImage: "/portraits/kage-sable-nocturne-hollow.webp", choices: [
                { text: "Show her the better truth.", nextPage: 3, requireTrait: "ms88-better-truth-ready", forbidTrait: "ms88-nyx-proof-deferred" },
                { text: "Let Nyx say her own name.", nextPage: 9, requireTrait: "ms88-better-truth-deferred" },
                { text: "Let Iro read the buyer's manifest.", nextPage: 16, requireTrait: "ms92-witness-present" },
                { text: "Show her the lease breach.", nextPage: 17, requireTrait: "ms85-copied-the-blank-line" },
                { text: "Show her Nyx's file.", nextPage: 14, requireTrait: "ms88-player-still-holds-nyx-file", forbidTrait: "ms88-better-truth-ready" },
                { text: "Show her the return figures.", nextPage: 13, requireTrait: "ms88-return-proven", forbidTrait: "ms88-better-truth-ready" },
                { text: "Answer for the shelf. You've been paying its fee for seasons.", nextPage: 18, requireTrait: "ms58-took-the-shelf" },
                { text: "Answer for my file. I burned it in front of you.", nextPage: 19, requireTrait: "ms70-burned-the-file" },
                { text: "Answer for Nerissa Vale. Her name comes home tonight.", nextPage: 20, requireTrait: "ms88-nyx-proof-any" },
                { text: "Answer for the night name you would not write.", nextPage: 21, requireTrait: "ms70-night-name-refused" },
                { text: "Answer for the night name that is yours alone.", nextPage: 22, requireTrait: "ms70-night-name-claimed" },
                { text: "Answer for the leaf you tore out of your own file.", nextPage: 23, requireTrait: "ms70-night-name-stolen-back" },
                { text: "Answer for the night name you wrote to shield someone else.", nextPage: 24, requireTrait: "ms70-night-name-guardian" }
            ] },
        ], [
            { text: "Open the tank. Every held thing goes home, and the fires are ours to survive.", conclusion: "The glass parts like water deciding to be honest, and four hundred years of surrendered trust flows back down the tower into the village that grew around its absence: every confession, every name, every traded piece of everyone, home by dawn. Some of it burns; you knew it would; you chose a village that owns its own fires. The buyer's escrow lands on an empty tank. Sable attacks you weeping with relief, free of her lease at last.", trait: "honorable" },
            { text: "Seal the lethal tenth under a keeper the village may audit: you.", conclusion: "Nine parts in ten go home. The last tenth, the truths that kill on contact, you seal under a new covenant: held, but audited, by a keeper the whole market is entitled to question at noon in the open square, and the keeper is you, and the first audit is scheduled before the ink dries. It is the least monstrous version of her office ever designed, and it is still her office, and the weight of it settles on you like a coat you watched someone else wear for forty years. The glass accepts the arrangement. So, with a bow that costs her everything, does what is left of Sable, and then the Gate calls in what remains of her, and it does not bow.", trait: "merciful" },
            { text: "Take the Mirror's keeping. The circle needs a holder it can't price.", conclusion: "You put your hand on the glass and the tank recognizes, for the first time in four centuries, a keeper it cannot appraise: no price, no lien, no prior holder. The lease's enforcement grammar slides off you the way the Hunter slid off a free envelope. The buyer's escrow hangs, unexecutable, over an asset held by an unpriceable thing. Sable laughs once, low and real. 'The circle finally meets a blank line,' she says. 'Hold it, then. And learn what I learned: the tank keeps its keeper too.' The fire in her gives out, and what wears her rises.", trait: "loyal" },
        ]),
    ],
};

export function getCurrentStory(character: Character) {
    const storyLine = storylines[character.storyVillage || character.village] || storylines["Stormveil Village"];
    return storyLine[character.storyProgress] ?? null;
}
