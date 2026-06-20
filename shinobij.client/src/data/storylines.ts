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
    4:   { hp: 600,   damage: 18,  xp: 120,   ryo: 75 },
    15:  { hp: 2000,  damage: 32,  xp: 500,   ryo: 250 },
    25:  { hp: 3500,  damage: 50,  xp: 900,   ryo: 500 },
    35:  { hp: 5200,  damage: 68,  xp: 1400,  ryo: 800 },
    50:  { hp: 7500,  damage: 90,  xp: 2200,  ryo: 1300 },
    65:  { hp: 11000, damage: 120, xp: 3400,  ryo: 2000 },
    75:  { hp: 14000, damage: 148, xp: 4600,  ryo: 2800 },
    85:  { hp: 18000, damage: 185, xp: 6200,  ryo: 4000 },
    // Kage finale: the peer-band AI (lvl 100) hits with uncapped damage + full
    // mastery, so 24k HP made the grind unwinnable for non-maxed players. Lowered
    // to leave room for player skill; effective HP floors at ~14,553 via
    // aiHpForLevel(100, 0) in makeStoryBossAi (the kage HP-floor was dropped too).
    100: { hp: 14000, damage: 250, xp: 10000, ryo: 7500 },
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
            storyPage("The Training Cliffs", "Storm clouds roll above jagged cliffs. Young shinobi spar while lightning flashes behind the village.", "Elder Vanta", ["Elder Vanta: Stormveil does not hold your hand.", "Elder Vanta: Here, the sky itself tests whether you deserve to stand.", "Elder Vanta: Your first lesson is simple: move before the thunder lands."]),
            storyPage("The New One", "Mira Volt watches from a broken stone rail, smiling like trouble found a name.", "Mira Volt", ["Mira Volt: You are the new one?", "Mira Volt: Try not to freeze. Around here, hesitation gets you buried.", "Mira Volt: The Kage says every rookie has to bleed once before being counted."]),
            storyPage("Hear the Thunder", "The training scout steps into the ring while the cliffs echo with thunder.", "Elder Vanta", ["Elder Vanta: Do not mistake chaos for stupidity.", "Elder Vanta: The storm is wild, yes, but it always knows where to strike.", "Elder Vanta: Defeat the training scout. Show me you can hear the thunder before it arrives."]),
        ], [{ text: "I'll strike first.", conclusion: "Mira grins. Stormveil respects boldness.", trait: "reckless" }, { text: "I'll watch before I move.", conclusion: "Elder Vanta nods. Even chaos has patterns.", trait: "suspicious" }, { text: "I don't need a lesson.", conclusion: "The training scout laughs and rushes you.", trait: "ambitious" }]),
        milestone("Stormveil Village", 15, "The Riot Bell", "Tempest Guard Captain", "⚡", [
            storyPage("The Riot Bell Rings", "A bronze bell screams through the village. Shinobi are fighting in the market.", "Narrator", ["Narrator: The bell is not used for invasion.", "Narrator: It is used when Stormveil begins attacking itself.", "Narrator: Tonight, it rings three times."]),
            storyPage("Planted Chaos", "Mira drags an injured duelist behind a stall as lightning cracks overhead.", "Mira Volt", ["Mira Volt: This was supposed to be a duel circle.", "Mira Volt: Then someone handed out Kage-sealed orders telling both sides the other cheated.", "Mira Volt: That is not normal chaos. That is planted chaos."]),
            storyPage("Punishment Wall", "The Tempest Guard forms a line in the market square.", "Tempest Guard Captain", ["Tempest Guard Captain: By order of Kage Raiko, all fighters are guilty.", "Tempest Guard Captain: Anyone interfering will be treated as a traitor.", "Tempest Guard Captain: Step aside, rookie, unless you want your name carved into the punishment wall."]),
        ], [{ text: "Protect the injured.", trait: "merciful" }, { text: "Challenge the Guard Captain.", trait: "reckless" }, { text: "Ask who gave the order.", trait: "suspicious" }]),
        milestone("Stormveil Village", 25, "Orders Written in Lightning", "Lightning-Sealed Informant", "⚡", [
            storyPage("Burned Command", "You and Mira inspect a burned command scroll sealed by the Kage.", "Mira Volt", ["Mira Volt: This order is real.", "Mira Volt: The Kage's seal is not forged.", "Mira Volt: But why would he order his own guards to turn a duel into a riot?"]),
            storyPage("Old Storm", "Elder Vanta traces the scorched paper with shaking fingers.", "Elder Vanta", ["Elder Vanta: There is an old storm beneath Stormveil.", "Elder Vanta: The first exiles built the village above it because they thought no ruler could control it.", "Elder Vanta: Perhaps someone learned how."]),
            storyPage("Feed the Sky", "A voice speaks from inside the burned ink.", "Unknown Voice", ["Unknown Voice: Stormveil grows stronger when it breaks itself.", "Unknown Voice: Every argument. Every duel. Every betrayal.", "Unknown Voice: Feed the sky, and the sky will crown its master."]),
        ], [{ text: "Follow the voice into the storm tunnel.", trait: "reckless" }, { text: "Take the scroll to Elder Vanta first.", trait: "honorable" }, { text: "Hide the scroll and investigate alone.", trait: "suspicious" }]),
        milestone("Stormveil Village", 35, "The Storm Engine", "Storm Engine Warden", "⚡", [
            storyPage("Ancient Engine", "Beneath the village, an ancient engine spins with blue-black lightning.", "Narrator", ["Narrator: The tunnel opens into a chamber older than Stormveil.", "Narrator: Metal rings rotate around a crystal heart.", "Narrator: Every time the village above erupts in violence, the crystal pulses."]),
            storyPage("Hunger Machine", "Elder Vanta stares at the crystal as if it is staring back.", "Elder Vanta", ["Elder Vanta: This is no defense system.", "Elder Vanta: It is a hunger machine.", "Elder Vanta: Someone has tied our people's rage to Central's old gates."]),
            storyPage("Raiko Appears", "Kage Raiko Veyr steps from the lightning, smiling.", "Kage Raiko Veyr", ["Kage Raiko Veyr: Careful, Elder.", "Kage Raiko Veyr: You speak as if chaos is a disease.", "Kage Raiko Veyr: Chaos is the only reason Stormveil was never conquered."]),
        ], [{ text: "Kage Raiko, explain this.", trait: "honorable" }, { text: "Destroy the engine now.", trait: "reckless" }, { text: "Stay silent and listen.", trait: "suspicious" }]),
        milestone("Stormveil Village", 50, "Jonin of the Unchained Sky", "Jonin Rank Trial: Twin Tempest Duelists", "⚡", [
            storyPage("Kage Tower Balcony", "The Kage tower balcony overlooks hundreds of shinobi.", "Kage Raiko Veyr", ["Kage Raiko Veyr: You have survived the village.", "Kage Raiko Veyr: You have challenged guards, spies, and machines.", "Kage Raiko Veyr: Stormveil does not promote obedience. It promotes impact."]),
            storyPage("Too Proud", "Mira watches the Kage from the edge of the crowd.", "Mira Volt", ["Mira Volt: He is smiling too much.", "Mira Volt: A normal Kage would be angry you found the engine.", "Mira Volt: Raiko looks proud."]),
            storyPage("Rise as Jonin", "Raiko raises one hand and the crowd falls silent.", "Kage Raiko Veyr", ["Kage Raiko Veyr: Kneel, shinobi.", "Kage Raiko Veyr: Rise as Jonin.", "Kage Raiko Veyr: And remember: the village belongs to whoever is strong enough to seize it."]),
        ], [{ text: "Accept the promotion with honor.", trait: "honorable" }, { text: "Ask about the Storm Engine publicly.", trait: "reckless" }, { text: "Accept, but watch Raiko closely.", trait: "suspicious" }]),
        milestone("Stormveil Village", 65, "The Mission That Should Not Exist", "Tempest Execution Squad", "⚡", [
            storyPage("No Questions", "You are sent to silence a supposed rebel camp.", "Tempest Guard Captain", ["Tempest Guard Captain: Kage order.", "Tempest Guard Captain: No questions. No prisoners.", "Tempest Guard Captain: The camp is accused of plotting against Stormveil."]),
            storyPage("Not Rebels", "The camp is filled with wounded civilians and young shinobi.", "Rebel Medic", ["Rebel Medic: We are not rebels.", "Rebel Medic: We are the ones who refused to keep feeding the Storm Engine.", "Rebel Medic: Raiko sends loyal shinobi here so they become murderers without knowing."]),
            storyPage("Become Interesting", "Raiko appears on a ridge, watching.", "Kage Raiko Veyr", ["Kage Raiko Veyr: There it is.", "Kage Raiko Veyr: That beautiful moment when freedom becomes choice.", "Kage Raiko Veyr: Will you obey, or will you become interesting?"]),
        ], [{ text: "Protect the camp.", trait: "merciful" }, { text: "Demand the rebels surrender safely.", trait: "honorable" }, { text: "Pretend to obey while planning to betray Raiko.", trait: "suspicious" }]),
        milestone("Stormveil Village", 75, "Mira's Betrayal", "Mira Volt, False Betrayer", "⚡", [
            storyPage("Night Meeting", "Mira meets you at night with Tempest Guard sigils on her cloak.", "Mira Volt", ["Mira Volt: I joined Raiko.", "Mira Volt: Before you say anything, listen.", "Mira Volt: He thinks I betrayed you. I needed him to think that."]),
            storyPage("Gate Key", "Mira reveals a cracked key humming with storm chakra.", "Mira Volt", ["Mira Volt: The Storm Engine is only one piece.", "Mira Volt: Raiko has a Hollow Gate Key.", "Mira Volt: When Stormveil hits peak chaos, he will open a path to Central and become something worse than Kage."]),
            storyPage("Betrayal Feeds", "The storm speaks through the key fragment.", "Hollow Gate Echo", ["Hollow Gate Echo: Betrayal is still chaos.", "Hollow Gate Echo: Friend against friend. Blade against promise.", "Hollow Gate Echo: Thank you for feeding us."]),
        ], [{ text: "Trust Mira.", trait: "loyal" }, { text: "Fight Mira to keep her cover believable.", trait: "reckless" }, { text: "Refuse both sides and go alone.", trait: "ambitious" }]),
        milestone("Stormveil Village", 85, "The Kage's True Storm", "Hollow Tempest General", "⚡", [
            storyPage("Cyclone Tower", "A cyclone forms above the Kage tower.", "Elder Vanta", ["Elder Vanta: Raiko has stopped hiding.", "Elder Vanta: He is forcing every faction in Stormveil to fight at once.", "Elder Vanta: The storm is drinking us alive."]),
            storyPage("Eternal Conflict", "Raiko's voice rolls through every street with the thunder.", "Kage Raiko Veyr", ["Kage Raiko Veyr: Do you see it now?", "Kage Raiko Veyr: A village without conflict is a corpse.", "Kage Raiko Veyr: I will make Stormveil eternal by making it impossible to control."]),
            storyPage("Tyranny in Lightning", "Mira stands beside you under the cyclone.", "Mira Volt", ["Mira Volt: He does not love freedom.", "Mira Volt: He loves being the only one strong enough to survive the chaos.", "Mira Volt: That is not Stormveil. That is tyranny with lightning around it."]),
        ], [{ text: "Rally the factions together.", trait: "loyal" }, { text: "Challenge Raiko's strongest guard.", trait: "reckless" }, { text: "Destroy the storm anchors first.", trait: "suspicious" }]),
        milestone("Stormveil Village", 100, "Break the False Thunder", "Kage Raiko Veyr, Hollow Storm Tyrant", "⚡", [
            storyPage("Storm Eye Throne", "The Kage tower floats inside a storm eye.", "Kage Raiko Veyr", ["Kage Raiko Veyr: You climbed all the way here.", "Kage Raiko Veyr: Good.", "Kage Raiko Veyr: Stormveil needs a final argument."]),
            storyPage("Chaos Waits", "Below, the village is silent for the first time.", "Narrator", ["Narrator: Below, the village is silent.", "Narrator: For the first time, chaos waits.", "Narrator: Every shinobi watches to see who the storm will answer."]),
            storyPage("False Thunder", "Raiko's body fractures with Hollow Gate lightning.", "Kage Raiko Veyr", ["Kage Raiko Veyr: I betrayed nothing.", "Kage Raiko Veyr: I became the truth Stormveil was too afraid to name.", "Kage Raiko Veyr: Power belongs to those who take it."]),
        ], [{ text: "Stormveil is freedom, not your feeding ground.", trait: "honorable" }, { text: "You made chaos into chains.", trait: "suspicious" }, { text: "I'll take the Kage seat from you.", trait: "ambitious" }]),
    ],
    "Ashen Leaf Village": [
        milestone("Ashen Leaf Village", 4, "Roots of the Shinobi", "Wooden Root Guardian", "🌿", [
            storyPage("Roots of the Shinobi", "A quiet training yard rests beneath golden-green trees dusted with ash.", "Elder Mori", [
                "Elder Mori: Bow before the roots. Every shinobi who came before you stands beneath your feet.",
                "Elder Mori: Ashen Leaf does not train warriors. It grows them. That takes longer, and it asks more.",
                "Elder Mori: The Root Guardian is the first lesson. Not because it is easy, but because it is watching.",
            ]),
            storyPage("The Weight of Tradition", "Toma Reed stands at the edge of the yard, arms crossed, watching the Guardian stir.", "Toma Reed", [
                "Toma Reed: Tradition matters more than breathing here, but control still has to be chosen.",
                "Toma Reed: The elders will test you on what you know before they test you on what you can do.",
                "Toma Reed: Pass the Root Guardian and they will start to see you. Fail and you become a footnote.",
            ]),
            storyPage("The Old Ways Ask", "The Wooden Root Guardian rises from the ground, bark cracking, eyes lit with green fire.", "First Flame Avatar", [
                "First Flame Avatar: The old ways require proof before they offer shelter.",
                "First Flame Avatar: The roots remember everyone who walked this yard. They will remember you too.",
                "First Flame Avatar: Show them something worth remembering.",
            ]),
        ], [
            { text: "Bow to the roots before engaging.", trait: "honorable" },
            { text: "Read the Guardian's movement before striking.", trait: "suspicious" },
            { text: "Hit first. Prove intent.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 15, "The Forbidden Seed", "Rootbound Guard Initiate", "🌿", [
            storyPage("The Forbidden Seed", "A sacred tree blooms black flowers overnight.", "Elder Mori", [
                "Elder Mori: Some roots are not meant to be disturbed, but these flowers whisper like prisoners.",
                "Elder Mori: That tree has not flowered in three generations. The last time it did, six families disappeared.",
                "Elder Mori: The archive recorded it as a blessed harvest. I was there. It was not.",
            ]),
            storyPage("What the Elders Call It", "Toma Reed crouches beneath the black blooms, studying them without touching.", "Toma Reed", [
                "Toma Reed: That tree was dead yesterday. The elders are calling it a blessing.",
                "Toma Reed: I have been asking who tended this tree before it bloomed. No one will answer.",
                "Toma Reed: The Guard Initiate has been posted here since dawn. Someone does not want us near it.",
            ]),
            storyPage("What the Root Wants", "The Guard Initiate moves to block your path, hand already on their weapon.", "First Flame Avatar", [
                "First Flame Avatar: Feed the root. Burn the unwanted branch.",
                "First Flame Avatar: The black flowers are a signal, not a miracle. Something was planted here on purpose.",
                "First Flame Avatar: You are being watched to see whether you ask questions or follow orders.",
            ]),
        ], [
            { text: "Take a sample of the black flowers before they're removed.", trait: "suspicious" },
            { text: "Ask Elder Mori what the last bloom cost.", trait: "honorable" },
            { text: "Get past the Guard Initiate and find who tends the tree.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 25, "Names Removed from Scrolls", "Archive Spirit of the Root", "🌿", [
            storyPage("Names Removed from Scrolls", "Elder Mori's archive has missing scrolls and erased family lines.", "Elder Mori", [
                "Elder Mori: Entire family lines are gone. Not killed. Removed.",
                "Elder Mori: The gaps follow a pattern. Every removed name questioned the Kage within the last twenty years.",
                "Elder Mori: Someone has been tending this archive the same way they tend that tree.",
            ]),
            storyPage("Toma's Brother", "Toma Reed spreads the damaged scrolls across the archive floor, hands shaking.", "Toma Reed", [
                "Toma Reed: My brother questioned the Kage's old rituals. Now the record says he never existed.",
                "Toma Reed: I have his name on a letter he sent me two years ago. The archive does not.",
                "Toma Reed: This is not record-keeping. This is erasure while everyone watches.",
            ]),
            storyPage("The Archive Defends Itself", "The Archive Spirit rises from the scroll stacks, drawn by the disturbance in the records.", "First Flame Avatar", [
                "First Flame Avatar: Tradition remembers what it is ordered to remember.",
                "First Flame Avatar: The Spirit was not bound to protect truth. It was bound to protect the archive.",
                "First Flame Avatar: Those are not the same thing anymore.",
            ]),
        ], [
            { text: "Copy the missing names before anyone else can erase them.", trait: "suspicious" },
            { text: "Destroy the falsified records entirely.", trait: "reckless" },
            { text: "Confront the Kage with the pattern of removals.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 35, "The First Flame Chamber", "First Flame Sentinel", "🌿", [
            storyPage("The First Flame Chamber", "Hidden stairs beneath the oldest tree lead to a chamber of green fire.", "Elder Mori", [
                "Elder Mori: The First Flame was meant to preserve us, but willingness is no longer required.",
                "Elder Mori: It was built as an offering chamber. Shinobi who had nothing left would give themselves to keep the village alive.",
                "Elder Mori: No one is giving themselves freely anymore. The names in those scrolls are proof.",
            ]),
            storyPage("What Toma Sees", "Toma Reed stops at the entrance to the chamber, staring at the green fire.", "Toma Reed", [
                "Toma Reed: This is not a shrine. This is a furnace.",
                "Toma Reed: The heat is wrong. Shrines feel like remembrance. This feels like appetite.",
                "Toma Reed: The Kage has been feeding it. I want to know with what.",
            ]),
            storyPage("The Sentinel Rises", "The First Flame Sentinel steps from the fire, armored in hardened ash.", "First Flame Avatar", [
                "First Flame Avatar: Careless progress must be burned away.",
                "First Flame Avatar: The Sentinel does not distinguish between what was freely given and what was taken.",
                "First Flame Avatar: It simply guards the Flame. That is the problem.",
            ]),
        ], [
            { text: "Extinguish a section of the Flame to see what it's protecting.", trait: "reckless" },
            { text: "Find the offering records before fighting the Sentinel.", trait: "suspicious" },
            { text: "Destroy the Sentinel and shut the chamber down.", trait: "honorable" },
        ]),
        milestone("Ashen Leaf Village", 50, "The Branch That Rises", "Jonin Trial: Rootbound Master", "🌿", [
            storyPage("The Branch That Rises", "The Kage hall is filled with elders and incense.", "Elder Mori", [
                "Elder Mori: Ashen Leaf needs shinobi who can carry painful truths.",
                "Elder Mori: The elders know what you have seen. They are watching to see if you carry it or bury it.",
                "Elder Mori: The Jonin rank in this village is not a reward. It is a test of what you do with what you know.",
            ]),
            storyPage("Hoshina's Read", "Kage Hoshina Enju watches you from across the hall with something close to satisfaction.", "Toma Reed", [
                "Toma Reed: She is turning your suspicion into a promotion.",
                "Toma Reed: She wants you ranked because a Jonin who knows too much is easier to manage than a Chunin who keeps asking questions.",
                "Toma Reed: Accept carefully. Know what she thinks she just bought.",
            ]),
            storyPage("The Rootbound Master", "The trial begins as the Rootbound Master emerges from the chamber floor.", "First Flame Avatar", [
                "First Flame Avatar: Branches that grow too far from the tree must be cut.",
                "First Flame Avatar: The Rootbound Master tests whether your strength serves the village or only yourself.",
                "First Flame Avatar: That is a question the Flame has been asking for a long time.",
            ]),
        ], [
            { text: "Accept the rank and use it to dig further.", trait: "suspicious" },
            { text: "Accept and ask Hoshina directly what she expects in return.", trait: "honorable" },
            { text: "Decline until the erased names are answered for.", trait: "reckless" },
        ]),
        milestone("Ashen Leaf Village", 65, "The Mission of Quiet Ash", "Rootbound Retrieval Squad", "🌿", [
            storyPage("The Mission of Quiet Ash", "Sacred relics reveal the names of people fed to the First Flame.", "Elder Mori", [
                "Elder Mori: The dead are most useful when they stop arguing.",
                "Elder Mori: These relics were supposed to be destroyed. Someone hid them in the outer grove instead.",
                "Elder Mori: Every name on them is someone the archive says never existed.",
            ]),
            storyPage("What Toma Stole", "Toma Reed lays out stolen scrolls on a stone table, hands still.", "Toma Reed", [
                "Toma Reed: I stole names. Inside these scrolls are the people Hoshina fed to the Flame.",
                "Toma Reed: My brother is in here. So are forty-three others going back thirty years.",
                "Toma Reed: The Retrieval Squad is already looking for these. We have very little time.",
            ]),
            storyPage("The Squad Arrives", "The Rootbound Retrieval Squad enters the grove from three directions at once.", "First Flame Avatar", [
                "First Flame Avatar: Bring the relics back. Do not listen to their excuses.",
                "First Flame Avatar: The Squad was not told what they are retrieving. They were told it was stolen property.",
                "First Flame Avatar: They are following orders. The names in those scrolls are why that matters.",
            ]),
        ], [
            { text: "Protect the scrolls and take down the Squad.", trait: "merciful" },
            { text: "Hide the scrolls and lead the Squad away from them.", trait: "suspicious" },
            { text: "Send the scrolls with Toma and face the Squad alone.", trait: "loyal" },
        ]),
        milestone("Ashen Leaf Village", 75, "The Ancestors Speak", "Ancestor-Bound Flame Beast", "🌿", [
            storyPage("The Ancestors Speak", "The erased names glow inside the old archive.", "Elder Mori", [
                "Elder Mori: A record that hides murder is not history. It is a weapon.",
                "Elder Mori: The names are glowing because someone finally brought the relics back.",
                "Elder Mori: The archive is trying to correct itself. Whatever Hoshina bound to suppress it is fighting back.",
            ]),
            storyPage("What They Gave", "Toma Reed reads the names aloud one by one as the archive walls begin to shake.", "Toma Reed", [
                "Toma Reed: The ancestors gave themselves to save children, not children to save tradition.",
                "Toma Reed: Every name on that wall chose the Flame. None of the names in the stolen scrolls did.",
                "Toma Reed: Hoshina turned an offering into a sacrifice. That is the line she crossed.",
            ]),
            storyPage("The Flame Beast Wakes", "The Ancestor-Bound Flame Beast tears free of the archive walls, drawn by the restored names.", "First Flame Avatar", [
                "First Flame Avatar: Old roots. New blood. All will return to the first shape.",
                "First Flame Avatar: The Beast was not created to attack. It was created to protect what the archive tried to erase.",
                "First Flame Avatar: It does not know you yet. Show it you are not here to bury the names again.",
            ]),
        ], [
            { text: "Call the names out loud — show the Beast you restored them.", trait: "honorable" },
            { text: "Draw it away from the archive before it destroys the records.", trait: "reckless" },
            { text: "Let it burn what Hoshina corrupted and protect what remains.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 85, "The Kage Burns the Future", "Rootbound Elder Champion", "🌿", [
            storyPage("The Kage Burns the Future", "Kage Hoshina orders all young inventors arrested.", "Elder Mori", [
                "Elder Mori: The village must remember itself. Not as ash. As leaf.",
                "Elder Mori: She is arresting anyone who has built something new in the last five years.",
                "Elder Mori: Fourteen people this morning. Three of them are children.",
            ]),
            storyPage("What Hoshina Said", "Toma Reed watches the arrests from a rooftop, jaw tight.", "Toma Reed", [
                "Toma Reed: She is not preserving Ashen Leaf. She is freezing it in the past.",
                "Toma Reed: Hoshina told the council that innovation caused the last war. She is not wrong about the cause.",
                "Toma Reed: But arresting children for building things is not how you prevent the next one.",
            ]),
            storyPage("The Elder Champion", "The Rootbound Elder Champion steps forward to enforce the Kage's order.", "First Flame Avatar", [
                "First Flame Avatar: Innovation created the wars. I will save this village from tomorrow.",
                "First Flame Avatar: The Elder Champion has served Ashen Leaf for forty years. They believe this is right.",
                "First Flame Avatar: That is what makes them the hardest obstacle in the village.",
            ]),
        ], [
            { text: "Free the arrested inventors before they reach the Flame.", trait: "merciful" },
            { text: "Challenge the Elder Champion directly.", trait: "reckless" },
            { text: "Get to Hoshina before the arrests are complete.", trait: "suspicious" },
        ]),
        milestone("Ashen Leaf Village", 100, "The Tree Must Choose", "Kage Hoshina Enju, First Flame Vessel", "🌿", [
            storyPage("The Tree Must Choose", "The sacred tree burns green from root to crown.", "Elder Mori", [
                "Elder Mori: Every erased name has come to witness judgment.",
                "Elder Mori: The tree has not burned like this since it was planted. It is not dying.",
                "Elder Mori: It is deciding. The First Flame does not serve Hoshina anymore. It is asking what it should serve.",
            ]),
            storyPage("What Toma Carries", "Toma Reed stands at your side holding the recovered scrolls.", "Toma Reed", [
                "Toma Reed: If she falls, Ashen Leaf changes forever.",
                "Toma Reed: Every erased name in my hand is someone who trusted this village and was taken from it.",
                "Toma Reed: We do not fight for revenge. We fight so the next name on a scroll is chosen, not stolen.",
            ]),
            storyPage("Hoshina's Final Argument", "Kage Hoshina Enju steps into the green fire, the First Flame consuming her armor.", "Kage Hoshina Enju", [
                "Kage Hoshina Enju: If you fall, your name joins the ash.",
                "Kage Hoshina Enju: I did not erase them. I protected everything their deaths made possible.",
                "Kage Hoshina Enju: Ashen Leaf is alive because of what I fed the Flame. That is not murder. That is governance.",
            ]),
        ], [
            { text: "The names you erased are the village you claim to protect.", trait: "honorable" },
            { text: "Ashen Leaf survives by choosing — not by being fed to a fire.", trait: "merciful" },
            { text: "The tree is already choosing. You just cannot hear it.", trait: "ambitious" },
        ]),
    ],
    "Frostfang Village": [
        milestone("Frostfang Village", 4, "The Pack Survives", "Snow Warden Pup", "❄", [
            storyPage("The Pack Survives", "Snow lashes across a frozen training yard.", "Elder Sova", [
                "Elder Sova: The ice remembers footsteps. Walk with purpose, and it carries you.",
                "Elder Sova: This village was carved out of cold that killed everyone who came before us.",
                "Elder Sova: The training yard is your first test. It will not be your last.",
            ]),
            storyPage("Formation", "Captain Yura calls the drill over the sound of the wind.", "Captain Yura", [
                "Captain Yura: No shinobi stands alone. Your village gives your hands meaning.",
                "Captain Yura: The Snow Warden Pup is not the real lesson. Staying in formation when it charges is.",
                "Captain Yura: A wolf that breaks ranks is just a dog. Remember that.",
            ]),
            storyPage("The Cold Does Not Care", "The Snow Warden Pup circles the edge of the yard, watching for the weakest gap.", "Frost Seal Echo", [
                "Frost Seal Echo: Protect yourself, but think like part of a formation.",
                "Frost Seal Echo: The cold does not hate you. It simply does not care.",
                "Frost Seal Echo: Survive this, and the pack will remember your name.",
            ]),
        ], [
            { text: "Hold the formation line.", trait: "loyal" },
            { text: "Draw it toward me alone.", trait: "reckless" },
            { text: "Signal the others and flank it.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 15, "The Missing Patrol", "Oathbound Soldier", "❄", [
            storyPage("The Missing Patrol", "A patrol does not return from the northern ridge.", "Elder Sova", [
                "Elder Sova: Deserters leave heat behind. These left silence.",
                "Elder Sova: Five of Yura's best soldiers, all with fresh oaths. None would have run.",
                "Elder Sova: Something pulled them away from their post. Something patient.",
            ]),
            storyPage("The Closed File", "Captain Yura stands at the northern gate, looking out at empty tracks.", "Captain Yura", [
                "Captain Yura: Five shinobi vanished, and the Kage says they deserted.",
                "Captain Yura: I trained each of them. They were not the kind to break their oaths.",
                "Captain Yura: Kael closed the file before I could finish my report. That is not investigation. That is silence.",
            ]),
            storyPage("What Returns", "One of the missing soldiers walks through the gate at dusk, eyes flat and white.", "Frost Seal Echo", [
                "Frost Seal Echo: Repeat the Kage's judgment until doubt freezes.",
                "Frost Seal Echo: A soldier who doubts the Kage doubts the pack.",
                "Frost Seal Echo: Return to your post. The patrol will be explained in time.",
            ]),
        ], [
            { text: "Follow the trail north.", trait: "reckless" },
            { text: "Report what we know to Elder Sova.", trait: "honorable" },
            { text: "Ask the Kage directly what happened.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 25, "The Loyalty Seal", "Frost Seal Guardian", "❄", [
            storyPage("The Loyalty Seal", "The missing patrol is found alive in ice coffins.", "Elder Sova", [
                "Elder Sova: Something swallowed their vows and left obedience behind.",
                "Elder Sova: They breathe. They stand. They do not speak unless asked.",
                "Elder Sova: I have seen this seal used before. I helped write the theory behind it. I am not proud.",
            ]),
            storyPage("The Kage's Tool", "Captain Yura examines the seal burns on their wrists without touching them.", "Captain Yura", [
                "Captain Yura: The Kage brands soldiers before dangerous missions.",
                "Captain Yura: He told us the seal was for protection — a last resort if a shinobi was captured.",
                "Captain Yura: This is not protection. He used it on his own people.",
            ]),
            storyPage("What the Seal Says", "The Frost Seal Guardian rises from the ice, seal marks blazing across its arms.", "Frost Seal Echo", [
                "Frost Seal Echo: Choice creates weakness. Obedience preserves the pack.",
                "Frost Seal Echo: The sealed soldiers do not suffer. They are certain.",
                "Frost Seal Echo: Certainty is a gift. Most shinobi spend their lives searching for it.",
            ]),
        ], [
            { text: "Destroy the seal records before they can be used again.", trait: "honorable" },
            { text: "Find out who else has been sealed.", trait: "suspicious" },
            { text: "Demand the Kage explain himself.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 35, "The Pale Pack", "Oathbound Ice Captain", "❄", [
            storyPage("The Pale Pack", "Rebels gather in a cavern lit by blue fire.", "Elder Sova", [
                "Elder Sova: The ice screams from voices trapped beneath vows they never chose.",
                "Elder Sova: These are not criminals. They refused the seal and ran before it was forced on them.",
                "Elder Sova: Kael calls them deserters. I call them the only ones still thinking for themselves.",
            ]),
            storyPage("The Line Yura Won't Cross", "Captain Yura stands at the cave entrance, not yet stepping inside.", "Captain Yura", [
                "Captain Yura: We are loyal to Frostfang before we are loyal to Kael.",
                "Captain Yura: The Pale Pack did not abandon the village. They refused to let the village be taken from them.",
                "Captain Yura: I have been thinking about the difference between those two things for a long time.",
            ]),
            storyPage("What the Pack Remembers", "The Oathbound Ice Captain charges from the far end of the cavern.", "Frost Seal Echo", [
                "Frost Seal Echo: Unity is not a debate. Return, and I may forgive you.",
                "Frost Seal Echo: The pack needs every tooth. A loose tooth invites infection.",
                "Frost Seal Echo: Come back before this goes further. The Kage is not patient.",
            ]),
        ], [
            { text: "Stand with the Pale Pack.", trait: "honorable" },
            { text: "Warn them to stay hidden and leave.", trait: "merciful" },
            { text: "Ask how many others have refused the seal.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 50, "Jonin of the Frozen Oath", "Jonin Rank Trial: Glacier Twins", "❄", [
            storyPage("Jonin of the Frozen Oath", "The Kage hall is carved inside a glacier.", "Elder Sova", [
                "Elder Sova: Endurance is holy here, but forced loyalty is only fear wearing armor.",
                "Elder Sova: The Jonin rank in Frostfang comes with something the rank alone does not.",
                "Elder Sova: Watch what Kael offers you alongside the promotion. That is the real test.",
            ]),
            storyPage("Yura's Warning", "Captain Yura finds you in the corridor before the ceremony begins.", "Captain Yura", [
                "Captain Yura: If he offers you an oath seal, refuse without refusing.",
                "Captain Yura: I took mine because I thought loyalty and the seal were the same thing.",
                "Captain Yura: They are not. I know that now. I wish I had known it at your rank.",
            ]),
            storyPage("The Glacier Twins", "Two sealed figures emerge from the trial chamber walls, moving as one.", "Frost Seal Echo", [
                "Frost Seal Echo: Accept this mark of unity. Let the village know your heart cannot be divided.",
                "Frost Seal Echo: The Glacier Twins were sealed before birth. They know nothing else.",
                "Frost Seal Echo: That is not tragedy. That is strength without the weight of doubt.",
            ]),
        ], [
            { text: "Accept the rank and decline the seal.", trait: "honorable" },
            { text: "Accept the rank and take the seal on your own terms.", trait: "ambitious" },
            { text: "Ask what the seal costs the ones who carry it.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 65, "Orders in White Blood", "Oathbound Purge Unit", "❄", [
            storyPage("Orders in White Blood", "The Kage sends you to eliminate a Pale Pack shelter.", "Elder Sova", [
                "Elder Sova: Mercy is not weakness. It is the proof that choice survived.",
                "Elder Sova: The order Kael gave you is designed to make you something you are not.",
                "Elder Sova: What you find at that shelter will tell you who Frostfang is actually fighting.",
            ]),
            storyPage("What Was There", "The shelter holds children, elders, and four unsealed shinobi — not nineteen fighters.", "Captain Yura", [
                "Captain Yura: Look around. Are these enemies?",
                "Captain Yura: He told you nineteen Pale Pack fighters. He sent you here knowing what you would find.",
                "Captain Yura: He wants to know what you will do with it.",
            ]),
            storyPage("The Unit Behind You", "The Oathbound Purge Unit steps from the treeline — they followed you the entire way.", "Frost Seal Echo", [
                "Frost Seal Echo: Cut out the weakness. Return with proof of loyalty.",
                "Frost Seal Echo: The order is clear. Hesitation is not mercy — it is doubt.",
                "Frost Seal Echo: Complete this, and the conflict ends. Refuse, and you become the next target.",
            ]),
        ], [
            { text: "Protect the shelter.", trait: "merciful" },
            { text: "Get the civilians out before the unit reaches them.", trait: "loyal" },
            { text: "Stand between the unit and the shelter and force them to choose.", trait: "reckless" },
        ]),
        milestone("Frostfang Village", 75, "Yura Breaks the Oath", "Frostfang Oathbreaker Hunter", "❄", [
            storyPage("Yura Breaks the Oath", "Captain Yura kneels in the snow, carving the seal from her armor.", "Elder Sova", [
                "Elder Sova: The ice has been screaming for years.",
                "Elder Sova: Every sealed shinobi who doubted and said nothing — their silence built this moment.",
                "Elder Sova: Yura is not weak for breaking. She is the first one strong enough to.",
            ]),
            storyPage("What She Knows Now", "Captain Yura presses the blade against her own wrist without hesitation.", "Captain Yura", [
                "Captain Yura: I called obedience loyalty. I was wrong.",
                "Captain Yura: Everything I did under the seal — I need to know which of it was mine.",
                "Captain Yura: The only way to find out is to take it off and see what I do next.",
            ]),
            storyPage("The Oath Fights Back", "The Oathbreaker Hunter emerges from the treeline — sent to stop exactly this.", "Frost Seal Echo", [
                "Frost Seal Echo: Forced loyalty is heavier. The Gate opens beneath the weight.",
                "Frost Seal Echo: Remove the seal and you remove your place in the formation.",
                "Frost Seal Echo: You will be hunted. The pack does not forgive a tooth that pulls itself.",
            ]),
        ], [
            { text: "Help Yura through the removal.", trait: "merciful" },
            { text: "Stand guard — no one interrupts this.", trait: "loyal" },
            { text: "Demand the Echo name the Gate it keeps mentioning.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 85, "The Kage Freezes Dissent", "Oathbound Alpha Guard", "❄", [
            storyPage("The Kage Freezes Dissent", "Frostfang's central square is filled with frozen citizens.", "Elder Sova", [
                "Elder Sova: Preserved citizens are still prisoners.",
                "Elder Sova: The square held forty-three people this morning. None of them were armed.",
                "Elder Sova: He called it protection. He called the patrol desertion. He calls everything something else.",
            ]),
            storyPage("Kael's Explanation", "The Kage stands at the edge of the square, watching his village with something that looks like pride.", "Captain Yura", [
                "Captain Yura: He froze children, elders, medics — anyone who questioned him.",
                "Captain Yura: The Alpha Guard is still taking orders. They have not looked at the square.",
                "Captain Yura: If we can show them what is in that ice, we can end this without a battle.",
            ]),
            storyPage("The Guard Advances", "The Oathbound Alpha Guard moves to seal the square exits.", "Frost Seal Echo", [
                "Frost Seal Echo: No one has died. This is mercy.",
                "Frost Seal Echo: The village is stable. The chaos has been removed.",
                "Frost Seal Echo: When the threat passes, the ice will melt. This is how the pack endures.",
            ]),
        ], [
            { text: "Break the ice seals and free the citizens.", trait: "reckless" },
            { text: "Turn the Alpha Guard against Kael.", trait: "honorable" },
            { text: "Get to Kael before he seals anyone else.", trait: "suspicious" },
        ]),
        milestone("Frostfang Village", 100, "The Oath Must Break", "Kage Kael Whitefang, Hollow Oath Tyrant", "❄", [
            storyPage("The Oath Must Break", "The Kage throne sits inside the heart of the glacier.", "Elder Sova", [
                "Elder Sova: Loyalty chosen freely is stronger than any seal.",
                "Elder Sova: I have watched Frostfang for sixty years. It was built by people who had nothing but each other.",
                "Elder Sova: Kael did not build this village. He inherited it. And he is about to lose it.",
            ]),
            storyPage("What Yura Knows", "Captain Yura stands at your side, wrist bare where the seal used to be.", "Captain Yura", [
                "Captain Yura: That is what he forgot. That is why the village is no longer his.",
                "Captain Yura: Frostfang was loyal before the seals existed. The pack does not need chains to hold together.",
                "Captain Yura: End this. Not for us. For everyone still frozen in that square.",
            ]),
            storyPage("The Tyrant's Argument", "The Hollow Oath Tyrant rises from the glacier as every embedded seal in the walls begins to crack.", "Kage Kael Whitefang", [
                "Kage Kael Whitefang: If I fall, Frostfang may choose. If you fall, Frostfang will obey.",
                "Kage Kael Whitefang: I did not create the seals to control the village. I created them because the village kept choosing wrong.",
                "Kage Kael Whitefang: You are the last variable. After tonight, Frostfang will finally be safe.",
            ]),
        ], [
            { text: "The village never needed you to choose for it.", trait: "honorable" },
            { text: "Free the people in the square before this ends.", trait: "merciful" },
            { text: "A Kage who fears his own village has already lost it.", trait: "ambitious" },
        ]),
    ],
    "Moonshadow Village": [
        milestone("Moonshadow Village", 4, "No One Saves You", "Hidden Blade Trainee", "🌙", [
            storyPage("The Silent Yard", "The moon is hidden behind black clouds. The training yard is silent.", "Shade Master Iro", [
                "Shade Master Iro: Welcome to Moonshadow. No one will greet you, and no one will watch your back.",
                "Shade Master Iro: Every shinobi here has one skill in common: knowing exactly how much their presence is worth.",
                "Shade Master Iro: Find yours quickly, or someone else will assign you a value you will not enjoy.",
            ]),
            storyPage("New Blood", "A figure crouches on a rooftop above the yard, watching with quiet amusement.", "Nyx", [
                "Nyx: So you are the new one. You look like you are still waiting for someone to explain the rules.",
                "Nyx: There are no rules here. There are prices. Everything costs something.",
                "Nyx: The trainee in the yard already knows your face. I would start moving.",
            ]),
            storyPage("The First Test", "The Hidden Blade Trainee drops from the shadows, knife already drawn.", "Shade Master Iro", [
                "Shade Master Iro: Every shinobi's first lesson in Moonshadow is the same.",
                "Shade Master Iro: No one announces the test. No one tells you when it begins.",
                "Shade Master Iro: They simply send someone who is already better than you and wait to see what you do.",
            ]),
        ], [
            { text: "I'll read the opponent first.", conclusion: "Shade Master Iro watches closely. Good instincts.", trait: "suspicious" },
            { text: "Strike before they settle.", conclusion: "Nyx smirks from the rooftop. Aggressive suits this village.", trait: "reckless" },
            { text: "I have nothing to prove yet.", conclusion: "Shade Master Iro narrows his eyes. Neither does the knife.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 15, "The Sold Secret", "Veiled Hand Collector", "🌙", [
            storyPage("Unmarked Scroll", "A coded scroll appears in your room without a broken lock.", "Shade Master Iro", [
                "Shade Master Iro: Someone left that for you to find. Not to warn you. To test what you do with it.",
                "Shade Master Iro: The cipher is a dead network's hand. Whoever sent it wanted you to know they still exist.",
                "Shade Master Iro: In Moonshadow, information delivered without a price attached is a trap.",
            ]),
            storyPage("The Decoded Pattern", "Nyx reads the scroll by candlelight, tracing the cipher with one finger.", "Nyx", [
                "Nyx: Patrol routes. All of them. Yours, mine, the gate rotations.",
                "Nyx: Someone inside Moonshadow has been selling our movements to an outside buyer for months.",
                "Nyx: The worst part? Whoever leaked this is still being paid. The scroll proves the deal is ongoing.",
            ]),
            storyPage("The Collector Arrives", "A figure in layered veils steps through the door without knocking.", "Veiled Hand Collector", [
                "Veiled Hand Collector: You decoded it faster than expected.",
                "Veiled Hand Collector: That scroll was bait. The question was whether you would run to the Kage or keep it.",
                "Veiled Hand Collector: You kept it. Interesting. Now hand it over, or we test how well you fight indoors.",
            ]),
        ], [
            { text: "I kept it to find the real leak, not to protect it.", trait: "honorable" },
            { text: "You will tell me who hired you first.", trait: "suspicious" },
            { text: "The scroll stays with me.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 25, "Masks Beneath Masks", "Masked Auction Enforcer", "🌙", [
            storyPage("Below the Market", "A secret auction runs beneath the black market in a room that smells of old ink.", "Shade Master Iro", [
                "Shade Master Iro: Every mask in this room belongs to someone with a rank and a reason to hide it.",
                "Shade Master Iro: The first auction items were jutsu scrolls and contraband.",
                "Shade Master Iro: They are not selling contraband anymore.",
            ]),
            storyPage("What Is Being Sold", "Nyx points to the lot board as the auctioneer begins calling names.", "Nyx", [
                "Nyx: Lot four: Chunin patrol schedules. Lot five: medical records with chakra signatures.",
                "Nyx: Lot seven: bloodline names. Living ones. With home addresses.",
                "Nyx: Someone is building a list of everyone in Moonshadow who could threaten the Kage.",
            ]),
            storyPage("Spotted", "An enforcer in a blank white mask locks eyes with you from across the room.", "Masked Auction Enforcer", [
                "Masked Auction Enforcer: Guests do not attend without an invitation.",
                "Masked Auction Enforcer: You have two choices: leave with your memory wiped, or leave in pieces.",
                "Masked Auction Enforcer: Which would you prefer?",
            ]),
        ], [
            { text: "I came to buy. What is lot nine?", trait: "suspicious" },
            { text: "Shut this auction down.", trait: "honorable" },
            { text: "My invitation is staying alive long enough to walk out.", trait: "reckless" },
        ]),
        milestone("Moonshadow Village", 35, "The Hollow Moon Contract", "Contract-Bound Shadow", "🌙", [
            storyPage("The Bleeding Document", "The stolen Kage document bleeds black ink when held to moonlight.", "Shade Master Iro", [
                "Shade Master Iro: This is not a trade agreement and it is not a security directive.",
                "Shade Master Iro: It is a list of names the Kage has agreed to make disappear in exchange for something larger.",
                "Shade Master Iro: The ink is reactive. It was designed to destroy itself. Someone copied it fast.",
            ]),
            storyPage("The Real Purpose", "Nyx spreads the surviving pages across the floor, piecing them together.", "Nyx", [
                "Nyx: Sable is not removing threats. She is removing competition.",
                "Nyx: Every name on this list is a shinobi talented enough to challenge her position.",
                "Nyx: The contract is with an outside party. Someone who benefits from Moonshadow having only one strong leader.",
            ]),
            storyPage("The Shadow Speaks", "A voice slides out of the darkness at the edge of the room.", "Hollow Moon", [
                "Hollow Moon: The contract was signed before you arrived.",
                "Hollow Moon: Every secret your village has ever held was already being traded.",
                "Hollow Moon: Ambition is useful. It makes people sign things without reading the last page.",
            ]),
        ], [
            { text: "Who is the outside party?", trait: "suspicious" },
            { text: "Sable answers for every name on this list.", trait: "honorable" },
            { text: "I want to know what she was promised.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 50, "Jonin of the Hidden Knife", "Jonin Trial: Mirror Assassin", "🌙", [
            storyPage("The Mirror Chamber", "The Kage chamber has no guards. Every wall is mirrored floor to ceiling.", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: A room with no witnesses is never truly empty.",
                "Kage Sable Nocturne: The mirrors remember everything. So does the village.",
                "Kage Sable Nocturne: You have been thorough. You have been quiet. You have stayed useful.",
            ]),
            storyPage("Something Is Off", "Nyx waits in the corridor outside, too far for Sable to see.", "Nyx", [
                "Nyx: She knows exactly what you found. The contract, the auction, all of it.",
                "Nyx: A normal Kage would have had you silenced.",
                "Nyx: Sable promoted you. That means she thinks you are more valuable inside her hand than outside it.",
            ]),
            storyPage("The Price of Rank", "Sable extends a blade handle-first across the table.", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: Jonin of the Hidden Knife is not a rank given for loyalty.",
                "Kage Sable Nocturne: It is given to people whose ambition has matured enough to be aimed.",
                "Kage Sable Nocturne: The question is whether that ambition belongs to you, or to me.",
            ]),
        ], [
            { text: "Accept the rank on my own terms.", trait: "ambitious" },
            { text: "Accept, and watch everything she does after.", trait: "suspicious" },
            { text: "Ask what she expects in return.", trait: "honorable" },
        ]),
        milestone("Moonshadow Village", 65, "Mission to Kill a Witness", "Veiled Hand Executioner", "🌙", [
            storyPage("The Private Order", "Sable assigns a private assassination at the old shrine, no written record.", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: The target saw something they were not meant to see.",
                "Kage Sable Nocturne: They have not spoken yet, but they will. Silence is a delay, not a solution.",
                "Kage Sable Nocturne: I am not asking you to enjoy this. I am asking you to be useful.",
            ]),
            storyPage("What the Target Knows", "The target sits in the shrine, holding a folded paper with shaking hands.", "Shrine Witness", [
                "Shrine Witness: I copied the names before they were erased.",
                "Shrine Witness: People the Kage sold to the Hollow Gate. Alive ones.",
                "Shrine Witness: If you kill me, the list dies with me. But you already know what she is doing.",
            ]),
            storyPage("The Executioner Arrives", "A Veiled Hand operative appears at the shrine entrance, watching you both.", "Veiled Hand Executioner", [
                "Veiled Hand Executioner: The Kage sent backup in case you hesitated.",
                "Veiled Hand Executioner: This is not a test of loyalty. It is a test of whether you are still useful.",
                "Veiled Hand Executioner: Make a choice. We do not have long.",
            ]),
        ], [
            { text: "Protect the witness and take the list.", trait: "merciful" },
            { text: "Take down the Executioner and let the witness run.", trait: "reckless" },
            { text: "Appear to comply, then get the list out another way.", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 75, "Nyx Chooses a Side", "Shadow Network Hunter", "🌙", [
            storyPage("Rooftop Under a Red Moon", "Nyx waits on a rooftop beneath a blood-red moon, alone.", "Nyx", [
                "Nyx: Moonshadow teaches you to trust no one. I used that lesson against the Hollow Gate.",
                "Nyx: I spent six months selling them false intelligence. Bad patrol routes. Wrong names.",
                "Nyx: I found their real buyer: an agent embedded inside the Kage's inner circle.",
            ]),
            storyPage("The Gate's Hand Inside", "Nyx passes a small sealed envelope with a name written on the outside.", "Nyx", [
                "Nyx: The Hollow Gate does not want Moonshadow destroyed. It wants it hollow.",
                "Nyx: A village that runs on pure ambition and no loyalty is the easiest kind to feed.",
                "Nyx: Sable did not start this. She was recruited into it. The difference matters for what comes next.",
            ]),
            storyPage("The Moon Listens", "The red light on the rooftop deepens, and a voice resonates from the shadows.", "Hollow Moon", [
                "Hollow Moon: Selfishness is still hunger.",
                "Hollow Moon: A village of hungry people is a village that feeds us without noticing.",
                "Hollow Moon: Thank you for the months of careful secrets. Every one of them arrived.",
            ]),
        ], [
            { text: "We close the Gate's channel from inside.", trait: "suspicious" },
            { text: "Expose the embedded agent publicly.", trait: "honorable" },
            { text: "Let Sable think she still controls the village.", trait: "ambitious" },
        ]),
        milestone("Moonshadow Village", 85, "The Kage Owns Every Secret", "Veiled Hand Grandmaster", "🌙", [
            storyPage("The Files Open", "Every hidden archive in Moonshadow unseals at once. Secrets flood the streets.", "Shade Master Iro", [
                "Shade Master Iro: She did this.",
                "Shade Master Iro: Every debt, every betrayal, every name someone hid to survive. She released it all.",
                "Shade Master Iro: A village built on secrets does not survive when the secrets go public at once.",
            ]),
            storyPage("Controlled Collapse", "Sable watches from the Kage tower balcony as the village tears itself apart.", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: Moonshadow was always going to destroy itself. I simply chose the moment.",
                "Kage Sable Nocturne: When the smoke clears, the ones still standing will owe their survival to me.",
                "Kage Sable Nocturne: That is not a village anymore. That is a weapon.",
            ]),
            storyPage("Not Yet", "Nyx pulls you back from the street as two groups clash in the square below.", "Nyx", [
                "Nyx: She wants us in the chaos. She wants us blamed for it or consumed by it.",
                "Nyx: Every shinobi she cannot account for right now is a problem for her plan.",
                "Nyx: We do not fight in the square. We get to the tower.",
            ]),
        ], [
            { text: "Rally anyone still thinking clearly.", trait: "loyal" },
            { text: "Go straight for the tower now.", trait: "reckless" },
            { text: "Find and destroy the archive release mechanism first.", trait: "suspicious" },
        ]),
        milestone("Moonshadow Village", 100, "The Moon Belongs to No One", "Kage Sable Nocturne, Hollow Moon Sovereign", "🌙", [
            storyPage("The Tower in the Black Moon", "The Kage tower is swallowed in a black moon. Sable stands at the summit.", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: You climbed every rung.",
                "Kage Sable Nocturne: You read every scroll, survived every test, and refused to be useful on my terms.",
                "Kage Sable Nocturne: Moonshadow was always a ladder. The only question is who stands at the top.",
            ]),
            storyPage("What She Became", "The Hollow Moon light bleeds through Sable's shadow, and she does not seem to notice.", "Nyx", [
                "Nyx: She is not in control anymore. The Gate finished using her.",
                "Nyx: She thought she was feeding her own ambition. She was feeding the Hollow Moon.",
                "Nyx: Ambition that eats its village eventually eats its owner.",
            ]),
            storyPage("The Last Argument", "Sable's shadow stretches across the entire tower floor.", "Kage Sable Nocturne", [
                "Kage Sable Nocturne: I protected this village by owning every secret inside it.",
                "Kage Sable Nocturne: Without control, Moonshadow would have been picked apart years ago.",
                "Kage Sable Nocturne: If you win tonight, everyone will want what you have. Welcome to the top.",
            ]),
        ], [
            { text: "The moon belongs to no one. Not you. Not the Gate.", trait: "honorable" },
            { text: "You called it protection. They called it a cage.", trait: "merciful" },
            { text: "I did not climb here to own the village. I climbed here to free it.", trait: "loyal" },
        ]),
    ],
};

export function getCurrentStory(character: Character) {
    const storyLine = storylines[character.storyVillage || character.village] || storylines["Stormveil Village"];
    return storyLine[character.storyProgress] ?? null;
}
