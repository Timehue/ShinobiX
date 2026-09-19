/*
 * storylines — the per-village main-story arc, plus the helpers that
 * construct each milestone entry (storyPage, milestone) and the small
 * lookup tables they consume (bossScaleByLevel, kageLiberatorTitles,
 * villageBiomeMap, storyAiId).
 *
 * Pure data and pure transformations — no closures, no React, no side
 * effects. StoryStep + CreatorEvent live in types/vn so this large prose
 * module stays independent from the App component graph.
 *
 * Extracted from App.tsx.
 */

import type { CreatorEvent, StoryStep } from "../types/vn";
import type { Character } from "../types/character";
import { bossScaleByLevel, storyAiId } from "./story-boss-meta";
import { villageBiomeMap } from "./village-biomes";

// bossScaleByLevel + storyAiId now live in ./story-boss-meta and
// villageBiomeMap in ./village-biomes, so boot-path modules (lib/combat-ai,
// App.tsx) can read the compact facts without pulling this file's story prose
// into the entry chunk. Re-exported so lazy story-side consumers keep their
// existing imports. Boss names/icons in the milestone(...) calls below are
// parity-tested against story-boss-meta (data/story-boss-meta.test.ts) — if
// you rename a boss or add/move a chapter HERE, update VILLAGE_BOSSES there.
export { storyAiId, villageBiomeMap };

const kageLiberatorTitles: Record<string, string> = {
    "Stormveil Village": "Stormbreaker",
    "Ashen Leaf Village": "Root Liberator",
    "Frostfang Village": "Oathbreaker",
    "Moonshadow Village": "Moon Unmasked",
};

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
                "You're new. Stand over here. The ground on that side is wet, and those cables are live.",
                "I'm Mira. I take care of the rigging around the arena.",
                "That's the challenge board. Someone posts a grievance, someone else answers it, and everybody comes to watch. Afterward, if nobody is badly hurt, there's soup.",
                "The clerk will ask why you're fighting. Just tell him."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
            { ...storyPage("The Reason Line", "The board clerk's stand, a wet brush waiting", "Ledger Clerk", [
                "Your name first. Then tell me which bout you're answering.",
                "Now I need a reason. I write down whatever you say.",
                "You can take a minute if you need one.",
                "Why are you fighting?"
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "\"So nobody else has to.\"", nextPage: 2, trait: "sv4-post-protector" },
                { text: "\"To be the strongest name on this board.\"", nextPage: 3, trait: "sv4-post-strongest" },
                { text: "\"Someone owes me. I intend to collect.\"", nextPage: 4, trait: "sv4-post-debt" },
                { text: "\"I'm looking for someone. Fighting turns heads.\"", nextPage: 5, trait: "sv4-post-searcher" },
                { text: "\"I don't have a reason I can say.\"", nextPage: 6, trait: "sv4-post-unknown" }
            ] },
            { ...storyPage("A Shield Reason", "The clerk's stand", "Ledger Clerk", [
                "So nobody else has to. All right.",
                "You're posted, %name. Welcome to Stormveil.",
                "Then keep your guard up. I don't want to write anybody on the injury line tonight."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("A Ladder Reason", "The clerk's stand", "Ledger Clerk", [
                "The strongest name on the board. You're not the first to say it.",
                "You're posted, %name. Welcome to Stormveil.",
                "Good luck. You'll need some."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("A Debt Reason", "The clerk's stand", "Ledger Clerk", [
                "Someone owes you. Fine. I don't need the rest.",
                "You're posted, %name. Welcome to Stormveil.",
                "If you change your mind, tell me before the bout, not during it."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("A Searching Reason", "The clerk's stand", "Ledger Clerk", [
                "Looking for someone. I hope this gets their attention.",
                "You're posted, %name. Welcome to Stormveil.",
                "What you say to them is your business."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Step back from the board.", nextPage: 7 }
            ] },
            { ...storyPage("A Blank Reason", "The clerk's stand", "Ledger Clerk", [
                "You can't say. All right. I'll leave it blank.",
                "The board allows that, even if the odds-runners don't like it.",
                "You're posted, %name. Welcome to Stormveil."
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
                "Leave the clerk alone. He didn't do it.",
                "I'm Vanta. I've watched this board a long time. I've seen it lose a name twice before.",
                "Both times, something bad followed. I don't know if that means anything yet.",
                "Go take your bout. I'll look into this."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp", choices: [
                { text: "Walk to the arena floor.", nextPage: 9 }
            ] },
            { ...storyPage("The First Bout", "The arena floor, chalk dust, the crowd leaning in", "Mira Volt", [
                "Rules, fast. First yield or first fall. No edges on a first bout. The bell starts it and the bell ends it, and everything between the bells is yours.",
                "That scout has taken a hundred first-timers apart, so the odds-runners have you long. Don't take it personally. Take it as room to surprise people.",
                "One more thing. The crowd gets loud, especially when you're losing. Keep your eyes on the scout. You can argue with the spectators afterward.",
                "Bell's up. Go."
            ]), image: "/scenes/story/story-stormveil-village-4-0.webp" },
        ], [
            { text: "Move on the bell. Make the first attack.", conclusion: "You cross the chalk before the bell's echo dies, and the crowd loves you instantly, at least until the next odds shift. The scout catches your first strike an inch from his jaw and grins. Somewhere above the rim, thunder answers the bell, one beat early.", trait: "reckless" },
            { text: "Circle him. Watch the feet, not the hands.", conclusion: "The scout feints twice, but his weight shifts back only when he means to strike. You watch his feet and move as he commits. At the rail, Mira leans forward to see whether you can get past his guard.", trait: "suspicious" },
            { text: "Tell the clerk to raise the purse first.", conclusion: "The crowd howls with delight at the nerve of it, and the odds swing hard while the clerk chalks a fatter line. Win or lose, you just taught the whole rim your name. The board, notably, spells it right this time.", trait: "ambitious" },
        ]),
        milestone("Stormveil Village", 15, "The Riot Bell", "Tempest Guard Captain", "⚡", [
            { ...storyPage("The Market Breaks", "The market square mid-riot, stalls going over, the riot bell hammering", "Mira Volt", [
                "Stay on the wall side. Don't swing unless something swings at you.",
                "This didn't spread from one fight. Everybody started at once.",
                "That's Besh with the crate. He sells buttons. I've never seen him hit anybody.",
                "Get him to look at you. Ask him what's wrong."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("The Empty Why", "A cornered stall, a button-seller with bleeding knuckles", "Narrator", [
                "You catch the button-seller's arm mid-throw and turn him. His eyes take a moment to find you, like a man surfacing from deep water.",
                "You ask him why. He opens his mouth to tell you.",
                "He cannot answer. He looks from his bleeding knuckles to the crate in his hands, suddenly bewildered.",
                "'I had it,' he says. 'A minute ago I had it.'"
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("The Kage in the Square", "The square, a big man walking into the riot unarmed", "Kage Raiko Veyr", [
                "Enough. Put it down. All of you.",
                "Besh, drop the crate. Mara, your daughter is by the well. Go check on her. If you can't remember why you're fighting, stop until you can.",
                "Is anyone badly hurt? No? Good. Get some water over here.",
                "You. The newcomer. You went in without a weapon and talked to him. I noticed."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("After the Kage", "The square's edge, Raiko moving crowd to crowd, beloved", "Mira Volt", [
                "That's Raiko Veyr. He knows everybody, and everybody trusts him. I do too. Most of the time.",
                "Now look at this before the Guard takes it.",
                "It's a riot order with today's date and the Kage's seal. The route around the market was drawn in advance.",
                "Somebody planned this. I want to know why."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp", choices: [
                { text: "The Guard closes the square.", nextPage: 4 }
            ] },
            { ...storyPage("Booked Guilty", "The square gates chained, the Tempest Guard forming a line", "Tempest Guard Captain", [
                "By order of the tower: the square is closed. Everyone inside is booked for riot. Names to the clerk, marks on the slate, fines by the door. No exceptions.",
                "Yes, including the wounded. The wounded can bleed in a line like everyone else.",
                "The button man goes in the wagon. He can't state his own business. That's public disorder twice over.",
                "You have a problem with the process, new blood, you know where the board is. Post it."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
            { ...storyPage("The Captain's Line", "The wagon, Besh looking small between two guards", "Narrator", [
                "The wounded man by the well can't walk. The wagon has room for one more, and the Captain is deciding whether it's the wounded man or the button-seller who can't remember his own anger.",
                "Mira is already coiling a cable around her fist, which is how she argues.",
                "The riot bell has stopped. The square is very quiet, the way the arena gets between the bell and the first blow."
            ]), image: "/scenes/story/story-stormveil-village-15-1.webp" },
        ], [
            { text: "Stand over the wounded man. He is not walking, and he is not booked.", conclusion: "You step between the wounded man and the guards. The Captain leaves the arrest slate with the clerk and draws his weapon. He means to take the man unless you stop him.", trait: "merciful" },
            { text: "Challenge the Captain, by name, in the open square.", conclusion: "The oldest law in Stormveil: a posted challenge outranks a booking. The crowd chalks it on the nearest wall before the clerk can even arrive. The Captain takes off his cloak, folds it, and says he was hoping somebody would do this, and the square becomes an arena, because here it always was one.", trait: "reckless" },
            { text: "Hold up the tallied order. Ask, loudly, who counts riots before they happen.", conclusion: "The square goes still. The Captain reads the route lines, the wax, the tally marks, and for one long moment he is a man looking at his own orders and not liking their handwriting. 'Booking stands,' he says. He folds the order into his own coat, then signals the arrest himself.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 25, "Orders Written in Lightning", "Lightning-Sealed Informant", "⚡", [
            { ...storyPage("The Lifted Scroll", "Mira's rooftop, rain coming, a stolen scroll between you", "Mira Volt", [
                "I took it from a Guard clerk. He thinks he lost it during the riot.",
                "The tower wax is real. The route was drawn a week early, and there are eleven marks down the side.",
                "I don't know what the marks mean. I do know somebody had the market surrounded before the first punch.",
                "My mother would have called that laundering. Make a mess, then hide what you took inside it."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
            { ...storyPage("The Name on the Board", "The rooftop, wind pulling at an old slate Mira keeps wrapped in oilcloth", "Mira Volt", [
                "There's something else. I don't show this to many people.",
                "Kesa Volt. My mother. Cable rigger, best on the coast. Dead six years. And her grudge is still posted on the board, still drawing odds, still scheduled twice a season against a man who is also dead.",
                "The clerks call it an estate bout. I don't care what they call it. She's dead. He is too.",
                "I asked the tower to remove it. They said the account was still active. I haven't asked again."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Show her the Red Tally token from the border. Same tick marks.", nextPage: 2, requireTrait: "rd22-showed-the-token" },
                { text: "\"Take the scroll to Vanta. He reads boards better than anyone.\"", nextPage: 3 }
            ] },
            { ...storyPage("The Same Hand", "The rooftop, the lead token flat on the scroll", "Mira Volt", [
                "Where did you get that? Tell me on the way. We're going to Vanta.",
                "Same tick marks. Same line under the count. Your border fire and my market riot, added up by the same hand.",
                "This isn't only happening here.",
                "Bring the scroll. Step where I step. Some of these roofs are rotten."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Cross the roofs to Vanta.", nextPage: 3 }
            ] },
            { ...storyPage("Vanta Reads the Wax", "Vanta's rail-side shack, purse ledgers stacked to the ceiling", "Elder Vanta", [
                "Close the door. The rain's getting in.",
                "The wax is real. So is the order. Somebody arranged the riot, then took something from the people in it. I've suspected that for years. I never had proof.",
                "The eleven marks are an intake count. I think they took eleven reasons. I can remember every purse I've paid, but ask any fighter why they were angry the next morning and most of them can't tell you.",
                "There's a shaft under the arena. Kesa knew about it. She tried to tell me, and I laughed at her."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp", choices: [
                { text: "Someone is on the roof.", nextPage: 4 }
            ] },
            { ...storyPage("The Listener", "The shack, rain starting, a shape on the skylight", "Narrator", [
                "The skylight creaks under someone's weight.",
                "Vanta doesn't look up. He slides the scroll under a purse ledger with a bookmaker's smoothness and says, louder than he needs to, that the rain is early this year.",
                "Through the glass, backlit by the first lightning, you can see the listener's hands moving. Tick, tick, tick. Counting the room.",
                "'That one is sealed to the tower,' Vanta says quietly. 'Lightning-sealed. You can't out-talk it. Decide what it takes back with it.'"
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
            { ...storyPage("Sealed and Sent", "The rooftops in the rain, the informant between you and the tower", "Mira Volt", [
                "It saw us with the scroll. If it reaches the tower, they'll know where we took it.",
                "We can cut it off on the next roof. The rain should cover our footsteps.",
                "Whatever you do, do it before the next lightning. It counts by the flashes. I watched it do it.",
                "Go."
            ]), image: "/scenes/story/story-stormveil-village-25-2.webp" },
        ], [
            { text: "Force it away from the maintenance stair. Get a look down the shaft.", conclusion: "You race toward the maintenance stair and pull the hatch open. A deep vibration rises from below. Before you can descend, the informant lands between you and the opening. Mira reaches the hatch as it turns to attack.", trait: "reckless" },
            { text: "Put the scroll in Vanta's hands and stand between him and the seal.", conclusion: "Vanta folds the scroll into his ledgers, where one more page among ten thousand becomes invisible, and you plant yourself on the wet slate between the old man and the thing with counting hands. 'You're insane,' Mira says, taking your flank. 'Good. Stay that way.'", trait: "honorable" },
            { text: "Copy the tally. Burn the rest, and let it watch you do it.", conclusion: "You chalk the eleven marks onto your own slate while the original curls in the rain barrel. The sealed thing abandons the ash and reaches for the only copy left. If the tower wants the count now, it has to take it from you.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 35, "The Storm Engine", "Storm Engine Warden", "⚡", [
            { ...storyPage("Down the Well That Isn't", "The maintenance shaft under the arena, rungs slick, a hum below", "Mira Volt", [
                "Loose rung at the third landing. Vanta, are you still with us? Say something.",
                "That vibration is coming from below. I've felt it in the roof cables for years. I thought it was the wind.",
                "I was wrong.",
                "Keep the lamps low. Don't touch anything until we know what it is."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("Eleven Pipes", "The engine floor: eleven great pipes running from the arena floor overhead into a banked crystal reserve", "Narrator", [
                "The arena is directly overhead. You can hear tonight's crowd through the stone, a heartbeat of stamping feet.",
                "Eleven pipes run from the arena floor to the crystal reserve. Light pulses down them in a steady flow.",
                "Along the wall hang maintenance rotas, a mop, a kettle. Somebody works here on a schedule, and somebody always has. The rota nail-holes climb the wall like tide marks.",
                "The reserve is the size of a house. Its crystals glow almost to the top of the fill gauge."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("The First Storm", "An alcove off the engine floor, founders' slates behind wax", "Elder Vanta", [
                "Before you decide what this place is, read one of these.",
                "This says, 'My feud with Harn's line, thirty years and both our fathers. Given to the sky, gladly, so my sons fight nothing but weather.' He signed it. Someone witnessed it.",
                "That was the original bargain. The Engine took the reason behind a feud and turned it into power for the village's storm shield.",
                "The founders volunteered. The pipes above us do not ask today's fighters. The board keeps a grudge open until there is nothing left to take."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp", choices: [
                { text: "Ask Mira what her mother knew about this place.", nextPage: 3, requireTrait: "mira-trust" },
                { text: "Read the chalked figures at the pipe junctions.", nextPage: 4 }
            ] },
            { ...storyPage("Kesa's Whisper", "The alcove, Mira's lamp low", "Mira Volt", [
                "I never told you everything about my mother.",
                "She came down here. I'm sure of it. After my father drowned, she started drawing anchors on the high ridge. Nobody understood what she was trying to build.",
                "She posted her grievance, and after that they scheduled her every season. She got quieter each time. I thought she was getting better.",
                "They were taking it from her.",
                "Then she died, and they left her name on the board."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp", choices: [
                { text: "Something moves by the reserve.", nextPage: 4 }
            ] },
            { ...storyPage("The Warden of the Reserve", "The engine floor, a founders' construct unfolding from the pipework", "Narrator", [
                "It stands up out of the pipework the way a rigger stands up out of a hammock: unhurried, at home, enormous.",
                "A plate on the construct identifies it as the Storm Engine Warden. Its inspection dates go back four hundred years.",
                "Its post was to check what comes in. It holds a slate, and on the slate is one question, worn nearly smooth by centuries of asking: STATE YOUR REASON.",
                "Vanta states forty years of guilt, and it lets him stand. Mira states her mother's name, and it bows its head an inch.",
                "Then it looks at you. Whatever it expects to find where your reason should be is missing. Its stance changes to the one shown on the older, sterner slates."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
            { ...storyPage("State Your Reason", "The engine floor, the Warden between you and the reserve", "Elder Vanta", [
                "It isn't angry. It's following old instructions.",
                "It can't read you, and it doesn't know what to do with that.",
                "Raiko probably knows we're here. Whatever you decide, decide now.",
                "Here it comes."
            ]), image: "/scenes/story/story-stormveil-village-35-3.webp" },
        ], [
            { text: "Tell the Warden you're here to stop the Engine taking people's reasons.", conclusion: "You tell the Warden why you came. Writing flickers across its slate, but no answer settles into place. It lowers the slate and advances. Above you, the crowd keeps stamping as light pours through the pipes.", trait: "honorable" },
            { text: "Go for the reserve's bank, now, while it's mid-question.", conclusion: "You climb over the pipework toward the reserve. Mira shouts for you to stop. The crystals flare and an alarm sounds; the Warden turns to block your way.", trait: "reckless" },
            { text: "Read the chalked figures at the junctions first. All of them.", conclusion: "Draw rates, junction by junction, in a maintenance hand: the intake has doubled every decade and the outflow to the storm shield has not risen in forty years. The surplus is going somewhere with no chalk line to it. You memorize the whole count while the Warden closes, and Vanta whispers that you read figures like a man he used to be afraid of.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 50, "Jonin of the Unchained Sky", "Jonin Rank Trial: Twin Tempest Duelists", "⚡", [
            { ...storyPage("The Rite of the Posted Rival", "The arena at noon, banners up, the board scrubbed clean for the rite", "Ledger Clerk", [
                "Stand on the chalk, face the board. This is the part of the rite everyone's family comes to see, so smile, or at least stop looking like weather.",
                "Jonin of Stormveil post a lifetime rival. One name, on the board, forever. The village watches your whole career against one other name. It's how we make ambition public and keep it honest. That's the speech, anyway.",
                "The board never forgets a posted name. Whatever else you hear today, that part is true.",
                "The Kage is here. He posts the rite bouts himself. Try not to say anything I'll have to chalk."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp" },
            { ...storyPage("Raiko's Dare", "The rite chalk, Raiko grinning like the whole village's uncle", "Kage Raiko Veyr", [
                "There's my riot-stopper. Still in one piece after that business under the arena? Good. I'd prefer to promote you before you get yourself killed.",
                "Now. The rival line. Most people post a training mate, someone safe. A rivalry you can have soup with after. Nothing wrong with that.",
                "But you've been under my arena, so let's be adults. You want to post a name that means something? Post mine. Raiko Veyr, right there on the slate. I'll even hold the brush.",
                "Careful, though. A posted grudge is a lifetime account here. Ask yourself who profits from holding yours open, and then ask why I'm smiling."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Ask where the surplus in Vanta's copied junction figures goes.", nextPage: 2 },
                { text: "Answer the dare at the board.", nextPage: 3 }
            ] },
            { ...storyPage("The Missing Chalk Line", "The rite chalk, the crowd noise far away for a moment", "Kage Raiko Veyr", [
                "Vanta copied the numbers. Neither of you was supposed to see those.",
                "I'm not going to lie to you. The surplus goes up the hill. There's an old debt tied to this seat, and every Kage inherits the payment schedule.",
                "I keep the withdrawals small. Nobody has died in a grudge fight in thirty years, and the storm shield still works. I know what that has cost people. I made the choice anyway.",
                "You want to know what I get from the seat? I hear every voice in that crowd, all the time. Now finish the rite."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Walk back to the board.", nextPage: 3 }
            ] },
            { ...storyPage("Supply Lines", "The board's shadow, Mira pretending to check a cable anchor", "Mira Volt", [
                "Don't write his name. Please.",
                "I know why you want to. You want the real fight where everyone can see it. But the board will keep scheduling it for the rest of your life.",
                "My mother told the truth once. They used it for six years.",
                "Leave the slate empty if you have to. People will call you a coward. You'll live."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp", choices: [
                { text: "Take the brush.", nextPage: 4 }
            ] },
            { ...storyPage("The Twin Tempest", "The rite floor, two duelists uncoiling like paired lightning", "Narrator", [
                "The Twin Tempest Duelists step onto the trial floor. They have fought together for decades. Each time one changes position, the other moves to cover them.",
                "The crowd quiets as the duelists take their starting positions.",
                "At the rail, Raiko holds the brush he offered you, still smiling, watching what you do with your slate more closely than he will watch the fight.",
                "The bell is up."
            ]), image: "/scenes/story/story-stormveil-village-50-4.webp" },
        ], [
            { text: "Take the trial with an empty rival line. Refuse to post at all.", conclusion: "You leave the slate blank in front of the whole village. The clerk's brush hovers. Raiko's smile goes somewhere private. With no account to announce, the bell names only the Twin Tempest. They bow together and cross the chalk toward you.", trait: "honorable" },
            { text: "Write Raiko's name on the board.", conclusion: "The crowd's roar knocks birds off the tower. RAIKO VEYR fills the slate as a lifetime rivalry, and eleven pipes lean toward the fresh account below. Raiko laughs, keeps hold of the brush, and rings the Twin Tempest into your trial himself.", trait: "reckless" },
            { text: "Post a rival who died years ago. Watch what the board does.", conclusion: "You post a dead name. The board accepts it without checking the living register and begins chalking schedules beneath it. Mira goes pale. Now you both know how her mother's line kept fighting. The Twin Tempest steps between you and the board before you can erase the test.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 65, "The Mission That Should Not Exist", "Tempest Execution Squad", "⚡", [
            { ...storyPage("The Ravine Order", "The tower gatehouse, an order with fresh wax and no clerk's initials", "Tempest Guard Captain", [
                "Jonin. I have an order from the tower, and I don't like it.",
                "There's a camp in the north ravine. About forty people. They're charged with treason because they refuse to post their grievances on the board.",
                "An execution squad left an hour ago. You're listed as the ranking witness.",
                "At the market, I enforced the arrests even though people were hurt. This morning I wrote a protest to this execution order and didn't send it. I'm telling you now because you can still reach the camp before the squad."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Ask what the order's pay line says. You know the shares now.", nextPage: 1, requireTrait: "sv58-refused-the-ninth" },
                { text: "Go north ahead of the squad.", nextPage: 2 }
            ] },
            { ...storyPage("The Ninth Share", "The gatehouse, the order flat between you", "Tempest Guard Captain", [
                "The pay line? All right. Look.",
                "There are nine shares. Eight go to the squad. The ninth is marked like the elders' cut, with a quartered circle beside it.",
                "That share was set aside for you before you accepted the order.",
                "You can beat them there by half a bell. Use it."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Ride north.", nextPage: 2 }
            ] },
            { ...storyPage("The Camp That Keeps Its Anger", "The ravine camp: cook fires, mended tents, slates nailed to posts with reasons written large", "Rebel Medic", [
                "Stop there. I can see the village crest. If the tower sent you about the board, you've found the right camp.",
                "Yes, we refuse to post. My sister was arrested in a riot four years ago. She came home and couldn't remember why she'd left her husband.",
                "So we argue in private. We lose sleep. Sometimes we stay angry for years. At least the anger is ours.",
                "Once a season we intercept a cart of confiscated slates headed for the shaft. We keep them here because most of the owners no longer remember what was taken."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
            { ...storyPage("The Rescued Slates", "A dry cave wall racked with hundreds of confiscated reason-slates", "Mira Volt", [
                "You ride too fast. I almost lost my horse trying to catch you.",
                "Look at these. Weddings, land disputes, family fights. This one belonged to a child. Nine years old.",
                "Wait.",
                "This is my mother's handwriting. It's her grievance. And these are the ridge plans. I thought they were gone."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp", choices: [
                { text: "Wrap Kesa's grievance and maps. They leave this ravine with you.", nextPage: 4, trait: "sv65-saved-the-reason" },
                { text: "Give Mira her mother's grievance and plans.", nextPage: 4, trait: "sv65-gave-mira-the-page" },
                { text: "Leave the grievance and plans in the camp's care.", nextPage: 4, trait: "sv65-resealed-the-cart" }
            ] },
            { ...storyPage("Eight Riders", "The ravine mouth, dust rising on the valley road", "Rebel Medic", [
                "Eight riders on the road. Tower gray.",
                "There are children and old people here. Four of us can fight, and one of those four has a broken wrist.",
                "You reached us first. That has to mean something.",
                "Are you helping us or not?"
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
            { ...storyPage("The Ranking Witness", "The ravine mouth, the squad dismounting with ceremony", "Narrator", [
                "The squad forms up with the unhurried confidence of people who have done this before and been thanked for it. Their leader carries the order like a shield.",
                "Behind you, the camp bangs pots and herds children toward the caves, and a nine-year-old's rescued slate swings on the rack in the wind.",
                "The order names you ranking witness. That means the squad, the camp, and every child behind you are waiting on your word.",
                "The medic was right. Say it fast."
            ]), image: "/scenes/story/story-stormveil-village-65-5.webp" },
        ], [
            { text: "Get between the squad and the tents. The order dies here.", conclusion: "You block the road with your rank. The leader says eight paid shares outweigh one witness who cannot hold the road. The medic steps beside you and names the wounded people the squad left at the well. Three soldiers lower their eyes. The leader does not. He draws, and the rest follow.", trait: "merciful" },
            { text: "Take the camp's surrender. Loudly. On your record, on your terms.", conclusion: "You claim custody in a voice that carries down the ravine, under your seal and pending your report. The leader objects that the tower's execution writ outranks a field arrest. The camp medic spits at your boots, then produces the rescued slates and demands they be entered as evidence. With the squad's clean withdrawal gone, its leader orders the arrest challenged by force.", trait: "honorable" },
            { text: "Signal compliance. Then walk the squad into the wrong ravine.", conclusion: "You confirm the order and point the squad toward a scree fork while the camp starts striking tents behind you. Their leader checks the route against fresh tower wax and catches the false turn. Nobody wants to lose a paid share or explain an empty ravine. He blocks the path and draws before your delay can become an escape.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 75, "Kesa's Bout", "Mira Volt, Estate Bout Rigger", "⚡", [
            { ...storyPage("The Estate Closure", "The board at dawn, a new slate in the estate column, Mira staring at it", "Mira Volt", [
                "They posted this this morning.",
                "It's a closure bout for my mother's account. Because I'm her daughter, I have to fight it.",
                "They matched me with you. Three days from now, main card.",
                "I was going to leave. I'm not leaving. I have a plan, and I need you to listen before you tell me it's a bad one."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "\"You read the routing mark on my fixed bout. Read this one.\"", nextPage: 1, requireTrait: "sv70-read-the-mark" },
                { text: "Hear the plan on the roof.", nextPage: 2 }
            ] },
            { ...storyPage("The Routing Mark", "The board, Mira's finger under the slate's corner", "Mira Volt", [
                "Look in the corner. It's the same routing mark that was on your bout. I learned how to read it.",
                "They already filed the result. I'm supposed to lose in the fourth exchange, and the account closes at maximum draw.",
                "They picked the moment I'm supposed to break down.",
                "Meet me on the roof. Please."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Up the cable run.", nextPage: 2 }
            ] },
            { ...storyPage("Storm Rules", "Mira's rooftop, the plan chalked on slate, her hands steady", "Mira Volt", [
                "Don't repeat this to anyone.",
                "We can't stop the bout. But founders' law says a closure ends if the account holder's reason is spoken and settled. The rule is still on the oldest slate.",
                "I've read my mother's reason enough times to know it by heart.",
                "We fight for real. In the fourth exchange, I stop and read it. You keep the officials away from me until I'm done. If the rule still means anything, her account closes and her reason stays with me. Are you in?"
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp", choices: [
                { text: "Three days pass. The bell.", nextPage: 3 }
            ] },
            { ...storyPage("Main Card", "The arena floor, the estate slate hung over the bell, the crowd enormous", "Narrator", [
                "They hang the estate slate above the bell where everyone can read it: KESA VOLT, CLOSURE. The odds say you beat Mira. They say her grief beats you both.",
                "Mira stands across the chalk from you, wearing her mother's rigging gloves, and under the crowd noise she mouths the plan's last line: fight me true, and when I raise my hand, hold the ring. Don't let them stop me when I speak.",
                "Under the sand, faint as a held breath, the seams begin to glow before the first exchange. The board does not care whether tonight's grief is honest. Honest grief has always been its best draw. It has waited six years for this one.",
                "The bell is up, friend."
            ]), image: "/scenes/story/story-stormveil-village-75-6.webp" },
        ], [
            { text: "Fight her true, and guard the moment she stops to speak.", conclusion: "You meet Mira honestly, exchange for exchange, while the seams brighten under your feet. On the fourth, she raises one rigging glove. The nearest clerk steps onto the chalk before she can read Kesa's grievance. You turn to hold the ring. Mira draws breath behind you.", trait: "loyal" },
            { text: "Tear the estate slate off the board mid-bout, in front of everyone.", conclusion: "You break from the exchange and run the rail for KESA VOLT. The crowd rises. Clerks rush the board. Mira follows with both gloves up. Founders' law may void a torn posting, but first you have to reach it through everyone paid to keep it hanging.", trait: "reckless" },
            { text: "Buy the account. Purse, odds, and the estate's debt, in your name.", conclusion: "You invoke the old rule that lets an open account be purchased and put your own name against Kesa's debt. The clerk hesitates with the transfer brush above the slate. Mira stops across the chalk, waiting to see whether you mean to free her mother's reason or own it. The officials close around the unratified sale.", trait: "ambitious" },
        ]),
        milestone("Stormveil Village", 85, "The Kage's True Storm", "Hollow Tempest General", "⚡", [
            { ...storyPage("Fees Waived", "The square under a bruise-green sky, clerks posting free bouts as fast as chalk allows", "Tempest Guard Captain", [
                "The tower waived every posting fee at dawn. The line reaches around the square, and the clerks are running out of slate.",
                "I've watched this sky for thirty years. I've never seen it turn like that.",
                "Raiko knows the bouts feed the engine. If he wants this many at once, the tower is trying to pay something tonight.",
                "I sent a report saying the order was wrong. I should have done that years ago."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
            { ...storyPage("The Balloon Payment", "The rail, Harrow with a valise and no intention of staying", "Kite Harrow", [
                "I was looking for you. I'm leaving tonight, so listen.",
                "Your engine is one of four feeding the same reserve. Fire, frost, moon, and storm. I saw the payment order. The entire reserve comes due tonight.",
                "Raiko is filling it with every grievance he can get. It still won't be enough. The debt was designed that way.",
                "The surge valve is in the square, under that armored thing. Cut the square off from the engine and you can interrupt the payment."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "\"Stay. Hold the coast gate open tonight. I'll owe you.\"", nextPage: 2, requireTrait: "sv80-pulled-her-back" },
                { text: "Head for the square.", nextPage: 3 }
            ] },
            { ...storyPage("The Anomaly, Again", "The rail, Harrow looking at her own valise like it betrayed her", "Kite Harrow", [
                "Stay? In that weather? For a favor?",
                "You helped me once and asked for nothing. Fine. The coast gate stays open, and anyone who wants out gets out.",
                "After this, we're even.",
                "Go. I'll keep the door open."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "Head for the square.", nextPage: 3 }
            ] },
            { ...storyPage("The Rigger's Answer", "A rooftop over the square, cables everywhere, Mira already working", "Mira Volt", [
                "Hold this turnbuckle steady while I tighten the cable. Use both hands. Good.",
                "I'm not leaving. My mother drew those ridge anchors for a storm like this. I'm going to finish the work.",
                "The General is standing over the surge valve. Get it away from there. I'll handle the cables.",
                "If her account still sits under your name, don't mistake this for settling who owns it. But you kept it out of the floor tonight. Thank you for that. Now go."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "The tower door stands open.", nextPage: 4 }
            ] },
            { ...storyPage("The Weather Ledger", "Raiko's office, storm maps and a lifetime of bout slates, the Kage watching his sky", "Kage Raiko Veyr", [
                "Come in. I expected you'd want an explanation. Sit if you like. I've been standing here watching that sky all morning.",
                "Before you say it, remember two numbers. The Split-Sky year killed sixty people. Floods and lightning took the low market in an hour.",
                "In my first year as Kage, I used the reserve to stop another storm like it. No one here has died from weather in thirty years. That is why I kept the Engine running.",
                "Hollow Gate takes the reserve when the payment comes due. Unless I refill it, there will be nothing left to power the shield. That's why I waived the posting fees. I need more bouts before the storm reaches us.",
                "Show me another way to keep the roofs standing through that storm, and I'll close the intakes myself. I mean it. But I need something that works, not a promise to the people sheltering under them."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp", choices: [
                { text: "The square. The General.", nextPage: 5 }
            ] },
            { ...storyPage("The Surge Valve", "The square, the Hollow Tempest General planted like a monument, sky turning", "Narrator", [
                "The Hollow Tempest General does not patrol. It stands where the pipes meet, hands folded on its warhammer, and the ground under it breathes light in slow pulls: the payment, gathering.",
                "Around the square's rim the whole village is posting, queuing, betting, feeding, under a sky that has begun, very gently, to rotate.",
                "The Captain arrives with thirty guards, though nobody sent for them. Above the square, Mira's new cables pull taut. The General moves its hammer across the valve.",
                "The General turns toward you and raises its hammer. You will have to get past it to reach the valve."
            ]), image: "/scenes/story/story-stormveil-village-85-7.webp" },
        ], [
            { text: "Rally every rim of the square to one banner before you swing.", conclusion: "You call for everyone to stop the bouts and clear the ring. The Captain orders his guards to help, and the odds-runners pull people out of the queues. The light under the square fades. The General raises its hammer as you approach the valve.", trait: "loyal" },
            { text: "Walk into the square alone and take the General now.", conclusion: "No speech. You walk the open chalk with the whole village watching and hit the monument where it stands. The crowd's roar drowns the storm bell, the odds-runners tear up their slates, and the payment stutters as its valve is forced to defend itself. Somewhere above, the sky forgets its rotation for one full breath.", trait: "reckless" },
            { text: "Shear the junction cables feeding the square first.", conclusion: "Mira's maps in your head, you take the junctions in order, fast, while the queues still think you're a maintenance run. By the time the General understands the valve under it has gone quiet, the square is off the grid and the payment is coming up short exactly as an appraiser predicted. Uphill, an automated collection ledger records the shortfall.", trait: "suspicious" },
        ]),
        milestone("Stormveil Village", 100, "Break the False Thunder", "Kage Raiko Veyr, Hollow Storm Tyrant", "⚡", [
            { ...storyPage("The Village Climbs", "The tower road at dusk, the whole village walking up to watch", "Narrator", [
                "Word went out at noon bell, no one knows from whom: the last bout is tonight, at the top, and everyone is invited.",
                "So Stormveil climbs. Soup carts and grandmothers, odds-runners with nothing chalked, the Captain in his best coat, the camp come down from the ravine carrying their slates like lanterns.",
                "At the tower gate, for the first time in anyone's memory, the betting window is shuttered. A hand-lettered sign says: NO ODDS POSTED ON THIS ONE.",
                "The board at the base of the tower is blank, and it is humming, and on the top step sits a bowl of soup going cold, with a note under it in a big cheerful hand: 'You'll fight better fed. R.'"
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp" },
            { ...storyPage("At the Gate", "The tower gate, Mira with her mother's gloves tucked in her belt", "Mira Volt", [
                "I know. Past the gate, it's only you and him. I'll stay here.",
                "I checked the exits. Both are clear if this goes badly. The boat is still there too, but I'm not taking it.",
                "If the sky comes apart, I can hold the ridge line. Go deal with Raiko.",
                "Come over for soup afterward. I'm serious."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Climb to the storm floor.", nextPage: 2 }
            ] },
            { ...storyPage("The Drain Speaks", "The storm floor, open to the rotating sky, Raiko at the rail", "Kage Raiko Veyr", [
                "You're on time.",
                "Before we fight, I'll answer one question. The debt above this village is called the Hollow Gate. There are four seats tied to it, one for each village. I don't know what the others were promised. I know what I was promised.",
                "Quiet. One hour a day when I don't hear every grievance in Stormveil. It sounds small. It isn't. I have done terrible things to keep that hour.",
                "Kesa Volt's grief fed the shield for six years. I knew. I let it happen, and I sent what the shield didn't use up the hill.",
                "That's the answer. If you have another question, ask it now."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp" },
            { ...storyPage("The Man Becoming Weather", "The storm floor, lightning walking Raiko's shoulders like gulls", "Kage Raiko Veyr", [
                "You're looking at the lightning. I can feel it too.",
                "It started a few years ago. I lose my temper at doors, at the sea, at people who aren't there. Last week I broke a mirror and couldn't remember doing it.",
                "The engine is changing me. I knew it would. I thought I had more time.",
                "That's enough talking. The payment is due, and the board is blank. Step forward."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Step onto the storm floor.", nextPage: 19 }
            ] },
            { ...storyPage("The Quiet Storm", "The storm floor, Kesa's cable maps unrolled on the rail", "Kage Raiko Veyr", [
                "Let me see that. Hold it down.",
                "This is Kesa Volt's ridge line. It crossed my desk twelve years ago. The council called it grief, and I signed the refusal.",
                "You built it? The Low Terraces made it through the first arm with the engine off?",
                "All right. Show me exactly what happened."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "\"Three hundred roofs. One district. Engine cold. And the district saw it hold.\"", nextPage: 5, requireTrait: "sv88-woke-the-district" },
                { text: "Open Vanta's storm log to the signed pages and read him every line.", nextPage: 6, requireTrait: "sv88-logged-the-storm" },
                { text: "\"Your own odds-runners moved the line. The board already believes it.\"", nextPage: 7, requireTrait: "sv88-baited-the-board" },
                { text: "Set the anchor splice on the rail and let the wind sing through it.", nextPage: 8 }
            ] },
            { ...storyPage("What the District Saw", "The storm floor, the Low Terraces' lamps visible far below", "Kage Raiko Veyr", [
                "Three hundred families saw it hold. I sent people down there to check because I didn't believe the first report.",
                "The engine was off. No intake at all.",
                "I can't dismiss that as luck."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He looks to the turning sky.", nextPage: 15 }
            ] },
            { ...storyPage("The Signed Log", "The storm floor, Vanta's log flat under Raiko's wide hand", "Kage Raiko Veyr", [
                "Give me the log.",
                "Wind load at the anchors. Nothing drawn at the junctions. Roof counts every hour. Vanta signed every page?",
                "Damn him.",
                "No. I'm not arguing with the figures. They hold."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He sets the log down.", nextPage: 15 }
            ] },
            { ...storyPage("The Board's Own Odds", "The storm floor, a torn odds slate spinning in the wind between you", "Kage Raiko Veyr", [
                "I saw the odds change at dawn. I told myself a clerk had made a mistake.",
                "Then they changed again.",
                "The board expects the Low Terraces to survive without the engine. So do the people betting their own money.",
                "I understand what that means."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He lets the torn slate spin away.", nextPage: 15 }
            ] },
            { ...storyPage("The Splice", "The storm floor, the anchor splice knotted to the rail, holding", "Kage Raiko Veyr", [
                "That's her splice. I remember it from the plans.",
                "It held through the first arm?",
                "I signed those plans away without leaving my desk.",
                "Put it here. I want to see the knot."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He rests two fingers on the splice.", nextPage: 15 }
            ] },
            { ...storyPage("Her Daughter Says the Why", "The gate stair door banging open, Mira crossing the storm floor", "Mira Volt", [
                "%name, step back. I need to do this myself.",
                "Her name was Kesa Volt. She was my mother. Your board used her grief for six years and kept using her name after she died.",
                "She wrote down her reason. I'm going to read it."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Let her say the why.", nextPage: 10 }
            ] },
            { ...storyPage("The Reason, Kept", "The storm floor, Mira reading from a slate that never reached the shaft", "Mira Volt", [
                "'I am angry because I warned the council the low moorings would fail, and they laughed, and my husband drowned at the low moorings. I am angry because my grief was posted as entertainment. I am angry because anger is all of him I have left, and this village keeps trying to collect it.'",
                "That's what she wrote.",
                "Her account is closed. You're not taking anything else from her."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "The Kage looks at the slate a long time.", nextPage: 11 }
            ] },
            { ...storyPage("The Bookmaker's Silence", "The storm floor, the wind oddly gentle for a breath", "Kage Raiko Veyr", [
                "I should have listened to her twelve years ago.",
                "I don't have a defense for that."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He looks at the slate a moment longer.", nextPage: 15 }
            ] },
            { ...storyPage("A Sky Without a Why", "The storm floor, the district's lamps below, the maps not in your hands", "Kage Raiko Veyr", [
                "The Low Terraces held. I can see that.",
                "But you haven't shown me the design or told me who made it. I don't know if it can protect the rest of the village.",
                "One district surviving one night is not enough for me to shut down the engine.",
                "Bring me the rest, or fight me."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He turns back to the storm.", nextPage: 19 }
            ] },
            { ...storyPage("The Answer in Your Kit", "Kesa's maps unrolled in Raiko's scarred hands", "Kage Raiko Veyr", [
                "These are Kesa Volt's plans. They're built, tested, and protecting three hundred eleven roofs.",
                "And you still have her reason in your coat.",
                "You found it in the ravine, carried it all this way, and never gave it to her daughter.",
                "Maybe you meant to keep it safe. So did I."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He rolls the maps with terrible care.", nextPage: 19 }
            ] },
            { ...storyPage("Vanta Opens the Books", "The storm floor, an old bookmaker setting ledgers on the rail one by one", "Elder Vanta", [
                "Move aside. I need to say this.",
                "These are my records, Raiko. Every bout I arranged and every share I took. I started matching the fights the tower requested thirty years ago.",
                "I knew the floor was taking something. I chose not to ask how much.",
                "Put my name beside yours. I helped you do it."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "He sets the last ledger down.", nextPage: 19 }
            ] },
            { ...storyPage("The Last Answer", "The storm floor, Raiko looking from the proof to the turning sky", "Kage Raiko Veyr", [
                "All right. Kesa's line can hold one district. I promised to close every intake if you proved that much.",
                "I hear the bell anyway. The other districts still need crews, cable, and shelter, and I still want the quiet hour. Last wager, then: if you want the board tonight, come take my side of it."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. The storm decides now.", nextPage: 19 }
            ] },
            { ...storyPage("Answer for the ninth share. You've been drawing it for seasons.", "The reckoning", "Kage Raiko Veyr", [
                "You took the elders' cut. Then you know how easy it is to accept the money and stop asking where it came from.",
                "Did you ever look at two angry people and think their fight would cover the month? I did.",
                "You carried that responsibility for two seasons. I've carried it for thirty years. That doesn't excuse me. It does mean I know how quickly a person gets used to it."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. The storm decides now.", nextPage: 19 }
            ] },
            { ...storyPage("Answer for the routing mark. My bout was written before I fought it.", "The reckoning", "Kage Raiko Veyr", [
                "The Pike bout was fixed. You were supposed to lose in the third exchange. I approved it.",
                "Your slate came back blank three times. A clerk was punished because I assumed the error was theirs.",
                "The board can't predict you. I don't know why. But don't stand there and pretend I had no choice because the board could predict me."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. The storm decides now.", nextPage: 19 }
            ] },
            { ...storyPage("Answer for Kesa Volt. Her line holds your sky right now.", "The reckoning", "Kage Raiko Veyr", [
                "I knew the report as soon as you put it in front of me. Twelve years ago I called it grief and sent it back.",
                "I tested one section later, alone. It held through winter. I buried the result because if Stormveil stopped needing the Engine, Hollow Gate stopped being fed.",
                "Her anchors are protecting the Low Terraces now. Tell Mira I knew they could. I don't have a cleaner version of that."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", choices: [
                { text: "Enough. The storm decides now.", nextPage: 19 }
            ] },
            { ...storyPage("The Blank Board", "The storm floor, the last blank slate between you and the Tyrant rising", "Kage Raiko Veyr", [
                "Enough. Bell's up.",
                "I've kept this village alive for thirty years. Even if one district has another way, the rest still need crews, cable, and shelter before the next full storm.",
                "The board is blank, and the debt is due. Last slate in Stormveil, Jonin. It's yours.",
                "If you mean to take the board from me, step forward."
            ]), image: "/scenes/story/story-stormveil-village-100-8.webp", leftName: "Player", rightName: "Kage Raiko Veyr", rightImage: "/portraits/cinematic/storywide/kage-raiko-veyr-hollow.webp", choices: [
                { text: "Show him the quiet storm.", nextPage: 4, requireTrait: "sv88-better-storm-carried", trait: "sv100-proof-presented-carried" },
                { text: "Let Mira say her mother's reason.", nextPage: 9, requireTrait: "sv88-better-storm-deferred", trait: "sv100-proof-presented-deferred" },
                { text: "Let Vanta answer for the ninth share.", nextPage: 14, requireTrait: "sv92-witness-present", trait: "sv100-vanta-testified" },
                { text: "Show him Kesa's answer from your kit.", nextPage: 13, requireTrait: "sv88-unfinished-answer", forbidTrait: "sv88-better-storm-ready" },
                { text: "Show him the district that held.", nextPage: 12, requireTrait: "sv88-line-held", forbidTrait: "sv88-reason-proof-any" },
                { text: "Answer for the ninth share. You've been drawing it for seasons.", nextPage: 16, requireTrait: "sv58-took-the-cut" },
                { text: "Answer for the routing mark. My bout was written before I fought it.", nextPage: 17, requireTrait: "sv70-read-the-mark" },
                { text: "Answer for Kesa Volt. Her line holds your sky right now.", nextPage: 18, requireTrait: "sv88-reason-proof-any" }
            ] },
        ], [
            { text: "Refuse the challenge. Out loud. Before everyone. Then break the board.", conclusion: "You refuse in front of the square and strike the board. Its accounts begin returning their reasons to the people they came from, and tonight's intake falls to zero. Raiko sees the system fail, calls the storm, and attacks before you can finish breaking it.", trait: "honorable" },
            { text: "Accept the bout. After it, the valve gets a meter, a law, and a watch.", conclusion: "You accept only after stating new rules: every future draw requires consent, witnesses, and a public meter. Tonight's old schedule has no valid name or witness, so the cistern's immediate intake shuts and Hollow Gate receives nothing tonight. Raiko calls the storm and attacks before the new law can take hold.", trait: "suspicious" },
            { text: "Challenge Raiko for the seat and take control of the Engine.", conclusion: "You challenge Raiko for control of the Kage's seat, the valve, and the ledger. The board accepts your name immediately. It has been preparing you as a possible replacement. The cistern remains active and waits for its new keeper's first order. Raiko tells you to win the position and attacks.", trait: "ambitious" },
        ]),
    ],
    "Ashen Leaf Village": [
        milestone("Ashen Leaf Village", 4, "Roots of the Shinobi", "Wooden Root Guardian", "🌿", [
            { ...storyPage("The Register Hall", "Register hall, morning light through cedar smoke", "Toma Reed", [
                "First time signing? Stand here, next to me. If you stand in the middle of the hall, the clerks think you have something to hide.",
                "I'm Toma. Toma Reed, grove squad. I've done this four times, so you're in good hands.",
                "Name, family, craft. Then what you intend to become.",
                "My brother told me to answer the last one smaller than the truth.",
                "I laughed at him. Don't do that."
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
                "A protector. All right.",
                "The ink went deeper than usual. I haven't seen that in a while.",
                "You're signed in, %name. Welcome to Ashen Leaf."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("The Strongest", "The Register wall", "Registry Duty Clerk", [
                "The strongest shinobi alive. That's a large answer.",
                "The ink went deep. I don't know whether that's good.",
                "You're signed in, %name. Welcome to Ashen Leaf."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("A Builder", "The Register wall", "Registry Duty Clerk", [
                "Something that outlasts you. Good.",
                "Someone gave me almost the same answer years ago. Keep your drawings somewhere safe.",
                "You're signed in, %name. Welcome to Ashen Leaf."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("A Seeker", "The Register wall", "Registry Duty Clerk", [
                "You want to uncover what people hide. You know you're saying that in the records hall, right?",
                "No, don't change it. I'll write what you said.",
                "You're signed in, %name. Welcome to Ashen Leaf."
            ]), image: "/scenes/story/story-ashen-leaf-village-4-0.webp", choices: [
                { text: "Step back from the wall.", nextPage: 7 }
            ] },
            { ...storyPage("Not Yet", "The Register wall", "Registry Duty Clerk", [
                "You don't know yet. That's fine.",
                "The quill keeps catching on your line. Strange.",
                "I'll put 'undecided.' If you change your mind, come back. Welcome to Ashen Leaf, %name."
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
                "It's a black flower. The Register grows one when it sees unusual potential.",
                "I've seen two in forty years. People will congratulate you. There will be too much bread.",
                "Enjoy that if you can. Just don't assume the flower is a gift.",
                "Come with me. You have a grove trial before sundown."
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
            { text: "Watch the Guardian's pattern before you move.", conclusion: "It circles the way roots grow, in slow spirals that repeat. By the second pass you know where the next root will break the soil. Behind you, Mori stops reciting instructions and counts the spiral under his breath. The Guardian turns inward toward you.", trait: "suspicious" },
            { text: "Strike before the Guardian finishes rising.", conclusion: "Toma yelps as you rush forward. The Guardian catches your first blow. The yard shakes, and more roots break through the soil around you.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 15, "The Forbidden Seed", "Rootbound Guard Initiate", "🌿", [
            { ...storyPage("The Blessing", "Ash-house row at dawn, neighbors gathering", "Narrator", [
                "Overnight, black flowers opened along a fence in ash-house row. Eleven of them, glossy as beetle shells, in a straight and tidy line.",
                "The neighbors are bringing honey bread and congratulations. Flowers on a fence mean the same thing as a flower on the Register wall: someone in that house could become something extraordinary.",
                "Toma is standing at the edge of the crowd, and he is not eating his honey bread."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("Eleven Flowers", "The fence line, crowd thinning", "Toma Reed", [
                "That's Imera's house. Her daughter Sena is nine. She builds water wheels from barrel scraps and a loom that walks across the table.",
                "We had flowers on our fence when I was little. Everyone brought us bread.",
                "My brother changed that spring.",
                "I haven't said that before. Look, the Kage is here."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("The Kage at the Fence", "Imera's gate, winter bundles stacked", "Kage Hoshina Enju", [
                "Imera. I brought your winter share early. There's extra because half the village will eat your food this week.",
                "You must be Sena. I heard you built a walking loom. May I see it?",
                "It limps. I like that. You made this by yourself?",
                "The survey comes tomorrow. Get some rest tonight."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("What the Village Says", "The gate, Hoshina's guards moving on", "Imera", [
                "Hoshina kept this village alive. No child has frozen here since she became Kage. My mother reminds us every winter.",
                "She remembered Sena's name.",
                "So why am I afraid of those flowers?",
                "There are eleven. Nobody gets eleven. I asked Jorun how many his family had, and he couldn't remember any."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp", choices: [
                { text: "Go find Mori.", nextPage: 4 }
            ] },
            { ...storyPage("Mori Counts", "The register annex, bloom charts on the table", "Elder Mori", [
                "Good. I need both of you on ash-house row tonight. The survey arrives at first light.",
                "Most houses get one flower, sometimes two. I've never recorded eleven.",
                "Don't let anyone touch them. That includes the family.",
                "If something happens, come to me before you speak to the survey."
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
                "Please. You can still pretend you didn't see me.",
                "My aunt had flowers too. She could sing in three languages. Then one spring she stopped singing unless somebody asked. After a while she stopped completely.",
                "Nobody in my family thinks that's strange. I do.",
                "I'm going to cut one or two before the survey arrives. Maybe they'll record a smaller blessing and leave Sena alone.",
                "Give me one minute. That's all I'm asking."
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
                "They're almost here. If we're going to help Imera, we have to act now."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
            { ...storyPage("The Survey Arrives", "The gate, the Initiate's staff already glowing", "Narrator", [
                "The Initiate plants its staff at the gate and begins the recording chant. Under the fence, roots stir like fingers under a blanket.",
                "Imera looks at you once, quickly, the way people look at weather before a journey.",
                "Eleven flowers shine in a tidy line, and the largest one leans toward a child's window."
            ]), image: "/scenes/story/story-ashen-leaf-village-15-1.webp" },
        ], [
            { text: "Cut the largest flower and hide it before the survey counts it.", conclusion: "One quick snip, hidden in your sleeve, smooth as a card trick. The survey records ten blooms and Imera's shoulders come down an inch. The Initiate pauses over its count, then turns its head toward you.", trait: "suspicious" },
            { text: "Stand between Imera's gate and the survey.", conclusion: "The chant falters. Initiates are not trained for a person who simply will not move. Behind you, Imera whispers thank you, and then she whispers run.", trait: "honorable" },
            { text: "Tear the big flower out, roots and all, in the open.", conclusion: "The bloom comes up with a sound like a struck bell, and every root in the row wakes at once. Toma shouts your name. At least nobody can pretend it was an accident.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 25, "The Cut Branches", "Archive Spirit of the Root", "🌿", [
            { ...storyPage("After Hours", "The archive, one lamp between the stacks", "Toma Reed", [
                "Everything from the Register is copied here. Letters and drawings too.",
                "I have a key because I repair the shelves. I took the job because I wanted the key.",
                "I need someone else to look at this and tell me whether I'm imagining it.",
                "Start with Jorun's record. Tell me what he was building."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
            { ...storyPage("Jorun's Plans", "The carpenter's slat, held to the lamp", "Narrator", [
                "The record lists an apprenticeship, a marriage, and a workshop by the mill. Three entries contain detailed drawings for a bridge across the flood channel.",
                "The bridge drawings stop mid-line. The very next entry is a cabinet. Then chairs. Then twenty years of chairs.",
                "The ink of the first chair is exactly as old as the ink of the unfinished bridge."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Pull Aren Reed's slat yourself.", nextPage: 4 },
                { text: "Ask Toma what happened to the bridge.", nextPage: 2 },
                { text: "Ask Mori. He owes you for the border.", nextPage: 3, requireTrait: "rd22-sealed-for-mori" }
            ] },
            { ...storyPage("The Bridge", "Between the racks", "Toma Reed", [
                "Jorun is still alive. He drinks at the mill house most nights. If you ask him about the flood channel, he laughs and says bridges were never his thing.",
                "But you saw the drawings. He cared about that bridge.",
                "Then the drawings stop and he spends twenty years making chairs. He doesn't remember wanting anything else.",
                "Inside some of these racks, somebody carved the word 'pruned.' I don't think they meant the orchards."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Ask about Aren.", nextPage: 4 }
            ] },
            { ...storyPage("A Quiet Debt", "Mori's desk, lamp turned low", "Elder Mori", [
                "You kept the border business quiet. I remember. What do you want to know?",
                "Jorun. Yes. I remember the bridge. I surveyed his household myself, the same spring he stopped drawing it.",
                "The official record says he changed his mind. I don't believe that anymore.",
                "Read Aren Reed's record tonight. Don't tell Toma I sent you."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp", choices: [
                { text: "Pull Aren's slat.", nextPage: 4 }
            ] },
            { ...storyPage("Aren Reed", "The Reed family rack", "Toma Reed", [
                "Here. Aren Reed, my brother. There aren't any gaps in the dates. If you didn't know him, you'd think this was his whole life.",
                "It says he was quiet and dutiful. It even describes his smile correctly.",
                "My mother remembers him that way too.",
                "But he wasn't quiet. He argued with everybody. I have proof at home. I'm not ready to show you yet."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
            { ...storyPage("The Archive Wakes", "The stacks, lamp guttering", "Narrator", [
                "The racks creak. Not the creak of wood settling. The creak of something heavy turning over in its sleep.",
                "Down the aisle, the slats you pulled tonight begin sliding back into their places. Gently. Tidily. By themselves.",
                "The Archive Spirit guards the records. Roots close around the racks you opened, then reach across the aisle toward you."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
            { ...storyPage("The Keeper of Copies", "The archive aisle, roots sliding from the walls", "Toma Reed", [
                "Okay. That's the archive's keeper. It's old, it's strong, and we are very much not supposed to be in here at night.",
                "It won't follow us past the door. Probably. I mend its shelves and it tolerates me, but you pulled records, and it takes that personally.",
                "One rule, whatever happens: the slats stay in this room. If we carry one out, the survey knows by noon and this whole night becomes evidence against us.",
                "It's reaching for you. Decide."
            ]), image: "/scenes/story/story-ashen-leaf-village-25-2.webp" },
        ], [
            { text: "Copy Aren's page by lamplight while it comes.", conclusion: "You spread paper beside the slat and start copying. Your letters come out ugly and complete until the Spirit's roots close over the aisle. Toma raises the lamp. The copy becomes yours only if you can hold your place long enough to finish it.", trait: "suspicious" },
            { text: "Hold the keeper off Toma. He copies faster.", conclusion: "You step into the aisle while Toma drops to the page. The Spirit hits like a falling shelf. Behind you, he scribbles, swears, and keeps scribbling, but the copy is only half finished when the roots reach for him again.", trait: "reckless" },
            { text: "Set the slat down and face the Spirit with open hands.", conclusion: "You set Aren's slat down and show the Spirit your empty hands. It stops one root-length away and reads you twice, then closes its roots across the only path to the door. Toma reaches for the lamp as the aisle tightens.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 35, "The Rootfire Chamber", "First Flame Sentinel", "🌿", [
            { ...storyPage("The Kiln Stair", "Beneath the ancestral kiln, heat rising", "Elder Mori", [
                "Stay on the stairs. The floor down here is older than the village, and I do not trust it.",
                "I decided you needed to see this. If anyone objects, they can come to me.",
                "The Rootfire is below us. The founders lit it four hundred years ago. It has kept the village warm ever since.",
                "Put your gloves on. I need to show you two different rooms."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
            { ...storyPage("The Founders' Alcove", "A carved alcove, offerings behind wax", "Narrator", [
                "In the small alcove, wooden tokens rest in carefully swept niches. Each was carved by hand: a little ship, a house, a wedding ring, a book.",
                "Each token bears a large, carefully carved signature.",
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
                "The slats on those racks tell a different story. Come and look."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Walk to the racks.", nextPage: 5 }
            ] },
            { ...storyPage("The Gift", "The alcove", "Elder Mori", [
                "Each token represents a future someone gave up. The Rootfire turned it into heat, medicine, and material for the walls.",
                "The founders volunteered. They were adults, and they were told what it would cost them.",
                "I was proud of this room for thirty years.",
                "Now look at the racks on the left."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Walk to the racks.", nextPage: 5 }
            ] },
            { ...storyPage("Aren's Map", "The alcove, out of Mori's hearing", "Toma Reed", [
                "This is the room from Aren's letter. He wrote that the fire was fed twice. I thought he meant the kiln had two doors.",
                "He drew a map on the back. Stairs, alcove, then racks. Under the racks he wrote 'stamped.'",
                "There's a quartered circle beside it. I thought it was part of his water-screw.",
                "It isn't."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Walk to the racks.", nextPage: 5 }
            ] },
            { ...storyPage("The Second Feeding", "Iron racks, fresh graft-slats in rows", "Narrator", [
                "Twenty steps left, the hand carving stops and the iron begins. Racks from floor to ceiling, loaded with pale wooden slats.",
                "No signatures on these. Each slat carries a stamp instead: a household mark, a season, and one small tidy character that means 'approved.'",
                "The nearest slat still smells of fresh sap. Somebody's future was cut this week, without their name on it, and the fire is drawing warmth from it while you stand here.",
                "Ash from the signed tokens rises through the flue toward the village above.",
                "The stamped slats burn differently. Their smoke keeps the chamber warm, but their ash falls through a grate beneath the racks.",
                "A black seam under the kiln draws the ash downward. The stolen futures are feeding something below the village, not just the Rootfire. Mori watches it happen and has no answer."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
            { ...storyPage("The First Flame Sentinel", "The threshold, an armored shape kindling", "Elder Mori", [
                "Don't move. Don't draw your weapon.",
                "The founders built that Sentinel to keep thieves away from their gifts. It asks whether you gave or took.",
                "Survey crews carry permits, and the Sentinel accepts them. I've watched them bring stolen futures past it and said nothing.",
                "I didn't bring a permit tonight."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp", choices: [
                { text: "Face the Sentinel.", nextPage: 7 }
            ] },
            { ...storyPage("Did You Give, Or Did You Take", "The threshold, the Rootfire at your back", "Narrator", [
                "Fire glows behind the Sentinel's open visor. It studies Mori, then lowers its head toward you.",
                "Then it looks at you, and stops. Whatever it measures people against, you come back unreadable, and unreadable is not on its list of permitted things.",
                "Its blade arm wakes with a sound like a kiln door opening. It is not wrong to guard this place. That is the terrible part."
            ]), image: "/scenes/story/story-ashen-leaf-village-35-3.webp" },
        ], [
            { text: "Douse the nearest rack line and see what happens.", conclusion: "Steam rushes up the flue. The chamber cools, and the heat gauge on the wall drops sharply. The Sentinel advances between you and the remaining racks.", trait: "reckless" },
            { text: "Count the stamps. Every household. Every season.", conclusion: "You reach forty one households before the Sentinel closes the distance. Forty one, in this season alone. Mori watches you count, and every rack seems to age him another year.", trait: "suspicious" },
            { text: "Demand Mori say who signs the approvals.", conclusion: "'Hoshina,' Mori says, still looking at the fire. 'She's signed them for thirty years.' The Sentinel raises its blade, forcing you to turn from him.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 50, "The Branch That Rises", "Jonin Trial: Rootbound Master", "🌿", [
            { ...storyPage("The Measuring", "The graft hall, ribbons and calipers", "Registry Duty Clerk", [
                "Arm out, please. Now the other one. Chin level, eyes on the wall mark.",
                "Height, reach, span of hand. The tailors want your measurements for the Jonin grays, and the Register wants them for the record. Between you and me, the Register asks for more measurements than any tailor I've ever met.",
                "You're the one with the black flower. Everyone here has heard about you. You'll have to earn the rank like anyone else, though.",
                "That's everything. The rite starts at the bell, and the Kage is attending. Go find your place before the hall fills up."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
            { ...storyPage("Before the Bell", "The hall steps, Toma pacing", "Toma Reed", [
                "You're really doing this. I'd be happier if I weren't about to be sick.",
                "The old records call this rite 'the grafting.' Nobody says that anymore.",
                "Listen for the third line of the oath: 'I will grow where the tree permits.'",
                "Say whatever keeps you safe. Just know Aren took the same oath."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Answer the bell.", nextPage: 2 }
            ] },
            { ...storyPage("The Grafting", "The rite circle, Hoshina presiding", "Kage Hoshina Enju", [
                "Come forward.",
                "The village is proud of you. You are the strongest shinobi this hall has seen in a generation.",
                "The oath is short. Service to the village, silence when required, and the final line.",
                "Repeat it after me."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Swear it plainly, every word.", nextPage: 3 },
                { text: "Ask what happens to branches that grow past permission.", nextPage: 4 },
                { text: "Change the third line: swear to the village, not the tree.", nextPage: 5 }
            ] },
            { ...storyPage("Word for Word", "The rite circle", "Kage Hoshina Enju", [
                "'I will grow where the tree permits.' You didn't hesitate.",
                "I don't know whether you meant it. I expect I'll find out.",
                "Rise, Jonin of Ashen Leaf.",
                "The village will be watching you closely from now on."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Rise as Jonin.", nextPage: 6 }
            ] },
            { ...storyPage("The Question", "The rite circle, the hall holding its breath", "Kage Hoshina Enju", [
                "No one has asked me that during the rite in forty years.",
                "If someone becomes dangerous to the village, I decide what happens to them.",
                "Sometimes I remove them. You already knew that, or you wouldn't have asked.",
                "Take the oath. Don't make me decide that about you."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Take the oath and rise.", nextPage: 6 }
            ] },
            { ...storyPage("The Substitution", "The rite circle", "Kage Hoshina Enju", [
                "'I will grow where the village needs me.' The village. Not the tree.",
                "That is not the oath.",
                "No. Leave it. Clerk, record exactly what was said.",
                "Rise, Jonin. I want you where I can see you."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp", choices: [
                { text: "Rise as Jonin.", nextPage: 6 }
            ] },
            { ...storyPage("The Trial of the Rootbound Master", "The rite circle, floor roots parting", "Narrator", [
                "The floor opens on old root-worked steps. Rank in Ashen Leaf is not handed over. It is tested in the dark, against the Rootbound Master, the grafted champion of the last generation.",
                "Hoshina watches from the rim with her hands folded, unhurried, like a keeper watching weather roll in.",
                "Toma catches your eye from the crowd and holds both thumbs up. He looks pale."
            ]), image: "/scenes/story/story-ashen-leaf-village-50-4.webp" },
        ], [
            { text: "Fight carefully. Give the watchers nothing to write down.", conclusion: "You give the first exchange no flourish and no wasted motion. Hoshina tilts her head. 'Restraint,' she tells the hall, 'grafts well.' The old Master hears her and sets his feet. Hoshina watches both of you with the same appraising stillness.", trait: "suspicious" },
            { text: "Fight as yourself, whatever it shows them.", conclusion: "Your opening is loud, untidy, and entirely yours. The old Master catches the blow, then laughs like the sound surprised him. Above the trial floor, the black flower on the Register glows brighter. He waves you in again before Hoshina can call the exchange.", trait: "honorable" },
            { text: "End it fast. Break the Master's stance in three moves.", conclusion: "The first break comes in three moves. The hall gasps. Up close, the old Master's face shows relief before discipline shuts it away. He rebuilds his stance around the grafted roots. Retirement is not among the choices the Register gave him.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 65, "The Mission of Quiet Ash", "Rootbound Retrieval Squad", "🌿", [
            { ...storyPage("Escort Orders", "The register annex, crates on a wagon", "Registry Duty Clerk", [
                "Jonin. Good, you're punctual. Escort assignment: six crates of seasoned offerings, from this annex to the kiln, before the frost arrives. Signed by the Kage's own office.",
                "The crates are sealed and blessed. That means nobody opens them. The last escort who opened one has spent a season pulling weeds on the terraces, and he was lucky.",
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
                "So you have read Mori's charts. I wondered why he cleared you so fast.",
                "Fine. Lean in. Crate two came from the mill line. Crate three is the weaver who petitioned for a school last spring. Crates five and six came out of the detention rows, and I wasn't here when they were packed, because I made sure I was needed elsewhere.",
                "I tell myself I only file the orders. I don't choose who gets taken. That's getting harder to live with.",
                "Sign, Jonin. And if you walk slowly past the mill, I won't be the one who noticed."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Sign and move out.", nextPage: 3 }
            ] },
            { ...storyPage("The Kiln Road", "The forest road, wagon wheels loud", "Toma Reed", [
                "Aren would have opened these before the second mile marker.",
                "The third crate rattles when we hit a rut. Ash and cedar slats don't make that sound.",
                "I'm asking as your friend: let me look inside.",
                "There's a pry bar under the seat."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Pull the wagon off the road. Open the crate.", nextPage: 5 },
                { text: "Keep rolling. The seals stay on.", nextPage: 4 }
            ] },
            { ...storyPage("Sealed", "The wagon, still rolling", "Toma Reed", [
                "Right. Sealed. You're right. Forget I said anything.",
                "There. That was a little wooden wheel. I built toys with Aren for ten years. I know the sound.",
                "Stop the wagon. You can report me afterward.",
                "I can't deliver a child's toy to that fire. Please."
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
                "This was under the false bottom. It's a shipping manifest.",
                "It says: graft-slats, late season, destination Fifth Anchor escrow. The buyer's mark is a circle cut in four.",
                "At the bottom: 'Deliver surplus below Rootfire intake.'",
                "There's something under the fire. Whatever the village doesn't use is being sent there."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp", choices: [
                { text: "Pocket the manifest.", nextPage: 7, trait: "al65-found-gate-manifest" }
            ] },
            { ...storyPage("The Retrieval Squad", "The road behind, lanterns through the trees", "Toma Reed", [
                "Lanterns on the road behind us. Rootbound Retrieval Squad. They sweep the route whenever a shipment stalls too long.",
                "We have six crates and one wagon. They're coming from behind us.",
                "Keep that manifest. It shows the lower delivery was approved, and who approved it.",
                "Decide now."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
            { ...storyPage("Lantern Light", "The kiln road, squad closing", "Narrator", [
                "The lanterns spread out through the trees the way trained squads spread: unhurried, certain, closing from three sides.",
                "In crate five, paper shifts softly, like letters turning over in their sleep.",
                "Toma sets down the loom and reaches for the pry bar. The squad is almost at the wagon."
            ]), image: "/scenes/story/story-ashen-leaf-village-65-5.webp" },
        ], [
            { text: "Scatter the crates into the dark. Burn the wagon and manifest.", conclusion: "You cut the traces and kick the first crate from the wagon. Its root-work splits against a stone, scattering bright scraps into the trees. The squad reaches the bend before you can free the other five. Toma strikes a spark over the manifest while the retrieval line closes.", trait: "merciful" },
            { text: "Hide two crates. Let the squad recover the rest, and keep the manifest.", conclusion: "You and Toma drag two crates under the road roots and fold the manifest inside his coat. The retrieval squad finds four crates still lashed to the wagon and counts six spaces. Their leader looks from the empty bindings to the ash on your sleeves, then orders a search before either hidden crate can be carried clear.", trait: "suspicious" },
            { text: "Send Toma into the dark with the crates. Face the squad alone.", conclusion: "Toma takes the wagon into the trees while you remain in the road. The retrieval squad spreads across it, listening to the wheels fade behind you. Their leader asks where he went. You give no answer, and the first rank draws before Toma is safely out of hearing.", trait: "loyal" },
        ]),
        milestone("Ashen Leaf Village", 75, "The Ancestors Speak", "Ancestor-Bound Flame Beast", "🌿", [
            { ...storyPage("Ash on the Wind", "The kiln yard at dusk, ash falling upward", "Elder Mori", [
                "The Rootfire changed at noon. An hour later, every founder's token turned face-down.",
                "The survey wants an exorcist. Hoshina wants the yard closed. I want you.",
                "Something is coming up through the fire. It sounds like the founders.",
                "Toma went down without us. He thinks they know Aren."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Go down to the fire.", nextPage: 1 }
            ] },
            { ...storyPage("The First Flame", "The Rootfire chamber, flames standing upright", "First Flame Avatar", [
                "Stand where we can warm you. We are the founders whose names are on the first tokens.",
                "We knowingly gave up parts of our futures. Those gifts became walls, medicine, harvests, and winter mortar. We accepted that cost.",
                "The stamped slats are different. Those futures were taken without consent, and the Rootfire cannot use them properly.",
                "It has stored centuries of stolen plans, hopes, and years. We cannot contain them much longer.",
                "We never agreed to feed the pipe beneath this floor. The stamped slats are theft, not sacrifice. Stop calling them our gift."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Ask what the fire wants from you.", nextPage: 2, trait: "al75-founders-reject-drain" },
                { text: "Show them the tool outlines you copied from the Reed wall.", nextPage: 3, requireTrait: "al42-filed-a-report", trait: "al75-founders-reject-drain" }
            ] },
            { ...storyPage("The Ask", "The chamber, tokens rising in the heat", "First Flame Avatar", [
                "Not revenge. We are dead. The dead make poor executioners and worse judges.",
                "We want a witness. One living voice that can stand in front of the village and say: the founders gave, and the keepers took, and those are not the same fire.",
                "The Register cannot read you properly. That makes it harder for the keepers to alter your record and erase what you know. You have a chance to make the village hear us.",
                "There is one task we cannot do ourselves. Our grief formed a living body, and we chained it here because it was dangerous.",
                "Hoshina has been using that creature to force more heat from the Rootfire. Free it or end its suffering, but do not leave it under her control."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Follow the chain.", nextPage: 4 }
            ] },
            { ...storyPage("The Ghost Lines", "The chamber, your copied page held up", "First Flame Avatar", [
                "Hold it higher, child. Yes. A wall of tools that nobody remembers owning, copied in a living hand.",
                "You wrote down the dead's own testimony without knowing you were doing it. The boy those tools belonged to is in here with us. The stolen part of him. He still remembers arguing.",
                "He asks us to tell his brother something. Tell Toma: the bench was never the whole of me. Tell him about the ink.",
                "Go to the chain. The creature there formed from our grief. It is dangerous, but Hoshina had no right to chain it to her furnace."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp", choices: [
                { text: "Follow the chain.", nextPage: 4 }
            ] },
            { ...storyPage("The Bellows", "The chamber's far vault, a chain thick as a tree", "Toma Reed", [
                "There you are. Don't step on the melted part.",
                "The Avatar says this thing is the founders' grief. They chained it down here to protect the village. Hoshina has been using it to feed the fire.",
                "It looked at me the way my mother looks at Aren's workbench.",
                "We're supposed to free it or kill it. I think it heard that."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp" },
            { ...storyPage("Grief, Off the Chain", "The vault, the Flame Beast rising", "Narrator", [
                "The Flame Beast rises, pulling its chain taut. Voices and faces flicker in its fire: people the Rootfire could not save.",
                "The Avatar calls down the flue: 'Whatever you decide, remember what it is. This is our grief made into a living creature, not Hoshina's weapon.'",
                "The Beast sees you between it and the exit, lowers its head, and prepares to attack."
            ]), image: "/scenes/story/story-ashen-leaf-village-75-6.webp" },
        ], [
            { text: "Say the founders' words to it: 'given gladly.' Mean them.", conclusion: "At the founders' words, the Beast pauses. Faces become clear within the flames, then vanish as it strains against the chain and lunges at you.", trait: "honorable" },
            { text: "Shatter the chain. Whatever follows, follows.", conclusion: "The chain snaps. The Beast charges for the exit, straight toward you. Behind it, the bellows fall still and the Rootfire drops.", trait: "reckless" },
            { text: "Ask the Avatar what it hasn't told you. Then fight.", conclusion: "The Avatar admits the founders' gifts protected the village for only two winters each generation. Later keepers used that weakness to justify stealing additional futures and falsely claimed the founders approved. They did not. You now have their direct testimony, and the Flame Beast attacks.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 85, "The Kage Burns the Future", "Rootbound Elder Champion", "🌿", [
            { ...storyPage("The Detainment Lists", "The village square, notices in fresh ink", "Toma Reed", [
                "They posted this at dawn. 'Seasonal custodianship of promising branches.' It means detention.",
                "Fourteen names. The weaver who petitioned for a school. Jorun's apprentice. Two names from the mill whose only crime is planning a wedding their families forbid.",
                "Sena is on it. They took her at breakfast. One of the guards used to bring her scrap iron for her machines.",
                "Mori told me why. The more promising the future, the hotter it burns. They're filling the kiln before winter."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Go to Imera first.", nextPage: 2, trait: "al85-swore-to-imera" },
                { text: "Go straight to the Kage's orchard office.", nextPage: 3 },
                { text: "Ask Toma why he's stopped calling you 'friend.'", nextPage: 1, requireTrait: "toma-doubt" }
            ] },
            { ...storyPage("Jonin", "The square's edge", "Toma Reed", [
                "You noticed. I wondered if you would.",
                "You told me to burn Aren's letter. Maybe you thought you were protecting me. I didn't burn it.",
                "I'll follow your orders today because fourteen people need help.",
                "Afterward, you're coming to my mother's table and telling me why you did it. Then I'll decide whether we're still friends."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Go to Imera's house.", nextPage: 2 }
            ] },
            { ...storyPage("Imera's Kitchen", "The house behind the eleven-flower fence", "Imera", [
                "Don't tell me you're sorry. I can't do anything with sorry right now.",
                "You stood at our fence when the survey came. I haven't forgotten what that cost you. So I'll tell you what I can't tell the survey office.",
                "They let me see her after noon bell. She's warm and well fed. They give her puzzles and write down how she solves them. She thinks she's been chosen for something good.",
                "Her first loom is under the bed. Bring her home before they make her forget why she built it."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Go to the orchard office.", nextPage: 3 }
            ] },
            { ...storyPage("The Orchard Office", "The Kage's office, rain on new grafts", "Kage Hoshina Enju", [
                "You've seen the list. Sit down.",
                "The split-oak winter killed forty one people. The granary winter killed twenty six. Most were children.",
                "No child has frozen here in thirty years. I chose fourteen people to keep it that way.",
                "I know why you're angry. Anger is not a winter plan."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "\"Fourteen people are not firewood.\"", nextPage: 4 },
                { text: "Show her your own scarred line. Make it personal.", nextPage: 5, requireTrait: "al70-claimed-the-name" },
                { text: "Ask her exactly what the fire does with the unwilling.", nextPage: 6 }
            ] },
            { ...storyPage("Not Firewood", "The orchard office", "Kage Hoshina Enju", [
                "Don't use that word in my office. I know their names.",
                "Sena is nine. She builds little machines that walk. I have three of them upstairs.",
                "You can call me a monster after you've found another way to keep four hundred people alive.",
                "The burning is at frost-fall. Bring me a real alternative before then and all fourteen go home. Otherwise, stay out of my way."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Leave her office.", nextPage: 7 }
            ] },
            { ...storyPage("The Scarred Line", "The orchard office", "Kage Hoshina Enju", [
                "I've read your page many times.",
                "Someone cut you before you came here. No stamp, no date, no record of what they took.",
                "That is not proof that every cut is wrong. It is proof that an unchecked person with the shears is dangerous.",
                "Frost-fall is three days away. Bring me another way to heat the village."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Leave her office.", nextPage: 7 }
            ] },
            { ...storyPage("The Unwilling", "The orchard office", "Kage Hoshina Enju", [
                "You already know the answer. An unwilling future burns longer. A child's burns longer still.",
                "The founders' gifts could only carry us through two winters in a generation. That was not enough.",
                "The village doesn't keep all the heat. Part of it goes through a lower draw marked with a quartered circle. The name on the old agreement is Hollow Gate.",
                "I inherited that agreement, and I renew it every winter. You can hold me to account for it. First, show me how we'll keep people warm without the cuts."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp", choices: [
                { text: "Leave her office.", nextPage: 7, trait: "al85-hoshina-named-gate" }
            ] },
            { ...storyPage("The Detention Rows", "Outside the rows, the Elder Champion at the gate", "Narrator", [
                "The Rootbound Elder Champion stands at the detention gate. It has guarded the elders' orders for so long that bark has grown over its armor.",
                "Through the fence, a small girl waves at you cheerfully and holds up a finished puzzle for you to admire.",
                "Frost is three days out. The kiln flue is already warming. Toma keeps one hand under his coat around the pry bar from the wagon, waiting for your word."
            ]), image: "/scenes/story/story-ashen-leaf-village-85-7.webp" },
        ], [
            { text: "Break the rows open tonight. All fourteen, into the dark.", conclusion: "Toma puts the pry bar in your hand. The first hinge screams loud enough to wake the depot, and the Elder Champion turns from the gate before any child can cross it. Behind you, fourteen voices go quiet. The dark beyond the fence is close. The old guard is closer.", trait: "merciful" },
            { text: "Challenge the Champion at the gate, in daylight, before everyone.", conclusion: "The square fills fast. Three hundred people watch the old Champion leave the detention gate and plant itself in the road before you. Nobody behind you moves. There is no second plan. It lowers its staff and takes the first step.", trait: "reckless" },
            { text: "Let the transfer start, and shadow the crates to her private room.", conclusion: "You let the first wagon roll and fall in behind it. The Elder Champion leaves the gate to inspect the shadow keeping pace with the wheels. Past its shoulder, you glimpse the private orchard road and the lit upper room where Sena's machines are kept. The guard bars that road before the wagon reaches the turn.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 100, "The Tree Must Choose", "Kage Hoshina Enju, First Flame Vessel", "🌿", [
            { ...storyPage("Frost-Fall", "The Register hall, every line glowing faint", "Narrator", [
                "Frost-fall, and the Register wall is lit from inside, forty strides of lives glowing like banked coals. The hall is empty. She sent everyone home warm.",
                "Your black flower has grown all season. Tonight its petals are fully open, and for the first time, the whole bloom is leaning in one clear direction: toward the kiln stair.",
                "The stair door stands unlocked. On the top step sits a plate of honey bread, still warm, and a note in a keeper's steady hand: 'You were always going to come tonight. Eat something first.'"
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("At the Stair", "The kiln stair door", "Toma Reed", [
                "I know you have to go down alone. I don't like it.",
                "Take Aren's letter. If she lies about him, read it to her.",
                "Come to my mother's house afterward. There will be tea.",
                "Go. I'll keep the door open."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Go down alone.", nextPage: 2 }
            ] },
            { ...storyPage("The Keeper at the Fire", "The Rootfire chamber, racks emptied, shears on an anvil", "Kage Hoshina Enju", [
                "You're here.",
                "Those are the shears. I took them out to clean them this morning. Six hours later, I was still holding them.",
                "I made my first cut at thirty one. A boy planned to redirect the flood, and his bridge would have drowned the low fields.",
                "Don't ask whether I regret it. That isn't a useful question tonight."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp" },
            { ...storyPage("The Vessel", "The fire climbing her arms like ivy", "Kage Hoshina Enju", [
                "The fire started answering me in the spring. Now it comes whether I call it or not.",
                "I hear the people I cut. The bridge boy when it rains. The weaver teaching a school that never existed.",
                "Maybe those are their memories. Maybe they're mine. I don't know anymore.",
                "Ask what you came to ask."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Ask about the pipe beneath the Rootfire.", nextPage: 4 }
            ] },
            { ...storyPage("The Lower Draw", "The Rootfire behind her: an upper flame, cedar-gold, and beneath the grate a darker pull", "Kage Hoshina Enju", [
                "Look under the grate. The dark pull beneath the flame is the lower draw.",
                "The Rootfire keeps enough to warm Ashen Leaf. The rest goes to Hollow Gate.",
                "I told myself it was a tax. That every Kage paid one and at least our share kept children alive.",
                "Aren Reed fed both fires. I approved it. Now show me what you brought."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Face her across the anvil.", nextPage: 20, trait: "al100-lower-draw-confessed" }
            ] },
            { ...storyPage("The Better Winter", "The anvil, water dripping from your sleeve", "Kage Hoshina Enju", [
                "Show me. Slowly.",
                "Aren Reed's water-screw. Jorun built the housing, didn't he?",
                "How long has the full-size one been running? How many people does it feed?",
                "One channel is not a winter plan. Give me the numbers."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "\"Ninety mouths from the terraces alone. And the terrace families watched the water climb.\"", nextPage: 6, requireTrait: "al88-proved-the-winter" },
                { text: "Open Mori's book to the measured pages and read her every line.", nextPage: 7, requireTrait: "al88-held-the-proof" },
                { text: "\"Your own survey measured the field. Check their report.\"", nextPage: 8, requireTrait: "al88-baited-the-survey" },
                { text: "Set Aren's model on her anvil and let the water speak for itself.", nextPage: 9 }
            ] },
            { ...storyPage("What the Village Saw", "The anvil, her hands very still", "Kage Hoshina Enju", [
                "Ninety people from the terraces alone?",
                "And the families saw the channel running. They know where the water came from.",
                "Then I can't call it a failed test and make it disappear. Not anymore."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Wait while she considers the evidence.", nextPage: 16 }
            ] },
            { ...storyPage("The Measured Pages", "Mori's book open on the anvil", "Kage Hoshina Enju", [
                "Give me the book.",
                "This flow rate is too high. No. Wait. I read the column wrong.",
                "Worst week, ninety people. Mori signed every page.",
                "The dates are here too. It's kept running since the first successful trial."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She closes the book.", nextPage: 16 }
            ] },
            { ...storyPage("Her Own Eyes", "A survey report unfolded between you", "Kage Hoshina Enju", [
                "I read this report three times. I thought the east fields were wet because a test line had broken.",
                "You let my survey find it before you told me.",
                "Do you have any idea what could have happened if that channel failed?",
                "No. Don't answer. It didn't fail. That's the point."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She folds the report closed.", nextPage: 16 }
            ] },
            { ...storyPage("The Water Answers", "The model turning in a channel of firelight", "Kage Hoshina Enju", [
                "The vane is still cracked.",
                "I tested the full design once, at night, in this room. It worked then too.",
                "Now the full screw is running upstairs without burning anyone's future.",
                "I knew it could work."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She watches the water climb.", nextPage: 16 }
            ] },
            { ...storyPage("This Part Is Ours", "The kiln stair door opening behind you, Toma and Sera coming down into the firelight", "Toma Reed", [
                "Thank you for keeping the door open, %name. We need to do this part.",
                "That's Aren's model. You signed the order that took this work from him.",
                "I had a speech. I can't remember it. Mom?"
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Let Sera speak.", nextPage: 11 }
            ] },
            { ...storyPage("Handwriting", "The chamber, Sera laying the letter flat on the anvil", "Sera Reed", [
                "My son wrote this. I know that now. I know the threes he never closed. I know how he pressed too hard on the page when he was angry, and he was angry so much of the time.",
                "For twenty years, I thought he had always been quiet. That wasn't my son. You left me with someone easier to remember.",
                "His channel feeds ninety people.",
                "He wanted more than a quiet life in that workshop. You took that from him."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "The Kage looks at the letter.", nextPage: 12 }
            ] },
            { ...storyPage("A Mother's Proof", "The Rootfire dimming, Hoshina very still", "Kage Hoshina Enju", [
                "I remember Aren. He argued with me for an hour.",
                "I should have told you that. I should have told you the machine worked."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She cannot look away from the letter.", nextPage: 16 }
            ] },
            { ...storyPage("Water Without a Name", "The channel numbers chalked on a slate", "Kage Hoshina Enju", [
                "The number is real. I can see the east field from my tower.",
                "But you haven't shown me whose design this is or who paid for it.",
                "I won't rebuild the village around a machine with no history and no one responsible for it.",
                "You brought me water. You didn't bring me the rest."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She sets the slate down.", nextPage: 20 }
            ] },
            { ...storyPage("The Unfinished Answer", "Aren's model in her scarred hands", "Kage Hoshina Enju", [
                "Aren Reed's model. I signed the cut.",
                "I tested it. It worked.",
                "The full screw is running upstairs, but you kept his original model in your kit. His family still doesn't have it.",
                "You want to accuse me of deciding what belongs to other people? Settle its custody with them first."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "She sets the model down gently.", nextPage: 20 }
            ] },
            { ...storyPage("Mori Reads the Pattern", "Mori opening the bloom charts on the anvil beside the shears, Hoshina saying his name once, quietly", "Elder Mori", [
                "No. Let me do this.",
                "These are forty years of bloom charts and surveys. I knew the pattern. I kept telling myself I needed more proof.",
                "I was afraid, Hoshina. That's the reason.",
                "The flowers marked the people you planned to take. I helped you call it a blessing."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "He sets the charts beside the shears.", nextPage: 20 }
            ] },
            { ...storyPage("No Answer Left", "The Rootfire low, Hoshina looking at the shears on the anvil", "Kage Hoshina Enju", [
                "I built my life around one answer. You proved stolen futures are not the only way to feed the terraces.",
                "You have not replaced every winter fire. That is the work I should have allowed us to begin years ago. I still won't put down the shears while frost is at the door."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Then stop the cuts. Put down the shears.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for Mori's charts. You've known the pattern for years.", "The reckoning", "Kage Hoshina Enju", [
                "Mori showed you how to read the blooms. Then you knew which families were in danger and still had to walk past their houses.",
                "Did you ever hope a flower would die before the survey found it? I did. More than once.",
                "You carried that knowledge for one season. I carried it for thirty years and kept approving the cuts. Don't confuse understanding me with forgiving me."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Then stop the cuts. Put down the shears.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for my page. You kept my cut in your wonder room.", "The reckoning", "Kage Hoshina Enju", [
                "Yes. Your stub is in that room. It's older than every cut I made, and I don't know who put it there.",
                "I couldn't burn it. I also didn't return it. Then you found it and demanded an answer I didn't have.",
                "If you survive this, find the person who cut you. Don't let them hide behind numbers the way I did."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Then stop the cuts. Put down the shears.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for Aren Reed. His future gets finished.", "The reckoning", "Kage Hoshina Enju", [
                "I signed Aren Reed's cut. Don't look at Mori. The approval was mine, and I had read the complaint.",
                "I built his screw in this room afterward. It worked. Ninety more mouths from the east terraces. I counted them myself.",
                "Then I worked out what it would cost the Rootfire. I chose the fire and destroyed his work. Tell Toma I knew exactly what I was burning."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", choices: [
                { text: "Then stop the cuts. Put down the shears.", nextPage: 20 }
            ] },
            { ...storyPage("The Shears on the Anvil", "The Rootfire at full roar, Hoshina alight", "Kage Hoshina Enju", [
                "I've heard you.",
                "I've held these shears for thirty years. I know what they cost now. My hand still will not open.",
                "The frost is at the door. If you mean to stop the next cut, stop mine."
            ]), image: "/scenes/story/story-ashen-leaf-village-100-8.webp", leftName: "Player", rightName: "Kage Hoshina Enju", rightImage: "/portraits/cinematic/storywide/kage-hoshina-enju-hollow-canon.webp", choices: [
                { text: "Show her the better winter.", nextPage: 5, requireTrait: "al88-better-winter-carried", trait: "al100-proof-presented-carried" },
                { text: "Let the Reeds show her the better winter.", nextPage: 10, requireTrait: "al88-better-winter-deferred", trait: "al100-proof-presented-deferred" },
                { text: "Let Mori answer for his charts.", nextPage: 15, requireTrait: "al92-mori-present", trait: "al100-mori-testified" },
                { text: "Show her Aren's model.", nextPage: 14, requireTrait: "al88-unfinished-answer", forbidTrait: "al88-better-winter-ready" },
                { text: "Show her the east channel numbers.", nextPage: 13, requireTrait: "al88-water-proven", forbidTrait: "al65-saved-the-screw" },
                { text: "Answer for Mori's charts. You've known the pattern for years.", nextPage: 17, requireTrait: "al58-took-the-knowledge" },
                { text: "Answer for my page. You kept my cut in your wonder room.", nextPage: 18, requireTrait: "al70-claimed-the-name" },
                { text: "Answer for Aren Reed. His future gets finished.", nextPage: 19, requireTrait: "al88-reed-proof-any" }
            ] },
        ], [
            { text: "Break the shears on the anvil. Give every future back.", conclusion: "You break the shears. The stolen plans and ambitions stored in the Rootfire return to their owners, and the pipe feeding Hollow Gate goes cold. The village loses the extra heat those thefts provided, so winter will be difficult. Hoshina refuses to accept that cost and attacks.", trait: "honorable" },
            { text: "Bind the Rootfire to willing gifts alone. Sheathe the shears forever.", conclusion: "The fire shrinks to the founders' flame. Every unsigned stamp splits, and from tonight the Rootfire accepts only willing adult signatures. The lower seam opens, finds nothing it is allowed to take, and closes. Ashen Leaf will have to ask for its warmth now, winter by winter. Hoshina bows to the new rule. The fire in her does not.", trait: "merciful" },
            { text: "Take the shears. The village needs a keeper who was never fooled.", conclusion: "You take the shears and claim Hoshina's authority. The Register had been steering your assignments toward this role, hoping you might replace her. The pipe to Hollow Gate remains open, and the control ledger lists you as the next person authorized to approve a cut. Hoshina accepts your challenge and attacks to decide who keeps control.", trait: "ambitious" },
        ]),
    ],
    "Frostfang Village": [
        milestone("Frostfang Village", 4, "The Pack Survives", "Snow Warden Pup", "❄", [
            { ...storyPage("First Bell", "The training yard at first bell, breath-fog in rows, lantern lines overhead", "Captain Yura", [
                "New recruits, take your places on the worn spots. Leave enough room to move your arms.",
                "I'm Captain Yura. You'll freeze in that coat. After drill, get a real one from stores and tell them I sent you. The clerk owes me.",
                "At every bell, you answer your name. Listen for the person beside you. If they don't answer, you tell me. You don't assume somebody else noticed.",
                "Sova keeps the book. She'll explain the Count.",
                "Move. Your feet are getting cold."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
            { ...storyPage("The Intake", "The roll stone, Elder Sova with the Count book open", "Elder Sova", [
                "Hold out your wrist. This is where your rescue mark will go. If you're light-headed from the cold, sit beside the brazier first.",
                "The Count is Frostfang's official rescue roster. Your wrist mark puts you on it, and the rules say we search for every marked name.",
                "The words are: checked, counted, kept, warm. Checked means the plate knows you. Counted means you're in this book. Kept means we search if you go missing. Warm means we bring you home.",
                "That's all. Now tell me why you want your name in the Count."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "\"So the cold takes nobody on my watch.\"", nextPage: 2, trait: "ff4-count-protector" },
                { text: "\"To be the strongest back in the pack.\"", nextPage: 3, trait: "ff4-count-strongest" },
                { text: "\"Someone came for me once. I'm repaying it.\"", nextPage: 4, trait: "ff4-count-repayer" },
                { text: "\"I'm looking for someone who walked away.\"", nextPage: 5, trait: "ff4-count-seeker" },
                { text: "\"I don't know yet.\"", nextPage: 6, trait: "ff4-count-unknown" }
            ] },
            { ...storyPage("A Guard's Reason", "The roll stone", "Elder Sova", [
                "So the cold takes nobody on your watch. Good.",
                "You're in the book, %name.",
                "Remember you said that when the watch gets difficult."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("A Strong Back", "The roll stone", "Elder Sova", [
                "The strongest back in the pack. We can use one.",
                "You're in the book, %name.",
                "Don't try to carry a whole patrol by yourself. I've seen people ruin their knees that way."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("A Debt to Pay", "The roll stone", "Elder Sova", [
                "Someone came for you, so you'll come for someone else. I understand.",
                "You're in the book, %name.",
                "Just remember that you don't owe the Count your whole life."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("A Door That Closed", "The roll stone", "Elder Sova", [
                "You're looking for someone who left. People don't often admit that here.",
                "You're in the book, %name.",
                "I hope you find them. Ask why before you ask them to come back."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("A Blank Line", "The roll stone", "Elder Sova", [
                "You don't know yet. That's allowed.",
                "You're in the book, %name. I left the reason blank.",
                "Come back if you want to add one later."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Step to the mark plate.", nextPage: 7 }
            ] },
            { ...storyPage("The Fogged Plate", "The gate's mark plate, frost crawling where a wrist should read", "Captain Yura", [
                "Rest your wrist on the plate. It should read your mark and match it to the name Sova just entered in the Count.",
                "Huh. Wipe it and try again.",
                "Stop. Look. It isn't misreading you. It's reading somebody. That's a name coming up, and it's an old name. Nobody's had a plate-read like that in twenty years.",
                "Sova! Sova. The plate just read the new intake as someone long gone. Bring the book."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
            { ...storyPage("Someone Long Gone", "The gate, Sova's thumb on the fogged plate", "Elder Sova", [
                "I haven't seen that before.",
                "It may be frost in the plate. These things are old.",
                "It should match your mark to your entry in the book. Instead, it's showing the name of someone who died years ago.",
                "I'll check the old books. For now, Yura is waiting in the yard."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp", choices: [
                { text: "Form up in the yard.", nextPage: 9 }
            ] },
            { ...storyPage("The Loose Warden", "The yard, a Snow Warden Pup pacing the drill square, six recruits in line", "Captain Yura", [
                "Listen up. The pup has broken out of the pens twice this month. It's young, it's frightened, and it is still two hundred pounds of teeth.",
                "You'll take the front position. The others will hold formation behind you. I need to see how you handle a charge with a squad at your back.",
                "Stay where they can reach you, and call if you need help.",
                "Take your position. Start on the bell."
            ]), image: "/scenes/story/story-frostfang-village-4-0.webp" },
        ], [
            { text: "Hold formation. Trust the line at your back.", conclusion: "You take the front position, close enough for the others to cover you. The pup lowers its head and charges. Yura checks the line behind you, then raises a hand to keep the recruits in place.", trait: "loyal" },
            { text: "Break formation. Take the pup down before it reaches the line.", conclusion: "You leave the line while Yura is still shouting the hold order and meet the pup alone in the open square. Half the yard curses the broken formation. The other half leans forward. The animal lowers its head and comes for the gap you chose to make.", trait: "reckless" },
            { text: "Watch its paws. Herd it toward the open pen instead.", conclusion: "The animal is not attacking. It is cornered. You open a lane toward the pen with two short feints, but the frozen latch catches halfway. The pup sees the narrowing gate, wheels toward you, and makes you prove you read more than its fear.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 15, "The Missing Patrol", "Oathbound Soldier", "❄", [
            { ...storyPage("Five Names Unanswered", "The roll stone at third bell, snow starting, five names hanging", "Captain Yura", [
                "Ruven's patrol missed roll call. Five people. Their ridge camp is empty, but the fires were banked and their packs are still there.",
                "Kael called it desertion and struck their names from the Count.",
                "Struck means the Count now treats them as people who chose to leave. No search, no rescue, and no place on the official roster.",
                "Ruven wouldn't leave his dog, and he wouldn't abandon a clean kit. Something happened to them.",
                "I'm going north. Are you coming?"
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("The Kage in the Snow", "The north gate, Kael Whitefang walking in out of the storm carrying a shepherd", "Kage Kael Whitefang", [
                "Open the gate! Now!",
                "This shepherd strayed past his line in the east folds. He's frostbit, not dead. Get him soup and a warm wall. Move.",
                "Yura, if you're taking this recruit north, stop right there.",
                "A person stays in the Count if the mark answers, the route is logged, and the rescue line holds. This shepherd still met two of those conditions, so I went for him.",
                "Ruven's patrol met none of them. Their names were struck.",
                "You think they're lost. I think they deserted. Either way, I'm not sending more people into that storm."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("What Yura Knows", "The north road, snow thickening", "Captain Yura", [
                "Kael has carried people home through weather that should have killed him.",
                "But once the Count strikes a name, he stops seeing the person. I've never understood how both can be true.",
                "Ruven banked his fire. He meant to return.",
                "Tracks ahead. One person, coming toward us. Something is wrong with the way he's walking."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("Dain Comes Back", "The road, a soldier walking out of the white with his hood down", "Frost Seal Echo", [
                "The soldier Dain is returned to the Count.",
                "The soldier Dain reports: the patrol went beyond its line. The patrol is corrected. The Count is whole.",
                "You stand outside your posted rotation. State your numbers. The Count is whole. The Count is whole.",
                "Your orders are to return to the wall. Further refusal will be corrected."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
            { ...storyPage("The Corrected Man", "The road, Dain's hood down, frost in a script down his wrist", "Captain Yura", [
                "That's Dain, but he doesn't sound like himself. He stammers when he's afraid. He hums. He's doing neither.",
                "The script on his arm isn't ours. It goes all the way to his elbow.",
                "The other four are still out there.",
                "Don't forget this is Dain's body. Put him down without killing him if you can."
            ]), image: "/scenes/story/story-frostfang-village-15-1.webp" },
        ], [
            { text: "Take the corrected man down fast, before it learns you're a threat.", conclusion: "You hit first and hard. The thing wearing Dain catches the blow with drill-perfect, joyless precision and answers from the next line of the Count. Under the deep script his own mark shows faintly at the wrist. Yura sees it too, and shouts for you to leave him breathing.", trait: "reckless" },
            { text: "Block the road. Keep him away from the village.", conclusion: "You plant yourself in the road. Dain advances, reciting the Count with every step. Yura clears the path behind you. He does not look at her when he raises his hands.", trait: "honorable" },
            { text: "Answer in its rhythm. See whether it will keep talking.", conclusion: "You repeat the Echo's questions in its flat rhythm. It pauses to answer each one, giving you time to learn the sequence. Then it asks for your number again. When you fail to give it one, it lunges.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 25, "The Loyalty Seal", "Frost Seal Guardian", "❄", [
            { ...storyPage("Cut From the Ice", "A ravine north of the line, three figures standing in cut ice like specimens", "Captain Yura", [
                "There. Snow take me. There they are.",
                "They're frozen upright. I can see them through the ice.",
                "Ruven's the one at the front. Cut around him carefully. Keep your blade away from his skin.",
                "Three. Count again. Three. We met Dain on the road, so that's four of the five accounted for. But Kessa isn't here. She's the fifth name, the youngest of them, and she is not here."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
            { ...storyPage("The Deep Script", "The ravine, three soldiers thawing, wrists black with script to the elbow", "Narrator", [
                "They wake calm. That is the wrong part. Men cut from ice should shake, weep, swear. These three stand up, form a line, and wait for orders.",
                "Ruven looks at Yura with polite, total certainty. He asks nothing about his wife. He asks nothing about his dog. He asks for his rotation.",
                "The script runs wrist to elbow on all three. It does more than track them: it replaces their choices with the Count's orders. They never agreed to it.",
                "'The Count is whole,' they say together. Yura calls Ruven's name again. He repeats the same words."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
            { ...storyPage("The Seal's Voice", "The ravine mouth, the Frost Seal Echo standing on the ice, guardian shapes forming under it", "Frost Seal Echo", [
                "Four are recovered. The Count is whole.",
                "The fifth resisted correction. The fifth is pending.",
                "You transport recovered assets. This is approved. You inquire after the pending. This is not approved.",
                "The Count provides warmth for those who obey. Do not interfere with the fifth soldier's correction. Stand down."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp", choices: [
                { text: "Point out the Count's own promise to search for every marked person.", nextPage: 3, requireTrait: "ff20-read-her-license" },
                { text: "Put the three behind you and face the Guardian.", nextPage: 4 }
            ] },
            { ...storyPage("Terms of Service", "The ravine mouth, the Echo's cadence stuttering", "Captain Yura", [
                "Harrow was right. It follows the wording.",
                "Kessa was checked at intake. The checked are counted, and the counted are kept. Your own rule says she's owed a search.",
                "It's hesitating.",
                "Move. The ice is coming up."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp", choices: [
                { text: "Draw your weapon.", nextPage: 4 }
            ] },
            { ...storyPage("The Frost Seal Guardian", "The ravine, a guardian of old ice rising between you and the road home", "Captain Yura", [
                "That's an old Guardian. The seal is controlling it the way it controlled Dain.",
                "We have three people behind us and Kessa is still missing.",
                "The three come home. That's the mission. I'll keep looking for Kessa after that.",
                "Your call."
            ]), image: "/scenes/story/story-frostfang-village-25-2.webp" },
        ], [
            { text: "Hold the road until all three are clear, then withdraw.", conclusion: "You block the narrowest part of the ravine while Yura leads the three rescued soldiers toward the road. The Guardian advances on you. Ruven stops to await an order, and Yura pulls him onward. You need to hold a little longer.", trait: "honorable" },
            { text: "Watch the script for a pattern as you fight.", conclusion: "The Guardian moves in time with the litany: four beats and a pause. You wait for that pause before retreating. Yura shouts for you to hurry; the rescued soldiers keep stopping for orders, and she cannot help all of you at once. The Guardian begins its next attack.", trait: "suspicious" },
            { text: "Go through it. Kessa is out there and this thing is the door.", conclusion: "You drive straight at the old ice because Kessa is pending on the far side. The first impact splits one white plate and costs you skin. The Guardian closes over the breach before you can see what lies beyond it, reshaping its stance around the force you chose.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 35, "The Pale Pack", "Oathbound Ice Captain", "❄", [
            { ...storyPage("The Struck Names", "A rebel cavern in the glacier, forty-one people, no marks, warm fires", "Pale Pack Runner", [
                "Leave your weapons on the rack by the entrance. There are children in here.",
                "Welcome to the Pale Pack. Forty-one names the Count struck. Deserters, doubters, one woman who missed a check nursing her sick mother. Struck all the same.",
                "Don't mistake this for a perfect camp. We call the Roll because we choose to, but people still argue, miss calls, and make mistakes.",
                "The fires smoke, the stew is thin, and two winters ago the east watch slept through second bell. A boy died because of it.",
                "The youngest of us is Kessa, off the ridge patrol. She walked in half-frozen a week after the seal took her squad, unsealed, still marked 'pending' in the wall's book. She teaches the children knots now.",
                "So no, we are not proof that walking free is easy. We are proof of one thing only: the Count lied when it told you there was no other way. Ask the wall how their Count is doing."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
            { ...storyPage("Yura's Roster-Mate", "The cavern fires, a big woman standing up slow", "Captain Yura", [
                "Kessa is here? She's alive?",
                "Marrin.",
                "I filed the report that struck your name. The handwriting is mine. I'm not asking you to forgive me.",
                "You built another Roll out here without the Count.",
                "I don't know what to say."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
            { ...storyPage("Returned to the Count", "The cavern mouth, torchlight, a sealed recovery detail forming up outside", "Narrator", [
                "The recovery detail arrives at dusk: twelve sealed soldiers and a captain whose wrist script is old and deep, a man who was himself recovered once, and speaks of it the way saved men speak of medicine.",
                "The order he carries is short, in Kael's own hand: ALL STRUCK NAMES RETURNED TO THE COUNT. RECOVERY AUTHORIZED. SEALING AUTHORIZED.",
                "Forty-one people wait behind you. At the entrance, the runner moves between the children and the soldiers outside.",
                "The captain gives you until the next bell to bring everyone out voluntarily. His soldiers keep their weapons drawn."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp", choices: [
                { text: "Ask Yura, quietly, what she's about to do.", nextPage: 3, requireTrait: "yura-trust" },
                { text: "Answer the captain at the mouth.", nextPage: 4 }
            ] },
            { ...storyPage("The Captain's Arithmetic", "The cavern mouth's shadow, Yura checking her gear by touch", "Captain Yura", [
                "My mark says I stand with the recovery detail.",
                "Marrin is behind us. Kael signed the order that sent those soldiers here.",
                "If this goes wrong, I'm staying in the entrance. I'm not letting them take the cavern.",
                "Whatever you decide, say it loudly enough for both sides to hear."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp", choices: [
                { text: "Answer the captain.", nextPage: 4 }
            ] },
            { ...storyPage("One Bell", "The cavern mouth, the detail in formation, snow beginning", "Pale Pack Runner", [
                "They've done this before, you know. Not here. Smaller camps. Struck names, recovered, and you meet them a season later at the wall with script to the elbow, asking for their rotation.",
                "Forty-one of us. Some will fight. Some are children. Some would honestly rather be sealed than spend another winter unforgiven. Don't judge them. Warmth is warmth when you're tired enough.",
                "The next bell is about to ring.",
                "Will you help us hold the entrance? I need to know now."
            ]), image: "/scenes/story/story-frostfang-village-35-3.webp" },
        ], [
            { text: "Stand in the mouth beside Yura. The cavern doesn't empty tonight.", conclusion: "You take the cavern mouth beside Yura. Marrin joins without being asked. The runner follows after one look at the children behind you. The sealed captain counts four bodies in his road and orders the recovery line forward. Nobody in the mouth moves.", trait: "honorable" },
            { text: "Negotiate: the children and the willing go down warm, the rest stay free.", conclusion: "You offer the captain nine willing names, fed and blanketed, and sign the remaining thirty-two under your protection. He reads the split twice. Then he says the Count ordered forty-one recoveries, not a bargain, and reaches for the signed page while the unit closes around you.", trait: "merciful" },
            { text: "Let the bell run out. Then shadow the detail's captain home.", conclusion: "You refuse the recovery order and let the deadline bell finish. The captain turns the unit downhill, exactly as you hoped, but leaves a rear rank to seize the witness who voided his count. If you want the hidden route home, you first have to get past the soldiers assigned to make sure you never follow it.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 50, "Jonin of the Frozen Oath", "Jonin Rank Trial: Glacier Twins", "❄", [
            { ...storyPage("Both or Neither", "The oath hall, a two-page scroll flat on the stone table", "Elder Sova", [
                "Read before you sign. Both pages. I'll wait. I've grown good at waiting.",
                "Page one is your rank: Jonin of Frostfang. You earned it, and the book agrees.",
                "Page two is the officer's mark: deep script, wrist to elbow. It turns Count orders into commands your body is forced to obey.",
                "The rule I wrote requires you to accept both. I thought it would make our officers answer to the people they command. You've seen what it actually does."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp" },
            { ...storyPage("The Oath Is a Comfort", "The oath hall, Kael by the brazier, hands out to the heat", "Kage Kael Whitefang", [
                "You should hesitate. This mark does not come off.",
                "On a ridge at night, it means someone knows where you are and someone comes for you. I know what that is worth.",
                "People talk about choice when they're warm. I use this mark to keep them alive.",
                "Sign or don't. If you refuse it, the Count will not send a rescue for you."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "\"The plate took away Essen's anger about his brother. He never agreed to that.\"", nextPage: 2, requireTrait: "ff42-held-the-doubt" },
                { text: "Take up the pen.", nextPage: 3 }
            ] },
            { ...storyPage("What Doubt Weighs", "The oath hall, the brazier crackling", "Kage Kael Whitefang", [
                "You helped Essen. Good. What happens to everyone else when the heat stops?",
                "I've carried children out of the snow. I won't let that happen again.",
                "The Count took Essen's grievance without permission and sent it through the gate. I know. I have not dealt with it because the winter keeps coming first.",
                "Maybe you think that's an excuse. Fine. Sign or don't."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "Take up the pen.", nextPage: 3 }
            ] },
            { ...storyPage("The Pen Gets Lighter", "The hall's side door, Yura turning her own wrist in the brazier light", "Captain Yura", [
                "Before you decide, look at my wrist.",
                "I signed at nineteen and signed again with every promotion. My hand shook the first time. The last time, I was talking about boots and barely looked down.",
                "The mark makes it easy to stop asking what you're agreeing to.",
                "Read both pages. Take your time."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp", choices: [
                { text: "The Glacier Twins wait.", nextPage: 4 }
            ] },
            { ...storyPage("The Rank Trial", "The proving floor, two glacier-pale duelists bowing as one", "Elder Sova", [
                "Whatever you sign, you can still take the trial. I won't turn you away from the proving floor.",
                "These are the Glacier Twins. They've had deep marks since they were young. Watch how closely they move together. The Count presents them as proof of what the mark can do.",
                "I want to see what you can do. I'll enter the result myself.",
                "Begin on the bell. And come eat afterward, whatever happens. I'll have soup ready."
            ]), image: "/scenes/story/story-frostfang-village-50-4.webp" },
        ], [
            { text: "Take rank with the recruit's mark only. Refuse the deep script, out loud.", conclusion: "You sign page one and set the pen down. Sova checks the unbound entry twice. Kael says nothing. On the proving floor, the Glacier Twins touch marked wrists together and take formation against the Jonin who refused their bond.", trait: "honorable" },
            { text: "Sign both pages. Rank now, and the binding's secrets from inside it.", conclusion: "The deep script takes like ice taking a lake: total, quiet, certain. It whispers immediately: rotations, tallies, the warmth below. Across the floor, the Glacier Twins answer the same cadence before the bell. You wanted the machine's secrets. Now you have to fight inside its voice.", trait: "ambitious" },
            { text: "Ask Sova, at the table, why the litany never mentions leaving.", conclusion: "The hall goes drill-quiet. Checked, counted, kept, warm. Four verbs, and not one of them is released. Sova looks down at the book. Kael tells you to sign or step back. You step onto the proving floor instead, and the marked Twins close rank around the question.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 65, "Orders in White Blood", "Oathbound Purge Unit", "❄", [
            { ...storyPage("The Removal Order", "The muster yard before dawn, an order pinned under a lamp", "Captain Yura", [
                "Read this.",
                "The order says there are nineteen Pale Pack fighters in the old quarry. I'm assigned the sweep, and you're the ranking witness.",
                "I pulled the original scout report. It lists nine children, six elders, and four unsealed adults. No fighters.",
                "Someone changed 'people' to 'fighters' before Kael signed it.",
                "I invoked confirmation protocol before I came for you. The unit is already two hours late. That delay is mine, and it is nearly spent."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "\"I refused Sova's exemption and stayed in the Count. What did that change for you?\"", nextPage: 1, requireTrait: "ff58-stayed-in-the-count" },
                { text: "Ride for the quarry ahead of the unit.", nextPage: 2 }
            ] },
            { ...storyPage("From Inside", "The muster yard, Yura buckling her kit slow", "Captain Yura", [
                "You refused the exemption so you could challenge the Count from inside it. That made me ask what I was doing with my own authority.",
                "So I used what authority I have: confirmation protocol delayed the unit for two hours. It's legal, and it has my signature.",
                "After twelve years as an officer, two hours is all I could get us.",
                "Use them."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "Ride. Now.", nextPage: 2 }
            ] },
            { ...storyPage("The Old Quarry", "The quarry floor, tents against the cut walls, children's snow-forts by the pool", "Pale Pack Runner", [
                "You rode hard. Yura says a recovery unit is coming for us?",
                "The cavern scattered after the last recovery push. Marrin took the fighters deeper. I brought the children and elders here.",
                "They're calling us fighters? Look around. Do you see anyone who could face a sealed unit?",
                "Yura said dawn. All right. I'll wake the children and get everyone ready to move. You two keep watch on the rim."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
            { ...storyPage("The Confiscated Kits", "A dry cut in the quarry wall, crates of struck names' belongings stacked as a windbreak", "Captain Yura", [
                "These are confiscated kits from people the Count struck. They were supposed to be processed. They're being used as a windbreak.",
                "Wait. This tag is from my old ridge post.",
                "Dren Coldewe. I reported him for desertion on day six. On day nineteen, someone without a mark pulled me out of a whiteout. I never saw his face.",
                "This is his letter. These plans are for relay lanterns that can find someone without a plate-read. He came back for me."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp", choices: [
                { text: "Wrap the letter and the lantern plans. They leave with you.", nextPage: 4, trait: "ff65-saved-the-letter" },
                { text: "Put the letter in Yura's hands. It was always addressed to her.", nextPage: 4, trait: "ff65-gave-yura-the-letter" },
                { text: "Reseal the crate. The dead keep their kit. The living keep moving.", nextPage: 4, trait: "ff65-resealed-the-kit" }
            ] },
            { ...storyPage("Dawn Comes Anyway", "The quarry rim at first light, twelve sealed silhouettes against the snow", "Narrator", [
                "The unit crests the rim exactly on schedule, minus the two hours a captain's signature bought and spent.",
                "Below, the adults divide blankets and food among the children and elders. Several crates remain beside the tents; no one can carry them.",
                "The order in your coat says nineteen fighters. The quarry floor says a soup pot and snow-forts.",
                "The sealed unit waits on its witness. The word is yours, and the paper is wrong, and the paper is signed by the man who carries shepherds home."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
            { ...storyPage("Ranking Witness", "The quarry rim, the purge unit forming its sweep line", "Captain Yura", [
                "The order says sweep. There are children below us.",
                "Whatever you decide, I'll confirm it. Two officers on the record are harder to ignore than one.",
                "They're waiting.",
                "Decide."
            ]), image: "/scenes/story/story-frostfang-village-65-5.webp" },
        ], [
            { text: "Refuse the order as written. False count, no sweep, on your testimony.", conclusion: "You declare the sweep void for a false count and sign the refusal. Yura countersigns. The sealed captain says Kael's signature still outranks both witnesses and orders the line forward. A runner below holds up the scout roll with nineteen civilian names. Half the unit hesitates. The captain attacks to force the order through.", trait: "merciful" },
            { text: "Escort the camp down the mountain yourself, under pack law.", conclusion: "You invoke the drill-book rule that lets a pack walk home together. The sealed captain bars the descent: struck names are no longer Pack. Yura reads the rule aloud. Two soldiers step out rather than deny it, but he orders the rest to take all nineteen names by force.", trait: "loyal" },
            { text: "Burn the order in front of the sealed unit and see who salutes.", conclusion: "Paper burns fast at altitude. One soldier salutes your rank. Another points out that the order was copied into their marks before the march. The unit splits between two commands, but its captain chooses the one that preserves his post and draws on you. The camp has an opening if you can hold it.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 75, "Yura Breaks the Oath", "Frostfang Oathbreaker Hunter", "❄", [
            { ...storyPage("Drill Fashion", "The north tower before first light, Yura's kit laid out in perfect rows", "Captain Yura", [
                "You came. Good. I wrote this down last night so I couldn't change my mind.",
                "The blade is clean. The bandages are ready. The kettle is hot. I need you to witness this.",
                "I've worn the mark for twelve years. This morning I'm taking it out.",
                "Keep talking while I work. If I stop answering, ask me something simple."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
            { ...storyPage("Line by Line", "The tower room, lamplight, the work begun", "Captain Yura", [
                "The first line is the intake mark. I was nineteen when I took it. There it goes.",
                "You're wondering why I waited this long. So am I.",
                "I kept thinking I needed the mark to be sure someone would come for me. Dren came back without one. I've run out of excuses.",
                "Second line. Promotion mark. Keep talking. I'm fine. No, don't look at it. Just talk."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp", choices: [
                { text: "\"I turned the holder plate down. Did seeing that make this any easier?\"", nextPage: 2, requireTrait: "ff70-turned-the-plate" },
                { text: "Keep her talking. Bell by bell.", nextPage: 3 }
            ] },
            { ...storyPage("The Same Hand", "The tower room, steam off the kettle", "Captain Yura", [
                "Vess offered you the holder plate. You turned it down while I was standing there.",
                "I thought about that, and about Dren walking into the storm because he chose to. Watching you refuse made my own excuses harder to repeat.",
                "It still frightens me. But I made the decision myself.",
                "Last line. Hold the lamp closer. If my hand stops, don't help me."
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
                "It calls the mark its property. It calls me confused.",
                "When marked people want to refuse an order but obey anyway, the vault takes that refusal for fuel. That's what the litany leaves out.",
                "It's on the stairs. It moves like Dain did.",
                "If you stay, stay because you choose to. I won't ask twice."
            ]), image: "/scenes/story/story-frostfang-village-75-6.webp" },
        ], [
            { text: "Stand between the Hunter and her bound wrist. She finishes her morning.", conclusion: "The Hunter wants Yura's wrist. It gets you at the stair instead. Behind your shoulder, she binds her own arm and takes one deliberate drink of tea. Then the Hunter drives you back a landing, and Yura sets the cup down hard enough to crack it.", trait: "merciful" },
            { text: "Fight it side by side. Her first bout as a free name.", conclusion: "Shoulder to shoulder, no mark binds Yura to your orders. Each flank she covers is hers to choose. The Hunter reaches for the command that used to own her wrist, finds nothing, and changes its grip. 'Landing one,' Yura says. This count belongs to her.", trait: "loyal" },
            { text: "Let it enter, then bar the door. See how it responds to Yura.", conclusion: "You let the Hunter enter the room and bar the door behind it. Yura gives her old rank and asks who sent it. The Hunter pauses for a second, as if waiting for an order, then lunges before she can ask again.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 85, "The Kage Freezes Dissent", "Oathbound Alpha Guard", "❄", [
            { ...storyPage("The White Silence", "The central square at dawn, forty-three citizens standing frozen in perfect rows", "Narrator", [
                "They stand in rows in the square, forty-three of them, frost-sealed upright with their eyes open. Neighbors. A baker still dusted in flour. A boy of maybe sixteen with his fists still balled.",
                "The village walks around them. Quietly. Eyes down. The way people walk around a thing they've decided not to see, because seeing it costs too much.",
                "The wall calls it the White Silence. Preservation, the notice says. Protective custody against the winter of dissent.",
                "Each of the forty-three, you learn by asking, filed a grievance, missed a check, or asked the wrong question at roll call. The rows are alphabetical."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
            { ...storyPage("What Harrow Sells", "The icehouse, Harrow with her collar up and her ledger out", "Kite Harrow", [
                "I matched the forty-three seal dates to Sova's meter. Each intake made the vault's lower draw jump, and the notices show every person was frozen after a refusal or grievance.",
                "The meter rises more sharply for each new prisoner than it does for an already sealed soldier. That's what the readings show; I don't yet know why.",
                "Kael is storing a new source for a payment. I don't know when it is due."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "\"You burned the forged plates. Now show me the real ones' weakness.\"", nextPage: 2, requireTrait: "ff80-burned-the-plates" },
                { text: "Go to the vault hall. Face him.", nextPage: 3 }
            ] },
            { ...storyPage("The Rhythm's Flaw", "The icehouse, Harrow sketching a mark plate on the table", "Kite Harrow", [
                "I burned the forged plates. I still remember how they worked.",
                "The litany is a four-beat lock: checked, counted, kept, warm. The plate verifies the rhythm, not the person.",
                "The frozen people are being kept, but they can't answer a check. That breaks the order the plate expects.",
                "Give the plate the right rhythm and it will accept a false answer. That's the weakness."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "To the vault hall.", nextPage: 3 }
            ] },
            { ...storyPage("The Quartermaster of Doubt", "The vault hall, warm as a hearth, Kael at a table of tally boards", "Kage Kael Whitefang", [
                "Sit down. Nobody argues well shivering.",
                "Ninety-one people died the winter before I took the vault. Since then, none.",
                "You see forty-three people in the square. I see four hundred people who freeze if the vault runs dry.",
                "I've heard every plan for replacing it. None survived the first serious storm.",
                "Bring me one that works, not another promise. Until then, the rows stay where they are."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp", choices: [
                { text: "The Alpha Guard bars the hall.", nextPage: 4 }
            ] },
            { ...storyPage("The Alpha Guard", "The vault hall doors, the oldest sealed soldier in the village unfolding to full height", "Narrator", [
                "The Alpha Guard was the first soldier Kael sealed. He volunteered forty years ago, when the Count still asked permission.",
                "Forty years of the script sinking deeper kept his strength and his training. It took almost everything else that made him a person.",
                "He stands in the hall door because Kael told him to keep you from the rows outside.",
                "The vault is drawing on those forty-three people right now. Nobody reaches them, or the system under them, without going through him."
            ]), image: "/scenes/story/story-frostfang-village-85-7.webp" },
        ], [
            { text: "Break the rows out now. All forty-three, whatever it costs.", conclusion: "Forty volunteers take your signal and put hooks to the first frozen row. The White Silence Guard steps between them and the release wheel. Breaking all forty-three free will drain the vault by afternoon, but none of that happens unless you move the thing guarding the lever now.", trait: "reckless" },
            { text: "Post yourself at the rows. Nobody freezes, nobody vanishes, on your watch.", conclusion: "You take the post in front of the frozen rows and call the first name. A villager answers for the person who cannot. Another voice answers the second. The White Silence Guard steps into the roll and raises its weapon. Keeping all forty-three visible starts with holding this post.", trait: "honorable" },
            { text: "Map the rows against the vault's intake schedule. Find the payment date.", conclusion: "Forty-three names, forty-three seal dates, and the vault's draw curve from Sova's meter converge three weeks out. The vault is short, and Kael is using the White Silence to cover the payment date. The Guard crosses the figures with one pale arm before you can copy the final column.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 100, "The Oath Must Break", "Kage Kael Whitefang, Hollow Oath Tyrant", "❄", [
            { ...storyPage("The Open Ledgers", "The vault stair, Sova's records room standing open, lamps lit, no keeper", "Narrator", [
                "The records room stands open. Not forced. Opened. Every vault ledger is out on the reading tables, squared to the table edges, lamps trimmed and burning.",
                "Sova is nowhere in the room. Her chair is pushed in. The Count book is gone from its stand, and on the bare wood where it sat for forty years, dead center, lies her pen.",
                "Her resignation is entered in perfect register hand and underlined hard enough to split the paper.",
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
            { ...storyPage("The Pack Comes Down", "The vault forecourt, unmarked figures standing in falling snow", "Pale Pack Runner", [
                "Marrin brought everyone who could safely come. Kessa has the roll-slate. The children are safe with Sova.",
                "We talked about it. If this works, we'll answer one roll call here in the forecourt because we choose to.",
                "That doesn't mean we forgive anyone.",
                "Yura is holding the stair. Go."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "To the stair.", nextPage: 3 }
            ] },
            { ...storyPage("The Stair Held by Choice", "The vault stair, Yura at the landing, bare wrist bandaged, standing easy", "Captain Yura", [
                "I'm staying on this stair. No mark, no order. Just me.",
                "Kael is below at the meter. The payment comes due tonight, and he hasn't left the vault in days.",
                "Come back up when this is over. That's an order.",
                "Go. I'll keep the door open."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Down, alone.", nextPage: 4 }
            ] },
            { ...storyPage("The Man Fused to the Door", "The vault floor: a wall of ancient ice, a meter running backward, Kael before it", "Kage Kael Whitefang", [
                "You're on time.",
                "That's the vault. The meter reaches zero tonight.",
                "The script has moved past my shoulder. I knew the vault was changing other people. I didn't realize it was changing me too.",
                "The Count worked when I inherited it. Somewhere along the way, rescue became a quota. I knew, and I kept using it because no one froze. There's something else you need to see."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Look where he is looking.", nextPage: 5 }
            ] },
            { ...storyPage("The Gate Tax", "The vault's blue-white flame steady above, and beneath the grate a darker pull downward", "Kage Kael Whitefang", [
                "Look beneath the flame. The lower draw is marked with a quartered circle.",
                "Its name is Hollow Gate. I signed that draw open thirty years ago and renewed it every year after.",
                "The other villages pay it too. Frostfang pays with the choices people surrender to the Count.",
                "Dren's years under the Count fed the vault and the Gate. His final refusal did not. I hid that difference when I called him a deserter.",
                "Now show me what you brought. The meter won't wait."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Face him at the meter.", nextPage: 20, trait: "ff100-lower-draw-confessed" }
            ] },
            { ...storyPage("The Better Roll", "The vault floor, Dren's lantern plans unrolled against the ice", "Kage Kael Whitefang", [
                "Bring that into the light.",
                "Relay lanterns. This is Coldewe's handwriting.",
                "You ran a drill on the ridge. One person went missing and the lantern team found him in nineteen minutes without a mark.",
                "One drill does not replace the vault. Show me what else you have."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "\"Nineteen minutes to find a man in a whiteout. No mark. No vault. And the rows saw it.\"", nextPage: 7, requireTrait: "ff88-woke-the-rows" },
                { text: "Open the drill log to Sova's countersigned pages and read him every line.", nextPage: 8, requireTrait: "ff88-logged-the-drill" },
                { text: "\"Your own wardens timed the search. Do you doubt their report too?\"", nextPage: 9, requireTrait: "ff88-baited-the-wardens" },
                { text: "Hang Dren's lantern from the meter's frame and let it burn there.", nextPage: 10 }
            ] },
            { ...storyPage("What the Rows Saw", "The vault floor, the meter's light unsteady", "Kage Kael Whitefang", [
                "The whole wall watched the drill?",
                "I had three people tell me the volunteer carried a hidden plate. They were lying.",
                "Four hundred people saw him found without the Count.",
                "I can't make all of them pretend it didn't happen."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He looks at the meter a long time.", nextPage: 16 }
            ] },
            { ...storyPage("The Countersigned Log", "The vault floor, the drill log flat against the ice wall", "Kage Kael Whitefang", [
                "Give me the log.",
                "Lantern spacing, sweep times, no plate-read, no draw. Sova signed it.",
                "She wouldn't sign an estimate. I taught her better than that.",
                "The figures are sound."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He closes the log with care.", nextPage: 16 }
            ] },
            { ...storyPage("His Own Wardens", "The vault floor, a warden's report unfolded between you", "Kage Kael Whitefang", [
                "My wardens filed this report.",
                "I called the duty officer in and asked whether the drill was real. He said they timed it twice.",
                "I accused him of helping you falsify it. He asked to be placed under oath.",
                "The report is real. I knew that before you came down here."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He folds the report in half.", nextPage: 16 }
            ] },
            { ...storyPage("The Lantern on the Meter", "The vault floor, one lantern burning against a wall of banked exits", "Kage Kael Whitefang", [
                "Coldewe's pattern. Storm glass and a slow wick.",
                "I struck him for leaving. Then he came back for Yura without a mark, and I recorded it as self-recovery.",
                "I knew it was a lie.",
                "Leave the lantern there."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He does not touch the lantern.", nextPage: 16 }
            ] },
            { ...storyPage("She Answers His Roll", "The vault stair door opening, Yura coming down with the letter", "Captain Yura", [
                "%name, step back. This is between Dren and me.",
                "Kael. Dren Coldewe, ridge post four. Struck for desertion on day six. On day nineteen, he came back for me without a mark or an order.",
                "His letter says: 'Tell Yura: being counted isn't the same as being come for.'",
                "Dren Coldewe. Present. Twelve years late."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Kael stands very still.", nextPage: 12 }
            ] },
            { ...storyPage("The Door, Answered", "The vault floor, the meter's hum faltering", "Kage Kael Whitefang", [
                "I remember that letter. I ordered it confiscated.",
                "Being counted isn't the same as being come for.",
                "No. It isn't.",
                "Yura, I knew he came back for you. I changed the report."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He stands very still.", nextPage: 16 }
            ] },
            { ...storyPage("A Roll Without a Name", "The vault floor, the drill figures chalked on slate, no letter behind them", "Kage Kael Whitefang", [
                "Nineteen minutes. My wardens timed it twice.",
                "But who built the lanterns? Who walked into the storm? Who chose to search?",
                "A drill result isn't enough. I need to know whether real people will use this when they're frightened and freezing.",
                "Bring me names, or the Count stays."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He turns back to the meter.", nextPage: 20 }
            ] },
            { ...storyPage("The Undelivered Letter", "Dren's letter in Kael's scarred hands, unopened", "Kage Kael Whitefang", [
                "That's Coldewe's kit tag. I signed the strike.",
                "My wardens reported nineteen minutes for the lantern search. I've kept their findings to myself.",
                "But this letter was addressed to Yura, and you kept it in your coat.",
                "Give it to her. Then come back and tell me what it changes."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "He sets the letter down like a sleeping child.", nextPage: 20 }
            ] },
            { ...storyPage("The Litany, Backwards", "The vault floor, Sova on the stair with the Count book held open outward", "Elder Sova", [
                "Wait. I need to say this.",
                "Kael, I wrote the litany. I taught it to thousands of people.",
                "The warm are kept. The kept are counted. The counted are checked. We bound everyone together so nobody could be left behind. We also made it impossible for them to leave.",
                "I helped you do that. I'm done. The book stays open from now on."
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
                "Sova gave you the keeper's exemption. Your wrists stayed bare while everyone else paid into the vault.",
                "Did you ever look at the intake book and feel relieved it was them instead of you? I did.",
                "I felt it for forty years. Then I kept the exemption and called the arrangement necessary."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. The Count ends here.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for my plate. It read someone long gone.", "The reckoning", "Kage Kael Whitefang", [
                "I read Vess's report about the fogged plate. The vault calls that response an unpaid debt.",
                "The plate did not mistake your body for that dead person. It found one missing decision in your history: a particular time you left something behind.",
                "Someone used an old account to remove that departure from the record, then stored the choice under your name. That is the debt the vault detected.",
                "I don't know who opened the account or what you left. That record is outside this village."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. The Count ends here.", nextPage: 20 }
            ] },
            { ...storyPage("Answer for Dren Coldewe. His lanterns are lit on your ridge.", "The reckoning", "Kage Kael Whitefang", [
                "Dren Coldewe did not desert. Don't ask Sova. I entered the lie.",
                "He refused the ridge rotation in front of his post. If I recorded a refusal, everyone else would know saying no was possible. So I called him a deserter.",
                "Then he walked into the whiteout and saved Yura anyway. Tell her I knew. Tell her the false report stayed because I wanted it to."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", choices: [
                { text: "Enough. The Count ends here.", nextPage: 20 }
            ] },
            { ...storyPage("The Meter at Zero", "The vault floor, the payment due, Kael's script reaching his jaw", "Kage Kael Whitefang", [
                "I've heard you. Now listen to me.",
                "A voluntary lantern line may find one person. It does not heat the barracks, and I still don't know whether the rest will survive a real winter without the Count.",
                "Struck names from the glacier and the wall are waiting outside. The meter is at zero.",
                "Final order: the Count holds. Refuse it to my face."
            ]), image: "/scenes/story/story-frostfang-village-100-8.webp", leftName: "Player", rightName: "Kage Kael Whitefang", rightImage: "/portraits/cinematic/storywide/kage-kael-whitefang-hollow.webp", choices: [
                { text: "Show him the better Roll: Dren's lanterns found a man with no mark and no vault.", nextPage: 6, requireTrait: "ff88-better-roll-carried", trait: "ff100-proof-presented-carried" },
                { text: "Let Yura answer Dren's Roll.", nextPage: 11, requireTrait: "ff88-better-roll-deferred", trait: "ff100-proof-presented-deferred" },
                { text: "Let Sova read the litany backwards.", nextPage: 15, requireTrait: "ff92-witness-present", trait: "ff100-sova-testified" },
                { text: "Show him Dren's letter.", nextPage: 14, requireTrait: "ff88-unfinished-answer", forbidTrait: "ff88-better-roll-ready" },
                { text: "Show him the nineteen minutes.", nextPage: 13, requireTrait: "ff88-relay-held", forbidTrait: "ff65-saved-the-letter" },
                { text: "Answer for the exemption. You stood outside the Count like Sova.", nextPage: 17, requireTrait: "ff58-took-the-exemption" },
                { text: "Answer for my plate. It read someone long gone.", nextPage: 18, requireTrait: "ff70-turned-the-plate" },
                { text: "Answer for Dren Coldewe. His lanterns are lit on your ridge.", nextPage: 19, requireTrait: "ff88-exit-proof-any" }
            ] },
        ], [
            { text: "Break the vault's hold on every mark. Rescue must be a choice.", conclusion: "You begin breaking the vault's hold on every Count mark. The refusals it stored surge back toward the people they came from, and Hollow Gate's immediate drain falters. Outside, struck names answer Yura's roll by choice. Kael hears them and attacks before the release can finish. Surviving the next winter will still require watch crews, fuel, and shelter freely supplied.", trait: "honorable" },
            { text: "Bind the vault. Metered, lawful, every struck name a case with your signature.", conclusion: "You keep the vault but impose public records, consent for every draw, and marks that wearers can revoke. The next Hollow Gate collection cycle runs, but the new rules authorize no payment. Sova gives you the ledger and pen. Kael accepts the rules, but the deep script controlling him forces him to attack.", trait: "merciful" },
            { text: "Take the valve. A better keeper is still a keeper, and it's you.", conclusion: "You claim the keeper's valve. The vault links your missing past record to an old, unclaimed account and unlocks its keeper controls for you. New script begins spreading from your wrist, and the drain to Hollow Gate stays open for your orders. Kael yields the role, then attacks to test whether you can hold it.", trait: "ambitious" },
        ]),
    ],
    "Moonshadow Village": [
        milestone("Moonshadow Village", 4, "No One Saves You", "Hidden Blade Trainee", "🌙", [
            { ...storyPage("Two Names", "The registry booth at moonrise, violet lanterns on the canal", "Shade Master Iro", [
                "Welcome to Moonshadow. Sit down. And don't lean on the curtain. It falls if you look at it too hard.",
                "Most people here use two names. The day name is for ordinary life. The night name is for work you don't want following you home.",
                "I'll take your day name now. You can choose the other one later.",
                "Go ahead."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
            { ...storyPage("The First Trade", "The registry booth, Iro's pen waiting over the intake book", "Shade Master Iro", [
                "All right. Now the intake question.",
                "If you had to give something up to get through a bad night, what would go first?"
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "\"Nothing that keeps someone else safe. That's not for sale.\"", nextPage: 2, trait: "ms4-trade-protector" },
                { text: "\"Whatever buys me the strongest hand in the room.\"", nextPage: 3, trait: "ms4-trade-strongest" },
                { text: "\"Anything, to buy back something I lost.\"", nextPage: 4, trait: "ms4-trade-redeemer" },
                { text: "\"I don't sell. I listen.\"", nextPage: 5, trait: "ms4-trade-listener" },
                { text: "\"I don't know what I have left to trade.\"", nextPage: 6, trait: "ms4-trade-unknown" }
            ] },
            { ...storyPage("A Guardian's Answer", "The registry booth", "Shade Master Iro", [
                "Nothing that keeps someone else safe. Fair enough.",
                "I've written it down, %name. Welcome to Moonshadow.",
                "Just make sure you know who you're protecting. People will use that against you."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("A Buyer's Answer", "The registry booth", "Shade Master Iro", [
                "The strongest hand in the room. A lot of people say that when they arrive.",
                "I've written it down, %name. Welcome to Moonshadow.",
                "Be careful who offers to help you become important."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("A Debtor's Answer", "The registry booth", "Shade Master Iro", [
                "Anything. That's a dangerous answer.",
                "I've written it down, %name. Welcome to Moonshadow.",
                "Whatever you lost, make sure it's really the same thing before you pay to get it back."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("A Listener's Answer", "The registry booth", "Shade Master Iro", [
                "You listen. Good. Most people here are waiting for their turn to talk.",
                "I've written it down, %name. Welcome to Moonshadow.",
                "Don't repeat everything you hear."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "Step to the Mirror registry.", nextPage: 7 }
            ] },
            { ...storyPage("An Open Answer", "The registry booth", "Shade Master Iro", [
                "You don't know what you have left. That's an unusual way to put it.",
                "I've written it down, %name. Welcome to Moonshadow.",
                "If you work out what you meant, you can tell me. Or don't."
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
                "Hey. Over here. Try not to make it obvious.",
                "Your intake paper says the first test is in two nights. It isn't. It's tonight.",
                "Nobody will ring a bell or come looking if you miss it. I found that out the hard way.",
                "Yard behind the silk house, one bell after moonrise. Bring a weapon."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp", choices: [
                { text: "The silent yard, one bell after moonrise.", nextPage: 9 }
            ] },
            { ...storyPage("The Silent Yard", "The silk-house yard at moonrise, a veteran trainee unfolding from the shadows", "Narrator", [
                "The yard is silent because it is built silent: sand raked to swallow footsteps, walls hung with cloth that eats echoes. Whatever happens here happens unheard.",
                "A veteran trainee waits at the far end of the yard. Their weapon is already drawn.",
                "There is no instructor. Nyx sits on the wall, watching. She puts away her coin when the veteran approaches you.",
                "The veteran attacks without an introduction. You'll have to earn your place here before anyone offers to help."
            ]), image: "/scenes/story/story-moonshadow-village-4-0.webp" },
        ], [
            { text: "Read the veteran's feet before the first exchange. Silence works both ways.", conclusion: "You watch the veteran's feet shift through the sand. By the third exchange, you can recognize the step that precedes a lunge. You move to intercept the next one. On the wall, Nyx leans forward.", trait: "suspicious" },
            { text: "Let the first strike bring the veteran within reach. Counter hard.", conclusion: "You take a shallow cut and strike back before the veteran can withdraw. They wipe blood from their lip and reset their guard. Your arm hurts. You keep it raised as they approach again.", trait: "reckless" },
            { text: "End it clean and stand over them until the watchers see who won.", conclusion: "You drive the veteran toward the center of the yard, where the watching trainees can see. The veteran notices the open windows too. They lower their stance and counter, determined to make you regret the choice.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 15, "The Sold Secret", "Veiled Hand Collector", "🌙", [
            { ...storyPage("Inside a Locked Room", "Your quarters, door still bolted, a cipher scroll on the pillow", "Narrator", [
                "The door was bolted from inside. The window latch is unbroken. The dust on the sill is undisturbed, and you checked, because this village has already taught you to check.",
                "And on your pillow, folded in thirds, is a cipher scroll in a dead network's hand.",
                "You can make out a few phrases: village patrol routes, an outside buyer, regular payments. The last line asks for a meeting. You'll need help decoding the rest.",
                "You check the lock again before taking the scroll. Whoever left it got past your precautions without leaving a mark."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Money That Sits", "Nyx's stall over the dye canal, the scroll flat between you", "Nyx", [
                "Where did you get this? No, wait. Let me read it first.",
                "It's an old cipher. Patrol routes and gate rotations, sold every quarter. The buyer is real.",
                "But nobody spends the payments. I traced two accounts last season. The money goes in and sits there.",
                "I don't think the sellers need the money. The payments may be there to make this look like an ordinary sale."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Kage's Mercy", "The canal walk at midnight, Sable Nocturne feeding a lantern flame, alone", "Kage Sable Nocturne", [
                "Walk with me. The scroll can wait.",
                "You've heard what people call me. Most of it is deserved.",
                "A creditor bought proof of something a merchant's daughter did years ago. He planned to reveal it at her wedding. I bought the proof back this afternoon. That's it burning now.",
                "She will never know. You may think she had a right to. I decided she didn't. Decisions like that are my job."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("The Doorway", "Your quarters again, and this time the doorway is occupied", "Veiled Hand Collector", [
                "You received our scroll. We watched you take it to the canal dealer.",
                "It was a test. We wanted to know who you would trust with a secret.",
                "Nyx has no license to read our records. Taking the scroll to her was an offense. You will be assessed for it.",
                "Stay where you are. This will be quicker if you cooperate."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
            { ...storyPage("Assessment", "The quarters, the Collector's veils drifting like ink in water", "Narrator", [
                "It moves like a debt: quietly, patiently, absolutely certain it will be paid.",
                "Outside the window, Nyx whispers: 'Veiled Hand. The tower hires them for work it won't admit to. Someone paid a lot to have you tested. Keep it away from your throat.'",
                "The Collector's veils spread across the doorway, sealing the room the way a seal closes a letter.",
                "Assessment begins."
            ]), image: "/scenes/story/story-moonshadow-village-15-1.webp" },
        ], [
            { text: "Stand in the middle of the room and meet it head-on.", conclusion: "You step clear of the furniture. The Collector feints toward the window, then hesitates when you refuse to follow. You hold your ground as its veils spread for another attack.", trait: "honorable" },
            { text: "Use the room against it. Lamp, shadow, curtain, angle.", conclusion: "You kill the lamp and pull down the curtain, turning its practiced darkness into a room only you have measured. The Collector's first sweep cuts empty cloth. Its second finds your shoulder. Outside, Nyx whispers that making an assessor uncertain only raises the fee.", trait: "suspicious" },
            { text: "Break through it and take the fight into the open street.", conclusion: "You go through the veils and out the door, dragging the confrontation onto the canal walk where lanterns burn and windows watch. Several curtains open. The Collector flinches from the audience, then seals the street behind you. Backing out still costs it more than finishing the assessment.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 25, "Masks Beneath Masks", "Masked Auction Enforcer", "🌙", [
            { ...storyPage("The Cellar Auction", "Under the whisper market: a lantern-lit cellar, lots on velvet, buyers in masks", "Nyx", [
                "Keep your hood up and look bored. I bribed the stair guard, but that only gets us so far.",
                "Watch the lots. I used to move contraband through here: weapons, relics, private letters.",
                "Tonight they're selling patrol schedules and medical records.",
                "Lot eleven is a person's name and address. That's new."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
            { ...storyPage("The Prepaid Buyer", "The cellar floor, an empty chair with a standing bid", "Nyx", [
                "See the empty chair with the lantern? It has a standing bid on every lot, one step above the highest offer. No limit.",
                "Nobody buys everything unless the individual lots don't matter to them.",
                "I know everyone who works this market. I don't know who is behind that chair.",
                "Someone is collecting the village one file at a time."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp", choices: [
                { text: "Ask Harrow to trace the account behind the empty chair.", nextPage: 2, requireTrait: "ms20-respected-the-unsworn" },
                { text: "Get closer to lot eleven before it sells.", nextPage: 3 }
            ] },
            { ...storyPage("The Appraiser's Trace", "The cellar's shadowed gallery, Harrow already there, because of course she is", "Kite Harrow", [
                "Don't stare. I'm working.",
                "I traced the chair through four brokers. Two are dead. The original account carries a quartered circle, the same mark I've seen in three other villages.",
                "The buyer already knows what's in these lots. That's why the auctioneer barely describes them.",
                "This looks less like shopping than an inventory. I cannot tell you what they intend to do with it."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp", choices: [
                { text: "Lot eleven goes up.", nextPage: 3 }
            ] },
            { ...storyPage("No White Invitation", "The cellar floor, the auctioneer's hand pausing, every mask turning", "Narrator", [
                "Lot eleven rises on its velvet: a name, an address, a life with a reserve price.",
                "The stair guard signals to the auctioneer, pointing at you. The auctioneer stops with one hand over the lot.",
                "'The house notes,' the auctioneer says smoothly, 'a guest without a white invitation.'",
                "The buyers turn to look. An armored Enforcer steps away from the wall. Nyx swears and glances at the stair, then stays beside you."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
            { ...storyPage("The House Rules", "The cellar, the Masked Auction Enforcer rolling its shoulders", "Nyx", [
                "The Enforcer won't damage the lots. Use that.",
                "Copy the quartered-circle stamp on the chair's payment slip. We can trace that account once we're out.",
                "Lot eleven sells in ninety seconds.",
                "I'll get the name. Keep that thing busy."
            ]), image: "/scenes/story/story-moonshadow-village-25-2.webp" },
        ], [
            { text: "Fight the Enforcer as a screen. Nyx palms lot eleven in the chaos.", conclusion: "You draw the Enforcer to the center of the floor. While every mask follows its first charge, Nyx slips toward lot eleven. The auctioneer sees her and orders the doors barred. The Enforcer turns to cut off her retreat. The lot only disappears if you hold the room long enough.", trait: "suspicious" },
            { text: "Stand on the auction table and say what's being sold, mask off.", conclusion: "You remove your mask and identify the lots in plain language: work schedules, medicine, a person's name, information about neighbors. Several bidders leave before their own names enter the record. The sellers bar the doors, and the remaining buyers stay behind the Enforcer because losing their deposits costs more than exposure. It comes for you in front of everyone.", trait: "honorable" },
            { text: "Put the Enforcer through the buyer's chair. Let the house bill the circle.", conclusion: "You drive the Enforcer toward the proxy chair. The auctioneer orders it to protect the standing account, and the masked buyers clear the floor rather than be named in its damage claim. It plants itself between you and the chair. If the house is going to bill the circle, you have to put it through its own guard first.", trait: "reckless" },
        ]),
        milestone("Moonshadow Village", 35, "The Hollow Moon Contract", "Contract-Bound Shadow", "🌙", [
            { ...storyPage("The Bleeding Page", "A safe room over the canal, a contract that darkens in moonlight", "Nyx", [
                "I took the rider attached to lot eleven. Read it under the moon.",
                "In lamplight it looks like a purchase memo. The real text only appears out here.",
                "Sable Nocturne is the contracting party. It pays for the disappearance of everyone on this list.",
                "They're all talented people with influence. She isn't removing criminals. She's removing possible successors."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp", choices: [
                { text: "Tell Nyx about the shrine that recognized a witnessed refusal.", nextPage: 1, requireTrait: "rd34-kept-my-no" },
                { text: "Ask what's on the other end of the contract.", nextPage: 2 }
            ] },
            { ...storyPage("The Kept No", "The safe room, the contract pinned under a lamp it doesn't like", "Nyx", [
                "A stone opened for a witnessed refusal? Where did you find that? No, later.",
                "This rider does the opposite. It treats silence as permission.",
                "The dark text isn't ordinary ink. Each name is already partially bound to the contract.",
                "If the document is destroyed, those claims may break with it."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp", choices: [
                { text: "The lamplight bends.", nextPage: 2 }
            ] },
            { ...storyPage("The Counterparty", "The safe room, the lamp's light bending toward the wall like a bow", "Hollow Moon", [
                "I have read the contract, and I recognize you as the unexplained person mentioned in our records.",
                "We are not collecting anything from you tonight. This is a warning.",
                "Kage Sable's seal is on the rider. Delivery is late. This warning is for the contracting party as much as it is for you.",
                "Your history is different. Part of it was already taken before you reached Moonshadow, but our records do not name the owner. Find out who altered your past. Until then, even the Hollow Moon does not know how to classify you."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
            { ...storyPage("The Contract's Guard", "The safe room, a shadow detaching from the contract itself", "Nyx", [
                "It said someone took part of your history. We'll find out what that means after we deal with this guard.",
                "The shadow is bound to the page. Its job is to keep the contract intact.",
                "The shadow is keeping us away from the rider. I cannot tell whether breaking its binding frees those claims or only destroys the evidence. Keeping the page whole may let me trace the drafter.",
                "The lamp is going out. Decide."
            ]), image: "/scenes/story/story-moonshadow-village-35-3.webp" },
        ], [
            { text: "Study the binding as you break it. Learn the drafter's hand.", conclusion: "Each time the guard moves, a line of script flares on the rider. You watch for a repeated pattern while Nyx copies the marks, including a quartered circle beside each name. The guard closes on her before she reaches the last line.", trait: "suspicious" },
            { text: "Break the escrow outright. Eleven names go free tonight.", conclusion: "You strike the binding instead of the guard. Eleven names flare across the page, each one still caught in the escrow. Nyx snatches up a pen to preserve them before the paper burns. The shadow folds around the contract, forcing you to break its defense before you can free anyone.", trait: "honorable" },
            { text: "Keep the rider intact. A contract with her name on it is leverage.", conclusion: "You slide a protected case beneath the rider without tearing Sable's seal. The shadow clamps both hands over the page. Nyx warns that every moment spent preserving the evidence is another moment its eleven claims remain active. You will have to contain the guard without destroying what it guards.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 50, "Jonin of the Hidden Knife", "Jonin Trial: Mirror Assassin", "🌙", [
            { ...storyPage("The Mirrored Chamber", "The tower's mirrored chamber, a hundred reflections, one Kage", "Kage Sable Nocturne", [
                "Come in. Ignore the mirrors.",
                "I know about the cellar, the rider, and the thing you saw in the lamp. I've read every report on you.",
                "I could have you killed. I'm promoting you instead. Kneel.",
                "The rank is real. So is the assignment that comes with it. You should assume I'm keeping you close because I don't trust you."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "Ask what she did with your report on the confession booths.", nextPage: 1, requireTrait: "ms42-reported-the-booths" },
                { text: "Take the errand and read it later.", nextPage: 2 }
            ] },
            { ...storyPage("The Report She Kept", "The mirrored chamber, Sable drawing one page from her sleeve", "Kage Sable Nocturne", [
                "I have the report you filed about the confession booths. The tower intercepted it before it reached the watch.",
                "Someone files a complaint every few years. Usually they describe the fear and stop there.",
                "You mapped the drain.",
                "That is why I'm promoting you. I want you close enough to watch."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "The corridor, after.", nextPage: 2 }
            ] },
            { ...storyPage("Collateral That Reports", "The tower corridor, Nyx leaning where the guards pretend not to see her", "Nyx", [
                "Jonin. That was quick.",
                "Your new rank means the tower will record everything you do more closely. Be careful what you say around me too.",
                "I had a badge once. It took me a month to understand it was mostly there to make me easier to track.",
                "Read the assignment twice. Small errands are how they find out what you'll do on a larger one."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp", choices: [
                { text: "The trial waits below.", nextPage: 3 }
            ] },
            { ...storyPage("The Mirror Assassin", "The trial floor beneath the chamber, your own reflection stepping out of the glass", "Kage Sable Nocturne", [
                "Every Moonshadow Jonin takes this trial.",
                "The Mirror keeps a reading of everyone registered here. It uses that reading to make the opponent in front of you.",
                "It knows whatever the registry knows about you. It also shares the registry's gaps.",
                "Yours appeared half a second late. Begin when you're ready."
            ]), image: "/scenes/story/story-moonshadow-village-50-4.webp" },
        ], [
            { text: "Fight it to a standstill, then claim its reading as your property.", conclusion: "You tell Sable the trial's reading belongs to whoever takes possession of it. Her mouth almost becomes a smile. The reflection drops low to protect itself like an asset under threat, while a registry brush waits beside the floor for a transfer it cannot record until one of you yields.", trait: "ambitious" },
            { text: "Study its moves. It's built from the registry's file on you. Learn the file's gaps.", conclusion: "You defend and compare. The reflection knows the academy forms and every move Moonshadow has watched. It stutters at the habits the registry never saw. Sable notices you testing the gaps and orders the model to close distance before you can map them all.", trait: "suspicious" },
            { text: "Refuse to fight yourself. Stand still and let it choose.", conclusion: "You lower your weapon. The reflection follows half a beat later. Sable orders it to attack, and it raises its blade again. You have a moment to brace before it reaches you.", trait: "honorable" },
        ]),
        milestone("Moonshadow Village", 65, "Mission to Kill a Witness", "Veiled Hand Executioner", "🌙", [
            { ...storyPage("The Unwritten Order", "The tower's night office, an errand delivered as a whisper, nothing on paper", "Narrator", [
                "The order arrives the way the worst ones do here: spoken, thirdhand, easy to deny. No seal, no page, no file. The small errand's true face, finally shown.",
                "A shrine witness on the eastern canal has been copying names. The witness dies tonight. The Jonin of the Hidden Knife handles it personally. The tower never asked.",
                "There is nothing you can show a witness to prove who gave the order. If the killing is exposed, the blame will fall on you.",
                "The shrine on the eastern canal keeps its lamps low. Witnesses usually do."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
            { ...storyPage("The Copied Names", "The canal shrine, an old keeper laying pages flat with shaking hands", "Shrine Witness", [
                "You're the one they sent. Sit down and read before you decide what to do with me.",
                "There are three hundred eleven names here, going back forty years. The booth records say they were sold downward. They may still be alive.",
                "Their families think they left. I made copies so the original records couldn't be erased without a trace.",
                "Read the third page. I think that's why the tower sent you instead of someone it trusts."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Read the third page.", nextPage: 2 }
            ] },
            { ...storyPage("The Third Page", "The shrine, one page under the low lamp", "Narrator", [
                "The third page is newer than the others. The names on it are children.",
                "Halfway down, in the witness's careful duplicate hand, one entry is ringed where the original was ringed: a girl, aged nine at sale, her true name traded by her own hand, 'consideration: one winter's food.' Sold to a buyer marked with a quartered circle. Storage fees current, paid quarterly, forty years running.",
                "Beside the sale, a later entry gives the day name she uses now: Nyx. The witness confirms the stall's address. It is the woman you know.",
                "Nyx's true name has a holder, and a price, and a receipt, and she has been buying information about that file her whole life without ever once being able to afford the file itself."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "Take Nyx's file page. Whatever else tonight becomes, this leaves with you.", nextPage: 3, trait: "ms65-saved-the-file" },
                { text: "Send the page to Nyx tonight, unsigned. Hers to hold first.", nextPage: 3, trait: "ms65-gave-nyx-the-file" },
                { text: "Copy nothing, take nothing. The witness's set stays whole and hidden.", nextPage: 3, trait: "ms65-resealed-the-crate" }
            ] },
            { ...storyPage("The Second Knife", "The shrine door, a second figure arriving with excellent manners", "Veil Adaza", [
                "Evening. Veil Adaza. The tower prefers us as unsigned silhouettes. I prefer introductions.",
                "I received the same order you did. Same witness, same night. The tower is testing both of us.",
                "My order says that if you hesitate, I finish the job.",
                "The Executioner behind me is here in case we both refuse. What do you want to do?"
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp", choices: [
                { text: "\"I've stood between bolts and the chained before. I'm doing it again.\"", nextPage: 4, requireTrait: "rd52-shielded-the-line" },
                { text: "Answer with your stance, at the shrine door.", nextPage: 4 }
            ] },
            { ...storyPage("The Executioner's Patience", "The shrine yard, the Veiled Hand Executioner unfolding from the dark", "Veil Adaza", [
                "I was hoping you'd protect the door.",
                "The witness is still copying. The tower wants those names reduced to one set, and it wants to see whether you obey.",
                "The Executioner won't negotiate. I already tried once.",
                "It's coming."
            ]), image: "/scenes/story/story-moonshadow-village-65-5.webp" },
        ], [
            { text: "Stand between the Executioner and the shrine. The copying continues.", conclusion: "You take the shrine door while the keeper keeps copying. Adaza plants herself beside you and states, for her report, that the tower ordered a witness killed without a page. The Executioner has no concern for the report. It advances, and the two of you meet it before it reaches the lamp.", trait: "merciful" },
            { text: "Unmask the errand: shout the tower's order to the whole canal.", conclusion: "You shout the tower's order across the canal. Windows open, and people gather on the opposite bank. Adaza steps in front of the shrine keeper. The Executioner turns toward your voice and attacks.", trait: "reckless" },
            { text: "Let Adaza engage first. Read the Executioner's contract as it fights.", conclusion: "As Adaza holds it off, you read the script flashing along the Executioner's seal. You call out the phrase that ends its assignment. It pauses, but a fresh order burns across the seal and sends it forward again. Adaza reaches your side. 'It bought us a breath. Ready?'", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 75, "Nyx Chooses a Side", "Shadow Network Hunter", "🌙", [
            { ...storyPage("The Red Moon Ledger", "A rooftop over the whisper market, red moon, Nyx's ledger open to a page of shame", "Nyx", [
                "Sit down. Have a drink. I need to tell you something.",
                "Six months ago, people working for Hollow Gate offered to buy information about you. I accepted.",
                "I sold them lies. Fake routines, false debts, places you never went. They paid full price every time.",
                "After a while, I understood they didn't care whether the information was true. They wanted me to keep choosing to sell you. I'm sorry."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
            { ...storyPage("The Free Envelope", "The rooftop, one envelope on the tiles between you, unpriced", "Nyx", [
                "This envelope names Hollow Gate's agent inside the tower. It includes the room and the hours when their correspondence arrives.",
                "It is worth more than everything I own.",
                "Take it. I don't want payment. You do not owe me trust with it.",
                "I stopped keeping a file on you too."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "\"You named the lattice once. Now name its agent out loud with me.\"", nextPage: 2, requireTrait: "rd74-bound-the-lattice" },
                { text: "Take the envelope, but tell her the apology does not settle the account between you.", nextPage: 3 },
                { text: "Ask her to verify the room and hours once more before you rely on them.", nextPage: 3 }
            ] },
            { ...storyPage("Naming It", "The rooftop, the red moon deepening", "Nyx", [
                "The lattice was the old name for the same network. The tower calls it Hollow Gate now.",
                "Four village anchors feed one system, and each tower has someone handling its messages.",
                "The agent in our tower is named in that envelope.",
                "There. We both know it. Neither of us gets to pretend this is only business anymore."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp", choices: [
                { text: "The moon's light bends.", nextPage: 3 }
            ] },
            { ...storyPage("The Lecture", "The rooftop, the red moonlight pooling into a standing shape", "Hollow Moon", [
                "You brought us both the unclassified subject and the dealer who broke her terms. Convenient.",
                "We knew your reports were false. Their content did not matter. The signed sale was enough to keep your account open.",
                "Tonight you passed verified information without a price. The ledger marks an unclassified transfer.",
                "The Hunter will correct the discrepancy and return the information to its proper account."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
            { ...storyPage("The Shadow Network Hunter", "The rooftop, shapes rising from every drain and gutter the market owns", "Nyx", [
                "That's the Hunter. I was afraid they'd send it.",
                "It doesn't kill people. It takes them back and removes whatever made them refuse. I've met people after that happened.",
                "No. I'm not taking the envelope back.",
                "Back to back. Don't let it get hold of either of us."
            ]), image: "/scenes/story/story-moonshadow-village-75-6.webp" },
        ], [
            { text: "Study how the Hunter binds its target. Look for a way to break its grip.", conclusion: "Back to back with Nyx, you watch the Hunter build its hold from her old receipts. The chain catches when it reaches the free envelope. There is no price to lock. A tower handler forces the grip past the gap. Nyx notices. 'Good,' she says, breathing hard. 'Now make it matter.'", trait: "suspicious" },
            { text: "Stay at Nyx's side. Keep the Hunter away from her.", conclusion: "You take Nyx's shoulder and give the Hunter no contract, debt, or hidden exchange to exploit. It stops searching for one and drives both of you toward the roof edge by force. Nyx refuses the envelope it offers her. Neither of you looks away from the next rush.", trait: "honorable" },
            { text: "Counter-offer the Hollow Moon, mid-fight: the agent's name for its retreat.", conclusion: "You shout your offer over the Hunter's shoulder: call it off, and the envelope's name stays private one more season. The moonlight pauses long enough to log the terms, then marks them PENDING SETTLEMENT. The Hunter closes again. Nyx swears once. 'You opened an account. Try living long enough to dispute it.'", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 85, "The Kage Owns Every Secret", "Veiled Hand Grandmaster", "🌙", [
            { ...storyPage("The Night of Open Files", "The whisper market at dawn, forty years of intake dumped on every doorstep", "Narrator", [
                "It happens in one night. Every original file still held on the archive shelves is unsealed and returned to its subject. Doorsteps. Stall counters. Nailed to the shrine door. The Mirror's copied claims remain in the tank, but the papers people can hold come back all at once.",
                "Arguments break out in homes along the canal. Three brokers flee before the fish carts arrive. A moneylender weeps over his file on the steps while people hurry past, clutching their own returned records.",
                "The returns are chaotic, but their route is exact.",
                "Every packet went to its subject. Not to an enemy or a buyer. Each doorstep bears the name inside the file."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp" },
            { ...storyPage("The Controlled Burn", "Nyx's stall, shutters up, her own returned file unopened on the counter", "Nyx", [
                "Mine came too. The tower used every courier it had to return the archive originals in one night. Sable ordered it. The Mirror still retains its copies.",
                "A transfer notice arrived at midnight. Someone with a quartered-circle seal is taking ownership of the Mirror.",
                "Sable returned the paper originals before the buyer arrived. She hasn't dealt with the copies in the Mirror.",
                "My file is here. I've wanted it for forty years, and now I can't open it."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "\"You pulled Harrow back from the Mirror job. Now ask her who the buyer is.\"", nextPage: 2, requireTrait: "ms80-pulled-her-back" },
                { text: "Climb to the tower before the transfer lands.", nextPage: 3 }
            ] },
            { ...storyPage("The Buyer's Name", "The stall's back room, Harrow arriving with her collar up and her license folded away", "Kite Harrow", [
                "You kept me from taking the Mirror contract. I owe you this.",
                "The client never asked what any secret said. They only asked how much the Mirror could hold and how long it retained a copy.",
                "They want the container, not the information. It's the same pattern as the reserve, the vault, and the Rootfire.",
                "Sable knows. Go to the tower before the transfer finishes."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Up the tower.", nextPage: 3 }
            ] },
            { ...storyPage("The Empty Archive", "The tower archive, stripped to bare shelves, Sable alone in the wreck of her life's work", "Kage Sable Nocturne", [
                "Come in. I returned the files. All of them.",
                "Before I did, I found a prior claim on every record in the archive. The mark was the quartered circle. I thought I owned this collection. I was maintaining it for Hollow Gate.",
                "The Mirror's transfer is still due tonight. Returning the papers hasn't stopped it. The tank holds a copy of everything the booths collected.",
                "Here is the founding lease. Its first signature line is blank, but I kept renewing it. I won't break the tank until you show me how people can survive what it holds."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp", choices: [
                { text: "Take the founding lease with you. The blank line no hand ever signed is evidence too.", nextPage: 4, trait: "ms85-copied-the-blank-line" },
                { text: "Leave the paper. Bring her the living truth instead.", nextPage: 4 }
            ] },
            { ...storyPage("The Veiled Hand Grandmaster", "The tower stair, the eldest Veiled Hand unfolding from the shadows it taught", "Narrator", [
                "The Grandmaster of the Veiled Hand has served through changes of Kage and repeated attempts to replace it. It protects the system itself, not Sable personally.",
                "Below, people are reading the files the market returned. Above, the buyer is preparing to take ownership of the Mirror.",
                "The Grandmaster's oldest order is simple: nobody reaches the Mirror unless the registry has set a value on them and holds their contract.",
                "The registry has never managed to put a value on you. To the Grandmaster, that makes you a threat, and it fills the stair."
            ]), image: "/scenes/story/story-moonshadow-village-85-7.webp" },
        ], [
            { text: "Stand with the market: shepherd the night of open files at street level.", conclusion: "You return to the street and stand between the families and the brokers trying to seize their files. The Grandmaster follows you down. You tell the families to get indoors as it advances.", trait: "loyal" },
            { text: "Go through the Grandmaster now. The Mirror doesn't change hands tonight.", conclusion: "You take the tower stairs before the transfer bell. The Grandmaster gives no warning and no speech. It simply fills the landing, the oldest contract in the Hand made flesh. Above it, the Mirror's ownership line begins to move. Reaching the chamber in time means going through now.", trait: "reckless" },
            { text: "Audit the lease itself. Every contract that binds has a breach clause.", conclusion: "You open Moonshadow's founding lease to the required signature that was never made. An unsigned debt cannot be collected under the contract's own terms. The Grandmaster reaches for the page as soon as you read the clause aloud. Keeping the blank line for the final confrontation means keeping it out of those hands.", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 100, "The Moon Belongs to No One", "Kage Sable Nocturne, Hollow Moon Sovereign", "🌙", [
            { ...storyPage("The Black Moon", "The tower summit stair, the moon overhead gone black as the Mirror", "Narrator", [
                "The moon goes black at dusk, and nobody in the market needs it explained: the collection date arrived. The buyer's escrow sits full. Tonight the account of Moonshadow settles, one way or the other.",
                "The village does not follow you up the tower. People stay home with every lamp lit and place their returned files in the windows, where Sable can see them.",
                "The shrine keeper and a moneylender climb with you, carrying their records. Nyx is waiting on the summit landing.",
                "At the summit landing, on the last step, someone has left a cup of canal tea, still warm, and a note in a broker's quick hand: 'Argue dry and you'll lose. No charge. N.'",
                "The Mirror chamber stands open. It has been waiting half a second longer for you than for anyone."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp" },
            { ...storyPage("At the Chamber Door", "The summit door, Nyx with her returned file tucked unopened in her coat", "Nyx", [
                "Sable wants you to enter first. I'll wait by the door until you call for me.",
                "I brought the file the tower returned. I still haven't opened it. I want us both to get through tonight first.",
                "Harrow was right about one thing. Someone got to Sable before Sable got to the rest of us. That doesn't excuse her.",
                "I'll hold the door. Come back."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Enter the Mirror chamber.", nextPage: 2 }
            ] },
            { ...storyPage("The Woman and the Tank", "The Mirror chamber, the black glass vast and still, Sable's shadow no longer matching her", "Kage Sable Nocturne", [
                "You're here. Good.",
                "The Mirror holds a copy of every act of trust surrendered through a name, confession, secret, or favor. It transfers to Hollow Gate tonight.",
                "My shadow stopped matching me in the spring. The Gate is taking its payment from me too. I renewed the lease every quarter, so don't mistake that for innocence.",
                "Three people challenged me before you. I destroyed them. Their files are still in the Mirror. You do not need to have read them to know what I did.",
                "Go on. Show me why this should be different."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Face her before the glass.", nextPage: 25 }
            ] },
            { ...storyPage("The Better Truth", "The Mirror chamber, the Returning's receipts fanned on the black glass", "Kage Sable Nocturne", [
                "Let me see those.",
                "Eleven files returned with the owners' consent. I read the reports.",
                "One week without a killing does not make the market safe. How many people were threatened afterward? How many returns were staged?",
                "Show me the rest."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "\"Eleven files returned before witnesses. Zero fires. The market saw it hold.\"", nextPage: 4, requireTrait: "ms88-open-returns" },
                { text: "Lay the sealed receipts on the glass and read her every countersigned line.", nextPage: 5, requireTrait: "ms88-sealed-receipts" },
                { text: "\"Your booth clerks checked the returns. They found no violence linked to them.\"", nextPage: 6, requireTrait: "ms88-baited-the-market" },
                { text: "Show her Nyx's childhood bill of sale.", nextPage: 7 }
            ] },
            { ...storyPage("What the Market Saw", "The chamber, the black glass showing the market's lanterns far below", "Kage Sable Nocturne", [
                "All eleven happened in the open market?",
                "My people found no killings tied to the returns. I had them check three times.",
                "If the market saw it work, other people will try it whether I allow them to or not."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass moves.", nextPage: 8 }
            ] },
            { ...storyPage("The Countersigned Receipts", "The chamber, receipts flat on the glass, her finger moving line to line", "Kage Sable Nocturne", [
                "Give them to me.",
                "Owner verified, witness signed. Eleven times. The shrine witness, the moneylender, and Iro?",
                "These signatures could have been bought. No. I know three of these hands. They weren't.",
                "The receipts are valid."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass moves.", nextPage: 8 }
            ] },
            { ...storyPage("The Market's Own Arithmetic", "The chamber, a booth's price-slate held up to the glass", "Kage Sable Nocturne", [
                "I saw the new prices at dusk. I had two clerks punished because I thought they forged the slates.",
                "They didn't. Every booth reached the same conclusion on its own: returning a file is survivable, and holding one is becoming dangerous.",
                "The market has already moved without me."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass moves.", nextPage: 8 }
            ] },
            { ...storyPage("The Unopened File", "The chamber, one file on the black glass, still closed", "Kage Sable Nocturne", [
                "That's Nyx's file. She was nine when she sold the name for food.",
                "She kept this bill of sale even after I returned her archive file.",
                "I don't know what you think that proves.",
                "She wants the original sale annulled. Giving her the papers back didn't end the claim on her name."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass moves.", nextPage: 8 }
            ] },
            { ...storyPage("The Names in the Glass", "The Mirror chamber, the receipts against the tank, the reflection changing", "Narrator", [
                "The receipts change the black glass. The keeper's face fades, and the names on the signatures rise into its place.",
                "A single clear line crosses the tank, and a voice follows it, level and old. OWNERS VERIFIED. RETURN CHAIN WITNESSED. CONSENT CONFIRMED. NO HOLDER REQUIRED.",
                "'The First Reflection,' Sable says, very quietly. 'The Mirror's oldest instruction. Witness the truth. Then let it go. We kept the witnessing and removed the letting go.'",
                "She straightens, and does not look away from the glass again."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "The glass stills.", nextPage: 12 }
            ] },
            { ...storyPage("Her Own Name", "The chamber door opening, Nyx crossing the black glass floor", "Nyx", [
                "%name, step back. I need to say this myself.",
                "Sable, you know the name I use. You also have the record of the name I sold when I was nine because I needed food.",
                "My name is Nerissa Vale. My mother chose it. It belongs to me.",
                "That's all."
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
                "Nerissa Vale. I know that name.",
                "That voice from the glass is in the oldest Mirror plans. I thought it was ceremonial.",
                "The original instruction was to hear a truth, verify the person who entrusted it, and release the claim. Hollow Gate added the rule that the Mirror keeps a copy and treats it as property.",
                "I knew the plans. I kept the copies anyway."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "She steps back from the glass.", nextPage: 12 }
            ] },
            { ...storyPage("Unlisted", "The Mirror chamber, Sable's shadow finishing its departure", "Kage Sable Nocturne", [
                "I have nothing left to bargain with.",
                "But I won't let you open the tank. You'll have to force me."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("Returns Without Names", "The chamber, the return figures chalked plain, no receipts behind them", "Kage Sable Nocturne", [
                "Eleven returns and no violence tied to them. I had the figures checked three times.",
                "But I don't have names, signatures, or proof that the owners agreed.",
                "I'm not opening a four-hundred-year-old tank on an anonymous report."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "She turns back to the glass.", nextPage: 25 }
            ] },
            { ...storyPage("The File in Your Coat", "Nyx's file in Sable's hands, hers to weigh, unopened", "Kage Sable Nocturne", [
                "This is Nyx's bill of sale. Her signature is on it, and it was still in your coat.",
                "You saved it and told yourself you were keeping it safe.",
                "That's what I told myself about the whole archive.",
                "Give it back to her. Then tell me how different you are."
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
                "Don't touch that. I need to show it to her myself.",
                "Sable, this is the buyer's transfer manifest. Everything in the Mirror is listed.",
                "I'm on line four hundred and six. Not my accounts. Me.",
                "I spent forty years thinking I was part of the market. I was part of the inventory. So I'm done helping you protect it."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "He sets the manifest beside the glass.", nextPage: 25 }
            ] },
            { ...storyPage("The Blank Line", "The Mirror chamber, the founding lease unrolled on the black glass, older than the tank", "Kage Sable Nocturne", [
                "The founding lease. The first holder never signed it.",
                "I found the blank line in my first year as Kage.",
                "I could have challenged the lease then. I was afraid of what Hollow Gate would do, so I renewed it every quarter for forty years.",
                "The original debt may be invalid. My signatures are not."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the shelf. You've been paying its fee for seasons.", "The reckoning", "Kage Sable Nocturne", [
                "So Iro sold you a shelf. That gave you access to other people's files. He always did know how to make a trap look private.",
                "Did you ever open one just because you could? Take your time. I know what the honest answer costs.",
                "I did the same thing for forty years and called it protection. The scale is different. The excuse isn't."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for my file. I burned the delivered copy.", "The reckoning", "Kage Sable Nocturne", [
                "My clerks called it waste when you burned your file. I agreed with them for about an hour.",
                "I kept wondering whether it was worth giving up everything it could tell you.",
                "Don't answer. I can see that it was. I had thousands of chances to do the same and never did."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for Nerissa Vale. Her name comes home tonight.", "The reckoning", "Kage Sable Nocturne", [
                "I found Nerissa Vale's file in my first year. She was nine. She had sold her name for food.",
                "I could have returned it. I told myself the file proved how the whole system worked. The truth is I was afraid one return would start the rest.",
                "Tell her I read it every winter and still kept it. She should hear that tonight."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the night name you would not write.", "The reckoning", "Kage Sable Nocturne", [
                "You refused to write one. That matters more than leaving the space blank.",
                "You made the refusal explicit. My clerks couldn't pretend you had simply forgotten."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the night name that is yours alone.", "The reckoning", "Kage Sable Nocturne", [
                "When the file came to you, you chose a night name on your own terms and kept it.",
                "I held thousands of names before I understood how simple that was."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the leaf you tore out of your own file.", "The reckoning", "Kage Sable Nocturne", [
                "You tore the page from your own file before my clerks could use it.",
                "I was angry. I also understood."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("Answer for the night name you wrote to shield someone else.", "The reckoning", "Kage Sable Nocturne", [
                "You chose a name to protect someone else.",
                "The Mirror doesn't understand that. I think you did."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", choices: [
                { text: "Then release the claims. Let people choose what happens to their records.", nextPage: 25 }
            ] },
            { ...storyPage("The Glass and the Notice", "The Mirror chamber, the black moon at zenith, Sable's shadow finishing its departure", "Kage Sable Nocturne", [
                "The hearing is closed.",
                "I still believe opening this tank will destroy people. Look at the market below us. One night has already broken families, and there will be more.",
                "The buyer arrives tonight. I won't give it the Mirror, and I won't let you crack the glass because you hope the village can survive it.",
                "The Mirror holds everyone, %name. Everyone but you.",
                "There is no file that gives me terms for you. So there are no terms. Come through me."
            ]), image: "/scenes/story/story-moonshadow-village-100-8.webp", leftName: "Player", rightName: "Kage Sable Nocturne", rightImage: "/portraits/cinematic/storywide/kage-sable-nocturne-hollow.webp", choices: [
                { text: "Show her the better truth.", nextPage: 3, requireTrait: "ms88-better-truth-ready", forbidTrait: "ms88-nyx-proof-deferred", trait: "ms100-proof-presented-carried" },
                { text: "Let Nyx say her own name.", nextPage: 9, requireTrait: "ms88-better-truth-deferred", trait: "ms100-proof-presented-deferred" },
                { text: "Let Iro read the buyer's manifest.", nextPage: 16, requireTrait: "ms92-witness-present", trait: "ms100-iro-testified" },
                { text: "Show her the lease breach.", nextPage: 17, requireTrait: "ms85-copied-the-blank-line" },
                { text: "Show her Nyx's file.", nextPage: 14, requireTrait: "ms88-player-still-holds-nyx-file", forbidTrait: "ms88-better-truth-ready" },
                { text: "Show her the return figures.", nextPage: 13, requireTrait: "ms88-return-proven", forbidTrait: "ms88-better-truth-ready" },
                { text: "Answer for the shelf. You've been paying its fee for seasons.", nextPage: 18, requireTrait: "ms58-took-the-shelf" },
                { text: "Answer for my file. I burned the delivered copy.", nextPage: 19, requireTrait: "ms70-burned-the-file" },
                { text: "Answer for Nerissa Vale. Her name comes home tonight.", nextPage: 20, requireTrait: "ms88-nyx-proof-any" },
                { text: "Answer for the night name you would not write.", nextPage: 21, requireTrait: "ms70-night-name-refused" },
                { text: "Answer for the night name that is yours alone.", nextPage: 22, requireTrait: "ms70-night-name-claimed" },
                { text: "Answer for the leaf you tore out of your own file.", nextPage: 23, requireTrait: "ms70-night-name-stolen-back" },
                { text: "Answer for the night name you wrote to shield someone else.", nextPage: 24, requireTrait: "ms70-night-name-guardian" }
            ] },
        ], [
            { text: "Open the tank and return every claim to its owner.", conclusion: "You begin the witnessed release. The first copied claim clears instead of transferring, and Hollow Gate's immediate draw falters. Before the rest can follow, the old keeper protocol activates through Sable and forces her to defend the Mirror. People will still have to decide how to receive dangerous truths if you finish opening it.", trait: "honorable" },
            { text: "Return the claims, but hold dangerous records temporarily under public oversight.", conclusion: "You set a covenant for witnessed returns and temporary holds on records whose release poses an immediate threat. The first claim starts home under the new rule, but the keeper protocol activates through Sable before the covenant can be audited or enforced. Its limits will belong to the market only if you survive her defense.", trait: "merciful" },
            { text: "Take control of the Mirror yourself to prevent Hollow Gate's claim.", conclusion: "You claim the Mirror before the buyer can take it. The registry cannot find a valid price or owner for you, so the transfer stalls, but accepting the role also starts binding you to the tank. The keeper protocol turns Sable into its last defense before your first order can settle what the Mirror keeps.", trait: "loyal" },
        ]),
    ],
};

export function getCurrentStory(character: Character) {
    const storyLine = storylines[character.storyVillage || character.village] || storylines["Stormveil Village"];
    return storyLine[character.storyProgress] ?? null;
}
