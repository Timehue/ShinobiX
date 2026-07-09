/*
 * story-epilogues — short post-finale reckoning scenes, shown once after the
 * kage-finale boss falls (owner brief 2026-07-09: "ending modifiers").
 *
 * Selection: first entry whose `lane` matches the finale lane choice the
 * player fought through AND whose `requireTrait` (if any) is owned — so the
 * trait-gated variants MUST come before their ungated base entry for the same
 * lane, and every lane present must end with an ungated base entry (the
 * story-epilogues test enforces both).
 *
 * Zero imports on purpose (mirrors story-interludes.ts): tests dynamic-import
 * this module from the api suite without dragging the client tree along.
 * Display is read-only flavor: epilogues pay nothing, grant nothing, and are
 * never re-offered; skipping one loses nothing but the goodbye.
 */

export type StoryEpiloguePage = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
};

export type StoryEpilogueDef = {
    /** The finale lane trait this epilogue follows (e.g. "honorable"). */
    lane: string;
    /** Optional story-trait gate for a more specific variant (checked first). */
    requireTrait?: string;
    title: string;
    pages: StoryEpiloguePage[];
};

export const storyEpiloguesByVillage: Record<string, StoryEpilogueDef[]> = {
    "Ashen Leaf Village": [
        // ── Break the shears (honorable) ──────────────────────────────────
        {
            lane: "honorable",
            requireTrait: "al88-better-winter-ready",
            title: "The Honest Winter, Watered",
            pages: [
                {
                    title: "What Came Back",
                    scene: "Dawn over ash-house row, frost on returned paper",
                    speaker: "Narrator",
                    dialogue: [
                        "By dawn the whole village knows what broke in the night. Forty strides of cedar stand dark for the first time in four hundred years, and the wall's lines are just names now, keeping nobody.",
                        "People stand in their doorways holding what came back. Jorun has a bridge in his hands, forty years late. The weaver is reading her own school out loud to anyone who passes.",
                        "The walls groan when the wind leans on them. The ash in the mortar has stopped holding. It will be a hard winter, and an honest one.",
                    ],
                },
                {
                    title: "The Channel Never Stopped",
                    scene: "The east terrace channel, water climbing through frost",
                    speaker: "Toma Reed",
                    dialogue: [
                        "The channel never stopped turning. All night, through everything, it just kept climbing. Ninety mouths, remember. It won't carry the whole village.",
                        "It doesn't have to. It has to prove the rest can be built, and it already did. Jorun is drawing his flood-channel bridge again. Sena is nine and furious with ideas. We have until the deep cold to be clever.",
                        "Mori is on the terrace edge with a spade. He said you would understand. Something about being present for one beginning.",
                    ],
                },
            ],
        },
        {
            lane: "honorable",
            title: "The Honest Winter",
            pages: [
                {
                    title: "What Came Back",
                    scene: "Dawn over ash-house row, doors open to the cold",
                    speaker: "Narrator",
                    dialogue: [
                        "By dawn the whole village knows what broke in the night. The Register wall stands dark, the lines just names now, and everything the fire was holding has come home to people who had learned to live without it.",
                        "There is crying in ash-house row, the good kind and the other kind. The walls groan when the wind leans on them. The granary is being counted twice.",
                        "Nobody has said thank you yet. Nobody has thrown a stone either. It is going to be close, all winter, every winter, for a while.",
                    ],
                },
                {
                    title: "A Thin Spring, Freely Chosen",
                    scene: "The Reed kitchen, Aren's letter unfolded on the table",
                    speaker: "Toma Reed",
                    dialogue: [
                        "It's going to be a hungry spring. I want to say that plainly while I'm still brave. Nobody regrets it yet. Ask me again in the deep cold and I'll lie to you a little.",
                        "Aren's letter is on my mother's table now. She reads it every morning like it just arrived. That is worth a thin winter. I have to keep deciding that, and I keep deciding yes.",
                        "Come to the row tonight. We're planning fires people can actually sit around. It turns out that was always allowed.",
                    ],
                },
            ],
        },
        // ── Bind the Rootfire (merciful) ──────────────────────────────────
        {
            lane: "merciful",
            requireTrait: "al88-better-winter-ready",
            title: "Two Fires",
            pages: [
                {
                    title: "The Willing Flame",
                    scene: "The Rootfire chamber, one small clean flame, the alcove dusted",
                    speaker: "Narrator",
                    dialogue: [
                        "The Rootfire is small now, and clean. It burns exactly as bright as what people bring it, and people have been bringing things all morning: carved tokens, signed and given gladly, one by one.",
                        "The founders' alcove has been dusted. The iron racks stand empty, and Mori has already measured them for ordinary shelves.",
                        "Upstairs, the village is learning the new arithmetic. The fire keeps what is given freely, and only that.",
                    ],
                },
                {
                    title: "Bought Honestly Twice",
                    scene: "The kiln yard, steam and cold sunlight",
                    speaker: "Elder Mori",
                    dialogue: [
                        "Two fires now, if you count the channel. The willing flame for the worst nights, and Aren's machine for the ordinary ones. Between them, this winter is bought honestly twice over.",
                        "The alcove is filling again. Slowly, the way it should. Osu of the mill line would recognize this room at last.",
                        "You have made mercy into a working system, child. That is rarer than making it into a speech. Now come outside. There is planting to witness.",
                    ],
                },
            ],
        },
        {
            lane: "merciful",
            title: "The Thin Flame",
            pages: [
                {
                    title: "The Willing Flame",
                    scene: "The Rootfire chamber, one small clean flame",
                    speaker: "Narrator",
                    dialogue: [
                        "The Rootfire is small now, and clean, and honest, and everyone in the village understands exactly what that means for the cold season.",
                        "The willing alcove holds eleven new tokens by nightfall. Eleven, from a village of hundreds. Gladness was always a poor fuel. It is the only one left.",
                        "Nobody says the arithmetic out loud. Everyone is doing it.",
                    ],
                },
                {
                    title: "The Right to Be Asked",
                    scene: "The kiln stair, Toma turning a blank cedar token over",
                    speaker: "Toma Reed",
                    dialogue: [
                        "Eleven tokens. My mother's is one of them. I stood in that alcove for an hour with a blank piece of cedar, and I couldn't. I keep telling myself somebody has to stay unspent to do the work.",
                        "This is what you bought us, friend. The right to be asked. It is heavier than I thought, and I still want it.",
                        "Winter comes to a vote every year now. That is the deal. Help me make sure the vote keeps passing.",
                    ],
                },
            ],
        },
        // ── Take the shears (ambitious) — accusation depends on who carried
        //    the proof (owner FIX 12). Carried/deferred variants BEFORE base.
        {
            lane: "ambitious",
            requireTrait: "al88-better-winter-carried",
            title: "The Warm Chair",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The Rootfire chamber, the shears at your belt",
                    speaker: "Narrator",
                    dialogue: [
                        "The fire settles around you like a coat cut to your measure. Upstairs, forty strides of cedar are already learning your hand.",
                        "Hoshina's chair is still warm. Her room of taken wonders is yours now, every shelf of it, and the little walking loom goes still when you enter.",
                        "The keeper is dead. Long live the keeper. The wall has already put out a fresh black flower, and it is not for you.",
                    ],
                },
                {
                    title: "What Toma Saw",
                    scene: "The kiln stair door, Toma not coming in",
                    speaker: "Toma Reed",
                    dialogue: [
                        "I watched the water climb with my own eyes. Ninety mouths, not one future burned. You proved it. You carried the proof into that room in your own hands.",
                        "You showed her the door out and then sat down in her chair.",
                        "I don't know what to do with that. I've been standing here trying to build a sentence out of it and there isn't one.",
                        "Keep the model. I can't have it in the workshop. And don't send for me when the racks fill again, because they will, and you already know whose stamp goes on them.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            requireTrait: "al88-better-winter-deferred",
            title: "The Warm Chair",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The Rootfire chamber, the shears at your belt",
                    speaker: "Narrator",
                    dialogue: [
                        "The fire settles around you like a coat cut to your measure. Upstairs, forty strides of cedar are already learning your hand.",
                        "Hoshina's chair is still warm. Her room of taken wonders is yours now, every shelf of it, and the little walking loom goes still when you enter.",
                        "The keeper is dead. Long live the keeper. The wall has already put out a fresh black flower, and it is not for you.",
                    ],
                },
                {
                    title: "What Toma Saw",
                    scene: "The kiln stair door, Toma not coming in",
                    speaker: "Toma Reed",
                    dialogue: [
                        "You let us carry him in. You let my mother stand in front of the woman who cut him quiet and say his name out loud. I will hear that for the rest of my life.",
                        "Then you watched the door open and sat down in her chair anyway.",
                        "I don't know what to do with that. My mother doesn't either. She hasn't said a word since we came down the hill.",
                        "Keep the model. We don't want it back now. And don't send for us when the racks fill again, because they will, and we both know whose stamp goes on them.",
                    ],
                },
            ],
        },
        {
            lane: "ambitious",
            title: "Succession",
            pages: [
                {
                    title: "The New Keeper",
                    scene: "The Rootfire chamber, the shears at your belt",
                    speaker: "Narrator",
                    dialogue: [
                        "The fire settles around you like a coat cut to your measure. It does not celebrate. It has done this before.",
                        "In the morning the survey asks, very carefully, how you would like the schedules kept. The clerks have already changed the name on the approvals. The village is quiet, the way a field is quiet under snow.",
                        "Somewhere above, the wall puts out a fresh black flower on a stranger's line, and begins to wait again.",
                    ],
                },
                {
                    title: "Once a Year, To Your Face",
                    scene: "Mori's study, the bloom charts still open",
                    speaker: "Elder Mori",
                    dialogue: [
                        "Every keeper I have served stood where you are standing and believed they would be different. For a while, every one of them was. The fire is patient with new hands.",
                        "Hoshina asked angry people for a better winter for thirty years. I will ask you the same, once a year, to your face, for as long as I last.",
                        "The tree chose a new keeper. It always does. Prove an old man wrong, child. I would dearly like to file one surprise before I die.",
                    ],
                },
            ],
        },
    ],
};
